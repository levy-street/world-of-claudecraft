import type { MoveInputFrame } from '../../src/sim/move_input';
import type { SimEvent } from '../../src/sim/types';

export type EnforcementAction = 'none' | 'kick';

export type ProtocolAnomaly = 'invalid_json' | 'non_object' | 'unknown_type' | 'unknown_command';

export interface PlayerSessionRef {
  accountId: number;
  characterId: number;
  name: string;
  ip: string;
}

export interface SessionRuntimeSnapshot {
  capturedAt: number;
  simTime: number;
  x: number;
  z: number;
  facing: number;
  dead: boolean;
  inCombat: boolean;
  targetId: number | null;
  instanceSlot: number | null;
  instanceDungeonId: string | null;
  level: number;
  classId: string;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  resourceType: string | null;
  autoAttack: boolean;
  followTargetId: number | null;
  moveSpeed: number;
  onGround: boolean;
}

// A bounded in-memory value histogram published by the detector for operator-facing
// calibration dashboards. Which quantities are measured, and their ids, are decided
// entirely by the implementation at runtime; this shape is deliberately generic.
export interface CalibrationHistogramBucket {
  le: number; // inclusive upper bound of the bucket
  count: number;
}

export interface CalibrationHistogram {
  id: string;
  count: number;
  min: number; // 0 when count is 0
  max: number;
  sum: number;
  buckets: CalibrationHistogramBucket[];
  overflowCount: number; // observations above the last bucket bound
}

export interface SuspiciousEvidence {
  kind: string;
  weight: number;
  detail: string;
  expiresAt: number;
}

export type SuspiciousPlayerState = 'SUSPICIOUS' | 'CONFIRMED';

export interface SuspiciousPlayer {
  ref: PlayerSessionRef;
  snapshot: SessionRuntimeSnapshot | null;
  state: SuspiciousPlayerState;
  score: number;
  evidence: SuspiciousEvidence[];
}

// The brand makes this handle impossible to construct or read outside this module.
declare const botTrackingBrand: unique symbol;
export interface BotTrackingContext {
  readonly [botTrackingBrand]: true;
}

export interface BotDetector {
  createTrackingContext(ref: PlayerSessionRef, meta?: unknown): BotTrackingContext;
  releaseTrackingContext(ctx: BotTrackingContext): void;
  observeCommand(ctx: BotTrackingContext, cmd: string, now: number, message?: unknown): void;
  observeEvent(ctx: BotTrackingContext, ev: SimEvent, now: number): void;
  observeInput(ctx: BotTrackingContext, frame: MoveInputFrame, now: number): void;
  observeProtocolAnomaly(
    ctx: BotTrackingContext,
    anomaly: ProtocolAnomaly,
    raw: string,
    now: number,
  ): void;
  handleTick(
    ctx: BotTrackingContext,
    now: number,
    enforce: boolean,
    snapshot: SessionRuntimeSnapshot | null,
  ): EnforcementAction;
  listSuspiciousPlayers(): SuspiciousPlayer[];
  listCalibrationHistograms(): CalibrationHistogram[];
}
