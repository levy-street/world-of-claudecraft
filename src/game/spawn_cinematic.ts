// First-spawn camera cinematic, pure math (no DOM): the camera opens far out
// across the field, high above the world, and glides in one long continuous
// approach toward the character, sweeping gently around (a fraction of a turn,
// not an orbit) until it lands exactly on the normal gameplay pose. main.ts
// feeds elapsed seconds in and applies the returned pose to the input camera
// each frame; tests/spawn_cinematic.test.ts locks the start/landing/continuity
// contract.

export interface CameraPose {
  yaw: number;
  pitch: number;
  dist: number;
}

export interface SpawnCinematic {
  durationSec: number;
  turns: number; // fraction of a turn swept during the approach
  startDist: number; // the approach opens far out across the field ...
  startPitch: number; // ... and high, looking down over the world
  end: CameraPose; // gameplay pose the cinematic lands on exactly
}

export interface SpawnCinematicPolicyInput {
  requested: boolean;
  seen: boolean;
  playerLevel: number;
  reducedMotion: boolean;
  native: boolean;
  platform: string;
  engine: string;
  constrainedMemory: boolean;
  graphicsPreset: number;
}

export type SpawnCinematicPolicyReason = 'eligible' | 'ineligible' | 'constrained-ios-webkit';

export interface SpawnCinematicPolicyDecision {
  play: boolean;
  reason: SpawnCinematicPolicyReason;
}

/**
 * Decide whether to run the first-spawn pan before any DOM or camera mutation.
 *
 * Native iOS WebKit has a strict WebContent-process memory ceiling that does
 * not scale with the phone's total RAM. On Medium and above, the long camera
 * sweep streams the crowded spawn view while the hidden HUD is revealed at
 * landing. Retained device diagnostics show that combination can terminate
 * the process even after scene construction and prewarm succeeded. Low keeps
 * the cinematic, and ordinary gameplay remains at the player's chosen tier.
 */
export function decideSpawnCinematic(
  input: SpawnCinematicPolicyInput,
): SpawnCinematicPolicyDecision {
  if (!input.requested || input.seen || input.playerLevel > 1 || input.reducedMotion) {
    return { play: false, reason: 'ineligible' };
  }
  if (
    input.native &&
    input.platform === 'ios' &&
    input.engine === 'webkit' &&
    input.constrainedMemory &&
    input.graphicsPreset >= 2
  ) {
    return { play: false, reason: 'constrained-ios-webkit' };
  }
  return { play: true, reason: 'eligible' };
}

// startDist is deliberately beyond the wheel-zoom range (3..22): the opening
// is an establishing shot of the world around the spawn. The renderer clamps
// the camera above terrain, so the long path can never dip underground.
export function spawnCinematicFor(end: CameraPose): SpawnCinematic {
  return { durationSec: 9, turns: 0.3, startDist: 55, startPitch: 1.0, end };
}

export function spawnCinematicPose(
  elapsedSec: number,
  c: SpawnCinematic,
): CameraPose & { done: boolean } {
  const p = clamp01(elapsedSec / c.durationSec);
  // One shared ease for the whole approach: gentle start, long glide, slow
  // landing, with yaw/pitch/dist arriving together so there is no snap.
  const glide = easeInOutSine(p);
  return {
    yaw: c.end.yaw - (1 - glide) * c.turns * Math.PI * 2,
    pitch: c.startPitch + (c.end.pitch - c.startPitch) * glide,
    dist: c.startDist + (c.end.dist - c.startDist) * glide,
    done: elapsedSec >= c.durationSec,
  };
}

// Skipping: desktop presses Escape; touch players have no Escape key, so a
// rapid burst of taps skips instead (a lone stray tap must not).
export const SKIP_TAP_COUNT = 4;
export const SKIP_TAP_WINDOW_SEC = 1.5;

// Records one tap at nowSec into `taps` (pruned in place to the sliding
// window) and reports whether the burst threshold was reached.
export function recordSkipTap(taps: number[], nowSec: number): boolean {
  taps.push(nowSec);
  while (taps.length > 0 && nowSec - taps[0] > SKIP_TAP_WINDOW_SEC) taps.shift();
  return taps.length >= SKIP_TAP_COUNT;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function easeInOutSine(x: number): number {
  return 0.5 - Math.cos(Math.PI * x) / 2;
}
