/** Authored physical motions. All distances are world yards, angles radians.
 * Geometry follows the attack's direction, never the camera's facing plane. */
export type PhysicalShape =
  | 'cut'
  | 'reap'
  | 'plunge'
  | 'thrust'
  | 'rise'
  | 'shield'
  | 'fault'
  | 'breath'
  | 'rush'
  | 'retreat'
  | 'spin'
  | 'inward'
  | 'parry'
  | 'restore'
  | 'quiet'
  | 'claw'
  | 'jaw'
  | 'scatter'
  | 'jab'
  | 'venom'
  | 'dart';
export interface PhysicalChoreography {
  shape: PhysicalShape;
  reach: number;
  width: number;
  lift: number;
  tilt: number;
  beats: readonly number[];
  weight: number;
  material: 'steel' | 'blood' | 'stone' | 'air' | 'venom';
  particles?: number;
  anchor?: 'caster' | 'target';
  /** The held item to sample during the real animation; absent for unarmed motion. */
  weapon?: 0 | 1 | 'both';
}

/** Contact silhouettes follow the physical action, never just its school colour. */
export function physicalContactSheet(
  p: PhysicalChoreography,
): 'contact_cut' | 'contact_crush' | 'contact_pierce' | null {
  switch (p.shape) {
    case 'quiet':
    case 'inward':
    case 'restore':
    case 'parry':
    case 'breath':
    case 'retreat':
      return null;
    case 'shield':
    case 'fault':
    case 'rush':
    case 'jaw':
      return 'contact_crush';
    case 'thrust':
    case 'dart':
    case 'jab':
    case 'venom':
      return 'contact_pierce';
    case 'plunge':
      return p.material === 'stone' ? 'contact_crush' : 'contact_cut';
    default:
      return 'contact_cut';
  }
}

/** Fit the authored contacts plus recovery inside the shortest combat GCD. */
export function physicalBeatTime(p: PhysicalChoreography, beat: number): number {
  return p.beats[beat] * Math.min(1, 0.34 / Math.max(0.001, p.beats[p.beats.length - 1]));
}

/** Open, tapered trajectories; no path closes into a perfect circle. */
export function physicalPathPoint(
  p: PhysicalChoreography,
  u: number,
  beat: number,
  strand: number,
  out: { x: number; y: number; z: number },
): void {
  const s = strand - 1;
  const reverse = beat % 2 === 0 ? 1 : -1;
  const a = (u - 0.5) * (p.shape === 'spin' ? 3.15 : 2.3) + beat * 0.95 + s * 0.17;
  const r = p.reach * (0.86 + 0.065 * strand) * (1 + Math.sin(u * 4.3 + strand * 1.6) * 0.085);
  let x = 0,
    y = 0,
    z = 0;
  switch (p.shape) {
    case 'cut':
    case 'reap':
    case 'spin':
      x = Math.sin(a) * r * reverse;
      z = Math.cos(a) * r;
      y = (u - 0.5) * (p.tilt + s * 0.45) + Math.sin(u * Math.PI) * 0.15 + s * 0.09;
      break;
    case 'plunge':
      x = (u - 0.5) * p.tilt + s * 0.065;
      y = (1 - u) * r * 1.3;
      z = Math.sin(u * 1.55) * r * 0.58;
      break;
    case 'rise':
      x = (u - 0.5) * p.tilt * reverse + s * 0.08;
      y = u * r * 0.95;
      z = Math.sin(u * 2.2) * r * 0.65;
      break;
    case 'thrust':
    case 'rush':
    case 'retreat':
    case 'dart':
      x = s * (0.06 + u * 0.14) + Math.sin(u * 8 + strand) * 0.03;
      y = Math.sin(u * Math.PI) * p.tilt * 0.15;
      z = u * r;
      break;
    case 'claw':
      x = (u - 0.5) * p.tilt + s * 0.22;
      y = (1 - u) * r * 0.48;
      z = Math.sin(u * 1.8) * r * (1 - strand * 0.09);
      break;
    case 'jaw':
      x = (strand % 2 ? -1 : 1) * (1 - u) * r * 0.4;
      y = (strand % 2 ? -0.3 : 0.3) * (1 - u) * r;
      z = 0.4 + u * r * 0.6;
      break;
    case 'jab':
      x = s * 0.065 + Math.sin(u * 3) * 0.04;
      y = u * p.tilt * 0.12;
      z = u * r * 0.7;
      break;
    case 'scatter':
      x = Math.sin(strand * 2.3 + beat * 0.8) * u * r;
      y = Math.sin(u * Math.PI) * 0.4;
      z = Math.cos(strand * 2.3 + beat * 0.8) * u * r;
      break;
    case 'venom':
      x = s * 0.13 + Math.sin(u * 6 + strand) * 0.07;
      y = (1 - u) * 0.8;
      z = 0.3 + Math.sin(u * 2.8) * r * 0.25;
      break;
    case 'shield':
    case 'parry':
      x = Math.sin(a) * r * 0.65;
      y = Math.cos(a) * r * 0.8;
      z = 0.65 + u * 0.25 + Math.sin(u * 3) * p.tilt * 0.1;
      break;
    case 'fault':
      x = s * u * r * 0.27 + Math.sin(u * 22 + strand * 4.3) * 0.12 * u;
      y = 0;
      z = u * r * (1 - strand * 0.14);
      break;
    case 'breath':
      x = s * u * r * 0.25 + Math.sin(u * 5 + strand) * 0.16 * u;
      y = Math.sin(u * 3.8 + strand) * u * 0.25 + p.tilt * u;
      z = u * r;
      break;
    case 'inward':
    case 'restore':
      x = Math.sin(a + strand * 1.7) * r * (1 - u);
      y = u * (p.shape === 'restore' ? 1.6 : 0.6) + s * 0.15;
      z = Math.cos(a + strand * 1.7) * r * (1 - u);
      break;
    case 'quiet':
      x = s * 0.16;
      y = u * 0.55;
      z = 0.25;
      break;
  }
  out.x = x;
  out.y = y + p.lift;
  out.z = z;
}
