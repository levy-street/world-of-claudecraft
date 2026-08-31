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
//
// Dual-wielders (rogue, fury warrior, enhancement shaman) run a genuinely
// independent OFF-HAND swing clock alongside the main-hand one (see
// src/sim/combat/auto_attack.ts): offhandSwingTimerState() is the same fill/ready
// math applied to that second clock, for melee weaving with two weapons. It is a
// second, instance-parameterized use of the SwingTimerPainter family (like
// CastBarPainter already drives both the player and target-of-target bars), not a
// new component: computeSwingState() holds the one copy of the edge-tracking math.

import { clamp01 } from './clamp';

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

/** The player fields the off-hand bar reads. A structural subset of Entity that
 *  both the offline Sim and the online ClientWorld mirror expose. Dual-wield
 *  status is not a separate field: Entity.dualWielding is always exactly
 *  `offhandWeapon !== null` (the only assignment site is entity.ts's
 *  recalcPlayerStats), so `offhandWeapon` alone is the complete gate. */
export interface OffhandSwingPlayerInput {
  autoAttack: boolean;
  offhandSwingTimer: number; // seconds remaining; counts down to 0 (= ready)
  offhandWeapon: { speed: number } | null; // null when not dual-wielding
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

// A live, non-object target (either bar shows only against one).
function isLiveSwingTarget(target: SwingTargetInput | null): boolean {
  return target !== null && !target.dead && target.kind !== 'object';
}

// The fill/ready math shared by the main-hand and off-hand bars. Recovers the
// full interval on the reset edge (timer jumped up): the freshly reset timer IS
// the interval, so trust it outright. The weapon's speed must not floor it
// (main-hand: Wolf Form swings a fixed 1.0s on a slow staff; either hand:
// haste shortens any swing below its weapon speed). On first show mid-swing
// the true interval is unknown, so max(timer, weapon speed) stays the best
// guess until the first edge corrects it; otherwise carry the previous period
// so the fill grows smoothly as the timer counts down.
function computeSwingState(
  swingTimer: number,
  weaponSpeed: number,
  prevPeriod: number,
  prevTimer: number,
): SwingTimerState {
  const period =
    swingTimer > prevTimer + SWING_EDGE_EPSILON
      ? swingTimer
      : prevPeriod <= 0
        ? Math.max(swingTimer, weaponSpeed)
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

export function swingTimerState(
  player: SwingPlayerInput,
  target: SwingTargetInput | null,
  prevPeriod: number,
  prevTimer: number,
): SwingTimerState {
  if (!player.autoAttack || !isLiveSwingTarget(target)) return HIDDEN;
  return computeSwingState(player.swingTimer, player.weapon.speed, prevPeriod, prevTimer);
}

export function offhandSwingTimerState(
  player: OffhandSwingPlayerInput,
  target: SwingTargetInput | null,
  prevPeriod: number,
  prevTimer: number,
): SwingTimerState {
  if (!player.autoAttack || !player.offhandWeapon || !isLiveSwingTarget(target)) return HIDDEN;
  return computeSwingState(
    player.offhandSwingTimer,
    player.offhandWeapon.speed,
    prevPeriod,
    prevTimer,
  );
}

/** The target/target-of-target fields the new bars read. A structural subset
 *  of Entity that both the offline Sim and the online ClientWorld mirror
 *  expose (the mirror is populated by src/net/online.ts's general per-entity
 *  decode of the server's dynamicFields `swing` key, not the self-only path). */
export interface TargetSwingInput {
  dead: boolean;
  kind: string; // entity kind; only 'object' (doors/crates) suppresses the bar
  autoAttack: boolean;
  swingTimer: number; // seconds remaining; counts down to 0 (= ready)
}

export function targetSwingTimerState(
  target: TargetSwingInput | null,
  prevPeriod: number,
  prevTimer: number,
): SwingTimerState {
  if (!target || target.dead || target.kind === 'object' || !target.autoAttack) return HIDDEN;
  // No weapon-speed hint rides the wire for a non-self entity (see
  // server/game.ts dynamicFields): pass 0, so computeSwingState's first-frame
  // guess degrades to swingTimer itself, self-correcting at the next reset edge.
  return computeSwingState(target.swingTimer, 0, prevPeriod, prevTimer);
}
