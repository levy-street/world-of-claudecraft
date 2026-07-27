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

import { forfeitsEveryMappedYield } from '../../../sim/professions/gathering';

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
 * Mirrored EXACTLY, including where it does not fire: a corpse whose tags all
 * map to nothing (fen_troll: claw, tusk) forfeits nothing whatever the player
 * checks, so it stays enabled and keeps its documented zero-yield path. Rows
 * are deliberately NOT filtered to the mapped families: filtering would change
 * what "check every box" submits, and so would move the concentration bonus
 * (`taggedComponents.length - effectiveChosen.length`) on nine shipped mobs.
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
  return {
    rows,
    harvestDisabled: tags.length === 0 || forfeitsEveryYield,
    concentrated: checked.length > 0 && checked.length < tags.length,
    forfeitsEveryYield,
  };
}
