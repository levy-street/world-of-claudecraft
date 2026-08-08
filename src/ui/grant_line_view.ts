// Pure, host-agnostic core for the profession GRANT LINES (#2430): the chat
// line a player-initiated profession action prints for the items it granted,
// one per DISTINCT granted item. Six of the seven flows grant a single item per
// command, so that is one line; corpse harvest (#2457) is the exception whose
// one command can land several.
//
// Background: every grant in the game flows through the one shared inventory
// hub (Sim.addItem/addItemInstance), which emits a 'loot' SimEvent carrying a
// flat "You receive: X" line. A profession action ALSO emits its own richer
// result event (gatherResult / harvestResult / fishingResult / craftResult /
// disenchantResult / salvageResult / enchantResult), so one action printed two
// lines for one grant, the plainer one first. The hub line now stands down for
// those grants (the loot event's `callerLogs` flag, see src/sim/types.ts),
// which makes the profession's own line the ONLY line for the grant, so it has
// to carry everything the hub line used to: the item, its quantity, and a link
// to it.
//
// This module owns the three decisions that gives the HUD, so the event arms in
// hud.ts stay thin and all three are unit-testable in Node:
//  - grantItemToken: the chat token for a granted item (the name-free
//    [[i:id]] link the chat log renders as a clickable, quality-colored
//    [Name], with a plain-text fallback for an id the client cannot resolve).
//  - grantQtyText: the localized {qty} value, one-unit default included.
//  - the yield-key selectors: which catalog key one result event renders,
//    picking the quantity-bearing variant only for a multi-unit grant.
//
// The grouping axis here is deliberately GRANT LINES, not profession: the
// gather and craft selectors live beside grantItemToken/grantQtyText rather
// than in gathering_view.ts / crafting_view.ts (which own the DENY and picker
// key families for those professions) precisely because the thing that has to
// stay consistent is what one grant line looks like across all seven flows.
// enchanting_view.ts is the one exception, and only because it already owned
// the event -> key + sink mapping for those three commands before #2430; it
// consumes isMultiUnitGrant from here so the families cannot diverge.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { farmCropById } from '../sim/content/farm_crops';
import { ITEMS } from '../sim/data';
import type { HarvestYieldKind } from '../sim/professions/harvest_yields';
import { itemDisplayName } from './entity_i18n';
import { tryEncodeItemLink } from './hud/quest/quest_link';
import { formatNumber } from './i18n';
import type { TranslationKey } from './i18n.catalog';

/** The chat token for one granted item: the name-free `[[i:id]]` link when the
 *  client can resolve it (the chat log renders it as a clickable, tooltipped,
 *  quality-colored `[Name]`), otherwise the plain localized name. An id the
 *  chat-link parser cannot match would reach the player as literal "[[i:...]]"
 *  source text, so `tryEncodeItemLink` (the guarded encoder, which lives beside
 *  that parser's own regex and answers the charset question for every encode
 *  site) returns null for one and the plain-name path takes over. An id absent
 *  from ITEMS (content drift between client and server) degrades to the raw id
 *  rather than the renderer's bare `[?]`, so the line still names something. */
export function grantItemToken(itemId: string): string {
  const item = ITEMS[itemId];
  if (!item) return itemId;
  return tryEncodeItemLink(itemId) ?? itemDisplayName(item);
}

/** True when a grant of `count` units should render the quantity-bearing line
 *  variant. Absent/1 renders the plain variant, matching the hub line's own
 *  " xN"-only-past-one rule (Sim.addItem). */
export function isMultiUnitGrant(count: number | undefined): boolean {
  return (count ?? 1) > 1;
}

/** The `{qty}` value a grant line splices: the localized integer, with an
 *  absent count reading as one unit. Owned here rather than restated at each
 *  event arm so every family agrees on the default and on the digit options;
 *  an arm that forgot the default would render a bare "x". */
export function grantQtyText(count: number | undefined): string {
  return formatNumber(count ?? 1, { maximumFractionDigits: 0 });
}

/** The gather line for one harvest: the quantity variant only past one unit. */
export function gatherLineKey(qty: number): TranslationKey {
  return isMultiUnitGrant(qty)
    ? 'hudChrome.gathering.gatherLineQty'
    : 'hudChrome.gathering.gatherLine';
}

/** The corpse-harvest line for ONE landed yield (#2457). Corpse harvest is the
 *  one flow whose single command grants several distinct items, so its result
 *  event carries a list and this selector runs per entry rather than per
 *  command.
 *
 *  A Pristine specimen (#1145) takes its own wording: it is a pure extra
 *  granted BESIDE its family's own plain component, so a shared line would
 *  read as if the harvest yielded the same thing twice. That is the precedent
 *  a rare-or-better disenchant already sets for its typed secondary
 *  (`disenchantedAlso` in enchanting_view.ts), and a specimen is always
 *  exactly one unit, which is why it has no quantity sibling.
 *
 *  A SIGNED component deliberately renders the same line as a plain one: the
 *  node-gather windfall has never had a line of its own either (the signed
 *  batch in professions/gathering.ts harvestNode renders `gatherLine`), and
 *  two gathering surfaces announcing the same mark differently would be the
 *  drift. The discriminant still rides the event, so the two can diverge later
 *  without a wire change. */
export function harvestLineKey(y: { kind: HarvestYieldKind; qty: number }): TranslationKey {
  if (y.kind === 'specimen') return 'hudChrome.gathering.harvestSpecimenLine';
  return isMultiUnitGrant(y.qty)
    ? 'hudChrome.gathering.harvestLineQty'
    : 'hudChrome.gathering.harvestLine';
}

/** The crafted line for one successful craft: the quantity variant only for a
 *  resultCount > 1 recipe, whose count used to be visible ONLY through the
 *  hub line's " xN" suffix. */
export function craftedLineKey(count: number | undefined): TranslationKey {
  return isMultiUnitGrant(count)
    ? 'hudChrome.crafting.craftedToastQty'
    : 'hudChrome.crafting.craftedToast';
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
 *  unit, exactly like its gather and corpse-harvest siblings above. Farming
 *  grants can and normally do land several units (the harvest-lives roll has a
 *  guaranteed floor of picks), so unlike `catchLine` this family needs the
 *  quantity sibling. */
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

// The three enchanting-action lines (disenchant / salvage / apply-enchant)
// keep their key selection in src/ui/enchanting_view.ts, which already owns the
// event -> key + sink mapping for those commands; it consumes isMultiUnitGrant
// above so all four families agree on when a quantity is worth showing.
