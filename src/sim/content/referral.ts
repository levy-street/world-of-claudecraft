import type { ItemDef } from '../types';
import { MEMBERSHIP_ARMOUR_SLOTS } from './membership';

export const REFERRAL_ARMOUR_NAMES = [
  'Friendship Helm',
  'Friendship Pauldrons',
  'Friendship Cuirass',
  'Friendship Girdle',
  'Friendship Legguards',
  'Friendship Gauntlets',
  'Friendship Boots',
] as const;
export const REFERRAL_ITEMS: Record<string, ItemDef> = Object.fromEntries(
  MEMBERSHIP_ARMOUR_SLOTS.map((slot, index) => [
    `referral_${slot}`,
    {
      id: `referral_${slot}`,
      name: REFERRAL_ARMOUR_NAMES[index],
      kind: 'armor',
      armorType: 'cloth',
      slot,
      quality: 'epic',
      requiredLevel: 1,
      soulbound: true,
      noSalvage: true,
      sellValue: 0,
    } satisfies ItemDef,
  ]),
);
