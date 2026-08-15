// Pure view-core for the per-corpse focus picker (#1142): DOM/i18n-free, so a
// Vitest can assert its shape directly. Maps a corpse's tagged components plus
// the player's current checkbox selection into the render model the thin
// painter (corpse_harvest_painter.ts, composed into hud.ts's existing loot
// window) draws.
//
// Design note: fewer checked tags concentrates the harvest for a higher tier
// per component (professions/gathering.ts `resolveCorpseFocusHarvest`); this
// core only builds the row list + the harvest-button label state, it never
// rolls or picks a tier itself.

import {
  forfeitsEveryMappedYield,
  harvestConcentrationBonus,
  harvestFamilyYieldsItem,
  isHarvestableCorpse,
} from '../../../sim/professions/gathering';

export interface CorpseHarvestRow {
  readonly tag: string;
  readonly checked: boolean;
  /**
   * #2514: does this family have a harvest item behind it? False for the four
   * carried-but-unmapped families (claw, tusk, gills, horn), whose rows are
   * still offered (the corpse really does carry them) but can extract nothing.
   * Checking one is now a no-op rather than a tier's worth of penalty, and the
   * painter marks the row so the box is not a silent one.
   */
  readonly yieldsItem: boolean;
}

export interface CorpseHarvestViewModel {
  readonly rows: CorpseHarvestRow[];
  readonly harvestDisabled: boolean;
  /**
   * True when THIS selection concentrates: it earns a higher tier than the
   * widest pick available on this corpse would. Measured against that widest
   * pick (the sim's bonus for an empty selection), not against zero, because
   * after #2514 the widest pick on a mixed corpse already carries a bonus: part
   * of the corpse's breadth is a family with no item behind it, which is
   * unreachable content rather than a choice the player declined. So on the
   * three `gills, hide` murlocs nothing is ever concentrated (checking hide is
   * the widest pick there is), and on old_greyjaw `['hide']` is while
   * `['hide','fang']` is not.
   *
   * Read off the sim's own bonus, never a checkbox count. A count would call
   * `['gills','hide']` a full cover and `['hide','claw']` a concentrate, and
   * the sim disagrees with both. On an all-mapped corpse the two definitions
   * coincide exactly, which is why the pre-#2514 count survived: it was right
   * about the eight templates it was ever tested on.
   */
  readonly concentrated: boolean;
  /** #2509: the checked set forfeits every yield this corpse could have given. */
  readonly forfeitsEveryYield: boolean;
  /**
   * #2513: this corpse carries at least one family with an item behind it, so a
   * harvest is possible at all. Independent of the selection, unlike
   * `forfeitsEveryYield`. The painter draws NO section when this is false: the
   * two are separate fields precisely so a painter can tell "your pick throws
   * everything away" (which owes the player a reason line) from "this corpse
   * yields nothing" (which owes them no section), instead of reading one merged
   * boolean and having to guess which.
   */
  readonly corpseHarvestable: boolean;
}

/**
 * Build the picker's row list + harvest-button state.
 * `componentTags`: every tag on this corpse (order-preserving, de-duplicated).
 * `selected`: the tags currently checked. An empty selection is allowed (it
 * means "spread across all", matching the pre-#1142 default) and is NOT
 * disabled: the harvest button enables once the corpse is harvestable, since
 * submitting an empty/partial selection is well-defined.
 *
 * The ONE selection that is not: #2509. Four shipped component families
 * (claw, tusk, gills, horn) are tagged on corpses but have no harvest item
 * behind them yet, and the rows for them are rendered like any other, so on a
 * mixed corpse a player could check only those and submit. That pick survives
 * the sim's sanitization (the tags ARE carried), spends the single-use claim,
 * and grants nothing. The command boundary now refuses it
 * (src/sim/interaction.ts harvestCorpse); this is the client mirror of the
 * same predicate, so the dead-end submit is not offered in the first place.
 *
 * Mirrored EXACTLY, including where it does not fire: on a corpse whose tags all
 * map to nothing (gills, horn on a retagged fixture; fen_troll was the shipped
 * case until #2905 mapped claw and tusk) NO pick forfeits anything, because no
 * pick could have paid out, so `forfeitsEveryYield` stays false there. What
 * disables that corpse is the OTHER term, isHarvestableCorpse (#2513): the sim
 * refuses the command outright, so the button must not submit. The two terms are
 * pinned separately for that reason; a fixture where they coincided would let
 * either one rot.
 *
 * `!isHarvestableCorpse(tags)` replaces a `tags.length === 0` written here by
 * hand. Note carefully that it is NOT simply that same arm widened: an empty tag
 * list produced this model but never a rendered picker, because the painter
 * early-returns on `rows.length === 0`, whereas an all-unmapped corpse has rows.
 * Left at that, a caller who reached the painter anyway would have drawn a NEW
 * state: a section with live checkboxes, a dead Harvest button, and no reason
 * line (there is no forfeit to report). So the model exposes `corpseHarvestable`
 * as its own field and the painter refuses the whole section on it, which is the
 * shipped behavior for an unharvestable corpse expressed once more, one layer
 * down. In the shipped client the painter is never reached for such a corpse at
 * all, since loot_window_controller.openCorpse only draws the picker when
 * corpseLootAvailability reports the corpse harvestable off this same predicate,
 * and tests/loot_window_controller.test.ts pins that gate rather than leaving it
 * as prose. `harvestDisabled` still folds the term in, so a painter that ignores
 * the new field cannot submit.
 *
 * Rows are still NOT filtered to the mapped families, and after #2514 that is a
 * choice with nothing left to pay for it. Filtering would hide a component the
 * corpse genuinely carries, and it would put the #2509 refusal above out of
 * reach of the shipped picker, leaving the reason line as dead UI for the one
 * client that can no longer produce the state it explains. The sim now ignores
 * an unmapped entry outright (yieldingFocusComponents), so the row costs the
 * player nothing; it carries `yieldsItem: false` instead, and the painter marks
 * it. Offered, marked, and free is the honest shape: "this beast has claws, we
 * cannot do anything with them yet".
 */
export function corpseHarvestView(
  componentTags: readonly string[],
  selected: ReadonlySet<string>,
): CorpseHarvestViewModel {
  const tags = [...new Set(componentTags)];
  const rows = tags.map((tag) => ({
    tag,
    checked: selected.has(tag),
    yieldsItem: harvestFamilyYieldsItem(tag),
  }));
  const checked = rows.filter((r) => r.checked);
  const chosen = checked.map((r) => r.tag);
  // The sim's own predicates, imported rather than restated: the command
  // boundary refuses exactly this and rolls exactly that bonus, and a mirror
  // written twice is a mirror that drifts the first time
  // effectiveFocusComponents' spread rule moves.
  const forfeitsEveryYield = forfeitsEveryMappedYield(tags, chosen);
  const corpseHarvestable = isHarvestableCorpse(tags);
  const harvestDisabled = !corpseHarvestable || forfeitsEveryYield;
  return {
    rows,
    harvestDisabled,
    // Gated on the button, because the field describes the harvest this button
    // would RUN: a pick that forfeits everything scores the whole tag count
    // (nothing is extracted, so all of it is forfeited breadth), which would
    // read as maximally concentrated for a harvest that cannot happen.
    concentrated:
      !harvestDisabled &&
      harvestConcentrationBonus(tags, chosen) > harvestConcentrationBonus(tags, []),
    forfeitsEveryYield,
    corpseHarvestable,
  };
}
