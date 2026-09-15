import type { VfxAnchorPose } from './vfx_anchor';

// The pure half of the renderer's VfxAnchorPoseFill (view_vfx_pose.ts binds
// it to the live view map): the displayed pose of an entity view that every
// pooled ability VFX (absorb shells, orbit halos, ribbons, impacts) resolves
// its world anchor from. Three-free so tests/architecture.test.ts sweeps it
// as a RENDER_PURE_CORES member and tests/view_vfx_pose.test.ts drives it
// with plain numbers.
//
// The pose is the view group's world position lifted by the rider anchor
// (rider_anchor.ts): while mounted the body sits a saddle above the group
// origin, and a shell resolved at the group would wrap the horse's belly.
// The anchor's local offset is expressed in the group's frame, so it rotates
// with the displayed yaw and stretches with the entity scale the group carries.

/** A local-frame offset (the rider anchor's position in the view group). */
export interface LocalOffset {
  x: number;
  y: number;
  z: number;
}

/** Fill `pose` with a view group's world position, yaw, and scale (no rider lift). */
export function fillViewGroundPose(
  pose: VfxAnchorPose,
  groupPosition: LocalOffset,
  groupYaw: number,
  rigHeight: number,
  entityScale: number,
): void {
  pose.x = groupPosition.x;
  pose.y = groupPosition.y;
  pose.z = groupPosition.z;
  pose.height = rigHeight * entityScale;
  // For local-offset resolves (the drain beams' familiar-side end): the
  // DISPLAYED yaw, so the offset tracks the body actually on screen.
  pose.yaw = groupYaw;
  pose.scale = entityScale;
}

/**
 * Lift `pose` by a group-local offset (the rider anchor's position): rotated by
 * the pose's displayed yaw and stretched by its scale, the same frame the
 * group applies to its children. A zero offset (dismounted) leaves it untouched.
 */
export function liftPoseByLocalOffset(pose: VfxAnchorPose, local: LocalOffset): void {
  if (local.x === 0 && local.y === 0 && local.z === 0) return;
  const yaw = pose.yaw ?? 0;
  const scale = pose.scale ?? 1;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // THREE's Y rotation: x' = x cos + z sin, z' = -x sin + z cos.
  pose.x += (local.x * cos + local.z * sin) * scale;
  pose.y += local.y * scale;
  pose.z += (-local.x * sin + local.z * cos) * scale;
}
