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

import type { CopperFlowSource, HarvestBand, HarvestTier } from '../server/economy_telemetry';
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
import { ITEMS } from '../src/sim/data';
import type { PlayerClass, SimEvent } from '../src/sim/types';

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
    dbPool: () => ({ total: 0, idle: 0, waiting: 0 }),
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
  const credited: Array<[CopperFlowSource, number]> = [];
  const spent: Array<[CopperFlowSource, number]> = [];
  const harvests: Array<[HarvestBand, HarvestTier]> = [];
  const fishingCasts: Array<[string, string]> = [];
  const fishingCatches: Array<[string, string, boolean]> = [];
  const fishingGotAways: Array<[string, string]> = [];
  const fishingEmptyHooks: Array<[string, string]> = [];
  const rodFees: string[] = [];
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
    copperCredited(source, amount) {
      credited.push([source, amount]);
    },
    copperSpent(source, amount) {
      spent.push([source, amount]);
    },
    harvest(band, tier) {
      harvests.push([band, tier]);
    },
    fishingCast(zone, band) {
      fishingCasts.push([zone, band]);
    },
    fishingCatch(zone, band, koi) {
      fishingCatches.push([zone, band, koi]);
    },
    fishingGotAway(zone, band) {
      fishingGotAways.push([zone, band]);
    },
    fishingEmptyHook(zone, band) {
      fishingEmptyHooks.push([zone, band]);
    },
    rodFeePaid(recipeId) {
      rodFees.push(recipeId);
    },
  };
  return {
    sink,
    dropped,
    seqGaps,
    credited,
    spent,
    harvests,
    fishingCasts,
    fishingCatches,
    fishingGotAways,
    fishingEmptyHooks,
    rodFees,
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

// ---------------------------------------------------------------------------
// Economy telemetry: the copper-flow sampler around one command dispatch and
// the per-band harvest counter on the tick's event pass. Recording-fake pins
// driven through the real handleMessage / detectActivity, same pattern as the
// drop and seq-gap counters above.
// ---------------------------------------------------------------------------

/** Put the player on top of an NPC so the vendor proximity checks pass. */
function placeOnNpc(server: GameServer, pid: number, templateId: string): void {
  const sim = server.sim as unknown as Record<string, any>;
  const npc = [...sim.entities.values()].find((e: any) => e.templateId === templateId);
  if (!npc) throw new Error(`npc ${templateId} not in world`);
  const player = sim.entities.get(pid);
  player.pos.x = npc.pos.x;
  player.pos.z = npc.pos.z;
  player.pos.y = npc.pos.y;
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
}

function vendorSellFrame(item: string, count: number): string {
  return JSON.stringify({ t: 'cmd', cmd: 'sell', item, count });
}

/** One granted node harvest, in the exact shape professions/gathering.ts emits.
 *  Typed through Extract rather than `as SimEvent`: a blanket cast would swallow
 *  a rename of the very field the counter reads (`nodeId` since the R3 zone
 *  re-key), leaving the server booking every harvest under the first band with
 *  this test still green. Real shipped node ids, because the band IS the
 *  node's zone now. */
type GatherResultEvent = Extract<SimEvent, { type: 'gatherResult' }>;
function harvestEvent(nodeId: string): SimEvent {
  const event: GatherResultEvent = {
    type: 'gatherResult',
    pid: 999,
    nodeId,
    nodeType: 'ore',
    professionId: 'mining',
    itemId: 'copper_ore',
    rarity: 'common',
    qty: 1,
    rareEvent: null,
  };
  return event;
}

describe('economy telemetry counters at their emission sites', () => {
  it('books a real vendor sale as a credit under the vendor surface', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const meta = server.sim.meta(session.pid) as unknown as Record<string, any>;
    placeOnNpc(server, session.pid, 'trader_wilkes');
    server.sim.addItem('bronze_sickle', 1, session.pid);
    meta.copper = 0;

    server.handleMessage(session, vendorSellFrame('bronze_sickle', 1));

    expect(meta.copper).toBe(ITEMS.bronze_sickle.sellValue);
    expect(rec.credited).toEqual([['vendor', ITEMS.bronze_sickle.sellValue]]);
    expect(rec.spent).toEqual([]);
    server.stop();
  });

  it('books a real vendor purchase as a spend, and the amount is the delta not the price list', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const meta = server.sim.meta(session.pid) as unknown as Record<string, any>;
    placeOnNpc(server, session.pid, 'trader_wilkes');
    meta.copper = 500;
    const npcId = [...(server.sim as unknown as Record<string, any>).entities.values()].find(
      (e: any) => e.templateId === 'trader_wilkes',
    ).id;

    // The tier-1 pick, not the tier-2 one this case used to buy: Eastbrook
    // stocks only the tier its own nodes use now, and the tier-2 rung also
    // asks for mining proficiency this fresh character has none of, so the
    // old purchase would be refused twice over and book no spend at all.
    // Either refusal would have made this case pass vacuously if it asserted
    // only that nothing unexpected was booked, which is why it asserts the
    // paid amount against the def.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'buy', npc: npcId, item: 'copper_mining_pick' }),
    );

    const paid = 500 - (meta.copper as number);
    expect(paid).toBe(ITEMS.copper_mining_pick.buyValue);
    expect(paid).toBeGreaterThan(0);
    expect(rec.spent).toEqual([['vendor', paid]]);
    expect(rec.credited).toEqual([]);
    server.stop();
  });

  it('books a count purchase as ONE whole-count spend; a non-number count degrades to one unit', () => {
    // The phase 21 telemetry claim, driven through the REAL dispatch: a
    // count-N frame books one larger vendor delta with zero telemetry
    // change, and the dispatch drops a non-number count the way sell's
    // does (the typeof filter), degrading to the ordinary single purchase
    // rather than a deny. This is also the one runtime pin on the buy arm's
    // count forwarding, complementing the source pins in
    // tests/vendor_buy_count.test.ts.
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const meta = server.sim.meta(session.pid) as unknown as Record<string, any>;
    placeOnNpc(server, session.pid, 'trader_wilkes');
    meta.copper = 500;
    const npcId = [...(server.sim as unknown as Record<string, any>).entities.values()].find(
      (e: any) => e.templateId === 'trader_wilkes',
    ).id;

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'buy', npc: npcId, item: 'copper_mining_pick', count: 3 }),
    );
    const paidTriple = 500 - (meta.copper as number);
    // Same guard as the sibling arm above: a zero catalog price would make
    // the count multiplication below pass vacuously.
    expect(paidTriple).toBeGreaterThan(0);
    expect(paidTriple).toBe(3 * (ITEMS.copper_mining_pick.buyValue as number));
    expect(rec.spent).toEqual([['vendor', paidTriple]]);

    meta.copper = 500;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'buy', npc: npcId, item: 'copper_mining_pick', count: '5' }),
    );
    const paidSingle = 500 - (meta.copper as number);
    expect(paidSingle).toBe(ITEMS.copper_mining_pick.buyValue);
    expect(rec.spent).toEqual([
      ['vendor', paidTriple],
      ['vendor', paidSingle],
    ]);
    server.stop();
  });

  it('books nothing at all when a command moves no copper', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const meta = server.sim.meta(session.pid) as unknown as Record<string, any>;
    meta.copper = 250;

    // A movement frame (the 20 Hz lane the sampler skips outright), a chat
    // line, and a denied sale: none of the three may book a sample.
    server.handleMessage(session, inputFrame(1));
    server.handleMessage(session, chatFrame('hello'));
    server.handleMessage(session, vendorSellFrame('bronze_sickle', 1)); // none held, no vendor

    expect(meta.copper).toBe(250);
    expect(rec.credited).toEqual([]);
    expect(rec.spent).toEqual([]);
    server.stop();
  });

  it('counts each granted harvest under its own ZONE band and node TIER (R3, R31)', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    // The real observer pass over a tick's events, fed one harvest per zone.
    // Bands are the node's zone since the R3 re-key: what it yields no longer
    // decides anything, where it stands does. The tier rides beside it (R31),
    // so a starter-zone bare-hands node and a tool-gated vein in the same
    // zone land on different series.
    (server as unknown as Record<string, any>).detectActivity([
      harvestEvent('ore_eastbrook_1'),
      harvestEvent('ore_mirefen_t2'),
      harvestEvent('ore_thornpeak_t3'),
      harvestEvent('ore_eastbrook_1'),
    ]);

    expect(rec.harvests).toEqual([
      ['eastbrook_vale', '1'],
      ['mirefen_marsh', '2'],
      ['thornpeak_heights', '3'],
      ['eastbrook_vale', '1'],
    ]);
    server.stop();
  });

  it('reads the tier off the same node the band came from, not off the band', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    // The arm that would break if the tier were derived from the zone (or
    // hardcoded): ONE zone carrying two different tiers must produce two
    // different label pairs, which is the whole R31 traveler-versus-capped read.
    (server as unknown as Record<string, any>).detectActivity([
      harvestEvent('ore_mirefen_1'),
      harvestEvent('ore_mirefen_t2'),
    ]);

    expect(rec.harvests).toEqual([
      ['mirefen_marsh', '1'],
      ['mirefen_marsh', '2'],
    ]);
    server.stop();
  });

  it('counts a harvest without needing a live session for the gatherer', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    // pid 999 has no ClientSession (a bot, or a player who left mid-tick). The
    // deed and levelup arms in this same loop filter on this.clients; the
    // harvest counter deliberately does not, because it measures the world.
    (server as unknown as Record<string, any>).detectActivity([harvestEvent('ore_thornpeak_t3')]);

    expect(rec.harvests).toEqual([['thornpeak_heights', '3']]);
    server.stop();
  });
});

// ---------------------------------------------------------------------------
// Fishing telemetry: the five outcome arms plus the rod-fee arm on the same
// single observer pass. Every event below is built through Extract rather than
// `as SimEvent` for the reason spelled out at harvestEvent: a blanket cast
// would swallow a rename of the very field the counter reads (zoneId, band,
// itemId, recipeId) and leave the server booking the wrong label with these
// tests still green.
// ---------------------------------------------------------------------------

/** Drive the tick's ONE observer pass directly. Typed through the method shape
 *  rather than an `any` cast (the broadcastSnapshots precedent above), so the
 *  event literals below stay checked against the real SimEvent union. */
function observe(server: GameServer, events: SimEvent[]): void {
  (server as unknown as { detectActivity(events: SimEvent[]): void }).detectActivity(events);
}

type CastStartEvent = Extract<SimEvent, { type: 'castStart' }>;
function castStartEvent(entityId: number, ability: string): SimEvent {
  const event: CastStartEvent = { type: 'castStart', entityId, ability, time: 0 };
  return event;
}

type FishingResultEvent = Extract<SimEvent, { type: 'fishingResult' }>;
function fishingResultEvent(zoneId: string, band: 0 | 1 | 2, itemId: string): SimEvent {
  const event: FishingResultEvent = {
    type: 'fishingResult',
    pid: 999,
    itemId,
    quality: 'common',
    zoneId,
    band,
  };
  return event;
}

type FishingGotAwayEvent = Extract<SimEvent, { type: 'fishingGotAway' }>;
function fishingGotAwayEvent(zoneId: string, band: 0 | 1 | 2): SimEvent {
  const event: FishingGotAwayEvent = { type: 'fishingGotAway', pid: 999, zoneId, band };
  return event;
}

type FishingEmptyHookEvent = Extract<SimEvent, { type: 'fishingEmptyHook' }>;
function fishingEmptyHookEvent(zoneId: string, band: 0 | 1 | 2): SimEvent {
  const event: FishingEmptyHookEvent = { type: 'fishingEmptyHook', pid: 999, zoneId, band };
  return event;
}

type TrainResultEvent = Extract<SimEvent, { type: 'trainResult' }>;
function trainResultEvent(recipeId: string, ok: boolean): SimEvent {
  const event: TrainResultEvent = ok
    ? { type: 'trainResult', pid: 999, ok: true, recipeId }
    : { type: 'trainResult', pid: 999, ok: false, recipeId, reason: 'train_cannot_afford' };
  return event;
}

describe('fishing telemetry counters at their emission sites', () => {
  it('counts a fishing cast under the water zone pinned on the caster', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const entity = server.sim.entities.get(session.pid);
    if (!entity) throw new Error('no entity for the joined session');
    // The zone the rod gate pinned at cast start. A cast has no dedicated
    // event, so this arm reads BOTH labels off the caster; the event itself
    // carries only the entity id and the ability.
    entity.fishCastZoneId = 'thornpeak_heights';

    observe(server, [castStartEvent(session.pid, 'fishing')]);

    // A fresh character has no rod and no proficiency, so the effective band
    // is 0 even though the water is Thornpeak's.
    expect(rec.fishingCasts).toEqual([['thornpeak_heights', '0']]);
    server.stop();
  });

  it('reads the cast band off the caster, not a constant', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const entity = server.sim.entities.get(session.pid);
    if (!entity) throw new Error('no entity for the joined session');
    const meta = server.sim.meta(session.pid) as unknown as Record<string, any>;
    entity.fishCastZoneId = 'mirefen_marsh';
    // Band 2 needs BOTH halves of effectiveFishingBand: the proficiency rung
    // and a rod whose tier covers it. Raise one at a time so a counter that
    // read only one of them still fails here.
    meta.gatheringProficiency.fishing = 200;
    observe(server, [castStartEvent(session.pid, 'fishing')]);
    // Proficiency alone is capped by the missing rod: still band 0.
    expect(rec.fishingCasts).toEqual([['mirefen_marsh', '0']]);

    server.sim.addItem('tidewrought_fishing_rod', 1, session.pid);
    observe(server, [castStartEvent(session.pid, 'fishing')]);
    expect(rec.fishingCasts).toEqual([
      ['mirefen_marsh', '0'],
      ['mirefen_marsh', '2'],
    ]);
    server.stop();
  });

  it('falls back to the caster position when no cast zone is pinned', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const entity = server.sim.entities.get(session.pid);
    if (!entity) throw new Error('no entity for the joined session');
    // A direct drive with no startFishing behind it leaves the pinned zone
    // empty; the arm resolves the zone from where the caster stands instead of
    // booking an empty label the sink would then drop.
    entity.fishCastZoneId = '';
    const spawnZone = 'eastbrook_vale';
    entity.pos.z = 300; // inside mirefen_marsh (zMin 180, zMax 540)

    observe(server, [castStartEvent(session.pid, 'fishing')]);

    expect(rec.fishingCasts).toEqual([['mirefen_marsh', '0']]);
    // Non-vacuity: the fallback moved the label off where the player spawned,
    // so this is a real position read and not a coincidence.
    expect(rec.fishingCasts[0][0]).not.toBe(spawnZone);
    server.stop();
  });

  it('ignores every cast that is not a fishing cast', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const entity = server.sim.entities.get(session.pid);
    if (!entity) throw new Error('no entity for the joined session');
    entity.fishCastZoneId = 'mirefen_marsh';

    // castStart is the world's GENERIC cast event: every ability and the
    // gathering cast share it. Only the fishing ability may book a cast, or
    // the denominator silently becomes "casts of anything".
    observe(server, [
      castStartEvent(session.pid, 'gather'),
      castStartEvent(session.pid, 'fireball'),
      castStartEvent(session.pid, ''),
    ]);

    expect(rec.fishingCasts).toEqual([]);
    server.stop();
  });

  it('books nothing for a fishing cast by an entity that is not a player', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    // An entity id with no entity (a caster who left mid-tick) and a live mob
    // with no PlayerMeta: neither can resolve a band, and guessing one would
    // put a fabricated rung into the distribution R4 reads.
    const mob = [...server.sim.entities.values()].find((e) => e.kind === 'mob');
    if (!mob) throw new Error('no mob in the world');
    observe(server, [castStartEvent(4242, 'fishing'), castStartEvent(mob.id, 'fishing')]);

    expect(rec.fishingCasts).toEqual([]);
    server.stop();
  });

  it('counts a landed catch under the zone and band the sim resolved', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    // The labels come off the EVENT, not off a server re-derivation: the sim
    // pinned the water zone at cast start and capped the band by the rod, and
    // re-deriving either here would drift from what actually rolled.
    observe(server, [
      fishingResultEvent('mirefen_marsh', 1, 'raw_marsh_pike'),
      fishingResultEvent('thornpeak_heights', 2, 'raw_stonescale_carp'),
    ]);

    expect(rec.fishingCatches).toEqual([
      ['mirefen_marsh', '1', false],
      ['thornpeak_heights', '2', false],
    ]);
    // A catch is not a got-away and not an empty hook.
    expect(rec.fishingGotAways).toEqual([]);
    expect(rec.fishingEmptyHooks).toEqual([]);
    server.stop();
  });

  it('flags the rare koi on the catch it rode in on, and only that one', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    observe(server, [
      fishingResultEvent('eastbrook_vale', 0, 'raw_mirror_trout'),
      fishingResultEvent('eastbrook_vale', 0, 'glimmerfin_koi'),
      fishingResultEvent('eastbrook_vale', 0, 'tangled_weed'),
    ]);

    // The koi flag is a per-catch split, not a per-band or per-tick one: the
    // catch either was the koi or was not.
    expect(rec.fishingCatches).toEqual([
      ['eastbrook_vale', '0', false],
      ['eastbrook_vale', '0', true],
      ['eastbrook_vale', '0', false],
    ]);
    server.stop();
  });

  it('counts a got-away and an empty hook on their own counters', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    observe(server, [
      fishingGotAwayEvent('eastbrook_vale', 0),
      fishingEmptyHookEvent('mirefen_marsh', 1),
      fishingGotAwayEvent('thornpeak_heights', 2),
    ]);

    expect(rec.fishingGotAways).toEqual([
      ['eastbrook_vale', '0'],
      ['thornpeak_heights', '2'],
    ]);
    expect(rec.fishingEmptyHooks).toEqual([['mirefen_marsh', '1']]);
    // Neither one is a catch: an empty hook counted as a catch would put the
    // koi odds denominator far above what actually landed.
    expect(rec.fishingCatches).toEqual([]);
    server.stop();
  });

  it('counts fishing outcomes without needing a live session for the angler', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    // pid 999 has no ClientSession, same as the harvest arm: bots fish too and
    // the series measures the world, not the logged-in subset.
    observe(server, [
      fishingResultEvent('mirefen_marsh', 1, 'glimmerfin_koi'),
      fishingGotAwayEvent('mirefen_marsh', 1),
      fishingEmptyHookEvent('mirefen_marsh', 1),
    ]);

    expect(rec.fishingCatches).toEqual([['mirefen_marsh', '1', true]]);
    expect(rec.fishingGotAways).toEqual([['mirefen_marsh', '1']]);
    expect(rec.fishingEmptyHooks).toEqual([['mirefen_marsh', '1']]);
    server.stop();
  });

  it('counts one rod fee payment per SUCCESSFUL rod training', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    observe(server, [
      trainResultEvent('recipe_stormreel_fishing_rod', true),
      trainResultEvent('recipe_tidewrought_fishing_rod', true),
    ]);

    expect(rec.rodFees).toEqual(['recipe_stormreel_fishing_rod', 'recipe_tidewrought_fishing_rod']);
    server.stop();
  });

  it('books no rod fee for a refused training or for a non-rod recipe', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);

    // Both controls matter and for different reasons. A refused training
    // charges nothing (Sim.trainRecipe debits only on ok), so counting it
    // would overstate the copper the fees took. A non-rod recipe trains
    // successfully and charges a fee, but it is not a ROD fee, and letting it
    // through would put an unbounded recipe vocabulary on the label.
    observe(server, [
      trainResultEvent('recipe_stormreel_fishing_rod', false),
      trainResultEvent('recipe_tidewrought_fishing_rod', false),
      trainResultEvent('recipe_bronze_sickle', true),
      trainResultEvent('', true),
      trainResultEvent('toString', true),
    ]);

    expect(rec.rodFees).toEqual([]);
    server.stop();
  });
});

describe('economy telemetry: the sampler edges', () => {
  it('still books the delta when the dispatch throws halfway through', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const meta = server.sim.meta(session.pid) as unknown as Record<string, any>;
    meta.copper = 500;

    // The property the sampler's placement after the catch exists for: a
    // command that moved coin and then blew up must not be silently unbooked.
    // Stub the sim call the 'buy' arm makes so it debits and then throws.
    const sim = server.sim as unknown as Record<string, any>;
    const realBuy = sim.buyItem;
    sim.buyItem = () => {
      meta.copper -= 60;
      throw new Error('exploded mid-purchase');
    };
    try {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'buy', npc: 1, item: 'x' }));
    } finally {
      sim.buyItem = realBuy;
    }

    expect(meta.copper).toBe(440);
    expect(rec.spent).toEqual([['vendor', 60]]);
    server.stop();
  });

  it('books nothing when the acting player is gone by the after-sample', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');
    const sim = server.sim as unknown as Record<string, any>;
    const meta = server.sim.meta(session.pid) as unknown as Record<string, any>;
    meta.copper = 500;

    // The guard's own case: the player record is gone by the time the after
    // sample reads it. Driven by removing the player inside the dispatch, since
    // a plain logout does NOT remove it synchronously (leave() is async, so the
    // meta is still there when the sampler runs). Without the guard the missing
    // read books a drain of the player's entire purse against 'vendor'.
    const realBuy = sim.buyItem;
    sim.buyItem = () => {
      sim.players.delete(session.pid);
    };
    try {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'buy', npc: 1, item: 'x' }));
    } finally {
      sim.buyItem = realBuy;
    }

    expect(server.sim.meta(session.pid)).toBeFalsy();
    expect(rec.spent).toEqual([]);
    expect(rec.credited).toEqual([]);
    server.stop();
  });

  it('survives a payload whose cmd cannot be coerced to a string', () => {
    const server = new GameServer();
    const rec = recordingSink();
    setGameMetricsCounters(rec.sink);
    const session = join(server, fakeWs(), 100, 1, 'Ayla');

    // String() throws on an object with a non-callable toString, and the
    // command name is read BEFORE the malformed-payload try. A frame like this
    // must be contained like any other garbage: no throw out of handleMessage,
    // and the frame still counted inbound.
    for (const frame of [
      '{"cmd":{"toString":1}}',
      '{"cmd":{"toString":null,"valueOf":null}}',
      '{"t":{"toString":1}}',
      '{"cmd":123}',
    ]) {
      expect(() => server.handleMessage(session, frame), frame).not.toThrow();
    }
    expect(rec.wsIn()).toBe(4);
    expect(rec.credited).toEqual([]);
    expect(rec.spent).toEqual([]);
    expect(session.left).toBe(false);
    server.stop();
  });
});
