import 'fake-indexeddb/auto';
import { db } from '../src/db';
import { useSampleStore, CapacityError, StaleConflictError } from '../src/stores/sampleStore';
import type { SamplePackage } from '../src/types/sync';
import type { MeteoriteSample } from '../src/types/sample';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error('FAIL:', msg);
  }
}

async function resetDb() {
  await db.delete();
  await db.open();
  useSampleStore.setState({
    samples: [],
    finds: [],
    sections: [],
    analysis: [],
    conflicts: [],
    batches: [],
    loaded: true,
    loading: false,
  });
}

const sample = (over: Partial<MeteoriteSample> & { id: string; sampleNo: string }): MeteoriteSample => ({
  totalWeight: 1000,
  category: 'chondrite',
  chemicalGroup: 'H',
  weathering: 'W1',
  fallOrFind: 'find',
  storage: 'cabinet-a',
  version: 1,
  createdAt: 100,
  updatedAt: 100,
  ...over,
});

const makePkg = (samples: MeteoriteSample[], extra: Partial<SamplePackage> = {}): SamplePackage => ({
  kind: 'gbmeteorite-sample-package',
  pkgVersion: 1,
  stationId: 'station-b',
  exportedAt: 200,
  samples,
  finds: [],
  sections: [],
  analysis: [],
  ...extra,
});

const s = useSampleStore.getState();

// 1. 单边新增：样本+切片+分析一并入库
await resetDb();
{
  const pkg = makePkg([sample({ id: 'p1', sampleNo: 'MET-2024-100' })], {
    sections: [
      {
        id: 'ps1',
        sectionNo: 'TS-100',
        sampleId: 'p1',
        thickness: 30,
        preparation: 'resin',
        minerals: { olivine: 40, pyroxene: 30, feldspar: 10, metal: 20 },
        micrographs: [],
        quality: 'good',
        sampleVersion: 1,
        createdAt: 200,
      },
    ],
    analysis: [
      {
        id: 'pa1',
        sampleId: 'p1',
        target: 'sample',
        method: 'microprobe',
        fa: 18,
        fs: 16,
        ni: 0.8,
        kamaciteBandwidth: 0.05,
        testedAt: '2024-01-01',
        sampleVersion: 1,
        createdAt: 200,
      },
    ],
  });
  const res = await s.importPackage('a.json', pkg);
  assert(res.ok, '导入成功');
  assert((await db.samples.count()) === 1, '样本入库 1');
  assert((await db.sections.count()) === 1, '切片入库 1');
  assert((await db.analysis.count()) === 1, '分析入库 1');
  const inserted = (await db.samples.toArray())[0];
  assert(inserted.id !== 'p1', '跨机 id 重签');
  const sec = (await db.sections.toArray())[0];
  assert(sec.sampleId === inserted.id && sec.sectionNo === 'TS-100', '切片重挂到新样本 id');
}

// 2. 同编号同版本：本机切片保留、离线切片补入（最初的 bug 场景）
await resetDb();
{
  const sid = await s.addSample({
    sampleNo: 'MET-2024-001',
    totalWeight: 1000,
    category: 'chondrite',
    chemicalGroup: 'H',
    weathering: 'W1',
    fallOrFind: 'find',
    storage: 'cabinet-a',
  });
  await s.addSection({
    sectionNo: 'TS-LOCAL',
    sampleId: sid,
    thickness: 30,
    preparation: 'resin',
    minerals: { olivine: 40, pyroxene: 30, feldspar: 10, metal: 20 },
    micrographs: [],
    quality: 'good',
  });
  const pkg = makePkg(
    [sample({ id: 'r1', sampleNo: 'MET-2024-001' })],
    {
      sections: [
        {
          id: 'rs1',
          sectionNo: 'TS-REMOTE',
          sampleId: 'r1',
          thickness: 30,
          preparation: 'resin',
          minerals: { olivine: 40, pyroxene: 30, feldspar: 10, metal: 20 },
          micrographs: [],
          quality: 'good',
          sampleVersion: 1,
          createdAt: 200,
        },
      ],
    },
  );
  const res = await s.importPackage('b.json', pkg);
  assert(res.ok, '导入成功');
  const secs = await db.sections.toArray();
  assert(secs.length === 2, `本机切片不丢 + 离线切片补入，实际 ${secs.length}`);
  assert(secs.some((x) => x.sectionNo === 'TS-LOCAL'), '本机刚补的切片仍在');
  assert(secs.some((x) => x.sectionNo === 'TS-REMOTE'), '离线切片已并库');
}

// 3. 重量冲突：两条挂起、总览筛选隐藏、地图隐藏
await resetDb();
{
  await s.addSample({
    sampleNo: 'MET-2024-002',
    totalWeight: 1000,
    category: 'chondrite',
    chemicalGroup: 'H',
    weathering: 'W1',
    fallOrFind: 'find',
    storage: 'cabinet-a',
  });
  const pkg = makePkg([sample({ id: 'q1', sampleNo: 'MET-2024-002', version: 2, totalWeight: 2000 })]);
  const res = await s.importPackage('c.json', pkg);
  assert(res.ok, '含冲突的包仍整体成功落库');
  const conflicts = await db.conflicts.toArray();
  assert(conflicts.length === 1 && conflicts[0].status === 'pending', '1 个 pending 冲突单');
  const allSamples = await db.samples.toArray();
  assert(allSamples.length === 2 && allSamples.every((x) => x.pendingConflict), '两条都挂起');
  const visible = useSampleStore.getState().samples.filter((x) => !x.pendingConflict);
  assert(visible.length === 0, '内存态总览可见 0 条');
}

// 4. 容量不足：整包拒绝、原柜位不动、失败包可改柜位后重试
await resetDb();
{
  // 先把 A 柜放到 19500g
  await s.addSample({
    sampleNo: 'MET-2024-010',
    totalWeight: 19500,
    category: 'iron',
    chemicalGroup: 'IAB',
    weathering: 'W0',
    fallOrFind: 'find',
    storage: 'cabinet-a',
  });
  const beforeCount = await db.samples.count();
  const pkg = makePkg([sample({ id: 'w1', sampleNo: 'MET-2024-011', totalWeight: 1000, storage: 'cabinet-a' })]);
  const res = await s.importPackage('d.json', pkg);
  assert(!res.ok, '超重拒绝');
  assert((await db.samples.count()) === beforeCount, '原柜位不动，样本数不变');
  const batches = await db.importBatches.toArray();
  assert(batches.length === 1 && batches[0].status === 'failed', '失败包落库');

  // 改到 B 柜（空柜）重试
  const retry = await s.retryBatch(batches[0].id, {
    'MET-2024-011': { storage: 'cabinet-b', totalWeight: 1000 },
  });
  assert(retry.ok, '改柜位后重试成功');
  const batches2 = await db.importBatches.toArray();
  assert(batches2[0].status === 'succeeded', '失败包标记成功');
  const inserted = (await db.samples.where('sampleNo').equals('MET-2024-011').toArray())[0];
  assert(inserted.storage === 'cabinet-b', '入 B 柜');
}

// 5. 新样本超重直接拒绝（容量闸）
await resetDb();
{
  let threw = false;
  try {
    await s.addSample({
      sampleNo: 'MET-2024-099',
      totalWeight: 25000,
      category: 'iron',
      chemicalGroup: 'IAB',
      weathering: 'W0',
      fallOrFind: 'find',
      storage: 'cabinet-a',
    });
  } catch (e) {
    threw = e instanceof CapacityError;
  }
  assert(threw, '25kg 超 A 柜，CapacityError');
  assert((await db.samples.count()) === 0, '未入库');
}

// 6. 重量变更 bump 版本戳；旧分析失效
await resetDb();
{
  const sid = await s.addSample({
    sampleNo: 'MET-2024-020',
    totalWeight: 1000,
    category: 'chondrite',
    chemicalGroup: 'H',
    weathering: 'W1',
    fallOrFind: 'find',
    storage: 'cabinet-a',
  });
  await s.addAnalysis({
    sampleId: sid,
    target: 'sample',
    method: 'microprobe',
    fa: 18,
    fs: 16,
    ni: 0.8,
    kamaciteBandwidth: 0.05,
    testedAt: '2024-01-01',
  });
  let a = (await db.analysis.toArray())[0];
  assert(a.sampleVersion === 1, '分析跟随 v1');
  await s.updateSample(sid, { totalWeight: 1500 });
  const updated = await db.samples.get(sid);
  assert(updated!.version === 2, '重量一变版本戳 v2');
  a = (await db.analysis.toArray())[0];
  assert(a.sampleVersion === 1 && a.sampleVersion < updated!.version, '旧分析仍在 v1（失效待重算）');
}

// 7. 裁决冲突 keep-local / keep-incoming 与并发：后确认抛 StaleConflictError，草稿方自行保留
await resetDb();
{
  await s.addSample({
    sampleNo: 'MET-2024-030',
    totalWeight: 1000,
    category: 'chondrite',
    chemicalGroup: 'H',
    weathering: 'W1',
    fallOrFind: 'find',
    storage: 'cabinet-a',
  });
  const pkg = makePkg([
    sample({ id: 'z1', sampleNo: 'MET-2024-030', version: 2, totalWeight: 3000, storage: 'cabinet-b' }),
  ]);
  await s.importPackage('e.json', pkg);
  const conflict = (await db.conflicts.toArray())[0];

  // 第一页确认保留本机
  await s.resolveConflict(conflict.id, 'keep-local');
  const afterFirst = await db.samples.toArray();
  assert(afterFirst.length === 1, '裁决后只剩 1 条');
  assert(afterFirst[0].totalWeight === 1000 && afterFirst[0].storage === 'cabinet-a', '保留本机值');
  assert(!afterFirst[0].pendingConflict, '恢复可见');

  // 第二页同冲突再确认 -> StaleConflictError
  let stale: unknown = null;
  try {
    await s.resolveConflict(conflict.id, 'keep-incoming');
  } catch (e) {
    stale = e;
  }
  assert(stale instanceof StaleConflictError, '后确认抛 StaleConflictError，不覆盖先确认');
  const stillThere = await db.samples.toArray();
  assert(stillThere.length === 1 && stillThere[0].totalWeight === 1000, '先确认结果未被覆盖');
}

// 8. 裁决超重：维持待裁决
await resetDb();
{
  await s.addSample({
    sampleNo: 'MET-2024-040',
    totalWeight: 1000,
    category: 'chondrite',
    chemicalGroup: 'H',
    weathering: 'W1',
    fallOrFind: 'find',
    storage: 'cabinet-a',
  });
  // B 柜放到 14000g
  await s.addSample({
    sampleNo: 'MET-2024-041',
    totalWeight: 14000,
    category: 'iron',
    chemicalGroup: 'IAB',
    weathering: 'W0',
    fallOrFind: 'find',
    storage: 'cabinet-b',
  });
  const pkg = makePkg([
    sample({ id: 'z2', sampleNo: 'MET-2024-040', version: 2, totalWeight: 5000, storage: 'cabinet-b' }),
  ]);
  await s.importPackage('f.json', pkg);
  const conflict = (await db.conflicts.toArray())[0];
  let capErr: unknown = null;
  try {
    // 采用离线：B 柜将达 19000 > 15000
    await s.resolveConflict(conflict.id, 'keep-incoming');
  } catch (e) {
    capErr = e;
  }
  assert(capErr instanceof CapacityError, '裁决入超重柜位被 CapacityError 拒绝');
  const conflictStill = await db.conflicts.get(conflict.id);
  assert(conflictStill?.status === 'pending', '冲突维持待裁决');
  assert((await db.samples.count()) === 3, '两条挂起样本都还在（+1 柜占位样本）');

  // 改保留本机（A 柜只有 1000，没问题）可以成功
  await s.resolveConflict(conflict.id, 'keep-local');
  assert((await db.samples.count()) === 2, '裁决成功后删除离线副本');
}

// 9. 旧数据迁移：无版本戳记录补 v1（Dexie v4 upgrade 路径）
await db.delete();
{
  // 在旧 schema（v3）下写入无版本戳数据
  // 直接用 Dexie 临时库写底层 object store 不可行（当前类已到 v4），
  // 这里验证 stampOf 归一化与 v4 upgrade 里同样的补齐逻辑
  const { stampOf, INITIAL_VERSION } = await import('../src/db');
  assert(stampOf(undefined) === INITIAL_VERSION, 'undefined -> v1');
  assert(stampOf(0) === INITIAL_VERSION, '0 -> v1');
  assert(stampOf(3) === 3, '3 保留');
  await db.open();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
