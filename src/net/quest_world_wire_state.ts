import type { QuestProgress, WorldQuestProgress } from '../sim/types';
import { decodeActiveWorldBossIds } from './world_boss_snapshot_wire';

export type QuestWorldCommand =
  | { cmd: 'world_quest_puzzle_rotate'; quest: string; tileIndex: number }
  | { cmd: 'world_quest_match3_swap'; quest: string; fromIndex: number; toIndex: number }
  | { cmd: 'world_quest_match3_reset'; quest: string };

/** Cold owner mirrors shared by quest snapshots and world-boss map state. */
export class QuestWorldWireState {
  questLog = new Map<string, QuestProgress>();
  questsDone = new Set<string>();
  worldQuestCycle = '';
  worldQuestExpiresAtMs = 0;
  worldQuestLog: ReadonlyMap<string, WorldQuestProgress> = new Map();
  private activeWorldBossIds = new Set<string>();

  protected sendQuestWorldCommand(_command: QuestWorldCommand): void {
    throw new Error('Quest world command transport is not configured');
  }

  rotateWorldQuestPuzzleTile(questId: string, tileIndex: number): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_puzzle_rotate', quest: questId, tileIndex });
  }

  swapWorldQuestMatch3Tiles(questId: string, fromIndex: number, toIndex: number): void {
    this.sendQuestWorldCommand({
      cmd: 'world_quest_match3_swap',
      quest: questId,
      fromIndex,
      toIndex,
    });
  }

  resetWorldQuestMatch3(questId: string): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_match3_reset', quest: questId });
  }

  worldBossActive(bossId: string): boolean {
    return this.activeWorldBossIds.has(bossId);
  }

  applyWorldBossWire(value: unknown): void {
    this.activeWorldBossIds = decodeActiveWorldBossIds(value);
  }

  resetQuestWorldWireState(): void {
    this.worldQuestCycle = '';
    this.worldQuestExpiresAtMs = 0;
    this.worldQuestLog = new Map();
    this.activeWorldBossIds = new Set();
  }
}
