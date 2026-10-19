// Calendar-bound character ledgers, copied at the character save boundary.
// Preserve field order and sparse defaults so untouched characters keep their
// existing save representation. Seasonal discovery shares this boundary.
import { craftDailySaveFragment, wyrmfallDailySaveFragment } from './professions/daily_gate_load';
import { seasonalSaveFragment } from './seasonal/seasonal_state';
import type { PlayerMeta } from './sim';

export function savedCharacterCalendar(
  meta: Pick<
    PlayerMeta,
    | 'delveDaily'
    | 'heroicDaily'
    | 'wyrmfallDaily'
    | 'emberWeekAnchor'
    | 'craftDaily'
    | 'seasonalDay'
    | 'seasonalKnocked'
    | 'pumpkinHeadWorn'
    | 'hauntedPumpkins'
  >,
) {
  return {
    delveDaily: {
      date: meta.delveDaily.date,
      firstClearXp: [...meta.delveDaily.firstClearXp],
      markClears: meta.delveDaily.markClears,
    },
    heroicDaily: { date: meta.heroicDaily.date, marked: [...meta.heroicDaily.marked] },
    // Empty material and recipe ledgers omit their optional save fields.
    ...wyrmfallDailySaveFragment(meta.wyrmfallDaily),
    ...(meta.emberWeekAnchor !== '' ? { emberWeekAnchor: meta.emberWeekAnchor } : {}),
    ...craftDailySaveFragment(meta.craftDaily),
    ...seasonalSaveFragment(meta),
  };
}
