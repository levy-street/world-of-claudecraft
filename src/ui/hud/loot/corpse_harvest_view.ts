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
   * #2514: does this family have a harvest item behind it? False for a
   * carried-but-unmapped family, whose row is still offered (the corpse
   * really does carry it) but can extract nothing: checking it is a no-op
   * rather than a tier's worth of penalty, and the painter marks the row so
   * the box is not a silent one. Four shipped families were in that state
   * when #2514 landed (claw, tusk, gills, horn); #2905 mapped the first two
   * and Masterwrought Phase 11m the last two, so today the false arm is
   * driven only by the retagged fixtures of tests/helpers/unmapped_family.ts.
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
   * since #2514 the widest pick on a MIXED corpse (one carrying a family
   * with no item behind it) already carries a bonus: part of the corpse's
   * breadth is unreachable content rather than a choice the player declined.
   * No shipped corpse is mixed since #2905 (claw, tusk) and Masterwrought
   * Phase 11m (horn, gills) mapped the last unmapped families, so on shipped
   * content the empty pick's bonus is 0 and the two baselines coincide; the
   * distinction stays exercised on the retagged fixtures of
   * tests/helpers/unmapped_family.ts, where an `['antler','hide']` corpse
   * concentrates nothing (every legal pick's bonus is 1, the empty pick's
   * own), exactly the shape the three `gills, hide` murlocs had before 11m
   * mapped gills. Today `['hide']` on those murlocs is a genuine concentrate
   * (bonus 1 against the spread's 0), and on old_greyjaw (hide, fang, claw)
   * every strict subset is: `['hide']` bonus 2, `['hide','fang']` and
   * `['hide','claw']` bonus 1, the spread 0.
   *
   * Read off the sim's own bonus, never a checkbox count. On an all-mapped
   * corpse the two definitions coincide exactly, which is why the pre-#2514
   * count survived: it was right about the eight templates it was ever
   * tested on, and since Phase 11m it would be right on every shipped
   * template again. What retires it is the mixed shape, now fixture-only: on
   * a retagged `['hide','fang','antler']` corpse a count calls
   * `['hide','antler']` a two-family pick distinct from `['hide']` and calls
   * `['hide','fang','antler']` a full cover, and the sim disagrees with
   * both: the first extracts only hide at bonus 2, byte-identical to
   * `['hide']`, and the cover still forfeits antler at bonus 1, never 0.
   * (Before #2905, old_greyjaw's own claw demonstrated the first half on
   * shipped content.)
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
 * The ONE selection that is not: #2509. A carried-but-unmapped family (a tag
 * HARVEST_COMPONENT_ITEMS maps to no item) renders its row like any other,
 * so on a mixed corpse a player could check only such rows and submit. That
 * pick survives the sim's sanitization (the tags ARE carried), would spend
 * the single-use claim, and would grant nothing. The command boundary
 * refuses it (src/sim/interaction.ts harvestCorpse); this is the client
 * mirror of the same predicate, so the dead-end submit is not offered in the
 * first place. Four shipped families were in that state when #2509 landed
 * (claw, tusk, gills, horn); #2905 mapped the first two and Masterwrought
 * Phase 11m the last two, so no shipped corpse is mixed today and the corpse
 * suites drive this arm through the retagged fixtures of
 * tests/helpers/unmapped_family.ts.
 *
 * Mirrored EXACTLY, including where it does not fire: on a corpse whose tags all
 * map to nothing (a fixture retagged with the synthetic antler and fleece
 * families of tests/helpers/unmapped_family.ts; fen_troll (claw, tusk) was the
 * shipped case until #2905 mapped both) NO pick forfeits anything, because no
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
