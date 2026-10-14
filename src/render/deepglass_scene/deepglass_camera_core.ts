// The Deepglass flight camera's pure half: the boom held inside the bell's
// glass and the base FOV easing between the land and flight figures. Three-
// and DOM-free; renderer.ts updateCamera is the thin consumer.

import { DEEPGLASS_CENTER, DEEPGLASS_RADIUS } from '../../sim/deepglass/layout';

/**
 * The Deepglass flight camera: Rocket League's FOV and camera lag, in the
 * bell's yards. FOV is RL's 110 horizontal, ~76 vertical at 16:9 (the land
 * camera is 60). Stiffness and leash are the camera LAG: the pivot trails a
 * burning body a couple of yards and catches up, which is the whole sense of
 * acceleration that game's camera has and a rigid boom cannot give.
 */
export const DG_CAMERA_FOV = 76;
export const DG_CAM_STIFFNESS = 0.5;
export const DG_CAM_LEASH_SCALE = 2.4;
/** Seconds for the base FOV to ease between the land and flight figures. */
export const DG_CAM_FOV_TAU = 0.35;
/** How far inside the glass the camera is held, yards. */
export const DG_CAM_GLASS_MARGIN = 0.6;

/**
 * The longest boom that keeps the camera INSIDE the bell's glass, from the eye
 * point along the boom direction (renderer seats the camera at eye minus
 * dir * dist, dir = (sin yaw cos pitch, -sin pitch, cos yaw cos pitch)).
 * Infinity when the eye is not inside the sphere (nothing to hold). Solves
 * |(E - C) - d t| = R for the far root, so the camera is pulled in to the
 * glass rather than pushed through it.
 */
export function bellBoomLimit(
  ex: number,
  ey: number,
  ez: number,
  yaw: number,
  pitch: number,
): number {
  const rx = ex - DEEPGLASS_CENTER.x;
  const ry = ey - DEEPGLASS_CENTER.y;
  const rz = ez - DEEPGLASS_CENTER.z;
  const r = DEEPGLASS_RADIUS - DG_CAM_GLASS_MARGIN;
  const rr = rx * rx + ry * ry + rz * rz;
  if (rr >= r * r) return Number.POSITIVE_INFINITY;
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp;
  const dy = -Math.sin(pitch);
  const dz = Math.cos(yaw) * cp;
  // Camera = E - d t. |E - C - d t|^2 = R^2 -> t^2 - 2 (d . (E-C)) t + rr - R^2 = 0.
  const b = dx * rx + dy * ry + dz * rz;
  const disc = b * b - (rr - r * r);
  if (disc <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0.9, b + Math.sqrt(disc));
}

/**
 * The base FOV for this frame. In the Deepglass world it eases between the
 * land figure and the bell's wider one rather than stepping, so a bout's first
 * frame is not a zoom cut. Every other world returns the land base unchanged,
 * exactly as before the bell existed (a settings FOV change still lands on
 * the next frame, never eased).
 */
export function nextCameraFovBase(
  current: number,
  landFov: number,
  flying: boolean,
  deepglassWorld: boolean,
  dt: number,
): number {
  if (!deepglassWorld) return landFov;
  const target = flying ? DG_CAMERA_FOV : landFov;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / DG_CAM_FOV_TAU));
  return Math.abs(next - target) < 0.02 ? target : next;
}
