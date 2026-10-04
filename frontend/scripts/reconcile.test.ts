import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { db } from '../src/db';
import type { SamplePackage } from '../src/types/sync';
import { buildPackage, parsePackage } from '../src/utils/package';
import { ConflictStaleError, mergePackage, resolveConflict, retryFailedEntry } from '../src/utils/reconcile';
import { storageLoad } from '../src/utils/capacity';

let pass = 0;
const ok = (name: string) => {
  pass += 1;
  console.log(`  ✓ ${name}`);
};

function pkg(over: Partial<SamplePackage> = {}): SamplePackage {
  return {
    format: 'gbmeteorite-package',
    packageVersion: 1,
    exportedAt: Date.now(),
    exportedFrom: 'test',
    samples: [],
    finds: [],
    sections: [],
    analysis: [],
    ...over,
  };
}

async function first<T>(p: DexieTable<T>): Promise<T | undefined> {
  const all = await p.toArray();
  return all[0];
}
type DexieTable<T> = { toArray(): Promise<T[]> };

async function reset() {
  await db.delete();
  await db.open();
}

async function main() {
  // 1. 单边新增直接并库（含切片与分析）
  await reset();
  {
    const p = pkg({
      samples: [
        {
          refId: 'r1',
          sampleNo: 'MET-2025-100',
          totalWeight: 500,
          category: 'chondrite',
          chemicalGroup: 'H',
          weathering: 'W1',
          fallOrFind: 'find',
          storage: 'cabinet-a',
          version: 1,
        },
      ],
      finds: [
        {
          sampleId: 'r1',
          placeName: 'Atacama',
          region: '智利',
          longitude: -70,
          latitude: -24,
          coordinateSource: 'gps',
          environment: 'desert',
          finder: 'X',
          sampleVersion: 1,
        },
      ],
      sections: [
        {
          sectionNo: 'TS-2025-001',
          sampleId: 'r1',
          thickness: 30,
          preparation: 'resin',
          minerals: { olivine: 40, pyroxene: 30, feldspar: 10, metal: 20 },
          micrographs: [],
          quality: 'good',
          sampleVersion: 1,
        },
      ],
      analysis: [
        {
          sampleId: 'r1',
          target: 'sample',
          method: 'microprobe',
          fa: 18,
          fs: 16,
          ni: 0.5,
          kamaciteBandwidth: 0.05,
          testedAt: '2025-01-01',
          sampleVersion: 1,
        },
      ],
    });
    const r = await mergePackage(p, 'a.json');
    assert.strictEqual(r.mergedSamples, 1);
    assert.strictEqual(r.mergedSections, 1);
    assert.strictEqual(r.mergedAnalysis, 1);
    assert.strictEqual(r.mergedFinds, 1);
    const s = await db.samples.where('sampleNo').equals('MET-2025-100').first();
    assert.ok(s && s.status === 'active' && s.version === 1);
    assert.ok(s.adviceSnapshot && s.adviceSnapshot.basis === 'analysis');
    assert.ok(s.occupancySnapshot && s.occupancySnapshot.weight === 500);
    ok('单边新增直接并库（样本+发现地+切片+分析，派生快照已生成）');
  }

  // 2. 本机刚补的切片/分析不被跳过也不被覆盖；同版本再并库只补缺
  {
    const p = pkg({
      samples: [
        {
          refId: 'r1',
          sampleNo: 'MET-2025-100',
          totalWeight: 500,
          category: 'chondrite',
          chemicalGroup: 'H',
          weathering: 'W1',
          fallOrFind: 'find',
          storage: 'cabinet-a',
          version: 1,
        },
      ],
      sections: [
        // 已有的编号不重复
        {
          sectionNo: 'TS-2025-001',
          sampleId: 'r1',
          thickness: 99,
          preparation: 'resin',
          minerals: { olivine: 1, pyroxene: 1, feldspar: 1, metal: 97 },
          micrographs: [],
          quality: 'poor',
          sampleVersion: 1,
        },
        // 新切片应补入
        {
          sectionNo: 'TS-2025-002',
          sampleId: 'r1',
          thickness: 45,
          preparation: 'epoxy',
          minerals: { olivine: 40, pyroxene: 30, feldspar: 10, metal: 20 },
          micrographs: [],
          quality: 'fair',
          sampleVersion: 1,
        },
      ],
    });
    const r = await mergePackage(p, 'a2.json');
    const sections = await db.sections.toArray();
    const s1 = sections.find((x) => x.sectionNo === 'TS-2025-001');
    assert.strictEqual(s1?.thickness, 30, '本机切片不能被包内覆盖');
    assert.ok(sections.some((x) => x.sectionNo === 'TS-2025-002'), '缺的切片应补入');
    assert.strictEqual(r.mergedSections, 1);
    ok('同版本再并库：本机切片不被覆盖，仅补缺');
  }

  // 3. 重量不一致 → 两条 pending + 冲突，总览/地图不显示
  {
    const p = pkg({
      samples: [
        {
          refId: 'r1',
          sampleNo: 'MET-2025-100',
          totalWeight: 999,
          category: 'chondrite',
          chemicalGroup: 'H',
          weathering: 'W1',
          fallOrFind: 'find',
          storage: 'cabinet-a',
          version: 2,
        },
      ],
    });
    const r = await mergePackage(p, 'b.json');
    assert.strictEqual(r.conflicts, 1);
    const conflict = await first(db.conflicts);
    assert.ok(conflict && conflict.status === 'open');
    assert.ok(conflict.diffs.some((d) => d.field === 'totalWeight'));
    const both = await db.samples.where('sampleNo').equals('MET-2025-100').toArray();
    assert.strictEqual(both.length, 2);
    assert.ok(both.every((s) => s.status === 'pending'));
    const activeCount = (await db.samples.where('status').equals('active').count());
    assert.strictEqual(activeCount, 0);
    const loads = storageLoad(await db.samples.toArray());
    const aLoad = loads.find((l) => l.storage === 'cabinet-a');
    assert.strictEqual(aLoad?.used, 0, 'pending 不占柜');
    ok('重量不一致：保留两条 pending 待裁决，总览/地图不显示，且不占柜架');
  }

  // 4. 容量不足拒绝入库并保留失败包，修正柜位后重试成功
  await reset();
  {
    const heavy = pkg({
      samples: [
        {
          refId: 'h',
          sampleNo: 'MET-2025-200',
          totalWeight: 50000,
          category: 'iron',
          chemicalGroup: 'IAB',
          weathering: 'W0',
          fallOrFind: 'find',
          storage: 'cabinet-a',
          version: 1,
        },
      ],
    });
    const r = await mergePackage(heavy, 'heavy.json');
    assert.strictEqual(r.rejected, 1);
    assert.strictEqual(r.mergedSamples, 0);
    const fails = await db.importFailures.toArray();
    assert.strictEqual(fails.length, 1);
    assert.strictEqual(fails[0].reason, 'capacity');
    assert.ok(fails[0].samples.length === 1 && fails[0].samples[0].totalWeight === 50000);
    // 改放到不限容量的外借，重试成功
    const rr = await retryFailedEntry(fails[0].id, { storageOverride: 'loan-out' });
    assert.strictEqual(rr.mergedSamples, 1);
    assert.strictEqual(await db.importFailures.count(), 0);
    const s = await db.samples.where('sampleNo').equals('MET-2025-200').first();
    assert.strictEqual(s?.storage, 'loan-out');
    ok('容量不足拒绝入库 → 失败包保留 → 修正柜位后重试成功');
  }

  // 5. 版本快进：重量/发现地/柜位一致时，其余字段快进 + 子记录跟随版本 + 派生重算
  await reset();
  {
    await mergePackage(
      pkg({
        samples: [
          {
            refId: 'r',
            sampleNo: 'MET-2025-300',
            totalWeight: 100,
            category: 'chondrite',
            chemicalGroup: 'H',
            weathering: 'W1',
            fallOrFind: 'find',
            storage: 'desiccator',
            version: 1,
          },
        ],
        sections: [
          {
            sectionNo: 'TS-X',
            sampleId: 'r',
            thickness: 30,
            preparation: 'resin',
            minerals: { olivine: 40, pyroxene: 30, feldspar: 10, metal: 20 },
            micrographs: [],
            quality: 'good',
            sampleVersion: 1,
          },
        ],
      }),
      'v1.json',
    );
    await mergePackage(
      pkg({
        samples: [
          {
            refId: 'r',
            sampleNo: 'MET-2025-300',
            totalWeight: 100,
            category: 'chondrite',
            chemicalGroup: 'H',
            weathering: 'W3',
            fallOrFind: 'find',
            storage: 'desiccator',
            version: 2,
          },
        ],
      }),
      'v2.json',
    );
    const s = await db.samples.where('sampleNo').equals('MET-2025-300').first();
    assert.strictEqual(s?.weathering, 'W3', '非键字段随版本快进');
    assert.strictEqual(s?.version, 2);
    assert.strictEqual(s?.occupancySnapshot?.weight, 100, '占用快照应随版本重算');
    assert.strictEqual(s?.adviceSnapshot?.weightBasis, 100);
    const sec = await db.sections.where('sectionNo').equals('TS-X').first();
    assert.strictEqual(sec?.sampleVersion, 2, '切片跟随样本版本');
    ok('版本快进：非键字段更新、占用与建议重算、切片跟随新版本');
  }

  // 6. 裁决冲突 + 两页并发：后确认的一页收到 ConflictStaleError，不覆盖
  await reset();
  {
    await mergePackage(
      pkg({
        samples: [
          {
            refId: 'r',
            sampleNo: 'MET-2025-400',
            totalWeight: 100,
            category: 'chondrite',
            chemicalGroup: 'H',
            weathering: 'W1',
            fallOrFind: 'find',
            storage: 'cabinet-b',
            version: 1,
          },
        ],
      }),
      'base.json',
    );
    await mergePackage(
      pkg({
        samples: [
          {
            refId: 'r',
            sampleNo: 'MET-2025-400',
            totalWeight: 250,
            category: 'chondrite',
            chemicalGroup: 'H',
            weathering: 'W1',
            fallOrFind: 'find',
            storage: 'cabinet-b',
            version: 3,
          },
        ],
      }),
      'conf.json',
    );
    const conflict = (await first(db.conflicts))!;
    // 第一页确认保留本机
    const winnerLocal = await resolveConflict(conflict.id, 'local', 'tab-A');
    assert.strictEqual(winnerLocal.status, 'active');
    assert.strictEqual(winnerLocal.totalWeight, 100);
    assert.strictEqual(winnerLocal.version, 2, '裁决后版本戳 +1');
    // 第二页再确认保留包内 → 必须失败
    await assert.rejects(
      () => resolveConflict(conflict.id, 'incoming', 'tab-B'),
      ConflictStaleError,
    );
    const finalSamples = await db.samples.toArray();
    assert.strictEqual(finalSamples.length, 1);
    assert.strictEqual(finalSamples[0].totalWeight, 100, '后确认不得覆盖先确认结果');
    const c2 = await db.conflicts.get(conflict.id);
    assert.strictEqual(c2?.resolution?.sessionId, 'tab-A');
    ok('并发裁决：先确认生效（版本+1），后确认抛 ConflictStaleError 不覆盖');
  }

  // 7. 旧数据无版本戳 → 解析时按初次入库补 v1；往返 export 保留版本
  await reset();
  {
    const legacy = {
      format: 'gbmeteorite-package',
      packageVersion: 1,
      exportedAt: Date.now(),
      samples: [
        {
          // 没有 version / refId
          sampleNo: 'MET-OLD-001',
          totalWeight: 10,
          category: 'iron',
          chemicalGroup: 'IAB',
          weathering: 'W0',
          fallOrFind: 'find',
          storage: 'cabinet-b',
        },
      ],
      sections: [],
      finds: [],
      analysis: [],
    };
    const parsed = parsePackage(legacy);
    assert.strictEqual(parsed.samples[0].version, 1);
    assert.ok(parsed.samples[0].refId);
    await mergePackage(parsed, 'legacy.json');
    const s = await db.samples.where('sampleNo').equals('MET-OLD-001').first();
    assert.strictEqual(s?.version, 1);
    const out = buildPackage(await db.samples.toArray(), [], [], []);
    assert.strictEqual(out.samples[0].version, 1);
    assert.ok(out.samples[0].refId);
    ok('旧数据无版本戳按初次入库补 v1，导出往返保留');
  }

  // 8. 整包非法 → invalid-package 失败记录
  await reset();
  {
    assert.throws(() => parsePackage({ hello: 1 }), /缺少 format/);
    assert.throws(() => parsePackage({ format: 'gbmeteorite-package' }), /samples/);
    ok('整包非法时抛 InvalidPackageError（页面侧记录 invalid-package 失败包）');
  }

  // 9. 发现地不一致同样产生冲突
  await reset();
  {
    const base = pkg({
      samples: [
        {
          refId: 'r',
          sampleNo: 'MET-2025-500',
          totalWeight: 300,
          category: 'achondrite',
          chemicalGroup: 'ungrouped',
          weathering: 'W2',
          fallOrFind: 'fall',
          storage: 'cabinet-a',
          version: 1,
        },
      ],
      finds: [
        {
          sampleId: 'r',
          placeName: 'A',
          region: '中国',
          longitude: 100,
          latitude: 40,
          coordinateSource: 'gps',
          environment: 'witnessed',
          finder: 'f',
          sampleVersion: 1,
        },
      ],
    });
    await mergePackage(base, 'base.json');
    const other = pkg({
      samples: [
        {
          refId: 'r',
          sampleNo: 'MET-2025-500',
          totalWeight: 300,
          category: 'achondrite',
          chemicalGroup: 'ungrouped',
          weathering: 'W2',
          fallOrFind: 'fall',
          storage: 'cabinet-a',
          version: 2,
        },
      ],
      finds: [
        {
          sampleId: 'r',
          placeName: 'B',
          region: '智利',
          longitude: -70,
          latitude: -24,
          coordinateSource: 'gps',
          environment: 'desert',
          finder: 'g',
          sampleVersion: 2,
        },
      ],
    });
    const r = await mergePackage(other, 'other.json');
    assert.strictEqual(r.conflicts, 1);
    const c = await first(db.conflicts);
    assert.ok(c?.diffs.some((d) => d.field === 'findLocation'));
    ok('发现地不一致 → 保留两条待裁决');
  }

  console.log(`\n全部 ${pass} 项断言通过`);
  await db.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
