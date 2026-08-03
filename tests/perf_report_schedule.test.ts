import { describe, expect, it } from 'vitest';
import {
  jitteredPerfReportDelay,
  perfReportScheduleInternalsForTest,
} from '../src/game/perf_report_schedule';

describe('jitteredPerfReportDelay', () => {
  it('is stable for one session and report sequence', () => {
    const fixtures = [
      ['session-a', 0, 71_868],
      ['session-a', 1, 71_809],
      ['session-b', 0, 68_302],
    ] as const;
    for (const [sessionId, sequence, expected] of fixtures) {
      expect(jitteredPerfReportDelay(75_000, sessionId, sequence)).toBe(expected);
    }
    expect(perfReportScheduleInternalsForTest.PERF_REPORT_JITTER_RATIO).toBe(0.1);
  });

  it('keeps first and repeat reports within ten percent of their cadence', () => {
    for (let sequence = 0; sequence < 50; sequence++) {
      const first = jitteredPerfReportDelay(75_000, 'session-a', sequence);
      const repeat = jitteredPerfReportDelay(300_000, 'session-b', sequence);
      expect(first).toBeGreaterThanOrEqual(67_500);
      expect(first).toBeLessThanOrEqual(82_500);
      expect(repeat).toBeGreaterThanOrEqual(270_000);
      expect(repeat).toBeLessThanOrEqual(330_000);
    }
  });

  it('distributes sessions instead of synchronizing every client', () => {
    const delays = new Set(
      Array.from({ length: 64 }, (_, index) =>
        jitteredPerfReportDelay(300_000, `session-${index}`, 1),
      ),
    );
    expect(delays.size).toBeGreaterThan(50);
    expect(Math.min(...delays)).toBeLessThan(290_000);
    expect(Math.max(...delays)).toBeGreaterThan(310_000);
  });

  it('normalizes invalid bases and sequences without leaving finite bounds', () => {
    expect(jitteredPerfReportDelay(Number.NaN, 'session', -5)).toBe(0);
    expect(jitteredPerfReportDelay(-1, 'session', Number.POSITIVE_INFINITY)).toBe(0);
  });
});
