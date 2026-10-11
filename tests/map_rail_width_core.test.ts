import { describe, expect, it } from 'vitest';
import { SETTING_RANGES } from '../src/game/settings';
import {
  clampMapRailWidth,
  MAP_RAIL_DEFAULT_WIDTH,
  MAP_RAIL_KEY_FINE_STEP,
  MAP_RAIL_KEY_STEP,
  MAP_RAIL_MAX_WIDTH,
  MAP_RAIL_MIN_WIDTH,
  mapRailWidthAfterDrag,
  mapRailWidthAfterKey,
} from '../src/ui/hud/map/map_rail_width_core';

describe('map atlas rail width', () => {
  it('mirrors the persisted setting range exactly', () => {
    expect(SETTING_RANGES.mapAtlasRailWidth).toEqual({
      min: MAP_RAIL_MIN_WIDTH,
      max: MAP_RAIL_MAX_WIDTH,
      def: MAP_RAIL_DEFAULT_WIDTH,
    });
    expect(MAP_RAIL_DEFAULT_WIDTH).toBe(300);
  });

  it('clamps, rounds, and falls back to the default for junk', () => {
    expect(clampMapRailWidth(412.6)).toBe(413);
    expect(clampMapRailWidth(10)).toBe(MAP_RAIL_MIN_WIDTH);
    expect(clampMapRailWidth(9000)).toBe(MAP_RAIL_MAX_WIDTH);
    expect(clampMapRailWidth(Number.NaN)).toBe(MAP_RAIL_DEFAULT_WIDTH);
    expect(clampMapRailWidth('400')).toBe(MAP_RAIL_DEFAULT_WIDTH);
    expect(clampMapRailWidth(null)).toBe(MAP_RAIL_DEFAULT_WIDTH);
  });

  it('converts a zoomed pointer drag into author px', () => {
    expect(mapRailWidthAfterDrag(300, 120, 1)).toBe(420);
    expect(mapRailWidthAfterDrag(300, 120, 1.5)).toBe(380);
    expect(mapRailWidthAfterDrag(300, -500, 1)).toBe(MAP_RAIL_MIN_WIDTH);
    expect(mapRailWidthAfterDrag(300, 60, 0)).toBe(360); // a bad scale reads as 1
  });

  it('steps with the arrows, fine-steps with Shift, and jumps with Home and End', () => {
    expect(mapRailWidthAfterKey(300, 'ArrowRight', false)).toBe(300 + MAP_RAIL_KEY_STEP);
    expect(mapRailWidthAfterKey(300, 'ArrowLeft', false)).toBe(300 - MAP_RAIL_KEY_STEP);
    expect(mapRailWidthAfterKey(300, 'ArrowRight', true)).toBe(300 + MAP_RAIL_KEY_FINE_STEP);
    expect(mapRailWidthAfterKey(300, 'Home', false)).toBe(MAP_RAIL_MIN_WIDTH);
    expect(mapRailWidthAfterKey(300, 'End', false)).toBe(MAP_RAIL_MAX_WIDTH);
    expect(mapRailWidthAfterKey(MAP_RAIL_MAX_WIDTH, 'ArrowRight', false)).toBe(MAP_RAIL_MAX_WIDTH);
    expect(mapRailWidthAfterKey(300, 'ArrowUp', false)).toBeNull();
    expect(mapRailWidthAfterKey(300, 'a', false)).toBeNull();
  });
});
