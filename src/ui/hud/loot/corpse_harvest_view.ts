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

export interface CorpseHarvestRow {
  readonly tag: string;
  readonly checked: boolean;
}

export interface CorpseHarvestViewModel {
  readonly rows: CorpseHarvestRow[];
  readonly harvestDisabled: boolean;
  readonly concentrated: boolean; // true when the current selection is a strict subset of all tags
}

/**
 * Build the picker's row list + harvest-button state.
 * `componentTags`: every tag on this corpse (order-preserving, de-duplicated).
 * `selected`: the tags currently checked. An empty selection is allowed (it
 * means "spread across all", matching the pre-#1142 default) and is NOT
 * disabled: the harvest button always enables once the corpse is
 * harvestable, since submitting an empty/partial selection is well-defined.
 */
export function corpseHarvestView(
  componentTags: readonly string[],
  selected: ReadonlySet<string>,
): CorpseHarvestViewModel {
  const tags = [...new Set(componentTags)];
  const rows = tags.map((tag) => ({ tag, checked: selected.has(tag) }));
  const checkedCount = rows.filter((r) => r.checked).length;
  return {
    rows,
    harvestDisabled: tags.length === 0,
    concentrated: checkedCount > 0 && checkedCount < tags.length,
  };
}
