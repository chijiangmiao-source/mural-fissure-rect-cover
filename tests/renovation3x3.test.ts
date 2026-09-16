// 验收级测试：以独立枚举器（src/lib/bruteforce.ts，枚举全部精确覆盖后按改造目标评分，
// 与主改造求解 src/lib/renovation.ts 的加权 DFS 完全不同的实现路径）逐一双重核对
// 「全部非空旧图样 × 任意新图样」组成的 3×3 图样对（511 × 512 = 261,632 对）：
//   1. 最终覆盖在当前裂格上合法（只含裂格、互不重叠、并集恰为全部裂格）；
//   2. 主目标（拆除数 + 新增数）一致；
//   3. 唯一结果一致：最终方案、保留 / 拆除 / 新增分类逐坐标相同；
//   4. 无变化图样对（新 = 旧）必须全部保留、0 操作；
// 并统计扩展（旧 ⊂ 新）、愈合（新 ⊂ 旧）、无变化三类场景确实被覆盖。
import { describe, expect, it } from 'vitest';
import { planRenovation } from '../src/lib/renovation';
import { searchOptimalCover } from '../src/lib/solver';
import { enumerateExactCovers, selectRenovationFromCovers } from '../src/lib/bruteforce';
import { flattenPlan, validateTiling, type Rect } from '../src/lib/rect';

const W = 3;
const H = 3;
const N = 9;

function maskToSet(mask: number): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < N; i++) if (mask & (1 << i)) s.add(i);
  return s;
}

describe('3×3 全部「非空旧图样 × 任意新图样」图样对改造验收（511×512）', () => {
  it('改造求解与独立枚举器在全部图样对上完全一致', () => {
    // 预计算每个非空旧图样的最优基线（主搜索引擎，已在 4×4 全域与独立穷举交叉验证，
    // 3×3 图样为其子集）；基线即「当前已求得的加固方案」。
    const baselines = new Map<number, Rect[]>();
    for (let oldMask = 1; oldMask < 1 << N; oldMask++) {
      baselines.set(oldMask, searchOptimalCover(W, H, maskToSet(oldMask), { maxTrace: 0 }).rects);
    }

    let checked = 0;
    let expansion = 0; // 旧 ⊂ 新（严格扩展）
    let healing = 0; // 新 ⊂ 旧（严格愈合）
    let unchanged = 0; // 新 = 旧
    let opsPositive = 0;

    for (let newMask = 0; newMask < 1 << N; newMask++) {
      const newCracks = maskToSet(newMask);
      // 独立枚举器：枚举该新图样的全部精确覆盖（每个新图样只枚举一次）
      const covers = enumerateExactCovers(W, H, newCracks);
      expect(covers.length).toBeGreaterThan(0);
      for (let oldMask = 1; oldMask < 1 << N; oldMask++) {
        const baseline = baselines.get(oldMask)!;
        const expected = selectRenovationFromCovers(covers, baseline);
        const plan = planRenovation(W, H, newCracks, baseline);

        // 1) 最终覆盖合法
        expect(validateTiling(plan.rects, newCracks, W, H)).toBe(true);
        // 2) 主目标一致：拆除数 + 新增数最少
        expect(plan.operations).toBe(expected.operations);
        // 3) 唯一结果一致（最终方案与三类分类逐坐标相同）
        expect(flattenPlan(plan.rects)).toEqual(flattenPlan(expected.rects));
        expect(flattenPlan(plan.kept)).toEqual(flattenPlan(expected.kept));
        expect(flattenPlan(plan.removed)).toEqual(flattenPlan(expected.removed));
        expect(flattenPlan(plan.added)).toEqual(flattenPlan(expected.added));
        // 不变量：操作数 = 拆除 + 新增；保留 + 新增 = 最终
        expect(plan.operations).toBe(plan.removed.length + plan.added.length);
        expect(plan.kept.length + plan.added.length).toBe(plan.rects.length);
        expect(plan.truncated).toBe(false);
        checked++;

        if (newMask === oldMask) {
          // 4) 无变化：全部保留、0 操作、最终方案即基线
          unchanged++;
          expect(plan.operations).toBe(0);
          expect(plan.removed).toEqual([]);
          expect(plan.added).toEqual([]);
          expect(flattenPlan(plan.rects)).toEqual(flattenPlan(baseline));
        } else {
          if (plan.operations > 0) opsPositive++;
          if ((newMask & oldMask) === oldMask) expansion++;
          if ((newMask & oldMask) === newMask) healing++;
        }
      }
    }

    // 全部 511×512 图样对被双重验证，且三类场景确实覆盖
    expect(checked).toBe(511 * 512);
    expect(unchanged).toBe(511);
    expect(expansion).toBeGreaterThan(1000);
    expect(healing).toBeGreaterThan(1000);
    expect(opsPositive).toBeGreaterThan(0);
  }, 300_000);
});
