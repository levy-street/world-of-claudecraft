// World-quest runtime/persistence adapters for the Sim coordinator. State stays
// on each Sim/PlayerMeta instance; only shape construction and normalization live
// here, behind explicit arguments.

import type { CharacterState } from './character_state';
import type { PlayerMeta } from './sim';
import type { Entity, WorldQuestDef, WorldQuestProgress } from './types';
import { WORLD_BOSSES } from './world_boss';
import {
  activeWorldQuestsForCycle,
  restoreWorldQuestClaims,
  sanitizeWorldQuestCycle,
  sanitizeWorldQuestProgress,
  worldQuestCycleForResetDay,
} from './world_quests';

export interface WorldQuestPlayerState {
  worldQuestCycle: string;
  worldQuestLog: Map<string, WorldQuestProgress>;
  /** Session-only cycle override used by focused dev commands; never persisted. */
  devWorldQuestCycle?: string | null;
  /** Puzzle-area entry edges for this session. Never persisted or wired. */
  worldQuestAreas: Set<string>;
  /** Minigame unlocked by the area's physical activator for this session. */
  openWorldQuestPuzzleId: string | null;
}

export interface WorldQuestRotationCache {
  resetDay: string;
  rotation: Readonly<{ cycle: string; quests: readonly WorldQuestDef[] }>;
}

export function freshWorldQuestPlayerState(): WorldQuestPlayerState {
  return {
    worldQuestCycle: '',
    worldQuestLog: new Map(),
    devWorldQuestCycle: null,
    worldQuestAreas: new Set(),
    openWorldQuestPuzzleId: null,
  };
}

export function freshWorldQuestRotationCache(): WorldQuestRotationCache {
  return { resetDay: '', rotation: { cycle: '', quests: [] } };
}

export function currentWorldQuestRotation(
  cache: WorldQuestRotationCache,
  resetDay: string,
): WorldQuestRotationCache['rotation'] {
  if (cache.resetDay !== resetDay) {
    cache.resetDay = resetDay;
    const cycle = worldQuestCycleForResetDay(resetDay);
    cache.rotation = { cycle, quests: activeWorldQuestsForCycle(cycle) };
  }
  return cache.rotation;
}

export function restoreWorldQuestState(
  meta: PlayerMeta,
  saved: CharacterState['worldQuests'],
): void {
  if (saved) {
    meta.worldQuestCycle = sanitizeWorldQuestCycle(saved.cycle);
    for (const progress of sanitizeWorldQuestProgress(saved.progress, meta.worldQuestCycle)) {
      meta.worldQuestLog.set(progress.questId, progress);
    }
  }
  restoreWorldQuestClaims(meta);
}

export function savedWorldQuestState(
  meta: PlayerMeta,
): Pick<CharacterState, 'worldQuests'> | Record<never, never> {
  if (!meta.worldQuestCycle && meta.worldQuestLog.size === 0) return {};
  return {
    worldQuests: {
      cycle: meta.worldQuestCycle,
      progress: [...meta.worldQuestLog.values()].map((progress) => ({
        ...progress,
        ...(progress.creditedObjects === undefined
          ? {}
          : { creditedObjects: [...progress.creditedObjects] }),
        ...(progress.puzzleRotations === undefined
          ? {}
          : { puzzleRotations: [...progress.puzzleRotations] }),
        ...(progress.match3Board === undefined ? {} : { match3Board: [...progress.match3Board] }),
      })),
    },
  };
}

export function worldBossActive(
  entities: ReadonlyMap<number, Entity>,
  entityIds: readonly (number | null)[],
  bossId: string,
): boolean {
  const index = WORLD_BOSSES.findIndex((boss) => boss.templateId === bossId);
  if (index < 0) return false;
  const entityId = entityIds[index];
  if (entityId === null) return false;
  const entity = entities.get(entityId);
  return entity !== undefined && !entity.dead;
}
