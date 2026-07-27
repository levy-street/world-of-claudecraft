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

import { forfeitsEveryMappedYield, isHarvestableCorpse } from '../../../sim/professions/gathering';

export interface CorpseHarvestRow {
  readonly tag: string;
  readonly checked: boolean;
}

export interface CorpseHarvestViewModel {
  readonly rows: CorpseHarvestRow[];
  readonly harvestDisabled: boolean;
  readonly concentrated: boolean; // true when the current selection is a strict subset of all tags
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
 * map to nothing (fen_troll: claw, tusk) NO pick forfeits anything, because no
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
 * Rows are deliberately NOT filtered to the mapped families: filtering would
 * change what "check every box" submits, and so would move the concentration
 * bonus (`taggedComponents.length - effectiveChosen.length`) on nine shipped mobs.
 */
export function corpseHarvestView(
  componentTags: readonly string[],
  selected: ReadonlySet<string>,
): CorpseHarvestViewModel {
  const tags = [...new Set(componentTags)];
  const rows = tags.map((tag) => ({ tag, checked: selected.has(tag) }));
  const checked = rows.filter((r) => r.checked);
  // The sim's own predicate, imported rather than restated: the command
  // boundary refuses exactly this, and a mirror written twice is a mirror that
  // drifts the first time effectiveFocusComponents' spread rule moves.
  const forfeitsEveryYield = forfeitsEveryMappedYield(
    tags,
    checked.map((r) => r.tag),
  );
  const corpseHarvestable = isHarvestableCorpse(tags);
  return {
    rows,
    harvestDisabled: !corpseHarvestable || forfeitsEveryYield,
    concentrated: checked.length > 0 && checked.length < tags.length,
    forfeitsEveryYield,
    corpseHarvestable,
  };
}
