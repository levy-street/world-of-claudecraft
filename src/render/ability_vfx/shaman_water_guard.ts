import type * as THREE from 'three';
import type { AbilityVfxRibbons } from './ribbons';

/** The real Lifespring guard leaves two open liquid shoulders until consumed.
 * Borrows the held owner's scratch, with no retained shape or timer. */
export function drawShamanWaterGuard(
  points: THREE.Vector3[],
  origin: THREE.Vector3,
  facing: number,
  time: number,
  detail: boolean,
  ribbons: Pick<AbilityVfxRibbons, 'appendHeld'>,
): void {
  const c = Math.cos(facing),
    s = Math.sin(facing);
  for (let side = -1; side <= 1; side += 2) {
    for (let j = 0; j < 9; j++) {
      const u = j / 8;
      const x = side * (0.68 + Math.sin(u * Math.PI) * 0.36);
      const z = 0.08 + Math.sin(u * Math.PI) * 0.22 + Math.sin(time * 1.5 + u * 5) * 0.035;
      points[j].set(origin.x + c * x + s * z, origin.y + 0.35 + u * 1.14, origin.z - s * x + c * z);
    }
    ribbons.appendHeld(points, 9, 0.14, 0x288d9d, 0.85);
    if (detail) ribbons.appendHeld(points, 9, 0.023, 0xbdece0, 1.1);
  }
}
