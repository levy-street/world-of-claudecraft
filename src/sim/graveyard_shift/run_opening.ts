// The shift's opening, the concept's soft start: Morthen fades in at his
// throne while the party is already busy in the next room with the last pack
// of crypt monsters, his colleagues, and the monsters the party cleared on the
// way in lie dead behind it, toward the entrance. The pack is Morthen's (owned,
// so the hostility rule sets it against the party), spawned on the pet AI's
// aggressive stance so the fight is on before he arrives; the cleared ones are
// ownerless corpses, which Raise the Fallen can take. Everything here is
// dropped by the teardown. Draws no rng.

import { MOBS } from '../data';
import { createMob } from '../entity';
import { instanceOriginOf } from '../instances/dungeons';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { GRAVEYARD_SHIFT_CLEARED_CORPSES, GRAVEYARD_SHIFT_PACK } from './run_layout';
import type { GraveyardShiftRun } from './run_state';

// The pack's health when Morthen fades in. Tuned on the headless probe: a fresh
// pack of three elites, with his two skeletons, won the shift for him whatever
// he pressed.
export const GRAVEYARD_SHIFT_PACK_HP_FRACTION = 0.12;

function spawnCryptMob(
  ctx: SimContext,
  run: GraveyardShiftRun,
  spot: { templateId: string; x: number; z: number },
): Entity | null {
  const template = MOBS[spot.templateId];
  if (!template) return null;
  const origin = instanceOriginOf(run.slot);
  const e = createMob(
    ctx.nextId++,
    template,
    template.maxLevel,
    ctx.groundPos(origin.x + spot.x, origin.z + spot.z),
  );
  e.loot = null;
  e.lootable = false;
  return e;
}

/** The pack fighting the party and the corpses behind it, at the run's start. */
export function spawnGraveyardShiftOpening(
  ctx: SimContext,
  run: GraveyardShiftRun,
  owner: Entity,
): void {
  // The pack is on the party's tank already (the pet AI keeps an aggro target).
  const tank = run.bots.find((bot) => bot.role === 'tank');
  for (const spot of GRAVEYARD_SHIFT_PACK) {
    const mob = spawnCryptMob(ctx, run, spot);
    if (!mob) continue;
    mob.ownerId = owner.id;
    mob.petMode = 'aggressive';
    mob.aggroTargetId = tank?.pid ?? null;
    // The tail of the fight: the party has been at this pack a while.
    mob.hp = Math.max(1, Math.round(mob.maxHp * GRAVEYARD_SHIFT_PACK_HP_FRACTION));
    mob.hostile = false;
    mob.tappedById = null;
    mob.wanderTarget = null;
    ctx.addEntity(mob);
    run.allyIds.push(mob.id);
    run.packIds.push(mob.id);
  }
  for (const spot of GRAVEYARD_SHIFT_CLEARED_CORPSES) {
    const corpse = spawnCryptMob(ctx, run, spot);
    if (!corpse) continue;
    corpse.dead = true;
    corpse.hp = 0;
    corpse.hostile = false;
    corpse.aiState = 'idle';
    ctx.addEntity(corpse);
    run.corpseIds.push(corpse.id);
  }
}

/** The teardown's half: the pack, standing or fallen (a fallen pack mob has
 *  left the allies and has no despawn timer), and the corpses go with the run. */
export function removeGraveyardShiftOpening(ctx: SimContext, run: GraveyardShiftRun): void {
  for (const id of [...run.packIds, ...run.corpseIds]) if (ctx.entities.has(id)) ctx.dropEntity(id);
  run.packIds.length = 0;
  run.corpseIds.length = 0;
}
