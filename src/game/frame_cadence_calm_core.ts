// When the automatic Frame Rate Limit may spend a few frames on a probe: never
// in a fight, and not right after one (the pull that follows a kill is the
// worst moment to stutter). Pure: the combat flag and play time in, calm out.

/** Seconds out of combat before the moment counts as calm. */
export const CALM_AFTER_COMBAT_S = 10;

export interface FrameCadenceCalmState {
  quietS: number;
}

export function createFrameCadenceCalm(): FrameCadenceCalmState {
  return { quietS: 0 };
}

export function stepFrameCadenceCalm(
  state: FrameCadenceCalmState,
  inCombat: boolean,
  dtSeconds: number,
): boolean {
  if (inCombat) state.quietS = 0;
  else if (dtSeconds > 0) state.quietS = Math.min(CALM_AFTER_COMBAT_S, state.quietS + dtSeconds);
  return state.quietS >= CALM_AFTER_COMBAT_S;
}
