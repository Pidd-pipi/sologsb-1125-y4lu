import { ANALYSIS_THRESHOLDS, type AnalysisRecord, type ThresholdHit } from '../types/analysis';
import type { ClassificationAdvice, SampleCategory } from '../types/sample';

/** 依据 Fa / Fs / Ni 与铁纹石带宽给出分类建议与置信说明 */
export function classifyByAnalysis(
  input: Pick<AnalysisRecord, 'fa' | 'fs' | 'ni' | 'kamaciteBandwidth'>,
): ClassificationAdvice {
  const { fa, fs, ni, kamaciteBandwidth } = input;
  const hits: string[] = [];
  let category: SampleCategory = 'chondrite';
  let confidence: ClassificationAdvice['confidence'] = 'low';

  const highNi = Number(ni) >= 5;
  const lowNi = Number(ni) < 1;
  const wideBand = Number(kamaciteBandwidth) >= 0.5;
  const narrowBand = Number(kamaciteBandwidth) > 0 && Number(kamaciteBandwidth) < 0.2;
  const moderateFa = Number(fa) >= 15 && Number(fa) <= 30;
  const lowFa = Number(fa) < 12;
  const fsFaGap = Math.abs(Number(fs) - Number(fa));

  if (highNi && wideBand) {
    category = 'iron';
    confidence = 'high';
    hits.push(`Ni ${ni} wt% ≥ 5 wt%，落入铁陨石常见区间`);
    hits.push(`铁纹石带宽 ${kamaciteBandwidth} mm ≥ 0.5 mm，指示粗粒八面体结构`);
  } else if (highNi && narrowBand) {
    category = 'iron';
    confidence = 'medium';
    hits.push(`Ni ${ni} wt% 偏高，但铁纹石带宽 ${kamaciteBandwidth} mm < 0.2 mm，偏六面体铁陨石`);
  } else if (highNi && !wideBand && !narrowBand) {
    category = 'stony-iron';
    confidence = 'medium';
    hits.push(`Ni ${ni} wt% 高且金属占比可观，倾向石铁陨石过渡类型`);
  } else if (moderateFa && !highNi) {
    category = 'chondrite';
    confidence = 'high';
    hits.push(`橄榄石 Fa ${fa} mol% 落在 15–30 mol% 的普通球粒区间`);
    if (lowNi) hits.push(`Ni ${ni} wt% < 1 wt%，符合石陨石特征`);
  } else if (lowFa && !highNi) {
    category = 'achondrite';
    confidence = fsFaGap > 8 ? 'medium' : 'low';
    hits.push(`橄榄石 Fa ${fa} mol% 偏低，普通球粒特征不足`);
    if (fsFaGap > 8) hits.push(`辉石 Fs 与 Fa 差值 ${fsFaGap.toFixed(1)} mol%，指示非平衡或混合样品`);
  } else {
    category = 'chondrite';
    confidence = 'low';
    hits.push('数值处在判别边界，建议补测 Ni 与金属相后再判定');
  }

  const summary =
    confidence === 'high'
      ? `建议归类为${labelOf(category)}，判据充分。`
      : confidence === 'medium'
        ? `倾向${labelOf(category)}，仍有一项判据不典型，建议复核。`
        : `暂按${labelOf(category)}记录，判据不足，需补测。`;

  return { category, confidence, summary, hits };
}

function labelOf(category: SampleCategory): string {
  switch (category) {
    case 'chondrite':
      return '球粒陨石';
    case 'iron':
      return '铁陨石';
    case 'stony-iron':
      return '石铁陨石';
    case 'achondrite':
      return '无球粒陨石';
    default:
      return '未定';
  }
}

/** 逐项计算阈值命中情况，供页面展示命中说明 */
export function evaluateThresholds(
  input: Pick<AnalysisRecord, 'fa' | 'fs' | 'ni' | 'kamaciteBandwidth'>,
): ThresholdHit[] {
  return ANALYSIS_THRESHOLDS.map((t) => {
    const value = Number(input[t.key]) || 0;
    return {
      key: t.key,
      label: t.label,
      value,
      unit: t.unit,
      inRange: value >= t.min && value <= t.max,
      description: t.description,
    };
  });
}
