import type { SimEvent } from '../../src/sim/types';
import type { MoveInputFrame } from '../../src/sim/move_input';

export type EnforcementAction = 'none' | 'kick';

export type ProtocolAnomaly =
  | 'invalid_json'
  | 'non_object'
  | 'unknown_type'
  | 'unknown_command';

export interface PlayerSessionRef {
  accountId: number;
  characterId: number;
  name: string;
  ip: string;
}

// The brand makes this handle impossible to construct or read outside this module.
declare const botTrackingBrand: unique symbol;
export interface BotTrackingContext { readonly [botTrackingBrand]: true }


export interface BotDetector {
  createTrackingContext(ref: PlayerSessionRef, meta?: unknown): BotTrackingContext;
  releaseTrackingContext(ctx: BotTrackingContext): void;
  observeCommand(ctx: BotTrackingContext, cmd: string, now: number, message?: unknown): void;
  observeEvent(ctx: BotTrackingContext, ev: SimEvent, now: number): void;
  observeInput(ctx: BotTrackingContext, frame: MoveInputFrame, now: number): void;
  observeProtocolAnomaly(ctx: BotTrackingContext, anomaly: ProtocolAnomaly, raw: string, now: number): void;
  handleTick(ctx: BotTrackingContext, now: number, enforce: boolean): EnforcementAction;
}
