// Tidehold's residents: spawning them, and walking the ones with a beat.
//
// Same treatment as the arena marshal and the match-day crowd, and for the same
// reason. The generic world-init loop allocates entity ids as it walks its
// roster, so forty extra bodies placed that way would shift every id after them
// — and with them the deepball bout's rng draw order, which
// tests/deepglass.test.ts pins to a pacing assertion. So every resident is
// `dynamic: true` in the world's npcs table (registered, never surface-placed)
// and spawned HERE at a reserved id instead.
//
// Parity: this module draws ZERO rng and reads no clock. The walk is
// npc_routes.ts's fixed-DT waypoint stepper, which is the same one the arena
// crowd uses.

import { createNpc } from '../entity';
import type { SimContext } from '../sim_context';
import { residentRoute, TH_ENTITY_ID_BASE, TIDEHOLD_RESIDENTS } from './citadel';

const residentEntityId = (index: number): number => TH_ENTITY_ID_BASE + index;

/**
 * Spawn the city. Arena worlds only (the caller gates on the presentation
 * mode); a re-call while spawned is a no-op per body, so this is safe to run
 * again after any world event that might have cleared one.
 */
export function spawnTideholdResidents(ctx: SimContext): void {
  TIDEHOLD_RESIDENTS.forEach((r, i) => {
    const id = residentEntityId(i);
    if (ctx.entities.has(id)) return;
    const npc = createNpc(id, r.def, ctx.groundPos(r.def.pos.x, r.def.pos.z));
    // createNpc deliberately does not copy the def's route (the arena crowd
    // assigns its own the same way), so the walk is attached here.
    const route = residentRoute(r);
    if (route) npc.route = route;
    ctx.addEntity(npc);
  });
}

// No per-tick driver here: the shared entity pass (sim.ts) walks every friendly
// NPC that carries a route, reserved-id and surface-placed alike, so a second
// stepper in this module walked the city at double speed.
