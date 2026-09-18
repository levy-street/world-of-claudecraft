import type { FactionId } from '../sim/factions';
import type { QuestProgress, QuestState, WorldQuestProgress } from '../sim/types';
import type { WorldQuestDifficulty } from '../sim/world_quest_activity';
import type { WorldQuestMedal, WorldQuestScoreboardId } from '../sim/world_quest_scoreboards';
import type { NearbyWorldQuestTrace } from '../sim/world_quest_trace_public';

/** One ranked row of a world-quest scoreboard (src/sim/world_quest_scoreboards.ts). */
export interface WorldQuestLeaderboardEntry {
  rank: number;
  name: string;
  medal: WorldQuestMedal | null;
  /** The board's number: waves held, seconds, or points (the board says which). */
  metric: number;
}

export interface WorldQuestLeaderboardPage {
  board: WorldQuestScoreboardId;
  leaders: WorldQuestLeaderboardEntry[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  /** The viewer's own best row on the WHOLE ladder (not just this page), when a
   *  viewer name was asked for and that character holds a row; null otherwise. */
  self?: WorldQuestLeaderboardEntry | null;
}

export interface IWorldQuests {
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  worldQuestCycle: string;
  /** Authoritative epoch-ms boundary at which the current rotation is replaced. */
  worldQuestExpiresAtMs: number;
  /** Latest authoritative simulation time used by session-bound World Quest deadlines. */
  readonly worldQuestTime?: number;
  worldQuestLog: ReadonlyMap<string, WorldQuestProgress>;
  /** Nearby other players' blue trails/results, never their private drawing guidance. */
  readonly nearbyWorldQuestTraces: readonly NearbyWorldQuestTrace[];
  /** Persistent reputation standing across all allied factions. */
  readonly factions: Readonly<Record<FactionId, number>>;
  /** Personal world quest replacement mappings for the current daily cycle. */
  readonly worldQuestReplacements?: Readonly<Record<string, string>>;
  /** Cycle key for which the player used their daily world quest reroll. */
  readonly worldQuestRerollCycle?: string;
  canRerollWorldQuest?(questId: string): { canReroll: boolean; reason?: string };
  rerollWorldQuest?(questId: string): boolean;
  questState(questId: string): QuestState;
  acceptQuest(questId: string, selection?: string): void;
  turnInQuest(questId: string): void;
  abandonQuest(questId: string): void;
  rotateWorldQuestPuzzleTile(questId: string, tileIndex: number): void;
  swapWorldQuestMatch3Tiles(questId: string, fromIndex: number, toIndex: number): void;
  resetWorldQuestMatch3(questId: string): void;
  resetWorldQuestPuzzle(questId: string): void;
  boostWorldQuestGlider(): void;
  accuseWorldQuestSuspect(npcId: number): void;
  shadowWorldQuestAction(action: 'pickpocket' | 'leave', targetId?: number): void;
  /** The instructor dialog's explicit-difficulty start (Normal / Hard) for an
   *  activity that offers the choice; the plain talk keeps its default profile. */
  startWorldQuestActivity(questId: string, difficulty: WorldQuestDifficulty): void;
  /** One page of a medal world quest's public ladder (best row per character;
   *  the offline world has no ladder and resolves an empty page). `viewer` is a
   *  character name: the page's `self` carries that character's standing. */
  worldQuestLeaderboard(
    board: WorldQuestScoreboardId,
    page?: number,
    pageSize?: number,
    viewer?: string,
  ): Promise<WorldQuestLeaderboardPage>;
  acceptLinkedQuest(questId: string, fromPid: number): void;
}
