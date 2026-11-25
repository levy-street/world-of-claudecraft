// Moonwing Tidewheel (Moongrove rework). Moongrove in Moonwing Form runs two
// banks instead of one: Suntide (Wildbolt casts and Stinging Swarm ticks) and
// Moontide (Skyfall casts and Lunar Tempest ticks). Each bank has its own
// payoff button, usable from 3 of its 5 points in Moonwing Form: Sunwake spends
// Suntide, Moonsurge spends Moontide (Moonsurge took the retired Moonseed's
// place in the kit). Each payoff refreshes its school's damage over time
// effect and opens a 10 sec window that favours the OTHER school (one window
// at a time: opening one closes the other):
// - Sunrise (after Sunwake): Skyfall casts faster and Lunar Tempest ticks
//   faster.
// - Moonrise (after Moonsurge): Wildbolt hits harder and Stinging Swarm ticks
//   faster.
// Tidecross: a payoff cast inside the OTHER payoff's window strikes harder
// (Moonsurge during Sunrise, Sunwake during Moonrise). That is what pays for
// turning the wheel: spamming one side keeps its own payoff but never lands
// a crossed strike.
// Casts also feed the effects: Wildbolt extends Stinging Swarm and Skyfall
// extends Lunar Tempest.
//
// A leaf module: it imports no class engine, so druid_engines.ts,
// effect_dispatch.ts, ability_resolution.ts and auras.ts can all call into it.
// Every hook is gated on a Moongrove druid in Moonwing Form; nothing here
// draws rng. Every tuning number is exported so the Monte Carlo harness and
// the tests read the values the sim applies.

import type { SimContext } from '../sim_context';
import { duelJustEndedBetween } from '../social/duel';
import { abilityScalingPower, dotTickBonus } from '../spell_scaling';
import { resolveTalentHitMult } from '../talent_hit_mult';
import type { Aura, Entity } from '../types';
import { extendOwnedDot } from './dot_mutation';

export const SUNTIDE_ID = 'suntide';
export const SUNTIDE_NAME = 'Suntide';
/** Suntide and Moontide each hold up to this many points. */
export const SUNTIDE_STAGES = 5;
/** Sunwake and Moonsurge (and Spore Burst's Moontide empowerment) become
 *  usable at this many points of their bank. */
export const TIDE_PAYOFF_MIN_STACKS = 3;
/** Each banked point past TIDE_PAYOFF_MIN_STACKS adds this much to the
 *  payoff's strike (Spore Burst's damage too): +20% at 4, +40% at 5. */
export const TIDE_SURPLUS_DMG_PER_STACK = 0.2;
/** The Moontide bank's aura id (druid_engines.ts MOONTIDE_ID; repeated here
 *  because druid_engines imports this module). */
const MOONTIDE_BANK_ID = 'moontide';

export const LUNAR_TEMPEST_ID = 'moonfire';
export const STINGING_SWARM_ID = 'insect_swarm';
export const WILDBOLT_ID = 'wrath';
export const SKYFALL_ID = 'starfire';
export const SUNWAKE_ID = 'sunlance';
export const MOONSURGE_ID = 'moonlash';

export const SUNRISE_ID = 'sunrise';
export const SUNRISE_NAME = 'Sunrise';
export const MOONRISE_ID = 'moonrise';
export const MOONRISE_NAME = 'Moonrise';
/** How long Sunrise and Moonrise last. */
export const TIDEWHEEL_WINDOW_SECONDS = 10;
/** Sunrise: Skyfall's cast time multiplier (0.8 = 25% faster). */
export const SUNRISE_SKYFALL_CAST_MULT = 0.8;
/** Moonrise: Wildbolt's damage multiplier. */
export const MOONRISE_WILDBOLT_DMG_MULT = 1.25;
/** Sunrise speeds Lunar Tempest ticks, Moonrise speeds Stinging Swarm ticks. */
export const TIDEWHEEL_TICK_RATE = 1.2;

/** A tick of Stinging Swarm or Lunar Tempest adds 1 to its bank, at most once
 *  per this many seconds per bank. */
export const TIDE_TICK_ICD = 8;
export const SUNTIDE_TICK_ICD_KEY = 'dru_suntide_tick';
export const MOONTIDE_TICK_ICD_KEY = 'dru_moontide_tick';

/** Wildbolt extends Stinging Swarm, Skyfall extends Lunar Tempest, per cast. */
export const TIDE_CAST_EXTEND_SECONDS = 2;
export const STINGING_SWARM_EXTEND_CAP = 6;
/** Skyfall's Lunar Tempest extension budget per application (one extendedBy
 *  counter per application; a Moonsurge replant starts a fresh one). */
export const LUNAR_TEMPEST_EXTEND_CAP = 12;

/** Tidecross: the payoff strike's multiplier when cast inside the other
 *  payoff's window (Moonsurge in Sunrise, Sunwake in Moonrise). */
export const TIDECROSS_PAYOFF_DMG_MULT = 1.3;
/** How long a crossed payoff in flight keeps its bonus (projectile travel). */
const TIDECROSS_ARMED_SECONDS = 5;
/** A crossed strike that landed before its cast-completed hook (no travel)
 *  leaves this short marker so the hook does not arm a second bonus. */
const TIDECROSS_TAKEN_SECONDS = 0.5;
const TIDECROSS_ARMED_PREFIX = 'dru_tidecross_armed_';
/** procState.counters key holding the armed strike's whole multiplier
 *  (Tidecross times the bank surplus), next to its armed marker. */
const PAYOFF_MULT_PREFIX = 'dru_tide_payoff_mult_';
const TIDECROSS_TAKEN_PREFIX = 'dru_tidecross_taken_';

function selfMarker(source: Entity, id: string): Aura | undefined {
  return source.auras.find(
    (aura) => aura.id === id && aura.sourceId === source.id && aura.kind === 'internal_cd',
  );
}

/** Sunwake or Moonsurge. */
export function isTidewheelPayoff(abilityId: string): boolean {
  return abilityId === SUNWAKE_ID || abilityId === MOONSURGE_ID;
}

/** The payoffs gate on their bank (requiresAuraKind), and a bank outlives the
 *  form, so the cast gate also asks for Moonwing Form here: true when this
 *  press must be refused. */
export function tidewheelPayoffBlocked(
  actor: { readonly auras: readonly { readonly kind: string }[] },
  abilityId: string,
): boolean {
  if (!isTidewheelPayoff(abilityId)) return false;
  return !actor.auras.some((aura) => aura.kind === 'form_moonkin');
}

/** The window that crosses this payoff: Sunrise for Moonsurge, Moonrise for
 *  Sunwake. */
function crossWindowOf(abilityId: string): typeof SUNRISE_ID | typeof MOONRISE_ID | null {
  if (abilityId === MOONSURGE_ID) return SUNRISE_ID;
  if (abilityId === SUNWAKE_ID) return MOONRISE_ID;
  return null;
}

/** Is this payoff crossed right now (its other window is open)? */
export function tidewheelCrossed(source: Entity, abilityId: string): boolean {
  const window = crossWindowOf(abilityId);
  return window !== null && selfMarker(source, window) !== undefined;
}

function tidecrossIcds(source: Entity): Record<string, number> {
  if (!source.procState) source.procState = { counters: {}, icds: {} };
  return source.procState.icds;
}

function tidecrossKey(prefix: string, abilityId: string, target: Entity): string {
  return `${prefix}${abilityId}_${target.id}`;
}

/** The bank surplus multiplier for a payoff spent at this many points:
 *  1 at 3 or fewer, +20% per point past 3, capped at the bank size. */
export function tidewheelSurplusMult(stacks: number): number {
  const surplus = Math.max(0, Math.min(stacks, SUNTIDE_STAGES) - TIDE_PAYOFF_MIN_STACKS);
  return 1 + TIDE_SURPLUS_DMG_PER_STACK * surplus;
}

/** The druid's own points in the bank this payoff spends (Suntide for
 *  Sunwake, Moontide for Moonsurge). */
export function tidewheelPayoffBankStacks(source: Entity, abilityId: string): number {
  const bankId =
    abilityId === SUNWAKE_ID ? SUNTIDE_ID : abilityId === MOONSURGE_ID ? MOONTIDE_BANK_ID : null;
  if (!bankId) return 0;
  const bank = source.auras.find((aura) => aura.id === bankId && aura.sourceId === source.id);
  return bank?.stacks ?? 0;
}

/** The payoff strike's live multiplier: Tidecross (its other window open)
 *  times the bank surplus (points past 3). */
function livePayoffMult(source: Entity, abilityId: string): number {
  const cross = tidewheelCrossed(source, abilityId) ? TIDECROSS_PAYOFF_DMG_MULT : 1;
  return cross * tidewheelSurplusMult(tidewheelPayoffBankStacks(source, abilityId));
}

/** Tidecross and the bank surplus on the payoff's strike. Both payoffs fly:
 *  the strike lands AFTER the cast-completed hook already spent the bank and
 *  swapped the window, so that hook ARMS the whole multiplier
 *  (tidewheelArmTidecross) and the impact consumes it here. A strike with no
 *  travel lands first: it reads the live window and bank and leaves a short
 *  marker so the hook does not arm a second bonus. Draws no rng. */
export function tidewheelPayoffMult(
  source: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): number {
  if (!isTidewheelPayoff(abilityId) || !target) return 1;
  const armed = tidecrossKey(TIDECROSS_ARMED_PREFIX, abilityId, target);
  if (source.procState?.icds[armed] !== undefined) {
    delete source.procState.icds[armed];
    const multKey = tidecrossKey(PAYOFF_MULT_PREFIX, abilityId, target);
    const mult = source.procState.counters[multKey] ?? TIDECROSS_PAYOFF_DMG_MULT;
    delete source.procState.counters[multKey];
    return mult;
  }
  const mult = livePayoffMult(source, abilityId);
  if (mult === 1) return 1;
  tidecrossIcds(source)[tidecrossKey(TIDECROSS_TAKEN_PREFIX, abilityId, target)] =
    TIDECROSS_TAKEN_SECONDS;
  return mult;
}

/** Read-only: does this payoff's strike into this target carry a bonus now (an
 *  armed one in flight, which may be Tidecross, the bank surplus or both, or a
 *  live cross window)? For tests and readouts. */
export function tidewheelPayoffCrossPending(
  source: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): boolean {
  if (!isTidewheelPayoff(abilityId) || !target) return false;
  const armed = tidecrossKey(TIDECROSS_ARMED_PREFIX, abilityId, target);
  if (source.procState?.icds[armed] !== undefined) return true;
  return tidewheelCrossed(source, abilityId);
}

/** Called from the payoff's cast-completed hook BEFORE it spends its bank and
 *  opens its own window: a crossed payoff, or one spent past 3 points, arms
 *  its in-flight strike with the whole multiplier, unless the strike already
 *  landed and took it. */
export function tidewheelArmTidecross(
  source: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): void {
  if (!target || !isTidewheelPayoff(abilityId)) return;
  const taken = tidecrossKey(TIDECROSS_TAKEN_PREFIX, abilityId, target);
  if (source.procState?.icds[taken] !== undefined) {
    delete source.procState.icds[taken];
    return;
  }
  const mult = livePayoffMult(source, abilityId);
  if (mult === 1) return;
  tidecrossIcds(source)[tidecrossKey(TIDECROSS_ARMED_PREFIX, abilityId, target)] =
    TIDECROSS_ARMED_SECONDS;
  if (!source.procState) source.procState = { counters: {}, icds: {} };
  source.procState.counters[tidecrossKey(PAYOFF_MULT_PREFIX, abilityId, target)] = mult;
}

export function isTidewheelDruid(ctx: SimContext, player: Entity): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  if (meta?.cls !== 'druid' || ctx.playerMods(meta).spec !== 'balance') return false;
  return player.auras.some((aura) => aura.kind === 'form_moonkin');
}

/** Open (or restart) Sunrise or Moonrise on the druid: an inert marker. */
export function openTidewheelWindow(
  ctx: SimContext,
  source: Entity,
  id: typeof SUNRISE_ID | typeof MOONRISE_ID,
): void {
  // One window at a time: opening Sunrise closes Moonrise and the reverse,
  // so the wheel always points at exactly one school.
  for (let index = source.auras.length - 1; index >= 0; index--) {
    const aura = source.auras[index];
    if ((aura.id !== SUNRISE_ID && aura.id !== MOONRISE_ID) || aura.sourceId !== source.id) {
      continue;
    }
    source.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: source.id, name: aura.name, gained: false });
  }
  ctx.applyAura(source, {
    id,
    name: id === SUNRISE_ID ? SUNRISE_NAME : MOONRISE_NAME,
    kind: 'internal_cd',
    remaining: TIDEWHEEL_WINDOW_SECONDS,
    duration: TIDEWHEEL_WINDOW_SECONDS,
    value: 0,
    sourceId: source.id,
    school: id === SUNRISE_ID ? 'nature' : 'arcane',
  });
}

/** Skyfall's cast time under Sunrise (ability_resolution's cast-time chain). */
export function tidewheelCastTime(
  actor: Pick<Entity, 'auras' | 'id'>,
  abilityId: string,
  castTime: number,
): number {
  if (abilityId !== SKYFALL_ID || castTime <= 0) return castTime;
  const sunrise = actor.auras.some(
    (aura) => aura.id === SUNRISE_ID && aura.sourceId === actor.id && aura.kind === 'internal_cd',
  );
  return sunrise ? castTime * SUNRISE_SKYFALL_CAST_MULT : castTime;
}

/** Wildbolt's direct damage multiplier under Moonrise. */
export function tidewheelDirectMult(source: Entity, abilityId: string): number {
  if (abilityId !== WILDBOLT_ID) return 1;
  return selfMarker(source, MOONRISE_ID) ? MOONRISE_WILDBOLT_DMG_MULT : 1;
}

/** How fast this aura's tick clock runs: Lunar Tempest under its owner's
 *  Sunrise, Stinging Swarm under its owner's Moonrise, else 1. */
export function tidewheelTickRate(ctx: SimContext, aura: Aura): number {
  if (aura.kind !== 'dot') return 1;
  const window =
    aura.id === LUNAR_TEMPEST_ID ? SUNRISE_ID : aura.id === STINGING_SWARM_ID ? MOONRISE_ID : null;
  if (!window) return 1;
  const source = ctx.entities.get(aura.sourceId);
  if (!source || !selfMarker(source, window)) return 1;
  return TIDEWHEEL_TICK_RATE;
}

/** Wildbolt extends Stinging Swarm, Skyfall extends Lunar Tempest. */
export function tidewheelExtendOnCast(
  player: Entity,
  abilityId: string,
  target: Entity | null | undefined,
): void {
  if (!target || target.dead) return;
  if (abilityId === WILDBOLT_ID) {
    extendOwnedDot(
      target,
      player.id,
      STINGING_SWARM_ID,
      TIDE_CAST_EXTEND_SECONDS,
      STINGING_SWARM_EXTEND_CAP,
    );
  } else if (abilityId === SKYFALL_ID) {
    extendOwnedDot(
      target,
      player.id,
      LUNAR_TEMPEST_ID,
      TIDE_CAST_EXTEND_SECONDS,
      LUNAR_TEMPEST_EXTEND_CAP,
    );
  }
}

/** Which bank a tick of this dot feeds, or null. */
export function tidewheelTickBank(aura: Aura): 'suntide' | 'moontide' | null {
  if (aura.kind !== 'dot') return null;
  if (aura.id === STINGING_SWARM_ID) return 'suntide';
  if (aura.id === LUNAR_TEMPEST_ID) return 'moontide';
  return null;
}

/** A payoff refreshes its school's effect: a fresh application at the
 *  value a real cast would plant (mirrors effect_dispatch's dot arm, the
 *  Spell Power rider skipped on a hybrid such as Lunar Tempest). */
export function tidewheelReplantDot(
  ctx: SimContext,
  player: Entity,
  target: Entity | null | undefined,
  abilityId: typeof LUNAR_TEMPEST_ID | typeof STINGING_SWARM_ID,
): void {
  if (!target || target.dead || !ctx.isHostileTo(player, target)) return;
  if (duelJustEndedBetween(ctx, target, player)) return;
  const meta = player.kind === 'player' ? ctx.players.get(player.id) : undefined;
  if (!meta) return;
  const resolved = ctx.resolvedAbility(abilityId, player.id);
  const dot = resolved?.effects.find((effect) => effect.type === 'dot');
  if (!resolved || !dot || dot.type !== 'dot') return;
  const hybrid = resolved.effects.some(
    (effect) =>
      effect.type === 'directDamage' ||
      effect.type === 'chainDamage' ||
      effect.type === 'aoeDamage' ||
      effect.type === 'aoeRoot',
  );
  const mods = ctx.playerMods(meta);
  const dotBase = Math.max(1, Math.round(dot.total / (dot.duration / dot.interval)));
  const dotSp = hybrid
    ? 0
    : dotTickBonus(
        abilityScalingPower(player, resolved.def),
        resolved.def,
        dot.duration,
        dot.interval,
        resolveTalentHitMult(resolved.def, mods).dmgMult * (1 + mods.global.dotDmgPct),
      );
  const id = dot.auraId ?? abilityId;
  // A refresh keeps the running tick clock: the payoffs land every few
  // seconds, and restarting the timer each time would eat the next tick.
  const live = target.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === id && aura.sourceId === player.id,
  );
  const tickTimer = live ? Math.min(live.tickTimer ?? dot.interval, dot.interval) : dot.interval;
  ctx.applyAura(target, {
    id,
    name: resolved.def.name,
    kind: 'dot',
    remaining: dot.duration,
    duration: dot.duration,
    value: dotBase + dotSp,
    tickInterval: dot.interval,
    tickTimer,
    sourceId: player.id,
    school: dot.school ?? resolved.def.school,
  });
  ctx.enterCombat(player, target);
}
