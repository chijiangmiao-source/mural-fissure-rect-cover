import { describe, expect, it } from 'vitest';
import {
  compareIntSeq,
  flattenPlan,
  rectCells,
  rectLabel,
  sortRects,
  validateTiling,
  type Rect,
} from '../src/lib/rect';

describe('rect 工具', () => {
  it('rectCells 枚举矩形内全部格', () => {
    const r: Rect = { top: 1, left: 2, bottom: 2, right: 3 };
    expect(rectCells(r)).toEqual([
      [1, 2], [1, 3],
      [2, 2], [2, 3],
    ]);
  });

  it('sortRects 按 [上,左,下,右] 排序', () => {
    const a: Rect = { top: 1, left: 0, bottom: 1, right: 1 };
    const b: Rect = { top: 0, left: 2, bottom: 0, right: 2 };
    const c: Rect = { top: 1, left: 0, bottom: 1, right: 0 };
    const sorted = sortRects([a, b, c]);
    // 先按 top：b(0) 最先；同 top=1 时 left 相同再比 bottom/right
    expect(flattenPlan(sorted)).toEqual([
      0, 2, 0, 2,
      1, 0, 1, 0,
      1, 0, 1, 1,
    ]);
  });

  it('compareIntSeq 为经典字典序', () => {
    expect(compareIntSeq([0, 0, 0, 0], [0, 0, 1, 0])).toBeLessThan(0);
    expect(compareIntSeq([1, 2], [1, 2])).toBe(0);
    expect(compareIntSeq([1, 2, 3], [1, 2])).toBeGreaterThan(0);
  });

  it('flattenPlan 先内部排序再展平', () => {
    const a: Rect = { top: 1, left: 1, bottom: 1, right: 1 };
    const b: Rect = { top: 0, left: 0, bottom: 0, right: 0 };
    expect(flattenPlan([a, b])).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it('rectLabel 人类可读', () => {
    expect(rectLabel({ top: 2, left: 1, bottom: 3, right: 4 }))
      .toBe('(上2,左1)–(下3,右4)');
  });
});

describe('validateTiling', () => {
  const w = 3;
  const h = 3;
  const idx = (r: number, c: number) => r * w + c;

  it('合法铺法通过', () => {
    const cracks = new Set([idx(0, 0), idx(0, 1), idx(1, 0), idx(1, 1)]);
    const rects: Rect[] = [{ top: 0, left: 0, bottom: 1, right: 1 }];
    expect(validateTiling(rects, cracks, w, h)).toBe(true);
  });

  it('压住完好格不通过', () => {
    const cracks = new Set([idx(0, 0), idx(0, 1)]);
    const rects: Rect[] = [{ top: 0, left: 0, bottom: 1, right: 1 }];
    expect(validateTiling(rects, cracks, w, h)).toBe(false);
  });

  it('贴片重叠不通过', () => {
    const cracks = new Set([idx(0, 0), idx(0, 1), idx(1, 0), idx(1, 1)]);
    const rects: Rect[] = [
      { top: 0, left: 0, bottom: 1, right: 1 },
      { top: 0, left: 0, bottom: 0, right: 0 },
    ];
    expect(validateTiling(rects, cracks, w, h)).toBe(false);
  });

  it('未覆盖全部裂格不通过', () => {
    const cracks = new Set([idx(0, 0), idx(2, 2)]);
    const rects: Rect[] = [{ top: 0, left: 0, bottom: 0, right: 0 }];
    expect(validateTiling(rects, cracks, w, h)).toBe(false);
  });

  it('越界矩形不通过', () => {
    const cracks = new Set([idx(0, 0)]);
    const rects: Rect[] = [{ top: 0, left: 0, bottom: 3, right: 3 }];
    expect(validateTiling(rects, cracks, w, h)).toBe(false);
  });
});
