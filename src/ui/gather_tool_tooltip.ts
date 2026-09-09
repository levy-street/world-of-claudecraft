// Gathering-tool item tooltip lines (#2343): what a pick/axe/sickle/rod is,
// what it is required for, how using it behaves, and its speed/fishing
// bonuses. A pure string-builder composed inside Hud.itemTooltip (the
// item_instance_tooltip.ts pattern): t() plus the shared tooltip_line_core
// builder (which owns the esc) here, no DOM, no Hud state,
// so tests/gather_tool_tooltip.test.ts drives it directly. Numbers come
// straight from the sim's own tuning constants, never re-invented copy:
// the gather cast sheds GATHER_CAST_TOOL_TIER_REDUCTION_SEC per owned tier
// above the node's, a rod pulls the bite-delay ceiling down by
// FISH_BITE_DELAY_ROD_REDUCTION_SEC and widens the reel window by
// FISH_REEL_WINDOW_ROD_BONUS_SEC per tier above 1 PLUS
// FISH_REEL_WINDOW_RARITY_BONUS_SEC per rarity rung above common (which is why
// the reel line is handed this def's own `quality` and not just its tier), and
// catch band b needs rod tier b + 1, which is fishingRodBandFor's own rule and
// is READ FROM IT rather than restated as tier - 1.
//
// THE INDEX IS FISHING'S LADDER, NOT THE SHARED ONE, and the distinction is
// the reason this file changed at masterwrought Phase 11i. It used to index
// PROFICIENCY_BAND_THRESHOLDS with a fishing band, correct only while the two
// arrays were the same three entries; once fishing grew its own six-rung ladder
// the shared array was SHORTER than the index, so the top rung read off the end
// of a three-element tuple and the line blanked or lied. It reads
// FISHING_CATCH_BAND_THRESHOLDS now.
// Tool-effect charm slotting has its own sibling card (tool_effect_tooltip.ts,
// composed right after these lines in Hud.itemTooltip), so it is deliberately
// not described here.

import { FISHING_BAND_INTRODUCED_CATCH } from '../sim/content/items';
import type { GatheringProfessionId } from '../sim/content/professions';
import {
  FISH_REEL_WINDOW_SEC,
  fishBiteSavedSecFor,
  fishingRodBandFor,
  fishReelWindowSecFor,
} from '../sim/professions/fishing';
import { FISHING_CATCH_BAND_THRESHOLDS } from '../sim/professions/fishing_bands';
import { isGatherToolUse } from '../sim/professions/tools';
import { wieldRequirementForTier } from '../sim/professions/wield_gate';
import type { ItemDef } from '../sim/types';
import { tEntity } from './entity_i18n';
import { gatheringProfessionNameKey } from './hud/professions/gathering_profession_name';
import { formatNumber, type TranslationKey, t } from './i18n';
import { tooltipLine } from './tooltip_line_core';

const KIND_KEYS: Record<GatheringProfessionId, TranslationKey> = {
  mining: 'hudChrome.gathering.toolTooltip.kind.mining',
  logging: 'hudChrome.gathering.toolTooltip.kind.logging',
  herbalism: 'hudChrome.gathering.toolTooltip.kind.herbalism',
  fishing: 'hudChrome.gathering.toolTooltip.kind.fishing',
  farming: 'hudChrome.gathering.toolTooltip.kind.farming',
};

const UNLOCKS_KEYS: Partial<Record<GatheringProfessionId, TranslationKey>> = {
  mining: 'hudChrome.gathering.toolTooltip.unlocks.mining',
  logging: 'hudChrome.gathering.toolTooltip.unlocks.logging',
  herbalism: 'hudChrome.gathering.toolTooltip.unlocks.herbalism',
  fishing: 'hudChrome.gathering.toolTooltip.unlocks.fishing',
  // The hoe phase filled the farming rows: `unlocks` states the crop tiers
  // the hoe's tier opens (the step-12 plant gate in professions/farming.ts).
  farming: 'hudChrome.gathering.toolTooltip.unlocks.farming',
};

const USE_KEYS: Partial<Record<GatheringProfessionId, TranslationKey>> = {
  mining: 'hudChrome.gathering.toolTooltip.use.mining',
  logging: 'hudChrome.gathering.toolTooltip.use.logging',
  herbalism: 'hudChrome.gathering.toolTooltip.use.herbalism',
  // The farming row deliberately has NO "Use:" imperative: a hoe is a passive
  // gate (useGatherToolItem never gains a farming arm; beds are not nodes),
  // so the line states the bags-carried behavior instead of a click action.
  farming: 'hudChrome.gathering.toolTooltip.use.farming',
};

/** The tooltip lines for one gathering implement, or '' for any other item.
 *  Handles both shapes: the tiered gatherTool items (picks, axes, sickles,
 *  rods) and the simple fishing pole (use.type 'fishing', which keeps its
 *  legacy useFishing line and gains the required-to-fish line). */
export function gatherToolTooltipLines(item: ItemDef): string {
  const use = item.use;
  if (!use) return '';
  if (use.type === 'fishing') {
    return (
      tooltipLine('tt-desc', t('itemUi.tooltip.useFishing')) +
      tooltipLine('tt-desc', t('hudChrome.gathering.toolTooltip.rodRequired'))
    );
  }
  if (!isGatherToolUse(use)) return '';
  const tier = formatNumber(use.tier, { maximumFractionDigits: 0 });
  let html = tooltipLine('tt-sub', t(KIND_KEYS[use.professionId], { tier }));
  if (use.professionId === 'fishing') {
    html += tooltipLine('tt-desc', t('itemUi.tooltip.useFishing'));
    html += tooltipLine('tt-desc', t('hudChrome.gathering.toolTooltip.rodRequired'));
    // What the tier actually opens, said on the item that satisfies it, the
    // same way a pick names the vein tiers it can work.
    const unlocksFishing = UNLOCKS_KEYS.fishing;
    if (unlocksFishing) html += tooltipLine('tt-desc', t(unlocksFishing, { tier }));
    if (use.tier > 1) {
      // Both numbers come from the sim's own functions rather than from a
      // second copy of its arithmetic. The copy is what shipped a tier-5 rod
      // advertising a second the bite clamp never gives.
      html += tooltipLine(
        'tt-desc',
        t('hudChrome.gathering.toolTooltip.rodBite', {
          seconds: formatNumber(fishBiteSavedSecFor(use.tier), { maximumFractionDigits: 2 }),
        }),
      );
      // Passed THIS def's own quality, not the common default: the rod's
      // rarity widens the window too, so a tooltip reading the tier alone
      // would under-promise every rod above ironreel by a quarter second per
      // rung. The line still states one number, the total the rod buys over
      // the base window, because a player holds one rod and cares what it is
      // worth, not how the sum was assembled.
      html += tooltipLine(
        'tt-desc',
        t('hudChrome.gathering.toolTooltip.rodReel', {
          seconds: formatNumber(
            fishReelWindowSecFor(use.tier, item.quality) - FISH_REEL_WINDOW_SEC,
            { maximumFractionDigits: 2 },
          ),
        }),
      );
      // The band line is only true while the rod actually raises the ceiling,
      // and where the ceiling is comes from the sim's own fishingRodBandFor
      // rather than from the threshold array's length: the engine caps the
      // band with that function, so reading anything else here is how the two
      // ends drift. A rod that opens no NEW band says nothing about bands;
      // clamping the index instead (which is what this did) made every rod
      // above tier 3 repeat the tier-3 rod's claim back at its owner.
      //
      // IT READS FISHING'S OWN LADDER, not the shared one. This line indexed
      // PROFICIENCY_BAND_THRESHOLDS until masterwrought Phase 11i split the
      // two, which was correct only while they were the same array: fishing's
      // ladder now has six rungs and the shared one still has three, so the
      // old read would have quoted 200 for a band gated at 150 and run off the
      // end of a three-element tuple at the top rung, blanking the number.
      if (fishingRodBandFor(use.tier) > fishingRodBandFor(use.tier - 1)) {
        const band = fishingRodBandFor(use.tier);
        const skill = formatNumber(FISHING_CATCH_BAND_THRESHOLDS[band], {
          maximumFractionDigits: 0,
        });
        // NAME THE CATCH where the band introduces one. Bands 3, 4 and 5 all
        // gate at fishing 200, so the skill-only line reads identically on all
        // three crafted rods, which is the defect the rod block in
        // content/items.ts documents against itself. The catch name is the one
        // thing that differs, and it is also the thing an owner wants to know.
        const introduced = FISHING_BAND_INTRODUCED_CATCH[band];
        const fish = introduced
          ? tEntity({ kind: 'item', id: introduced, field: 'name' })
          : undefined;
        html += tooltipLine(
          'tt-desc',
          fish
            ? t('hudChrome.gathering.toolTooltip.rodBandCatch', { fish, skill })
            : t('hudChrome.gathering.toolTooltip.rodBand', { skill }),
        );
      }
    }
    return html;
  }
  const unlocksKey = UNLOCKS_KEYS[use.professionId];
  const useKey = USE_KEYS[use.professionId];
  if (unlocksKey) html += tooltipLine('tt-desc', t(unlocksKey, { tier }));
  if (useKey) html += tooltipLine('tt-desc', t(useKey));
  // The R22 wield requirement, on the item that carries it: the same
  // "Requires {craft} {skill}" line the vendor's advisory sub-line renders,
  // with the number read from the one wield table the harvest gate enforces
  // (professions/wield_gate.ts). Land tools only by construction: rods are
  // R22-exempt and their branch returned above, and tier 1 reads 0.
  const wieldReq = wieldRequirementForTier(use.tier);
  const professionNameKey = gatheringProfessionNameKey(use.professionId);
  // No printable profession name means no line, matching requirementText in
  // the vendor painter: a fallback through the KIND keys would render
  // "Requires Mining tool 40", a wrong sentence rather than a missing one.
  if (wieldReq > 0 && professionNameKey !== undefined) {
    html += tooltipLine(
      'tt-desc',
      t('hudChrome.crafting.skillReqLine', {
        craft: t(professionNameKey),
        skill: formatNumber(wieldReq, { maximumFractionDigits: 0 }),
      }),
    );
  }
  if (use.tier > 1) {
    html += tooltipLine('tt-desc', t('hudChrome.gathering.toolTooltip.speed', { tier }));
  }
  return html;
}
