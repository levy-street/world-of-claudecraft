// The Deepglass venue's hooks into the Sim coordinator: its construction-time
// spawns, the overworld fixtures the arena world keeps out, and the Deepball
// tick phase. Moved whole out of src/sim/sim.ts (the Studio merge grew the
// coordinator past its monolith ceiling); every call site keeps its old slot in
// the constructor and the tick, so entity insertion order and the shared rng
// draw order are unchanged.
//
// Every spawn here is reserved-id and rng-free: none takes `nextId` or draws.

import { DG_SPECTATOR_IDS } from '../content/deepglass_event';
import { authoredMapActive } from '../data';
import { initEscorts } from '../escort';
import { spawnHealingTrainingGround } from '../healing_training';
import { spawnHubPractice } from '../hub_practice';
import { DEEPGLASS_PORTAL_WIZARD_NPC_ID } from '../portal_wizard';
import { spawnDeepglassPortalWizard, spawnTownPortalWizards } from '../portal_wizard_spawn';
import type { SimContext } from '../sim_context';
import type { SimConfig, WorldContent } from '../types';
import { spawnHarborHouseKeeper } from '../wyrmwatch_harbor_house';
import { TIDEHOLD_RESIDENTS } from './citadel';
import { spawnTideholdResidents } from './citadel_spawn';
import { spawnDeepglassCrowd } from './crowd';
import { updateDeepglass } from './match';
import { spawnDeepglassMarshal, spawnDeepglassSteward } from './steward';
import { DEEPGLASS_MARSHAL } from './world';

/** The Sim's findSafePos at the NPC spawn floor (`waterLevel() + 0.6`). */
export type SafeNpcPos = (x: number, z: number) => { x: number; z: number };

/** The Deepglass arena is a world you cannot walk out of: the fixed-overworld
 *  spawns (dungeon doors, escorts, practice yards) stay out of it. */
export function isDeepglassArena(world: WorldContent): boolean {
  return world.presentationMode === 'deepglass';
}

/**
 * Whether the venue's OWN reserved-id spawner should run for `id`.
 *
 * In the code-built arena every one of these NPCs is `dynamic: true`: the
 * generic surface loop skips them and the spawners here place them at reserved
 * ids, which is what keeps the bout's rng draw order stable. But a Studio
 * DOCUMENT of the same venue carries the roster as ordinary authored content
 * (editor/shipped_deepglass.ts drops `dynamic` so a maker can see and move
 * them), and there the surface loop places them itself, so running the
 * spawners as well stood a second marshal, a second crowd and a second city
 * beside the first. A def the world places itself is not ours to spawn.
 */
export function venueSpawns(world: WorldContent, id: string): boolean {
  return isDeepglassArena(world) && world.npcs[id]?.dynamic === true;
}

/** The steward and the marshal. Runs right after the Weekly keeper and before
 *  FURY, exactly where the coordinator used to spawn them inline. */
export function spawnDeepglassVenueStaff(
  ctx: SimContext,
  world: WorldContent,
  safeNpcPos: SafeNpcPos,
): void {
  // The Deepglass steward at her Goldcrest berth (reserved id, findSafePos).
  // Authored maps only: the built-in world has no Goldcrest.
  const stewardDef = world.npcs.deepglass_steward;
  if (stewardDef && authoredMapActive()) {
    const safe = safeNpcPos(stewardDef.pos.x, stewardDef.pos.z);
    spawnDeepglassSteward(ctx, stewardDef, safe);
  }
  // The Deepglass marshal, on the causeway inside the arena. Only that world
  // lists her, so the lookup is the gate, but the arena flag is asserted too,
  // because a map document that happened to name her must not put a fixture
  // desk in the middle of the overworld.
  const marshalDef = world.npcs[DEEPGLASS_MARSHAL.id];
  if (marshalDef && venueSpawns(world, DEEPGLASS_MARSHAL.id)) {
    spawnDeepglassMarshal(ctx, marshalDef);
  }
}

/** Baldemar's selves, the concourse crowd and Tidehold's residents. Runs right
 *  after FURY and before Warmarshal Kole, their old inline slot. */
export function spawnDeepglassVenueTownsfolk(
  ctx: SimContext,
  world: WorldContent,
  safeNpcPos: SafeNpcPos,
): void {
  // Baldemar the Bald, one self per town square plus the one at the bell.
  // Same reserved-id, rng-free treatment as every singleton around this call;
  // see src/sim/portal_wizard.ts for why he is fifteen NPCs and one joke.
  spawnTownPortalWizards(ctx, world.npcs, safeNpcPos);
  const bellSelf = world.npcs[DEEPGLASS_PORTAL_WIZARD_NPC_ID];
  if (bellSelf && venueSpawns(world, DEEPGLASS_PORTAL_WIZARD_NPC_ID)) {
    spawnDeepglassPortalWizard(ctx, bellSelf);
  }
  // The Deepglass city event: spectators walking the concourse, sitters in
  // the stands, stallkeepers at the market. Arena only, reserved ids, and
  // despawned for every bout (src/sim/deepglass/crowd.ts).
  if (venueSpawns(world, DG_SPECTATOR_IDS[0])) spawnDeepglassCrowd(ctx);
  // Tidehold, the Warden City across the causeway: forty residents on
  // reserved ids, walked by src/sim/deepglass/citadel_spawn.ts. Arena only,
  // and rng-free for the same reason the crowd is.
  if (venueSpawns(world, TIDEHOLD_RESIDENTS[0].def.id)) spawnTideholdResidents(ctx);
}

/**
 * Escorts, the practice yards, the harbormaster: rng-free, trailing or reserved
 * ids, the last thing the constructor spawns. Not in the Deepglass arena: all
 * carry fixed overworld coordinates, so they would leak into Tidehold's world
 * (the escortees' rigs are not in the arena's preload manifest either).
 */
export function spawnOverworldFixtures(ctx: SimContext, world: WorldContent): void {
  if (isDeepglassArena(world)) return;
  initEscorts(ctx);
  spawnHubPractice(ctx, world);
  spawnHealingTrainingGround(ctx, world);
  spawnHarborHouseKeeper(ctx, world);
}

/**
 * Deepball at the Deepglass, run in the tick right after the delve phase. Like
 * the Vale Cup phase it draws ZERO shared rng (pure fluid physics, clock-driven
 * currents, pure-function bot aim), so its slot cannot fork the draw order.
 * Authored maps only: the built-in tick (and the server profiler's phase list)
 * stays the release's.
 */
export function updateDeepglassPhase(ctx: SimContext, lap: SimConfig['perfLap']): void {
  if (!authoredMapActive()) return;
  updateDeepglass(ctx);
  lap?.('deepglass');
}
