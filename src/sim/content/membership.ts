import type { CoreStats, ItemDef, PlayerClass } from '../types';

export const MEMBERSHIP_TOKEN_ID = 'membership_token';
export const MEMBERSHIP_DURATION_SECONDS = 30 * 24 * 60 * 60;
export const MEMBERSHIP_XP_MULTIPLIER = 1.2;
export const MEMBERSHIP_ARMOUR_SLOTS = [
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
] as const;
export const MEMBERSHIP_ARMOUR_NAMES = [
  'Membership Helm',
  'Membership Pauldrons',
  'Membership Cuirass',
  'Membership Girdle',
  'Membership Legguards',
  'Membership Gauntlets',
  'Membership Boots',
] as const;

// Primary identities follow the shipped raid collection profiles. Tank stamina
// spends the ordinary stat line, and caster stamina follows the shared baseline.
export const MEMBERSHIP_PROFILES: Readonly<Record<string, Partial<CoreStats>>> = {
  strength: { str: 17, sta: 8 },
  agility: { agi: 17, sta: 8 },
  tank: { str: 10, sta: 15 },
  bear: { agi: 10, sta: 15 },
  caster: { int: 17, spi: 8 },
  healer: { int: 12, spi: 13 },
};
export const MEMBERSHIP_DEFAULT_PROFILE: Readonly<Record<PlayerClass, string>> = {
  warrior: 'strength',
  paladin: 'strength',
  hunter: 'agility',
  rogue: 'agility',
  priest: 'caster',
  shaman: 'caster',
  mage: 'caster',
  warlock: 'caster',
  druid: 'caster',
};
export const MEMBERSHIP_SPEC_PROFILE: Readonly<Record<string, string>> = {
  warrior_prot: 'tank',
  paladin_protection: 'tank',
  paladin_holy: 'healer',
  priest_discipline: 'healer',
  priest_holy: 'healer',
  shaman_enhancement: 'agility',
  shaman_restoration: 'healer',
  mage_arcane: 'healer',
  druid_feral: 'bear',
  druid_restoration: 'healer',
};

export const MEMBERSHIP_ITEMS: Record<string, ItemDef> = Object.fromEntries([
  [
    MEMBERSHIP_TOKEN_ID,
    {
      id: MEMBERSHIP_TOKEN_ID,
      name: 'Membership Token (30 Days)',
      kind: 'junk',
      quality: 'epic',
      sellValue: 0,
      noVendorSell: true,
      stackSize: 20,
    } satisfies ItemDef,
  ],
  ...MEMBERSHIP_ARMOUR_SLOTS.map((slot, index) => [
    `membership_${slot}`,
    {
      id: `membership_${slot}`,
      name: MEMBERSHIP_ARMOUR_NAMES[index],
      kind: 'armor',
      // The shell is universally wearable. The live projection uses the wearer's
      // strongest legal armour type, class, specialisation and level.
      armorType: 'cloth',
      slot,
      quality: 'epic',
      requiredLevel: 1,
      soulbound: true,
      noSalvage: true,
      sellValue: 0,
    } satisfies ItemDef,
  ]),
]);
