// @vitest-environment happy-dom
// The Slope tool through the real EditorApp stroke path (app.ts rightTap3d,
// strokeBegin, strokeStep): a right-click sets the start at the ground height,
// the press point's ground height is the end, every stamp follows the ramp and
// carries the sculpt brush shape and hardness, and a press with no start only
// explains what to do. WebGL and DOM notifications are stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorApp } from '../src/editor/app';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { SCULPT_POWER_SCALE } from '../src/editor/stamp_core';
import type { HeightStamp } from '../src/sim/types';
import * as world from '../src/sim/world';

interface SlopeHarness {
  map: { terrainEdits: HeightStamp[] };
  toasts: { info: ReturnType<typeof vi.fn> };
  rightTap3d(w: { x: number; z: number } | null): void;
  strokeBegin(w: { x: number; z: number }): void;
  strokeStep(w: { x: number; z: number }): void;
  slopeStart: { x: number; z: number; y: number } | null;
}

function harness(): SlopeHarness {
  // Ground that climbs half a yard per yard east, from 3 at x = 0.
  vi.spyOn(world, 'terrainHeight').mockImplementation((x: number) => 3 + x / 2);
  return Object.assign(Object.create(EditorApp.prototype), {
    map: newFlatCustomMap('Slope check', 'slope-check', 42),
    tool: 'slope',
    toasts: { info: vi.fn(), error: vi.fn() },
    inspector: { refresh: vi.fn() },
    brushRadius: 4,
    flattenHardEdge: false,
    flattenSmooth: false,
    flattenLock: null,
    sculptBrushShape: 'square',
    sculptHardness: 50,
    sculptAlphaId: null,
    slopeStart: null,
    slopeRamp: null,
    strokeInvert: false,
    rebuildTerrainRegion: vi.fn(),
  }) as SlopeHarness;
}

afterEach(() => vi.restoreAllMocks());

describe('the Slope tool in the editor', () => {
  it('explains the right-click first when no start is set, and lays nothing', () => {
    const app = harness();
    const before = app.map.terrainEdits.length;
    app.strokeBegin({ x: 10, z: 0 });
    app.strokeStep({ x: 14, z: 0 });
    expect(app.map.terrainEdits).toHaveLength(before);
    expect(app.toasts.info).toHaveBeenCalledWith(
      'Right-click the ground first to set where the slope starts.',
    );
  });

  it('ramps from the right-clicked start to the press point along the stroke', () => {
    const app = harness();
    app.rightTap3d({ x: 0, z: 0 });
    expect(app.slopeStart).toEqual({ x: 0, z: 0, y: 3 });
    expect(app.toasts.info).toHaveBeenCalledWith('Slope start set at 3 yards.');
    // Pressed at x = 20, where the ground is 13: the ramp runs 3 to 13.
    const before = app.map.terrainEdits.length;
    app.strokeBegin({ x: 20, z: 0 });
    app.strokeStep({ x: 10, z: 0 });
    const [end, mid] = app.map.terrainEdits.slice(before);
    expect(app.map.terrainEdits).toHaveLength(before + 2);
    expect(end).toMatchObject({ x: 20, delta: 13, mode: 'level', shape: 'square' });
    expect(end.gx).toBeUndefined();
    expect(mid).toMatchObject({
      x: 10,
      delta: 8,
      gx: 0.5,
      mode: 'level',
      strength: SCULPT_POWER_SCALE,
      shape: 'square',
      hardness: 0.5,
    });
  });

  it('ignores a right-click that misses the ground', () => {
    const app = harness();
    app.rightTap3d(null);
    expect(app.slopeStart).toBeNull();
  });
});
