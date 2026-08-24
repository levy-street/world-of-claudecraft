// WHICH GATHERING LINE SUPPLIES WHICH MATERIAL: one authority, derived from
// the shipped content tables and never hand-listed (masterwrought Phase 11k).
//
// WHY IT IS A MODULE AND NOT A TEST HELPER. This derivation was written inside
// tests/gathering_supply_coverage.test.ts at Phase 11j, which was the right
// place for it while the guard was its only reader. The provisioning wiki page
// is a SECOND reader, and the packet's own recorded lesson is that a fixture
// driving a COPY of a rule proves nothing about the rule: a page built on a
// second implementation could tell a player one thing while the guard asserted
// another, and both would be green. So the derivation moved here as a pure
// leaf and both sides import it. This is a MOVE, not a rewrite: every function
// below has the body it had in the guard.
//
// PURE LEAF: no SimContext, no rng, no clock, no player state. It reads content
// tables and answers a question about them.

import { FARM_CROPS } from '../content/farm_crops';
import { FISHING_TABLES_BY_BAND } from '../content/items';
import type { GatheringProfessionId } from '../content/professions';
import {
  GATHERING_PROFESSION_IDS,
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../content/professions';
import { ITEMS } from '../data';
import type { GatherNodeType } from '../types';
import { NODE_HARVEST_TABLE, NODE_MATERIAL_TABLE } from './gathering';
import { MATERIAL_GRADES } from './material_grades';

/** The sixth family. Corpse harvesting is a gathering FAMILY without being a
 *  gathering PROFESSION: it has no id in GATHERING_PROFESSION_IDS, no counter
 *  and no tool of its own, but it is a faucet the crafts eat from, so
 *  masterwrought decision C binds it with the other five rather than leaving
 *  it unreported. */
export const CORPSE_HARVEST_FAMILY = 'corpseHarvesting';

/**
 * mining / logging / herbalism: the NODE_MATERIAL_TABLE yields for whichever
 * node type NODE_HARVEST_TABLE says this profession harvests, plus each
 * yield's fine twin. Resolved through the tables rather than by hard-coding
 * ore/wood/herb, so a fourth node type joins its profession automatically.
 */
export function nodeSupplyFor(professionId: GatheringProfessionId): Set<string> {
  const ids = new Set<string>();
  for (const nodeType of Object.keys(NODE_HARVEST_TABLE) as GatherNodeType[]) {
    if (NODE_HARVEST_TABLE[nodeType].professionId !== professionId) continue;
    for (const cell of Object.values(NODE_MATERIAL_TABLE[nodeType])) {
      ids.add(cell.itemId);
      const fine = MATERIAL_GRADES[cell.itemId]?.fineItemId;
      if (fine !== undefined) ids.add(fine);
    }
  }
  return ids;
}

/**
 * fishing: every catchable id in the band tables, minus grey junk BY ITS DEF
 * (quality 'poor') rather than by an id list. Grey junk is a coin drop dressed
 * as a catch, never supply: sellAllJunk vendors it. The null rows are the
 * empty-hook weight and carry no id at all.
 */
export function fishingSupply(): Set<string> {
  const ids = new Set<string>();
  for (const band of FISHING_TABLES_BY_BAND) {
    for (const table of Object.values(band)) {
      for (const entry of table) {
        if (entry.itemId === null) continue;
        if (ITEMS[entry.itemId]?.quality === 'poor') continue;
        ids.add(entry.itemId);
      }
    }
  }
  return ids;
}

/** farming: both grades of every crop, off the crop records themselves. */
export function farmingSupply(): Set<string> {
  const ids = new Set<string>();
  for (const crop of Object.values(FARM_CROPS)) {
    ids.add(crop.produceItemId);
    ids.add(crop.fineProduceItemId);
  }
  return ids;
}

/** corpse harvesting: the ordinary components plus the premium specimens. */
export function corpseSupply(): Set<string> {
  return new Set([
    ...Object.values(HARVEST_COMPONENT_ITEMS),
    ...Object.values(HARVEST_COMPONENT_SPECIMENS),
  ]);
}

/**
 * The supply map: one id set per family. THE SUBJECT LIST IS DERIVED from
 * GATHERING_PROFESSION_IDS (masterwrought decision C) so a sixth gathering
 * profession joins every reader the day it is authored, with corpse harvesting
 * appended as the one family that has no profession id.
 */
export function gatheringSupplyByFamily(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const professionId of GATHERING_PROFESSION_IDS) {
    if (professionId === 'fishing') out.set(professionId, fishingSupply());
    else if (professionId === 'farming') out.set(professionId, farmingSupply());
    else out.set(professionId, nodeSupplyFor(professionId));
  }
  out.set(CORPSE_HARVEST_FAMILY, corpseSupply());
  return out;
}
