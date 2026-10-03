// Pure plan for the Sunken Bastion's creature effects (bastion_creature_fx.ts):
// where the Fogbound Arbalest's crossbow looses from and how its bolts fly,
// and when and where the Gaol Turnkey's lantern flares as it opens the cells.
// Numbers are in the creatures' Blender model units (scripts/assets/
// sunken_bastion_creatures/: drowned.py, turnkey.py), scaled here by the
// VISUALS height the renderer normalizes each GLB to.
//
// Presentation only: the sim already decided every hit; this just draws the
// bolt that carries it. Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';

export const ARBALEST = 'fogbound_arbalest';
export const TURNKEY = 'gaol_turnkey';

/** The attack gesture the renderer plays when the Turnkey opens the cells
 *  (its VISUALS row maps it to the LanternRaise clip). */
export const BASTION_OPEN_CELLS_GESTURE = 'bastion_open_cells';

/** A point in a creature's own frame, in model units: `side` to its LEFT
 *  (+X in the Blender file), `up`, and `fwd` along its facing. */
export interface ModelPoint {
  side: number;
  up: number;
  fwd: number;
}

/** The arbalest GLB's rest bounding height (model units; the Blender build
 *  prints it), which the VISUALS height normalizes. */
export const ARBALEST_RAW_HEIGHT = 3.14;
/** Where the loaded bolt's head sits at the loose (the shouldered aim, the
 *  crossbow level at the right cheek, the bolt tip past the prod). */
export const ARBALEST_MUZZLE: ModelPoint = { side: -0.3, up: 1.97, fwd: 2.2 };

/** The Turnkey GLB's idle bounding height (model units; turnkey.py prints it
 *  as IDLE_HEIGHT). */
export const TURNKEY_RAW_HEIGHT = 5.78;
/** The lantern held high over its head at the top of LanternRaise (turnkey.py
 *  prints it as LANTERN_HIGH, measured over the body's lowest point). */
export const TURNKEY_LANTERN_HIGH: ModelPoint = { side: 1.2, up: 5.45, fwd: 0.83 };
/** The lantern flares as it reaches the top of the raise (frame 9 of 24 fps). */
export const LANTERN_FLARE_DELAY = 0.36;
export const LANTERN_FLARE_SEC = 1.1;

/** Crossbow bolt speeds (yards per second): the Rusted Bolt, and the heavier
 *  Piercing Bolt driven down its lane. */
export const RUSTED_BOLT_SPEED = 48;
export const PIERCING_BOLT_SPEED = 62;
/** The Rusted Bolt aims at the chest of what it hits. */
export const BOLT_TARGET_CHEST = 1.25;
/** The longest trail each bolt drags (yards). */
export const RUSTED_TRAIL = 3.4;
export const PIERCING_TRAIL = 7.5;

/** Model units to yards for a creature drawn `visualHeight` tall at `scale`. */
export function modelScale(visualHeight: number, scale: number, rawHeight: number): number {
  if (rawHeight <= 0) return 0;
  return (visualHeight * scale) / rawHeight;
}

/** A model point in world space for a body at (x, y, z) facing `facing`
 *  (the game's yaw: forward is (sin, cos), the model's +X maps to
 *  (cos, -sin)). Writes into `out`. */
export function modelPointWorld(
  x: number,
  y: number,
  z: number,
  facing: number,
  k: number,
  p: ModelPoint,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  out.x = x + (p.side * c + p.fwd * s) * k;
  out.y = y + p.up * k;
  out.z = z + (-p.side * s + p.fwd * c) * k;
  return out;
}

/** Seconds a bolt flies `distance` yards at `speed` (never zero, so even a
 *  point-blank shot shows the bolt for a few frames). */
export function boltFlightSeconds(distance: number, speed: number): number {
  return Math.max(0.07, distance / Math.max(1, speed));
}

/** The Piercing Bolt's reach: the full lane the sim tests. */
export function piercingBoltReach(): number {
  return MOBS[ARBALEST]?.trashKit?.line?.length ?? 25;
}

/** The bolt's trail length `traveled` yards into its flight. */
export function boltTrailLength(traveled: number, maxTrail: number): number {
  return Math.max(0, Math.min(traveled, maxTrail));
}

/** The lantern flare's envelope `t` seconds after it lit: a fast swell to
 *  full, a hold, then a slow fade. 0 outside [0, LANTERN_FLARE_SEC]. */
export function lanternFlareEnvelope(t: number): number {
  if (t < 0 || t > LANTERN_FLARE_SEC) return 0;
  const rise = Math.min(1, t / 0.12);
  const fall = 1 - Math.max(0, (t - 0.45) / (LANTERN_FLARE_SEC - 0.45));
  return rise * fall * fall;
}
