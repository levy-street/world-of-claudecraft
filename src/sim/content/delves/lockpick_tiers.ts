// Lockpicking difficulty presets + loot-tier reward scaling, keyed to the
// delve's tier id. Puzzle difficulty scales with the delve band; the player's
// ante (lives) is a separate axis and is the loot tier, see lockpick.ts.
//
// Data-as-code: tune the numbers HERE, never inline in sim.ts.

import type { LockTierSpec, LootTier } from '../../lockpick';
import type { Rng } from '../../rng';
import type { PlayerClass } from '../../types';

/**
 * When false (default), the lock layout is identical across antes, a lower
 * ante is a pure error-margin gamble and premium is skill-gated on the same
 * puzzle. Flip to true (and wire anteScaledPreset) to make premium also a
 * harder board. Kept here as a single, reversible switch.
 */
export const LOCKPICK_ANTE_SCALES_DIFFICULTY = false;

/** Per-delve-tier puzzle presets. Add Mirefen/Thornpeak bands when those delves
 * ship; today only the Collapsed Reliquary exists (tiers: normal, heroic). */
export const LOCKPICK_TIER_PRESETS: Record<string, LockTierSpec> = {
  normal: {
    cols: 12,
    rows: 6,
    width: 1, // tight forgiveness band, must thread the true path
    gateCount: 2,
    visibilityWindow: 4, // fogged: only the next few wards are lit
    trapCount: 3, // ward-traps that jam on contact
    allowedActions: ['hardSet', 'set', 'steady', 'ease', 'drop'],
    // Per-MOVE clock lives on the ante (ANTE_TO_STEP_TIMEOUT_MS in lockpick.ts),
    // not the delve band: the difficulty the player antes sets their time budget.
  },
  heroic: {
    cols: 16,
    rows: 6,
    width: 1,
    gateCount: 3,
    visibilityWindow: 3, // heavier fog
    trapCount: 5,
    allowedActions: ['hardSet', 'set', 'steady', 'ease', 'drop'],
  },
};

export const DEFAULT_LOCKPICK_PRESET: LockTierSpec = LOCKPICK_TIER_PRESETS.normal;

export function lockpickPresetFor(tierId: string): LockTierSpec {
  return LOCKPICK_TIER_PRESETS[tierId] ?? DEFAULT_LOCKPICK_PRESET;
}

/** Loot-tier reward scaling applied on top of the base delve chest rewards.
 * Premium (ante 1, flawless) pays the most; low (ante 3) is the base. */
export const LOCKPICK_TIER_REWARD: Record<LootTier, { bonusMarks: number; copperMult: number }> = {
  premium: { bonusMarks: 2, copperMult: 2 },
  medium: { bonusMarks: 1, copperMult: 1.5 },
  low: { bonusMarks: 0, copperMult: 1 },
};

// Archetype groups mirror REWARD_ARCHETYPE in data.ts (inlined to avoid the
// data.ts -> content/delves import cycle): WAR plate, ROG leather/mail, MAG cloth.
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

/**
 * Item loot awarded in the post-unlock chest, real Collapsed Reliquary gear (Tier 1),
 * tuned to the looter's class archetype and the loot tier (ante). Premium yields a
 * rare-or-green signature, medium a class-appropriate green chest, low a class-neutral
 * green. Deterministic: every roll draws from the caller's seeded `rng`.
 *
 * `bountiful` (§7.6): a solved Bountiful Coffer GUARANTEES the signature rare plus a
 * premium green, strictly better than the 50% rare chance of a normal premium chest.
 * (Rogue/hunter has no signature rare in this tier yet, so they get the two best
 * greens, a known content gap to fill when a ROG rare ships.)
 */
export function delveChestItemsForTier(
  tier: LootTier,
  cls: PlayerClass,
  rng: Rng,
  bountiful = false,
): { itemId: string; count: number }[] {
  const arch = LOOT_ARCHETYPE[cls] ?? 'WAR';
  if (bountiful) {
    if (arch === 'WAR')
      return [
        { itemId: 'deacon_reliquary_helm', count: 1 },
        { itemId: 'reliquary_plate_chest', count: 1 },
      ];
    if (arch === 'MAG')
      return [
        { itemId: 'varric_shadow_cowl', count: 1 },
        { itemId: 'reliquary_cloth_chest', count: 1 },
      ];
    return [
      { itemId: 'reliquary_leather_chest', count: 1 },
      { itemId: 'reliquary_gloves_rog', count: 1 },
    ];
  }
  if (tier === 'premium') {
    if (arch === 'WAR')
      return [
        { itemId: rng.chance(0.5) ? 'deacon_reliquary_helm' : 'reliquary_plate_chest', count: 1 },
      ];
    if (arch === 'ROG')
      return [
        { itemId: 'reliquary_leather_chest', count: 1 },
        { itemId: 'reliquary_gloves_rog', count: 1 },
      ];
    return [{ itemId: rng.chance(0.5) ? 'varric_shadow_cowl' : 'reliquary_cloth_chest', count: 1 }];
  }
  if (tier === 'medium') {
    const itemId =
      arch === 'WAR'
        ? 'reliquary_plate_chest'
        : arch === 'ROG'
          ? 'reliquary_leather_chest'
          : 'reliquary_cloth_chest';
    return [{ itemId, count: 1 }];
  }
  return [{ itemId: rng.chance(0.5) ? 'reliquary_legs' : 'reliquary_shoulder', count: 1 }];
}
