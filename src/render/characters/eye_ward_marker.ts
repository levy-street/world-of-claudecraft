// The aim reticle on a warded boss's eye: the Three half.
//
// Read `../eye_ward_marker_core.ts` first, it owns the state ladder and says why the state
// is taken off the boss's own auras. This file is meshes only.
//
// It hangs on the same head bone and the same MEASURED offset the eye glow uses
// (`VisualDef.eyeGlow`), which is the whole reason it can be a reticle at all: the target it
// is pointing at is that exact glow, so sharing one offset means the ring and the thing it
// rings can never drift apart across a clip, a turn, or an animation frame.
import * as THREE from 'three';
import {
  EYE_WARD_BURST_SECONDS,
  type EyeWardMarkerPlan,
  eyeWardBurstAt,
  eyeWardMarkerAlpha,
} from '../eye_ward_marker_core';
import type { EyeGlowSpec } from './eye_glow_core';

/** Ring thickness as a fraction of its own radius. Thin: this frames the eye, it is not a lens. */
const TUBE_RATIO = 0.16;

/**
 * The reticle, plus the burst a landed thrust fires.
 *
 * Both rings are built once at construction and then only re-stated, because the plan can
 * change on any tick (a seal lifting, a wielder stepping into reach) and rebuilding geometry
 * on a state change would allocate inside the fight.
 */
export class EyeWardMarker {
  private ring: THREE.Mesh | null = null;
  private burst: THREE.Mesh | null = null;
  private clock = 0;
  private burstAge = EYE_WARD_BURST_SECONDS;
  private baseRadius = 0;

  constructor(spec: EyeGlowSpec, bone: THREE.Object3D | null) {
    if (!bone) return;
    // Sized off the eye's own radius rather than a constant: the spec is bone-local and the
    // rig's scale chain sits between it and world units, so anything absolute here is wrong
    // by that whole factor on any creature but the one it was tuned against.
    this.baseRadius = spec.radius;
    this.ring = this.build(spec, 0.5);
    this.burst = this.build(spec, 0);
    for (const mesh of [this.ring, this.burst]) bone.add(mesh);
  }

  usable(): boolean {
    return this.ring !== null;
  }

  /** Fire the landed-thrust burst. Restarts a burst already in flight rather than queueing. */
  strike(): void {
    this.burstAge = 0;
  }

  /**
   * One frame. A null plan hides the reticle without disposing it: the wielder sheathing the
   * pike for a moment must not cost a rebuild, and the boss keeps his ward either way.
   */
  update(plan: EyeWardMarkerPlan | null, dt: number, reducedMotion = false): void {
    if (!this.ring || !this.burst) return;
    this.clock += dt;
    this.burstAge += dt;

    this.ring.visible = plan !== null;
    if (plan) {
      const mat = this.ring.material as THREE.MeshBasicMaterial;
      mat.color.setHex(plan.color);
      mat.opacity = eyeWardMarkerAlpha(plan, this.clock, reducedMotion);
      this.ring.scale.setScalar(plan.radiusScale);
      // Face the same way the head does. A torus lying in the bone's XY plane reads as a
      // ring around the eye from the front, which is the only angle the mechanic is
      // performed from (you have to be in front of him to reach his face with a pike).
      this.ring.rotation.set(0, 0, this.clock * (reducedMotion ? 0 : 0.6));
    }

    const b = eyeWardBurstAt(this.burstAge);
    this.burst.visible = b !== null;
    if (b) {
      const mat = this.burst.material as THREE.MeshBasicMaterial;
      mat.opacity = b.alpha;
      this.burst.scale.setScalar(b.radiusScale);
    }
  }

  private build(spec: EyeGlowSpec, opacity: number): THREE.Mesh {
    const geo = new THREE.TorusGeometry(this.baseRadius, this.baseRadius * TUBE_RATIO, 8, 28);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x76e0d8,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
    mesh.renderOrder = 7;
    mesh.visible = false;
    mesh.frustumCulled = false;
    return mesh;
  }

  dispose(): void {
    for (const mesh of [this.ring, this.burst]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.ring = null;
    this.burst = null;
  }
}
