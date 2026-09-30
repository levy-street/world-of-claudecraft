// Which cached composed bodies the variant cache lets go of, and in what order
// (src/render/characters/composed_variant_residency_core.ts; the cache itself
// is characters/assets.ts modularVariantCache).
//
// Two contracts, and the second is the one a refactor would break quietly:
// - on the iOS memory profile the IDLE entries are bounded (16, 8 on the tight
//   rung), least recently SEEN first, and an entry a character is drawn from is
//   never named whatever the bounds say;
// - on every other profile (desktop, Android) the decision is exactly the
//   historical total-cap sweep: the same keys, in the same order, for any cache
//   state. That one is pinned against a verbatim copy of the pre-bound sweep.
import { describe, expect, it } from 'vitest';
import {
  COMPOSED_VARIANT_CACHE_MAX,
  COMPOSED_VARIANT_IDLE_MAX_IOS,
  COMPOSED_VARIANT_IDLE_MAX_TIGHT,
  type ComposedVariantResidency,
  composedVariantBounds,
  composedVariantEvictions,
} from '../src/render/characters/composed_variant_residency_core';
import { gfxInternalsForTest } from '../src/render/gfx';

type Entry = { refs: number; seenAt: number };

/** The eviction loop as it stood before the idle bound, over plain entries:
 *  cache order, idle only, until the size is back under the cap. */
function historicalSweep(cache: Map<string, Entry>, max: number): string[] {
  const out: string[] = [];
  let size = cache.size;
  if (size <= max) return out;
  for (const [key, entry] of cache) {
    if (size <= max) break;
    if (entry.refs > 0) continue;
    out.push(key);
    size--;
  }
  return out;
}

/** Deterministic cache states: a seeded LCG, never Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomCache(rand: () => number, size: number, liveShare: number): Map<string, Entry> {
  const cache = new Map<string, Entry>();
  // seenAt is a permutation, so recency and cache order disagree, as they do
  // once a release restamps an entry without moving it.
  const stamps = Array.from({ length: size }, (_, i) => i + 1);
  for (let i = stamps.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [stamps[i], stamps[j]] = [stamps[j], stamps[i]];
  }
  for (let i = 0; i < size; i++) {
    cache.set(`look${i}`, {
      refs: rand() < liveShare ? 1 + Math.floor(rand() * 3) : 0,
      seenAt: stamps[i],
    });
  }
  return cache;
}

function cacheOf(entries: Array<[string, number, number]>): Map<string, Entry> {
  return new Map(entries.map(([key, refs, seenAt]) => [key, { refs, seenAt }]));
}

const IOS = { iosMemoryProfile: true, tightMemory: false };
const TIGHT = { iosMemoryProfile: true, tightMemory: true };
const DESKTOP = { iosMemoryProfile: false, tightMemory: false };

describe('composedVariantBounds', () => {
  it('bounds the idle entries on the iOS profile, tighter on the tight rung, total cap kept', () => {
    expect(composedVariantBounds(IOS)).toEqual({ maxTotal: 96, maxIdle: 16 });
    expect(composedVariantBounds(TIGHT)).toEqual({ maxTotal: 96, maxIdle: 8 });
    expect(COMPOSED_VARIANT_CACHE_MAX).toBe(96);
    expect(COMPOSED_VARIANT_IDLE_MAX_IOS).toBe(16);
    expect(COMPOSED_VARIANT_IDLE_MAX_TIGHT).toBe(8);
  });

  it('keeps the historical rule everywhere else: the total cap alone', () => {
    const bounds = composedVariantBounds(DESKTOP);
    expect(bounds.maxTotal).toBe(96);
    expect(bounds.maxIdle).toBe(Number.POSITIVE_INFINITY);
  });

  it('never bounds a platform that is not iOS, even one flagged tight', () => {
    // The tight rung is an iOS rung today; a tightMemory flag another platform
    // grows later must not silently turn the idle bound on there.
    const bounds = composedVariantBounds({ iosMemoryProfile: false, tightMemory: true });
    expect(bounds.maxIdle).toBe(Number.POSITIVE_INFINITY);
    expect(bounds.maxTotal).toBe(96);
  });

  it('reads the real GFX profiles: only iOS WebKit hosts get an idle bound', () => {
    const { settingsFor } = gfxInternalsForTest;
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      expect(composedVariantBounds(settingsFor(tier)).maxIdle, `desktop ${tier}`).toBe(
        Number.POSITIVE_INFINITY,
      );
      // Android (and any other constrained phone browser) is not the iOS
      // profile: its WebContent-style kill does not exist, and it keeps today's
      // cache byte for byte.
      const android = settingsFor(tier, {
        platform: 'android',
        deviceMemory: 4,
        maxTouchPoints: 5,
        coarsePointer: true,
        narrowViewport: true,
      });
      expect(android.constrainedMemory, `android ${tier} premise`).toBe(true);
      expect(composedVariantBounds(android).maxIdle, `android ${tier}`).toBe(
        Number.POSITIVE_INFINITY,
      );
      expect(composedVariantBounds(settingsFor(tier, { platform: 'ios' })).maxIdle).toBe(16);
      expect(
        composedVariantBounds(settingsFor(tier, { platform: 'ios', tightMemory: true })).maxIdle,
      ).toBe(8);
    }
  });
});

describe('composedVariantEvictions on the unbounded-idle profiles (desktop, Android)', () => {
  const bounds = composedVariantBounds(DESKTOP);

  it('names exactly the keys the historical sweep evicted, in its order, for any cache state', () => {
    const rand = lcg(0x5eed);
    let evictingStates = 0;
    for (let round = 0; round < 400; round++) {
      const size = Math.floor(rand() * 140);
      const cache = randomCache(rand, size, rand());
      const expected = historicalSweep(cache, 96);
      if (expected.length > 0) evictingStates++;
      expect(composedVariantEvictions(cache, bounds), `round ${round}`).toEqual(expected);
    }
    // vacuity floor: the comparison must cover states that actually evict
    expect(evictingStates).toBeGreaterThan(100);
  });

  it('never looks at recency: a long-idle entry survives while the cache is under the cap', () => {
    const cache = randomCache(lcg(7), 90, 0);
    expect(composedVariantEvictions(cache, bounds)).toEqual([]);
  });

  it('evicts nothing when every entry over the cap is live', () => {
    const cache = randomCache(lcg(11), 120, 1);
    expect(composedVariantEvictions(cache, bounds)).toEqual([]);
  });
});

describe('composedVariantEvictions on the iOS profile', () => {
  const bounds = composedVariantBounds(IOS);

  it('keeps the idle entries at the bound, least recently seen evicted first', () => {
    // 20 idle entries in cache order, seen in REVERSE order: the head of the
    // cache (least recently composed) is the most recently seen.
    const entries: Array<[string, number, number]> = [];
    for (let i = 0; i < 20; i++) entries.push([`idle${i}`, 0, 100 - i]);
    const out = composedVariantEvictions(cacheOf(entries), bounds);
    expect(out).toEqual(['idle19', 'idle18', 'idle17', 'idle16']);
  });

  it('never names a live entry, however old, however far over the bounds', () => {
    const entries: Array<[string, number, number]> = [];
    for (let i = 0; i < 110; i++) entries.push([`live${i}`, 1, i]);
    for (let i = 0; i < 30; i++) entries.push([`idle${i}`, 0, 1000 + i]);
    const out = composedVariantEvictions(cacheOf(entries), bounds);
    for (const key of out) expect(key.startsWith('idle'), key).toBe(true);
    // every idle entry goes: the idle pass trims to 16, then the total cap
    // (140 entries, 110 live) takes the remaining 16 in cache order
    expect(out).toHaveLength(30);
    expect(new Set(out).size).toBe(30);
  });

  it('orders by the last time a character was drawn from the look, not when it was composed', () => {
    // A composed at the start of the session and released a moment ago; B
    // composed later but let go long ago. B is the one nobody has seen.
    const entries: Array<[string, number, number]> = [['A', 0, 50]];
    for (let i = 0; i < 15; i++) entries.push([`mid${i}`, 0, 20 + i]);
    entries.push(['B', 0, 10]);
    expect(composedVariantEvictions(cacheOf(entries), bounds)).toEqual(['B']);
  });

  it('evicts nothing while the idle entries fit, even with a large live crowd', () => {
    const entries: Array<[string, number, number]> = [];
    for (let i = 0; i < 62; i++) entries.push([`live${i}`, 2, i]);
    for (let i = 0; i < 16; i++) entries.push([`idle${i}`, 0, 100 + i]);
    expect(composedVariantEvictions(cacheOf(entries), bounds)).toEqual([]);
  });

  it('still applies the total cap after the idle pass, in cache order', () => {
    // 90 live + 16 idle = 106 entries: the idle pass has nothing to trim, the
    // total cap evicts ten idle entries, least recently composed first.
    const entries: Array<[string, number, number]> = [];
    for (let i = 0; i < 16; i++) entries.push([`idle${i}`, 0, 200 - i]);
    for (let i = 0; i < 90; i++) entries.push([`live${i}`, 1, i]);
    const out = composedVariantEvictions(cacheOf(entries), bounds);
    expect(out).toEqual(Array.from({ length: 10 }, (_, i) => `idle${i}`));
  });

  it('does not count an entry twice when both passes run', () => {
    const entries: Array<[string, number, number]> = [];
    for (let i = 0; i < 30; i++) entries.push([`idle${i}`, 0, i]);
    for (let i = 0; i < 90; i++) entries.push([`live${i}`, 1, 100 + i]);
    const out = composedVariantEvictions(cacheOf(entries), bounds);
    // idle pass: 14 least recently seen; total pass: 120 - 14 = 106 > 96, ten
    // more of the remaining idle in cache order
    expect(out.slice(0, 14)).toEqual(Array.from({ length: 14 }, (_, i) => `idle${i}`));
    expect(out.slice(14)).toEqual(Array.from({ length: 10 }, (_, i) => `idle${14 + i}`));
    expect(new Set(out).size).toBe(out.length);
  });

  it('the tight rung keeps half as many', () => {
    const entries: Array<[string, number, number]> = [];
    for (let i = 0; i < 12; i++) entries.push([`idle${i}`, 0, i]);
    expect(composedVariantEvictions(cacheOf(entries), composedVariantBounds(TIGHT))).toEqual([
      'idle0',
      'idle1',
      'idle2',
      'idle3',
    ]);
  });

  it('holds its bounds over random cache states: idle within the bound, total within the cap', () => {
    const rand = lcg(0xc0ffee);
    for (let round = 0; round < 400; round++) {
      const cache = randomCache(rand, Math.floor(rand() * 140), rand());
      const out = new Set(composedVariantEvictions(cache, bounds));
      let idleLeft = 0;
      let liveLeft = 0;
      let oldestKeptIdle = Number.POSITIVE_INFINITY;
      let newestEvicted = Number.NEGATIVE_INFINITY;
      for (const [key, entry] of cache) {
        if (entry.refs > 0) {
          expect(out.has(key), `round ${round}: live ${key} evicted`).toBe(false);
          liveLeft++;
        } else if (!out.has(key)) {
          idleLeft++;
          oldestKeptIdle = Math.min(oldestKeptIdle, entry.seenAt);
        } else {
          newestEvicted = Math.max(newestEvicted, entry.seenAt);
        }
      }
      expect(idleLeft).toBeLessThanOrEqual(16);
      expect(idleLeft + liveLeft).toBeLessThanOrEqual(Math.max(96, liveLeft));
      // With at most 80 live the total cap never steps in after the idle pass,
      // so recency alone decided: every kept idle entry was seen more recently
      // than every evicted one.
      if (liveLeft <= 80 && out.size > 0 && idleLeft > 0) {
        expect(newestEvicted).toBeLessThan(oldestKeptIdle);
      }
    }
  });
});

describe('the residency shape', () => {
  it('accepts any map whose values carry refs and seenAt', () => {
    const cache = new Map<string, ComposedVariantResidency & { extra: string }>([
      ['a', { refs: 0, seenAt: 1, extra: 'x' }],
    ]);
    expect(composedVariantEvictions(cache, composedVariantBounds(IOS))).toEqual([]);
  });
});
