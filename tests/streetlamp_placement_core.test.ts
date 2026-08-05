import { describe, expect, it } from 'vitest';
import {
  LAMP_LIGHT_STRIDE,
  type LampTown,
  lampCarriesLight,
  planStreetlamps,
  type StreetlampProbes,
} from '../src/render/streetlamp_placement_core';
import { resolvePosition } from '../src/sim/colliders';
import { getActiveWorldContent } from '../src/sim/data';
import { propPlacementRoll } from '../src/sim/prop_layout';
import { terrainHeight } from '../src/sim/world';

// streetlamp_placement_core: where the town streetlamps stand. Pure, so the
// layout is asserted directly here instead of eyeballed in a screenshot.

/** Flat ground, nothing in the way, a fixed roll: the layout under a microscope. */
function openGround(overrides: Partial<StreetlampProbes> = {}): StreetlampProbes {
  return {
    groundAt: () => 0,
    blocked: () => false,
    roll: () => 0.5,
    ...overrides,
  };
}

const HUB: LampTown = { x: 0, z: 0, radius: 20 };
/** A straight 200 yd run due north out of the hub, as two authored waypoints. */
const STRAIGHT = [
  [
    { x: 0, z: 0 },
    { x: 0, z: 200 },
  ],
];

describe('planStreetlamps: spacing and reach', () => {
  it('spaces lamps evenly along the road', () => {
    const plan = planStreetlamps(STRAIGHT, [HUB], openGround(), { spacing: 10, offset: 0 });
    expect(plan.sites.length).toBeGreaterThan(3);
    for (let i = 1; i < plan.sites.length; i++) {
      expect(plan.sites[i].z - plan.sites[i - 1].z).toBeCloseTo(10, 9);
    }
  });

  it('stops at the town reach instead of lighting the whole road', () => {
    // reach = radius * reachScale + reachPad
    const plan = planStreetlamps(STRAIGHT, [HUB], openGround(), {
      spacing: 10,
      offset: 0,
      reachScale: 1,
      reachPad: 30,
    });
    for (const site of plan.sites) expect(site.z).toBeLessThanOrEqual(50);
    // and it really did use the whole reach, not just the first chord
    expect(Math.max(...plan.sites.map((s) => s.z))).toBeGreaterThan(40);
  });

  it('keeps the step running across waypoints instead of restarting at each', () => {
    // The authored roads have uneven waypoint spacing; restarting the step at
    // every corner (the older Icemantle lantern loop does) bunches lamps up
    // wherever a road happens to be finely authored.
    const kinked = [
      [
        { x: 0, z: 0 },
        { x: 0, z: 13 }, // deliberately not a multiple of the spacing
        { x: 0, z: 60 },
      ],
    ];
    const plan = planStreetlamps(kinked, [HUB], openGround(), { spacing: 10, offset: 0 });
    for (let i = 1; i < plan.sites.length; i++) {
      expect(plan.sites[i].z - plan.sites[i - 1].z).toBeCloseTo(10, 9);
    }
  });

  it('stands the posts off the road, alternating sides down the run', () => {
    const plan = planStreetlamps(STRAIGHT, [HUB], openGround(), { spacing: 10, offset: 3 });
    const offsets = plan.sites.map((s) => s.x);
    expect(new Set(offsets.map(Math.abs))).toEqual(new Set([3]));
    // consecutive lamps sit on opposite sides
    for (let i = 1; i < offsets.length; i++) {
      expect(Math.sign(offsets[i])).toBe(-Math.sign(offsets[i - 1]));
    }
  });
});

describe('planStreetlamps: the rejection probes', () => {
  it('drops a site standing in water or over a void', () => {
    const drowned = planStreetlamps(STRAIGHT, [HUB], openGround({ groundAt: () => -40 }), {
      spacing: 10,
      offset: 0,
    });
    expect(drowned.sites).toHaveLength(0);
  });

  it('drops a site something else already occupies', () => {
    const blockedNorth = planStreetlamps(
      STRAIGHT,
      [HUB],
      openGround({ blocked: (_x, z) => z > 25 }),
      { spacing: 10, offset: 0 },
    );
    expect(blockedNorth.sites.length).toBeGreaterThan(0);
    for (const site of blockedNorth.sites) expect(site.z).toBeLessThanOrEqual(25);
  });

  it('carries the vetted ground height, so the builder never resamples', () => {
    const plan = planStreetlamps(STRAIGHT, [HUB], openGround({ groundAt: () => 7.5 }), {
      spacing: 10,
      offset: 0,
    });
    for (const site of plan.sites) expect(site.y).toBe(7.5);
  });

  it('collapses lamps where two roads converge on the same hub', () => {
    // Roads meet at a town, so their runs overlap on the approach; without the
    // separation guard the shared stretch gets two posts in the same spot.
    const converging = [
      [
        { x: 0, z: 0 },
        { x: 0, z: 60 },
      ],
      [
        { x: 0.4, z: 0 },
        { x: 0.4, z: 60 },
      ],
    ];
    const plan = planStreetlamps(converging, [HUB], openGround(), {
      spacing: 10,
      offset: 0,
      minSeparation: 6,
    });
    for (let i = 0; i < plan.sites.length; i++) {
      for (let j = i + 1; j < plan.sites.length; j++) {
        const dx = plan.sites[i].x - plan.sites[j].x;
        const dz = plan.sites[i].z - plan.sites[j].z;
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(6);
      }
    }
  });
});

describe('planStreetlamps: towns own their lamps', () => {
  it('tags every lamp with its town and reports contiguous ranges', () => {
    const towns: LampTown[] = [
      { x: 0, z: 0, radius: 20 },
      { x: 0, z: 400, radius: 20 },
    ];
    const road = [
      [
        { x: 0, z: -60 },
        { x: 0, z: 460 },
      ],
    ];
    const plan = planStreetlamps(road, towns, openGround(), { spacing: 10, offset: 0 });
    expect(plan.townRanges).toHaveLength(2);
    for (let t = 0; t < towns.length; t++) {
      const { start, end } = plan.townRanges[t];
      expect(end).toBeGreaterThan(start);
      for (let i = start; i < end; i++) expect(plan.sites[i].town).toBe(t);
    }
    // the two towns light their own approaches and nothing between them
    expect(plan.townRanges[0].end).toBe(plan.townRanges[1].start);
    const gap = plan.sites.filter((s) => s.z > 120 && s.z < 280);
    expect(gap).toHaveLength(0);
  });

  it('gives a town with no road nearby an empty range rather than a hole', () => {
    const towns: LampTown[] = [
      { x: 0, z: 0, radius: 20 },
      { x: 5000, z: 5000, radius: 20 },
    ];
    const plan = planStreetlamps(STRAIGHT, towns, openGround(), { spacing: 10, offset: 0 });
    expect(plan.townRanges[1].end - plan.townRanges[1].start).toBe(0);
  });
});

describe('planStreetlamps is deterministic and finite on the real world', () => {
  const seed = 12345;
  const content = getActiveWorldContent();
  const towns = content.zones.map((zone) => ({
    x: zone.hub.x,
    z: zone.hub.z,
    radius: zone.hub.radius,
  }));
  const probes: StreetlampProbes = {
    groundAt: (x, z) => terrainHeight(x, z, seed),
    blocked: (x, z) => {
      const resolved = resolvePosition(seed, x, z, 1.1);
      return Math.abs(resolved.x - x) > 0.05 || Math.abs(resolved.z - z) > 0.05;
    },
    roll: propPlacementRoll,
  };

  it('lights every town, and none of them extravagantly', () => {
    const plan = planStreetlamps(content.roads, towns, probes);
    expect(plan.townRanges).toHaveLength(content.zones.length);
    for (let t = 0; t < towns.length; t++) {
      const count = plan.townRanges[t].end - plan.townRanges[t].start;
      // A town with no lamps at all means its roads stopped reaching the hub;
      // a town with hundreds means the reach or the spacing has run away and
      // the per-town instanced draw is no longer a per-town draw.
      expect(count, content.zones[t].hub.name).toBeGreaterThan(0);
      expect(count, content.zones[t].hub.name).toBeLessThan(80);
    }
  });

  it('produces the identical layout twice (no hidden global state)', () => {
    const a = planStreetlamps(content.roads, towns, probes);
    const b = planStreetlamps(content.roads, towns, probes);
    expect(a.sites).toEqual(b.sites);
    expect(a.townRanges).toEqual(b.townRanges);
  });

  it('never stands a lamp in the sea', () => {
    const plan = planStreetlamps(content.roads, towns, probes);
    for (const site of plan.sites) expect(site.y).toBeGreaterThanOrEqual(-3);
  });
});

describe('lampCarriesLight (which posts get a real point light)', () => {
  it('lights one post in three, so the shared budget still has room', () => {
    // renderer.ts budgetFireLights keeps only GFX.maxPointLights alive at once,
    // and campfires, braziers, and quest glows already compete for those slots.
    expect(LAMP_LIGHT_STRIDE).toBe(3);
    expect([0, 1, 2, 3, 4, 5, 6].map(lampCarriesLight)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it('always lights the first post of a town, so a small town is never dark', () => {
    expect(lampCarriesLight(0)).toBe(true);
  });
});
