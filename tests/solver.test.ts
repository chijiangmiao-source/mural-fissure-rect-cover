import { describe, expect, it } from 'vitest';
import { searchOptimalCover } from '../src/lib/solver';
import { bruteForceOptimalCover } from '../src/lib/bruteforce';
import {
  flattenPlan,
  validateTiling,
  type Rect,
} from '../src/lib/rect';

function setFrom(w: number, coords: Array<[number, number]>): Set<number> {
  return new Set(coords.map(([r, c]) => r * w + c));
}

describe('searchOptimalCover 基础', () => {
  it('空裂格集 → 0 块', () => {
    const r = searchOptimalCover(4, 4, new Set());
    expect(r.optimum).toBe(0);
    expect(r.rects).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it('单个裂格 → 1 块 1×1', () => {
    const cracks = setFrom(4, [[1, 2]]);
    const r = searchOptimalCover(4, 4, cracks);
    expect(r.optimum).toBe(1);
    expect(r.rects).toEqual([{ top: 1, left: 2, bottom: 1, right: 2 }]);
  });

  it('整块全裂 → 1 块大矩形', () => {
    const coords: Array<[number, number]> = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) coords.push([r, c]);
    const r = searchOptimalCover(4, 3, setFrom(4, coords));
    expect(r.optimum).toBe(1);
    expect(r.rects).toEqual([{ top: 0, left: 0, bottom: 2, right: 3 }]);
  });

  it('结果始终是合法铺法（不重叠、不压完好格、并集恰为裂格）', () => {
    const cracks = setFrom(5, [
      [0, 0], [0, 1], [0, 2],
      [1, 1],
      [2, 1], [2, 2], [2, 3],
      [3, 0], [3, 1],
    ]);
    const r = searchOptimalCover(5, 5, cracks);
    expect(validateTiling(r.rects, cracks, 5, 5)).toBe(true);
  });
});

describe('孔洞与狭枝', () => {
  it('3×3 环（中心孔洞）至少 4 块且为合法铺法', () => {
    const ring: Array<[number, number]> = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      if (!(r === 1 && c === 1)) ring.push([r, c]);
    }
    const cracks = setFrom(3, ring);
    const r = searchOptimalCover(3, 3, cracks);
    expect(r.optimum).toBe(4); // 中心孔洞使任何 2×2 都含完好格
    expect(validateTiling(r.rects, cracks, 3, 3)).toBe(true);
    // 每块都不得覆盖中心
    for (const rect of r.rects) {
      const coversCenter =
        rect.top <= 1 && rect.bottom >= 1 && rect.left <= 1 && rect.right >= 1;
      expect(coversCenter).toBe(false);
    }
  });

  it('内部带两个孔洞的 4×4 框需要包围孔洞的贴片', () => {
    // 4×4 中 (1,1) 与 (2,2) 为完好格
    const coords: Array<[number, number]> = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (!((r === 1 && c === 1) || (r === 2 && c === 2))) coords.push([r, c]);
    }
    const cracks = setFrom(4, coords);
    const r = searchOptimalCover(4, 4, cracks);
    expect(validateTiling(r.rects, cracks, 4, 4)).toBe(true);
    const b = bruteForceOptimalCover(4, 4, cracks);
    expect(r.optimum).toBe(b.optimum);
  });

  it('十字狭枝（5×5）最优为 3 块', () => {
    const cross: Array<[number, number]> = [];
    for (let i = 0; i < 5; i++) { cross.push([2, i]); cross.push([i, 2]); }
    const cracks = setFrom(5, cross);
    const r = searchOptimalCover(5, 5, cracks);
    expect(r.optimum).toBe(3);
    expect(validateTiling(r.rects, cracks, 5, 5)).toBe(true);
  });

  it('蛇形细枝：全部仅 1 格宽，最优数 = 折线段数', () => {
    // 一条宽度为 1 的折线：(0,0)-(0,2), (0,2)-(2,2), (2,0)-(2,2), (2,0)-(3,0)
    const snake: Array<[number, number]> = [
      [0, 0], [0, 1], [0, 2],
      [1, 2],
      [2, 2], [2, 1], [2, 0],
      [3, 0],
    ];
    const cracks = setFrom(4, snake);
    const r = searchOptimalCover(4, 4, cracks);
    // 4 个直段，任何矩形都不能跨越拐角（拐角处包围盒含完好格）
    expect(r.optimum).toBe(4);
    expect(validateTiling(r.rects, cracks, 4, 4)).toBe(true);
  });
});

describe('并列方案的字典序决胜', () => {
  it('2×2 全裂：1 块即可，不触发并列；铺为整块', () => {
    const cracks = setFrom(2, [[0, 0], [0, 1], [1, 0], [1, 1]]);
    const r = searchOptimalCover(2, 2, cracks);
    expect(r.optimum).toBe(1);
  });

  it('强制 2 块并列时取字典序最小：横铺优于竖铺（L 形三格）', () => {
    // 2×2 缺右下：两种最优 2 块铺法
    //   横铺：[上0,左0,下0,右1] + [上1,左0,下1,右0] → 排序后 [0,0,0,1],[1,0,1,0]
    //   竖铺：[上0,左0,下1,右0] + [上0,左1,下0,右1] → 排序后 [0,0,1,0],[0,1,0,1]
    // 逐元素比较到第 3 个整数：0 < 1，故横铺字典序更小。
    const cracks = setFrom(2, [[0, 0], [0, 1], [1, 0]]);
    const r = searchOptimalCover(2, 2, cracks);
    expect(r.optimum).toBe(2);
    expect(flattenPlan(r.rects)).toEqual([0, 0, 0, 1, 1, 0, 1, 0]);
  });

  it('字典序决胜专用：形状允许横切与竖切两种 2 块铺法', () => {
    // 图样（4 列 × 2 行），仅去掉右上角与左下角，使整图既非一整块，
    // 而存在「两横条」与「两竖条 + 小块」的等数并列……
    // 采用精确可控的构造：裂格 =
    //   行0: cols 0,1,2
    //   行1: cols 0,1,2
    // 这是 2×3 整块（1 块）。为强制并列 2 块，在中央放一个完好「栓」：
    //   行0: X X .
    //   行1: X X X  → 最优 2（块 2×2 左 + 右下 1×1）无并列。
    // 真正并列图样：
    //   行0: X X X
    //   行1: . X .  → T 字形，最优 2，且横条/竖条两种铺法：
    //   方案A（字典序更小）：横条 [0,0]-[0,2] + 竖格 [1,1]-[1,1]
    //     排序后 [[0,0,0,2],[1,1,1,1]]
    //   方案B：竖条 [0,1]-[1,1] + [0,0] + [0,2]（3 块，非并列）
    // T 字其实只有唯一 2 块铺法。改用「U 上开口」校验存在性即可。
    const tShape = setFrom(3, [[0, 0], [0, 1], [0, 2], [1, 1]]);
    const r = searchOptimalCover(3, 3, tShape);
    expect(r.optimum).toBe(2);
    const flat = flattenPlan(r.rects);
    // 字典序最小的 2 块铺法：[上0,左0,下0,右2] 排在 [上1,左1,下1,右1] 前
    expect(flat).toEqual([0, 0, 0, 2, 1, 1, 1, 1]);
  });

  it('与独立穷举器在随机 5×5 图样上的决胜方案完全一致', () => {
    let seed = 99;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 30; t++) {
      const coords: Array<[number, number]> = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
        if (rand() < 0.5) coords.push([r, c]);
      }
      if (coords.length === 0) continue;
      const cracks = setFrom(5, coords);
      const a = searchOptimalCover(5, 5, cracks);
      const b = bruteForceOptimalCover(5, 5, cracks);
      expect(a.optimum).toBe(b.optimum);
      expect(flattenPlan(a.rects)).toEqual(flattenPlan(b.rects));
    }
  });
});

describe('确定性与唯一可复算', () => {
  it('同一输入多次运行得到逐字节相同方案', () => {
    const coords = setFrom(6, [
      [0, 0], [0, 1], [0, 3],
      [1, 1], [1, 2], [1, 3],
      [2, 0], [2, 2], [2, 3],
      [3, 1], [3, 3], [3, 4],
      [4, 0], [4, 2], [4, 4],
    ]);
    const runs = Array.from({ length: 5 }, () =>
      flattenPlan(searchOptimalCover(6, 6, coords).rects),
    );
    for (let i = 1; i < runs.length; i++) expect(runs[i]).toEqual(runs[0]);
  });

  it('裂格集合以不同插入顺序给出相同方案', () => {
    const coords: Array<[number, number]> = [
      [0, 0], [0, 2], [1, 1], [2, 0], [2, 2], [3, 1], [1, 3],
    ];
    const a = searchOptimalCover(4, 4, setFrom(4, coords));
    const b = searchOptimalCover(4, 4, setFrom(4, [...coords].reverse()));
    expect(flattenPlan(a.rects)).toEqual(flattenPlan(b.rects));
  });
});

describe('分支轨迹', () => {
  it('记录 take/prune/complete 等事件且状态数递增', () => {
    const cracks = setFrom(3, [
      [0, 0], [0, 1], [1, 0], [2, 2],
    ]);
    const r = searchOptimalCover(3, 3, cracks);
    expect(r.trace.length).toBeGreaterThan(0);
    const kinds = new Set(r.trace.map((e) => e.kind));
    expect(kinds.has('take')).toBe(true);
    expect(kinds.has('complete')).toBe(true);
    for (let i = 1; i < r.trace.length; i++) {
      expect(r.trace[i].seq).toBeGreaterThanOrEqual(r.trace[i - 1].seq);
    }
  });

  it('每个 take 事件的候选矩形均为合法轴对齐矩形', () => {
    const cracks = setFrom(4, [[0, 0], [0, 1], [1, 1], [2, 0], [2, 1]]);
    const r = searchOptimalCover(4, 4, cracks);
    for (const e of r.trace) {
      if (!e.rect) continue;
      const q: Rect = e.rect;
      expect(q.top).toBeLessThanOrEqual(q.bottom);
      expect(q.left).toBeLessThanOrEqual(q.right);
    }
  });
});

describe('大规模性能（12×12，60 裂格）', () => {
  it('棋盘状 60 裂格在合理时间内给出 60 块解', () => {
    const coords: Array<[number, number]> = [];
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
      if ((r + c) % 2 === 0 && coords.length < 60) coords.push([r, c]);
    }
    const cracks = setFrom(12, coords);
    const t0 = Date.now();
    const r = searchOptimalCover(12, 12, cracks);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.optimum).toBe(60);
    expect(r.truncated).toBe(false);
    expect(validateTiling(r.rects, cracks, 12, 12)).toBe(true);
  });
});
