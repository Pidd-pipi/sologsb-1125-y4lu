/** 制样方式 */
export type PreparationMethod = 'resin' | 'epoxy';

/** 切片质量标注 */
export type SectionQuality = 'good' | 'fair' | 'poor' | 'unrated';

/** 矿物占比（合计应约等于 100%） */
export interface MineralRatios {
  /** 橄榄石 */
  olivine: number;
  /** 辉石 */
  pyroxene: number;
  /** 长石 */
  feldspar: number;
  /** 金属 */
  metal: number;
}

/** 切片与制样（ThinSection） */
export interface ThinSection {
  id: string;
  /** 切片编号，形如 TS-2024-001 */
  sectionNo: string;
  /** 关联样本 id */
  sampleId: string;
  /** 厚度，单位 μm */
  thickness: number;
  preparation: PreparationMethod;
  minerals: MineralRatios;
  /** 显微照片清单（文件名 / 描述） */
  micrographs: string[];
  quality: SectionQuality;
  createdAt: number;
}

export const PREPARATION_LABELS: Record<PreparationMethod, string> = {
  resin: '树脂包埋',
  epoxy: '环氧粘接',
};

export const SECTION_QUALITY_LABELS: Record<SectionQuality, string> = {
  good: '优（可直接定量）',
  fair: '良（局部可用）',
  poor: '差（仅观察）',
  unrated: '未标注',
};

export const PREPARATIONS: PreparationMethod[] = ['resin', 'epoxy'];
export const SECTION_QUALITIES: SectionQuality[] = ['good', 'fair', 'poor', 'unrated'];

export const MINERAL_KEYS: (keyof MineralRatios)[] = ['olivine', 'pyroxene', 'feldspar', 'metal'];

export const MINERAL_LABELS: Record<keyof MineralRatios, string> = {
  olivine: '橄榄石',
  pyroxene: '辉石',
  feldspar: '长石',
  metal: '金属',
};

/** 矿物占比合计 */
export function mineralTotal(m: MineralRatios): number {
  return MINERAL_KEYS.reduce((sum, k) => sum + (Number(m[k]) || 0), 0);
}
