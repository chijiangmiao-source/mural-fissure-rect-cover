import { useCallback, useMemo, useRef, useState } from 'react';
import {
  GridSize,
  MAX_CRACKS,
  MAX_SIDE,
  MIN_SIDE,
  Rect,
  rectId,
  rectLabel,
  sortRects,
} from './lib/rect';
import {
  BranchEvent,
  BranchKind,
  SearchResult,
  searchOptimalCover,
} from './lib/solver';
import { canAddCrack, validateCracks, validateGridSize } from './lib/validation';

const CELL = 44; // 每格像素
const PALETTE = [
  '#d97757', '#5e8b7e', '#6a7fdb', '#c9a227', '#8f6a9f',
  '#4f9d9d', '#c06c84', '#7a9e4b', '#b57134', '#5078a8',
  '#9b5de5', '#f15bb5',
];

const KIND_TEXT: Record<BranchKind, string> = {
  take: '采用分支',
  'prune-lb': '下界剪枝',
  'prune-cut': '放置后超限，回溯',
  'prune-memo': '同态记忆剪枝',
  deadend: '死路',
  complete: '得到完整方案',
  greedy: '贪心初始上界',
};

function rectColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

export default function App() {
  // 已生效的网格尺寸
  const [size, setSize] = useState<GridSize>({ width: 4, height: 4 });
  // 输入框文本（允许暂时非法，提交时统一校验）
  const [widthText, setWidthText] = useState('4');
  const [heightText, setHeightText] = useState('4');
  const [cracks, setCracks] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [traceIndex, setTraceIndex] = useState(0);
  const [replayOn, setReplayOn] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const total = size.width * size.height;

  const clearSolution = useCallback((msg: string | null) => {
    setResult(null);
    setTraceIndex(0);
    setReplayOn(false);
    setNotice(msg);
  }, []);

  const enterReplay = (idx: number | ((i: number) => number)) => {
    setReplayOn(true);
    setTraceIndex(idx);
  };

  // ---- 尺寸应用：非法输入清除旧解并说明原因 ----
  const applySize = () => {
    const v = validateGridSize(widthText, heightText);
    if (!v.ok) {
      setError(v.message);
      clearSolution('尺寸非法，旧解已清除。');
      return;
    }
    const w = Number(widthText);
    const h = Number(heightText);
    setError(null);
    setSize({ width: w, height: h });
    // 裁剪越界裂格（正常点击不会产生，这里防御性处理）
    setCracks((prev) => {
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx >= 0 && idx < w * h) next.add(idx);
      });
      return next;
    });
    clearSolution('网格尺寸已变更，旧解已清除，请重新搜索。');
  };

  // ---- 点击切换裂格 ----
  const toggleCell = (idx: number) => {
    if (searching) return;
    if (!cracks.has(idx)) {
      const guard = canAddCrack(cracks.size);
      if (!guard.ok) {
        setError(guard.message);
        return;
      }
    }
    const next = new Set(cracks);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setCracks(next);
    setError(null);
    clearSolution('裂格已变更，旧解已清除，请重新搜索。');
  };

  // ---- 预设图样（孔洞、狭枝、并列、贪心反例） ----
  const loadPreset = (name: 'hole' | 'branch' | 'tie' | 'greedy') => {
    let w = size.width;
    let h = size.height;
    const set = new Set<number>();
    const add = (r: number, c: number) => set.add(r * w + c);
    if (name === 'hole') {
      // 3×3 环：中心是完好格（孔洞）
      w = 3; h = 3;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!(r === 1 && c === 1)) add(r, c);
    } else if (name === 'branch') {
      // 十字狭枝
      w = 5; h = 5;
      for (let i = 0; i < 5; i++) { add(2, i); add(i, 2); }
    } else if (name === 'tie') {
      // 并列决胜示例：2×2 缺右下的 L 形三格。
      // 横铺（顶行横条 + 左下）与竖铺（左列竖条 + 右上）并列 2 块，字典序取横铺。
      w = 2; h = 2;
      add(0, 0); add(0, 1); add(1, 0);
    } else {
      // 贪心反例：行0仅中间两格、行1-3全满。
      // 局部贪心先吃 3×2 竖块 → 3 块；精确最优为「顶部横条 + 下部整块」→ 2 块。
      w = 4; h = 4;
      add(0, 1); add(0, 2);
      for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) add(r, c);
    }
    setWidthText(String(w));
    setHeightText(String(h));
    setSize({ width: w, height: h });
    setCracks(set);
    setError(null);
    clearSolution('已载入预设图样，请点击「开始精确搜索」。');
  };

  const clearAll = () => {
    setCracks(new Set());
    setError(null);
    clearSolution('已清空全部裂格，旧解已清除。');
  };

  // ---- 执行搜索（Web Worker，避免阻塞界面；小问题直接同步也行，此处统一走 Worker） ----
  const runSearch = () => {
    const sizeV = validateGridSize(size.width, size.height);
    if (!sizeV.ok) {
      setError(sizeV.message);
      clearSolution(null);
      return;
    }
    const crackV = validateCracks(cracks, size);
    if (!crackV.ok) {
      setError(crackV.message);
      clearSolution(null);
      return;
    }
    if (cracks.size === 0) {
      setError('请先点击格子标记至少一个裂格。');
      clearSolution(null);
      return;
    }
    setError(null);
    setNotice(null);
    setSearching(true);
    setResult(null);

    // 12×12/60 裂格规模下主搜索为毫秒级；Worker 失败时回退同步执行，保证可用性。
    try {
      const worker = new Worker(new URL('./workers/searchWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      const timer = setTimeout(() => {
        worker.terminate();
        fallbackSync();
      }, 8000);
      worker.onmessage = (ev: MessageEvent<SearchResult>) => {
        clearTimeout(timer);
        worker.terminate();
        workerRef.current = null;
        finishSearch(ev.data);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        workerRef.current = null;
        fallbackSync();
      };
      worker.postMessage({ width: size.width, height: size.height, cracks: [...cracks] });
    } catch {
      fallbackSync();
    }
  };

  const fallbackSync = () => {
    const r = searchOptimalCover(size.width, size.height, cracks);
    finishSearch(r);
  };

  const finishSearch = (r: SearchResult) => {
    setSearching(false);
    if (r.truncated) {
      setError('搜索达到状态数上限被截断：当前结果不能保证最优，请缩小问题规模后重试。');
      setResult(null);
      return;
    }
    setResult(r);
    setTraceIndex(r.trace.length > 0 ? r.trace.length - 1 : 0);
    setReplayOn(false);
    setNotice(null);
  };

  // ---- 分支回放 ----
  const trace: BranchEvent[] = result?.trace ?? [];
  const currentEvent = replayOn ? trace[traceIndex] ?? null : null;
  const replayRect = currentEvent?.rect ?? null;
  const replayAnchor = currentEvent?.anchor ?? null;
  const anchorText =
    currentEvent && currentEvent.anchor.row >= 0
      ? `行${currentEvent.anchor.row + 1} 列${currentEvent.anchor.col + 1}`
      : '—';

  const sortedRects: Rect[] = useMemo(
    () => (result ? sortRects(result.rects) : []),
    [result],
  );

  // 最终贴片按坐标查颜色（保持与列表一致）；键为内部 0 起坐标 id，不随展示偏移变化
  const rectColorMap = useMemo(() => {
    const m = new Map<string, string>();
    sortedRects.forEach((r, i) => m.set(rectId(r), rectColor(i)));
    return m;
  }, [sortedRects]);

  const wPx = size.width * CELL;
  const hPx = size.height * CELL;

  return (
    <div className="app">
      <header>
        <h1>壁画裂隙矩形贴片精确加固</h1>
        <p className="subtitle">
          最少贴片数的精确状态空间搜索；并列时按「上、左、下、右」整数序列字典序决胜。
          贴片沿格线放置、只覆盖裂格、互不重叠，且并集恰为全部裂格。
        </p>
      </header>

      <section className="panel controls" aria-label="网格设置">
        <label>
          宽（列，{MIN_SIDE}–{MAX_SIDE}）
          <input
            data-testid="width-input"
            type="number"
            min={MIN_SIDE}
            max={MAX_SIDE}
            value={widthText}
            onChange={(e) => setWidthText(e.target.value)}
          />
        </label>
        <label>
          高（行，{MIN_SIDE}–{MAX_SIDE}）
          <input
            data-testid="height-input"
            type="number"
            min={MIN_SIDE}
            max={MAX_SIDE}
            value={heightText}
            onChange={(e) => setHeightText(e.target.value)}
          />
        </label>
        <button data-testid="apply-size" onClick={applySize} disabled={searching}>
          应用尺寸
        </button>
        <span className="count" data-testid="crack-count">
          裂格 {cracks.size} / {MAX_CRACKS}（网格共 {total} 格）
        </span>
        <span className="spacer" />
        <button onClick={() => loadPreset('hole')} disabled={searching}>预设：孔洞</button>
        <button onClick={() => loadPreset('branch')} disabled={searching}>预设：狭枝</button>
        <button onClick={() => loadPreset('tie')} disabled={searching}>预设：并列决胜</button>
        <button onClick={() => loadPreset('greedy')} disabled={searching}>预设：贪心反例</button>
        <button onClick={clearAll} disabled={searching}>清空裂格</button>
      </section>

      {error && (
        <div className="banner error" data-testid="error-banner" role="alert">
          ⚠ {error}
        </div>
      )}
      {notice && !error && (
        <div className="banner notice" data-testid="notice-banner">
          ℹ {notice}
        </div>
      )}

      <section className="main">
        <div className="panel board-panel">
          <svg
            data-testid="board"
            width={wPx}
            height={hPx}
            viewBox={`0 0 ${wPx} ${hPx}`}
            role="img"
            aria-label="裂隙网格"
          >
            {/* 单元格 */}
            {Array.from({ length: size.height }, (_, row) =>
              Array.from({ length: size.width }, (_, col) => {
                const idx = row * size.width + col;
                const isCrack = cracks.has(idx);
                return (
                  <rect
                    key={`c-${idx}`}
                    data-testid={`cell-${row}-${col}`}
                    data-crack={isCrack ? '1' : '0'}
                    x={col * CELL}
                    y={row * CELL}
                    width={CELL}
                    height={CELL}
                    className={isCrack ? 'cell crack' : 'cell intact'}
                    onClick={() => toggleCell(idx)}
                  >
                    <title>{`行${row + 1} 列${col + 1}：${isCrack ? '裂格' : '完好格'}（点击切换）`}</title>
                  </rect>
                );
              }),
            )}

            {/* 最终贴片 */}
            {sortedRects.map((r, i) => {
              const key = rectId(r);
              return (
                <rect
                  key={`r-${key}`}
                  data-testid={`patch-${i}`}
                  x={r.left * CELL + 3}
                  y={r.top * CELL + 3}
                  width={(r.right - r.left + 1) * CELL - 6}
                  height={(r.bottom - r.top + 1) * CELL - 6}
                  rx={6}
                  className="patch"
                  fill={rectColorMap.get(key)}
                  opacity={replayOn ? 0.25 : 0.82}
                  stroke={rectColorMap.get(key)}
                  strokeWidth={2}
                >
                  <title>{`贴片 ${i + 1}：${rectLabel(r)}`}</title>
                </rect>
              );
            })}

            {/* 分支回放高亮 */}
            {replayRect && (
              <rect
                data-testid="replay-rect"
                x={replayRect.left * CELL + 1}
                y={replayRect.top * CELL + 1}
                width={(replayRect.right - replayRect.left + 1) * CELL - 2}
                height={(replayRect.bottom - replayRect.top + 1) * CELL - 2}
                className="replay-rect"
                fill="none"
                stroke="#111"
                strokeWidth={3}
                strokeDasharray="7 4"
              />
            )}
            {replayAnchor && replayAnchor.row >= 0 && (
              <circle
                data-testid="replay-anchor"
                cx={replayAnchor.col * CELL + CELL / 2}
                cy={replayAnchor.row * CELL + CELL / 2}
                r={6}
                className="replay-anchor"
              />
            )}
          </svg>
          <p className="hint">点击格子切换「裂格 / 完好格」；深色为裂格，彩色块为最终贴片。</p>
        </div>

        <div className="side">
          <section className="panel">
            <button
              data-testid="solve-button"
              className="primary"
              onClick={runSearch}
              disabled={searching || cracks.size === 0}
            >
              {searching ? '搜索中…' : '开始精确搜索'}
            </button>
            {searching && <span data-testid="searching" className="searching"> 正在搜索状态空间…</span>}

            {result && (
              <dl className="stats" data-testid="stats">
                <dt>最优贴片数</dt>
                <dd data-testid="optimum">{result.optimum}</dd>
                <dt>贪心对照（局部最大块）</dt>
                <dd data-testid="greedy-count">{result.greedyCount} 块{result.greedyCount > result.optimum ? '（贪心多耗 ' + (result.greedyCount - result.optimum) + ' 块）' : ''}</dd>
                <dt>搜索状态数</dt>
                <dd data-testid="states">{result.states}</dd>
                <dt>耗时</dt>
                <dd>{result.elapsedMs.toFixed(2)} ms</dd>
              </dl>
            )}
          </section>

          {result && (
            <section className="panel" data-testid="patch-list-panel">
              <h2>各贴片坐标（上/左/下/右，自 1 起）</h2>
              <ol className="patch-list" data-testid="patch-list">
                {sortedRects.map((r, i) => (
                  <li key={rectId(r)} data-testid={`patch-item-${i}`}>
                    <span className="swatch" style={{ background: rectColor(i) }} />
                    贴片 {i + 1}：上 {r.top + 1}，左 {r.left + 1}，下 {r.bottom + 1}，右 {r.right + 1}
                    <span className="muted">（{rectLabel(r)}，{(r.bottom - r.top + 1) * (r.right - r.left + 1)} 格）</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

            {result && trace.length > 0 && (
            <section className="panel" data-testid="trace-panel">
              <h2>分支取舍回放（{trace.length} 条记录{result.traceTruncated ? '，已压缩' : ''}）</h2>
              {result.traceTruncated && (
                <div className="muted" data-testid="trace-truncated">
                  搜索状态较多，轨迹仅保留前段过程与最终落定；完整统计以「搜索状态数」为准。
                </div>
              )}
              <div className="replay-controls">
                <button data-testid="trace-first" onClick={() => enterReplay(0)}>⏮</button>
                <button
                  data-testid="trace-prev"
                  onClick={() => enterReplay((i) => Math.max(0, i - 1))}
                  disabled={!replayOn || traceIndex === 0}
                >
                  ◀ 上一步
                </button>
                <input
                  data-testid="trace-slider"
                  type="range"
                  min={0}
                  max={trace.length - 1}
                  value={traceIndex}
                  onChange={(e) => enterReplay(Number(e.target.value))}
                />
                <button
                  data-testid="trace-next"
                  onClick={() => enterReplay((i) => Math.min(trace.length - 1, i + 1))}
                  disabled={!replayOn || traceIndex === trace.length - 1}
                >
                  下一步 ▶
                </button>
                <button data-testid="trace-last" onClick={() => enterReplay(trace.length - 1)}>⏭</button>
                <button data-testid="trace-exit" onClick={() => setReplayOn(false)} disabled={!replayOn}>
                  返回最终方案
                </button>
              </div>
              {!replayOn ? (
                <div className="trace-info" data-testid="trace-info">
                  <div><strong>最终方案</strong></div>
                  <div className="muted">点击上方控件逐步查看搜索过程中的分支取舍与剪枝原因。</div>
                </div>
              ) : (
                <div className="trace-info" data-testid="trace-info">
                  <div>
                    <strong>第 {traceIndex + 1} / {trace.length} 步</strong>
                    <span className={`kind kind-${currentEvent?.kind}`}>
                      {currentEvent ? KIND_TEXT[currentEvent.kind] : ''}
                    </span>
                  </div>
                  <div className="muted">
                    深度 {currentEvent?.depth}　锚点 {anchorText}
                    　已用 {currentEvent?.used}　下界 {currentEvent?.lowerBound}
                    　当前最优 {currentEvent?.incumbent ?? '—'}
                  </div>
                  {currentEvent?.rect && (
                    <div>
                      候选矩形：{rectLabel(currentEvent.rect)}
                    </div>
                  )}
                  {currentEvent?.reason && <div className="reason">{currentEvent.reason}</div>}
                </div>
              )}
            </section>
            )}
        </div>
      </section>

      <footer className="muted">
        所有计算均在浏览器本地完成，无业务后端、无外部在线调用。
      </footer>
    </div>
  );
}
