import type { TreasureMapRarity } from '../sim/content/treasure_maps';
import type { FactionId } from '../sim/factions';
import { freshFactionCurrencies, freshFactionReputation } from '../sim/factions';
import type { TurretPlan } from '../sim/minigames/turret_defense_plan';
import type { TurretSessionView } from '../sim/turret_defense_session';
import type {
  CannonPoint,
  QuestProgress,
  SimEvent,
  VehicleActionId,
  VehicleSession,
  WeeklyQuestProgress,
  WorldQuestProgress,
} from '../sim/types';
import type { ActivityChoice } from '../sim/world_quest_activity';
import type { NearbyWorldQuestTrace } from '../sim/world_quest_trace_public';
import type { HoardBossCueView } from '../world_api/dungeons';
import { HoardBossCueMirror } from './hoard_boss_cue_mirror';
import { applyQuestSelfWire } from './quest_snapshot_wire';
import { TurretFeedbackMirror } from './turret_feedback_mirror';
import {
  decodeTurretPlan,
  decodeTurretSeat,
  sameTurretSeat,
  type TurretSeatState,
} from './turret_session_wire';
import { decodeVehicleSession } from './vehicle_session_wire';
import { decodeActiveWorldBossIds } from './world_boss_snapshot_wire';
import { fetchWorldQuestLeaderboard } from './world_quest_leaderboard_wire';
import { decodeNearbyWorldQuestTraces } from './world_quest_trace_public_wire';

export type QuestWorldCommand =
  | { cmd: 'vehicle_enter'; station: string }
  | { cmd: 'vehicle_action'; action: VehicleActionId; x: number; z: number }
  | { cmd: 'vehicle_leave' }
  | { cmd: 'world_quest_puzzle_rotate'; quest: string; tileIndex: number }
  | { cmd: 'world_quest_match3_swap'; quest: string; fromIndex: number; toIndex: number }
  | { cmd: 'world_quest_match3_reset'; quest: string }
  | { cmd: 'world_quest_puzzle_reset'; quest: string }
  | { cmd: 'world_quest_glider_boost' }
  | { cmd: 'world_quest_accuse'; npcId: number }
  | { cmd: 'world_quest_shadow'; action: 'pickpocket' | 'leave'; targetId?: number }
  | { cmd: 'world_quest_start'; quest: string; difficulty: ActivityChoice }
  | { cmd: 'world_quest_reroll'; quest: string }
  | { cmd: 'world_quest_weekly_choose'; quest: string }
  | { cmd: 'world_quest_weekly_commend'; faction: string }
  | { cmd: 'clue_hunt_abandon' };

/** Cold owner mirrors shared by quest snapshots and world-boss map state. */
export class QuestWorldWireState {
  vehicleSession: VehicleSession | null = null;
  /** The `tur` and `turp` keys plus the event-built ring: the same object until one moves. */
  turretSession: TurretSessionView | null = null;
  /** The last applied snapshot's tick while seated, else null. */
  turretClock: number | null = null;
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
  factionCurrencies: Readonly<Record<FactionId, number>> = freshFactionCurrencies();
  worldQuestReplacements: Readonly<Record<string, string>> = Object.freeze({});
  worldQuestRerollCycle = '';
  /** The active clue hunt mirrored from the `cluh` self key (null when none). */
  clueHunt: Readonly<{ huntId: string; step: number }> | null = null;
  /** The read treasure map mirrored from the `tmap` self key (null when none). */
  treasureMap: Readonly<{ rarity: TreasureMapRarity; siteId: string }> | null = null;
  /** Client clock mirror of the authoritative Buried Hoard boss telegraphs;
   *  the host feeds it every routed event (ClientWorld's event loop). */
  protected readonly hoardBossCueMirror = new HoardBossCueMirror(() => performance.now());
  private activeWorldBossIds = new Set<string>();
  // Lazy like the cue mirror's reads: bare test clients skip field initializers.
  private turretFeedback?: TurretFeedbackMirror;
  private turretPlan: TurretPlan | null = null;
  private turretSeatWire: unknown = null;
  private turretSeat: TurretSeatState | null = null;
  /** A leave was sent for a seat this client could not read; cleared once it reads one again. */
  private turretUnreadableLeft = false;
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

  hoardBossCues(): HoardBossCueView[] {
    return this.hoardBossCueMirror?.views() ?? [];
  }

  worldQuestLeaderboard(board: string, page = 0, pageSize?: number, viewer?: string) {
    return fetchWorldQuestLeaderboard(this.questWorldRestBase, board, page, pageSize, viewer);
  }

  /** The owner-only quest family plus the world-boss and vehicle mirrors of one self record. */
  applyQuestSelfSnapshot(
    self: Parameters<typeof applyQuestSelfWire>[1] & {
      wba?: unknown;
      vehicle?: unknown;
      tur?: unknown;
      turp?: unknown;
    },
    simTime?: unknown,
    tick?: unknown,
  ): void {
    applyQuestSelfWire(this, self, simTime);
    if (self.wba !== undefined) this.applyWorldBossWire(self.wba);
    if (self.vehicle !== undefined) this.vehicleSession = decodeVehicleSession(self.vehicle);
    this.applyTurretSelfWire(self, tick);
  }

  /** Every routed event: the hoard telegraph clock and the turret feedback ring. */
  protected applyQuestWorldEvent(event: SimEvent): void {
    this.hoardBossCueMirror?.apply(event);
    if (event.type === 'turretDefense') this.turretRing().apply(event);
  }

  private turretRing(): TurretFeedbackMirror {
    this.turretFeedback ??= new TurretFeedbackMirror();
    return this.turretFeedback;
  }

  private applyTurretSelfWire(self: { tur?: unknown; turp?: unknown }, tick: unknown): void {
    const ring = this.turretRing();
    const planMoved = self.turp !== undefined;
    const seatMoved = self.tur !== undefined;
    if (planMoved) this.turretPlan = decodeTurretPlan(self.turp);
    if (seatMoved) this.turretSeatWire = self.tur;
    if (planMoved || seatMoved) {
      const prior = this.turretSeat;
      this.turretSeat = this.turretPlan
        ? decodeTurretSeat(this.turretSeatWire, this.turretPlan)
        : null;
      // Another seat (a spectator switching targets): its sequence need not go back.
      if (prior && this.turretSeat && !sameTurretSeat(prior, this.turretSeat)) ring.clear();
    }
    const ringMoved = ring.publish();
    this.leaveUnreadableSeat();
    if (!this.turretSeat) {
      ring.clear();
      this.turretSession = null;
    } else if (planMoved || seatMoved || ringMoved || !this.turretSession) {
      this.turretSession = { ...this.turretSeat, feedback: ring.entries };
    }
    this.turretClock =
      this.turretSession && typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0
        ? tick
        : null;
  }

  /**
   * The server holds a seat this client cannot decode (a skewed build, a field out of
   * bounds): no turret HUD means no Leave, while the seat locks the player in place, so
   * the client leaves it on the player's behalf, once per unreadable stretch.
   */
  private leaveUnreadableSeat(): void {
    const unreadable = this.turretSeatWire != null && !this.turretSeat;
    if (!unreadable) {
      this.turretUnreadableLeft = false;
      return;
    }
    if (this.turretUnreadableLeft) return;
    this.turretUnreadableLeft = true;
    console.warn('[turret] the server sent a seat this client cannot read; leaving it');
    this.leaveVehicle();
  }

  /** Drops both seats' mirrors (a closed socket, an ended session, a reconnect). */
  protected clearVehicleMirrors(): void {
    this.vehicleSession = null;
    this.turretSession = null;
    this.turretClock = null;
    this.turretPlan = null;
    this.turretSeatWire = null;
    this.turretSeat = null;
    this.turretUnreadableLeft = false;
    this.turretFeedback?.reset();
  }

  enterVehicle(stationId: string): void {
    this.sendQuestWorldCommand({ cmd: 'vehicle_enter', station: stationId });
  }

  useVehicleAction(action: VehicleActionId, point: CannonPoint): void {
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

  startWorldQuestActivity(questId: string, difficulty: ActivityChoice): void {
    this.sendQuestWorldCommand({ cmd: 'world_quest_start', quest: questId, difficulty });
  }

  abandonClueHunt(): void {
    this.sendQuestWorldCommand({ cmd: 'clue_hunt_abandon' });
  }

  canRerollWorldQuest(questId: string): { canReroll: boolean; reason?: string } {
    if (!this.worldQuestCycle) {
      return { canReroll: false, reason: 'No active world quest cycle.' };
    }
    if (this.worldQuestRerollCycle === this.worldQuestCycle) {
      return { canReroll: false, reason: 'Daily world quest reroll already used today.' };
    }
    const progress = this.worldQuestLog.get(questId);
    if (
      progress?.state === 'completed' ||
      progress?.practiceOnly ||
      progress?.glider?.practiceOnly
    ) {
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
    this.clearVehicleMirrors();
    this.worldQuestCycle = '';
    this.worldQuestExpiresAtMs = 0;
    this.worldQuestTime = 0;
    this.worldQuestLog = new Map();
    this.worldQuestReplacements = Object.freeze({});
    this.worldQuestRerollCycle = '';
    this.weeklyQuest = null;
    this.weeklyQuestResetAtMs = 0;
    this.clueHunt = null;
    this.treasureMap = null;
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
