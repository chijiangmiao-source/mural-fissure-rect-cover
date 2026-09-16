// 精确状态空间搜索：用互不重叠的轴对齐矩形覆盖全部裂格。
// 主目标：矩形数量最少；并列时按方案展平整数序列字典序取最小。
//
// 搜索算法（完备且可复算）：
//  1. 每一步选取行优先序下第一个未覆盖裂格 p 作为锚点（确定性）。
//  2. 枚举报围 p 的每一个合法自由矩形（枚举「锚点列连续行带 × 行带内左右界」，
//     不做极大性过滤，保证任何合法铺法中覆盖 p 的那块矩形一定被枚举到 → 朴素完备）。
//  3. 初始上界：同一枚举框架下的贪心可行解（每步取面积最大者），尽早收紧剪枝。
//  4. 下界剪枝：剩余自由裂格间的「不可同矩形覆盖」冲突集合 packing
//     （不弱于四邻接连通分量下界：不同分量的格彼此互不相容）。
//  5. 同态记忆：同一剩余形态若曾以更少贴片数到达，则当前路径必不更优，剪枝。
//  6. 并列决胜：完整方案展平为整数序列比较字典序，全局保留最小者。
// 同时产出分支取舍轨迹，供界面逐步回放。

import { Rect, canonicalPlanKey, compareIntSeq } from './rect';

export interface SearchOptions {
  /** 状态数硬上限（安全熔断；截断时结果标记 truncated 且不冒充最优） */
  maxStates?: number;
  /** 分支轨迹最多保留条数 */
  maxTrace?: number;
}

export type BranchKind =
  | 'take'
  | 'prune-lb'
  | 'prune-cut'
  | 'prune-memo'
  | 'deadend'
  | 'complete'
  | 'greedy';

export interface BranchEvent {
  /** 单调状态序号 */
  seq: number;
  depth: number;
  kind: BranchKind;
  /** 本步锚点格（行优先序首个未覆盖裂格） */
  anchor: { row: number; col: number };
  /** 尝试的候选矩形（take/prune 时存在） */
  rect?: Rect;
  reason?: string;
  used: number;
  lowerBound: number;
  incumbent: number | null;
}

export interface SearchResult {
  rects: Rect[];
  states: number;
  optimum: number;
  trace: BranchEvent[];
  truncated: boolean;
  /** 分支轨迹是否因超过上限而被压缩（关键事件始终保留） */
  traceTruncated: boolean;
  elapsedMs: number;
  /** 初始贪心解使用的贴片数（对照用，体现“局部贪心会多耗贴片”） */
  greedyCount: number;
}

interface Internal {
  width: number;
  height: number;
  crack: Uint8Array;
  states: number;
  trace: BranchEvent[];
  best: number[] | null;
  bestCount: number;
  maxStates: number;
  maxTrace: number;
  truncated: boolean;
  traceTruncated: boolean;
  memo: Map<bigint, number>;
  greedyCount: number;
}

/** 枚举报围锚点 (ar,ac) 的所有「全自由裂格」矩形（自由 = 裂格且未覆盖）。 */
export function enumerateFreeRects(
  crack: Uint8Array,
  covered: Uint8Array,
  width: number,
  height: number,
  ar: number,
  ac: number,
): Rect[] {
  const isFree = (r: number, c: number) =>
    crack[r * width + c] === 1 && covered[r * width + c] === 0;
  const out: Rect[] = [];
  // 锚点列上的连续行带 [top, bottom]
  for (let top = ar; top >= 0; top--) {
    if (!isFree(top, ac)) break;
    for (let bottom = ar; bottom < height; bottom++) {
      if (!isFree(bottom, ac)) break;
      // 求该行带内相对锚点的最大自由左右界
      let maxLeft = ac;
      outerLeft: while (maxLeft - 1 >= 0) {
        for (let r = top; r <= bottom; r++) {
          if (!isFree(r, maxLeft - 1)) break outerLeft;
        }
        maxLeft--;
      }
      let maxRight = ac;
      outerRight: while (maxRight + 1 < width) {
        for (let r = top; r <= bottom; r++) {
          if (!isFree(r, maxRight + 1)) break outerRight;
        }
        maxRight++;
      }
      // 行带内所有包含锚点列的左右组合都是合法矩形
      for (let left = maxLeft; left <= ac; left++) {
        for (let right = ac; right <= maxRight; right++) {
          out.push({ top, left, bottom, right });
        }
      }
    }
  }
  return out;
}

function area(r: Rect): number {
  return (r.bottom - r.top + 1) * (r.right - r.left + 1);
}

/** 矩形覆盖位掩码（BigInt，网格最多 12×12=144 位） */
export function rectMask(r: Rect, width: number): bigint {
  let m = 0n;
  for (let row = r.top; row <= r.bottom; row++) {
    const base = BigInt(row * width);
    for (let col = r.left; col <= r.right; col++) m |= 1n << (base + BigInt(col));
  }
  return m;
}

/**
 * 下界：在剩余自由裂格中贪心构造一个「任意两格都不可能被同一块矩形覆盖」的格集。
 * 集合中每个格至少需要一块独立贴片，故其大小是贴片数的合法下界。
 * 两格可同矩形覆盖 ⇔ 其包围盒内每个格当前都是自由裂格。
 */
export function packingLowerBound(
  crack: Uint8Array,
  covered: Uint8Array,
  width: number,
): number {
  const freeCells: number[] = [];
  for (let i = 0; i < crack.length; i++) {
    if (crack[i] === 1 && covered[i] === 0) freeCells.push(i);
  }
  const compatible = (a: number, b: number): boolean => {
    const ra = (a / width) | 0;
    const ca = a % width;
    const rb = (b / width) | 0;
    const cb = b % width;
    const t = Math.min(ra, rb);
    const bo = Math.max(ra, rb);
    const l = Math.min(ca, cb);
    const ri = Math.max(ca, cb);
    for (let r = t; r <= bo; r++) {
      const base = r * width;
      for (let c = l; c <= ri; c++) {
        if (crack[base + c] !== 1 || covered[base + c] === 1) return false;
      }
    }
    return true;
  };
  const picked: number[] = [];
  for (const cell of freeCells) {
    let ok = true;
    for (const p of picked) {
      if (compatible(cell, p)) {
        ok = false;
        break;
      }
    }
    if (ok) picked.push(cell);
  }
  return picked.length;
}

/**
 * 执行精确搜索。
 * @param width  网格宽（列数）
 * @param height 网格高（行数）
 * @param cracks 裂格索引集合 row*width+col
 */
export function searchOptimalCover(
  width: number,
  height: number,
  cracks: ReadonlySet<number>,
  options: SearchOptions = {},
): SearchResult {
  const started = performance.now();
  const ctx: Internal = {
    width,
    height,
    crack: new Uint8Array(width * height),
    states: 0,
    trace: [],
    best: null,
    bestCount: Infinity,
    maxStates: options.maxStates ?? 5_000_000,
    maxTrace: options.maxTrace ?? 6000,
    truncated: false,
    traceTruncated: false,
    memo: new Map(),
    greedyCount: 0,
  };
  for (const idx of cracks) ctx.crack[idx] = 1;

  const covered = new Uint8Array(width * height);
  let mask = 0n;
  const chosen: Rect[] = [];

  if (cracks.size === 0) {
    return {
      rects: [],
      states: 0,
      optimum: 0,
      trace: [],
      truncated: false,
      traceTruncated: false,
      elapsedMs: performance.now() - started,
      greedyCount: 0,
    };
  }

  const applyRect = (r: Rect, value: 0 | 1): void => {
    for (let row = r.top; row <= r.bottom; row++) {
      const base = row * width;
      for (let col = r.left; col <= r.right; col++) covered[base + col] = value;
    }
  };

  const firstFree = (): number => {
    for (let i = 0; i < ctx.crack.length; i++) {
      if (ctx.crack[i] === 1 && covered[i] === 0) return i;
    }
    return -1;
  };

  const pushEvent = (ev: Omit<BranchEvent, 'seq'>): void => {
    if (ctx.maxTrace <= 0) return;
    if (ctx.trace.length >= ctx.maxTrace) {
      ctx.traceTruncated = true;
      return;
    }
    ctx.trace.push({ seq: ctx.states, ...ev });
  };

  const candidateRects = (ar: number, ac: number): Rect[] => {
    const rects = enumerateFreeRects(ctx.crack, covered, width, height, ar, ac);
    // 大面积优先：尽早得到高质量可行解；面积相同按键字典序，保证过程可复算。
    rects.sort((a, b) => {
      const dArea = area(b) - area(a);
      if (dArea !== 0) return dArea;
      return compareIntSeq(
        [a.top, a.left, a.bottom, a.right],
        [b.top, b.left, b.bottom, b.right],
      );
    });
    return rects;
  };

  // ---- 初始贪心可行解（同一锚点规则，每步取面积最大候选），作为初始上界 ----
  const greedyRects: Rect[] = [];
  for (;;) {
    const idx = firstFree();
    if (idx === -1) break;
    const ar = (idx / width) | 0;
    const ac = idx % width;
    const rects = candidateRects(ar, ac);
    if (rects.length === 0) break; // 理论上不会发生（至少 1×1 自身）
    const pick = rects[0];
    applyRect(pick, 1);
    greedyRects.push(pick);
  }
  const greedyComplete = firstFree() === -1; // 仍处于贪心覆盖态时判断
  for (const r of greedyRects) applyRect(r, 0); // 恢复覆盖态
  if (greedyRects.length > 0 && greedyComplete) {
    // 以一基整数序列保存当前最优（常量偏移与 0 起坐标等价，按需求字面使用一基坐标）
    ctx.best = canonicalPlanKey(greedyRects);
    ctx.bestCount = greedyRects.length;
    ctx.greedyCount = greedyRects.length;
    pushEvent({
      depth: 0,
      kind: 'greedy',
      anchor: { row: -1, col: -1 },
      used: ctx.bestCount,
      lowerBound: ctx.bestCount,
      incumbent: ctx.bestCount,
      reason: `贪心初始解：${ctx.bestCount} 块贴片，作为搜索上界`,
    });
  }

  const dfs = (depth: number): void => {
    if (ctx.truncated) return;
    ctx.states++;
    if (ctx.states > ctx.maxStates) {
      ctx.truncated = true;
      return;
    }

    const anchorIdx0 = firstFree();

    // 同态记忆：同一覆盖形态曾以「严格更少」贴片数到达 → 当前路径数量上必不更优。
    // 相等数量不剪枝：不同前缀拼出的完整方案字典序可能不同，必须保留。
    const prev = ctx.memo.get(mask);
    if (prev !== undefined && prev < chosen.length) {
      pushEvent({
        depth,
        kind: 'prune-memo',
        anchor:
          anchorIdx0 === -1
            ? { row: -1, col: -1 }
            : { row: (anchorIdx0 / width) | 0, col: anchorIdx0 % width },
        used: chosen.length,
        lowerBound: prev,
        incumbent: ctx.bestCount,
        reason: `剩余形态曾以 ${prev} 块到达（当前 ${chosen.length} 块），剪枝`,
      });
      return;
    }
    ctx.memo.set(mask, chosen.length);

    if (anchorIdx0 === -1) {
      const flat = canonicalPlanKey(chosen);
      if (
        ctx.best === null ||
        chosen.length < ctx.bestCount ||
        (chosen.length === ctx.bestCount && compareIntSeq(flat, ctx.best) < 0)
      ) {
        ctx.best = flat;
        ctx.bestCount = chosen.length;
      }
      pushEvent({
        depth,
        kind: 'complete',
        anchor: { row: -1, col: -1 },
        used: chosen.length,
        lowerBound: chosen.length,
        incumbent: ctx.bestCount,
        reason: '得到完整覆盖方案',
      });
      return;
    }

    const ar = (anchorIdx0 / width) | 0;
    const ac = anchorIdx0 % width;
    const lb0 = chosen.length + packingLowerBound(ctx.crack, covered, width);
    if (ctx.best !== null && lb0 > ctx.bestCount) {
      pushEvent({
        depth,
        kind: 'prune-lb',
        anchor: { row: ar, col: ac },
        used: chosen.length,
        lowerBound: lb0,
        incumbent: ctx.bestCount,
        reason: `下界 ${lb0} 已超过已知最优 ${ctx.bestCount}，剪枝`,
      });
      return;
    }

    const candidates = candidateRects(ar, ac);
    if (candidates.length === 0) {
      pushEvent({
        depth,
        kind: 'deadend',
        anchor: { row: ar, col: ac },
        used: chosen.length,
        lowerBound: lb0,
        incumbent: ctx.bestCount,
        reason: '无可用候选矩形',
      });
      return;
    }

    for (const rect of candidates) {
      if (ctx.truncated) return;
      const rMask = rectMask(rect, width);
      applyRect(rect, 1);
      mask |= rMask;
      chosen.push(rect);
      ctx.states++;

      const projected = chosen.length + packingLowerBound(ctx.crack, covered, width);
      if (ctx.best !== null && projected > ctx.bestCount) {
        pushEvent({
          depth,
          kind: 'prune-cut',
          anchor: { row: ar, col: ac },
          rect,
          used: chosen.length,
          lowerBound: projected,
          incumbent: ctx.bestCount,
          reason: `放置后下界 ${projected} > 最优 ${ctx.bestCount}，回溯`,
        });
      } else {
        pushEvent({
          depth,
          kind: 'take',
          anchor: { row: ar, col: ac },
          rect,
          used: chosen.length,
          lowerBound: projected,
          incumbent: ctx.bestCount,
        });
        dfs(depth + 1);
      }

      chosen.pop();
      mask &= ~rMask;
      applyRect(rect, 0);
    }
  };

  dfs(0);

  // 轨迹若因规模过大被截断，追加一条最终落定事件，保证回放最后一步总能展示最优方案。
  if (ctx.traceTruncated && ctx.best !== null && ctx.maxTrace > 0) {
    ctx.trace.push({
      seq: ctx.states,
      depth: ctx.bestCount,
      kind: 'complete',
      anchor: { row: -1, col: -1 },
      used: ctx.bestCount,
      lowerBound: ctx.bestCount,
      incumbent: ctx.bestCount,
      reason: `搜索完成（轨迹超 ${ctx.maxTrace} 条已压缩，仅展示前段过程）：最终最优 ${ctx.bestCount} 块`,
    });
  }

  // ctx.best 为一基展平序列，重建内部 0 起坐标时逐值减一。
  const rects: Rect[] = [];
  if (ctx.best) {
    for (let i = 0; i < ctx.best.length; i += 4) {
      rects.push({
        top: ctx.best[i] - 1,
        left: ctx.best[i + 1] - 1,
        bottom: ctx.best[i + 2] - 1,
        right: ctx.best[i + 3] - 1,
      });
    }
  }

  return {
    rects,
    states: ctx.states,
    optimum: ctx.bestCount === Infinity ? 0 : ctx.bestCount,
    trace: ctx.trace,
    truncated: ctx.truncated,
    traceTruncated: ctx.traceTruncated,
    elapsedMs: performance.now() - started,
    greedyCount: ctx.greedyCount,
  };
}
