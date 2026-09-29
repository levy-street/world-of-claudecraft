// World-map background residency: how many per-zone map backgrounds the HUD
// keeps ready to draw, and which one leaves when a new one lands. Pure: the
// HUD injects how a background is released and which zone the player is in,
// so the policy runs (and is tested) without a DOM.
//
// The policy follows how the two painters consume a background. The minimap
// blits only the CURRENT zone's background sharp (the rest of its disc is the
// coarse whole-world strip), and the world map blits only the ONE zone it
// shows. So on a bounded profile a background stays while it is drawn: every
// read records a use, and a newly committed background releases the least
// recently drawn one past the capacity. The current zone is never released:
// the minimap only peeks at the cache, so it would stay on the coarse strip
// until the next crossing. A zone the world map asks for again reloads from its
// baked plate, and the map shows its blank-paper placeholder meanwhile. Nor
// does a bounded profile prewarm the zones the renderer streams in: none is
// drawn before the player crosses into it, and the bound would release it.
//
// Only the iOS memory profile is bounded (iOS kills the page past a fixed
// budget, whatever the device RAM). Every other host keeps the session-long
// cache, the retained decoded plate and the streamed prewarm, unchanged.

export interface MapBgResidencyPolicy {
  /** Most backgrounds kept at once, the current zone's included; null keeps every one. */
  readonly capacity: number | null;
  /** Keep the decoded baked plate after the HUD copied it into its own canvas. */
  readonly retainDecodedPlates: boolean;
  /** Prewarm the background of every zone the renderer prepares, ahead of a crossing. */
  readonly prewarmPreparedZones: boolean;
}

/** The current zone, the zone just left (walking back over a border never
 *  reloads), and the zone last shown on the world map. */
export const MAP_BG_BOUNDED_CAPACITY = 3;

const UNBOUNDED: MapBgResidencyPolicy = Object.freeze({
  capacity: null,
  retainDecodedPlates: true,
  prewarmPreparedZones: true,
});

const BOUNDED: MapBgResidencyPolicy = Object.freeze({
  capacity: MAP_BG_BOUNDED_CAPACITY,
  retainDecodedPlates: false,
  prewarmPreparedZones: false,
});

export function mapBgResidencyPolicy(iosMemoryProfile: boolean): MapBgResidencyPolicy {
  return iosMemoryProfile ? BOUNDED : UNBOUNDED;
}

/** The per-zone background cache. `get` is a draw's read and records the use;
 *  `has` is a bookkeeping check and does not. */
export class MapBgResidentCache<T> {
  private readonly entries = new Map<string, T>();
  private readonly lastUse = new Map<string, number>();
  private useClock = 0;

  constructor(
    readonly policy: MapBgResidencyPolicy,
    private readonly release: (value: T) => void,
    private readonly currentZoneId: () => string,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  has(zoneId: string): boolean {
    return this.entries.has(zoneId);
  }

  get(zoneId: string): T | undefined {
    const value = this.entries.get(zoneId);
    if (value !== undefined && this.policy.capacity !== null) {
      this.lastUse.set(zoneId, ++this.useClock);
    }
    return value;
  }

  /** Commit a ready background. On a bounded profile, release the least
   *  recently drawn ones past the capacity, never this one or the current zone. */
  set(zoneId: string, value: T): void {
    this.entries.set(zoneId, value);
    const capacity = this.policy.capacity;
    if (capacity === null) return;
    this.lastUse.set(zoneId, ++this.useClock);
    const current = this.currentZoneId();
    while (this.entries.size > capacity) {
      let victim: string | null = null;
      let oldest = Number.POSITIVE_INFINITY;
      for (const [id, used] of this.lastUse) {
        if (id === zoneId || id === current || used >= oldest) continue;
        victim = id;
        oldest = used;
      }
      if (victim === null) return;
      const released = this.entries.get(victim);
      this.entries.delete(victim);
      this.lastUse.delete(victim);
      if (released !== undefined) this.release(released);
    }
  }
}
