import type { AnalysisRecord } from '../types/analysis';
import type { ClassificationAdvice, MeteoriteSample } from '../types/sample';
import { classifyByAnalysis } from './classify';

/**
 * 切片 / 分析记录跟随所属样本版本：
 * 样本重量一变，版本戳 +1，挂在旧版本戳上的分类建议立即失效，
 * 页面必须基于当前版本重新计算，而不是沿用记录上的旧结论。
 */
export function isRecordCurrent(record: { sampleVersion?: number }, sample: MeteoriteSample | undefined): boolean {
  if (!sample) return false;
  return (record.sampleVersion ?? 1) >= sample.version;
}

/** 分析记录相对所属样本是否已失效（旧版本上的检测结论） */
export function isAnalysisStale(
  record: Pick<AnalysisRecord, 'sampleVersion'>,
  sample: MeteoriteSample | undefined,
): boolean {
  return !isRecordCurrent(record, sample);
}

/**
 * 始终按传入的最新检测值即时重算分类建议（不在任何地方持久化结论）。
 * 重量 / 版本变化后，UI 重新调用本函数即得到重算结果。
 */
export function recomputeAdvice(
  input: Pick<AnalysisRecord, 'fa' | 'fs' | 'ni' | 'kamaciteBandwidth'>,
): ClassificationAdvice {
  return classifyByAnalysis(input);
}

/** 失效提示文案 */
export function staleAdviceNote(record: { sampleVersion?: number }, sample: MeteoriteSample | undefined): string {
  if (!sample) return '关联样本已不在库中，结论不可用';
  return `该检测跟随样本 v${record.sampleVersion ?? 1}，样本已变更至 v${sample.version}，分类建议已失效，请以当前版本重算`;
}
