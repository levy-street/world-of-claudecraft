import type { MoveInput } from '../sim/types';
import { isInputSendBackpressured } from './send_backpressure';

export interface MovementFrameV2 {
  ct: number;
  mi: MoveInput;
  facing: number | null;
}

export interface MovementFrameSocket {
  bufferedAmount: number;
  send(payload: string): void;
}

// Six frames align with the server timeline, with two more for transport headroom.
export const MOVEMENT_FRAME_V2_PENDING_CAP = 8;

export interface MovementFrameV2SendResult {
  accepted: boolean;
  lastSeq: number;
}

export class MovementFrameV2Outbox {
  droppedOldest = 0;

  private readonly pending: MovementFrameV2[] = [];

  reset(): void {
    this.pending.length = 0;
    this.droppedOldest = 0;
  }

  send(
    socket: MovementFrameSocket,
    canSend: boolean,
    frame: MovementFrameV2,
    lastSeq: number,
    bypassBackpressure = false,
  ): MovementFrameV2SendResult {
    if (!canSend) return { accepted: false, lastSeq };
    if (bypassBackpressure) {
      const accepted = sendMovementFrameV2(socket, true, frame, lastSeq + 1, true);
      return { accepted, lastSeq: accepted ? lastSeq + 1 : lastSeq };
    }
    if (isInputSendBackpressured(socket.bufferedAmount)) {
      this.enqueue(frame);
      return { accepted: true, lastSeq };
    }
    lastSeq = this.flush(socket, true, lastSeq).lastSeq;
    if (isInputSendBackpressured(socket.bufferedAmount)) {
      this.enqueue(frame);
      return { accepted: true, lastSeq };
    }
    const accepted = sendMovementFrameV2(socket, true, frame, lastSeq + 1);
    return { accepted, lastSeq: accepted ? lastSeq + 1 : lastSeq };
  }

  flush(socket: MovementFrameSocket, canSend: boolean, lastSeq: number): MovementFrameV2SendResult {
    if (!canSend) return { accepted: false, lastSeq };
    while (this.pending.length > 0 && !isInputSendBackpressured(socket.bufferedAmount)) {
      if (!sendMovementFrameV2(socket, true, this.pending[0], lastSeq + 1)) break;
      lastSeq++;
      this.pending.shift();
    }
    return { accepted: true, lastSeq };
  }

  private enqueue(frame: MovementFrameV2): void {
    this.pending.push({ ...frame, mi: { ...frame.mi } });
    if (this.pending.length > MOVEMENT_FRAME_V2_PENDING_CAP) {
      this.pending.shift();
      this.droppedOldest++;
    }
  }
}

export function trackPendingInputSequence(
  pending: Map<number, number>,
  seq: number,
  now: number,
): void {
  pending.set(seq, now);
  if (pending.size <= 120) return;
  const stale = seq - 120;
  for (const pendingSeq of pending.keys()) {
    if (pendingSeq <= stale) pending.delete(pendingSeq);
  }
}

export function trackPendingInputSequenceRange(
  pending: Map<number, number>,
  firstSeq: number,
  lastSeq: number,
  now: number,
): void {
  for (let seq = firstSeq; seq <= lastSeq; seq++) trackPendingInputSequence(pending, seq, now);
}

export function sendMovementFrameV2(
  socket: MovementFrameSocket,
  canSend: boolean,
  frame: MovementFrameV2,
  seq: number,
  bypassBackpressure = false,
): boolean {
  if (!canSend || (!bypassBackpressure && isInputSendBackpressured(socket.bufferedAmount))) {
    return false;
  }
  const { ct, mi, facing } = frame;
  const msg: Record<string, unknown> = {
    t: 'input',
    seq,
    ct,
    mi: {
      f: mi.forward ? 1 : 0,
      b: mi.back ? 1 : 0,
      tl: mi.turnLeft ? 1 : 0,
      tr: mi.turnRight ? 1 : 0,
      sl: mi.strafeLeft ? 1 : 0,
      sr: mi.strafeRight ? 1 : 0,
      j: mi.jump ? 1 : 0,
      dv: mi.dive ? 1 : 0,
      sf: mi.surface ? 1 : 0,
    },
  };
  if (mi.swimSteer !== undefined && mi.swimSteer !== 1) {
    (msg.mi as Record<string, number>).ss = mi.swimSteer;
  }
  if (facing !== null) msg.facing = facing;
  socket.send(JSON.stringify(msg));
  return true;
}
