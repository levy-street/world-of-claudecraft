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
