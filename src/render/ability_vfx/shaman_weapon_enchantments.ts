import * as THREE from 'three';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import { OVERLAY_CELL } from './fx_textures';
import type { OverlaySprites } from './overlay_sprites';
import type { AbilityVfxRibbons } from './ribbons';

type Ribbons = Pick<AbilityVfxRibbons, 'appendHeld'>;
type Overlay = Pick<OverlaySprites, 'push'>;

/** Draws only inside an actual worn weapon's animated frame. The single scratch
 * set is shared by all wearers and both hands; immediate buffers own submission.
 * Maximum per hand: four paths (72 vertices) and two points, no retained spawns. */
export class ShamanWeaponEnchantments {
  private readonly points = Array.from({ length: 9 }, () => new THREE.Vector3());
  private readonly frame = new THREE.Matrix4();
  private readonly tip = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly front = new THREE.Vector3();
  private readonly extents = new THREE.Vector3();
  private halfLength = 0.26;
  private halfWidth = 0.08;
  private halfDepth = 0.035;

  draw(
    sample: WeaponAnchorSampler,
    imbue: number,
    cadence: number,
    time: number,
    detail: boolean,
    ribbons: Ribbons,
    overlay: Overlay,
  ): boolean {
    if (!sample(this.tip)) return false;
    const color =
      imbue === 1 ? 0xb6a57d : imbue === 2 ? 0xfca354 : imbue === 4 ? 0x58d5c9 : 0xb5edee;
    const surface = sample.surface?.(this.frame, this.extents) ?? false;
    if (!surface && !sample.frame?.(this.frame)) {
      // Tip-only samplers still identify the real equipment, never the face.
      overlay.push(this.tip.x, this.tip.y, this.tip.z, color, 0.2, OVERLAY_CELL.spark, 0.8, 1.3);
      return true;
    }
    this.centre.setFromMatrixPosition(this.frame);
    this.front.setFromMatrixColumn(this.frame, 2).normalize();
    if (surface) {
      this.axis.setFromMatrixColumn(this.frame, 1);
      this.halfLength = this.extents.y;
      this.halfWidth = this.extents.x;
      this.halfDepth = this.extents.z;
    } else {
      this.axis.subVectors(this.tip, this.centre);
      this.axis.addScaledVector(this.front, -this.axis.dot(this.front));
      this.halfLength = THREE.MathUtils.clamp(this.axis.length(), 0.18, 1.3);
      this.halfWidth = 0.08;
      this.halfDepth = 0.035;
      if (this.axis.lengthSq() < 0.0001) this.axis.setFromMatrixColumn(this.frame, 1);
    }
    this.axis.normalize();
    this.side.crossVectors(this.axis, this.front).normalize();
    if (imbue === 4) this.water(time, detail, ribbons, overlay);
    else if (imbue === 2) this.fire(time, detail, ribbons, overlay);
    else if (imbue === 1) this.stone(time, detail, ribbons, overlay);
    else this.wind(time, detail, ribbons, overlay, cadence);
    return true;
  }

  private point(index: number, along: number, side: number, front: number): THREE.Vector3 {
    return this.points[index]
      .copy(this.centre)
      .addScaledVector(this.axis, (along - 0.5) * this.halfLength * 2)
      .addScaledVector(this.side, side)
      .addScaledVector(this.front, front);
  }

  private water(t: number, detail: boolean, ribbons: Ribbons, overlay: Overlay): void {
    // One broad flowing runnel on EACH actual blade face. Its crosswise travel
    // covers an axehead, not merely the shaft sampled by an ordinary tip trail.
    for (let side = -1; side <= 1; side += 2) {
      for (let j = 0; j < 9; j++) {
        const u = j / 8;
        const phase = u * 7 + t * side * 1.8;
        this.point(
          j,
          u,
          Math.sin(phase) * this.halfWidth * 0.72,
          side * (this.halfDepth + 0.045 + Math.cos(phase) * 0.012),
        );
      }
      ribbons.appendHeld(this.points, 9, Math.max(0.15, this.halfWidth * 1.1), 0x219aaa, 1.05);
      if (detail) ribbons.appendHeld(this.points, 9, 0.021, 0xd2fff1, 1.35);
      const u = (((t * side * 0.23 + (side > 0 ? 0.27 : 0.76)) % 1) + 1) % 1;
      const p = this.point(
        0,
        u,
        Math.sin(u * 7 + t * side * 1.8) * this.halfWidth * 0.72,
        side * (this.halfDepth + 0.065),
      );
      overlay.push(p.x, p.y, p.z, 0xaffff0, 0.15, OVERLAY_CELL.glow, 0.9, 1.4);
    }
  }

  private fire(t: number, detail: boolean, ribbons: Ribbons, overlay: Overlay): void {
    // The red ember bed is the lasting buff read, present on BOTH weapon faces
    // even at low detail. Thin ignition filaments alone vanish at gameplay range.
    // These flowing strips follow the real prop without repainting its material.
    for (let face = -1; face <= 1; face += 2) {
      for (let j = 0; j < 9; j++) {
        const u = j / 8;
        this.point(
          j,
          0.08 + u * 0.84,
          Math.sin(u * 6.2 - t * 1.7 + face * 0.8) * this.halfWidth * 0.48,
          face * (this.halfDepth + 0.035),
        );
      }
      ribbons.appendHeld(this.points, 9, Math.max(0.18, this.halfWidth * 1.45), 0xe93616, 1.15);
    }
    // Two unequal tongues complete the same four-path per-hand ceiling. The
    // low tier keeps the ember bed and one tongue; only garnish is reduced.
    const tongues = detail ? 2 : 1;
    for (let n = 0; n < tongues; n++) {
      for (let j = 0; j < 9; j++) {
        const u = j / 8;
        const curl = Math.sin(t * 3.2 + u * 5.5 + n * 1.7);
        this.point(
          j,
          0.18 + n * 0.28 + u * 0.36,
          curl * this.halfWidth * 0.6 * u,
          (n % 2 ? -1 : 1) * (this.halfDepth + 0.035 + u * (0.04 + n * 0.018)),
        );
      }
      ribbons.appendHeld(
        this.points,
        9,
        Math.max(0.09, this.halfWidth * (n === 0 ? 0.5 : 0.36)),
        n === 1 ? 0xff9b38 : 0xff6324,
        1.35,
      );
    }
    for (let n = 0; n < 2; n++) {
      const u = (t * 0.31 + n * 0.43) % 1;
      const p = this.point(
        0,
        0.2 + u * 0.7,
        Math.sin(u * 5 + n) * this.halfWidth * 0.7,
        (n ? -1 : 1) * (this.halfDepth + 0.045 + u * 0.1),
      );
      overlay.push(p.x, p.y, p.z, 0xffc15b, 0.075, OVERLAY_CELL.spark, 0.85, 1.6);
    }
  }

  private stone(t: number, detail: boolean, ribbons: Ribbons, overlay: Overlay): void {
    // Segmented mineral bindings have deliberate gaps and straight fractured
    // shoulders. A quiet travelling edge glint never makes the stone slosh.
    const bands = detail ? 4 : 3;
    for (let n = 0; n < bands; n++) {
      const u = 0.17 + n * (detail ? 0.21 : 0.3);
      const face = n % 2 ? -1 : 1;
      this.point(0, u - 0.055, -this.halfWidth * 0.75, face * (this.halfDepth + 0.025));
      this.point(1, u, -this.halfWidth, face * (this.halfDepth + 0.055));
      this.point(2, u + 0.055, -this.halfWidth * 0.15, face * (this.halfDepth + 0.078));
      this.point(3, u + 0.035, this.halfWidth * 0.8, face * (this.halfDepth + 0.045));
      ribbons.appendHeld(this.points, 4, n % 2 ? 0.07 : 0.095, n % 2 ? 0x92896e : 0xb2a27d, 0.85);
    }
    const p = this.point(
      0,
      0.2 + ((t * 0.08) % 1) * 0.6,
      -this.halfWidth * 0.8,
      this.halfDepth + 0.08,
    );
    overlay.push(p.x, p.y, p.z, 0xe6d9a9, 0.065, OVERLAY_CELL.spark, 0.7, 1.2);
  }

  private wind(
    t: number,
    detail: boolean,
    ribbons: Ribbons,
    overlay: Overlay,
    cadence: number,
  ): void {
    // Thin helical pressure filaments have a longer pitch than the water flow.
    for (let n = 0; n < (detail ? 3 : 2); n++) {
      for (let j = 0; j < 9; j++) {
        const u = j / 8;
        const phase = u * 4.4 - t * 3.1 + n * 2.1;
        this.point(
          j,
          u,
          Math.sin(phase) * (this.halfWidth + 0.025 + n * 0.013),
          Math.cos(phase) * (this.halfDepth + 0.055),
        );
      }
      ribbons.appendHeld(
        this.points,
        9,
        n === 0 ? 0.028 : 0.014,
        n === 0 ? 0xa9e7ed : 0xe7fff9,
        1.1 + cadence * 0.08,
      );
    }
    for (let n = 0; n < 2; n++) {
      const u = (t * 0.45 + n * 0.5) % 1;
      const p = this.point(
        0,
        u,
        Math.sin(u * 5 + n) * (this.halfWidth + 0.025),
        (n ? -1 : 1) * (this.halfDepth + 0.07),
      );
      overlay.push(p.x, p.y, p.z, 0xddffff, 0.08 + cadence * 0.009, OVERLAY_CELL.spark, 0.65, 1.3);
    }
  }
}
