// Readiness-driven admission of detailed scenery after world entry.
//
// Vista tiers already have a coarse far-terrain stand-in. The first live frame
// therefore does not need to admit every detailed subsystem out to 700 yards.
// This policy opens a small useful near field first, then expands one ring only
// when shader debt is settled, terrain exists through that ring, and several
// consecutive frame intervals show headroom. It is deliberately not a timer:
// a slow machine may hold a ring as long as needed without dumping the rest of
// the debt into one frame.

export const ENTRY_DETAIL_HORIZON_STEPS = [240, 360, 520, 700] as const;
export const ENTRY_DETAIL_HORIZON_STABLE_FRAMES = 8;
export const ENTRY_DETAIL_HORIZON_HEADROOM_MS = 20;

export interface EntryDetailHorizonState {
  cap: number;
  step: number;
  stableFrames: number;
  complete: boolean;
}

export interface EntryDetailHorizonInput {
  targetFar: number;
  compileReady: boolean;
  terrainReadyFar: number;
  frameMs: number;
  /** The renderer governor identified display pacing rather than render load. */
  externallyPaced?: boolean;
}

const targetAt = (step: number, targetFar: number): number =>
  Math.min(
    targetFar,
    ENTRY_DETAIL_HORIZON_STEPS[Math.min(step, ENTRY_DETAIL_HORIZON_STEPS.length - 1)],
  );

export function createEntryDetailHorizonState(targetFar: number): EntryDetailHorizonState {
  const cap = Math.max(0, targetAt(0, targetFar));
  return { cap, step: 0, stableFrames: 0, complete: cap >= targetFar };
}

export function advanceEntryDetailHorizon(
  state: EntryDetailHorizonState,
  input: EntryDetailHorizonInput,
): EntryDetailHorizonState {
  if (state.complete || state.cap >= input.targetFar) {
    return { ...state, cap: input.targetFar, stableFrames: 0, complete: true };
  }
  const nextStep = Math.min(state.step + 1, ENTRY_DETAIL_HORIZON_STEPS.length - 1);
  const nextCap = targetAt(nextStep, input.targetFar);
  const healthy =
    input.compileReady &&
    input.terrainReadyFar >= nextCap &&
    Number.isFinite(input.frameMs) &&
    (input.externallyPaced || input.frameMs <= ENTRY_DETAIL_HORIZON_HEADROOM_MS);
  const stableFrames = healthy ? state.stableFrames + 1 : 0;
  if (stableFrames < ENTRY_DETAIL_HORIZON_STABLE_FRAMES) {
    return { ...state, stableFrames };
  }
  return {
    cap: nextCap,
    step: nextStep,
    stableFrames: 0,
    complete: nextCap >= input.targetFar,
  };
}

/**
 * The cull far the reveal-gated scenery (props, towns, foliage) consults while
 * the entry horizon is still expanding: the horizon's cap wins over a wider
 * cull far. Before the far-terrain stand-in is complete the renderer culls at
 * scene fog instead of the horizon, and one such frame under the entry cover
 * requested every scenery key out to that fog (measured: 81 keys, 46 of them
 * beyond the 240 yd first ring, the two mainland towns included), clogging the
 * reveal lane the spawn's own decor waits in and starting their watchdogs
 * while the horizon then hid them. Terrain keeps the wide far: the stand-in
 * question is its own, and nothing it draws rides the reveal lane. The bound
 * is on REAL-GEOMETRY keys: foliage sprite rows cull against the atmospheric
 * far (foliage.ts `spriteFar`), which this cap does not shrink, so an impostor
 * bucket beyond the ring still consults its gate.
 */
export function entrySceneryCullFar(cullFar: number, state: EntryDetailHorizonState): number {
  return state.complete ? cullFar : Math.min(cullFar, state.cap);
}
