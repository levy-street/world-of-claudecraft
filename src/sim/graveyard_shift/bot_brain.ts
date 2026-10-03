// The adventurer party's decision rules, pure: no SimContext, no shared rng.
// The driver (bot_driver.ts) builds the inputs from VISIBLE state only (health,
// positions, cast bars, auras; never the player's input) and applies the
// outcome through the real player verbs, so every rule here is a fair one.
// Randomness comes only from each bot's private Rng.

import type { Rng } from '../rng';
import type { AbilityDef, PlayerClass } from '../types';

// A bot thinks five times a second, its decisions staggered across the party.
export const BOT_THINK_INTERVAL_TICKS = 4;
// A perceived event becomes actionable after a human reaction delay
// (400 to 900 ms); a bot never reacts faster than that.
export const BOT_REACTION_MIN_TICKS = 8;
export const BOT_REACTION_MAX_TICKS = 18;
// An interrupt never fires in the first 0.3 sec of the cast it cuts.
export const BOT_INTERRUPT_MIN_ELAPSED = 0.3;
// The party engages once Morthen comes this close or lands a hit.
export const PARTY_ENGAGE_RADIUS = 12;

export type BotRole = 'tank' | 'healer' | 'dps';

// Where each bot wants to stand from its target: the tank and the rogue in
// melee, the casters and the hunter at range.
const MELEE_RANGE_GOAL = 2.5;
export const ROLE_RANGE: Record<BotRole, number> = { tank: MELEE_RANGE_GOAL, healer: 18, dps: 22 };
export function botRange(role: BotRole, cls: PlayerClass): number {
  return cls === 'rogue' ? MELEE_RANGE_GOAL : ROLE_RANGE[role];
}

// The interrupt each class reaches for at level 10, and how often a pickup
// player of that class notices a given cast and goes for it (the rest of the
// time it is busy with its own buttons). The tank is the party's kicker; the
// hunter has Counter Shot but plays the pickup hunter who never presses it.
export const BOT_KICK: Partial<Record<PlayerClass, { ability: string; chance: number }>> = {
  warrior: { ability: 'pummel', chance: 0.45 },
  rogue: { ability: 'kick', chance: 0.3 },
  mage: { ability: 'counterspell', chance: 0.2 },
};

export function willKick(cls: PlayerClass, rng: Rng): boolean {
  const kick = BOT_KICK[cls];
  return kick !== undefined && rng.chance(kick.chance);
}

export function reactionDelayTicks(rng: Rng): number {
  return rng.int(BOT_REACTION_MIN_TICKS, BOT_REACTION_MAX_TICKS);
}

export function interruptAllowed(castTotal: number, castRemaining: number): boolean {
  return castTotal - castRemaining >= BOT_INTERRUPT_MIN_ELAPSED;
}

// The fairness rule: bots never crowd-control the boss (the template is immune
// anyway; this keeps them from wasting casts on it).
const CONTROL_EFFECTS = new Set(['stun', 'polymorph', 'incapacitate', 'fear', 'root']);
export function isControlAbility(def: Pick<AbilityDef, 'effects'>): boolean {
  return def.effects.some((effect) => CONTROL_EFFECTS.has(effect.type));
}

export interface HealCandidate {
  id: number;
  hpFrac: number;
  role: BotRole;
  isSelf: boolean;
}

// Healer triage, with its exploitable flaw: the tank weighs heavier and the
// healer neglects itself. Returns the most urgent ally, or null when nobody is
// hurt. Ties break on entity id, never on iteration order.
export function pickHealTarget(allies: readonly HealCandidate[]): HealCandidate | null {
  let best: HealCandidate | null = null;
  let bestScore = 0;
  for (const ally of allies) {
    const weight = ally.isSelf ? 0.6 : ally.role === 'tank' ? 1.5 : 1;
    const score = (1 - ally.hpFrac) * weight;
    if (score <= 0) continue;
    if (score > bestScore || (score === bestScore && best && ally.id < best.id)) {
      best = ally;
      bestScore = score;
    }
  }
  return best;
}

export interface TargetCandidate {
  id: number;
  hpFrac: number;
  isAssist: boolean; // the tank's current target
  attackingMe: boolean;
  isCurrent: boolean;
  isMinion: boolean;
}

// Damage target choice: assist the tank, finish the wounded, answer whoever
// hits me, and keep hitting what I already hit (tunnel vision, the flaw that
// lets a minion chew on the healer).
export function scoreTarget(c: TargetCandidate): number {
  return (
    (c.isAssist ? 1 : 0) +
    0.3 * (1 - c.hpFrac) +
    (c.attackingMe ? 0.4 : 0) +
    (c.isCurrent ? 0.35 : 0) -
    (c.isMinion && !c.isAssist ? 0.2 : 0)
  );
}

export function pickTarget(candidates: readonly TargetCandidate[]): TargetCandidate | null {
  let best: TargetCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const score = scoreTarget(c);
    if (score > bestScore || (score === bestScore && best && c.id < best.id)) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

// A private stream per run, mixed from the world seed, the start tick and the
// owner (zero draws on the shared stream), and one sub-stream per roster slot so
// adding a bot never shifts the others.
export function graveyardShiftRunSeed(worldSeed: number, tick: number, ownerPid: number): number {
  let h = 2166136261;
  for (const v of [worldSeed, tick, ownerPid]) {
    h ^= v >>> 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

export function botSeed(runSeed: number, rosterIndex: number): number {
  return (runSeed ^ Math.imul(rosterIndex + 1, 0x9e3779b9)) >>> 0 || 1;
}
