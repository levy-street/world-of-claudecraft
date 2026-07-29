// Long-hair secondary motion: drives the hair_sway_l / hair_sway_r /
// hair_sway_b morph targets the modular build (tmp/modular/hairimp.py) bakes
// onto styles with a hanging length.
//
// Morphs, not bones or shaders, on purpose: the hair rides the head bone as a
// single skinned part, and the shared tintedMaterial path rebuilds materials
// as Lambert on the low graphics tier, a shader sway would silently vanish
// there (the rim-glow lesson), while morph targets work on every material
// three ships. Carrying morphs also keeps the part out of mergeSkinnedParts,
// so only the styles that actually hang pay their extra draw.
//
// The driver is a stride oscillator into a lateral spring (so a stop SETTLES,
// swinging through a couple of diminishing arcs, instead of freezing mid-sway)
// plus a smoothed backward stream that rises with gait, subtle by design:
// influences cap well under 1, and idle carries only a breath of motion.
//
// Cost: a handful of scalar ops per frame plus writing three floats per hair
// mesh. Characters without sway morphs (every remote player, every mob, every
// short style) build an empty rig list and the update is a length check.

import type * as THREE from 'three';
import type { AnimState } from './anim_state';

interface SwayRig {
  infl: number[];
  iL: number;
  iR: number;
  iB: number;
}

/** Master switch for hair secondary motion. OFF for the current release: the
 *  hair library is shipping before the animation pass, so every style is static
 *  rather than half-tuned. The driver below is untouched and comes back by
 *  setting this to true (no rebuild needed, it reads morphs off the GLB). */
const HAIR_SWAY_ENABLED = false;

/** Gait that reaches full sway (yd/s), the run reference. */
const FULL_GAIT_SPEED = 7;
/** Stride oscillator, rad/s at idle drift and at full run. */
const PHASE_IDLE = 2.2;
const PHASE_RUN = 8.4;
/** Lateral amplitude (morph influence) at idle / at full run. */
const LAT_IDLE = 0.045;
const LAT_RUN = 0.5;
/** Backward stream at full run / while swimming. */
const BACK_RUN = 0.62;
const BACK_SWIM = 0.5;
/** Lateral spring: stiffness and damping (slightly under-damped, so ends
 *  swing through and settle in two or three arcs after a stop). */
const SPRING_K = 30;
const SPRING_D = 7.5;

export class HairSwayDriver {
  private rigs: SwayRig[] = [];
  private phase = 0;
  private lat = 0;
  private latVel = 0;
  private back = 0;

  /** Collect the meshes of a freshly composed model that carry sway morphs.
   *  Meshes without all three targets are skipped whole, a partial write
   *  would bend a style sideways with no way back. */
  build(root: THREE.Object3D): void {
    this.rigs.length = 0;
    // Hair animation is OFF for the current release (Troy, 2026-08-05: ship the
    // hair library first, animate it after). This is the whole switch: with no
    // rigs collected, update() returns on its length check and every style is
    // static, whether or not its GLB carries the morphs. Flip HAIR_SWAY_ENABLED
    // back to true to restore the driver, nothing else here changed.
    if (!HAIR_SWAY_ENABLED) return;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      if (!dict || !infl) return;
      const iL = dict.hair_sway_l;
      const iR = dict.hair_sway_r;
      const iB = dict.hair_sway_b;
      if (iL === undefined || iR === undefined || iB === undefined) return;
      this.rigs.push({ infl, iL, iR, iB });
    });
  }

  get active(): boolean {
    return this.rigs.length > 0;
  }

  /** Advance the sway. Called from CharacterVisual.update on animated frames,
   *  which also covers the creation-screen turntable (it drives the same
   *  update with a preview AnimState). */
  update(dt: number, s: AnimState): void {
    if (this.rigs.length === 0) return;
    const moving = s.moving && !s.dead;
    const gait = s.dead ? 0 : Math.min(1, s.speed / FULL_GAIT_SPEED);
    this.phase += dt * (PHASE_IDLE + (PHASE_RUN - PHASE_IDLE) * gait);
    const targetLat =
      (moving ? LAT_IDLE + (LAT_RUN - LAT_IDLE) * gait : LAT_IDLE) * Math.sin(this.phase);
    this.latVel += ((targetLat - this.lat) * SPRING_K - this.latVel * SPRING_D) * dt;
    this.lat += this.latVel * dt;
    const targetBack = s.dead ? 0 : s.swimming ? BACK_SWIM : moving ? BACK_RUN * gait : 0;
    this.back += (targetBack - this.back) * Math.min(1, dt * 5);
    const L = Math.max(0, this.lat);
    const R = Math.max(0, -this.lat);
    for (const rig of this.rigs) {
      rig.infl[rig.iL] = L;
      rig.infl[rig.iR] = R;
      rig.infl[rig.iB] = this.back;
    }
  }
}
