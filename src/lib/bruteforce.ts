// 独立慢速穷举器（仅用于验收测试，刻意与主搜索 src/lib/solver.ts 采用不同实现路径）：
//  1. 先枚举「完全由裂格构成」的所有轴对齐子矩形（含非极大矩形）；
//  2. 精确覆盖回溯：每步选取「可覆盖它的候选矩形数最少」的未覆盖裂格（MRV）；
//  3. 遍历所有铺法，按 贴片数最少 → 展平整数序列字典序最小 决定最优。
// 该实现不依赖主搜索的任何函数与剪枝结论，只共享 Rect 类型与字典序工具。

import { Rect, canonicalPlanKey, compareIntSeq, rectId, sortRects } from './rect';

export interface BruteForceResult {
  rects: Rect[];
  optimum: number;
  nodes: number;
  feasible: boolean;
}

function allCrackRects(crack: Uint8Array, width: number, height: number): Rect[] {
  const out: Rect[] = [];
  for (let top = 0; top < height; top++) {
    for (let left = 0; left < width; left++) {
      if (crack[top * width + left] !== 1) continue;
      for (let bottom = top; bottom < height; bottom++) {
        for (let right = left; right < width; right++) {
          let ok = true;
          for (let r = top; r <= bottom && ok; r++) {
            for (let c = left; c <= right; c++) {
              if (crack[r * width + c] !== 1) {
                ok = false;
                break;
              }
            }
          }
          if (ok) out.push({ top, left, bottom, right });
        }
      }
    }
  }
  return out;
}

export function bruteForceOptimalCover(
  width: number,
  height: number,
  cracks: ReadonlySet<number>,
): BruteForceResult {
  const crack = new Uint8Array(width * height);
  for (const idx of cracks) crack[idx] = 1;

  const rects = allCrackRects(crack, width, height);

  // 每个矩形覆盖的位掩码（4×4 穷举规模下 number 足够；更大规模不在本验证器职责内）
  const masks: number[] = [];
  for (const r of rects) {
    let m = 0;
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) m |= 1 << (row * width + col);
    }
    masks.push(m);
  }

  let target = 0;
  for (const idx of cracks) target |= 1 << idx;

  let bestFlat: number[] | null = null;
  let bestCount = Infinity;
  let nodes = 0;
  const MAX_NODES = 50_000_000;
  const stack: number[] = [];

  const dfs = (covered: number, usedCount: number): void => {
    nodes++;
    if (nodes > MAX_NODES) return;
    if (covered === target) {
      // 叶点（保险路径；正常叶点在下方选矩形处处理）
      return;
    }
    // 非叶点：再放至少一块，故已用数达到最优即无更优可能。
    if (usedCount >= bestCount) return;

    // MRV：选未覆盖裂格中候选矩形最少者
    const remaining: number[] = [];
    for (let i = 0; i < width * height; i++) {
      if ((target & (1 << i)) && !(covered & (1 << i))) remaining.push(i);
    }

    let chosenCell = -1;
    let chosenOptions: number[] = [];
    let bestOptCount = Infinity;
    for (const cell of remaining) {
      const opts: number[] = [];
      const bit = 1 << cell;
      for (let ri = 0; ri < rects.length; ri++) {
        if ((masks[ri] & bit) && !(masks[ri] & covered)) opts.push(ri);
      }
      if (opts.length < bestOptCount) {
        bestOptCount = opts.length;
        chosenOptions = opts;
        chosenCell = cell;
        if (opts.length === 1) break;
      }
    }

    if (chosenOptions.length === 0) return; // 无法精确覆盖
    void chosenCell;

    for (const ri of chosenOptions) {
      const newCovered = covered | masks[ri];
      const newCount = usedCount + 1;
      if (newCount > bestCount) continue;
      if (newCovered === target) {
        // 叶点：通过全局栈重建方案，决胜使用一基整数序列
        stack.push(ri);
        const flat = canonicalPlanKey(stack.map((i) => rects[i]));
        if (
          bestFlat === null ||
          stack.length < bestCount ||
          (stack.length === bestCount && compareIntSeq(flat, bestFlat) < 0)
        ) {
          bestFlat = flat;
          bestCount = stack.length;
        }
        stack.pop();
        continue;
      }
      stack.push(ri);
      dfs(newCovered, newCount);
      stack.pop();
    }
  };

  if (cracks.size === 0) {
    return { rects: [], optimum: 0, nodes: 0, feasible: true };
  }

  dfs(0, 0);

  const resultRects: Rect[] = [];
  const bf = bestFlat as number[] | null;
  if (bf !== null) {
    for (let i = 0; i < bf.length; i += 4) {
      resultRects.push({
        top: bf[i] - 1,
        left: bf[i + 1] - 1,
        bottom: bf[i + 2] - 1,
        right: bf[i + 3] - 1,
      });
    }
  }
  return {
    rects: resultRects,
    optimum: bestCount === Infinity ? 0 : bestCount,
    nodes,
    feasible: bestFlat !== null,
  };
}

// ---------------------------------------------------------------------------
// 改造验收：独立枚举器（与 src/lib/renovation.ts 的加权 DFS 完全不同的实现路径：
// 先枚举新图样上的「全部」精确覆盖，再按改造目标逐方案评分取唯一最优）。
// ---------------------------------------------------------------------------

export interface BruteForceRenovation {
  /** 最终合法覆盖（保留 + 新增），按 [上,左,下,右] 字典序排序 */
  rects: Rect[];
  kept: Rect[];
  removed: Rect[];
  added: Rect[];
  /** 主目标值：拆除数 + 新增数 */
  operations: number;
  /** 次目标值：最终贴片总数 */
  finalCount: number;
  /** 枚举到的精确覆盖总数（供测试确认枚举确实展开） */
  covers: number;
}

/** 矩形覆盖位掩码（BigInt 版本，独立实现，不依赖主搜索） */
function rectMaskBig(r: Rect, width: number): bigint {
  let m = 0n;
  for (let row = r.top; row <= r.bottom; row++) {
    const base = BigInt(row * width);
    for (let col = r.left; col <= r.right; col++) m |= 1n << (base + BigInt(col));
  }
  return m;
}

/**
 * 枚举给定裂格集合上的全部精确矩形覆盖。
 * 实现路径：枚举全部合法子矩形 + MRV 精确覆盖回溯，收集所有解（不做最优性剪枝）。
 */
export function enumerateExactCovers(
  width: number,
  height: number,
  cracks: ReadonlySet<number>,
): Rect[][] {
  const crack = new Uint8Array(width * height);
  for (const idx of cracks) crack[idx] = 1;
  const rects = allCrackRects(crack, width, height);
  const masks = rects.map((r) => rectMaskBig(r, width));

  let target = 0n;
  for (const idx of cracks) target |= 1n << BigInt(idx);

  const covers: Rect[][] = [];
  const stack: number[] = [];

  const dfs = (covered: bigint): void => {
    if (covered === target) {
      covers.push(stack.map((i) => rects[i]));
      return;
    }
    // MRV：选「可覆盖它的候选矩形数最少」的未覆盖裂格
    let chosenOpts: number[] = [];
    let bestOptCount = Infinity;
    for (let cell = 0; cell < width * height; cell++) {
      const bit = 1n << BigInt(cell);
      if ((target & bit) === 0n || (covered & bit) !== 0n) continue;
      const opts: number[] = [];
      for (let ri = 0; ri < rects.length; ri++) {
        if ((masks[ri] & bit) !== 0n && (masks[ri] & covered) === 0n) opts.push(ri);
      }
      if (opts.length < bestOptCount) {
        bestOptCount = opts.length;
        chosenOpts = opts;
        if (opts.length <= 1) break;
      }
    }
    // 每个未覆盖裂格至少可被自身 1×1 覆盖，chosenOpts 不会为空
    for (const ri of chosenOpts) {
      stack.push(ri);
      dfs(covered | masks[ri]);
      stack.pop();
    }
  };

  if (cracks.size === 0) return [[]];
  dfs(0n);
  return covers;
}

/**
 * 从全部精确覆盖中按改造目标选出唯一最优：
 * 拆除数+新增数最少 → 最终贴片总数最少 → 一基坐标展平序列字典序最小。
 */
export function selectRenovationFromCovers(
  covers: readonly Rect[][],
  baseline: readonly Rect[],
): BruteForceRenovation {
  const baselineIds = new Set(baseline.map((r) => rectId(r)));
  let best: Rect[] | null = null;
  let bestKey: number[] | null = null;
  let bestOps = Infinity;
  let bestCount = Infinity;
  for (const cover of covers) {
    let keptN = 0;
    for (const r of cover) if (baselineIds.has(rectId(r))) keptN++;
    const ops = baseline.length - keptN + (cover.length - keptN);
    const key = canonicalPlanKey(cover);
    if (
      bestKey === null ||
      ops < bestOps ||
      (ops === bestOps && cover.length < bestCount) ||
      (ops === bestOps && cover.length === bestCount && compareIntSeq(key, bestKey) < 0)
    ) {
      best = cover;
      bestKey = key;
      bestOps = ops;
      bestCount = cover.length;
    }
  }
  const finalRects = sortRects(best ?? []);
  const kept: Rect[] = [];
  const added: Rect[] = [];
  for (const r of finalRects) {
    (baselineIds.has(rectId(r)) ? kept : added).push(r);
  }
  const keptIds = new Set(kept.map(rectId));
  const removed = sortRects(baseline.filter((r) => !keptIds.has(rectId(r))));
  return {
    rects: finalRects,
    kept,
    removed,
    added,
    operations: removed.length + added.length,
    finalCount: finalRects.length,
    covers: covers.length,
  };
}

/** 独立改造求解器：枚举全部精确覆盖后按改造目标评分（仅用于验收交叉验证）。 */
export function bruteForceRenovation(
  width: number,
  height: number,
  cracks: ReadonlySet<number>,
  baseline: readonly Rect[],
): BruteForceRenovation {
  return selectRenovationFromCovers(enumerateExactCovers(width, height, cracks), baseline);
}
