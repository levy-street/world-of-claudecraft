import type { Vector3 } from 'three';
import type { AbilityVfxRibbons } from './ribbons';

/** Three open lightning shields, one per actual charge. A continuous blue
 * conductor remains legible between white return strokes; no orbiting beads.
 * Uses the existing held buffer and caller-owned scratch, two paths per charge
 * plus one fine fork at high detail. */
export function drawThunderWard(
  points: Vector3[],
  origin: Vector3,
  facing: number,
  time: number,
  charges: number,
  color: number,
  fade: number,
  detail: boolean,
  ribbons: Pick<AbilityVfxRibbons, 'appendHeld'>,
): void {
  for (let n = 0; n < Math.min(3, Math.max(0, charges)); n++) {
    const angle = facing + (n * Math.PI * 2) / 3 + time * 0.36 + 0.35;
    const rx = Math.cos(angle),
      rz = -Math.sin(angle);
    const tx = Math.sin(angle),
      tz = Math.cos(angle);
    const epoch = Math.floor(time * 11 + n * 2.3);
    const beat = (time * 1.3 + n * 0.31) % 1;
    for (let pass = 0; pass < 2; pass++) {
      const count = pass === 0 ? 12 : 5;
      for (let j = 0; j < count; j++) {
        const u = pass === 0 ? j / 11 : Math.max(0, Math.min(1, beat * 1.3 - 0.15 + j * 0.06));
        const bow = Math.sin(u * Math.PI);
        const tooth = Math.sin(u * 52.03 + epoch) * bow * 0.19;
        const shoulder = bow ** 0.65;
        const radius = 1.1 + shoulder * 1.1 + tooth - (pass ? bow * 0.38 : 0);
        const tangent = (u - 0.5) * 2.65 + Math.sin(u * Math.PI * 2) * 0.3;
        points[j].set(
          origin.x + rx * radius + tx * tangent,
          origin.y - 1.12 + u * 2.35 + tooth * 0.6,
          origin.z + rz * radius + tz * tangent,
        );
      }
      ribbons.appendHeld(
        points,
        count,
        pass === 0 ? 0.24 : 0.085 + Math.sin(beat * Math.PI) * 0.07,
        pass === 0 ? 0xa5ddff : 0xe5faff,
        fade * (pass === 0 ? 1.35 : 2.0),
      );
    }
    if (!detail) continue;
    const root = points[2];
    const x = root.x,
      y = root.y,
      z = root.z;
    for (let j = 0; j < 7; j++) {
      const u = j / 6;
      const kink = Math.sin(j * 3.7 + epoch * 1.9) * Math.sin(u * Math.PI) * 0.09;
      points[j].set(
        x + tx * u * 0.75 + rx * (kink - Math.sin(u * Math.PI) * 0.32),
        y - u * 0.55 + kink,
        z + tz * u * 0.75 + rz * (kink - Math.sin(u * Math.PI) * 0.32),
      );
    }
    ribbons.appendHeld(points, 7, 0.027, color, fade * (beat < 0.18 ? 1.65 : 0.45));
  }
}
