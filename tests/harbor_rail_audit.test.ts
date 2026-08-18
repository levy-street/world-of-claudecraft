// The railing completeness audit (J5): the owner asked for a mechanical
// proof that every stretch of boardwalk over open water carries a railing,
// after "the last stretch" shipped with its rail visually buried under the
// seam ramp and a 2.4 yard authored opening on each berth-head corridor.
// Arm 1 audits deck-edge rail coverage from HarborDef alone; arm 2 audits
// the DRAWN rail profile against the walk surface along every run. Each arm
// carries a failing control so a regression cannot pass silently.

import { describe, expect, it } from 'vitest';
import { railHeightProfile, railProfileTopAt } from '../src/render/harbor_rail_profile_core';
import {
  GULLHAVEN_HARBOR,
  HARBOR_RAIL_HEIGHT,
  HARBORS,
  type HarborDef,
  type HarborRail,
  harborSurfaceHeight,
  MAINLAND_HARBOR,
} from '../src/sim/harbor_layout';
import { buriedRailSamples, unrailedDeckEdgeGaps } from '../src/sim/harbor_rail_audit';

function samplerFor(harbor: HarborDef): (x: number, z: number) => number {
  return (x, z) => harborSurfaceHeight(harbor, x, z);
}

function outerPierRailIndexes(harbor: HarborDef): number[] {
  // The long outer-pier/outer-run rails that flank the climbing seam ramp:
  // mainland { x: 215, hw: 9.5 } pair, gullhaven { x: 740.7, hw: 12.3 } pair.
  const wanted = harbor.id === 'mainland' ? { x: 215, hw: 9.5 } : { x: 740.7, hw: 12.3 };
  return harbor.rails
    .map((rail, index) => ({ rail, index }))
    .filter(({ rail }) => rail.rot === 0 && rail.x === wanted.x && rail.hw === wanted.hw)
    .map(({ index }) => index);
}

describe('harbor railing completeness (J5)', () => {
  it('rails every open-water boardwalk edge at both harbors, no allowances needed', () => {
    for (const harbor of HARBORS) {
      expect(unrailedDeckEdgeGaps(harbor), harbor.id).toEqual([]);
    }
  });

  it('control: removing the mainland apron north rail is detected as a gap', () => {
    const doctored: HarborDef = {
      ...MAINLAND_HARBOR,
      rails: MAINLAND_HARBOR.rails.filter((rail) => !(rail.x === 173 && rail.z === -41)),
    };
    const gaps = unrailedDeckEdgeGaps(doctored);
    expect(gaps.length).toBeGreaterThan(0);
    const apronNorth = gaps.find(
      (gap) => gap.edge === 'z+' && Math.abs(gap.edgeCoord - -41) < 0.01,
    );
    expect(apronNorth).toBeDefined();
    // The whole 14 yard apron edge is open, not just a sliver of it.
    if (apronNorth) expect(apronNorth.to - apronNorth.from).toBeGreaterThan(10);
  });

  it('control: removing a corridor closure rail reopens the arrival-sweep gap', () => {
    for (const harbor of HARBORS) {
      const closureZ =
        harbor.id === 'mainland'
          ? MAINLAND_HARBOR.rails.find((rail) => rail.x === 229.7)
          : GULLHAVEN_HARBOR.rails.find((rail) => rail.x === 723.8);
      expect(closureZ, harbor.id).toBeDefined();
      const doctored: HarborDef = {
        ...harbor,
        rails: harbor.rails.filter((rail) => rail !== closureZ),
      };
      const gaps = unrailedDeckEdgeGaps(doctored);
      const corridor = gaps.find((gap) => gap.edge === 'z-' && gap.to - gap.from > 2);
      expect(corridor, harbor.id).toBeDefined();
    }
  });

  it('an allowance suppresses exactly its own span and nothing wider', () => {
    const doctored: HarborDef = {
      ...MAINLAND_HARBOR,
      rails: MAINLAND_HARBOR.rails.filter((rail) => !(rail.x === 173 && rail.z === -41)),
    };
    const full = unrailedDeckEdgeGaps(doctored, [
      { harborId: 'mainland', edge: 'z+', edgeCoord: -41, from: 166, to: 180 },
    ]);
    expect(
      full.find((gap) => gap.edge === 'z+' && Math.abs(gap.edgeCoord - -41) < 0.01),
    ).toBeUndefined();
    // A narrower allowance must NOT swallow the whole gap.
    const narrow = unrailedDeckEdgeGaps(doctored, [
      { harborId: 'mainland', edge: 'z+', edgeCoord: -41, from: 166, to: 170 },
    ]);
    expect(
      narrow.find((gap) => gap.edge === 'z+' && Math.abs(gap.edgeCoord - -41) < 0.01),
    ).toBeDefined();
    // An allowance for the other harbor never applies.
    const wrongHarbor = unrailedDeckEdgeGaps(doctored, [
      { harborId: 'gullhaven', edge: 'z+', edgeCoord: -41, from: 166, to: 180 },
    ]);
    expect(
      wrongHarbor.find((gap) => gap.edge === 'z+' && Math.abs(gap.edgeCoord - -41) < 0.01),
    ).toBeDefined();
  });

  it('the drawn rail profile clears the walk surface along every run', () => {
    for (const harbor of HARBORS) {
      const surfaceAt = samplerFor(harbor);
      const profiles = harbor.rails.map((rail) => railHeightProfile(rail, surfaceAt));
      const buried = buriedRailSamples(harbor, (_rail, railIndex, along) =>
        railProfileTopAt(profiles[railIndex], along),
      );
      expect(buried, harbor.id).toEqual([]);
    }
  });

  it('control: the old center-sampled flat cap is caught on both outer piers', () => {
    for (const harbor of HARBORS) {
      const surfaceAt = samplerFor(harbor);
      const flatTop = (rail: HarborRail): number => surfaceAt(rail.x, rail.z) + HARBOR_RAIL_HEIGHT;
      const buried = buriedRailSamples(harbor, (rail) => flatTop(rail));
      expect(buried.length, harbor.id).toBeGreaterThan(0);
      const outer = new Set(outerPierRailIndexes(harbor));
      expect(outer.size, harbor.id).toBe(2);
      const flagged = new Set(
        buried.filter((sample) => outer.has(sample.railIndex)).map((s) => s.railIndex),
      );
      // Both flanking rails dive under the seam ramp's climb.
      expect(flagged.size, harbor.id).toBe(2);
    }
  });
});
