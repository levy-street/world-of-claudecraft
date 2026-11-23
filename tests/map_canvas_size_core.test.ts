import { describe, expect, it } from 'vitest';
import {
  MAP_CANVAS_DEFAULT_SIDE,
  MAP_CANVAS_MAX_SIDE,
  MAP_CANVAS_MIN_SIDE,
  mapCanvasBackingSide,
} from '../src/ui/hud/map/map_canvas_size_core';

describe('mapCanvasBackingSide', () => {
  it('matches the displayed square 1:1 in author px', () => {
    expect(mapCanvasBackingSide(560, 560)).toBe(MAP_CANVAS_DEFAULT_SIDE);
    expect(mapCanvasBackingSide(812, 812)).toBe(812);
  });

  it('takes the shorter axis of a non-square box and rounds to whole px', () => {
    expect(mapCanvasBackingSide(900, 640.4)).toBe(640);
    expect(mapCanvasBackingSide(700.6, 1000)).toBe(701);
  });

  it('clamps to the readable minimum and the fill-cost maximum', () => {
    expect(mapCanvasBackingSide(120, 120)).toBe(MAP_CANVAS_MIN_SIDE);
    expect(mapCanvasBackingSide(5000, 4000)).toBe(MAP_CANVAS_MAX_SIDE);
  });

  it('keeps the current backing for a box that is not laid out', () => {
    expect(mapCanvasBackingSide(0, 0)).toBeNull();
    expect(mapCanvasBackingSide(560, 0)).toBeNull();
    expect(mapCanvasBackingSide(Number.NaN, 560)).toBeNull();
  });
});
