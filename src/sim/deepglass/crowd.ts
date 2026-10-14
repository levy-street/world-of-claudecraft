// The Deepglass city-event crowd: spawning, the pacers' short walk, the
// standing posts, and the match-day despawn. Data lives in
// content/deepglass_event.ts; the cheering is presentation and lives in
// render/deepglass_crowd_fx.ts.
//
// Determinism doctrine (see steward.ts): every body spawns under a RESERVED
// entity id after the rng-drawing world roster, and nothing here draws from
// ctx.rng or a wall clock. The four pacers advance through the shared NpcRoute
// walker (npc_routes.ts, zero rng, DT-scaled) on a two-point tangent; everyone
// else never moves, and the twelve in the bowl are pinned to their deck height
// because the seating geometry is render-only over a dead-flat heightfield.
//
// The despawn is the point: startDeepglassMatch calls despawnDeepglassCrowd so
// a bout runs with twenty-three fewer composed characters in the scene, and
// endDeepglassMatch brings the event back.

import {
  DEEPGLASS_EVENT_NPCS,
  DG_CROWD_BASE_ENTITY_ID,
  DG_PACE_HALF_SPAN,
  DG_SEAT_TIER_DECK_Y,
  DG_SPECTATOR_IDS,
  DG_SPECTATORS,
  DG_STALLKEEPER_BASE_ENTITY_ID,
  DG_STALLKEEPER_IDS,
  type DgSpectatorSpot,
} from '../content/deepglass_event';
import { createNpc } from '../entity';
import type { SimContext } from '../sim_context';

const spectatorEntityId = (i: number): number => DG_CROWD_BASE_ENTITY_ID + i;

function crowdEntityIds(): number[] {
  return [
    ...DG_SPECTATOR_IDS.map((_, i) => spectatorEntityId(i)),
    ...DG_STALLKEEPER_IDS.map((_, i) => DG_STALLKEEPER_BASE_ENTITY_ID + i),
  ];
}

/** Spawn the whole event roster. Arena worlds only (the caller gates on
 *  isDeepglassArena); a re-call while spawned is a no-op per body. */
export function spawnDeepglassCrowd(ctx: SimContext): void {
  DG_SPECTATORS.forEach((spot, i) => {
    const id = spectatorEntityId(i);
    if (ctx.entities.has(id)) return;
    const def = DEEPGLASS_EVENT_NPCS[spot.npcId];
    if (!def) return;
    const npc = createNpc(id, def, ctx.groundPos(def.pos.x, def.pos.z));
    if (spot.role === 'pace') {
      // The walk is authored on the def now (content/deepglass_event.ts), the
      // same record a Studio document round-trips.
      if (def.route) npc.route = def.route;
    } else if (spot.role === 'tier' && spot.tier !== undefined) {
      // The bowl has no collision, so the deck height is authored rather than
      // sampled (updateDeepglassCrowd re-pins it every tick).
      npc.pos.y = DG_SEAT_TIER_DECK_Y[spot.tier];
    }
    ctx.addEntity(npc);
  });
  DG_STALLKEEPER_IDS.forEach((templateId, i) => {
    const id = DG_STALLKEEPER_BASE_ENTITY_ID + i;
    if (ctx.entities.has(id)) return;
    const def = DEEPGLASS_EVENT_NPCS[templateId];
    if (!def) return;
    ctx.addEntity(createNpc(id, def, ctx.groundPos(def.pos.x, def.pos.z)));
  });
}

/** Whether a match despawn is holding the crowd off the concourse, so the
 *  final whistle knows to bring the event back (and a world that never had a
 *  crowd never conjures one). */
let despawnedForMatch = false;

/** Remove every event body (match day: the concourse clears for the bout). */
export function despawnDeepglassCrowd(ctx: SimContext): void {
  for (const id of crowdEntityIds()) {
    if (ctx.entities.has(id)) {
      ctx.dropEntity(id);
      despawnedForMatch = true;
    }
  }
}

/** The final whistle: restore the event, but only if a match despawn took it
 *  away in the first place. */
export function respawnDeepglassCrowdAfterMatch(ctx: SimContext): void {
  if (!despawnedForMatch) return;
  despawnedForMatch = false;
  spawnDeepglassCrowd(ctx);
}

/** Per-tick: advance the pacers, keep the bowl standing on its decks. Cheap
 *  and rng-free; called from the deepglass tick only when the arena is idle
 *  (the crowd does not exist during a bout). The first lookup is the world
 *  gate: in any world without the event roster this is one Map miss and out. */
export function updateDeepglassCrowd(ctx: SimContext): void {
  if (!ctx.entities.has(DG_CROWD_BASE_ENTITY_ID)) return;
  DG_SPECTATORS.forEach((spot, i) => {
    const e = ctx.entities.get(spectatorEntityId(i));
    if (!e) return;
    // Pacers need no step here any more: the shared entity pass walks every
    // friendly NPC that carries a route (sim.ts), and stepping them here too
    // walked the concourse at double speed.
    if (spot.role === 'tier' && spot.tier !== undefined) {
      const y = DG_SEAT_TIER_DECK_Y[spot.tier];
      if (e.pos.y !== y) e.pos.y = y;
    }
  });
}
