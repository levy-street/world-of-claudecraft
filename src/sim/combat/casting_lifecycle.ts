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

import { isDispellableAura } from '../aura_classify';
import { ITEMS, isDelvePos, MOBS } from '../data';
import { recalcPlayerStats } from '../entity';
import { isShieldItem } from '../equipment_rules';
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
  CAST_QUEUE_WINDOW_SEC,
  CHANNEL_PUSHBACK_FRACTION,
  DEMON_HEAL_CAST_ID,
  DT,
  dist2d,
  FACING_HOLD_DIST,
  FISHING_CAST_ID,
  isFormAuraKind,
  MELEE_ARC,
  MELEE_RANGE,
  MIN_GCD,
  normAngle,
} from '../types';
import { drawWeapon } from '../weapon_stow';
import {
  hasUnbreakableMovementLock,
  isInStasis,
  isLockedOut,
  isSilenced,
  isStunned,
  isUnbreakableControlAura,
  tonguesMult,
} from './cc';
import {
  ARCANE_SURGE_ID,
  aetherDartsBoltBonus,
  aetherDartsChannelStart,
  aetherSurgeCastMult,
} from './chronomancy';
import { extendOwnedDot } from './dot_mutation';
import {
  consumeFreeCostFor,
  consumeNextAttackCrit,
  consumeNextCastCheap,
  consumeNextCastInstant,
  hasFreeCostFor,
  hasScopedNextCastInstant,
  nextCastCheapMultiplier,
} from './empower_next';
import { isActionLockingFormAuraKind, isResourceShiftFormAuraKind } from './forms';
import {
  applyBrainFreezeOverride,
  brainFreezeBypassesCooldown,
  frostMageChannelPulse,
  frostMageChannelStart,
} from './frost_mage';
import { empoweredCastProgress, empoweredStageForProgress } from './glacial_front';
import { hasDeadGroupMember, isMassResurrectionAbility } from './mass_resurrection';
import {
  hasCastShield,
  noteSpellHit,
  spellDamageMultFromAuras,
  spellHasteMult,
} from './spell_combat';
import { isSpellResisted } from './spell_resist';
import { onCastCompleted } from './talent_procs';

// Shaman shocks (earth/flame/frost) share one cooldown; lightning_shock joins them
// for the shared-cooldown predicate. Moved with the casting slice (only callers).
const SHAMAN_SHOCK_COOLDOWN_IDS = ['earth_shock', 'flame_shock', 'frost_shock'] as const;
export const COLOSSAL_MIGHT_COOLDOWNS = new Set([
  'recklessness',
  'avatar',
  'storm_bolt',
  'bladestorm',
  'sanguine_aura',
  'bloodthirst',
  'mortal_strike',
  'shield_slam',
]);

function isFormToggle(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff' && isFormAuraKind(e.kind));
}

// Forms, stances and stealth are toggles: re-casting cancels the aura, and
// cancelling is never gated by cost or cooldown (the cooldown gates re-entry).
function isToggleBuff(ability: AbilityDef): boolean {
  if (ability.id === 'ghost_wolf') return true;
  return ability.effects.some(
    (e) =>
      e.type === 'selfBuff' &&
      (isFormAuraKind(e.kind) ||
        e.kind === 'defensive_stance' ||
        e.kind === 'stealth' ||
        e.kind === 'stasis'),
  );
}

function isStasisToggle(ability: AbilityDef): boolean {
  return ability.effects.some((effect) => effect.type === 'selfBuff' && effect.kind === 'stasis');
}

function cancelStasisToggle(ctx: SimContext, entity: Entity, ability: AbilityDef): boolean {
  if (
    !isStasisToggle(ability) ||
    !entity.auras.some(
      (aura) =>
        aura.id === ability.id && aura.sourceId === entity.id && !isUnbreakableControlAura(aura),
    )
  ) {
    return false;
  }
  for (let index = entity.auras.length - 1; index >= 0; index--) {
    const aura = entity.auras[index];
    if (
      (aura.id !== ability.id && aura.id !== `${ability.id}_absorb`) ||
      aura.sourceId !== entity.id ||
      isUnbreakableControlAura(aura)
    )
      continue;
    entity.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
  }
  return true;
}

function isShamanShock(abilityId: string): boolean {
  return (
    (SHAMAN_SHOCK_COOLDOWN_IDS as readonly string[]).includes(abilityId) ||
    abilityId === 'lightning_shock'
  );
}

function chargeState(p: Entity, abilityId: string, bonusCharges: number, cooldown: number) {
  if (bonusCharges <= 0 || cooldown <= 0) return null;
  p.abilityCharges ??= {};
  const maxCharges = 1 + Math.max(0, Math.floor(bonusCharges));
  const existing = p.abilityCharges[abilityId];
  if (existing && existing.maxCharges === maxCharges && existing.rechargeLength === cooldown) {
    return existing;
  }
  const state =
    existing ??
    ({
      charges: maxCharges,
      maxCharges,
      recharge: 0,
      rechargeLength: cooldown,
    } satisfies NonNullable<Entity['abilityCharges']>[string]);
  state.maxCharges = maxCharges;
  state.rechargeLength = cooldown;
  state.charges = Math.min(Math.max(state.charges, 0), maxCharges);
  p.abilityCharges[abilityId] = state;
  return state;
}

function hasAbilityCharge(
  p: Entity,
  abilityId: string,
  bonusCharges: number,
  cooldown: number,
): boolean {
  const state = chargeState(p, abilityId, bonusCharges, cooldown);
  return !!state && state.charges > 0;
}

export function updateCasting(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (!p.castingAbility) {
    // a queued press held back by a still-running GCD (see fireQueuedCast) retries
    // here every tick until the GCD clears, instead of being dropped once at the
    // moment the cast that queued it completed.
    if (p.queuedCastAbility) fireQueuedCast(ctx, p);
    return;
  }
  if (isStunned(p)) {
    cancelCast(ctx, p);
    return;
  }
  const activeCast = ctx.resolvedAbility(p.castingAbility, p.id);
  if (activeCast && isMassResurrectionAbility(activeCast.def)) {
    if (p.inCombat) {
      cancelCast(ctx, p);
      ctx.error(p.id, "You can't do that while in combat.");
      return;
    }
    if (!hasDeadGroupMember(ctx, p)) {
      cancelCast(ctx, p);
      ctx.error(p.id, 'There are no dead group members to resurrect.');
      return;
    }
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
    const fireChannelTick = () => {
      // Read fresh each tick: a tick that cancels the cast (e.g. a LoS block) nulls
      // castingAbility, and the guard here stops the flush from firing any more.
      const abilityId = p.castingAbility;
      if (abilityId == null) return;
      if (abilityId === DEMON_HEAL_CAST_ID) {
        ctx.applyDemonHealTick(p);
      } else {
        const res = ctx.resolvedAbility(abilityId, p.id);
        if (res) applyChannelTick(ctx, p, res);
      }
    };
    p.channelTickTimer -= DT;
    if (p.channelTickTimer <= 0) {
      p.channelTickTimer += p.channelTickEvery;
      // channelTicksLeft is only tracked for FIXED-count channels (it starts > 0);
      // duration-based channels (Demon Heal, boss channels) leave it 0, so they
      // fire unbounded here exactly as before and never flush below.
      if (p.channelTicksLeft > 0) p.channelTicksLeft -= 1;
      fireChannelTick();
    }
    if (p.castRemaining <= CAST_COMPLETE_EPS) {
      // Flush any fixed-count tick the timer has not reached yet: the tick
      // accumulator and the channel's end advance separately, so floating-point
      // drift can leave the final tick a hair short exactly when they coincide,
      // silently dropping the last missile (the Arcane Missiles 5-barrage bug). A
      // fixed-count channel must always land exactly channelTicks ticks. Inert for
      // duration-based channels, whose channelTicksLeft is 0.
      while (p.channelTicksLeft > 0) {
        p.channelTicksLeft -= 1;
        fireChannelTick();
      }
      p.castingAbility = null;
      p.channeling = false;
      // completed ground-targeted channels drop their aim like every other
      // resolve path: castAim is always cleared on resolve
      p.castAim = null;
      p.castTargetId = null;
      ctx.emit({ type: 'castStop', entityId: p.id, success: true });
      fireQueuedCast(ctx, p);
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
    // Ice Floes (mage choice row): a COMPLETED hard cast spends one protected
    // use whether or not the caster actually moved (the buff is a banked
    // window, not a refund). Fishing above never spends one. Draws no rng.
    const floes = p.auras.find((a) => a.kind === 'ice_floes');
    if (floes) {
      floes.value -= 1;
      if (floes.value <= 0) {
        p.auras.splice(p.auras.indexOf(floes), 1);
        ctx.emit({ type: 'aura', targetId: p.id, name: floes.name, gained: false });
      }
    }
    const res = ctx.resolvedAbility(castId, p.id);
    if (res) {
      const resolved = res.def.empowerStages
        ? { ...res, empowerLevel: res.def.empowerStages }
        : res;
      applyAbility(ctx, p, meta, resolved);
    }
    // the aim point is consumed by the resolved area effects; drop it so a later
    // non-aimed cast can't inherit a stale target point.
    p.castAim = null;
    p.castTargetId = null;
    fireQueuedCast(ctx, p);
  }
}

/** Release a hold-to-charge cast. The caller supplies no timing data: the
 * authoritative stage comes exclusively from the simulation's live cast clock. */
export function releaseEmpoweredAbility(ctx: SimContext, abilityId: string, pid?: number): void {
  const resolvedPlayer = ctx.resolve(pid);
  if (!resolvedPlayer) return;
  const { e: p, meta } = resolvedPlayer;
  if (p.castingAbility !== abilityId || p.channeling) return;
  const res = ctx.resolvedAbility(abilityId, p.id);
  const stageCount = res?.def.empowerStages ?? 0;
  if (!res || stageCount <= 0) return;
  if (
    isStunned(p) ||
    (res.def.school !== 'physical' && (isSilenced(p) || isLockedOut(p, res.def.school)))
  ) {
    cancelCast(ctx, p);
    return;
  }

  const level = empoweredStageForProgress(
    empoweredCastProgress(p.castTotal, p.castRemaining),
    stageCount,
  );
  p.castingAbility = null;
  p.castRemaining = 0;
  ctx.emit({ type: 'castStop', entityId: p.id, success: true });

  const floes = p.auras.find((a) => a.kind === 'ice_floes');
  if (floes) {
    floes.value -= 1;
    if (floes.value <= 0) {
      p.auras.splice(p.auras.indexOf(floes), 1);
      ctx.emit({ type: 'aura', targetId: p.id, name: floes.name, gained: false });
    }
  }

  applyAbility(ctx, p, meta, { ...res, empowerLevel: level });
  p.castAim = null;
  p.castTargetId = null;
  fireQueuedCast(ctx, p);
}

// Consumes the single-slot spell queue (see CAST_QUEUE_WINDOW_SEC), firing the
// queued ability exactly as a fresh castAbility press. A cast shorter than the
// flat GCD (the common hasted case) can complete before the GCD armed at its
// start clears: hold the slot in that case and let updateCasting retry every
// tick until the GCD is gone, instead of dropping the press.
function fireQueuedCast(ctx: SimContext, p: Entity): void {
  const queued = p.queuedCastAbility;
  if (!queued) return;
  const res = ctx.resolvedAbility(queued, p.id);
  if (res && !res.def.offGcd && p.gcdRemaining > 0) return;
  const aim = p.queuedCastAim;
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  castAbility(ctx, queued, p.id, aim ?? undefined);
}

export function cancelCast(ctx: SimContext, p: Entity): void {
  p.castingAbility = null;
  p.castRemaining = 0;
  p.channeling = false;
  p.channelTicksLeft = 0; // an interrupted channel owes no more ticks
  p.castAim = null;
  p.castTargetId = null;
  // an interrupted cast never completed, so its queued follow-up is dropped too
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  ctx.emit({ type: 'castStop', entityId: p.id, success: false });
}

export function pushbackCast(p: Entity): void {
  if (hasCastShield(p)) return;
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

// Mouseover-cast (Clique-style) friendly-target resolution: an explicit
// override id (from castAbility's castTargetId param at start, or the
// entity's stored castTargetId at a timed cast's finish) wins while valid;
// a stale/invalid override falls back to the classic current-friendly-target-
// else-self rule, byte-identical to the pre-override behavior when null.
function resolveFriendlyTarget(ctx: SimContext, p: Entity, overrideId: number | null): Entity {
  if (overrideId !== null) {
    const o = ctx.entities.get(overrideId);
    if (o && !o.dead && ctx.isFriendlyTo(p, o)) return o;
  }
  const cur = p.targetId !== null ? (ctx.entities.get(p.targetId) ?? null) : null;
  return cur && !cur.dead && ctx.isFriendlyTo(p, cur) ? cur : p;
}

// Combat-resurrection target (Temporal Reversal): the mouseover override or current
// target, but ONLY when it is a DEAD player in the caster's group/raid. No self-cast
// fallback (you can't rewind yourself). Returns null when there is no valid dead ally.
function resolveDeadAllyTarget(
  ctx: SimContext,
  p: Entity,
  overrideId: number | null,
): Entity | null {
  const id = overrideId ?? p.targetId;
  if (id === null) return null;
  const t = ctx.entities.get(id);
  if (!t || !t.dead || t.kind !== 'player') return null;
  const party = ctx.partyOf(p.id);
  return party && party.members.includes(t.id) ? t : null;
}

export function castAbility(
  ctx: SimContext,
  abilityId: string,
  pid?: number,
  aim?: { x: number; z: number },
  castTargetId: number | null = null,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  let res = ctx.resolvedAbility(abilityId, p.id);
  if (!res || p.dead) return;
  // Passive traits are spellbook information and mechanics hooks, never actions.
  if (res.def.passive) return;
  meta.lastActiveTick = ctx.tickCount; // a cast attempt is a deliberate action
  const ability = res.def;
  if (cancelStasisToggle(ctx, p, ability)) return;
  // Ice Block (usableWhileControlled) may be pressed through ordinary control;
  // cleanseSelf removes the player-breakable debuffs while encounter-authored
  // unbreakable control remains. Its own stasis is handled by the recast toggle above.
  if (!ability.usableWhileControlled) {
    if (isInStasis(p)) return;
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
  }
  if (
    hasUnbreakableMovementLock(p) &&
    res.effects.some(
      (effect) =>
        effect.type === 'blinkForward' ||
        effect.type === 'repositionToAim' ||
        effect.type === 'charge',
    )
  ) {
    ctx.error(p.id, 'You are stunned!');
    return;
  }
  // Blink While Casting (mage choice row): Flickerstep slips through the busy
  // guard AND the GCD, an escape button that never touches the cast in
  // progress (the cast survives the relocation: player_motion only breaks
  // casts on MOVE INPUT). Everything else keeps the classic rules. No rng.
  const blinkThrough =
    p.castingAbility !== null &&
    p.castingAbility !== FISHING_CAST_ID &&
    ability.castTime === 0 &&
    (ability.usableWhileCasting === true ||
      (abilityId === 'blink' && ctx.playerMods(meta).global.blinkCast > 0));
  if (p.castingAbility) {
    if (!blinkThrough) {
      // classic-era spell queue: a press during the tail of the current cast
      // queues instead of erroring, and updateCasting fires it on cast completion.
      // Fishing is exempt (like the silence/lockout guards above): completeFishing
      // never calls fireQueuedCast, so a press queued against it would strand and
      // misfire on a later, unrelated cast.
      if (p.castRemaining <= CAST_QUEUE_WINDOW_SEC && p.castingAbility !== FISHING_CAST_ID) {
        p.queuedCastAbility = abilityId;
        p.queuedCastAim = aim ?? null;
        return;
      }
      ctx.error(p.id, 'You are busy.');
      return;
    }
  }
  // note: a queued press fires here, re-running the full castAbility gate set
  // (including this GCD check). fireQueuedCast holds the slot instead of calling
  // in when the GCD is still running, so this early return only fires for a
  // same-tick player press racing the GCD, not for a queued follow-up.
  if (!ability.offGcd && p.gcdRemaining > 0 && !blinkThrough) return; // silent, classic spams this
  const togglingOff = isToggleBuff(ability) && p.auras.some((a) => a.id === ability.id);
  const sharedCooldown = isShamanShock(ability.id)
    ? SHAMAN_SHOCK_COOLDOWN_IDS.find((id) => p.cooldowns.has(id))
    : undefined;
  // Charge-limited abilities (the abilityCharges recharge model, driven by
  // bonusCharges: Double Charge, extra Blink/Frost Nova/Ice Block): a running
  // cooldown is only the RECHARGE timer; the cast is blocked only once every
  // stored use is spent.
  if (
    (p.cooldowns.has(ability.id) || sharedCooldown) &&
    !togglingOff &&
    !hasAbilityCharge(p, ability.id, res.bonusCharges ?? 0, res.cooldown) &&
    // An armed Brain Freeze lets Flurry cast through its running cooldown
    // (combat/frost_mage.ts; the override below consumes the proc).
    !brainFreezeBypassesCooldown(p, ability.id)
  ) {
    ctx.error(p.id, 'That ability is not ready yet.');
    return;
  }
  // shifting out of a form is free; shifting across forms bills the parked
  // mana (the live bar is rage/energy in a form) — see spendAbilityCost
  const canCastFree = res.cost > 0 && hasFreeCostFor(p, ability.id);
  const cheapMultiplier = nextCastCheapMultiplier(p, ability.id);
  const payableCost = cheapMultiplier === null ? res.cost : Math.ceil(res.cost * cheapMultiplier);
  if (p.resource < payableCost && !canCastFree && !togglingOff && !formShiftKind(p, ability)) {
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
  if (ability.requiresShield) {
    const offhand = p.equippedItems.offhand;
    if (!offhand || !isShieldItem(ITEMS[offhand])) {
      ctx.error(p.id, 'You must have a shield equipped.');
      return;
    }
  }
  // casting is deliberate action — drop any active follow so you don't drift
  ctx.stopFollow(p);
  if (ability.requiresDodgeProc && ctx.time > p.overpowerUntil) {
    ctx.error(p.id, 'Your target must dodge first.');
    return;
  }
  // Kill-window abilities (Victory Rush): usable only while the enabling aura
  // is worn; runEffects consumes it on a successful cast. Reuses the existing
  // not-ready error literal so no new client matcher is needed. requiresAuraStacks
  // (Glacial Spike's full 5-stack Icicles) additionally gates on the stack count.
  if (
    ability.requiresAuraKind &&
    !p.auras.some(
      (a) =>
        a.kind === ability.requiresAuraKind && (a.stacks ?? 1) >= (ability.requiresAuraStacks ?? 1),
    )
  ) {
    ctx.error(p.id, 'That ability is not ready yet.');
    return;
  }
  // combo points are character-bound: any built points finish on the current target
  if (ability.spendsCombo && p.comboPoints <= 0) {
    ctx.error(p.id, 'That ability requires combo points.');
    return;
  }
  // Action-locking forms gate their kit both ways: Druid form abilities need
  // their form, while travel forms lock the normal kit until toggled off.
  const form = p.auras.find((a) => isActionLockingFormAuraKind(a.kind));
  if (ability.requiresForm) {
    const need = ability.requiresForm === 'bear' ? 'form_bear' : 'form_cat';
    if (!form || form.kind !== need) {
      ctx.error(p.id, `You must be in ${ability.requiresForm === 'bear' ? 'Bruin' : 'Wolf'} Form.`);
      return;
    }
  } else if (form && !isFormToggle(ability) && !ability.usableInForm) {
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
  if (isMassResurrectionAbility(ability) && !hasDeadGroupMember(ctx, p)) {
    ctx.error(p.id, 'There are no dead group members to resurrect.');
    return;
  }

  let target: Entity | null = null;
  if (ability.requiresTarget && ability.targetsDead) {
    // Combat res: the target must be a DEAD group/raid member (no self-cast fallback).
    const dead = resolveDeadAllyTarget(ctx, p, castTargetId);
    if (!dead) {
      ctx.error(p.id, 'You must target a dead ally in your group.');
      return;
    }
    if (dist2d(p.pos, dead.corpsePos ?? dead.pos) > ability.range) {
      ctx.error(p.id, 'Out of range.');
      return;
    }
    target = dead;
  } else if (ability.requiresTarget && ability.targetType === 'friendly') {
    // heals/buffs: the mouseover override when given, else the current
    // friendly target, else yourself
    target = resolveFriendlyTarget(ctx, p, castTargetId);
    const d = dist2d(p.pos, target.pos);
    if (d > Math.max(ability.range, 5)) {
      ctx.error(p.id, 'Out of range.');
      return;
    }
    if (ctx.lineOfSightBlocked(p, target, ability)) {
      ctx.error(p.id, 'Line of sight.');
      return;
    }
    // Group/raid-only friendly target (Cascada temporal): the target must be the
    // caster or a member of the caster's party/raid, never an external friendly or
    // NPC. Refuse before any cost/cooldown is paid, so an out-of-group target never
    // silently burns the cast on an empty selection.
    if (ability.partyOnlyTarget && target.id !== p.id) {
      const party = ctx.partyOf(p.id);
      if (!party || !party.members.includes(target.id)) {
        ctx.error(p.id, 'That ally is not in your group.');
        return;
      }
    }
  } else if (ability.requiresTarget && ability.targetType === 'any') {
    target = p.targetId !== null ? (ctx.entities.get(p.targetId) ?? null) : null;
    if (!target || target.dead || (!ctx.isHostileTo(p, target) && !ctx.isFriendlyTo(p, target))) {
      ctx.error(p.id, 'You have no target.', target?.dead ? 'target_dead' : undefined);
      return;
    }
    const d = dist2d(p.pos, target.pos);
    const maxRange = ability.range > 0 ? ability.range : MELEE_RANGE;
    if (d > maxRange) {
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
      target.hp > target.maxHp * ability.requiresTargetHpBelow &&
      !(ability.id === 'execute' && p.auras.some((aura) => aura.kind === 'sudden_death'))
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
  // Hard Bargain cannot spend the caster's last health. Reject it before GCD,
  // cost, cooldown, and cast-completion proc hooks so a failed conversion cannot
  // arm Blood Credit or count toward any cast-based talent.
  const lifeTap = res.effects.find((effect) => effect.type === 'lifeTap');
  if (lifeTap && p.hp <= lifeTap.hp) {
    ctx.error(p.id, 'Not enough health.');
    return;
  }
  // Voidfeast (requiresDispellable): the devour is only castable when the
  // target actually carries something to eat, refused BEFORE billing mana or
  // arming the cooldown (the no-Seal precedent). It sits AFTER the whole
  // target-resolution chain because a targetType 'any' cast never walks the
  // hostile-branch validation loop above. The eligibility rule is the shared
  // one the dispel executor uses (aura_classify), so gate and executor agree.
  if (target) {
    for (const eff of res.effects) {
      if (eff.type === 'dispel' && eff.requiresDispellable) {
        const offensive = ctx.isHostileTo(p, target);
        if (!target.auras.some((aura) => isDispellableAura(aura, offensive))) {
          ctx.error(p.id, 'Nothing to devour.');
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
  if (p.weaponStowed) drawWeapon(p);
  if (ability.id !== 'ghost_wolf' && p.auras.some((a) => a.id === 'ghost_wolf')) {
    ctx.breakGhostWolf(p);
  }
  // An instant slipping through a RUNNING cast (usableWhileCasting /
  // Flickerstep) must not disturb that cast's aim: castTargetId/castAim belong
  // to the spell in progress (its finish path re-validates them), so they are
  // stashed here and restored after the interleaved resolution below. Without
  // this the running Fireball lost its target (fizzling at completion, the
  // owner's round-four report) and an aimed Blizzard fell back to the feet.
  const heldCastTarget = blinkThrough ? p.castTargetId : null;
  const heldCastAim = blinkThrough ? p.castAim : null;
  // Stash the (clamped) aim so the resolved area effects read it, both for an
  // instant cast (resolved just below) and a cast-time spell (resolved on
  // completion in updateCasting). Cleared there / on cancel.
  p.castAim = aimPoint;

  // Heroic-strike style: queue on next swing, pay cost on the swing itself.
  if (ability.onNextSwing) {
    const toggledOff = p.queuedOnSwing === ability.id;
    p.queuedOnSwing = toggledOff ? null : ability.id;
    if (!toggledOff && canCastFree && consumeFreeCostFor(ctx, p, ability.id)) {
      p.queuedOnSwingFree = true;
      delete p.queuedOnSwingCostMultiplier;
    } else {
      delete p.queuedOnSwingFree;
      const cheap = toggledOff ? null : consumeNextCastCheap(ctx, p, ability.id);
      if (cheap === null) delete p.queuedOnSwingCostMultiplier;
      else p.queuedOnSwingCostMultiplier = cheap;
    }
    // A queued-on-swing ability bills on the swing, not through this cast's
    // completion, so the empower flag the consumes above set must not leak
    // onto whatever cast completes next (the castNth guard in talent_procs.ts
    // deliberately exempts on-next-swing abilities).
    if (p.castConsumedEmpower !== undefined) p.castConsumedEmpower = undefined;
    if (!p.autoAttack && target) ctx.startAutoAttack(p.id);
    return;
  }
  p.castTargetId = target?.id ?? null;

  // Brain Freeze (combat/frost_mage.ts): consumed HERE, after every gate
  // above (so a blocked cast never eats the proc) and before the cast-time /
  // cost / cooldown reads below: the armed Flurry goes instant, skips its
  // cooldown and carries its 30% baked into the resolved effects.
  res = applyBrainFreezeOverride(ctx, p, res);

  // Owner 2026-07-13: spell haste shortens the global cooldown (floored at MIN_GCD),
  // so gear/Bloodlust/Temporal Acceleration haste speeds the whole rotation, not just
  // cast bars. spellHasteMult is 1 for anyone without spell haste, so their GCD is
  // unchanged.
  const gcd = Math.max(MIN_GCD, ctx.playerGcdFor(meta.cls) / spellHasteMult(p));
  // A channel keeps its duration, so it must not eat a next_cast_instant charge.
  const castTime =
    !ability.channel &&
    res.castTime > 0 &&
    (ability.school !== 'physical' || hasScopedNextCastInstant(p, ability.id)) &&
    consumeNextCastInstant(ctx, p, ability.id)
      ? 0
      : res.castTime;
  // A free cast is consumed where the cost is actually billed: here for channels
  // and instants (this tick resolves them via the local `res`), but for cast-time
  // spells the bill lands in applyAbility at completion, which RE-RESOLVES the
  // ability, so the charge must survive until then and be consumed there.
  if ((castTime === 0 || ability.channel) && !togglingOff) {
    if (canCastFree && consumeFreeCostFor(ctx, p, ability.id)) {
      res = { ...res, cost: 0 };
    } else if (res.cost > 0) {
      const cheap = consumeNextCastCheap(ctx, p, ability.id);
      if (cheap !== null) res = { ...res, cost: Math.ceil(res.cost * cheap) };
    }
  }

  if (ability.channel) {
    spendAbilityCost(ctx, p, meta, res);
    armAbilityCooldown(p, ability.id, res.cooldown, false, res.bonusCharges ?? 0);
    // Blizzard's Frozen Orb refund budget resets per cast (combat/frost_mage.ts).
    frostMageChannelStart(p, ability.id);
    // Aether Darts arms its one-time Arcane Charge consume for THIS channel
    // (combat/chronomancy.ts); inert for every other channel.
    aetherDartsChannelStart(p, ability.id);
    // Spell haste (item-set bonus) shortens the whole channel and so each tick.
    const channelDuration = ability.channel.duration / spellHasteMult(p);
    p.castingAbility = ability.id;
    p.castTotal = channelDuration;
    p.castRemaining = channelDuration;
    p.channeling = true;
    // Aether Darts fires a full-charge barrage (5 missiles) at max Arcane Charges:
    // aetherDartsChannelStart set p.aetherDartsTicks; every other channel uses the
    // ability's default tick count.
    const channelTicks =
      ability.id === 'arcane_missiles' && p.aetherDartsTicks
        ? p.aetherDartsTicks
        : ability.channel.ticks;
    p.channelTickEvery = channelDuration / channelTicks;
    p.channelTickTimer = p.channelTickEvery;
    p.channelTicksLeft = channelTicks;
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
    if (p.kind === 'player') onCastCompleted(ctx, p, ability.id, target);
    return;
  }

  if (castTime > 0 && !togglingOff) {
    // Spell haste (item-set bonus) shortens the cast; Curse of Tongues stretches it.
    // Physical-school casts (Slam) ride spellHaste too: set-bonus haste is ONE stat,
    // so meleeHaste always equals spellHaste and the classic melee-haste scaling
    // falls out identically. If the haste channels ever split, give physical casts
    // p.meleeHaste here (and mirror `mh` over the wire for the tooltip).
    // Aether Surge speeds up with held Arcane Charges and while Aether Rush is armed
    // (combat/chronomancy.ts); 1x for every other cast, so nothing else is touched.
    const surgeCastMult = ability.id === ARCANE_SURGE_ID ? aetherSurgeCastMult(p) : 1;
    const stretchedCastTime = (castTime * tonguesMult(p) * surgeCastMult) / spellHasteMult(p);
    p.castingAbility = ability.id;
    p.castTotal = stretchedCastTime;
    p.castRemaining = stretchedCastTime;
    p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
    ctx.emit({ type: 'castStart', entityId: p.id, ability: ability.id, time: stretchedCastTime });
    return;
  }

  if (!ability.offGcd) p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
  const instantResolved = ability.empowerStages
    ? { ...res, empowerLevel: ability.empowerStages }
    : res;
  applyAbility(ctx, p, meta, instantResolved, castTargetId);
  // instant ground-targeted cast: its effects have consumed the aim point. An
  // interleaved instant instead hands the aim back to the cast still running.
  p.castAim = blinkThrough ? heldCastAim : null;
  p.castTargetId = blinkThrough ? heldCastTarget : null;
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
  if (p.auras.some((a) => isFormAuraKind(a.kind))) return 'cross';
  return null;
}

// Colossal Might's rolling CDR cap (v0.27.1). Uncapped, sustained Red Harvest
// spam banked ~78s of CDR per minute and collapsed the 180s offensive cooldowns
// to an effective ~78s. Same numbers and aura mechanism as the mage Overflowing
// Power cap below (which copied this feature and got the cap the original
// lacked); the accumulator rides an 'internal_cd' aura the player can watch
// tick down, so no new entity field enters the parity state hash.
export const COLOSSAL_MIGHT_CAP_SECONDS = 10;
export const COLOSSAL_MIGHT_CAP_WINDOW = 30;

export function applyRageSpendCooldownRefund(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  spentRage: number,
): void {
  const rate = ctx.playerMods(meta).global.cdrPerRage;
  if (spentRage <= 0 || rate <= 0) return;
  const capAura = p.auras.find((a) => a.id === 'colossal_might_cap');
  const used = capAura?.value ?? 0;
  const refund = Math.min(spentRage * rate, COLOSSAL_MIGHT_CAP_SECONDS - used);
  if (refund <= 0) return;
  if (capAura) {
    capAura.value += refund;
  } else {
    ctx.applyAura(p, {
      id: 'colossal_might_cap',
      name: 'Colossal Might',
      kind: 'internal_cd',
      value: refund,
      remaining: COLOSSAL_MIGHT_CAP_WINDOW,
      duration: COLOSSAL_MIGHT_CAP_WINDOW,
      sourceId: p.id,
      school: 'physical',
    });
  }
  for (const id of COLOSSAL_MIGHT_COOLDOWNS) {
    const current = p.cooldowns.get(id);
    if (current === undefined) continue;
    if (current <= refund) p.cooldowns.delete(id);
    else p.cooldowns.set(id, current - refund);
  }
}

function spendAbilityCost(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  res: ResolvedAbility,
): void {
  if (isToggleBuff(res.def) && p.auras.some((a) => a.id === res.def.id)) return;
  const spentRage = p.resourceType === 'rage' ? res.cost : 0;
  const shift = formShiftKind(p, res.def);
  if (shift === 'off') return;
  if (shift === 'cross') {
    // The parked-mana debit only applies when the CURRENT form swapped the
    // resource bar (bear/cat rage/energy park the mana pool). A caster form
    // (moonkin/shadow) keeps the live mana bar, and recalc would overwrite
    // savedMana on the next resource-shift entry anyway, so bill live mana.
    const parked = p.auras.some((a) => isResourceShiftFormAuraKind(a.kind));
    if (parked) {
      p.savedMana = Math.max(0, p.savedMana - res.cost);
    } else {
      spendResource(p, res.cost);
    }
    return;
  }
  spendResource(p, res.cost);
  // Overflowing Power (mage choice row): every 10% of maximum mana actually
  // spent shaves manaDefCdrPer10 seconds off the mage defensive cooldowns,
  // capped per rolling window (the 'internal_cd' aura carries the window's
  // running total, so no new entity field enters the parity state hash).
  overflowingPowerCdr(ctx, p, meta, res.cost);
  // Colossal Might: each point of rage actually spent shaves cdrPerRage seconds
  // off the tracked offensive cooldowns. 0 for everyone without the capstone.
  applyRageSpendCooldownRefund(ctx, p, meta, spentRage);
}

// Overflowing Power (mage choice row): the Colossal Might pattern on mana. The
// defensive set it shaves, the seconds cap, and the rolling window; the cap
// accumulator rides an 'internal_cd' aura the player can watch tick down.
const MAGE_DEFENSIVE_COOLDOWNS = [
  'blink',
  'ice_barrier',
  'blazing_barrier',
  'greater_invisibility',
] as const;
const OVERFLOW_CAP_SECONDS = 10;
const OVERFLOW_CAP_WINDOW = 30;

function overflowingPowerCdr(ctx: SimContext, p: Entity, meta: PlayerMeta, cost: number): void {
  if (cost <= 0 || p.resourceType !== 'mana' || p.maxResource <= 0) return;
  const per10 = ctx.playerMods(meta).global.manaDefCdrPer10;
  if (per10 <= 0) return;
  const capAura = p.auras.find((a) => a.id === 'overflowing_power_cap');
  const used = capAura?.value ?? 0;
  const shave = Math.min((cost / p.maxResource) * 10 * per10, OVERFLOW_CAP_SECONDS - used);
  if (shave <= 0) return;
  if (capAura) {
    capAura.value += shave;
  } else {
    ctx.applyAura(p, {
      id: 'overflowing_power_cap',
      name: 'Overflowing Power',
      kind: 'internal_cd',
      value: shave,
      remaining: OVERFLOW_CAP_WINDOW,
      duration: OVERFLOW_CAP_WINDOW,
      sourceId: p.id,
      school: 'arcane',
    });
  }
  for (const id of MAGE_DEFENSIVE_COOLDOWNS) {
    const cur = p.cooldowns.get(id);
    if (cur === undefined) continue;
    if (cur <= shave) p.cooldowns.delete(id);
    else p.cooldowns.set(id, cur - shave);
  }
}

// Overload (mage choice row): consume the armed amplifier on a mana spell,
// returning a scaled copy of the resolved ability (numeric effect fields ride
// the output amp; the bill rides the cost amp). The original resolved struct
// is never mutated. Draws no rng.
const OVERLOAD_COST_MULT = 1.5;

function consumeOverload(ctx: SimContext, p: Entity, res: ResolvedAbility): ResolvedAbility {
  if (res.def.school === 'physical' || res.cost <= 0) return res;
  const idx = p.auras.findIndex((a) => a.kind === 'overload');
  if (idx < 0) return res;
  const aura = p.auras[idx];
  const amp = 1 + aura.value;
  p.auras.splice(idx, 1);
  ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  const effects = res.effects.map((eff) => {
    if (eff.type === 'empoweredCone') {
      return {
        ...eff,
        stages: eff.stages.map((stage) => ({
          ...stage,
          min: Math.round(stage.min * amp),
          max: Math.round(stage.max * amp),
        })),
      };
    }
    const scaled: Record<string, unknown> = { ...eff };
    for (const key of ['min', 'max', 'amount', 'bonus', 'total', 'value'] as const) {
      const v = scaled[key];
      if (typeof v === 'number' && v > 0) scaled[key] = Math.round(v * amp);
    }
    return scaled as typeof eff;
  });
  return { ...res, cost: Math.round(res.cost * OVERLOAD_COST_MULT), effects };
}

function armAbilityCooldown(
  p: Entity,
  abilityId: string,
  cooldown: number,
  togglingOff = false,
  // `bonusCharges` drives the abilityCharges recharge model (Double Charge, and
  // the extra Blink/Frost Nova/Ice Block charges); content resolves it onto the
  // ResolvedAbility. A running cooldown is the recharge timer once uses are spent.
  bonusCharges = 0,
): void {
  if (cooldown <= 0 || togglingOff) return;
  const state = chargeState(p, abilityId, bonusCharges, cooldown);
  if (state) {
    state.charges = Math.max(0, state.charges - 1);
    // Parallel per-charge recharge: every spend starts ITS OWN timer.
    state.recharges ??= state.recharge > 0 ? [state.recharge] : [];
    state.recharges.push(cooldown);
    state.recharges.sort((a, b) => a - b);
    state.recharge = state.recharges[0] ?? 0;
    if (state.charges <= 0) p.cooldowns.set(abilityId, state.recharge);
    else p.cooldowns.delete(abilityId);
    return;
  }
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
    const center = res.def.selfCentered ? p.pos : (p.castAim ?? p.pos);
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
    // How many enemies this pulse actually struck: Blizzard's Frozen Orb
    // refund (frostMageChannelPulse below) scales with it.
    let struck = 0;
    for (const eff of res.effects) {
      if (eff.type !== 'aoeDamage') continue;
      for (const m of ctx.hostilesInRadius(p, center, eff.radius)) {
        if (!ctx.hasLineOfSight(p, m)) continue;
        let dmg = ctx.rng.range(eff.min, eff.max) + channelSp;
        // physical channels (Volley) are mitigated by armor; spell-school rain is not,
        // mirroring the instant aoeDamage path in effect_dispatch.
        if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(m), p.level);
        ctx.dealDamage(p, m, Math.round(dmg), false, res.def.school, res.def.name, 'hit');
        struck++;
      }
    }
    // A position channel may also carry an aoeSlow rider (Blizzard): each
    // pulse re-applies the snare at the aimed point, refresh-by-id like the
    // instant aoeSlow case in effect_dispatch.
    for (const eff of res.effects) {
      if (eff.type !== 'aoeSlow') continue;
      for (const m of ctx.hostilesInRadius(p, center, eff.radius)) {
        if (m.dead) continue;
        if (!ctx.hasLineOfSight(p, m)) continue;
        ctx.applyAura(m, {
          id: `${res.def.id}_slow`,
          name: res.def.name,
          kind: 'slow',
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.mult,
          sourceId: p.id,
          school: res.def.school,
        });
      }
    }
    frostMageChannelPulse(ctx, p, res.def.id, struck);
    return;
  }

  // Self-centered AoE channel (Steel Cyclone / bladestorm): a targetless channel
  // whose storm follows the CASTER, pulsing its aoeDamage on every hostile in
  // radius around the caster each tick (center is live p.pos, so it moves with
  // the warrior). Distinct from the position channel above (which clamps a
  // ground point) and from the single-target channel below.
  if (!res.def.requiresTarget && res.effects.some((eff) => eff.type === 'aoeDamage')) {
    const isSpell = res.def.school !== 'physical';
    const channelSp = channelTickBonus(abilityScalingPower(p, res.def), res.def);
    for (const eff of res.effects) {
      if (eff.type !== 'aoeDamage') continue;
      ctx.emit({
        type: 'spellfxAt',
        x: p.pos.x,
        z: p.pos.z,
        school: res.def.school,
        fx: 'nova',
        radius: eff.radius,
      });
      for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
        if (!ctx.hasLineOfSight(p, m)) continue;
        let dmg = ctx.rng.range(eff.min, eff.max) + channelSp;
        if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(m), p.level);
        ctx.dealDamage(p, m, Math.round(dmg), false, res.def.school, res.def.name, 'hit');
      }
    }
    return;
  }

  // Targetless SELF channel (Aetherwell): no aim point, no area, no enemy.
  // Each tick restores the flat mana AND stacks the channel's spell-power
  // buff (owner design: the longer you channel, the more spell power), the
  // aura value growing by the effect value per pulse with its clock
  // refreshed; the recalc applies the new power at once. Draws no rng.
  if (!res.def.requiresTarget && res.effects.some((eff) => eff.type === 'gainResource')) {
    for (const eff of res.effects) {
      if (eff.type === 'gainResource') {
        p.resource = Math.min(p.maxResource, p.resource + eff.amount);
      } else if (eff.type === 'selfBuff' && eff.kind === 'buff_spellpower') {
        const existing = p.auras.find((a) => a.id === res.def.id && a.kind === 'buff_spellpower');
        if (existing) {
          existing.value += eff.value;
          existing.stacks = (existing.stacks ?? 1) + 1;
          existing.remaining = eff.duration;
          existing.duration = eff.duration;
        } else {
          ctx.applyAura(p, {
            id: res.def.id,
            name: res.def.name,
            kind: 'buff_spellpower',
            value: eff.value,
            remaining: eff.duration,
            duration: eff.duration,
            sourceId: p.id,
            school: res.def.school,
            stacks: 1,
          });
        }
        const channelMeta = ctx.players.get(p.id);
        if (channelMeta) {
          recalcPlayerStats(
            p,
            channelMeta.cls,
            channelMeta.equipment,
            ctx.playerMods(channelMeta),
            channelMeta.equipmentInstance,
          );
        }
      }
    }
    return;
  }

  // Self-centered healing channels pulse around the caster's live position on
  // every tick. Instant aoeHeal effects still resolve once through effect_dispatch.
  if (!res.def.requiresTarget && res.effects.some((eff) => eff.type === 'aoeHeal')) {
    const channelSp = channelTickBonus(abilityScalingPower(p, res.def), res.def);
    for (const eff of res.effects) {
      if (eff.type !== 'aoeHeal') continue;
      ctx.emit({
        type: 'spellfxAt',
        x: p.pos.x,
        z: p.pos.z,
        school: res.def.school,
        fx: 'nova',
        radius: eff.radius,
      });
      const radiusSq = eff.radius * eff.radius;
      for (const ally of ctx.entities.values()) {
        if (ally.dead || (ally.id !== p.id && !ctx.isFriendlyTo(p, ally))) continue;
        const dx = ally.pos.x - p.pos.x;
        const dz = ally.pos.z - p.pos.z;
        if (dx * dx + dz * dz > radiusSq || !ctx.hasLineOfSight(p, ally)) continue;
        const amount = ctx.rng.range(eff.min, eff.max) + channelSp;
        ctx.applyHeal(p, ally, amount, res.def.name, res.def.id);
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
    // Aether Darts: the FIRST landed missile consumes the caster's Arcane Charges
    // and locks a flat per-missile Arcane bonus (combat/chronomancy.ts); later
    // missiles reuse it. It is plain Arcane damage, so Temporal Echo heals from it
    // at the normal rate. Draws no rng; a no-op (0) for any other channel and with
    // no charges held.
    const surgeBonus =
      res.def.id === 'arcane_missiles'
        ? aetherDartsBoltBonus(ctx, src, res.def.channel?.ticks ?? 1)
        : 0;
    for (const eff of res.effects) {
      if (eff.type === 'directDamage') {
        const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, src) ? 1 : ctx.spellCrit(src));
        let dmg = ctx.rng.range(eff.min, eff.max) + channelSp + surgeBonus;
        dmg *= spellDamageMultFromAuras(src);
        // A channeled spell tick (Arcane Missiles) is a spell crit, so it takes the
        // spell crit-damage channel of the mastery (plus the generic bonus) like
        // every other spell crit.
        if (crit) dmg *= 1.5 + src.critDmgSpellBonus;
        ctx.dealDamage(src, tgt, Math.round(dmg), crit, res.def.school, res.def.name, 'hit');
        noteSpellHit(ctx, src, crit, res.def.id);
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
      } else if (eff.type === 'extendDot') {
        extendOwnedDot(tgt, src.id, eff.dot, eff.seconds, eff.maxBonus);
      }
    }
  });
}

function applyAbility(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  res: ResolvedAbility,
  castTargetId: number | null = null,
): void {
  // Consume the mouseover override: an instant cast passes it directly; a
  // timed cast stored it on the entity at start (updateCasting's finish call
  // passes nothing). Cleared here so it can never leak into a later cast.
  const castTarget = castTargetId ?? p.castTargetId;
  p.castTargetId = null;
  if (isMassResurrectionAbility(res.def)) {
    if (p.inCombat) {
      ctx.error(p.id, "You can't do that while in combat.");
      return;
    }
    if (!hasDeadGroupMember(ctx, p)) {
      ctx.error(p.id, 'There are no dead group members to resurrect.');
      return;
    }
  }
  // Overload (mage choice row): the armed amplifier bakes the next MANA spell
  // 40% stronger and 50% costlier into a scaled COPY of the resolved ability
  // before cost and effects resolve (channels are exempt: they bill in the
  // castAbility channel branch and resolve per tick). Draws no rng.
  res = consumeOverload(ctx, p, res);
  const ability = res.def;
  const togglingOff = isToggleBuff(ability) && p.auras.some((a) => a.id === ability.id);
  // The free charge is consumed exactly where a cost is actually billed; the
  // early-return utility branches below bill directly, so they must go through
  // this too or a free conjure/revive would keep the charge alive.
  const billableCost = (): number => {
    if (res.cost <= 0 || togglingOff) return res.cost;
    if (consumeFreeCostFor(ctx, p, ability.id)) return 0;
    const cheap = consumeNextCastCheap(ctx, p, ability.id);
    return cheap !== null ? Math.ceil(res.cost * cheap) : res.cost;
  };
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
    if (p.kind === 'player') onCastCompleted(ctx, p, ability.id);
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
    if (p.kind === 'player') onCastCompleted(ctx, p, ability.id);
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
    spendResource(p, billableCost());
    armAbilityCooldown(p, ability.id, res.cooldown, false, res.bonusCharges ?? 0);
    if (pet.dead) {
      ctx.revivePet(p.id);
    } else {
      const hot = res.effects.find((effect) => effect.type === 'hot');
      if (hot) {
        ctx.applyAura(pet, {
          id: ability.id,
          name: ability.name,
          kind: 'hot',
          remaining: hot.duration,
          duration: hot.duration,
          value: Math.max(1, Math.round(hot.total / (hot.duration / hot.interval))),
          tickInterval: hot.interval,
          tickTimer: hot.interval,
          sourceId: p.id,
          school: ability.school,
        });
      }
    }
    if (p.kind === 'player') onCastCompleted(ctx, p, ability.id, pet);
    return;
  }

  let target: Entity | null = null;
  if (ability.requiresTarget && ability.targetsDead) {
    // Combat res finish: the dead ally's id was stored in castTarget at cast start
    // (it is auto-deselected from p.targetId once dead, so we cannot re-derive it).
    const dead = resolveDeadAllyTarget(ctx, p, castTarget);
    if (!dead) {
      ctx.error(p.id, 'You must target a dead ally in your group.');
      return;
    }
    target = dead;
  } else if (ability.requiresTarget && ability.targetType === 'friendly') {
    // Keep the branch's mouseover-cast resolution (Clique-style): the explicit
    // override wins while valid, else current-friendly-target-else-self.
    target = resolveFriendlyTarget(ctx, p, castTarget);
    if (dist2d(p.pos, target.pos) > Math.max(ability.range, 5) + 2) {
      ctx.error(p.id, 'Out of range.');
      return;
    }
    if (ctx.lineOfSightBlocked(p, target, ability)) {
      ctx.error(p.id, 'Line of sight.');
      return;
    }
  } else if (ability.requiresTarget && ability.targetType === 'any') {
    target = castTarget !== null ? (ctx.entities.get(castTarget) ?? null) : null;
    if (!target || target.dead || (!ctx.isHostileTo(p, target) && !ctx.isFriendlyTo(p, target))) {
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
  } else if (ability.requiresTarget) {
    target = castTarget !== null ? (ctx.entities.get(castTarget) ?? null) : null;
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
  const canCastFree = res.cost > 0 && hasFreeCostFor(p, ability.id);
  const cheapMultiplier = nextCastCheapMultiplier(p, ability.id);
  const payableCost = cheapMultiplier === null ? res.cost : Math.ceil(res.cost * cheapMultiplier);
  if (p.resource < payableCost && !canCastFree && !togglingOff && !formShiftKind(p, ability)) {
    ctx.error(p.id, `Not enough ${p.resourceType ?? 'resource'}!`);
    return;
  }
  if (canCastFree && !togglingOff && consumeFreeCostFor(ctx, p, ability.id)) {
    res = { ...res, cost: 0 };
  } else if (res.cost > 0 && !togglingOff) {
    const cheap = consumeNextCastCheap(ctx, p, ability.id);
    if (cheap !== null) res = { ...res, cost: Math.ceil(res.cost * cheap) };
  }
  if (ability.spendsAllResource && !togglingOff) {
    const spend =
      ability.spendResourceCap === undefined
        ? p.resource
        : Math.min(p.resource, ability.spendResourceCap);
    res = { ...res, cost: spend };
  }

  // helpful spells never miss
  if (
    ability.targetType === 'friendly' ||
    (ability.targetType === 'any' && target && ctx.isFriendlyTo(p, target))
  ) {
    spendAbilityCost(ctx, p, meta, res);
    armAbilityCooldown(p, ability.id, res.cooldown, togglingOff, res.bonusCharges ?? 0);
    ctx.runEffects(p, meta, target, res);
    // 'spellCast' means SPELLS: a physical friendly ability never rolls.
    if (p.kind === 'player' && ability.school !== 'physical')
      ctx.applySetProcs(p, target, 'spellCast');
    if (p.kind === 'player') onCastCompleted(ctx, p, ability.id, target);
    return;
  }

  // A ranged attack travels as a projectile, so its damage/effects resolve when the
  // bolt LANDS, not at cast completion. Every non-physical spell is a bolt by
  // convention (school proxy); a physical ranged shot (hunter Aimed / Concussive Shot)
  // opts in with projectile:true. Without this a physical shot deals its damage
  // instantly while the arrow is still visibly in flight (health drops, or the mob
  // dies, before it arrives).
  // `projectile: false` opts a spell OUT (Fire Blast bites instantly).
  const firesProjectile = ability.projectile ?? ability.school !== 'physical';
  if (target && firesProjectile) {
    const isSpell = ability.school !== 'physical';
    spendAbilityCost(ctx, p, meta, res);
    armAbilityCooldown(p, ability.id, res.cooldown, togglingOff, res.bonusCharges ?? 0);
    ctx.emit({
      type: 'spellfx',
      sourceId: p.id,
      targetId: target.id,
      school: ability.school,
      // A spell may override the flying-bolt visual (e.g. Lightning Bolt draws a
      // jagged electric strike); the projectile MECHANIC below is unchanged.
      fx: ability.projectileFx ?? 'projectile',
      ...(isSpell ? {} : { attackAnimation: 'ranged-shot' as const }),
    });
    // The bolt is now in flight: its hit roll and effects resolve when it reaches the
    // target (projectile_travel), not this tick. A target that dies before impact
    // takes nothing (the fizzle is handled by scheduleProjectile). Spells never "miss"
    // like a physical attack; a target can only fully RESIST them (classic-era
    // semantics), so a spell's on-impact roll uses isSpellResisted and emits a 'resist'.
    // A physical shot has no resist roll; its hit/crit resolve inside runEffects.
    // Taunts (e.g. Sacred Goad) ALWAYS land: a resisted taunt would silently break
    // tanking, so a taunt ability skips the resist roll entirely (physical taunts like
    // Goad / Menace already never roll, since they resolve instantly below).
    const isTaunt = res.effects.some((eff) => eff.type === 'taunt');
    scheduleProjectile(ctx, p, target, (src, tgt) => {
      if (isSpell && !isTaunt && isSpellResisted(ctx.rng, src.level, tgt.level, src.hitBonus)) {
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
      ctx.runEffects(src, meta, tgt, res, !isSpell);
    });
    // 'spellCast' set procs (Clearcasting) roll at CAST COMPLETION, matching the
    // trigger name: the cast is done even though the bolt is still in flight (a
    // resisted or fizzled bolt was still a cast). Physical projectile shots
    // (hunter Aimed / Concussive) are not spells and never roll.
    if (p.kind === 'player' && isSpell) ctx.applySetProcs(p, target, 'spellCast');
    if (p.kind === 'player') onCastCompleted(ctx, p, ability.id, target);
    return;
  }

  spendAbilityCost(ctx, p, meta, res);
  armAbilityCooldown(p, ability.id, res.cooldown, togglingOff, res.bonusCharges ?? 0);
  // A shout announces itself: world-visible cue so the caster roars and the
  // shockwave ring reads for everyone nearby (renderer-only; no mechanic).
  if (ability.castFx && !togglingOff) {
    ctx.emit({
      type: 'spellfx',
      sourceId: p.id,
      targetId: p.id,
      school: ability.school,
      fx: ability.castFx,
      ability: ability.id,
    });
  }
  ctx.runEffects(p, meta, target, res);
  // 'spellCast' means SPELLS: physical specials (a cat/bear weapon strike from a
  // cloth-capable druid) and toggle-offs fall through here and must not roll.
  if (p.kind === 'player' && ability.school !== 'physical' && !togglingOff)
    ctx.applySetProcs(p, target, 'spellCast');
  if (p.kind === 'player' && !togglingOff) onCastCompleted(ctx, p, ability.id, target);
}
