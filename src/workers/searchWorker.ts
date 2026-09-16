// 搜索 Worker：把可能较耗时的精确搜索 / 改造求解移出主线程，保证界面交互不卡顿。
//
// 消息契约（求解器 ↔ Worker ↔ React 状态共同传递基线与改造结果）：
//  - { type: 'search', width, height, cracks }          → { type: 'search', result: SearchResult }
//  - { type: 'renovate', width, height, cracks, baseline } → { type: 'renovate', result: RenovationPlan }
/// <reference lib="webworker" />
import { Rect } from '../lib/rect';
import { RenovationPlan, planRenovation } from '../lib/renovation';
import { SearchResult, searchOptimalCover } from '../lib/solver';

export type SearchWorkerRequest =
  | { type: 'search'; width: number; height: number; cracks: number[] }
  | { type: 'renovate'; width: number; height: number; cracks: number[]; baseline: Rect[] };

export type SearchWorkerResponse =
  | { type: 'search'; result: SearchResult }
  | { type: 'renovate'; result: RenovationPlan };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<SearchWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'renovate') {
    const result = planRenovation(msg.width, msg.height, new Set(msg.cracks), msg.baseline);
    const response: SearchWorkerResponse = { type: 'renovate', result };
    ctx.postMessage(response);
    return;
  }
  const result = searchOptimalCover(msg.width, msg.height, new Set(msg.cracks));
  const response: SearchWorkerResponse = { type: 'search', result };
  ctx.postMessage(response);
};
