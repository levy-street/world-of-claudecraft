// Whether a character rig contributes to THIS frame, in each pass separately.
//
// Rigs used to be exempt from frustum culling on every shadow-casting tier:
// renderer.ts set its group-level cull only where the sun cast nothing, and
// every skinned caster kept `frustumCulled = false`. Both reasons were real:
// a SkinnedMesh's bind-pose bounding sphere does not follow the animated pose,
// and a rig standing behind the camera can still drop a shadow the camera
// sees. The consequence was that every rig inside the 80 yard draw band paid a
// colour draw AND a shadow draw every frame, behind the camera included, each
// one a full material and uniform setup plus its bone-texture upload.
//
// The fix is to answer the two passes with two different questions:
//
//   DRAWS  - the rig's own conservative sphere against the camera frustum.
//   CASTS  - the rig's shadow: it must sit inside the key light's ortho box
//            (nothing outside it can write a shadow texel, the same argument
//            foliage_shadow_core.ts makes for tree rows) AND the ground strip
//            it darkens must reach the camera's view volume. A rig behind the
//            camera at high noon shades the dirt under its own feet, which no
//            one can see; the same rig at a low sun throws a stripe forward
//            into the shot, and that one still casts.
//
// Neither answer is exact and neither needs to be: both are conservative in
// the same direction as the foliage row test. A true answer means "submit it",
// and only a geometrically impossible contribution is rejected.
//
// The renderer acts on the pair by HIDING the group when both bits are clear
// (three's projectObject stops at an invisible subtree, so a hidden group
// costs nothing in either pass). When only CASTS is set, the group stays
// visible and the per-mesh split is three's own: `skinned_cull_bounds.ts`
// gives each skinned caster `frustumCulled = true` plus a padded bounding
// sphere, and three then tests that sphere against the CAMERA frustum in
// projectObject and against the SHADOW CAMERA frustum in
// WebGLShadowMap.renderObject. That is the only per-pass separation three
// offers a non-instanced mesh (`material.visible` and `object.layers` are both
// read by both passes, and the instance-count trick of
// shadow_pass_gate_core.ts exists only for an InstancedMesh), and it is also
// what keeps a doubly-culled rig from flattening its palette: `objects.update`
// (which calls `Skeleton.update`, which re-arms the bone texture) is called
// INSIDE that guard in both passes. Pinned against three's own source by
// tests/character_cull_core.test.ts.
//
// Pure core contract: plain numbers and typed arrays only, no three import, no
// DOM, no clocks, no randomness. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts); tested by tests/character_cull_core.test.ts.

import { MOUNTS } from '../sim/content/mounts';
import { RUN_SPEED } from '../sim/types';
import {
  createShadowVolumeBasis,
  type ShadowVolumeBasis,
  type ShadowVolumeInput,
  setShadowVolumeBasis,
  shadowVolumeIntersectsBox,
} from './foliage_shadow_core';

/** The rig draws in the colour pass. */
export const CHARACTER_CULL_DRAWS = 1;
/** The rig can darken a texel the camera sees. */
export const CHARACTER_CULL_CASTS = 2;
/** Both bits: what an un-culled rig, and every rig under `?charcull=off`, gets. */
export const CHARACTER_CULL_ALL = CHARACTER_CULL_DRAWS | CHARACTER_CULL_CASTS;

/** The best mount's additive move-speed fraction, read off the content table. */
const MAX_MOUNT_SPEED_PCT = Object.values(MOUNTS).reduce(
  (best, mount) => (mount.moveSpeedPct > best ? mount.moveSpeedPct : best),
  0,
);
/**
 * Sustained travel speed on the best mount, yards/second. It is not an upper
 * bound on displacement: `moveSpeedMult` adds speed buffs and travel forms on
 * top, and a charge or a blink beats any speed-derived number outright. Those
 * are covered by the drift term beside it and, for a real teleport, by the
 * arrival cover, never by this margin.
 */
const MAX_RIG_SPEED = RUN_SPEED * (1 + MAX_MOUNT_SPEED_PCT);
/**
 * The cull reads LAST frame's camera and key light (both are repositioned
 * after the entity loop), so a rig may have moved for one whole frame since.
 * 20 fps is the floor a loaded client sinks to before render_budget.ts sheds,
 * so it is the longest frame the margin has to cover.
 */
const CULL_LAG_SECONDS = 1 / 20;
/**
 * Animation drift: `characterCullRadius` describes a standing silhouette, and
 * a two-handed swing or a jump's tuck reaches past it. One yard covers every
 * shipped clip on the tallest rig.
 */
const CULL_ANIM_DRIFT = 1;
/**
 * Slack added to every rig sphere, in yards: animation drift plus one frame of
 * movement at mounted speed.
 */
export const CHARACTER_CULL_MARGIN = CULL_ANIM_DRIFT + MAX_RIG_SPEED * CULL_LAG_SECONDS;

/**
 * How far the ground downsun of a rig may fall below its own feet before the
 * sweep stops following it. A rig's shadow lands on terrain, and terrain a
 * shadow's length away is not arbitrarily lower; twelve yards covers the
 * steepest slope a body stands on inside one shadow box.
 */
const SHADOW_GROUND_DROP = 12;

/** Camera planes, packed nx, ny, nz, constant, six of them. */
const PLANE_COUNT = 6;
const PLANE_STRIDE = 4;

/** Column-major view-projection scratch, so the once-per-frame push allocates nothing. */
const viewProjScratch = new Float64Array(16);

/**
 * Live per-frame inputs of the cull, reused frame to frame: every setter below
 * writes in place so the per-rig path allocates nothing.
 */
export interface CharacterCullPass {
  readonly planes: Float64Array;
  /** False means "no camera pushed": every rig then draws. */
  cameraLive: boolean;
  /** Camera world position, the origin the turn slack below is measured from. */
  camX: number;
  camY: number;
  camZ: number;
  /** Camera forward at the previous push, for that same measurement. */
  fwdX: number;
  fwdY: number;
  fwdZ: number;
  /**
   * Radians the camera turned between the previous push and this one. The cull
   * reads LAST frame's camera, so a rig one frame outside the view can already
   * be inside it, by an angle nothing about the RIG bounds: a mouse flick moves
   * the frustum far faster than a mounted sprint moves a body. The slack is the
   * turn actually measured rather than a tuned worst case, so a still camera
   * pays nothing and a flick culls nothing.
   */
  turnRad: number;
  /** False means the key light casts nothing, so no rig can be shadow-only. */
  shadowsLive: boolean;
  readonly volume: ShadowVolumeBasis;
  /** Unit vector from a caster TOWARD the light. */
  lightX: number;
  lightY: number;
  lightZ: number;
  /** Widest the shadow sweep may run, from the ortho box's own width. */
  sweepCap: number;
  /**
   * Band, squared, inside which a rig submits ANY shadow caster at all: the
   * renderer's own outer shadow bound (the articulated band plus the static
   * proxy band past it). A rig further out has `castShadow` false on every
   * mesh it owns, so its shadow can never be the reason to keep it in scene.
   */
  castRangeSq: number;
}

export function createCharacterCullPass(): CharacterCullPass {
  return {
    planes: new Float64Array(PLANE_COUNT * PLANE_STRIDE),
    cameraLive: false,
    camX: 0,
    camY: 0,
    camZ: 0,
    fwdX: 0,
    fwdY: 0,
    fwdZ: -1,
    turnRad: 0,
    shadowsLive: false,
    volume: createShadowVolumeBasis(),
    lightX: 0,
    lightY: 1,
    lightZ: 0,
    sweepCap: 0,
    castRangeSq: 0,
  };
}

/** The frame's camera: its two matrices plus the world position of the eye. */
export interface CullCameraInput {
  readonly projectionMatrix: { readonly elements: ArrayLike<number> };
  readonly matrixWorldInverse: { readonly elements: ArrayLike<number> };
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * The key light, read structurally so this core never imports three. Direction
 * and distance come from the light's OWN position and target rather than from
 * a separately pushed vector, so the sweep and three's shadow camera cannot
 * disagree about where the sun is.
 */
export interface CullLightInput {
  readonly castShadow: boolean;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: {
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
  };
  readonly shadow: {
    readonly camera: { readonly top: number; readonly near: number; readonly far: number };
  };
}

function setPlane(
  planes: Float64Array,
  index: number,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const len = Math.hypot(x, y, z);
  const inv = len > 0 ? 1 / len : 0;
  const at = index * PLANE_STRIDE;
  planes[at] = x * inv;
  planes[at + 1] = y * inv;
  planes[at + 2] = z * inv;
  planes[at + 3] = w * inv;
}

/**
 * Extract the six camera frustum planes from projection * viewInverse, the
 * same six three's `Frustum.setFromProjectionMatrix` builds for the WebGL
 * coordinate system (the multiply is done here so the renderer keeps no
 * scratch matrix of its own). Elements are column-major, as three stores them.
 */
export function setCharacterCullCamera(pass: CharacterCullPass, camera: CullCameraInput): void {
  const p = camera.projectionMatrix.elements;
  const v = camera.matrixWorldInverse.elements;
  const m = viewProjScratch;
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      m[col * 4 + row] =
        p[row] * v[col * 4] +
        p[4 + row] * v[col * 4 + 1] +
        p[8 + row] * v[col * 4 + 2] +
        p[12 + row] * v[col * 4 + 3];
    }
  }
  setPlane(pass.planes, 0, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  setPlane(pass.planes, 1, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  setPlane(pass.planes, 2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  setPlane(pass.planes, 3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  setPlane(pass.planes, 4, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  setPlane(pass.planes, 5, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  // The view matrix is the camera's inverse, so its third ROW is the camera's
  // own z axis and the eye looks down the negative of it.
  const fx = -v[2];
  const fy = -v[6];
  const fz = -v[10];
  const chord = pass.cameraLive ? Math.hypot(fx - pass.fwdX, fy - pass.fwdY, fz - pass.fwdZ) : 0;
  pass.turnRad = 2 * Math.asin(Math.min(1, chord * 0.5));
  pass.fwdX = fx;
  pass.fwdY = fy;
  pass.fwdZ = fz;
  pass.camX = camera.position.x;
  pass.camY = camera.position.y;
  pass.camZ = camera.position.z;
  pass.cameraLive = true;
}

/** Resolve the key light into the sweep direction and the ortho box test. */
export function setCharacterCullShadow(
  pass: CharacterCullPass,
  light: CullLightInput,
  castRangeSq: number,
): void {
  pass.castRangeSq = castRangeSq;
  const dx = light.position.x - light.target.position.x;
  const dy = light.position.y - light.target.position.y;
  const dz = light.position.z - light.target.position.z;
  const distance = Math.hypot(dx, dy, dz);
  pass.shadowsLive = light.castShadow && distance > 0;
  if (!pass.shadowsLive) {
    setShadowVolumeBasis(pass.volume, null);
    return;
  }
  pass.lightX = dx / distance;
  pass.lightY = dy / distance;
  pass.lightZ = dz / distance;
  pass.sweepCap = 2 * light.shadow.camera.top;
  const volume: ShadowVolumeInput = {
    dirX: pass.lightX,
    dirY: pass.lightY,
    dirZ: pass.lightZ,
    targetX: light.target.position.x,
    targetY: light.target.position.y,
    targetZ: light.target.position.z,
    halfExtent: light.shadow.camera.top,
    lightDistance: distance,
    near: light.shadow.camera.near,
    far: light.shadow.camera.far,
  };
  setShadowVolumeBasis(pass.volume, volume);
}

/** The conservative world-space radius of a standing rig, before the margin. */
export function characterRigRadius(height: number, scale: number): number {
  return (height * 0.7 + 1.5) * scale;
}

/**
 * The sphere the colour cull tests: the standing silhouette plus the margin,
 * never smaller than `floor` (the Paladin aegis dome is drawn from the rig and
 * reaches well past the body).
 */
export function characterCullRadius(height: number, scale: number, floor: number): number {
  const r = characterRigRadius(height, scale) + CHARACTER_CULL_MARGIN;
  return r > floor ? r : floor;
}

/**
 * The local-space radius a skinned caster's bounding sphere is padded to, so
 * three's own per-pass tests can never reject a rig that is really on screen.
 *
 * The sphere keeps the bind-pose geometry CENTRE, which is some point inside
 * the rig, so it is at most one rig radius away from the rig's centre: twice
 * the rig radius from that point therefore contains the whole animated body,
 * whatever the pose. `worldScale` is the accumulated scale from the mesh's own
 * object space up to the visual root; the group's live entity scale rides
 * matrixWorld outside it, so the world sphere follows a resized rig for free.
 */
export function skinnedCullSphereRadius(height: number, worldScale: number): number {
  if (!(worldScale > 0)) return Number.POSITIVE_INFINITY;
  return (2 * characterRigRadius(height, 1) + CHARACTER_CULL_MARGIN) / worldScale;
}

function frustumTouchesSphere(
  planes: Float64Array,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): boolean {
  for (let i = 0; i < PLANE_COUNT; i++) {
    const at = i * PLANE_STRIDE;
    const d = planes[at] * cx + planes[at + 1] * cy + planes[at + 2] * cz + planes[at + 3];
    if (d < -radius) return false;
  }
  return true;
}

function frustumTouchesBox(
  planes: Float64Array,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
): boolean {
  for (let i = 0; i < PLANE_COUNT; i++) {
    const at = i * PLANE_STRIDE;
    const nx = planes[at];
    const ny = planes[at + 1];
    const nz = planes[at + 2];
    const reach = Math.abs(nx) * hx + Math.abs(ny) * hy + Math.abs(nz) * hz;
    if (nx * cx + ny * cy + nz * cz + planes[at + 3] < -reach) return false;
  }
  return true;
}

/**
 * Which passes this rig contributes to, as a CHARACTER_CULL_* bitmask.
 *
 * `feetY` is the ground the rig stands on, which is where the near end of its
 * own shadow sits; the sweep runs downsun from the body until it has dropped
 * past that ground (plus the slope allowance), and the swept box is then
 * tested against the camera. The body's own box carries the ortho-volume test,
 * because a rig outside the box writes no texel wherever its stripe would land.
 *
 * `playerDistSq` is the rig's own squared distance from the player, which is
 * what the renderer's shadow bands are measured on: past the outer band it has
 * no shadow caster switched on, so the whole sweep question is moot.
 */
export function characterCullBits(
  pass: CharacterCullPass,
  x: number,
  feetY: number,
  z: number,
  height: number,
  scale: number,
  minR: number,
  playerDistSq: number,
): number {
  if (!pass.cameraLive) return CHARACTER_CULL_ALL;
  const cy = feetY + height * 0.5 * scale;
  const eye = Math.hypot(x - pass.camX, cy - pass.camY, z - pass.camZ);
  const radius = characterCullRadius(height, scale, minR) + pass.turnRad * eye;
  let bits = frustumTouchesSphere(pass.planes, x, cy, z, radius) ? CHARACTER_CULL_DRAWS : 0;
  if (!pass.shadowsLive || !(playerDistSq < pass.castRangeSq)) return bits;
  if (!shadowVolumeIntersectsBox(pass.volume, x, cy, z, radius, radius, radius)) return bits;
  const drop = cy + radius - feetY + SHADOW_GROUND_DROP;
  // A light at the horizon casts an arbitrarily long stripe, but only the part
  // inside the ortho box exists, so the box's own width is the only bound the
  // sweep needs (and the one that keeps a grazing sun from dividing by zero).
  const sweep = pass.lightY > 0 ? Math.min(drop / pass.lightY, pass.sweepCap) : pass.sweepCap;
  const ex = x - pass.lightX * sweep;
  const ey = cy - pass.lightY * sweep;
  const ez = z - pass.lightZ * sweep;
  const hx = Math.abs(ex - x) * 0.5 + radius;
  const hy = Math.abs(ey - cy) * 0.5 + radius;
  const hz = Math.abs(ez - z) * 0.5 + radius;
  if (frustumTouchesBox(pass.planes, (x + ex) * 0.5, (cy + ey) * 0.5, (z + ez) * 0.5, hx, hy, hz)) {
    bits |= CHARACTER_CULL_CASTS;
  }
  return bits;
}
