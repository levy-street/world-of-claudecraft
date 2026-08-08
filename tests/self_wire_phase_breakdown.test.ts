// The bcastSelf per-key-group profiler breakdown (SELF_WIRE_PHASES): during a
// detailed capture every selfWireJson call attributes its time to contiguous
// key-group buckets, so a production Tick Profiler capture names WHICH self
// key group eats the broadcast budget (the market and corder incidents both
// hid inside the one bcastSelf total). Pins: every bucket is registered in
// the profiler, the probe fills every bucket during a pass, and the
// steady-state loop (perfDetailActive off) pays and records nothing.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameServer, SELF_WIRE_PHASES } from '../server/game';
import { broadcast, fakeWs, joinServer } from './helpers/bare_client';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('bcastSelf per-key-group breakdown', () => {
  it('names one self.* bucket per contiguous key group and registers each in the profiler', () => {
    expect(SELF_WIRE_PHASES).toHaveLength(16);
    for (const name of SELF_WIRE_PHASES) expect(name.startsWith('self.')).toBe(true);
    // The corder and market groups exist by name: the two shipped incidents
    // this breakdown exists to catch must never fold into a broader bucket.
    expect(SELF_WIRE_PHASES).toContain('self.market');
    expect(SELF_WIRE_PHASES).toContain('self.corder');
    expect(SELF_WIRE_PHASES).toContain('self.mail');

    const server = new GameServer();
    // biome-ignore lint/suspicious/noExplicitAny: reaching the profiler is the harness idiom
    const profile = (server as any).tickProfiler.profile();
    for (const name of SELF_WIRE_PHASES) {
      expect(profile.phases[name], `${name} must be a registered profiler phase`).toBeDefined();
    }
  });

  it('the loop callback drives the flush and the per-pass reset (source pin)', () => {
    // The interval body is not drivable from a unit test, so the two wiring
    // sites are pinned in source: deleting the flush call leaves every
    // behavior test green while the admin table zeroes forever, and deleting
    // the clear makes the accumulators inflate monotonically across passes.
    const source = readFileSync(join(ROOT, 'server', 'game.ts'), 'utf8');
    expect(source).toMatch(/this\.selfWireNs\.clear\(\);/);
    const flushIdx = source.indexOf('this.flushSelfWirePhases();');
    expect(flushIdx).toBeGreaterThan(-1);
    // The flush sits directly beside the bcastSelf total it decomposes.
    const bcastIdx = source.indexOf("this.tickProfiler.add('bcastSelf'");
    expect(bcastIdx).toBeGreaterThan(-1);
    expect(flushIdx).toBeGreaterThan(bcastIdx);
    expect(flushIdx - bcastIdx).toBeLessThan(500);
  });

  it('the selfLap probe sequence in selfWireJson equals SELF_WIRE_PHASES, in order', () => {
    // Source pin (the tests/architecture.test.ts idiom): a reordered, missing,
    // or misspelled bucket label would silently misattribute (an unknown phase
    // accumulates locally but TickProfiler.add drops it), so the lap sequence
    // is diffed against the registry both ways, order included.
    const source = readFileSync(join(ROOT, 'server', 'game.ts'), 'utf8');
    const laps = [...source.matchAll(/selfLap\?\.\('([^']+)'\)/g)].map((m) => m[1]);
    expect(laps).toEqual([...SELF_WIRE_PHASES]);
  });

  it('fills every bucket during a detailed-capture pass and nothing when the switch is off', () => {
    const server = new GameServer();
    const fc = fakeWs();
    joinServer(server, fc, 71, 'Probe');
    // biome-ignore lint/suspicious/noExplicitAny: reaching the accumulators is the harness idiom
    const ns = (server as any).selfWireNs as Map<string, bigint>;

    // Steady state: the probe is off, no clock reads, no accumulation.
    broadcast(server);
    expect(ns.size).toBe(0);

    // Capture active: one pass fills every bucket (a bucket whose keys did no
    // work still records its boundary, so the map holds all names).
    // biome-ignore lint/suspicious/noExplicitAny: the capture switch is private by design
    (server as any).perfDetailActive = true;
    broadcast(server);
    for (const name of SELF_WIRE_PHASES) {
      expect(ns.has(name), `${name} must be accumulated during a capture pass`).toBe(true);
    }
    const total = [...ns.values()].reduce((a, b) => a + b, 0n);
    expect(total > 0n).toBe(true);

    // The flush path is the piece the admin table actually depends on:
    // deleting it must redden this test, not silently zero the table forever.
    // biome-ignore lint/suspicious/noExplicitAny: the flush is private by design
    (server as any).flushSelfWirePhases();
    // biome-ignore lint/suspicious/noExplicitAny: reaching the profiler is the harness idiom
    const profiler = (server as any).tickProfiler;
    profiler.commit(1);
    const phases = profiler.profile().phases;
    const flushedTotal = SELF_WIRE_PHASES.reduce(
      (sum: number, name: string) => sum + (phases[name]?.max ?? 0),
      0,
    );
    expect(flushedTotal).toBeGreaterThan(0);
  });
});
