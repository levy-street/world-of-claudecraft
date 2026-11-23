// The pitched-segment fit both authored towns (render/eastbrook_town.ts,
// render/fenbridge_town.ts) and the Studio's promotion of their dressing
// (editor/authored_town_dressing_placements.ts) stand a long, thin model on:
// a fence run, a wall wing, a boardwalk plank. The model follows the ground's
// slope between its two ends (the pitch) and sinks by the deepest dip under
// its footprint so no corner floats. Pure math over an injected ground
// sampler, so the render views and the editor emit byte-identical transforms.

import { BUILDING_TERRAIN_SAMPLE_STEP } from './building_layout';

type GroundAt = (x: number, z: number) => number;

export type SegmentPoint = Readonly<{ x: number; z: number }>;

export interface PitchedSegmentPlacement {
  centerX: number;
  centerY: number;
  centerZ: number;
  rotation: number;
  pitch: number;
  spatialLength: number;
  terrainOffset: number;
}

export function forEachSegmentFootprintSample(
  start: SegmentPoint,
  end: SegmentPoint,
  width: number,
  visit: (x: number, z: number, progress: number) => void,
): void {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const alongSteps = Math.max(1, Math.ceil(length / BUILDING_TERRAIN_SAMPLE_STEP));
  const acrossSteps = Math.max(1, Math.ceil(width / BUILDING_TERRAIN_SAMPLE_STEP));
  const normalX = length > 1e-8 ? -dz / length : 0;
  const normalZ = length > 1e-8 ? dx / length : 1;
  for (let along = 0; along <= alongSteps; along++) {
    const progress = along / alongSteps;
    const centerX = start.x + dx * progress;
    const centerZ = start.z + dz * progress;
    for (let across = 0; across <= acrossSteps; across++) {
      const lateral = -width / 2 + (width * across) / acrossSteps;
      visit(centerX + normalX * lateral, centerZ + normalZ * lateral, progress);
    }
  }
}

export function pitchedSegmentPlacement(
  start: SegmentPoint,
  end: SegmentPoint,
  width: number,
  groundAt: GroundAt,
): PitchedSegmentPlacement {
  const startY = groundAt(start.x, start.z);
  const endY = groundAt(end.x, end.z);
  const horizontalLength = Math.hypot(end.x - start.x, end.z - start.z);
  const deltaY = endY - startY;
  let minimumResidual = 0;
  forEachSegmentFootprintSample(start, end, width, (x, z, progress) => {
    const pitchedBottomY = startY + deltaY * progress;
    minimumResidual = Math.min(minimumResidual, groundAt(x, z) - pitchedBottomY);
  });
  return {
    centerX: (start.x + end.x) / 2,
    centerY: (startY + endY) / 2 + minimumResidual,
    centerZ: (start.z + end.z) / 2,
    rotation: Math.atan2(-(end.z - start.z), end.x - start.x),
    pitch: Math.atan2(deltaY, horizontalLength),
    spatialLength: Math.hypot(horizontalLength, deltaY),
    terrainOffset: minimumResidual,
  };
}
