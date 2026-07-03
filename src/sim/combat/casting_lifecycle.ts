// Player cast lifecycle, extracted from the Sim monolith (C4a).
//
// This module owns how a cast STARTS (castAbility/castAbilityBySlot: the
// stun/silence/lockout/busy/gcd/cooldown/cost guards, form-toggle handling,
// onNextSwing queueing, channel-start vs timed-cast-start vs instant resolution),
// how it PROGRESSES each tick (updateCasting: interrupt checks, castRemaining
// decay, channel-tick dispatch, finish), how it is CANCELLED or PUSHED BACK
// (cancelCast/pushbackCast, driven inbound from dealDamage's spell-pushback block),
// and how a finished/instant cast RESOLVES up to (but not including) the actual
// ability effects (applyAbility: target/range/LoS resolution + the spell hit roll,
// then spendAbilityCost + armAbilityCooldown + the runEffects hand-off). It also
// owns resource spend (spendResource/spendAbilityCost), form-shift cost accounting
// (formShiftKind), and cooldown arming (armAbilityCooldown).
//
// MOVE, not rewrite (PRIME DIRECTIVE): the bodies are byte-for-byte the same
// statements, branches, and iteration order as the Sim methods they came from, so
// the shared rng draw order (applyChannelTick's crit/range draws and applyAbility's
// spell-hit roll) is preserved exactly. The in-place Entity mutation is kept (the
// immutability rule is waived for these extractions).
//
// `runEffects` (the actual ability resolution) STAYS on Sim and is the C4b boundary:
// applyAbility and applyChannelTick reach it (and every other still-on-Sim helper)
// only through `SimContext`. `cancelCast`/`pushbackCast` stay on the SimContext
// surface because dealDamage (C1, combat/damage.ts) drives them inbound.
//
// `src/sim`-pure: imports only sibling sim types/data + the cc predicates (no
// DOM/Three/render/ui/game/net, no Math.random/Date.now), enforced by
// tests/architecture.test.ts.

import { ITEMS, MOBS } from '../data';
import { scheduleProjectile } from '../projectile_travel';
import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import { abilityScalingPower, channelTickBonus } from '../spell_scaling';
import type { AbilityDef, Entity } from '../types';
import {
  angleTo,
  CAST_COMPLETE_EPS,
  CAST_PUSHBACK_SEC,
  CHANNEL_PUSHBACK_FRACTION,
  DEMON_HEAL_CAST_ID,
  DT,
  dist2d,
  FISHING_CAST_ID,
  MELEE_ARC,
  MELEE_RANGE,
  normAngle,
} from '../types';
import { isLockedOut, isSilenced, isStunned, tonguesMult } from './cc';
import { isSpellResisted } from './spell_resist';

// Shaman shocks (earth/flame/frost) share one cooldown; lightning_shock joins them
// for the shared-cooldown predicate. Moved with the casting slice (only callers).
const SHAMAN_SHOCK_COOLDOWN_IDS = ['earth_shock', 'flame_shock', 'frost_shock'] as const;

function isFormToggle(ability: AbilityDef): boolean {
  return ability.effects.some(
    (e) =>
      e.type === 'selfBuff' &&
      (e.kind === 'form_bear' || e.kind === 'form_cat' || e.kind === 'form_travel'),
  );
}

// Forms, stances and stealth are toggles: re-casting cancels the aura, and
// cancelling is never gated by cost or cooldown (the cooldown gates re-entry).
function isToggleBuff(ability: AbilityDef): boolean {
  if (ability.id === 'ghost_wolf') return true;
  return ability.effects.some(
    (e) =>
      e.type === 'selfBuff' &&
      (e.kind === 'form_bear' ||
        e.kind === 'form_cat' ||
        e.kind === 'form_travel' ||
        e.kind === 'defensive_stance' ||
        e.kind === 'stealth'),
  );
}

function isShamanShock(abilityId: string): boolean {
  return (
    (SHAMAN_SHOCK_COOLDOWN_IDS as readonly string[]).includes(abilityId) ||
    abilityId === 'lightning_shock'
  );
}

export function updateCasting(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (!p.castingAbility) return;
  if (isStunned(p)) {
    cancelCast(ctx, p);
    return;
  }
  // a silence breaks an in-progress spell, but never the fishing cast or a
  // physical channel (e.g. an aimed-shot kind) — those aren't spells.
  if (isSilenced(p) && p.castingAbility !== FISHING_CAST_ID) {
    const cast = ctx.resolvedAbility(p.castingAbility, p.id);
    if (cast && cast.def.school !== 'physical') {
      cancelCast(ctx, p);
      return;
    }
  }
  // a school lockout breaks an in-progress spell only when it matches the locked school.
  if (p.castingAbility !== FISHING_CAST_ID) {
    const cast = ctx.resolvedAbility(p.castingAbility, p.id);
    if (cast && cast.def.school !== 'physical' && isLockedOut(p, cast.def.school)) {
      cancelCast(ctx, p);
      return;
    }
  }
  p.castRemaining -= DT;

  if (p.channeling) {
    p.channelTickTimer -= DT;
    if (p.channelTickTimer <= 0) {
      p.channelTickTimer += p.channelTickEvery;
      if (p.castingAbility === DEMON_HEAL_CAST_ID) {
        ctx.applyDemonHealTick(p);
      } else {
        const res = ctx.resolvedAbility(p.castingAbility, p.id);
        if (res) applyChannelTick(ctx, p, res);
      }
    }
    if (p.castRemaining <= CAST_COMPLETE_EPS) {
      p.castingAbility = null;
      p.channeling = false;
      ctx.emit({ type: 'castStop', entityId: p.id, success: true });
    }
    return;
  }

  if (p.castRemaining <= CAST_COMPLETE_EPS) {
    const castId = p.castingAbility;
    p.castingAbility = null;
    p.castRemaining = 0;
    ctx.emit({ type: 'castStop', entityId: p.id, success: true });
    if (castId === FISHING_CAST_ID) {
      ctx.completeFishing(p, meta);
      return;
    }
    const res = ctx.resolvedAbility(castId, p.id);
    if (res) applyAbility(ctx, p, meta, res);
  }
}

export function cancelCast(ctx: SimContext, p: Entity): void {
  p.castingAbility = null;
  p.castRemaining = 0;
  p.channeling = false;
  ctx.emit({ type: 'castStop', entityId: p.id, success: false });
}

export function pushbackCast(p: Entity): void {
  // Item-set caster bonus scales damage-driven pushback (1 = fully immune).
  const factor = 1 - p.castPushbackReduction;
  if (factor <= 0) return;
  if (p.channeling) {
    p.castRemaining = Math.max(
      0,
      p.castRemaining - p.castTotal * CHANNEL_PUSHBACK_FRACTION * factor,
    );
  } else {
    p.castRemaining += CAST_PUSHBACK_SEC * factor;
    p.castTotal += CAST_PUSHBACK_SEC * factor;
  }
}

export function castAbilityBySlot(ctx: SimContext, slot: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const known = r.meta.known[slot];
  if (known) castAbility(ctx, known.def.id, pid);
}

export function castAbility(ctx: SimContext, abilityId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const res = ctx.resolvedAbility(abilityId, p.id);
  if (!res || p.dead) return;
  meta.lastActiveTick = ctx.tickCount; // a cast attempt is a deliberate action
  const ability = res.def;
  if (isStunned(p)) {
    ctx.error(p.id, 'You are stunned!');
    return;
  }
  if (ability.school !== 'physical' && isSilenced(p)) {
    ctx.error(p.id, 'You are silenced!');
    return;
  }
  if (ability.school !== 'physical' && isLockedOut(p, ability.school)) {
    ctx.error(p.id, 'You are silenced!');
    return;
  }
  if (p.castingAbility) {
    ctx.error(p.id, 'You are busy.');
    return;
  }
  if (!ability.offGcd && p.gcdRemaining > 0) return; // silent, classic spams this
  const togglingOff = isToggleBuff(ability) && p.auras.some((a) => a.id === ability.id);
  const sharedCooldown = isShamanShock(ability.id)
    ? SHAMAN_SHOCK_COOLDOWN_IDS.find((id) => p.cooldowns.has(id))
    : undefined;
  if ((p.cooldowns.has(ability.id) || sharedCooldown) && !togglingOff) {
    ctx.error(p.id, 'That ability is not ready yet.');
    return;
  }
  // shifting out of a form is free; shifting across forms bills the parked
  // mana (the live bar is rage/energy in a form) — see spendAbilityCost
  if (p.resource < res.cost && !togglingOff && !formShiftKind(p, ability)) {
    ctx.error(
      p.id,
      p.resourceType === 'rage'
        ? 'Not enough rage!'
        : p.resourceType === 'energy'
          ? 'Not enough energy!'
          : 'Not enough mana!',
    );
    return;
  }
  // casting is deliberate action — drop any active follow so you don't drift
  ctx.stopFollow(p);
  if (ability.requiresDodgeProc && ctx.time > p.overpowerUntil) {
    ctx.error(p.id, 'Your target must dodge first.');
    return;
  }
  if (ability.spendsCombo && (p.comboPoints <= 0 || p.comboTargetId !== p.targetId)) {
    ctx.error(p.id, 'That ability requires combo points.');
    return;
  }
  // druid forms gate their kit both ways: form abilities need the form, and
  // everything else (the caster kit) is locked while shapeshifted
  const form = p.auras.find(
    (a) => a.kind === 'form_bear' || a.kind === 'form_cat' || a.kind === 'form_travel',
  );
  if (ability.requiresForm) {
    const need = ability.requiresForm === 'bear' ? 'form_bear' : 'form_cat';
    if (!form || form.kind !== need) {
      ctx.error(p.id, `You must be in ${ability.requiresForm === 'bear' ? 'Bear' : 'Wolf'} Form.`);
      return;
    }
  } else if (form && !isFormToggle(ability)) {
    ctx.error(p.id, "You can't do that while shapeshifted.");
    return;
  }
  if (ability.requiresStealth && !p.auras.some((a) => a.kind === 'stealth')) {
    ctx.error(p.id, 'You must be stealthed.');
    return;
  }
  if (ability.requiresOutOfCombat && p.inCombat) {
    ctx.error(p.id, "You can't do that while in combat.");
    return;
  }

  let target: Entity | null = null;
  if (ability.requiresTarget && ability.targetType === 'friendly') {
    // heals/buffs: current friendly target, else yourself
    const cur = p.targetId !== null ? (ctx.entities.get(p.targetId) ?? null) : null;
    target = cur && !cur.dead && ctx.isFriendlyTo(p, cur) ? cur : p;
    const d = dist2d(p.pos, target.pos);
    if (d > Math.max(ability.range, 5)) {
      ctx.error(p.id, 'Out of range.');
      return;
    }
    if (ctx.lineOfSightBlocked(p, target, ability)) {
      ctx.error(p.id, 'Line of sight.');
      return;
    }
  } else if (ability.requiresTarget) {
    target = p.targetId !== null ? (ctx.entities.get(p.targetId) ?? null) : null;
    if (!target || target.dead || !ctx.isHostileTo(p, target)) {
      ctx.error(p.id, 'You have no target.', target?.dead ? 'target_dead' : undefined);
      return;
    }
    const d = dist2d(p.pos, target.pos);
    const maxRange = ability.range > 0 ? ability.range : MELEE_RANGE;
    if (d > maxRange) {
      ctx.error(p.id, 'Out of range.');
      return;
    }
    if (ability.minRange && d < ability.minRange) {
      ctx.error(p.id, 'Too close!');
      return;
    }
    if (ctx.lineOfSightBlocked(p, target, ability)) {
      ctx.error(p.id, 'Line of sight.');
      return;
    }
    const facingDiff = Math.abs(normAngle(angleTo(p.pos, target.pos) - p.facing));
    if (facingDiff > MELEE_ARC) {
      ctx.error(p.id, 'You must be facing your target.');
      return;
    }
    // execute-style gate: only usable while the target is nearly dead
    if (
      ability.requiresTargetHpBelow !== undefined &&
      target.hp > target.maxHp * ability.requiresTargetHpBelow
    ) {
      ctx.error(
        p.id,
        `That ability requires the target below ${Math.round(ability.requiresTargetHpBelow * 100)}% health.`,
      );
      return;
    }
    for (const eff of res.effects) {
      if (eff.type === 'weaponStrike' && eff.requiresBehind) {
        if (!p.weapon.dagger) {
          ctx.error(p.id, 'You must wield a dagger.');
          return;
        }
        const behindDiff = Math.abs(normAngle(angleTo(target.pos, p.pos) - target.facing));
        if (behindDiff < Math.PI / 2) {
          ctx.error(p.id, 'You must be behind your target.');
          return;
        }
      }
      if (eff.type === 'polymorph') {
        if (target.kind === 'mob') {
          const fam = MOBS[target.templateId]?.family;
          if (fam === 'undead' || target.templateId === 'gorrak') {
            ctx.error(p.id, 'This creature cannot be polymorphed.');
            return;
          }
        } else if (target.kind !== 'player') {
          ctx.error(p.id, 'This creature cannot be polymorphed.');
          return;
        }
      }
      if (
        eff.type === 'judgement' &&
        !p.auras.some((a) => a.kind === 'imbue' && a.value2 !== undefined)
      ) {
        ctx.error(p.id, 'You have no active Seal.');
        return;
      }
      if (eff.type === 'taunt' && target.kind !== 'mob') {
        ctx.error(p.id, 'You cannot taunt that.');
        return;
      }
      if (eff.type === 'tamePet') {
        const err = ctx.tameError(p, target);
        if (err) {
          ctx.error(p.id, err);
          return;
        }
      }
    }
  }
  if (p.sitting) ctx.standUp(p);
  if (ability.id !== 'ghost_wolf' && p.auras.some((a) => a.id === 'ghost_wolf')) {
    ctx.breakGhostWolf(p);
  }

  // Heroic-strike style: queue on next swing, pay cost on the swing itself.
  if (ability.onNextSwing) {
    p.queuedOnSwing = p.queuedOnSwing === ability.id ? null : ability.id;
    if (!p.autoAttack && target) ctx.startAutoAttack(p.id);
    return;
  }

  const gcd = ctx.playerGcdFor(meta.cls);

  if (ability.channel) {
    spendResource(p, res.cost);
    armAbilityCooldown(p, ability.id, res.cooldown);
    p.castingAbility = ability.id;
    p.castTotal = ability.channel.duration;
    p.castRemaining = ability.channel.duration;
    p.channeling = true;
    p.channelTickEvery = ability.channel.duration / ability.channel.ticks;
    p.channelTickTimer = p.channelTickEvery;
    p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
    ctx.emit({
      type: 'castStart',
      entityId: p.id,
      ability: ability.id,
      time: ability.channel.duration,
    });
    return;
  }

  if (res.castTime > 0 && !togglingOff) {
    // Curse of Tongues stretches the resolved (already haste-adjusted) cast time.
    const castTime = res.castTime * tonguesMult(p);
    p.castingAbility = ability.id;
    p.castTotal = castTime;
    p.castRemaining = castTime;
    p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
    ctx.emit({ type: 'castStart', entityId: p.id, ability: ability.id, time: castTime });
    return;
  }

  if (!ability.offGcd) p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
  applyAbility(ctx, p, meta, res);
}

export function spendResource(p: Entity, cost: number): void {
  p.resource = Math.max(0, p.resource - cost);
  if (p.resourceType === 'mana' && cost > 0) p.fiveSecondRule = 0;
}

/** Is this cast a form toggle while already shapeshifted? 'off' = leaving
 *  the form (free, classic), 'cross' = bear<->cat (costs the parked mana). */
function formShiftKind(p: Entity, ability: AbilityDef): 'off' | 'cross' | null {
  if (!isFormToggle(ability)) return null;
  if (p.auras.some((a) => a.id === ability.id)) return 'off';
  if (
    p.auras.some((a) => a.kind === 'form_bear' || a.kind === 'form_cat' || a.kind === 'form_travel')
  )
    return 'cross';
  return null;
}

function spendAbilityCost(p: Entity, res: ResolvedAbility): void {
  if (isToggleBuff(res.def) && p.auras.some((a) => a.id === res.def.id)) return;
  const shift = formShiftKind(p, res.def);
  if (shift === 'off') return;
  if (shift === 'cross') {
    p.savedMana = Math.max(0, p.savedMana - res.cost);
    return;
  }
  spendResource(p, res.cost);
}

function armAbilityCooldown(
  p: Entity,
  abilityId: string,
  cooldown: number,
  togglingOff = false,
): void {
  if (cooldown <= 0 || togglingOff) return;
  if (isShamanShock(abilityId)) {
    for (const id of SHAMAN_SHOCK_COOLDOWN_IDS) p.cooldowns.set(id, cooldown);
    return;
  }
  p.cooldowns.set(abilityId, cooldown);
}

function applyChannelTick(ctx: SimContext, p: Entity, res: ResolvedAbility): void {
  const target = p.targetId !== null ? ctx.entities.get(p.targetId) : null;
  if (!target || target.dead || !ctx.isHostileTo(p, target)) {
    cancelCast(ctx, p);
    return;
  }
  const maxRange = res.def.range > 0 ? res.def.range : MELEE_RANGE;
  if (dist2d(p.pos, target.pos) > maxRange) {
    ctx.error(p.id, 'Out of range.');
    cancelCast(ctx, p);
    return;
  }
  if (ctx.lineOfSightBlocked(p, target, res.def)) {
    ctx.error(p.id, 'Line of sight.');
    cancelCast(ctx, p);
    return;
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: target.id,
    school: res.def.school,
    fx: 'projectile',
  });
  // Each channel bolt (e.g. Arcane Missiles) deals its damage on arrival, not on the
  // tick it is fired; a target that dies mid-flight fizzles it (the drain's guard).
  scheduleProjectile(ctx, p, target, (src, tgt) => {
    const channelSp = channelTickBonus(abilityScalingPower(src, res.def), res.def);
    for (const eff of res.effects) {
      if (eff.type === 'directDamage') {
        const crit = ctx.rng.chance(ctx.spellCrit(src));
        let dmg = ctx.rng.range(eff.min, eff.max) + channelSp;
        if (crit) dmg *= 1.5;
        ctx.dealDamage(src, tgt, Math.round(dmg), crit, res.def.school, res.def.name, 'hit');
      } else if (eff.type === 'drainTick') {
        const dmg = Math.round(ctx.rng.range(eff.min, eff.max) + channelSp);
        ctx.dealDamage(src, tgt, dmg, false, res.def.school, res.def.name, 'hit');
        if (!src.dead) {
          const healed = Math.min(Math.round(dmg * eff.healFrac), src.maxHp - src.hp);
          if (healed > 0) {
            src.hp += healed;
            ctx.emit({
              type: 'heal2',
              sourceId: src.id,
              targetId: src.id,
              amount: healed,
              crit: false,
              ability: res.def.name,
            });
            ctx.healingThreat(src, src, healed);
          }
        }
      }
    }
  });
}

function applyAbility(ctx: SimContext, p: Entity, meta: PlayerMeta, res: ResolvedAbility): void {
  const ability = res.def;
  const togglingOff = isToggleBuff(ability) && p.auras.some((a) => a.id === ability.id);
  if (ability.id === 'conjure_water') {
    spendResource(p, res.cost);
    // higher ranks conjure better water (falls back if the item isn't defined)
    const tiered = `conjured_water${res.rank}`;
    ctx.addItem(res.rank > 1 && ITEMS[tiered] ? tiered : 'conjured_water', 2, p.id);
    return;
  }
  if (ability.id === 'conjure_food') {
    spendResource(p, res.cost);
    // higher ranks conjure heartier fare (falls back if the item isn't defined)
    const tiered = `conjured_bread${res.rank}`;
    ctx.addItem(res.rank > 1 && ITEMS[tiered] ? tiered : 'conjured_bread', 2, p.id);
    return;
  }
  if (ability.id === 'revive_pet') {
    const pet = ctx.petOf(p.id, true);
    if (!pet) {
      ctx.error(p.id, 'You have no pet.');
      return;
    }
    if (!pet.dead) {
      ctx.error(p.id, 'Your pet is already alive.');
      return;
    }
    spendResource(p, res.cost);
    armAbilityCooldown(p, ability.id, res.cooldown);
    ctx.revivePet(p.id);
    return;
  }

  let target: Entity | null = null;
  if (ability.requiresTarget && ability.targetType === 'friendly') {
    const cur = p.targetId !== null ? (ctx.entities.get(p.targetId) ?? null) : null;
    target = cur && !cur.dead && ctx.isFriendlyTo(p, cur) ? cur : p;
    if (dist2d(p.pos, target.pos) > Math.max(ability.range, 5) + 2) {
      ctx.error(p.id, 'Out of range.');
      return;
    }
    if (ctx.lineOfSightBlocked(p, target, ability)) {
      ctx.error(p.id, 'Line of sight.');
      return;
    }
  } else if (ability.requiresTarget) {
    target = p.targetId !== null ? (ctx.entities.get(p.targetId) ?? null) : null;
    if (!target || target.dead || !ctx.isHostileTo(p, target)) {
      ctx.error(p.id, 'You have no target.');
      return;
    }
    const d = dist2d(p.pos, target.pos);
    const maxRange = ability.range > 0 ? ability.range : MELEE_RANGE;
    if (d > maxRange + 2) {
      ctx.error(p.id, 'Out of range.');
      return;
    }
    if (ctx.lineOfSightBlocked(p, target, ability)) {
      ctx.error(p.id, 'Line of sight.');
      return;
    }
  }
  if (p.resource < res.cost && !togglingOff && !formShiftKind(p, ability)) {
    ctx.error(p.id, `Not enough ${p.resourceType ?? 'resource'}!`);
    return;
  }

  // helpful spells never miss
  if (ability.targetType === 'friendly') {
    spendAbilityCost(p, res);
    armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
    ctx.runEffects(p, meta, target, res);
    return;
  }

  if (target && ability.school !== 'physical') {
    spendAbilityCost(p, res);
    armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
    ctx.emit({
      type: 'spellfx',
      sourceId: p.id,
      targetId: target.id,
      school: ability.school,
      fx: 'projectile',
    });
    // The bolt is now in flight: its hit roll and effects resolve when it reaches the
    // target (projectile_travel), not this tick. A target that dies before impact
    // takes nothing (the drain fizzles the projectile). Spells never "miss" like a
    // physical attack; a target can only fully RESIST them (classic-era semantics),
    // so the on-impact roll uses isSpellResisted and emits a 'resist', not a 'miss'.
    scheduleProjectile(ctx, p, target, (src, tgt) => {
      if (isSpellResisted(ctx.rng, src.level, tgt.level)) {
        ctx.emit({
          type: 'damage',
          sourceId: src.id,
          targetId: tgt.id,
          amount: 0,
          crit: false,
          school: ability.school,
          ability: ability.name,
          kind: 'resist',
        });
        ctx.enterCombat(src, tgt);
        return;
      }
      ctx.runEffects(src, meta, tgt, res);
    });
    return;
  }

  spendAbilityCost(p, res);
  armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
  ctx.runEffects(p, meta, target, res);
}
