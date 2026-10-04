import { useMemo } from 'react';
import type { MeteoriteSample } from '../types/sample';
import { useSampleStore } from '../stores/sampleStore';
import { useUiStore } from '../stores/uiStore';

/**
 * 管理分类、化学群、重量区间与关键词筛选并返回结果集。
 * 被 / 与 /sections 消费。
 */
export function useSampleFilter(override?: Partial<{ category: string; group: string }>) {
  const samples = useSampleStore((s) => s.samples);
  const categories = useUiStore((s) => s.categories);
  const groups = useUiStore((s) => s.groups);
  const minWeight = useUiStore((s) => s.minWeight);
  const maxWeight = useUiStore((s) => s.maxWeight);
  const keyword = useUiStore((s) => s.keyword);
  const sort = useUiStore((s) => s.sort);

  const results = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    // 待裁决样本暂不在样本总览显示，裁决完成后自动恢复
    const list = samples.filter((s) => {
      if (s.pendingConflict) return false;
      if (categories.length && !categories.includes(s.category)) return false;
      if (groups.length && !groups.includes(s.chemicalGroup)) return false;
      if (minWeight !== null && s.totalWeight < minWeight) return false;
      if (maxWeight !== null && s.totalWeight > maxWeight) return false;
      if (override?.category && s.category !== override.category) return false;
      if (override?.group && s.chemicalGroup !== override.group) return false;
      if (kw) {
        const hay = `${s.sampleNo} ${s.note ?? ''}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    return sortSamples(list, sort);
  }, [samples, categories, groups, minWeight, maxWeight, keyword, sort, override?.category, override?.group]);

  return {
    results,
    /** 总览可见样本数（待裁决不计） */
    total: samples.filter((s) => !s.pendingConflict).length,
    activeCount:
      categories.length +
      groups.length +
      (minWeight !== null || maxWeight !== null ? 1 : 0) +
      (keyword.trim() ? 1 : 0),
  };
}

export function sortSamples(list: MeteoriteSample[], sort: string): MeteoriteSample[] {
  const copy = [...list];
  switch (sort) {
    case 'totalWeight':
      return copy.sort((a, b) => b.totalWeight - a.totalWeight);
    case 'sampleNo':
      return copy.sort((a, b) => a.sampleNo.localeCompare(b.sampleNo));
    default:
      return copy.sort((a, b) => b.createdAt - a.createdAt);
  }
}
