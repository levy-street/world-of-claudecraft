// Pure view-core for the shared corpse-harvest preference picker (Intentional
// Gathering PR3): one radio choice of All or a single material, reused
// unmodified by the Field Kit use, Professions, and corpse Change entrances.
// DOM/i18n-free; the thin painter (harvest_preference_picker.ts) resolves
// display names and paints from this model. Decides no yield, spends no
// claim, and knows nothing of the timed harvest cast: it is a setting.

import {
  corpseHarvestPreferenceOptions,
  generalHarvestMaterialOptions,
  HARVEST_PREFERENCE_ALL_TOKEN,
  type HarvestPreference,
} from '../../../sim/professions/harvest_preference';

export interface HarvestPreferenceRow {
  /** Radio value: HARVEST_PREFERENCE_ALL_TOKEN, or the material's item id. */
  readonly token: string;
  /** null only for the All row. */
  readonly itemId: string | null;
}

export interface HarvestPreferencePickerViewModel {
  readonly rows: readonly HarvestPreferenceRow[];
  /**
   * The row to preselect, or null. Null for a malformed (`preference ===
   * null`) load AND for a stored material this list does not offer: both
   * ask the player for an explicit new choice rather than silently
   * defaulting to All.
   */
  readonly selectedToken: string | null;
  /**
   * Set only when `preference` names a MATERIAL not among `rows` (retired
   * from the catalog entirely, or simply not on this corpse), carrying the
   * raw stored id so the painter can still describe the player's current
   * choice even though it cannot be reselected as-is. Never set for a
   * malformed (null) preference: there is no choice to describe. This raw id
   * is state for that description ONLY; the painter must never print it
   * verbatim (see its header).
   */
  readonly currentUnavailableItemId: string | null;
}

/**
 * `componentTags` omitted: the general catalog (Field Kit use, Professions),
 * every catalog-supported material behind one All-first row list. Supplied:
 * one corpse's offer (the Change entrance), already deduplicated by item id
 * (tusk and horn both fold into the one curved_tusk row).
 */
export function buildHarvestPreferencePickerView(
  preference: HarvestPreference | null,
  componentTags?: readonly string[],
): HarvestPreferencePickerViewModel {
  const rows: HarvestPreferenceRow[] = componentTags
    ? corpseHarvestPreferenceOptions(componentTags).map((option) =>
        option.kind === 'all'
          ? { token: HARVEST_PREFERENCE_ALL_TOKEN, itemId: null }
          : { token: option.itemId, itemId: option.itemId },
      )
    : [
        { token: HARVEST_PREFERENCE_ALL_TOKEN, itemId: null },
        ...generalHarvestMaterialOptions().map((option) => ({
          token: option.itemId,
          itemId: option.itemId,
        })),
      ];

  if (preference === null) {
    return { rows, selectedToken: null, currentUnavailableItemId: null };
  }
  if (preference.kind === 'all') {
    return { rows, selectedToken: HARVEST_PREFERENCE_ALL_TOKEN, currentUnavailableItemId: null };
  }
  const offered = rows.some((row) => row.itemId === preference.itemId);
  return offered
    ? { rows, selectedToken: preference.itemId, currentUnavailableItemId: null }
    : { rows, selectedToken: null, currentUnavailableItemId: preference.itemId };
}
