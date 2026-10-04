import type { AnalysisRecord } from './analysis';
import type { FindRecord } from './find';
import type { MeteoriteSample, StorageLocation } from './sample';
import type { ThinSection } from './section';

/** 离线样本包：编目台离线带回、跨机导出导入的唯一载体 */
export interface SamplePackage {
  /** 固定格式标识，用于入库前结构校验 */
  kind: 'gbmeteorite-sample-package';
  /** 包结构版本 */
  pkgVersion: 1;
  /** 来源编目台标识，用于区分同编号记录来自哪台机器 */
  stationId: string;
  exportedAt: number;
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
}

/** 冲突字段：同编号样本重量、发现地或存放位置不一致 */
export type ConflictField = 'totalWeight' | 'find' | 'storage';

/** 冲突单状态 */
export type ConflictStatus = 'pending' | 'resolved';

/** 冲突裁决结果 */
export type ConflictResolution = 'keep-local' | 'keep-incoming';

/**
 * 对账冲突单：同样本编号、版本戳不同且
 * 重量 / 发现地 / 存放位置至少一项不一致时生成，两条样本都挂起待裁决。
 */
export interface ConflictRecord {
  id: string;
  /** 样本编号（冲突对账键） */
  sampleNo: string;
  status: ConflictStatus;
  /** 不一致字段清单 */
  fields: ConflictField[];
  /** 本机侧样本快照（裁决时以库内实时状态复核，不用快照直接覆盖） */
  localSampleId: string;
  /** 离线侧样本快照 */
  incomingSampleId: string;
  localSnapshot: MeteoriteSample;
  incomingSnapshot: MeteoriteSample;
  localFind: FindRecord | null;
  incomingFind: FindRecord | null;
  /** 来源离线包标识 */
  stationId: string;
  createdAt: number;
  resolvedAt?: number;
  resolution?: ConflictResolution;
  /** 裁决时复核用的库内版本戳，防止后确认页覆盖先确认结果 */
  localVersion?: number;
  incomingVersion?: number;
}

/** 失败包状态：容量不足等原因整包未入库，修正后可重试 */
export type ImportBatchStatus = 'failed' | 'succeeded';

/** 失败样本包：容量不足拒绝入库后原样保留，改柜位 / 重量后重试 */
export interface ImportBatch {
  id: string;
  fileName: string;
  stationId: string;
  status: ImportBatchStatus;
  /** 原始包 JSON（结构损坏无法解析时为空，需重新上传修正后的文件） */
  payload?: SamplePackage;
  /** 拒绝原因（按样本编号给出，如柜架超重明细） */
  reasons: string[];
  createdAt: number;
  updatedAt: number;
  succeededAt?: number;
}

/** 柜架占用快照 */
export interface StorageOccupancy {
  storage: StorageLocation;
  /** 占用重量 g（待裁决样本不计入） */
  usedGrams: number;
  /** 容量上限 g；null 表示不限（外借） */
  capacityGrams: number | null;
  sampleCount: number;
}

/** 合并计划动作为 keep（单边/并子记录）、fast-forward（高版本同关键值）或 conflict（待裁决） */
export type MergeActionType = 'add-local' | 'add-incoming' | 'keep' | 'fast-forward' | 'conflict';

/** 单条样本对账结论（纯函数产物，供执行器与预览 UI 共用） */
export interface MergePlanItem {
  sampleNo: string;
  action: MergeActionType;
  /** action 对应的样本记录（add-incoming/keep/fast-forward/conflict 时为离线侧） */
  incoming?: MeteoriteSample;
  local?: MeteoriteSample;
  /** conflict 时不一致字段 */
  fields?: ConflictField[];
  /** 该样本携带的切片 / 分析 / 发现地（离线侧） */
  incomingSections: ThinSection[];
  incomingAnalysis: AnalysisRecord[];
  incomingFind: FindRecord | null;
}

/** 整份离线包的对账计划 */
export interface MergePlan {
  items: MergePlanItem[];
  /** 直接并库（单边新增）条数 */
  directAddCount: number;
  /** 子记录合并条数（同编号已有样本上补本机没有的切片 / 分析） */
  childMergeCount: number;
  /** 待裁决条数 */
  conflictCount: number;
  /** 高版本同关键值直接跟进条数 */
  fastForwardCount: number;
  /** 容量拒绝明细（按样本编号）；非空时整包拒绝、原柜位不动 */
  capacityRejections: CapacityRejection[];
}

/** 容量不足拒绝明细 */
export interface CapacityRejection {
  sampleNo: string;
  storage: StorageLocation;
  /** 该动作预计占用后重量 */
  wouldUseGrams: number;
  capacityGrams: number | null;
  /** 超重克数 */
  overflowGrams: number;
  message: string;
}
