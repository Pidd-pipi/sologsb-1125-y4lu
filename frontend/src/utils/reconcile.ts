import { db, makeId } from '../db';
import type { FindRecord } from '../types/find';
import type { AnalysisRecord } from '../types/analysis';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import type {
  ConflictDiff,
  ConflictRecord,
  ImportFailure,
  MergeResult,
  PackageAnalysis,
  PackageFind,
  PackageSample,
  PackageSection,
  SamplePackage,
} from '../types/sync';
import { checkCapacity, recomputeAdvice, recomputeOccupancy } from './capacity';
import { validatePackageSample } from './package';

/** 冲突已被另一个标签页裁决 */
export class ConflictStaleError extends Error {
  constructor(public conflictId: string) {
    super('该冲突已被另一个标签页确认，本页选择已保留为草稿');
    this.name = 'ConflictStaleError';
  }
}

const emptyResult = (): MergeResult => ({
  mergedSamples: 0,
  mergedFinds: 0,
  mergedSections: 0,
  mergedAnalysis: 0,
  conflicts: 0,
  rejected: 0,
  stale: 0,
});

/** 切片自然键（编号优先，防重复并库） */
function sectionKey(s: { sectionNo: string }): string {
  return `no:${s.sectionNo.trim()}`;
}

/** 分析记录自然键（方法+日期+数值） */
function analysisKey(
  a: Pick<AnalysisRecord, 'method' | 'testedAt' | 'fa' | 'fs' | 'ni' | 'kamaciteBandwidth'>,
): string {
  return [a.method, a.testedAt, a.fa, a.fs, a.ni, a.kamaciteBandwidth].join('|');
}

/** 发现地是否一致（地点/地区/经纬度任一不同即视为不一致） */
function findMismatch(local: FindRecord, incoming: PackageFind): boolean {
  return (
    local.placeName.trim() !== incoming.placeName.trim() ||
    local.region.trim() !== incoming.region.trim() ||
    Number(local.longitude) !== Number(incoming.longitude) ||
    Number(local.latitude) !== Number(incoming.latitude)
  );
}

function findSummary(f: { placeName: string; region: string; longitude: number; latitude: number }): string {
  return `${f.region} · ${f.placeName}（${Number(f.longitude)}, ${Number(f.latitude)}）`;
}

function diffsFor(
  local: MeteoriteSample,
  incoming: PackageSample,
  localFind: FindRecord | undefined,
  incomingFind: PackageFind | undefined,
): ConflictDiff[] {
  const diffs: ConflictDiff[] = [];
  if (Number(local.totalWeight) !== Number(incoming.totalWeight)) {
    diffs.push({
      field: 'totalWeight',
      label: '重量',
      local: `${local.totalWeight} g`,
      incoming: `${incoming.totalWeight} g`,
    });
  }
  if (local.storage !== incoming.storage) {
    diffs.push({
      field: 'storage',
      label: '存放位置',
      local: local.storage,
      incoming: incoming.storage,
    });
  }
  if (localFind && incomingFind && findMismatch(localFind, incomingFind)) {
    diffs.push({
      field: 'findLocation',
      label: '发现地',
      local: findSummary(localFind),
      incoming: findSummary(incomingFind),
    });
  }
  return diffs;
}

interface MergeContext {
  result: MergeResult;
  /** 已落库的在档样本（含本次新增），用于容量校验 */
  activeSamples: MeteoriteSample[];
  analysesBySample: Map<string, AnalysisRecord[]>;
  failures: ImportFailure[];
  packageName: string;
  now: number;
}

/**
 * 离线样本包并库。按样本编号 + 版本戳对账：
 *  - 单边新增直接并库（含其切片 / 分析 / 发现记录）
 *  - 同编号且重量 / 发现地 / 存放位置不一致：保留两条 pending 待裁决
 *  - 版本更新：字段快进到新版本，子记录跟随版本；旧版本只补缺不降级
 *  - 容量不足：拒绝入库并保留原柜位，失败包可修正后重试
 */
export async function mergePackage(
  pkg: SamplePackage,
  packageName: string,
): Promise<MergeResult> {
  const result = emptyResult();
  const now = Date.now();

  await db.transaction(
    'rw',
    [db.samples, db.finds, db.sections, db.analysis, db.conflicts, db.importFailures],
    async () => {
      const [samples, finds, sections, analysis, conflicts] = await Promise.all([
        db.samples.toArray(),
        db.finds.toArray(),
        db.sections.toArray(),
        db.analysis.toArray(),
        db.conflicts.toArray(),
      ]);

      const activeByNo = new Map<string, MeteoriteSample>();
      const openConflictByNo = new Map<string, ConflictRecord>();
      for (const s of samples) {
        if (s.status === 'pending') continue;
        activeByNo.set(s.sampleNo, s);
      }
      for (const c of conflicts) {
        if (c.status === 'open') openConflictByNo.set(c.sampleNo, c);
      }

      const analysesBySample = new Map<string, AnalysisRecord[]>();
      for (const a of analysis) {
        const list = analysesBySample.get(a.sampleId) ?? [];
        list.push(a);
        analysesBySample.set(a.sampleId, list);
      }

      // 包内 children 按入站样本 refId 归属
      const incomingFindsByRef = groupBy(pkg.finds, (f) => f.sampleId);
      const incomingSectionsByRef = groupBy(pkg.sections, (s) => s.sampleId);
      const incomingAnalysisByRef = groupBy(pkg.analysis, (a) => a.sampleId);

      const ctx: MergeContext = {
        result,
        activeSamples: samples.filter((s) => s.status !== 'pending'),
        analysesBySample,
        failures: [],
        packageName,
        now,
      };

      // 编号去重：同一编号在包内出现多次只处理第一条，其余记失败
      const seenNos = new Set<string>();

      for (const incoming of pkg.samples) {
        const refId = incoming.refId;
        const inFinds = incomingFindsByRef.get(refId) ?? [];
        const inSections = incomingSectionsByRef.get(refId) ?? [];
        const inAnalysis = incomingAnalysisByRef.get(refId) ?? [];

        const entryError = validatePackageSample(incoming);
        if (entryError) {
          ctx.failures.push(
            buildFailure(packageName, 'invalid-entry', entryError, [incoming], {
              finds: inFinds,
              sections: inSections,
              analysis: inAnalysis,
            }, now),
          );
          result.rejected += 1;
          continue;
        }

        if (seenNos.has(incoming.sampleNo)) {
          ctx.failures.push(
            buildFailure(
              packageName,
              'invalid-entry',
              `${incoming.sampleNo} 在包内重复出现`,
              [incoming],
              { finds: inFinds, sections: inSections, analysis: inAnalysis },
              now,
            ),
          );
          result.rejected += 1;
          continue;
        }
        seenNos.add(incoming.sampleNo);

        const local = activeByNo.get(incoming.sampleNo);
        const openConflict = openConflictByNo.get(incoming.sampleNo);

        if (openConflict) {
          ctx.failures.push(
            buildFailure(
              packageName,
              'duplicate-conflict',
              `${incoming.sampleNo} 已有同编号冲突待裁决，请先在对账台裁决后重试`,
              [incoming],
              { finds: inFinds, sections: inSections, analysis: inAnalysis },
              now,
              openConflict.id,
            ),
          );
          result.rejected += 1;
          continue;
        }

        if (!local) {
          await insertNewSample(ctx, incoming, inFinds, inSections, inAnalysis);
          continue;
        }

        const localFind = finds.find((f) => f.sampleId === local.id && f.status !== 'pending');
        const incomingFind = inFinds[0];
        const diffs = diffsFor(local, incoming, localFind, incomingFind);

        if (diffs.length > 0) {
          await createConflict(ctx, local, incoming, inFinds, inSections, inAnalysis, diffs);
          continue;
        }

        // 内容一致：按版本戳处理
        if (incoming.version > (local.version ?? 1)) {
          const capacityMsg = checkCapacity(
            ctx.activeSamples,
            incoming.storage,
            incoming.totalWeight,
            local.id,
          );
          if (capacityMsg) {
            ctx.failures.push(
              buildFailure(
                packageName,
                'capacity',
                `${incoming.sampleNo} 版本 ${incoming.version} 快进被拒：${capacityMsg}`,
                [incoming],
                { finds: inFinds, sections: inSections, analysis: inAnalysis },
                now,
              ),
            );
            result.rejected += 1;
            continue;
          }
          await fastForward(
            ctx,
            local,
            incoming,
            inFinds,
            inSections,
            inAnalysis,
            { finds, sections, analysis },
          );
        } else {
          if (incoming.version < (local.version ?? 1)) result.stale += 1;
          // 相同版本或旧版本：只补缺的子记录（本机刚补的切片/分析不会被跳过），样本不降级
          const added = await mergeChildrenOnly(
            local.id,
            inFinds,
            inSections,
            inAnalysis,
            { finds, sections, analysis },
            local.version ?? 1,
            now,
          );
          if (added.finds || added.sections || added.analysis.length) {
            const mergedAnalyses = [
              ...(ctx.analysesBySample.get(local.id) ?? []),
              ...added.analysis,
            ];
            ctx.analysesBySample.set(local.id, mergedAnalyses);
            // 有新检测记录时按当前重量重算分类建议（重量未变，占用不受影响）
            if (added.analysis.length) {
              await db.samples.update(local.id, {
                adviceSnapshot: recomputeAdvice(local, mergedAnalyses),
              });
            }
            result.mergedFinds += added.finds;
            result.mergedSections += added.sections;
            result.mergedAnalysis += added.analysis.length;
          }
        }
      }

      if (ctx.failures.length) await db.importFailures.bulkAdd(ctx.failures);
    },
  );

  return result;
}

async function insertNewSample(
  ctx: MergeContext,
  incoming: PackageSample,
  inFinds: PackageFind[],
  inSections: PackageSection[],
  inAnalysis: PackageAnalysis[],
) {
  // 单边新增也要做容量校验：容量不足拒绝入库并保留（失败包原样保留）
  const capacityMsg = checkCapacity(ctx.activeSamples, incoming.storage, incoming.totalWeight);
  if (capacityMsg) {
    ctx.failures.push(
      buildFailure(
        ctx.packageName,
        'capacity',
        `${incoming.sampleNo} 无法入库：${capacityMsg}`,
        [incoming],
        { finds: inFinds, sections: inSections, analysis: inAnalysis },
        ctx.now,
      ),
    );
    ctx.result.rejected += 1;
    return;
  }

  const sampleId = makeId('sample');
  const { refId: _newRef, ...sampleFields } = incoming;
  void _newRef;
  const sample: MeteoriteSample = {
    ...sampleFields,
    id: sampleId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: incoming.version,
    status: 'active',
  };
  sample.adviceSnapshot = recomputeAdvice(sample, []);
  sample.occupancySnapshot = recomputeOccupancy(sample);
  await db.samples.add(sample);
  ctx.activeSamples.push(sample);
  ctx.result.mergedSamples += 1;

  const findRecords: FindRecord[] = inFinds.map((f) => ({
    ...f,
    sampleId,
    id: makeId('find'),
    createdAt: ctx.now,
    sampleVersion: incoming.version,
    status: 'active',
  }));
  if (findRecords.length) await db.finds.bulkAdd(findRecords);
  ctx.result.mergedFinds += findRecords.length;

  const sectionRecords: ThinSection[] = inSections.map((s) => ({
    ...s,
    sampleId,
    id: makeId('section'),
    createdAt: ctx.now,
    sampleVersion: incoming.version,
  }));
  if (sectionRecords.length) await db.sections.bulkAdd(sectionRecords);
  ctx.result.mergedSections += sectionRecords.length;

  const analysisRecords: AnalysisRecord[] = inAnalysis.map((a) =>
    toAnalysisRecord(a, sampleId, incoming.version),
  );
  if (analysisRecords.length) await db.analysis.bulkAdd(analysisRecords);
  ctx.analysesBySample.set(sampleId, analysisRecords);
  // 单边新增带来检测记录：立即给出分类建议快照
  if (analysisRecords.length) {
    await db.samples.update(sampleId, {
      adviceSnapshot: recomputeAdvice(sample, analysisRecords),
    });
  }
  ctx.result.mergedAnalysis += analysisRecords.length;
}

function toAnalysisRecord(a: PackageAnalysis, sampleId: string, version: number): AnalysisRecord {
  return {
    ...a,
    sampleId,
    id: makeId('analysis'),
    createdAt: Date.now(),
    sampleVersion: version,
  };
}

async function createConflict(
  ctx: MergeContext,
  local: MeteoriteSample,
  incoming: PackageSample,
  inFinds: PackageFind[],
  inSections: PackageSection[],
  inAnalysis: PackageAnalysis[],
  diffs: ConflictDiff[],
) {
  const conflictId = makeId('conflict');

  // 本机原记录转 pending（保留，总览与地图暂不显示）
  await db.samples.update(local.id, { status: 'pending', conflictId, updatedAt: ctx.now });
  const localIdx = ctx.activeSamples.findIndex((s) => s.id === local.id);
  if (localIdx >= 0) ctx.activeSamples.splice(localIdx, 1);
  await db.finds
    .where('sampleId')
    .equals(local.id)
    .modify((f) => {
      f.status = 'pending';
      f.conflictId = conflictId;
    });

  // 包内副本另立 pending
  const incomingSampleId = makeId('sample');
  const { refId: _incomingRef, ...incomingFields } = incoming;
  void _incomingRef;
  const incomingSample: MeteoriteSample = {
    ...incomingFields,
    id: incomingSampleId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: incoming.version,
    status: 'pending',
    conflictId,
  };
  incomingSample.adviceSnapshot = recomputeAdvice(incomingSample, []);
  incomingSample.occupancySnapshot = recomputeOccupancy(incomingSample);
  await db.samples.add(incomingSample);

  const incomingFinds: FindRecord[] = inFinds.map((f) => ({
    ...f,
    sampleId: incomingSampleId,
    id: makeId('find'),
    createdAt: ctx.now,
    sampleVersion: incoming.version,
    status: 'pending',
    conflictId,
  }));
  if (incomingFinds.length) await db.finds.bulkAdd(incomingFinds);

  const sectionRecords: ThinSection[] = inSections.map((s) => ({
    ...s,
    sampleId: incomingSampleId,
    id: makeId('section'),
    createdAt: ctx.now,
    sampleVersion: incoming.version,
  }));
  if (sectionRecords.length) await db.sections.bulkAdd(sectionRecords);

  const analysisRecords = inAnalysis.map((a) =>
    toAnalysisRecord(a, incomingSampleId, incoming.version),
  );
  if (analysisRecords.length) await db.analysis.bulkAdd(analysisRecords);

  const conflict: ConflictRecord = {
    id: conflictId,
    sampleNo: incoming.sampleNo,
    localSampleId: local.id,
    incomingSampleId,
    diffs,
    createdAt: ctx.now,
    status: 'open',
  };
  await db.conflicts.add(conflict);
  ctx.result.conflicts += 1;
}

async function fastForward(
  ctx: MergeContext,
  local: MeteoriteSample,
  incoming: PackageSample,
  inFinds: PackageFind[],
  inSections: PackageSection[],
  inAnalysis: PackageAnalysis[],
  existing: { finds: FindRecord[]; sections: ThinSection[]; analysis: AnalysisRecord[] },
) {
  const { refId: _ref, ...incomingFields } = incoming;
  void _ref;
  // 重量 / 柜位变化：分类建议与柜架占用立即失效重算
  const updated: MeteoriteSample = {
    ...local,
    ...incomingFields,
    updatedAt: ctx.now,
  };
  const added = await mergeChildrenOnly(
    local.id,
    inFinds,
    inSections,
    inAnalysis,
    existing,
    incoming.version,
    ctx.now,
  );
  // 子记录跟随所属样本版本（本机历史子记录也统一到新版本戳）
  await stampChildrenVersion(local.id, incoming.version);

  const mergedAnalyses = [
    ...(ctx.analysesBySample.get(local.id) ?? []),
    ...added.analysis,
  ];
  updated.adviceSnapshot = recomputeAdvice(updated, mergedAnalyses);
  updated.occupancySnapshot = recomputeOccupancy(updated);
  await db.samples.put(updated);
  const idx = ctx.activeSamples.findIndex((s) => s.id === local.id);
  if (idx >= 0) ctx.activeSamples[idx] = updated;
  ctx.analysesBySample.set(local.id, mergedAnalyses);
  ctx.result.mergedSamples += 1;
  ctx.result.mergedFinds += added.finds;
  ctx.result.mergedSections += added.sections;
  ctx.result.mergedAnalysis += added.analysis.length;
}

/** 把样本下的子记录版本戳统一到新版本 */
async function stampChildrenVersion(sampleId: string, version: number) {
  await db.sections.where('sampleId').equals(sampleId).modify({ sampleVersion: version });
  await db.analysis.where('sampleId').equals(sampleId).modify({ sampleVersion: version });
  await db.finds
    .where('sampleId')
    .equals(sampleId)
    .modify((f) => {
      f.sampleVersion = version;
    });
}

interface AddedChildren {
  finds: number;
  sections: number;
  analysis: AnalysisRecord[];
}

/**
 * 只合并缺失子记录（切片 / 分析按自然键去重，发现地按地点去重）。
 * 本机刚补的切片与分析记录一律保留，不会被并库跳过，也不会被包内记录覆盖。
 */
async function mergeChildrenOnly(
  sampleId: string,
  inFinds: PackageFind[],
  inSections: PackageSection[],
  inAnalysis: PackageAnalysis[],
  existing: { finds: FindRecord[]; sections: ThinSection[]; analysis: AnalysisRecord[] },
  version: number,
  now: number,
): Promise<AddedChildren> {
  // 发现地：同地点不重复入库（不一致已在冲突路径处理）
  const localFinds = existing.finds.filter((f) => f.sampleId === sampleId && f.status !== 'pending');
  const newFinds: FindRecord[] = [];
  for (const f of inFinds) {
    const dup = localFinds.some((lf) => !findMismatch(lf, f));
    if (dup) continue;
    newFinds.push({
      ...f,
      sampleId,
      id: makeId('find'),
      createdAt: now,
      sampleVersion: version,
      status: 'active',
    });
  }
  if (newFinds.length) await db.finds.bulkAdd(newFinds);

  // 切片：编号去重
  const localSections = existing.sections.filter((s) => s.sampleId === sampleId);
  const localSectionKeys = new Set(localSections.map(sectionKey));
  const newSections: ThinSection[] = [];
  for (const s of inSections) {
    if (localSectionKeys.has(sectionKey(s))) continue;
    newSections.push({
      ...s,
      sampleId,
      id: makeId('section'),
      createdAt: now,
      sampleVersion: version,
    });
    localSectionKeys.add(sectionKey(s));
  }
  if (newSections.length) await db.sections.bulkAdd(newSections);

  // 分析记录：自然键去重
  const localAnalysis = existing.analysis.filter((a) => a.sampleId === sampleId);
  const localAnalysisKeys = new Set(localAnalysis.map(analysisKey));
  const newAnalysis: AnalysisRecord[] = [];
  for (const a of inAnalysis) {
    if (localAnalysisKeys.has(analysisKey(a))) continue;
    const rec: AnalysisRecord = {
      ...a,
      sampleId,
      id: makeId('analysis'),
      createdAt: now,
      sampleVersion: version,
    };
    newAnalysis.push(rec);
    localAnalysisKeys.add(analysisKey(a));
  }
  if (newAnalysis.length) await db.analysis.bulkAdd(newAnalysis);

  return { finds: newFinds.length, sections: newSections.length, analysis: newAnalysis };
}

function groupBy<T>(list: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const key = keyOf(item);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return map;
}

function buildFailure(
  packageName: string,
  reason: ImportFailure['reason'],
  message: string,
  samples: PackageSample[],
  children: { finds: PackageFind[]; sections: PackageSection[]; analysis: PackageAnalysis[] },
  now: number,
  conflictId?: string,
): ImportFailure {
  return {
    id: makeId('failure'),
    packageName,
    reason,
    message,
    samples,
    finds: children.finds,
    sections: children.sections,
    analysis: children.analysis,
    ...(conflictId ? { conflictId } : {}),
    createdAt: now,
  };
}

/**
 * 裁决冲突。
 * 两个标签页同时确认时，以本事务内读到的冲突单为准：已 resolved 即抛 ConflictStaleError，
 * 调用方保留本页草稿并提示重载，绝不覆盖先确认结果。
 *
 * @param winnerSide 保留哪一条
 * @param sessionId  确认所在标签页会话
 * @param storageOverride 可选改放柜位（裁决时超重可换柜）
 */
export async function resolveConflict(
  conflictId: string,
  winnerSide: 'local' | 'incoming',
  sessionId: string,
  storageOverride?: MeteoriteSample['storage'],
): Promise<MeteoriteSample> {
  let resolvedSample: MeteoriteSample;

  await db.transaction(
    'rw',
    [db.samples, db.finds, db.sections, db.analysis, db.conflicts, db.importFailures],
    async () => {
      const conflict = await db.conflicts.get(conflictId);
      if (!conflict) throw new ConflictStaleError(conflictId);
      if (conflict.status === 'resolved') throw new ConflictStaleError(conflictId);

      const winnerId = winnerSide === 'local' ? conflict.localSampleId : conflict.incomingSampleId;
      const loserId = winnerSide === 'local' ? conflict.incomingSampleId : conflict.localSampleId;
      const winner = await db.samples.get(winnerId);
      if (!winner) throw new Error('裁决失败：获胜样本记录已不存在');

      const targetStorage = storageOverride ?? winner.storage;
      // 裁决落位需容量校验：超重则拒绝，两条 pending 原样保留等待改放
      const activeSamples = await db.samples.where('status').equals('active').toArray();
      const capacityMsg = checkCapacity(activeSamples, targetStorage, winner.totalWeight);
      if (capacityMsg) throw new Error(`裁决失败：${capacityMsg}`);

      // 删除失败方整组记录
      await db.finds.where('sampleId').equals(loserId).delete();
      await db.sections.where('sampleId').equals(loserId).delete();
      await db.analysis.where('sampleId').equals(loserId).delete();
      await db.samples.delete(loserId);

      // 获胜方恢复在档：版本戳 +1（重量/内容可能随之变化），派生数据立即重算
      const winnerAnalyses = await db.analysis.where('sampleId').equals(winnerId).toArray();
      const now = Date.now();
      resolvedSample = {
        ...winner,
        storage: targetStorage,
        status: 'active',
        conflictId: undefined,
        version: (winner.version ?? 1) + 1,
        updatedAt: now,
      };
      resolvedSample.adviceSnapshot = recomputeAdvice(resolvedSample, winnerAnalyses);
      resolvedSample.occupancySnapshot = recomputeOccupancy(resolvedSample);
      await db.samples.put(resolvedSample);
      await db.finds.where('sampleId').equals(winnerId).modify({
        status: 'active',
        conflictId: undefined,
        sampleVersion: resolvedSample.version,
      });
      await db.sections.where('sampleId').equals(winnerId).modify({
        sampleVersion: resolvedSample.version,
      });
      await db.analysis.where('sampleId').equals(winnerId).modify({
        sampleVersion: resolvedSample.version,
      });

      await db.conflicts.update(conflictId, {
        status: 'resolved',
        resolution: {
          winner: winnerSide,
          resolvedAt: now,
          sessionId,
          winningSampleId: winnerId,
        },
      });
      // 与该冲突相关的失败包记录随裁决一并清理
      await db.importFailures.where('conflictId').equals(conflictId).delete();
    },
  );

  return resolvedSample!;
}

/**
 * 失败包修正后重试（单条）。
 * 容量不足可换 storageOverride；其余情况按原条目重新走对账。
 */
export async function retryFailedEntry(
  failureId: string,
  options: { storageOverride?: MeteoriteSample['storage'] } = {},
): Promise<MergeResult> {
  const failure = await db.importFailures.get(failureId);
  if (!failure) throw new Error('失败记录已不存在');
  if (failure.reason === 'invalid-package') {
    throw new Error('整包结构不合法，请修正样本包文件后重新导入');
  }

  const samples = failure.samples.map((s) =>
    options.storageOverride ? { ...s, storage: options.storageOverride } : s,
  );

  const pkg: SamplePackage = {
    format: 'gbmeteorite-package',
    packageVersion: 1,
    exportedFrom: failure.packageName,
    exportedAt: failure.createdAt,
    samples,
    finds: failure.finds,
    sections: failure.sections,
    analysis: failure.analysis,
  };

  // 先清掉原失败记录，再重新对账：成功即并库；仍失败会留下一条带最新原因的新失败记录
  await db.importFailures.delete(failureId);
  return mergePackage(pkg, failure.packageName);
}

/** 删除失败记录（放弃该失败包） */
export async function discardFailure(failureId: string): Promise<void> {
  await db.importFailures.delete(failureId);
}
