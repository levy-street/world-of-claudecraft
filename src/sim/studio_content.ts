// Studio fork content that belongs to AUTHORED maps, never to the built-in world.
//
// The Studio merge brought the fork's own game content along with the map
// editor: the Scorching Wastes roster, Goldcrest Harbor's Deepglass steward,
// the map-objectives rehearsal champion and the Deepglass venue's roster (the
// marshal, the crowd, Tidehold's residents, Baldemar's selves, the Tidesow).
// Registered in the built-in lookup tables, every one of those changes the
// default world: the quest and item rows grow every saved character, and every
// NPC row is ringed by a terrain calm pad. So the built-in tables stay exactly the release's,
// and this overlay is merged into them only while an authored map is the
// active content (data.ts setActiveWorldContent), then removed again when the
// built-in world comes back.
//
// Pure leaf over plain records: no rng, no SimContext. data.ts owns the tables
// and hands them in, so this module never imports data.ts (no value cycle).

import { DEEPGLASS_EVENT_NPCS } from './content/deepglass_event';
import { GOLDCREST_NPCS, GOLDCREST_ZONE } from './content/goldcrest';
import { OBJECTIVE_BOT_MOB, OBJECTIVE_BOT_TEMPLATE_ID } from './content/objective_bots';
import {
  SCORCHING_ITEMS,
  SCORCHING_MOBS,
  SCORCHING_NPCS,
  SCORCHING_QUEST_ORDER,
  SCORCHING_QUESTS,
} from './content/scorching_wastes';
import {
  DEEPBALL_ABILITIES,
  DEEPGLASS_BALL_MOB,
  DEEPGLASS_BALL_TEMPLATE_ID,
} from './deepglass/abilities';
import { TIDEHOLD_NPCS } from './deepglass/citadel';
import { DEEPGLASS_MARSHAL } from './deepglass/world';
import { PORTAL_WIZARD_NPCS } from './portal_wizard';
import type {
  AbilityDef,
  DungeonDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  QuestDef,
  ZoneDef,
} from './types';

/** The Studio records an authored map may resolve by id. */
export const STUDIO_CONTENT = {
  // The deepball kit (the Deepglass sport, class-agnostic; no class lists it).
  // Registered with the venue so the built-in ability inventory stays the
  // release's.
  abilities: { ...DEEPBALL_ABILITIES } as Record<string, AbilityDef>,
  items: { ...SCORCHING_ITEMS } as Record<string, ItemDef>,
  mobs: {
    ...SCORCHING_MOBS,
    [OBJECTIVE_BOT_TEMPLATE_ID]: OBJECTIVE_BOT_MOB,
    // The Deepglass Tidesow: an inert ball entity the match driver spawns.
    [DEEPGLASS_BALL_TEMPLATE_ID]: DEEPGLASS_BALL_MOB,
  } as Record<string, MobTemplate>,
  // All dynamic: the authored map that wants them places them itself, and
  // every reader that resolves an NPC by templateId (nameplates, gossip flags,
  // vendor stock) finds the row here. The Deepglass roster rides this overlay
  // too: the built-in NPC table is read by more than lookups (the terrain calm
  // pads ring every row in it, terrain_calm_anchors.ts), so a dynamic row
  // there still reshapes the default world's ground.
  npcs: {
    ...SCORCHING_NPCS,
    ...GOLDCREST_NPCS,
    [DEEPGLASS_MARSHAL.id]: DEEPGLASS_MARSHAL,
    ...PORTAL_WIZARD_NPCS,
    ...DEEPGLASS_EVENT_NPCS,
    ...TIDEHOLD_NPCS,
  } as Record<string, NpcDef>,
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
  abilities: Record<string, AbilityDef>;
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
  abilities: string[];
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
      abilities: addMissing(tables.abilities, STUDIO_CONTENT.abilities),
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
  removeIds(tables.abilities, prev.abilities);
  removeIds(tables.items, prev.items);
  removeIds(tables.mobs, prev.mobs);
  removeIds(tables.npcs, prev.npcs);
  removeIds(tables.quests, prev.quests);
}
