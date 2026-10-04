import type { ClassificationAdvice } from './sample';

/** 检测方法 */
export type AnalysisMethod = 'microprobe' | 'sem-eds';

/** 检测对象类型 */
export type AnalysisTarget = 'sample' | 'section';

/** 分析检测结果（AnalysisRecord） */
export interface AnalysisRecord {
  id: string;
  /** 关联样本 id */
  sampleId: string;
  /** 关联切片 id（检测对象为切片时填写） */
  sectionId?: string;
  target: AnalysisTarget;
  method: AnalysisMethod;
  /** 橄榄石 Fa 值（mol%） */
  fa: number;
  /** 辉石 Fs 值（mol%） */
  fs: number;
  /** Ni 含量 wt% */
  ni: number;
  /** 铁纹石带宽 mm */
  kamaciteBandwidth: number;
  /** 检测日期 YYYY-MM-DD */
  testedAt: string;
  createdAt: number;
}

export const ANALYSIS_METHOD_LABELS: Record<AnalysisMethod, string> = {
  microprobe: '电子探针',
  'sem-eds': 'SEM-EDS',
};

export const ANALYSIS_TARGET_LABELS: Record<AnalysisTarget, string> = {
  sample: '样本',
  section: '切片',
};

export const ANALYSIS_METHODS: AnalysisMethod[] = ['microprobe', 'sem-eds'];
export const ANALYSIS_TARGETS: AnalysisTarget[] = ['sample', 'section'];

/** 阈值定义：用于分类建议与命中说明 */
export interface AnalysisThreshold {
  key: 'fa' | 'fs' | 'ni' | 'kamaciteBandwidth';
  label: string;
  min: number;
  max: number;
  unit: string;
  description: string;
}

export const ANALYSIS_THRESHOLDS: AnalysisThreshold[] = [
  { key: 'fa', label: '橄榄石 Fa', min: 0, max: 30, unit: 'mol%', description: '普通球粒陨石橄榄石 Fa 通常 0–30 mol%，超出应考虑无球粒或铁陨石' },
  { key: 'fs', label: '辉石 Fs', min: 0, max: 30, unit: 'mol%', description: '辉石 Fs 与 Fa 差值过大提示非平衡或混合样品' },
  { key: 'ni', label: 'Ni', min: 0, max: 20, unit: 'wt%', description: '铁陨石 Ni 多在 5–20 wt%，石陨石通常低于 1 wt%' },
  { key: 'kamaciteBandwidth', label: '铁纹石带宽', min: 0, max: 2, unit: 'mm', description: '带宽 > 0.5 mm 偏粗粒八面体铁陨石，< 0.2 mm 偏六面体' },
];

/** 阈值命中说明 */
export interface ThresholdHit {
  key: AnalysisThreshold['key'];
  label: string;
  value: number;
  unit: string;
  inRange: boolean;
  description: string;
}

/** 单条检测记录的评估结果 */
export interface AnalysisEvaluation {
  hits: ThresholdHit[];
  advice: ClassificationAdvice;
}

/** 生成一条空检测记录骨架 */
export function emptyAnalysisDraft(sampleId: string): Omit<AnalysisRecord, 'id' | 'createdAt'> {
  return {
    sampleId,
    target: 'sample',
    method: 'microprobe',
    fa: 0,
    fs: 0,
    ni: 0,
    kamaciteBandwidth: 0,
    testedAt: new Date().toISOString().slice(0, 10),
  };
}
