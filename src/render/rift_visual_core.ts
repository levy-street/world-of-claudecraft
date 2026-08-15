// RENDER_PURE_CORES: deterministic rift presentation decisions. Three.js and
// mutable renderer state stay in renderer.ts; this module owns the stable
// template/profile mappings that would otherwise grow that coordinator.

import type { DemonTowerSceneProfile } from '../sim/dungeon_layout';

export interface RiftLightingGrade {
  sun: number;
  hemi: number;
  env: number;
  rim: number;
}

export type RiftHazardStyle = 'lava' | 'soul' | 'void';

export const DUNGEON_SUN_INTENSITY = 0.34;
export const DUNGEON_HEMI_INTENSITY = 0.22;
export const DUNGEON_ENV_INTENSITY = 0.05;
export const DUNGEON_RIM_BOOST = 2.4;

const AUTHORED_RIFT_LIGHTING: RiftLightingGrade = Object.freeze({
  sun: 0.54,
  hemi: 0.32,
  env: 0.1,
  rim: 2.15,
});

const PROCEDURAL_RIFT_LIGHTING: RiftLightingGrade = Object.freeze({
  sun: DUNGEON_SUN_INTENSITY,
  hemi: DUNGEON_HEMI_INTENSITY,
  env: DUNGEON_ENV_INTENSITY,
  rim: DUNGEON_RIM_BOOST,
});

export const DEMON_TOWER_CORE_RENDER_HEIGHT = 6;

export function resolveRiftLightingGrade(
  authored: boolean,
  floorGrade: RiftLightingGrade | null,
): RiftLightingGrade {
  return floorGrade ?? (authored ? AUTHORED_RIFT_LIGHTING : PROCEDURAL_RIFT_LIGHTING);
}

export function riftHazardStyleForProfile(
  profile: DemonTowerSceneProfile | undefined,
): RiftHazardStyle {
  if (profile === 'ossuary') return 'soul';
  if (profile === 'void_crown') return 'void';
  return 'lava';
}

export function riftPuzzlePropRenderHeight(templateId: string): number {
  if (templateId === 'rift_tower_core') return DEMON_TOWER_CORE_RENDER_HEIGHT;
  if (templateId === 'rift_pylon' || templateId === 'rift_pylon_lit') return 4;
  if (templateId === 'rift_gate' || templateId === 'rift_gate_open') return 5.6;
  if (templateId === 'rift_roller') return 3;
  if (templateId === 'rift_infernal_orb' || templateId === 'rift_infernal_orb_active') return 2.2;
  return 2.4;
}
