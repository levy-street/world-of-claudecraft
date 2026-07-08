// Sprite locomotion — bone-free lean and speed scaling for billboard sprites.
// Sprites have no skeleton, so locomotion is purely visual: a slight forward lean
// when moving and optional animation speed scaling based on movement speed.

import type { AnimState } from '../characters/anim_state';

/** Maximum lean angle (radians) when moving at full speed. */
const MAX_LEAN = 0.12;

/** Smoothing rate for lean interpolation (EMA). */
const LEAN_SMOOTH = 10;

/** Speed at which lean reaches maximum (u/s). */
const LEAN_FULL_SPEED = 6;

export interface SpriteLocoState {
  /** Current lean angle (radians, positive = forward tilt). */
  lean: number;
}

export function newSpriteLocoState(): SpriteLocoState {
  return { lean: 0 };
}

/**
 * Advance sprite locomotion state by one frame.
 * Returns the new lean angle to apply to the sprite mesh's rotation.x.
 */
export function updateSpriteLoco(
  t: SpriteLocoState,
  s: AnimState,
  dt: number,
): number {
  // Target lean: proportional to speed, capped at MAX_LEAN
  const speedRatio = Math.min(1, s.speed / LEAN_FULL_SPEED);
  const targetLean = s.moving ? speedRatio * MAX_LEAN : 0;

  // Smooth interpolation
  t.lean += (targetLean - t.lean) * Math.min(1, dt * LEAN_SMOOTH);

  return t.lean;
}

/**
 * Compute animation speed multiplier based on movement speed.
 * Walk cycles play faster when the entity moves faster.
 */
export function spriteAnimSpeedScale(speed: number): number {
  // Base walk speed ~4 u/s; scale animation proportionally
  const base = 4;
  return Math.max(0.6, Math.min(1.6, speed / base));
}
