import { stampOf } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import { STORAGE_CAPACITY_GRAMS, type StorageLocation } from '../types/sample';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import type {
  CapacityRejection,
  ConflictField,
  MergePlan,
  MergePlanItem,
  SamplePackage,
} from '../types/sync';
import { getStationId } from './station';

/** 发现地对账签名：地名 / 地区 / 经纬度任一不同即视为发现地不一致 */
export function findSignature(f: FindRecord | null | undefined): string {
  if (!f) return '';
  return [
    f.placeName?.trim() ?? '',
    f.region?.trim() ?? '',
    roundCoord(f.longitude),
    roundCoord(f.latitude),
  ].join('|');
}

/** 重量对账签名：按 0.1g 精度比较，规避浮点尾数 */
export function weightSignature(w: number): string {
  return String(round1(Number(w) || 0));
}

/** 切片自然键：编号相同视为同一张（跨机器 id 不稳定，不拿 id 对账） */
export function sectionNaturalKey(s: ThinSection): string {
  return `sec:${s.sectionNo?.trim() ?? ''}`;
}

/** 分析记录自然键：方法 + 检测日期 + 全部检测值 */
export function analysisNaturalKey(a: AnalysisRecord): string {
  return [
    'ana',
    a.method,
    a.testedAt,
    round3(a.fa),
    round3(a.fs),
    round3(a.ni),
    round3(a.kamaciteBandwidth),
  ].join('|');
}

/**
 * 按样本编号 + 版本戳对账，产出合并计划（纯函数，不落库）。
 *
 * 规则：
 *  - 单边新增（本机无同编号）：直接并库（受容量预检约束）
 *  - 同编号同版本戳：视为同一记录，保留本机样本，补入本机没有的切片 / 分析 / 发现地
 *  - 同编号不同版本戳且重量 / 发现地 / 存放位置一致：跟进高版本并并子记录
 *  - 同编号不同版本戳且三项任一不一致：保留两条待裁决
 *  - 容量预检：任一新增样本导致柜架超重即整包拒绝（capacityRejections 非空）
 */
export function planMerge(input: {
  localSamples: MeteoriteSample[];
  localFinds: FindRecord[];
  localSections: ThinSection[];
  localAnalysis: AnalysisRecord[];
  pkg: SamplePackage;
}): MergePlan {
  const { localSamples, localFinds, localSections, localAnalysis, pkg } = input;

  const localByNo = new Map<string, MeteoriteSample[]>();
  for (const s of localSamples) {
    const list = localByNo.get(s.sampleNo) ?? [];
    list.push(s);
    localByNo.set(s.sampleNo, list);
  }
  const findOfSample = (sampleId: string) => localFinds.find((f) => f.sampleId === sampleId) ?? null;
  const sectionsOfSample = (sampleId: string) => localSections.filter((s) => s.sampleId === sampleId);
  const analysisOfSample = (sampleId: string) => localAnalysis.filter((a) => a.sampleId === sampleId);

  const incomingSectionsBySample = groupBy(pkg.sections, (s) => s.sampleId);
  const incomingAnalysisBySample = groupBy(pkg.analysis, (a) => a.sampleId);
  const incomingFindBySample = new Map(pkg.finds.map((f) => [f.sampleId, f]));

  const items: MergePlanItem[] = [];
  let directAddCount = 0;
  let childMergeCount = 0;
  let conflictCount = 0;
  let fastForwardCount = 0;

  for (const incoming of pkg.samples) {
    const incomingSections = incomingSectionsBySample.get(incoming.id) ?? [];
    const incomingAnalysis = incomingAnalysisBySample.get(incoming.id) ?? [];
    const incomingFind = incomingFindBySample.get(incoming.id) ?? null;

    const peers = localByNo.get(incoming.sampleNo) ?? [];
    // 已有待裁决副本时以本机原始侧为准（同编号本机侧排在前）
    const local =
      peers.find((s) => !s.pendingConflict) ?? peers.sort((a, b) => a.createdAt - b.createdAt)[0];

    // 该编号已在裁决流程中（两条都挂起）：本次不重复并、不重复建单
    if (local?.pendingConflict) {
      continue;
    }

    if (!local) {
      items.push({
        sampleNo: incoming.sampleNo,
        action: 'add-incoming',
        incoming,
        incomingSections: [...incomingSections],
        incomingAnalysis: [...incomingAnalysis],
        incomingFind,
      });
      directAddCount += 1;
      continue;
    }

    const localFind = findOfSample(local.id);

    if (stampOf(local.version) === stampOf(incoming.version)) {
      // 同编号同版本戳：同一记录，本机刚补的切片 / 分析全部保留，只补本机缺的
      const added = countNovelChildren(
        sectionsOfSample(local.id),
        analysisOfSample(local.id),
        localFind,
        incomingSections,
        incomingAnalysis,
        incomingFind,
      );
      childMergeCount += added;
      items.push({
        sampleNo: incoming.sampleNo,
        action: 'keep',
        local,
        incoming,
        incomingSections: [...incomingSections],
        incomingAnalysis: [...incomingAnalysis],
        incomingFind,
      });
      continue;
    }

    const fields = diffConflictFields(local, incoming, localFind, incomingFind);
    if (fields.length === 0) {
      // 版本不同但关键三项一致：跟进高版本（版本相同的分支已在上面处理）
      const added = countNovelChildren(
        sectionsOfSample(local.id),
        analysisOfSample(local.id),
        localFind,
        incomingSections,
        incomingAnalysis,
        incomingFind,
      );
      childMergeCount += added;
      fastForwardCount += 1;
      items.push({
        sampleNo: incoming.sampleNo,
        action: 'fast-forward',
        local,
        incoming,
        incomingSections: [...incomingSections],
        incomingAnalysis: [...incomingAnalysis],
        incomingFind,
      });
    } else {
      conflictCount += 1;
      items.push({
        sampleNo: incoming.sampleNo,
        action: 'conflict',
        local,
        incoming,
        fields,
        incomingSections: [...incomingSections],
        incomingAnalysis: [...incomingAnalysis],
        incomingFind,
      });
    }
  }

  // 容量预检：仅单边新增样本会新增柜位占用（待裁决两条先挂起、跟进高版本关键三项不变）
  const capacityRejections = evalCapacity(items, localSamples);

  return {
    items,
    directAddCount,
    childMergeCount,
    conflictCount,
    fastForwardCount,
    capacityRejections,
  };
}

/** 比较重量 / 发现地 / 存放位置三项不一致字段 */
export function diffConflictFields(
  local: MeteoriteSample,
  incoming: MeteoriteSample,
  localFind: FindRecord | null,
  incomingFind: FindRecord | null,
): ConflictField[] {
  const fields: ConflictField[] = [];
  if (weightSignature(local.totalWeight) !== weightSignature(incoming.totalWeight)) {
    fields.push('totalWeight');
  }
  if (findSignature(localFind) !== findSignature(incomingFind)) {
    fields.push('find');
  }
  if (local.storage !== incoming.storage) {
    fields.push('storage');
  }
  return fields;
}

function countNovelChildren(
  localSections: ThinSection[],
  localAnalysis: AnalysisRecord[],
  localFind: FindRecord | null,
  incomingSections: ThinSection[],
  incomingAnalysis: AnalysisRecord[],
  incomingFind: FindRecord | null,
): number {
  const sectionKeys = new Set(localSections.map(sectionNaturalKey));
  const analysisKeys = new Set(localAnalysis.map(analysisNaturalKey));
  let n = 0;
  for (const s of incomingSections) {
    const k = sectionNaturalKey(s);
    if (k !== 'sec:' && !sectionKeys.has(k)) {
      sectionKeys.add(k);
      n += 1;
    }
  }
  for (const a of incomingAnalysis) {
    const k = analysisNaturalKey(a);
    if (!analysisKeys.has(k)) {
      analysisKeys.add(k);
      n += 1;
    }
  }
  // 本机尚无发现地时，离线侧发现地随样本补入
  if (!localFind && incomingFind) n += 1;
  return n;
}

/** 逐柜位累加单边新增样本，超重即给出拒绝明细（任一超重 → 整包拒绝、原柜位不动） */
function evalCapacity(items: MergePlanItem[], localSamples: MeteoriteSample[]): CapacityRejection[] {
  const usedNow = new Map<StorageLocation, number>();
  for (const s of localSamples) {
    if (s.pendingConflict) continue;
    usedNow.set(s.storage, round1((usedNow.get(s.storage) ?? 0) + (Number(s.totalWeight) || 0)));
  }
  const rejections: CapacityRejection[] = [];
  for (const item of items) {
    if (item.action !== 'add-incoming' || !item.incoming) continue;
    const { storage, totalWeight, sampleNo } = item.incoming;
    const capacity = CAPACITY[storage];
    if (capacity === null) continue;
    const next = round1((usedNow.get(storage) ?? 0) + (Number(totalWeight) || 0));
    if (next > capacity) {
      rejections.push({
        sampleNo,
        storage,
        wouldUseGrams: next,
        capacityGrams: capacity,
        overflowGrams: round1(next - capacity),
        message: `${STORAGE_SHORT[storage]}容量 ${formatG(capacity)}，放入后将达 ${formatG(next)}，超重 ${formatG(next - capacity)}`,
      });
      // 超重样本不计入后续累加（它会被拒绝）
    } else {
      usedNow.set(storage, next);
    }
  }
  return rejections;
}

/** 离线包结构校验；通过则返回归一化后的包（旧数据无版本戳按初次入库补齐） */
export function validatePackage(raw: unknown): { pkg: SamplePackage | null; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { pkg: null, errors: ['文件内容不是合法 JSON 对象'] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== 'gbmeteorite-sample-package') {
    errors.push('缺少 kind=gbmeteorite-sample-package 标识，不是样本包文件');
  }
  const samples = Array.isArray(obj.samples) ? (obj.samples as MeteoriteSample[]) : null;
  if (!samples) errors.push('samples 缺失或不是数组');
  if (errors.length) return { pkg: null, errors };

  const seenNo = new Set<string>();
  for (const [i, s] of (samples ?? []).entries()) {
    if (!s || typeof s !== 'object') {
      errors.push(`samples[${i}] 不是对象`);
      continue;
    }
    if (!s.id) errors.push(`samples[${i}] 缺少 id`);
    if (!s.sampleNo || typeof s.sampleNo !== 'string') errors.push(`samples[${i}] 缺少样本编号`);
    else if (seenNo.has(s.sampleNo)) errors.push(`样本编号 ${s.sampleNo} 在包内重复`);
    seenNo.add(s.sampleNo);
    if (!(Number(s.totalWeight) > 0)) errors.push(`样本 ${s.sampleNo ?? i} 总重量非法`);
    if (!s.storage) errors.push(`样本 ${s.sampleNo ?? i} 缺少存放位置`);
    if (!s.category) errors.push(`样本 ${s.sampleNo ?? i} 缺少分类`);
  }
  if (errors.length) return { pkg: null, errors };

  return { pkg: normalizePackage(obj as unknown as SamplePackage), errors: [] };
}

/**
 * 归一化离线包：
 *  - 样本版本戳缺失按初次入库补 1；子记录 sampleVersion 缺失跟随所属样本版本
 *  - 清掉来源侧的待裁决标记（裁决状态不跨机器流动）
 *  - 非法 id 重新签发
 */
export function normalizePackage(obj: SamplePackage): SamplePackage {
  const now = Date.now();
  const samples = obj.samples.map((s) => ({
    ...s,
    id: s.id || `pkg_sample_${now}_${Math.random().toString(36).slice(2, 7)}`,
    version: stampOf(s.version),
    totalWeight: Number(s.totalWeight) || 0,
    pendingConflict: undefined,
    conflictId: undefined,
  }));
  const versionByIncomingId = new Map(samples.map((s) => [s.id, s.version]));

  const stampChild = <
    T extends { id?: string; sampleId: string; sampleVersion?: number },
  >(
    c: T,
    idx: number,
    p: string,
  ): T => ({
    ...c,
    id: c.id || `${p}_${now}_${idx}`,
    sampleVersion: stampOf(c.sampleVersion ?? versionByIncomingId.get(c.sampleId)),
  });

  return {
    kind: 'gbmeteorite-sample-package',
    pkgVersion: 1,
    stationId: typeof obj.stationId === 'string' && obj.stationId ? obj.stationId : 'unknown-station',
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : now,
    samples,
    finds: (Array.isArray(obj.finds) ? obj.finds : []).map((f, i) => stampChild(f, i, 'pkg_find')),
    sections: (Array.isArray(obj.sections) ? obj.sections : []).map((s, i) =>
      stampChild(s, i, 'pkg_section'),
    ),
    analysis: (Array.isArray(obj.analysis) ? obj.analysis : []).map((a, i) =>
      stampChild(a, i, 'pkg_analysis'),
    ),
  };
}

/** 导出当前本机档案为离线样本包（待裁决副本及其子记录不导出） */
export function buildExportPackage(input: {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
}): SamplePackage {
  const visibleIds = new Set(input.samples.filter((s) => !s.pendingConflict).map((s) => s.id));
  return {
    kind: 'gbmeteorite-sample-package',
    pkgVersion: 1,
    stationId: getStationId(),
    exportedAt: Date.now(),
    samples: input.samples.filter((s) => visibleIds.has(s.id)),
    finds: input.finds.filter((f) => visibleIds.has(f.sampleId)),
    sections: input.sections.filter((s) => visibleIds.has(s.sampleId)),
    analysis: input.analysis.filter((a) => visibleIds.has(a.sampleId)),
  };
}

/** 触发浏览器下载 JSON 文件 */
export function downloadJsonFile(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function groupBy<T>(list: T[], keyOf: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of list) {
    const k = keyOf(item);
    const arr = m.get(k) ?? [];
    arr.push(item);
    m.set(k, arr);
  }
  return m;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round3(v: number): string {
  return String(Number(v) || 0);
}
function roundCoord(v: number): string {
  return String(Math.round((Number(v) || 0) * 1e6) / 1e6);
}
function formatG(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(1)} g`;
}

const CAPACITY = STORAGE_CAPACITY_GRAMS;
const STORAGE_SHORT: Record<StorageLocation, string> = {
  'cabinet-a': 'A 柜',
  'cabinet-b': 'B 柜',
  desiccator: '干燥器',
  'loan-out': '外借',
};
