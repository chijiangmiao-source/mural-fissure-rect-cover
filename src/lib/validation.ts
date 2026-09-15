// 输入校验：网格尺寸与裂格集合的合法性检查，产生明确错误反馈。
import { GridSize, MAX_CRACKS, MAX_SIDE, MIN_SIDE } from './rect';

export type ValidationCode =
  | 'not-integer'
  | 'out-of-range'
  | 'too-many-cracks'
  | 'crack-out-of-bounds'
  | 'duplicate-crack'
  | 'ok';

export interface ValidationResult {
  ok: boolean;
  code: ValidationCode;
  message: string;
}

export function validateGridSize(width: unknown, height: unknown): ValidationResult {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    return {
      ok: false,
      code: 'not-integer',
      message: `网格尺寸必须是整数（当前：宽=${String(width)}，高=${String(height)}）。请重新输入 1–12 的整数，旧方案已清除。`,
    };
  }
  if (
    w < MIN_SIDE || w > MAX_SIDE ||
    h < MIN_SIDE || h > MAX_SIDE
  ) {
    return {
      ok: false,
      code: 'out-of-range',
      message: `网格尺寸超出范围：宽、高都必须在 ${MIN_SIDE}–${MAX_SIDE} 之间（当前：宽=${w}，高=${h}）。旧方案已清除。`,
    };
  }
  return { ok: true, code: 'ok', message: '' };
}

/**
 * 校验裂格索引集合。
 * @param cracks 单元格索引 row*width+col 的集合
 */
export function validateCracks(
  cracks: ReadonlySet<number>,
  size: GridSize,
): ValidationResult {
  const { width, height } = size;
  const total = width * height;
  for (const idx of cracks) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= total) {
      return {
        ok: false,
        code: 'crack-out-of-bounds',
        message: `存在越界裂格索引 ${idx}（合法范围 0–${total - 1}，网格 ${width}×${height}）。旧方案已清除。`,
      };
    }
  }
  if (cracks.size > MAX_CRACKS) {
    return {
      ok: false,
      code: 'too-many-cracks',
      message: `裂格数量 ${cracks.size} 超过上限 ${MAX_CRACKS}。请减少裂格，旧方案已清除。`,
    };
  }
  return { ok: true, code: 'ok', message: '' };
}

/** 切换某格时预判是否会超过裂格上限（用于界面即时反馈） */
export function canAddCrack(currentCount: number): { ok: boolean; message: string } {
  if (currentCount >= MAX_CRACKS) {
    return {
      ok: false,
      message: `裂格最多 ${MAX_CRACKS} 个：无法继续添加。可先取消其它裂格。旧方案已清除。`,
    };
  }
  return { ok: true, message: '' };
}
