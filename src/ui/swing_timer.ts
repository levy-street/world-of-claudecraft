// Pure derivation of the swing-timer (auto-attack) bar state. Kept DOM-free and
// i18n-free (no t()/tEntity here, like cast_bar) so the fill / ready rules stay
// unit-testable without a HUD; the painter resolves the visible label from the
// returned discriminator.
//
// The bar fills between melee/ranged auto-attack swings. `swingTimer` counts DOWN
// to 0 (= ready); the full swing interval is recovered from the reset edge so the
// bar stays accurate under haste and for ranged weapons. That edge-tracking is
// PARAMETER-IN / NEXT-STATE-OUT: the core takes the previous period + timer and
// returns the new ones, so it holds no hidden mutable state and stays deterministic
// (same input gives the same output). The Hud owns the two scalars and feeds them
// back next frame, so the core stays allocation-light (a single returned object,
// or the shared HIDDEN constant when the bar is off).

// Epsilon for detecting the swing reset edge: the timer jumping UP past the last
// value means a fresh swing began, so the full interval is recovered.
const SWING_EDGE_EPSILON = 1e-4;

export type SwingLabelKind = 'ready' | 'seconds';

/** The player fields the bar reads. A structural subset of Entity that both the
 *  offline Sim and the online ClientWorld mirror expose. */
export interface SwingPlayerInput {
  autoAttack: boolean;
  swingTimer: number; // seconds remaining; counts down to 0 (= ready)
  weapon: { speed: number }; // seconds per swing
}

/** The target fields the bar reads; null when there is no current target. */
export interface SwingTargetInput {
  dead: boolean;
  kind: string; // entity kind; only 'object' (doors/crates) suppresses the bar
}

export interface SwingTimerState {
  visible: boolean; // whether the bar is shown this frame
  frac: number; // 0..1 fill width (grows toward 1 as the next swing nears)
  ready: boolean; // swingTimer <= 0: the swing is up (highlight + ready label)
  labelKind: SwingLabelKind; // discriminator the painter localizes through t()
  seconds: number; // the swingTimer value the painter formats when labelKind === 'seconds'
  nextPeriod: number; // edge-tracking carried to next frame (the recovered interval)
  nextTimer: number; // edge-tracking carried to next frame (this frame's swingTimer)
}

const HIDDEN: SwingTimerState = {
  visible: false,
  frac: 0,
  ready: false,
  labelKind: 'seconds',
  seconds: 0,
  nextPeriod: 0,
  nextTimer: 0,
};

export function swingTimerState(
  player: SwingPlayerInput,
  target: SwingTargetInput | null,
  prevPeriod: number,
  prevTimer: number,
): SwingTimerState {
  const liveTarget = target !== null && !target.dead && target.kind !== 'object';
  if (!player.autoAttack || !liveTarget) return HIDDEN;

  const swingTimer = player.swingTimer;
  // Recover the full interval on the reset edge (timer jumped up) or first show;
  // otherwise carry the previous period so the fill stays smooth as it counts down.
  const period =
    swingTimer > prevTimer + SWING_EDGE_EPSILON || prevPeriod <= 0
      ? Math.max(swingTimer, player.weapon.speed)
      : prevPeriod;
  const frac = period > 0 ? clamp01(1 - swingTimer / period) : 1;
  const ready = swingTimer <= 0;
  return {
    visible: true,
    frac,
    ready,
    labelKind: ready ? 'ready' : 'seconds',
    seconds: swingTimer,
    nextPeriod: period,
    nextTimer: swingTimer,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
