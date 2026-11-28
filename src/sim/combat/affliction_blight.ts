// Hexcraft "Blight Coven" (the affliction DoT rework). Hexcraft keeps its
// Condemnation bar, Evil Eye, Needle of Fate and Sentence, and gains three
// DoTs that fill the bar as they tick:
// - Blackrot (ability id 'corruption'): the long, weakest DoT. It jumps to the
//   nearest enemy when its target dies, and stealth effects cannot strip it, so
//   its next tick pulls a hidden enemy back out (damage breaks stealth).
// - Hex of Anguish ('curse_of_agony'): the short DoT with the hardest ticks.
// - Veinleech ('siphon_life'): the leech; healing past full health becomes a
//   capped shield.
// Buffs: Evil Eye (DoTs on the Eye target deal more and echo to every other
// enemy carrying Blackrot), Hex of Violence (DoT ticks may tick twice), Hour of
// Judgment (doubles tick Condemnation). Spenders: Contagion (copies the three
// DoTs to nearby enemies), Sentence (refreshes them), Plague Bloom (deals a
// burst of ticks to every enemy carrying Blackrot).
//
// Every tuning number lives here so the Monte Carlo harness and the tests read
// the values the sim applies. Draws rng only for the Hex of Violence roll.

import { HEXTHREAD_2PC_TICK_STACK_CHANCE } from '../content/ignivar_set_bonuses';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { wearsSetBonus } from './set_bonus_wearer';

export const BLACKROT_ID = 'corruption';
export const HEX_OF_ANGUISH_ID = 'curse_of_agony';
export const VEINLEECH_ID = 'siphon_life';
export const BLIGHT_DOT_IDS: ReadonlySet<string> = new Set([
  BLACKROT_ID,
  HEX_OF_ANGUISH_ID,
  VEINLEECH_ID,
]);

/** Condemnation each tick generates on the Evil Eye target. */
export const BLIGHT_TICK_DOOM: Readonly<Record<string, number>> = {
  [BLACKROT_ID]: 1,
  [HEX_OF_ANGUISH_ID]: 2,
  [VEINLEECH_ID]: 1,
};
/** Ticks on enemies without the primary Eye generate this share. */
export const BLIGHT_OFF_EYE_DOOM_MULT = 0.5;
/** At most this much Condemnation from DoT ticks per second, all enemies. */
export const BLIGHT_TICK_DOOM_CAP_PER_SEC = 6;
/** Hour of Judgment multiplies tick Condemnation. */
export const BLIGHT_JUDGMENT_TICK_DOOM_MULT = 2;

/** Evil Eye: your DoTs on the primary Eye target deal this much more. */
export const BLIGHT_EYE_DOT_BONUS = 0.2;
/** Evil Eye: share of each Eye-target tick echoed to other Blackrot carriers. */
export const BLIGHT_EYE_ECHO_PCT = 0.15;
export const BLIGHT_EYE_ECHO_MAX_TARGETS = 4;
export const BLIGHT_EYE_ECHO_RANGE = 30;

/** Hex of Violence: chance for a DoT tick on the hexed enemy to tick again. */
export const BLIGHT_VIOLENCE_DOUBLE_TICK_CHANCE = 0.7;

/** Blackrot jumps to the nearest enemy within this range of its dying host. */
export const BLACKROT_JUMP_RANGE = 10;
/** Veinleech: overheal turns into a shield capped at this share of max HP. */
export const VEINLEECH_SHIELD_CAP_PCT = 0.1;
export const VEINLEECH_SHIELD_ID = 'veinleech_ward';
const VEINLEECH_SHIELD_SECONDS = 10;

export const CONTAGION_DOOM_COST = 30;
export const CONTAGION_MAX_TARGETS = 3;
export const CONTAGION_RADIUS = 12;
/** Copies last this share of their full duration. */
export const CONTAGION_DURATION_PCT = 1;

export const PLAGUE_BLOOM_DOOM_COST = 60;
export const PLAGUE_BLOOM_TICKS = 4;
export const PLAGUE_BLOOM_MAX_TARGETS = 5;
export const PLAGUE_BLOOM_RANGE = 30;

export const BLIGHT_SENTENCE_HEAL_PCT = 0.3;
export const BLIGHT_SENTENCE_SPLASH_RADIUS = 12;

const TICK_DOOM_WINDOW_START = 'blight_tick_doom_window_start';
const TICK_DOOM_WINDOW_SPENT = 'blight_tick_doom_window_spent';
const TICK_DOOM_CARRY = 'blight_tick_doom_carry';

export function isBlightDot(aura: Pick<Aura, 'kind' | 'id'>): boolean {
  return aura.kind === 'dot' && BLIGHT_DOT_IDS.has(aura.id);
}

/** Blackrot is the weakest DoT, so stealth strips (Greater Invisibility) skip it. */
export function survivesStealthStrip(aura: Pick<Aura, 'kind' | 'id'>): boolean {
  return aura.kind === 'dot' && aura.id === BLACKROT_ID;
}

function hasPrimaryEye(target: Entity, warlockId: number): boolean {
  return target.auras.some((a) => a.kind === 'affliction_eye' && a.sourceId === warlockId);
}

function ownDot(target: Entity, warlockId: number, id: string): Aura | undefined {
  return target.auras.find((a) => a.kind === 'dot' && a.id === id && a.sourceId === warlockId);
}

function dist(a: Entity, b: Entity): number {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
}

/** Tick multiplier for a Blight DoT (Evil Eye bonus on the primary Eye target). */
export function blightTickMult(source: Entity | null, target: Entity, aura: Aura): number {
  if (!source || !isBlightDot(aura)) return 1;
  return hasPrimaryEye(target, source.id) ? 1 + BLIGHT_EYE_DOT_BONUS : 1;
}

function counters(entity: Entity): Record<string, number> {
  if (!entity.procState) entity.procState = { counters: {}, icds: {} };
  return entity.procState.counters;
}

/** Condemnation from a tick, through the off-Eye share, Judgment and the per-second cap. */
function tickDoomGain(ctx: SimContext, warlock: Entity, target: Entity, aura: Aura): number {
  let gain = BLIGHT_TICK_DOOM[aura.id] ?? 0;
  if (gain <= 0) return 0;
  if (!hasPrimaryEye(target, warlock.id)) gain *= BLIGHT_OFF_EYE_DOOM_MULT;
  if (warlock.auras.some((a) => a.kind === 'affliction_judgment')) {
    gain *= BLIGHT_JUDGMENT_TICK_DOOM_MULT;
  }
  const c = counters(warlock);
  const start = c[TICK_DOOM_WINDOW_START] ?? -Infinity;
  if (ctx.time - start >= 1) {
    c[TICK_DOOM_WINDOW_START] = ctx.time;
    c[TICK_DOOM_WINDOW_SPENT] = 0;
  }
  const room = Math.max(0, BLIGHT_TICK_DOOM_CAP_PER_SEC - (c[TICK_DOOM_WINDOW_SPENT] ?? 0));
  gain = Math.min(gain, room);
  c[TICK_DOOM_WINDOW_SPENT] = (c[TICK_DOOM_WINDOW_SPENT] ?? 0) + gain;
  // Halved ticks bank their fraction so two off-Eye ticks still pay a point.
  const total = (c[TICK_DOOM_CARRY] ?? 0) + gain;
  const whole = Math.floor(total + 1e-9);
  c[TICK_DOOM_CARRY] = total - whole;
  return whole;
}

export interface BlightTickDeps {
  gainDoom: (ctx: SimContext, warlock: Entity, amount: number) => number;
  /** Deals one more tick of the same aura (the Rotfever double tick). */
  repeatTick: () => void;
  /** Adds one Carrion stack to the warlock (Hexthread 2pc proc). */
  addStack?: () => void;
}

/**
 * Runs after a Blight DoT tick landed: its Blight, the Hexthread 2pc Rot Splinter
 * roll, the Rotmark echo and the Rotfever repeat roll. A tick that killed its target
 * still pays its Blight, then stops. `extra` marks a Rotfever repeat: a real tick
 * that echoes like any other, but never rolls another repeat.
 */
export function blightOnDotTick(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  aura: Aura,
  tickDamage: number,
  deps: BlightTickDeps,
  extra = false,
): void {
  if (!source || source.dead || !isBlightDot(aura)) return;
  const gain = tickDoomGain(ctx, source, target, aura);
  if (gain > 0) deps.gainDoom(ctx, source, gain);
  // The tick killed its target: no Splinter roll, no echo, no repeat roll (and no
  // rng drawn for any of them).
  if (target.dead) return;
  if (
    deps.addStack &&
    hasPrimaryEye(target, source.id) &&
    wearsSetBonus(ctx, source, 'hexthread', 2) &&
    ctx.rng.chance(HEXTHREAD_2PC_TICK_STACK_CHANCE)
  ) {
    deps.addStack();
  }
  if (hasPrimaryEye(target, source.id) && BLIGHT_EYE_ECHO_PCT > 0) {
    const echo = Math.round(tickDamage * BLIGHT_EYE_ECHO_PCT);
    if (echo > 0) {
      const carriers = [...ctx.entities.values()]
        .filter(
          (e) =>
            e.id !== target.id &&
            !e.dead &&
            ctx.isHostileTo(source, e) &&
            dist(e, target) <= BLIGHT_EYE_ECHO_RANGE &&
            ownDot(e, source.id, BLACKROT_ID) !== undefined,
        )
        .sort((a, b) => dist(a, target) - dist(b, target) || a.id - b.id)
        .slice(0, BLIGHT_EYE_ECHO_MAX_TARGETS);
      for (const carrier of carriers) {
        ctx.dealDamage(
          source,
          carrier,
          echo,
          false,
          'shadow',
          'Rotmark',
          'hit',
          true,
          undefined,
          false,
          false,
          false,
          'evil_eye',
        );
      }
    }
  }
  if (extra) return;
  const violence = target.auras.find(
    (a) => a.kind === 'affliction_violence' && a.sourceId === source.id && a.remaining > 0,
  );
  if (violence && ctx.rng.chance(violence.value || BLIGHT_VIOLENCE_DOUBLE_TICK_CHANCE)) {
    deps.repeatTick();
  }
}

/** Veinleech overheal becomes a shield, topped up to the cap. */
export function veinleechOverhealShield(
  ctx: SimContext,
  warlock: Entity,
  aura: Aura,
  overheal: number,
): void {
  if (aura.id !== VEINLEECH_ID || overheal <= 0 || warlock.dead) return;
  const cap = Math.round(warlock.maxHp * VEINLEECH_SHIELD_CAP_PCT);
  if (cap <= 0) return;
  const existing = warlock.auras.find(
    (a) => a.kind === 'absorb' && a.id === VEINLEECH_SHIELD_ID && a.sourceId === warlock.id,
  );
  if (existing) {
    existing.value = Math.min(cap, existing.value + overheal);
    existing.remaining = VEINLEECH_SHIELD_SECONDS;
    return;
  }
  ctx.applyAura(warlock, {
    id: VEINLEECH_SHIELD_ID,
    name: 'Veinleech Ward',
    kind: 'absorb',
    value: Math.min(cap, overheal),
    remaining: VEINLEECH_SHIELD_SECONDS,
    duration: VEINLEECH_SHIELD_SECONDS,
    sourceId: warlock.id,
    school: 'shadow',
  });
}

/** Blackrot leaves a dying host for the nearest enemy that lacks it. */
export function blackrotJumpOnDeath(ctx: SimContext, dying: Entity): void {
  for (const rot of dying.auras) {
    if (rot.kind !== 'dot' || rot.id !== BLACKROT_ID || rot.remaining <= 0) continue;
    const warlock = ctx.entities.get(rot.sourceId);
    if (!warlock || warlock.dead) continue;
    let best: Entity | null = null;
    let bestDist = Infinity;
    for (const e of ctx.entities.values()) {
      if (e.id === dying.id || e.dead || !ctx.isHostileTo(warlock, e)) continue;
      if (ownDot(e, warlock.id, BLACKROT_ID)) continue;
      const d = dist(e, dying);
      if (
        d <= BLACKROT_JUMP_RANGE &&
        (d < bestDist || (d === bestDist && best && e.id < best.id))
      ) {
        best = e;
        bestDist = d;
      }
    }
    if (best) ctx.applyAura(best, { ...rot });
  }
}

/** Contagion: copy the three DoTs from the target to the nearest enemies. */
export function applyContagion(
  ctx: SimContext,
  warlock: Entity,
  target: Entity,
  maxTargets = CONTAGION_MAX_TARGETS,
  radius = CONTAGION_RADIUS,
): number {
  const dots = [...BLIGHT_DOT_IDS]
    .map((id) => ownDot(target, warlock.id, id))
    .filter((d): d is Aura => d !== undefined);
  if (dots.length === 0) return 0;
  const victims = [...ctx.entities.values()]
    .filter(
      (e) =>
        e.id !== target.id && !e.dead && ctx.isHostileTo(warlock, e) && dist(e, target) <= radius,
    )
    .sort((a, b) => dist(a, target) - dist(b, target) || a.id - b.id)
    .slice(0, maxTargets);
  for (const victim of victims) {
    for (const dot of dots) {
      const duration = dot.duration * CONTAGION_DURATION_PCT;
      ctx.applyAura(victim, {
        ...dot,
        remaining: duration,
        duration,
        tickTimer: dot.tickInterval ?? dot.tickTimer,
      });
    }
    ctx.enterCombat(warlock, victim);
  }
  return victims.length;
}

/** Plague Bloom: every Blackrot carrier in range takes a burst of ticks. */
export function applyPlagueBloom(
  ctx: SimContext,
  warlock: Entity,
  ticks = PLAGUE_BLOOM_TICKS,
  maxTargets = PLAGUE_BLOOM_MAX_TARGETS,
  range = PLAGUE_BLOOM_RANGE,
): number {
  const carriers = [...ctx.entities.values()]
    .filter(
      (e) =>
        !e.dead &&
        ctx.isHostileTo(warlock, e) &&
        dist(e, warlock) <= range &&
        ownDot(e, warlock.id, BLACKROT_ID) !== undefined,
    )
    .sort((a, b) => {
      const ae = hasPrimaryEye(a, warlock.id) ? 0 : 1;
      const be = hasPrimaryEye(b, warlock.id) ? 0 : 1;
      return ae - be || dist(a, warlock) - dist(b, warlock) || a.id - b.id;
    })
    .slice(0, maxTargets);
  for (const victim of carriers) {
    let total = 0;
    for (const id of BLIGHT_DOT_IDS) {
      const dot = ownDot(victim, warlock.id, id);
      if (dot) total += dot.value * ticks * blightTickMult(warlock, victim, dot);
    }
    if (total <= 0) continue;
    ctx.dealDamage(
      warlock,
      victim,
      Math.round(total),
      false,
      'shadow',
      'Plague Bloom',
      'hit',
      true,
      undefined,
      false,
      false,
      false,
      'plague_bloom',
    );
  }
  return carriers.length;
}

/** Sentence refreshes the three DoTs on its target to full duration. */
export function refreshBlightDots(target: Entity, warlockId: number): void {
  for (const id of BLIGHT_DOT_IDS) {
    const dot = ownDot(target, warlockId, id);
    if (dot) dot.remaining = dot.duration;
  }
}

/** Hexcraft's own damage against players is 10% higher than against mobs. */
export const BLIGHT_PVP_DAMAGE_MULT = 1.1;

/** PvP-only damage multiplier for a Hexcraft warlock's own hits on players. */
export function blightPvpDamageMult(ctx: SimContext, source: Entity): number {
  const meta = source.kind === 'player' ? ctx.players.get(source.id) : undefined;
  return meta?.cls === 'warlock' && meta.talents.spec === 'affliction' ? BLIGHT_PVP_DAMAGE_MULT : 1;
}
