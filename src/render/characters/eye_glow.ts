// A creature's eye, permanently lit.
//
// Balgath's whole identity is the Loomshard burning in his socket: it is what the fight is
// named for, what his scry channel is, and the colour every one of his telegraphs borrows.
// A boss whose one eye only lights up while he happens to be casting reads as a statue
// between mechanics, and at raid distance the eye is the ONLY part of a grey stone
// silhouette with any colour in it at all.
//
// Parented to the head bone at a MEASURED offset (see eye_glow_core.ts), so it tracks every
// frame of every clip for free. This file is the Three half only: the spec and the curve
// live in the core beside it.
import * as THREE from 'three';
import { type EyeGlowSpec, eyeGlowIntensity } from './eye_glow_core';

/**
 * The lit eye: a bright core inside a soft halo.
 *
 * Two shells rather than one, because a single additive sphere reads as a flat disc at
 * distance and as a hard ball up close. The halo carries it across the arena and the core
 * gives it a source.
 */
export class EyeGlow {
  private core: THREE.Mesh | null = null;
  private halo: THREE.Mesh | null = null;
  private clock = 0;

  constructor(
    private spec: EyeGlowSpec,
    bone: THREE.Object3D | null,
  ) {
    if (!bone) return;
    this.core = this.build(spec.radius, spec.color, 0.72);
    this.halo = this.build(spec.radius * 2.8, spec.color, 0.26);
    for (const mesh of [this.halo, this.core]) {
      mesh.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
      bone.add(mesh);
    }
  }

  /** True when the rig had the bone to hang it on. */
  usable(): boolean {
    return this.core !== null;
  }

  update(dt: number, reducedMotion = false, asleep = false): void {
    if (!this.core || !this.halo) return;
    this.clock += dt;
    const k = eyeGlowIntensity(this.spec, this.clock, reducedMotion, asleep);
    (this.core.material as THREE.MeshBasicMaterial).opacity = 0.72 * k;
    (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.3 * k;
    // The halo breathes in SIZE as well as brightness; a glow that only changes opacity
    // reads as a light being dimmed rather than as something alive behind the socket.
    const s = 0.9 + 0.2 * k;
    this.halo.scale.setScalar(s);
  }

  private build(radius: number, color: number, opacity: number): THREE.Mesh {
    const geo = new THREE.SphereGeometry(radius, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 6;
    return mesh;
  }

  dispose(): void {
    for (const mesh of [this.core, this.halo]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.core = null;
    this.halo = null;
  }
}

export type { EyeGlowSpec };
