import { describe, expect, it } from 'vitest';
import { MovementInputTimeline } from '../server/movement_input_timeline_v2';
import { ClientWorld } from '../src/net/online';
import { INPUT_SEND_BACKPRESSURE_LIMIT_BYTES } from '../src/net/send_backpressure';
import { parseMoveInputFrame } from '../src/sim/move_input';

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
    lastInputSentAt: 0,
    lastInputSig: '',
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
      expect(client.flushInput(1_000)).toBe(true);
    });
    expect(sent).toHaveLength(1);
  });

  it('sheds the send once the local unflushed buffer is backed up past the limit', () => {
    const { client, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      expect(client.flushInput(1_000)).toBe(false);
    });
    expect(sent).toHaveLength(0);
    expect(client.netPipeline().summary().inputBackpressure).toEqual({
      sheds: 1,
      peakBufferedBytes: INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1,
    });
  });

  it('preserves periodic input shedding above the client-local threshold', () => {
    const { client, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      expect((client as unknown as { sendInput(now?: number): boolean }).sendInput(1_000)).toBe(
        false,
      );
    });
    expect(sent).toHaveLength(0);
  });

  it('resumes sending as soon as the buffer drains back under the limit', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      expect(client.flushInput(1_000)).toBe(false);
      ws.bufferedAmount = 0;
      expect(client.flushInput(2_000)).toBe(true);
    });
    expect(sent).toHaveLength(1);
  });

  it('delivers a jump press exactly once after press and release both occur during congestion', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      client.moveInput.jump = true;
      expect(client.flushInput(1_000)).toBe(false);
      client.moveInput.jump = false;
      expect(client.flushInput(1_100)).toBe(false);

      ws.bufferedAmount = 0;
      expect(client.flushInput(2_000)).toBe(true);
      expect(client.flushInput(2_100)).toBe(false);
    });

    expect(sent).toHaveLength(1);
    expect(sentInput(sent).mi.j).toBe(1);
  });

  it.each([
    ['left', 'turnLeft', 'tl'],
    ['right', 'turnRight', 'tr'],
  ] as const)(
    'delivers the manual-turn %s engagement edge exactly once after it is suppressed during congestion',
    (_direction, inputKey, wireKey) => {
      const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
      withWebSocketStub(() => {
        client.moveInput[inputKey] = true;
        expect(client.flushInput(1_000)).toBe(false);
        // keyboard_turn_facing suppresses the raw turn flag after the engage
        // frame; the edge still has to survive until the socket drains.
        client.moveInput[inputKey] = false;
        expect(client.flushInput(1_100)).toBe(false);

        ws.bufferedAmount = 0;
        expect(client.flushInput(2_000)).toBe(true);
        expect(client.flushInput(2_100)).toBe(false);
      });

      expect(sent).toHaveLength(1);
      expect(sentInput(sent).mi[wireKey]).toBe(1);
    },
  );

  it('recovers only the latest persistent state while retaining transient intent', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      client.moveInput.jump = true;
      expect(client.flushInput(1_000)).toBe(false);
      client.moveInput.jump = false;
      client.moveInput.forward = false;
      client.moveInput.back = true;
      expect(client.flushInput(1_100)).toBe(false);

      ws.bufferedAmount = 0;
      expect(client.flushInput(2_000)).toBe(true);
    });

    expect(sentInput(sent).mi).toMatchObject({ f: 0, b: 1, j: 1 });
  });

  it('consumes retained transient intent only after WebSocket.send accepts a real frame', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      client.moveInput.jump = true;
      expect(client.flushInput(1_000)).toBe(false);
      client.moveInput.jump = false;
      ws.bufferedAmount = 0;
      ws.send = () => {
        throw new Error('socket closed during send');
      };
      expect(() => client.flushInput(2_000)).toThrow('socket closed during send');

      ws.send = (payload: string) => sent.push(payload);
      expect(client.flushInput(3_000)).toBe(true);
    });

    expect(sent).toHaveLength(1);
    expect(sentInput(sent).mi.j).toBe(1);
  });

  it('does not gate cmd frames on backpressure: only the idempotent-latest input path is shed', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    withWebSocketStub(() => {
      expect(client.flushInput(1_000)).toBe(false);
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

  it('queues a v2 jump edge and flushes it in client tick order on recovery', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    client.movementWireVersion = 2;
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

  it('drops the oldest v2 queue frame and lets the server timeline resync', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    const timeline = new MovementInputTimeline();
    client.movementWireVersion = 2;
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

  it('uses the v2 timer only to flush queued frames, never to send legacy input', () => {
    const { client, ws, sent } = makeClient(INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1);
    client.movementWireVersion = 2;
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
