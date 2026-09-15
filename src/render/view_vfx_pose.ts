import type * as THREE from 'three';
import type { VfxAnchorPose, VfxAnchorPoseFill } from './vfx_anchor';
import { fillViewGroundPose, liftPoseByLocalOffset } from './view_vfx_pose_core';

// The renderer's VfxAnchorPoseFill: the thin Three binding over
// view_vfx_pose_core.ts (which owns the math), reading the live view map and
// entity lookup. Extracted from renderer.ts so the rider lift has a
// host-agnostic home a Vitest drives directly.

/** The slice of an entity view this fill reads. */
export interface VfxPoseView {
  group: THREE.Object3D;
  /** Rig height in world units before the entity scale. */
  height: number;
  /** The body-attached aura anchor (rider_anchor.ts), a child of `group`. */
  riderAnchor: THREE.Object3D;
}

/**
 * Build the fill over the renderer's live view map and entity lookup. Writes
 * into the caller's pose and allocates nothing per call (the anchor contract).
 */
export function createViewVfxPoseFill(
  views: { get(id: number): VfxPoseView | undefined },
  entities: { get(id: number): { scale: number } | undefined },
): VfxAnchorPoseFill {
  return (id: number, pose: VfxAnchorPose): boolean => {
    const v = views.get(id);
    if (!v) return false;
    fillViewGroundPose(
      pose,
      v.group.position,
      v.group.rotation.y,
      v.height,
      entities.get(id)?.scale ?? 1,
    );
    liftPoseByLocalOffset(pose, v.riderAnchor.position);
    return true;
  };
}
