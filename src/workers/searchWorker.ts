// 搜索 Worker：把可能较耗时的精确搜索移出主线程，保证界面交互不卡顿。
/// <reference lib="webworker" />
import { searchOptimalCover } from '../lib/solver';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface SearchRequest {
  width: number;
  height: number;
  cracks: number[];
}

ctx.onmessage = (ev: MessageEvent<SearchRequest>) => {
  const { width, height, cracks } = ev.data;
  const result = searchOptimalCover(width, height, new Set(cracks));
  ctx.postMessage(result);
};
