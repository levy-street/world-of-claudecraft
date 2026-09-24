// A zone's TOWN QUESTS and the entry hint that reads off them.
//
// UI-ONLY sim leaf: consumed by src/ui/zone_entry_line_core.ts and its tests;
// no src/sim file may import it, so it never joins the tick (the
// material_taxonomy.ts precedent, pinned by the GUARDED_MODULES walk in
// tests/material_taxonomy.test.ts). Pure: no Sim, no SimContext; the quest
// state comes in as a callback so the offline Sim and the online mirror
// resolve it the same way.
//
// The town quests of a zone are the town's OWN ERRANDS: the non-repeatable
// quests the town hands out or receives (the giver or a turn-in NPC stands
// inside the zone's hub circle, professions/focus.ts isInTownZone) that are
// also finished inside the zone (a turn-in NPC stands in it). Turn-ins count
// because most zones open with a border scout's breadcrumb that reports TO
// the town warden; a town whose warden is still owed that report is not
// finished. A hand-off to the next town (given here, turned in there, e.g.
// Fenbridge's Highwatch summons) belongs to the town that receives it.
// Excluded whole:
// - the profession trainers' quests (content/profession_trainers.ts): the
//   public service roles hand out work orders and craft onboarding, not the
//   town's story;
// - group quests (suggestedPlayers) and instance quests (a kill objective on
//   a mob that spawns in a dungeon or raid): every group-quest giver in
//   Highwatch stands inside the hub, so without this the town-done line would
//   only ever show to someone who has cleared the Nythraxis raid.
// A quest the character can never take (retired, or class-locked to another
// class) is skipped rather than counted as unfinished, so a warrior can still
// finish Fenbridge although the paladin-only rite lives there; a quest that
// is merely gated for now (level, an earlier quest) still counts, because it
// is coming.
//
// zoneEntryHint is the one decision the HUD's zone-entry chat line reads: the
// zone's welcome hint while its welcome quest is still on offer (the legacy
// data.ts zoneWelcomeText rule, unchanged), the zone's own "town done" line
// (ZoneDef.welcomeDone, authored only for the zones whose welcome names the
// town's questgiver) once every counted town quest is turned in, nothing in
// between. A zone without welcomeDone never reads town_done.
import { PROFESSION_TRAINERS } from './content/profession_trainers';
import { DUNGEONS, NPCS, QUESTS, zoneAt, zoneWelcomeText } from './data';
import { isInTownZone } from './professions/focus';
import type { DungeonDef, NpcDef, PlayerClass, QuestDef, QuestState, ZoneDef } from './types';

export type ZoneEntryHint = 'welcome' | 'town_done';

/** The content tables the town-quest rule reads; every one defaults to the
 *  shipped table so callers (and tests) can substitute any of them. */
export interface TownQuestTables {
  readonly npcs: Readonly<Record<string, NpcDef>>;
  readonly quests: Readonly<Record<string, QuestDef>>;
  readonly dungeons: Readonly<Record<string, DungeonDef>>;
  /** Trainer NPC id -> profession (the PROFESSION_TRAINERS shape). */
  readonly trainers: Readonly<Record<string, string>>;
}

const SHIPPED_TABLES: TownQuestTables = {
  npcs: NPCS,
  quests: QUESTS,
  dungeons: DUNGEONS,
  trainers: PROFESSION_TRAINERS,
};

export function isProfessionTrainerNpc(
  npcId: string,
  trainers: Readonly<Record<string, string>> = PROFESSION_TRAINERS,
): boolean {
  return Object.hasOwn(trainers, npcId);
}

/** The NPCs a quest is anchored to: its giver and every turn-in. */
export function questAnchorNpcIds(quest: QuestDef): string[] {
  return [quest.giverNpcId, ...questTurnInNpcIds(quest)];
}

function questTurnInNpcIds(quest: QuestDef): string[] {
  return [quest.turnInNpcId, ...(quest.turnInNpcIds ?? [])];
}

function npcInTown(npc: NpcDef | undefined, zone: ZoneDef): boolean {
  return npc !== undefined && isInTownZone(npc.pos, zone);
}

function npcInZone(npc: NpcDef | undefined, zone: ZoneDef): boolean {
  return npc !== undefined && zoneAt(npc.pos.x, npc.pos.z).id === zone.id;
}

/** Mob ids that spawn inside any dungeon or raid: a kill objective on one of
 *  them makes the quest an instance quest. */
export function instanceMobIds(
  dungeons: Readonly<Record<string, DungeonDef>>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const dungeon of Object.values(dungeons)) {
    for (const spawn of dungeon.spawns) ids.add(spawn.mobId);
  }
  return ids;
}

/** A group or instance quest: not an errand the town can finish on its own. */
export function isGroupOrInstanceQuest(
  quest: QuestDef,
  instanceMobs: ReadonlySet<string>,
): boolean {
  if (quest.suggestedPlayers !== undefined) return true;
  return quest.objectives.some((o) => o.type === 'kill' && instanceMobs.has(o.targetMobId));
}

/** Ids of the zone's town quests, in QUESTS table order. */
export function townQuestIds(zone: ZoneDef, tables: Partial<TownQuestTables> = {}): string[] {
  const { npcs, quests, dungeons, trainers } = { ...SHIPPED_TABLES, ...tables };
  const instanceMobs = instanceMobIds(dungeons);
  const ids: string[] = [];
  for (const quest of Object.values(quests)) {
    if (quest.repeatable) continue;
    if (isProfessionTrainerNpc(quest.giverNpcId, trainers)) continue;
    if (isGroupOrInstanceQuest(quest, instanceMobs)) continue;
    if (!questAnchorNpcIds(quest).some((npcId) => npcInTown(npcs[npcId], zone))) continue;
    if (!questTurnInNpcIds(quest).some((npcId) => npcInZone(npcs[npcId], zone))) continue;
    ids.push(quest.id);
  }
  return ids;
}

/** Whether this character can ever take the quest at all (retired and
 *  other-class quests cannot be, so they never hold a town open). */
function questReachableFor(quest: QuestDef, playerClass: PlayerClass | undefined): boolean {
  if (quest.retired) return false;
  if (quest.requiredClass && (!playerClass || !quest.requiredClass.includes(playerClass))) {
    return false;
  }
  return true;
}

/** True once every reachable town quest of the zone is turned in. A zone with
 *  no reachable town quests is never "complete": there was nothing to finish. */
export function townQuestsComplete(
  zone: ZoneDef,
  questState: (questId: string) => QuestState,
  playerClass: PlayerClass | undefined,
  tables: Partial<TownQuestTables> = {},
): boolean {
  const quests = tables.quests ?? QUESTS;
  let counted = 0;
  for (const id of townQuestIds(zone, tables)) {
    const quest = quests[id];
    if (!quest || !questReachableFor(quest, playerClass)) continue;
    counted++;
    if (questState(id) !== 'done') return false;
  }
  return counted > 0;
}

export function zoneEntryHint(
  zone: ZoneDef,
  questState: (questId: string) => QuestState,
  playerClass: PlayerClass | undefined,
): ZoneEntryHint | null {
  if (zone.welcomeDone !== undefined && townQuestsComplete(zone, questState, playerClass)) {
    return 'town_done';
  }
  return zoneWelcomeText(zone, questState) === null ? null : 'welcome';
}
