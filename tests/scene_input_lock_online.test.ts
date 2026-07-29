import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { sceneInputLockAfterEvent } from '../src/net/scene_input_lock_mirror';
import { emptyMoveInput, type SimEvent } from '../src/sim/types';

function bareOnline() {
  const sent: Record<string, unknown>[] = [];
  const client = Object.create(ClientWorld.prototype) as ClientWorld;
  Object.assign(client as object, {
    connected: true,
    spectating: null,
    playerId: 7,
    eventQueue: [],
    moveInput: {
      ...emptyMoveInput(),
      forward: true,
      jump: true,
    },
    mouselookFacing: 1.4,
    sceneInputLockedBeforeDrain: false,
    onSceneInputLockChanged: null,
    lastInputSentAt: 0,
    lastInputSig: '',
    inputSeq: 0,
    pendingInputSeqSentAt: new Map<number, number>(),
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
    },
  });
  return { client, sent };
}

function feed(client: ClientWorld, list: SimEvent[]): void {
  (
    client as unknown as {
      onMessage(raw: string): void;
    }
  ).onMessage(JSON.stringify({ t: 'events', list }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('online scene input lock receipt', () => {
  it('clears stale movement and facing before the independent sender can flush', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const { client, sent } = bareOnline();
    const changes = vi.fn();
    client.onSceneInputLockChanged = changes;

    feed(client, [
      {
        type: 'scene',
        pid: 7,
        op: { kind: 'inputLock', on: true },
      } as SimEvent,
    ]);

    expect(client.sceneInputLockPending()).toBe(true);
    expect(client.moveInput).toEqual(emptyMoveInput());
    expect(changes).toHaveBeenCalledWith(true);
    expect(client.flushInput(100)).toBe(true);
    expect(sent).toEqual([
      {
        t: 'input',
        seq: 1,
        mi: { f: 0, b: 0, tl: 0, tr: 0, sl: 0, sr: 0, j: 0 },
      },
    ]);
  });

  it('preserves an explicit input-lock on-to-off batch', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const { client } = bareOnline();
    const changes = vi.fn();
    client.onSceneInputLockChanged = changes;

    feed(client, [
      { type: 'scene', pid: 7, op: { kind: 'inputLock', on: true } } as SimEvent,
      { type: 'scene', pid: 7, op: { kind: 'inputLock', on: false } } as SimEvent,
    ]);

    expect(changes.mock.calls).toEqual([[true], [false]]);
    expect(client.sceneInputLockPending()).toBe(false);
    expect(client.moveInput).toEqual(emptyMoveInput());
    expect(client.drainEvents()).toHaveLength(2);
  });

  it('also releases a pending lock when the scene ends', () => {
    const { client } = bareOnline();
    const changes = vi.fn();
    client.onSceneInputLockChanged = changes;

    feed(client, [
      { type: 'scene', pid: 7, op: { kind: 'inputLock', on: true } } as SimEvent,
      { type: 'scene', pid: 7, op: { kind: 'end' } } as SimEvent,
    ]);

    expect(changes.mock.calls).toEqual([[true], [false]]);
    expect(client.sceneInputLockPending()).toBe(false);
  });

  it('ignores scene locks scoped to another player', () => {
    const { client } = bareOnline();
    const changes = vi.fn();
    client.onSceneInputLockChanged = changes;

    feed(client, [
      {
        type: 'scene',
        pid: 11,
        op: { kind: 'inputLock', on: true },
      } as SimEvent,
    ]);

    expect(client.sceneInputLockPending()).toBe(false);
    expect(client.moveInput.forward).toBe(true);
    expect(changes).not.toHaveBeenCalled();
    expect(client.drainEvents()).toHaveLength(1);
  });

  it('converges reconnect scene-sync state through the same pure mirror', () => {
    const locked = sceneInputLockAfterEvent(
      false,
      {
        type: 'sceneSync',
        state: {
          sceneId: 'scn_lb_q0_voyage',
          remainingSeconds: 3,
          inputLocked: true,
          letterbox: true,
          musicSilenced: false,
        },
      } as SimEvent,
      7,
    );

    expect(locked).toBe(true);
    expect(
      sceneInputLockAfterEvent(
        locked,
        {
          type: 'sceneSync',
          state: null,
        } as SimEvent,
        7,
      ),
    ).toBe(false);
  });
});
