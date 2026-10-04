import type { TreasureMapRarity } from '../sim/content/treasure_maps';
import type { FactionId } from '../sim/factions';
import type { PersonalFireAndFlyRecords } from '../sim/fire_and_fly_personal_records';
import type { FireAndFlyRecruitment } from '../sim/fire_and_fly_recruitment';
import type {
  QuestProgress,
  QuestState,
  WeeklyQuestProgress,
  WorldQuestProgress,
} from '../sim/types';
import type { ActivityChoice } from '../sim/world_quest_activity';
import type { WorldQuestMedal, WorldQuestScoreboardId } from '../sim/world_quest_scoreboards';
import type { NearbyWorldQuestTrace } from '../sim/world_quest_trace_public';

/** One ranked row of a world-quest scoreboard (src/sim/world_quest_scoreboards.ts). */
export interface WorldQuestLeaderboardEntry {
  rank: number;
  name: string;
  medal: WorldQuestMedal | null;
  /** The board's number: waves held, seconds, or points (the board says which). */
  metric: number;
  /** The Gunner's Mastery only: the best mission medals summed (gold 3, silver 2, bronze 1). */
  stars?: number;
}

export interface WorldQuestLeaderboardPage {
  /** Offline records belonging only to this character. */
  personal?: boolean;
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
  /** The weekly emissary's pick for this character (null while none is taken). */
  readonly weeklyQuest: WeeklyQuestProgress | null;
  /** Epoch ms of the next weekly reset, when the pick rolls over. */
  readonly weeklyQuestResetAtMs: number;
  /** Nearby other players' blue trails/results, never their private drawing guidance. */
  readonly nearbyWorldQuestTraces: readonly NearbyWorldQuestTrace[];
  /** Persistent reputation standing across all allied factions. */
  readonly factions: Readonly<Record<FactionId, number>>;
  /** Persistent balances of allied faction currencies (marks, crests, cogs). */
  readonly factionCurrencies: Readonly<Record<FactionId, number>>;
  /** Personal world quest replacement mappings for the current daily cycle. */
  readonly worldQuestReplacements?: Readonly<Record<string, string>>;
  /** Cycle key for which the player used their daily world quest reroll. */
  readonly worldQuestRerollCycle?: string;
  /**
   * Clue Scrolls: the active treasure hunt (src/sim/clue_scrolls.ts), the
   * authored hunt id plus the 0-based index of the step being solved, or null
   * when none. The tracker resolves the clue text from clues.<huntId>.<step>.
   */
  readonly clueHunt: Readonly<{ huntId: string; step: number }> | null;
  /** Drops the active clue hunt; returns nothing (the spent scroll stays spent). */
  abandonClueHunt(): void;
  /**
   * Treasure maps (src/sim/treasure_vault.ts): the map read and not yet dug up
   * (its rarity and the dig site id, resolved through TREASURE_SITES_BY_ID), or
   * null when none.
   */
  readonly treasureMap: Readonly<{ rarity: TreasureMapRarity; siteId: string }> | null;
  /**
   * Fire and Fly's recruitment (src/sim/fire_and_fly_recruitment.ts): the trials won in
   * order and whether the character is recruited; `fireAndFlyScenarioUnlocked` reads
   * which trials and missions Master Gunner Alder offers.
   */
  readonly fireAndFlyRecruitment: Readonly<FireAndFlyRecruitment>;
  /**
   * This character's own Fire and Fly records (src/sim/fire_and_fly_personal_records.ts),
   * keyed by scoreboard id: the best run per trial (day and all time) and per mission.
   * Owner-only, so the Gunnery Board reads its medals without a ladder request.
   */
  readonly fireAndFlyRecords: Readonly<PersonalFireAndFlyRecords>;
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
  startWorldQuestActivity(questId: string, difficulty: ActivityChoice): void;
  /** Take one of the emissary's weekly charges (server-validated: beside him, none taken). */
  chooseWeeklyQuest(questId: string): void;
  /** Claim the finished weekly charge's commendation for one faction. */
  commendWeeklyQuest(factionId: FactionId): void;
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
