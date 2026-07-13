// Wiring tests for the game-state metrics end to end through a live GameServer
// (server/game.ts) and the exporter registration (server/http/game_metrics.ts):
// the gauges reflect real joined sessions/accounts/entities at scrape time, and the
// three throughput counters increment at their real emission sites (inbound ws
// dispatch, outbound send, chat routing) via the process-wide slot
// (server/http/game_signals.ts). The exporter's own unit tests
// (tests/server/http/game_metrics.test.ts) pin the exposition shape; this file pins
// that the GameServer actually feeds it.

import { Registry } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed (mirrors tests/snapshots.test.ts).
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
  // The rest of the db surface GameServer's module graph imports (the
  // tests/character_lease_game.test.ts canonical shape): a partial mock stays
  // green only until a test path touches a missing name, then throws
  // "No X export is defined on the mock".
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import { type GameStateSource, registerGameStateMetrics } from '../server/http/game_metrics';
import { noopGameMetricsCounters, setGameMetricsCounters } from '../server/http/game_signals';
import type { PlayerClass } from '../src/sim/types';

interface FakeClient {
  sent: unknown[];
  ws: { readyState: number; send: (payload: string) => void; bufferedAmount: number };
}

function fakeWs(): FakeClient {
  const sent: unknown[] = [];
  return {
    sent,
    ws: { readyState: 1, bufferedAmount: 0, send: (payload: string) => sent.push(payload) },
  };
}

function join(
  server: GameServer,
  fc: FakeClient,
  accountId: number,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws as never, accountId, characterId, name, cls, null);
  if ('error' in session) throw new Error(`join failed: ${session.error}`);
  return session;
}

/** A source over the live server. wsConnections is bound to wss.clients.size in
 *  main.ts (no WebSocketServer in a unit test), so here it stands in as the joined
 *  session count; the exporter unit test pins its independent mapping. */
function sourceOver(server: GameServer): GameStateSource {
  return {
    playersOnline: () => server.clients.size,
    accountsOnline: () => server.liveAccountIds().size,
    wsConnections: () => server.clients.size,
    simEntities: () => server.sim.entities.size,
    simTickHz: () => server.simTickHz(),
    tickPhaseMillis: () => server.tickPhaseMillis(),
  };
}

function value(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? Number(m[1]) : Number.NaN;
}

afterEach(() => {
  setGameMetricsCounters(noopGameMetricsCounters);
});

describe('game-state metrics wiring: gauges reflect live GameServer state', () => {
  it('reports players_online and accounts_online from the live sessions', async () => {
    const server = new GameServer();
    const registry = new Registry();
    setGameMetricsCounters(registerGameStateMetrics(registry, sourceOver(server)));

    // One live session per account (MAX_ACTIVE_SESSIONS_PER_ACCOUNT is 1), so three
    // distinct accounts give three players across three accounts.
    join(server, fakeWs(), 100, 1, 'Ayla');
    join(server, fakeWs(), 200, 2, 'Bront');
    join(server, fakeWs(), 300, 3, 'Cyra');

    const text = await registry.metrics();
    expect(value(text, /^woc_players_online (\d+)$/m)).toBe(3);
    expect(value(text, /^woc_accounts_online (\d+)$/m)).toBe(3);
    // Each joined player is a sim entity; the world may also hold mobs.
    expect(value(text, /^woc_sim_entities (\d+)$/m)).toBeGreaterThanOrEqual(3);

    server.stop();
  });
});

describe('game-state metrics wiring: counters increment at their emission sites', () => {
  it('counts inbound ws frames on handleMessage', async () => {
    const server = new GameServer();
    const registry = new Registry();
    setGameMetricsCounters(registerGameStateMetrics(registry, sourceOver(server)));
    const fc = fakeWs();
    const session = join(server, fc, 100, 1, 'Ayla');

    // Every inbound frame is counted at the top of handleMessage, even an empty
    // object that dispatches to nothing.
    server.handleMessage(session, '{}');
    server.handleMessage(session, '{}');

    const text = await registry.metrics();
    expect(value(text, /^woc_ws_messages_total\{direction="in"\} (\d+)$/m)).toBe(2);

    server.stop();
  });

  it('counts outbound ws frames when the server sends', async () => {
    const server = new GameServer();
    const registry = new Registry();
    setGameMetricsCounters(registerGameStateMetrics(registry, sourceOver(server)));
    join(server, fakeWs(), 100, 1, 'Ayla');
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();

    const text = await registry.metrics();
    expect(value(text, /^woc_ws_messages_total\{direction="out"\} (\d+)$/m)).toBeGreaterThan(0);

    server.stop();
  });

  it('counts a routed chat message on the say channel', async () => {
    const server = new GameServer();
    const registry = new Registry();
    setGameMetricsCounters(registerGameStateMetrics(registry, sourceOver(server)));
    const fc = fakeWs();
    const session = join(server, fc, 100, 1, 'Ayla');

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: 'hello there' }));

    const text = await registry.metrics();
    expect(value(text, /^woc_chat_messages_total (\d+)$/m)).toBe(1);

    server.stop();
  });
});
