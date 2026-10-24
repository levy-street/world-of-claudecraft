// The Slope tool (src/editor/slope_core.ts): right-click sets the ramp's
// start, the stroke's press point is its end, and every stamp levels toward
// the straight ramp between them. Pinned here:
//  - the ramp height runs linearly from start to end and holds each end's
//    height past it, and a ramp whose ends coincide is flat at the start;
//  - a stamp inside the ramp carries its gradient, one at or past an end is a
//    flat landing, and the strength and edge choice ride along;
//  - painted along the path, the stamps really pull flat ground onto the ramp
//    through the shared terrain evaluation (sim/terrain_edit_layer.ts);
//  - a slope stamp survives the shared map-document sanitizer unchanged, and
//    an over-steep ramp is clamped to the grade a saved stamp keeps.
import { describe, expect, it } from 'vitest';
import { newCustomMap } from '../src/editor/custom_map';
import {
  MAX_SLOPE_GRADE,
  type SlopeRamp,
  slopeGradient,
  slopeHeightAt,
  slopeProgress,
  slopeStamp,
} from '../src/editor/slope_core';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { applyHeightStamp } from '../src/sim/terrain_edit_layer';
import type { HeightStamp } from '../src/sim/types';

const ramp: SlopeRamp = { start: { x: 0, z: 0, y: 0 }, end: { x: 20, z: 0, y: 10 } };

describe('the slope ramp', () => {
  it('climbs linearly from start to end and holds each end past it', () => {
    expect(slopeHeightAt(ramp, 0, 0)).toBe(0);
    expect(slopeHeightAt(ramp, 10, 0)).toBe(5);
    expect(slopeHeightAt(ramp, 20, 0)).toBe(10);
    // sideways offsets project onto the ramp line
    expect(slopeHeightAt(ramp, 5, 30)).toBe(2.5);
    expect(slopeHeightAt(ramp, -8, 0)).toBe(0);
    expect(slopeHeightAt(ramp, 35, 0)).toBe(10);
    expect(slopeProgress(ramp, -1, 0)).toBe(0);
    expect(slopeProgress(ramp, 21, 0)).toBe(1);
  });

  it('treats coincident ends as a flat ramp at the start height', () => {
    const point: SlopeRamp = { start: { x: 4, z: 4, y: 7 }, end: { x: 4.1, z: 4, y: 12 } };
    expect(slopeHeightAt(point, 50, 50)).toBe(7);
    expect(slopeGradient(point)).toEqual({ gx: 0, gz: 0 });
  });

  it('carries the gradient inside the ramp and lays flat landings at the ends', () => {
    const mid = slopeStamp(10, 0, 4, ramp, 0.2, false);
    expect(mid).toMatchObject({
      x: 10,
      z: 0,
      radius: 4,
      delta: 5,
      mode: 'level',
      falloff: 'smooth',
      strength: 0.2,
      gx: 0.5,
    });
    expect(mid.gz).toBeUndefined();
    const past = slopeStamp(30, 0, 4, ramp, 0.2, true);
    expect(past.delta).toBe(10);
    expect(past.falloff).toBe('flat');
    expect(past.gx).toBeUndefined();
    expect(slopeStamp(10, 0, 4, ramp, 3, false).strength).toBe(1);
  });

  it('pulls flat ground onto the ramp when painted along the path', () => {
    const stamps: HeightStamp[] = [];
    for (let pass = 0; pass < 40; pass++) {
      for (let x = 0; x <= 20; x += 2) stamps.push(slopeStamp(x, 0, 4, ramp, 0.2, false));
    }
    const height = (x: number, z: number): number =>
      stamps.reduce((h, s) => applyHeightStamp(s, x, z, h), 0);
    expect(height(5, 0)).toBeCloseTo(2.5, 1);
    expect(height(10, 0)).toBeCloseTo(5, 1);
    expect(height(15, 1)).toBeCloseTo(7.5, 1);
    // well outside the painted corridor the ground is untouched
    expect(height(10, 12)).toBe(0);
  });

  it('survives the shared map sanitizer, and clamps an over-steep ramp to the kept grade', () => {
    const map = newCustomMap('Slope', 'slope', 1);
    const stamp = slopeStamp(10, 0, 4, ramp, 0.2, false);
    const doc = sanitizeMapDoc({ ...map, terrainEdits: [stamp] });
    expect(doc?.terrainEdits[0]).toEqual(stamp);
    const cliff: SlopeRamp = { start: { x: 0, z: 0, y: 0 }, end: { x: 1, z: 0, y: 100 } };
    expect(slopeGradient(cliff).gx).toBe(MAX_SLOPE_GRADE);
  });
});
