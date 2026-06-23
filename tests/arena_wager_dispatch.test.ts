// Exercises the REAL game.ts wager wiring: the WS command dispatch
// (wager_queue/wager_staked/wager_cancel), the arenaEnd -> onBoutEnd bridge, and
// the leave -> onLeave hook all route to the service. The ArenaWagerService is a
// recording fake (it is unit-tested separately in arena_wager_service.test.ts), so
// this proves the game.ts code paths I added actually execute and forward.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadMarketState: vi.fn(async () => null),
  saveMarketState: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer, type ClientSession } from '../server/game';
import type { SimEvent } from '../src/sim/types';

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

class FakeWagerService {
  calls: { fn: string; args: any[] }[] = [];
  handleQueue(...a: any[]) { this.calls.push({ fn: 'handleQueue', args: a }); return Promise.resolve(); }
  handleStaked(...a: any[]) { this.calls.push({ fn: 'handleStaked', args: a }); return Promise.resolve(); }
  handleCancel(...a: any[]) { this.calls.push({ fn: 'handleCancel', args: a }); }
  onArenaEnd(...a: any[]) { this.calls.push({ fn: 'onArenaEnd', args: a }); return Promise.resolve(); }
  onLeave(...a: any[]) { this.calls.push({ fn: 'onLeave', args: a }); }
}

function setup() {
  const server = new GameServer();
  const fc = fakeWs();
  const session = server.join(fc.ws as any, 1, 1, 'Aleph', 'warrior', null) as ClientSession;
  const wager = new FakeWagerService();
  (server as any).arenaWager = wager;
  return { server, session, wager, fc };
}
const cmd = (server: GameServer, session: ClientSession, c: Record<string, unknown>) =>
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...c }));

describe('game.ts wager dispatch wiring', () => {
  it('routes wager_queue to the service with the session + raw stake', () => {
    const { server, session, wager } = setup();
    cmd(server, session, { cmd: 'wager_queue', stake: '100000000' });
    expect(wager.calls).toContainEqual({ fn: 'handleQueue', args: [session, '100000000'] });
  });

  it('routes wager_staked with matchId + signature', () => {
    const { server, session, wager } = setup();
    cmd(server, session, { cmd: 'wager_staked', matchId: '7', signature: 'sig-abc' });
    expect(wager.calls).toContainEqual({ fn: 'handleStaked', args: [session, '7', 'sig-abc'] });
  });

  it('routes wager_cancel', () => {
    const { server, session, wager } = setup();
    cmd(server, session, { cmd: 'wager_cancel' });
    expect(wager.calls).toContainEqual({ fn: 'handleCancel', args: [session] });
  });

  it('is a no-op (no throw) when the wager service is not configured', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws as any, 2, 2, 'Bet', 'mage', null) as ClientSession;
    expect(() => cmd(server, session, { cmd: 'wager_queue', stake: '100000000' })).not.toThrow();
  });

  it('bridges arenaEnd events to onBoutEnd (only for events carrying a pid)', () => {
    const { server, session, wager } = setup();
    const events: SimEvent[] = [
      { type: 'arenaEnd', pid: session.pid, won: true, draw: false } as unknown as SimEvent,
      { type: 'arenaEnd', won: false, draw: false } as unknown as SimEvent, // no pid: skipped
      { type: 'log', text: 'x' } as unknown as SimEvent,
    ];
    (server as any).handleWagerArenaEnds(events);
    expect(wager.calls).toEqual([{ fn: 'onArenaEnd', args: [session.pid, true, false] }]);
  });

  it('dequeues a leaving player via onLeave', async () => {
    const { server, session, wager } = setup();
    await server.leave(session, 'test');
    expect(wager.calls).toContainEqual({ fn: 'onLeave', args: [session.pid] });
  });
});
