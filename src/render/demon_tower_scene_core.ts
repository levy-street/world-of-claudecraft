// RENDER_PURE_CORES: deterministic authored environment plans. Three.js lives
// in the sibling builder; tests can pin the low-tier information contract here.

import type { DemonTowerSceneProfile } from '../sim/dungeon_layout';
import { DEMON_TOWER_ARENA_LINEAR_SCALE } from '../sim/rift/tower_floors';

export interface DemonTowerScenePlan {
  profile: DemonTowerSceneProfile;
  floorColor: number;
  floorRoughness: number;
  floorTextureScale: number;
  floorAccentOpacity: number;
  accentColor: number;
  secondaryAccent: number;
  backdropColor: number;
  backdropKind: 'forge_vault' | 'ossuary_vault' | 'void_storm';
  ringRadii: readonly number[];
  lightAnchors: readonly { x: number; z: number; y: number; scale: number }[];
  lowTierEssentials: readonly ('floor' | 'backdrop' | 'hazards' | 'landmarks')[];
}

const PLANS: Readonly<Record<DemonTowerSceneProfile, DemonTowerScenePlan>> = {
  bloodforge: {
    profile: 'bloodforge',
    floorColor: 0x191715,
    floorRoughness: 0.96,
    floorTextureScale: 6.5 * DEMON_TOWER_ARENA_LINEAR_SCALE,
    floorAccentOpacity: 0.18,
    accentColor: 0xa64724,
    secondaryAccent: 0x80643e,
    backdropColor: 0x240805,
    backdropKind: 'forge_vault',
    ringRadii: [8.2, 17, 27.5].map((radius) => radius * DEMON_TOWER_ARENA_LINEAR_SCALE),
    lightAnchors: [
      { x: -42, z: 18, y: 3.4, scale: 1.4 },
      { x: 42, z: 18, y: 3.4, scale: 1.4 },
      { x: 0, z: 40, y: 2.2, scale: 1.1 },
    ],
    lowTierEssentials: ['floor', 'backdrop', 'hazards', 'landmarks'],
  },
  ossuary: {
    profile: 'ossuary',
    floorColor: 0x24232c,
    floorRoughness: 0.88,
    floorTextureScale: 5.5 * DEMON_TOWER_ARENA_LINEAR_SCALE,
    floorAccentOpacity: 0.2,
    accentColor: 0x9b63ff,
    secondaryAccent: 0x67dcff,
    backdropColor: 0x0c0b1d,
    backdropKind: 'ossuary_vault',
    ringRadii: [8.5, 17.5, 25].map((radius) => radius * DEMON_TOWER_ARENA_LINEAR_SCALE),
    lightAnchors: [
      { x: -34, z: 0, y: 4.8, scale: 1.1 },
      { x: 34, z: 0, y: 4.8, scale: 1.1 },
      { x: 0, z: 36, y: 4.8, scale: 1.2 },
    ],
    lowTierEssentials: ['floor', 'backdrop', 'hazards', 'landmarks'],
  },
  void_crown: {
    profile: 'void_crown',
    floorColor: 0x191a20,
    floorRoughness: 0.76,
    floorTextureScale: 7 * DEMON_TOWER_ARENA_LINEAR_SCALE,
    floorAccentOpacity: 0.22,
    accentColor: 0xd94cff,
    secondaryAccent: 0x6f7dff,
    backdropColor: 0x09091f,
    backdropKind: 'void_storm',
    ringRadii: [7.5, 14.5, 23.5].map((radius) => radius * DEMON_TOWER_ARENA_LINEAR_SCALE),
    lightAnchors: [
      { x: -28, z: 20, y: 3, scale: 1.2 },
      { x: 28, z: 20, y: 3, scale: 1.2 },
      { x: 0, z: -32, y: 3, scale: 1.1 },
    ],
    lowTierEssentials: ['floor', 'backdrop', 'hazards', 'landmarks'],
  },
};

export function demonTowerScenePlan(profile: DemonTowerSceneProfile): DemonTowerScenePlan {
  return PLANS[profile];
}

export function demonTowerSceneProfiles(): DemonTowerSceneProfile[] {
  return ['bloodforge', 'ossuary', 'void_crown'];
}
