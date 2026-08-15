// RENDER_PURE_CORES: deterministic authored environment plans. Three.js lives
// in the sibling builder; tests can pin the low-tier information contract here.

import type { DemonTowerSceneProfile } from '../sim/dungeon_layout';

export interface DemonTowerScenePlan {
  profile: DemonTowerSceneProfile;
  floorColor: number;
  floorRoughness: number;
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
    floorColor: 0x211a18,
    floorRoughness: 0.92,
    accentColor: 0xff5a18,
    secondaryAccent: 0xc88b38,
    backdropColor: 0x240805,
    backdropKind: 'forge_vault',
    ringRadii: [8.2, 17, 27.5],
    lightAnchors: [
      { x: -21, z: 9, y: 3.4, scale: 1.4 },
      { x: 21, z: 9, y: 3.4, scale: 1.4 },
      { x: 0, z: 20, y: 2.2, scale: 1.1 },
    ],
    lowTierEssentials: ['floor', 'backdrop', 'hazards', 'landmarks'],
  },
  ossuary: {
    profile: 'ossuary',
    floorColor: 0x24232c,
    floorRoughness: 0.88,
    accentColor: 0x9b63ff,
    secondaryAccent: 0x67dcff,
    backdropColor: 0x0c0b1d,
    backdropKind: 'ossuary_vault',
    ringRadii: [8.5, 17.5, 25],
    lightAnchors: [
      { x: -17, z: 0, y: 4.8, scale: 1.1 },
      { x: 17, z: 0, y: 4.8, scale: 1.1 },
      { x: 0, z: 18, y: 4.8, scale: 1.2 },
    ],
    lowTierEssentials: ['floor', 'backdrop', 'hazards', 'landmarks'],
  },
  void_crown: {
    profile: 'void_crown',
    floorColor: 0x151625,
    floorRoughness: 0.76,
    accentColor: 0xd94cff,
    secondaryAccent: 0x6f7dff,
    backdropColor: 0x09091f,
    backdropKind: 'void_storm',
    ringRadii: [7.5, 14.5, 23.5],
    lightAnchors: [
      { x: -14, z: 10, y: 3, scale: 1.2 },
      { x: 14, z: 10, y: 3, scale: 1.2 },
      { x: 0, z: -16, y: 3, scale: 1.1 },
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
