import type { SampleCategory } from '../types/sample';

/** 重量格式化：>=1000g 显示 kg */
export function formatWeight(grams: number): string {
  const g = Number(grams) || 0;
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`;
  return `${g.toFixed(1)} g`;
}

/** 简单日期格式化 */
export function formatDate(value: number | string): string {
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 数值保留小数位，空值统一显示为短横线 */
export function formatNumber(value: number | undefined | null, digits = 2, unit = ''): string {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}${unit}`;
}

/** 分类配色（用于徽标与地图点着色） */
export function categoryColor(category: SampleCategory): string {
  switch (category) {
    case 'chondrite':
      return '#8d6e63';
    case 'iron':
      return '#455a64';
    case 'stony-iron':
      return '#b08d57';
    case 'achondrite':
      return '#7e57c2';
    default:
      return '#757575';
  }
}

/** 截断长文本 */
export function truncate(text: string, max = 48): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
