import { buildWarriorBlade, type warriorBladePoint } from './warrior_blade_shape';

export type WarriorHeavyShape = 'steel_chop' | 'steel_counter' | 'steel_execution';
type Sample = typeof warriorBladePoint;

/** Compression, a returning hook, and a torn execution cleaver have separate
 * leading paths. The same functions feed their mesh and contact ribbons. */
export const WARRIOR_HEAVY_POINTS: Readonly<Record<WarriorHeavyShape, Sample>> = {
  steel_chop(u, v, out) {
    const taper = Math.sin(Math.PI * u);
    out.x = (u - 0.5) * 4.4;
    out.y = 0.26 * taper - v * taper * (1.25 + 0.3 * u);
    out.z = 0.32 * taper - v * taper * 0.75;
  },
  steel_counter(u, v, out) {
    const theta = -2.35 + u * 3.9;
    const taper = Math.sin(Math.PI * u);
    const radius = 2.2 - v * taper * 0.62;
    out.x = Math.sin(theta) * radius;
    out.y = Math.cos(theta) * (1.25 - v * taper * 0.58) - 0.2;
    out.z = taper * (0.85 - v * 0.9);
  },
  steel_execution(u, v, out) {
    const taper = Math.sin(Math.PI * u);
    const tooth = 1 - Math.abs(((u * 6) % 1) * 2 - 1);
    out.x = (u - 0.5) * 4.4;
    out.y = 0.45 * taper - 0.22 * u - v * taper * (1.55 + tooth * v * 0.42);
    out.z = taper * (0.6 - v * 0.95);
  },
};

export function buildWarriorHeavyShape(kind: WarriorHeavyShape) {
  return buildWarriorBlade(WARRIOR_HEAVY_POINTS[kind], kind === 'steel_execution' ? [16, 26] : []);
}
