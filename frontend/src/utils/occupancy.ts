import {
  STORAGE_CAPACITY_GRAMS,
  type MeteoriteSample,
  type StorageLocation,
} from '../types/sample';
import type { StorageOccupancy } from '../types/sync';

/**
 * 柜架占用：待裁决（pendingConflict）样本暂不计入——
 * 它们尚未正式入库到任何一个柜位，裁决通过后才重新计入。
 */
export function calcOccupancy(samples: MeteoriteSample[]): StorageOccupancy[] {
  const used = new Map<StorageLocation, { grams: number; count: number }>();
  for (const s of samples) {
    if (s.pendingConflict) continue;
    const entry = used.get(s.storage) ?? { grams: 0, count: 0 };
    entry.grams += Number(s.totalWeight) || 0;
    entry.count += 1;
    used.set(s.storage, entry);
  }
  return (Object.keys(STORAGE_CAPACITY_GRAMS) as StorageLocation[]).map((storage) => {
    const e = used.get(storage) ?? { grams: 0, count: 0 };
    return {
      storage,
      usedGrams: round1(e.grams),
      capacityGrams: STORAGE_CAPACITY_GRAMS[storage],
      sampleCount: e.count,
    };
  });
}

/** 当前库状态下，某柜位再放入 weightGrams 是否超重；返回超重明细（不超重返回 null） */
export function checkCapacity(
  occupancy: StorageOccupancy[],
  storage: StorageLocation,
  weightGrams: number,
  /** 被替换 / 移动的样本 id：计算占用时先扣除它自身的重量 */
  excludeSampleId?: string,
  samples: MeteoriteSample[] = [],
): StorageOccupancy | null {
  const slot = occupancy.find((o) => o.storage === storage);
  if (!slot || slot.capacityGrams === null) return null;
  const ownWeight = excludeSampleId
    ? samples.find((s) => s.id === excludeSampleId && s.storage === storage && !s.pendingConflict)
        ?.totalWeight ?? 0
    : 0;
  const nextUsed = round1(slot.usedGrams - ownWeight + (Number(weightGrams) || 0));
  if (nextUsed > slot.capacityGrams) {
    return { ...slot, usedGrams: nextUsed };
  }
  return null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
