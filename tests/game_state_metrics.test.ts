// Wiring tests for the game-state metrics end to end through a live GameServer
// (server/game.ts) and the exporter registration (server/http/game_metrics.ts):
// the gauges reflect real joined sessions/accounts/entities at scrape time, and the
// throughput counters increment at their real emission sites (inbound ws
// dispatch, outbound send, chat routing, the inbound gate and lane drop sites,
// the flood kick, and the input seq-gap read) via the process-wide slot
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
import {
  type GameMetricsCounters,
  noopGameMetricsCounters,
  setGameMetricsCounters,
  type WsDropCause,
} from '../server/http/game_signals';
import { isLive, registerLivenessSource, resetHealthForTests } from '../server/http/health';
import {
  MSG_LANE_CHAT_BURST,
  MSG_LANE_COMMAND_BURST,
  MSG_LANE_MOVEMENT_BURST,
} from '../server/msg_lanes';
import {
  MSG_ABUSE_SECOND_DROP_FLOOR,
  MSG_BYTE_BURST,
  MSG_RATE_BURST,
  MSG_RATE_REFILL_PER_SECOND,
  MSG_SEQ_GAP_SANITY,
} from '../server/msg_rate_limit';
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

// ---------------------------------------------------------------------------
// Inbound drop, kick, and seq-gap counters (R8, R9): recording-fake pins that
// GameServer emits each counter at its exact site, driven through the real
// handleMessage with a fake Date clock (the tests/msg_lanes.test.ts pattern).
// ---------------------------------------------------------------------------

/** A recording GameMetricsCounters sink: every emission lands in plain arrays. */
function recordingSink() {
  let wsIn = 0;
  let rateKicks = 0;
  let chats = 0;
  const dropped: WsDropCause[] = [];
  const seqGaps: number[] = [];
  const sink: GameMetricsCounters = {
    wsMessage(direction) {
      if (direction === 'in') wsIn++;
    },
    wsMessageDropped(cause) {
      dropped.push(cause);
    },
    wsRateKick() {
      rateKicks++;
    },
    wsInputSeqGap(missed) {
      seqGaps.push(missed);
    },
    chatMessage() {
      chats++;
    },
    characterCreated() {},
  };
  return {
    sink,
    dropped,
    seqGaps,
    wsIn: () => wsIn,
    rateKicks: () => rateKicks,
    chats: () => chats,
  };
}

/** A fake client whose ws also records close(), for the kick teardown pins. */
function kickableWs() {
  const sent: string[] = [];
  let closed = false;
  return {
    sent,
    closed: () => closed,
    ws: {
      readyState: 1,
      bufferedAmount: 0,
      send: (payload: string) => sent.push(payload),
      close: () => {
        closed = true;
      },
    },
  };
}

function inputFrame(seq: number): string {
  return JSON.stringify({ t: 'input', seq, mi: { f: 1 }, facing: 0.25 });
}

// Lane-EXEMPT filler (classifyMsgLane 'exempt'): drains the pre-parse gate
// without drawing any lane token, so gate arms stay cause-pure.
const TELEMETRY_FRAME = JSON.stringify({ t: 'cmd', cmd: 'telemetry', apm: 42 });

function castFrame(): string {
  return JSON.stringify({ t: 'cmd', cmd: 'castSlot', slot: 0 });
}

function chatFrame(text: string): string {
  return JSON.stringify({ t: 'cmd', cmd: 'chat', text });
}

const GATE_T0 = 1_700_000_000_000;

describe('inbound drop, kick, and seq-gap counters at their emission sites', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(GATE_T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits cause rate on a gate drop while the inbound frame count still includes it', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    // Control: with gate tokens available a chat frame dispatches and routes.
    server.handleMessage(session, chatFrame('control'));
    expect(rec.chats()).toBe(1);

    // Drain the remaining frame burst at one frozen instant.
    for (let i = 1; i < MSG_RATE_BURST; i++) server.handleMessage(session, TELEMETRY_FRAME);
    expect(rec.dropped).toEqual([]);

    // The next frame is gate-dropped with cause rate. wsMessage in counted it
    // anyway (the R8 kept meaning: frames RECEIVED, before the verdict), and
    // the drop returned before dispatch: the chat never routed.
    server.handleMessage(session, chatFrame('starved'));
    expect(rec.dropped).toEqual(['rate']);
    expect(rec.wsIn()).toBe(MSG_RATE_BURST + 1);
    expect(rec.chats()).toBe(1);
    // A lone sub-floor drop throttles without ever kicking.
    expect(rec.rateKicks()).toBe(0);
    expect(server.clients.has(session.pid)).toBe(true);
    server.stop();
  });

  it('emits cause bytes exactly at the raw length byte budget boundary', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    // Eight 16 KiB frames spend the 128 KiB byte burst to exactly zero. The
    // boundary arithmetic is the phase-01-deferred wiring pin: handleMessage
    // must pass raw.length (the UTF-16 code-unit proxy) as approxBytes, or the
    // first byte drop lands on a different frame. The filler char is one code
    // unit but two UTF-8 bytes, so a Buffer.byteLength implementation would
    // exhaust the budget by frame five and redden the empty-until-eight pin.
    // The frames are invalid JSON, dying before dispatch with no lane token.
    const frame = 'é'.repeat(16 * 1024);
    for (let i = 0; i < MSG_BYTE_BURST / frame.length; i++) server.handleMessage(session, frame);
    expect(rec.dropped).toEqual([]);

    server.handleMessage(session, frame);
    expect(rec.dropped).toEqual(['bytes']);
    expect(rec.rateKicks()).toBe(0);
    expect(server.clients.has(session.pid)).toBe(true);
    server.stop();
  });

  it('counts the gate kick once and tears the session down', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const fc = kickableWs();
    const session = join(server, fc, 100, 1, 'Ayla');

    // Five abusive receive-time seconds of pure gate drops: drain the burst,
    // then each second refills the rate allowance and thirty more sends book
    // thirty rate drops. The thirtieth drop of the fifth second is the kick.
    for (let sec = 0; sec < 5 && !session.left; sec++) {
      vi.setSystemTime(GATE_T0 + sec * 1000);
      const allowance = sec === 0 ? MSG_RATE_BURST : MSG_RATE_REFILL_PER_SECOND;
      for (let i = 0; i < allowance + MSG_ABUSE_SECOND_DROP_FLOOR && !session.left; i++) {
        server.handleMessage(session, TELEMETRY_FRAME);
      }
    }

    expect(rec.rateKicks()).toBe(1);
    // The kick verdict rode the crossing drop, which counts under both.
    expect(rec.dropped).toHaveLength(5 * MSG_ABUSE_SECOND_DROP_FLOOR);
    expect(rec.dropped.every((cause) => cause === 'rate')).toBe(true);
    expect(session.left).toBe(true);
    expect(server.clients.has(session.pid)).toBe(false);
    expect(fc.sent).toContain(JSON.stringify({ t: 'error', error: 'message rate exceeded' }));
    expect(fc.closed()).toBe(true);
    server.stop();
  });

  it('emits cause lane movement for a movement lane drop', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    // One past the movement burst at one instant, comfortably under the gate
    // burst: the only drop is the movement lane's.
    for (let i = 0; i < MSG_LANE_MOVEMENT_BURST + 1; i++) {
      server.handleMessage(session, inputFrame(i + 1));
    }
    expect(rec.dropped).toEqual(['lane_movement']);
    expect(rec.rateKicks()).toBe(0);
    expect(server.clients.has(session.pid)).toBe(true);
    server.stop();
  });

  it('emits cause lane command for a command lane drop', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    for (let i = 0; i < MSG_LANE_COMMAND_BURST + 1; i++) {
      server.handleMessage(session, castFrame());
    }
    expect(rec.dropped).toEqual(['lane_command']);
    expect(rec.rateKicks()).toBe(0);
    server.stop();
  });

  it('emits cause lane chat for a chat lane drop', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    // One past the chat lane burst at one instant. The in-handler ladder
    // refuses some of the passed subset without tallying any lane drop; only
    // the ninth frame is the lane's.
    for (let i = 0; i < MSG_LANE_CHAT_BURST + 1; i++) {
      server.handleMessage(session, chatFrame(`line ${i}`));
    }
    expect(rec.dropped).toEqual(['lane_chat']);
    expect(rec.rateKicks()).toBe(0);
    server.stop();
  });

  it('emits cause list read for a guarded readout refusal', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const host = server as unknown as {
      social: { ignoreList: (actor: unknown) => Promise<void> };
    };
    const listSpy = vi.spyOn(host.social, 'ignoreList').mockResolvedValue(undefined);

    // One readout past the guard burst at one instant: the refusal emits the
    // list_read cause and returns before the DB read (the phase 06 maintainer
    // ruling); the ten passed readouts ran their reads.
    for (let i = 0; i < 11; i++) {
      server.handleMessage(session, chatFrame('/ignorelist'));
    }
    expect(rec.dropped).toEqual(['list_read']);
    expect(listSpy).toHaveBeenCalledTimes(10);
    expect(rec.rateKicks()).toBe(0);
    server.stop();
  });

  it('counts a lane-driven kick through the same kick counter', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const fc = kickableWs();
    const session = join(server, fc, 100, 1, 'Ayla');

    // A 100 per second cast flood stays under the pre-parse refill entirely,
    // so every drop is the command lane's; the shared abuse window kicks on
    // the fifth abusive second (the msg_lanes kick arm, observed here through
    // the counter seam).
    for (let i = 0; i < 100 * 8 && !session.left; i++) {
      vi.setSystemTime(GATE_T0 + Math.floor((i * 1000) / 100));
      server.handleMessage(session, castFrame());
    }

    expect(rec.rateKicks()).toBe(1);
    expect(rec.dropped.length).toBeGreaterThan(0);
    expect(rec.dropped.every((cause) => cause === 'lane_command')).toBe(true);
    expect(session.left).toBe(true);
    expect(fc.closed()).toBe(true);
    server.stop();
  });

  it('books a seq gap only past the plus-one contiguity and adds the exact miss count', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    server.handleMessage(session, inputFrame(1));
    server.handleMessage(session, inputFrame(2));
    expect(rec.seqGaps).toEqual([]);
    // seq 5 after 2 proves seqs 3 and 4 were sent and never processed.
    server.handleMessage(session, inputFrame(5));
    expect(rec.seqGaps).toEqual([2]);
    // Contiguous resumption books nothing further.
    server.handleMessage(session, inputFrame(6));
    expect(rec.seqGaps).toEqual([2]);
    // A stale lower seq is not a forward gap and never books.
    server.handleMessage(session, inputFrame(4));
    expect(rec.seqGaps).toEqual([2]);
    expect(session.lastInputSeq).toBe(6);
    server.stop();
  });

  it('never books a gap from the zero high-water on a fresh join or a resume', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const fc = fakeWs();
    const session = join(server, fc, 100, 1, 'Ayla');

    // Fresh session: the first frame may land mid-stream, and the zero
    // high-water must swallow it without a gap.
    server.handleMessage(session, inputFrame(500));
    expect(rec.seqGaps).toEqual([]);
    expect(session.lastInputSeq).toBe(500);

    // Linkdead resume through the REAL path zeroes the high-water while the
    // client restarts its counter at one: the positive-high-water guard is
    // exactly what keeps this reset from booking a fictitious gap.
    server.socketClosed(session, fc.ws as never);
    expect(session.linkdead).toBe(true);
    const resumed = join(server, fakeWs(), 100, 1, 'Ayla');
    expect(resumed).toBe(session);
    expect(session.lastInputSeq).toBe(0);

    server.handleMessage(session, inputFrame(1));
    server.handleMessage(session, inputFrame(2));
    expect(rec.seqGaps).toEqual([]);
    expect(session.lastInputSeq).toBe(2);
    server.stop();
  });

  it('caps one gap observation at the seq gap sanity bound', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    server.handleMessage(session, inputFrame(1));
    server.handleMessage(session, inputFrame(2 + MSG_SEQ_GAP_SANITY + 500));
    expect(rec.seqGaps).toEqual([MSG_SEQ_GAP_SANITY]);
    server.stop();
  });

  it('attributes a movement lane drop to the seq gap on the next processed frame', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    // Saturate the movement lane at one instant: the last frame is
    // lane-dropped BEFORE its seq ever parses into the high-water, so the
    // drop itself books nothing.
    for (let i = 0; i < MSG_LANE_MOVEMENT_BURST + 1; i++) {
      server.handleMessage(session, inputFrame(i + 1));
    }
    expect(rec.dropped).toEqual(['lane_movement']);
    expect(session.lastInputSeq).toBe(MSG_LANE_MOVEMENT_BURST);
    expect(rec.seqGaps).toEqual([]);

    // A second later the lane has refilled; the next frame's seq proves
    // exactly the one shed frame was sent and never processed. This is R9's
    // meaning: the input-frame-attributed share of the server's own drops.
    vi.setSystemTime(GATE_T0 + 1000);
    server.handleMessage(session, inputFrame(MSG_LANE_MOVEMENT_BURST + 2));
    expect(rec.seqGaps).toEqual([1]);
    server.stop();
  });
});
