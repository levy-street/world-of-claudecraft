// Kit adds: the Bone Minion a necromancer raises, the flock a Crow Caller
// summons, the Bone Brute a minion grows into. Modeled on the boss add
// spawner (mob/boss_mechanics.ts spawnBossAdds) with the claim's difficulty
// transform and tuning, but with ZERO rng: the add takes its template's
// lowest level (the difficulty transform rebases heroic), and it stands at a
// caller-chosen spot rather than a rolled ring.

import { MOBS } from '../../data';
import { createMob } from '../../entity';
import {
  applyDungeonMobTuning,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from '../../instances/difficulty';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat, SUMMONED_ADD_THREAT_SEED } from '../../threat';
import { dist2d, type Entity } from '../../types';
import { mobCombatProfile } from '../combat_profile';

/** Spawn one kit add of `templateId` at (x, z), owned by `owner`, straight
 *  into the fight on `victim` (when there is one). Returns the add. */
export function spawnKitAdd(
  ctx: SimContext,
  inst: InstanceSlot,
  owner: Entity,
  templateId: string,
  x: number,
  z: number,
  victim: Entity | null,
): Entity | null {
  const template = MOBS[templateId];
  if (!template) return null;
  const addTemplate = mobTemplateForDungeonDifficulty(template, inst.dungeonId, inst.difficulty, {
    summonedAdd: true,
  });
  const level = mobLevelForDungeonDifficulty(inst.dungeonId, inst.difficulty, template.minLevel);
  const add = createMob(ctx.nextId++, addTemplate, level, ctx.groundPos(x, z));
  applyDungeonMobTuning(add, inst.dungeonId, inst.difficulty, { summonedAdd: true });
  add.tappedById = owner.tappedById;
  add.summonedAdd = true;
  add.facing = owner.facing;
  add.prevFacing = owner.facing;
  ctx.addEntity(add);
  owner.summonedIds.push(add.id);
  inst.mobIds.push(add.id);
  if (victim && !victim.dead && victim.kind === 'player') {
    add.aggroTargetId = victim.id;
    add.inCombat = true;
    add.aiState =
      dist2d(add.pos, victim.pos) > mobCombatProfile(add).meleeRange ? 'chase' : 'attack';
    add.leashAnchor = { ...add.pos };
    addThreat(add, victim.id, SUMMONED_ADD_THREAT_SEED);
  }
  return add;
}
