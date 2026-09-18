import type { FactionId } from '../sim/factions';
import { freshFactionReputation } from '../sim/factions';
import type {
  CannonActionId,
  CannonPoint,
  QuestProgress,
  VehicleSession,
  WeeklyQuestProgress,
  WorldQuestProgress,
} from '../sim/types';
import type { WorldQuestDifficulty } from '../sim/world_quest_activity';
import type { NearbyWorldQuestTrace } from '../sim/world_quest_trace_public';
import { applyQuestSelfWire } from './quest_snapshot_wire';
import { decodeVehicleSession } from './vehicle_session_wire';
import { decodeActiveWorldBossIds } from './world_boss_snapshot_wire';
import { fetchWorldQuestLeaderboard } from './world_quest_leaderboard_wire';
import { decodeNearbyWorldQuestTraces } from './world_quest_trace_public_wire';

export type QuestWorldCommand =
  | { cmd: 'vehicle_enter'; station: string }
  | { cmd: 'vehicle_action'; action: CannonActionId; x: number; z: number }
  | { cmd: 'vehicle_leave' }
  | { cmd: 'world_quest_puzzle_rotate'; quest: string; tileIndex: number }
  | { cmd: 'world_quest_match3_swap'; quest: string; fromIndex: number; toIndex: number }
  | { cmd: 'world_quest_match3_reset'; quest: string }
  | { cmd: 'world_quest_puzzle_reset'; quest: string }
  | { cmd: 'world_quest_glider_boost' }
  | { cmd: 'world_quest_accuse'; npcId: number }
  | { cmd: 'world_quest_shadow'; action: 'pickpocket' | 'leave'; targetId?: number }
  | { cmd: 'world_quest_start'; quest: string; difficulty: WorldQuestDifficulty }
  | { cmd: 'world_quest_reroll'; quest: string }
  | { cmd: 'world_quest_weekly_choose'; quest: string }
  | { cmd: 'world_quest_weekly_commend'; faction: string };

/** Cold owner mirrors shared by quest snapshots and world-boss map state. */
export class QuestWorldWireState {
  vehicleSession: VehicleSession | null = null;
  questLog = new Map<string, QuestProgress>();
  questsDone = new Set<string>();
  worldQuestCycle = '';
  worldQuestExpiresAtMs = 0;
  worldQuestTime = 0;
  worldQuestLog: ReadonlyMap<string, WorldQuestProgress> = new Map();
  weeklyQuest: WeeklyQuestProgress | null = null;
  weeklyQuestResetAtMs = 0;
  nearbyWorldQuestTraces: readonly NearbyWorldQuestTrace[] = [];
  factions: Readonly<Record<FactionId, number>> = freshFactionReputation();
  worldQuestReplacements: Readonly<Record<string, string>> = Object.freeze({});
  worldQuestRerollCycle = '';
  private activeWorldBossIds = new Set<string>();
  private questWorldTransport: ((command: QuestWorldCommand) => void) | null = null;
  private questWorldRestBase = '';

  /** The host's command transport and REST origin, bound once at construction. */
  protected bindQuestWorldWire(restBase: string, send: (command: QuestWorldCommand) => void): void {
    this.questWorldRestBase = restBase;
    this.questWorldTransport = send;
  }

  protected sendQuestWorldCommand(command: QuestWorldCommand): void {
    if (!this.questWorldTransport) {
      throw new Error('Quest world command transport is not configured');
    }
    this.questWorldTransport(command);
  }

  worldQuestLeaderboard(board: string, page = 0, pageSize?: number, viewer?: string) {
    return fetchWorldQuestLeaderboard(this.questWorldRestBase, board, page, pageSize, viewer);
  }

  /** The owner-only quest family plus the world-boss and vehicle mirrors of one self record. */
  applyQuestSelfSnapshot(
    self: Parameters<typeof applyQuestSelfWire>[1] & { wba?: unknown; vehicle?: unknown },
    simTime?: unknown,
  ): void {
    applyQuestSelfWire(this, self, simTime);
    if (self.wba !== undefined) this.applyWorldBossWire(self.wba);
    if (self.vehicle !== undefined) this.vehicleSession = decodeVehicleSession(self.vehicle);
  }

  enterVehicle(stationId: string): void {
    this.sendQuestWorldCommand({ cmd: 'vehicle_enter', station: stationId });
  }

  useVehicleAction(action: CannonActionId, point: CannonPoint): void {
    this.sendQuestWorldCommand({ cmd: 'vehicle_action', action, x: point.x, z: point.z });
  }

  leaveVehicle(): void {
    this.sendQuestWorldCommand({ cmd: 'vehicle_leave' });
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

  resetWorldQuestPuzzle(questId: string): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_puzzle_reset', quest: questId });
  }

  accuseWorldQuestSuspect(npcId: number): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_accuse', npcId });
  }

  boostWorldQuestGlider(): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_glider_boost' });
  }

  shadowWorldQuestAction(action: 'pickpocket' | 'leave', targetId?: number): void {
    this.sendQuestWorldCommand({
      cmd: 'world_quest_shadow',
      action,
      ...(targetId === undefined ? {} : { targetId }),
    });
  }

  startWorldQuestActivity(questId: string, difficulty: WorldQuestDifficulty): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_start', quest: questId, difficulty });
  }

  canRerollWorldQuest(questId: string): { canReroll: boolean; reason?: string } {
    if (!this.worldQuestCycle) {
      return { canReroll: false, reason: 'No active world quest cycle.' };
    }
    if (this.worldQuestRerollCycle === this.worldQuestCycle) {
      return { canReroll: false, reason: 'Daily world quest reroll already used today.' };
    }
    const progress = this.worldQuestLog.get(questId);
    if (progress?.state === 'completed') {
      return { canReroll: false, reason: 'Completed world quests cannot be rerolled.' };
    }
    if (progress && progress.count > 0) {
      return { canReroll: false, reason: 'In-progress world quests cannot be rerolled.' };
    }
    return { canReroll: true };
  }

  rerollWorldQuest(questId: string): boolean {
    const check = this.canRerollWorldQuest(questId);
    if (!check.canReroll) return false;
    this.sendQuestWorldCommand({ cmd: 'world_quest_reroll', quest: questId });
    return true;
  }

  chooseWeeklyQuest(questId: string): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_weekly_choose', quest: questId });
  }

  commendWeeklyQuest(factionId: FactionId): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_weekly_commend', faction: factionId });
  }

  worldBossActive(bossId: string): boolean {
    return this.activeWorldBossIds.has(bossId);
  }

  applyWorldBossWire(value: unknown): void {
    this.activeWorldBossIds = decodeActiveWorldBossIds(value);
  }

  resetQuestWorldWireState(): void {
    this.vehicleSession = null;
    this.worldQuestCycle = '';
    this.worldQuestExpiresAtMs = 0;
    this.worldQuestTime = 0;
    this.worldQuestLog = new Map();
    this.worldQuestReplacements = Object.freeze({});
    this.worldQuestRerollCycle = '';
    this.weeklyQuest = null;
    this.weeklyQuestResetAtMs = 0;
    this.nearbyWorldQuestTraces = [];
    this.activeWorldBossIds = new Set();
  }

  /** Unlike owner deltas, public trails clear on every missing or malformed snapshot. */
  applyNearbyWorldQuestTraceSnapshot<
    T extends { self?: unknown; qtraces?: unknown; time?: unknown },
  >(snap: T): T['self'] {
    const self = snap.self as { id?: unknown } | undefined;
    this.nearbyWorldQuestTraces = decodeNearbyWorldQuestTraces(snap.qtraces, self?.id, snap.time);
    return snap.self;
  }
}
