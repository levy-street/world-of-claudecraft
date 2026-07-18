// Fire mage spec mechanics (owner design 2026-07-10, built 2026-07-11): the
// crit-driven Pyromancy loop, mirroring combat/frost_mage.ts.
//
//  - IGNITION (mastery): the fire mage's spell CRITICALS burn the target for
//    IGNITION_PCT of the damage dealt over IGNITE_DURATION, STACKING by adding
//    into the running burn (igniteOnCrit, hooked in combat/damage.ts). The burn
//    copies the RESOLVED damage: no new rng is ever drawn.
//  - HOT STREAK (signature): two consecutive BUILDER crits (Fireball / Fire
//    Blast / Scorch) make the next Pyroblast OR Flamestrike free AND instant
//    (the empower_next machinery, ability-scoped). The counter READS crits
//    already rolled (fireMageOnSpellHit, wired through noteSpellHit) and never
//    draws dice. Guaranteed crits BUILD it too, Combustion included (owner
//    reversal 2026-07-11 of the earlier skip: Combustion windows are meant to
//    chain Hot Streaks, the classic Combustion fantasy). The spenders are
//    also builders (free casts included): one spender crit is still only ONE
//    crit, never a whole new streak by itself, and a Flamestrike counts once
//    per cast however many enemies it strikes.
//  - GUARANTEED CRITS (fireGuaranteedCrit, read at the spell-crit roll sites in
//    effect_dispatch): Fire Blast ALWAYS crits; Scorch always crits against
//    targets at or below SCORCH_EXECUTE_HP; while Combustion is worn, every
//    Fire spell crits. The rng roll is STILL drawn exactly as before (only the
//    outcome is overridden), so the shared draw order never moves.
//
// Every check is deterministic; the counters and windows ride AURAS so no new
// entity field enters the parity state hash.
//
// `src/sim`-pure: sibling sim modules + the SimContext seam only.

import { ABILITIES } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const IGNITE_DURATION = 6;
export const IGNITE_INTERVAL = 2;
export const SCORCH_EXECUTE_HP = 0.3; // Scorch always crits at or below this
// The spenders are ALSO builders (owner rule 2026-07-11, final form): their
// crits, free casts included, count toward the NEXT streak. A Flamestrike is
// one crit per CAST however many enemies it strikes (the aoeDamage canCrit
// path notes exactly once), and only the initial impact counts: ground-zone
// pulses, DoT ticks and Ignite never reach noteSpellHit.
export const HOT_STREAK_BUILDERS: readonly string[] = [
  'fireball',
  'fire_blast',
  'scorch',
  'pyroblast',
  'flamestrike',
  'dragons_breath',
];
export const HOT_STREAK_SPENDERS: readonly string[] = ['pyroblast', 'flamestrike'];
export const HEATING_UP_WINDOW = 10; // seconds the first crit is remembered
export const HOT_STREAK_DURATION = 12; // seconds to spend the free instant
// Owner 2026-07-13: seconds shaved off Combustion's cooldown per builder crit landed
// outside Combustion. Tunable.
export const COMBUSTION_CDR_PER_CRIT = 1;

// Cauterize (fire-spec passive, owner 2026-07-13): the first lethal hit does not kill.
// Instead you heal to 25% max HP and BURN for 6s (5% max HP per second, 30% total),
// dealing +12% Fire damage to enemies while it rides. 5 minute internal cooldown. It
// is a gamble: the burn can finish you if no one heals through it.
export const CAUTERIZE_ICD = 300; // seconds (5 min), worn as the fatigue debuff below
// The visible 5 min lockout debuff. It gates the save (not a procState icd, which
// death wipes), SURVIVES death (resurrection.ts aurasSurvivingDeath), and pauses
// while dead (updateAuras' dead guard), so die-revive-die never double-saves.
export const CAUTERIZE_FATIGUE_ID = 'cauterize_fatigue';
export const CAUTERIZE_HEAL_FRAC = 0.25;
export const CAUTERIZE_BURN_PER_SEC = 0.05; // of max HP, per 1s tick
export const CAUTERIZE_BURN_DURATION = 6; // seconds
export const CAUTERIZE_FIRE_DMG_BONUS = 0.12; // +12% Fire damage while burning
const CAUTERIZING_ID = 'cauterizing';

// The personal-barrier SLOT (owner rule): each mage spec fills it with its own
// shield, and the shared row talents (Warded / Cold Snap / Overflowing Power)
// hook whichever the player's spec provides, never a hardcoded single id.
export const PERSONAL_BARRIER_IDS: readonly string[] = [
  'ice_barrier',
  'blazing_barrier',
  // Chronomancy's shield fills the same slot (it is also its ally shield).
  'temporal_barrier',
];

/** The active mage spec's occupant of the shared personal-barrier slot. */
export function personalBarrierIdForSpec(spec: string | null): string | null {
  if (spec === 'arcane') return 'temporal_barrier';
  if (spec === 'fire') return 'blazing_barrier';
  if (spec === 'frost') return 'ice_barrier';
  return null;
}

function fireSpecMods(ctx: SimContext, p: Entity) {
  if (p.kind !== 'player') return null;
  const meta = ctx.players.get(p.id);
  if (!meta) return null;
  const mods = ctx.playerMods(meta);
  return mods.spec === 'fire' ? mods : null;
}

/** Guaranteed-crit override for the fire spec, read at the spell-crit roll
 *  sites (the roll is still drawn; only the outcome is overridden). */
export function fireGuaranteedCrit(
  ctx: SimContext,
  p: Entity,
  abilityId: string,
  school: string,
  target: Entity | null,
): boolean {
  if (school !== 'fire') return false;
  if (!fireSpecMods(ctx, p)) return false;
  if (p.auras.some((a) => a.kind === 'combustion')) return true;
  if (abilityId === 'fire_blast') return true;
  if (abilityId === 'scorch' && target && target.hp <= target.maxHp * SCORCH_EXECUTE_HP)
    return true;
  return false;
}

/** Hot Streak: two consecutive BUILDER crits arm a free, instant Pyroblast or
 *  Flamestrike. Wired through noteSpellHit so it READS every resolved spell
 *  hit; draws no rng. Every crit builds, Combustion's guaranteed ones too. */
export function fireMageOnSpellHit(
  ctx: SimContext,
  p: Entity,
  abilityId: string | undefined,
  crit: boolean,
): void {
  if (!abilityId || !HOT_STREAK_BUILDERS.includes(abilityId)) return;
  if (!fireSpecMods(ctx, p)) return;
  const heatingIdx = p.auras.findIndex((a) => a.id === 'heating_up');
  if (!crit) {
    // A non-crit builder breaks the streak.
    if (heatingIdx >= 0) {
      const gone = p.auras[heatingIdx];
      p.auras.splice(heatingIdx, 1);
      ctx.emit({ type: 'aura', targetId: p.id, name: gone.name, gained: false });
    }
    return;
  }
  // Owner 2026-07-13: a builder crit OUTSIDE Combustion shaves its cooldown, so a run
  // of Fireball / Scald crits brings the next Combustion up sooner. During Combustion
  // its guaranteed crits do not (it is already active). Draws no rng.
  if (!p.auras.some((a) => a.kind === 'combustion')) {
    const cd = p.cooldowns.get('combustion');
    if (cd && cd > 0) p.cooldowns.set('combustion', Math.max(0, cd - COMBUSTION_CDR_PER_CRIT));
  }
  if (heatingIdx < 0) {
    ctx.applyAura(p, {
      id: 'heating_up',
      name: 'Heating Up',
      kind: 'internal_cd',
      value: 0,
      remaining: HEATING_UP_WINDOW,
      duration: HEATING_UP_WINDOW,
      sourceId: p.id,
      school: 'fire',
    });
    return;
  }
  // Second crit in a row: consume Heating Up, arm Hot Streak (free + instant,
  // scoped to the two spenders via the empower_next ability lists).
  const heat = p.auras[heatingIdx];
  p.auras.splice(heatingIdx, 1);
  ctx.emit({ type: 'aura', targetId: p.id, name: heat.name, gained: false });
  ctx.applyAura(p, {
    id: 'hot_streak',
    name: 'Hot Streak',
    kind: 'next_cast_free',
    value: 0,
    remaining: HOT_STREAK_DURATION,
    duration: HOT_STREAK_DURATION,
    sourceId: p.id,
    school: 'fire',
    empowerAbilities: [...HOT_STREAK_SPENDERS],
  });
  ctx.applyAura(p, {
    id: 'hot_streak_instant',
    name: 'Hot Streak',
    kind: 'next_cast_instant',
    value: 0,
    remaining: HOT_STREAK_DURATION,
    duration: HOT_STREAK_DURATION,
    sourceId: p.id,
    school: 'fire',
    empowerAbilities: [...HOT_STREAK_SPENDERS],
  });
}

/** Cauterize's Fire-damage bonus while the burn rides: 1 + 12% when `source` is
 *  burning and the hit is Fire on someone OTHER than the source (never the self-burn),
 *  else 1. Read at the top of dealDamage. Draws no rng. */
export function cauterizeFireDamageMult(
  source: Entity | null,
  target: Entity,
  school: string,
): number {
  if (!source || source === target || school !== 'fire') return 1;
  return source.auras.some((a) => a.id === CAUTERIZING_ID) ? 1 + CAUTERIZE_FIRE_DMG_BONUS : 1;
}

/** Cauterize's lethal save (fire spec passive). When a killing blow (`incoming` >= hp)
 *  lands on a fire mage whose Cauterize is off its internal cooldown, the mage survives:
 *  healed to 25% max HP, set burning for 6s (5% max HP/s), the 5 min ICD armed, and the
 *  +12% Fire window opened. Returns the damage to actually apply (0, the blow negated)
 *  on a save, or null when it does not fire (not fire spec, on cooldown, or not lethal).
 *  Draws no rng. */
export function fireMageCauterize(
  ctx: SimContext,
  target: Entity,
  incoming: number,
): number | null {
  if (target.kind !== 'player' || target.dead || incoming < target.hp) return null;
  if (!fireSpecMods(ctx, target)) return null;
  // The fatigue debuff IS the cooldown: while worn, no second save. An aura (not a
  // procState icd) because procState resets on death, and this lockout must hold
  // through a die-revive-die inside the window (owner 2026-07-13).
  if (target.auras.some((a) => a.kind === 'cauterize_fatigue')) return null;
  target.hp = Math.max(1, Math.round(target.maxHp * CAUTERIZE_HEAL_FRAC));
  ctx.applyAura(target, {
    id: CAUTERIZE_FATIGUE_ID,
    name: 'Cauterize Fatigue',
    kind: 'cauterize_fatigue',
    value: 0,
    remaining: CAUTERIZE_ICD,
    duration: CAUTERIZE_ICD,
    sourceId: target.id,
    school: 'fire',
  });
  ctx.applyAura(target, {
    id: CAUTERIZING_ID,
    name: 'Cauterized',
    kind: 'dot',
    value: Math.max(1, Math.round(target.maxHp * CAUTERIZE_BURN_PER_SEC)),
    remaining: CAUTERIZE_BURN_DURATION,
    duration: CAUTERIZE_BURN_DURATION,
    tickInterval: 1,
    tickTimer: 1,
    sourceId: target.id,
    school: 'fire',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: target.id,
    targetId: target.id,
    school: 'fire',
    fx: 'wardBloom',
  });
  ctx.emit({ type: 'log', pid: target.id, text: 'Cauterize saves you!', color: '#ff7a1a' });
  return 0;
}

/** Bank a burn on the target over IGNITE_DURATION, STACKING into the running
 *  Ignite (per-tick value grows, clock refreshes). The caller computes the
 *  burn from RESOLVED damage; draws no rng. */
export function applyIgnite(ctx: SimContext, source: Entity, target: Entity, burn: number): void {
  if (burn <= 0 || target.dead) return;
  const perTick = Math.max(1, Math.round(burn / (IGNITE_DURATION / IGNITE_INTERVAL)));
  const existing = target.auras.find((a) => a.id === 'ignite' && a.sourceId === source.id);
  if (existing) {
    existing.value += perTick;
    existing.remaining = IGNITE_DURATION;
    existing.duration = IGNITE_DURATION;
    return;
  }
  ctx.applyAura(target, {
    id: 'ignite',
    name: 'Ignite',
    kind: 'dot',
    value: perTick,
    remaining: IGNITE_DURATION,
    duration: IGNITE_DURATION,
    tickInterval: IGNITE_INTERVAL,
    tickTimer: IGNITE_INTERVAL,
    sourceId: source.id,
    school: 'fire',
  });
}

/** The mastery hook, called from combat/damage.ts once per landed hit: a fire
 *  mage's Fire-school ABILITY crit banks its Ignite. Ignite's own ticks carry
 *  crit=false, so a burn can never re-ignite itself. */
export function igniteOnCrit(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
  crit: boolean,
  school: string,
  ability: string | null,
): void {
  if (!crit || amount <= 0 || ability === null || school !== 'fire') return;
  if (!source || source.id === target.id) return;
  const mods = fireSpecMods(ctx, source);
  if (!mods || mods.global.ignitionPct <= 0) return;
  applyIgnite(ctx, source, target, Math.round(amount * mods.global.ignitionPct));
}

/** Does this ability id name a mage ability (used by tests and tooling). */
export function isFireSpender(abilityId: string): boolean {
  return HOT_STREAK_SPENDERS.includes(abilityId) && ABILITIES[abilityId] !== undefined;
}
