import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { DB_NAME, db, INITIAL_VERSION } from '../src/db';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error('FAIL:', msg);
  }
}

// 1) 用旧 schema 建一个 v3 库，写入没有任何版本戳的旧数据
await new Promise<void>((resolve, reject) => {
  const old = new Dexie(DB_NAME);
  old.version(1).stores({
    samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt',
    finds: 'id, sampleId, region, createdAt',
    sections: 'id, sectionNo, sampleId, thickness, createdAt',
  });
  old.version(2).stores({
    samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt',
    finds: 'id, sampleId, region, createdAt',
    sections: 'id, sectionNo, sampleId, thickness, createdAt',
    analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
  });
  old.version(3).stores({
    samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt, updatedAt',
    finds: 'id, sampleId, region, createdAt',
    sections: 'id, sectionNo, sampleId, thickness, createdAt',
    analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
  });
  old.on('populate', () => undefined);
  old
    .open()
    .then(async () => {
      await old.table('samples').bulkAdd([
        {
          id: 'old_s1',
          sampleNo: 'MET-2019-001',
          totalWeight: 900,
          category: 'iron',
          chemicalGroup: 'IAB',
          weathering: 'W0',
          fallOrFind: 'find',
          storage: 'cabinet-b',
          createdAt: 1,
          updatedAt: 1,
          // 注意：没有 version
        },
      ]);
      await old.table('finds').bulkAdd([
        {
          id: 'old_f1',
          sampleId: 'old_s1',
          placeName: '旧地',
          region: '旧国',
          longitude: 10,
          latitude: 20,
          coordinateSource: 'gps',
          environment: 'desert',
          finder: '前人',
          createdAt: 1,
        },
      ]);
      await old.table('sections').bulkAdd([
        {
          id: 'old_t1',
          sectionNo: 'TS-OLD',
          sampleId: 'old_s1',
          thickness: 30,
          preparation: 'resin',
          minerals: { olivine: 1, pyroxene: 1, feldspar: 1, metal: 1 },
          micrographs: [],
          quality: 'good',
          createdAt: 1,
        },
      ]);
      await old.table('analysis').bulkAdd([
        {
          id: 'old_a1',
          sampleId: 'old_s1',
          target: 'sample',
          method: 'microprobe',
          fa: 5,
          fs: 6,
          ni: 7,
          kamaciteBandwidth: 0.6,
          testedAt: '2019-01-01',
          createdAt: 1,
        },
      ]);
      old.close();
      resolve();
    })
    .catch(reject);
});

// 2) 打开新版 db 单例 → Dexie 自动执行 v4 upgrade
const s = await db.samples.get('old_s1');
assert(s?.version === INITIAL_VERSION, '旧样本补齐 version=1');
assert(s?.pendingConflict === undefined, '旧样本无待裁决标记');

const f = await db.finds.get('old_f1');
assert(f?.sampleVersion === 1, '旧发现地补齐 sampleVersion=1');
const t = await db.sections.get('old_t1');
assert(t?.sampleVersion === 1, '旧切片补齐 sampleVersion=1');
const a = await db.analysis.get('old_a1');
assert(a?.sampleVersion === 1, '旧分析补齐 sampleVersion=1');

// 3) 新表可用
assert((await db.conflicts.count()) === 0, 'conflicts 表已建');
assert((await db.importBatches.count()) === 0, 'importBatches 表已建');

// 4) 再次打开不重复迁移、数据完好
await db.close();
await db.open();
assert((await db.samples.get('old_s1'))?.version === 1, '重开后版本戳仍为 1');
assert((await db.samples.count()) === 1, '记录无损');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
