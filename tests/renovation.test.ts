import { describe, expect, it } from 'vitest';
import { planRenovation } from '../src/lib/renovation';
import { searchOptimalCover } from '../src/lib/solver';
import { bruteForceRenovation } from '../src/lib/bruteforce';
import { flattenPlan, rectId, validateTiling, type Rect } from '../src/lib/rect';

function setFrom(w: number, coords: Array<[number, number]>): Set<number> {
  return new Set(coords.map(([r, c]) => r * w + c));
}

describe('planRenovation 基础场景', () => {
  it('无变化：全部保留，0 操作，最终方案即基线', () => {
    const cracks = setFrom(2, [[0, 0], [0, 1], [1, 0], [1, 1]]);
    const baseline = searchOptimalCover(2, 2, cracks).rects; // 1 块 2×2
    const plan = planRenovation(2, 2, cracks, baseline);
    expect(plan.kept).toEqual(baseline);
    expect(plan.removed).toEqual([]);
    expect(plan.added).toEqual([]);
    expect(plan.operations).toBe(0);
    expect(plan.finalCount).toBe(1);
    expect(plan.truncated).toBe(false);
    expect(validateTiling(plan.rects, cracks, 2, 2)).toBe(true);
  });

  it('扩展：保留整块基线，仅新增 1 块', () => {
    const oldCracks = setFrom(2, [[0, 0], [0, 1], [1, 0], [1, 1]]);
    const baseline = searchOptimalCover(2, 2, oldCracks).rects;
    const now = setFrom(3, [[0, 0], [0, 1], [1, 0], [1, 1], [0, 2]]);
    const plan = planRenovation(3, 2, now, baseline);
    expect(plan.kept).toEqual([{ top: 0, left: 0, bottom: 1, right: 1 }]);
    expect(plan.removed).toEqual([]);
    expect(plan.added).toEqual([{ top: 0, left: 2, bottom: 0, right: 2 }]);
    expect(plan.operations).toBe(1);
    expect(plan.finalCount).toBe(2);
    expect(validateTiling(plan.rects, now, 3, 2)).toBe(true);
  });

  it('愈合：基线块压到完好格必须拆除，剩余裂格重新合法覆盖', () => {
    const oldCracks = setFrom(2, [[0, 0], [0, 1], [1, 0], [1, 1]]);
    const baseline = searchOptimalCover(2, 2, oldCracks).rects;
    const now = setFrom(2, [[0, 0], [0, 1], [1, 0]]); // (1,1) 愈合
    const plan = planRenovation(2, 2, now, baseline);
    expect(plan.kept).toEqual([]);
    expect(plan.removed).toEqual(baseline);
    expect(plan.added.length).toBe(2); // L 形三格需 2 块
    expect(plan.operations).toBe(3);
    expect(validateTiling(plan.rects, now, 2, 2)).toBe(true);
  });

  it('全部愈合：拆除全部基线，最终覆盖为空', () => {
    const oldCracks = setFrom(2, [[0, 0], [0, 1], [1, 0], [1, 1]]);
    const baseline = searchOptimalCover(2, 2, oldCracks).rects;
    const plan = planRenovation(2, 2, new Set(), baseline);
    expect(plan.rects).toEqual([]);
    expect(plan.kept).toEqual([]);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual(baseline);
    expect(plan.operations).toBe(1);
    expect(plan.finalCount).toBe(0);
  });

  it('空基线退化为普通最优覆盖', () => {
    const cracks = setFrom(3, [[0, 0], [0, 1], [0, 2], [1, 1]]);
    const plan = planRenovation(3, 3, cracks, []);
    const optimal = searchOptimalCover(3, 3, cracks);
    expect(plan.kept).toEqual([]);
    expect(plan.removed).toEqual([]);
    expect(plan.operations).toBe(plan.added.length);
    expect(flattenPlan(plan.rects)).toEqual(flattenPlan(optimal.rects));
  });
});

describe('改造目标的三级决胜', () => {
  it('主目标优先：保留 2 块 + 新增 1 块（3 块）优于全拆重铺 1 整块', () => {
    // 基线：两个 1×1（(0,0) 与 (0,2)）；新图样：顶行三格连通。
    // 保留两块 + 新增 (0,1)：操作 1；全拆 + 一条横贯：操作 2+1=3。
    const baseline: Rect[] = [
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 0, left: 2, bottom: 0, right: 2 },
    ];
    const now = setFrom(3, [[0, 0], [0, 1], [0, 2]]);
    const plan = planRenovation(3, 1, now, baseline);
    expect(plan.operations).toBe(1);
    expect(plan.kept.length).toBe(2);
    expect(plan.added).toEqual([{ top: 0, left: 1, bottom: 0, right: 1 }]);
    expect(plan.finalCount).toBe(3); // 主目标优先于最终块数
  });

  it('次目标：操作数并列时取最终贴片总数最少', () => {
    // 基线：1×1 at (0,0)；新图样：2×2 全裂。
    // 保留 (0,0) + 新增 2 块盖 L：操作 2、共 3 块；
    // 拆除 (0,0) + 新增 1 整块 2×2：操作 2、共 1 块 → 取后者。
    const baseline: Rect[] = [{ top: 0, left: 0, bottom: 0, right: 0 }];
    const now = setFrom(2, [[0, 0], [0, 1], [1, 0], [1, 1]]);
    const plan = planRenovation(2, 2, now, baseline);
    expect(plan.operations).toBe(2);
    expect(plan.finalCount).toBe(1);
    expect(plan.kept).toEqual([]);
    expect(plan.removed).toEqual(baseline);
    expect(plan.added).toEqual([{ top: 0, left: 0, bottom: 1, right: 1 }]);
  });

  it('字典序决胜：操作数与块数均并列时取坐标字典序最小（横铺优于竖铺）', () => {
    // 基线：1×1 at (2,2)（已愈合，必拆除）；新图样：L 形三格。
    // 拆 1 + 新增 2：横铺 [[0,0,0,1],[1,0,1,0]] 与竖铺 [[0,0,1,0],[0,1,0,1]] 并列，取横铺。
    const baseline: Rect[] = [{ top: 2, left: 2, bottom: 2, right: 2 }];
    const now = setFrom(3, [[0, 0], [0, 1], [1, 0]]);
    const plan = planRenovation(3, 3, now, baseline);
    expect(plan.operations).toBe(3);
    expect(plan.finalCount).toBe(2);
    expect(flattenPlan(plan.rects)).toEqual([0, 0, 0, 1, 1, 0, 1, 0]);
  });
});

describe('与独立枚举器交叉验证', () => {
  it('随机 3×3 旧/新图样对：操作数、最终方案与保留/拆除/新增分类完全一致', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 200; t++) {
      const oldCoords: Array<[number, number]> = [];
      const newCoords: Array<[number, number]> = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (rand() < 0.5) oldCoords.push([r, c]);
          if (rand() < 0.5) newCoords.push([r, c]);
        }
      }
      if (oldCoords.length === 0) continue; // 基线来自非空旧图样
      const oldCracks = setFrom(3, oldCoords);
      const newCracks = setFrom(3, newCoords);
      const baseline = searchOptimalCover(3, 3, oldCracks).rects;

      const a = planRenovation(3, 3, newCracks, baseline);
      const b = bruteForceRenovation(3, 3, newCracks, baseline);

      expect(validateTiling(a.rects, newCracks, 3, 3)).toBe(true);
      expect(a.operations).toBe(b.operations);
      expect(a.finalCount).toBe(b.finalCount);
      expect(flattenPlan(a.rects)).toEqual(flattenPlan(b.rects));
      expect(flattenPlan(a.kept)).toEqual(flattenPlan(b.kept));
      expect(flattenPlan(a.removed)).toEqual(flattenPlan(b.removed));
      expect(flattenPlan(a.added)).toEqual(flattenPlan(b.added));
      // 不变量：操作数 = 拆除 + 新增；保留 ⊆ 基线；保留 + 新增 = 最终
      expect(a.operations).toBe(a.removed.length + a.added.length);
      expect(a.kept.length + a.added.length).toBe(a.rects.length);
      const baselineIds = new Set(baseline.map((r) => rectId(r)));
      for (const k of a.kept) expect(baselineIds.has(rectId(k))).toBe(true);
    }
  });

  it('确定性：同一输入多次求解逐字节一致', () => {
    const oldCracks = setFrom(4, [[0, 0], [0, 1], [1, 0], [1, 1], [2, 2], [2, 3], [3, 2], [3, 3]]);
    const baseline = searchOptimalCover(4, 4, oldCracks).rects;
    const now = setFrom(4, [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [2, 2], [3, 3]]);
    const runs = Array.from({ length: 5 }, () => planRenovation(4, 4, now, baseline));
    for (let i = 1; i < runs.length; i++) {
      expect(flattenPlan(runs[i].rects)).toEqual(flattenPlan(runs[0].rects));
      expect(runs[i].operations).toBe(runs[0].operations);
    }
  });

  it('截断：状态数上限极小时标记 truncated（界面不得展示）', () => {
    const cracks = setFrom(4, [
      [0, 0], [0, 1], [1, 0], [1, 1],
      [2, 2], [2, 3], [3, 2], [3, 3],
    ]);
    const plan = planRenovation(4, 4, cracks, [], { maxStates: 1 });
    expect(plan.truncated).toBe(true);
  });
});
