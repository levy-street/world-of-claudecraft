import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

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
        send: (payload: string) => sent.push(payload),
      },
      lastInputSentAt: 999,
      lastInputSig: '0,0,0,0,0,0,0,',
      inputSeq: 4,
      pendingInputSeqSentAt: new Map<number, number>(),
    });
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
    });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toEqual({
      t: 'input',
      seq: 5,
      mi: { f: 0, b: 0, tl: 0, tr: 0, sl: 0, sr: 0, j: 0 },
    });
  });
});
