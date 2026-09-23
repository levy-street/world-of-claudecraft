import * as THREE from 'three';
import type { AbilityVfxRibbons } from './ribbons';
import { drawThunderWard } from './shaman_thunder_ward';

// Three open charged shields belong to Thunder Ward. Primal Mastery instead
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
      drawThunderWard(this.points, at, facing, time, charges, color, fade, detail, ribbons);
      return;
    }
    // A driven shoulder-to-hand current distinguishes the 12-second offensive
    // window from the three orbiting defensive charges.
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
