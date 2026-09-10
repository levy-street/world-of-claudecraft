import type { MobTemplate } from '../types';

// The Eastbrook Healing Training Ground: an array of injured practice allies
// for healers to test single-target triage, HoTs, shields, and AoE healing
// rotations.
//
// Each dummy has a high health pool (40k to 80k HP) and a low resting health
// fraction (15% to 30%), simulating a severely wounded 5-man dungeon party.
// When healed, their HP rises; when healing ceases, they shed health back down
// toward their resting health so practice can continue indefinitely without the
// dummies ever dying or getting stuck at 100% full health.

export const HEALING_DUMMY_TANK_ID = 'healing_dummy_tank';
export const HEALING_DUMMY_SOLDIER_ID = 'healing_dummy_soldier';
export const HEALING_DUMMY_SCOUT_ID = 'healing_dummy_scout';
export const HEALING_DUMMY_CASTER_ID = 'healing_dummy_caster';
export const HEALING_DUMMY_RANGER_ID = 'healing_dummy_ranger';

export const HEALING_DUMMY_IDS = [
  HEALING_DUMMY_TANK_ID,
  HEALING_DUMMY_SOLDIER_ID,
  HEALING_DUMMY_SCOUT_ID,
  HEALING_DUMMY_CASTER_ID,
  HEALING_DUMMY_RANGER_ID,
] as const;

const DUMMY_BASE = {
  family: 'humanoid',
  dmgBase: 0,
  dmgPerLevel: 0,
  moveSpeed: 0,
  aggroRadius: 0,
  loot: [],
  dummy: true,
  friendlyPracticeTarget: true,
  respawnSeconds: 10,
  minLevel: 20,
  maxLevel: 20,
  hpPerLevel: 0,
  armorPerLevel: 0,
} as const satisfies Partial<MobTemplate>;

export const HEALING_TRAINING_MOBS: Record<string, MobTemplate> = {
  [HEALING_DUMMY_TANK_ID]: {
    ...DUMMY_BASE,
    id: HEALING_DUMMY_TANK_ID,
    name: 'Injured Vanguard Dummy',
    hpBase: 80000,
    restHpFraction: 0.2, // 16,000 / 80,000 (20% HP)
    scale: 1.5,
    color: 0x55aa55,
    attackSpeed: 2.0,
  },
  [HEALING_DUMMY_SOLDIER_ID]: {
    ...DUMMY_BASE,
    id: HEALING_DUMMY_SOLDIER_ID,
    name: 'Injured Soldier Dummy',
    hpBase: 50000,
    restHpFraction: 0.2, // 10,000 / 50,000 (20% HP)
    scale: 1.4,
    color: 0x74c476,
    attackSpeed: 2.0,
  },
  [HEALING_DUMMY_SCOUT_ID]: {
    ...DUMMY_BASE,
    id: HEALING_DUMMY_SCOUT_ID,
    name: 'Critical Scout Dummy',
    hpBase: 45000,
    restHpFraction: 0.15, // 6,750 / 45,000 (15% HP - critical)
    scale: 1.35,
    color: 0x74c476,
    attackSpeed: 2.0,
  },
  [HEALING_DUMMY_CASTER_ID]: {
    ...DUMMY_BASE,
    id: HEALING_DUMMY_CASTER_ID,
    name: 'Wounded Spellcaster Dummy',
    hpBase: 40000,
    restHpFraction: 0.25, // 10,000 / 40,000 (25% HP)
    scale: 1.35,
    color: 0x74c476,
    attackSpeed: 2.0,
  },
  [HEALING_DUMMY_RANGER_ID]: {
    ...DUMMY_BASE,
    id: HEALING_DUMMY_RANGER_ID,
    name: 'Battered Ranger Dummy',
    hpBase: 45000,
    restHpFraction: 0.3, // 13,500 / 45,000 (30% HP)
    scale: 1.4,
    color: 0x74c476,
    attackSpeed: 2.0,
  },
};

export const HEALING_TRAINING_GROUND_SPAWNS = [
  { mobId: HEALING_DUMMY_TANK_ID, pos: { x: -76, z: -50 } },
  { mobId: HEALING_DUMMY_SOLDIER_ID, pos: { x: -76, z: -46 } },
  { mobId: HEALING_DUMMY_SCOUT_ID, pos: { x: -76, z: -42 } },
  { mobId: HEALING_DUMMY_CASTER_ID, pos: { x: -76, z: -38 } },
  { mobId: HEALING_DUMMY_RANGER_ID, pos: { x: -76, z: -34 } },
] as const;
