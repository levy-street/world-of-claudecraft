import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed. What is under test is the SERVER
// ENCODER for operator-set account flair: the two places a flagged account's [AI]
// mark and streamer links reach a client, namely the entity identity record and the
// chat fan-out. (tests/account_flair.test.ts pins the pure gate, and the client
// tests hand-build their events, so they exercise the DECODER and would stay green
// if the server stopped emitting anything at all.)
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
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { type ClientSession, GameServer, wireEntity } from '../server/game';
import type { AccountFlair } from '../src/sim/account_flair';
import type { PlayerClass } from '../src/sim/types';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

// accountId === characterId here, so applyAccountFlairLive(id) targets that player.
function joinServer(
  server: GameServer,
  fc: FakeClient,
  id: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, id, id, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function route(server: GameServer): void {
  (server as any).routeEvents(server.sim.tick());
}

function cmd(server: GameServer, session: ClientSession, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

function chatsOf(fc: FakeClient): any[] {
  return fc.sent
    .flatMap((msg) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === 'chat');
}

function colocate(server: GameServer, aPid: number, bPid: number): void {
  const a = server.sim.entities.get(aPid);
  const b = server.sim.entities.get(bPid);
  if (!a || !b) throw new Error('missing entity');
  b.pos.x = a.pos.x;
  b.pos.y = a.pos.y;
  b.pos.z = a.pos.z;
}

// Park two players far enough apart that neither is in the other's interest scope
// (INTEREST_RADIUS is ~120yd), so the listener has NO entity record for the speaker.
// This is the whole reason flair rides the chat event instead of being read off the
// speaker's entity: general/world/lfg chat crosses the map.
function separate(server: GameServer, aPid: number, bPid: number): void {
  const a = server.sim.entities.get(aPid);
  const b = server.sim.entities.get(bPid);
  if (!a || !b) throw new Error('missing entity');
  b.pos.x = a.pos.x + 5000;
  b.pos.z = a.pos.z + 5000;
}

const STREAMER: AccountFlair = {
  ai: true,
  streamer: true,
  links: { twitch: 'https://twitch.tv/someone' },
};

afterEach(() => vi.restoreAllMocks());

describe('account flair: the entity identity encoding', () => {
  it('rides the identity record as ai + slk once an operator sets it', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const speaker = joinServer(server, fa, 1, 'Streamer');

    const before = wireEntity(server.sim.entities.get(speaker.pid)!);
    expect(before.ai).toBeUndefined();
    expect(before.slk).toBeUndefined();

    server.applyAccountFlairLive(1, STREAMER);

    const after = wireEntity(server.sim.entities.get(speaker.pid)!);
    expect(after.ai).toBe(1);
    expect(after.slk).toEqual({ twitch: 'https://twitch.tv/someone' });
  });

  it('ships NO links while the streamer flag is off, however many are stored', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const speaker = joinServer(server, fa, 1, 'Streamer');

    // The exact row of an account whose flair was switched off: links intact, flag
    // down. wireStreamerLinks is the gate, and this is the surface it guards.
    server.applyAccountFlairLive(1, { ...STREAMER, ai: false, streamer: false });

    const wire = wireEntity(server.sim.entities.get(speaker.pid)!);
    expect(wire.slk).toBeUndefined();
    expect(wire.ai).toBeUndefined();
  });

  it('clears the mark on the entity when an operator revokes it', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const speaker = joinServer(server, fa, 1, 'Streamer');

    server.applyAccountFlairLive(1, STREAMER);
    expect(wireEntity(server.sim.entities.get(speaker.pid)!).ai).toBe(1);

    server.applyAccountFlairLive(1, { ai: false, streamer: false, links: {} });

    // Absent, not false: the identity JSON diff re-broadcasts the record, and the
    // client reads a full identity record with no `ai` as "no mark".
    expect(wireEntity(server.sim.entities.get(speaker.pid)!).ai).toBeUndefined();
  });
});

describe('account flair: the chat fan-out encoding', () => {
  it('attaches the SPEAKER flair to a chat line, even out of interest scope', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const speaker = joinServer(server, fa, 1, 'Streamer');
    const listener = joinServer(server, fb, 2, 'Listener');
    // Far apart on purpose: the listener has no entity record for the speaker, so
    // the event is the ONLY place their flair can arrive.
    separate(server, speaker.pid, listener.pid);
    server.applyAccountFlairLive(1, STREAMER);

    cmd(server, speaker, '/general going live');
    route(server);

    const heard = chatsOf(fb).find((ev) => ev.text === 'going live');
    expect(heard).toBeDefined();
    expect(heard.flair).toEqual({ ai: true, links: { twitch: 'https://twitch.tv/someone' } });
  });

  it('leaves an ORDINARY player chat line bare: no flair key on the wire', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const speaker = joinServer(server, fa, 1, 'Nobody');
    const listener = joinServer(server, fb, 2, 'Listener');
    colocate(server, speaker.pid, listener.pid);

    cmd(server, speaker, 'hello there');
    cmd(server, speaker, '/general hello there');
    route(server);

    const heard = chatsOf(fb).filter((ev) => ev.text === 'hello there');
    expect(heard.length).toBeGreaterThan(0);
    // Absent, NOT {}: an unflagged sender's chat event must be byte-unchanged.
    for (const ev of heard) expect(ev.flair, ev.channel).toBeUndefined();
  });

  it('attaches the AI mark alone when the account has no streamer links', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const speaker = joinServer(server, fa, 1, 'Bot');
    const listener = joinServer(server, fb, 2, 'Listener');
    colocate(server, speaker.pid, listener.pid);
    server.applyAccountFlairLive(1, { ai: true, streamer: false, links: {} });

    cmd(server, speaker, 'beep');
    route(server);

    const heard = chatsOf(fb).find((ev) => ev.text === 'beep');
    expect(heard.flair).toEqual({ ai: true });
    expect(heard.flair.links).toBeUndefined();
  });

  it('does not leak the links of a speaker whose streamer flag is off', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const speaker = joinServer(server, fa, 1, 'Lapsed');
    const listener = joinServer(server, fb, 2, 'Listener');
    colocate(server, speaker.pid, listener.pid);
    // Links still stored against the account, flag switched off by an operator.
    server.applyAccountFlairLive(1, { ...STREAMER, ai: false, streamer: false });

    cmd(server, speaker, 'still here');
    route(server);

    const heard = chatsOf(fb).find((ev) => ev.text === 'still here');
    expect(heard.flair).toBeUndefined();
  });
});
