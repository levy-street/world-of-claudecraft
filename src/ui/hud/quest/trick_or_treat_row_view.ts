// The trick-or-treat row of the NPC gossip menu: a pure lookup from the world's
// mirrored seasonal state (IWorldSeasonal: the running event and today's knocks)
// to what the dialog shows at THIS NPC. The sim owns every rule (seasonal/
// trick_or_treat.ts re-checks the event, the reach and the day's ledger); this
// only decides whether to offer the knock, or to say it was already made today.
import { GOURDLIGHT_DAILY_BOO_QUEST_ID } from '../../../sim/content/gourdlight_eve_dailies';
import { booLedgerKey, wearsGourdlightCostume } from '../../../sim/seasonal/gourdlight_dailies';
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

/** The Boo! daily's row at a townsperson (seasonal/gourdlight_dailies.ts owns the rules
 *  and re-checks all of them): offered to a player on the errand, a hint to put on a
 *  costume first, or a note that this one was already frightened today. */
export type BooRow = 'offer' | 'needsCostume' | 'frightened';

export function booRowFor(
  activeEvent: string | null | undefined,
  onErrand: boolean,
  costumed: boolean,
  todayLedger: readonly string[] | undefined,
  npcTemplateId: string,
): BooRow | null {
  if (!activeEvent || !onErrand || !isTrickOrTreatNpc(npcTemplateId)) return null;
  if (todayLedger?.includes(booLedgerKey(npcTemplateId))) return 'frightened';
  return costumed ? 'offer' : 'needsCostume';
}

/** Both townsfolk rows: the knock and the fright. */
export interface SeasonalTownsfolkRows {
  knock: TrickOrTreatRow | null;
  boo: BooRow | null;
}

/** The world state the rows read (the IWorld facets' slices). */
export interface SeasonalRowsWorld {
  readonly activeSeasonalEvent: string | null;
  readonly trickOrTreatedToday: readonly string[];
  readonly questLog: ReadonlyMap<string, { state: string }>;
  readonly player: { readonly auras: readonly { id: string }[] };
}

export function seasonalTownsfolkRows(
  world: SeasonalRowsWorld,
  npcTemplateId: string,
): SeasonalTownsfolkRows {
  const knock = trickOrTreatRowFor(
    world.activeSeasonalEvent,
    world.trickOrTreatedToday,
    npcTemplateId,
  );
  // the errand is read first, so a world with no seasonal event (or no player auras
  // yet) never pays for the costume walk
  const onErrand = world.questLog?.get(GOURDLIGHT_DAILY_BOO_QUEST_ID)?.state === 'active';
  if (!knock || !onErrand) return { knock, boo: null };
  return {
    knock,
    boo: booRowFor(
      world.activeSeasonalEvent,
      onErrand,
      wearsGourdlightCostume(world.player?.auras ?? []),
      world.trickOrTreatedToday,
      npcTemplateId,
    ),
  };
}

/** Staleness signature for both rows. */
export function seasonalTownsfolkRowsSig(rows: SeasonalTownsfolkRows): string {
  return `${rows.knock ?? ''}|${rows.boo ?? ''}`;
}
