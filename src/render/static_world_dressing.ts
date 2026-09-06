// The world-spanning static dressing the renderer attaches once at boot,
// each entry through attachZoneFeature (so the distance cull and the gated
// program link apply): the Duskfall cave mouths (built by the caller, which
// also drives their occluder fade each frame), lily-and-reed water flora on
// every temperate lake, the Farshore's palm strand, and the waystone arches
// (one cull group per arch: its two sides stand zones apart).
// A new world-wide static feature is a new entry here, never another inline
// builder in renderer.ts.

import type * as THREE from 'three';
import { buildFarshoreFeatures } from './farshore_features';
import { buildWaterFlora } from './water_flora';
import { buildWaystonePortals } from './waystone_portals';

export interface StaticWorldDressing {
  group: THREE.Group;
  glowLights?: THREE.PointLight[];
  cullGroups?: THREE.Group[];
}

export function buildStaticWorldDressing(
  hollowGates: StaticWorldDressing,
  seed: number,
  lowGfx: boolean,
): StaticWorldDressing[] {
  return [
    hollowGates,
    buildWaterFlora(seed),
    buildFarshoreFeatures(seed),
    buildWaystonePortals(seed, lowGfx),
  ];
}
