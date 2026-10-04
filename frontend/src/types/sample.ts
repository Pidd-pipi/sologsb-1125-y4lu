/** 陨石分类：球粒陨石 / 铁陨石 / 石铁陨石 / 无球粒陨石 */
export type SampleCategory = 'chondrite' | 'iron' | 'stony-iron' | 'achondrite';

/** 化学群：普通球粒 H/L/LL 与铁陨石 IAB；未知时用 ungrouped */
export type ChemicalGroup = 'H' | 'L' | 'LL' | 'IAB' | 'ungrouped';

/** 风化等级 W0（新鲜）→ W4（严重风化） */
export type WeatheringGrade = 'W0' | 'W1' | 'W2' | 'W3' | 'W4';

/** 发现或坠落标记 */
export type FallOrFind = 'fall' | 'find';

/** 存放位置 */
export type StorageLocation = 'cabinet-a' | 'cabinet-b' | 'desiccator' | 'loan-out';

/** 在档状态：active 正常；pending 为冲突待裁决副本（不进总览与地图） */
export type SampleStatus = 'active' | 'pending';

/** 分类建议快照：重量变化即失效，立即重算 */
export interface AdviceSnapshot {
  /** 依据：最新检测记录 / 按登记分类兜底 / 暂无数据 */
  basis: 'analysis' | 'default' | 'none';
  category: SampleCategory;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  hits: string[];
  /** 作为依据的检测记录 id（basis=analysis 时） */
  analysisId?: string;
  /** 快照所依据的样本重量（g），与当前重量不一致即视为失效 */
  weightBasis: number;
  computedAt: number;
}

/** 柜架占用快照：记录重量落位时的柜位与重量 */
export interface OccupancySnapshot {
  storage: StorageLocation;
  weight: number;
  computedAt: number;
}

/** 陨石样本（MeteoriteSample） */
export interface MeteoriteSample {
  id: string;
  /** 样本编号，形如 MET-2024-001 */
  sampleNo: string;
  /** 总重量，单位 g */
  totalWeight: number;
  category: SampleCategory;
  chemicalGroup: ChemicalGroup;
  weathering: WeatheringGrade;
  fallOrFind: FallOrFind;
  storage: StorageLocation;
  /** 备注（可选） */
  note?: string;
  createdAt: number;
  /** v3 升级迁移新增字段 */
  updatedAt: number;
  /** 版本戳：每次内容修订 / 裁决自增；v4 迁移旧数据按初次入库补 1 */
  version: number;
  /** v4：在档状态 */
  status: SampleStatus;
  /** pending 副本所属冲突单 id */
  conflictId?: string;
  /** 派生数据：分类建议快照（重量一变即失效重算） */
  adviceSnapshot?: AdviceSnapshot | null;
  /** 派生数据：柜架占用快照 */
  occupancySnapshot?: OccupancySnapshot | null;
}

export const CATEGORY_LABELS: Record<SampleCategory, string> = {
  chondrite: '球粒陨石',
  iron: '铁陨石',
  'stony-iron': '石铁陨石',
  achondrite: '无球粒陨石',
};

export const CHEMICAL_GROUP_LABELS: Record<ChemicalGroup, string> = {
  H: 'H（高铁）',
  L: 'L（低铁）',
  LL: 'LL（低铁低金属）',
  IAB: 'IAB（铁陨石群）',
  ungrouped: '未分群',
};

export const WEATHERING_LABELS: Record<WeatheringGrade, string> = {
  W0: 'W0 新鲜',
  W1: 'W1 轻微',
  W2: 'W2 中等',
  W3: 'W3 明显',
  W4: 'W4 严重',
};

export const FALL_OR_FIND_LABELS: Record<FallOrFind, string> = {
  fall: '目击坠落',
  find: '发现',
};

export const STORAGE_LABELS: Record<StorageLocation, string> = {
  'cabinet-a': 'A 柜 · 干燥剂箱',
  'cabinet-b': 'B 柜 · 常温架',
  desiccator: '真空干燥器',
  'loan-out': '外借中',
};

/**
 * 柜架容量上限（g）。undefined 表示不计容量（外借中不占柜）。
 * 入库前校验，不足时拒绝入库并保留原柜位。
 */
export const STORAGE_CAPACITY: Partial<Record<StorageLocation, number>> = {
  'cabinet-a': 10000,
  'cabinet-b': 12000,
  desiccator: 2000,
  'loan-out': undefined,
};

export const SAMPLE_CATEGORIES: SampleCategory[] = ['chondrite', 'iron', 'stony-iron', 'achondrite'];
export const CHEMICAL_GROUPS: ChemicalGroup[] = ['H', 'L', 'LL', 'IAB', 'ungrouped'];
export const WEATHERING_GRADES: WeatheringGrade[] = ['W0', 'W1', 'W2', 'W3', 'W4'];
export const FALL_OR_FINDS: FallOrFind[] = ['fall', 'find'];
export const STORAGE_LOCATIONS: StorageLocation[] = ['cabinet-a', 'cabinet-b', 'desiccator', 'loan-out'];

/** 分类建议结果 */
export interface ClassificationAdvice {
  category: SampleCategory;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  hits: string[];
}

/** 样本编号生成：MET-<年>-<三位序号> */
export function generateSampleNo(year: number, seq: number): string {
  return `MET-${year}-${String(seq).padStart(3, '0')}`;
}
