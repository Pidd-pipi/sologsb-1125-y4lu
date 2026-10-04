import { isValidLatitude, isValidLongitude } from '../types/find';

export interface GeoPoint {
  longitude: number;
  latitude: number;
}

/** 经纬度范围校验，返回错误信息（无错误返回 null） */
export function validateCoordinate(lng: number, lat: number): string | null {
  if (Number.isNaN(Number(lng)) || Number.isNaN(Number(lat))) return '经纬度必须是数字';
  if (!isValidLongitude(Number(lng))) return '经度需在 -180 ~ 180 之间';
  if (!isValidLatitude(Number(lat))) return '纬度需在 -90 ~ 90 之间';
  return null;
}

/** 经纬度 → SVG 网格坐标（等距圆柱投影，网格 0~100） */
export function projectToGrid(point: GeoPoint, size = 100): { x: number; y: number } {
  const x = ((Number(point.longitude) + 180) / 360) * size;
  const y = ((90 - Number(point.latitude)) / 180) * size;
  return { x: clamp(x, 0, size), y: clamp(y, 0, size) };
}

/** 反向：网格坐标 → 经纬度 */
export function unprojectFromGrid(x: number, y: number, size = 100): GeoPoint {
  const longitude = (clamp(x, 0, size) / size) * 360 - 180;
  const latitude = 90 - (clamp(y, 0, size) / size) * 180;
  return { longitude: round(longitude, 2), latitude: round(latitude, 2) };
}

/** 两点球面距离（km），用于邻近样本提示 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))), 1);
}

/** 生成用于 SVG 网格的经纬参考线位置（每 30°） */
export function graticuleLines(size = 100, step = 30): { vertical: number[]; horizontal: number[] } {
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (let lng = -180; lng <= 180; lng += step) {
    vertical.push(((lng + 180) / 360) * size);
  }
  for (let lat = -90; lat <= 90; lat += step) {
    horizontal.push(((90 - lat) / 180) * size);
  }
  return { vertical, horizontal };
}

/** 经纬度文本显示 */
export function formatCoordinate(lng: number, lat: number): string {
  return `${Math.abs(Number(lat)).toFixed(2)}°${Number(lat) >= 0 ? 'N' : 'S'} ${Math.abs(
    Number(lng),
  ).toFixed(2)}°${Number(lng) >= 0 ? 'E' : 'W'}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
