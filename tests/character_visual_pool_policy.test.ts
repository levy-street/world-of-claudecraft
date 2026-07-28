import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldRetainPooledCharacterVisual } from '../src/render/characters/visual_pool_policy';

describe('character visual pool residency policy', () => {
  it('retains visuals only while the global pool is below its bound', () => {
    expect(shouldRetainPooledCharacterVisual(0, 6)).toBe(true);
    expect(shouldRetainPooledCharacterVisual(5, 6)).toBe(true);
    expect(shouldRetainPooledCharacterVisual(6, 6)).toBe(false);
    expect(shouldRetainPooledCharacterVisual(7, 6)).toBe(false);
  });

  it('keeps an explicit unbounded compatibility mode for external callers', () => {
    expect(shouldRetainPooledCharacterVisual(10_000, Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('rejects invalid or disabled capacities', () => {
    expect(shouldRetainPooledCharacterVisual(0, 0)).toBe(false);
    expect(shouldRetainPooledCharacterVisual(0, Number.NaN)).toBe(false);
  });

  it('is enforced by the renderer pool take and store paths', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const takeStart = renderer.indexOf('private takePooledVisual(');
    const storeStart = renderer.indexOf('private storePooledVisual(', takeStart);
    const storeEnd = renderer.indexOf('\n  private ', storeStart + 1);
    const take = renderer.slice(takeStart, storeStart);
    const store = renderer.slice(storeStart, storeEnd);

    expect(takeStart).toBeGreaterThan(-1);
    expect(storeStart).toBeGreaterThan(takeStart);
    expect(renderer).toContain('new CharacterVisualPool<CharacterVisual>');
    expect(take).toContain('this.visualPool.acquire(key)');
    expect(store).toContain('this.visualPool.release(key, visual)');
    expect(renderer).toContain('pooledVisuals: this.visualPool.size');
    expect(renderer).not.toContain('private pooledVisualCount');
  });
});
