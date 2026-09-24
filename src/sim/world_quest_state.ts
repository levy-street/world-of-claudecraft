// World-quest runtime/persistence adapters for the Sim coordinator. State stays
// on each Sim/PlayerMeta instance; only shape construction and normalization live
// here, behind explicit arguments.

import type { CharacterState } from './character_state';
import { type ClueHuntProgress, sanitizeClueCasketsOpened, sanitizeClueHunt } from './clue_scrolls';
import type { TreasureMapProgress } from './content/treasure_maps';
import type { FactionId } from './factions';
import {
  freshFactionCurrencies,
  freshFactionReputation,
  sanitizeFactionCurrencies,
  sanitizeFactionReputation,
} from './factions';
import type { PlayerMeta } from './sim';
import {
  sanitizeTreasureMap,
  sanitizeVaultAttempt,
  sanitizeVaultGuestPayouts,
  type VaultAttempt,
} from './treasure_vault';
import type { Entity, WorldQuestDef, WorldQuestProgress } from './types';
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
  /** Persistent spendable faction currencies earned from world quests. */
  factionCurrencies: Record<FactionId, number>;
  /** The cycle for which the character used their single daily reroll. */
  worldQuestRerollCycle: string;
  /** Personal quest replacement: oldQuestId -> newQuestId for the current cycle. */
  worldQuestReplacements: Record<string, string>;
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
  /**
   * Treasure maps (src/sim/treasure_vault.ts): the map read and not yet dug up
   * (null when none), and the guest vault payouts taken in `vaultGuestCycle`
   * (the owner's own vaults never count). Cycle-independent like the hunt.
   */
  treasureMap: TreasureMapProgress | null;
  vaultAttempt: VaultAttempt | null;
  vaultAttemptSeq: number;
  /** This process has persisted the dug map; not serialized. */
  vaultAttemptDurable: boolean;
  vaultGuestCycle: string;
  vaultGuestPayouts: number;
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
    factionCurrencies: freshFactionCurrencies(),
    worldQuestRerollCycle: '',
    worldQuestReplacements: {},
    clueHunt: null,
    clueScrollCycle: '',
    clueCasketsOpened: 0,
    treasureMap: null,
    vaultAttempt: null,
    vaultAttemptSeq: 0,
    vaultAttemptDurable: true,
    vaultGuestCycle: '',
    vaultGuestPayouts: 0,
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
  characterFactionCurrencies?: CharacterState['factionCurrencies'],
): void {
  meta.factions = freshFactionReputation();
  const rawFactions = characterFactions ?? saved?.factions;
  if (rawFactions) {
    meta.factions = sanitizeFactionReputation(rawFactions);
  }
  meta.factionCurrencies = freshFactionCurrencies();
  const rawCurrencies = characterFactionCurrencies ?? saved?.factionCurrencies;
  if (rawCurrencies) {
    meta.factionCurrencies = sanitizeFactionCurrencies(rawCurrencies);
  }
  meta.worldQuestRerollCycle = '';
  meta.worldQuestReplacements = {};
  // Clue Scrolls: cycle-independent, restored whatever the board holds. A hunt whose id
  // is no longer in the pool restores to null (a retired hunt returns nothing,
  // by design; sanitizeClueHunt says the same); the step is clamped to the
  // hunt's length. The paid-cycle mark is kept whatever cycle it names: a
  // stale one simply never matches the current cycle again.
  meta.clueHunt = sanitizeClueHunt(saved?.clueHunt);
  meta.clueScrollCycle = sanitizeWorldQuestCycle(saved?.clueScrollCycle);
  meta.clueCasketsOpened = sanitizeClueCasketsOpened(saved?.clueCasketsOpened);
  meta.treasureMap = sanitizeTreasureMap(saved?.treasureMap);
  meta.vaultAttempt = sanitizeVaultAttempt(saved?.vaultAttempt, meta.characterId);
  meta.vaultAttemptSeq = Math.max(
    meta.vaultAttempt ? Number(meta.vaultAttempt.id.split(':')[1]) : 0,
    typeof saved?.vaultAttemptSeq === 'number' && Number.isSafeInteger(saved.vaultAttemptSeq)
      ? Math.max(0, saved.vaultAttemptSeq)
      : 0,
  );
  meta.vaultAttemptDurable = true;
  meta.vaultGuestCycle = sanitizeWorldQuestCycle(saved?.vaultGuestCycle);
  meta.vaultGuestPayouts = sanitizeVaultGuestPayouts(saved?.vaultGuestPayouts);
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
  factionCurrencies?: CharacterState['factionCurrencies'];
} {
  const hasRep = meta.factions && Object.values(meta.factions).some((v) => v > 0);
  const hasCurrencies =
    meta.factionCurrencies && Object.values(meta.factionCurrencies).some((v) => v > 0);
  const hasReroll =
    meta.worldQuestRerollCycle && meta.worldQuestRerollCycle === meta.worldQuestCycle;
  const hasReplacements =
    hasReroll && meta.worldQuestReplacements && Object.keys(meta.worldQuestReplacements).length > 0;
  const hasClueHunt = meta.clueHunt !== null && meta.clueHunt !== undefined;
  const hasClueCycle = typeof meta.clueScrollCycle === 'string' && meta.clueScrollCycle !== '';
  const hasCaskets = (meta.clueCasketsOpened ?? 0) > 0;
  const hasTreasureMap = meta.treasureMap !== null && meta.treasureMap !== undefined;
  const hasVaultAttempt = meta.vaultAttempt !== null && meta.vaultAttempt !== undefined;
  const hasVaultAttemptSeq = meta.vaultAttemptSeq > 0;
  const hasVaultGuest = (meta.vaultGuestPayouts ?? 0) > 0 && !!meta.vaultGuestCycle;
  if (
    !meta.worldQuestCycle &&
    meta.worldQuestLog.size === 0 &&
    !hasRep &&
    !hasCurrencies &&
    !hasReroll &&
    !hasClueHunt &&
    !hasClueCycle &&
    !hasCaskets &&
    !hasTreasureMap &&
    !hasVaultAttempt &&
    !hasVaultAttemptSeq &&
    !hasVaultGuest
  ) {
    return {};
  }
  const factionsObj = hasRep ? { ...meta.factions } : undefined;
  const currenciesObj = hasCurrencies ? { ...meta.factionCurrencies } : undefined;
  return {
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
      ...(currenciesObj ? { factionCurrencies: currenciesObj } : {}),
      ...(hasReroll ? { rerollCycle: meta.worldQuestRerollCycle } : {}),
      ...(hasReplacements ? { replacements: { ...meta.worldQuestReplacements } } : {}),
      ...(hasClueHunt && meta.clueHunt ? { clueHunt: { ...meta.clueHunt } } : {}),
      ...(hasClueCycle ? { clueScrollCycle: meta.clueScrollCycle } : {}),
      ...(hasCaskets ? { clueCasketsOpened: meta.clueCasketsOpened } : {}),
      ...(hasTreasureMap && meta.treasureMap ? { treasureMap: { ...meta.treasureMap } } : {}),
      ...(hasVaultAttempt && meta.vaultAttempt ? { vaultAttempt: { ...meta.vaultAttempt } } : {}),
      ...(hasVaultAttemptSeq ? { vaultAttemptSeq: meta.vaultAttemptSeq } : {}),
      ...(hasVaultGuest
        ? { vaultGuestCycle: meta.vaultGuestCycle, vaultGuestPayouts: meta.vaultGuestPayouts }
        : {}),
    },
    ...(factionsObj ? { factions: factionsObj } : {}),
    ...(currenciesObj ? { factionCurrencies: currenciesObj } : {}),
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
