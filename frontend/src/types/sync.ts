import type { FindRecord } from './find';
import type { AnalysisRecord } from './analysis';
import type { MeteoriteSample, StorageLocation } from './sample';
import type { ThinSection } from './section';

/** 离线样本包：编目台之间离线交换的 JSON 结构 */
export interface SamplePackage {
  /** 固定标识，校验用 */
  format: 'gbmeteorite-package';
  /** 包版本，当前 1 */
  packageVersion: 1;
  /** 导出台 / 备注 */
  exportedFrom?: string;
  exportedAt: number;
  samples: PackageSample[];
  finds: PackageFind[];
  sections: PackageSection[];
  analysis: PackageAnalysis[];
}

export type PackageSample = Omit<
  MeteoriteSample,
  'id' | 'createdAt' | 'updatedAt' | 'status' | 'conflictId' | 'adviceSnapshot' | 'occupancySnapshot'
> & {
  /** 包内引用 id：子记录（find/section/analysis）用它指向所属样本 */
  refId: string;
};
export type PackageFind = Omit<FindRecord, 'id' | 'createdAt' | 'status' | 'conflictId'>;
export type PackageSection = Omit<ThinSection, 'id' | 'createdAt'>;
export type PackageAnalysis = Omit<AnalysisRecord, 'id' | 'createdAt'>;

/** 冲突裁决方 */
export type ConflictSide = 'local' | 'incoming';

/** 冲突单：同编号重量 / 发现地 / 存放位置不一致时保留两条待裁决 */
export interface ConflictRecord {
  id: string;
  sampleNo: string;
  /** 本机在档（已被转 pending 的原记录）样本 id */
  localSampleId: string;
  /** 包内副本（pending）样本 id */
  incomingSampleId: string;
  /** 重量 / 发现地 / 存放位置等不一致项 */
  diffs: ConflictDiff[];
  /** 首次发现时间 */
  createdAt: number;
  status: 'open' | 'resolved';
  /** 裁决结果 */
  resolution?: {
    winner: ConflictSide;
    resolvedAt: number;
    /** 裁决时所在标签页会话 id */
    sessionId: string;
    /** 裁决后样本 id（指向获胜样本） */
    winningSampleId: string;
  };
}

/** 单个不一致项描述 */
export interface ConflictDiff {
  field: 'totalWeight' | 'findLocation' | 'storage';
  label: string;
  local: string;
  incoming: string;
}

/** 入库失败原因 */
export type ImportFailureReason =
  | 'capacity'
  | 'duplicate-conflict'
  | 'invalid-entry'
  | 'invalid-package';

/** 失败包记录：可修正后重试 */
export interface ImportFailure {
  id: string;
  packageName: string;
  reason: ImportFailureReason;
  message: string;
  /** 失败的单条入站数据（整包非法时为空数组） */
  samples: PackageSample[];
  finds: PackageFind[];
  sections: PackageSection[];
  analysis: PackageAnalysis[];
  /** 关联冲突单（duplicate-conflict） */
  conflictId?: string;
  /** 重试时用户选择的目标柜位（容量不足可换柜位） */
  retryStorage?: StorageLocation;
  createdAt: number;
  retriedAt?: number;
}

/** 一次并库的执行结果 */
export interface MergeResult {
  mergedSamples: number;
  mergedFinds: number;
  mergedSections: number;
  mergedAnalysis: number;
  conflicts: number;
  rejected: number;
  stale: number;
}

export const IMPORT_FAILURE_LABELS: Record<ImportFailureReason, string> = {
  capacity: '柜架容量不足',
  'duplicate-conflict': '已有同编号冲突待裁决',
  'invalid-entry': '条目数据不合法',
  'invalid-package': '样本包格式不合法',
};
