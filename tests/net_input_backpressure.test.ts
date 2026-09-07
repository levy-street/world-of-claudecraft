import { describe, expect, it } from 'vitest';
import { MovementInputTimeline } from '../server/movement_input_timeline_v2';
import { type MovementWireClient, MovementWireGlue } from '../src/game/movement_wire_glue';
import { MOVEMENT_FRAME_V2_PENDING_CAP } from '../src/net/movement_frame_v2_wire';
import { ClientWorld } from '../src/net/online';
import { INPUT_SEND_BACKPRESSURE_LIMIT_BYTES } from '../src/net/send_backpressure';
import { parseMoveInputFrame } from '../src/sim/move_input';
import { emptyMoveInput } from '../src/sim/types';

function makeClient(bufferedAmount: number) {
  const sent: string[] = [];
  const client = Object.create(ClientWorld.prototype) as ClientWorld;
  const ws = {
    readyState: 1,
    bufferedAmount,
    send: (payload: string) => {
      sent.push(payload);
    },
  };
  Object.assign(client as unknown as Record<string, unknown>, {
    moveInput: {
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    },
    mouselookFacing: null,
    connected: true,
    spectating: null,
    ws,
    inputSeq: 0,
    pendingInputSeqSentAt: new Map<number, number>(),
  });
  return { client, ws, sent };
}

function sentInput(sent: string[], index = 0) {
  return JSON.parse(sent[index]) as {
    t: 'input';
    seq: number;
    ct?: number;
    mi: { f: number; b: number; tl: number; tr: number; j: number };
  };
}

describe('ClientWorld input send backpressure gate', () => {
  const previousWebSocket = globalThis.WebSocket;
  const withWebSocketStub = <T>(fn: () => T): T => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: { OPEN: 1 } });
    try {
      return fn();
    } finally {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        value: previousWebSocket,
      });
    }
  };

  it('sends normally while the local socket is draining', () => {
    const { client, sent } = makeClient(0);
    withWebSocketStub(() => {
      expect(client.sendMovementFrame({ ct: 0, mi: client.moveInput, facing: null }, 1_000)).toBe(
        true,
      );
    });
    expect(sent).toHaveLength(1);
  });

  it('keeps the frame off the wire once the local unflushed buffer is backed up past the limit', () => {
    const { client, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      // Accepted into the outbox, but nothing is written behind a backlog that
      // is not draining.
      expect(client.sendMovementFrame({ ct: 0, mi: client.moveInput, facing: null }, 1_000)).toBe(
        true,
      );
    });
    expect(sent).toHaveLength(0);
  });

  it('resumes sending as soon as the buffer drains back under the limit', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      expect(client.sendMovementFrame({ ct: 0, mi: client.moveInput, facing: null }, 1_000)).toBe(
        true,
      );
      expect(sent).toHaveLength(0);
      ws.bufferedAmount = 0;
      expect(client.sendMovementFrame({ ct: 1, mi: client.moveInput, facing: null }, 2_000)).toBe(
        true,
      );
    });
    expect(sent.map((payload) => sentInput([payload]).ct)).toEqual([0, 1]);
  });

  it('consumes a queued frame only after WebSocket.send accepts it', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      client.sendMovementFrame(
        { ct: 0, mi: { ...client.moveInput, jump: true }, facing: null },
        1_000,
      );
      ws.bufferedAmount = 0;
      ws.send = () => {
        throw new Error('socket closed during send');
      };
      expect(() =>
        client.sendMovementFrame({ ct: 1, mi: client.moveInput, facing: null }, 2_000),
      ).toThrow('socket closed during send');

      ws.send = (payload: string) => sent.push(payload);
      expect(client.sendMovementFrame({ ct: 2, mi: client.moveInput, facing: null }, 3_000)).toBe(
        true,
      );
    });

    expect(sent.map((payload) => sentInput([payload]).ct)).toEqual([0, 2]);
    expect(sentInput(sent).mi.j).toBe(1);
  });

  it('books a backpressure shed only once the outbox has to drop a queued frame', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      // Filling the outbox to its cap holds every frame without losing one, so
      // nothing is shed yet.
      for (let ct = 0; ct < MOVEMENT_FRAME_V2_PENDING_CAP; ct++) {
        client.sendMovementFrame({ ct, mi: client.moveInput, facing: null }, 1_000 + ct);
      }
      expect(client.netPipeline().summary().inputBackpressure).toEqual({
        sheds: 0,
        peakBufferedBytes: 0,
      });

      // The frame past the cap evicts the oldest: that eviction is the shed.
      client.sendMovementFrame(
        { ct: MOVEMENT_FRAME_V2_PENDING_CAP, mi: client.moveInput, facing: null },
        2_000,
      );
    });

    expect(sent).toHaveLength(0);
    expect(client.netPipeline().summary().inputBackpressure).toEqual({
      sheds: 1,
      peakBufferedBytes: INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1,
    });
    expect(ws.bufferedAmount).toBe(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
  });

  it('loses the evicted frame outright and replays the rest in client tick order', () => {
    // What congestion actually costs on this path, stated as bytes on the wire.
    // The outbox holds frames rather than shedding them, so nothing is lost
    // until the cap evicts the OLDEST: a one-shot edge (a jump) that was in
    // that frame is gone, and every retained frame still arrives in ct order.
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      client.sendMovementFrame(
        { ct: 0, mi: { ...client.moveInput, jump: true }, facing: null },
        1_000,
      );
      for (let ct = 1; ct <= MOVEMENT_FRAME_V2_PENDING_CAP; ct++) {
        client.sendMovementFrame({ ct, mi: client.moveInput, facing: null }, 1_000 + ct);
      }
      expect(sent).toHaveLength(0);

      ws.bufferedAmount = 0;
      client.sendMovementFrame(
        { ct: MOVEMENT_FRAME_V2_PENDING_CAP + 1, mi: client.moveInput, facing: null },
        2_000,
      );
    });

    const frames = sent.map((payload) => sentInput([payload]));
    // Client tick 0 carried the jump and was the one evicted; 1..cap+1 land in
    // order behind it, and no frame on the wire carries the lost edge.
    expect(frames.map((frame) => frame.ct)).toEqual(
      Array.from({ length: MOVEMENT_FRAME_V2_PENDING_CAP + 1 }, (_, index) => index + 1),
    );
    expect(frames.some((frame) => frame.mi.j === 1)).toBe(false);
    expect(frames.map((frame) => frame.seq)).toEqual(
      Array.from({ length: MOVEMENT_FRAME_V2_PENDING_CAP + 1 }, (_, index) => index + 1),
    );
  });

  it('re-emits the held turn engage edge on the first frame that reaches the wire', () => {
    // The engage edge is the one frame the server may integrate a manual turn
    // from, so it must survive a frame that never reached the wire: the glue
    // holds it until a frame carrying it is actually accepted.
    const sentFrames: { ct: number; turnLeft: boolean; turnRight: boolean }[] = [];
    let accepting = false;
    const wireClient: MovementWireClient = {
      onMovementWireNegotiated: null,
      onMovementWireNeutral: null,
      movementWireIsOpen: () => true,
      sendMovementFrame: (frame) => {
        if (!accepting) return false;
        sentFrames.push({
          ct: frame.ct,
          turnLeft: frame.mi.turnLeft,
          turnRight: frame.mi.turnRight,
        });
        return true;
      },
    };
    const glue = new MovementWireGlue();
    glue.connect(wireClient, 0);
    const engaging = { ...emptyMoveInput(), forward: true, turnLeft: true };
    // What main.ts streams once the local heading owns the channel: the raw
    // turn flags are zeroed, so a turnLeft on the wire can ONLY be the edge.
    const steady = { ...emptyMoveInput(), forward: true };

    glue.advance(wireClient, 0.05, engaging, null, 50, true);
    expect(sentFrames).toEqual([]);

    accepting = true;
    glue.advance(wireClient, 0.05, steady, null, 100);
    expect(sentFrames.length).toBeGreaterThanOrEqual(1);
    expect(sentFrames[0]).toMatchObject({ turnLeft: true, turnRight: false });
    // Exactly once: every later frame carries the zeroed steady flags.
    expect(sentFrames.slice(1).every((frame) => !frame.turnLeft && !frame.turnRight)).toBe(true);

    const afterResume = sentFrames.length;
    glue.advance(wireClient, 0.05, steady, null, 150);
    expect(sentFrames.length).toBeGreaterThan(afterResume);
    expect(sentFrames.slice(afterResume).every((frame) => !frame.turnLeft)).toBe(true);
  });

  it('does not gate cmd frames on backpressure: only the idempotent-latest input path is held', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      client.sendMovementFrame({ ct: 0, mi: client.moveInput, facing: null }, 1_000);
      expect(sent).toHaveLength(0);
      // rawCmd's own gate is only connected + readyState; it never reads
      // ws.bufferedAmount, so a saturated socket still lets a command through.
      (client as unknown as { rawCmd: (payload: Record<string, unknown>) => void }).rawCmd({
        cmd: 'chat',
      });
    });
    expect(ws.bufferedAmount).toBe(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toEqual({ t: 'cmd', cmd: 'chat' });
  });

  it('queues a jump edge and flushes it in client tick order on recovery', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      expect(
        client.sendMovementFrame(
          { ct: 0, mi: { ...client.moveInput, jump: true }, facing: null },
          1_000,
        ),
      ).toBe(true);
      ws.bufferedAmount = 0;
      expect(
        client.sendMovementFrame(
          { ct: 1, mi: { ...client.moveInput, jump: false }, facing: null },
          1_050,
        ),
      ).toBe(true);
    });

    expect(sent.map((payload) => sentInput([payload]).ct)).toEqual([0, 1]);
    expect(sentInput(sent).mi.j).toBe(1);
    expect(sentInput(sent, 1).mi.j).toBe(0);
  });

  it('drops the oldest queued frame and lets the server timeline resync', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    const timeline = new MovementInputTimeline();
    ws.send = (payload: string) => {
      sent.push(payload);
      const raw = JSON.parse(payload) as { ct: number };
      const parsed = parseMoveInputFrame(raw);
      timeline.enqueue({ ct: raw.ct, mi: parsed.moveInput, facing: parsed.facing });
      if (sent.length === 6) ws.bufferedAmount = INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1;
    };

    withWebSocketStub(() => {
      for (let ct = 0; ct <= 8; ct++) {
        expect(client.sendMovementFrame({ ct, mi: client.moveInput, facing: null }, ct)).toBe(true);
      }
      ws.bufferedAmount = 0;
      expect(client.sendMovementFrame({ ct: 9, mi: client.moveInput, facing: null }, 9)).toBe(true);
    });

    expect(sent.map((payload) => sentInput([payload]).ct)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(timeline.consumeNext()).toBeNull();
    expect(timeline.consumeNext()).toBeNull();
    expect(timeline.consumeNext()).toBeNull();
    expect(timeline.resyncs).toBe(1);
    expect(timeline.consumeNext()?.ct).toBe(1);
  });

  it('uses the outbox timer only to flush queued frames, never to mint one of its own', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      expect(client.sendMovementFrame({ ct: 0, mi: client.moveInput, facing: null }, 1_000)).toBe(
        true,
      );
      ws.bufferedAmount = 0;
      (client as unknown as { sendMovementTimerTick(now?: number): void }).sendMovementTimerTick(
        1_050,
      );
    });

    expect(sent).toHaveLength(1);
    expect(sentInput(sent)).toMatchObject({ t: 'input', ct: 0 });
  });
});
