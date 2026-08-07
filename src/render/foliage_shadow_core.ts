// Which foliage shadow casters can still reach the key light's shadow map.
//
// The sun (and the moon it hands off to) renders ONE orthographic shadow map,
// aimed at the player, 2 * halfExtent yards across (renderer.ts sizes it: 105
// outdoors, so a 210 yard box) and near..far deep along the light axis.
// Geometry outside that box cannot darken a single texel, however close to the
// camera it stands, and geometry inside it casts at full shadow-map resolution
// however far away it is. Distance from the CAMERA, which is what the foliage
// bucket cull measures, is the wrong axis for this row.
//
// The shadow-only clones were culled on a camera-radial window measured from
// the bucket's NEAR EDGE. A foliage bucket is a ~500x240 yard slab with a ~290
// yard bounding radius, so the near-edge probe kept every slab whose centre sat
// within cap + 290 yards: six of them in town, ~670k submitted triangles, when
// the shadow box can only ever hold part of one or two. This module replaces
// that with the two tests that are actually true:
//
//   1. a row-level box test against the real light volume (plus a rectangle
//      distance against the caller's radial cap, which is the honest "how far
//      is this row's NEAREST tree" the near-edge probe was reaching for), and
//   2. a per-INSTANCE box test that packs the survivors to the front of the
//      instance buffer, so a kept row submits only the trees that can cast.
//
// Both are conservative in one direction only: a true result means "submit it",
// and only a geometrically impossible contribution is rejected. When the caller
// has no live volume (shadows off, the light within a few degrees of vertical,
// a renderer that never pushed one) every test falls back to the radial rule,
// so a missing volume can never delete a shadow.
//
// Pure core contract: plain numbers and typed arrays only, no three import, no
// DOM, no clocks, no randomness. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts); tested by tests/foliage_shadow_core.test.ts.

/** Live description of the key light's orthographic shadow volume. */
export interface ShadowVolumeInput {
  /** Unit vector from the shadow target TOWARD the light. */
  readonly dirX: number;
  readonly dirY: number;
  readonly dirZ: number;
  /** World point the shadow camera is aimed at (the player). */
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
  /** Orthographic half width and half height, world units. */
  readonly halfExtent: number;
  /** Distance from the target to the light position. */
  readonly lightDistance: number;
  /** Shadow camera near/far planes, measured from the light. */
  readonly near: number;
  readonly far: number;
}

/**
 * The volume resolved into the light-space basis the box tests project onto.
 * Reused frame to frame: `setShadowVolumeBasis` writes in place so the per-frame
 * path allocates nothing.
 */
export interface ShadowVolumeBasis {
  /** False means "no usable volume": every test then answers conservatively. */
  valid: boolean;
  rightX: number;
  rightY: number;
  rightZ: number;
  upX: number;
  upY: number;
  upZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  halfExtent: number;
  /** Allowed range of (point - target) . dir, from the near/far planes. */
  depthMin: number;
  depthMax: number;
}

/**
 * Slack added to every caster box, in yards. It covers the PCF kernel's filter
 * footprint, the gap between the sim player position this module is fed and the
 * interpolated render position the shadow camera actually targets, and a frame
 * of player movement (the volume is pushed once per frame, so a test can be one
 * frame stale).
 */
export const SHADOW_CASTER_MARGIN = 4;

/**
 * Below this the light is within ~3 degrees of straight up and the light-space
 * right axis (up x dir) collapses: three's lookAt perturbs its own basis there,
 * so ours would no longer describe the same box. The volume is marked invalid
 * instead and callers keep everything the radial rule allows.
 */
const MIN_HORIZONTAL_DIR = 0.05;

export function createShadowVolumeBasis(): ShadowVolumeBasis {
  return {
    valid: false,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    upX: 0,
    upY: 1,
    upZ: 0,
    dirX: 0,
    dirY: 1,
    dirZ: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    halfExtent: 0,
    depthMin: 0,
    depthMax: 0,
  };
}

/**
 * Resolve a live volume into `out`, mirroring how three builds the shadow
 * camera's own basis: the camera sits at target + dir * lightDistance and looks
 * back down -dir with world up, so right = normalize(up x dir) and
 * up' = dir x right.
 */
export function setShadowVolumeBasis(
  out: ShadowVolumeBasis,
  v: ShadowVolumeInput | null,
): ShadowVolumeBasis {
  out.valid = false;
  if (v === null) return out;
  const horizontal = Math.hypot(v.dirX, v.dirZ);
  if (!(horizontal >= MIN_HORIZONTAL_DIR)) return out;
  if (!(v.halfExtent > 0) || !(v.far > v.near)) return out;
  const len = Math.hypot(v.dirX, v.dirY, v.dirZ);
  if (!(len > 0)) return out;
  const dx = v.dirX / len;
  const dy = v.dirY / len;
  const dz = v.dirZ / len;
  // right = up x dir with up = (0, 1, 0), which is (dir.z, 0, -dir.x).
  const rl = Math.hypot(dz, dx);
  out.rightX = dz / rl;
  out.rightY = 0;
  out.rightZ = -dx / rl;
  // up' = dir x right
  out.upX = dy * out.rightZ - dz * out.rightY;
  out.upY = dz * out.rightX - dx * out.rightZ;
  out.upZ = dx * out.rightY - dy * out.rightX;
  out.dirX = dx;
  out.dirY = dy;
  out.dirZ = dz;
  out.targetX = v.targetX;
  out.targetY = v.targetY;
  out.targetZ = v.targetZ;
  out.halfExtent = v.halfExtent;
  out.depthMin = v.lightDistance - v.far;
  out.depthMax = v.lightDistance - v.near;
  out.valid = true;
  return out;
}

/**
 * Does an axis-aligned world box overlap the shadow volume?
 *
 * Projects the box onto each of the volume's three axes (the standard slab
 * test). It can retain a box that only clips the volume's corner, but it never
 * rejects one that overlaps.
 */
export function shadowVolumeIntersectsBox(
  b: ShadowVolumeBasis,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
): boolean {
  if (!b.valid) return true;
  const ox = cx - b.targetX;
  const oy = cy - b.targetY;
  const oz = cz - b.targetZ;
  const right = ox * b.rightX + oy * b.rightY + oz * b.rightZ;
  const rightSpan = Math.abs(b.rightX) * hx + Math.abs(b.rightY) * hy + Math.abs(b.rightZ) * hz;
  if (Math.abs(right) > b.halfExtent + rightSpan) return false;
  const up = ox * b.upX + oy * b.upY + oz * b.upZ;
  const upSpan = Math.abs(b.upX) * hx + Math.abs(b.upY) * hy + Math.abs(b.upZ) * hz;
  if (Math.abs(up) > b.halfExtent + upSpan) return false;
  const depth = ox * b.dirX + oy * b.dirY + oz * b.dirZ;
  const depthSpan = Math.abs(b.dirX) * hx + Math.abs(b.dirY) * hy + Math.abs(b.dirZ) * hz;
  return depth + depthSpan >= b.depthMin && depth - depthSpan <= b.depthMax;
}

/**
 * Horizontal distance from a point to a box: 0 while the point is inside the
 * footprint. This is what the shadow rows measure their radial cap against.
 * The bucket bounding SPHERE was the old probe and it is ~290 yards on a
 * 500x240 slab, so "centre minus radius" reported a slab as 290 yards nearer
 * than its nearest tree in every direction at once.
 */
export function boxDistanceXZ(
  x: number,
  z: number,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
): number {
  const dx = Math.max(Math.abs(x - cx) - hx, 0);
  const dz = Math.max(Math.abs(z - cz) - hz, 0);
  return Math.hypot(dx, dz);
}

/** One shadow row's world bounds (the union of its caster instances). */
export interface ShadowRowBounds {
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;
}

/**
 * Row-level decision: keep this shadow mesh in the scene at all?
 *
 * `maxDist` is the caller's radial cap already resolved against everything that
 * is not the light (the build-time shadow radius times the budget scale, the
 * runtime tree-detail swap, the fog cull), measured from the camera to the row's
 * footprint. The volume test then removes rows the shadow map cannot see.
 */
export function shadowRowVisible(
  bounds: ShadowRowBounds,
  camX: number,
  camZ: number,
  maxDist: number,
  basis: ShadowVolumeBasis,
): boolean {
  const dist = boxDistanceXZ(
    camX,
    camZ,
    bounds.centerX,
    bounds.centerZ,
    bounds.halfX,
    bounds.halfZ,
  );
  if (!(dist < maxDist)) return false;
  return shadowVolumeIntersectsBox(
    basis,
    bounds.centerX,
    bounds.centerY,
    bounds.centerZ,
    bounds.halfX,
    bounds.halfY,
    bounds.halfZ,
  );
}

/** Floats per caster in the `boxes` array: centre xyz then half extents xyz. */
export const SHADOW_BOX_STRIDE = 6;
/** Floats per instance matrix. */
const MATRIX_STRIDE = 16;

/**
 * Where a caster's own collapse is measured from, and the line it dies on.
 * Mutable and reused frame to frame, like ShadowVolumeBasis.
 */
export interface CollapseProbe {
  /** Camera position, which is what the collapse shader measures against. */
  camX: number;
  camZ: number;
  /**
   * The collapse window's far edge (foliage.ts `shadowFar`: the sprite swap or
   * the fog cull, whichever bites first), ALREADY widened by the caller's
   * slack. Pass Infinity to skip the test.
   */
  collapseFar: number;
}

export function createCollapseProbe(): CollapseProbe {
  return { camX: 0, camZ: 0, collapseFar: Number.POSITIVE_INFINITY };
}

/**
 * Copy the instance matrices of every caster that can still cast to the FRONT
 * of `target`, and return how many there are. The caller then draws
 * [0, packed) instances, which is the only per-instance cull three's shadow
 * pass offers: the per-instance collapse the colour materials use patches
 * onBeforeCompile, and three builds the depth pass from its own material.
 *
 * TWO reasons to drop a caster, and they catch different trees:
 *
 *  1. Outside the shadow volume: it cannot write a texel.
 *  2. Past its own collapse window: foliage_collapse.ts has already sent this
 *     instance's real geometry off-clip and its sprite stands in, and a sprite
 *     mesh does not cast (foliage_impostor.ts sets castShadow false). A caster
 *     for a tree that is not drawn is pure waste, and worse, a shadow with no
 *     visible tree over it. The two tests overlap at a high sun, where the
 *     volume reaches ~160 yards and the swap sits at ~234. They come apart at
 *     dawn and dusk: the volume tilts flat and reaches its far plane, ~360
 *     yards downsun, where every tree is already a billboard.
 *
 * The collapse test mirrors the shader's exactly: distance from the CAMERA to
 * the instance ORIGIN. Jitter only ever pulls an instance's own swap NEARER
 * (`collapseEnd = uCollapseMax - uCollapseFade * jitter`), so the window's far
 * edge is the last distance at which any real geometry survives, and testing
 * against it can never drop a caster whose tree is still drawn.
 *
 * With no usable volume this copies the whole source and returns `count`, so a
 * caller that has never been pushed a volume behaves exactly as before.
 */
export function packShadowCasters(
  basis: ShadowVolumeBasis,
  boxes: Float32Array,
  count: number,
  source: Float32Array,
  target: Float32Array,
  collapse: CollapseProbe,
): number {
  if (!basis.valid) {
    target.set(source.subarray(0, count * MATRIX_STRIDE));
    return count;
  }
  const farSq = collapse.collapseFar * collapse.collapseFar;
  let packed = 0;
  for (let i = 0; i < count; i++) {
    const b = i * SHADOW_BOX_STRIDE;
    const dx = boxes[b] - collapse.camX;
    const dz = boxes[b + 2] - collapse.camZ;
    if (dx * dx + dz * dz >= farSq) continue;
    if (
      !shadowVolumeIntersectsBox(
        basis,
        boxes[b],
        boxes[b + 1],
        boxes[b + 2],
        boxes[b + 3],
        boxes[b + 4],
        boxes[b + 5],
      )
    ) {
      continue;
    }
    const src = i * MATRIX_STRIDE;
    const dst = packed * MATRIX_STRIDE;
    for (let k = 0; k < MATRIX_STRIDE; k++) target[dst + k] = source[src + k];
    packed++;
  }
  return packed;
}

/**
 * How far the inputs may drift before a repack is due. Well inside
 * SHADOW_CASTER_MARGIN, so a pack held over from an earlier frame is always
 * still a superset of what the current frame needs.
 */
export const SHADOW_REPACK_MOVE = 0.5;

/**
 * Has the volume moved enough to be worth repacking? The town-idle case (and
 * any stationary player) then skips the pack and its buffer upload entirely.
 */
export function shadowVolumeMoved(a: ShadowVolumeBasis, b: ShadowVolumeBasis): boolean {
  if (a.valid !== b.valid) return true;
  if (!a.valid) return false;
  if (a.halfExtent !== b.halfExtent || a.depthMin !== b.depthMin || a.depthMax !== b.depthMax) {
    return true;
  }
  const moved =
    Math.abs(a.targetX - b.targetX) +
    Math.abs(a.targetY - b.targetY) +
    Math.abs(a.targetZ - b.targetZ);
  if (moved > SHADOW_REPACK_MOVE) return true;
  const turned = Math.abs(a.dirX - b.dirX) + Math.abs(a.dirY - b.dirY) + Math.abs(a.dirZ - b.dirZ);
  return turned > 0.002;
}

/**
 * The collapse half of the same question, and it needs asking separately: the
 * collapse is measured from the CAMERA while the volume is centred on the
 * PLAYER, so orbiting a stationary character moves one and not the other.
 */
export function collapseProbeMoved(a: CollapseProbe, b: CollapseProbe): boolean {
  if (Math.abs(a.collapseFar - b.collapseFar) > SHADOW_REPACK_MOVE) return true;
  return Math.abs(a.camX - b.camX) + Math.abs(a.camZ - b.camZ) > SHADOW_REPACK_MOVE;
}

/** Copy `from` into `to` so the caller can compare next frame's probe to it. */
export function copyCollapseProbe(to: CollapseProbe, from: CollapseProbe): void {
  to.camX = from.camX;
  to.camZ = from.camZ;
  to.collapseFar = from.collapseFar;
}

/** Copy `from` into `to` so the caller can compare next frame's volume to it. */
export function copyShadowVolumeBasis(to: ShadowVolumeBasis, from: ShadowVolumeBasis): void {
  to.valid = from.valid;
  to.rightX = from.rightX;
  to.rightY = from.rightY;
  to.rightZ = from.rightZ;
  to.upX = from.upX;
  to.upY = from.upY;
  to.upZ = from.upZ;
  to.dirX = from.dirX;
  to.dirY = from.dirY;
  to.dirZ = from.dirZ;
  to.targetX = from.targetX;
  to.targetY = from.targetY;
  to.targetZ = from.targetZ;
  to.halfExtent = from.halfExtent;
  to.depthMin = from.depthMin;
  to.depthMax = from.depthMax;
}

/**
 * Shadow-pass-only gate whose instance count is decided per frame.
 *
 * Same trick as shadow_pass_gate_core.ts (three's instanced draw path skips the
 * GL call when count is 0, so a colorWrite-off clone costs nothing in the colour
 * pass), except the restored count is read live from the row rather than frozen
 * at attach time, because the pack above changes it every time the player moves.
 */
export interface ShadowPassCountSource {
  /** Instances currently packed at the front of the buffer. */
  readonly drawCount: number;
}

export interface PackedShadowGatedMesh {
  count: number;
  onBeforeShadow: unknown;
  onAfterShadow: unknown;
  /** The full instance count, for cost telemetry. */
  shadowPassFullCount?: number;
}

/**
 * CALLER CONTRACT, inherited from shadow_pass_gate_core.ts: compute the mesh's
 * bounding volumes BEFORE attaching, while the count is still full. three
 * computes an InstancedMesh's bounding sphere lazily from the CURRENT count
 * exactly once, and an empty sphere culls the mesh (and its shadow) forever.
 * The sphere must stay the FULL-count one afterwards: packing only reorders
 * which instances draw, so the full sphere remains the conservative bound.
 */
export function attachPackedShadowGate(
  mesh: PackedShadowGatedMesh,
  source: ShadowPassCountSource,
): void {
  mesh.shadowPassFullCount = mesh.count;
  mesh.onBeforeShadow = () => {
    mesh.count = source.drawCount;
  };
  mesh.onAfterShadow = () => {
    mesh.count = 0;
  };
  mesh.count = 0;
}
