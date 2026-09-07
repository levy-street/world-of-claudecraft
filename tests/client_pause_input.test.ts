import { describe, expect, it } from 'vitest';
import { MovementWireGlue } from '../src/game/movement_wire_glue';
import { ClientWorld } from '../src/net/online';
import { INPUT_SEND_BACKPRESSURE_LIMIT_BYTES } from '../src/net/send_backpressure';

describe('ClientWorld neutralizeInputForClientPause', () => {
  it('overwrites every movement bit and sends an unconditional neutral packet', () => {
    const sent: string[] = [];
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    Object.assign(client as unknown as Record<string, unknown>, {
      moveInput: {
        forward: true,
        back: true,
        turnLeft: true,
        turnRight: true,
        strafeLeft: true,
        strafeRight: true,
        jump: true,
      },
      mouselookFacing: 2.4,
      connected: true,
      spectating: null,
      ws: {
        readyState: 1,
        bufferedAmount: INPUT_SEND_BACKPRESSURE_LIMIT_BYTES + 1,
        send: (payload: string) => sent.push(payload),
      },
      inputSeq: 4,
      pendingInputSeqSentAt: new Map<number, number>(),
    });
    // The neutral frame is minted by the wire glue the game loop installs, so
    // the pause path exercises the real onMovementWireNeutral seam.
    new MovementWireGlue().connect(client, 0);
    const previousWebSocket = globalThis.WebSocket;
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: { OPEN: 1 },
    });
    try {
      expect(client.neutralizeInputForClientPause(1_000)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        value: previousWebSocket,
      });
    }

    expect(client.moveInput).toEqual({
      forward: false,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
      dive: false,
      surface: false,
    });
    expect((client as unknown as { mouselookFacing: number | null }).mouselookFacing).toBeNull();
    // Saturated browser buffer and all: the pause frame bypasses backpressure
    // rather than queueing in the outbox behind a backlog that is not moving.
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toEqual({
      t: 'input',
      seq: 5,
      ct: 0,
      mi: { f: 0, b: 0, tl: 0, tr: 0, sl: 0, sr: 0, j: 0, dv: 0, sf: 0 },
    });
  });
});
