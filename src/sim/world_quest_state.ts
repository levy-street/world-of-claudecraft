// World-quest runtime/persistence adapters for the Sim coordinator. State stays
// on each Sim/PlayerMeta instance; only shape construction and normalization live
// here, behind explicit arguments.

import type { CharacterState } from './character_state';
import { type ClueHuntProgress, sanitizeClueCasketsOpened, sanitizeClueHunt } from './clue_scrolls';
import type { FactionId } from './factions';
import { freshFactionReputation, sanitizeFactionReputation } from './factions';
import type { PlayerMeta } from './sim';
import type { Entity, WeeklyQuestProgress, WorldQuestDef, WorldQuestProgress } from './types';
import { sanitizeWeeklyQuestProgress, savedWeeklyQuestProgress } from './weekly_quests';
import { WORLD_BOSSES } from './world_boss';
import { sanitizeWorldQuestReplacements } from './world_quest_reroll';
import {
  activeWorldQuestsForCycle,
  restoreWorldQuestClaims,
  sanitizeWorldQuestCycle,
  sanitizeWorldQuestProgress,
  worldQuestCycleForResetDay,
} from './world_quests';

export { nearbyWorldQuestTraces } from './world_quest_trace_public';

export interface WorldQuestPlayerState {
  worldQuestCycle: string;
  worldQuestLog: Map<string, WorldQuestProgress>;
  /** Session-only cycle override used by focused dev commands; never persisted. */
  devWorldQuestCycle?: string | null;
  /** Puzzle-area entry edges for this session. Never persisted or wired. */
  worldQuestAreas: Set<string>;
  /** Minigame unlocked by the area's physical activator for this session. */
  openWorldQuestPuzzleId: string | null;
  /** Persistent faction standing earned across world quests. */
  factions: Record<FactionId, number>;
  /** The cycle for which the character used their single daily reroll. */
  worldQuestRerollCycle: string;
  /** Personal quest replacement: oldQuestId -> newQuestId for the current cycle. */
  worldQuestReplacements: Record<string, string>;
  /** The weekly emissary's pick (src/sim/weekly_quests.ts); null while none is taken. */
  weeklyQuest: WeeklyQuestProgress | null;
  /**
   * Clue Scrolls (src/sim/clue_scrolls.ts). The active hunt cursor (null when
   * none); the world-quest cycle that already paid a scroll ('' when none);
   * the lifetime Treasure Caskets opened (the clueCasketsOpened deed meter).
   * None of the three is touched by a cycle rollover: a hunt survives the
   * daily reset by design, and the paid-cycle mark is what makes the next
   * day's slate a fresh entitlement.
   */
  clueHunt: ClueHuntProgress | null;
  clueScrollCycle: string;
  clueCasketsOpened: number;
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
    factions: freshFactionReputation(),
    worldQuestRerollCycle: '',
    worldQuestReplacements: {},
    weeklyQuest: null,
    clueHunt: null,
    clueScrollCycle: '',
    clueCasketsOpened: 0,
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

export function rotationBindings(cache: WorldQuestRotationCache, host: { resetDay: string }) {
  return { currentWorldQuestRotation: () => currentWorldQuestRotation(cache, host.resetDay) };
}

export function restoreWorldQuestState(
  meta: PlayerMeta,
  saved: CharacterState['worldQuests'],
  characterFactions?: CharacterState['factions'],
  savedWeekly?: CharacterState['weeklyQuest'],
): void {
  meta.factions = freshFactionReputation();
  const rawFactions = characterFactions ?? saved?.factions;
  if (rawFactions) {
    meta.factions = sanitizeFactionReputation(rawFactions);
  }
  meta.worldQuestRerollCycle = '';
  meta.worldQuestReplacements = {};
  meta.weeklyQuest = sanitizeWeeklyQuestProgress(savedWeekly);
  // Clue Scrolls: cycle-independent, restored whatever the board holds. A hunt whose id
  // is no longer in the pool restores to null (a retired hunt returns nothing,
  // by design; sanitizeClueHunt says the same); the step is clamped to the
  // hunt's length. The paid-cycle mark is kept whatever cycle it names: a
  // stale one simply never matches the current cycle again.
  meta.clueHunt = sanitizeClueHunt(saved?.clueHunt);
  meta.clueScrollCycle = sanitizeWorldQuestCycle(saved?.clueScrollCycle);
  meta.clueCasketsOpened = sanitizeClueCasketsOpened(saved?.clueCasketsOpened);
  if (saved) {
    meta.worldQuestCycle = sanitizeWorldQuestCycle(saved.cycle);
    if (typeof saved.rerollCycle === 'string' && saved.rerollCycle === meta.worldQuestCycle) {
      meta.worldQuestRerollCycle = saved.rerollCycle;
      meta.worldQuestReplacements = sanitizeWorldQuestReplacements(
        saved.replacements,
        meta.worldQuestCycle,
      );
    }
    for (const progress of sanitizeWorldQuestProgress(
      saved.progress,
      meta.worldQuestCycle,
      false,
      meta.worldQuestReplacements,
    )) {
      meta.worldQuestLog.set(progress.questId, progress);
    }
  }
  restoreWorldQuestClaims(meta);
}

export function savedWorldQuestState(meta: PlayerMeta): {
  worldQuests?: CharacterState['worldQuests'];
  factions?: CharacterState['factions'];
  weeklyQuest?: CharacterState['weeklyQuest'];
} {
  const weekly = savedWeeklyQuestProgress(meta);
  const weeklyPart = weekly ? { weeklyQuest: weekly } : {};
  const hasRep = meta.factions && Object.values(meta.factions).some((v) => v > 0);
  const hasReroll =
    meta.worldQuestRerollCycle && meta.worldQuestRerollCycle === meta.worldQuestCycle;
  const hasReplacements =
    hasReroll && meta.worldQuestReplacements && Object.keys(meta.worldQuestReplacements).length > 0;
  const hasClueHunt = meta.clueHunt !== null && meta.clueHunt !== undefined;
  const hasClueCycle = typeof meta.clueScrollCycle === 'string' && meta.clueScrollCycle !== '';
  const hasCaskets = (meta.clueCasketsOpened ?? 0) > 0;
  if (
    !meta.worldQuestCycle &&
    meta.worldQuestLog.size === 0 &&
    !hasRep &&
    !hasReroll &&
    !hasClueHunt &&
    !hasClueCycle &&
    !hasCaskets
  ) {
    return weeklyPart;
  }
  const factionsObj = hasRep ? { ...meta.factions } : undefined;
  return {
    ...weeklyPart,
    worldQuests: {
      cycle: meta.worldQuestCycle,
      progress: [...meta.worldQuestLog.values()].map(
        ({
          tracing: _tracing,
          forging: _forging,
          wispMaze: _wispMaze,
          investigation: _investigation,
          shadow: _shadow,
          glider: _glider,
          puzzleExpiresAt: _puzzleExpiresAt,
          ...progress
        }) => ({
          ...progress,
          ...(progress.gliderResult === undefined
            ? {}
            : { gliderResult: { ...progress.gliderResult } }),
          ...(progress.forgeResult === undefined
            ? {}
            : { forgeResult: { ...progress.forgeResult } }),
          ...(progress.creditedObjects === undefined
            ? {}
            : { creditedObjects: [...progress.creditedObjects] }),
          ...(progress.puzzleRotations === undefined
            ? {}
            : { puzzleRotations: [...progress.puzzleRotations] }),
          ...(progress.match3Board === undefined ? {} : { match3Board: [...progress.match3Board] }),
          ...(progress.traceScores === undefined
            ? {}
            : { traceScores: progress.traceScores.map((score) => ({ ...score })) }),
          ...(progress.traceResult === undefined
            ? {}
            : { traceResult: { ...progress.traceResult } }),
        }),
      ),
      ...(factionsObj ? { factions: factionsObj } : {}),
      ...(hasReroll ? { rerollCycle: meta.worldQuestRerollCycle } : {}),
      ...(hasReplacements ? { replacements: { ...meta.worldQuestReplacements } } : {}),
      ...(hasClueHunt && meta.clueHunt ? { clueHunt: { ...meta.clueHunt } } : {}),
      ...(hasClueCycle ? { clueScrollCycle: meta.clueScrollCycle } : {}),
      ...(hasCaskets ? { clueCasketsOpened: meta.clueCasketsOpened } : {}),
    },
    ...(factionsObj ? { factions: factionsObj } : {}),
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
