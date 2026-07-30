import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const openPlaySession = vi.fn(async () => 1);
const closePlaySession = vi.fn(async () => {});

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: (...args: unknown[]) => openPlaySession(...(args as [])),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: (...args: unknown[]) => closePlaySession(...(args as [])),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // Character load leases: leave() releases and the autosave loop heartbeats, so
  // these must exist on the mock or those paths throw on the undefined export.
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { releaseCharacterLease } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { LINKDEAD_GRACE_MS, planJoin } from '../server/linkdead';
import {
  isTransientReconnectRejection,
  isTransientTimeoutRejection,
  MAX_CONFLICT_REJECTIONS,
  MAX_TIMEOUT_REJECTIONS,
  RECONNECT_CONFLICT_ERROR,
  RECONNECT_TIMEOUT_ERROR,
} from '../src/net/reconnect_policy';

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

// Simulate the transport-level drop: the real WebSocketServer close/error
// handlers in server/main.ts call game.socketClosed(session, ws).
function dropSocket(server: GameServer, session: ClientSession, ws: any): boolean {
  ws.readyState = 3; // CLOSED
  return server.socketClosed(session, ws);
}

describe('planJoin (pure decision core)', () => {
  const base = { accountId: 7, isGm: false, liveOtherSessions: 0, maxPerAccount: 1 };

  it('resumes the same character when its held session is linkdead and same-account', () => {
    expect(
      planJoin({ ...base, sameCharacter: { accountId: 7, linkdead: true, left: false } }),
    ).toEqual({
      action: 'resume',
    });
  });

  it('rejects the same character while its session socket is still live', () => {
    expect(
      planJoin({ ...base, sameCharacter: { accountId: 7, linkdead: false, left: false } }),
    ).toEqual({
      action: 'reject',
      error: 'character already in world',
    });
  });

  it('never resumes a session already mid-teardown (left), even linkdead same-account', () => {
    // A fire-and-forget leave() (grace expiry, logout) has set left=true and is
    // parked on its save await: its sim entity and lease row are about to be
    // destroyed, so a resume would hand the client a zombie session whose lease
    // release the nonce fence cannot see (the resume arm never re-acquires).
    // Reject with the transient conflict error instead; the client's reconnect
    // policy retries it, and the retry lands on the fresh-acquire arm.
    expect(
      planJoin({ ...base, sameCharacter: { accountId: 7, linkdead: true, left: true } }),
    ).toEqual({
      action: 'reject',
      error: 'character already in world',
    });
  });

  it('rejects a linkdead session owned by a different account (takeover stays explicit)', () => {
    expect(
      planJoin({ ...base, sameCharacter: { accountId: 8, linkdead: true, left: false } }),
    ).toEqual({
      action: 'reject',
      error: 'character already in world',
    });
  });

  it('lets a different character join over the account cap when the blockers are linkdead', () => {
    // liveOtherSessions excludes linkdead sessions; the caller displaces them
    expect(planJoin({ ...base, sameCharacter: null, liveOtherSessions: 0 })).toEqual({
      action: 'join',
    });
  });

  it('still enforces the per-account cap against live sessions', () => {
    expect(planJoin({ ...base, sameCharacter: null, liveOtherSessions: 1 })).toEqual({
      action: 'reject',
      error: 'too many characters on this account are already in the world',
    });
  });

  it('exempts GMs from the per-account cap', () => {
    expect(planJoin({ ...base, isGm: true, sameCharacter: null, liveOtherSessions: 1 })).toEqual({
      action: 'join',
    });
  });
});

describe('linkdead grace lifecycle', () => {
  it('holds the character in-world and online after a socket drop', () => {
    closePlaySession.mockClear();
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Heldin', 'warrior', null));

    expect(dropSocket(server, session, ws)).toBe(true);

    expect(session.linkdead).toBe(true);
    expect(session.left).toBe(false);
    expect(session.graceUntil).toBeGreaterThan(Date.now());
    expect(session.graceUntil).toBeLessThanOrEqual(Date.now() + LINKDEAD_GRACE_MS);
    // still in the world, still counted online, still online for friends
    expect(server.sim.entities.has(session.pid)).toBe(true);
    expect(server.clients.size).toBe(1);
    expect((server as any).sessionByCharacterId(101)).toBe(session);
    // the play-session analytics row stays open for the whole grace window
    expect(closePlaySession).not.toHaveBeenCalled();
  });

  it('zeroes held movement input at grace start', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Runner', 'warrior', null));
    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 1, mi: { f: 1, b: 0, tl: 0, tr: 0, sl: 0, sr: 0, j: 0 } }),
    );
    expect(server.sim.meta(session.pid)?.moveInput.forward).toBe(true);

    dropSocket(server, session, ws);

    expect(server.sim.meta(session.pid)?.moveInput.forward).toBe(false);
  });

  it('resumes the held session on a same-character re-join: same pid, fresh socket, full re-sync', () => {
    const server = new GameServer();
    const setTrackingConnection = vi.spyOn((server as any).botDetector, 'setTrackingConnection');
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Comeback', 'warrior', null));
    expect(setTrackingConnection).not.toHaveBeenCalled();
    server.handleMessage(
      session,
      JSON.stringify({ t: 'input', seq: 9, mi: { f: 0, b: 0, tl: 0, tr: 0, sl: 0, sr: 0, j: 0 } }),
    );
    session.sentEnts.set(4242, {} as any);
    dropSocket(server, session, ws);
    expect(setTrackingConnection).toHaveBeenCalledTimes(1);
    expect(setTrackingConnection).toHaveBeenCalledWith(session.botTrackingContext, false);

    const ws2 = fakeWs();
    const resumeMeta = {
      ip: '203.0.113.45',
      userAgent: 'Mozilla/5.0 linkdead-test',
      clientSeed: 'seed-after-resume',
    };
    const resumed = expectJoined(
      server.join(ws2, 11, 101, 'Comeback', 'warrior', null, false, resumeMeta),
    );

    expect(resumed).toBe(session);
    expect(resumed.linkdead).toBe(false);
    expect(resumed.graceUntil).toBe(0);
    expect(resumed.ws).toBe(ws2);
    expect(setTrackingConnection).toHaveBeenCalledTimes(2);
    expect(setTrackingConnection).toHaveBeenLastCalledWith(
      session.botTrackingContext,
      true,
      resumeMeta,
    );
    // per-connection wire/input state restarts so the new client gets a full
    // snapshot and its input sequence (restarting at 1) is acked correctly
    expect(resumed.lastInputSeq).toBe(0);
    expect(resumed.sentEnts.size).toBe(0);
    expect(resumed.selfHeavyDirty).toBe(true);
    expect(resumed.lastWireRev).toBe(-1);
    // the fresh socket got its hello
    const hello = ws2.send.mock.calls
      .map((c: any[]) => JSON.parse(c[0]))
      .find((m: any) => m.t === 'hello');
    expect(hello).toMatchObject({ pid: session.pid, name: 'Comeback', cls: 'warrior' });
    // one session, one character: no duplicates were created
    expect(server.clients.size).toBe(1);
  });

  it('ignores a late close event from the pre-resume socket', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Latecl', 'warrior', null));
    dropSocket(server, session, ws);
    const ws2 = fakeWs();
    expectJoined(server.join(ws2, 11, 101, 'Latecl', 'warrior', null));

    // the old transport's close/error fires after the resume: must be a no-op
    expect(server.socketClosed(session, ws)).toBe(false);
    expect(session.linkdead).toBe(false);
    expect(session.ws).toBe(ws2);
  });

  it('does not resurrect a kicked session when its socket close lands afterwards', async () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Kicked', 'warrior', null));

    server.disconnectAccount(11, 'moderation action');
    await vi.waitFor(() => {
      expect(session.left).toBe(true);
    });

    expect(server.socketClosed(session, ws)).toBe(false);
    expect(session.linkdead).toBe(false);
    expect(server.clients.size).toBe(0);
  });

  it('fully logs the character out when the grace window expires', async () => {
    closePlaySession.mockClear();
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Expired', 'warrior', null));
    dropSocket(server, session, ws);

    session.graceUntil = Date.now() - 1;
    (server as any).expireLinkdeadSessions();

    await vi.waitFor(() => {
      expect((server as any).sessionByCharacterId(101)).toBeNull();
    });
    expect(session.left).toBe(true);
    expect(server.sim.entities.has(session.pid)).toBe(false);
    expect(server.clients.size).toBe(0);
    expect(closePlaySession).toHaveBeenCalled();
  });

  it('leaves a not-yet-expired linkdead session alone on the expiry sweep', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Waiting', 'warrior', null));
    dropSocket(server, session, ws);

    (server as any).expireLinkdeadSessions();

    expect(session.left).toBe(false);
    expect(session.linkdead).toBe(true);
    expect(server.clients.size).toBe(1);
  });

  it("logging in on a different character displaces the account's linkdead session immediately", async () => {
    const server = new GameServer();
    const ws = fakeWs();
    const a = expectJoined(server.join(ws, 11, 101, 'Olda', 'warrior', null));
    dropSocket(server, a, ws);

    const b = expectJoined(server.join(fakeWs(), 11, 102, 'Newb', 'mage', null));

    expect(a.left).toBe(true);
    expect(b.characterId).toBe(102);
    expect(server.clients.size).toBe(1);
    await vi.waitFor(() => {
      expect((server as any).sessionByCharacterId(101)).toBeNull();
    });
    expect((server as any).sessionByCharacterId(102)).toBe(b);
    expect(server.sim.entities.has(a.pid)).toBe(false);
  });

  it("still blocks a second character while the first session's socket is live", () => {
    const server = new GameServer();
    expectJoined(server.join(fakeWs(), 11, 101, 'Livea', 'warrior', null));
    expect(server.join(fakeWs(), 11, 102, 'Liveb', 'mage', null)).toEqual({
      error: 'too many characters on this account are already in the world',
    });
  });

  it('rejects a linkdead character for a different account, but takeover still works', async () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Mine', 'warrior', null));
    dropSocket(server, session, ws);

    // another account cannot slide into the held session
    expect(server.join(fakeWs(), 12, 101, 'Mine', 'warrior', null)).toEqual({
      error: 'character already in world',
    });

    // the owner's explicit takeover tears the held session down
    expect(await server.takeOverCharacter(11, 101)).toBe('taken-over');
    await vi.waitFor(() => {
      expect((server as any).sessionByCharacterId(101)).toBeNull();
    });
    expectJoined(server.join(fakeWs(), 11, 101, 'Mine', 'warrior', null));
  });

  it('adjusts per-IP session counts when a resume arrives from a different IP', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Roamer', 'warrior', null, false, { ip: '198.51.100.1' }),
    );
    expect(server.countIpSessions('198.51.100.1')).toBe(1);
    dropSocket(server, session, ws);
    // the held session keeps its IP slot during grace (the hard cap counts it)
    expect(server.countIpSessions('198.51.100.1')).toBe(1);

    expectJoined(
      server.join(fakeWs(), 11, 101, 'Roamer', 'warrior', null, false, { ip: '198.51.100.2' }),
    );

    expect(server.countIpSessions('198.51.100.1')).toBe(0);
    expect(server.countIpSessions('198.51.100.2')).toBe(1);
  });

  it('keepalive sweep pings live sessions and holds a pong-silent socket linkdead', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Blackhole', 'warrior', null));

    // first sweep: ping goes out, pong now outstanding
    server.pingLiveSessions();
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(session.awaitingPong).toBe(true);

    // the pong arrives (ws_auth wires ws 'pong' to clear the flag): the next
    // sweep pings again instead of terminating
    session.awaitingPong = false;
    server.pingLiveSessions();
    expect(ws.ping).toHaveBeenCalledTimes(2);
    expect(ws.terminate).not.toHaveBeenCalled();

    // no pong before the following sweep: black-holed socket, terminated
    // into the linkdead grace (never a full logout)
    server.pingLiveSessions();
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(session.linkdead).toBe(true);
    expect(session.left).toBe(false);
    expect(server.clients.size).toBe(1);
  });

  it('keepalive sweep leaves linkdead sessions alone and resume clears the pong flag', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Pongreset', 'warrior', null));
    server.pingLiveSessions();
    dropSocket(server, session, ws);

    server.pingLiveSessions();
    expect(ws.terminate).not.toHaveBeenCalled();

    const resumed = expectJoined(server.join(fakeWs(), 11, 101, 'Pongreset', 'warrior', null));
    expect(resumed.awaitingPong).toBe(false);
  });

  it('resume sends no self entered-the-world notice (the player never saw themselves leave)', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Quietback', 'warrior', null));
    dropSocket(server, session, ws);

    const ws2 = fakeWs();
    expectJoined(server.join(ws2, 11, 101, 'Quietback', 'warrior', null));

    const frames = ws2.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    const enteredNotice = frames.find(
      (f: any) =>
        f.t === 'events' && f.list?.some((ev: any) => String(ev.text ?? '').includes('entered')),
    );
    expect(enteredNotice).toBeUndefined();
  });

  it('skips snapshot building for linkdead sessions', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Quiet', 'warrior', null));
    dropSocket(server, session, ws);
    ws.send.mockClear();

    (server as any).broadcastSnapshots();

    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('reconnect policy (client-side conflict tolerance)', () => {
  it('tolerates the in-world conflict only while a reconnect is in flight', () => {
    expect(isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, 1, 0)).toBe(true);
    // not reconnecting (a fresh char-select join): the takeover prompt path
    expect(isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, 0, 0)).toBe(false);
  });

  it('never tolerates any other server rejection', () => {
    expect(isTransientReconnectRejection('character taken over', 3, 0)).toBe(false);
    expect(isTransientReconnectRejection('not authenticated', 3, 0)).toBe(false);
    expect(isTransientReconnectRejection(undefined, 3, 0)).toBe(false);
  });

  it('gives up after the bounded number of conflict rejections (a real takeover stays fatal)', () => {
    expect(
      isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, 5, MAX_CONFLICT_REJECTIONS - 1),
    ).toBe(true);
    expect(
      isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, 5, MAX_CONFLICT_REJECTIONS),
    ).toBe(false);
  });

  it('matches the exact wire string planJoin sends', () => {
    const plan = planJoin({
      accountId: 7,
      isGm: false,
      sameCharacter: { accountId: 7, linkdead: false, left: false },
      liveOtherSessions: 0,
      maxPerAccount: 1,
    });
    expect(plan).toEqual({ action: 'reject', error: RECONNECT_CONFLICT_ERROR });
  });

  it('tolerates the auth-timeout rejection only while a reconnect is in flight', () => {
    expect(isTransientTimeoutRejection('authentication timed out', 1, 0)).toBe(true);
    // a fresh character-select join (not reconnecting) must stay fatal
    expect(isTransientTimeoutRejection('authentication timed out', 0, 0)).toBe(false);
  });

  it('gives up after its own bounded run of timeout rejections, and pins both bounds', () => {
    expect(
      isTransientTimeoutRejection('authentication timed out', 5, MAX_TIMEOUT_REJECTIONS - 1),
    ).toBe(true);
    expect(isTransientTimeoutRejection('authentication timed out', 5, MAX_TIMEOUT_REJECTIONS)).toBe(
      false,
    );
    // the two transient windows carry different, literally-pinned bounds, so a
    // silent change to either reds here
    expect(MAX_TIMEOUT_REJECTIONS).toBe(20);
    expect(MAX_CONFLICT_REJECTIONS).toBe(8);
  });

  it('keeps the timeout and conflict predicates independent by string and by counter', () => {
    // cross-string: neither predicate fires on the other's wire string
    expect(isTransientTimeoutRejection(RECONNECT_CONFLICT_ERROR, 3, 0)).toBe(false);
    expect(isTransientReconnectRejection(RECONNECT_TIMEOUT_ERROR, 3, 0)).toBe(false);
    // cross-counter: each predicate bounds on its OWN counter. At a rejection count
    // of 8 (the conflict bound) the timeout predicate is still transient (its bound
    // is 20), while the conflict predicate has already given up. A shared counter
    // or a swapped bound would flip one of these.
    expect(isTransientTimeoutRejection(RECONNECT_TIMEOUT_ERROR, 3, MAX_CONFLICT_REJECTIONS)).toBe(
      true,
    );
    expect(
      isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, 3, MAX_CONFLICT_REJECTIONS),
    ).toBe(false);
  });

  it('pins the auth-timeout wire string byte-identical to the server literal', () => {
    // Must equal the server's WS_AUTH_ERROR.authTimedOut value (server/ws_auth.ts,
    // sent by the first-frame auth timer in onConnection).
    expect(RECONNECT_TIMEOUT_ERROR).toBe('authentication timed out');
    // That table is a private const, not exported, so the server side is pinned
    // by source text: renaming or rewording the table entry there reds this test
    // until the client constant moves in the same change (the conflict literal
    // gets the equivalent guard through the planJoin call above).
    const wsAuthSource = readFileSync(new URL('../server/ws_auth.ts', import.meta.url), 'utf8');
    expect(wsAuthSource).toContain("authTimedOut: 'authentication timed out',");
    // The conflict literal has a SECOND live server copy in this same table
    // (the lease-acquire reject), which the planJoin call above cannot see:
    // pin it in the same source scan so rewording only that copy cannot
    // silently turn tolerated reconnect conflicts fatal.
    expect(wsAuthSource).toContain("alreadyInWorld: 'character already in world',");
  });

  it('never tolerates any other server rejection under the timeout predicate', () => {
    expect(isTransientTimeoutRejection('character taken over', 3, 0)).toBe(false);
    expect(isTransientTimeoutRejection('not authenticated', 3, 0)).toBe(false);
    expect(isTransientTimeoutRejection(undefined, 3, 0)).toBe(false);
  });

  it('treats the realm-full rejection as FATAL under both predicates (a fresh join is not retried)', () => {
    // The realm admission cap refusal (server/ws_auth.ts WS_AUTH_ERROR.realmFull,
    // the exact literal 'realm is full') matches NEITHER transient predicate, so a
    // reconnect gives up rather than hammering a realm that is at capacity. Pinned
    // mid-retry (attempts 3) with fresh rejection counters (0) so the false result
    // comes from the string not matching, not from a spent bound.
    expect(isTransientReconnectRejection('realm is full', 3, 0)).toBe(false);
    expect(isTransientTimeoutRejection('realm is full', 3, 0)).toBe(false);
  });

  it('treats the too-many-connections refusal as FATAL under both predicates (the refusal is not retried)', () => {
    // The per-IP hard-limit refusal (server/ws_auth.ts WS_AUTH_ERROR.tooManyConnections,
    // the exact literal 'too many connections from your network') matches NEITHER transient
    // predicate, so a reconnect surfaces it to the player instead of silently hammering the
    // same network cap. Pinned mid-retry (attempts 3) with fresh rejection counters (0) so
    // the false result comes from the string not matching, not from a spent bound.
    expect(isTransientReconnectRejection('too many connections from your network', 3, 0)).toBe(
      false,
    );
    expect(isTransientTimeoutRejection('too many connections from your network', 3, 0)).toBe(false);
  });
});

describe('deliberate logout skips linkdead grace', () => {
  it("a t:'logout' message leaves the session immediately, not linkdead", async () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(
      server.join(ws, 11, 101, 'Quitter', 'warrior', null, false, { leaseNonce: 'nonce-logout' }),
    );
    const release = vi.mocked(releaseCharacterLease);
    release.mockClear();

    server.handleMessage(session, JSON.stringify({ t: 'logout' }));

    // session.left is set synchronously so socketClosed (page-unload close)
    // cannot enter linkdead grace
    expect(session.left).toBe(true);
    expect(session.linkdead).toBe(false);

    // the subsequent WebSocket close from the page reload is now a no-op
    expect(server.socketClosed(session, ws)).toBe(false);
    expect(session.linkdead).toBe(false);

    // character is gone, not held in-world
    await vi.waitFor(() => {
      expect((server as any).sessionByCharacterId(101)).toBeNull();
    });
    expect(server.clients.size).toBe(0);
    expect(server.sim.entities.has(session.pid)).toBe(false);

    // The logout funnels through leave(), which releases the character load
    // lease with the session's OWN nonce (the fence). Without this, every
    // deliberate logout would leak its lease row and lock the character out of
    // other realm processes for the full TTL.
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledTimes(1);
    });
    expect(release).toHaveBeenCalledWith(101, 'nonce-logout');
  });

  it('allows a fresh join on the same character after a t:logout', async () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Loggedout', 'warrior', null));
    server.handleMessage(session, JSON.stringify({ t: 'logout' }));

    await vi.waitFor(() => {
      expect((server as any).sessionByCharacterId(101)).toBeNull();
    });

    // no "character already in world" after a deliberate logout
    const fresh = expectJoined(server.join(fakeWs(), 11, 101, 'Loggedout', 'warrior', null));
    expect(fresh.characterId).toBe(101);
    expect(fresh.left).toBe(false);
  });
});
