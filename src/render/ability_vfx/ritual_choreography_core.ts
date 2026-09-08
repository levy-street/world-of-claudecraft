/** Authored open silhouettes. No random per-cast shape or circular fallback. */
export type RitualShape =
  | 'edge'
  | 'ward'
  | 'feather'
  | 'stitch'
  | 'chorus'
  | 'bone'
  | 'storm'
  | 'water'
  | 'growth'
  | 'moon'
  | 'ash'
  | 'precision'
  | 'trap'
  | 'veil';
export interface RitualChoreography {
  shape: RitualShape;
  radius: number;
  height: number;
  width: number;
  strands: number;
  beats: readonly number[];
  duration: number;
  twist: number;
  anchor?: 'caster' | 'target';
}

/** Open class silhouettes, sampled by both held casts and their release. */
export function classCastPoint(
  style: string,
  u: number,
  strand: number,
  progress: number,
  out: { x: number; y: number; z: number },
): void {
  const side = strand % 2 ? -1 : 1;
  const gather = 1 - progress * 0.32;
  switch (style) {
    case 'spring':
      out.x = side * (0.65 * (1 - u) + Math.sin(u * 5) * 0.12);
      out.y = 0.15 + u * 1.4 + Math.sin(u * Math.PI) * 0.3;
      out.z = Math.cos(strand * 2.2) * (1 - u) * 0.55 + u * 0.45;
      break;
    case 'psionic':
      out.x = side * (0.25 + Math.abs(u - 0.5) * 0.65);
      out.y = 1.1 + u * 1.35;
      out.z = -0.1 + (strand >> 1) * 0.25 + Math.sin(u * 27) * 0.045;
      break;
    case 'lunar': {
      const crescent = -1.2 + u * 2.2;
      out.x = side * (0.35 + Math.cos(crescent) * 0.55);
      out.y = 1.45 + Math.sin(crescent) * 0.7;
      out.z = 0.1 + strand * 0.13;
      break;
    }
    case 'quiver': // Parallel fletching aligns down the weapon's firing axis.
      out.x = side * (1 - u) * 0.38;
      out.y = 1.35 + (strand - 1) * 0.13;
      out.z = 0.15 + u * 1.25;
      break;
    case 'scripture': // Three suspended lines of a luminous written invocation.
      out.x = (u - 0.5) * 1.8;
      out.y = 1.35 + strand * 0.27 + Math.sin(u * Math.PI) * 0.18;
      out.z = 0.6 + Math.sin(u * Math.PI * 4) * 0.07;
      break;
    case 'conduction': // Forks climb from separate shoulder/weapon conductors.
      out.x = side * (0.2 + u * 0.8) + Math.sin(u * 29 + strand) * 0.12 * u;
      out.y = 1.45 + Math.sin(u * 16 + strand) * 0.13 + u * 0.6;
      out.z = 0.2 + strand * 0.16 + Math.cos(u * 19) * 0.11;
      break;
    case 'bough': // Asymmetric living branches gather into the raised hands.
      out.x = side * Math.sin(u * Math.PI * 0.8) * 0.8 * gather;
      out.y = 0.2 + u * 1.7;
      out.z = 0.3 + Math.sin(u * 6 + strand) * 0.2 * (1 - u);
      break;
    case 'solar': // Upright spear-shaped rays; no horizontal casting disc.
      out.x = side * (0.3 + strand * 0.12) * Math.sin(u * Math.PI);
      out.y = 0.45 + u * 2.5;
      out.z = -0.25 + Math.sin(u * Math.PI) * 0.2;
      break;
    case 'occult': // Unequal hooked wisps contract toward the casting hand.
      out.x = side * (1 - u) * 1.2 * gather;
      out.y = 0.8 + u + Math.sin(u * 8 + strand) * 0.22;
      out.z = -0.4 + u * 0.9 + Math.sin(u * 10 + strand) * 0.16;
      break;
    default:
      out.x = 0;
      out.y = 1;
      out.z = u;
  }
}
export function ritualPathPoint(
  p: RitualChoreography,
  u: number,
  strand: number,
  beat: number,
  out: { x: number; y: number; z: number },
): void {
  const side = strand % 2 ? -1 : 1;
  const a = strand * 2.39996 + p.twist;
  const expansion = 0.7 + beat * 0.18;
  let x = 0,
    y = 0,
    z = 0;
  switch (p.shape) {
    case 'chorus':
      x = (u - 0.5) * 2;
      y = 0.25 + strand * 0.16 + Math.sin(u * Math.PI) * 0.2;
      z = side * (0.18 + Math.sin(u * Math.PI * 2) * 0.2);
      break;
    case 'edge':
      x = (u - 0.5) * 2 * side;
      y = (1 - u) * 1.3;
      z = (strand - 1) * 0.18 + Math.sin(u * Math.PI) * 0.14;
      break;
    case 'ward': {
      // Shield profile: pitched shoulder, planar face, lower tapered point.
      const q = u * 3;
      x = side * (q < 1 ? q * 0.7 : q < 2 ? 0.7 : 0.7 * (3 - q));
      y = q < 1 ? 1 - q * 0.12 : q < 2 ? 0.88 - (q - 1) * 0.58 : 0.3 - (q - 2) * 0.35;
      z = 0.5 + (strand >> 1) * 0.2;
      break;
    }
    case 'feather':
      x = side * (0.12 + Math.sin(u * Math.PI * 0.8) * (0.75 + (strand >> 1) * 0.2));
      y = 0.15 + u * 0.9;
      z = Math.cos(a) * 0.23 + Math.sin(u * 5) * 0.07;
      break;
    case 'stitch':
      x = Math.sin(u * Math.PI * 2.6 + a) * (1 - u) * 0.8;
      y = 0.12 + u * 0.72;
      z = Math.cos(u * Math.PI * 1.8 + a) * (1 - u) * 0.6;
      break;
    case 'bone':
      x = side * (0.12 + Math.sin(u * Math.PI) * 0.65);
      y = 0.2 + (strand >> 1) * 0.18 + u * 0.16;
      z = 0.1 + Math.cos(u * Math.PI) * 0.46;
      break;
    case 'storm':
      x = Math.cos(a) * u + Math.sin(u * 35 + strand) * 0.095 * u;
      z = Math.sin(a) * u + Math.sin(u * 23 + strand) * 0.12 * u;
      y = 1 - u * 0.85 + Math.sin(u * 19) * 0.1;
      break;
    case 'water':
      x = Math.cos(a) * (1 - u) * 0.9 + Math.sin(u * 5 + a) * 0.16;
      z = Math.sin(a) * (1 - u) * 0.9;
      y = 0.05 + u * 0.65 + Math.sin(u * Math.PI) * 0.24;
      break;
    case 'growth':
      x = Math.cos(a) * Math.sin(u * Math.PI * 0.7) * (1 + Math.sin(u * 9) * 0.13);
      z = Math.sin(a) * Math.sin(u * Math.PI * 0.7) + Math.cos(u * 7 + a) * 0.08;
      y = u * u * 0.9;
      break;
    case 'moon': {
      const t = -1.2 + u * 2.1;
      x = side * (Math.cos(t) - 0.3);
      y = 0.5 + Math.sin(t) * 0.48;
      z = (strand >> 1) * 0.24 + u * 0.1;
      break;
    }
    case 'ash':
      x = Math.cos(a) * (0.35 + u * 0.28 + Math.sin(u * 13) * 0.05);
      z = Math.sin(a) * (0.35 + u * 0.2);
      y = u * 0.8;
      break;
    case 'precision':
      x = (strand - 1) * 0.025;
      y = 0.4 + (u - 0.5) * 0.05;
      z = (u - 0.5) * 2;
      break;
    case 'trap':
      x = side * (0.12 + u * 0.8);
      y = Math.sin(u * Math.PI) * 0.35;
      z = (strand >> 1) * 0.22 - 0.35;
      break;
    case 'veil':
      x = side * (0.2 + u * 0.45);
      y = 1 - u;
      z = Math.sin(u * 8 + a) * 0.2 - u * 0.5;
      break;
  }
  out.x = x * p.radius * expansion;
  out.y = y * p.height;
  out.z = z * p.radius * expansion;
}
