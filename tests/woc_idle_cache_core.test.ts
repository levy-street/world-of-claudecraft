// The idle caps of the derived WOC caches (src/render/characters/woc_idle_cache_core.ts;
// PR 4360 review, N20): how many far bakes, merged heads and merged kits each cache keeps
// with nobody drawing them. A constrained profile (every phone, every iOS host) keeps far
// fewer: what a crowd leaves behind is the last thing worth holding near a memory ceiling.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { wocIdleCacheCaps } from '../src/render/characters/woc_idle_cache_core';

describe('the idle caps of the WOC caches', () => {
  it('keeps the roomy caps on an unconstrained profile', () => {
    expect(wocIdleCacheCaps(false)).toEqual({ farBakes: 32, mergedHeads: 12, mergedArmor: 16 });
  });

  it('keeps far fewer idle builds on a constrained profile, and never none', () => {
    const phone = wocIdleCacheCaps(true);
    expect(phone).toEqual({ farBakes: 8, mergedHeads: 4, mergedArmor: 4 });
    const desktop = wocIdleCacheCaps(false);
    for (const cache of ['farBakes', 'mergedHeads', 'mergedArmor'] as const) {
      // a look that walks back into view is still served from the cache
      expect(phone[cache], cache).toBeGreaterThan(0);
      expect(phone[cache], cache).toBeLessThan(desktop[cache]);
    }
  });

  it.each([
    ['woc_far_bake.ts', 'wocIdleCacheCaps(GFX.constrainedMemory).farBakes'],
    ['woc_head_merge.ts', 'wocIdleCacheCaps(GFX.constrainedMemory).mergedHeads'],
    ['woc_armor_merge.ts', 'wocIdleCacheCaps(GFX.constrainedMemory).mergedArmor'],
  ])('%s trims to its cap of the STATIC memory class', (file, read) => {
    // each cache asks at trim time, of the static profile only (never the governor); the
    // head cache is also driven through a constrained profile in tests/woc_head_merge.test.ts
    const source = readFileSync(
      path.resolve(__dirname, '..', 'src', 'render', 'characters', file),
      'utf8',
    );
    expect(source).toContain(read);
    expect(source).not.toMatch(/MAX_IDLE_(BAKES|MERGES)\b/);
  });
});
