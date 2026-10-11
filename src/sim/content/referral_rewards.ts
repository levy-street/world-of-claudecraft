import type { ItemDef } from '../types';

export const REFERRAL_TITLE = 'referral_trailmate';
export const REFERRAL_BAG = 'referral_satchel';
export const REFERRAL_HOLLOW_TRINKET = 'referral_hollow_charm';
export const REFERRAL_FOG_TRINKET = 'referral_fog_charm';
export const REFERRAL_TANK_REINS = 'reins_referral_tank';
export const REFERRAL_RAPTOR_REINS = 'reins_referral_raptor';
export const REFERRAL_REWARD_SOURCE_BOSSES: Readonly<Record<string, string>> = {
  [REFERRAL_HOLLOW_TRINKET]: 'morthen',
  [REFERRAL_FOG_TRINKET]: 'vael_the_mistcaller',
};

// Rewards stay in personal custody so a card can move before its final binding.
const protectedReward = {
  sellValue: 0,
  soulbound: true,
  noVendorSell: true,
  noDiscard: true,
  noMarketList: true,
  noSalvage: true,
} as const;

export const REFERRAL_STAMP_ITEMS: Record<string, ItemDef> = {
  [REFERRAL_RAPTOR_REINS]: {
    id: REFERRAL_RAPTOR_REINS,
    name: 'Friendship Raptor Reins',
    kind: 'mount',
    mount: 'referral_raptor',
    quality: 'epic',
    ...protectedReward,
  },
  [REFERRAL_BAG]: {
    id: REFERRAL_BAG,
    name: 'Friendship Satchel',
    kind: 'bag',
    quality: 'rare',
    // Matches the largest general bag; larger satchels hold materials only.
    bagSlots: 16,
    ...protectedReward,
  },
  [REFERRAL_HOLLOW_TRINKET]: {
    id: REFERRAL_HOLLOW_TRINKET,
    name: 'Hollow Friendship Charm',
    kind: 'armor',
    slot: 'trinket',
    quality: 'uncommon',
    stats: { sta: 3 },
    ...protectedReward,
  },
  [REFERRAL_FOG_TRINKET]: {
    id: REFERRAL_FOG_TRINKET,
    name: 'Fogbound Friendship Charm',
    kind: 'armor',
    slot: 'trinket',
    quality: 'rare',
    stats: { sta: 5 },
    ...protectedReward,
  },
  [REFERRAL_TANK_REINS]: {
    id: REFERRAL_TANK_REINS,
    name: 'Friendship Tank Reins',
    kind: 'mount',
    mount: 'referral_tank',
    quality: 'epic',
    ...protectedReward,
  },
};
