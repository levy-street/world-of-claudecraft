import type { MoveInput } from '../sim/types';
import { type InputTickFrame, InputTickSampler } from './input_tick_sampler';

export interface MovementWireClient {
  movementWireVersion: 1 | 2;
  onMovementWireNegotiated: ((version: 1 | 2, now: number) => void) | null;
  onMovementWireNeutral: ((now: number) => boolean) | null;
  movementWireIsOpen(): boolean;
  sendMovementFrame(frame: InputTickFrame, now: number, bypassBackpressure?: boolean): boolean;
}

export class MovementWireGlue {
  onFrame: ((frame: InputTickFrame) => void) | null = null;
  onNegotiated: ((version: 1 | 2) => void) | null = null;
  private readonly sampler = new InputTickSampler();
  private paused = false;
  private pendingTurnEngage: { turnLeft: boolean; turnRight: boolean } | null = null;

  get interpolationAlpha(): number {
    return this.sampler.interpolationAlpha;
  }

  connect(client: MovementWireClient, now: number): void {
    client.onMovementWireNegotiated = (version, negotiatedAt) =>
      this.negotiated(version, negotiatedAt);
    client.onMovementWireNeutral = (now) => this.emitNeutralFrame(client, now);
    this.negotiated(client.movementWireVersion, now);
  }

  negotiated(version: 1 | 2, now: number): void {
    this.onNegotiated?.(version);
    if (version !== 2) return;
    this.sampler.reset(now);
    this.paused = false;
    this.pendingTurnEngage = null;
  }

  resume(): void {
    this.paused = false;
  }

  emitNeutralFrame(client: MovementWireClient, now: number): boolean {
    if (client.movementWireVersion !== 2 || !client.movementWireIsOpen()) return false;
    const frame = this.sampler.emitNeutralFrame(now);
    this.pendingTurnEngage = null;
    try {
      const sent = client.sendMovementFrame(frame, now, true);
      if (sent) this.onFrame?.(frame);
      return sent;
    } finally {
      this.paused = true;
    }
  }

  advance(
    client: MovementWireClient,
    _frameDtSec: number,
    mi: MoveInput,
    facing: number | null,
    now: number,
    turnEngageEdge = false,
  ): boolean {
    if (client.movementWireVersion !== 2 || this.paused || !client.movementWireIsOpen()) {
      return false;
    }
    if (turnEngageEdge) {
      this.pendingTurnEngage = { turnLeft: mi.turnLeft, turnRight: mi.turnRight };
    }
    const steadyMi = turnEngageEdge ? { ...mi, turnLeft: false, turnRight: false } : mi;
    let sampledEngage = false;
    const frames = this.sampler.advance(now, () => {
      if (this.pendingTurnEngage && !sampledEngage) {
        sampledEngage = true;
        return {
          mi: {
            ...steadyMi,
            turnLeft: this.pendingTurnEngage.turnLeft,
            turnRight: this.pendingTurnEngage.turnRight,
          },
          facing: null,
        };
      }
      return { mi: steadyMi, facing };
    });
    let emitted = false;
    for (const frame of frames) {
      if (!client.sendMovementFrame(frame, now)) continue;
      emitted = true;
      if (frame.mi.turnLeft || frame.mi.turnRight) this.pendingTurnEngage = null;
      this.onFrame?.(frame);
    }
    return emitted;
  }
}
