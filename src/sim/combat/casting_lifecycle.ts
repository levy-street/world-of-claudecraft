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

import { ITEMS, isDelvePos, MOBS } from '../data';
import { scheduleProjectile } from '../projectile_travel';
import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import { abilityScalingPower, channelTickBonus } from '../spell_scaling';
import type { AbilityDef, Entity, Vec3 } from '../types';
import {
  angleTo,
  armorReduction,
  CAST_COMPLETE_EPS,
  CAST_PUSHBACK_SEC,
  CHANNEL_PUSHBACK_FRACTION,
  DEMON_HEAL_CAST_ID,
  DT,
  dist2d,
  FACING_HOLD_DIST,
  FISHING_CAST_ID,
  MELEE_ARC,
  MELEE_RANGE,
  normAngle,
} from '../types';
import { isLockedOut, isSilenced, isStunned, tonguesMult } from './cc';
import {
  consumeNextAttackCrit,
  consumeNextCastFree,
  consumeNextCastInstant,
  hasNextCastFree,
} from './empower_next';
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
      // completed ground-targeted channels drop their aim like every other
      // resolve path: castAim is always cleared on resolve
      p.castAim = null;
      p.castTargetId = null;
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
    // the aim point is consumed by the resolved area effects; drop it so a later
    // non-aimed cast can't inherit a stale target point.
    p.castAim = null;
    p.castTargetId = null;
  }
}

export function cancelCast(ctx: SimContext, p: Entity): void {
  p.castingAbility = null;
  p.castRemaining = 0;
  p.channeling = false;
  p.castAim = null;
  p.castTargetId = null;
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

export function castAbilityBySlot(
  ctx: SimContext,
  slot: number,
  pid?: number,
  aim?: { x: number; z: number },
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const known = r.meta.known[slot];
  if (known) castAbility(ctx, known.def.id, pid, aim);
}

export function castAbility(
  ctx: SimContext,
  abilityId: string,
  pid?: number,
  aim?: { x: number; z: number },
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  let res = ctx.resolvedAbility(abilityId, p.id);
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
  const canCastFree = res.cost > 0 && hasNextCastFree(p);
  if (p.resource < res.cost && !canCastFree && !togglingOff && !formShiftKind(p, ability)) {
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
  // combo points are character-bound: any built points finish on the current target
  if (ability.spendsCombo && p.comboPoints <= 0) {
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
      ctx.error(p.id, `You must be in ${ability.requiresForm === 'bear' ? 'Bruin' : 'Wolf'} Form.`);
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
        // Inside FACING_HOLD_DIST the target's facing is held steady (see
        // steadyAngleTo) and "behind" is undefined anyway, so overlapping the
        // target always reads as in front: no point-blank Backstab through a
        // frozen facing.
        const behindDiff = Math.abs(normAngle(angleTo(target.pos, p.pos) - target.facing));
        if (behindDiff < Math.PI / 2 || dist2d(target.pos, p.pos) < FACING_HOLD_DIST) {
          ctx.error(p.id, 'You must be behind your target.');
          return;
        }
      }
      if (eff.type === 'polymorph') {
        if (target.kind === 'mob') {
          const fam = MOBS[target.templateId]?.family;
          // Undead/gorrak are lore-exempt; cc-immune mobs (raid bosses) reject it here so
          // the cast never reaches the effect's sheep full-heal side effect.
          if (
            fam === 'undead' ||
            target.templateId === 'gorrak' ||
            MOBS[target.templateId]?.ccImmune ||
            target.ccImmune
          ) {
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
  // Ground-targeted abilities aim at a world point instead of an entity. The
  // client proposes the point; the server clamps it to the ability's range from
  // the caster (authoritative) and the cast's area effects center on it.
  let aimPoint: Vec3 | null = null;
  if (ability.targetMode === 'position') {
    if (aim) {
      const maxRange = ability.range > 0 ? ability.range : MELEE_RANGE;
      const dx = aim.x - p.pos.x;
      const dz = aim.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      aimPoint =
        d > maxRange
          ? { x: p.pos.x + (dx / d) * maxRange, y: p.pos.y, z: p.pos.z + (dz / d) * maxRange }
          : { x: aim.x, y: p.pos.y, z: aim.z };
    } else {
      // No point chosen (e.g. a keybind cast with nothing under the cursor): fall
      // back to the caster's own position so the spell still resolves at the feet,
      // exactly as a caster-centered cast would.
      aimPoint = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    }
  }

  if (p.sitting) ctx.standUp(p);
  if (ability.id !== 'ghost_wolf' && p.auras.some((a) => a.id === 'ghost_wolf')) {
    ctx.breakGhostWolf(p);
  }
  // Stash the (clamped) aim so the resolved area effects read it, both for an
  // instant cast (resolved just below) and a cast-time spell (resolved on
  // completion in updateCasting). Cleared there / on cancel.
  p.castAim = aimPoint;

  // Heroic-strike style: queue on next swing, pay cost on the swing itself.
  if (ability.onNextSwing) {
    const toggledOff = p.queuedOnSwing === ability.id;
    p.queuedOnSwing = toggledOff ? null : ability.id;
    if (!toggledOff && canCastFree && consumeNextCastFree(ctx, p)) {
      p.queuedOnSwingFree = true;
    } else {
      delete p.queuedOnSwingFree;
    }
    if (!p.autoAttack && target) ctx.startAutoAttack(p.id);
    return;
  }
  p.castTargetId = target?.id ?? null;

  const gcd = ctx.playerGcdFor(meta.cls);
  // A channel keeps its duration, so it must not eat a next_cast_instant charge.
  const castTime =
    !ability.channel &&
    res.castTime > 0 &&
    ability.school !== 'physical' &&
    consumeNextCastInstant(ctx, p)
      ? 0
      : res.castTime;
  // A free cast is consumed where the cost is actually billed: here for channels
  // and instants (this tick resolves them via the local `res`), but for cast-time
  // spells the bill lands in applyAbility at completion, which RE-RESOLVES the
  // ability, so the charge must survive until then and be consumed there.
  if ((castTime === 0 || ability.channel) && !togglingOff) {
    if (canCastFree && consumeNextCastFree(ctx, p)) res = { ...res, cost: 0 };
  }

  if (ability.channel) {
    spendResource(p, res.cost);
    armAbilityCooldown(p, ability.id, res.cooldown);
    // Spell haste (item-set bonus) shortens the whole channel and so each tick.
    const channelDuration = ability.channel.duration / (1 + p.spellHaste);
    p.castingAbility = ability.id;
    p.castTotal = channelDuration;
    p.castRemaining = channelDuration;
    p.channeling = true;
    p.channelTickEvery = channelDuration / ability.channel.ticks;
    p.channelTickTimer = p.channelTickEvery;
    p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
    ctx.emit({
      type: 'castStart',
      entityId: p.id,
      ability: ability.id,
      time: channelDuration,
    });
    // A channel never reaches applyAbility (its ticks resolve in updateCasting),
    // so 'spellCast' set procs (Clearcasting) roll HERE, once per channel start.
    // Gated on setProcs inside applySetProcs, so proc-less players draw no rng.
    if (p.kind === 'player' && ability.school !== 'physical')
      ctx.applySetProcs(p, target ?? null, 'spellCast');
    return;
  }

  if (castTime > 0 && !togglingOff) {
    // Spell haste (item-set bonus) shortens the cast; Curse of Tongues stretches it.
    // Physical-school casts (Slam) ride spellHaste too: set-bonus haste is ONE stat,
    // so meleeHaste always equals spellHaste and the classic melee-haste scaling
    // falls out identically. If the haste channels ever split, give physical casts
    // p.meleeHaste here (and mirror `mh` over the wire for the tooltip).
    const stretchedCastTime = (castTime * tonguesMult(p)) / (1 + p.spellHaste);
    p.castingAbility = ability.id;
    p.castTotal = stretchedCastTime;
    p.castRemaining = stretchedCastTime;
    p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
    ctx.emit({ type: 'castStart', entityId: p.id, ability: ability.id, time: stretchedCastTime });
    return;
  }

  if (!ability.offGcd) p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
  applyAbility(ctx, p, meta, res);
  // instant ground-targeted cast: its effects have consumed the aim point.
  p.castAim = null;
  p.castTargetId = null;
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
  // Ground-targeted channels (Rain of Fire / Volley / Hurricane): each tick pulses
  // the ability's aoeDamage at the aimed point (clamped at cast start, held in
  // castAim for the channel's life), independent of any entity target.
  if (res.def.targetMode === 'position') {
    const center = p.castAim ?? p.pos;
    const isSpell = res.def.school !== 'physical';
    const radius = res.effects.find((eff) => eff.type === 'aoeDamage')?.radius;
    ctx.emit({
      type: 'spellfxAt',
      x: center.x,
      z: center.z,
      school: res.def.school,
      fx: 'nova',
      radius,
    });
    const channelSp = channelTickBonus(abilityScalingPower(p, res.def), res.def);
    for (const eff of res.effects) {
      if (eff.type !== 'aoeDamage') continue;
      for (const m of ctx.hostilesInRadius(p, center, eff.radius)) {
        if (!ctx.hasLineOfSight(p, m)) continue;
        let dmg = ctx.rng.range(eff.min, eff.max) + channelSp;
        // physical channels (Volley) are mitigated by armor; spell-school rain is not,
        // mirroring the instant aoeDamage path in effect_dispatch.
        if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(m), p.level);
        ctx.dealDamage(p, m, Math.round(dmg), false, res.def.school, res.def.name, 'hit');
      }
    }
    return;
  }

  const target = p.castTargetId !== null ? ctx.entities.get(p.castTargetId) : null;
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
        const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, src) ? 1 : ctx.spellCrit(src));
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
  // The free charge is consumed exactly where a cost is actually billed; the
  // early-return utility branches below bill directly, so they must go through
  // this too or a free conjure/revive would keep the charge alive.
  const billableCost = (): number =>
    res.cost > 0 && !togglingOff && consumeNextCastFree(ctx, p) ? 0 : res.cost;
  if (ability.id === 'conjure_water') {
    // higher ranks conjure better water (falls back if the item isn't defined)
    const tiered = `conjured_water${res.rank}`;
    const waterId = res.rank > 1 && ITEMS[tiered] ? tiered : 'conjured_water';
    if (!ctx.canAddItem(waterId, 2, p.id)) {
      ctx.error(p.id, 'Your bags are full.');
      return;
    }
    spendResource(p, billableCost());
    ctx.addItem(waterId, 2, p.id);
    return;
  }
  if (ability.id === 'conjure_food') {
    // higher ranks conjure heartier fare (falls back if the item isn't defined)
    const tiered = `conjured_bread${res.rank}`;
    const foodId = res.rank > 1 && ITEMS[tiered] ? tiered : 'conjured_bread';
    if (!ctx.canAddItem(foodId, 2, p.id)) {
      ctx.error(p.id, 'Your bags are full.');
      return;
    }
    spendResource(p, billableCost());
    ctx.addItem(foodId, 2, p.id);
    return;
  }
  if (ability.id === 'revive_pet') {
    const pet = ctx.petOf(p.id, true);
    if (!pet) {
      ctx.error(
        p.id,
        isDelvePos(p.pos.x) ? 'Pets are not allowed inside the delves.' : 'You have no pet.',
      );
      return;
    }
    if (!pet.dead) {
      ctx.error(p.id, 'Your pet is already alive.');
      return;
    }
    spendResource(p, billableCost());
    armAbilityCooldown(p, ability.id, res.cooldown);
    ctx.revivePet(p.id);
    return;
  }

  let target: Entity | null = null;
  if (ability.requiresTarget && ability.targetType === 'friendly') {
    const cur = p.castTargetId !== null ? (ctx.entities.get(p.castTargetId) ?? null) : null;
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
    target = p.castTargetId !== null ? (ctx.entities.get(p.castTargetId) ?? null) : null;
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
  const canCastFree = res.cost > 0 && hasNextCastFree(p);
  if (p.resource < res.cost && !canCastFree && !togglingOff && !formShiftKind(p, ability)) {
    ctx.error(p.id, `Not enough ${p.resourceType ?? 'resource'}!`);
    return;
  }
  if (canCastFree && !togglingOff && consumeNextCastFree(ctx, p)) res = { ...res, cost: 0 };

  // helpful spells never miss
  if (ability.targetType === 'friendly') {
    spendAbilityCost(p, res);
    armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
    ctx.runEffects(p, meta, target, res);
    // 'spellCast' means SPELLS: a physical friendly ability never rolls.
    if (p.kind === 'player' && ability.school !== 'physical')
      ctx.applySetProcs(p, target, 'spellCast');
    return;
  }

  // A ranged attack travels as a projectile, so its damage/effects resolve when the
  // bolt LANDS, not at cast completion. Every non-physical spell is a bolt by
  // convention (school proxy); a physical ranged shot (hunter Aimed / Concussive Shot)
  // opts in with projectile:true. Without this a physical shot deals its damage
  // instantly while the arrow is still visibly in flight (health drops, or the mob
  // dies, before it arrives).
  const firesProjectile = ability.school !== 'physical' || ability.projectile === true;
  if (target && firesProjectile) {
    const isSpell = ability.school !== 'physical';
    spendAbilityCost(p, res);
    armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
    ctx.emit({
      type: 'spellfx',
      sourceId: p.id,
      targetId: target.id,
      school: ability.school,
      // A spell may override the flying-bolt visual (e.g. Lightning Bolt draws a
      // jagged electric strike); the projectile MECHANIC below is unchanged.
      fx: ability.projectileFx ?? 'projectile',
    });
    // The bolt is now in flight: its hit roll and effects resolve when it reaches the
    // target (projectile_travel), not this tick. A target that dies before impact
    // takes nothing (the fizzle is handled by scheduleProjectile). Spells never "miss"
    // like a physical attack; a target can only fully RESIST them (classic-era
    // semantics), so a spell's on-impact roll uses isSpellResisted and emits a 'resist'.
    // A physical shot has no resist roll; its hit/crit resolve inside runEffects.
    scheduleProjectile(ctx, p, target, (src, tgt) => {
      if (isSpell && isSpellResisted(ctx.rng, src.level, tgt.level)) {
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
    // 'spellCast' set procs (Clearcasting) roll at CAST COMPLETION, matching the
    // trigger name: the cast is done even though the bolt is still in flight (a
    // resisted or fizzled bolt was still a cast). Physical projectile shots
    // (hunter Aimed / Concussive) are not spells and never roll.
    if (p.kind === 'player' && isSpell) ctx.applySetProcs(p, target, 'spellCast');
    return;
  }

  spendAbilityCost(p, res);
  armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
  ctx.runEffects(p, meta, target, res);
  // 'spellCast' means SPELLS: physical specials (a cat/bear weapon strike from a
  // cloth-capable druid) and toggle-offs fall through here and must not roll.
  if (p.kind === 'player' && ability.school !== 'physical' && !togglingOff)
    ctx.applySetProcs(p, target, 'spellCast');
}
