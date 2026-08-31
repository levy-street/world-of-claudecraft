import { describe, expect, it } from 'vitest';
import { dungeonEntrySnapshotFacing } from '../src/net/dungeon_entry_facing';
import type { ClientWorld } from '../src/net/online';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { emptyMoveInput } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

function selfWire(
  id: number,
  x: number,
  z: number,
  facing: number,
  entrySeq?: number,
): Record<string, unknown> {
  return {
    id,
    k: 'player',
    tid: 'warrior',
    nm: 'Dungeon Tester',
    lv: 1,
    x,
    y: 0,
    z,
    f: facing,
    hp: 100,
    mhp: 100,
    ...(entrySeq === undefined ? {} : { de: entrySeq }),
  };
}

function applySelf(client: ClientWorld, wire: Record<string, unknown>): void {
  (client as unknown as { applySnapshot(snapshot: unknown): void }).applySnapshot({
    self: wire,
    ents: [],
    keep: [],
  });
}

describe('online dungeon entry facing fence', () => {
  it('replaces queued Mouse Camera facing synchronously during snapshot decode', () => {
    const id = 42;
    const raid = DUNGEONS.ignivar_forge_approach;
    const origin = instanceOrigin(raid.index, 0);
    const sent: string[] = [];
    const client = bareClient(id, {
      mouselookFacing: Math.PI,
      moveInput: { ...emptyMoveInput(), forward: true, turnLeft: true, turnRight: true },
      ws: {
        readyState: WebSocket.OPEN,
        bufferedAmount: Number.MAX_SAFE_INTEGER,
        send: (raw: string) => sent.push(raw),
      },
    });
    applySelf(client, selfWire(id, raid.doorPos.x, raid.doorPos.z, Math.PI, 0));

    applySelf(client, selfWire(id, origin.x + raid.entry.x, origin.z + raid.entry.z, 0, 1));

    expect((client as unknown as { mouselookFacing: number | null }).mouselookFacing).toBe(0);
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      facing: 0,
      de: 1,
      mi: { f: 1, tl: 0, tr: 0 },
    });
    const internals = client as unknown as {
      ws: { bufferedAmount: number };
      sendInput(now?: number): boolean;
    };
    internals.ws.bufferedAmount = 0;
    expect(internals.sendInput(10_000)).toBe(true);
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({ de: 1, mi: { tl: 0, tr: 0 } });
    expect(client.consumeDungeonEntryFacing()).toBe(0);
    expect(client.consumeDungeonEntryFacing()).toBeNull();

    (client as unknown as { mouselookFacing: number | null }).mouselookFacing = 1.25;
    const sentAfterAck = sent.length;
    applySelf(client, selfWire(id, origin.x + raid.entry.x + 1, origin.z + raid.entry.z, 1.25));
    expect(sent).toHaveLength(sentAfterAck);
    expect((client as unknown as { mouselookFacing: number | null }).mouselookFacing).toBe(1.25);
    expect(client.consumeDungeonEntryFacing()).toBeNull();

    applySelf(client, selfWire(id, origin.x + raid.entry.x + 2, origin.z + raid.entry.z, 1.25, 1));
    expect(sent).toHaveLength(sentAfterAck);
    expect((client as unknown as { mouselookFacing: number | null }).mouselookFacing).toBe(1.25);

    const wire = client as unknown as {
      reconnectAttempts: number;
      onMessage(raw: string): void;
    };
    wire.reconnectAttempts = 1;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: id, seed: 20061 }));
    const sentAfterHello = sent.length;
    applySelf(client, selfWire(id, origin.x + raid.entry.x + 3, origin.z + raid.entry.z, 0, 1));
    expect(sent).toHaveLength(sentAfterHello + 1);
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({ facing: 0, de: 1 });
    expect(client.consumeDungeonEntryFacing()).toBe(0);

    (client as unknown as { mouselookFacing: number | null }).mouselookFacing = 1.25;
    wire.reconnectAttempts = 1;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: id, seed: 20061 }));
    const sentBeforeOutsideResume = sent.length;
    applySelf(client, selfWire(id, raid.doorPos.x, raid.doorPos.z, 1.25, 1));
    expect(sent).toHaveLength(sentBeforeOutsideResume);
    expect((client as unknown as { mouselookFacing: number | null }).mouselookFacing).toBe(1.25);
    expect(client.consumeDungeonEntryFacing()).toBeNull();
  });

  it('acknowledges a pending nonzero entry on a newly constructed client', () => {
    const id = 43;
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    const sent: string[] = [];
    const client = bareClient(id, {
      mouselookFacing: Math.PI,
      ws: {
        readyState: WebSocket.OPEN,
        bufferedAmount: Number.MAX_SAFE_INTEGER,
        send: (raw: string) => sent.push(raw),
      },
    });

    applySelf(client, selfWire(id, origin.x + crypt.entry.x, origin.z + crypt.entry.z, 0, 4));

    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({ facing: 0, de: 4 });
    expect(client.consumeDungeonEntryFacing()).toBe(0);
  });

  it('uses the spatial fallback when an older server omits entry tokens', () => {
    const id = 44;
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    const sent: string[] = [];
    const client = bareClient(id, {
      mouselookFacing: Math.PI,
      moveInput: { ...emptyMoveInput(), forward: true },
      ws: {
        readyState: WebSocket.OPEN,
        bufferedAmount: 0,
        send: (raw: string) => sent.push(raw),
      },
    });
    applySelf(client, selfWire(id, crypt.doorPos.x, crypt.doorPos.z, Math.PI));
    const sentAtDoor = sent.length;

    applySelf(client, selfWire(id, origin.x + crypt.entry.x, origin.z + crypt.entry.z, 0));

    expect(sent).toHaveLength(sentAtDoor + 1);
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({ facing: 0, mi: { f: 1 } });
    expect(JSON.parse(sent.at(-1) ?? '{}')).not.toHaveProperty('de');
    expect(client.consumeDungeonEntryFacing()).toBe(0);
  });

  it('cancels queued entry presentation after an exit or reconnect reset', () => {
    const id = 45;
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    const client = bareClient(id, {
      mouselookFacing: Math.PI,
      ws: {
        readyState: WebSocket.OPEN,
        bufferedAmount: 0,
        send: () => {},
      },
    });
    applySelf(client, selfWire(id, crypt.doorPos.x, crypt.doorPos.z, Math.PI, 0));
    applySelf(client, selfWire(id, origin.x + crypt.entry.x, origin.z + crypt.entry.z, 0, 1));
    applySelf(client, selfWire(id, crypt.doorPos.x, crypt.doorPos.z, 1.25));
    expect(client.consumeDungeonEntryFacing()).toBeNull();

    (client as unknown as { pendingDungeonEntryFacing: number | null }).pendingDungeonEntryFacing =
      0;
    const wire = client as unknown as {
      reconnectAttempts: number;
      onMessage(raw: string): void;
    };
    wire.reconnectAttempts = 1;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: id, seed: 20061 }));
    expect(client.consumeDungeonEntryFacing()).toBeNull();
  });

  it('acknowledges every new generation and ignores absent or malformed tokens', () => {
    const crypt = DUNGEONS.hollow_crypt;
    const origin = instanceOrigin(crypt.index, 0);
    const insideX = origin.x + crypt.entry.x;
    expect(dungeonEntrySnapshotFacing(null, 0, insideX, insideX, 0, Math.PI)).toEqual({
      entrySeq: 0,
      inputFacing: Math.PI,
      entryAck: null,
      forceFacing: false,
    });
    expect(dungeonEntrySnapshotFacing(0, 1, insideX, insideX, 0, Math.PI)).toEqual({
      entrySeq: 1,
      inputFacing: 0,
      entryAck: 1,
      forceFacing: true,
    });
    expect(dungeonEntrySnapshotFacing(1, undefined, insideX, insideX, 0, Math.PI)).toEqual({
      entrySeq: 1,
      inputFacing: Math.PI,
      entryAck: null,
      forceFacing: false,
    });
    expect(dungeonEntrySnapshotFacing(1, 1, insideX, insideX, 0, Math.PI)).toEqual({
      entrySeq: 1,
      inputFacing: Math.PI,
      entryAck: null,
      forceFacing: false,
    });
    expect(dungeonEntrySnapshotFacing(1, '2', insideX, insideX, 0, Math.PI)).toEqual({
      entrySeq: 1,
      inputFacing: Math.PI,
      entryAck: null,
      forceFacing: false,
    });
    expect(dungeonEntrySnapshotFacing(1, 2, insideX, insideX, 0, Math.PI)).toEqual({
      entrySeq: 2,
      inputFacing: 0,
      entryAck: 2,
      forceFacing: true,
    });
    expect(dungeonEntrySnapshotFacing(3, 0, insideX, insideX, 0, Math.PI)).toEqual({
      entrySeq: 0,
      inputFacing: Math.PI,
      entryAck: null,
      forceFacing: false,
    });
    expect(
      dungeonEntrySnapshotFacing(null, 2, crypt.doorPos.x, crypt.doorPos.x, 0, Math.PI),
    ).toEqual({
      entrySeq: 2,
      inputFacing: Math.PI,
      entryAck: null,
      forceFacing: false,
    });

    expect(
      dungeonEntrySnapshotFacing(
        null,
        undefined,
        crypt.doorPos.x,
        origin.x + crypt.entry.x,
        0,
        Math.PI,
      ),
    ).toMatchObject({ inputFacing: 0, entryAck: null, forceFacing: true });
  });
});
