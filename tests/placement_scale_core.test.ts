import { describe, expect, it } from 'vitest';
import {
  applyScaleEqualize,
  EQUALIZABLE_BUILDING_ASSET_IDS,
  planScaleEqualize,
} from '../src/editor/placement_scale_core';
import type { MapPlacement } from '../src/sim/map_doc';

function placement(over: Partial<MapPlacement> = {}): MapPlacement {
  return {
    assetId: 'props/inn',
    x: 0,
    z: 0,
    y: 0,
    rotY: 0,
    scale: 4,
    collide: true,
    ...over,
  } as MapPlacement;
}

describe('placement scale equalize', () => {
  it('evens the horizontal axes while keeping footprint area and height', () => {
    // Building 28 as the shipped map carries it.
    const placements = [placement({ name: 'Building 28', scaleX: 1.367, scaleZ: 0.721 })];
    const plans = planScaleEqualize(placements);
    expect(plans).toHaveLength(1);
    applyScaleEqualize(placements, plans);
    const p = placements[0];
    expect(p.scaleX).toBeCloseTo(p.scaleZ as number, 12);
    // area preserved
    expect((p.scaleX as number) * (p.scaleZ as number)).toBeCloseTo(1.367 * 0.721, 10);
    // height untouched
    expect(p.scaleY).toBe(1);
    expect(p.scale).toBe(4);
  });

  it('snaps to the model proportions in natural mode', () => {
    const placements = [placement({ scaleX: 1.522, scaleZ: 1.897 })];
    applyScaleEqualize(placements, planScaleEqualize(placements, { mode: 'natural' }));
    expect(placements[0].scaleX).toBe(1);
    expect(placements[0].scaleY).toBe(1);
    expect(placements[0].scaleZ).toBe(1);
  });

  it('leaves deliberately stretched scenery alone', () => {
    // A fence module is stretched to span the gap to the next post, and a
    // toppled ruin column is squashed on purpose. Equalizing either would be a
    // regression, so they are not eligible.
    const placements = [
      placement({ assetId: 'props/fence', scaleX: 0.362, scaleZ: 1.149 }),
      placement({ assetId: 'props/column_broken', scaleX: 1.85, scaleZ: 1.93 }),
      placement({ assetId: 'foliage/rock_1', scaleX: 1.01, scaleY: 0.683, scaleZ: 1.241 }),
    ];
    expect(planScaleEqualize(placements)).toHaveLength(0);
  });

  it('skips placements that are already even', () => {
    const placements = [
      placement({ scaleX: 1, scaleZ: 1 }),
      placement({ scaleX: 1.005, scaleZ: 0.995 }),
      placement({}),
    ];
    expect(planScaleEqualize(placements)).toHaveLength(0);
  });

  it('is idempotent: a second pass finds nothing', () => {
    const placements = [placement({ scaleX: 1.7, scaleZ: 0.6 })];
    applyScaleEqualize(placements, planScaleEqualize(placements));
    expect(planScaleEqualize(placements)).toHaveLength(0);
  });

  it('honours an index scope so the action can run on a selection', () => {
    const placements = [
      placement({ scaleX: 1.4, scaleZ: 0.7 }),
      placement({ scaleX: 1.4, scaleZ: 0.7 }),
    ];
    const plans = planScaleEqualize(placements, { indexes: [1] });
    expect(plans.map((p) => p.index)).toEqual([1]);
    applyScaleEqualize(placements, plans);
    expect(placements[0].scaleX).toBe(1.4);
    expect(placements[1].scaleX).toBeCloseTo(Math.sqrt(1.4 * 0.7), 12);
  });

  it('applies to a plan whose placement moved by refusing the mismatched slot', () => {
    const placements = [placement({ scaleX: 1.4, scaleZ: 0.7 })];
    const plans = planScaleEqualize(placements);
    placements[0] = placement({ assetId: 'props/well', scaleX: 1.4, scaleZ: 0.7 });
    applyScaleEqualize(placements, plans);
    expect(placements[0].scaleX).toBe(1.4);
  });

  it('covers the six kit building models the fitter stretches', () => {
    expect([...EQUALIZABLE_BUILDING_ASSET_IDS].sort()).toEqual([
      'props/bell_tower',
      'props/blacksmith',
      'props/house_1',
      'props/house_2',
      'props/house_3',
      'props/inn',
    ]);
  });
});
