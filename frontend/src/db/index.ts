import Dexie, { type Table } from 'dexie';
import type { MeteoriteSample } from '../types/sample';
import type { FindRecord } from '../types/find';
import type { ThinSection } from '../types/section';
import type { AnalysisRecord } from '../types/analysis';
import type { ConflictRecord, ImportBatch } from '../types/sync';

/** 库名固定为 gbmeteorite-db */
export const DB_NAME = 'gbmeteorite-db';

/**
 * 版本历史（IndexedDB 升级迁移）：
 *  - v1：建 samples / finds / sections 三张表
 *  - v2：新增 analysis 表，并为 analysis 加 sampleId 索引
 *  - v3：为 samples 补 updatedAt 字段，并按 id 回填旧记录
 *  - v4：对账合并——samples 加 version/pendingConflict/conflictId 索引，
 *        切片/分析/发现地补 sampleVersion，新增 conflicts / importBatches 两张表；
 *        旧数据没有版本戳，按初次入库统一补齐为 version=1、sampleVersion=1。
 */
export class MeteoriteDB extends Dexie {
  samples!: Table<MeteoriteSample, string>;
  finds!: Table<FindRecord, string>;
  sections!: Table<ThinSection, string>;
  analysis!: Table<AnalysisRecord, string>;
  conflicts!: Table<ConflictRecord, string>;
  importBatches!: Table<ImportBatch, string>;

  constructor() {
    super(DB_NAME);

    this.version(1).stores({
      samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt',
      finds: 'id, sampleId, region, createdAt',
      sections: 'id, sectionNo, sampleId, thickness, createdAt',
    });

    this.version(2)
      .stores({
        samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
      })
      .upgrade(async (tx) => {
        // v2：旧记录补齐新表所需字段，避免读取时 undefined
        await tx
          .table<AnalysisRecord, string>('analysis')
          .toCollection()
          .modify((rec) => {
            if (typeof rec.createdAt !== 'number') rec.createdAt = Date.now();
          });
      });

    this.version(3)
      .stores({
        samples:
          'id, sampleNo, category, chemicalGroup, totalWeight, createdAt, updatedAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
      })
      .upgrade(async (tx) => {
        // v3：为样本表补 updatedAt，并按 id 回填旧记录
        await tx
          .table<MeteoriteSample, string>('samples')
          .toCollection()
          .modify((sample) => {
            if (typeof sample.updatedAt !== 'number') {
              sample.updatedAt =
                typeof sample.createdAt === 'number' ? sample.createdAt : Date.now();
            }
          });
      });

    this.version(4)
      .stores({
        samples:
          'id, sampleNo, version, pendingConflict, conflictId, category, chemicalGroup, totalWeight, createdAt, updatedAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
        conflicts: 'id, sampleNo, status, createdAt',
        importBatches: 'id, status, stationId, createdAt',
      })
      .upgrade(async (tx) => {
        // v4：旧数据没有版本戳，按初次入库补齐
        const samples = await tx.table<MeteoriteSample, string>('samples').toArray();
        const versionById = new Map(samples.map((s) => [s.id, stampOf(s.version)]));
        await tx
          .table<MeteoriteSample, string>('samples')
          .toCollection()
          .modify((sample) => {
            sample.version = stampOf(sample.version);
          });
        await tx
          .table<FindRecord, string>('finds')
          .toCollection()
          .modify((rec) => {
            if (typeof rec.sampleVersion !== 'number') {
              rec.sampleVersion = versionById.get(rec.sampleId) ?? INITIAL_VERSION;
            }
          });
        await tx
          .table<ThinSection, string>('sections')
          .toCollection()
          .modify((rec) => {
            if (typeof rec.sampleVersion !== 'number') {
              rec.sampleVersion = versionById.get(rec.sampleId) ?? INITIAL_VERSION;
            }
          });
        await tx
          .table<AnalysisRecord, string>('analysis')
          .toCollection()
          .modify((rec) => {
            if (typeof rec.sampleVersion !== 'number') {
              rec.sampleVersion = versionById.get(rec.sampleId) ?? INITIAL_VERSION;
            }
          });
      });
  }
}

/** 初次入库补齐的版本戳 */
export const INITIAL_VERSION = 1;

/** 版本戳兜底：非有限正整数一律按初次入库补 1 */
export function stampOf(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : INITIAL_VERSION;
}

export const db = new MeteoriteDB();

/** 生成一个稳定的本地 id */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** 首次运行时灌入演示档案，保证页面有可检索内容 */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.samples.count();
  if (count > 0) return;
  const now = Date.now();
  await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, async () => {
    await db.samples.bulkAdd([
      {
        id: 'sample_seed_1',
        sampleNo: 'MET-2024-001',
        totalWeight: 1250.4,
        category: 'chondrite',
        chemicalGroup: 'H',
        weathering: 'W1',
        fallOrFind: 'find',
        storage: 'cabinet-a',
        note: '撒哈拉回收，熔壳完整',
        version: INITIAL_VERSION,
        createdAt: now - 86400000 * 40,
        updatedAt: now - 86400000 * 40,
      },
      {
        id: 'sample_seed_2',
        sampleNo: 'MET-2024-002',
        totalWeight: 8420,
        category: 'iron',
        chemicalGroup: 'IAB',
        weathering: 'W0',
        fallOrFind: 'find',
        storage: 'cabinet-b',
        note: '八面体结构清晰',
        version: INITIAL_VERSION,
        createdAt: now - 86400000 * 30,
        updatedAt: now - 86400000 * 30,
      },
      {
        id: 'sample_seed_3',
        sampleNo: 'MET-2024-003',
        totalWeight: 318.9,
        category: 'achondrite',
        chemicalGroup: 'ungrouped',
        weathering: 'W2',
        fallOrFind: 'fall',
        storage: 'desiccator',
        note: '目击坠落，无熔壳',
        version: INITIAL_VERSION,
        createdAt: now - 86400000 * 18,
        updatedAt: now - 86400000 * 18,
      },
    ]);
    await db.finds.bulkAdd([
      {
        id: 'find_seed_1',
        sampleId: 'sample_seed_1',
        placeName: 'Dar al Gani 区域',
        region: '利比亚',
        longitude: 16.2,
        latitude: 27.4,
        coordinateSource: 'gps',
        environment: 'desert',
        finder: '野外队 A 组',
        sampleVersion: INITIAL_VERSION,
        createdAt: now - 86400000 * 40,
      },
      {
        id: 'find_seed_2',
        sampleId: 'sample_seed_2',
        placeName: 'Gobi 南缘',
        region: '中国 内蒙古',
        longitude: 108.6,
        latitude: 42.1,
        coordinateSource: 'literature',
        environment: 'desert',
        finder: '标本室交换',
        sampleVersion: INITIAL_VERSION,
        createdAt: now - 86400000 * 30,
      },
    ]);
    await db.sections.bulkAdd([
      {
        id: 'section_seed_1',
        sectionNo: 'TS-2024-001',
        sampleId: 'sample_seed_1',
        thickness: 30,
        preparation: 'resin',
        minerals: { olivine: 42, pyroxene: 28, feldspar: 12, metal: 18 },
        micrographs: ['met001_ppl.jpg', 'met001_xpl.jpg'],
        quality: 'good',
        sampleVersion: INITIAL_VERSION,
        createdAt: now - 86400000 * 35,
      },
      {
        id: 'section_seed_2',
        sectionNo: 'TS-2024-002',
        sampleId: 'sample_seed_2',
        thickness: 60,
        preparation: 'epoxy',
        minerals: { olivine: 2, pyroxene: 5, feldspar: 1, metal: 92 },
        micrographs: ['met002_reflect.jpg'],
        quality: 'fair',
        sampleVersion: INITIAL_VERSION,
        createdAt: now - 86400000 * 25,
      },
    ]);
    await db.analysis.bulkAdd([
      {
        id: 'analysis_seed_1',
        sampleId: 'sample_seed_1',
        target: 'sample',
        method: 'microprobe',
        fa: 18.6,
        fs: 16.2,
        ni: 0.8,
        kamaciteBandwidth: 0.02,
        testedAt: '2024-06-12',
        sampleVersion: INITIAL_VERSION,
        createdAt: now - 86400000 * 20,
      },
      {
        id: 'analysis_seed_2',
        sampleId: 'sample_seed_2',
        target: 'sample',
        method: 'sem-eds',
        fa: 3.2,
        fs: 4.1,
        ni: 7.4,
        kamaciteBandwidth: 0.62,
        testedAt: '2024-07-03',
        sampleVersion: INITIAL_VERSION,
        createdAt: now - 86400000 * 12,
      },
    ]);
  });
}
