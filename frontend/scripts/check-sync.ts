import { planMerge, diffConflictFields, validatePackage, buildExportPackage } from '../src/utils/sync';
import { calcOccupancy } from '../src/utils/occupancy';
import type { MeteoriteSample } from '../src/types/sample';
import type { SamplePackage } from '../src/types/sync';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error('FAIL:', msg);
  }
}

const baseSample = (over: Partial<MeteoriteSample> = {}): MeteoriteSample => ({
  id: 's1',
  sampleNo: 'MET-2024-001',
  totalWeight: 1000,
  category: 'chondrite',
  chemicalGroup: 'H',
  weathering: 'W1',
  fallOrFind: 'find',
  storage: 'cabinet-a',
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const pkg = (samples: MeteoriteSample[], extra: Partial<SamplePackage> = {}): SamplePackage => ({
  kind: 'gbmeteorite-sample-package',
  pkgVersion: 1,
  stationId: 'station-b',
  exportedAt: 2,
  samples,
  finds: [],
  sections: [],
  analysis: [],
  ...extra,
});

// 1. 单边新增直接并库
{
  const plan = planMerge({
    localSamples: [],
    localFinds: [],
    localSections: [],
    localAnalysis: [],
    pkg: pkg([baseSample({ id: 'x1' })]),
  });
  assert(plan.items[0].action === 'add-incoming', '单边新增应为 add-incoming');
  assert(plan.directAddCount === 1, 'directAddCount=1');
  assert(plan.capacityRejections.length === 0, '1kg 不应超重（A 柜 20kg）');
}

// 2. 同编号同版本戳：本机切片保留（不被跳过问题复现），离线切片补充
{
  const local = baseSample();
  const plan = planMerge({
    localSamples: [local],
    localFinds: [],
    localSections: [
      {
        id: 'sec-local',
        sectionNo: 'TS-1',
        sampleId: 's1',
        thickness: 30,
        preparation: 'resin',
        minerals: { olivine: 1, pyroxene: 1, feldspar: 1, metal: 1 },
        micrographs: [],
        quality: 'good',
        sampleVersion: 1,
        createdAt: 1,
      },
    ],
    localAnalysis: [],
    pkg: pkg([baseSample({ id: 'y1' })], {
      sections: [
        {
          id: 'sec-inc',
          sectionNo: 'TS-2',
          sampleId: 'y1',
          thickness: 30,
          preparation: 'resin',
          minerals: { olivine: 1, pyroxene: 1, feldspar: 1, metal: 1 },
          micrographs: [],
          quality: 'good',
          sampleVersion: 1,
          createdAt: 2,
        },
      ],
    }),
  });
  assert(plan.items[0].action === 'keep', '同版本应为 keep');
  assert(plan.childMergeCount === 1, '离线新切片 TS-2 应并库，本机 TS-1 不动');
}

// 3. 同编号不同版本 + 重量不一致 -> conflict
{
  const plan = planMerge({
    localSamples: [baseSample()],
    localFinds: [],
    localSections: [],
    localAnalysis: [],
    pkg: pkg([baseSample({ id: 'y2', version: 2, totalWeight: 1200 })]),
  });
  assert(plan.items[0].action === 'conflict', '重量不同应为 conflict');
  assert(plan.items[0].fields?.includes('totalWeight'), 'fields 含 totalWeight');
  assert(plan.conflictCount === 1, 'conflictCount=1');
}

// 4. 发现地不一致 -> conflict on find
{
  const fields = diffConflictFields(
    baseSample({ storage: 'cabinet-b' }),
    baseSample({ version: 2, storage: 'cabinet-b' }),
    null,
    {
      id: 'f',
      sampleId: 'y',
      placeName: 'Atacama',
      region: '智利',
      longitude: 1,
      latitude: 1,
      coordinateSource: 'gps',
      environment: 'desert',
      finder: 'x',
      sampleVersion: 2,
      createdAt: 2,
    },
  );
  assert(fields.includes('find') && !fields.includes('storage'), '仅发现地不一致');
}

// 5. 柜位不一致
{
  const fields = diffConflictFields(
    baseSample(),
    baseSample({ version: 2, storage: 'cabinet-b' }),
    null,
    null,
  );
  assert(fields.includes('storage'), 'storage 不一致');
}

// 6. 版本不同但三项一致 -> fast-forward
{
  const plan = planMerge({
    localSamples: [baseSample()],
    localFinds: [],
    localSections: [],
    localAnalysis: [],
    pkg: pkg([baseSample({ id: 'y3', version: 3, note: '备注变化但关键三项不变' })]),
  });
  assert(plan.items[0].action === 'fast-forward', '应 fast-forward');
}

// 7. 容量：A 柜 20kg，放入 25kg 拒绝
{
  const plan = planMerge({
    localSamples: [],
    localFinds: [],
    localSections: [],
    localAnalysis: [],
    pkg: pkg([baseSample({ id: 'big', totalWeight: 25000 })]),
  });
  assert(plan.capacityRejections.length === 1, '25kg 超 A 柜 20kg 应拒绝');
  assert(plan.capacityRejections[0].overflowGrams === 5000, '超重 5000g');
}

// 8. 多个单边新增累计超重也要拒
{
  const plan = planMerge({
    localSamples: [baseSample({ id: 'full', totalWeight: 19000 })],
    localFinds: [],
    localSections: [],
    localAnalysis: [],
    pkg: pkg([
      baseSample({ id: 'b1', sampleNo: 'MET-2024-002', totalWeight: 1000 }),
      baseSample({ id: 'b2', sampleNo: 'MET-2024-003', totalWeight: 1000 }),
    ]),
  });
  assert(plan.capacityRejections.length === 1, '第二条导致累计 21kg 应拒绝一条');
}

// 9. 待裁决样本不计占用
{
  const occ = calcOccupancy([baseSample({ pendingConflict: true, totalWeight: 19000 })]);
  const a = occ.find((o) => o.storage === 'cabinet-a')!;
  assert(a.usedGrams === 0 && a.sampleCount === 0, '待裁决不计占用');
}

// 10. 旧数据无版本戳：validate+normalize 补 v1
{
  const old: unknown = {
    kind: 'gbmeteorite-sample-package',
    stationId: 's',
    exportedAt: 1,
    samples: [
      {
        id: 'old1',
        sampleNo: 'MET-2020-001',
        totalWeight: 10,
        category: 'iron',
        chemicalGroup: 'IAB',
        weathering: 'W0',
        fallOrFind: 'fall',
        storage: 'loan-out',
        createdAt: 1,
      },
    ],
  };
  const { pkg: p, errors } = validatePackage(old);
  assert(errors.length === 0 && p !== null, '旧包应校验通过');
  assert(p!.samples[0].version === 1, '样本版本戳补 1');
}

// 11. 坏包拒绝
{
  const { errors } = validatePackage({ hello: 1 });
  assert(errors.length > 0, '坏包应报错');
}

// 12. 导出排除待裁决
{
  const p = buildExportPackage({
    samples: [baseSample(), baseSample({ id: 's2', sampleNo: 'MET-2024-002', pendingConflict: true })],
    finds: [],
    sections: [],
    analysis: [],
  });
  assert(p.samples.length === 1 && p.samples[0].id === 's1', '导出排除待裁决');
}

// 13. 待裁决编号再次导入：不重复建单
{
  const plan = planMerge({
    localSamples: [
      baseSample({ id: 'loc', pendingConflict: true, conflictId: 'c1' }),
      baseSample({ id: 'inc', sampleNo: 'MET-2024-001', pendingConflict: true, conflictId: 'c1', version: 2, totalWeight: 2000 }),
    ],
    localFinds: [],
    localSections: [],
    localAnalysis: [],
    pkg: pkg([baseSample({ id: 'again', version: 2, totalWeight: 2000 })]),
  });
  assert(plan.items.length === 0, '已在裁决流程中的编号应跳过');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
