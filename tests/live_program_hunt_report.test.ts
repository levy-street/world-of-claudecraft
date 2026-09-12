import { describe, expect, it } from 'vitest';
import {
  aggregateLivePrograms,
  BURST_WINDOW_MS,
  collectGateFailures,
  findBursts,
  renderReport,
  shortKey,
} from '../scripts/lib/live_program_hunt_report.mjs';

const KEY =
  'basic,highp,srgb-linear,false,,uv,false,false,false,false,false,false,0,,false,0,,1,10,0,0,1,0,1,0,0,8388608,8520707,srgb,onBeforeCompile(){}';

function sample(over: Record<string, unknown>) {
  return {
    t: 0,
    zone: 'thornpeak_heights',
    pos: { x: -23.4, z: 695.6 },
    programs: [],
    events: [],
    diag: null,
    ...over,
  };
}

describe('live_program_hunt_report', () => {
  it('shortens a three cache key to its head and tail', () => {
    expect(shortKey(KEY)).toBe('basic,highp,...,8388608,8520707,srgb,onBeforeCompile(){}');
    expect(shortKey('dungeon:')).toBe('dungeon:');
    expect(shortKey(undefined)).toBe('');
  });

  it('groups live-program events by label with the first sighting context', () => {
    const rows = aggregateLivePrograms([
      sample({
        programs: [{ id: 7, name: '', cacheKey: KEY, owner: 'props:ruin:MeshBasicMaterial' }],
        events: [{ kind: 'live-program', key: KEY, atMs: 95737, readyRoots: 0, totalRoots: 0 }],
        diag: {
          newMaterials: ['MeshBasicMaterial:ab12cd34'],
          firstVisibleObjects: ['props:ruin:MeshBasicMaterial:ab12cd34'],
        },
      }),
      sample({
        zone: 'other',
        events: [{ kind: 'live-program', key: KEY, atMs: 99000, readyRoots: 0, totalRoots: 0 }],
      }),
      sample({
        programs: [{ id: 8, name: 'dungeon:', cacheKey: 'physical,...' }],
        events: [{ kind: 'live-program', key: 'dungeon:', atMs: 95737 }],
      }),
    ]);
    expect(rows).toHaveLength(2);
    const [basic, named] = rows;
    expect(basic.count).toBe(2);
    expect(basic.zone).toBe('thornpeak_heights');
    expect(basic.pos).toBe('(-23, 696)');
    expect(basic.materialName).toBe('');
    expect(basic.owner).toBe('props:ruin:MeshBasicMaterial');
    expect(named.owner).toBe('');
    expect(basic.firstVisibleObjects).toEqual(['props:ruin:MeshBasicMaterial:ab12cd34']);
    expect(basic.readyRoots).toBe('0/0');
    expect(named.materialName).toBe('dungeon:');
    expect(named.keyShort).toBe('physical,...');
  });

  it('finds bursts of live programs closer than the window', () => {
    const at = 95737;
    const bursts = findBursts([
      sample({
        events: [
          { kind: 'live-program', key: 'a', atMs: at },
          { kind: 'live-program', key: 'b', atMs: at + 1 },
          { kind: 'live-program', key: 'c', atMs: at + 1 + BURST_WINDOW_MS + 1 },
          { kind: 'attach-watchdog', key: 'x', atMs: at + 2 },
        ],
      }),
      sample({ events: [{ kind: 'live-program', key: 'd', atMs: 42274 }] }),
    ]);
    expect(bursts).toEqual([{ atMs: at, zone: 'thornpeak_heights', count: 2, labels: ['a', 'b'] }]);
  });

  it('lists gate failures in time order', () => {
    const rows = collectGateFailures([
      sample({ events: [{ kind: 'gate-timeout', key: 'live-gate:Group', atMs: 47903 }] }),
      sample({ events: [{ kind: 'attach-watchdog', key: 'farmPlot:bed_1', atMs: 46974 }] }),
      sample({ events: [{ kind: 'live-program', key: 'k', atMs: 1 }] }),
    ]);
    expect(rows.map((r) => `${r.kind}@${r.atMs}`)).toEqual([
      'attach-watchdog@46974',
      'gate-timeout@47903',
    ]);
  });

  it('renders a report that names the owner columns and warns when the audit is off', () => {
    const report = renderReport(
      [
        sample({
          programs: [{ id: 7, name: '', cacheKey: KEY }],
          events: [{ kind: 'live-program', key: KEY, atMs: 95737, readyRoots: 0, totalRoots: 0 }],
          diag: {
            newMaterials: ['MeshBasicMaterial:ab12cd34'],
            firstVisibleObjects: ['props:ruin:MeshBasicMaterial:ab12cd34'],
          },
        }),
      ],
      {
        target: 'https://example.test',
        gitSha: 'abc1234',
        durationMs: 61_000,
        polls: 240,
        audit: { enabled: false },
      },
    );
    expect(report).toContain(
      '| 95.7 s | thornpeak_heights | (-23, 696) | (not in scene at the poll) | (unnamed) |',
    );
    expect(report).toContain('props:ruin:MeshBasicMaterial:ab12cd34');
    expect(report).toContain('Live programs: 1 events, 1 distinct');
    expect(report).toContain('Audit off');
    expect(renderReport([], { polls: 12 })).toContain('None. Every program the session drew');
    expect(renderReport([], { polls: 0 })).toContain('No poll reached the renderer');
  });
});
