import { FLUID_ASSET_IDS } from '../sim/fluid_volumes';
import { MAX_WORLD_COORD, type MapPlacement } from '../sim/map_doc';
import type { HeightStamp } from '../sim/types';
import type { HeightSampler } from './stamp_core';

export const POND_RADIUS_MIN = 2;
export const POND_RADIUS_MAX = 60;
export const POND_DEPTH_MIN = 0.5;
export const POND_DEPTH_MAX = 8;
export const DEFAULT_POND_RADIUS = 8;
export const DEFAULT_POND_DEPTH = 2;
export const POND_BANK_RADIUS_FACTOR = 1.4;

export interface PondOptions {
  x: number;
  z: number;
  radius: number;
  depth: number;
}

export interface PondRegion {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PondPlan {
  stamps: HeightStamp[];
  water: MapPlacement;
  region: PondRegion;
  surfaceY: number;
}

/** A local decorative pond. The existing fluid volume renders independently
 *  of the map-wide sea level and does not enable the sea swimming system.
 *  A level bank buries the complete water-disc edge even on sloped terrain;
 *  the wider soft edge blends that bank back into the surrounding landscape. */
export function planPond(options: PondOptions, sampleHeight: HeightSampler): PondPlan | null {
  if (![options.x, options.z, options.radius, options.depth].every(Number.isFinite)) return null;
  const { x, z } = options;
  const radius = Math.max(POND_RADIUS_MIN, Math.min(POND_RADIUS_MAX, options.radius));
  const depth = Math.max(POND_DEPTH_MIN, Math.min(POND_DEPTH_MAX, options.depth));
  const bankRadius = radius * POND_BANK_RADIUS_FACTOR;
  if (Math.abs(x) + bankRadius > MAX_WORLD_COORD || Math.abs(z) + bankRadius > MAX_WORLD_COORD)
    return null;
  const rimY = sampleHeight(x, z);
  const floorY = rimY - depth;
  // Level targets are saved in HeightStamp.delta, sanitized to [-200, 200].
  // Refuse a plan that would silently change its terrain after saving.
  if (!Number.isFinite(rimY) || rimY > 200 || floorY < -200) return null;
  const surfaceY = rimY - Math.min(0.25, depth * 0.25);
  return {
    stamps: [
      {
        x,
        z,
        radius: bankRadius,
        delta: rimY,
        mode: 'level',
        shape: 'circle',
        hardness: radius / bankRadius,
        falloff: 'smooth',
      },
      {
        x,
        z,
        radius,
        delta: floorY,
        mode: 'level',
        shape: 'circle',
        hardness: 0,
        falloff: 'smooth',
      },
    ],
    water: {
      assetId: FLUID_ASSET_IDS.water,
      x,
      z,
      rotY: 0,
      scale: 1,
      collide: false,
      sizeX: radius * 2,
      sizeZ: radius * 2,
      // Fluid surface height is relative to the FINAL terrain at its center.
      sizeY: surfaceY - floorY,
      fluidDps: 0,
      fluidFx: 0,
    },
    region: {
      minX: x - bankRadius,
      maxX: x + bankRadius,
      minZ: z - bankRadius,
      maxZ: z + bankRadius,
    },
    surfaceY,
  };
}

/** Verify the completed terrain before retaining the edit. Authored world
 *  pads can override stamps after evaluation, leaving a pond floating above
 *  its intended basin. The caller undoes the whole command on a failed check. */
export function pondTerrainMatches(plan: PondPlan, sampleHeight: HeightSampler): boolean {
  const { water, surfaceY } = plan;
  const halfX = ((water.sizeX ?? 0) * water.scale) / 2;
  const halfZ = ((water.sizeZ ?? 0) * water.scale) / 2;
  const floorY = surfaceY - (water.sizeY ?? NaN);
  if (![water.x, water.z, water.rotY, halfX, halfZ, floorY, surfaceY].every(Number.isFinite))
    return false;
  if (halfX <= 0 || halfZ <= 0) return false;
  const centerY = sampleHeight(water.x, water.z);
  const tolerance = 0.01;
  if (!Number.isFinite(centerY) || Math.abs(centerY - floorY) > tolerance) return false;
  const cos = Math.cos(water.rotY);
  const sin = Math.sin(water.rotY);
  for (let step = 0; step < 16; step++) {
    const angle = (step * Math.PI * 2) / 16;
    const dx = Math.cos(angle) * halfX;
    const dz = Math.sin(angle) * halfZ;
    const rimY = sampleHeight(water.x + dx * cos + dz * sin, water.z - dx * sin + dz * cos);
    if (!Number.isFinite(rimY) || rimY + tolerance < surfaceY) return false;
  }
  return true;
}
