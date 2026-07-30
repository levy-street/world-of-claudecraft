import { describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { rowForLevel } from '../src/sim/content/talents';

interface FakeClient {
  sent: SnapshotMessage[];
  ws: WebSocket;
}

interface TalentSnapshotPayload {
  alloc?: Record<string, unknown>;
  spec?: unknown;
  role?: unknown;
  loadouts?: unknown[];
  activeLoadout?: number;
}

interface SnapshotMessage {
  t?: string;
  self?: { tal?: TalentSnapshotPayload };
}

function fakeWs(): FakeClient {
  const sent: SnapshotMessage[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload) as SnapshotMessage),
    } as unknown as WebSocket,
  };
}

function setup(): { server: GameServer; client: FakeClient; session: ClientSession } {
  const server = new GameServer();
  const client = fakeWs();
  const joined = server.join(client.ws, 1, 1, 'Rowguard', 'warrior', null);
  if ('error' in joined) throw new Error(joined.error);
  joined.blockListLoaded = true;
  server.sim.setPlayerLevel(20, joined.pid);
  return { server, client, session: joined };
}

function command(
  server: GameServer,
  session: ClientSession,
  message: Record<string, unknown>,
): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...message }));
}

function broadcast(server: GameServer): void {
  (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
}

function lastSnapshot(client: FakeClient): SnapshotMessage | null {
  for (let index = client.sent.length - 1; index >= 0; index--) {
    if (client.sent[index].t === 'snap') return client.sent[index];
  }
  return null;
}

function firstWarriorRowOptionId(): string {
  const row = rowForLevel('warrior', 5);
  if (!row?.options[0]) throw new Error('warrior level 5 row fixture missing');
  return row.options[0].id;
}

describe('authoritative server Talent V2 boundary', () => {
  it('dispatches only strict canonical allocations, row levels, and safe loadout indexes', () => {
    const { server, session } = setup();
    const applyTalents = vi.spyOn(server.sim, 'applyTalents');
    const selectTalentRow = vi.spyOn(server.sim, 'selectTalentRow');
    const switchLoadout = vi.spyOn(server.sim, 'switchLoadout');
    const deleteLoadout = vi.spyOn(server.sim, 'deleteLoadout');
    const optionId = firstWarriorRowOptionId();

    for (const alloc of [
      { spec: 'arms', ranks: {}, choices: {} },
      { spec: 'arms', rows: {}, rowPicks: [] },
      { spec: 'arms', rows: {}, unknown: true },
      { spec: 'arms', rows: { 5: null } },
    ]) {
      command(server, session, { cmd: 'applyTalents', alloc });
    }
    command(server, session, { cmd: 'selectTalentRow', level: '5', optionId });
    command(server, session, { cmd: 'selectTalentRow', level: 6, optionId });
    command(server, session, { cmd: 'selectTalentRow', level: 5, optionId: 7 });
    command(server, session, { cmd: 'switchLoadout', index: 1.5 });
    command(server, session, { cmd: 'switchLoadout', index: 2 ** 32 });
    command(server, session, { cmd: 'deleteLoadout', index: Number.POSITIVE_INFINITY });

    expect(applyTalents).not.toHaveBeenCalled();
    expect(selectTalentRow).not.toHaveBeenCalled();
    expect(switchLoadout).not.toHaveBeenCalled();
    expect(deleteLoadout).not.toHaveBeenCalled();

    const allocation = { spec: 'arms', rows: { 5: optionId } };
    command(server, session, { cmd: 'applyTalents', alloc: allocation });
    expect(applyTalents).toHaveBeenCalledWith(allocation, session.pid);
  });

  it('refreshes one canonical talent snapshot after each live spec or row mutation', () => {
    const { server, client, session } = setup();
    const optionId = firstWarriorRowOptionId();

    broadcast(server);
    client.sent.length = 0;
    const meta = server.sim.meta(session.pid);
    if (!meta) throw new Error('joined player metadata missing');
    const beforeRev = meta.wireRev;

    command(server, session, { cmd: 'setSpec', spec: 'fury' });
    expect(meta.wireRev).toBe(beforeRev + 1);
    command(server, session, { cmd: 'selectTalentRow', level: 5, optionId });
    expect(meta.wireRev).toBe(beforeRev + 2);

    broadcast(server);
    const snapshot = lastSnapshot(client);
    expect(snapshot?.self?.tal).toEqual({
      alloc: { spec: 'fury', rows: { 5: optionId } },
      loadouts: [],
      activeLoadout: -1,
    });
    expect(snapshot?.self?.tal).not.toHaveProperty('spec');
    expect(snapshot?.self?.tal).not.toHaveProperty('role');
    expect(snapshot?.self?.tal?.alloc).not.toHaveProperty('ranks');
    expect(snapshot?.self?.tal?.alloc).not.toHaveProperty('choices');
    expect(snapshot?.self?.tal?.alloc).not.toHaveProperty('rowPicks');

    client.sent.length = 0;
    command(server, session, { cmd: 'selectTalentRow', level: 5, optionId });
    expect(meta.wireRev).toBe(beforeRev + 2);
    broadcast(server);
    expect(lastSnapshot(client)?.self).not.toHaveProperty('tal');
  });

  it('refreshes loadout metadata immediately even when the allocation is unchanged', () => {
    const { server, client, session } = setup();
    const meta = server.sim.meta(session.pid);
    if (!meta) throw new Error('joined player metadata missing');
    broadcast(server);
    client.sent.length = 0;
    const beforeRev = meta.wireRev;

    command(server, session, { cmd: 'saveLoadout', name: 'One', bar: ['attack'] });
    expect(meta.wireRev).toBe(beforeRev + 1);
    broadcast(server);
    expect(lastSnapshot(client)?.self?.tal).toMatchObject({
      loadouts: [{ name: 'One', bar: ['attack'] }],
      activeLoadout: 0,
    });

    client.sent.length = 0;
    command(server, session, { cmd: 'saveLoadout', name: 'Two', bar: ['battle_shout'] });
    expect(meta.wireRev).toBe(beforeRev + 2);
    broadcast(server);
    expect(lastSnapshot(client)?.self?.tal).toMatchObject({
      loadouts: [{ name: 'One' }, { name: 'Two' }],
      activeLoadout: 1,
    });

    client.sent.length = 0;
    command(server, session, { cmd: 'switchLoadout', index: 0 });
    expect(meta.wireRev).toBe(beforeRev + 3);
    broadcast(server);
    expect(lastSnapshot(client)?.self?.tal?.activeLoadout).toBe(0);

    client.sent.length = 0;
    command(server, session, { cmd: 'deleteLoadout', index: 1 });
    expect(meta.wireRev).toBe(beforeRev + 4);
    broadcast(server);
    expect(lastSnapshot(client)?.self?.tal).toMatchObject({
      loadouts: [{ name: 'One' }],
      activeLoadout: 0,
    });
  });
});
