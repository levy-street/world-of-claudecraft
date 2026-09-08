import * as THREE from 'three';
import type { AbilityVfxRibbons } from './ribbons';

// Three charged conductors belong to Thunder Ward. Primal Mastery instead
// gathers current along the arms. Both are actor-facing worn silhouettes,
// never a floor circle or a successful hit on another actor.
export class HeldConduction {
  private points = Array.from({ length: 12 }, () => new THREE.Vector3());
  private origin = new THREE.Vector3();
  private rx = 1;
  private rz = 0;
  private fx = 0;
  private fz = 1;

  private point(index: number, side: number, up: number, forward: number): void {
    this.points[index].set(
      this.origin.x + this.rx * side + this.fx * forward,
      this.origin.y + up,
      this.origin.z + this.rz * side + this.fz * forward,
    );
  }

  draw(
    ribbons: AbilityVfxRibbons,
    style: 'wardCharges' | 'conduction',
    at: THREE.Vector3,
    facing: number,
    time: number,
    charges: number,
    color: number,
    fade: number,
    detail: boolean,
  ): void {
    this.origin.copy(at);
    this.rx = Math.cos(facing);
    this.rz = -Math.sin(facing);
    this.fx = Math.sin(facing);
    this.fz = Math.cos(facing);
    if (style === 'wardCharges') {
      for (let node = 0; node < Math.min(3, Math.max(0, charges)); node++) {
        const side = node === 0 ? -0.7 : node === 1 ? 0.7 : 0;
        const up = node === 2 ? -0.16 : 0.34;
        const forward = node === 2 ? 0.72 : 0;
        // Unequal barbs make a compact conductor, rather than a perfect rune.
        this.point(0, side - 0.1, up - 0.21, forward);
        this.point(1, side - 0.17, up + 0.02, forward - 0.06);
        this.point(2, side + 0.04, up + 0.4, forward);
        this.point(3, side + 0.15, up + 0.06, forward + 0.07);
        this.point(4, side - 0.1, up - 0.21, forward);
        ribbons.appendHeld(this.points, 5, 0.16, color, fade * 1.1);
        ribbons.appendHeld(this.points, 5, 0.045, 0xe1faff, fade * 2.4);
        if (!detail) continue;
        // Current crawls down each charge's spine, never bridging to a
        // depleted charge or drawing a fictitious retaliation target.
        for (let j = 0; j < 7; j++) {
          const u = j / 6;
          const ripple = Math.sin(time * 13 + j * 2.5 + node * 2.1);
          this.point(
            j,
            side + ripple * 0.09,
            up + 0.32 - u * 0.5,
            forward + Math.cos(j * 2.3 + time * 9) * 0.06,
          );
        }
        ribbons.appendHeld(this.points, 7, 0.08, 0xb7f3ff, fade * 2);
      }
      return;
    }
    // A driven shoulder-to-hand current distinguishes the 12-second offensive
    // window from the three stationary defensive charge conductors.
    for (let side = -1; side <= 1; side += 2) {
      for (let j = 0; j < 12; j++) {
        const u = j / 11;
        const wave = Math.sin(time * 8 + u * 18 + side);
        this.point(
          j,
          side * (0.26 + u * 0.58) + wave * 0.065,
          0.52 - u * 0.84 + Math.sin(u * 3.1) * 0.14,
          0.06 + u * 0.26 + Math.cos(time * 6 + u * 15) * 0.06,
        );
      }
      ribbons.appendHeld(this.points, 12, detail ? 0.24 : 0.16, color, fade * 1.3);
      ribbons.appendHeld(this.points, 12, 0.065, 0xebffff, fade * 2.1);
    }
  }
}
