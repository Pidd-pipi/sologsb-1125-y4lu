import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import type { ConflictRecord, ImportFailure } from '../types/sync';
import { checkCapacity, recomputeAdvice, recomputeOccupancy } from '../utils/capacity';
import { dataChangeBus } from '../utils/syncBus';

/** 入库被容量拒绝：表单保留原值（原柜位不动），由调用方提示 */
export class CapacityExceededError extends Error {}

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  conflicts: ConflictRecord[];
  failures: ImportFailure[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  refreshSyncState: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'status'>) => Promise<string>;
  updateSample: (id: string, patch: Partial<MeteoriteSample>) => Promise<void>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt' | 'sampleVersion' | 'status'>) => Promise<string>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt' | 'sampleVersion'>) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (
    input: Omit<AnalysisRecord, 'id' | 'createdAt' | 'sampleVersion'>,
  ) => Promise<string>;
  nextSampleSeq: () => number;
}

export const useSampleStore = create<SampleState>((set, get) => ({
  samples: [],
  finds: [],
  sections: [],
  analysis: [],
  conflicts: [],
  failures: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    set({ loading: true });
    await seedIfEmpty();
    const [samples, finds, sections, analysis, conflicts, failures] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
      db.conflicts.toArray(),
      db.importFailures.toArray(),
    ]);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    conflicts.sort((a, b) => b.createdAt - a.createdAt);
    failures.sort((a, b) => b.createdAt - a.createdAt);
    set({ samples, finds, sections, analysis, conflicts, failures, loading: false, loaded: true });
  },

  refreshSyncState: async () => {
    const [conflicts, failures, samples, finds, sections, analysis] = await Promise.all([
      db.conflicts.toArray(),
      db.importFailures.toArray(),
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
    ]);
    conflicts.sort((a, b) => b.createdAt - a.createdAt);
    failures.sort((a, b) => b.createdAt - a.createdAt);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    set({ conflicts, failures, samples, finds, sections, analysis });
  },

  addSample: async (input) => {
    // 容量不足拒绝入库（新样本尚无原柜位，直接拒绝，表单值保留）
    const capacityMsg = checkCapacity(get().samples, input.storage, input.totalWeight);
    if (capacityMsg) throw new CapacityExceededError(capacityMsg);

    const now = Date.now();
    const version = 1;
    const record: MeteoriteSample = {
      ...input,
      id: makeId('sample'),
      createdAt: now,
      updatedAt: now,
      version,
      status: 'active',
    };
    record.adviceSnapshot = recomputeAdvice(record, []);
    record.occupancySnapshot = recomputeOccupancy(record);
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    dataChangeBus.post({ kind: 'sample-write', sessionId: '' });
    return record.id;
  },

  updateSample: async (id, patch) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) return;

    const nextStorage = patch.storage ?? current.storage;
    const nextWeight = patch.totalWeight ?? current.totalWeight;
    // 改放柜位 / 改重量都要重新过容量；不足时拒绝并保留原柜位
    if (patch.storage !== undefined || patch.totalWeight !== undefined) {
      const capacityMsg = checkCapacity(get().samples, nextStorage, nextWeight, id);
      if (capacityMsg) throw new CapacityExceededError(capacityMsg);
    }

    const weightChanged =
      patch.totalWeight !== undefined && Number(patch.totalWeight) !== Number(current.totalWeight);
    const now = Date.now();
    const updated: MeteoriteSample = {
      ...current,
      ...patch,
      storage: nextStorage,
      totalWeight: nextWeight,
      updatedAt: now,
      version: current.version + (weightChanged ? 1 : 0),
    };

    if (weightChanged || patch.storage !== undefined) {
      // 样本重量一变，分类建议和柜架占用立即失效重算
      const sampleAnalyses = get().analysis.filter((a) => a.sampleId === id);
      updated.adviceSnapshot = recomputeAdvice(updated, sampleAnalyses);
      updated.occupancySnapshot = recomputeOccupancy(updated);
      if (weightChanged) {
        // 子记录跟随所属样本新版本
        await db.sections.where('sampleId').equals(id).modify({ sampleVersion: updated.version });
        await db.analysis.where('sampleId').equals(id).modify({ sampleVersion: updated.version });
        await db.finds
          .where('sampleId')
          .equals(id)
          .modify((f) => {
            f.sampleVersion = updated.version;
          });
        set({
          sections: get().sections.map((s) =>
            s.sampleId === id ? { ...s, sampleVersion: updated.version } : s,
          ),
          analysis: get().analysis.map((a) =>
            a.sampleId === id ? { ...a, sampleVersion: updated.version } : a,
          ),
          finds: get().finds.map((f) =>
            f.sampleId === id ? { ...f, sampleVersion: updated.version } : f,
          ),
        });
      }
    }

    await db.samples.put(updated);
    set({ samples: get().samples.map((s) => (s.id === id ? updated : s)) });
    dataChangeBus.post({ kind: 'sample-write', sessionId: '' });
  },

  removeSample: async (id) => {
    await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, async () => {
      await db.samples.delete(id);
      await db.finds.where('sampleId').equals(id).delete();
      await db.sections.where('sampleId').equals(id).delete();
      await db.analysis.where('sampleId').equals(id).delete();
    });
    set({
      samples: get().samples.filter((s) => s.id !== id),
      finds: get().finds.filter((f) => f.sampleId !== id),
      sections: get().sections.filter((s) => s.sampleId !== id),
      analysis: get().analysis.filter((a) => a.sampleId !== id),
    });
    dataChangeBus.post({ kind: 'sample-write', sessionId: '' });
  },

  addFind: async (input) => {
    const parent = get().samples.find((s) => s.id === input.sampleId);
    const record: FindRecord = {
      ...input,
      id: makeId('find'),
      createdAt: Date.now(),
      sampleVersion: parent?.version ?? 1,
      status: 'active',
    };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    return record.id;
  },

  addSection: async (input) => {
    const parent = get().samples.find((s) => s.id === input.sampleId);
    if (parent?.status === 'pending') {
      throw new Error('该样本正在冲突待裁决，暂不能新增切片');
    }
    const record: ThinSection = {
      ...input,
      id: makeId('section'),
      createdAt: Date.now(),
      sampleVersion: parent?.version ?? 1,
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
    const parent = get().samples.find((s) => s.id === input.sampleId);
    if (parent?.status === 'pending') {
      throw new Error('该样本正在冲突待裁决，暂不能新增分析记录');
    }
    const record: AnalysisRecord = {
      ...input,
      id: makeId('analysis'),
      createdAt: Date.now(),
      sampleVersion: parent?.version ?? 1,
    };
    await db.analysis.add(record);

    // 新增检测记录：按当前重量立即重算所属样本的分类建议
    const nextAnalyses = [record, ...get().analysis.filter((a) => a.sampleId === input.sampleId)];
    let updatedParent: MeteoriteSample | undefined;
    if (parent) {
      updatedParent = {
        ...parent,
        adviceSnapshot: recomputeAdvice(parent, nextAnalyses),
      };
      await db.samples.update(parent.id, { adviceSnapshot: updatedParent.adviceSnapshot });
    }

    set({
      analysis: [record, ...get().analysis],
      samples: updatedParent
        ? get().samples.map((s) => (s.id === updatedParent!.id ? updatedParent! : s))
        : get().samples,
    });
    return record.id;
  },

  nextSampleSeq: () => {
    const year = new Date().getFullYear();
    const prefix = `MET-${year}-`;
    const used = get()
      .samples.filter((s) => s.status !== 'pending')
      .map((s) => s.sampleNo)
      .filter((no) => no.startsWith(prefix))
      .map((no) => Number(no.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
    const max = used.length ? Math.max(...used) : 0;
    return max + 1;
  },
}));
