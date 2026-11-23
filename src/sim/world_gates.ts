// The world's gated collider sets, synced together at the top of every tick and before
// any construction-time placement query: the transport berths (transport_ferry.ts, whose
// whole public surface this module re-exports, so the Sim reaches the ferry through one
// import) and the seasonal event's solid dressing (seasonal_decor_colliders.ts).
//
// Both ride the shared per-(content, seed) collider grid, so every world in one process
// re-applies its OWN answer before its movement runs: a short-lived Sim built beside the
// realm's world (character creation, a headless env next to another) can never leave
// another world walking a berth or a stall that is not there for it.
//
// Pure delegation: no rng, no clock.
import { isBuiltinWorldActive } from './data';
import { activeSeasonalEventOf } from './seasonal/seasonal_state';
import { syncSeasonalDecorColliders } from './seasonal_decor_colliders';
import type { SimContext } from './sim_context';
import { syncFerryGates, updateTransportFerries } from './transport_ferry';

export * from './transport_ferry';

/** This world's seasonal decor gate (built-in world only: the dressing is resolved
 *  against the built-in towns, so an authored map never builds it). */
export function syncSeasonalGates(ctx: SimContext): void {
  if (!isBuiltinWorldActive()) return;
  syncSeasonalDecorColliders(ctx.cfg.seed, activeSeasonalEventOf(ctx.seasonal));
}

/** Construction: every gate in this world's state before any placement query. */
export function syncWorldGates(ctx: SimContext): void {
  syncFerryGates(ctx);
  syncSeasonalGates(ctx);
}

/** Top of the tick: the ferry timetable (which re-applies the berth gates), then the
 *  seasonal decor gate, before any movement. */
export function updateWorldGates(ctx: SimContext): void {
  updateTransportFerries(ctx);
  syncSeasonalGates(ctx);
}
