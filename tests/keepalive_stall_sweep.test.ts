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

import { type ClientSession, GameServer } from '../server/game';
import { noteClientFrame, WS_SILENCE_DEADLINE_MS } from '../server/keepalive_sweep';

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

// Force the sweep to believe the previous run was `agoMs` in the past, so the next
// pingLiveSessions() call classifies itself as on time or stalled deterministically.
function backdateLastSweep(server: GameServer, agoMs: number): void {
  (server as unknown as { lastKeepaliveSweepAt: number }).lastKeepaliveSweepAt = Date.now() - agoMs;
}

describe('keepalive sweep under an event-loop stall', () => {
  it('re-arms instead of terminating when the sweep itself fired late, then terminates on the next on-time sweep', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Stalled', 'warrior', null));

    // First on-time sweep: a ping goes out and a pong is now outstanding.
    server.pingLiveSessions();
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(session.awaitingPong).toBe(true);

    // The process stalled longer than the stall threshold: the client's pong arrived
    // during the stall but was never processed, so awaitingPong is still set through no
    // fault of the client. This delayed sweep must terminate nobody and instead re-arm
    // every live session (ping again) so the next on-time sweep can judge honestly.
    backdateLastSweep(server, 70_000);
    server.pingLiveSessions();
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(session.awaitingPong).toBe(true);
    expect(ws.ping).toHaveBeenCalledTimes(2);
    expect(server.clients.size).toBe(1);

    // A genuinely black-holed socket still terminates after one clean missed interval:
    // the next on-time sweep sees awaitingPong still set and no stall to excuse it.
    server.pingLiveSessions();
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(session.linkdead).toBe(true);
    expect(session.left).toBe(false);
    expect(server.clients.size).toBe(1);
  });
});

// A socket that answers no frame at all (no pong, no input) for the whole
// WS_SILENCE_DEADLINE_MS is terminated into the linkdead grace by the NEXT sweep
// even when that sweep fired late. The pong check above deliberately pauses while
// the loop is stalled; without a hard deadline a black-holed socket on a
// chronically late server held its character 'already in world' with no bound,
// and the client's bounded reconnect gave up long before the socket was reaped.
describe('keepalive silence deadline in the sweep', () => {
  it('terminates a socket silent past the deadline even on a delayed sweep', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Silent', 'warrior', null));
    const t0 = Date.now();
    noteClientFrame(ws, t0 - WS_SILENCE_DEADLINE_MS - 60_000);

    // The previous sweep ran one deadline after the last processed frame, and the
    // process has stalled since (this sweep is late): the stall guard alone would
    // reap nobody, but silence proven up to the previous sweep is stall-proof.
    backdateLastSweep(server, 60_000);
    server.pingLiveSessions();
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(session.linkdead).toBe(true);
    expect(session.left).toBe(false);
    expect(server.clients.size).toBe(1);
  });

  it('keeps a quiet but answering client (an AFK player) in the world', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Afk', 'warrior', null));
    // Frames keep landing (the browser answers pings on its own), just under the
    // deadline each time.
    noteClientFrame(ws, Date.now() - WS_SILENCE_DEADLINE_MS + 1_000);
    backdateLastSweep(server, 30_000);
    server.pingLiveSessions();
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(session.linkdead).toBe(false);
  });

  it('does not judge a session whose socket has not produced a frame yet', () => {
    const server = new GameServer();
    const ws = fakeWs();
    expectJoined(server.join(ws, 11, 101, 'Fresh', 'warrior', null));
    backdateLastSweep(server, WS_SILENCE_DEADLINE_MS * 3);
    server.pingLiveSessions();
    expect(ws.terminate).not.toHaveBeenCalled();
  });
});
