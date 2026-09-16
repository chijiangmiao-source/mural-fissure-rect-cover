// 改造方案求解：在「已安装基线」存在的前提下，针对当前裂格集合求最终矩形覆盖。
//
// 规则：
//  - 最终方案必须是当前裂格上的合法矩形覆盖（只含裂格、互不重叠、并集恰为全部裂格）；
//  - 与基线坐标完全一致且仍只覆盖裂格的贴片视为「保留」，保留不消耗任何操作；
//  - 主目标：拆除数 + 新增数 最少；
//  - 并列时依次按「最终贴片总数」「既有坐标字典序（一基 [上,左,下,右] 展平序列）」决胜，
//    因此对任一合法输入只呈现唯一可复算的改造结果。
//
// 设基线 B 块、最终保留 R 块、新增 A 块，则操作数 = (B − R) + A，
// 等价于最小化逐块重量和 Σw(r)：保留块 w = −1、新增块 w = +1（B 为常量，只做平移）。
//
// 搜索框架与 src/lib/solver.ts 相同（确定性锚点 + 完备候选枚举，保证朴素完备），
// 目标函数替换为 (重量, 块数, 字典序) 的三元字典序：
//  - 下界：剩余至少还需 lb 块贴片（packing 下界），每块重量 ≥ −1，且至多还能保留
//    retainable 块基线 → 追加重量 ≥ lb − 2·retainable，超过已知最优即剪枝；
//  - 支配记忆：同一剩余形态曾以字典序更小的 (重量, 块数) 到达，则当前路径必不更优
//    （相等不剪枝：不同前缀拼出的完整方案字典序可能不同，必须保留）。

import {
  MAX_SIDE,
  Rect,
  canonicalPlanKey,
  compareIntSeq,
  rectArea,
  sortRects,
} from './rect';
import { enumerateFreeRects, packingLowerBound, rectMask } from './solver';

export interface RenovationOptions {
  /** 状态数硬上限（安全熔断；截断时结果标记 truncated，界面不得展示） */
  maxStates?: number;
}

/** 已安装基线：一次精确搜索的最优方案及其所属网格尺寸（尺寸变更后不再兼容） */
export interface InstalledBaseline {
  width: number;
  height: number;
  rects: Rect[];
}

export interface RenovationPlan {
  /** 最终合法覆盖（保留 + 新增），按 [上,左,下,右] 字典序排序 */
  rects: Rect[];
  /** 保留的基线贴片（与基线坐标完全一致且仍只覆盖裂格） */
  kept: Rect[];
  /** 拆除的基线贴片 */
  removed: Rect[];
  /** 新增贴片 */
  added: Rect[];
  /** 主目标值：拆除数 + 新增数 */
  operations: number;
  /** 次目标值：最终贴片总数 */
  finalCount: number;
  /** 基线贴片总数 */
  baselineCount: number;
  states: number;
  truncated: boolean;
  elapsedMs: number;
}

/** 矩形坐标 → 紧凑整数编码（坐标均 < MAX_SIDE，进制编码保证唯一），供热路径集合查询 */
const rectCode = (r: Rect): number =>
  ((r.top * MAX_SIDE + r.left) * MAX_SIDE + r.bottom) * MAX_SIDE + r.right;

/**
 * 求解改造方案。
 * @param width    网格宽（列数）
 * @param height   网格高（行数）
 * @param cracks   当前裂格索引集合 row*width+col
 * @param baseline 已安装基线贴片（0 起坐标，与当前网格同尺寸）
 */
export function planRenovation(
  width: number,
  height: number,
  cracks: ReadonlySet<number>,
  baseline: readonly Rect[],
  options: RenovationOptions = {},
): RenovationPlan {
  const started = performance.now();
  const maxStates = options.maxStates ?? 5_000_000;

  const crack = new Uint8Array(width * height);
  let crackMask = 0n;
  for (const idx of cracks) {
    crack[idx] = 1;
    crackMask |= 1n << BigInt(idx);
  }

  const baselineCodes = new Set<number>();
  const baselineMasks: bigint[] = [];
  for (const r of baseline) {
    baselineCodes.add(rectCode(r));
    baselineMasks.push(rectMask(r, width));
  }
  // 基线贴片是否仍完整落在裂格内（不随搜索推进变化，预先计算）；
  // 压到完好格的基线贴片永远不会被枚举为候选 → 必然拆除。
  const baselineViable = baselineMasks.map((m) => (m & ~crackMask) === 0n);

  const buildResult = (
    bestKey: number[] | null,
    states: number,
    truncated: boolean,
  ): RenovationPlan => {
    // bestKey 为一基展平序列，重建内部 0 起坐标时逐值减一（序列本身已按字典序排序）
    const rects: Rect[] = [];
    if (bestKey) {
      for (let i = 0; i < bestKey.length; i += 4) {
        rects.push({
          top: bestKey[i] - 1,
          left: bestKey[i + 1] - 1,
          bottom: bestKey[i + 2] - 1,
          right: bestKey[i + 3] - 1,
        });
      }
    }
    const kept: Rect[] = [];
    const added: Rect[] = [];
    for (const r of rects) {
      (baselineCodes.has(rectCode(r)) ? kept : added).push(r);
    }
    const keptCodes = new Set(kept.map(rectCode));
    const removed = sortRects(baseline.filter((r) => !keptCodes.has(rectCode(r))));
    return {
      rects,
      kept,
      removed,
      added,
      operations: removed.length + added.length,
      finalCount: rects.length,
      baselineCount: baseline.length,
      states,
      truncated,
      elapsedMs: performance.now() - started,
    };
  };

  // 全部愈合：最终覆盖为空，基线全部拆除
  if (cracks.size === 0) return buildResult(null, 0, false);

  const covered = new Uint8Array(width * height);
  let coveredMask = 0n;
  const chosen: Rect[] = [];
  let weight = 0; // 新增数 − 保留数（操作数 = 基线数 + weight）

  let states = 0;
  let truncated = false;
  let bestKey: number[] | null = null;
  let bestWeight = Infinity;
  let bestCount = Infinity;
  const memo = new Map<bigint, number>();

  const applyRect = (r: Rect, v: 0 | 1): void => {
    for (let row = r.top; row <= r.bottom; row++) {
      const base = row * width;
      for (let col = r.left; col <= r.right; col++) covered[base + col] = v;
    }
  };

  const firstFree = (): number => {
    for (let i = 0; i < crack.length; i++) {
      if (crack[i] === 1 && covered[i] === 0) return i;
    }
    return -1;
  };

  /** 仍可保留的基线贴片数（完整落在未覆盖裂格内；基线贴片互不重叠，故可全部同时保留） */
  const retainableNow = (): number => {
    let n = 0;
    for (let i = 0; i < baselineMasks.length; i++) {
      if (baselineViable[i] && (baselineMasks[i] & coveredMask) === 0n) n++;
    }
    return n;
  };

  /** 追加重量下界：剩余至少还需 lb 块贴片，每块重量 ≥ −1，且至多再保留 retainable 块 */
  const weightLowerBound = (): number =>
    packingLowerBound(crack, covered, width) - 2 * retainableNow();

  interface Tagged {
    r: Rect;
    w: number;
    m: bigint;
  }

  const candidateRects = (ar: number, ac: number): Tagged[] => {
    const rects = enumerateFreeRects(crack, covered, width, height, ar, ac);
    const tagged = rects.map((r) => ({
      r,
      w: baselineCodes.has(rectCode(r)) ? -1 : 1,
      m: rectMask(r, width),
    }));
    // 保留优先、其次大面积、再按坐标字典序：尽早得到高质量可行解，过程确定可复算
    tagged.sort((a, b) => {
      if (a.w !== b.w) return a.w - b.w;
      const dArea = rectArea(b.r) - rectArea(a.r);
      if (dArea !== 0) return dArea;
      return compareIntSeq(
        [a.r.top, a.r.left, a.r.bottom, a.r.right],
        [b.r.top, b.r.left, b.r.bottom, b.r.right],
      );
    });
    return tagged;
  };

  // ---- 贪心初始可行解（同一锚点规则，每步取「保留优先、面积最大」候选），收紧剪枝 ----
  const greedyRects: Rect[] = [];
  let greedyWeight = 0;
  for (;;) {
    const idx = firstFree();
    if (idx === -1) break;
    const cands = candidateRects((idx / width) | 0, idx % width);
    if (cands.length === 0) break; // 理论上不会发生（至少 1×1 自身）
    const pick = cands[0];
    applyRect(pick.r, 1);
    greedyRects.push(pick.r);
    greedyWeight += pick.w;
  }
  const greedyComplete = firstFree() === -1; // 仍处于贪心覆盖态时判断
  for (const r of greedyRects) applyRect(r, 0); // 恢复覆盖态
  if (greedyComplete && greedyRects.length > 0) {
    bestKey = canonicalPlanKey(greedyRects);
    bestWeight = greedyWeight;
    bestCount = greedyRects.length;
  }

  // (重量, 块数) 打包为单个整数：重量 ≥ −基线数、块数 < 1024（裂格最多 144 格），
  // 打包后的整数比较与 (重量, 块数) 字典序比较一致
  const wOffset = baseline.length + 8;
  const packScore = (w: number, c: number): number => (w + wOffset) * 1024 + c;

  const dfs = (): void => {
    if (truncated) return;
    states++;
    if (states > maxStates) {
      truncated = true;
      return;
    }

    const anchorIdx = firstFree();

    // 支配记忆：同一剩余形态曾以字典序更小的 (重量, 块数) 到达 → 当前路径必不更优。
    // 相等不剪枝：不同前缀拼出的完整方案字典序可能不同，必须保留。
    const packed = packScore(weight, chosen.length);
    const prev = memo.get(coveredMask);
    if (prev !== undefined && prev < packed) return;
    if (prev === undefined || packed < prev) memo.set(coveredMask, packed);

    if (anchorIdx === -1) {
      const key = canonicalPlanKey(chosen);
      if (
        bestKey === null ||
        weight < bestWeight ||
        (weight === bestWeight && chosen.length < bestCount) ||
        (weight === bestWeight && chosen.length === bestCount &&
          compareIntSeq(key, bestKey) < 0)
      ) {
        bestKey = key;
        bestWeight = weight;
        bestCount = chosen.length;
      }
      return;
    }

    if (bestKey !== null && weight + weightLowerBound() > bestWeight) return;

    const ar = (anchorIdx / width) | 0;
    const ac = anchorIdx % width;
    for (const cand of candidateRects(ar, ac)) {
      if (truncated) return;
      applyRect(cand.r, 1);
      coveredMask |= cand.m;
      chosen.push(cand.r);
      weight += cand.w;
      states++;
      // 进入子状态后由其自身做支配与下界判断，此处不再重复投影剪枝
      dfs();
      chosen.pop();
      weight -= cand.w;
      coveredMask &= ~cand.m;
      applyRect(cand.r, 0);
    }
  };

  dfs();

  return buildResult(bestKey, states, truncated);
}
