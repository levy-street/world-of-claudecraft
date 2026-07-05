import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the block enforcement in the
// server's event routing is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass } from '../src/sim/types';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

// One server tick: run the sim and route the resulting events to sessions,
// exactly like the 50 ms loop does.
function route(server: GameServer): void {
  (server as any).routeEvents(server.sim.tick());
}

function cmd(server: GameServer, session: ClientSession, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

function eventsOf(fc: FakeClient, type: string): any[] {
  return fc.sent
    .flatMap((msg) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === type);
}

function textsOf(fc: FakeClient): string[] {
  return fc.sent
    .flatMap((msg) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === 'log' || ev.type === 'error')
    .map((ev: any) => ev.text);
}

// Trade (10 yd) and duel (30 yd) requests are proximity-gated; park the
// second player on top of the first.
function colocate(server: GameServer, aPid: number, bPid: number): void {
  const a = server.sim.entities.get(aPid);
  const b = server.sim.entities.get(bPid);
  if (!a || !b) throw new Error('entity missing');
  b.pos.x = a.pos.x;
  b.pos.y = a.pos.y;
  b.pos.z = a.pos.z;
  b.prevPos = { ...b.pos };
}

function setup() {
  const server = new GameServer();
  const fcSender = fakeWs();
  const sender = joinServer(server, fcSender, 1, 'Aleph');
  const fcTarget = fakeWs();
  const target = joinServer(server, fcTarget, 2, 'Bet');
  const fcOther = fakeWs();
  const other = joinServer(server, fcOther, 3, 'Gimel');
  // Bet has Aleph on their ignore list
  target.blockedIds = new Set([sender.characterId]);
  return { server, fcSender, sender, fcTarget, target, fcOther, other };
}

describe('blocked party invites', () => {
  it('suppresses a pinvite from a blocked sender and declines on the target behalf', () => {
    const { server, fcSender, sender, fcTarget, target, other } = setup();

    cmd(server, sender, { cmd: 'pinvite', id: target.pid });
    route(server);
    route(server);

    // the target never sees the invite dialog
    expect(eventsOf(fcTarget, 'partyInvite')).toHaveLength(0);
    // the sender sees exactly the ordinary invite-then-decline outcome
    expect(textsOf(fcSender)).toContain('You have invited Bet to your party.');
    expect(textsOf(fcSender)).toContain('Bet declines your invitation.');
    // no lingering pending state in the sim
    expect((server.sim as any).party.partyInvites.has(target.pid)).toBe(false);

    // a subsequent invite from an UNBLOCKED player works immediately
    cmd(server, other, { cmd: 'pinvite', id: target.pid });
    route(server);
    const invites = eventsOf(fcTarget, 'partyInvite');
    expect(invites).toHaveLength(1);
    expect(invites[0].fromName).toBe('Gimel');
  });

  it('suppresses a realm-wide /invite by name from a blocked sender the same way', () => {
    const { server, fcSender, sender, fcTarget, target, other } = setup();

    cmd(server, sender, { cmd: 'chat', text: '/invite Bet' });
    route(server);
    route(server);

    expect(eventsOf(fcTarget, 'partyInvite')).toHaveLength(0);
    expect(textsOf(fcSender)).toContain('Bet declines your invitation.');
    expect((server.sim as any).party.partyInvites.has(target.pid)).toBe(false);

    cmd(server, other, { cmd: 'pinvite', id: target.pid });
    route(server);
    expect(eventsOf(fcTarget, 'partyInvite')).toHaveLength(1);
  });

  it('unblocking the sender restores their party invites', () => {
    const { server, sender, fcTarget, target } = setup();

    cmd(server, sender, { cmd: 'pinvite', id: target.pid });
    route(server);
    route(server);
    expect(eventsOf(fcTarget, 'partyInvite')).toHaveLength(0);

    // Bet unignores Aleph (the social command path updates session.blockedIds)
    target.blockedIds = new Set();
    cmd(server, sender, { cmd: 'pinvite', id: target.pid });
    route(server);
    const invites = eventsOf(fcTarget, 'partyInvite');
    expect(invites).toHaveLength(1);
    expect(invites[0].fromName).toBe('Aleph');
  });
});

describe('blocked trade and duel requests', () => {
  it('suppresses a trade request from a blocked sender with no lingering pending invite', () => {
    const { server, fcSender, sender, fcTarget, target, other } = setup();
    colocate(server, target.pid, sender.pid);
    colocate(server, target.pid, other.pid);

    cmd(server, sender, { cmd: 'trade_req', id: target.pid });
    route(server);
    route(server);

    // the target never sees the request; the sender sees only the ordinary
    // "requested" confirmation (a real target who ignores the dialog produces
    // the same silence, there is no trade decline command)
    expect(eventsOf(fcTarget, 'tradeRequest')).toHaveLength(0);
    expect(textsOf(fcSender)).toContain('You have requested to trade with Bet.');
    expect(server.sim.tradeInvites.has(target.pid)).toBe(false);

    // an unblocked player's request goes through immediately
    cmd(server, other, { cmd: 'trade_req', id: target.pid });
    route(server);
    const requests = eventsOf(fcTarget, 'tradeRequest');
    expect(requests).toHaveLength(1);
    expect(requests[0].fromName).toBe('Gimel');
  });

  it('suppresses a duel challenge from a blocked sender and declines on the target behalf', () => {
    const { server, fcSender, sender, fcTarget, target, other } = setup();
    colocate(server, target.pid, sender.pid);
    colocate(server, target.pid, other.pid);

    cmd(server, sender, { cmd: 'duel_req', id: target.pid });
    route(server);
    route(server);

    expect(eventsOf(fcTarget, 'duelRequest')).toHaveLength(0);
    expect(textsOf(fcSender)).toContain('You have challenged Bet to a duel.');
    expect(textsOf(fcSender)).toContain('Bet declines your challenge.');
    expect(server.sim.duelInvites.has(target.pid)).toBe(false);

    cmd(server, other, { cmd: 'duel_req', id: target.pid });
    route(server);
    const requests = eventsOf(fcTarget, 'duelRequest');
    expect(requests).toHaveLength(1);
    expect(requests[0].fromName).toBe('Gimel');
  });
});
