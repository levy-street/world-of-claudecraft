// The Eastbrook quay's practice yard (content/practice_dummies.ts): the hub
// training dummy and Drillmaster Hale, its sparring master.
//
// Spawned AFTER the player and the escorts rather than by the NPC and camp
// loops on purpose. Those loops mint ids in order, so an entry appended to
// either shifts every id minted after it (the player first), which moves
// every id-seeded private stream (mob/idle_rng.ts) and every seed-pinned
// test that reads the player's id, and re-mints every parity golden. A
// trailing spawn consumes only trailing ids: the escort precedent
// (escort.ts initEscorts), so a world with the yard is byte-identical to one
// without it up to the yard's own two entities.
//
// Draws no rng: both stand on authored marks that tests pin clear of every
// collider and neighbour (tests/hub_training_dummy.test.ts,
// tests/hub_dummy_drill.test.ts), so no findSafePos nudge is needed.
// `src/sim`-pure (tests/architecture.test.ts).

import { HUB_SPARRING_MASTER_ID, HUB_TRAINING_DUMMY_POS } from './content/practice_dummies';
import { MOBS } from './data';
import { createMob, createNpc } from './entity';
import type { SimContext } from './sim_context';
import type { WorldContent } from './types';

/** The yard ships with the sparring master: a world content that carries his
 *  def (the built-in world; never a trimmed test world) gets both entities. */
export function hubPracticeEnabled(world: WorldContent): boolean {
  return world.npcs[HUB_SPARRING_MASTER_ID] !== undefined;
}

export function spawnHubPractice(ctx: SimContext, world: WorldContent): void {
  if (!hubPracticeEnabled(world)) return;
  const dummy = createMob(
    ctx.nextId++,
    MOBS.training_dummy,
    MOBS.training_dummy.maxLevel,
    ctx.groundPos(HUB_TRAINING_DUMMY_POS.x, HUB_TRAINING_DUMMY_POS.z),
  );
  dummy.facing = 0;
  dummy.prevFacing = 0;
  ctx.addEntity(dummy);
  const def = world.npcs[HUB_SPARRING_MASTER_ID];
  const hale = createNpc(ctx.nextId++, def, ctx.groundPos(def.pos.x, def.pos.z));
  ctx.addEntity(hale);
}
