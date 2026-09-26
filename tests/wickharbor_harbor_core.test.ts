import { describe, expect, it } from 'vitest';
import {
  WICKHARBOR_HARBOR_CRITICAL_PARTS,
  WICKHARBOR_HARBOR_OPTIONAL_PARTS,
  WICKHARBOR_HARBOR_TRIM_PARTS,
  wickharborHarborParts,
} from '../src/render/wickharbor_harbor_core';
import { WICKHARBOR_HARBOR_PROPS } from '../src/sim/content/wickharbor_harbor';

// Wickharbor's wooden harbor's pure core (src/render/wickharbor_harbor_core.ts): which parts
// each graphics tier draws. Everything a player walks on, bumps into or steers by is drawn on
// every tier; only collision-free dressing is shed (graphics-settings fairness).

describe('wickharbor harbor tiers (graphics fairness)', () => {
  it('keeps the plank fields, frame, stairs, rails, lanterns and cargo on every tier', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      const parts = wickharborHarborParts(tier);
      for (const p of WICKHARBOR_HARBOR_CRITICAL_PARTS) expect(parts, tier).toContain(p);
    }
    expect(wickharborHarborParts('low')).toEqual([...WICKHARBOR_HARBOR_CRITICAL_PARTS]);
    expect(wickharborHarborParts('medium')).toEqual([
      ...WICKHARBOR_HARBOR_CRITICAL_PARTS,
      ...WICKHARBOR_HARBOR_TRIM_PARTS,
    ]);
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      expect(wickharborHarborParts(tier)).toEqual([
        ...WICKHARBOR_HARBOR_CRITICAL_PARTS,
        ...WICKHARBOR_HARBOR_TRIM_PARTS,
        ...WICKHARBOR_HARBOR_OPTIONAL_PARTS,
      ]);
    }
  });

  it('draws every solid the sim collides with in a part the low tier keeps', () => {
    const drawnBy: Record<string, string> = {
      lanternPost: 'HarborLanterns',
      crateStack: 'HarborCargo',
      barrel: 'HarborCargo',
      bollard: 'HarborCargo',
      // the quay crane's mast and the cargo shelter's posts, with the jib and the roof
      timberPost: 'HarborCargo',
    };
    const low = wickharborHarborParts('low');
    for (const p of WICKHARBOR_HARBOR_PROPS) {
      expect(drawnBy[p.kind], p.kind).toBeDefined();
      expect(low).toContain(drawnBy[p.kind]);
    }
    // the walkable surfaces and the rails too
    for (const part of ['HarborDecks', 'HarborFrame', 'HarborStairs', 'HarborRails']) {
      expect(low).toContain(part);
    }
    // the shed parts hold nothing solid
    for (const part of [...WICKHARBOR_HARBOR_TRIM_PARTS, ...WICKHARBOR_HARBOR_OPTIONAL_PARTS]) {
      expect(Object.values(drawnBy)).not.toContain(part);
    }
  });
});
