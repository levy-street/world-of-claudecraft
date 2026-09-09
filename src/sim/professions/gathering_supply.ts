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
// PURE in the sense that matters here: no SimContext, no rng, no clock, no
// player state. It reads content tables and answers a question about them.
//
// NOT a dependency-free leaf, and saying so matters to its second consumer:
// `./gathering` is imported for NODE_HARVEST_TABLE and NODE_MATERIAL_TABLE, and
// that module is a full profession system, so every importer (the wiki
// generator included) pulls its transitive closure. The derivation itself
// touches only the two tables. Moving those two tables into a data-only leaf
// would make this a true leaf; that is a larger extraction than this phase
// owns, so the cost is recorded rather than implied away.

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

// ---------------------------------------------------------------------------
// THE REVERSE LOOKUP (Intentional Gathering PR4): given an item id, which
// gathering family (if any) supplies it, plus, for a corpse-harvest item, the
// ORDINARY MATERIAL id a harvest preference actually stores (never a tag,
// never the specimen id itself; harvest_preference.ts states that contract).
// Built once from gatheringSupplyByFamily() plus the same
// HARVEST_COMPONENT_ITEMS / HARVEST_COMPONENT_SPECIMENS tables the preference
// module reads, so this is a SECOND reader of those two tables, never a
// second registry: nothing here invents a source id gathering_supply.ts does
// not already derive.
// ---------------------------------------------------------------------------

/** One family's answer for one item id. `corpsePreferenceItemId` is non-null
 *  ONLY when `familyId` is the corpse family and the item resolves to a
 *  material a harvest preference can target: the plain component item itself
 *  (corpsePreferenceItemId === the id being looked up) or a Pristine specimen
 *  (corpsePreferenceItemId names the ordinary material behind it, e.g.
 *  pristine_hide -> rough_hide). Every node/fish/farm hint carries null here:
 *  there is no harvest-preference concept for those families. */
export interface GatheringSupplyHint {
  readonly familyId: GatheringProfessionId | typeof CORPSE_HARVEST_FAMILY;
  readonly corpsePreferenceItemId: string | null;
}

const NO_SUPPLY_HINTS: readonly GatheringSupplyHint[] = Object.freeze([]);

/** Composite dedupe key: horn and tusk both map to curved_tusk, so both tags'
 *  loop iterations must collapse to exactly ONE hint on that item, not two
 *  identical ones. */
function hintKey(hint: GatheringSupplyHint): string {
  return `${hint.familyId}|${hint.corpsePreferenceItemId ?? ''}`;
}

function buildSupplyHintIndex(): ReadonlyMap<string, readonly GatheringSupplyHint[]> {
  const byItem = new Map<string, Map<string, GatheringSupplyHint>>();
  const add = (itemId: string, hint: GatheringSupplyHint): void => {
    let hints = byItem.get(itemId);
    if (!hints) {
      hints = new Map();
      byItem.set(itemId, hints);
    }
    // Frozen at construction, matching the array's own freeze below: the
    // cache is documented immutable end to end, row objects included, so a
    // caller can never mutate a shared hint out from under a later reader.
    hints.set(hintKey(hint), Object.freeze(hint));
  };

  for (const [family, ids] of gatheringSupplyByFamily()) {
    if (family === CORPSE_HARVEST_FAMILY) continue; // corpse hints are built below, per component
    for (const itemId of ids) {
      add(itemId, { familyId: family as GatheringProfessionId, corpsePreferenceItemId: null });
    }
  }
  // Every plain component item names itself as the preference target.
  for (const itemId of Object.values(HARVEST_COMPONENT_ITEMS)) {
    add(itemId, { familyId: CORPSE_HARVEST_FAMILY, corpsePreferenceItemId: itemId });
  }
  // Every Pristine specimen names the ORDINARY material behind its own
  // component tag as the preference target (a preference is never a
  // specimen id): materialId is undefined only for a specimen family with no
  // HARVEST_COMPONENT_ITEMS row, which does not exist on the shipped tables.
  for (const [component, specimenId] of Object.entries(HARVEST_COMPONENT_SPECIMENS)) {
    const materialId = HARVEST_COMPONENT_ITEMS[component];
    if (materialId === undefined) continue;
    add(specimenId, { familyId: CORPSE_HARVEST_FAMILY, corpsePreferenceItemId: materialId });
  }

  const frozen = new Map<string, readonly GatheringSupplyHint[]>();
  for (const [itemId, hints] of byItem) frozen.set(itemId, Object.freeze([...hints.values()]));
  return frozen;
}

// Lazily built and cached: the content tables this derives from are frozen
// for the life of the process, so the index never needs invalidation. Cached
// as a plain module-level singleton (never exposed directly: a caller only
// ever sees gatheringSupplyHintsForItem's per-id, already-frozen answer), the
// same pattern reliquary.ts's content-keyed memos use for an immutable table.
let cachedSupplyHintIndex: ReadonlyMap<string, readonly GatheringSupplyHint[]> | null = null;

/**
 * Every gathering family that supplies `itemId`, most specific first (there
 * is no ordering rule beyond insertion order today: no shipped item is
 * supplied by two families). Unknown, prototype, and non-supplied ids all
 * answer the same frozen empty array; the returned array is never mutable, so
 * a caller can never corrupt the shared cache.
 */
export function gatheringSupplyHintsForItem(itemId: string): readonly GatheringSupplyHint[] {
  if (cachedSupplyHintIndex === null) cachedSupplyHintIndex = buildSupplyHintIndex();
  return cachedSupplyHintIndex.get(itemId) ?? NO_SUPPLY_HINTS;
}
