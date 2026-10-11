// The in-flight half of the template cast-bar mechanics (bigCast, the two
// rift death zones, breathCone): the per-tick countdown of a bar that has
// already STARTED, and its landing. The cadence half (when a new bar starts)
// stays in mob/locomotion.ts runMobAttackMechanics and stays melee-gated.
//
// Why the split: the countdown used to live inside the melee-gated mechanics
// tail, so a bar froze on every tick that did not end in melee contact. The
// owner's playtest (2026-10-04) caught it on the Drowned Watchman's Halberd
// Sweep: standing in the drawn area it landed in 1.5 s, stepping out of it
// stalled the bar until the target walked back in, so stepping out of a
// telegraph DELAYED it instead of dodging it. Now a started bar counts down
// on every engaged tick the combat profile runs and lands on time whatever
// the range (the states that own or freeze a mob's whole tick, a stun, a
// pin in place, a flee, a charge dash, keep the bar frozen as before):
//   - a tick that ends in melee runs the full mechanics tail, which ticks the
//     bar here exactly where it always did (same driver order, same draws);
//   - any other engaged tick calls tickStartedMobCastBars, which runs only
//     these in-flight arms, in the same driver order.
// The rift spacing lock (mechanic_spacing.ts) still advances only in melee,
// so it can outlast a bar that landed out of melee: the safe direction (the
// next mechanic waits longer, never lands on top of this one).
// Inside a dungeon that plants its area casts (DungeonDef.areaCastsPlant) the
// breath cone's caster is put back on the spot and the facing its bar began
// with each tick (trash_kit/cast_hold.ts), so it stands its ground through the
// bar instead of chasing the one who stepped out.
//
// The bodies below are MOVED verbatim from locomotion.ts (statement order and
// every rng draw unchanged). Draws rng only where a landing bar rolls damage,
// one roll per player hit, in ctx.players order, exactly as before.

import { MOBS } from '../data';
import { capRiftNonLethalMechanicDamage, riftMechanicSuppressed } from '../rift/ranks';
import type { SimContext } from '../sim_context';
import { type Aura, angleTo, DT, dist2d, type Entity, type MobTemplate, normAngle } from '../types';
import { applyBroodBurn } from './dragonkin_brood';
import { landBreathPool } from './trash_kit/breath_pool';
import { restoreCastHold } from './trash_kit/cast_hold';
import { noteBreathLanded } from './trash_kit/crypt_hooks';

/** True when the mob belongs to a live rift instance: kit bosses via the
 * instance mob roster, and their summoned adds via the roster mobs'
 * summonedIds links (the summon path registers adds on the dungeon/delve
 * rosters, never riftInstance.mobIds, so the reverse link is what keeps a
 * future add template with a raw mechanic inside the cap). Only consulted on
 * mechanic-fire ticks, never per tick. */
export function mobInRiftInstance(ctx: SimContext, mob: Entity): boolean {
  for (const ri of ctx.riftInstances) {
    if (ri.partyKey === null) continue;
    if (ri.mobIds.includes(mob.id)) return true;
    for (const id of ri.mobIds) {
      if (ctx.entities.get(id)?.summonedIds.includes(mob.id)) return true;
    }
  }
  return false;
}

/** Tick a started bigCast bar and land it at zero. Returns false (and does
 *  nothing) when the mob is not casting it, so the caller runs the cadence. */
export function tickBigCastBar(
  ctx: SimContext,
  mob: Entity,
  bigCast: NonNullable<MobTemplate['bigCast']>,
): boolean {
  if (mob.castingAbility !== bigCast.castId) return false;
  mob.castRemaining = Math.max(0, mob.castRemaining - DT);
  if (mob.castRemaining <= 0) {
    mob.castingAbility = null;
    mob.castTotal = 0;
    mob.castRemaining = 0;
    mob.castTargetId = null;
    const school = (bigCast.school ?? 'nature') as Aura['school'];
    ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
    if (!MOBS[mob.templateId]?.quietMechanics)
      ctx.emit({
        type: 'log',
        text: `${mob.name} unleashes ${bigCast.name}!`,
        color: '#ff9933',
        entityId: mob.id,
      });
    const capBigCast = mobInRiftInstance(ctx, mob);
    for (const meta of ctx.players.values()) {
      const pe = ctx.entities.get(meta.entityId);
      if (pe && !pe.dead && dist2d(pe.pos, mob.pos) <= bigCast.radius) {
        let dmg = Math.round(
          ctx.rng.range(bigCast.min, bigCast.max) * (mob.mechanicDamageMult ?? 1),
        );
        if (capBigCast) dmg = capRiftNonLethalMechanicDamage(dmg, pe.maxHp);
        ctx.dealDamage(mob, pe, dmg, false, school, bigCast.name, 'hit', true);
      }
    }
  }
  return true;
}

/** Tick a started death-zone bar (deathZoneCast / deathZoneStrike). The zones
 *  themselves detonate on their own fuse clock (tickRiftBossDeathZones); the
 *  bar's landing only clears it and calls the detonation. Returns false when
 *  the mob is not casting it. */
export function tickDeathZoneBar(
  ctx: SimContext,
  mob: Entity,
  def: NonNullable<MobTemplate['deathZoneCast']>,
): boolean {
  if (mob.castingAbility !== def.castId) return false;
  mob.castRemaining = Math.max(0, mob.castRemaining - DT);
  if (mob.castRemaining <= 0) {
    mob.castingAbility = null;
    mob.castTotal = 0;
    mob.castRemaining = 0;
    mob.castTargetId = null;
    const school = (def.school ?? 'fire') as Aura['school'];
    ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
    if (!MOBS[mob.templateId]?.quietMechanics)
      ctx.emit({
        type: 'log',
        text: def.detonateText,
        color: '#ff4400',
        entityId: mob.id,
        telegraph: true,
      });
    // The zone was placed at cast-start; tickRiftBossDeathZones handles detonation.
  }
  return true;
}

/** Tick a started breath-cone bar and land it at zero on every living player
 *  inside `range` AND the `arcDeg` cone about the mob's facing. Returns false
 *  when the mob is not casting it. */
export function tickBreathConeBar(
  ctx: SimContext,
  mob: Entity,
  breath: NonNullable<MobTemplate['breathCone']>,
): boolean {
  if (mob.castingAbility !== breath.castId) return false;
  // A dungeon mob holds the spot and the facing its bar began with
  // (mob/trash_kit/cast_hold.ts): the cone lands where it was drawn.
  if (restoreCastHold(mob)) ctx.rebucket(mob);
  mob.castRemaining = Math.max(0, mob.castRemaining - DT);
  if (mob.castRemaining <= 0) {
    mob.castingAbility = null;
    mob.castTotal = 0;
    mob.castRemaining = 0;
    mob.castTargetId = null;
    const school = (breath.school ?? 'fire') as Aura['school'];
    // The renderer draws the breath as a terrain-hugging cone off the
    // mob's live facing (the existing fireCone visual), not a nova ring.
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.id,
      school,
      fx: 'fireCone',
      range: breath.range,
      angle: breath.arcDeg,
    });
    if (!MOBS[mob.templateId]?.quietMechanics)
      ctx.emit({
        type: 'log',
        text: `${mob.name} unleashes ${breath.name}!`,
        color: '#ff9933',
        entityId: mob.id,
      });
    const capBreath = mobInRiftInstance(ctx, mob);
    const halfArc = (breath.arcDeg * Math.PI) / 180 / 2;
    for (const meta of ctx.players.values()) {
      const pe = ctx.entities.get(meta.entityId);
      if (!pe || pe.dead || dist2d(pe.pos, mob.pos) > breath.range) continue;
      if (Math.abs(normAngle(angleTo(mob.pos, pe.pos) - mob.facing)) > halfArc) continue;
      let dmg = Math.round(ctx.rng.range(breath.min, breath.max) * (mob.mechanicDamageMult ?? 1));
      if (capBreath) dmg = capRiftNonLethalMechanicDamage(dmg, pe.maxHp);
      ctx.dealDamage(mob, pe, dmg, false, school, breath.name, 'hit', true);
      if (breath.burn && !pe.dead) applyBroodBurn(ctx, mob, pe, breath.burn);
    }
    // A breath that melts the floor leaves its pool (trash_kit/breath_pool.ts).
    landBreathPool(ctx, mob);
    // A kit breath that leaves its fire on the floor (trashKit.scorch).
    noteBreathLanded(mob);
  }
  return true;
}

/**
 * One engaged tick that did NOT end in melee contact (the caller ran the
 * combat profile and it returned 'done'): keep a started bar counting down.
 * Same gates and the same driver order as the melee tail
 * (runMobAttackMechanics), so a mob holds at most one of these bars and the
 * one it holds lands on the same tick it would have in melee. Starts nothing.
 */
export function tickStartedMobCastBars(ctx: SimContext, mob: Entity): void {
  if (mob.castingAbility === null || mob.dead) return;
  if (mob.aiState !== 'chase' && mob.aiState !== 'attack') return;
  const template = MOBS[mob.templateId];
  if (!template) return;
  const bigCast = template.bigCast;
  if (bigCast && !riftMechanicSuppressed(mob, 'bigCast') && tickBigCastBar(ctx, mob, bigCast))
    return;
  const zoneCast = template.deathZoneCast;
  if (
    zoneCast &&
    !riftMechanicSuppressed(mob, 'deathZoneCast') &&
    tickDeathZoneBar(ctx, mob, zoneCast)
  )
    return;
  const zoneStrike = template.deathZoneStrike;
  if (
    zoneStrike &&
    !riftMechanicSuppressed(mob, 'deathZoneStrike') &&
    tickDeathZoneBar(ctx, mob, zoneStrike)
  )
    return;
  const breath = template.breathCone;
  if (breath && !riftMechanicSuppressed(mob, 'breathCone')) tickBreathConeBar(ctx, mob, breath);
}
