import type { ZonePropsDef } from './types';

// Shared analytic layout for the three rendered dock-platform sections. Keep
// this leaf free of world/renderer imports: the sim heightfield, prop renderer,
// and footstep routing all consume the same dimensions.

export type DockDef = ZonePropsDef['docks'][number];

export const DOCK_SECTION_LOCAL_Z = [-1.05, -3.18, -5.31] as const;
export const DOCK_SECTION_HALF_WIDTH = 0.98;
export const DOCK_SECTION_HALF_DEPTH = 1.07;
export const DOCK_SECTION_TERRAIN_CLEARANCE = 0.15;

// The asset is normalized to min-y 0 and rendered at y-scale 0.52. Its plank
// top is 0.70 asset units above the normalized base, yielding ~0.36 world yd.
// The taller post tops are decoration, not walkable ground.
export const DOCK_SECTION_SURFACE_Y = 0.36;

export interface DockSurfaceLine {
  nearLocalZ: number;
  nearY: number;
  slope: number;
}

export function dockLocalPoint(dock: DockDef, x: number, z: number): { x: number; z: number } {
  const dx = x - dock.x;
  const dz = z - dock.z;
  const cos = Math.cos(dock.rot);
  const sin = Math.sin(dock.rot);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

export function dockSectionAt(dock: DockDef, x: number, z: number): number {
  const local = dockLocalPoint(dock, x, z);
  return dockSectionAtLocal(local.x, local.z);
}

export function dockSectionAtLocal(localX: number, localZ: number): number {
  if (Math.abs(localX) > DOCK_SECTION_HALF_WIDTH) return -1;

  let closest = -1;
  let closestDistance = Infinity;
  for (let i = 0; i < DOCK_SECTION_LOCAL_Z.length; i++) {
    const distance = Math.abs(localZ - DOCK_SECTION_LOCAL_Z[i]);
    if (distance <= DOCK_SECTION_HALF_DEPTH && distance < closestDistance) {
      closest = i;
      closestDistance = distance;
    }
  }
  return closest;
}

export function dockSectionWorldCenter(
  dock: DockDef,
  sectionIndex: number,
): { x: number; z: number } {
  const localZ = DOCK_SECTION_LOCAL_Z[sectionIndex];
  return {
    x: dock.x + localZ * Math.sin(dock.rot),
    z: dock.z + localZ * Math.cos(dock.rot),
  };
}

// The three platform assets share one continuous plank plane. Its endpoints
// retain the shore-seating rule, while the middle section follows the line
// between them so a mover never meets an invisible vertical step at a join.
export function dockSurfaceLine(
  dock: DockDef,
  terrainAt: (x: number, z: number) => number,
): DockSurfaceLine {
  const anchorY = terrainAt(dock.x, dock.z);
  const sectionSurfaceY = (sectionIndex: number): number => {
    const center = dockSectionWorldCenter(dock, sectionIndex);
    const centerY = terrainAt(center.x, center.z);
    const baseY = anchorY + Math.min(0, centerY - anchorY + DOCK_SECTION_TERRAIN_CLEARANCE);
    return baseY + DOCK_SECTION_SURFACE_Y;
  };
  const farIndex = DOCK_SECTION_LOCAL_Z.length - 1;
  const nearLocalZ = DOCK_SECTION_LOCAL_Z[0];
  const farLocalZ = DOCK_SECTION_LOCAL_Z[farIndex];
  const nearY = sectionSurfaceY(0);
  const farY = sectionSurfaceY(farIndex);
  return {
    nearLocalZ,
    nearY,
    slope: (farY - nearY) / (farLocalZ - nearLocalZ),
  };
}

export function dockSurfaceYAt(line: DockSurfaceLine, localZ: number): number {
  return line.nearY + (localZ - line.nearLocalZ) * line.slope;
}
