// Gathering profession content (data-as-code, exempt from module-first size
// rules per root CLAUDE.md: this is a declarative table, not logic). Starter
// set is Mining, Logging, Herbalism; the state and gain logic live in
// ../professions/gathering.ts behind the SimContext seam. `icon` is a plain
// identifier (no emoji glyph, per the repo copy rule); a future UI surface
// resolves it to a procedural icon the same way ability/item icons do.
//
// Each def extends the settled `ProfessionRecord` shape (src/sim/professions/
// types.ts, from #1164) with the display metadata (name/icon/description)
// the `/dev gather` chat cheat and a future UI need; category/maxSkill are
// the fields later profession issues (#1120/#1125/#1126/#1140) read against.
// maxSkill follows the classic 1-300 profession skill scale.
import type { ProfessionRecord } from '../professions/types';

export type GatheringProfessionId = 'mining' | 'logging' | 'herbalism';

export interface GatheringProfessionDef extends ProfessionRecord {
  id: GatheringProfessionId;
  name: string;
  icon: string;
  description: string;
}

export const GATHERING_PROFESSIONS: Record<GatheringProfessionId, GatheringProfessionDef> = {
  mining: {
    id: 'mining',
    category: 'gathering',
    maxSkill: 300,
    name: 'Mining',
    icon: 'mining',
    description: 'Extracting ore and stone from nodes found in the wild.',
  },
  logging: {
    id: 'logging',
    category: 'gathering',
    maxSkill: 300,
    name: 'Logging',
    icon: 'logging',
    description: 'Felling timber from trees found across the zones.',
  },
  herbalism: {
    id: 'herbalism',
    category: 'gathering',
    maxSkill: 300,
    name: 'Herbalism',
    icon: 'herbalism',
    description: 'Collecting herbs and plants growing in the wild.',
  },
};

// Stable iteration order, used for defaulting/normalizing a per-player
// proficiency record. Keep in sync with GATHERING_PROFESSIONS above.
export const GATHERING_PROFESSION_IDS: GatheringProfessionId[] = ['mining', 'logging', 'herbalism'];
// Ten-craft ring content: pure data plus pure helper functions. No engine logic,
// no mechanic wiring: this file only defines the ring geometry (order, pole tags)
// and the adjacency/opposite lookups derived from it. See issue #1125.
//
// Design-doc note: the canonical ring order lives at
// https://woc.nervemart.com/docs/professions-system, which returned 403 Forbidden
// when this file was authored. The ring below is a reasonable placeholder pending
// maintainer confirmation against the design doc: a 10-craft circle, opposite =
// 5 positions away, adjacent = 1 position away either side, with the 4 poles grouped
// as evenly as sensible (Material: crafts that shape raw matter into gear;
// Experimental: crafts driven by trial-and-error formulae; Formal: crafts built on
// exact patterns/measurements; Cross-cutting: crafts that touch every other craft's
// output). Flag any correction needed once the doc is reachable.

export type CraftPole = 'Material' | 'Experimental' | 'Formal' | 'Cross-cutting';

export interface CraftDef {
  id: string;
  name: string;
  pole: CraftPole;
}

// Fixed ring order (index is the ring position). Opposite crafts sit 5 positions
// apart; adjacent crafts sit 1 position apart on either side.
export const CRAFT_RING: CraftDef[] = [
  { id: 'armorcrafting', name: 'Armorcrafting', pole: 'Material' },
  { id: 'weaponcrafting', name: 'Weaponcrafting', pole: 'Material' },
  { id: 'jewelcrafting', name: 'Jewelcrafting', pole: 'Material' },
  { id: 'alchemy', name: 'Alchemy', pole: 'Experimental' },
  { id: 'engineering', name: 'Engineering', pole: 'Experimental' },
  { id: 'cooking', name: 'Cooking', pole: 'Cross-cutting' },
  { id: 'inscription', name: 'Inscription', pole: 'Cross-cutting' },
  { id: 'enchanting', name: 'Enchanting', pole: 'Cross-cutting' },
  { id: 'tailoring', name: 'Tailoring', pole: 'Formal' },
  { id: 'leatherworking', name: 'Leatherworking', pole: 'Formal' },
];

const RING_SIZE = CRAFT_RING.length;

const CRAFT_INDEX: ReadonlyMap<string, number> = new Map(
  CRAFT_RING.map((craft, index) => [craft.id, index]),
);

function indexOf(craftId: string): number {
  const index = CRAFT_INDEX.get(craftId);
  if (index === undefined) {
    throw new Error(`unknown craft id: ${craftId}`);
  }
  return index;
}

/** The two crafts one ring position away from the given craft, on either side. */
export function adjacentCrafts(craftId: string): [CraftDef, CraftDef] {
  const index = indexOf(craftId);
  const prev = CRAFT_RING[(index - 1 + RING_SIZE) % RING_SIZE];
  const next = CRAFT_RING[(index + 1) % RING_SIZE];
  return [prev, next];
}

/** The craft directly opposite the given craft (halfway around the ring). */
export function oppositeCraft(craftId: string): CraftDef {
  const index = indexOf(craftId);
  return CRAFT_RING[(index + RING_SIZE / 2) % RING_SIZE];
}

/** Lookup a craft definition by id. */
export function craftById(craftId: string): CraftDef {
  return CRAFT_RING[indexOf(craftId)];
}
