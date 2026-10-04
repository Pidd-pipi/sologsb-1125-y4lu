import { useMemo } from 'react';
import { useSampleStore } from '../stores/sampleStore';
import type { SampleCategory } from '../types/sample';

export interface RegionStat {
  region: string;
  sampleCount: number;
  totalWeight: number;
  categories: Record<string, number>;
  points: { sampleId: string; longitude: number; latitude: number; category: SampleCategory }[];
}

/** 按国家地区聚合样本数与总重量，被 /locations 消费 */
export function useRegionStats() {
  const finds = useSampleStore((s) => s.finds);
  const samples = useSampleStore((s) => s.samples);

  return useMemo(() => {
    const activeSamples = samples.filter((s) => s.status !== 'pending');
    const sampleMap = new Map(activeSamples.map((s) => [s.id, s]));
    const map = new Map<string, RegionStat>();
    // 待裁决副本及其发现地不在地图打点
    for (const f of finds.filter((f) => f.status !== 'pending')) {
      const sample = sampleMap.get(f.sampleId);
      const region = f.region?.trim() || '未标注地区';
      const entry =
        map.get(region) ??
        ({ region, sampleCount: 0, totalWeight: 0, categories: {}, points: [] } as RegionStat);
      entry.sampleCount += 1;
      entry.totalWeight += sample?.totalWeight ?? 0;
      if (sample) {
        entry.categories[sample.category] = (entry.categories[sample.category] ?? 0) + 1;
        entry.points.push({
          sampleId: sample.id,
          longitude: f.longitude,
          latitude: f.latitude,
          category: sample.category,
        });
      }
      map.set(region, entry);
    }
    const stats = Array.from(map.values()).sort((a, b) => b.sampleCount - a.sampleCount);
    const totalSamples = stats.reduce((n, s) => n + s.sampleCount, 0);
    const totalWeight = stats.reduce((n, s) => n + s.totalWeight, 0);
    const maxCount = stats.length ? Math.max(...stats.map((s) => s.sampleCount)) : 0;
    return { stats, totalSamples, totalWeight, maxCount };
  }, [finds, samples]);
}
