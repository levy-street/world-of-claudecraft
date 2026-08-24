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

// The detector's operator-tunable runtime configuration, published for the admin
// dashboard. Which fields exist, and their ids, groups, and labels, are decided
// entirely by the implementation at runtime; this shape is deliberately generic
// (the CalibrationHistogram precedent). The host persists an override document
// ({ [fieldId]: value }), audits before/after values, and replays it through
// applyConfig at boot. Config fields are operator-visible and MUST NOT expose secrets.
export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'select' | 'multi_select';

export type ConfigValue = string | number | boolean | string[];

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface ConfigField {
  id: string;
  group: string; // section heading the dashboard renders fields under
  label: string;
  type: ConfigFieldType;
  defaultValue: ConfigValue;
  value: ConfigValue; // currently applied (the default unless overridden)
  min?: number;
  max?: number;
  step?: number;
  unit?: string; // e.g. 'ms'
  options?: ConfigFieldOption[]; // select / multi_select choices
  help?: string;
}

export interface ConfigApplyResult {
  errors: string[];
}

export interface SuspiciousEvidence {
  kind: string;
  weight: number;
  detail: string;
  expiresAt: number;
  // Recurrence history, present only on kinds where re-triggering carries
  // information (decided entirely by the implementation): distinct episodes
  // observed this session, when the first and latest happened (epoch ms), and
  // the opening timestamps of the most recent episodes (bounded ring; the count
  // and firstAt keep the totals the ring loses when it overflows).
  occurrences?: number;
  firstAt?: number;
  lastAt?: number;
  episodesAt?: number[];
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

// One automated-detection observation for an account, in the words the
// detector itself uses (the evidence summary). The host owns the storage
// policy: source, kind, severity, dedupe, and field limits never cross the seam.
export interface SuspicionFlagObservation {
  accountId: number;
  details: string;
}

// What the host lends a detector that files automated cases. Both calls are
// fire-and-forget from the detector's tick: they never throw, and the promise
// they return never rejects. It resolves once the host has settled the write:
// true when the observation was accepted (persisted, or coalesced into a
// pending write), false only when the host could not persist it and the
// detector should retry later, the way it retries a failed report.
//   recordSuspicionFlag: a decision (the initial one, or an escalation worth a
//     fresh look): mints the account's active flag or bumps its occurrences.
//   refreshSuspicionFlagDetails: the evidence behind an already-recorded case
//     evolved: replaces the active flag's details, occurrences unchanged; no
//     active flag (an admin cleared it) means nothing is written. The host
//     paces these per account, so a detector may call as often as it likes.
export interface BotDetectorHost {
  recordSuspicionFlag(observation: SuspicionFlagObservation): Promise<boolean>;
  refreshSuspicionFlagDetails(observation: SuspicionFlagObservation): Promise<boolean>;
}

export interface BotDetector {
  createTrackingContext(ref: PlayerSessionRef, meta?: unknown): BotTrackingContext;
  // Contexts start connected; linkdead drop marks false, same-session resume marks true with fresh meta.
  setTrackingConnection(ctx: BotTrackingContext, connected: boolean, meta?: unknown): void;
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
  // The full operator-tunable surface: schema plus currently applied values.
  describeConfig(): ConfigField[];
  // Validates an override document ({ [fieldId]: value }) and REPLACES all previous
  // overrides with it (an absent id reverts that field to its default). Valid entries
  // apply immediately; invalid ones are skipped and reported in `errors`, so a strict
  // caller rejects on any error (re-applying its previous document) while boot applies
  // what it can and logs the rest.
  applyConfig(overrides: Record<string, unknown>): ConfigApplyResult;
  // Optional on purpose so either side of the seam can move first: a host that
  // offers it to a detector without it skips the call, and a detector that has
  // it keeps filing automated cases its old way until a host attaches. The
  // bundled implementation is whatever sits beside the server at build time,
  // so the two never have to be updated in the same step.
  attachHost?(host: BotDetectorHost): void;
}
