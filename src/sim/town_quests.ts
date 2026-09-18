// A zone's TOWN QUESTS and the entry hint that reads off them.
//
// The town quests of a zone are the non-repeatable quests the town hands out
// OR receives: the giver or a turn-in NPC stands inside the zone's hub circle
// (professions/focus.ts isInTownZone). Turn-ins count because most zones open
// with a border scout's breadcrumb that reports TO the town warden; a town
// whose warden is still owed that report is not finished. Excluded whole are
// the profession trainers' quests (content/profession_trainers.ts): the public
// service roles hand out work orders and craft onboarding, not the town's
// story, so they never hold the town's "all done" state open. A quest the
// character can never take (retired, or class-locked to another class) is
// skipped rather than counted as unfinished, so a warrior can still finish
// Fenbridge although the paladin-only rite lives there; a quest that is merely
// gated for now (level, an earlier quest) still counts, because it is coming.
//
// zoneEntryHint is the one decision the HUD's zone-entry chat line reads: the
// zone's welcome hint while its welcome quest is still on offer (the legacy
// data.ts zoneWelcomeText rule, unchanged), the zone's own "town done" line
// (ZoneDef.welcomeDone, authored only for the zones whose welcome names the
// town's questgiver) once every counted town quest is turned in, nothing in
// between. A zone without welcomeDone never reads town_done. Pure leaf: no Sim,
// no SimContext; the quest state comes in as a callback so the offline Sim and
// the online mirror resolve it the same way.
import { PROFESSION_TRAINERS } from './content/profession_trainers';
import { NPCS, QUESTS, zoneWelcomeText } from './data';
import { isInTownZone } from './professions/focus';
import type { NpcDef, PlayerClass, QuestDef, QuestState, ZoneDef } from './types';

export type ZoneEntryHint = 'welcome' | 'town_done';

const TRAINER_IDS: ReadonlySet<string> = new Set(Object.keys(PROFESSION_TRAINERS));

export function isProfessionTrainerNpc(npcId: string): boolean {
  return TRAINER_IDS.has(npcId);
}

/** The NPCs a quest is anchored to: its giver and every turn-in. */
export function questAnchorNpcIds(quest: QuestDef): string[] {
  return [quest.giverNpcId, quest.turnInNpcId, ...(quest.turnInNpcIds ?? [])];
}

function npcInTown(npc: NpcDef | undefined, zone: ZoneDef): boolean {
  return npc !== undefined && isInTownZone(npc.pos, zone);
}

/** Ids of the zone's town quests, in QUESTS table order. */
export function townQuestIds(
  zone: ZoneDef,
  npcs: Readonly<Record<string, NpcDef>> = NPCS,
  quests: Readonly<Record<string, QuestDef>> = QUESTS,
): string[] {
  const ids: string[] = [];
  for (const quest of Object.values(quests)) {
    if (quest.repeatable) continue;
    if (isProfessionTrainerNpc(quest.giverNpcId)) continue;
    if (questAnchorNpcIds(quest).some((npcId) => npcInTown(npcs[npcId], zone))) ids.push(quest.id);
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
  npcs: Readonly<Record<string, NpcDef>> = NPCS,
  quests: Readonly<Record<string, QuestDef>> = QUESTS,
): boolean {
  let counted = 0;
  for (const id of townQuestIds(zone, npcs, quests)) {
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
