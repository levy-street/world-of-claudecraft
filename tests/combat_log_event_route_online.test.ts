import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
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
import type { Entity, SimEvent } from '../src/sim/types';

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;
type Heal2Event = Extract<SimEvent, { type: 'heal2' }>;
type WireMsg = { t?: string; list?: SimEvent[] };

interface FakeClient {
  sent: WireMsg[];
  ws: { readyState: number; send(payload: string): void };
}

function fakeWs(): FakeClient {
  const sent: WireMsg[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload) => sent.push(JSON.parse(payload) as WireMsg),
    },
  };
}

function joinServer(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = server.join(
    fc.ws as Parameters<GameServer['join']>[0],
    id,
    id,
    name,
    'warrior',
    null,
  );
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function clearSent(...clients: FakeClient[]): void {
  for (const client of clients) client.sent.length = 0;
}

function route(server: GameServer, events: SimEvent[]): void {
  (server as unknown as { routeEvents(events: SimEvent[]): void }).routeEvents(events);
}

function deliveredDamage(client: FakeClient): DamageEvent[] {
  return client.sent
    .filter((msg) => msg.t === 'events')
    .flatMap((msg) => msg.list ?? [])
    .filter((event): event is DamageEvent => event.type === 'damage');
}

function deliveredHeals(client: FakeClient): Heal2Event[] {
  return client.sent
    .filter((msg) => msg.t === 'events')
    .flatMap((msg) => msg.list ?? [])
    .filter((event): event is Heal2Event => event.type === 'heal2');
}

function damage(sourceId: number, targetId: number): DamageEvent {
  return {
    type: 'damage',
    sourceId,
    targetId,
    amount: 17,
    crit: false,
    school: 'physical',
    ability: null,
    kind: 'hit',
  };
}

function heal(sourceId: number, targetId: number, amount = 0): Heal2Event {
  return {
    type: 'heal2',
    sourceId,
    targetId,
    amount,
    crit: false,
    ability: 'Whispered Prayer',
  };
}

function placeTogether(server: GameServer, sessions: ClientSession[]): void {
  const anchor = server.sim.entities.get(sessions[0].pid);
  if (!anchor) throw new Error('missing anchor');
  for (const session of sessions) {
    const entity = server.sim.entities.get(session.pid);
    if (!entity) throw new Error(`missing entity ${session.pid}`);
    const pos: Entity['pos'] = { x: anchor.pos.x + 2, y: anchor.pos.y, z: anchor.pos.z };
    entity.pos = pos;
    entity.prevPos = { ...pos };
    server.sim.grid.update(entity);
    server.sim.playerGrid.update(entity);
  }
}

function setup() {
  const server = new GameServer();
  const viewerClient = fakeWs();
  const allyClient = fakeWs();
  const sourceClient = fakeWs();
  const targetClient = fakeWs();
  const viewer = joinServer(server, viewerClient, 101, 'Viewer');
  const ally = joinServer(server, allyClient, 102, 'Ally');
  const source = joinServer(server, sourceClient, 103, 'Source');
  const target = joinServer(server, targetClient, 104, 'Target');
  placeTogether(server, [viewer, ally, source, target]);
  clearSent(viewerClient, allyClient, sourceClient, targetClient);
  return {
    server,
    viewerClient,
    allyClient,
    sourceClient,
    targetClient,
    viewer,
    ally,
    source,
    target,
  };
}

describe('online combat log event routing', () => {
  it('keeps the local player own combat damage events', () => {
    const { server, viewerClient, viewer, target } = setup();

    route(server, [damage(viewer.pid, target.pid)]);

    expect(deliveredDamage(viewerClient)).toEqual([
      expect.objectContaining({ sourceId: viewer.pid }),
    ]);
  });

  it('keeps party member combat damage events for the local player', () => {
    const { server, viewerClient, viewer, ally, target } = setup();
    server.sim.partyInvite(ally.pid, viewer.pid);
    server.sim.partyAccept(ally.pid);
    clearSent(viewerClient);

    route(server, [damage(ally.pid, target.pid)]);

    expect(deliveredDamage(viewerClient)).toEqual([
      expect.objectContaining({ sourceId: ally.pid }),
    ]);
  });

  it('filters unrelated nearby player combat damage events from the local player', () => {
    const { server, viewerClient, sourceClient, targetClient, source, target } = setup();
    const event = damage(source.pid, target.pid);

    route(server, [event]);

    expect(deliveredDamage(viewerClient)).toHaveLength(0);
    expect(deliveredDamage(sourceClient)).toEqual([event]);
    expect(deliveredDamage(targetClient)).toEqual([event]);
  });

  it('keeps zero-effective direct self heals for online healer feedback', () => {
    const { server, viewerClient, viewer } = setup();
    const event = heal(viewer.pid, viewer.pid, 0);

    route(server, [event]);

    expect(deliveredHeals(viewerClient)).toEqual([event]);
  });

  it('keeps party member heal events for the local player', () => {
    const { server, viewerClient, viewer, ally } = setup();
    server.sim.partyInvite(ally.pid, viewer.pid);
    server.sim.partyAccept(ally.pid);
    clearSent(viewerClient);
    const event = heal(ally.pid, ally.pid, 0);

    route(server, [event]);

    expect(deliveredHeals(viewerClient)).toEqual([event]);
  });

  it('filters unrelated nearby player heal events from the local player', () => {
    const { server, viewerClient, sourceClient, source, target } = setup();
    const event = heal(source.pid, target.pid, 0);

    route(server, [event]);

    expect(deliveredHeals(viewerClient)).toHaveLength(0);
    expect(deliveredHeals(sourceClient)).toEqual([event]);
  });
});
