// The one signal saying the client paces its own rendered frames (the frame
// rate ceiling). Written once per rendered frame by the frame loop's cadence
// wiring (src/game/frame_cadence_wiring.ts), read by the consumers that would
// otherwise take the chosen interval for a slow machine. Module state, like
// arrival_cover.ts: the writer and the readers share no object to thread it on.

import { chosenCadenceLoadMs, NO_CHOSEN_CADENCE } from './chosen_cadence_pressure_core';

let chosenIntervalMs = 0;
/** Longer than any tier's shed cooldown (gfx.ts budgets), so consecutive steps
 *  of one descent read as one shedding span. Play time, not a machine reading. */
export const GOVERNOR_SHEDDING_HOLD_S = 3;

let missShare = NO_CHOSEN_CADENCE;
let holdQuality = false;
let governorSheddingForS = 0;
let governorAtBaseline = false;
let playerInCombat = false;

/** `hold`: the automatic ceiling is still forming its verdict (a provisional
 *  hold, a probe, a probation), so the governor keeps its quality levels. */
export function setChosenCadence(intervalMs: number, share: number, hold: boolean): void {
  chosenIntervalMs = intervalMs > 0 ? intervalMs : 0;
  missShare = chosenIntervalMs > 0 ? share : NO_CHOSEN_CADENCE;
  holdQuality = hold;
}

/** A new renderer starts with a governor that is not shedding: without this a
 *  value left by the previous one would stop the automatic ceiling for good. */
export function resetChosenCadenceForRenderer(): void {
  governorSheddingForS = 0;
  governorAtBaseline = false;
  playerInCombat = false;
}

export function chosenCadenceHoldsQuality(): boolean {
  return holdQuality;
}

/** Written by the renderer after each governor update, read by the automatic
 *  ceiling: quality is shed first, the ceiling waits its turn. */
export function noteGovernorShedding(shedding: boolean, dtSeconds: number): void {
  // The governor reads as shedding only on the frame a step fires, then cools
  // down for about a second before the next one: a whole descent of its ladder
  // is a pulse train. The reading is held across those gaps.
  if (shedding) governorSheddingForS = GOVERNOR_SHEDDING_HOLD_S;
  else if (dtSeconds > 0) governorSheddingForS = Math.max(0, governorSheddingForS - dtSeconds);
}

/** The renderer's other two readings for the automatic ceiling: the governor
 *  has restored its baseline quality (the headroom evidence a probe needs), and
 *  the player is in a fight (no probe then). */
export function noteCadenceProbeContext(atBaseline: boolean, inCombat: boolean): void {
  governorAtBaseline = atBaseline;
  playerInCombat = inCombat;
}

export function governorIsAtBaseline(): boolean {
  return governorAtBaseline;
}

export function cadencePlayerInCombat(): boolean {
  return playerInCombat;
}

export function governorIsShedding(): boolean {
  return governorSheddingForS > 0;
}

/** The chosen interval in ms, 0 when the display paces the frames. */
export function chosenCadenceIntervalMs(): number {
  return chosenIntervalMs;
}

export function chosenCadenceMissShare(): number {
  return missShare;
}

/** The frame interval as a load reading (see chosenCadenceLoadMs). */
export function frameLoadMs(intervalMs: number): number {
  return chosenCadenceLoadMs(intervalMs, chosenIntervalMs);
}
