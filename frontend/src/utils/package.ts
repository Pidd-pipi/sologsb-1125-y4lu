import type { FindRecord } from '../types/find';
import type { AnalysisRecord } from '../types/analysis';
import type { MeteoriteSample, StorageLocation } from '../types/sample';
import type { ThinSection } from '../types/section';
import type {
  PackageAnalysis,
  PackageFind,
  PackageSample,
  PackageSection,
  SamplePackage,
} from '../types/sync';

/** 整包结构不合法错误（失败包整体保留、不可单条重试） */
export class InvalidPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPackageError';
  }
}

/** 生成离线样本包（只导出在档 active 样本及其版本跟随的记录） */
export function buildPackage(
  samples: MeteoriteSample[],
  finds: FindRecord[],
  sections: ThinSection[],
  analysis: AnalysisRecord[],
  exportedFrom = '本机编目台',
): SamplePackage {
  const activeSamples = samples.filter((s) => s.status !== 'pending');
  const activeIds = new Set(activeSamples.map((s) => s.id));
  const stripSample = ({
    id,
    createdAt: _c,
    updatedAt: _u,
    status: _st,
    conflictId: _ci,
    adviceSnapshot: _a,
    occupancySnapshot: _o,
    ...rest
  }: MeteoriteSample): PackageSample => ({ ...rest, refId: id });
  const stripFind = ({
    id: _id,
    createdAt: _c,
    status: _st,
    conflictId: _ci,
    ...rest
  }: FindRecord): PackageFind => rest;
  const stripSection = ({
    id: _id,
    createdAt: _c,
    ...rest
  }: ThinSection): PackageSection => rest;
  const stripAnalysis = ({
    id: _id,
    createdAt: _c,
    ...rest
  }: AnalysisRecord): PackageAnalysis => rest;

  return {
    format: 'gbmeteorite-package',
    packageVersion: 1,
    exportedFrom,
    exportedAt: Date.now(),
    samples: activeSamples.map(stripSample),
    finds: finds.filter((f) => activeIds.has(f.sampleId) && f.status !== 'pending').map(stripFind),
    sections: sections.filter((s) => activeIds.has(s.sampleId)).map(stripSection),
    analysis: analysis.filter((a) => activeIds.has(a.sampleId)).map(stripAnalysis),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 解析样本包 JSON：
 *  - 结构非法抛 InvalidPackageError（整包保留为 invalid-package）
 *  - 旧数据没有版本戳的按初次入库补齐（version=1，跟随记录补 sampleVersion=1）
 */
export function parsePackage(raw: unknown): SamplePackage {
  if (!isRecord(raw) || raw.format !== 'gbmeteorite-package') {
    throw new InvalidPackageError('不是 gbmeteorite 离线样本包（缺少 format 标识）');
  }
  if (!Array.isArray(raw.samples)) throw new InvalidPackageError('样本包缺少 samples 数组');
  for (const key of ['finds', 'sections', 'analysis'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      throw new InvalidPackageError(`样本包 ${key} 必须是数组`);
    }
  }

  const samples = (raw.samples as PackageSample[]).map(normalizeSample);
  const versionByNo = new Map(samples.map((s) => [s.sampleNo, s.version]));
  const stamp = <T extends { sampleId?: string; sampleNo?: string; sampleVersion?: number }>(
    rec: T,
  ): T => {
    if (typeof rec.sampleVersion !== 'number') {
      const key = rec.sampleId ?? rec.sampleNo;
      rec.sampleVersion = (key && versionByNo.get(key)) || 1;
    }
    return rec;
  };

  const finds = ((raw.finds as PackageFind[] | undefined) ?? []).map((f) => stamp(normalizeFind(f)));
  const sections = ((raw.sections as PackageSection[] | undefined) ?? []).map((s) =>
    stamp(normalizeSection(s)),
  );
  const analysis = ((raw.analysis as PackageAnalysis[] | undefined) ?? []).map((a) =>
    stamp(normalizeAnalysis(a)),
  );

  return {
    format: 'gbmeteorite-package',
    packageVersion: 1,
    exportedFrom: typeof raw.exportedFrom === 'string' ? raw.exportedFrom : '离线台',
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : Date.now(),
    samples,
    finds,
    sections,
    analysis,
  };
}

/** 校验单条样本；返回错误信息（合法返回 null） */
export function validatePackageSample(s: PackageSample): string | null {
  if (!s || typeof s.sampleNo !== 'string' || !s.sampleNo.trim()) return '样本编号缺失';
  if (!(Number(s.totalWeight) > 0)) return `${s.sampleNo} 总重量需大于 0 g`;
  if (!s.storage) return `${s.sampleNo} 存放位置缺失`;
  return null;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSample(raw: unknown): PackageSample {
  if (!isRecord(raw)) throw new InvalidPackageError('samples 中存在非对象条目');
  const s = raw as Partial<PackageSample>;
  return {
    refId: typeof s.refId === 'string' && s.refId ? s.refId : `ref_${String(s.sampleNo ?? '')}`,
    sampleNo: String(s.sampleNo ?? '').trim(),
    totalWeight: num(s.totalWeight),
    category: (s.category as PackageSample['category']) ?? 'chondrite',
    chemicalGroup: (s.chemicalGroup as PackageSample['chemicalGroup']) ?? 'ungrouped',
    weathering: (s.weathering as PackageSample['weathering']) ?? 'W1',
    fallOrFind: (s.fallOrFind as PackageSample['fallOrFind']) ?? 'find',
    storage: (s.storage as StorageLocation) ?? 'cabinet-a',
    note: typeof s.note === 'string' ? s.note : undefined,
    // 旧数据没有版本戳的按初次入库补齐
    version: typeof s.version === 'number' && s.version > 0 ? Math.trunc(s.version) : 1,
  };
}

function normalizeFind(raw: unknown): PackageFind {
  if (!isRecord(raw)) throw new InvalidPackageError('finds 中存在非对象条目');
  const f = raw as Partial<PackageFind>;
  return {
    sampleId: String(f.sampleId ?? ''),
    placeName: String(f.placeName ?? ''),
    region: String(f.region ?? ''),
    longitude: num(f.longitude),
    latitude: num(f.latitude),
    coordinateSource: (f.coordinateSource as PackageFind['coordinateSource']) ?? 'gps',
    environment: (f.environment as PackageFind['environment']) ?? 'desert',
    finder: String(f.finder ?? '未署名'),
    ...(typeof f.sampleVersion === 'number' ? { sampleVersion: f.sampleVersion } : {}),
  };
}

function normalizeSection(raw: unknown): PackageSection {
  if (!isRecord(raw)) throw new InvalidPackageError('sections 中存在非对象条目');
  const s = raw as Partial<PackageSection>;
  return {
    sectionNo: String(s.sectionNo ?? ''),
    sampleId: String(s.sampleId ?? ''),
    thickness: num(s.thickness, 30),
    preparation: (s.preparation as PackageSection['preparation']) ?? 'resin',
    minerals: isRecord(s.minerals)
      ? {
          olivine: num(s.minerals.olivine),
          pyroxene: num(s.minerals.pyroxene),
          feldspar: num(s.minerals.feldspar),
          metal: num(s.minerals.metal),
        }
      : { olivine: 0, pyroxene: 0, feldspar: 0, metal: 0 },
    micrographs: Array.isArray(s.micrographs) ? s.micrographs.map(String) : [],
    quality: (s.quality as PackageSection['quality']) ?? 'unrated',
    ...(typeof s.sampleVersion === 'number' ? { sampleVersion: s.sampleVersion } : {}),
  };
}

function normalizeAnalysis(raw: unknown): PackageAnalysis {
  if (!isRecord(raw)) throw new InvalidPackageError('analysis 中存在非对象条目');
  const a = raw as Partial<PackageAnalysis>;
  return {
    sampleId: String(a.sampleId ?? ''),
    target: (a.target as PackageAnalysis['target']) ?? 'sample',
    method: (a.method as PackageAnalysis['method']) ?? 'microprobe',
    fa: num(a.fa),
    fs: num(a.fs),
    ni: num(a.ni),
    kamaciteBandwidth: num(a.kamaciteBandwidth),
    testedAt: String(a.testedAt ?? new Date().toISOString().slice(0, 10)),
    ...(a.sectionId ? { sectionId: String(a.sectionId) } : {}),
    ...(typeof a.sampleVersion === 'number' ? { sampleVersion: a.sampleVersion } : {}),
  };
}
