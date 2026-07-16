// Player auto-attack + the melee/ranged white-hit table, extracted from the Sim
// monolith (C5). This module owns:
//   - startAutoAttack / stopAutoAttack: the public auto-attack toggle (validate
//     target, aggro an idle mob, enter combat).
//   - updatePlayerAutoAttack: the per-tick driver (swing-timer decay, facing/range
//     gates, the ranged-vs-melee branch, and queuedOnSwing consumption that feeds
//     on-next-swing abilities like Heroic Strike / Raptor Strike into the swing).
//   - rangedSwing: Auto Shot (hunters, 8yd dead zone) and Wand (casters, no dead
//     zone); miss roll, crit, and armor mitigation for physical shots only.
//   - meleeSwing: the white-hit table (single rng.next() miss -> dodge -> hit, crit,
//     weapon imbue bonus, armor mitigation, and the thorns / spiked-hide reflect
//     tail). Returns whether the swing connected so the effect_dispatch weaponStrike
//     handler can gate its combo award.
//
// The swing sites resolve crit/dodge/miss/armor UPSTREAM and hand dealDamage an
// already-mitigated amount; dealDamage (C1, combat/damage.ts) applies the
// post-mitigation amp/absorb/death routing on top.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Each function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam),
// `this.{isStunned,isDisarmed,blindMissBonus}` to sibling imports from ./cc, and
// `this.spendResource` to the sibling export from ./casting_lifecycle. Statement
// order, branch order, the single shared rng draw order, and the in-place Entity
// mutation (the refactor's immutability waiver) are preserved exactly so the parity
// gate's full-state trace and rng draw-order log stay byte-identical.
//
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now; all randomness is the shared
// `ctx.rng` stream, drawn in the exact pre-move positions.

import { CLASSES, isArenaPos, MOBS } from '../data';
import { scheduleProjectile } from '../projectile_travel';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { addThreat } from '../threat';
import {
  angleTo,
  armorReduction,
  DT,
  dist2d,
  type Entity,
  MELEE_ARC,
  MELEE_RANGE,
  normAngle,
  swingMissChance,
} from '../types';
import { drawWeapon } from '../weapon_stow';
import { spendResource } from './casting_lifecycle';
import { blindMissBonus, isDisarmed, isStunned } from './cc';
import { consumeNextAttackCrit } from './empower_next';
import { runWeaponProcs } from './equip_procs';
import { baseSwingSpeed } from './form_swing';
import { rangedShotProfile } from './ranged_shot';
import { applyThornsReaction } from './thorns_charge';

// Fraction of the mainhand weapon's damage a hunter's Auto Shot deals. There is no
// dedicated ranged-weapon slot, so the mainhand doubles as the "bow"; a full melee
// weapon's damage on ranged would push a fully geared hunter's white DPS well past
// the melee classes (measured ~+30%), so only part of it carries to the shot. The
// agility-driven ranged attack-power term is unaffected, and wands (the caster
// sidearm, fixed class damage) are exempt.
const RANGED_WEAPON_COEFF = 0.6;

export function startAutoAttack(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const p = r.e;
  if (p.dead) return;
  const t = p.targetId !== null ? ctx.entities.get(p.targetId) : null;
  if (!t || t.dead || !ctx.isHostileTo(p, t)) {
    ctx.error(p.id, 'Invalid attack target.');
    return;
  }
  if (p.sitting) ctx.standUp(p);
  if (p.weaponStowed) drawWeapon(p);
  p.autoAttack = true;
  r.meta.lastActiveTick = ctx.tickCount; // starting auto-attack is a deliberate action
  // Engaging MELEE auto-attack seeds aggro at once, because the swing lands almost
  // immediately. Ranged auto-attack (wand / auto shot, up to 30-35yd) must NOT pre-aggro
  // at engage: its threat comes from the shot LANDING (rangedSwing schedules a projectile
  // whose impact aggros, like the spell it accompanies). Otherwise the "Attack on Ability
  // Use" QoL, which engages auto-attack when you cast a damaging spell, pulls a distant
  // mob the instant the cast starts, before anything lands.
  const d = dist2d(p.pos, t.pos);
  // The melee seed is additionally gated on no cast in progress: the swing loop is
  // paused while casting (updatePlayerAutoAttack bails on castingAbility), so a
  // mid-cast Attack press must not aggro an untouched mob (the aggro-before-damage
  // bug, #1324). The toggle still arms autoAttack above; once the cast resolves, the
  // first landed swing (or the spell's own damage) aggros the target legitimately.
  if (
    d <= MELEE_RANGE &&
    !p.castingAbility &&
    t.kind === 'mob' &&
    t.hostile &&
    t.ownerId === null &&
    t.aiState !== 'evade'
  ) {
    if (t.aiState === 'idle') ctx.aggroMob(t, p, true);
    else if (t.aggroTargetId === null) t.aggroTargetId = p.id;
    addThreat(t, p.id, 1);
    p.combatTimer = 0;
    p.inCombat = true;
  }
}

export function stopAutoAttack(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (r) r.e.autoAttack = false;
}

export function updatePlayerAutoAttack(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  p.swingTimer = Math.max(0, p.swingTimer - DT);
  if (!p.autoAttack || p.castingAbility) return;
  const t = p.targetId !== null ? ctx.entities.get(p.targetId) : null;
  if (!t || t.dead || !ctx.isHostileTo(p, t)) {
    p.autoAttack = false;
    return;
  }
  if (p.swingTimer > 0) return;
  if (isStunned(p)) return;
  if (isDisarmed(p)) return; // weapon knocked away: no auto-attack swings
  const d = dist2d(p.pos, t.pos);
  const facingDiff = Math.abs(normAngle(angleTo(p.pos, t.pos) - p.facing));
  if (facingDiff > MELEE_ARC) return;

  // ranged auto-attack: hunters (auto shot, dead zone inside minRange) and
  // casters (wand-style, no dead zone so they don't run into melee — #94)
  const ranged = CLASSES[meta.cls].ranged;
  if (ranged && d <= ranged.maxRange && d >= (ranged.wand ? 0 : ranged.minRange)) {
    if (!ctx.hasLineOfSight(p, t)) return;
    ctx.breakGhostWolf(p);
    // Hunters shoot with their equipped weapon (damage range + speed), casters
    // with their fixed class wand; the shot then fires at that resolved profile.
    const shot = rangedShotProfile(ranged, p.weapon);
    rangedSwing(ctx, p, t, { ...ranged, min: shot.min, max: shot.max, speed: shot.speed });
    // The weapon's speed sets the cadence; ranged haste (item-set bonus) then
    // shortens the auto-shot interval.
    p.swingTimer = (shot.speed * ctx.swingIntervalMult(p)) / (1 + p.rangedHaste);
    return;
  }
  if (d > MELEE_RANGE) return;
  // Melee normally skips line of sight (it's always point-blank), but the
  // arena's thin enclosing walls sit inside MELEE_RANGE: without this a
  // combatant pressed against a wall could swing through it. See sibling
  // logic in Sim.abilityNeedsLineOfSight.
  if (isArenaPos(p.pos.x) && !ctx.hasLineOfSight(p, t)) return;
  ctx.breakGhostWolf(p);

  let bonus = 0;
  let abilityName: string | null = null;
  let threatFlat = 0;
  let threatMult = 1;
  if (p.queuedOnSwing) {
    const queued = ctx.resolvedAbility(p.queuedOnSwing, p.id);
    if (queued) {
      const eff = queued.effects.find((e) => e.type === 'weaponDamage');
      const queuedCost = p.queuedOnSwingFree === true ? 0 : queued.cost;
      if (p.resource >= queuedCost && eff && eff.type === 'weaponDamage') {
        spendResource(p, queuedCost);
        // on-next-swing abilities (e.g. Raptor Strike) resolve here rather than
        // in castAbility, so their cooldown must be applied on the swing too (#56)
        if (queued.def.cooldown > 0) p.cooldowns.set(queued.def.id, queued.def.cooldown);
        bonus = eff.bonus;
        abilityName = queued.def.name;
        threatFlat = queued.threatFlat;
        threatMult = queued.threatMult;
      }
    }
    p.queuedOnSwing = null;
    delete p.queuedOnSwingFree;
  }
  meleeSwing(ctx, p, t, bonus, abilityName, { threatFlat, threatMult });
  // Wolf Form swings at the rogue's fixed feral cadence, not the carried weapon's
  // speed (see combat/form_swing.ts); everyone else uses their weapon speed. Melee
  // haste (item-set bonus) then shortens whatever base interval that yields.
  p.swingTimer = (baseSwingSpeed(p) * ctx.swingIntervalMult(p)) / (1 + p.meleeHaste);
}

export const AUTO_SHOT_LABEL = 'Auto Shot';

export function rangedSwing(
  ctx: SimContext,
  attacker: Entity,
  target: Entity,
  ranged: { min: number; max: number; speed: number; wand?: boolean; school?: string },
): void {
  const school = ranged.wand ? (ranged.school ?? 'arcane') : 'physical';
  const label = ranged.wand ? 'Wand' : AUTO_SHOT_LABEL;
  ctx.emit({
    type: 'spellfx',
    sourceId: attacker.id,
    targetId: target.id,
    school,
    fx: 'projectile',
    ...(ranged.wand ? { wand: true as const } : { attackAnimation: 'ranged-shot' as const }),
  });
  // The shot/bolt is in flight: its miss roll and damage land when it reaches the
  // target (projectile_travel), and fizzle if the target dies before impact.
  scheduleProjectile(ctx, attacker, target, (atk, tgt) => {
    const missChance = swingMissChance(atk, tgt) + blindMissBonus(atk);
    if (ctx.rng.chance(missChance)) {
      ctx.emit({
        type: 'damage',
        sourceId: atk.id,
        targetId: tgt.id,
        amount: 0,
        crit: false,
        school,
        ability: label,
        kind: 'miss',
        ...(ranged.wand ? {} : { attackAnimationStarted: true as const }),
      });
      ctx.enterCombat(atk, tgt);
      return;
    }
    // Only part of a melee weapon's roll carries to a hunter's Auto Shot (see
    // RANGED_WEAPON_COEFF); a wand deals its full fixed damage. The ranged AP term
    // (agility) is unaffected either way.
    const weaponRoll = ctx.rng.range(ranged.min, ranged.max);
    let dmg =
      (ranged.wand ? weaponRoll : weaponRoll * RANGED_WEAPON_COEFF) +
      (atk.rangedPower / 14) * ranged.speed;
    // ranged white hits suffer the same higher-level crit suppression as melee
    const critChance = Math.max(0.005, atk.critChance - Math.max(0, tgt.level - atk.level) * 0.002);
    const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, atk) ? 1 : critChance);
    if (crit) dmg *= 2 + atk.critDmgPhysBonus;
    // wand bolts are magic — armor doesn't apply; physical auto shot is mitigated
    if (!ranged.wand) dmg *= 1 - armorReduction(ctx.effectiveArmor(tgt), atk.level);
    ctx.dealDamage(
      atk,
      tgt,
      Math.max(1, Math.round(dmg)),
      crit,
      school,
      label,
      'hit',
      false,
      undefined,
      true,
      !ranged.wand,
    );
    // 4-piece set procs keyed to weapon crits (ranged arm). Gated on setProcs
    // inside applySetProcs, so proc-less players draw no rng.
    if (crit && atk.kind === 'player') ctx.applySetProcs(atk, tgt, 'weaponCrit');
    // Legendary on-hit weapon procs (e.g. Thronebane's Chain Arc) fire on a hunter's
    // Auto Shot too, since it strikes with the equipped mainhand. Wand bolts do not
    // swing the mainhand, so casters never roll it. No-op (no rng draw) unless the
    // shooter wields a proc weapon with a weaponHit proc.
    if (!ranged.wand) runWeaponProcs(ctx, atk, tgt, 'weaponHit');
  });
}

// Returns true if the swing connected.
export function meleeSwing(
  ctx: SimContext,
  attacker: Entity,
  target: Entity,
  bonus: number,
  abilityName: string | null,
  opts: {
    cannotBeDodged?: boolean;
    weaponMult?: number;
    threatFlat?: number;
    threatMult?: number;
  },
): boolean {
  const missChance = swingMissChance(attacker, target) + blindMissBonus(attacker);
  const dodgeChance = opts.cannotBeDodged
    ? 0
    : target.kind === 'player'
      ? target.dodgeChance
      : 0.05 + Math.max(0, target.level - attacker.level) * 0.005;
  const roll = ctx.rng.next();
  if (roll < missChance) {
    ctx.emit({
      type: 'damage',
      sourceId: attacker.id,
      targetId: target.id,
      amount: 0,
      crit: false,
      school: 'physical',
      ability: abilityName,
      kind: 'miss',
    });
    ctx.enterCombat(attacker, target);
    return false;
  }
  if (roll < missChance + dodgeChance) {
    ctx.emit({
      type: 'damage',
      sourceId: attacker.id,
      targetId: target.id,
      amount: 0,
      crit: false,
      school: 'physical',
      ability: abilityName,
      kind: 'dodge',
    });
    ctx.enterCombat(attacker, target);
    if (attacker.kind === 'player') attacker.overpowerUntil = ctx.time + 5;
    return false;
  }
  const mult = opts.weaponMult ?? 1;
  // weapon imbues (seals, rockbiter) add flat damage to every swing
  let imbueBonus = 0;
  for (const a of attacker.auras) if (a.kind === 'imbue') imbueBonus += a.value;
  let dmg =
    (ctx.rng.range(attacker.weapon.min, attacker.weapon.max) +
      // Normalize the attack-power contribution to the SAME cadence the swing
      // fires at: Wolf Form swings at the rogue speed (baseSwingSpeed), so its
      // AP-per-swing must use that speed too, not the slow staff's, or feral
      // would double-dip (fast swings AND heavy slow-weapon AP weighting).
      (ctx.effectiveAttackPower(attacker) / 14) * baseSwingSpeed(attacker)) *
      mult +
    bonus +
    imbueBonus;
  const critChance = Math.max(
    0.005,
    attacker.critChance - Math.max(0, target.level - attacker.level) * 0.002,
  );
  const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, attacker) ? 1 : critChance);
  if (crit) dmg *= 2 + attacker.critDmgPhysBonus;
  dmg *= 1 - armorReduction(ctx.effectiveArmor(target), attacker.level);
  ctx.dealDamage(
    attacker,
    target,
    Math.max(1, Math.round(dmg)),
    crit,
    'physical',
    abilityName,
    'hit',
    false,
    { flat: opts.threatFlat ?? 0, mult: opts.threatMult ?? 1 },
  );
  // 4-piece set procs keyed to weapon crits (melee arm; covers auto-attack AND
  // the weaponStrike ability path, which resolves through this shell). Gated on
  // setProcs inside applySetProcs, so proc-less players draw no rng.
  if (crit && attacker.kind === 'player') ctx.applySetProcs(attacker, target, 'weaponCrit');
  // thorns / lightning shield: melee attackers take damage back. Charge-limited
  // thorns (Lightning Shield) consume a charge and gate on an internal cooldown.
  if (!attacker.dead) {
    applyThornsReaction(ctx, target, attacker);
    // innate "spiked hide" mobs (e.g. bristleback boars) reflect on every hit
    const spikes = MOBS[target.templateId]?.thorns;
    if (spikes && !attacker.dead) {
      ctx.dealDamage(
        target,
        attacker,
        spikes.value,
        false,
        spikes.school ?? 'physical',
        spikes.name ?? 'Spiked Hide',
        'hit',
        true,
        undefined,
        false, // reflected damage shield: incidental, never walks the leash anchor
      );
    }
  }
  // Legendary on-hit weapon procs (e.g. Thronebane's Chain Arc). No-op (no rng
  // draw) unless the attacker wields a proc weapon with a weaponHit proc.
  runWeaponProcs(ctx, attacker, target, 'weaponHit');
  return true;
}
