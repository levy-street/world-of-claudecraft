import * as THREE from 'three';
import { WARRIOR_READINESS as R } from '../warrior_readiness_core';
import { OVERLAY_CELL } from './fx_textures';
import type { OverlaySprites } from './overlay_sprites';
import type { AbilityVfxRibbons } from './ribbons';

// Coordinates run across and along the actual blade. Open, asymmetric edges
// replace body halos; a prepared execution and a calm free spender do not share
// the same silhouette. Arrays and transformed points are retained once.
const STEEL_EDGE = [-0.08, -0.8, -0.08, 0.28, -0.04, 0.48, -0.08, 0.65, -0.04, 1.05];
const RED_EDGE = [0.08, -0.65, 0.09, -0.1, 0.17, 0.04, 0.08, 0.14, 0.08, 0.95];
const WIDE_EDGE = [-0.18, -0.55, -0.36, 0.05, -0.38, 0.6, -0.2, 1.25, 0.02, 1.45];
const WIDE_RETURN = [0.14, -0.4, 0.28, 0.2, 0.24, 0.75, 0.04, 1.22];
const EXECUTION = [-0.28, 0.76, -0.18, 1.3, 0, 1.55, 0.19, 1.16, 0.27, 0.96];
const EXECUTION_CUT = [-0.2, 0.48, -0.12, 1.03, 0, 1.4];
const TRANCE_A = [-0.2, -0.68, -0.2, -0.24, -0.12, -0.12];
const TRANCE_B = [0.13, -0.78, 0.13, -0.35, 0.23, -0.23];
const GUARD = [-0.44, 0.24, -0.4, -0.18, 0, -0.46, 0.4, -0.18, 0.44, 0.24];
const COUNTER = [-0.42, 0.5, -0.2, 0.24, 0, 0.34, 0.22, 0.24, 0.45, 0.5];
const COUNTER_CUT = [-0.3, 0.65, 0, 0.48, 0.32, 0.65];

export class WarriorReadinessShapes {
  private readonly points = Array.from({ length: 8 }, () => new THREE.Vector3());
  private readonly center = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private length = 1;

  draw(
    ribbons: AbilityVfxRibbons,
    overlay: OverlaySprites,
    frame: THREE.Matrix4,
    tip: THREE.Vector3,
    bits: number,
    hand: 0 | 1,
    offhandReady: boolean,
    time: number,
    reducedMotion: boolean,
  ): void {
    this.center.setFromMatrixPosition(frame);
    this.normal.setFromMatrixColumn(frame, 2).normalize();
    this.along.copy(tip).sub(this.center);
    this.along.addScaledVector(this.normal, -this.along.dot(this.normal));
    this.length = this.along.length();
    if (this.length < 0.12) {
      this.along.setFromMatrixColumn(frame, 1);
      this.length = 0.25;
    } else this.along.multiplyScalar(1 / this.length);
    this.across.crossVectors(this.along, this.normal).normalize();
    const pulse = reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(time * 5);
    if (hand === 0) {
      if (bits & R.battle) this.line(ribbons, STEEL_EDGE, 0xdcb66d, 0.072, 1.25);
      if (bits & R.wideningArc) {
        this.line(ribbons, WIDE_EDGE, 0x9c7652, 0.095, 0.7);
        this.line(ribbons, WIDE_EDGE, 0xe8d6af, 0.035, 1.25);
        this.line(ribbons, WIDE_RETURN, 0xc7d9e5, 0.035, 0.8);
      }
      if (bits & R.suddenDeath) {
        this.line(ribbons, EXECUTION, 0x971d26, 0.12, 1);
        this.line(ribbons, EXECUTION_CUT, 0xffd8bd, 0.038, 1.4 * pulse);
        overlay.push(tip.x, tip.y, tip.z, 0xffd9c4, 0.22, OVERLAY_CELL.star, 0.9, 1.5, 1);
      }
      if (bits & R.battleTrance) {
        this.line(ribbons, TRANCE_A, 0xe7c282, 0.055, 1.1);
        this.line(ribbons, TRANCE_B, 0xfcdf9e, 0.035, 1.2);
      }
    }
    if (bits & R.berserker) this.line(ribbons, RED_EDGE, 0xeb3244, 0.078, 1.25);
    if ((hand === 1 || !offhandReady) && bits & (R.guarded | R.revenge)) {
      // Use the real equipment face even when the permitted loadout has no shield.
      this.along.setFromMatrixColumn(frame, 1).normalize();
      this.across.setFromMatrixColumn(frame, 0).normalize();
      this.length = Math.max(0.35, this.length);
      if (bits & R.guarded) this.line(ribbons, GUARD, 0x79cce8, 0.08, 1.2);
      if (bits & R.revenge) {
        this.line(ribbons, COUNTER, 0x6399b6, 0.1, 0.85);
        this.line(ribbons, COUNTER_CUT, 0xe1f1ef, 0.045, 1.3 * pulse);
      }
    }
  }

  private line(
    ribbons: AbilityVfxRibbons,
    shape: readonly number[],
    color: number,
    width: number,
    light: number,
  ): void {
    const count = shape.length / 2;
    for (let i = 0; i < count; i++)
      this.points[i]
        .copy(this.center)
        .addScaledVector(this.across, shape[i * 2] * this.length)
        .addScaledVector(this.along, shape[i * 2 + 1] * this.length)
        .addScaledVector(this.normal, 0.055);
    ribbons.appendHeld(this.points, count, width, color, light);
  }
}
