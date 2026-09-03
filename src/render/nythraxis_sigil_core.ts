// Nythraxis Binding Sigil presentation math. The countdown sweep and spoke
// placement are deterministic and allocation-free so the Three painter only
// owns buffers and materials.

import { NYTHRAXIS_SIGIL_CAST_ID } from '../sim/nythraxis_binding_sigil';

export const NYTHRAXIS_SIGIL_SPOKE_COUNT = 8;
export const NYTHRAXIS_SIGIL_GROUND_LIFT = 0.065;
export const NYTHRAXIS_SIGIL_SWEEP_SEGMENTS = 64;

export const NYTHRAXIS_SIGIL_PALETTE = {
  rim: 0xffd27a,
  fill: 0x5a4310,
  sweep: 0xffe7ad,
} as const;

export function isNythraxisBindingSigil(ability: string | undefined): boolean {
  return ability === NYTHRAXIS_SIGIL_CAST_ID;
}

/** Visible clockwise arc in radians, clamped to the authoritative duration. */
export function nythraxisSigilSweepAngle(remaining: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.PI * 2 * Math.min(1, Math.max(0, remaining / duration));
}

export interface NythraxisSigilSpokePose {
  x: number;
  z: number;
  yaw: number;
  length: number;
  width: number;
}

export function nythraxisSigilSpokePoseInto(
  out: NythraxisSigilSpokePose,
  index: number,
  radius: number,
): NythraxisSigilSpokePose {
  const angle = (index / NYTHRAXIS_SIGIL_SPOKE_COUNT) * Math.PI * 2;
  const inner = radius * 0.3;
  const outer = radius * 0.88;
  const middle = (inner + outer) * 0.5;
  out.x = Math.sin(angle) * middle;
  out.z = Math.cos(angle) * middle;
  out.yaw = angle;
  out.length = outer - inner;
  out.width = Math.max(0.08, radius * 0.035);
  return out;
}

/** A slow readable breath, fixed at its midpoint for reduced motion. */
export function nythraxisSigilRimOpacity(phase: number, reducedMotion: boolean): number {
  const wave = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(phase);
  return 0.78 + wave * 0.16;
}
