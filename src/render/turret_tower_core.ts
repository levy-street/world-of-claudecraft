// The Fire and Fly cannon tower on screen, the pure half: the GLB's head and
// barrel nodes and where they sit, the head's eased turn toward the aim, the
// barrel's elevation from the shell's own arc (cannon_shell_core.ts), and the
// gunner's feet behind the breech. The painter is turret_tower_visual.ts; the
// tower's scale and roof are the sim's (fire_and_fly_field.ts).
//
// Three/DOM/i18n-free (RENDER_PURE_CORES).

import { FIRE_AND_FLY_TOWER } from '../sim/fire_and_fly_field';
import { cannonLaunchPitch } from './cannon_shell_core';
import { wrapAngle } from './facing_smooth';

/** hex_tower_cannon.glb, in model units (the tower draws at FIRE_AND_FLY_TOWER.scale). */
export const TURRET_TOWER_MODEL = {
  url: '/models/biome/hex_tower_cannon.glb',
  /** The head: the only node that yaws. It sits on the roof platform, its +z toward the shot. */
  headNode: 'cannon_turret_green',
  /** The barrel, a child of the head: it pitches about its own origin and recoils along its +z. */
  barrelNode: 'cannon_green',
  /** The barrel's origin in the head's space, and its half length (its node scale). */
  barrelPivot: { y: 0.483, z: 0.055 },
  barrelHalfLength: 0.49,
  /** The centre of the bore ring, in the barrel node's own (dequantized) space. */
  muzzleTip: { x: 0, y: 0, z: 1 },
} as const;

export const TURRET_HEAD = {
  /** The fastest the head turns (rad/s): 540 degrees a second. */
  maxTurnRate: 3 * Math.PI,
  /** The ease toward the aim (1/s): the share of the gap closed per second, before the cap. */
  ease: 18,
} as const;

export const TURRET_BARREL = {
  /** The barrel's travel (rad, nose up positive). */
  minPitch: -0.35,
  maxPitch: Math.PI / 4,
  /** Before the first shot, the barrel lies at the elevation of a shot this far out (yd). */
  restRange: 20,
  /** The recoil's full kick, in the head's own (model) units: about a sixth of the barrel. */
  recoilKick: 0.16,
} as const;

export const TURRET_GUNNER = {
  /** Yards from the tower's axis to the gunner's feet, right behind the breech. */
  behind: 1.7,
  /** The head fills the roof platform: the gunner stands on the parapet ring around it. */
  lift: FIRE_AND_FLY_TOWER.topY - FIRE_AND_FLY_TOWER.roofY,
} as const;

/** A hitch never swings the head further than a frame this long would. */
const MAX_STEP_DT = 0.1;
/** Nearer than this to the muzzle, a shot's reach is read as this (yd): no degenerate tangent. */
const MIN_SPAN = 0.05;
/** Each step shrinks the error about sixfold: six leave it far under a hundredth of a degree. */
const PITCH_STEPS = 6;

/**
 * The head's yaw one frame on: an ease toward `target` along the shorter way
 * around, never faster than TURRET_HEAD.maxTurnRate. A non-finite target holds.
 */
export function stepTurretHeadYaw(current: number, target: number, dt: number): number {
  if (!Number.isFinite(target) || !Number.isFinite(current)) {
    return Number.isFinite(current) ? current : Number.isFinite(target) ? target : 0;
  }
  const step = Math.min(MAX_STEP_DT, Math.max(0, dt));
  const gap = wrapAngle(target - current);
  const eased = Math.abs(gap) * (1 - Math.exp(-TURRET_HEAD.ease * step));
  const move = Math.min(eased, TURRET_HEAD.maxTurnRate * step);
  return wrapAngle(current + Math.sign(gap) * move);
}

/**
 * The barrel's elevation (rad) for a shot `range` yards out from the tower's
 * axis landing `rise` yards above the roof (negative: below it): the launch
 * tangent of the shell's arc from the muzzle this very elevation puts it at,
 * within the barrel's travel. The muzzle moves little with the elevation, so a
 * few fixed-point steps settle it.
 */
export function turretBarrelPitch(
  range: number,
  rise: number,
  scale: number = FIRE_AND_FLY_TOWER.scale,
): number {
  const { barrelPivot, barrelHalfLength } = TURRET_TOWER_MODEL;
  const pivotY = barrelPivot.y * scale;
  const pivotZ = barrelPivot.z * scale;
  const half = barrelHalfLength * scale;
  const reach = Number.isFinite(range) ? Math.max(0, range) : TURRET_BARREL.restRange;
  const drop = Number.isFinite(rise) ? rise : 0;
  let pitch = 0;
  for (let i = 0; i < PITCH_STEPS; i++) {
    const forward = pivotZ + half * Math.cos(pitch);
    const up = pivotY + half * Math.sin(pitch);
    pitch = cannonLaunchPitch(Math.max(MIN_SPAN, reach - forward), drop - up);
    pitch = Math.min(TURRET_BARREL.maxPitch, Math.max(TURRET_BARREL.minPitch, pitch));
  }
  return pitch;
}

/** The barrel's elevation before any shot: a shot at the rest range onto ground level with the tower's foot. */
export function turretRestPitch(scale: number = FIRE_AND_FLY_TOWER.scale): number {
  return turretBarrelPitch(TURRET_BARREL.restRange, -FIRE_AND_FLY_TOWER.roofY, scale);
}

/**
 * Where the gunner stands for a head yawed `yaw` (x += sin, z += cos): behind
 * the breech on the parapet ring of the tower at (`cx`, `cz`), whose roof
 * platform is at `roofY`.
 */
export function turretGunnerInto(
  out: { x: number; y: number; z: number },
  cx: number,
  cz: number,
  roofY: number,
  yaw: number,
): void {
  out.x = cx - Math.sin(yaw) * TURRET_GUNNER.behind;
  out.y = roofY + TURRET_GUNNER.lift;
  out.z = cz - Math.cos(yaw) * TURRET_GUNNER.behind;
}
