// Loot Explorer: the pure encounter-narrowing core. Builds the Encounter
// dropdown's option list (instances, then their bosses in progression order)
// for the categories that have bosses (raid, dungeon, world boss), and the
// card order the "By Encounter" tab paints in, so a boss's Normal and Heroic
// tables always sit side by side instead of scattered through the list.
//
// DOM-free and i18n-free like loot_explorer_view.ts: emits raw ids only; the
// painter (loot_explorer_window.ts) resolves names. Registered in
// UI_PURE_CORES (tests/architecture.test.ts); driven directly by
// tests/loot_explorer_encounters.test.ts.

import { FINDER_ACTIVITIES } from '../../../sim/content/dungeon_finder';
import { MOBS } from '../../../sim/data';
import {
  type EncounterFilterCategory,
  LOOT_EXPLORER_CATEGORIES,
  type LootExplorerEncounter,
  type LootExplorerIndex,
} from './loot_explorer_view';

/** One option group in the Encounter dropdown. Raid and dungeon groups carry
 *  the instance id (its "whole instance" option plus one option per boss);
 *  the world boss list is a single group with no instance. */
export interface LootExplorerEncounterGroup {
  contextId?: string;
  bossMobIds: readonly string[];
}

/** mobId -> its position in the Dungeon Finder's authored encounter order
 *  (activity order, then encounter order inside it). The finder registry is
 *  the one place boss progression is authored, so the dropdown reads it
 *  rather than inventing an order. */
function buildEncounterOrder(): Map<string, number> {
  const out = new Map<string, number>();
  for (const activity of FINDER_ACTIVITIES) {
    for (const encounter of activity.encounters) {
      if (!out.has(encounter.mobId)) out.set(encounter.mobId, out.size);
    }
  }
  return out;
}

let encounterOrder: Map<string, number> | null = null;
function orderOf(mobId: string): number {
  encounterOrder ??= buildEncounterOrder();
  return encounterOrder.get(mobId) ?? Number.POSITIVE_INFINITY;
}

/** A mob counts as a boss for the dropdown when the finder lists it as an
 *  encounter or its template is flagged a boss (a named instance mid-boss
 *  included). Trash stays reachable through the "whole instance" option. */
function isBossMob(mobId: string, category: EncounterFilterCategory): boolean {
  if (category === 'world_boss') return true;
  if (Number.isFinite(orderOf(mobId))) return true;
  const mob = MOBS[mobId];
  return !!(mob?.boss || mob?.bossCorpseHold);
}

function byOrderThenId(a: string, b: string): number {
  const diff = orderOf(a) - orderOf(b);
  if (diff !== 0 && Number.isFinite(diff)) return diff;
  if (Number.isFinite(orderOf(a)) !== Number.isFinite(orderOf(b))) {
    return Number.isFinite(orderOf(a)) ? -1 : 1;
  }
  return a.localeCompare(b);
}

/** The Encounter dropdown's groups for one category, built from the index so
 *  an instance or boss that pays no item never shows up as a dead option. */
export function lootExplorerEncounterGroups(
  index: LootExplorerIndex,
  category: EncounterFilterCategory,
): LootExplorerEncounterGroup[] {
  const bossesByContext = new Map<string, Set<string>>();
  for (const item of index.items) {
    for (const source of item.sources) {
      if (source.category !== category) continue;
      const key = source.contextId ?? '';
      let bosses = bossesByContext.get(key);
      if (!bosses) {
        bosses = new Set();
        bossesByContext.set(key, bosses);
      }
      if (isBossMob(source.sourceId, category)) bosses.add(source.sourceId);
    }
  }
  const groups: LootExplorerEncounterGroup[] = [...bossesByContext.entries()].map(
    ([contextId, bosses]) => ({
      contextId: contextId || undefined,
      bossMobIds: [...bosses].sort(byOrderThenId),
    }),
  );
  const groupOrder = (g: LootExplorerEncounterGroup) =>
    Math.min(Number.POSITIVE_INFINITY, ...g.bossMobIds.map(orderOf));
  groups.sort((a, b) => {
    const diff = groupOrder(a) - groupOrder(b);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return (a.contextId ?? '').localeCompare(b.contextId ?? '');
  });
  return groups;
}

const DIFFICULTY_ORDER = { normal: 0, heroic: 1 } as const;
const MOB_CATEGORIES = new Set(['raid', 'dungeon', 'world_boss', 'delve', 'open_world']);

/** The "By Encounter" card order: by source category, then (for mob drops)
 *  instance and boss progression, with each boss's Normal card directly
 *  before its Heroic one. Other categories keep their incoming order (the
 *  sort is stable). Returns a new array. */
export function sortLootExplorerEncounters(
  encounters: readonly LootExplorerEncounter[],
): LootExplorerEncounter[] {
  const categoryIndex = (c: LootExplorerEncounter['category']) =>
    LOOT_EXPLORER_CATEGORIES.indexOf(c);
  const contextOrder = new Map<string, number>();
  for (const enc of encounters) {
    const key = enc.contextId ?? '';
    contextOrder.set(key, Math.min(contextOrder.get(key) ?? Infinity, orderOf(enc.sourceId)));
  }
  return [...encounters].sort((a, b) => {
    const cat = categoryIndex(a.category) - categoryIndex(b.category);
    if (cat !== 0) return cat;
    if (!MOB_CATEGORIES.has(a.category)) return 0;
    const ca = contextOrder.get(a.contextId ?? '') ?? Infinity;
    const cb = contextOrder.get(b.contextId ?? '') ?? Infinity;
    if (ca !== cb) return ca < cb ? -1 : 1;
    const ctx = (a.contextId ?? '').localeCompare(b.contextId ?? '');
    if (ctx !== 0) return ctx;
    const boss = a.sourceId === b.sourceId ? 0 : byOrderThenId(a.sourceId, b.sourceId);
    if (boss !== 0) return boss;
    const da = a.difficulty ? DIFFICULTY_ORDER[a.difficulty] : 2;
    const db = b.difficulty ? DIFFICULTY_ORDER[b.difficulty] : 2;
    return da - db;
  });
}
