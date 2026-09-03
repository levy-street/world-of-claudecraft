// The Crown Endures: Nythraxis's hard enrage clock.
//
// The clock starts on the first encounter tick and runs through the
// transition. When it runs out he gains a large damage and attack-speed bonus,
// and the damage bonus keeps climbing every NYTHRAXIS_ENRAGE_RAMP_EVERY
// seconds until the raid or the king is dead. Text warnings fire as the clock
// crosses each mark in NYTHRAXIS_ENRAGE_WARN_SECONDS; there is no timer bar
// (classic fidelity). The pure pieces live here (tuning, the warn-mark
// crossings, the stack ramp); the driver in encounters/nythraxis.ts owns the
// elapsed counter, the auras, and the yells.
//
// Both clock lengths are calibration placeholders until the matrix runs
// (docs/prd/nythraxis-mechanics-redo.md, section 8).
//
// `src/sim`-pure: no rng, no wall clock, no DOM.

import type { DungeonDifficulty } from './types';

export const NYTHRAXIS_CROWN_ENDURES_CAST_ID = 'The Crown Endures';
export const NYTHRAXIS_CROWN_ENDURES_AURA_ID = 'nythraxis_crown_endures';
export const NYTHRAXIS_CROWN_ENDURES_HASTE_AURA_ID = 'nythraxis_crown_endures_haste';
export const NYTHRAXIS_CROWN_ENDURES_AURA_NAME = 'The Crown Endures';

export const NYTHRAXIS_ENRAGE_SECONDS_NORMAL = 7 * 60;
export const NYTHRAXIS_ENRAGE_SECONDS_HEROIC = 6 * 60;
/** Seconds remaining at which a warning fires, in the order they are crossed. */
export const NYTHRAXIS_ENRAGE_WARN_SECONDS = [60, 30, 10] as const;
export type NythraxisEnrageWarn = (typeof NYTHRAXIS_ENRAGE_WARN_SECONDS)[number];
export const NYTHRAXIS_ENRAGE_DAMAGE_BONUS = 0.5;
export const NYTHRAXIS_ENRAGE_HASTE_BONUS = 0.5;
export const NYTHRAXIS_ENRAGE_RAMP_EVERY = 30;
export const NYTHRAXIS_ENRAGE_RAMP_STEP = 0.25;

/** The callout each warning mark and the enrage itself emit. */
export const NYTHRAXIS_ENRAGE_WARN_CALLOUT = {
  60: 'crownEndures60',
  30: 'crownEndures30',
  10: 'crownEndures10',
} as const satisfies Record<NythraxisEnrageWarn, string>;
export const NYTHRAXIS_ENRAGE_CALLOUT = 'crownEndures';

export function nythraxisEnrageSeconds(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_ENRAGE_SECONDS_HEROIC
    : NYTHRAXIS_ENRAGE_SECONDS_NORMAL;
}

/** Seconds left on the clock (0 once it has run out). */
export function nythraxisEnrageRemaining(elapsed: number, difficulty: DungeonDifficulty): number {
  return Math.max(0, nythraxisEnrageSeconds(difficulty) - elapsed);
}

/**
 * The warning mark the clock crossed between two consecutive elapsed readings
 * (the first crossed mark if a long step crosses several), or null. A mark is
 * crossed when the remaining time falls from above it to at or below it.
 */
export function nythraxisEnrageWarnCrossed(
  previousElapsed: number,
  elapsed: number,
  difficulty: DungeonDifficulty,
): NythraxisEnrageWarn | null {
  const before = nythraxisEnrageRemaining(previousElapsed, difficulty);
  const after = nythraxisEnrageRemaining(elapsed, difficulty);
  for (const mark of NYTHRAXIS_ENRAGE_WARN_SECONDS) {
    if (before > mark && after <= mark) return mark;
  }
  return null;
}

/** True on the tick the clock runs out. */
export function nythraxisEnrageStarts(
  previousElapsed: number,
  elapsed: number,
  difficulty: DungeonDifficulty,
): boolean {
  const limit = nythraxisEnrageSeconds(difficulty);
  return previousElapsed < limit && elapsed >= limit;
}

/** 0 before the clock runs out, 1 at the enrage, +1 every ramp interval after. */
export function nythraxisEnrageStacks(elapsed: number, difficulty: DungeonDifficulty): number {
  const over = elapsed - nythraxisEnrageSeconds(difficulty);
  if (over < 0) return 0;
  return 1 + Math.floor(over / NYTHRAXIS_ENRAGE_RAMP_EVERY);
}

/** The damage bonus at a stack count: the base at 1, one ramp step per stack after. */
export function nythraxisEnrageDamageBonus(stacks: number): number {
  if (stacks <= 0) return 0;
  return NYTHRAXIS_ENRAGE_DAMAGE_BONUS + (stacks - 1) * NYTHRAXIS_ENRAGE_RAMP_STEP;
}
