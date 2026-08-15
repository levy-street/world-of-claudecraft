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

export type RiftHazardStyle = 'lava' | 'tower_lava' | 'soul' | 'void';

export interface RiftHazardPalette {
  pool: number;
  poolOpacity: number;
  rim: number;
  rimOpacity: number;
  glow: number;
  poolY: number;
  rimY: number;
  glowY: number;
}

const RIFT_HAZARD_PALETTES: Readonly<Record<RiftHazardStyle, RiftHazardPalette>> = {
  lava: {
    pool: 0xd83410,
    poolOpacity: 0.9,
    rim: 0xffca4a,
    rimOpacity: 0.5,
    glow: 0xff5a1e,
    poolY: 0.12,
    rimY: 0.14,
    glowY: 0.55,
  },
  tower_lava: {
    pool: 0x1b1917,
    poolOpacity: 0.7,
    rim: 0x8f6a46,
    rimOpacity: 0.28,
    glow: 0x5f3425,
    poolY: 0.012,
    rimY: 0.014,
    glowY: 0.016,
  },
  soul: {
    pool: 0x221247,
    poolOpacity: 0.9,
    rim: 0x73e7ff,
    rimOpacity: 0.5,
    glow: 0x9b63ff,
    poolY: 0.12,
    rimY: 0.14,
    glowY: 0.3,
  },
  void: {
    pool: 0x160c32,
    poolOpacity: 0.92,
    rim: 0xf05cff,
    rimOpacity: 0.5,
    glow: 0x806dff,
    poolY: 0.12,
    rimY: 0.14,
    glowY: 0.3,
  },
};

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
  if (profile === 'bloodforge') return 'tower_lava';
  if (profile === 'ossuary') return 'soul';
  if (profile === 'void_crown') return 'void';
  return 'lava';
}

export function riftHazardPalette(style: RiftHazardStyle): RiftHazardPalette {
  return RIFT_HAZARD_PALETTES[style];
}

export function riftPuzzlePropRenderHeight(templateId: string): number {
  if (templateId === 'rift_tower_core') return DEMON_TOWER_CORE_RENDER_HEIGHT;
  if (templateId === 'rift_pylon' || templateId === 'rift_pylon_lit') return 4;
  if (templateId === 'rift_gate' || templateId === 'rift_gate_open') return 5.6;
  if (templateId === 'rift_roller') return 3;
  if (templateId === 'rift_infernal_orb' || templateId === 'rift_infernal_orb_active') return 2.2;
  return 2.4;
}
