// The town buildings' distance tiers (render/placed_batch_core.ts): the full
// model to 200 yd, its baked LOD twin to 300, the twin's sprite to 500, then
// nothing (SPACEY, 2026-09-26: "300 imposters and then 500yd dont even render
// the bulding at all"). Each edge has the same hysteresis as the sprite tier.

import { describe, expect, it } from 'vitest';
import {
  BUILDING_CULL,
  PLACED_LOD_HYSTERESIS,
  placedTwinLevel,
  TWIN_FAR,
  TWIN_NEAR,
  twinPathFor,
} from '../src/render/placed_batch_core';

const sq = (d: number) => d * d;

describe('twinPathFor', () => {
  it('names the twin of every town building and nothing else', () => {
    expect(twinPathFor('/models/tidehold/house_b.glb')).toBe('/models/tidehold/house_b.lod.glb');
    expect(twinPathFor('/models/tidehold/tavern_b.glb')).toBe('/models/tidehold/tavern_b.lod.glb');
    expect(twinPathFor('/models/tidehold/bank.glb?v=1')).toBe('/models/tidehold/bank.lod.glb');
    expect(twinPathFor('/models/tidehold/bank.parts.glb')).toBeNull();
    expect(twinPathFor('/models/tidehold/castle_b.glb')).toBeNull();
    expect(twinPathFor('/models/foliage/pine_01.glb')).toBeNull();
    expect(twinPathFor(undefined)).toBeNull();
  });
});

describe('placedTwinLevel', () => {
  it('steps full -> twin -> sprite outward at 200 and 300', () => {
    expect(TWIN_NEAR).toBe(200);
    expect(TWIN_FAR).toBe(300);
    expect(BUILDING_CULL).toBe(500);
    expect(placedTwinLevel(sq(150), 0)).toBe(0);
    expect(placedTwinLevel(sq(210), 0)).toBe(2);
    expect(placedTwinLevel(sq(310), 2)).toBe(1);
    // a jump (a teleport) lands in the right tier at once
    expect(placedTwinLevel(sq(450), 0)).toBe(1);
    expect(placedTwinLevel(sq(50), 1)).toBe(0);
  });

  it('holds a tier inside the hysteresis band', () => {
    const back = TWIN_NEAR / PLACED_LOD_HYSTERESIS;
    expect(placedTwinLevel(sq(back + 2), 2)).toBe(2);
    expect(placedTwinLevel(sq(back - 2), 2)).toBe(0);
    const back2 = TWIN_FAR / PLACED_LOD_HYSTERESIS;
    expect(placedTwinLevel(sq(back2 + 2), 1)).toBe(1);
    expect(placedTwinLevel(sq(back2 - 2), 1)).toBe(2);
  });

  it('keeps the twin to the cull when there is no sprite tier', () => {
    expect(placedTwinLevel(sq(450), 2, false)).toBe(2);
    expect(placedTwinLevel(sq(450), 1, false)).toBe(2);
  });
});
