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

  it('supports an unbounded cap (the ground-object pool desktop configuration)', () => {
    expect(shouldRetainPooledCharacterVisual(10_000, Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('rejects invalid or disabled capacities', () => {
    expect(shouldRetainPooledCharacterVisual(0, 0)).toBe(false);
    expect(shouldRetainPooledCharacterVisual(0, Number.NaN)).toBe(false);
  });

  it('is enforced by the renderer pool take, store, and teardown paths', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const lifecycle = readFileSync(
      new URL('../src/render/characters/pooled_visual_lifecycle.ts', import.meta.url),
      'utf8',
    );
    // The character pool routes every release through the bounded LRU store
    // (which evicts + disposes least-recently-released overflow under the
    // live GFX cap; see tests/character_visual_pool.test.ts for its unit
    // behavior), and every acquire through the pool take: both halves live in
    // PooledVisualLifecycle, which the renderer binds ONCE to its pool and to
    // the live cap, and every renderer take/store goes through that binding.
    expect(lifecycle).toContain('this.pool.store(key, visual, this.host.maxPooled())');
    expect(lifecycle).toContain('this.pool.take(key)');
    expect(renderer).toContain('new PooledVisualLifecycle(this.visualPool, {');
    expect(renderer).toContain('maxPooled: () => GFX.maxPooledCharacterVisuals,');
    expect(renderer).toContain('this.pooledVisuals.take(visualPoolKey, e.color)');
    expect(renderer).toContain('this.pooledVisuals.store(v.visualPoolKey, v.visual)');
    expect(renderer).not.toMatch(/this\.visualPool\.(take|store)\(/);
    // Terminal teardown drains the pool and really disposes every visual.
    expect(renderer).toContain(
      'for (const visual of this.visualPool.drain()) bestEffort(() => visual.dispose());',
    );
    // The ground-object pool still gates retention on this policy predicate.
    expect(renderer).toContain(
      'shouldRetainPooledCharacterVisual(this.pooledObjectCount, GFX.maxPooledObjects)',
    );
  });
});
