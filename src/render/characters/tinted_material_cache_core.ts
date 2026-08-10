// The bounded, claim-counted store behind the shared tinted-material cache
// (characters/assets.ts tintedMaterial). Pure bookkeeping: no Three, no DOM,
// no clock; values are opaque to this core (the caller hands in material
// clones and an onEvict that owns their disposal).
//
// Why bounded: the tinted-material memo used to retain every clone ever built
// for the renderer's whole lifetime. Its keys embed the SOURCE material's
// uuid, so an entry whose source is gone (the recolour LRU disposing a
// colour-wheel shade, a profile reset dropping the optimized-scene cache) can
// never be requested again and used to sit stranded until page unload (the C3
// memory ratchet). C1's acquire-time retint added a second arm: every
// distinct rift color mints one tinted-clone set per source material, so
// colors cycling through the visual pool grew the cache without bound.
//
// The policy mirrors the C2 emissive-derivation core (weapon_vfx_emissive_
// cache_core.ts): a mounted clone is pinned by its claims and is NEVER
// evicted, so eviction cannot change what is on screen. When the last claim
// releases, the entry joins the idle tail (warm for the next same-key
// request) until more than `maxIdle` idle entries exist; the
// least-recently-released idle entries then evict through `onEvict`. A
// live-source key rebuilds identically on its next request (the tinted clone
// is a pure function of source + tint + tier + atlases + role), so eviction
// is invisible apart from the rebuild cost; a dead-source key is simply never
// requested again, which is exactly what makes its idle eviction the
// reclamation.
//
// Liveness argument, spelled out once: disposal happens only in `onEvict`,
// `onEvict` runs only on entries with zero claims, and every mount of a
// cached clone on a mesh holds a claim for as long as the mount can exist
// (CharacterVisual's material sweeps claim into a lease before mounting and
// release the previous lease only after the sweep replaced every mount; see
// visual.ts). Zero claims therefore implies no live mesh mounts the value.
//
// Linear scans are fine at this scale: claim/release run on visual
// build/re-tint/teardown (entity stream-in/out, skin/weapon swaps), never per
// frame, and the entry count is bounded by live mounts plus the idle bound.

/** Idle entries (no live claim) the tinted-material store keeps warm. Live
 *  mounts are pinned on top of this. Each entry is one material clone (cheap
 *  CPU-side, and its shader program is shared with the live tints of the same
 *  source), so the bound is generous: it covers several full rigs' worth of
 *  clones so despawn/respawn churn stays warm, and only has to make dead-key
 *  and stale-rift-color residue finite, not tight. */
export const TINTED_MATERIAL_IDLE_CACHE_MAX = 64;

interface TintedEntry<V> {
  value: V;
  claims: number;
  /** Set by reset(): the entry belongs to a retired generation (profile
   *  reset), so it disposes on its last release instead of idling warm. A
   *  fresh claim un-retires it (it is demonstrably live again). */
  retired: boolean;
}

export class TintedMaterialCache<V> {
  /** Insertion order doubles as the eviction order: an entry is re-inserted
   *  the moment it becomes idle, so iteration meets idle entries
   *  least-recently-released first. */
  private entries = new Map<string, TintedEntry<V>>();
  private readonly maxIdle: number;

  constructor(
    maxIdle: number,
    private readonly onEvict: (value: V) => void,
  ) {
    // Fail closed: an invalid bound retains nothing idle rather than
    // everything (the ratchet this cache exists to prevent).
    this.maxIdle = Number.isFinite(maxIdle) ? Math.max(0, Math.floor(maxIdle)) : 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get idleSize(): number {
    let idle = 0;
    for (const entry of this.entries.values()) {
      if (entry.claims === 0) idle++;
    }
    return idle;
  }

  /** The stored value for `key` without touching claims or recency, or
   *  undefined. For lease-idempotent re-reads (a sweep meeting the same
   *  source material on a second mesh). */
  peek(key: string): V | undefined {
    return this.entries.get(key)?.value;
  }

  /** The memoized value for `key`, building it cold on a miss; either way the
   *  caller now holds one claim and owes exactly one `release`. */
  claim(key: string, build: () => V): V {
    const entry = this.entries.get(key);
    if (entry) {
      entry.claims++;
      entry.retired = false;
      return entry.value;
    }
    const value = build();
    this.entries.set(key, { value, claims: 1, retired: false });
    return value;
  }

  /**
   * Drop one claim. Returns false (a refused no-op) for an unknown key or an
   * entry with no live claims: a double-released lease must not underflow
   * another mount's pin. When the last claim goes, a retired entry disposes
   * immediately; a live-generation entry moves to the back of the eviction
   * order and the idle overflow (if any) evicts oldest first through
   * `onEvict`.
   */
  release(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.claims === 0) return false;
    entry.claims--;
    if (entry.claims > 0) return true;
    this.entries.delete(key);
    if (entry.retired) {
      this.onEvict(entry.value);
      return true;
    }
    this.entries.set(key, entry);
    this.evictIdleOverflow();
    return true;
  }

  /** Profile reset: dispose every idle entry now and retire the claimed ones,
   *  so each disposes the moment its last mount releases (never while
   *  mounted). Claimed entries stay servable in the meantime, and a re-claim
   *  un-retires (see TintedEntry.retired). */
  reset(): void {
    for (const [key, entry] of this.entries) {
      if (entry.claims === 0) {
        this.entries.delete(key);
        this.onEvict(entry.value);
      } else {
        entry.retired = true;
      }
    }
  }

  private evictIdleOverflow(): void {
    let idle = 0;
    for (const entry of this.entries.values()) {
      if (entry.claims === 0) idle++;
    }
    for (const [key, entry] of this.entries) {
      if (idle <= this.maxIdle) return;
      if (entry.claims > 0) continue;
      this.entries.delete(key);
      this.onEvict(entry.value);
      idle--;
    }
  }
}
