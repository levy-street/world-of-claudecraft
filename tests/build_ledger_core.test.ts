import { describe, expect, it } from 'vitest';
import {
  BUILD_LEDGER_EMA_ALPHA,
  BUILD_LEDGER_SLOWEST_LIMIT,
  buildLedgerLane,
  createBuildLedger,
} from '../src/render/build_ledger_core';

describe('buildLedgerLane', () => {
  it('names the lane from the kind prefix, wall spans before the zone prefix', () => {
    expect(buildLedgerLane('view:composed')).toBe('view');
    expect(buildLedgerLane('zone:features:buildRealmFlora')).toBe('zone');
    expect(buildLedgerLane('zone-wall:terrain')).toBe('wall');
    expect(buildLedgerLane('view-part:assemble')).toBe('part');
    expect(buildLedgerLane('view-part:assemble:parts')).toBe('part');
    expect(buildLedgerLane('mount')).toBe('other');
  });
});

describe('createBuildLedger', () => {
  it('keeps per-kind count, last, ema, max and total, rounded to 0.1 in the snapshot only', () => {
    const ledger = createBuildLedger();
    ledger.record('view:rig', 4.04, 100);
    ledger.record('view:rig', 12.06, 110);
    const rig = ledger.snapshot().kinds['view:rig'];
    expect(rig.count).toBe(2);
    expect(rig.lastMs).toBe(12.1);
    expect(rig.maxMs).toBe(12.1);
    expect(rig.maxAtMs).toBe(110);
    expect(rig.totalMs).toBe(16.1);
    // First sample seeds the average; the second moves it by the alpha.
    const ema = 4.04 + (12.06 - 4.04) * BUILD_LEDGER_EMA_ALPHA;
    expect(rig.emaMs).toBe(Math.round(ema * 10) / 10);
    expect(BUILD_LEDGER_EMA_ALPHA).toBe(0.2);
  });

  it('accumulates the frame spend by lane since the last beginFrame', () => {
    const ledger = createBuildLedger();
    ledger.record('view:composed', 8, 1);
    ledger.record('view:object', 2, 2);
    ledger.record('zone:features:buildFenFeatures', 30, 3);
    ledger.record('other-thing', 1, 4);
    const spend = ledger.frameSpend();
    expect(spend.totalMs).toBe(41);
    expect(spend.viewMs).toBe(10);
    expect(spend.zoneMs).toBe(30);
    expect(spend.count).toBe(4);
    ledger.beginFrame();
    expect(ledger.frameSpend()).toEqual({ totalMs: 0, viewMs: 0, zoneMs: 0, count: 0 });
    ledger.record('zone:features:buildGaleFeatures', 5, 9);
    expect(ledger.frameSpend().zoneMs).toBe(5);
    expect(ledger.frameSpend().viewMs).toBe(0);
  });

  it('keeps wall spans per kind but out of the frame spend, worst frame and slowest ring', () => {
    const ledger = createBuildLedger();
    ledger.record('zone-wall:sky', 6000, 1);
    ledger.record('view:rig', 3, 2);
    expect(ledger.frameSpend().totalMs).toBe(3);
    expect(ledger.frameSpend().count).toBe(1);
    ledger.beginFrame();
    const snap = ledger.snapshot();
    expect(snap.kinds['zone-wall:sky'].maxMs).toBe(6000);
    expect(snap.worstFrame).toEqual({ ms: 3, count: 1, atMs: 2 });
    expect(snap.slowest.map((s) => s.kind)).toEqual(['view:rig']);
  });

  it('keeps a view-part sub-span per kind, out of the frame spend, worst frame and slowest ring', () => {
    // The sub-spans are NESTED in the outer build: their ms is already inside
    // its 60, so the frame counts the outer build only, once.
    const ledger = createBuildLedger();
    ledger.record('view:composed', 60, 1);
    ledger.record('view-part:assemble', 40, 2);
    ledger.record('view-part:assemble:parts', 25, 3);
    const spend = ledger.frameSpend();
    expect(spend.viewMs).toBe(60);
    expect(spend.zoneMs).toBe(0);
    expect(spend.totalMs).toBe(60);
    expect(spend.count).toBe(1);
    ledger.beginFrame();
    const snap = ledger.snapshot();
    expect(snap.kinds['view-part:assemble'].lastMs).toBe(40);
    expect(snap.kinds['view-part:assemble:parts'].maxMs).toBe(25);
    // A part lane kind is out of the frame lanes, but its worst sample still
    // says WHEN: that is the only frame anchor a nested span keeps.
    ledger.record('view-part:assemble:parts', 24, 4);
    expect(ledger.snapshot().kinds['view-part:assemble:parts'].maxAtMs).toBe(3);
    expect(snap.worstFrame).toEqual({ ms: 60, count: 1, atMs: 1 });
    expect(snap.slowest.map((s) => s.kind)).toEqual(['view:composed']);
  });

  it('remembers the worst frame with its build count and first timestamp', () => {
    const ledger = createBuildLedger();
    ledger.record('view:rig', 5, 100);
    ledger.beginFrame();
    ledger.record('view:composed', 20, 200);
    ledger.record('view:composed', 15, 210);
    ledger.beginFrame();
    ledger.record('view:rig', 6, 300);
    ledger.beginFrame();
    expect(ledger.snapshot().worstFrame).toEqual({ ms: 35, count: 2, atMs: 200 });
  });

  it('bounds the slowest ring, sorted worst first, and evicts the lightest', () => {
    const ledger = createBuildLedger({ slowestLimit: 3 });
    ledger.record('view:a', 5, 1);
    ledger.record('view:b', 50, 2);
    ledger.record('view:c', 20, 3);
    ledger.record('view:d', 1, 4);
    ledger.record('view:e', 30, 5);
    expect(ledger.snapshot().slowest).toEqual([
      { kind: 'view:b', ms: 50, atMs: 2 },
      { kind: 'view:e', ms: 30, atMs: 5 },
      { kind: 'view:c', ms: 20, atMs: 3 },
    ]);
    expect(BUILD_LEDGER_SLOWEST_LIMIT).toBe(24);
    const wide = createBuildLedger();
    for (let i = 0; i < 40; i++) wide.record('view:x', i, i);
    expect(wide.snapshot().slowest).toHaveLength(BUILD_LEDGER_SLOWEST_LIMIT);
    expect(wide.snapshot().slowest[0].ms).toBe(39);
  });

  it('serves the frame spend as one reused object and ignores invalid durations', () => {
    const ledger = createBuildLedger();
    expect(ledger.frameSpend()).toBe(ledger.frameSpend());
    ledger.record('view:rig', Number.NaN, 1);
    ledger.record('view:rig', -1, 1);
    expect(ledger.frameSpend().count).toBe(0);
    expect(ledger.snapshot().kinds['view:rig']).toBeUndefined();
  });
});
