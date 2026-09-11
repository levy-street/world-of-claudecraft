// Steward Aleyn Tidewell: the berth in Goldcrest Harbor that sells you passage
// down to the Deepglass (docs/prd/deepglass.md).
//
// The bell is its own world (?map=deepglass), so "teleport me there" is a world
// change rather than a walk — the steward's dialog row hands the client a
// destination and the client boots the arena with a bout already called. That
// keeps the sim honest: nothing here moves a body between worlds, it only
// answers "is there a steward, and is the player standing at her berth?".
//
// Placement follows Groundskeeper Bram exactly (social/vale_cup.ts): a RESERVED
// entity id outside the nextId sequence, spawned after the rng-drawing world
// roster so world-gen determinism and the parity goldens' pinned id sequence
// both survive.

import { createNpc } from '../entity';
import type { SimContext } from '../sim_context';
import type { NpcDef } from '../types';

/**
 * The steward's reserved entity id. 000/001/002/003 are Bram, FURY, the
 * Warmarshal and the marshal below; the original pick here was 001, which
 * COLLIDED with FURY_ENTITY_ID: the steward spawned first, FURY's spawn is
 * guarded by `!entities.has(FURY_ENTITY_ID)`, and the Eastbrook honor
 * quartermaster silently never existed. First genuinely free slot is 004.
 */
export const DEEPGLASS_STEWARD_ID = 1_000_000_004;

export function spawnDeepglassSteward(
  ctx: SimContext,
  def: NpcDef,
  safe: { x: number; z: number },
): void {
  if (ctx.entities.has(DEEPGLASS_STEWARD_ID)) return;
  const npc = createNpc(DEEPGLASS_STEWARD_ID, def, ctx.groundPos(safe.x, safe.z));
  ctx.addEntity(npc);
}

/**
 * Marshal Yvette Coralwake, at the head of the causeway INSIDE the arena. The
 * steward above sells the journey; the marshal runs the fixtures once you are
 * standing at the bell.
 *
 * Reserved id for the same reason as every other singleton here, and it is not
 * theoretical: spawning her through the generic world-init loop instead cost a
 * `nextId`, which shifted every id allocated after it, moved the bout's rng
 * draws with it, and tipped the pacing test (a bout that should run past a
 * minute ended at 59.25s). 000/001/002 are Bram, FURY and the Warmarshal.
 *
 * No findSafePos: the arena's terrace is authored dead flat out to 104 yards,
 * so there is nothing to search for — and a search could only move her OFF the
 * causeway she is meant to be standing on.
 */
export const DEEPGLASS_MARSHAL_ID = 1_000_000_003;

export function spawnDeepglassMarshal(ctx: SimContext, def: NpcDef): void {
  if (ctx.entities.has(DEEPGLASS_MARSHAL_ID)) return;
  const npc = createNpc(DEEPGLASS_MARSHAL_ID, def, ctx.groundPos(def.pos.x, def.pos.z));
  ctx.addEntity(npc);
}
