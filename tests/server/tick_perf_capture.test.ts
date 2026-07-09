import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the tick-perf capture lifecycle is
// pure in-memory state on GameServer.
vi.mock('../../server/db', () => ({
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

import { GameServer, SIM_LAP_PHASES } from '../../server/game';
import { Sim } from '../../src/sim/sim';

// Drive the capture window the way the world loop does: advance sim ticks, feed the
// profiler a synthetic per-tick sample, then run the finalize check, until the window
// closes.
function runCaptureWindow(server: GameServer, perTickMs: number): void {
  const sim = (server as unknown as { sim: { tick: () => unknown; tickCount: number } }).sim;
  const profiler = (
    server as unknown as {
      tickProfiler: { add: (p: string, ms: number) => void; commit: (ms: number) => void };
    }
  ).tickProfiler;
  const finalize = (
    server as unknown as { finalizePerfCaptureIfDue: () => void }
  ).finalizePerfCaptureIfDue.bind(server);
  const endTick = (server as unknown as { perfCaptureEndsAtTick: number | null })
    .perfCaptureEndsAtTick;
  if (endTick === null) throw new Error('no capture in flight');
  let guard = 0;
  while (sim.tickCount < endTick) {
    if (++guard > 5000) throw new Error('capture window never closed');
    sim.tick();
    profiler.add('total', perTickMs);
    profiler.commit(perTickMs);
    finalize();
  }
}

const detailActive = (server: GameServer): boolean =>
  (server as unknown as { perfDetailActive: boolean }).perfDetailActive;

describe('tick perf capture lifecycle', () => {
  it('is idle before any capture', () => {
    const server = new GameServer();
    expect(server.perfCaptureStatus()).toEqual({ capturing: false, endsAt: null, last: null });
    expect(detailActive(server)).toBe(false);
  });

  it('freezes a result at the end of the window and reverts the detailed-timing switch', () => {
    const server = new GameServer();
    const before = Date.now();
    const started = server.startPerfCapture(3000);
    expect(started.capturing).toBe(true);
    expect(started.endsAt).not.toBeNull();
    expect(started.endsAt!).toBeGreaterThanOrEqual(before + 3000);
    // The detailed sub-phase timing is on for the duration of the window.
    expect(detailActive(server)).toBe(true);
    expect(server.perfCaptureStatus().capturing).toBe(true);

    runCaptureWindow(server, 7);

    const status = server.perfCaptureStatus();
    expect(status.capturing).toBe(false);
    expect(status.endsAt).toBeNull();
    // ...and the switch is back off so the steady-state loop pays nothing.
    expect(detailActive(server)).toBe(false);
    expect(status.last).not.toBeNull();
    expect(status.last!.durationMs).toBe(3000);
    expect(status.last!.online).toBe(0);
    // The frozen profile reflects the window's samples (7 ms every tick -> mean 7).
    expect(status.last!.profile.phases.total.mean).toBe(7);
    // A 3s window at 20 Hz is 60 committed ticks.
    expect(status.last!.profile.samples).toBe(60);
  });

  it('clamps the requested window to the [3s, 30s] bounds', () => {
    const duration = (server: GameServer): number =>
      (server as unknown as { perfCaptureDurationMs: number }).perfCaptureDurationMs;

    const low = new GameServer();
    low.startPerfCapture(10);
    expect(duration(low)).toBe(3000);

    const high = new GameServer();
    high.startPerfCapture(999_999);
    expect(duration(high)).toBe(30_000);

    const def = new GameServer();
    def.startPerfCapture();
    expect(duration(def)).toBe(10_000);
  });

  it('restarts the window on a second capture, discarding the earlier profiler state', () => {
    const server = new GameServer();
    server.startPerfCapture(3000);
    const firstEnd = (server as unknown as { perfCaptureEndsAtTick: number }).perfCaptureEndsAtTick;
    // A second start resets the profiler and schedules a fresh end tick further out.
    server.startPerfCapture(6000);
    const secondEnd = (server as unknown as { perfCaptureEndsAtTick: number })
      .perfCaptureEndsAtTick;
    expect(secondEnd).toBeGreaterThan(firstEnd);
    expect(server.perfCaptureStatus().capturing).toBe(true);
    expect(detailActive(server)).toBe(true);
  });

  it('resets the profiler at capture start, so the frozen window excludes prior samples', () => {
    const server = new GameServer();
    const profiler = (
      server as unknown as {
        tickProfiler: { add: (p: string, ms: number) => void; commit: (ms: number) => void };
      }
    ).tickProfiler;
    // Simulate the always-on loop having accumulated samples before the capture: a
    // window of 40 ticks at a very different cost than the capture will run at.
    for (let i = 0; i < 40; i++) {
      profiler.add('total', 99);
      profiler.commit(99);
    }

    server.startPerfCapture(3000);
    runCaptureWindow(server, 7);

    const last = server.perfCaptureStatus().last;
    expect(last).not.toBeNull();
    // Without the reset() in startPerfCapture the ring would hold 100 samples and the
    // mean would blend 99 and 7; the clean window keeps only the 60 capture ticks.
    expect(last!.profile.samples).toBe(60);
    expect(last!.profile.phases.total.mean).toBe(7);
  });

  it('emits only phase names the GameServer profiler has registered (no silently dropped timing)', () => {
    // TickProfiler.add() ignores an unregistered phase, so a lap?.('name') in
    // sim.tick() with no matching SIM_LAP_PHASES entry would drop that timing without
    // failing anything. Pin the sim's real emissions against the registry.
    const emitted = new Set<string>();
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      perfLap: (phase) => emitted.add(phase),
    });
    sim.addPlayer('warrior', 'PerfProbe'); // exercise the per-player lap phases too
    for (let i = 0; i < 5; i++) sim.tick();

    expect(emitted.size).toBeGreaterThan(0);
    const registered = new Set(SIM_LAP_PHASES);
    for (const phase of emitted) {
      expect(registered.has(`sim.${phase}`), `sim.${phase} is not in SIM_LAP_PHASES`).toBe(true);
    }
  });
});
