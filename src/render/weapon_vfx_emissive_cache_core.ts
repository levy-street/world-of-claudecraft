// The bounded, reference-counted memo behind the weapon-skin emissive
// derivation (weapon_vfx.ts). Pure bookkeeping: no Three, no DOM, no clock,
// values are opaque to this core (the caller hands in derived texture pairs
// and an onEvict that owns their disposal).
//
// Why bounded: the derivation memo used to retain every (source albedo map,
// emissive spec) pair ever SEEN for the renderer's whole lifetime, about two
// full-resolution canvases plus two GPU textures per weapon cosmetic that
// ever walked past (the C2 memory ratchet). The boot prewarm deliberately
// does not populate it (its host material carries no albedo map), so the set
// grew with cosmetic traffic, never with the catalog.
//
// The policy: a live rig holds a reference, and a referenced entry is NEVER
// evicted, so eviction can never change what is on screen. An entry whose
// last wearer released it stays resident (warm for the next wearer of that
// skin) until more than `maxIdle` idle entries exist; then the
// least-recently-released idle entries evict through `onEvict`. An evicted
// key simply derives again on its next acquire, byte-identically (the
// derivation is a pure function of the memo key, see
// weapon_vfx_emissive_core.ts), so eviction is invisible apart from the
// rebuild cost.
//
// Linear scans are fine at this scale: acquire/release run on rig
// build/teardown (entity stream-in/out and gear swaps), never per frame, and
// the entry count is bounded by live wearers plus the idle bound.

/** Idle entries (no live wearer) the derivation memo keeps warm. Live rigs
 *  are pinned on top of this, so the resident set is live wearers + at most
 *  this many recently-released derivations. */
export const WEAPON_EMISSIVE_IDLE_CACHE_MAX = 8;

interface DerivationEntry<V> {
  value: V;
  refs: number;
}

export class WeaponEmissiveDerivationCache<V> {
  /** Insertion order doubles as the eviction order: an entry is re-inserted
   *  the moment it becomes idle, so iteration meets idle entries
   *  least-recently-released first. */
  private entries = new Map<string, DerivationEntry<V>>();
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

  /** The memoized value for `key`, deriving it cold on a miss; either way the
   *  caller now holds one reference and owes exactly one `release`. */
  acquire(key: string, derive: () => V): V {
    const entry = this.entries.get(key);
    if (entry) {
      entry.refs++;
      return entry.value;
    }
    const value = derive();
    this.entries.set(key, { value, refs: 1 });
    return value;
  }

  /**
   * Drop one reference. Returns false (a refused no-op) for an unknown key or
   * an entry with no live references: a double-released rig must not underflow
   * another wearer's pin. When the last reference goes, the entry moves to the
   * back of the eviction order and the idle overflow (if any) evicts oldest
   * first through `onEvict`.
   */
  release(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.refs === 0) return false;
    entry.refs--;
    if (entry.refs > 0) return true;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.evictIdleOverflow();
    return true;
  }

  /** Empty the cache and hand every value back, live or idle. TERMINAL: the
   *  renderer's teardown owns disposal (with its best-effort guard), so
   *  `onEvict` is deliberately not invoked here. */
  drain(): V[] {
    const drained: V[] = [];
    for (const entry of this.entries.values()) drained.push(entry.value);
    this.entries.clear();
    return drained;
  }

  private evictIdleOverflow(): void {
    let idle = 0;
    for (const entry of this.entries.values()) {
      if (entry.refs === 0) idle++;
    }
    for (const [key, entry] of this.entries) {
      if (idle <= this.maxIdle) return;
      if (entry.refs > 0) continue;
      this.entries.delete(key);
      this.onEvict(entry.value);
      idle--;
    }
  }
}
