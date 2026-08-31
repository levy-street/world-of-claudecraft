import type { InputTickFrame } from '../game/input_tick_sampler';
import { type MovementWireClient, MovementWireGlue } from '../game/movement_wire_glue';
import { stepPlayerMotion } from '../sim/player_motion';
import type { Entity, MoveInput } from '../sim/types';
import { createClientPlayerMotionDeps } from './client_player_motion';
import {
  copyMotionState,
  type MotionState,
  PredictionRing,
  type PredictionStep,
  predictTick,
  reconcile,
} from './self_prediction_core';
import type { ReconciledSelfPrediction } from './self_render_position_core';

export interface SelfPredictionWire extends MovementWireClient {
  reconAuthoritativeX: number | null;
  reconAuthoritativeY: number | null;
  reconAuthoritativeZ: number | null;
  reconAuthoritativeFacing: number | null;
  reconAckClientTick: number;
  reconOverrideEpoch: number;
  reconOverrideActive: boolean;
  reconMoveSpeedMult: number;
  netPipeline(): {
    noteReconcileOutcome(outcome: 'match' | 'replayed' | 'ignore' | 'stale' | 'suspend'): void;
  };
}

function hasAuthoritativePose(wire: SelfPredictionWire): boolean {
  return (
    wire.reconAuthoritativeX !== null &&
    wire.reconAuthoritativeY !== null &&
    wire.reconAuthoritativeZ !== null &&
    wire.reconAuthoritativeFacing !== null
  );
}

function motionState(self: Entity, wire: SelfPredictionWire): MotionState {
  const x = wire.reconAuthoritativeX ?? self.pos.x;
  const y = wire.reconAuthoritativeY ?? self.pos.y;
  const z = wire.reconAuthoritativeZ ?? self.pos.z;
  return {
    id: self.id,
    pos: { x, y, z },
    prevPos: { x, y, z },
    facing: wire.reconAuthoritativeFacing ?? self.facing,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    jumping: false,
    fallStartY: y,
    swimStroke: 0,
    swimDiving: false,
    auras: self.auras.slice(),
    ghost: self.ghost,
    sitting: self.sitting,
    castingAbility: self.castingAbility,
    maxHp: self.maxHp,
    mountKey: self.mountKey,
    mountCastRemaining: self.mountCastRemaining,
    mountCastKey: self.mountCastKey,
  };
}

function refreshMirroredMotionState(state: MotionState, self: Entity): void {
  state.auras = self.auras.slice();
  state.ghost = self.ghost;
  state.sitting = self.sitting;
  state.castingAbility = self.castingAbility;
  state.maxHp = self.maxHp;
  state.mountKey = self.mountKey;
  state.mountCastRemaining = self.mountCastRemaining;
  state.mountCastKey = self.mountCastKey;
}

export class MovementPredictionPipeline {
  private readonly wireGlue = new MovementWireGlue();
  private readonly ring = new PredictionRing();
  private readonly stepFn: PredictionStep;
  private wire: SelfPredictionWire | null = null;
  private self: Entity | null = null;
  private enabled = false;
  private predicted: MotionState | null = null;
  private lastEpoch: number | null = null;
  private lastAckClientTick = -1;
  private lastPredictedClientTick = -1;
  private pendingResidual: ReconciledSelfPrediction['residual'] = null;
  private readonly displayOutput: ReconciledSelfPrediction = {
    kind: 'reconciled',
    position: { x: 0, y: 0, z: 0 },
    residual: null,
  };

  constructor(seed: number, riftCollisionToken = 0) {
    const deps = createClientPlayerMotionDeps(
      seed,
      () => this.wire?.reconMoveSpeedMult ?? 1,
      riftCollisionToken,
    );
    this.stepFn = (state, frame) => stepPlayerMotion(deps, state as Entity, frame.mi);
    this.wireGlue.onFrame = (frame) => this.predictFrame(frame);
    this.wireGlue.onNegotiated = () => this.reset();
  }

  get interpolationAlpha(): number {
    return this.wireGlue.interpolationAlpha;
  }

  connect(client: SelfPredictionWire, now = performance.now()): void {
    this.wireGlue.connect(client, now);
  }

  resume(): void {
    this.wireGlue.resume();
  }

  prepare(client: SelfPredictionWire, self: Entity, enabled: boolean): void {
    this.wire = client;
    this.self = self;
    this.enabled = enabled;
  }

  advance(
    client: SelfPredictionWire,
    frameDtSec: number,
    mi: MoveInput,
    facing: number | null,
    now: number,
    turnEngageEdge = false,
  ): boolean {
    return this.wireGlue.advance(client, frameDtSec, mi, facing, now, turnEngageEdge);
  }

  display(): ReconciledSelfPrediction | null {
    const wire = this.wire;
    const self = this.self;
    if (!wire || !self) return null;
    if (!this.canPredict()) {
      this.resetPrediction();
      if (!hasAuthoritativePose(wire)) this.lastEpoch = null;
      this.lastAckClientTick = wire.reconAckClientTick;
      return null;
    }
    if (this.lastEpoch === null) this.lastEpoch = wire.reconOverrideEpoch;
    if (wire.reconOverrideEpoch !== this.lastEpoch) {
      wire.netPipeline().noteReconcileOutcome('suspend');
      this.suspendAtCurrentWireState();
      return null;
    }
    if (wire.reconAckClientTick !== this.lastAckClientTick && wire.reconAckClientTick >= 0) {
      const acknowledgedPrediction = this.ring.find(wire.reconAckClientTick);
      const result = reconcile(
        this.ring,
        wire.reconAckClientTick,
        {
          x: wire.reconAuthoritativeX as number,
          y: wire.reconAuthoritativeY as number,
          z: wire.reconAuthoritativeZ as number,
          facing: wire.reconAuthoritativeFacing as number,
        },
        wire.reconOverrideEpoch,
        this.lastEpoch,
        this.stepFn,
      );
      wire.netPipeline().noteReconcileOutcome(result.mode);
      this.lastAckClientTick = wire.reconAckClientTick;
      if (result.mode === 'stale' || result.mode === 'suspend') {
        this.suspendAtCurrentWireState();
        return null;
      }
      if (result.mode === 'replayed') {
        this.pendingResidual = result.residual;
        this.predicted = this.ring.head?.pose
          ? copyMotionState(this.ring.head.pose)
          : acknowledgedPrediction
            ? copyMotionState(acknowledgedPrediction.pose)
            : motionState(self, wire);
      }
    }
    if (!this.predicted) return null;
    const output = this.displayOutput;
    const alpha = this.wireGlue.interpolationAlpha;
    output.position.x =
      this.predicted.prevPos.x + (this.predicted.pos.x - this.predicted.prevPos.x) * alpha;
    output.position.y =
      this.predicted.prevPos.y + (this.predicted.pos.y - this.predicted.prevPos.y) * alpha;
    output.position.z =
      this.predicted.prevPos.z + (this.predicted.pos.z - this.predicted.prevPos.z) * alpha;
    output.residual = this.pendingResidual;
    this.pendingResidual = null;
    return output;
  }

  private predictFrame(frame: InputTickFrame): void {
    if (!this.canPredict() || !this.wire || !this.self) return;
    if (frame.ct <= this.lastPredictedClientTick) this.resetPrediction();
    if (!this.predicted) this.predicted = motionState(this.self, this.wire);
    refreshMirroredMotionState(this.predicted, this.self);
    this.predicted = predictTick(this.ring, this.predicted, frame, this.stepFn);
    this.lastPredictedClientTick = frame.ct;
  }

  private canPredict(): boolean {
    return (
      this.enabled &&
      this.wire?.movementWireVersion === 2 &&
      !this.wire.reconOverrideActive &&
      hasAuthoritativePose(this.wire)
    );
  }

  private suspendAtCurrentWireState(): void {
    this.resetPrediction();
    if (!this.wire) return;
    this.lastEpoch = this.wire.reconOverrideEpoch;
    this.lastAckClientTick = this.wire.reconAckClientTick;
  }

  private resetPrediction(): void {
    this.ring.clear();
    this.predicted = null;
    this.pendingResidual = null;
    this.lastPredictedClientTick = -1;
  }

  reset(): void {
    this.resetPrediction();
    this.lastEpoch = null;
    this.lastAckClientTick = -1;
  }
}
