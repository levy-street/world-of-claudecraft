// The Founder Salesman (Eastbrook, beside the graveyard): three tiered,
// wallet-gated, one-time-per-account claims. Host-agnostic data only; the
// claim itself (server/game.ts 'claim_founder_pack') owns the wallet-balance
// check, the account-cosmetics grants, and the mail delivery.
//
// Everything here is a single lifetime claim per account (one of the three
// tiers, ever), except the skin PICK, which repeats up to the claimed tier's
// skinPicks allowance (3/6/9), one skin per claim call.

import type { PlayerClass, SkinCatalog } from '../types';
import type { MountKey } from './mounts';

export type FounderPackTier = 'uncommon' | 'rare' | 'epic';

export interface FounderPackTierDef {
  tier: FounderPackTier;
  /** Minimum real on-chain $WOC balance the account's linked wallet must
   *  hold to claim this tier (server/woc_balance.ts cachedWocBalance). */
  wocThreshold: number;
  /** The cosmetic title granted (Book of Deeds, content/deeds.ts). */
  title: string;
  titleDeedId: string;
  /** How many of the 3 Founder Pack mounts the claimant picks (all 3, for
   *  the top tier). */
  mountPicks: number;
  /** How many of the 9 FOUNDER_SKIN_CATALOG skins the claimant may pick,
   *  one per 'claim_founder_pack' skin-pick call. */
  skinPicks: number;
  /** The tier's bag-pet item (src/sim/content/items.ts), mailed once on claim. */
  bagItemId: string;
  /** Local placeholder credit only; see src/world_api/cosmetics.ts
   *  AccountCosmetics.founderPackClaudium for why this never reaches the
   *  real economy-service balance. */
  claudium: number;
  /** Epic only: the account-wide Golden Aura cosmetic flag. No render
   *  effect yet (art/VFX follow in a separate PR, the bag-pet precedent). */
  goldenAura: boolean;
}

export const FOUNDER_PACK_TIERS: readonly FounderPackTierDef[] = [
  {
    tier: 'uncommon',
    wocThreshold: 1_000_000,
    title: 'Emberborn',
    titleDeedId: 'feat_founder_emberborn',
    mountPicks: 1,
    skinPicks: 3,
    bagItemId: 'founder_bag_phantom',
    claudium: 1000,
    goldenAura: false,
  },
  {
    tier: 'rare',
    wocThreshold: 5_000_000,
    title: 'Starforged',
    titleDeedId: 'feat_founder_starforged',
    mountPicks: 2,
    skinPicks: 6,
    bagItemId: 'founder_bag_triplet',
    claudium: 1500,
    goldenAura: false,
  },
  {
    tier: 'epic',
    wocThreshold: 10_000_000,
    title: 'Worldshaper',
    titleDeedId: 'feat_founder_worldshaper',
    mountPicks: 3,
    skinPicks: 9,
    bagItemId: 'founder_bag_emberfall_phoenix',
    claudium: 2000,
    goldenAura: true,
  },
];

export function founderPackTierDef(tier: string): FounderPackTierDef | null {
  return FOUNDER_PACK_TIERS.find((def) => def.tier === tier) ?? null;
}

/** The 3 mounts every tier picks from (src/sim/content/mounts.ts
 *  FOUNDER_PACK_MOUNTS is the same list; kept here too so this module is a
 *  complete read of "what the store sells" without an extra import for
 *  callers that only need the picks, not the mount defs). */
export const FOUNDER_PACK_MOUNT_PICKS: readonly MountKey[] = [
  'cinderjaw_rex',
  'ancient_devourer',
  'shiba_inu',
];

/** The item that grants a given Founder Pack mount pick. */
export function founderPackMountReinsItemId(key: MountKey): string | null {
  switch (key) {
    case 'cinderjaw_rex':
      return 'founder_reins_cinderjaw_rex';
    case 'ancient_devourer':
      return 'founder_reins_ancient_devourer';
    case 'shiba_inu':
      return 'founder_reins_shiba_inu';
    default:
      return null;
  }
}

/** The 9 full-body skins the pack sells, one per class (World of Claudecraft
 *  Founders Pack spec). Each is a fixed FULL_BODY_SKIN_CATALOGS id (no
 *  chroma; see src/sim/types.ts and src/render/characters/manifest.ts
 *  FULL_BODY_SKIN_VISUAL_KEYS), restricted to its one class here. */
export interface FounderSkinDef {
  catalog: SkinCatalog;
  requiredClass: PlayerClass;
}

export const FOUNDER_SKIN_CATALOG: readonly FounderSkinDef[] = [
  { catalog: 'altherion', requiredClass: 'priest' },
  { catalog: 'boneforged', requiredClass: 'warrior' },
  { catalog: 'bonehunter', requiredClass: 'hunter' },
  { catalog: 'eclipse_wildheart', requiredClass: 'druid' },
  { catalog: 'frostfire', requiredClass: 'mage' },
  { catalog: 'dawnbreaker', requiredClass: 'paladin' },
  { catalog: 'plaguebringer', requiredClass: 'warlock' },
  { catalog: 'shinobi', requiredClass: 'rogue' },
  { catalog: 'spiritwolf', requiredClass: 'shaman' },
];

export function founderSkinDef(catalog: string): FounderSkinDef | null {
  return FOUNDER_SKIN_CATALOG.find((def) => def.catalog === catalog) ?? null;
}
