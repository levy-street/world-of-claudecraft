// Moonwing Tidewheel (Moongrove rework). Moongrove in Moonwing Form runs two
// banks instead of one: Suntide (Wildbolt casts and Stinging Swarm ticks) and
// Moontide (Skyfall and Moonseed casts and Lunar Tempest ticks). Each bank has
// its own payoff on the existing buttons: Sunwake (the Skyfall button) spends
// Suntide, Moonsurge (the Moonseed button) spends Moontide. Each payoff
// refreshes its school's damage over time effect and opens a 10 sec window
// that favours the OTHER school (one window at a time: opening one closes the
// other), so the best play alternates instead of
// spamming Skyfall:
// - Sunrise (after Sunwake): Skyfall casts faster and Lunar Tempest ticks
//   faster.
// - Moonrise (after Moonsurge): Wildbolt hits harder and Stinging Swarm ticks
//   faster.
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
export const SUNTIDE_STAGES = 3;

export const LUNAR_TEMPEST_ID = 'moonfire';
export const STINGING_SWARM_ID = 'insect_swarm';
export const WILDBOLT_ID = 'wrath';
export const SKYFALL_ID = 'starfire';

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
/** Lunar Tempest's extension budget is shared with Moonseed's own 6 sec
 *  extendDot row (one extendedBy counter per application), so Skyfall's cap
 *  sits on top of it. */
export const LUNAR_TEMPEST_EXTEND_CAP = 12;

function selfMarker(source: Entity, id: string): Aura | undefined {
  return source.auras.find(
    (aura) => aura.id === id && aura.sourceId === source.id && aura.kind === 'internal_cd',
  );
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
