// Pure world-quest reroll leaf: deterministic selection, validation, and
// assignment replacement. Zero RNG, no wall clock, no DOM/Three.js imports.

import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { WorldQuestDef } from './types';
import {
  ALWAYS_ACTIVE_WORLD_QUEST_IDS,
  activeWorldQuestsForCycle,
  WORLD_QUESTS_BY_ZONE,
  worldQuestCycleNumber,
} from './world_quest_rotation';

export interface CanRerollResult {
  readonly canReroll: boolean;
  readonly reason?: string;
  readonly replacementId?: string;
}

/** Determine all active world quests for a player, applying any personal cycle replacements. */
export function playerActiveWorldQuests(
  meta: Pick<PlayerMeta, 'worldQuestCycle' | 'worldQuestReplacements'>,
  cycle?: string,
  baseQuests?: readonly WorldQuestDef[],
): readonly WorldQuestDef[] {
  const c = cycle ?? meta.worldQuestCycle;
  const base = baseQuests ?? activeWorldQuestsForCycle(c);
  const replacements = meta.worldQuestReplacements;
  if (!replacements || Object.keys(replacements).length === 0) {
    return base;
  }
  return Object.freeze(
    base.map((quest) => {
      const replacementId = replacements[quest.id];
      if (replacementId && Object.hasOwn(WORLD_QUESTS_BY_ID, replacementId)) {
        return WORLD_QUESTS_BY_ID[replacementId];
      }
      return quest;
    }),
  );
}

/** Check whether a player may reroll a specific World Quest today. */
export function canRerollWorldQuest(
  meta: PlayerMeta,
  questId: string,
  cycle: string,
  playerLevel: number,
): CanRerollResult {
  if (!cycle) {
    return { canReroll: false, reason: 'No active world quest cycle.' };
  }
  if (meta.worldQuestRerollCycle === cycle) {
    return { canReroll: false, reason: 'Daily world quest reroll already used today.' };
  }
  const progress = meta.worldQuestLog.get(questId);
  if (progress?.state === 'completed') {
    return { canReroll: false, reason: 'Completed world quests cannot be rerolled.' };
  }
  if (progress && progress.count > 0) {
    return { canReroll: false, reason: 'In-progress world quests cannot be rerolled.' };
  }

  const activeQuests = playerActiveWorldQuests(meta, cycle);
  const quest = activeQuests.find((q) => q.id === questId);
  if (!quest) {
    return { canReroll: false, reason: 'This world quest is not currently active for you.' };
  }

  // Find candidate replacements in the same zone
  const zoneQuests = WORLD_QUESTS_BY_ZONE[quest.zoneId] ?? [];
  const activeIds = new Set(activeQuests.map((q) => q.id));
  const candidates = zoneQuests.filter((id) => {
    if (id === quest.id) return false;
    if (ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(id)) return false;
    if (activeIds.has(id)) return false;
    const existing = meta.worldQuestLog.get(id);
    if (existing?.state === 'completed') return false;
    const def = WORLD_QUESTS_BY_ID[id];
    if (!def) return false;
    if (playerLevel < def.minLevel) return false;
    return true;
  });

  if (candidates.length === 0) {
    return {
      canReroll: false,
      reason: 'No alternative assignments available in this zone today.',
    };
  }

  // Deterministic selection based on cycle number, player entity id, and quest id
  const cycleNum = worldQuestCycleNumber(cycle) ?? 0;
  const seedVal = Math.abs(cycleNum * 31 + meta.entityId * 17 + quest.id.length);
  const selectedIndex = seedVal % candidates.length;
  return { canReroll: true, replacementId: candidates[selectedIndex] };
}

/** Sanitize persisted replacement mappings. */
export function sanitizeWorldQuestReplacements(
  raw: unknown,
  cycle: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || !cycle) return result;
  const activeIds = new Set(activeWorldQuestsForCycle(cycle).map((q) => q.id));
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof k === 'string' &&
      typeof v === 'string' &&
      activeIds.has(k) &&
      Object.hasOwn(WORLD_QUESTS_BY_ID, v)
    ) {
      result[k] = v;
    }
  }
  return result;
}

/** Apply a validated world quest reroll for a player. */
export function applyWorldQuestReroll(
  meta: PlayerMeta,
  oldQuestId: string,
  newQuest: WorldQuestDef,
  cycle: string,
): void {
  meta.worldQuestRerollCycle = cycle;
  if (!meta.worldQuestReplacements) {
    meta.worldQuestReplacements = {};
  }
  meta.worldQuestReplacements[oldQuestId] = newQuest.id;
  meta.worldQuestLog.delete(oldQuestId);
  meta.worldQuestAreas.delete(oldQuestId);
  meta.wireRev++;
}

/** Execute a world quest reroll in the live simulation. */
export function rerollWorldQuest(ctx: SimContext, meta: PlayerMeta, questId: string): boolean {
  const player = ctx.entities.get(meta.entityId);
  if (!player || player.dead) {
    ctx.error(meta.entityId, "You can't do that right now.");
    return false;
  }
  const cycle = meta.devWorldQuestCycle ?? ctx.currentWorldQuestRotation().cycle;
  const check = canRerollWorldQuest(meta, questId, cycle, player.level);
  if (!check.canReroll || !check.replacementId) {
    ctx.error(meta.entityId, check.reason ?? 'Cannot reroll this world quest.');
    return false;
  }

  const replacement = WORLD_QUESTS_BY_ID[check.replacementId];
  if (!replacement) {
    ctx.error(meta.entityId, 'Replacement quest not found.');
    return false;
  }

  applyWorldQuestReroll(meta, questId, replacement, cycle);
  return true;
}
