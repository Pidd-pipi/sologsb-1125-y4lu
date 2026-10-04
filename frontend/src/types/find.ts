/** 坐标来源 */
export type CoordinateSource = 'gps' | 'literature';

/** 发现环境 */
export type FindEnvironment = 'desert' | 'antarctica' | 'witnessed';

/** 在档状态：pending 为冲突待裁决副本 */
export type FindStatus = 'active' | 'pending';

/** 发现与坠落记录（FindRecord） */
export interface FindRecord {
  id: string;
  /** 关联样本 id */
  sampleId: string;
  /** 发现地名 */
  placeName: string;
  /** 国家 / 地区 */
  region: string;
  /** 经度 -180 ~ 180 */
  longitude: number;
  /** 纬度 -90 ~ 90 */
  latitude: number;
  coordinateSource: CoordinateSource;
  environment: FindEnvironment;
  /** 发现者 */
  finder: string;
  createdAt: number;
  /** v4：跟随所属样本版本戳 */
  sampleVersion?: number;
  /** v4：在档状态 */
  status?: FindStatus;
  /** pending 副本所属冲突单 id */
  conflictId?: string;
}

export const COORDINATE_SOURCE_LABELS: Record<CoordinateSource, string> = {
  gps: 'GPS 实测',
  literature: '文献转抄',
};

export const FIND_ENVIRONMENT_LABELS: Record<FindEnvironment, string> = {
  desert: '沙漠',
  antarctica: '南极冰盖',
  witnessed: '目击陨落',
};

export const COORDINATE_SOURCES: CoordinateSource[] = ['gps', 'literature'];
export const FIND_ENVIRONMENTS: FindEnvironment[] = ['desert', 'antarctica', 'witnessed'];

/** 经纬度合法性校验 */
export function isValidLongitude(v: number): boolean {
  return Number.isFinite(v) && v >= -180 && v <= 180;
}

export function isValidLatitude(v: number): boolean {
  return Number.isFinite(v) && v >= -90 && v <= 90;
}
