// The trick-or-treat row of the NPC gossip menu: a pure lookup from the world's
// mirrored seasonal state (IWorldSeasonal: the running event and today's knocks)
// to what the dialog shows at THIS NPC. The sim owns every rule (seasonal/
// trick_or_treat.ts re-checks the event, the reach and the day's ledger); this
// only decides whether to offer the knock, or to say it was already made today.
import { isTrickOrTreatNpc } from '../../../sim/seasonal/trick_or_treat';

export type TrickOrTreatRow = 'offer' | 'knocked';

/** The row for `npcTemplateId`, or null when no event runs or the NPC does not
 *  answer a knock. */
export function trickOrTreatRowFor(
  activeEvent: string | null | undefined,
  knockedToday: readonly string[] | undefined,
  npcTemplateId: string,
): TrickOrTreatRow | null {
  if (!activeEvent || !isTrickOrTreatNpc(npcTemplateId)) return null;
  return knockedToday?.includes(npcTemplateId) ? 'knocked' : 'offer';
}

/** Staleness signature for the open dialog's refreshIfChanged watch. */
export function trickOrTreatRowSig(row: TrickOrTreatRow | null): string {
  return row ?? '';
}
