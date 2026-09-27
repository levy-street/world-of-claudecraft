// The forge workshop: a timing hammer and a heat gauge.
//
// A needle sweeps a bar back and forth; a dark band marks where the blow must
// land. Strike (the anvil) while the needle is inside the band and the piece
// takes shape; every good strike narrows the band and quickens the needle.
// The forge cools the whole time: Stoke (the woodpile) throws heat back in,
// and a blow on a forge below the heat floor is a cold strike that counts as
// a mistake. Ten good strikes finish the piece; the medal comes from the
// clock plus a penalty per mistake, exactly as before.
//
// Pure, deterministic and clock-driven: the needle and the heat are FUNCTIONS
// of the authoritative time, so both hosts and the owner's client read the
// same value from the same clock with no per-tick mutation. An isolated seeded
// stream picks each band centre so workshop input never perturbs world RNG.

import { Rng } from '../rng';
import type { WorldQuestForgeResult, WorldQuestForgeState } from '../types';

export const FORGE_STRIKES = 10;
export const FORGE_MAX_MISTAKES = 3;
export const FORGE_WRONG_PENALTY = 3;
export const FORGE_GOLD_SECONDS = 40;
export const FORGE_SILVER_SECONDS = 60;
export const FORGE_CLOCK_INTERVAL = 0.2;
export const FORGE_COUNTDOWN_SECONDS = 3;
/** Needle sweeps per second at the first strike; grows with every strike landed. */
export const FORGE_NEEDLE_SWEEPS = 0.55;
export const FORGE_NEEDLE_SWEEP_GROWTH = 0.07;
/** Band half-width (0..1 of the bar) at the first strike, its shrink per strike and floor. */
export const FORGE_BAND_HALF = 0.16;
export const FORGE_BAND_SHRINK = 0.011;
export const FORGE_BAND_MIN_HALF = 0.055;
/** Heat: percent floor for a warm strike, decay per second, gain per stoke, stoke cooldown. */
export const FORGE_HEAT_FLOOR = 70;
export const FORGE_HEAT_DECAY = 7;
export const FORGE_STOKE_HEAT = 12;
export const FORGE_STOKE_COOLDOWN = 0.5;
export const FORGE_STRIKE_LOCK = 0.35;
export const FORGE_MISS_LOCK = 0.45;

export function createForgeWorkshop(seed: number, now: number): WorldQuestForgeState {
  const readyAt = now + FORGE_COUNTDOWN_SECONDS;
  return {
    phase: 'countdown',
    observedAt: now,
    seed: seed >>> 0,
    readyAt,
    startedAt: readyAt,
    strikes: 0,
    band: forgeBandCentre(seed >>> 0, 0),
    bandHalf: FORGE_BAND_HALF,
    heat: 100,
    heatAt: readyAt,
    stokeReadyAt: readyAt,
    lockUntil: readyAt,
    mistakes: 0,
    feedback: 'ready',
  };
}

/** Where the band sits for strike number `strike` (0-based), in [0.15, 0.85]. */
export function forgeBandCentre(seed: number, strike: number): number {
  const rng = new Rng((seed ^ Math.imul(strike + 1, 0x9e3779b1)) >>> 0);
  return 0.15 + rng.next() * 0.7;
}

/** The needle's position on the bar (0..1) at authoritative time `now`. */
export function forgeNeedleAt(
  state: Pick<WorldQuestForgeState, 'startedAt' | 'strikes'>,
  now: number,
): number {
  const sweeps = FORGE_NEEDLE_SWEEPS * (1 + FORGE_NEEDLE_SWEEP_GROWTH * state.strikes);
  const phase = Math.max(0, now - state.startedAt) * sweeps;
  const cycle = phase - Math.floor(phase / 2) * 2;
  return cycle <= 1 ? cycle : 2 - cycle;
}

/** The forge heat (0..100) at authoritative time `now`, decaying since the last sample. */
export function forgeHeatAt(
  state: Pick<WorldQuestForgeState, 'heat' | 'heatAt'>,
  now: number,
): number {
  return Math.max(
    0,
    Math.min(100, state.heat - FORGE_HEAT_DECAY * Math.max(0, now - state.heatAt)),
  );
}

export function forgeNeedleInBand(
  state: Pick<WorldQuestForgeState, 'band' | 'bandHalf'>,
  needle: number,
): boolean {
  return Math.abs(needle - state.band) <= state.bandHalf;
}

export function forgeResult(elapsed: number, mistakes: number): WorldQuestForgeResult {
  const adjustedTime = elapsed + mistakes * FORGE_WRONG_PENALTY;
  return {
    elapsed,
    mistakes,
    adjustedTime,
    rating:
      adjustedTime <= FORGE_GOLD_SECONDS
        ? 'gold'
        : adjustedTime <= FORGE_SILVER_SECONDS
          ? 'silver'
          : 'bronze',
  };
}

/** Clock publication at a bounded cadence; returns true when the owner readout changed. */
export function advanceForgeWorkshop(state: WorldQuestForgeState, now: number): boolean {
  if (state.phase === 'success' || state.phase === 'failed') return false;
  const becameReady = state.observedAt < state.readyAt && now >= state.readyAt;
  const phaseChanged = state.phase === 'countdown' && now >= state.readyAt;
  if (phaseChanged) state.phase = 'working';
  if (!phaseChanged && !becameReady && now - state.observedAt < FORGE_CLOCK_INTERVAL - 1e-9)
    return false;
  state.observedAt = now;
  return true;
}

function working(state: WorldQuestForgeState, now: number): boolean {
  if (state.phase === 'countdown' && now >= state.readyAt) state.phase = 'working';
  return state.phase === 'working' && now >= state.readyAt;
}

/** The anvil: returns true only on accepted input (a blow, hit or miss). */
export function strikeForge(state: WorldQuestForgeState, now: number): boolean {
  if (!working(state, now) || now < state.lockUntil) return false;
  state.observedAt = now;
  if (forgeHeatAt(state, now) < FORGE_HEAT_FLOOR) {
    state.mistakes++;
    state.feedback = 'cold';
    state.lockUntil = now + FORGE_MISS_LOCK;
    if (state.mistakes >= FORGE_MAX_MISTAKES) {
      state.phase = 'failed';
    }
    return true;
  }
  if (!forgeNeedleInBand(state, forgeNeedleAt(state, now))) {
    state.mistakes++;
    state.feedback = 'miss';
    state.lockUntil = now + FORGE_MISS_LOCK;
    if (state.mistakes >= FORGE_MAX_MISTAKES) {
      state.phase = 'failed';
    }
    return true;
  }
  state.strikes++;
  state.feedback = 'hit';
  state.lockUntil = now + FORGE_STRIKE_LOCK;
  if (state.strikes >= FORGE_STRIKES) {
    state.phase = 'success';
    state.result = forgeResult(Math.max(0, now - state.startedAt), state.mistakes);
    return true;
  }
  state.band = forgeBandCentre(state.seed, state.strikes);
  state.bandHalf = Math.max(FORGE_BAND_MIN_HALF, state.bandHalf - FORGE_BAND_SHRINK);
  return true;
}

/** The woodpile: returns true only when a stoke was accepted. */
export function stokeForge(state: WorldQuestForgeState, now: number): boolean {
  if (!working(state, now) || now < state.stokeReadyAt) return false;
  state.observedAt = now;
  state.heat = Math.min(100, forgeHeatAt(state, now) + FORGE_STOKE_HEAT);
  state.heatAt = now;
  state.stokeReadyAt = now + FORGE_STOKE_COOLDOWN;
  state.feedback = 'stoked';
  return true;
}

export function sanitizeForgeResult(value: unknown): WorldQuestForgeResult | undefined {
  if (!value || typeof value !== 'object') return;
  const row = value as Partial<WorldQuestForgeResult>;
  if (
    typeof row.elapsed !== 'number' ||
    !Number.isFinite(row.elapsed) ||
    row.elapsed < 0 ||
    row.elapsed > 86400 ||
    !Number.isSafeInteger(row.mistakes) ||
    (row.mistakes as number) < 0 ||
    (row.mistakes as number) > 100000
  )
    return;
  return forgeResult(row.elapsed, row.mistakes as number);
}
