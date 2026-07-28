import { describe, expect, it, vi } from 'vitest';
import { CharacterVisualPool } from '../src/render/characters/visual_pool';

describe('CharacterVisualPool', () => {
  it('reuses matching visuals and resets them before acquisition', () => {
    const reset = vi.fn();
    const dispose = vi.fn();
    const pool = new CharacterVisualPool(2, { reset, dispose });
    const visual = { id: 1 };
    pool.release('mage', visual);
    expect(pool.acquire('mage')).toBe(visual);
    expect(reset).toHaveBeenCalledWith(visual);
    expect(pool.size).toBe(0);
  });

  it('evicts the global least recently released visual at a finite cap', () => {
    const dispose = vi.fn();
    const pool = new CharacterVisualPool<{ id: number }>(2, {
      reset: vi.fn(),
      dispose,
    });
    pool.release('a', { id: 1 });
    pool.release('b', { id: 2 });
    pool.release('c', { id: 3 });
    expect(pool.size).toBe(2);
    expect(dispose).toHaveBeenCalledWith({ id: 1 });
  });
});
