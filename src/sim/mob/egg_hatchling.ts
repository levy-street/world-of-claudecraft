// A destroyed Broodmother egg (q_broodmother) has a 50% chance to hatch a widow
// hatchling that immediately swarms the player who broke it. The hatchling is a
// summoned add (it never respawns), and updateMob/resetEvadingMob despawn it two
// minutes after it leashes home, so a player who runs off is not chased forever.
import { MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { addThreat, SUMMONED_ADD_THREAT_SEED } from '../threat';
import type { Entity } from '../types';

const HATCHLING_ID = 'widow_hatchling';
const HATCHLING_DESPAWN_SECS = 120;
const HATCHLING_SPAWN_CHANCE = 0.5;

export function spawnWidowHatchlingOnEggDeath(ctx: SimContext, egg: Entity, killer: Entity): void {
  // Attribute the hatch to the destroying player (a pet kill credits its owner).
  const ownerId = killer.kind === 'player' ? killer.id : killer.ownerId;
  const owner = ownerId !== null ? ctx.entities.get(ownerId) : null;
  if (!owner || owner.kind !== 'player' || owner.dead) return;
  if (!ctx.rng.chance(HATCHLING_SPAWN_CHANCE)) return;
  const template = MOBS[HATCHLING_ID];
  if (!template) return;
  const hatchling = createMob(ctx.nextId++, template, template.minLevel, { ...egg.pos });
  hatchling.summonedAdd = true;
  hatchling.leashAnchor = { ...hatchling.pos };
  hatchling.leashDespawnSecs = HATCHLING_DESPAWN_SECS;
  hatchling.aggroTargetId = owner.id;
  hatchling.inCombat = true;
  hatchling.aiState = 'chase';
  ctx.addEntity(hatchling);
  addThreat(hatchling, owner.id, SUMMONED_ADD_THREAT_SEED);
}
