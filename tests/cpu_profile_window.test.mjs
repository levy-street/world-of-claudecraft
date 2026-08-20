import { describe, expect, it } from 'vitest';
import {
  aggregate,
  frameKey,
  selectWindow,
  toPageMs,
} from '../scripts/profiler/cpu_profile_window.mjs';

// root -> render -> compile, sampled at a flat 1 ms. The profiler clock ends
// at 5_006_000 us while the page clock reads 1006 ms at the stop, so sample i
// lands at page ms 1000 + i.
const profile = {
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 }, children: [2, 4] },
    {
      id: 2,
      callFrame: {
        functionName: 'render',
        url: 'http://host/src/render/renderer.ts',
        lineNumber: 9,
      },
      children: [3],
    },
    {
      id: 3,
      callFrame: {
        functionName: 'compile',
        url: 'http://host/src/render/shaders.ts',
        lineNumber: 41,
      },
      children: [],
    },
    { id: 4, callFrame: { functionName: '(idle)', url: '', lineNumber: -1 }, children: [] },
  ],
  startTime: 5_000_000,
  endTime: 5_006_000,
  samples: [2, 3, 3, 2, 4, 3],
  timeDeltas: [1000, 1000, 1000, 1000, 1000, 1000],
  wocProfileEndTimeUs: 5_006_000,
  wocPageNowAtStopMs: 1006,
};

// A recursive stack: render calls a helper that calls render again, so one
// sample's chain names the same frame twice. Inclusive time credits a frame
// once per SAMPLE, never once per occurrence, or any recursion would report
// more inclusive time than the window itself holds.
const recursiveProfile = {
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 }, children: [2] },
    {
      id: 2,
      callFrame: {
        functionName: 'render',
        url: 'http://host/src/render/renderer.ts',
        lineNumber: 9,
      },
      children: [3],
    },
    {
      id: 3,
      callFrame: {
        functionName: 'helper',
        url: 'http://host/src/render/renderer.ts',
        lineNumber: 20,
      },
      children: [4],
    },
    {
      id: 4,
      callFrame: {
        functionName: 'render',
        url: 'http://host/src/render/renderer.ts',
        lineNumber: 9,
      },
      children: [],
    },
  ],
  startTime: 5_000_000,
  endTime: 5_002_000,
  samples: [4, 4],
  timeDeltas: [1000, 1000],
  wocProfileEndTimeUs: 5_002_000,
  wocPageNowAtStopMs: 1002,
};

describe('cpu profile window', () => {
  it('maps profiler microseconds onto the page performance.now() clock', () => {
    expect(toPageMs(profile, 5_000_000)).toBe(1000);
    expect(toPageMs(profile, 5_003_500)).toBe(1003.5);
  });

  it('names a frame by function, file basename, and one-based line', () => {
    expect(frameKey(profile.nodes[1].callFrame)).toBe('render renderer.ts:10');
    expect(frameKey(profile.nodes[0].callFrame)).toBe('(root)');
  });

  it('keeps only the samples inside the window', () => {
    const rows = selectWindow(profile, 1002, 1004);
    expect(rows.map((row) => row.nodeId)).toEqual([3, 3, 2]);
    expect(rows.map((row) => row.pageMs)).toEqual([1002, 1003, 1004]);
    expect(rows.every((row) => row.weightMs === 1)).toBe(true);
    expect(selectWindow(profile, 1010, 1020)).toEqual([]);
  });

  it('splits self and inclusive time and weighs each distinct stack', () => {
    const result = aggregate(profile, selectWindow(profile, 1001, 1006));
    expect(result.totalMs).toBe(6);
    expect(result.special['(idle)']).toBe(1);
    expect(result.special['(garbage collector)']).toBe(0);
    expect(result.self.get('compile shaders.ts:42')).toBe(3);
    expect(result.self.get('render renderer.ts:10')).toBe(2);
    expect(result.self.get('(idle)')).toBe(1);
    // A sample credits every ancestor once: render carries its own 2 ms plus
    // compile's 3 ms, and the root carries the whole window.
    expect(result.inclusive.get('render renderer.ts:10')).toBe(5);
    expect(result.inclusive.get('compile shaders.ts:42')).toBe(3);
    expect(result.inclusive.get('(root)')).toBe(6);
    expect(result.stacks.get('compile shaders.ts:42 < render renderer.ts:10 < (root)')).toBe(3);
    expect(result.stacks.get('render renderer.ts:10 < (root)')).toBe(2);
    expect(result.stacks.get('(idle) < (root)')).toBe(1);
  });

  it('counts a recursive frame once per sample in inclusive time', () => {
    const rows = selectWindow(recursiveProfile, 1000, 1002);
    expect(rows.map((row) => row.nodeId)).toEqual([4, 4]);
    const result = aggregate(recursiveProfile, rows);

    expect(result.totalMs).toBe(2);
    // The innermost render is where the samples landed, so it owns the self
    // time; the outer render sits twice in the same chain and still carries
    // the window once, never 4 ms out of a 2 ms window.
    expect(result.self.get('render renderer.ts:10')).toBe(2);
    expect(result.inclusive.get('render renderer.ts:10')).toBe(2);
    expect(result.inclusive.get('helper renderer.ts:21')).toBe(2);
    expect(result.inclusive.get('(root)')).toBe(2);
    for (const ms of result.inclusive.values()) expect(ms).toBeLessThanOrEqual(result.totalMs);
    // The stack itself still spells the recursion out.
    expect(
      result.stacks.get(
        'render renderer.ts:10 < helper renderer.ts:21 < render renderer.ts:10 < (root)',
      ),
    ).toBe(2);
  });
});
