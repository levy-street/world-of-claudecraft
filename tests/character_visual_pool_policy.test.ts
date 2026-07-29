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

  it('preserves the desktop unbounded-pool behavior', () => {
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
    expect(store).toContain(
      'shouldRetainPooledCharacterVisual(this.pooledVisualCount, GFX.maxPooledCharacterVisuals)',
    );
    expect(take).toContain('this.pooledVisualCount = Math.max(0, this.pooledVisualCount - 1)');
    expect(store).toContain('visual.dispose();');
    expect(store).toContain('this.pooledVisualCount++;');
    expect(store.indexOf('visual.dispose();')).toBeLessThan(
      store.indexOf('this.pooledVisualCount++;'),
    );
  });
});
