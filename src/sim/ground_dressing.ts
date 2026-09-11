import {
  activeZoneAt,
  CAMPS,
  getActiveWorldContent,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from './data';
import type { BiomeId } from './types';
import { roadDistance, terrainCutAtHeight, terrainHeight, WATER_LEVEL, zoneBiomeAt } from './world';

export type GroundDressingKind = 'bush' | 'bushFlowers' | 'fern' | 'mushroom';

export interface GroundDressingSpot {
  x: number;
  z: number;
  kind: GroundDressingKind;
  scale: number;
}

export interface GroundDressingBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const DRESS_STEP_HIGH = 12;
const DRESS_STEP_LOW = 10;
const DRESS_DENSITY: Record<BiomeId, number> = {
  vale: 0.26,
  marsh: 0.26,
  peaks: 0.15,
  beach: 0.1,
  desert: 0.07,
  volcano: 0.05,
  cave: 0.08,
  dusk: 0.24,
  ember: 0.18,
  frost: 0.08,
  amber: 0.34,
  fen: 0.38,
  night: 0.32,
  haunt: 0.3,
  jungle: 0.5,
  garden: 0.4,
  gale: 0.32,
};
const DRESS_DENSITY_LOW_SCALE = 1.24;
const DRESS_LOW_SCALE_BOOST = 1.08;
const DRESS_SCALE: Record<GroundDressingKind, [number, number]> = {
  bush: [0.9, 0.7],
  bushFlowers: [0.9, 0.7],
  fern: [0.85, 0.6],
  mushroom: [0.9, 0.8],
};
const SLOPE_EPS = 1.2;
const MAX_SLOPE = 0.62;

/** Mushrooms are deliberate signature flora in these three regions only. */
const MUSHROOM_ZONE_IDS = new Set(['nightbloom', 'veiled_hollow', 'wraithwood']);

export function mushroomsAllowedAt(x: number, z: number): boolean {
  return MUSHROOM_ZONE_IDS.has(activeZoneAt(x, z).id);
}

function hashAt(a: number, b: number, salt: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function kindFor(biome: BiomeId, r: number): GroundDressingKind {
  if (biome === 'vale') {
    if (r < 0.36) return 'bush';
    if (r < 0.46) return 'bushFlowers';
    if (r < 0.8) return 'fern';
    return 'mushroom';
  }
  if (biome === 'marsh') {
    if (r < 0.3) return 'bush';
    if (r < 0.62) return 'fern';
    return 'mushroom';
  }
  if (biome === 'beach' || biome === 'desert' || biome === 'volcano') return 'bush';
  if (biome === 'cave') return r < 0.5 ? 'mushroom' : 'fern';
  if (biome === 'dusk') {
    if (r < 0.12) return 'bush';
    if (r < 0.34) return 'bushFlowers';
    if (r < 0.78) return 'fern';
    return 'mushroom';
  }
  if (biome === 'fen') {
    if (r < 0.08) return 'bush';
    if (r < 0.48) return 'bushFlowers';
    if (r < 0.72) return 'fern';
    return 'mushroom';
  }
  if (biome === 'amber') {
    if (r < 0.1) return 'bush';
    if (r < 0.52) return 'bushFlowers';
    if (r < 0.86) return 'fern';
    return 'mushroom';
  }
  if (biome === 'night') {
    if (r < 0.08) return 'bush';
    if (r < 0.56) return 'bushFlowers';
    if (r < 0.76) return 'fern';
    return 'mushroom';
  }
  if (biome === 'haunt') {
    if (r < 0.24) return 'bush';
    if (r < 0.6) return 'fern';
    return 'mushroom';
  }
  if (biome === 'jungle') {
    if (r < 0.16) return 'bush';
    if (r < 0.38) return 'bushFlowers';
    if (r < 0.88) return 'fern';
    return 'mushroom';
  }
  if (biome === 'garden') {
    if (r < 0.12) return 'bush';
    if (r < 0.52) return 'bushFlowers';
    if (r < 0.82) return 'fern';
    return 'mushroom';
  }
  if (biome === 'gale') {
    if (r < 0.3) return 'bush';
    if (r < 0.62) return 'bushFlowers';
    if (r < 0.9) return 'fern';
    return 'mushroom';
  }
  return r < 0.62 ? 'bush' : 'fern';
}

function tooSteep(x: number, z: number, seed: number): boolean {
  const hx = terrainHeight(x + SLOPE_EPS, z, seed) - terrainHeight(x - SLOPE_EPS, z, seed);
  const hz = terrainHeight(x, z + SLOPE_EPS, seed) - terrainHeight(x, z - SLOPE_EPS, seed);
  return Math.hypot(hx, hz) / (2 * SLOPE_EPS) > MAX_SLOPE;
}

export function groundDressingKey(spot: Pick<GroundDressingSpot, 'kind' | 'x' | 'z'>): string {
  return `dress:${spot.kind}:${spot.x.toFixed(3)}:${spot.z.toFixed(3)}`;
}

/** The exact deterministic ground-dressing field used by render and editor. */
export function generateGroundDressing(
  seed: number,
  options: { leanFoliage?: boolean; bounds?: GroundDressingBounds } = {},
): GroundDressingSpot[] {
  const world = getActiveWorldContent();
  if (world.decorationsMode === 'empty') return [];
  const out: GroundDressingSpot[] = [];
  const lean = options.leanFoliage === true;
  const step = lean ? DRESS_STEP_LOW : DRESS_STEP_HIGH;
  const scaleBoost = lean ? DRESS_LOW_SCALE_BOOST : 1;
  const xStart = -(WORLD_MAX_X - 16);
  const xEnd = WORLD_MAX_X - 16;
  const zStart = WORLD_MIN_Z + 16;
  const zEnd = WORLD_MAX_Z - 16;
  const bounds = options.bounds;
  const firstX = bounds
    ? xStart + Math.max(0, Math.floor((bounds.minX - step / 2 - xStart) / step)) * step
    : xStart;
  const firstZ = bounds
    ? zStart + Math.max(0, Math.floor((bounds.minZ - step / 2 - zStart) / step)) * step
    : zStart;
  const excluded = new Set(world.decorationExclusions ?? []);
  for (let gx = firstX; gx < xEnd; gx += step) {
    if (bounds && gx > bounds.maxX + step / 2) break;
    for (let gz = firstZ; gz < zEnd; gz += step) {
      if (bounds && gz > bounds.maxZ + step / 2) break;
      const r = hashAt(gx, gz, 41);
      const biome = zoneBiomeAt(gx, gz);
      const density = DRESS_DENSITY[biome] * (lean ? DRESS_DENSITY_LOW_SCALE : 1);
      if (r > density) continue;
      const x = gx + (hashAt(gx, gz, 42) - 0.5) * step;
      const z = gz + (hashAt(gx, gz, 43) - 0.5) * step;
      if (bounds && (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ)) {
        continue;
      }
      let blocked = false;
      for (const zone of ZONES) {
        if (Math.hypot(x - zone.hub.x, z - zone.hub.z) < zone.hub.radius + 4) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      for (const camp of CAMPS) {
        if (Math.hypot(x - camp.center.x, z - camp.center.z) < camp.radius + 2) {
          blocked = true;
          break;
        }
      }
      const dressH = terrainHeight(x, z, seed);
      if (
        blocked ||
        roadDistance(x, z) < 4 ||
        dressH < WATER_LEVEL + 1.2 ||
        // a boolean cut removes the ground: nothing to gather over the void
        terrainCutAtHeight(x, z, dressH) ||
        tooSteep(x, z, seed)
      ) {
        continue;
      }
      const kind = kindFor(biome, hashAt(gx, gz, 44));
      if (kind === 'mushroom' && !mushroomsAllowedAt(x, z)) continue;
      const [scaleMin, scaleRange] = DRESS_SCALE[kind];
      const spot = {
        x,
        z,
        kind,
        scale: (scaleMin + hashAt(gx, gz, 45) * scaleRange) * scaleBoost,
      };
      if (!excluded.has(groundDressingKey(spot))) out.push(spot);
    }
  }
  return out;
}
