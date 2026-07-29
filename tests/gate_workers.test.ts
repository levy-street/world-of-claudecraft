import { describe, expect, it } from 'vitest';
import {
  computeGateWorkers,
  GATE_WORKER_TIER_CAPS,
  parseGateWorkerTier,
  resolveGateWorkerTierCap,
} from '../scripts/lib/gate_workers.mjs';

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

describe('computeGateWorkers: CPU-bound default (plenty of free memory)', () => {
  it('halves the core count, floored, on a machine with ample free memory', () => {
    expect(
      computeGateWorkers({ cpuCount: 16, freeMemBytes: 32 * GIB, envOverride: undefined }),
    ).toBe(8);
  });

  it('never returns fewer than 1 worker on a single-core machine', () => {
    expect(
      computeGateWorkers({ cpuCount: 1, freeMemBytes: 32 * GIB, envOverride: undefined }),
    ).toBe(1);
  });

  it('floors an odd core count', () => {
    expect(
      computeGateWorkers({ cpuCount: 5, freeMemBytes: 32 * GIB, envOverride: undefined }),
    ).toBe(2);
  });
});

describe('computeGateWorkers: memory-bound clamp', () => {
  it('clamps below the CPU bound when free memory is tight', () => {
    expect(
      computeGateWorkers({ cpuCount: 16, freeMemBytes: 1536 * MIB, envOverride: undefined }),
    ).toBe(2);
  });

  it('never returns fewer than 1 worker even under severe memory pressure', () => {
    expect(
      computeGateWorkers({ cpuCount: 16, freeMemBytes: 100 * MIB, envOverride: undefined }),
    ).toBe(1);
  });

  it('never returns fewer than 1 worker at exactly zero free memory', () => {
    expect(computeGateWorkers({ cpuCount: 16, freeMemBytes: 0, envOverride: undefined })).toBe(1);
  });

  it('does not tighten below the CPU bound when memory is not actually the limiter', () => {
    // Memory bound (10) is looser than the CPU bound (4): CPU stays the limiter.
    expect(
      computeGateWorkers({ cpuCount: 8, freeMemBytes: 10 * 768 * MIB, envOverride: undefined }),
    ).toBe(4);
  });
});

describe('computeGateWorkers: GATE_MAX_WORKERS override', () => {
  it('takes precedence over both the CPU and memory bounds', () => {
    expect(computeGateWorkers({ cpuCount: 16, freeMemBytes: 100 * MIB, envOverride: '3' })).toBe(3);
  });

  it('can request more workers than the default CPU-halving heuristic would allow', () => {
    expect(computeGateWorkers({ cpuCount: 4, freeMemBytes: 32 * GIB, envOverride: '12' })).toBe(12);
  });

  it.each(['0', '-1', 'abc', '', '  '])(
    'falls back to the computed default on an invalid override %j',
    (bad) => {
      expect(computeGateWorkers({ cpuCount: 16, freeMemBytes: 32 * GIB, envOverride: bad })).toBe(
        8,
      );
    },
  );

  it('takes precedence over a tier cap as well', () => {
    expect(
      computeGateWorkers({
        cpuCount: 16,
        freeMemBytes: 32 * GIB,
        envOverride: '6',
        tierCap: 2,
      }),
    ).toBe(6);
  });
});

describe('GATE_WORKER_TIER presets', () => {
  it('exports fixed low/medium/high caps', () => {
    expect(GATE_WORKER_TIER_CAPS).toEqual({ low: 2, medium: 4, high: 8 });
  });

  it.each([
    ['low', 'low'],
    ['MEDIUM', 'medium'],
    [' High ', 'high'],
  ] as const)('parseGateWorkerTier accepts %j', (raw, expected) => {
    expect(parseGateWorkerTier(raw)).toBe(expected);
  });

  it('parseGateWorkerTier rejects unknown labels', () => {
    expect(parseGateWorkerTier(null)).toBeNull();
    expect(parseGateWorkerTier(undefined)).toBeNull();
    expect(parseGateWorkerTier('')).toBeNull();
    expect(parseGateWorkerTier('turbo')).toBeNull();
    expect(parseGateWorkerTier('2')).toBeNull();
  });

  it('resolveGateWorkerTierCap maps labels and ignores invalid', () => {
    expect(resolveGateWorkerTierCap('low')).toBe(2);
    expect(resolveGateWorkerTierCap('medium')).toBe(4);
    expect(resolveGateWorkerTierCap('high')).toBe(8);
    expect(resolveGateWorkerTierCap('nope')).toBeUndefined();
    expect(resolveGateWorkerTierCap(undefined)).toBeUndefined();
  });

  it('tierCap lowers workers after free-mem clamp, never raises them', () => {
    // CPU/2 = 8, mem allows 8; low tier caps at 2.
    expect(
      computeGateWorkers({
        cpuCount: 16,
        freeMemBytes: 32 * GIB,
        envOverride: undefined,
        tierCap: 2,
      }),
    ).toBe(2);
  });

  it('free-mem clamp still wins when tighter than the tier cap', () => {
    // memBound = floor(100MiB / 0.75GiB) = 1; medium tier cap 4 must not raise above 1.
    expect(
      computeGateWorkers({
        cpuCount: 16,
        freeMemBytes: 100 * MIB,
        envOverride: undefined,
        tierCap: 4,
      }),
    ).toBe(1);
  });

  it('ignores non-positive or non-finite tierCap values', () => {
    expect(
      computeGateWorkers({
        cpuCount: 16,
        freeMemBytes: 32 * GIB,
        envOverride: undefined,
        tierCap: 0,
      }),
    ).toBe(8);
    expect(
      computeGateWorkers({
        cpuCount: 16,
        freeMemBytes: 32 * GIB,
        envOverride: undefined,
        tierCap: Number.NaN,
      }),
    ).toBe(8);
  });
});
