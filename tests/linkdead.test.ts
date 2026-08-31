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
import { VARKHUL_FORGE_PORTAL_ABILITY_ID } from '../src/sim/varkhul_forge_intermission';

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
      planJoin({
        ...base,
        sameCharacter: { accountId: 7, linkdead: true, left: false, escrowQuarantined: false },
      }),
    ).toEqual({
      action: 'resume',
    });
  });

  it('rejects the same character while its session socket is still live', () => {
    expect(
      planJoin({
        ...base,
        sameCharacter: { accountId: 7, linkdead: false, left: false, escrowQuarantined: false },
      }),
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
      planJoin({
        ...base,
        sameCharacter: { accountId: 7, linkdead: true, left: true, escrowQuarantined: false },
      }),
    ).toEqual({
      action: 'reject',
      error: 'character already in world',
    });
  });

  it('rejects a linkdead session owned by a different account (takeover stays explicit)', () => {
    expect(
      planJoin({
        ...base,
        sameCharacter: { accountId: 8, linkdead: true, left: false, escrowQuarantined: false },
      }),
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

  it('adopts an explicit mutedUntil/reason/strikes supplied on resume', () => {
    // resumeSession trusts meta.mutedUntil/reason/chatStrikes as-is: the race
    // that could make that snapshot stale (an admin /mute or the chat
    // filter's own optimistic mute landing on this exact still-linkdead
    // session while ws_auth.ts's account read is in flight) is fenced
    // upstream, before this value is ever computed (server/chat_mod_live.ts,
    // exercised end to end in tests/server/ws_auth.test.ts). This pins the
    // wiring half: an explicit fresh mute must actually reach the session.
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Muted', 'warrior', null));
    dropSocket(server, session, ws);
    expect(session.chatMutedUntil).toBeNull();

    const ws2 = fakeWs();
    const mutedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    const resumed = expectJoined(
      server.join(ws2, 11, 101, 'Muted', 'warrior', null, false, {
        mutedUntil,
        reason: 'spam',
        chatStrikes: 2,
      }),
    );

    expect(resumed.chatMutedUntil).toBe(new Date(mutedUntil).getTime());
    expect(resumed.chatMuteReason).toBe('spam');
    expect(resumed.chatStrikes).toBe(2);
  });

  it('resumes unmuted when nothing was ever muted and the resume meta carries no mute', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'NeverMuted', 'warrior', null));
    dropSocket(server, session, ws);
    expect(session.chatMutedUntil).toBeNull();

    const ws2 = fakeWs();
    const resumed = expectJoined(server.join(ws2, 11, 101, 'NeverMuted', 'warrior', null));

    expect(resumed.chatMutedUntil).toBeNull();
  });

  it('replays current forge portals once after the resumed socket receives its full snapshot', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Forgebck', 'warrior', null));
    const player = server.sim.entities.get(session.pid);
    if (!player) throw new Error('Player missing');
    const nearPortal = {
      type: 'spellfxAt' as const,
      x: player.pos.x + 2,
      z: player.pos.z,
      school: 'fire' as const,
      fx: 'burst' as const,
      sourceId: 9001,
      radius: 4,
      duration: 1.35,
      ability: VARKHUL_FORGE_PORTAL_ABILITY_ID,
    };
    vi.spyOn(server.sim, 'activeVarkhulForgePortalTelegraphs', 'get').mockReturnValue([
      nearPortal,
      { ...nearPortal, x: player.pos.x + 10_000 },
    ]);
    dropSocket(server, session, ws);
    const ws2 = fakeWs();
    expectJoined(server.join(ws2, 11, 101, 'Forgebck', 'warrior', null));

    (server as any).broadcastSnapshots();
    const firstFrames = ws2.send.mock.calls.map((call: any[]) => JSON.parse(call[0]));
    const snapIndex = firstFrames.findIndex((frame: any) => frame.t === 'snap');
    const portalIndex = firstFrames.findIndex(
      (frame: any) =>
        frame.t === 'events' &&
        frame.list?.some((event: any) => event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID),
    );
    expect(snapIndex).toBeGreaterThanOrEqual(0);
    expect(portalIndex).toBeGreaterThan(snapIndex);
    expect(firstFrames[portalIndex].list).toEqual([nearPortal]);

    (server as any).broadcastSnapshots();
    const allFrames = ws2.send.mock.calls.map((call: any[]) => JSON.parse(call[0]));
    expect(
      allFrames.filter(
        (frame: any) =>
          frame.t === 'events' &&
          frame.list?.some((event: any) => event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID),
      ),
    ).toHaveLength(1);
  });

  it('does not duplicate a forge portal event already delivered after resume', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Forgeevt', 'warrior', null));
    const player = server.sim.entities.get(session.pid);
    if (!player) throw new Error('Player missing');
    const portal = {
      type: 'spellfxAt' as const,
      x: player.pos.x + 2,
      z: player.pos.z,
      school: 'fire' as const,
      fx: 'burst' as const,
      sourceId: 9002,
      radius: 4,
      duration: 1.2,
      ability: VARKHUL_FORGE_PORTAL_ABILITY_ID,
    };
    vi.spyOn(server.sim, 'activeVarkhulForgePortalTelegraphs', 'get').mockReturnValue([portal]);
    dropSocket(server, session, ws);
    const ws2 = fakeWs();
    expectJoined(server.join(ws2, 11, 101, 'Forgeevt', 'warrior', null));
    ws2.send.mockClear();

    (server as any).routeEvents([portal]);
    (server as any).broadcastSnapshots();

    const frames = ws2.send.mock.calls.map((call: any[]) => JSON.parse(call[0]));
    expect(frames[0]).toMatchObject({ t: 'events', list: [portal] });
    expect(frames.some((frame: any) => frame.t === 'snap')).toBe(true);
    expect(
      frames.filter(
        (frame: any) =>
          frame.t === 'events' &&
          frame.list?.some((event: any) => event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID),
      ),
    ).toHaveLength(1);
  });

  it('keeps the replay armed for an out-of-range portal or an unrelated world effect', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Forgefar', 'warrior', null));
    const player = server.sim.entities.get(session.pid);
    if (!player) throw new Error('Player missing');
    const portal = {
      type: 'spellfxAt' as const,
      x: player.pos.x + 2,
      z: player.pos.z,
      school: 'fire' as const,
      fx: 'burst' as const,
      sourceId: 9003,
      radius: 4,
      duration: 1.1,
      ability: VARKHUL_FORGE_PORTAL_ABILITY_ID,
    };
    vi.spyOn(server.sim, 'activeVarkhulForgePortalTelegraphs', 'get').mockReturnValue([portal]);
    dropSocket(server, session, ws);
    const ws2 = fakeWs();
    expectJoined(server.join(ws2, 11, 101, 'Forgefar', 'warrior', null));
    ws2.send.mockClear();

    (server as any).routeEvents([
      { ...portal, x: player.pos.x + 10_000 },
      { ...portal, ability: 'Unrelated World Effect' },
    ]);
    expect(session.needsVarkhulPortalReplay).toBe(true);
    (server as any).broadcastSnapshots();

    const frames = ws2.send.mock.calls.map((call: any[]) => JSON.parse(call[0]));
    const snapIndex = frames.findIndex((frame: any) => frame.t === 'snap');
    const replayIndex = frames.findIndex(
      (frame: any) =>
        frame.t === 'events' &&
        frame.list?.some((event: any) => event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID),
    );
    expect(frames[0]).toMatchObject({
      t: 'events',
      list: [expect.objectContaining({ ability: 'Unrelated World Effect' })],
    });
    expect(snapIndex).toBeGreaterThan(0);
    expect(replayIndex).toBeGreaterThan(snapIndex);
    expect(frames[replayIndex].list).toEqual([portal]);
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

  it('disconnectAccount kicks every live session for the account unconditionally, even one authenticated with the same stolen bearer token', async () => {
    const server = new GameServer();
    const wsVictim = fakeWs();
    const wsAttacker = fakeWs();
    // Both sessions join as GM (isGm=true): MAX_ACTIVE_SESSIONS_PER_ACCOUNT caps an
    // account at one LIVE session, and GMs are the one exemption, which is the
    // simplest way to get two simultaneous live sessions for one account in this
    // test. A bearer token is a reusable wire credential, not a per-socket identity,
    // so an attacker holding a stolen/shared token can authenticate their own live
    // session with it; disconnectAccount must not spare either session by token
    // equality (a prior revision did exactly that, and it could just as easily have
    // spared the attacker's session instead of the victim's own).
    const victimSession = expectJoined(
      server.join(wsVictim, 11, 101, 'Victim', 'warrior', null, true),
    );
    const attackerSession = expectJoined(
      server.join(wsAttacker, 11, 102, 'Attacker', 'warrior', null, true),
    );

    server.disconnectAccount(11, 'credential change');
    await vi.waitFor(() => {
      expect(victimSession.left).toBe(true);
      expect(attackerSession.left).toBe(true);
    });

    expect(server.clients.has(victimSession.pid)).toBe(false);
    expect(server.clients.has(attackerSession.pid)).toBe(false);
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

describe('chat-moderation live-state pushes (server/chat_mod_live.ts wiring)', () => {
  // Each of these opens a hydration BEFORE calling the live-push method, the
  // same order a real reconnect race has it in (server/ws_auth.ts captures
  // the hydration before its DB reads; the push lands during those reads).
  // Proves the wiring, not just the pure fence (already covered directly in
  // tests/chat_mod_live.test.ts): deleting any pushMuteChange/pushStrikesChange
  // call in server/game.ts must fail one of these.
  const UNMUTED = { mutedUntil: null, reason: '', strikes: 0 };

  it('muteAccountChat pushes the mute into an in-flight hydration', () => {
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 11, 101, 'Muted', 'warrior', null));
    const hydration = server.beginChatModerationHydration(11);

    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    server.muteAccountChat(11, expiresAt, 'spam');

    expect(hydration.resolve(UNMUTED)).toEqual({
      mutedUntil: expiresAt,
      reason: 'spam',
      strikes: 0,
    });
    hydration.release();
  });

  it('liftChatMuteLive pushes the unmute into an in-flight hydration', () => {
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 11, 101, 'WasMuted', 'warrior', null));
    server.muteAccountChat(11, new Date(Date.now() + 60_000).toISOString(), 'spam');

    const hydration = server.beginChatModerationHydration(11);
    server.liftChatMuteLive(11);

    const dbMuted = { ...UNMUTED, mutedUntil: '2099-01-01T00:00:00.000Z' };
    expect(hydration.resolve(dbMuted)).toEqual(UNMUTED);
    hydration.release();
  });

  it('resetChatStrikesLive pushes the reset into an in-flight hydration', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Strikeout', 'warrior', null));
    session.chatStrikes = 2;

    const hydration = server.beginChatModerationHydration(11);
    server.resetChatStrikesLive(11);

    expect(hydration.resolve({ ...UNMUTED, strikes: 2 })).toEqual(UNMUTED);
    hydration.release();
  });
});

describe('reconnect policy (client-side conflict tolerance)', () => {
  it('tolerates the in-world conflict on the FIRST join attempt exactly like mid-reconnect', () => {
    // A roster row's online flag can lag a drop that happened seconds ago, so a
    // plain "Enter World" click (attempt zero, never a prior drop-and-retry in
    // this tab) can land in the same "server has not yet noticed the old socket
    // died" window a mid-session auto-reconnect does. A genuinely live conflict
    // (the character actively played elsewhere) has its own explicit UI, the
    // char-select Take Over button + confirm, which never reaches this path.
    expect(isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, 0)).toBe(true);
  });

  it('never tolerates any other server rejection', () => {
    expect(isTransientReconnectRejection('character taken over', 0)).toBe(false);
    expect(isTransientReconnectRejection('not authenticated', 0)).toBe(false);
    expect(isTransientReconnectRejection(undefined, 0)).toBe(false);
  });

  it('gives up after the bounded number of conflict rejections (a real takeover stays fatal)', () => {
    expect(
      isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, MAX_CONFLICT_REJECTIONS - 1),
    ).toBe(true);
    expect(isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, MAX_CONFLICT_REJECTIONS)).toBe(
      false,
    );
  });

  it('matches the exact wire string planJoin sends', () => {
    const plan = planJoin({
      accountId: 7,
      isGm: false,
      sameCharacter: { accountId: 7, linkdead: false, left: false, escrowQuarantined: false },
      liveOtherSessions: 0,
      maxPerAccount: 1,
    });
    expect(plan).toEqual({ action: 'reject', error: RECONNECT_CONFLICT_ERROR });
  });

  it('tolerates the auth-timeout rejection on the FIRST join attempt exactly like mid-reconnect', () => {
    expect(isTransientTimeoutRejection('authentication timed out', 0)).toBe(true);
  });

  it('gives up after its own bounded run of timeout rejections, and pins both bounds', () => {
    expect(
      isTransientTimeoutRejection('authentication timed out', MAX_TIMEOUT_REJECTIONS - 1),
    ).toBe(true);
    expect(isTransientTimeoutRejection('authentication timed out', MAX_TIMEOUT_REJECTIONS)).toBe(
      false,
    );
    // the two transient windows carry different, literally-pinned bounds, so a
    // silent change to either reds here
    expect(MAX_TIMEOUT_REJECTIONS).toBe(20);
    expect(MAX_CONFLICT_REJECTIONS).toBe(8);
  });

  it('keeps the timeout and conflict predicates independent by string and by counter', () => {
    // cross-string: neither predicate fires on the other's wire string
    expect(isTransientTimeoutRejection(RECONNECT_CONFLICT_ERROR, 0)).toBe(false);
    expect(isTransientReconnectRejection(RECONNECT_TIMEOUT_ERROR, 0)).toBe(false);
    // cross-counter: each predicate bounds on its OWN counter. At a rejection count
    // of 8 (the conflict bound) the timeout predicate is still transient (its bound
    // is 20), while the conflict predicate has already given up. A shared counter
    // or a swapped bound would flip one of these.
    expect(isTransientTimeoutRejection(RECONNECT_TIMEOUT_ERROR, MAX_CONFLICT_REJECTIONS)).toBe(
      true,
    );
    expect(isTransientReconnectRejection(RECONNECT_CONFLICT_ERROR, MAX_CONFLICT_REJECTIONS)).toBe(
      false,
    );
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
    expect(isTransientTimeoutRejection('character taken over', 0)).toBe(false);
    expect(isTransientTimeoutRejection('not authenticated', 0)).toBe(false);
    expect(isTransientTimeoutRejection(undefined, 0)).toBe(false);
  });

  it('treats the realm-full rejection as FATAL under both predicates (never retried, first attempt or later)', () => {
    // The realm admission cap refusal (server/ws_auth.ts WS_AUTH_ERROR.realmFull,
    // the exact literal 'realm is full') matches NEITHER transient predicate, so a
    // join gives up rather than hammering a realm that is at capacity. Pinned with
    // a fresh rejection counter (0) so the false result comes from the string not
    // matching, not from a spent bound.
    expect(isTransientReconnectRejection('realm is full', 0)).toBe(false);
    expect(isTransientTimeoutRejection('realm is full', 0)).toBe(false);
  });

  it('treats the too-many-connections refusal as FATAL under both predicates (the refusal is not retried)', () => {
    // The per-IP hard-limit refusal (server/ws_auth.ts WS_AUTH_ERROR.tooManyConnections,
    // the exact literal 'too many connections from your network') matches NEITHER transient
    // predicate, so a join surfaces it to the player instead of silently hammering the
    // same network cap. Pinned with a fresh rejection counter (0) so the false result
    // comes from the string not matching, not from a spent bound.
    expect(isTransientReconnectRejection('too many connections from your network', 0)).toBe(false);
    expect(isTransientTimeoutRejection('too many connections from your network', 0)).toBe(false);
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

describe('planJoin: an escrow-quarantined session is never resumed', () => {
  // A quarantined session's live state was abandoned: saveCharacter returns
  // early for it, forever. Resuming it inside the linkdead grace would hand
  // the player a session that plays normally and persists NOTHING, with no
  // error and no signal, which is silent unbounded data loss. The refusal is
  // transient by contract: the client's reconnect policy retries and lands on
  // a fresh join that loads the durable row, which is what the rollback wants.
  const base = { accountId: 7, isGm: false, liveOtherSessions: 0, maxPerAccount: 2 };
  it('refuses the resume it would otherwise allow', () => {
    const view = { accountId: 7, linkdead: true, left: false };
    expect(planJoin({ ...base, sameCharacter: { ...view, escrowQuarantined: false } })).toEqual({
      action: 'resume',
    });
    expect(planJoin({ ...base, sameCharacter: { ...view, escrowQuarantined: true } })).toEqual({
      action: 'reject',
      error: 'character already in world',
    });
  });
});
