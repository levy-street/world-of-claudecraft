// The Mirefen tavern's patrons: the regulars who sit in its seats (content/
// mirefen_tavern_seats.ts) as ambient company. Friendly, with a short word each when
// spoken to and nothing else (no quests, no stock). Data-as-code; ../mirefen_tavern.ts
// spawns them seated under their reserved ids.
//
// Each patron HOLDS the seat it sits in the same way a player does (a seated body on the
// seat's stand spot, seat_anchor.ts), so a player can never sit on top of one.
//
// Names are original and were checked against the major game wikis and this repo before
// shipping (docs/design/mirefen-tavern.md, "Patrons"): Amos Eelby, Grissel Sedgeworth,
// Ned Oxley, Hester Quillby.

import type { NpcDef } from '../types';
import { MIREFEN_TAVERN_SEATS } from './mirefen_tavern_seats';

/** What a seated patron does in their seat (the renderer's seated idle): chat with the
 *  companion beside them, nurse a drink, or lean back at ease. */
export type TavernPatronIdle = 'talk' | 'drink' | 'rest';

export interface TavernPatron {
  npcId: string;
  /** The reserved entity id (the singleton band, types.ts STATIC_WORLD_SERVICE note). */
  entityId: number;
  seatId: string;
  idle: TavernPatronIdle;
}

/** The regulars, each in their usual seat: the two old hands side by side on the hearth's
 *  far bench facing the door, the drover on a bar stool before the innkeeper, and the
 *  travelling mapmaker in the window booth left of the door. */
export const TAVERN_PATRONS: readonly TavernPatron[] = [
  {
    npcId: 'patron_amos_eelby',
    entityId: 1_000_000_021,
    seatId: 'tavern_hearth_2_0',
    // he nurses his ale and listens; she, on his right as they face the fire, talks
    // (the talking idle turns toward a companion on the sitter's left)
    idle: 'drink',
  },
  {
    npcId: 'patron_grissel_sedgeworth',
    entityId: 1_000_000_022,
    seatId: 'tavern_hearth_2_1',
    idle: 'talk',
  },
  {
    npcId: 'patron_ned_oxley',
    entityId: 1_000_000_023,
    seatId: 'tavern_barstool_1',
    idle: 'drink',
  },
  {
    npcId: 'patron_hester_quillby',
    entityId: 1_000_000_024,
    seatId: 'tavern_settle_2_1',
    idle: 'rest',
  },
];

function seatOf(patron: TavernPatron): (typeof MIREFEN_TAVERN_SEATS)[number] {
  const seat = MIREFEN_TAVERN_SEATS.find((s) => s.id === patron.seatId);
  if (!seat) throw new Error(`mirefen_tavern_patrons: no seat ${patron.seatId}`);
  return seat;
}

function patronNpc(
  patron: TavernPatron,
  name: string,
  title: string,
  color: number,
  greeting: string,
): NpcDef {
  const seat = seatOf(patron);
  return {
    id: patron.npcId,
    name,
    title,
    pos: { x: seat.standX, z: seat.standZ },
    facing: seat.facing,
    color,
    questIds: [],
    dynamic: true,
    greeting,
  };
}

const [amos, grissel, ned, hester] = TAVERN_PATRONS;

/** The patrons' NPC records: `dynamic`, so the world-init NPC loop skips them;
 *  ../mirefen_tavern.ts spawns each in its seat under its reserved id. */
export const MIREFEN_TAVERN_PATRON_NPCS: Record<string, NpcDef> = {
  [amos.npcId]: patronNpc(
    amos,
    'Amos Eelby',
    'Eel Fisher',
    0x5a6b3a,
    "Pull up a bench, $C. Grissel here swears the big eel under Fenbridge is a myth. I've had my hand on him twice. Twice! Slippery as a tax collector, and near as long as this bench.",
  ),
  [grissel.npcId]: patronNpc(
    grissel,
    'Grissel Sedgeworth',
    'Peat Cutter',
    0x7a5230,
    "Don't mind Amos. Forty years cutting peat and I've pulled more strange things out of this bog than he's pulled eels: boots, bones, a helmet with the head still worried about it. Warm yourself, the fire's free.",
  ),
  [ned.npcId]: patronNpc(
    ned,
    'Ned Oxley',
    'Drover',
    0x6e4a2a,
    "Drove forty head down the causeway and lost two to the mire before Fenbridge. Maudie's ale is the only thing on this road that never lets a man down. Buy your own, mind.",
  ),
  [hester.npcId]: patronNpc(
    hester,
    'Hester Quillby',
    'Mapmaker',
    0x3e5a7a,
    "Every map of this marsh I've ever bought was wrong within a season. The water moves the paths, and the paths move the water. So I draw my own, and I sit here where it's dry while the ink sets.",
  ),
};

/** Every tavern patron's NPC id. */
export const TAVERN_PATRON_NPC_IDS: readonly string[] = TAVERN_PATRONS.map((p) => p.npcId);
