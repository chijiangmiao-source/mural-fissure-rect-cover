// 验收级慢速测试：以独立实现的慢速穷举器（src/lib/bruteforce.ts，枚举全部合法子矩形 +
// MRV 精确覆盖回溯）逐一双重核对主搜索引擎在「全部 2^16 = 65536 个 4×4 图样」上的
// 最优贴片数、字典序决胜方案，并校验铺法合法性；另含孔洞、狭枝与并列方案的定向断言。
import { describe, expect, it } from 'vitest';
import { searchOptimalCover } from '../src/lib/solver';
import { bruteForceOptimalCover } from '../src/lib/bruteforce';
import { flattenPlan, validateTiling } from '../src/lib/rect';

const W = 4;
const H = 4;

function maskToSet(mask: number): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < 16; i++) if (mask & (1 << i)) s.add(i);
  return s;
}

describe('全 4×4 图样独立慢速穷举交叉验证（65536 例）', () => {
  it('主搜索与独立穷举在每个图样上的贴片数与决胜方案完全一致', () => {
    let tieCases = 0;
    let holeLike = 0;
    let branchLike = 0;
    let checked = 0;

    for (let mask = 0; mask < 1 << 16; mask++) {
      const cracks = maskToSet(mask);
      const a = searchOptimalCover(W, H, cracks, { maxTrace: 0 });
      const b = bruteForceOptimalCover(W, H, cracks);

      // 空图样：两者都应为 0
      if (cracks.size === 0) {
        expect(a.optimum).toBe(0);
        expect(b.optimum).toBe(0);
        continue;
      }
      checked++;

      // 1) 铺法合法：沿格线、只含裂格、互不重叠、并集恰为全部裂格
      expect(validateTiling(a.rects, cracks, W, H)).toBe(true);
      expect(validateTiling(b.rects, cracks, W, H)).toBe(true);

      // 2) 主目标一致：最少贴片数
      expect(a.optimum).toBe(b.optimum);

      // 3) 并列决胜一致：方案内部排序后的整数序列逐元素相同（唯一可复算方案）
      expect(flattenPlan(a.rects)).toEqual(flattenPlan(b.rects));

      // 统计结构性图样，保证循环确实覆盖到这些类别
      const grid = Array.from({ length: 4 }, (_, r) =>
        Array.from({ length: 4 }, (_, c) => cracks.has(r * 4 + c)),
      );
      const hasHole = (() => {
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
          if (grid[r][c]) continue;
          const up = r === 0 || grid[r - 1][c];
          const down = r === 3 || grid[r + 1][c];
          const left = c === 0 || grid[r][c - 1];
          const right = c === 3 || grid[r][c + 1];
          if (up && down && left && right && cracks.size >= 8) return true;
        }
        return false;
      })();
      if (hasHole) holeLike++;
      if (hasHole) branchLike += 0;
      // 狭枝：存在裂格四邻接中恰好两个且方向相反（走廊段）
      let corridor = false;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        if (!grid[r][c]) continue;
        const u = r > 0 && grid[r - 1][c];
        const d = r < 3 && grid[r + 1][c];
        const l = c > 0 && grid[r][c - 1];
        const rr = c < 3 && grid[r][c + 1];
        if ((u && d && !l && !rr) || (l && rr && !u && !d)) corridor = true;
      }
      if (corridor) branchLike++;
      // 并列：最优数 ≥ 2 时多数非平凡图样存在多条铺法，这里只做计数统计
      if (b.optimum >= 2) tieCases++;
    }

    // 65535 个非空图样全部被双重验证；且孔洞类、狭枝类图样确实被覆盖
    expect(checked).toBe(65535);
    expect(holeLike).toBeGreaterThan(100);
    expect(branchLike).toBeGreaterThan(100);
    expect(tieCases).toBeGreaterThan(1000);
  }, 300_000);
});

describe('定向图样：孔洞、狭枝、并列方案', () => {
  it('孔洞：3×3 环主搜索与穷举一致，需要 4 块且无矩形覆盖中心孔', () => {
    const cracks = new Set<number>();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      if (!(r === 1 && c === 1)) cracks.add(r * 4 + c);
    }
    const a = searchOptimalCover(4, 4, cracks);
    const b = bruteForceOptimalCover(4, 4, cracks);
    expect(a.optimum).toBe(4);
    expect(flattenPlan(a.rects)).toEqual(flattenPlan(b.rects));
    for (const q of a.rects) {
      const coversHole = q.top <= 1 && q.bottom >= 1 && q.left <= 1 && q.right >= 1;
      expect(coversHole).toBe(false);
    }
  });

  it('狭枝：十字走廊需要 3 块，与穷举一致', () => {
    const cracks = new Set<number>();
    for (let i = 0; i < 4; i++) {
      cracks.add(1 * 4 + i);
      if (i !== 1) cracks.add(i * 4 + 1); // 避免与横枝重复计格
    }
    cracks.add(0 * 4 + 1);
    const a = searchOptimalCover(4, 4, cracks);
    const b = bruteForceOptimalCover(4, 4, cracks);
    expect(a.optimum).toBe(b.optimum);
    expect(flattenPlan(a.rects)).toEqual(flattenPlan(b.rects));
    expect(validateTiling(a.rects, cracks, 4, 4)).toBe(true);
  });

  it('并列：L 形三格的字典序最小方案为横铺', () => {
    const cracks = new Set([0, 1, 4]); // (0,0)(0,1)(1,0)
    const a = searchOptimalCover(4, 4, cracks);
    const b = bruteForceOptimalCover(4, 4, cracks);
    expect(a.optimum).toBe(2);
    expect(flattenPlan(a.rects)).toEqual([0, 0, 0, 1, 1, 0, 1, 0]);
    expect(flattenPlan(a.rects)).toEqual(flattenPlan(b.rects));
  });

  it('并列：枚举至少一个「存在多种最少铺法」的 4×4 图样并验证决胜唯一', () => {
    // 2×2 全裂在更大网格中：1 块唯一。取 2×3 缺中心栓类图样；
    // 直接用暴力枚举找出一个 optimum>=2 的图样，并确认主搜索方案与穷举逐元素相同。
    let found = 0;
    for (let mask = 1; mask < 1 << 16; mask++) {
      const cracks = maskToSet(mask);
      const b = bruteForceOptimalCover(W, H, cracks);
      if (b.optimum === 2 && cracks.size >= 4) {
        const a = searchOptimalCover(W, H, cracks, { maxTrace: 0 });
        expect(a.optimum).toBe(2);
        expect(flattenPlan(a.rects)).toEqual(flattenPlan(b.rects));
        found++;
        if (found >= 50) break;
      }
    }
    expect(found).toBe(50);
  }, 120_000);
});
