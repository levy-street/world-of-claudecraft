import { MIREFEN_IMPACT_CRATER } from '../sim/world';

export interface ImpactCraterTerrainBlend {
  ash: number;
  scorch: number;
  dirt: number;
  rock: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function impactCraterTerrainBlend(x: number, z: number): ImpactCraterTerrainBlend {
  const d = Math.hypot(x - MIREFEN_IMPACT_CRATER.x, z - MIREFEN_IMPACT_CRATER.z);
  if (d >= MIREFEN_IMPACT_CRATER.radius) {
    return { ash: 0, scorch: 0, dirt: 0, rock: 0 };
  }

  const bowl = 1 - smoothstep(0, MIREFEN_IMPACT_CRATER.bowlRadius, d);
  const lip = smoothstep(MIREFEN_IMPACT_CRATER.bowlRadius * 0.62, MIREFEN_IMPACT_CRATER.bowlRadius, d)
    * (1 - smoothstep(MIREFEN_IMPACT_CRATER.bowlRadius, MIREFEN_IMPACT_CRATER.radius, d));
  const scorch = Math.max(bowl, lip * 0.55);

  return {
    ash: clamp01(bowl * 0.95 + lip * 0.22),
    scorch: clamp01(scorch),
    dirt: clamp01(scorch * 0.92),
    rock: clamp01(bowl * 0.32 + lip * 0.22),
  };
}
