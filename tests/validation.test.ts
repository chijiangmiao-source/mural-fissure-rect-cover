import { describe, expect, it } from 'vitest';
import { canAddCrack, validateCracks, validateGridSize } from '../src/lib/validation';

describe('validateGridSize', () => {
  it('接受 1–12 的整数', () => {
    expect(validateGridSize(1, 12).ok).toBe(true);
    expect(validateGridSize('12', '1').ok).toBe(true);
  });

  it('拒绝非整数', () => {
    const r = validateGridSize(2.5, 'abc');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('not-integer');
    expect(r.message).toContain('整数');
    expect(r.message).toContain('旧方案已清除');
  });

  it('拒绝越界尺寸并给出明确原因', () => {
    const r = validateGridSize(13, 0);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('out-of-range');
    expect(r.message).toContain('1–12');
    expect(r.message).toContain('旧方案已清除');
  });
});

describe('validateCracks', () => {
  it('接受合法裂格', () => {
    expect(validateCracks(new Set([0, 5, 15]), { width: 4, height: 4 }).ok).toBe(true);
  });

  it('拒绝越界裂格索引', () => {
    const r = validateCracks(new Set([16]), { width: 4, height: 4 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('crack-out-of-bounds');
    expect(r.message).toContain('越界');
  });

  it('拒绝超过 60 个裂格', () => {
    const r = validateCracks(new Set(Array.from({ length: 61 }, (_, i) => i)), { width: 12, height: 12 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('too-many-cracks');
    expect(r.message).toContain('60');
  });
});

describe('canAddCrack', () => {
  it('未达上限允许添加', () => {
    expect(canAddCrack(59).ok).toBe(true);
  });
  it('达到上限拒绝并说明', () => {
    const r = canAddCrack(60);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('60');
  });
});
