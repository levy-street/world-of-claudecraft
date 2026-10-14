import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as unknown[] })),
}));

vi.mock('../server/db', () => ({
  pool: { query: db.query },
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

vi.mock('../server/moderation_db', () => ({
  recordInGameAction: vi.fn(async () => {}),
  muteAccountChat: vi.fn(async () => {}),
  moderateAccount: vi.fn(async () => {}),
  forceCharacterRename: vi.fn(async () => ({ accountId: 0 })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { REALM } from '../server/realm';
import { UPSERT_REALM_MOTD_SQL } from '../server/realm_motd_db';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';

// Only sessions and chat take part; strip ambient world content like the other
// GameServer suites (tests/moderation_game.test.ts).
setActiveWorldContent({ ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] });
afterAll(() => setActiveWorldContent(null));

type FakeWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function fakeWs(): FakeWs & Parameters<GameServer['join']>[0] {
  return { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as FakeWs &
    Parameters<GameServer['join']>[0];
}

function joined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  result.blockListLoaded = true;
  return result;
}

function eventTexts(ws: FakeWs, type: string): string[] {
  return ws.send.mock.calls
    .map(
      (call) =>
        JSON.parse(String(call[0])) as { t?: string; list?: { type?: string; text?: string }[] },
    )
    .filter((frame) => frame.t === 'events')
    .flatMap((frame) => frame.list ?? [])
    .filter((event) => event.type === type && typeof event.text === 'string')
    .map((event) => event.text as string);
}

function logTexts(ws: FakeWs): string[] {
  return ws.send.mock.calls
    .map(
      (call) =>
        JSON.parse(String(call[0])) as { t?: string; list?: { type?: string; text?: string }[] },
    )
    .filter((frame) => frame.t === 'events')
    .flatMap((frame) => frame.list ?? [])
    .filter((event) => event.type === 'log' && typeof event.text === 'string')
    .map((event) => event.text as string);
}

function chat(server: GameServer, session: ClientSession, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

function joinAdmin(
  server: GameServer,
  ws: ReturnType<typeof fakeWs>,
  permissions: readonly string[],
) {
  return joined(
    server.join(ws, 1, 101, 'Overseer', 'warrior', null, false, {
      isAdmin: true,
      adminPermissions: permissions,
    }),
  );
}

beforeEach(() => {
  db.query.mockClear();
  db.query.mockImplementation(async () => ({ rows: [] }));
});

describe('realm message of the day in the live server', () => {
  it('broadcasts an admin /motd to everyone online and persists it', async () => {
    const server = new GameServer();
    const adminWs = fakeWs();
    const playerWs = fakeWs();
    const admin = joinAdmin(server, adminWs, ['realm.motd']);
    joined(server.join(playerWs, 2, 102, 'Mira', 'mage', null));

    chat(server, admin, '/motd "Double XP all weekend!"');

    expect(logTexts(playerWs)).toContain('Message of the day: Double XP all weekend!');
    expect(logTexts(adminWs)).toEqual(
      expect.arrayContaining([
        'Message of the day: Double XP all weekend!',
        'Message of the day updated.',
      ]),
    );
    await vi.waitFor(() =>
      expect(db.query).toHaveBeenCalledWith(UPSERT_REALM_MOTD_SQL, [
        REALM,
        'Double XP all weekend!',
        1,
      ]),
    );
  });

  it('greets a player who joins later, right after the world-entry line', () => {
    const server = new GameServer();
    const admin = joinAdmin(server, fakeWs(), ['realm.motd']);
    chat(server, admin, '/motd Welcome to the realm');

    const lateWs = fakeWs();
    joined(server.join(lateWs, 3, 103, 'Tor', 'rogue', null));

    const texts = logTexts(lateWs);
    const entered = texts.indexOf('Tor has entered World of ClaudeCraft.');
    expect(entered).toBeGreaterThanOrEqual(0);
    expect(texts[entered + 1]).toBe('Message of the day: Welcome to the realm');
  });

  it('does not repeat the message on a seamless reconnect', () => {
    // A linkdead resume keeps the same session and chat pane, so like the
    // world-entry line the greeting is a fresh-join event only.
    const server = new GameServer();
    const admin = joinAdmin(server, fakeWs(), ['realm.motd']);
    chat(server, admin, '/motd "Once per login"');
    const firstWs = fakeWs();
    const session = joined(server.join(firstWs, 3, 103, 'Tor', 'rogue', null));
    expect(logTexts(firstWs)).toContain('Message of the day: Once per login');

    server.socketClosed(session, firstWs);
    const resumedWs = fakeWs();
    const resumed = joined(server.join(resumedWs, 3, 103, 'Tor', 'rogue', null));

    expect(resumed).toBe(session);
    expect(logTexts(resumedWs).some((text) => text.startsWith('Message of the day'))).toBe(false);
  });

  it('greets nobody once the message is cleared', () => {
    const server = new GameServer();
    const admin = joinAdmin(server, fakeWs(), ['realm.motd']);
    chat(server, admin, '/motd "Short lived"');
    chat(server, admin, '/motd clear');

    const lateWs = fakeWs();
    joined(server.join(lateWs, 3, 103, 'Tor', 'rogue', null));

    expect(logTexts(lateWs).some((text) => text.startsWith('Message of the day'))).toBe(false);
  });

  it('restores the stored message at boot and greets with it', async () => {
    db.query.mockImplementation(async () => ({ rows: [{ message: 'Patch 0.45 is live' }] }));
    const server = new GameServer();
    await server.realmMotd.load();

    const ws = fakeWs();
    joined(server.join(ws, 2, 102, 'Mira', 'mage', null));

    expect(logTexts(ws)).toContain('Message of the day: Patch 0.45 is live');
  });

  it('refuses a moderator without realm.motd and ignores a plain player', () => {
    const server = new GameServer();
    const moderatorWs = fakeWs();
    const moderator = joinAdmin(server, moderatorWs, ['moderation.act', 'moderation.spectate']);
    const playerWs = fakeWs();
    const player = joined(server.join(playerWs, 2, 102, 'Mira', 'mage', null));

    chat(server, moderator, '/motd "Not allowed"');
    chat(server, player, '/motd "Not allowed either"');
    server.sim.tick();
    (server as unknown as { routeEvents(events: unknown[]): void }).routeEvents(server.sim.tick());

    expect(server.realmMotd.current).toBeNull();
    expect(eventTexts(moderatorWs, 'error')).toContain("You don't have permission to do that.");
    const everything = [moderatorWs, playerWs].flatMap((ws) =>
      ws.send.mock.calls.map((call) => String(call[0])),
    );
    expect(everything.some((frame) => frame.includes('Message of the day'))).toBe(false);
    expect(everything.some((frame) => frame.includes('Not allowed"'))).toBe(false);
    expect(db.query).not.toHaveBeenCalledWith(UPSERT_REALM_MOTD_SQL, expect.anything());
  });

  it('claims /motd from a spectating admin instead of the spectate chat guard', async () => {
    const server = new GameServer();
    const adminWs = fakeWs();
    const admin = joinAdmin(server, adminWs, ['realm.motd', 'moderation.spectate']);
    joined(server.join(fakeWs(), 2, 102, 'Mira', 'mage', null));

    chat(server, admin, '/spectate Mira');
    await vi.waitFor(() => expect(admin.spectating).toBeTruthy());
    chat(server, admin, '/motd "Seen from afar"');

    expect(server.realmMotd.current).toBe('Seen from afar');
    expect(eventTexts(adminWs, 'error')).not.toContain(
      'Local chat is unavailable while spectating.',
    );
  });

  it('loads the stored message at boot, before the server starts listening', () => {
    const main = readFileSync('server/main.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const loadAt = main.indexOf('await game.realmMotd.load();');
    const listenAt = main.indexOf('server.listen(');
    expect(loadAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(loadAt);
  });
});
