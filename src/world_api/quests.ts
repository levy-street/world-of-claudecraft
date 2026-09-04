import type { QuestProgress, QuestState, WorldQuestProgress } from '../sim/types';

export interface IWorldQuests {
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  worldQuestCycle: string;
  /** Authoritative epoch-ms boundary at which the current rotation is replaced. */
  worldQuestExpiresAtMs: number;
  worldQuestLog: ReadonlyMap<string, WorldQuestProgress>;
  questState(questId: string): QuestState;
  acceptQuest(questId: string, selection?: string): void;
  turnInQuest(questId: string): void;
  abandonQuest(questId: string): void;
  rotateWorldQuestPuzzleTile(questId: string, tileIndex: number): void;
  swapWorldQuestMatch3Tiles(questId: string, fromIndex: number, toIndex: number): void;
  resetWorldQuestMatch3(questId: string): void;
  acceptLinkedQuest(questId: string, fromPid: number): void;
  // The tutorial greeting's accept button: asks the sim for the ferry ride to
  // the Proving Shore. Server-validated (level 1, alive, overworld); the
  // decline path needs no command at all (the one-shot flag latched at emit).
  startTutorial(): void;
}
