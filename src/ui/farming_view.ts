// Pure, host-agnostic core for the farming HUD lines: the deny-toast key and
// the grant-line selectors the farm event arms in hud.ts render.
//
// Extracted on the rule of three (state.md, the Phase 3 QA addendum): farming's
// view logic previously spanned gathering_view.ts (the deny key) and
// grant_line_view.ts (the grant-line selectors) by adjacency, and the knobs
// phase's additions are the third arrival, so farming earns its own core. The
// shared grant-line primitives (grantItemToken, grantQtyText, isMultiUnitGrant)
// deliberately STAY in grant_line_view.ts: they are the cross-profession
// contract that keeps one grant line consistent across all flows, and this
// module consumes isMultiUnitGrant from there exactly as enchanting_view.ts
// does, so the families cannot diverge.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { farmCropById } from '../sim/content/farm_crops';
import type { SimEvent } from '../sim/types';
import { isMultiUnitGrant } from './grant_line_view';
import type { TranslationKey } from './i18n.catalog';

/** Every reason a farming plant or harvest can be refused, taken FROM the
 *  event rather than restated, so a reason added to the sim's union cannot
 *  quietly miss its line: the selector below stops compiling until the catalog
 *  carries a leaf named for it. */
export type FarmDeniedReason = Extract<SimEvent, { type: 'farmDenied' }>['reason'];

/** The i18n key a farmDenied SimEvent's error toast resolves. The sim is
 *  text-free (the gatherDenied contract), and every reason has exactly one
 *  line, so this is a template literal over the reason id itself rather than a
 *  hand-written map: a map would be a second list free to drift from the
 *  union, and this one cannot be. The catalog leaves are therefore named for
 *  the reasons verbatim (snake_case, the `abilityUi.cast.tool_recharge`
 *  precedent), not re-cased. */
export function farmDeniedLineKey(reason: FarmDeniedReason): TranslationKey {
  return `hudChrome.farming.denied.${reason}`;
}

/** The item id whose token a farm PLANT line splices. A plant event carries
 *  the crop id, and what the player actually spent is that crop's seed, so
 *  this is the one hop between them: the disenchant/salvage precedent of a
 *  line naming the item it consumed, which is what tells a farmer carrying
 *  several seeds which one went into the bed.
 *
 *  A crop id the catalog does not carry (or a row with no seed) falls back to
 *  the crop id itself rather than to nothing. That is the honest degrade, not
 *  a nicety: `grantItemToken` turns an id absent from ITEMS into the raw id,
 *  so the line still names SOMETHING instead of rendering an empty splice.
 *  Unreachable through the plant path (plantCrop refuses an unknown crop id
 *  before it emits), so this arm exists for content drift between a client
 *  and a newer server, and is pinned in both directions. */
export function farmPlantedTokenId(cropId: string): string {
  return farmCropById(cropId)?.seedItemId ?? cropId;
}

/** The produce line for one farm harvest: the quantity variant only past one
 *  unit, exactly like its gather and corpse-harvest siblings in
 *  grant_line_view.ts. Farming grants can and normally do land several units
 *  (the harvest-lives roll has a guaranteed floor of picks), so unlike
 *  `catchLine` this family needs the quantity sibling. */
export function farmHarvestLineKey(count: number | undefined): TranslationKey {
  return isMultiUnitGrant(count)
    ? 'hudChrome.farming.harvestLineQty'
    : 'hudChrome.farming.harvestLine';
}

/** The line for the FINE-grade twin a farm harvest also granted. Its own line
 *  for the reason `harvestSpecimenLine` takes one (a different item granted
 *  BESIDE the plain produce, so a shared line would read as one yield counted
 *  twice), but with a quantity sibling, because several picks in one harvest
 *  can upgrade. */
export function farmFineLineKey(count: number | undefined): TranslationKey {
  return isMultiUnitGrant(count)
    ? 'hudChrome.farming.harvestFineLineQty'
    : 'hudChrome.farming.harvestFineLine';
}

/** The line a withered plot's husk payout renders: the same quantity split as
 *  the produce family, so a one-husk clear never reads "x1". */
export function farmWitheredLineKey(count: number | undefined): TranslationKey {
  return isMultiUnitGrant(count)
    ? 'hudChrome.farming.witheredLineQty'
    : 'hudChrome.farming.witheredLine';
}

/** The line the husk trade renders (the knobs phase's convert_husks command):
 *  the quantity split keys on the COMPOST granted, the grant side of the
 *  trade, matching every other grant-line family; the husks spent splice into
 *  the line as their own token either way. */
export function farmHusksConvertedLineKey(compost: number | undefined): TranslationKey {
  return isMultiUnitGrant(compost)
    ? 'hudChrome.farming.husksConvertedLineQty'
    : 'hudChrome.farming.husksConvertedLine';
}
