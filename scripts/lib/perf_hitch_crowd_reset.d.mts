export type CrowdResetPhase = 'neutral' | 'presented';

export interface CrowdResetFixtureRow {
  readonly index: number;
  readonly cls: string;
  readonly skin: number;
  readonly weaponType: string;
  readonly weaponSkin: string;
  readonly mountItem: string;
}

export interface CrowdResetTarget {
  readonly botIndex: number;
  readonly parking: { readonly x: number; readonly z: number };
  readonly facing: number;
  readonly level: number;
  readonly auraIds: readonly string[];
  readonly skin: number;
  readonly weaponType: string;
  readonly weaponSkin: string;
  readonly mountItem: string;
  readonly mountKey: string;
}

export interface CrowdResetState {
  readonly botIndex: number;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly level: number;
  readonly skin: number;
  readonly weaponSkin: string | null;
  readonly mountKey: string;
  readonly mountCastRemaining: number;
  readonly mountCastKey: string;
  readonly weaponStowed: boolean;
  readonly auraIds: readonly string[];
  readonly targetId: number | null;
  readonly autoAttack: boolean;
  readonly queuedOnSwing: string | null;
  readonly casting: boolean;
  readonly inCombat: boolean;
  readonly dead: boolean;
  readonly ghost: boolean;
  readonly profilerInvulnerable: boolean;
  readonly ridingTrained: boolean;
  readonly bagItemIds: readonly string[];
}

export type CrowdResetAction =
  | {
      readonly botIndex: number;
      readonly kind: 'input';
      readonly move: Readonly<Record<string, number>>;
      readonly facing: number;
    }
  | {
      readonly botIndex: number;
      readonly kind: 'command';
      readonly payload: Readonly<Record<string, unknown>> & { readonly cmd: string };
    };

export interface CrowdResetVerdict {
  readonly ok: boolean;
  readonly phase: CrowdResetPhase;
  readonly bots: number;
  readonly failures: readonly string[];
}

export interface CrowdResetEvidence {
  readonly bots: number;
  readonly recovery: CrowdRecoveryVerdict & { readonly attempts: number };
  readonly neutral: CrowdResetVerdict & { readonly attempts: number };
  readonly presented: CrowdResetVerdict & { readonly attempts: number };
}

export interface CrowdRecoveryVerdict {
  readonly ok: boolean;
  readonly phase: 'recovery';
  readonly bots: number;
  readonly failures: readonly string[];
}

export interface CrowdCosmeticEvidence {
  readonly players: number;
  readonly skins: number;
  readonly weaponSkins: number;
  readonly mounts: number;
  readonly [key: string]: unknown;
}

export const HITCH_CROWD_PARKING_X: number;
export const HITCH_CROWD_PARKING_Z: number;
export const HITCH_CROWD_PARKING_LOCATION: Readonly<{
  readonly name: string;
  readonly x: number;
  readonly z: number;
}>;
export const HITCH_CROWD_PARKING_COLUMNS: number;
export const HITCH_CROWD_PARKING_SPACING: number;
export const HITCH_CROWD_PARKING_TOLERANCE: number;
export const HITCH_CROWD_INFLUX_LOCATION: Readonly<{
  readonly name: string;
  readonly x: number;
  readonly z: number;
}>;
export const HITCH_CROWD_INFLUX_X: number;
export const HITCH_CROWD_INFLUX_Z: number;
export const HITCH_CROWD_INFLUX_MOTION_RADIUS: number;
export const HITCH_CROWD_INFLUX_START_RADIUS: number;
export const HITCH_CROWD_INFLUX_MOVE_INTERVAL_MS: number;
export const HITCH_CROWD_INFLUX_MOVE_STEPS: number;
export const HITCH_CROWD_COMBAT_QUIET_MS: number;
export const HITCH_CROWD_FACING: number;
export const HITCH_CROWD_FACING_TOLERANCE: number;
export const HITCH_CROWD_RESET_LEVEL: number;
export const HITCH_CROWD_RECOVERY_LEVEL: number;
export const HITCH_CROWD_CHAT_RETRY_MS: number;
export const HITCH_CROWD_COMMAND_RETRY_MS: number;
export const HITCH_CROWD_MOUNT_GRANT_READBACK_MS: number;

export interface CrowdCommandLedger {
  readonly issuedAtBySignature: Map<string, number>;
  readonly lastChatAtByBot: Map<number, number>;
}

export interface CrowdServerErrorTail {
  readonly botIndex: number;
  readonly errors: readonly string[];
}

export function createCrowdCommandLedger(): CrowdCommandLedger;

export function crowdCommandSignature(
  botIndex: number,
  payload: Readonly<Record<string, unknown>> & { readonly cmd: string },
): string;

export function paceCrowdResetActions(
  ledger: CrowdCommandLedger,
  actions: readonly CrowdResetAction[],
  nowMs: number,
): CrowdResetAction[];

export function planCrowdMountReadinessActions(
  targets: readonly CrowdResetTarget[],
  states: readonly CrowdResetState[],
  ledger: CrowdCommandLedger,
  nowMs: number,
): CrowdResetAction[];

export function assertNoRateLimiterErrors(
  serverErrors: readonly CrowdServerErrorTail[] | null | undefined,
): readonly CrowdServerErrorTail[];

export function buildCrowdInfluxPositions(botCount: number): Array<{
  readonly x: number;
  readonly z: number;
  readonly angle: number;
}>;

export function buildCrowdResetTargets(rows: readonly CrowdResetFixtureRow[]): CrowdResetTarget[];

export function observeCrowdResetState(input: {
  readonly botIndex: number;
  readonly frame: Readonly<Record<string, unknown>> | null | undefined;
  readonly profilerInvulnerable?: boolean;
  readonly ridingTrained?: boolean;
  readonly inventory?: readonly unknown[];
  readonly inCombat?: boolean;
}): CrowdResetState;

export function planCrowdRecoveryActions(
  targets: readonly CrowdResetTarget[],
  states: readonly CrowdResetState[],
): CrowdResetAction[];

export function validateCrowdRecoveryState(
  targets: readonly CrowdResetTarget[],
  states: readonly CrowdResetState[],
): CrowdRecoveryVerdict;

export function validateCrowdRecoveryLifeState(
  targets: readonly CrowdResetTarget[],
  states: readonly CrowdResetState[],
): CrowdRecoveryVerdict;

export function planCrowdResetActions(
  targets: readonly CrowdResetTarget[],
  states: readonly CrowdResetState[],
  phase: CrowdResetPhase,
  sequence?: {
    readonly nowMs?: number;
    readonly presentedAlignedBotIds?: ReadonlySet<number>;
    readonly mountRetryHoldUntilByBot?: ReadonlyMap<number, number>;
  },
): CrowdResetAction[];

export function crowdResetPlacementSettled(
  target: CrowdResetTarget,
  state: CrowdResetState,
): boolean;

export function validateCrowdResetState(
  targets: readonly CrowdResetTarget[],
  states: readonly CrowdResetState[],
  phase: CrowdResetPhase,
): CrowdResetVerdict;

export function assertCrowdResetEvidence(
  reset: CrowdResetEvidence | null | undefined,
  botCount: number,
): CrowdResetEvidence;

export function buildCrowdInfluxValidation(input: {
  readonly cosmetics: CrowdCosmeticEvidence;
  readonly quiet: unknown;
  readonly reset: CrowdResetEvidence | null | undefined;
  readonly botCount: number;
  readonly serverErrors?: readonly CrowdServerErrorTail[];
}): CrowdCosmeticEvidence & {
  readonly quiet: unknown;
  readonly reset: CrowdResetEvidence;
  readonly serverErrors: readonly CrowdServerErrorTail[];
};
