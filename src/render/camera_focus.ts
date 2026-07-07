// Camera focus: glide the chase camera to an authored framing (an in-world
// minigame surface: the sigil slab, the echo table, the rope lane) and hold
// it there until released. A pure blend helper the renderer owns: the chase
// path computes its candidate pose every frame exactly as before, and this
// mixes it toward the focus pose by an eased 0..1 blend, so both the glide in
// and the release back to the chase cam are smooth from whatever the camera
// was doing. While fully focused the chase candidate still computes (cheap)
// but is invisible; orbit input keeps writing camYaw/camPitch harmlessly.
//
// Poses are authored clear of geometry (over a slab inside the open venue), so
// bypassing camera collision during the hold is intentional and safe.

import type * as THREE from 'three';

export interface CameraFocusPose {
  pos: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
}

// Full glide duration, seconds (the blend eases with smoothstep on top).
const GLIDE_S = 0.8;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

export class CameraFocus {
  private pose: CameraFocusPose | null = null;
  private blend = 0;

  /** Set (or retarget) the focus pose; null releases back to the chase cam. */
  set(pose: CameraFocusPose | null): void {
    this.pose = pose;
  }

  /** True while the focus influences the camera (holding or still blending out). */
  active(): boolean {
    return this.pose !== null || this.blend > 0.0005;
  }

  /**
   * Mix the chase candidate toward the focus pose in place. Call once per
   * frame after the chase path has produced its position + lookAt.
   */
  apply(position: THREE.Vector3, lookAt: THREE.Vector3, dt: number): void {
    const dir = this.pose ? 1 : -1;
    this.blend = Math.min(1, Math.max(0, this.blend + (dir * dt) / GLIDE_S));
    if (this.blend <= 0) return;
    // Blending out with no pose left would have nothing to blend toward, so
    // the pose is retained until the blend drains.
    const p = this.pose ?? this.lastPose;
    if (!p) {
      this.blend = 0;
      return;
    }
    this.lastPose = p;
    const k = smoothstep(this.blend);
    position.set(
      position.x + (p.pos.x - position.x) * k,
      position.y + (p.pos.y - position.y) * k,
      position.z + (p.pos.z - position.z) * k,
    );
    lookAt.set(
      lookAt.x + (p.lookAt.x - lookAt.x) * k,
      lookAt.y + (p.lookAt.y - lookAt.y) * k,
      lookAt.z + (p.lookAt.z - lookAt.z) * k,
    );
  }

  private lastPose: CameraFocusPose | null = null;
}
