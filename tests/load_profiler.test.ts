import { describe, expect, it } from 'vitest';
import {
  collectLoadSpans,
  type LoadSpanEntry,
  loadPhaseEnd,
  loadPhaseStart,
  loadSpan,
  resetLoadProfile,
  summarizeLoadProfile,
} from '../src/game/load_profiler';

const span = (name: string, startTime: number, duration: number): LoadSpanEntry => ({
  name,
  startTime,
  duration,
});

describe('summarizeLoadProfile', () => {
  it('nests spans by interval containment under the root', () => {
    const summary = summarizeLoadProfile(
      [
        span('entry', 0, 100),
        span('renderer-ctor', 10, 40),
        span('terrain', 15, 20),
        span('prepare-zone', 60, 30),
      ],
      'entry',
    );
    expect(summary.totalMs).toBe(100);
    expect(summary.phases.map((p) => p.name)).toEqual(['renderer-ctor', 'prepare-zone']);
    const ctor = summary.phases[0];
    expect(ctor.children.map((c) => c.name)).toEqual(['terrain']);
    expect(ctor.selfMs).toBe(20);
  });

  it('aggregates repeated span names with counts and sums', () => {
    const summary = summarizeLoadProfile(
      [
        span('entry', 0, 100),
        span('prepare-zone', 10, 30),
        span('zone-sky', 12, 10),
        span('prepare-neighbors', 50, 40),
        span('zone-sky', 55, 5),
        span('zone-sky', 70, 5),
      ],
      'entry',
    );
    const zone = summary.phases.find((p) => p.name === 'prepare-zone');
    const neighbors = summary.phases.find((p) => p.name === 'prepare-neighbors');
    expect(zone?.children).toEqual([
      expect.objectContaining({ name: 'zone-sky', ms: 10, count: 1 }),
    ]);
    expect(neighbors?.children).toEqual([
      expect.objectContaining({ name: 'zone-sky', ms: 10, count: 2 }),
    ]);
  });

  it('computes unattributed time inside the root', () => {
    const summary = summarizeLoadProfile(
      [span('entry', 0, 100), span('renderer-ctor', 10, 40)],
      'entry',
    );
    expect(summary.unattributedMs).toBe(60);
  });

  it('keeps spans recorded before the root as top-level phases', () => {
    const summary = summarizeLoadProfile(
      [span('sim-build', 0, 20), span('entry', 25, 100), span('mount-ui', 30, 10)],
      'entry',
    );
    expect(summary.phases.map((p) => p.name)).toEqual(['sim-build', 'mount-ui']);
    expect(summary.phases[0].startMs).toBe(-25);
    expect(summary.unattributedMs).toBe(90);
  });

  it('returns a flat summary when the root span is absent', () => {
    const summary = summarizeLoadProfile([span('renderer-ctor', 10, 40)], 'entry');
    expect(summary.totalMs).toBe(0);
    expect(summary.phases.map((p) => p.name)).toEqual(['renderer-ctor']);
  });
});

describe('mark wrappers (Node performance)', () => {
  it('records and collects a measured span, and reset clears it', () => {
    resetLoadProfile();
    loadPhaseStart('probe-outer');
    loadSpan('probe-inner', () => undefined);
    loadPhaseEnd('probe-outer');
    const spans = collectLoadSpans();
    const names = spans.map((s) => s.name);
    expect(names).toContain('probe-outer');
    expect(names).toContain('probe-inner');
    const outer = spans.find((s) => s.name === 'probe-outer');
    const inner = spans.find((s) => s.name === 'probe-inner');
    expect(outer && inner && inner.startTime >= outer.startTime).toBe(true);
    resetLoadProfile();
    expect(collectLoadSpans()).toEqual([]);
  });

  it('ending a phase without a start does not throw', () => {
    expect(() => loadPhaseEnd('never-started')).not.toThrow();
  });
});
