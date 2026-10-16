// Studio fork content that belongs to AUTHORED maps, never to the built-in world.
//
// The Studio merge brought the fork's own game content along with the map
// editor: the Scorching Wastes roster, Goldcrest Harbor's zone and the
// map-objectives rehearsal champion. Registered in the built-in lookup tables,
// every one of those changes the default world: the quest and item rows grow
// every saved character, and every NPC row is ringed by a terrain calm pad.
// So the built-in tables stay exactly the release's,
// and this overlay is merged into them only while an authored map is the
// active content (data.ts setActiveWorldContent), then removed again when the
// built-in world comes back.
//
// Pure leaf over plain records: no rng, no SimContext. data.ts owns the tables
// and hands them in, so this module never imports data.ts (no value cycle).

import { GOLDCREST_ZONE } from './content/goldcrest';
import { OBJECTIVE_BOT_MOB, OBJECTIVE_BOT_TEMPLATE_ID } from './content/objective_bots';
import {
  SCORCHING_ITEMS,
  SCORCHING_MOBS,
  SCORCHING_NPCS,
  SCORCHING_QUEST_ORDER,
  SCORCHING_QUESTS,
} from './content/scorching_wastes';
import type { DungeonDef, ItemDef, MobTemplate, NpcDef, QuestDef, ZoneDef } from './types';

/** The Studio records an authored map may resolve by id. */
export const STUDIO_CONTENT = {
  items: { ...SCORCHING_ITEMS } as Record<string, ItemDef>,
  mobs: {
    ...SCORCHING_MOBS,
    [OBJECTIVE_BOT_TEMPLATE_ID]: OBJECTIVE_BOT_MOB,
  } as Record<string, MobTemplate>,
  // All dynamic: the authored map that wants them places them itself, and
  // every reader that resolves an NPC by templateId (nameplates, gossip flags,
  // vendor stock) finds the row here. The built-in NPC table is read by more
  // than lookups (the terrain calm pads ring every row in it,
  // terrain_calm_anchors.ts), so a dynamic row there would still reshape the
  // default world's ground.
  npcs: { ...SCORCHING_NPCS } as Record<string, NpcDef>,
  quests: { ...SCORCHING_QUESTS } as Record<string, QuestDef>,
  questOrder: [...SCORCHING_QUEST_ORDER] as readonly string[],
  // No Studio dungeon is registered today; the slot (and its list/index
  // bookkeeping below) stays for the next authored-map dungeon.
  dungeons: {} as Record<string, DungeonDef>,
  // Name lookup only, never merged into ZONES: an authored map carries its
  // own zone list (the Goldcrest map document declares this zone itself), and
  // the built-in ZONES fold the world's bounds and terrain at load.
  zones: [GOLDCREST_ZONE] as readonly ZoneDef[],
  // Quest ids a built-in NPC also offers on an authored map (none today).
  npcQuestIds: {} as Record<string, readonly string[]>,
} as const;

/** The live tables the overlay writes into (data.ts passes its own). */
export interface StudioOverlayTables {
  items: Record<string, ItemDef>;
  mobs: Record<string, MobTemplate>;
  npcs: Record<string, NpcDef>;
  quests: Record<string, QuestDef>;
  questOrder: string[];
  dungeons: Record<string, DungeonDef>;
  /** Sorted by index; kept sorted. */
  dungeonList: DungeonDef[];
  dungeonByIndex: (DungeonDef | undefined)[];
}

interface Installed {
  items: string[];
  mobs: string[];
  npcs: string[];
  quests: string[];
  questOrder: string[];
  dungeons: string[];
  npcQuestIds: Map<string, string[]>;
}

let installed: Installed | null = null;

/** Whether the Studio records are currently merged into the tables. */
export function studioOverlayInstalled(): boolean {
  return installed !== null;
}

/** True when `id` is an NPC or dungeon row the overlay put into the built-in
 *  tables (false for every row the release itself registers). Readers that
 *  derive per-seed world shape from those tables (terrain_calm_anchors.ts)
 *  skip such rows, so a cache built while an authored map was active can never
 *  carry Studio shaping back into the default world. */
export function isStudioOverlayRow(kind: 'npc' | 'dungeon', id: string): boolean {
  if (installed === null) return false;
  return (kind === 'npc' ? installed.npcs : installed.dungeons).includes(id);
}

// Add only ids the table does not already carry, and remember exactly those,
// so removal can never take out a built-in record that shares an id.
function addMissing<T>(table: Record<string, T>, records: Record<string, T>): string[] {
  const added: string[] = [];
  for (const [id, record] of Object.entries(records)) {
    if (id in table) continue;
    table[id] = record;
    added.push(id);
  }
  return added;
}

function removeIds<T>(table: Record<string, T>, ids: readonly string[]): void {
  for (const id of ids) delete table[id];
}

/** Merge (on) or strip (off) the Studio records. Idempotent both ways. */
export function setStudioOverlay(tables: StudioOverlayTables, on: boolean): void {
  if (on === (installed !== null)) return;
  if (on) {
    const next: Installed = {
      items: addMissing(tables.items, STUDIO_CONTENT.items),
      mobs: addMissing(tables.mobs, STUDIO_CONTENT.mobs),
      npcs: addMissing(tables.npcs, STUDIO_CONTENT.npcs),
      quests: addMissing(tables.quests, STUDIO_CONTENT.quests),
      questOrder: [],
      dungeons: addMissing(tables.dungeons, STUDIO_CONTENT.dungeons),
      npcQuestIds: new Map(),
    };
    for (const id of STUDIO_CONTENT.questOrder) {
      if (tables.questOrder.includes(id)) continue;
      tables.questOrder.push(id);
      next.questOrder.push(id);
    }
    for (const id of next.dungeons) {
      const def = tables.dungeons[id];
      tables.dungeonList.push(def);
      tables.dungeonByIndex[def.index] = def;
    }
    tables.dungeonList.sort((a, b) => a.index - b.index);
    for (const [npcId, questIds] of Object.entries(STUDIO_CONTENT.npcQuestIds)) {
      const def = tables.npcs[npcId];
      if (!def) continue;
      next.npcQuestIds.set(npcId, def.questIds);
      def.questIds = [...def.questIds, ...questIds.filter((q) => !def.questIds.includes(q))];
    }
    installed = next;
    return;
  }
  const prev = installed as Installed;
  installed = null;
  for (const [npcId, questIds] of prev.npcQuestIds) {
    const def = tables.npcs[npcId];
    if (def) def.questIds = questIds;
  }
  for (const id of prev.dungeons) {
    const def = tables.dungeons[id];
    const at = tables.dungeonList.indexOf(def);
    if (at >= 0) tables.dungeonList.splice(at, 1);
    if (tables.dungeonByIndex[def.index] === def) tables.dungeonByIndex[def.index] = undefined;
  }
  removeIds(tables.dungeons, prev.dungeons);
  for (const id of prev.questOrder) {
    const at = tables.questOrder.indexOf(id);
    if (at >= 0) tables.questOrder.splice(at, 1);
  }
  removeIds(tables.items, prev.items);
  removeIds(tables.mobs, prev.mobs);
  removeIds(tables.npcs, prev.npcs);
  removeIds(tables.quests, prev.quests);
}
