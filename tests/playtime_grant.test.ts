// Playtime reward grant: the durable "you were online and active" points award
// (GameServer.grantPlaytimePoints, armed on a PLAYTIME_GRANT_MS interval).
//
// The behavior under test is the linkdead guard. grantPlaytimePoints iterates
// this.clients, which deliberately RETAINS a linkdead session for the whole
// disconnect grace, and its only eligibility check is the activity window
// (sim.time - lastInputAt <= PLAYTIME_GRANT_MS/1000 = 300 s). LINKDEAD_GRACE_MS is
// also exactly 300 s and socketClosed never rewinds lastInputAt, so a player who
// gave input any time in the 5 minutes before dropping passes the window check for
// the entire grace: without the guard the grant lands while they are offline.
//
// Rig: tests/linkdead.test.ts's server rig (mocked server/db, fakeWs, join/
// socketClosed) plus a mocked server/discord_db so grantRewardPoints is a spy. The
// mock matters for decisiveness: the db fake's pool has no `connect`, so the real
// grantRewardPoints would throw inside grantPlaytimePoints's own try/catch and a
// no-grant assertion would pass for the wrong reason.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));
vi.mock('../server/discord_db', () => ({
  discordFlairForAccount: vi.fn(async () => null),
  grantRewardPoints: vi.fn(async () => {}),
}));

import { pool } from '../server/db';
import { grantRewardPoints } from '../server/discord_db';
import { type ClientSession, GameServer } from '../server/game';

function fakeWs() {
  const ws: any = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(() => {
      ws.readyState = 3;
    }),
  };
  return ws;
}

function expectJoined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  return result;
}

function dropSocket(server: GameServer, session: ClientSession, ws: any): boolean {
  ws.readyState = 3; // CLOSED
  return server.socketClosed(session, ws);
}

// Drive the private interval body directly, the expireLinkdeadSessions idiom.
async function runGrant(server: GameServer): Promise<void> {
  await (server as any).grantPlaytimePoints();
}

const grant = vi.mocked(grantRewardPoints);

describe('playtime reward grant', () => {
  it('grants a live, recently-active session its playtime points', async () => {
    grant.mockClear();
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Active', 'warrior', null));
    // join sets lastInputAt = sim.time, so the activity window check passes
    expect(server.sim.time - session.lastInputAt).toBe(0);

    await runGrant(server);

    // Pinned to the literal award so a silent retune reds here, and to the
    // 'playtime' ledger reason the reward ledger rows are keyed by.
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith(pool, 11, 10, 'playtime');
  });

  it('skips a live session that has been idle past the activity window', async () => {
    // Negative control for the OTHER skip: the linkdead guard must not have
    // replaced the idle check, so a live-but-idle session still earns nothing.
    grant.mockClear();
    const server = new GameServer();
    const session = expectJoined(server.join(fakeWs(), 11, 101, 'Afk', 'warrior', null));
    session.lastInputAt = server.sim.time - 301; // one second past the 300 s window

    await runGrant(server);

    expect(grant).not.toHaveBeenCalled();
  });

  it('grants nothing to a linkdead session during the disconnect grace', async () => {
    grant.mockClear();
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Dropped', 'warrior', null));

    expect(dropSocket(server, session, ws)).toBe(true);
    expect(session.linkdead).toBe(true);
    // The session is STILL in this.clients (that is the whole grace mechanism) and
    // its activity window is wide open, so the linkdead flag is the only thing that
    // can stop the grant. Set lastInputAt explicitly so an accidental sim-time
    // advance can never make this pass for the idle reason instead.
    expect(server.clients.size).toBe(1);
    session.lastInputAt = server.sim.time;
    // Fresh server, so the per-account dedupe map is empty and cannot be the cause.

    await runGrant(server);

    expect(grant).not.toHaveBeenCalled();
  });

  it('resumes granting once the player reconnects inside the grace window', async () => {
    grant.mockClear();
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Backagain', 'warrior', null));
    dropSocket(server, session, ws);

    const resumed = expectJoined(server.join(fakeWs(), 11, 101, 'Backagain', 'warrior', null));
    expect(resumed).toBe(session);
    expect(resumed.linkdead).toBe(false);

    await runGrant(server);

    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith(pool, 11, 10, 'playtime');
  });

  it('flips one session between granting and not as it drops and resumes', async () => {
    // The three arms above on ONE session, to pin that the difference is the
    // session's linkdead state and nothing about how each server was built.
    grant.mockClear();
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Flipflop', 'warrior', null));

    await runGrant(server);
    expect(grant).toHaveBeenCalledTimes(1);

    // sim.time never advances in this rig, so the per-account 5-minute dedupe would
    // block every later grant on its own. Clear it between arms to isolate the one
    // dimension under test.
    const dedupe = (server as any).lastPlaytimeGrantAt as Map<number, number>;
    dedupe.clear();
    dropSocket(server, session, ws);
    session.lastInputAt = server.sim.time;

    await runGrant(server);
    expect(grant).toHaveBeenCalledTimes(1); // still 1: nothing granted while linkdead

    dedupe.clear();
    expectJoined(server.join(fakeWs(), 11, 101, 'Flipflop', 'warrior', null));

    await runGrant(server);
    expect(grant).toHaveBeenCalledTimes(2);
  });
});
