// Two one-line hooks the trash kit's Hollow Crypt pass needs from outside the
// kit's own tick, as a dependency-light leaf (the mob lifecycle and the mob
// cast bars import it; crypt_kit.ts is the kit pass):
//
//   boneShrapnel      a detonating corpse's burst also cuts the skeletons
//                     round it (MobTemplate.deathThroes.shrapnel), called from
//                     mob/lifecycle.ts detonateCorpse.
//   noteBreathLanded  a template breath cone just landed, called from
//                     mob/mob_cast_bars.ts tickBreathConeBar: the kit pass sets
//                     its cone burning on heroic (trashKit.scorch).
//
// Zero rng.

import { MOBS } from '../../data';
import type { SimContext } from '../../sim_context';
import { dist2d, type Entity } from '../../types';
import { CRYPT_SPLINTER_BURST } from './cast_ids';

/**
 * A detonating corpse's shrapnel (deathThroes.shrapnel): every living hostile
 * claim mob of the family inside the burst's radius loses a share of its own
 * health, never the last of it. Called from mob/lifecycle.ts detonateCorpse.
 * Zero rng. Returns how many it cut.
 */
export function boneShrapnel(ctx: SimContext, dead: Entity): number {
  const dt = MOBS[dead.templateId]?.deathThroes;
  const def = dt?.shrapnel;
  if (!dt || !def) return 0;
  const inst = ctx.instances.find((i) => i.mobIds.includes(dead.id));
  if (!inst) return 0;
  let cut = 0;
  for (const id of inst.mobIds) {
    const m = ctx.entities.get(id);
    if (!m || m.id === dead.id || m.kind !== 'mob' || m.dead || m.hp <= 1) continue;
    // Only skeletons in the fight: an unpulled pack is never pre-cut, a boss never.
    if (!m.hostile || !m.inCombat || m.ownerId !== null || m.damageImmune) continue;
    if (MOBS[m.templateId]?.family !== def.family || MOBS[m.templateId]?.boss) continue;
    if (dist2d(m.pos, dead.pos) > dt.radius) continue;
    // Never a killing blow, even through a vulnerability on the victim.
    const amount = Math.min(Math.round(m.maxHp * def.maxHpPct), Math.floor((m.hp - 1) / 2));
    if (amount <= 0) continue;
    ctx.dealDamage(null, m, amount, false, 'physical', def.name, 'hit', true);
    cut++;
  }
  if (cut > 0)
    ctx.emit({
      type: 'spellfx',
      sourceId: dead.id,
      targetId: dead.id,
      school: 'physical',
      fx: 'nova',
      ability: CRYPT_SPLINTER_BURST,
    });
  return cut;
}

/** The breath bar landed (called from mob/mob_cast_bars.ts): remember where
 *  its cone fell, for the kit pass to set burning. */
export function noteBreathLanded(mob: Entity): void {
  if (!MOBS[mob.templateId]?.trashKit?.scorch || !mob.trashKit) return;
  mob.trashKit.scorchAt = { x: mob.pos.x, z: mob.pos.z, facing: mob.facing };
}
