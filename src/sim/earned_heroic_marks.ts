// Completed encounters cannot refuse already-earned currency. Keep overflow
// in the existing authored reward parcel until the player spends enough marks.
import { HEROIC_MARK_CURRENCY_ID } from './content/dungeon_difficulty';
import { assertHeroicMarksGrantsFit, sanitizeHeroicMarks } from './heroic_marks';
import type { SimContext } from './sim_context';

export function grantEarnedHeroicMarks(ctx: SimContext, pid: number, count: number): void {
  const meta = ctx.players.get(pid);
  if (!meta || meta.leaving) return;
  // Invalid reward amounts remain programmer errors, never oversized parcels.
  assertHeroicMarksGrantsFit({ heroicMarks: 0 }, [{ itemId: HEROIC_MARK_CURRENCY_ID, count }]);
  if (
    Math.max(0, Math.floor(count)) >
    Number.MAX_SAFE_INTEGER - sanitizeHeroicMarks(meta.heroicMarks)
  ) {
    ctx.mailHeroicMarks(pid, HEROIC_MARK_CURRENCY_ID, count);
  } else {
    ctx.addItem(HEROIC_MARK_CURRENCY_ID, count, pid);
  }
}
