// 矩形（贴片）领域模型与工具函数
// 坐标系：row 自上而下 0..height-1，col 自左而右 0..width-1。
// 「上、左、下、右」分别对应 top、left、bottom、right（含边界）。

export interface Rect {
  top: number;
  left: number;
  bottom: number; // 含
  right: number; // 含
}

export interface GridSize {
  width: number;
  height: number;
}

export const MIN_SIDE = 1;
export const MAX_SIDE = 12;
export const MAX_CRACKS = 60;

export function rectArea(r: Rect): number {
  return (r.bottom - r.top + 1) * (r.right - r.left + 1);
}

/** 整数序列：[上, 左, 下, 右]，字典序比较的基础形式 */
export function rectKey(r: Rect): [number, number, number, number] {
  return [r.top, r.left, r.bottom, r.right];
}

/** 方案内部排序：按 [上,左,下,右] 字典序 */
export function sortRects(rects: Rect[]): Rect[] {
  return [...rects].sort((a, b) => {
    const ka = rectKey(a);
    const kb = rectKey(b);
    for (let i = 0; i < 4; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
}

/** 把方案展平为整数序列：各矩形 [上,左,下,右] 依次拼接（方案已内部排序） */
export function flattenPlan(rects: Rect[]): number[] {
  const sorted = sortRects(rects);
  const out: number[] = [];
  for (const r of sorted) {
    out.push(r.top, r.left, r.bottom, r.right);
  }
  return out;
}

/**
 * 两个整数序列的字典序比较：
 * 返回负数表示 a < b，0 表示相等，正数表示 a > b。
 * 长度相同时即经典字典序；长度不同时前缀较短者更小（本问题并列方案贴片数相同，长度必然相等）。
 */
export function compareIntSeq(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** 把矩形集合编码为单元格索引集合，便于测试与校验 */
export function rectCells(r: Rect): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let row = r.top; row <= r.bottom; row++) {
    for (let col = r.left; col <= r.right; col++) {
      cells.push([row, col]);
    }
  }
  return cells;
}

/** 校验一组矩形是否：互不重叠、并集恰为给定裂格集合 */
export function validateTiling(rects: Rect[], cracks: Set<number>, width: number, height: number): boolean {
  const covered = new Set<number>();
  for (const r of rects) {
    if (
      r.top < 0 || r.left < 0 || r.bottom >= height || r.right >= width ||
      r.top > r.bottom || r.left > r.right
    ) {
      return false;
    }
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) {
        const idx = row * width + col;
        if (!cracks.has(idx)) return false; // 压住完好格
        if (covered.has(idx)) return false; // 贴片重叠
        covered.add(idx);
      }
    }
  }
  if (covered.size !== cracks.size) return false; // 未覆盖全部裂格
  for (const idx of cracks) {
    if (!covered.has(idx)) return false;
  }
  return true;
}

/** 人类可读的坐标标签，如 (上2,左1)-(下3,右4) */
export function rectLabel(r: Rect): string {
  return `(上${r.top},左${r.left})–(下${r.bottom},右${r.right})`;
}
