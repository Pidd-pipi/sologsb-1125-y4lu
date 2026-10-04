import { create } from 'zustand';
import { db, makeId, seedIfEmpty, stampOf } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import type {
  ConflictRecord,
  ConflictResolution,
  ImportBatch,
  MergePlan,
  SamplePackage,
} from '../types/sync';
import { calcOccupancy, checkCapacity } from '../utils/occupancy';
import {
  analysisNaturalKey,
  buildExportPackage,
  planMerge,
  sectionNaturalKey,
  validatePackage,
} from '../utils/sync';
import { broadcast } from '../utils/station';

/** 容量不足：拒绝入库、原柜位保留 */
export class CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapacityError';
  }
}

/** 冲突已被另一标签页 / 先确认页裁决：本页确认作废，需保留草稿并提示重载 */
export class StaleConflictError extends Error {
  resolution?: ConflictResolution;
  constructor(message: string, resolution?: ConflictResolution) {
    super(message);
    this.name = 'StaleConflictError';
    this.resolution = resolution;
  }
}

export interface ImportResult {
  ok: boolean;
  plan?: MergePlan;
  batchId: string;
  errors: string[];
}

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  conflicts: ConflictRecord[];
  batches: ImportBatch[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt' | 'version'>) => Promise<string>;
  updateSample: (id: string, patch: Partial<MeteoriteSample>) => Promise<void>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt' | 'sampleVersion'> & { sampleVersion?: number }) => Promise<string>;
  addSection: (
    input: Omit<ThinSection, 'id' | 'createdAt' | 'sampleVersion'> & { sampleVersion?: number },
  ) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (
    input: Omit<AnalysisRecord, 'id' | 'createdAt' | 'sampleVersion'> & { sampleVersion?: number },
  ) => Promise<string>;
  nextSampleSeq: () => number;
  occupancy: () => ReturnType<typeof calcOccupancy>;
  importPackage: (fileName: string, raw: unknown) => Promise<ImportResult>;
  retryBatch: (
    batchId: string,
    edits?: Record<string, { storage?: MeteoriteSample['storage']; totalWeight?: number }>,
  ) => Promise<ImportResult>;
  replaceBatchPayload: (batchId: string, raw: unknown) => { errors: string[] };
  removeBatch: (batchId: string) => Promise<void>;
  resolveConflict: (conflictId: string, resolution: ConflictResolution) => Promise<void>;
  exportPackage: () => SamplePackage;
}

export const useSampleStore = create<SampleState>((set, get) => ({
  samples: [],
  finds: [],
  sections: [],
  analysis: [],
  conflicts: [],
  batches: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    set({ loading: true });
    await seedIfEmpty();
    const [samples, finds, sections, analysis, conflicts, batches] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
      db.conflicts.toArray(),
      db.importBatches.toArray(),
    ]);
    // 双保险：v4 迁移之外读到缺戳记录时，内存侧按初次入库补 1
    const versionById = new Map(samples.map((s) => [s.id, stampOf(s.version)]));
    samples.forEach((s) => {
      s.version = stampOf(s.version);
    });
    finds.forEach((f) => {
      if (typeof f.sampleVersion !== 'number') f.sampleVersion = versionById.get(f.sampleId) ?? 1;
    });
    sections.forEach((s) => {
      if (typeof s.sampleVersion !== 'number') s.sampleVersion = versionById.get(s.sampleId) ?? 1;
    });
    analysis.forEach((a) => {
      if (typeof a.sampleVersion !== 'number') a.sampleVersion = versionById.get(a.sampleId) ?? 1;
    });
    sortByCreatedAt(samples);
    sortByCreatedAt(finds);
    sortByCreatedAt(sections);
    sortByCreatedAt(analysis);
    conflicts.sort((a, b) => b.createdAt - a.createdAt);
    batches.sort((a, b) => b.updatedAt - a.updatedAt);
    set({
      samples,
      finds,
      sections,
      analysis,
      conflicts,
      batches,
      loading: false,
      loaded: true,
    });
  },

  addSample: async (input) => {
    // 容量闸：超重直接拒绝，柜位状态不变
    const overflow = checkCapacity(get().occupancy(), input.storage, input.totalWeight);
    if (overflow) {
      throw new CapacityError(`入库被拒：${overflow.storage === 'cabinet-a' ? 'A 柜' : overflow.storage === 'cabinet-b' ? 'B 柜' : '干燥器'}将达 ${formatG(overflow.usedGrams)} / ${formatG(overflow.capacityGrams ?? 0)}，请改放其他柜位`);
    }
    const now = Date.now();
    const record: MeteoriteSample = {
      ...input,
      id: makeId('sample'),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    return record.id;
  },

  updateSample: async (id, patch) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) return;
    const nextStorage = patch.storage ?? current.storage;
    const nextWeight = patch.totalWeight !== undefined ? Number(patch.totalWeight) : current.totalWeight;

    // 柜位或重量变更时复核容量；不足则拒绝，样本留在原柜位
    if (patch.storage !== undefined || patch.totalWeight !== undefined) {
      const overflow = checkCapacity(
        get().occupancy(),
        nextStorage,
        nextWeight,
        id,
        get().samples,
      );
      if (overflow) {
        throw new CapacityError(
          `柜架容量不足：${nextStorage === 'cabinet-a' ? 'A 柜' : nextStorage === 'cabinet-b' ? 'B 柜' : '干燥器'}将达 ${formatG(overflow.usedGrams)} / ${formatG(overflow.capacityGrams ?? 0)}，已保留原柜位`,
        );
      }
    }

    // 样本重量（及分类实质字段）一变，版本戳 +1，旧版本上的分类建议立即失效重算
    const bumpVersion =
      (patch.totalWeight !== undefined && Number(patch.totalWeight) !== current.totalWeight) ||
      (patch.category !== undefined && patch.category !== current.category) ||
      (patch.chemicalGroup !== undefined && patch.chemicalGroup !== current.chemicalGroup) ||
      (patch.weathering !== undefined && patch.weathering !== current.weathering) ||
      (patch.fallOrFind !== undefined && patch.fallOrFind !== current.fallOrFind);
    const now = Date.now();
    const updated: MeteoriteSample = {
      ...current,
      ...patch,
      totalWeight: nextWeight,
      version: bumpVersion ? current.version + 1 : current.version,
      updatedAt: now,
    };
    await db.samples.put(updated);
    set({ samples: get().samples.map((s) => (s.id === id ? updated : s)) });
    broadcast({ type: 'data-changed' });
  },

  removeSample: async (id) => {
    const victim = get().samples.find((s) => s.id === id);
    await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, db.conflicts, async () => {
      await db.samples.delete(id);
      await db.finds.where('sampleId').equals(id).delete();
      await db.sections.where('sampleId').equals(id).delete();
      await db.analysis.where('sampleId').equals(id).delete();
      if (victim?.conflictId) {
        const conflict = await db.conflicts.get(victim.conflictId);
        if (conflict) {
          const peerId =
            conflict.localSampleId === id ? conflict.incomingSampleId : conflict.localSampleId;
          await db.samples.update(peerId, { pendingConflict: undefined, conflictId: undefined });
          await db.conflicts.delete(conflict.id);
        }
      }
    });
    set({
      samples: get().samples.filter((s) => s.id !== id),
      finds: get().finds.filter((f) => f.sampleId !== id),
      sections: get().sections.filter((s) => s.sampleId !== id),
      analysis: get().analysis.filter((a) => a.sampleId !== id),
      conflicts: victim?.conflictId
        ? get().conflicts.filter((c) => c.id !== victim.conflictId)
        : get().conflicts,
    });
    broadcast({ type: 'data-changed' });
  },

  addFind: async (input) => {
    const sample = get().samples.find((s) => s.id === input.sampleId);
    const record: FindRecord = {
      ...input,
      id: makeId('find'),
      sampleVersion: input.sampleVersion ?? sample?.version ?? 1,
      createdAt: Date.now(),
    };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    return record.id;
  },

  addSection: async (input) => {
    const sample = get().samples.find((s) => s.id === input.sampleId);
    const record: ThinSection = {
      ...input,
      id: makeId('section'),
      sampleVersion: input.sampleVersion ?? sample?.version ?? 1,
      createdAt: Date.now(),
    };
    await db.sections.add(record);
    set({ sections: [record, ...get().sections] });
    return record.id;
  },

  updateSection: async (id, patch) => {
    await db.sections.update(id, patch);
    set({ sections: get().sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  },

  addAnalysis: async (input) => {
    const sample = get().samples.find((s) => s.id === input.sampleId);
    const record: AnalysisRecord = {
      ...input,
      id: makeId('analysis'),
      sampleVersion: input.sampleVersion ?? sample?.version ?? 1,
      createdAt: Date.now(),
    };
    await db.analysis.add(record);
    set({ analysis: [record, ...get().analysis] });
    return record.id;
  },

  nextSampleSeq: () => {
    const year = new Date().getFullYear();
    const prefix = `MET-${year}-`;
    const used = get()
      .samples.map((s) => s.sampleNo)
      .filter((no) => no.startsWith(prefix))
      .map((no) => Number(no.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
    const max = used.length ? Math.max(...used) : 0;
    return max + 1;
  },

  occupancy: () => calcOccupancy(get().samples),

  importPackage: async (fileName, raw) => {
    const { pkg, errors } = validatePackage(raw);
    const batchId = makeId('batch');
    if (!pkg) {
      const batch: ImportBatch = {
        id: batchId,
        fileName,
        stationId: 'unknown',
        status: 'failed',
        reasons: errors,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.importBatches.add(batch);
      set({ batches: [batch, ...get().batches] });
      return { ok: false, batchId, errors };
    }

    const plan = planMerge({
      localSamples: get().samples,
      localFinds: get().finds,
      localSections: get().sections,
      localAnalysis: get().analysis,
      pkg,
    });

    if (plan.capacityRejections.length) {
      // 容量不足：整包拒绝、原样落失败包，库内任何柜位都不动
      const reasons = plan.capacityRejections.map(
        (r) => `${r.sampleNo}：${r.message}（可在下方改柜位 / 重量后重试）`,
      );
      const batch: ImportBatch = {
        id: batchId,
        fileName,
        stationId: pkg.stationId,
        status: 'failed',
        payload: pkg,
        reasons,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.importBatches.add(batch);
      set({ batches: [batch, ...get().batches] });
      return { ok: false, batchId, plan, errors: reasons };
    }

    await executePlan(pkg, plan);

    const now = Date.now();
    const batch: ImportBatch = {
      id: batchId,
      fileName,
      stationId: pkg.stationId,
      status: 'succeeded',
      payload: pkg,
      reasons: [],
      createdAt: now,
      updatedAt: now,
      succeededAt: now,
    };
    await db.importBatches.add(batch);
    await get().loadAll();
    set({ batches: [batch, ...get().batches.filter((b) => b.id !== batchId)] });
    broadcast({ type: 'import-completed', batchId });
    return { ok: true, batchId, plan, errors: [] };
  },

  retryBatch: async (batchId, edits = {}) => {
    const batch = get().batches.find((b) => b.id === batchId);
    if (!batch) {
      return { ok: false, batchId, errors: ['失败包不存在，可能已被删除'] };
    }
    if (!batch.payload) {
      return { ok: false, batchId, errors: ['原始包结构损坏，请重新上传修正后的文件再重试'] };
    }
    // 失败包可修正（改柜位 / 重量）后重试
    const payload: SamplePackage = {
      ...batch.payload,
      samples: batch.payload.samples.map((s) => {
        const edit = edits[s.sampleNo];
        return edit
          ? {
              ...s,
              storage: edit.storage ?? s.storage,
              totalWeight: edit.totalWeight ?? s.totalWeight,
            }
          : s;
      }),
    };
    const { pkg, errors } = validatePackage(payload);
    if (!pkg) {
      const updated: ImportBatch = { ...batch, payload, reasons: errors, updatedAt: Date.now() };
      await db.importBatches.put(updated);
      set({ batches: get().batches.map((b) => (b.id === batchId ? updated : b)) });
      return { ok: false, batchId, errors };
    }
    const plan = planMerge({
      localSamples: get().samples,
      localFinds: get().finds,
      localSections: get().sections,
      localAnalysis: get().analysis,
      pkg,
    });
    if (plan.capacityRejections.length) {
      const reasons = plan.capacityRejections.map(
        (r) => `${r.sampleNo}：${r.message}（可改柜位 / 重量后重试）`,
      );
      const updated: ImportBatch = { ...batch, payload: pkg, reasons, updatedAt: Date.now() };
      await db.importBatches.put(updated);
      set({ batches: get().batches.map((b) => (b.id === batchId ? updated : b)) });
      return { ok: false, batchId, plan, errors: reasons };
    }

    await executePlan(pkg, plan);
    const now = Date.now();
    const updated: ImportBatch = {
      ...batch,
      payload: pkg,
      status: 'succeeded',
      reasons: [],
      updatedAt: now,
      succeededAt: now,
    };
    await db.importBatches.put(updated);
    await get().loadAll();
    set({ batches: get().batches.map((b) => (b.id === batchId ? updated : b)) });
    broadcast({ type: 'import-completed', batchId });
    return { ok: true, batchId, plan, errors: [] };
  },

  replaceBatchPayload: (batchId, raw) => {
    const batch = get().batches.find((b) => b.id === batchId);
    if (!batch) return { errors: ['失败包不存在'] };
    const { pkg, errors } = validatePackage(raw);
    if (!pkg || errors.length) return { errors };
    const updated: ImportBatch = {
      ...batch,
      payload: pkg,
      stationId: pkg.stationId,
      reasons: batch.reasons,
      updatedAt: Date.now(),
    };
    void db.importBatches.put(updated);
    set({ batches: get().batches.map((b) => (b.id === batchId ? updated : b)) });
    return { errors: [] };
  },

  removeBatch: async (batchId) => {
    await db.importBatches.delete(batchId);
    set({ batches: get().batches.filter((b) => b.id !== batchId) });
  },

  resolveConflict: async (conflictId, resolution) => {
    await db.transaction(
      'rw',
      db.samples,
      db.finds,
      db.sections,
      db.analysis,
      db.conflicts,
      async () => {
        const conflict = await db.conflicts.get(conflictId);
        if (!conflict) throw new StaleConflictError('冲突单不存在，可能已在另一页被裁决');
        if (conflict.status === 'resolved') {
          // 后确认的一页：先确认结果已落库，本次确认作废
          throw new StaleConflictError(
            `冲突已在另一标签页按「${conflict.resolution === 'keep-local' ? '保留本机' : '采用离线'}」裁决，请重载`,
            conflict.resolution,
          );
        }
        const local = await db.samples.get(conflict.localSampleId);
        const incoming = await db.samples.get(conflict.incomingSampleId);
        if (!local || !incoming || !local.pendingConflict || !incoming.pendingConflict) {
          throw new StaleConflictError('冲突双方状态已变化，请重载后查看最新结果');
        }

        const winner = resolution === 'keep-local' ? local : incoming;
        // 两条都挂起未计占用；裁决通过者重新计入，必须复核容量，不足则拒绝、维持待裁决
        const liveSamples = await db.samples.toArray();
        const overflow = checkCapacity(
          calcOccupancy(liveSamples),
          winner.storage,
          winner.totalWeight,
        );
        if (overflow) {
          throw new CapacityError(
            `裁决被拒：${winner.storage === 'cabinet-a' ? 'A 柜' : winner.storage === 'cabinet-b' ? 'B 柜' : '干燥器'}容量不足（${formatG(overflow.usedGrams)} / ${formatG(overflow.capacityGrams ?? 0)}），冲突维持待裁决`,
          );
        }

        const loser = winner === local ? incoming : local;
        await db.samples.update(winner.id, {
          pendingConflict: undefined,
          conflictId: undefined,
          updatedAt: Date.now(),
        });
        await db.finds.where('sampleId').equals(loser.id).delete();
        await db.sections.where('sampleId').equals(loser.id).delete();
        await db.analysis.where('sampleId').equals(loser.id).delete();
        await db.samples.delete(loser.id);
        await db.conflicts.update(conflictId, {
          status: 'resolved',
          resolvedAt: Date.now(),
          resolution,
          localVersion: local.version,
          incomingVersion: incoming.version,
        });
      },
    );
    await get().loadAll();
    broadcast({ type: 'conflict-resolved', conflictId, resolution });
  },

  exportPackage: () =>
    buildExportPackage({
      samples: get().samples,
      finds: get().finds,
      sections: get().sections,
      analysis: get().analysis,
    }),
}));

/** 按对账计划执行整包写入（调用方已完成容量预检，任一前置失败都不会进入本函数） */
async function executePlan(pkg: SamplePackage, plan: MergePlan): Promise<void> {
  await db.transaction(
    'rw',
    db.samples,
    db.finds,
    db.sections,
    db.analysis,
    db.conflicts,
    async () => {
      const incomingSectionsBySample = new Map<string, ThinSection[]>();
      for (const s of pkg.sections) {
        const arr = incomingSectionsBySample.get(s.sampleId) ?? [];
        arr.push(s);
        incomingSectionsBySample.set(s.sampleId, arr);
      }
      const incomingAnalysisBySample = new Map<string, AnalysisRecord[]>();
      for (const a of pkg.analysis) {
        const arr = incomingAnalysisBySample.get(a.sampleId) ?? [];
        arr.push(a);
        incomingAnalysisBySample.set(a.sampleId, arr);
      }
      const incomingFindBySample = new Map<string, FindRecord[]>();
      for (const f of pkg.finds) {
        const arr = incomingFindBySample.get(f.sampleId) ?? [];
        arr.push(f);
        incomingFindBySample.set(f.sampleId, arr);
      }

      for (const item of plan.items) {
        if (item.action === 'add-incoming' && item.incoming) {
          await insertIncomingSample(
            item.incoming,
            incomingSectionsBySample.get(item.incoming.id) ?? [],
            incomingAnalysisBySample.get(item.incoming.id) ?? [],
            incomingFindBySample.get(item.incoming.id) ?? [],
          );
        } else if ((item.action === 'keep' || item.action === 'fast-forward') && item.local && item.incoming) {
          await mergeIntoLocal(
            item,
            incomingSectionsBySample.get(item.incoming.id) ?? [],
            incomingAnalysisBySample.get(item.incoming.id) ?? [],
            incomingFindBySample.get(item.incoming.id) ?? [],
          );
        } else if (item.action === 'conflict' && item.local && item.incoming) {
          await raiseConflict(
            item,
            pkg.stationId,
            incomingSectionsBySample.get(item.incoming.id) ?? [],
            incomingAnalysisBySample.get(item.incoming.id) ?? [],
            incomingFindBySample.get(item.incoming.id) ?? [],
          );
        }
      }
    },
  );
}

/** 单边新增：离线样本连同全部子记录直接并库（跨机 id 全部重签） */
async function insertIncomingSample(
  incoming: MeteoriteSample,
  inSections: ThinSection[],
  inAnalysis: AnalysisRecord[],
  inFinds: FindRecord[],
): Promise<{ newSampleId: string; sectionIdMap: Map<string, string> }> {
  const newSampleId = makeId('sample');
  const now = Date.now();
  await db.samples.add({
    ...incoming,
    id: newSampleId,
    pendingConflict: undefined,
    conflictId: undefined,
    version: stampOf(incoming.version),
    createdAt: now,
    updatedAt: now,
  });
  const sectionIdMap = new Map<string, string>();
  for (const s of inSections) {
    const newId = makeId('section');
    sectionIdMap.set(s.id, newId);
    await db.sections.add({
      ...s,
      id: newId,
      sampleId: newSampleId,
      sampleVersion: stampOf(s.sampleVersion ?? incoming.version),
      createdAt: s.createdAt || now,
    });
  }
  for (const a of inAnalysis) {
    await db.analysis.add({
      ...a,
      id: makeId('analysis'),
      sampleId: newSampleId,
      sectionId: a.sectionId ? sectionIdMap.get(a.sectionId) : undefined,
      sampleVersion: stampOf(a.sampleVersion ?? incoming.version),
      createdAt: a.createdAt || now,
    });
  }
  for (const f of inFinds) {
    await db.finds.add({
      ...f,
      id: makeId('find'),
      sampleId: newSampleId,
      sampleVersion: stampOf(f.sampleVersion ?? incoming.version),
      createdAt: f.createdAt || now,
    });
  }
  return { newSampleId, sectionIdMap };
}

/** 同编号：保留本机样本，补本机缺失的切片 / 分析 / 发现地；fast-forward 时跟进高版本字段 */
async function mergeIntoLocal(
  item: MergePlan['items'][number],
  inSections: ThinSection[],
  inAnalysis: AnalysisRecord[],
  inFinds: FindRecord[],
): Promise<void> {
  const local = item.local!;
  const incoming = item.incoming!;
  const action = item.action;
  const now = Date.now();

  if (action === 'fast-forward') {
    await db.samples.update(local.id, {
      ...stripManaged(incoming),
      version: Math.max(stampOf(local.version), stampOf(incoming.version)),
      updatedAt: now,
    });
  }

  const localSections = await db.sections.where('sampleId').equals(local.id).toArray();
  const localAnalysis = await db.analysis.where('sampleId').equals(local.id).toArray();
  const localFinds = await db.finds.where('sampleId').equals(local.id).toArray();
  const sectionKeys = new Set(localSections.map(sectionNaturalKey));
  const analysisKeys = new Set(localAnalysis.map(analysisNaturalKey));
  const targetVersion =
    action === 'fast-forward'
      ? Math.max(stampOf(local.version), stampOf(incoming.version))
      : stampOf(local.version);

  // fast-forward 时关键三项（重量 / 发现地 / 柜位）未变：本机已有子记录随样本抬版本戳，
  // 不应被误判为「旧版本失效」
  if (action === 'fast-forward') {
    await Promise.all([
      ...localSections
        .filter((c) => stampOf(c.sampleVersion) < targetVersion)
        .map((c) => db.sections.update(c.id, { sampleVersion: targetVersion })),
      ...localAnalysis
        .filter((c) => stampOf(c.sampleVersion) < targetVersion)
        .map((c) => db.analysis.update(c.id, { sampleVersion: targetVersion })),
      ...localFinds
        .filter((c) => stampOf(c.sampleVersion) < targetVersion)
        .map((c) => db.finds.update(c.id, { sampleVersion: targetVersion })),
    ]);
  }

  // 子记录 id 重签防跨机碰撞，切片 id 映射同步修正分析记录的 sectionId
  const sectionIdMap = new Map<string, string>();
  for (const s of inSections) {
    const key = sectionNaturalKey(s);
    if (key === 'sec:' || sectionKeys.has(key)) continue;
    sectionKeys.add(key);
    const newId = makeId('section');
    sectionIdMap.set(s.id, newId);
    await db.sections.add({
      ...s,
      id: newId,
      sampleId: local.id,
      sampleVersion: stampOf(s.sampleVersion) || targetVersion,
      createdAt: s.createdAt || now,
    });
  }
  for (const a of inAnalysis) {
    const key = analysisNaturalKey(a);
    if (analysisKeys.has(key)) continue;
    analysisKeys.add(key);
    await db.analysis.add({
      ...a,
      id: makeId('analysis'),
      sampleId: local.id,
      sectionId: a.sectionId ? sectionIdMap.get(a.sectionId) : undefined,
      sampleVersion: stampOf(a.sampleVersion) || targetVersion,
      createdAt: a.createdAt || now,
    });
  }
  if (localFinds.length === 0) {
    for (const f of inFinds) {
      await db.finds.add({
        ...f,
        id: makeId('find'),
        sampleId: local.id,
        sampleVersion: targetVersion,
        createdAt: f.createdAt || now,
      });
    }
  } else if (action === 'fast-forward' && inFinds.length) {
    // 跟进高版本且签名一致：用离线发现地刷新本机首条，其余补入
    const [first, ...rest] = inFinds;
    await db.finds.update(localFinds[0].id, {
      ...stripManaged(first),
      id: localFinds[0].id,
      sampleId: local.id,
      sampleVersion: targetVersion,
    });
    for (const f of rest) {
      await db.finds.add({
        ...f,
        id: makeId('find'),
        sampleId: local.id,
        sampleVersion: targetVersion,
        createdAt: f.createdAt || now,
      });
    }
  }
}

/** 关键三项不一致：两条都挂起待裁决，冲突单记录差异与快照，子记录各随其主 */
async function raiseConflict(
  item: MergePlan['items'][number],
  stationId: string,
  inSections: ThinSection[],
  inAnalysis: AnalysisRecord[],
  inFinds: FindRecord[],
): Promise<void> {
  const local = item.local!;
  const incoming = item.incoming!;
  const fields = item.fields ?? [];
  const conflictId = makeId('conflict');
  const now = Date.now();

  // 本机侧挂起（样本总览与发现地地图暂不显示）
  await db.samples.update(local.id, { pendingConflict: true, conflictId });

  // 离线侧作为第二条副本入库，同样挂起
  const incomingCopyId = makeId('sample');
  await db.samples.add({
    ...incoming,
    id: incomingCopyId,
    pendingConflict: true,
    conflictId,
    version: stampOf(incoming.version),
    createdAt: now,
    updatedAt: now,
  });
  const sectionIdMap = new Map<string, string>();
  for (const s of inSections) {
    const newId = makeId('section');
    sectionIdMap.set(s.id, newId);
    await db.sections.add({
      ...s,
      id: newId,
      sampleId: incomingCopyId,
      sampleVersion: stampOf(s.sampleVersion ?? incoming.version),
      createdAt: s.createdAt || now,
    });
  }
  for (const a of inAnalysis) {
    await db.analysis.add({
      ...a,
      id: makeId('analysis'),
      sampleId: incomingCopyId,
      sectionId: a.sectionId ? sectionIdMap.get(a.sectionId) : undefined,
      sampleVersion: stampOf(a.sampleVersion ?? incoming.version),
      createdAt: a.createdAt || now,
    });
  }
  for (const f of inFinds) {
    await db.finds.add({
      ...f,
      id: makeId('find'),
      sampleId: incomingCopyId,
      sampleVersion: stampOf(f.sampleVersion ?? incoming.version),
      createdAt: f.createdAt || now,
    });
  }

  const conflict: ConflictRecord = {
    id: conflictId,
    sampleNo: incoming.sampleNo,
    status: 'pending',
    fields,
    localSampleId: local.id,
    incomingSampleId: incomingCopyId,
    localSnapshot: { ...local },
    incomingSnapshot: { ...incoming, id: incomingCopyId },
    localFind: (await db.finds.where('sampleId').equals(local.id).toArray())[0] ?? null,
    incomingFind: inFinds[0] ?? null,
    stationId,
    createdAt: now,
  };
  await db.conflicts.add(conflict);
}

/** 剥离跨库托管字段，update / put 前避免误改 id 等 */
function stripManaged<T extends object>(rec: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'id' || k === 'createdAt' || k === 'sampleId') continue;
    result[k] = v;
  }
  return result as Partial<T>;
}

function sortByCreatedAt<T extends { createdAt: number }>(list: T[]): void {
  list.sort((a, b) => b.createdAt - a.createdAt);
}

function formatG(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(1)} g`;
}
