import type { EquipmentPowerDefinition } from '../equipment/equipment_effect_types';
import type { PlayerClass } from '../types';
import type { ProceduralItemBase } from './procedural_loot/types';

const HEALING_PERCENT_ROLL = { min: 14, max: 20, step: 1 } as const;

export const PROCEDURAL_LEGENDARY_POWERS = {
  crown_last_pyre: {
    id: 'crown_last_pyre',
    revision: 1,
    name: 'Crown of the Last Pyre',
    description: 'Every third Cinderbolt scorches enemies near the target.',
    requiredClass: 'mage',
    trigger: { event: 'ability_cast', abilityIds: ['fireball'], every: 3 },
    rolls: { potencyPct: { min: 29, max: 34, step: 1 } },
    effects: [
      {
        kind: 'area_damage',
        target: 'area_around_target',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        radius: 4,
        maxTargets: 4,
        tag: 'fire',
      },
    ],
  },
  greyjaws_edge: {
    id: 'greyjaws_edge',
    revision: 1,
    name: "Greyjaw's Edge",
    description: 'Every third weapon hit bleeds the target and restores a little resource.',
    requiredClass: 'warrior',
    trigger: { event: 'weapon_hit', every: 3 },
    rolls: { potencyPct: { min: 38, max: 40, step: 1 } },
    effects: [
      {
        kind: 'apply_dot',
        target: 'event_target',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        durationMs: 6000,
        intervalMs: 2000,
        tag: 'bleed',
      },
      {
        kind: 'restore_resource',
        target: 'self',
        magnitude: { base: 4 },
        tag: 'primary',
      },
    ],
  },
  hushwood_longbow: {
    id: 'hushwood_longbow',
    revision: 1,
    name: 'Hushwood Longbow',
    description: 'Long Draw or Fell Shot can briefly silence its target.',
    requiredClass: 'hunter',
    trigger: {
      event: 'ability_cast',
      abilityIds: ['aimed_shot', 'arcane_shot'],
      chance: 0.25,
      internalCooldownMs: 8000,
    },
    rolls: { durationMs: { min: 800, max: 1200, step: 100 } },
    effects: [
      {
        kind: 'apply_silence',
        target: 'event_target',
        magnitude: { rollKey: 'durationMs' },
        durationMs: 1000,
        tag: 'silence',
      },
    ],
  },
  nightglass_fang: {
    id: 'nightglass_fang',
    revision: 1,
    name: 'Nightglass Fang',
    description: 'A kill grants a short burst of haste.',
    requiredClass: 'rogue',
    trigger: { event: 'kill', internalCooldownMs: 8000 },
    rolls: { potencyPct: { min: 10, max: 14, step: 1 } },
    effects: [
      {
        kind: 'grant_buff',
        target: 'self',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        durationMs: 4000,
        tag: 'haste',
      },
    ],
  },
  ysoleis_vigil: {
    id: 'ysoleis_vigil',
    revision: 1,
    name: "Ysolei's Vigil",
    description: 'Critical healing creates a brief restorative ground area.',
    requiredClass: 'priest',
    trigger: { event: 'heal', criticalOnly: true, internalCooldownMs: 8000 },
    rolls: { potencyPct: HEALING_PERCENT_ROLL },
    effects: [
      {
        kind: 'create_ground_area',
        target: 'area_around_target',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        durationMs: 4000,
        intervalMs: 1000,
        radius: 4,
        maxTargets: 5,
        tag: 'healing',
      },
    ],
  },
  stormwake_idol: {
    id: 'stormwake_idol',
    revision: 1,
    name: 'Stormwake Idol',
    description: 'Every fourth Arc Bolt arcs to nearby enemies.',
    requiredClass: 'shaman',
    trigger: { event: 'ability_cast', abilityIds: ['lightning_bolt'], every: 4 },
    rolls: { potencyPct: { min: 22, max: 30, step: 1 } },
    effects: [
      {
        kind: 'chain_damage',
        target: 'event_target',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        maxTargets: 3,
        tag: 'nature',
      },
    ],
  },
  ashbinders_seal: {
    id: 'ashbinders_seal',
    revision: 1,
    name: "Ashbinder's Seal",
    description: 'Every fourth Gloom Bolt marks its target for added Shadow damage.',
    requiredClass: 'warlock',
    trigger: { event: 'ability_cast', abilityIds: ['shadow_bolt'], every: 4 },
    rolls: { potencyPct: { min: 15, max: 20, step: 1 } },
    effects: [
      {
        kind: 'apply_mark',
        target: 'event_target',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        durationMs: 6000,
        tag: 'shadow',
      },
    ],
  },
  dawnward_signet: {
    id: 'dawnward_signet',
    revision: 1,
    name: 'Dawnward Signet',
    description: 'Mending Light shields its recipient for a portion of the heal.',
    requiredClass: 'paladin',
    trigger: { event: 'ability_cast', abilityIds: ['holy_light'], internalCooldownMs: 6000 },
    rolls: { potencyPct: { min: 16, max: 22, step: 1 } },
    effects: [
      {
        kind: 'grant_shield',
        target: 'event_target',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        durationMs: 6000,
        tag: 'holy',
      },
    ],
  },
  feral_moonclasp: {
    id: 'feral_moonclasp',
    revision: 1,
    name: 'Feral Moonclasp',
    description: 'Every third Lunar Tempest restores primary resource.',
    requiredClass: 'druid',
    trigger: { event: 'ability_cast', abilityIds: ['moonfire'], every: 3 },
    rolls: { resource: { min: 4, max: 7, step: 1 } },
    effects: [
      {
        kind: 'restore_resource',
        target: 'self',
        magnitude: { rollKey: 'resource' },
        tag: 'primary',
      },
    ],
  },
  bell_of_the_ninth_peal: {
    id: 'bell_of_the_ninth_peal',
    revision: 1,
    name: 'Bell of the Ninth Peal',
    description: 'Every second damaging spell tolls around the target.',
    compatibleBaseIds: ['ashwood_staff', 'gravecaller_cloth_hood'],
    trigger: { event: 'spell_damage', every: 2 },
    rolls: { potencyPct: { min: 25, max: 29, step: 1 } },
    effects: [
      {
        kind: 'area_damage',
        target: 'area_around_target',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        radius: 5,
        maxTargets: 5,
        tag: 'arcane',
      },
    ],
  },
  mantle_of_borrowed_time: {
    id: 'mantle_of_borrowed_time',
    revision: 1,
    name: 'Mantle of Stolen Hours',
    description: 'Falling below 35% health grants a brief defensive ward.',
    trigger: {
      event: 'health_changed',
      healthCrossing: { direction: 'below', fraction: 0.35 },
      internalCooldownMs: 45000,
    },
    rolls: { potencyPct: { min: 14, max: 20, step: 1 } },
    effects: [
      {
        kind: 'grant_buff',
        target: 'self',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        durationMs: 5000,
        tag: 'damage_reduction',
      },
    ],
  },
  boots_of_the_unbroken_road: {
    id: 'boots_of_the_unbroken_road',
    revision: 1,
    name: 'Boots of the Unbroken Road',
    description: 'Moving 15 yards grants a short movement-speed burst.',
    trigger: {
      event: 'movement',
      accumulatedMovement: 15,
      internalCooldownMs: 6000,
    },
    rolls: { potencyPct: { min: 8, max: 12, step: 1 } },
    effects: [
      {
        kind: 'grant_buff',
        target: 'self',
        magnitude: { rollKey: 'potencyPct', rollScale: 0.01 },
        durationMs: 2500,
        tag: 'movement_speed',
      },
    ],
  },
} as const satisfies Readonly<Record<string, EquipmentPowerDefinition>>;

export type ProceduralLegendaryPowerId = keyof typeof PROCEDURAL_LEGENDARY_POWERS;

export const PROCEDURAL_LEGENDARY_POWER_IDS = Object.freeze(
  Object.keys(PROCEDURAL_LEGENDARY_POWERS) as ProceduralLegendaryPowerId[],
);

export function proceduralLegendaryPower(id: string): EquipmentPowerDefinition | undefined {
  return PROCEDURAL_LEGENDARY_POWERS[id as ProceduralLegendaryPowerId];
}

export function proceduralLegendaryPowerCompatibleWithBase(
  power: EquipmentPowerDefinition,
  base: ProceduralItemBase,
  personalLootClass?: PlayerClass,
): boolean {
  if (power.compatibleBaseIds && !power.compatibleBaseIds.includes(base.id)) return false;
  if (!power.requiredClass) return true;
  if (personalLootClass && power.requiredClass !== personalLootClass) return false;
  return !base.requiredClass || base.requiredClass.includes(power.requiredClass);
}
