// The bounded, reference-counted memo policy behind the weapon-skin emissive
// derivation (weapon_vfx.ts). A live rig pins its derivation via a reference
// count, so eviction can never touch a texture pair any wearer still draws
// with; idle derivations (every wearer gone) stay warm up to the idle bound
// and then evict least-recently-released, through the onEvict callback that
// owns disposal. This is what turns the old grow-forever memo (one
// megabyte-class texture pair retained per cosmetic ever seen) into a bounded
// working set.
import { describe, expect, it } from 'vitest';
import {
  WEAPON_EMISSIVE_IDLE_CACHE_MAX,
  WeaponEmissiveDerivationCache,
} from '../src/render/weapon_vfx_emissive_cache_core';

function makeCache(maxIdle: number) {
  const evicted: string[] = [];
  const cache = new WeaponEmissiveDerivationCache<string>(maxIdle, (value) => evicted.push(value));
  return { cache, evicted };
}

/** A derive callback that counts its cold runs and mints a distinct value. */
function makeDerive(value: string) {
  let calls = 0;
  const derive = () => {
    calls++;
    return value;
  };
  return { derive, calls: () => calls };
}

describe('WeaponEmissiveDerivationCache', () => {
  it('derives once per key and serves every later acquire from the memo', () => {
    const { cache, evicted } = makeCache(2);
    const a = makeDerive('A');

    expect(cache.acquire('a', a.derive)).toBe('A');
    expect(cache.acquire('a', a.derive)).toBe('A');
    expect(a.calls()).toBe(1);
    expect(cache.size).toBe(1);
    expect(evicted).toEqual([]);
  });

  it('never evicts an entry a live reference still pins, even at idle bound zero', () => {
    const { cache, evicted } = makeCache(0);
    const a = makeDerive('A');
    const b = makeDerive('B');

    cache.acquire('a', a.derive); // stays live for the whole case
    cache.acquire('b', b.derive);
    expect(cache.release('b')).toBe(true);

    // b became idle over a zero idle bound: evicted immediately. a is pinned.
    expect(evicted).toEqual(['B']);
    expect(cache.acquire('a', a.derive)).toBe('A');
    expect(a.calls()).toBe(1);
  });

  it('keeps idle entries warm up to the bound and evicts least-recently-released past it', () => {
    const { cache, evicted } = makeCache(2);
    const derives = ['A', 'B', 'C', 'D'].map((value) => makeDerive(value));
    for (const [i, key] of ['a', 'b', 'c', 'd'].entries()) {
      cache.acquire(key, derives[i].derive);
      cache.release(key);
    }

    // Release order a, b, c, d with two idle slots: a then b fall out.
    expect(evicted).toEqual(['A', 'B']);
    expect(cache.size).toBe(2);
    // The survivors are served warm.
    cache.acquire('c', derives[2].derive);
    cache.acquire('d', derives[3].derive);
    expect(derives[2].calls()).toBe(1);
    expect(derives[3].calls()).toBe(1);
  });

  it('a revived then re-released entry moves to the back of the eviction order', () => {
    const { cache, evicted } = makeCache(2);
    const a = makeDerive('A');
    const b = makeDerive('B');
    const c = makeDerive('C');

    cache.acquire('a', a.derive);
    cache.release('a');
    cache.acquire('b', b.derive);
    cache.release('b');
    // Revive a (a new wearer), then release again: a is now the most recently
    // released idle entry, so b is the eviction candidate, not a.
    cache.acquire('a', a.derive);
    cache.release('a');

    cache.acquire('c', c.derive);
    cache.release('c');
    expect(evicted).toEqual(['B']);
    cache.acquire('a', a.derive);
    expect(a.calls()).toBe(1);
  });

  it('release of an unknown key or an already idle entry is a refused no-op', () => {
    const { cache, evicted } = makeCache(1);
    const a = makeDerive('A');

    expect(cache.release('missing')).toBe(false);
    cache.acquire('a', a.derive);
    expect(cache.release('a')).toBe(true);
    // A double release (a double-disposed rig) must not underflow the count:
    // the entry stays a single idle entry, evicted at most once, and a later
    // flood cannot dispose it out from under a future wearer twice.
    expect(cache.release('a')).toBe(false);
    expect(cache.size).toBe(1);
    expect(evicted).toEqual([]);
  });

  it('fails closed on an invalid idle bound: nothing idle is retained', () => {
    // +Infinity is the load-bearing arm: an "unbounded" bound is exactly the
    // ratchet this cache exists to prevent, so it must clamp to zero, not
    // retain everything.
    for (const bound of [Number.NaN, -3, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      const { cache, evicted } = makeCache(bound);
      const a = makeDerive('A');
      cache.acquire('a', a.derive);
      cache.release('a');
      expect(evicted, `bound ${bound}`).toEqual(['A']);
      expect(cache.size, `bound ${bound}`).toBe(0);
    }
  });

  it('drain hands every value back, live or idle, without invoking onEvict', () => {
    const { cache, evicted } = makeCache(4);
    const a = makeDerive('A');
    const b = makeDerive('B');
    cache.acquire('a', a.derive); // still live: drain is the terminal path
    cache.acquire('b', b.derive);
    cache.release('b');

    expect(cache.drain()).toEqual(['A', 'B']);
    expect(cache.size).toBe(0);
    // Disposal stays with the caller: the renderer teardown wraps each
    // dispose in its own best-effort guard.
    expect(evicted).toEqual([]);
    // The map is empty, not merely detached: the next acquire derives cold.
    cache.acquire('a', a.derive);
    expect(a.calls()).toBe(2);
  });

  it('ships a real, finite idle bound (the ratchet fix cannot regress to unbounded)', () => {
    expect(Number.isInteger(WEAPON_EMISSIVE_IDLE_CACHE_MAX)).toBe(true);
    // Envelope, not an exact pin: at least one idle slot keeps the shared
    // derivation warm across wearer churn of one skin (the pre-existing rig
    // suite depends on that), and a two-digit ceiling keeps worst-case idle
    // retention megabyte-class instead of the whole catalog.
    expect(WEAPON_EMISSIVE_IDLE_CACHE_MAX).toBeGreaterThanOrEqual(1);
    expect(WEAPON_EMISSIVE_IDLE_CACHE_MAX).toBeLessThanOrEqual(32);
  });
});
