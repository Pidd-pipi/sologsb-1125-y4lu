import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { db } from '../src/db';
import { CapacityExceededError, useSampleStore } from '../src/stores/sampleStore';

let pass = 0;
const ok = (name: string) => {
  pass += 1;
  console.log(`  ✓ ${name}`);
};

async function reset() {
  await db.delete();
  await db.open();
  await useSampleStore.getState().loadAll();
}

async function main() {
  // 1. 新增样本容量不足拒绝（desiccator 上限 2000g）
  await reset();
  const before = await db.samples.count();
  await assert.rejects(
    () =>
      useSampleStore.getState().addSample({
        sampleNo: 'MET-T-001',
        totalWeight: 5000,
        category: 'iron',
        chemicalGroup: 'IAB',
        weathering: 'W0',
        fallOrFind: 'find',
        storage: 'desiccator',
      }),
    CapacityExceededError,
  );
  assert.strictEqual(await db.samples.count(), before, '被拒样本不得落库');
  assert.ok(
    !(await db.samples.where('sampleNo').equals('MET-T-001').first()),
    '被拒编号不应存在',
  );
  ok('新增超重拒绝入库（不落库）');

  // 2. 正常新增 + 切片/分析跟随版本；改重量触发失效重算与版本+1
  const id = await useSampleStore.getState().addSample({
    sampleNo: 'MET-T-002',
    totalWeight: 100,
    category: 'chondrite',
    chemicalGroup: 'H',
    weathering: 'W1',
    fallOrFind: 'find',
    storage: 'cabinet-a',
  });
  await useSampleStore.getState().addSection({
    sectionNo: 'TS-T-1',
    sampleId: id,
    thickness: 30,
    preparation: 'resin',
    minerals: { olivine: 40, pyroxene: 30, feldspar: 10, metal: 20 },
    micrographs: [],
    quality: 'good',
  });
  await useSampleStore.getState().addAnalysis({
    sampleId: id,
    target: 'sample',
    method: 'microprobe',
    fa: 18,
    fs: 16,
    ni: 0.6,
    kamaciteBandwidth: 0.05,
    testedAt: '2025-03-01',
  });

  let s = useSampleStore.getState().samples.find((x) => x.id === id)!;
  assert.strictEqual(s.version, 1);
  assert.strictEqual(s.adviceSnapshot?.basis, 'analysis', '新增分析后应按检测重算建议');
  assert.strictEqual(s.adviceSnapshot?.weightBasis, 100);

  await useSampleStore.getState().updateSample(id, { totalWeight: 120 });
  s = useSampleStore.getState().samples.find((x) => x.id === id)!;
  assert.strictEqual(s.version, 2, '重量一变版本戳 +1');
  assert.strictEqual(s.occupancySnapshot?.weight, 120, '柜架占用立即重算');
  assert.strictEqual(s.adviceSnapshot?.weightBasis, 120, '分类建议立即按新重量重算');
  const sec = useSampleStore.getState().sections.find((x) => x.sectionNo === 'TS-T-1')!;
  assert.strictEqual(sec.sampleVersion, 2, '切片跟随新版本戳');
  const ana = useSampleStore.getState().analysis.find((x) => x.sampleId === id)!;
  assert.strictEqual(ana.sampleVersion, 2, '分析跟随新版本戳');
  ok('重量变化：版本+1、建议与占用失效重算、切片/分析跟随版本');

  // 3. 改柜位超重拒绝并保留原柜位（cabinet-b 上限 12000，种子已占 8420；先放 3000）
  const heavyId = await useSampleStore.getState().addSample({
    sampleNo: 'MET-T-003',
    totalWeight: 3000,
    category: 'iron',
    chemicalGroup: 'IAB',
    weathering: 'W0',
    fallOrFind: 'find',
    storage: 'cabinet-b',
  });
  // 把 120g 的样本改放进 cabinet-b → 8420+3000+120 = 11540 < 12000 OK
  await useSampleStore.getState().updateSample(id, { storage: 'cabinet-b' });
  s = useSampleStore.getState().samples.find((x) => x.id === id)!;
  assert.strictEqual(s.storage, 'cabinet-b');
  // 再增加重量到 1000：8420+3000+1000 = 12420 > 12000 → 拒绝，原柜位/原重量保留
  await assert.rejects(
    () => useSampleStore.getState().updateSample(id, { totalWeight: 1000 }),
    CapacityExceededError,
  );
  s = useSampleStore.getState().samples.find((x) => x.id === id)!;
  assert.strictEqual(s.totalWeight, 120, '超重拒绝后保留原重量');
  assert.strictEqual(s.storage, 'cabinet-b', '超重拒绝后保留原柜位');
  assert.strictEqual(s.version, 2, '拒绝不改变版本戳');
  const heavy = useSampleStore.getState().samples.find((x) => x.id === heavyId)!;
  assert.strictEqual(heavy.storage, 'cabinet-b');
  ok('改放超重拒绝：原重量与原柜位保留');

  console.log(`\n全部 ${pass} 项断言通过`);
  await db.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
