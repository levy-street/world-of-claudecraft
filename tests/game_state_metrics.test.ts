// Wiring tests for the game-state metrics end to end through a live GameServer
// (server/game.ts) and the exporter registration (server/http/game_metrics.ts):
// the gauges reflect real joined sessions/accounts/entities at scrape time, and the
// three throughput counters increment at their real emission sites (inbound ws
// dispatch, outbound send, chat routing) via the process-wide slot
// (server/http/game_signals.ts). The exporter's own unit tests
// (tests/server/http/game_metrics.test.ts) pin the exposition shape; this file pins
// that the GameServer actually feeds it.

import { Registry } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { isLive, registerLivenessSource, resetHealthForTests } from '../server/http/health';
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
    lastTickAt: () => server.lastTickAt(),
    loopStartedAt: () => server.loopStartedAt(),
  };
}

function value(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? Number(m[1]) : Number.NaN;
}

afterEach(() => {
  setGameMetricsCounters(noopGameMetricsCounters);
  resetHealthForTests();
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

// Fake timers so the 50 ms loop runs a bounded, deterministic number of passes and the
// wall clock advances on command. 'hrtime' MUST be faked alongside 'Date': the loop
// accumulates dt from process.hrtime, so advancing 50 ms of fake time is exactly one
// tick's worth (dt === DT) and the guarded body runs its inner sim.tick once per pass.
const LOOP_FAKE_TIMERS = ['setInterval', 'clearInterval', 'Date', 'hrtime'] as const;
// A fixed wall-clock base, so lastTickAt() lands on a known literal after one 50 ms pass.
const TICK_BASE_MS = 1_700_000_000_000;

describe('liveness wiring: isLive() tracks the live GameServer loop', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [...LOOP_FAKE_TIMERS] });
    vi.setSystemTime(TICK_BASE_MS);
    resetHealthForTests();
  });
  afterEach(() => {
    resetHealthForTests();
    vi.useRealTimers();
  });

  it('reads warmup as live, a completed pass as live, and a wedged loop as dead', () => {
    const server = new GameServer();
    // main.ts hands this exact source shape to registerLivenessSource; register it here
    // through the REAL health module so isLive() reads the real server's loop clock. If
    // main.ts ever fails to register a source, /livez answers 200 unconditionally in
    // production and the whole wedge-recovery chain (watchdog -> restart) is dead.
    registerLivenessSource(sourceOver(server));

    // Warmup: no pass completed yet, so /livez must answer live (never fail a booting
    // process). lastTickAt() is null here.
    expect(server.lastTickAt()).toBe(null);
    expect(isLive()).toBe(true);

    server.start();
    try {
      // One 50 ms interval completes a pass and stamps lastTickAt to now (base + 50).
      vi.advanceTimersByTime(50);
      expect(server.lastTickAt()).toBe(TICK_BASE_MS + 50);
      expect(isLive()).toBe(true);

      // Wedge: stop refreshing lastTickAt, then let 31 s of wall clock pass. A process
      // whose HTTP surface still answers but whose world loop has completed no pass in
      // over 30 s must read DEAD, so a watchdog can restart it.
      server.stop();
      vi.advanceTimersByTime(31_000);
      expect(isLive()).toBe(false);
    } finally {
      server.stop();
    }
  });

  it('stays live on a HEALTHY loop running past the window (loop start alone is stale)', () => {
    const server = new GameServer();
    registerLivenessSource(sourceOver(server));
    server.start();
    try {
      // The steady production state: the loop keeps completing passes for 31 s, so the
      // loop-start stamp alone is now PAST the staleness window while the completed-pass
      // stamp keeps refreshing. The completed pass must be what liveness reads: if the
      // read ever preferred the loop start (or dropped the completed pass), every
      // healthy server with over 30 s of uptime would answer 503 and the watchdog would
      // restart a working realm once per cooldown, forever.
      vi.advanceTimersByTime(31_000);
      expect(server.loopStartedAt()).toBe(TICK_BASE_MS);
      expect(Date.now() - TICK_BASE_MS).toBeGreaterThan(30_000);
      expect(server.lastTickAt()).toBe(TICK_BASE_MS + 31_000);
      expect(isLive()).toBe(true);
    } finally {
      server.stop();
    }
  });

  it('reads a loop that never completes its first pass as dead once past the window', () => {
    const server = new GameServer();
    registerLivenessSource(sourceOver(server));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Every tick throws from the very first one, so the loop NEVER completes a pass and
      // lastTickAt() stays null. runGuarded swallows the throw, so HTTP keeps answering:
      // this is the boot-time wedge that a null-is-warmup check would call healthy forever.
      (server as unknown as { sim: { tick: () => unknown } }).sim.tick = () => {
        throw new Error('boom');
      };
      server.start();
      // Right after start the loop-start backstop is fresh, so it still reads live (warmup).
      expect(server.lastTickAt()).toBe(null);
      expect(isLive()).toBe(true);
      // Past the window with no pass ever completed, the loop-start backstop makes it stale.
      // Without loopStartedAt(), lastTickAt() null would keep isLive() true for the process life.
      vi.advanceTimersByTime(31_000);
      expect(server.lastTickAt()).toBe(null);
      expect(server.loopStartedAt()).toBe(TICK_BASE_MS);
      expect(isLive()).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      server.stop();
    }
  });
});

describe('lastTickAt: the loop-liveness source (server/game.ts)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [...LOOP_FAKE_TIMERS] });
    vi.setSystemTime(TICK_BASE_MS);
    // The guarded tick body logs through console.error when it throws; silence it and
    // use the spy to prove the throwing path was actually taken.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('is null before the first pass and advances to a real timestamp after one', () => {
    const server = new GameServer();
    // No pass has completed, so the source reads null (warmup), never a live clock,
    // before the loop starts and again after start() but before the first 50 ms fire.
    expect(server.lastTickAt()).toBe(null);
    server.start();
    try {
      expect(server.lastTickAt()).toBe(null);
      vi.advanceTimersByTime(50);
      // Stamped at the END of the pass with the wall clock: this is the loop-liveness
      // signal /livez reads. If lastTickAt() ever returns Date.now() directly, it
      // silently reverts to PROCESS liveness and a wedged loop looks alive forever.
      expect(server.lastTickAt()).toBe(TICK_BASE_MS + 50);
    } finally {
      server.stop();
    }
  });

  it('does NOT advance when the tick body throws (a permanently-throwing loop goes stale)', () => {
    const server = new GameServer();
    server.start();
    try {
      vi.advanceTimersByTime(50);
      const afterFirstPass = server.lastTickAt();
      expect(afterFirstPass).toBe(TICK_BASE_MS + 50);

      // Make the guarded tick body throw. runGuarded swallows it, so the process keeps
      // answering HTTP, but the stamp is the LAST statement of the body, so a pass that
      // throws must leave it untouched. If the write moved before the throw (or the body
      // stopped being guarded), a loop that throws every tick would look permanently alive.
      (server as unknown as { sim: { tick: () => unknown } }).sim.tick = () => {
        throw new Error('boom');
      };
      vi.advanceTimersByTime(50);
      expect(errorSpy).toHaveBeenCalled();
      expect(server.lastTickAt()).toBe(afterFirstPass);
    } finally {
      server.stop();
    }
  });

  it('does NOT advance when a LATE step of the pass throws (the stamp is the last statement)', () => {
    const server = new GameServer();
    server.start();
    try {
      vi.advanceTimersByTime(50);
      const afterFirstPass = server.lastTickAt();
      expect(afterFirstPass).toBe(TICK_BASE_MS + 50);

      // flushPeriodicSaves is the final step before the stamp. A throw THERE must also
      // leave the stamp untouched: if the stamp ever moved earlier in the body (say,
      // right after sim.tick), a pass that died mid-save would still read as a completed
      // pass and a save-path wedge would look permanently alive.
      (server as unknown as { flushPeriodicSaves: () => void }).flushPeriodicSaves = () => {
        throw new Error('save wedge');
      };
      vi.advanceTimersByTime(50);
      expect(errorSpy).toHaveBeenCalled();
      expect(server.lastTickAt()).toBe(afterFirstPass);
    } finally {
      server.stop();
    }
  });
});

describe('lastTickAt stays out of the Prometheus exposition', () => {
  it('exposes no last-tick series (loop rate is covered by woc_sim_tick_hz)', async () => {
    const server = new GameServer();
    const registry = new Registry();
    setGameMetricsCounters(registerGameStateMetrics(registry, sourceOver(server)));
    const text = await registry.metrics();
    // game_metrics.ts promises lastTickAt() is NOT a gauge: it feeds /livez only. If it
    // leaked into the exposition it would publish a bare timestamp series no scraper
    // consumes; woc_sim_tick_hz already carries the achieved loop rate.
    expect(text).not.toMatch(/last_?tick/i);
    server.stop();
  });
});
