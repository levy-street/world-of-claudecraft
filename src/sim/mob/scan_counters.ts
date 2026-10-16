// Observability counters for the mob-AI scan hot paths (aggro proximity scans and
// threat-table walks). Plain integer visit tallies the host reads after each tick to
// attribute mob.update cost; the two visit tallies feed no gameplay branch and draw
// no rng, so incrementing them cannot perturb determinism. Deliberately always on in
// every host (offline and headless simply never read them): the per-visit cost is a
// single integer increment, cheaper than any guard around it would be.
//
// The route and sight tallies (mob/chase_route.ts, mob/cast_sight.ts,
// mob/trash_kit/kit_cast_sight.ts) ride the same holder because it is the one
// per-tick tally the sim already owns and resets itself: route searches made
// this tick, cells they judged, searches that found nothing, mobs the route
// budget put off, and line-of-sight queries mob casts asked for. TWO of them
// are more than a readout: `routeNodes` is also the tick's route budget
// (chase_route.ts refuses a new search once ROUTE_NODES_PER_TICK cells have
// been judged) and `sightQueries` the tick's sight budget (cast_sight.ts: past
// SIGHT_QUERIES_PER_TICK a cast that would begin waits a tick). That is sound,
// and deterministic on every host, only because the SIM resets this holder at
// the top of its own tick() (never the host) and serves mobs in entity order;
// a host that zeroed it mid-tick would hand mobs work another host refused.
// The host reads them like the rest (Sim.mobScanCounters) after tick().

export interface MobScanCounters {
  aggroScanPlayerVisits: number;
  threatEntryVisits: number;
  /** Route searches made this tick (found or not). */
  routePlans: number;
  /** Cells those searches judged: their cost, and the tick's route budget. */
  routeNodes: number;
  /** Searches this tick that found no route (none exists, or the cap). */
  routeFailed: number;
  /** Mobs the tick's route budget put back to their next plan slot. */
  routeDeferred: number;
  /** Line-of-sight queries mob casts asked for this tick, and the tick's
   *  sight budget. */
  sightQueries: number;
}

export function createMobScanCounters(): MobScanCounters {
  return {
    aggroScanPlayerVisits: 0,
    threatEntryVisits: 0,
    routePlans: 0,
    routeNodes: 0,
    routeFailed: 0,
    routeDeferred: 0,
    sightQueries: 0,
  };
}

export function resetMobScanCounters(c: MobScanCounters): void {
  c.aggroScanPlayerVisits = 0;
  c.threatEntryVisits = 0;
  c.routePlans = 0;
  c.routeNodes = 0;
  c.routeFailed = 0;
  c.routeDeferred = 0;
  c.sightQueries = 0;
}
