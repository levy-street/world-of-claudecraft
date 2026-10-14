// Which cached composed bodies the variant cache lets go of, and in what order.
// The cache is characters/assets.ts `modularVariantCache`: one merged part set
// per distinct LOOK, refcounted by the characters drawn from it (a world view,
// a pooled NPC visual, a portrait capture, the paperdoll), so an entry with a
// live clone is never evicted: clones share its geometry.
//
// It has always had a TOTAL cap, live entries included, which bounds only
// garbage. On desktop and Android that is still the whole rule, decided here
// exactly as the cache decided it before this module existed (same keys, same
// order), and pinned so.
//
// The iOS memory profile also bounds the IDLE entries. Every player and every
// world NPC composes, so what fills the cache is the population a session walks
// past, and a look nobody draws still holds its merged buffers, the morph
// texture three builds for them at the first draw (freed only with the
// geometry), and the CPU copies of both. Measured on the iPhone-profile rig
// (2026-09-29): a town tour grew the cache to 81 looks with 13 drawn at the end
// of the tour (22 back home at the end of the run), and a 40-player crowd left
// 51 idle looks behind when it logged out, none of them ever released. 16 idle
// looks hold the whole look set of any town outside the capital hub (4 to 14
// drawn per town on that tour), so stepping out of one and back in, with
// nothing else seen meanwhile, recomposes nothing, and they keep most of the
// capital's; the tight rung, the 4 GB-class devices whose entry already got
// killed once, keeps half of that. With the bound (2026-09-30, same rig), each
// look let go freed about 0.66 MiB of WebGL memory and 1 MiB of ArrayBuffers,
// and a look that comes back re-composes for what a first sighting costs (12
// to 18 ms of main thread on average there, on a desktop CPU); the crowd and
// capital returns measured there linked no program.
//
// ORDER: least recently SEEN first, where seen is the last time a character was
// composed from the entry or stopped drawing from it (the caller stamps both).
// A look that stepped out of range a moment ago is the one most likely to step
// back in, so it is the last to go, and a look composed early but drawn until
// now outlives one composed later and let go long ago. Evictions only ever
// happen on a release or before a new insert: an arriving character only turns
// an idle entry live, so a crowd walking back in cannot evict its own members.
//
// Pure: no three.js, no DOM, no clock, no randomness (RENDER_PURE_CORES).

/** The total cap on every profile: idle and live entries together. */
export const COMPOSED_VARIANT_CACHE_MAX = 96;
/** Idle entries the iOS memory profile keeps warm. */
export const COMPOSED_VARIANT_IDLE_MAX_IOS = 16;
/** Idle entries the tight-memory rung of the iOS profile keeps warm. */
export const COMPOSED_VARIANT_IDLE_MAX_TIGHT = 8;

export interface ComposedVariantBounds {
  /** Entries in all, live and idle: only idle ones are ever evicted to meet it. */
  readonly maxTotal: number;
  /** Idle entries kept warm; infinite where only the total cap applies. */
  readonly maxIdle: number;
}

const UNBOUNDED_IDLE: ComposedVariantBounds = Object.freeze({
  maxTotal: COMPOSED_VARIANT_CACHE_MAX,
  maxIdle: Number.POSITIVE_INFINITY,
});
const IOS_BOUNDS: ComposedVariantBounds = Object.freeze({
  maxTotal: COMPOSED_VARIANT_CACHE_MAX,
  maxIdle: COMPOSED_VARIANT_IDLE_MAX_IOS,
});
const TIGHT_BOUNDS: ComposedVariantBounds = Object.freeze({
  maxTotal: COMPOSED_VARIANT_CACHE_MAX,
  maxIdle: COMPOSED_VARIANT_IDLE_MAX_TIGHT,
});

/** The bounds for a memory profile (the two `GfxSettings` flags). */
export function composedVariantBounds(profile: {
  readonly iosMemoryProfile: boolean;
  readonly tightMemory: boolean;
}): ComposedVariantBounds {
  // Both flags, not tightMemory alone: the tight rung is an iOS rung today, and
  // a tightMemory flag that some other platform grows later must not bound it.
  if (!profile.iosMemoryProfile) return UNBOUNDED_IDLE;
  return profile.tightMemory ? TIGHT_BOUNDS : IOS_BOUNDS;
}

/** What the decision reads off one cache entry. */
export interface ComposedVariantResidency {
  /** Characters drawn from this entry right now; above zero it is never named. */
  readonly refs: number;
  /** A caller-owned sequence stamp of the last time the entry was seen
   *  (composed from, or released to idle): larger is more recent. */
  readonly seenAt: number;
}

/**
 * The keys to evict now, in eviction order. `cache` iterates in the cache's own
 * order, least recently COMPOSED first (a hit re-inserts), which is the order
 * the total cap has always used.
 *
 * Two passes. The idle pass (bounded profiles only) evicts the least recently
 * seen idle entries until the idle count fits. The total pass (every profile)
 * then walks the cache in order and evicts idle entries until the size fits;
 * with no idle bound it is the historical sweep unchanged. Neither ever names
 * an entry with a live reference.
 */
export function composedVariantEvictions<K>(
  cache: ReadonlyMap<K, ComposedVariantResidency>,
  bounds: ComposedVariantBounds,
): K[] {
  const out: K[] = [];
  const idleBounded = Number.isFinite(bounds.maxIdle);
  let size = cache.size;
  if (!idleBounded && size <= bounds.maxTotal) return out;
  if (idleBounded) {
    const idle: K[] = [];
    for (const [key, entry] of cache) if (entry.refs <= 0) idle.push(key);
    const over = idle.length - Math.max(0, bounds.maxIdle);
    if (over > 0) {
      const seenAt = (key: K): number => cache.get(key)?.seenAt ?? 0;
      // Array.prototype.sort is stable, so equal stamps keep cache order.
      idle.sort((a, b) => seenAt(a) - seenAt(b));
      for (let i = 0; i < over; i++) out.push(idle[i]);
      size -= over;
    }
  }
  if (size <= bounds.maxTotal) return out;
  const taken = out.length > 0 ? new Set(out) : null;
  for (const [key, entry] of cache) {
    if (size <= bounds.maxTotal) break;
    if (entry.refs > 0 || taken?.has(key)) continue;
    out.push(key);
    size--;
  }
  return out;
}
