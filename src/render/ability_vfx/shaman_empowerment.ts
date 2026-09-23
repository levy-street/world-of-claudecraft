import type { Vector3 } from 'three';
import type { AbilityVfxRibbons } from './ribbons';

const CHORUS_COLORS = [0x59baf3, 0x59baf3, 0xe9fbff, 0xe9fbff] as const;
const PRIMAL_COLORS = [0xff8c32, 0x50d8dd, 0xa0d9ff, 0xd3f4e2] as const;

/** Worn buff language on the actual aura recipient. All four elements remain
 * at low detail, and Storm Chorus keeps its actionable signal on every tier.
 * Immediate held geometry only: no new pools, retained particles or timers. */
export function drawShamanEmpowerment(
  points: Vector3[],
  origin: Vector3,
  facing: number,
  time: number,
  kind: 'chorus' | 'primal',
  remaining: number,
  detail: boolean,
  ribbons: Pick<AbilityVfxRibbons, 'appendHeld'>,
  compact = false,
  phaseSeed = 0,
): void {
  const rhythm = time + phaseSeed * 0.137;
  const c = Math.cos(facing),
    s = Math.sin(facing);
  const arrival = kind === 'chorus' ? Math.max(0, Math.min(1, (remaining - 13.4) / 1.6)) : 0;
  const colors = kind === 'chorus' ? CHORUS_COLORS : PRIMAL_COLORS;
  const fullCount = compact && kind === 'chorus' ? 8 : 12;
  for (let k = 0; k < (compact && kind === 'chorus' ? 2 : 4); k++) {
    const side = k % 2 ? 1 : -1;
    const fine = k >= 2;
    const returnStroke = fine && kind === 'chorus';
    const count = returnStroke ? 5 : fullCount;
    for (let j = 0; j < count; j++) {
      const u = returnStroke
        ? 0.12 + ((rhythm * 0.7 + k * 0.27) % 1) * 0.54 + j * 0.055
        : j / (count - 1);
      let x: number, y: number, z: number;
      if (kind === 'chorus') {
        const tooth =
          Math.sin(j * 4.73 + Math.floor(rhythm * 8) + side * 2) * Math.sin(u * Math.PI) * 0.055;
        const lift = Math.sin(Math.PI * u);
        x = side * (0.68 + lift * (0.7 + arrival * 1.2) - u * u * 0.25) + tooth;
        y =
          0.95 +
          lift * (0.85 + arrival * 2.0) -
          u * 0.9 +
          (fine ? 0.08 : 0) +
          lift * Math.sin(rhythm * 2.2 + side * 0.8) * 0.09;
        z = -0.27 - lift * (0.5 + arrival * 0.55) + u * 0.72 + (fine ? 0.1 : 0);
      } else {
        const phase = u * 3.4 + time * (k === 2 ? 0.22 : 0.45) + k * 1.55;
        const radius = 0.96 + Math.sin(u * Math.PI) * 0.38;
        x = Math.cos(phase) * radius;
        y = 0.15 + u * (k === 2 ? 1.9 : 1.65);
        z = Math.sin(phase) * radius;
        if (k === 2) x += Math.sin(j * 4.1 + Math.floor(time * 9)) * 0.055;
      }
      points[j].set(origin.x + c * x + s * z, origin.y + y, origin.z - s * x + c * z);
    }
    ribbons.appendHeld(
      points,
      count,
      kind === 'chorus' ? (fine ? 0.038 : 0.17 + arrival * 0.2) : k < 2 ? 0.1 : 0.037,
      colors[k],
      0.95 + arrival * 1.1,
    );
    if (detail && kind === 'primal' && k < 2)
      ribbons.appendHeld(points, count, 0.023, k ? 0xe0fff4 : 0xffe2a5, 1.25);
  }
}
