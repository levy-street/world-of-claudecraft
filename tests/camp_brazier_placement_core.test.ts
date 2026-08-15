import { describe, expect, it } from 'vitest';
import {
  type BrazierProbes,
  FALLBACK_RINGS,
  planCampBrazierSites,
  ROAD_CLEAR,
} from '../src/render/camp_brazier_placement_core';
import type { MobFamily } from '../src/sim/types';

// camp_brazier_placement_core: where the camp fires stand and which kind each
// one is. Pure, so the ring-slide and kind-split rules are asserted directly
// here; the real-world integration lives in tests/camp_braziers.test.ts.

const familyOf = (mobId: string): MobFamily | undefined =>
  (
    ({
      bandit: 'humanoid',
      wolf: 'beast',
      grump: 'ogre',
    }) as const
  )[mobId];

function openGround(overrides: Partial<BrazierProbes> = {}): BrazierProbes {
  return {
    groundAt: () => 2,
    blocked: () => false,
    roadClear: () => 100,
    roll: () => 0.7,
    ...overrides,
  };
}

const CAMP = (x: number, z: number, mobId = 'bandit') => ({ mobId, center: { x, z } });

describe('which camps burn', () => {
  it('lights fire-building camps and skips beast dens', () => {
    const sites = planCampBrazierSites(
      [CAMP(0, 0, 'bandit'), CAMP(50, 50, 'wolf'), CAMP(90, 90, 'grump')],
      [],
      familyOf,
      openGround(),
      -4.5,
    );
    expect(sites.map((s) => [s.x, s.z])).toEqual([
      [0, 0],
      [90, 90],
    ]);
  });

  it('skips a camp an authored campfire already lights', () => {
    const sites = planCampBrazierSites([CAMP(0, 0)], [[3, 4]], familyOf, openGround(), -4.5);
    expect(sites).toHaveLength(0);
  });

  it('skips a drowned camp', () => {
    const sites = planCampBrazierSites(
      [CAMP(0, 0)],
      [],
      familyOf,
      openGround({ groundAt: () => -8 }),
      -4.5,
    );
    expect(sites).toHaveLength(0);
  });
});

describe('the deterministic kind split', () => {
  it('rolls a fire pit under 0.5 and a brazier over it, per site', () => {
    const pit = planCampBrazierSites(
      [CAMP(0, 0)],
      [],
      familyOf,
      openGround({ roll: () => 0.2 }),
      -4.5,
    );
    expect(pit[0].kind).toBe('firepit');
    const brazier = planCampBrazierSites(
      [CAMP(0, 0)],
      [],
      familyOf,
      openGround({ roll: () => 0.7 }),
      -4.5,
    );
    expect(brazier[0].kind).toBe('brazier');
  });

  it('is identical across two runs (no hidden state)', () => {
    const camps = [CAMP(0, 0), CAMP(40, -20), CAMP(-70, 15, 'grump')];
    const run = () => planCampBrazierSites(camps, [], familyOf, openGround(), -4.5);
    expect(run()).toEqual(run());
  });
});

describe('the fallback ring', () => {
  it('slides off a blocked centre to the first clear ring spot', () => {
    const sites = planCampBrazierSites(
      [CAMP(0, 0)],
      [],
      familyOf,
      openGround({ blocked: (x, z) => x === 0 && z === 0 }),
      -4.5,
    );
    expect(sites).toHaveLength(1);
    const d = Math.hypot(sites[0].x, sites[0].z);
    expect(d).toBeCloseTo(FALLBACK_RINGS[0], 6);
  });

  it('slides a camp authored against the road until the fire clears it', () => {
    // the road runs along x = 0: clearance is |x|; the centre sits ON it
    const sites = planCampBrazierSites(
      [CAMP(0, 0)],
      [],
      familyOf,
      openGround({ roadClear: (x) => Math.abs(x) }),
      -4.5,
    );
    expect(sites).toHaveLength(1);
    expect(Math.abs(sites[0].x)).toBeGreaterThanOrEqual(ROAD_CLEAR);
  });

  it('keeps the centre when the whole ring is blocked: a dark camp is worse', () => {
    const sites = planCampBrazierSites(
      [CAMP(0, 0)],
      [],
      familyOf,
      openGround({ blocked: () => true }),
      -4.5,
    );
    expect(sites).toHaveLength(1);
    expect([sites[0].x, sites[0].z]).toEqual([0, 0]);
  });

  it('takes the clearest unblocked spot when nothing fully clears the road', () => {
    // clearance grows with |z| but never reaches ROAD_CLEAR on the near ring;
    // the wide ring does reach it
    const sites = planCampBrazierSites(
      [CAMP(0, 0)],
      [],
      familyOf,
      openGround({ roadClear: (_x, z) => Math.abs(z) * 0.6 }),
      -4.5,
    );
    expect(sites).toHaveLength(1);
    expect(Math.abs(sites[0].z) * 0.6).toBeGreaterThanOrEqual(ROAD_CLEAR);
  });
});
