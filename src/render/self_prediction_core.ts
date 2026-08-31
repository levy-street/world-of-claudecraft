import type { Entity, MoveInput } from '../sim/types';

export const SELF_PREDICTION_RING_CAPACITY = 128;

export interface PredictionPose {
  x: number;
  y: number;
  z: number;
  facing: number;
}

export type PredictionResidual = Pick<PredictionPose, 'x' | 'y' | 'z'>;

export interface PredictionFrame {
  ct: number;
  mi: MoveInput;
  facing: number | null;
}

export type MotionState = Pick<
  Entity,
  | 'id'
  | 'pos'
  | 'prevPos'
  | 'facing'
  | 'vx'
  | 'vy'
  | 'vz'
  | 'onGround'
  | 'jumping'
  | 'fallStartY'
  | 'swimStroke'
  | 'swimDiving'
  | 'auras'
  | 'ghost'
  | 'sitting'
  | 'castingAbility'
  | 'maxHp'
  | 'mountKey'
  | 'mountCastRemaining'
  | 'mountCastKey'
>;

export interface PredictionEntry {
  ct: number;
  mi: MoveInput;
  facing: number | null;
  pose: MotionState;
}

export type PredictionStep = (state: MotionState, frame: PredictionFrame) => void;

export type ReconciliationResult =
  | { mode: 'match' }
  | { mode: 'replayed'; residual: PredictionResidual }
  | { mode: 'ignore' }
  | { mode: 'stale' }
  | { mode: 'suspend' };

export function copyMotionState(state: MotionState): MotionState {
  return {
    ...state,
    pos: { ...state.pos },
    prevPos: { ...state.prevPos },
    auras: state.auras.slice(),
  };
}

function entryFrame(entry: PredictionEntry): PredictionFrame {
  return { ct: entry.ct, mi: entry.mi, facing: entry.facing };
}

function stepFrom(state: MotionState, frame: PredictionFrame, stepFn: PredictionStep): MotionState {
  const next = copyMotionState(state);
  next.prevPos.x = next.pos.x;
  next.prevPos.y = next.pos.y;
  next.prevPos.z = next.pos.z;
  if (frame.facing !== null) next.facing = frame.facing;
  stepFn(next, frame);
  return next;
}

function applyAuthoritativePose(state: MotionState, authoritative: PredictionPose): void {
  state.pos.x = authoritative.x;
  state.pos.y = authoritative.y;
  state.pos.z = authoritative.z;
  state.prevPos.x = authoritative.x;
  state.prevPos.y = authoritative.y;
  state.prevPos.z = authoritative.z;
  state.facing = authoritative.facing;
}

export class PredictionRing {
  private readonly entries: PredictionEntry[] = [];
  private anchorCt: number | null = null;

  constructor(readonly capacity = SELF_PREDICTION_RING_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('prediction ring capacity must be a positive integer');
    }
  }

  get size(): number {
    return this.entries.length;
  }

  get oldestClientTick(): number | null {
    return this.entries[0]?.ct ?? null;
  }

  get anchorClientTick(): number | null {
    return this.anchorCt;
  }

  get head(): PredictionEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  clear(): void {
    this.entries.length = 0;
    this.anchorCt = null;
  }

  push(entry: PredictionEntry): void {
    if (this.anchorCt === null) this.anchorCt = entry.ct;
    this.entries.push({
      ct: entry.ct,
      mi: { ...entry.mi },
      facing: entry.facing,
      pose: copyMotionState(entry.pose),
    });
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  find(clientTick: number): PredictionEntry | null {
    return this.entries.find((entry) => entry.ct === clientTick) ?? null;
  }

  entriesAfter(clientTick: number): PredictionEntry[] {
    return this.entries.filter((entry) => entry.ct > clientTick);
  }

  dropThrough(clientTick: number): void {
    let count = 0;
    while (count < this.entries.length && this.entries[count].ct <= clientTick) count++;
    if (count > 0) this.entries.splice(0, count);
  }
}

export function predictTick(
  ring: PredictionRing,
  state: MotionState,
  frame: PredictionFrame,
  stepFn: PredictionStep,
): MotionState {
  const predicted = stepFrom(state, frame, stepFn);
  ring.push({ ct: frame.ct, mi: frame.mi, facing: frame.facing, pose: predicted });
  return predicted;
}

export function reconcile(
  ring: PredictionRing,
  ackCt: number,
  authoritative: PredictionPose,
  epoch: number,
  lastEpoch: number | null,
  stepFn: PredictionStep,
): ReconciliationResult {
  if (lastEpoch !== null && epoch !== lastEpoch) return { mode: 'suspend' };

  const oldest = ring.oldestClientTick;
  if (oldest === null) return { mode: 'stale' };
  if (ackCt < oldest) {
    return ackCt < (ring.anchorClientTick ?? oldest) ? { mode: 'ignore' } : { mode: 'stale' };
  }
  const acknowledged = ring.find(ackCt);
  if (!acknowledged) return { mode: 'stale' };

  if (
    acknowledged.pose.pos.x === authoritative.x &&
    acknowledged.pose.pos.y === authoritative.y &&
    acknowledged.pose.pos.z === authoritative.z
  ) {
    ring.dropThrough(ackCt);
    return { mode: 'match' };
  }

  const oldHead = ring.head ? copyMotionState(ring.head.pose) : null;
  const replayed = ring.entriesAfter(ackCt);
  applyAuthoritativePose(acknowledged.pose, authoritative);
  let state = acknowledged.pose;
  for (const entry of replayed) {
    state = stepFrom(state, entryFrame(entry), stepFn);
    entry.pose = state;
  }
  const newHead = replayed[replayed.length - 1]?.pose ?? acknowledged.pose;
  ring.dropThrough(ackCt);
  return {
    mode: 'replayed',
    residual: {
      x: (oldHead?.pos.x ?? authoritative.x) - newHead.pos.x,
      y: (oldHead?.pos.y ?? authoritative.y) - newHead.pos.y,
      z: (oldHead?.pos.z ?? authoritative.z) - newHead.pos.z,
    },
  };
}
