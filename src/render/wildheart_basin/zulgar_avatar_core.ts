// Pure plan for Zulgar's Jaguar Avatar (zulgar_avatar_fx.ts): how big the jade
// spirit cat runs round him, how fast it fades in and out with the hunt, which
// gait it shows at his pace and at what clip rate, and how it turns.
//
// Three-free, DOM-free, deterministic.

import { JAGUAR_MODEL } from './jaguar_model_core';

export const AVATAR_LOOK = {
  /** The spirit cat a third again the Fanglord's: 6.1 yd to its ears, so it
   *  wraps the 2.8-scale priest from shoulder to haunch. */
  scale: 1.3,
  /** Its spirit material over the GLB's: opacity factor, emissive intensity. */
  opacity: 1.35,
  emissive: 3.2,
  /** Seconds to fade in (the hunt's roar) and out (the hunt's end). */
  fadeIn: 0.55,
  fadeOut: 0.8,
  /** The chase that smooths his 20 Hz steps (1/s), and its turn (rad/s). */
  follow: 18,
  turnRate: 7,
  /** Its body for the trail: half width, length, height (yards). */
  halfWidth: 1.6,
  length: 9,
  height: 6,
} as const;

/** The fade (0..1) after `dt` toward shown (`active`) or gone. */
export function avatarFade(fade: number, active: boolean, dt: number): number {
  const step = dt / (active ? AVATAR_LOOK.fadeIn : AVATAR_LOOK.fadeOut);
  return Math.max(0, Math.min(1, fade + (active ? step : -step)));
}

/** The gait his pace asks for (yards a second). */
export function avatarGait(speed: number): 'Idle' | 'Walk' | 'Run' {
  if (speed < 0.6) return 'Idle';
  return speed < 4.5 ? 'Walk' : 'Run';
}

/** The clip rate that keeps its planted paws on the ground at his pace. */
export function avatarGaitRate(gait: 'Idle' | 'Walk' | 'Run', speed: number): number {
  if (gait === 'Idle') return 1;
  const ref = (gait === 'Run' ? JAGUAR_MODEL.runRef : JAGUAR_MODEL.walkRef) * AVATAR_LOOK.scale;
  return Math.max(0.6, Math.min(1.7, speed / ref));
}

/** Turn `from` toward `to` by at most `max` radians, the short way round. */
export function turnToward(from: number, to: number, max: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= max) return to;
  return from + Math.sign(d) * max;
}
