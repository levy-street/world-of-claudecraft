import * as THREE from 'three';
import { OVERLAY_CELL } from './fx_textures';
import type { OverlaySprites } from './overlay_sprites';
import type { AbilityVfxRibbons } from './ribbons';
import { warriorAreaPoint } from './warrior_area_shapes';

/** Immediate held cutting seams use the existing ribbon buffer, with no new
 * per-frame paths, allocations, texture uploads or spawn-time world anchors. */
export class HeldWarriorStorm {
  private readonly points = Array.from({ length: 36 }, () => new THREE.Vector3());
  private readonly point = new THREE.Vector3();
  private readonly primary = Array.from({ length: 22 }, () => new THREE.Vector3());

  drawPrimary(
    ribbons: AbilityVfxRibbons,
    at: THREE.Vector3,
    elapsed: number,
    reducedMotion: boolean,
  ): void {
    const angle = reducedMotion ? 0 : elapsed * 14,
      cosine = Math.cos(angle),
      sine = Math.sin(angle);
    for (let blade = 0; blade < 3; blade++) {
      for (let i = 0; i < this.primary.length; i++) {
        warriorAreaPoint('steel_storm', blade, i / (this.primary.length - 1), 0, this.point);
        this.primary[i].set(
          at.x + this.point.x * cosine + this.point.z * sine,
          at.y + this.point.y,
          at.z + this.point.z * cosine - this.point.x * sine,
        );
      }
      ribbons.appendHeld(this.primary, this.primary.length, 0.22, 0xcbd8df, 1.4);
    }
  }

  draw(
    ribbons: AbilityVfxRibbons,
    overlay: OverlaySprites,
    at: THREE.Vector3,
    elapsed: number,
    reducedMotion: boolean,
  ): void {
    const angle = reducedMotion ? 0 : elapsed * 14;
    const cosine = Math.cos(angle),
      sine = Math.sin(angle);
    for (let blade = 0; blade < 3; blade++) {
      for (let i = 0; i < this.points.length; i++) {
        warriorAreaPoint('steel_storm', blade, i / (this.points.length - 1), 0, this.point);
        this.points[i].set(
          at.x + this.point.x * cosine + this.point.z * sine,
          at.y + this.point.y,
          at.z + this.point.z * cosine - this.point.x * sine,
        );
      }
      ribbons.appendHeld(this.points, this.points.length, 0.22, 0xc29876, 0.95);
      ribbons.appendHeld(this.points, this.points.length, 0.065, 0xdce9f1, 1.2);
      // Swept spokes connect the weapon's centre to each hooked outer wake.
      for (let i = 0; i < this.points.length; i++) {
        const u = i / (this.points.length - 1);
        const a = (blade * Math.PI * 2) / 3 + angle + u * 1.65;
        const radius = 1.15 + u * 4.6;
        this.points[i].set(
          at.x + Math.sin(a) * radius,
          at.y + 0.7 + Math.sin(u * Math.PI) * 0.55,
          at.z + Math.cos(a) * radius,
        );
      }
      ribbons.appendHeld(this.points, this.points.length, 0.12, 0x718ca1, 0.7);
    }
    const time = reducedMotion ? 0 : elapsed;
    for (let chip = 0; chip < 18; chip++) {
      const phase = chip * 2.39996 + time * (chip % 2 ? 9 : 12);
      const radius = 2.2 + (((chip * 17) % 29) / 29) * 3.5;
      const lift = 0.3 + (((chip * 13) % 19) / 19) * 1.2;
      overlay.push(
        at.x + Math.sin(phase) * radius,
        at.y + lift,
        at.z + Math.cos(phase) * radius,
        chip % 3 ? 0x9aafbb : 0xd3b08b,
        chip % 3 ? 0.12 : 0.19,
        OVERLAY_CELL.spark,
        0.85,
        1.2,
      );
    }
  }
}
