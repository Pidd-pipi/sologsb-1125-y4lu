import {
  STORAGE_CAPACITY,
  type AdviceSnapshot,
  type MeteoriteSample,
  type OccupancySnapshot,
  type StorageLocation,
} from '../types/sample';
import type { AnalysisRecord } from '../types/analysis';
import { classifyByAnalysis } from './classify';

/** 柜位是否计容量（外借中不占柜，无上限） */
export function hasCapacityLimit(storage: StorageLocation): boolean {
  return STORAGE_CAPACITY[storage] !== undefined;
}

/** 柜位容量上限 g；无限制返回 null */
export function capacityOf(storage: StorageLocation): number | null {
  const cap = STORAGE_CAPACITY[storage];
  return cap === undefined ? null : cap;
}

/** 柜架占用统计（只统计在档 active 样本；待裁决副本不占柜） */
export interface StorageLoad {
  storage: StorageLocation;
  used: number;
  capacity: number | null;
}

export function storageLoad(samples: Pick<MeteoriteSample, 'storage' | 'totalWeight' | 'status'>[]): StorageLoad[] {
  const loads = new Map<StorageLocation, number>();
  for (const s of samples) {
    if (s.status === 'pending') continue;
    loads.set(s.storage, (loads.get(s.storage) ?? 0) + (Number(s.totalWeight) || 0));
  }
  return (Object.keys(STORAGE_CAPACITY) as StorageLocation[]).map((storage) => ({
    storage,
    used: loads.get(storage) ?? 0,
    capacity: capacityOf(storage),
  }));
}

/**
 * 容量校验：把重量 weight 放入 target 柜位后是否超重。
 * excludeSampleId 用于改放（原柜位重量不计入）；pending 副本同样不占柜。
 * 返回 null 表示可入库，否则返回人类可读的拒绝原因。
 */
export function checkCapacity(
  samples: MeteoriteSample[],
  target: StorageLocation,
  weight: number,
  excludeSampleId?: string,
): string | null {
  const cap = capacityOf(target);
  if (cap === null) return null; // 外借等不限容量
  const used = samples
    .filter((s) => s.id !== excludeSampleId && s.status !== 'pending' && s.storage === target)
    .reduce((sum, s) => sum + (Number(s.totalWeight) || 0), 0);
  if (used + weight > cap) {
    return `柜位容量不足：当前已占 ${used} g / 上限 ${cap} g，再放入 ${weight} g 将超重 ${(
      used +
      weight -
      cap
    ).toFixed(1)} g，已保留原柜位`;
  }
  return null;
}

/**
 * 重量一变，分类建议立即失效重算。
 * 依据该样本最新一条检测记录重算；无检测记录时按登记分类给低置信兜底；
 * 连样本都没有时返回 null。
 */
export function recomputeAdvice(
  sample: Pick<MeteoriteSample, 'category' | 'totalWeight'>,
  analyses: Pick<AnalysisRecord, 'id' | 'fa' | 'fs' | 'ni' | 'kamaciteBandwidth' | 'createdAt'>[],
): AdviceSnapshot {
  const now = Date.now();
  const latest = analyses.length
    ? [...analyses].sort((a, b) => b.createdAt - a.createdAt)[0]
    : null;
  if (latest) {
    const advice = classifyByAnalysis(latest);
    return {
      basis: 'analysis',
      category: advice.category,
      confidence: advice.confidence,
      summary: advice.summary,
      hits: advice.hits,
      analysisId: latest.id,
      weightBasis: Number(sample.totalWeight) || 0,
      computedAt: now,
    };
  }
  return {
    basis: 'default',
    category: sample.category,
    confidence: 'low',
    summary: `暂无检测记录，按登记分类（${sample.category}）暂记；重量变化后建议补测重算。`,
    hits: [],
    weightBasis: Number(sample.totalWeight) || 0,
    computedAt: now,
  };
}

/** 重量 / 柜位一变，柜架占用立即失效重算 */
export function recomputeOccupancy(sample: {
  storage: StorageLocation;
  totalWeight: number;
}): OccupancySnapshot {
  return {
    storage: sample.storage,
    weight: Number(sample.totalWeight) || 0,
    computedAt: Date.now(),
  };
}

/** 分类建议快照是否已因重量变化失效 */
export function isAdviceStale(sample: Pick<MeteoriteSample, 'totalWeight' | 'adviceSnapshot'>): boolean {
  if (!sample.adviceSnapshot) return true;
  return sample.adviceSnapshot.weightBasis !== (Number(sample.totalWeight) || 0);
}

/** 柜架占用快照是否已失效（重量或柜位对不上） */
export function isOccupancyStale(
  sample: Pick<MeteoriteSample, 'storage' | 'totalWeight' | 'occupancySnapshot'>,
): boolean {
  if (!sample.occupancySnapshot) return true;
  return (
    sample.occupancySnapshot.storage !== sample.storage ||
    sample.occupancySnapshot.weight !== (Number(sample.totalWeight) || 0)
  );
}
