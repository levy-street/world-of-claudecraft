// ---------------------------------------------------------------------------
// Land-tool USE requirements (R22): the wield gate
// ---------------------------------------------------------------------------
//
// The RuneScape-shaped rule the packet review settled: owning a land tool and
// being able to SWING it are different facts. Acquisition stays open on every
// route (counters sell ahead freely like Wilkes' rods, the market, trade and
// mail all move tools at any proficiency, and owners are never stripped);
// enforcement lives at the moment of use, where no transfer route can dodge
// it. The old vendor purchase gates (content/vendor_row_gates.ts) survive as
// ADVISORY display only, reading their thresholds from this table so the two
// surfaces can never disagree about a number.
//
// Rods are exempt, structurally: fishing's pacing is the zone water gate plus
// its own teaching ceiling, its counter runs to 200 rather than 100, and the
// resolvers below therefore never filter the fishing profession. The exempt
// arm is code, not a caller convention, so a land-side caller cannot
// accidentally gate a rod by reaching for the wrong helper.
//
// The thresholds ladder, against the land cap of 100:
//   tier 1: 0   (the entry implement; gating it would gate gathering itself)
//   tier 2: 40  (reachable on tier-1 ground, which teaches to 75)
//   tier 3: 70  (still under the tier-1 ceiling, with margin pinned)
//   tier 4: 85  (crafted/Marks rung; reachable on the tier-2+ ground a
//               tier-3 tool opens, which teaches to the cap)
//   tier 5: 100 (the masterwork rung asks for a mastered counter)
// Every value is pinned against the LIVE gain curve by
// tests/professions_tool_gate.test.ts (the knife-edge rule: each requirement
// reachable on ground the previous tier's tool can already work), so a curve
// retune that would brick the ladder reds a test instead of shipping.
//
// DOM-free, rng-free, host-agnostic pure leaf: like professions/tools.ts, the
// items table is a parameter and player state never gets imported, so the
// same resolution runs in the sim, on the server, and in the client mirrors
// (tests/architecture.test.ts).

import { GATHERING_PROFESSION_IDS, type GatheringProfessionId } from '../content/professions';
import type { InvSlot, ItemDef } from '../types';
import { BARE_HANDS_TOOL_TIER, gatherToolTier, NO_TOOL_OWNED } from './tools';

/** Gathering proficiency required to WIELD a tier-2 land tool (R22). */
export const TIER2_TOOL_WIELD_PROFICIENCY = 40;

/** Gathering proficiency required to WIELD a tier-3 land tool (R22). */
export const TIER3_TOOL_WIELD_PROFICIENCY = 70;

/** Gathering proficiency required to WIELD a tier-4 land tool (R22, the
 *  crafted/Delve-Marks rung; derived in the content pass under the
 *  knife-edge rule). */
export const TIER4_TOOL_WIELD_PROFICIENCY = 85;

/** Gathering proficiency required to WIELD a tier-5 land tool (R22): the
 *  masterwork rung asks for the mastered counter itself. */
export const TIER5_TOOL_WIELD_PROFICIENCY = 100;

// One table, frozen like VENDOR_ROW_GATES: both worlds and every surface
// (harvest gate, tooltips, vendor advisory lines, the wiki) resolve
// requirements through this object, so a runtime mutation would desync a
// denial from the line that explains it.
export const WIELD_REQUIREMENT_BY_TIER: Readonly<Record<number, number>> = Object.freeze({
  1: 0,
  2: TIER2_TOOL_WIELD_PROFICIENCY,
  3: TIER3_TOOL_WIELD_PROFICIENCY,
  4: TIER4_TOOL_WIELD_PROFICIENCY,
  5: TIER5_TOOL_WIELD_PROFICIENCY,
});

/** The proficiency a land tool of `tier` demands before it wields. Tier 1 and
 *  anything outside the shipped ladder read 0 (ungated), so an unknown tier
 *  fails open toward the pre-R22 behavior rather than bricking a tool. */
export function wieldRequirementForTier(tier: number): number {
  return Object.hasOwn(WIELD_REQUIREMENT_BY_TIER, tier) ? WIELD_REQUIREMENT_BY_TIER[tier] : 0;
}

/** Coerce a proficiency read to a usable number: absent and malformed both
 *  read 0, which LOCKS rather than opens (the resolveVendorRowGate contract;
 *  the online mirror assigns proficiency straight off the wire, and NaN
 *  comparisons would otherwise fail open). */
function coerceProficiency(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** Whether a land tool of `tier` wields at `proficiency` (R22). */
export function canWieldGatherToolTier(tier: number, proficiency: unknown): boolean {
  return coerceProficiency(proficiency) >= wieldRequirementForTier(tier);
}

/**
 * The wield-aware sibling of tools.ts `bestOwnedGatherToolTierOrNone`: the
 * best tier this player can actually PUT TO WORK, scanning the same bags with
 * unwieldable land tools filtered out. Fishing is the structural R22
 * exemption: for `professionId === 'fishing'` no filter applies and the scan
 * degenerates to the ownership scan. Returns NO_TOOL_OWNED when nothing
 * wieldable is carried.
 */
export function bestWieldableGatherToolTierOrNone(
  inventory: readonly InvSlot[],
  professionId: GatheringProfessionId,
  proficiency: unknown,
  items: Readonly<Record<string, ItemDef>>,
): number {
  const held = coerceProficiency(proficiency);
  let best = NO_TOOL_OWNED;
  for (const slot of inventory) {
    const tier = gatherToolTier(items[slot.itemId], professionId);
    if (tier === undefined) continue;
    if (professionId !== 'fishing' && held < wieldRequirementForTier(tier)) continue;
    if (tier > best) best = tier;
  }
  return best;
}

/**
 * The wield-aware sibling of tools.ts `bestOwnedAnyGatherToolTier` for the
 * corpse-harvest arm: the best WIELDABLE tier across every gathering
 * profession, floored at bare hands. Each land profession filters by its OWN
 * counter; a rod contributes its tier unfiltered (the R22 exemption). The
 * proficiency map is the player's `gatheringProficiency` record, coerced
 * per profession.
 */
export function bestWieldableAnyGatherToolTier(
  inventory: readonly InvSlot[],
  proficiency: Readonly<Record<string, number>>,
  items: Readonly<Record<string, ItemDef>>,
): number {
  let best = BARE_HANDS_TOOL_TIER;
  for (const professionId of GATHERING_PROFESSION_IDS) {
    const tier = bestWieldableGatherToolTierOrNone(
      inventory,
      professionId,
      proficiency[professionId],
      items,
    );
    if (tier > best) best = tier;
  }
  return best;
}

/**
 * The corpse-arm sibling of `minWieldRequirementToWork`: the smallest
 * proficiency at which some LAND tool already in the bags would cover
 * `targetTier` for ANY profession. Null when nothing owned covers it. Rods
 * never appear here by construction: a covering rod wields freely (the R22
 * exemption), so the any-profession gate would have passed and no denial
 * would be asking for a requirement to name.
 */
export function minWieldRequirementToWorkAny(
  inventory: readonly InvSlot[],
  targetTier: number,
  items: Readonly<Record<string, ItemDef>>,
): number | null {
  let min: number | null = null;
  for (const professionId of GATHERING_PROFESSION_IDS) {
    if (professionId === 'fishing') continue;
    const req = minWieldRequirementToWork(inventory, professionId, targetTier, items);
    if (req !== null && (min === null || req < min)) min = req;
  }
  return min;
}

/**
 * The requirement a wield denial should NAME: the smallest proficiency at
 * which some tool ALREADY IN THIS PLAYER'S BAGS would work a node of
 * `targetTier`. Returns null when no owned tool covers the tier at all (the
 * denial is then the plain no-tool/tier arm, not a wield arm). Keyed to the
 * bags on purpose: telling a player who owns only the tier-3 pick that "40
 * opens tier 2" would name a threshold that unlocks nothing they carry.
 */
export function minWieldRequirementToWork(
  inventory: readonly InvSlot[],
  professionId: GatheringProfessionId,
  targetTier: number,
  items: Readonly<Record<string, ItemDef>>,
): number | null {
  let min: number | null = null;
  for (const slot of inventory) {
    const tier = gatherToolTier(items[slot.itemId], professionId);
    if (tier === undefined || tier < targetTier) continue;
    const req = wieldRequirementForTier(tier);
    if (min === null || req < min) min = req;
  }
  return min;
}
