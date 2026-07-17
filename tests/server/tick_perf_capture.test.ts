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

import {
  GameServer,
  MOB_UPDATE_BUCKETS,
  mobZonePhase,
  type PerfCaptureResult as ServerPerfCaptureResult,
  SIM_LAP_PHASES,
  SIM_MOB_ZONE_PHASES,
} from '../../server/game';
import type { PerfCaptureResult as AdminPerfCaptureResult } from '../../src/admin/types';
import { MOBS, ZONES } from '../../src/sim/data';
import { createMob } from '../../src/sim/entity';
import { Sim } from '../../src/sim/sim';
import type { Entity, MobFamily } from '../../src/sim/types';
import { terrainHeight } from '../../src/sim/world';

// Compile-time assertion that T is exactly `never` (same idiom as the IWorld facet
// pins in tests/world_api_parity.test.ts). A MobFamily value with no matching
// MOB_UPDATE_BUCKETS entry would derive a bucket name TickProfiler never registered
// and silently drop its timing, so force union coverage here: adding a family to the
// union without a bucket makes Exclude<> non-never and tsc fails.
type AssertNever<T extends never> = T;
type _ExhaustMobFamilyBuckets = AssertNever<
  Exclude<MobFamily | 'other', (typeof MOB_UPDATE_BUCKETS)[number]>
>;

// The admin dashboard's PerfCaptureResult is a hand-maintained structural mirror of
// the server's; pin the four mob-scan capture fields in both directions so a rename
// or type drift on either side reddens tsc instead of silently desyncing the SPA.
type AssertTrue<T extends true> = T;
type MobScanCaptureFields =
  | 'aggroVisitsTotal'
  | 'aggroVisitsMaxPerTick'
  | 'threatVisitsTotal'
  | 'threatVisitsMaxPerTick';
type _AdminMirrorCarriesMobScanFields = AssertTrue<
  Pick<ServerPerfCaptureResult, MobScanCaptureFields> extends Pick<
    AdminPerfCaptureResult,
    MobScanCaptureFields
  >
    ? Pick<AdminPerfCaptureResult, MobScanCaptureFields> extends Pick<
        ServerPerfCaptureResult,
        MobScanCaptureFields
      >
      ? true
      : false
    : false
>;

// Drive 60 nominal samples into the capture, then move its wall deadline to now and
// finalize. Production closes on wall time; this helper keeps the percentile sample
// assertions deterministic without making the unit test wait three seconds.
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
  for (let i = 0; i < 60; i++) {
    sim.tick();
    profiler.add('total', perTickMs);
    profiler.commit(perTickMs);
  }
  (server as unknown as { perfCaptureDeadlineNs: bigint }).perfCaptureDeadlineNs = 0n;
  finalize();
}

const detailActive = (server: GameServer): boolean =>
  (server as unknown as { perfDetailActive: boolean }).perfDetailActive;

describe('tick perf capture lifecycle', () => {
  it('is idle before any capture', () => {
    const server = new GameServer();
    expect(server.perfCaptureStatus()).toEqual({
      captureId: null,
      capturing: false,
      endsAt: null,
      last: null,
    });
    expect(detailActive(server)).toBe(false);
  });

  it('freezes a result at the end of the window and reverts the detailed-timing switch', () => {
    const server = new GameServer();
    const before = Date.now();
    const started = server.startPerfCapture(3000);
    expect(started.capturing).toBe(true);
    expect(started.captureId).toMatch(/^[0-9a-f-]{36}$/);
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
    expect(status.last?.captureId).toBe(started.captureId);
    expect(status.last?.loopCallbacks).toBe(0);
    expect(status.last?.simTicks).toBe(0);
    expect(status.last!.durationMs).toBe(3000);
    expect(status.last!.online).toBe(0);
    // The four mob-scan capture fields are present as numbers. This harness drives
    // sim.tick() directly rather than the GameServer loop that accumulates them, so
    // they stay at their zeroed start value; the real-loop test at the bottom of
    // this file drives the non-zero sums.
    expect(status.last!.aggroVisitsTotal).toBe(0);
    expect(status.last!.aggroVisitsMaxPerTick).toBe(0);
    expect(status.last!.threatVisitsTotal).toBe(0);
    expect(status.last!.threatVisitsMaxPerTick).toBe(0);
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

  it('ends by wall time even when many sim ticks run during one saturated window', () => {
    const server = new GameServer();
    const profiler = (
      server as unknown as {
        tickProfiler: { commit: (ms: number) => void };
      }
    ).tickProfiler;
    const finalize = (
      server as unknown as { finalizePerfCaptureIfDue: () => void }
    ).finalizePerfCaptureIfDue.bind(server);
    server.startPerfCapture(3000);

    // Catch-up work can advance far more than 60 sim ticks without reaching the
    // monotonic deadline. It must not close the capture early.
    for (let i = 0; i < 100; i++) {
      server.sim.tick();
      profiler.commit(7);
      finalize();
    }
    expect(server.perfCaptureStatus().capturing).toBe(true);

    (server as unknown as { perfCaptureDeadlineNs: bigint }).perfCaptureDeadlineNs = 0n;
    finalize();
    expect(server.perfCaptureStatus().capturing).toBe(false);
  });

  it('records catch-up sim ticks separately from loop callbacks', () => {
    const server = new GameServer();
    server.startPerfCapture(3000);
    const internal = server as unknown as {
      recordPerfCaptureCallback: (ticksRun: number) => void;
      perfCaptureDeadlineNs: bigint;
      finalizePerfCaptureIfDue: () => void;
    };
    internal.recordPerfCaptureCallback(1);
    internal.recordPerfCaptureCallback(3);
    internal.recordPerfCaptureCallback(0);
    internal.perfCaptureDeadlineNs = 0n;
    internal.finalizePerfCaptureIfDue();

    expect(server.perfCaptureStatus().last).toMatchObject({
      loopCallbacks: 3,
      simTicks: 4,
      catchUpCallbacks: 1,
      maxTicksPerCallback: 3,
    });
  });

  it('restarts the window on a second capture, discarding the earlier profiler state', () => {
    const server = new GameServer();
    const first = server.startPerfCapture(3000);
    const firstEnd = (server as unknown as { perfCaptureEndsAtMs: number }).perfCaptureEndsAtMs;
    // A second start resets the profiler and schedules a fresh wall deadline further out.
    const second = server.startPerfCapture(6000);
    const secondEnd = (server as unknown as { perfCaptureEndsAtMs: number }).perfCaptureEndsAtMs;
    expect(secondEnd).toBeGreaterThan(firstEnd);
    expect(second.captureId).not.toBe(first.captureId);
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

  it('registers the 29 base lap names first, then the 13 mob-family buckets', () => {
    // Literal pins: the registry is built by mapping the base names plus the buckets
    // through `sim.${n}`, so comparing these literals against the derived array proves
    // the mapping, not a constant against itself.
    const base = [
      'sim.respawns',
      'sim.worldBosses',
      'sim.groundAoEs',
      'sim.despawnDecay',
      'sim.projectiles',
      'sim.p.move',
      'sim.p.doors',
      'sim.p.casting',
      'sim.p.autoAtk',
      'sim.p.regen',
      'sim.p.auras',
      'sim.mob.update',
      'sim.mob.auras',
      'sim.ent.misc',
      'sim.engaged',
      'sim.duels',
      'sim.cardDuel',
      'sim.arena',
      'sim.trades',
      'sim.lootRolls',
      'sim.instances',
      'sim.delves',
      'sim.valecup',
      'sim.dfinder',
      'sim.market',
      'sim.postOffice',
      'sim.delayedEv',
      'sim.deeds',
      'sim.gridRefresh',
    ];
    const buckets = [
      'sim.mob.update|beast',
      'sim.mob.update|humanoid',
      'sim.mob.update|mudfin',
      'sim.mob.update|spider',
      'sim.mob.update|burrower',
      'sim.mob.update|undead',
      'sim.mob.update|troll',
      'sim.mob.update|ogre',
      'sim.mob.update|elemental',
      'sim.mob.update|dragonkin',
      'sim.mob.update|demon',
      'sim.mob.update|reptile',
      'sim.mob.update|other',
    ];
    expect(base).toHaveLength(29);
    expect(buckets).toHaveLength(13);
    // Base names are byte-identical and first; the buckets are appended after and
    // nothing else, so every registered name still reaches the TickProfiler ctor.
    expect(SIM_LAP_PHASES.slice(0, 29)).toEqual(base);
    expect(SIM_LAP_PHASES.slice(29)).toEqual(buckets);
    // Each bucket is registered (present in the set the ctor pre-registers).
    const registered = new Set(SIM_LAP_PHASES);
    for (const name of buckets) {
      expect(registered.has(name), `${name} is not registered in SIM_LAP_PHASES`).toBe(true);
    }
    // The exported bucket list is exactly the MobFamily union values plus 'other'.
    expect(MOB_UPDATE_BUCKETS).toEqual([
      'beast',
      'humanoid',
      'mudfin',
      'spider',
      'burrower',
      'undead',
      'troll',
      'ogre',
      'elemental',
      'dragonkin',
      'demon',
      'reptile',
      'other',
    ]);
    // Exhaustiveness against the live content set (the runtime cousin of the
    // type-level _ExhaustMobFamilyBuckets pin at the top of this file): a family
    // used by MOBS but missing from MOB_UPDATE_BUCKETS would derive an unregistered
    // bucket name and its mob.update timing would be silently dropped.
    const familiesInContent = new Set(Object.values(MOBS).map((m) => m.family));
    expect(familiesInContent.size).toBeGreaterThan(0);
    for (const family of familiesInContent) {
      expect(MOB_UPDATE_BUCKETS, `family '${family}' has no registered bucket`).toContain(family);
    }
  });

  it('buckets a placed mob into its family lap end to end through the real probe', () => {
    // Drive the REAL injected cfg.perfLap probe (not a stub) across a capture window,
    // with a forest_wolf placed in the server's live world. A forest_wolf is family
    // 'beast', so every one of its per-entity mob.update laps must be attributed to
    // BOTH the aggregate 'sim.mob.update' and the 'sim.mob.update|beast' family bucket.
    const server = new GameServer();
    const sim = (server as unknown as { sim: { addEntity: (e: Entity) => void } }).sim;
    // Placed far outside the [-180, 180] world so it just idles alone for the window;
    // it still runs one updateMob (one mob.update lap) every tick it is alive.
    const wolf = createMob(900401, MOBS.forest_wolf, 5, { x: 500, y: 0, z: 500 });
    wolf.aiState = 'idle';
    sim.addEntity(wolf);

    // Record which lap names the profiler's add() is called with. The spy is
    // timing-independent: it proves the probe routed a beast mob's mob.update time to
    // the family bucket regardless of how small the measured ms rounds to.
    const profiler = (
      server as unknown as { tickProfiler: { add: (p: string, ms: number) => void } }
    ).tickProfiler;
    const addCalls = new Map<string, number>();
    const origAdd = profiler.add.bind(profiler);
    profiler.add = (phase: string, ms: number) => {
      addCalls.set(phase, (addCalls.get(phase) ?? 0) + 1);
      origAdd(phase, ms);
    };

    server.startPerfCapture(3000);
    runCaptureWindow(server, 7);

    // The placed wolf runs mob.update once per tick for all 60 committed ticks, so the
    // beast bucket is add()-ed at least 60 times (the world may hold other beasts too).
    expect(addCalls.get('sim.mob.update|beast') ?? 0).toBeGreaterThanOrEqual(60);
    // The aggregate mob.update lap fires for every mob, so it is add()-ed at least as
    // often as the beast-only bucket.
    expect(addCalls.get('sim.mob.update') ?? 0).toBeGreaterThanOrEqual(
      addCalls.get('sim.mob.update|beast') ?? 0,
    );
    // Pin the concrete beast attribution rather than "some bucket": the assertions
    // above name the family the placed forest_wolf resolves to, so a probe that stopped
    // bucketing (or bucketed to the wrong family) reddens this test.
    const last = server.perfCaptureStatus().last;
    expect(last).not.toBeNull();
    // The frozen profile exposes the registered beast bucket key (TickProfiler
    // pre-registers every SIM_LAP_PHASES name), and the spy above proves it carried the
    // wolf's timing.
    expect(Object.keys(last!.profile.phases)).toContain('sim.mob.update|beast');
  });

  it('routes a mob whose family does not resolve to the other bucket', () => {
    // The 'other' catch-all fires for any templateId whose family does not resolve. Real
    // MOBS all carry a family, so force the fallback with a test-only mutation: build a
    // real mob, then point its templateId at a string absent from MOBS. mobUpdateBucketName
    // then resolves undefined -> 'other', and the lap must land in 'sim.mob.update|other'
    // (registered, so TickProfiler.add never silently drops it).
    const server = new GameServer();
    const sim = (server as unknown as { sim: { addEntity: (e: Entity) => void } }).sim;
    const orphan = createMob(900402, MOBS.forest_wolf, 5, { x: 500, y: 0, z: 500 });
    orphan.templateId = 'not_a_real_mob_family_zzz'; // absent from MOBS -> family fallback
    orphan.aiState = 'idle';
    sim.addEntity(orphan);

    const profiler = (
      server as unknown as { tickProfiler: { add: (p: string, ms: number) => void } }
    ).tickProfiler;
    const addCalls = new Map<string, number>();
    const origAdd = profiler.add.bind(profiler);
    profiler.add = (phase: string, ms: number) => {
      addCalls.set(phase, (addCalls.get(phase) ?? 0) + 1);
      origAdd(phase, ms);
    };

    server.startPerfCapture(3000);
    runCaptureWindow(server, 7);

    // No real world mob resolves to 'other', so the only source of these adds is the
    // orphaned mob: one per tick across the 60-tick window.
    expect(addCalls.get('sim.mob.update|other') ?? 0).toBeGreaterThanOrEqual(60);
    const last = server.perfCaptureStatus().last;
    expect(last).not.toBeNull();
    expect(Object.keys(last!.profile.phases)).toContain('sim.mob.update|other');
  });

  // Real timers and a real interval loop, so give the test room beyond the 5s
  // default when the host is under load; the happy path completes in well under a
  // second.
  it('fills the capture accumulators through the real loop and re-zeroes on a fresh capture', {
    timeout: 20_000,
  }, async () => {
    // Unlike runCaptureWindow (which drives sim.tick() directly), this drives the
    // REAL GameServer interval loop, pinning the wire the other tests bypass: after
    // each committed tick the loop must read sim.mobScanCounters and fold it into
    // the capture accumulators while a capture is in flight. Deleting that fold
    // call, swapping its aggro/threat arguments, or inverting its capturing gate
    // reddens this test.
    const server = new GameServer();
    const sim = (server as unknown as { sim: Sim }).sim;
    const seed = (sim as unknown as { cfg: { seed: number } }).cfg.seed;
    // One DEAD player 10 units from an idle wolf, far outside the world's camps
    // (the FAR-clear pin in tests/mob_scan_counters.test.ts covers this spot). A
    // dead player still counts as a grid visit (the increment precedes the dead
    // check) but can never be aggroed, so every committed tick adds exactly one
    // aggro visit while the threat accumulators stay at zero; a swapped fold
    // argument order would move the count across and redden both halves.
    const pid = sim.addPlayer('warrior', 'LoopScanTarget');
    const player = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid)!;
    player.pos.x = 510;
    player.pos.z = 500;
    player.pos.y = terrainHeight(510, 500, seed);
    player.prevPos = { ...player.pos };
    player.dead = true;
    const wolf = createMob(900403, MOBS.forest_wolf, 5, {
      x: 500,
      y: terrainHeight(500, 500, seed),
      z: 500,
    });
    wolf.aiState = 'idle';
    (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(wolf);

    // Max window so the capture cannot wall-close mid-test; production closes on
    // the wall deadline, which the finalize below forces instead.
    server.startPerfCapture(30_000);
    server.start();
    try {
      // Poll the accumulator itself rather than tick counts: the first committed
      // tick scans a player grid not yet refreshed with the teleported player, so
      // visit totals lag tick counts by one. A broken fold wire never reaches 3 and
      // times this wait out.
      await vi.waitFor(
        () => {
          const stats = (server as unknown as { mobScanTickStats: { aggroVisitsTotal: number } })
            .mobScanTickStats;
          expect(stats.aggroVisitsTotal).toBeGreaterThanOrEqual(3);
        },
        { timeout: 10_000, interval: 25 },
      );
    } finally {
      server.stop();
    }
    (server as unknown as { perfCaptureDeadlineNs: bigint }).perfCaptureDeadlineNs = 0n;
    (server as unknown as { finalizePerfCaptureIfDue: () => void }).finalizePerfCaptureIfDue();

    const first = server.perfCaptureStatus().last;
    expect(first).not.toBeNull();
    // The frozen result carries at least the visits the wait observed, peaking at
    // one visit per tick.
    expect(first!.aggroVisitsTotal).toBeGreaterThanOrEqual(3);
    expect(first!.aggroVisitsMaxPerTick).toBeGreaterThanOrEqual(1);
    expect(first!.aggroVisitsTotal).toBeGreaterThanOrEqual(first!.aggroVisitsMaxPerTick);
    // Nothing entered combat, so the threat side stays exactly zero.
    expect(first!.threatVisitsTotal).toBe(0);
    expect(first!.threatVisitsMaxPerTick).toBe(0);

    // A fresh capture must start from zeroed accumulators (startPerfCapture calls
    // resetMobScanCaptureAccumulators): finalize it with the loop stopped and the
    // first window's totals must not leak through.
    server.startPerfCapture(30_000);
    (server as unknown as { perfCaptureDeadlineNs: bigint }).perfCaptureDeadlineNs = 0n;
    (server as unknown as { finalizePerfCaptureIfDue: () => void }).finalizePerfCaptureIfDue();
    const second = server.perfCaptureStatus().last;
    expect(second).not.toBeNull();
    expect(second!.aggroVisitsTotal).toBe(0);
    expect(second!.aggroVisitsMaxPerTick).toBe(0);
    expect(second!.threatVisitsTotal).toBe(0);
    expect(second!.threatVisitsMaxPerTick).toBe(0);
  });

  it('prints the two visit tokens on the [perf] heartbeat line', () => {
    // The heartbeat is a dev-channel console line with no in-repo scraper, but the
    // two tokens are the cheap always-on view of the scan counters; pin their
    // presence and shape so an accidental format change is a deliberate one.
    vi.stubEnv('PERF_TICK_LOG', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const server = new GameServer();
      const stats = (
        server as unknown as {
          mobScanTickStats: { lastAggroScanVisits: number; lastThreatEntryVisits: number };
        }
      ).mobScanTickStats;
      stats.lastAggroScanVisits = 12;
      stats.lastThreatEntryVisits = 7;
      // Force the heartbeat branch (tickCount 0 minus -100 clears the 100-tick gap).
      (server as unknown as { lastPerfLogTick: number }).lastPerfLogTick = -100;
      (server as unknown as { maybeLogTickPerf: (ms: number) => void }).maybeLogTickPerf(5);
      const perfLine = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[perf] '));
      expect(perfLine).toBeDefined();
      expect(perfLine).toContain('aggroVisits=12');
      expect(perfLine).toContain('threatVisits=7');
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('registers every mob.update per-zone bucket so its timing is never silently dropped', () => {
    // TickProfiler.add() ignores an unregistered phase. The per-zone mob.update buckets
    // are host-derived, so unlike SIM_LAP_PHASES the sim never emits them;
    // pin that the GameServer profiler registered ALL of them, or a mob.update split
    // would vanish from the report.
    const server = new GameServer();
    const phases = (
      server as unknown as { tickProfiler: { profile: () => { phases: Record<string, unknown> } } }
    ).tickProfiler.profile().phases;
    expect(SIM_MOB_ZONE_PHASES.length).toBe(ZONES.length + 2); // every zone + instance + other
    for (const phase of SIM_MOB_ZONE_PHASES) {
      expect(phase in phases, `${phase} is not registered in the tick profiler`).toBe(true);
    }
  });

  it('maps a mob to its zone/group bucket (mobZonePhase)', () => {
    const at = (x: number, z: number): string => mobZonePhase({ pos: { x, z } } as Entity);
    // Each overworld zone resolves to its own registered bucket.
    for (const zone of ZONES) {
      const mid = (zone.zMin + zone.zMax) / 2;
      const bucket = at(0, mid);
      expect(bucket).toBe(`sim.mob.z:${zone.id}`);
      expect(SIM_MOB_ZONE_PHASES).toContain(bucket);
    }
    // Instance/delve mobs (x beyond the dungeon threshold) share the 'instance' bucket.
    expect(at(10_000, 0)).toBe('sim.mob.z:instance');
    // Distinct overworld zones do not collapse into one bucket.
    expect(at(0, (ZONES[0].zMin + ZONES[0].zMax) / 2)).not.toBe(
      at(0, (ZONES[1].zMin + ZONES[1].zMax) / 2),
    );
  });

  it('records the injected GameServer mob lap in both total and zone phases', () => {
    const server = new GameServer();
    server.startPerfCapture(3000);
    const mob = [...server.sim.entities.values()].find((entity) => entity.kind === 'mob');
    if (!mob) throw new Error('fresh GameServer world did not spawn a mob');

    const perfLap = (
      server.sim as unknown as {
        cfg: { perfLap?: (phase: string, entity?: Entity) => void };
      }
    ).cfg.perfLap;
    if (!perfLap) throw new Error('GameServer did not inject its sim perf probe');

    const internal = server as unknown as {
      simLapMark: bigint;
      tickProfiler: {
        commit(ms: number): void;
        profile(): { phases: Record<string, { mean: number }> };
      };
    };
    internal.simLapMark = process.hrtime.bigint() - 5_000_000n;
    perfLap('mob.update', mob);
    internal.tickProfiler.commit(8);

    const phases = internal.tickProfiler.profile().phases;
    expect(phases['sim.mob.update'].mean).toBeGreaterThan(0);
    expect(phases[mobZonePhase(mob)].mean).toBeGreaterThan(0);
  });
});
