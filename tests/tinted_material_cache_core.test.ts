// The bounded, claim-counted store policy behind the shared tinted-material
// cache (characters/assets.ts tintedMaterial). A mounted clone is pinned by
// its claims, so eviction can never touch a material a live mesh still draws
// with; idle entries (every claim released) stay warm up to the idle bound and
// then evict least-recently-released through the onEvict callback that owns
// disposal. reset() (a graphics-profile change) disposes idle entries now and
// retires claimed ones to dispose on their last release, never while mounted.
// This is what turns the old grow-forever memo (dead-source keys stranded for
// the page lifetime, one clone set per rift color ever seen) into a bounded
// working set.
import { describe, expect, it } from 'vitest';
import {
  TINTED_MATERIAL_IDLE_CACHE_MAX,
  TintedMaterialCache,
} from '../src/render/characters/tinted_material_cache_core';

function makeCache(maxIdle: number) {
  const evicted: string[] = [];
  const cache = new TintedMaterialCache<string>(maxIdle, (value) => evicted.push(value));
  return { cache, evicted };
}

/** A build callback that counts its cold runs and mints a distinct value. */
function makeBuild(value: string) {
  let calls = 0;
  const build = () => {
    calls++;
    return `${value}#${calls}`;
  };
  return { build, calls: () => calls };
}

describe('TintedMaterialCache', () => {
  it('builds once per key and shares the clone across later claims', () => {
    const { cache, evicted } = makeCache(2);
    const a = makeBuild('A');

    const first = cache.claim('a', a.build);
    const second = cache.claim('a', a.build);
    expect(first).toBe(second);
    expect(a.calls()).toBe(1);
    expect(cache.size).toBe(1);
    expect(evicted).toEqual([]);
  });

  it('never evicts an entry a live claim still pins, even at idle bound zero', () => {
    const { cache, evicted } = makeCache(0);
    const a = makeBuild('A');
    const b = makeBuild('B');

    cache.claim('a', a.build); // stays claimed for the whole case
    cache.claim('b', b.build);
    expect(cache.release('b')).toBe(true);

    // b became idle over a zero idle bound: evicted immediately. a is pinned.
    expect(evicted).toEqual(['B#1']);
    expect(cache.claim('a', a.build)).toBe('A#1');
    expect(a.calls()).toBe(1);
  });

  it('keeps a clone shared by two leases alive until BOTH release it', () => {
    const { cache, evicted } = makeCache(0);
    const a = makeBuild('A');

    cache.claim('a', a.build); // lease 1 (visual 1's mount)
    cache.claim('a', a.build); // lease 2 (visual 2's mount)
    expect(cache.release('a')).toBe(true); // visual 1 disposed

    // Still claimed by lease 2 over a zero idle bound: must not be evicted.
    expect(evicted).toEqual([]);
    expect(cache.peek('a')).toBe('A#1');

    expect(cache.release('a')).toBe(true); // visual 2 disposed
    expect(evicted).toEqual(['A#1']);
  });

  it('keeps idle entries warm up to the bound and evicts least-recently-released past it', () => {
    const { cache, evicted } = makeCache(2);
    for (const key of ['a', 'b', 'c']) {
      cache.claim(key, makeBuild(key.toUpperCase()).build);
    }
    cache.release('a');
    cache.release('b');
    expect(evicted).toEqual([]); // two idle, at the bound

    // Re-claiming and re-releasing a moves it to the eviction tail, so the
    // third idle entry evicts b (oldest release), not a.
    cache.claim('a', makeBuild('A2').build);
    cache.release('a');
    cache.release('c');
    expect(evicted).toEqual(['B#1']);
    expect(cache.peek('a')).toBe('A#1');
    expect(cache.peek('c')).toBe('C#1');
  });

  it('serves an evicted key by rebuilding through the build callback', () => {
    const { cache, evicted } = makeCache(0);
    const a = makeBuild('A');

    cache.claim('a', a.build);
    cache.release('a');
    expect(evicted).toEqual(['A#1']);

    // The rebuild is a fresh value (the old clone was disposed).
    expect(cache.claim('a', a.build)).toBe('A#2');
    expect(a.calls()).toBe(2);
  });

  it('refuses an unknown-key or zero-claim release so a double release cannot underflow a pin', () => {
    const { cache, evicted } = makeCache(1);
    const a = makeBuild('A');

    expect(cache.release('missing')).toBe(false);

    cache.claim('a', a.build); // one live claim (another lease's mount)
    cache.claim('a', a.build); // this lease
    expect(cache.release('a')).toBe(true); // this lease releases
    cache.release('a'); // the other lease releases: now idle
    expect(cache.release('a')).toBe(false); // double release refused
    // The refused release must not have evicted or double-disposed anything.
    expect(evicted).toEqual([]);
    expect(cache.peek('a')).toBe('A#1');
  });

  it('reset() disposes idle entries immediately and never a claimed one', () => {
    const { cache, evicted } = makeCache(8);
    cache.claim('idle', makeBuild('I').build);
    cache.release('idle');
    cache.claim('live', makeBuild('L').build);

    cache.reset();
    expect(evicted).toEqual(['I#1']);
    expect(cache.peek('live')).toBe('L#1');
    expect(cache.size).toBe(1);
  });

  it('reset() retires a claimed entry to dispose on its last release instead of idling warm', () => {
    const { cache, evicted } = makeCache(8);
    cache.claim('live', makeBuild('L').build);

    cache.reset();
    expect(evicted).toEqual([]);
    expect(cache.release('live')).toBe(true);
    // Disposed the moment its mount released, despite idle headroom.
    expect(evicted).toEqual(['L#1']);
    expect(cache.size).toBe(0);
  });

  it('a fresh claim un-retires a reset survivor (it is demonstrably live again)', () => {
    const { cache, evicted } = makeCache(8);
    const l = makeBuild('L');
    cache.claim('live', l.build);
    cache.reset();

    cache.claim('live', l.build); // a new visual claims the same key
    cache.release('live');
    cache.release('live');
    // Both claims released with idle headroom: the entry idles warm rather
    // than disposing, because the post-reset claim proved it live.
    expect(evicted).toEqual([]);
    expect(cache.peek('live')).toBe('L#1');
    expect(l.calls()).toBe(1);
  });

  it('fails closed on an invalid idle bound (retains nothing idle)', () => {
    const { cache, evicted } = makeCache(Number.NaN);
    cache.claim('a', makeBuild('A').build);
    cache.release('a');
    expect(evicted).toEqual(['A#1']);
    expect(cache.size).toBe(0);
  });

  it('pins the shipped idle bound', () => {
    // The bound only has to make dead-source keys and stale rift colors
    // finite while keeping despawn/respawn churn warm; a change here is a
    // deliberate retune, not drift.
    expect(TINTED_MATERIAL_IDLE_CACHE_MAX).toBe(64);
  });
});
