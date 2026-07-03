import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the send/backpressure path is
// under test, mirroring snapshots.test.ts.
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

import { GameServer } from '../server/game';
import { WS_BACKPRESSURE_LIMIT_BYTES } from '../server/ws_backpressure';

// A fake socket whose unflushed buffer size and lifecycle we control. send()
// records frames; terminate() flips readyState and fires the 'close' handler
// the real WebSocketServer wires to game.leave().
function fakeWs(bufferedAmount: number) {
  const sent: string[] = [];
  const ws: any = {
    readyState: 1,
    bufferedAmount,
    sent,
    terminated: false,
    send: (payload: string) => sent.push(payload),
    terminate() {
      ws.terminated = true;
      ws.readyState = 3; // CLOSED
    },
  };
  return ws;
}

function join(server: GameServer, ws: any, id: number, name: string) {
  const session = server.join(ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

describe('WebSocket send backpressure', () => {
  let server: GameServer;
  beforeEach(() => {
    server = new GameServer();
  });

  it('terminates a session whose outbound buffer has grown past the limit', () => {
    const ws = fakeWs(WS_BACKPRESSURE_LIMIT_BYTES + 1);
    const session = join(server, ws, 1, 'Stuck');

    (server as any).broadcastSnapshots();

    expect(ws.terminated).toBe(true);
    expect(session.left).toBe(true);
    expect((server as any).clients.has(session.pid)).toBe(false);
    // nothing was pushed onto the already-saturated buffer
    expect(ws.sent.length).toBe(0);
  });

  it('keeps serving a healthy session that drains its socket', () => {
    const ws = fakeWs(0);
    const session = join(server, ws, 2, 'Healthy');

    (server as any).broadcastSnapshots();

    expect(ws.terminated).toBe(false);
    expect(session.left).toBe(false);
    expect((server as any).clients.has(session.pid)).toBe(true);
    expect(ws.sent.length).toBeGreaterThan(0);
  });

  it('does not starve other players when one session is stuck', () => {
    const stuck = fakeWs(WS_BACKPRESSURE_LIMIT_BYTES + 1);
    const healthy = fakeWs(0);
    join(server, stuck, 3, 'Stuck');
    const live = join(server, healthy, 4, 'Healthy');

    (server as any).broadcastSnapshots();

    expect(stuck.terminated).toBe(true);
    expect(healthy.terminated).toBe(false);
    expect((server as any).clients.has(live.pid)).toBe(true);
    expect(healthy.sent.length).toBeGreaterThan(0);
  });
});
