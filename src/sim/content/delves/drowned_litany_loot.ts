// Drowned Litany finale loot tiers (Drowned Reliquary Rite). Mirrors the
// lockpick-tier shape: premium / medium / low map to mistake counts on the
// shrine-sequence puzzle. Deterministic rolls use the caller's seeded `rng`.

import type { LootTier } from '../../lockpick';
import type { Rng } from '../../rng';
import type { PlayerClass } from '../../types';

const LOOT_ARCHETYPE: Record<PlayerClass, 'WAR' | 'ROG' | 'MAG'> = {
  warrior: 'WAR',
  paladin: 'WAR',
  shaman: 'WAR',
  rogue: 'ROG',
  hunter: 'ROG',
  mage: 'MAG',
  priest: 'MAG',
  warlock: 'MAG',
  druid: 'MAG',
};

// Per-archetype item pools. Indexed so draws are arch-stable (same draw count
// regardless of which class opens the reliquary).
const UNCOMMON_A = {
  WAR: 'siltguard_helm',
  ROG: 'reedstalker_jerkin',
  MAG: 'cantors_drowned_sash',
} as const;
const UNCOMMON_B = {
  WAR: 'bulwark_rusted_pauldrons',
  ROG: 'mirejaw_fang_knife',
  MAG: 'corpse_candle_focus',
} as const;
const RARE = {
  WAR: 'nhalias_bell_maul',
  ROG: 'widow_silk_hood',
  MAG: 'nhalias_litany_rod',
} as const;
// 3% prestige epic, bountiful-only.
const EPIC = {
  WAR: 'blackwater_vanguard_chest',
  ROG: 'siltstep_leggings',
  MAG: 'sunken_reliquary_hood',
} as const;

/** Item loot for the opened Drowned Reliquary, tuned to looter class and tier.
 *
 * Every path makes exactly 2 rng draws so the shared stream position is stable
 * regardless of tier or archetype:
 *   Draw 1 - which of the two arch uncommons to award (50/50).
 *   Draw 2 - chance roll for the bonus slot (rare / epic / uncommon-chance).
 */
export function drownedLitanyChestItemsForTier(
  tier: LootTier,
  cls: PlayerClass,
  rng: Rng,
  bountiful = false,
): { itemId: string; count: number }[] {
  const arch = LOOT_ARCHETYPE[cls] ?? 'WAR';
  const result: { itemId: string; count: number }[] = [];

  // Draw 1: pick which uncommon to potentially award.
  const uncommonId = rng.chance(0.5) ? UNCOMMON_A[arch] : UNCOMMON_B[arch];

  if (bountiful) {
    // Guaranteed uncommon + guaranteed rare + 3% epic (draw 2).
    result.push({ itemId: uncommonId, count: 1 });
    result.push({ itemId: RARE[arch], count: 1 });
    if (rng.chance(0.03)) result.push({ itemId: EPIC[arch], count: 1 }); // draw 2
    return result;
  }

  if (tier === 'premium') {
    // Guaranteed uncommon + 20% rare (draw 2).
    result.push({ itemId: uncommonId, count: 1 });
    if (rng.chance(0.2)) result.push({ itemId: RARE[arch], count: 1 }); // draw 2
    return result;
  }

  if (tier === 'medium') {
    // Guaranteed uncommon; no bonus slot (draw 2 is a no-op to keep stream stable).
    result.push({ itemId: uncommonId, count: 1 });
    rng.chance(0); // draw 2 placeholder
    return result;
  }

  // Low (consolation): 50% chance at the uncommon (draw 2).
  if (rng.chance(0.5)) result.push({ itemId: uncommonId, count: 1 }); // draw 2
  return result;
}
