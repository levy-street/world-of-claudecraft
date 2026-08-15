// The authored three-floor Demon Tower contract. Gameplay systems consume this
// tuple instead of independently maintained floor counts, boss maps, scaling
// formulae and roster windows. Keeping those decisions together makes the
// promise "three distinct raids" mechanically testable.

import type { StyleSource } from './style';

export interface TowerWaveMember {
  templateId: string;
  count: number;
  /** A named lieutenant uses boss tuning/mechanics but does not own run clear. */
  lieutenant?: boolean;
}

export interface DemonTowerFloorProfile {
  id: 'bloodforge' | 'ossuary' | 'void_crown';
  name: string;
  subtitle: string;
  arena: {
    shape: 'octagon' | 'ossuary_cross' | 'void_crown';
    outerRadius: number;
    innerRadius: number;
    entryZ: number;
  };
  style: StyleSource;
  tuning: {
    healthMultiplier: number;
    damageMultiplier: number;
    addDamageMultiplier: number;
    armorMultiplier: number;
    mechanicLimit: number;
  };
  waves: readonly (readonly TowerWaveMember[])[];
  bossId: string;
  encounterSignature: readonly string[];
}

export const DEMON_TOWER_FLOORS = [
  {
    id: 'bloodforge',
    name: 'The Bloodforge',
    subtitle: 'Break the furnaces. Survive the slag.',
    arena: { shape: 'octagon', outerRadius: 32, innerRadius: 32, entryZ: -27.5 },
    style: {
      kit: 'bastion',
      sceneProfile: 'bloodforge',
      torch: { flame: 0xffa02f, emissive: 0xf04a12, light: 0xff6a1c },
      fog: { color: 0x1d0703, near: 14, far: 78 },
      wallTint: 0x3b2922,
      floorTint: 0x29211f,
      daisRaised: false,
      lighting: { sun: 1.1, hemi: 0.62, env: 0.42, rim: 1.25 },
    },
    tuning: {
      healthMultiplier: 1,
      damageMultiplier: 1,
      addDamageMultiplier: 1,
      armorMultiplier: 1,
      mechanicLimit: 2,
    },
    waves: [
      [
        { templateId: 'tower_imp', count: 4 },
        { templateId: 'tower_cinder_crawler', count: 2 },
      ],
      [
        { templateId: 'tower_hellhound', count: 4 },
        { templateId: 'tower_pact_reaver', count: 2 },
      ],
      [
        { templateId: 'tower_brimstone_zealot', count: 3 },
        { templateId: 'tower_flame_herald', count: 2 },
        { templateId: 'tower_iron_defiler', count: 1 },
      ],
      [
        { templateId: 'tower_pact_reaver', count: 3 },
        { templateId: 'tower_flame_herald', count: 2 },
      ],
    ],
    bossId: 'tower_boss_ash_tyrant',
    encounterSignature: ['slag-lanes', 'priority-heralds', 'ash-tyrant'],
  },
  {
    id: 'ossuary',
    name: 'The Ossuary of Chains',
    subtitle: 'Sever the soul chain before the dead mend.',
    arena: { shape: 'ossuary_cross', outerRadius: 31, innerRadius: 23, entryZ: -20 },
    style: {
      kit: 'crypt',
      sceneProfile: 'ossuary',
      torch: { flame: 0xb684ff, emissive: 0x6728c7, light: 0x6de5ff },
      fog: { color: 0x0c0a1d, near: 12, far: 70 },
      wallTint: 0x786e72,
      floorTint: 0x27252f,
      daisRaised: false,
      lighting: { sun: 0.82, hemi: 0.92, env: 0.55, rim: 1.45 },
    },
    tuning: {
      healthMultiplier: 2,
      damageMultiplier: 1.45,
      addDamageMultiplier: 1.3,
      armorMultiplier: 1.25,
      mechanicLimit: 3,
    },
    waves: [
      [
        { templateId: 'tower_gloom_bat', count: 4 },
        { templateId: 'tower_bone_acolyte', count: 3 },
      ],
      [
        { templateId: 'tower_shade_dancer', count: 3 },
        { templateId: 'tower_soulbinder', count: 2 },
      ],
      [
        { templateId: 'tower_rot_hulk', count: 2 },
        { templateId: 'tower_blood_matron', count: 2 },
        { templateId: 'tower_soulbinder', count: 1 },
      ],
      [
        { templateId: 'tower_void_sentinel', count: 2 },
        { templateId: 'tower_bone_acolyte', count: 3 },
      ],
    ],
    bossId: 'tower_boss_flesh_shaper',
    encounterSignature: ['soul-chasms', 'healer-kill-order', 'flesh-shaper'],
  },
  {
    id: 'void_crown',
    name: 'The Void Crown',
    subtitle: 'Defeat the Warden. End the tower.',
    arena: { shape: 'void_crown', outerRadius: 30, innerRadius: 21.5, entryZ: -18 },
    style: {
      kit: 'sanctum',
      sceneProfile: 'void_crown',
      torch: { flame: 0xe65cff, emissive: 0x8c24df, light: 0x826dff },
      fog: { color: 0x070817, near: 10, far: 92 },
      wallTint: 0x292544,
      floorTint: 0x171827,
      daisRaised: false,
      lighting: { sun: 0.72, hemi: 0.86, env: 0.66, rim: 1.8 },
    },
    tuning: {
      healthMultiplier: 4.2,
      damageMultiplier: 2,
      addDamageMultiplier: 1.65,
      armorMultiplier: 1.5,
      mechanicLimit: 4,
    },
    waves: [
      [
        { templateId: 'tower_abyss_knight', count: 3 },
        { templateId: 'tower_dread_harbinger', count: 2 },
      ],
      [
        { templateId: 'tower_void_sentinel', count: 2 },
        { templateId: 'tower_blood_matron', count: 2 },
        { templateId: 'tower_shade_dancer', count: 2 },
      ],
      [
        { templateId: 'tower_dread_harbinger', count: 3 },
        { templateId: 'tower_soulbinder', count: 2 },
      ],
      [{ templateId: 'tower_boss_gatekeeper', count: 1, lieutenant: true }],
      [
        { templateId: 'tower_abyss_knight', count: 2 },
        { templateId: 'tower_void_sentinel', count: 2 },
      ],
    ],
    bossId: 'tower_boss_demon_lord',
    encounterSignature: ['fracture-sectors', 'warden-lieutenant', 'rift-collapse'],
  },
] as const satisfies readonly DemonTowerFloorProfile[];

export type DemonTowerFloorId = (typeof DEMON_TOWER_FLOORS)[number]['id'];

export function demonTowerFloorProfile(floorIndex: number): DemonTowerFloorProfile {
  if (!Number.isFinite(floorIndex)) return DEMON_TOWER_FLOORS[0];
  const k = Math.max(0, Math.min(DEMON_TOWER_FLOORS.length - 1, Math.floor(floorIndex)));
  return DEMON_TOWER_FLOORS[k];
}
