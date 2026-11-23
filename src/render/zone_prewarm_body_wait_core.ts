// The zone prewarm's wait for cold creature bodies.
//
// A zone prewarm pass (renderer.ts prewarmZoneAt, and the entry prewarm's mob
// arm) builds the mob templates a zone can spawn into a hidden grid so their
// programs link before a first live sighting. A template whose body files are
// not resident is skipped (zone_prewarm_groups.ts buildEntityPrewarmGroup), and
// on iOS that is the normal case for the Quartered Isle: its bodies ride a paced
// lane (characters/rift_body_stream_core.ts) the pass must not fetch around. So
// a pass that skipped a cold body does not count the zone as prewarmed. The zone
// waits here instead, keyed by the visual keys it skipped. The wait owns the
// renderer's per-zone "programs prewarmed" record for this reason: settle is the
// only writer, so a zone is in it exactly when its last pass skipped nothing.
// - a waiting zone reads as prewarmed for ARRIVAL purposes (settledOrWaiting,
//   renderer.ts isZoneReadyAt): nothing an arrival can do (a curtain, a pass) brings
//   the bodies sooner, since the prewarm never fetches a body a lane still holds;
// - while none of the skipped bodies is resident, a new pass for the zone has
//   nothing to add, so the renderer returns early (skips) instead of running an
//   empty warm pass on every zone-streaming call;
// - when one lands (the character asset-ready signal, bodyArrived), the zone is
//   handed back to the prewarm (rewarm, deferred past the task that noticed it)
//   and that pass warms only the templates still missing (the per-template
//   record keeps the others), settling the zone again: prewarmed once nothing it
//   skipped is cold. A handed-back zone keeps waiting (so it still reads ready)
//   and is handed back once, until its pass settles it.
// A body that lands while a pass is in flight is caught at that pass's settle:
// its key is resident by then, so the zone is handed back at once. A lane fetch
// that fails does not strand the wait: the paced ask registered the file as
// awaited (characters/assets.ts visualAssetsResident), so the store asks for it
// again after its cooldown, and that landing is an arrival like any other.
//
// Pure (RENDER_PURE_CORES): no three.js, no DOM, no clock; tests import it
// directly. The host binds residency (visualAssetsResident without a fetch), the
// deferral (a zero-delay timer) and the rewarm (a background zone prewarm).

export interface ZonePrewarmBodyWaitHost {
  /** True when every file the visual key builds from is resident (asks only). */
  resident(key: string): boolean;
  /** Run `fn` in a later task (past the pass that is settling now). */
  defer(fn: () => void): void;
  /** Run the zone's prewarm again (a background pass at this point). */
  rewarm(x: number, z: number): void;
}

interface WaitingZone {
  readonly x: number;
  readonly z: number;
  readonly keys: readonly string[];
  /** A hand-back is queued or its pass is running: never hand it back twice. */
  handedBack: boolean;
}

export class ZonePrewarmBodyWait {
  private readonly zones = new Map<string, WaitingZone>();
  /** Bumped by clear(), so a hand-back queued before it is dropped. */
  private generation = 0;

  /** `prewarmed`: the renderer's per-zone "programs prewarmed" record. */
  constructor(
    private readonly host: ZonePrewarmBodyWaitHost,
    private readonly prewarmed: Set<string>,
  ) {}

  /** True when a new pass over the zone has nothing to add: it counts as
   *  prewarmed, or it waits, is not handed back, and none of its bodies landed. */
  skips(zoneId: string): boolean {
    return this.prewarmed.has(zoneId) || this.awaiting(zoneId);
  }

  /** The arrival readout: prewarmed, or waiting on bodies only a lane can bring. */
  settledOrWaiting(zoneId: string): boolean {
    return this.prewarmed.has(zoneId) || this.zones.has(zoneId);
  }

  /** Settle one pass over a zone (prewarmed at (x, z)): the zone counts as
   *  prewarmed when it skipped no cold body, and otherwise waits for one. */
  settle(zoneId: string, x: number, z: number, coldKeys: readonly string[]): boolean {
    if (coldKeys.length === 0) {
      this.zones.delete(zoneId);
      this.prewarmed.add(zoneId);
      return true;
    }
    this.prewarmed.delete(zoneId);
    const zone: WaitingZone = { x, z, keys: [...new Set(coldKeys)], handedBack: false };
    this.zones.set(zoneId, zone);
    if (this.anyResident(zone)) this.handBack(zone);
    return false;
  }

  /** True while the zone waits, is not handed back, and none of its bodies landed. */
  awaiting(zoneId: string): boolean {
    const zone = this.zones.get(zoneId);
    return zone !== undefined && !zone.handedBack && !this.anyResident(zone);
  }

  /** A character file landed: hand back every waiting zone one of whose
   *  skipped bodies is now resident. Nothing to scan while nothing waits. */
  bodyArrived(): void {
    for (const zone of this.zones.values()) {
      if (!zone.handedBack && this.anyResident(zone)) this.handBack(zone);
    }
  }

  /** Zones currently waiting (diagnostics and tests). */
  waitingZoneIds(): string[] {
    return [...this.zones.keys()];
  }

  /** Forget every wait (a context loss forgets the zone program records too). */
  clear(): void {
    this.zones.clear();
    this.generation++;
  }

  private anyResident(zone: WaitingZone): boolean {
    return zone.keys.some((key) => this.host.resident(key));
  }

  private handBack(zone: WaitingZone): void {
    zone.handedBack = true;
    const generation = this.generation;
    this.host.defer(() => {
      if (generation === this.generation) this.host.rewarm(zone.x, zone.z);
    });
  }
}
