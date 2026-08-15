import { describe, expect, it } from 'vitest';
import { NIGHT_LIGHT_STATIC_SLOTS } from '../src/render/night_light_field_core';
import { streetlampPlacements } from '../src/sim/colliders';
import { BUILTIN_WORLD, getActiveWorldContent, setActiveWorldContent } from '../src/sim/data';
import {
  LAMP_LIGHT_AXIS_MIN,
  LAMP_LIGHT_STRIDE,
  type LampSite,
  type LampTown,
  lampCarriesLight,
  lampFixtureYaw,
  planStreetlamps,
  type StreetlampProbes,
} from '../src/sim/streetlamp_layout';
import { roadDistance, terrainHeight } from '../src/sim/world';

// streetlamp_layout: where the streetlamps stand. Pure, so the layout
// is asserted directly here instead of eyeballed in a screenshot.

/** Distance from a point to the raw chords of a road set (the test's own
 *  "painted road" when no meander is being simulated). */
function chordDistance(
  roads: readonly (readonly { x: number; z: number }[])[],
  x: number,
  z: number,
): number {
  let best = Infinity;
  for (const road of roads) {
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const b = road[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2)) : 0;
      const dx = x - a.x - abx * t;
      const dz = z - a.z - abz * t;
      best = Math.min(best, Math.hypot(dx, dz));
    }
  }
  return best;
}

/** Flat ground and nothing in the way: the layout under a microscope.
 *  roadClear reports the true chord distance, as if the paint had no meander. */
function openGround(
  roads: readonly (readonly { x: number; z: number }[])[],
  overrides: Partial<StreetlampProbes> = {},
): StreetlampProbes {
  return {
    groundAt: () => 0,
    blocked: () => false,
    roadClear: (x, z) => chordDistance(roads, x, z),
    ...overrides,
  };
}

/** The closest any two lamps in a plan stand to each other. */
function closestPair(sites: readonly LampSite[]): number {
  let closest = Infinity;
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      closest = Math.min(closest, Math.hypot(sites[i].x - sites[j].x, sites[i].z - sites[j].z));
    }
  }
  return closest;
}

/** A yard along a site's road-facing yaw, in the same convention a Three Y
 *  rotation composes in (local +z at yaw 0, angles as `atan2(x, z)`). */
function stepTowardRoad(site: LampSite, distance: number): { x: number; z: number } {
  return {
    x: site.x + Math.sin(site.roadYaw) * distance,
    z: site.z + Math.cos(site.roadYaw) * distance,
  };
}

/** Turn a fixture-local horizontal direction into world space at a given yaw:
 *  the exact transform streetlamps.ts instances a lamp body with. */
function rotate(axisX: number, axisZ: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: axisX * c + axisZ * s, z: -axisX * s + axisZ * c };
}

const HUB: LampTown = { x: 0, z: 0, radius: 20 };
/** A straight 400 yd run due north out of the hub, as two authored waypoints. */
const STRAIGHT = [
  [
    { x: 0, z: 0 },
    { x: 0, z: 400 },
  ],
];

describe('planStreetlamps: the whole network is lit', () => {
  it('lines the road end to end, not just a walk out of the hub', () => {
    const plan = planStreetlamps(STRAIGHT, [HUB], openGround(STRAIGHT));
    const zs = plan.sites.map((s) => s.z);
    // reach = 20 * 1.6 + 60 = 92: the old plan stopped there; this one keeps
    // going to the far end (the last waymarker lands within one open step).
    expect(Math.max(...zs)).toBeGreaterThan(400 - 64);
    expect(Math.min(...zs)).toBeLessThan(30);
  });

  it('spaces lamps evenly along the open road', () => {
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT), { openSpacing: 25 });
    const zs = plan.sites.map((s) => s.z).sort((a, b) => a - b);
    expect(zs.length).toBeGreaterThan(10);
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i] - zs[i - 1]).toBeCloseTo(25, 6);
    }
  });

  it('packs lamps closer inside a town reach than out on the open road', () => {
    const plan = planStreetlamps(STRAIGHT, [HUB], openGround(STRAIGHT), {
      spacing: 10,
      openSpacing: 30,
      // this case is about the two spacing tiers, so the crowding floor (which
      // would eat a deliberately 10 yd town step) is lifted out of the way
      minSeparation: 4,
    });
    const zs = plan.sites.map((s) => s.z).sort((a, b) => a - b);
    const reach = HUB.radius * 1.6 + 60;
    const townGaps: number[] = [];
    const openGaps: number[] = [];
    for (let i = 1; i < zs.length; i++) {
      const gap = zs[i] - zs[i - 1];
      if (zs[i] < reach) townGaps.push(gap);
      else if (zs[i - 1] > reach) openGaps.push(gap);
    }
    expect(townGaps.length).toBeGreaterThan(2);
    expect(openGaps.length).toBeGreaterThan(2);
    for (const gap of townGaps) expect(gap).toBeCloseTo(10, 6);
    for (const gap of openGaps) expect(gap).toBeCloseTo(30, 6);
  });

  it('keeps the step running across waypoints instead of restarting at each', () => {
    // The authored roads have uneven waypoint spacing; restarting the step at
    // every corner bunches lamps up wherever a road is finely authored.
    const kinked = [
      [
        { x: 0, z: 0 },
        { x: 0, z: 13 }, // deliberately not a multiple of the spacing
        { x: 0, z: 400 },
      ],
    ];
    const plan = planStreetlamps(kinked, [], openGround(kinked), { openSpacing: 25 });
    const zs = plan.sites.map((s) => s.z).sort((a, b) => a - b);
    expect(zs.length).toBeGreaterThan(10);
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i] - zs[i - 1]).toBeCloseTo(25, 6);
    }
  });

  it('stands the posts off the road, alternating sides down the run', () => {
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT));
    const xs = plan.sites.map((s) => s.x);
    expect(xs.some((x) => x > 0)).toBe(true);
    expect(xs.some((x) => x < 0)).toBe(true);
    for (const x of xs) expect(Math.abs(x)).toBeGreaterThan(2.9);
  });

  it('assigns area identity from the road centre before alternating sides', () => {
    const plan = planStreetlamps(STRAIGHT, [], {
      ...openGround(STRAIGHT),
      areaAt: (x) => (x < 0 ? 'west' : 'east'),
    });
    expect(plan.sites.length).toBeGreaterThan(3);
    expect(plan.sites.every((site) => site.areaId === 'east')).toBe(true);
  });
});

describe('planStreetlamps: the clearance band against the painted road', () => {
  it('lands every post inside the band the roadClear probe reports', () => {
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT), {
      clearMin: 3.0,
      clearMax: 5.6,
    });
    expect(plan.sites.length).toBeGreaterThan(5);
    for (const site of plan.sites) {
      const clear = chordDistance(STRAIGHT, site.x, site.z);
      expect(clear).toBeGreaterThanOrEqual(3.0);
      expect(clear).toBeLessThanOrEqual(5.6);
    }
  });

  it('nudges a post OUT when the painted road has meandered under it', () => {
    // The paint is the chord shifted 2.5 yd toward +x: a fixed chord offset on
    // the +x side would stand IN the track. The probe reports the real paint.
    const shifted = (x: number, z: number) => chordDistance(STRAIGHT, x - 2.5, z);
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT, { roadClear: shifted }), {
      offset: 3.8,
      clearMin: 3.0,
      clearMax: 5.6,
    });
    expect(plan.sites.length).toBeGreaterThan(5);
    for (const site of plan.sites) {
      const clear = shifted(site.x, site.z);
      expect(clear).toBeGreaterThanOrEqual(3.0);
      expect(clear).toBeLessThanOrEqual(5.6);
    }
  });

  it('abandons a spot the band cannot be reached from, rather than misplacing it', () => {
    // A probe that always reports "on the road" is unescapable within maxNudges.
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT, { roadClear: () => 0 }));
    expect(plan.sites).toHaveLength(0);
  });

  it('rejects a painted-road correction that crowds an authored connector', () => {
    // The paint has swung 4.5yd east of the raw chord. Correcting posts on its
    // west side can otherwise pull them back across the authored connector.
    const shifted = (x: number, z: number) => chordDistance(STRAIGHT, x - 4.5, z);
    const probes = openGround(STRAIGHT, { roadClear: shifted });
    const unguarded = planStreetlamps(STRAIGHT, [], probes, { maxNudges: 10 });
    const guarded = planStreetlamps(STRAIGHT, [], probes, {
      authoredClearMin: 1.88,
      maxNudges: 10,
    });

    expect(unguarded.sites.some((site) => chordDistance(STRAIGHT, site.x, site.z) < 1.88)).toBe(
      true,
    );
    expect(guarded.sites.length).toBeGreaterThan(0);
    expect(guarded.sites.length).toBeLessThan(unguarded.sites.length);
    for (const site of guarded.sites) {
      expect(chordDistance(STRAIGHT, site.x, site.z)).toBeGreaterThanOrEqual(1.88);
    }
  });
});

describe('planStreetlamps: which way a lamp faces', () => {
  it('turns every post toward the road it stands beside, on either side', () => {
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT));
    const bySide = { east: 0, west: 0 };
    for (const site of plan.sites) {
      // The road runs due north at x = 0, so facing it is purely +/-x.
      expect(Math.cos(site.roadYaw)).toBeCloseTo(0, 6);
      expect(Math.sin(site.roadYaw)).toBeCloseTo(site.x > 0 ? -1 : 1, 6);
      if (site.x > 0) bySide.east++;
      else bySide.west++;
    }
    // both sides represented, so the assertion above covered both signs
    expect(bySide.east).toBeGreaterThan(2);
    expect(bySide.west).toBeGreaterThan(2);
  });

  it('faces the painted track, not the raw chord, after a meander nudged the post', () => {
    // The paint is the chord shifted 2.5 yd toward +x, so posts on the +x side
    // are pushed outward: a yaw derived from the side a post STARTED on would
    // still be right here, but only because it is measured after the nudge.
    const shifted = (x: number, z: number) => chordDistance(STRAIGHT, x - 2.5, z);
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT, { roadClear: shifted }));
    expect(plan.sites.length).toBeGreaterThan(5);
    for (const site of plan.sites) {
      const here = shifted(site.x, site.z);
      const ahead = stepTowardRoad(site, 1);
      // one step along the facing yaw always gets closer to the paint
      expect(shifted(ahead.x, ahead.z)).toBeCloseTo(here - 1, 6);
    }
  });
});

describe('lampFixtureYaw: the fixture hangs its light over the road', () => {
  // A post on the +x side of a road running due north: facing it means facing -x.
  const roadYaw = Math.atan2(-1, 0);

  it('swings a side-arm lantern out over the track and leaves the base outside', () => {
    // A lantern hung off the model's +x edge, 1.2 yd out from its own post.
    const yaw = lampFixtureYaw(roadYaw, 1.2, 0);
    const light = rotate(1.2, 0, yaw);
    expect(light.x).toBeCloseTo(-1.2, 6);
    expect(light.z).toBeCloseTo(0, 6);
    // and the post, which is the other end of that axis, ends up on the verge
    const base = rotate(-1.2, 0, yaw);
    expect(base.x).toBeCloseTo(1.2, 6);
  });

  it('lands the same way for a fixture whose light hangs off a different edge', () => {
    // The whole point of measuring the axis per model: an arm authored along
    // -z reaches over the road exactly as the +x one does, with no per-style
    // table to keep in step with the art.
    for (const axis of [
      [1.2, 0],
      [-1.2, 0],
      [0, 1.2],
      [0, -1.2],
      [0.85, 0.85],
    ] as const) {
      const light = rotate(axis[0], axis[1], lampFixtureYaw(roadYaw, axis[0], axis[1]));
      expect(light.x).toBeCloseTo(-Math.hypot(axis[0], axis[1]), 6);
      expect(light.z).toBeCloseTo(0, 6);
    }
  });

  it('squares a centred fixture up to the road rather than spinning it', () => {
    // A lantern carried straight above its post has no lit side to present, so
    // it simply faces the road; a row of them then reads as one aligned street.
    expect(lampFixtureYaw(roadYaw, 0, 0)).toBe(roadYaw);
    expect(lampFixtureYaw(roadYaw, LAMP_LIGHT_AXIS_MIN * 0.99, 0)).toBe(roadYaw);
    // just past the threshold the axis takes over
    expect(lampFixtureYaw(roadYaw, LAMP_LIGHT_AXIS_MIN * 1.01, 0)).not.toBe(roadYaw);
  });
});

describe('planStreetlamps: the rejection probes', () => {
  it('drops a site standing in water or over a void', () => {
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT, { groundAt: () => -8 }));
    expect(plan.sites).toHaveLength(0);
  });

  it('drops a site something else already occupies', () => {
    const blockedNorth = planStreetlamps(
      STRAIGHT,
      [],
      openGround(STRAIGHT, { blocked: (_x, z) => z > 200 }),
    );
    expect(blockedNorth.sites.length).toBeGreaterThan(0);
    for (const site of blockedNorth.sites) expect(site.z).toBeLessThanOrEqual(200);
  });

  it('carries the vetted ground height, so the builder never resamples', () => {
    const plan = planStreetlamps(STRAIGHT, [], openGround(STRAIGHT, { groundAt: () => 4.25 }));
    expect(plan.sites.length).toBeGreaterThan(0);
    for (const site of plan.sites) expect(site.y).toBe(4.25);
  });

  it('collapses lamps where two roads cross', () => {
    const crossing = [
      [
        { x: -200, z: 100 },
        { x: 200, z: 100 },
      ],
      [
        { x: 0, z: -100 },
        { x: 0, z: 300 },
      ],
    ];
    const plan = planStreetlamps(crossing, [], openGround(crossing), { minSeparation: 8 });
    expect(plan.sites.length).toBeGreaterThan(10);
    expect(closestPair(plan.sites)).toBeGreaterThanOrEqual(8);
  });

  it('leaves a real gap by default, not a token one', () => {
    // Two roads leaving a hub on a shallow fork: the pair of runs stays within
    // a few yards of each other for the first stretch, which is exactly where
    // posts used to end up close enough to read as one doubled fixture. The
    // default floor is two thirds of the town step, so a crowded pair collapses
    // while the rhythm of a lit street survives.
    const forked = [
      [
        { x: 0, z: 0 },
        { x: 0, z: 400 },
      ],
      [
        { x: 0, z: 0 },
        { x: 56, z: 400 },
      ],
    ];
    const plan = planStreetlamps(forked, [], openGround(forked));
    expect(plan.sites.length).toBeGreaterThan(10);
    expect(closestPair(plan.sites)).toBeGreaterThanOrEqual(18);
    // and the fork is genuinely tight, so the floor did the work rather than
    // the geometry never bringing two lamps near each other in the first place
    const tight = planStreetlamps(forked, [], openGround(forked), { minSeparation: 1 });
    expect(closestPair(tight.sites)).toBeLessThan(11);
    expect(tight.sites.length).toBeGreaterThan(plan.sites.length);
  });
});

describe('the real world lamp network is deterministic and finite', () => {
  const SEED = 0;
  // The SHIPPED list, not a re-plan. colliders.ts builds the world's lamps
  // exactly once, while its grid is still lamp-free, and plants a post on each;
  // re-planning here against a warm grid would hand the layout its own posts as
  // obstacles and quietly thin the network under every assertion below.
  const realSites = () => streetlampPlacements(SEED);

  it('lights the whole network, sparsely (waymarkers, not a boulevard)', () => {
    const sites = realSites();
    // ~13,500 yd of road at town spacing 26 / open spacing 64: a few hundred
    // posts. A runaway count is a perf regression (fixtures instance per zone,
    // but every third post carries a real light object); a collapsed count
    // means part of the network went dark.
    expect(sites.length).toBeGreaterThan(200);
    expect(sites.length).toBeLessThan(450);
  });

  it('stands every post beside the painted road, never on it', () => {
    for (const site of realSites()) {
      const clear = roadDistance(site.x, site.z);
      expect(clear).toBeGreaterThanOrEqual(3.0);
      expect(clear).toBeLessThanOrEqual(5.6);
    }
  });

  it('never stands a lamp in the sea', () => {
    for (const site of realSites()) expect(site.y).toBeGreaterThanOrEqual(-3);
  });

  it('fits every lamp within a hundred yards into the night field, with room for the fires', () => {
    // The field carries only its nearest NIGHT_LIGHT_STATIC_SLOTS fixed lights,
    // and a lamp outside that window casts NOTHING: its ground stays dark while
    // the lamp overhead lights a pool, which is what "the light only shows when
    // you are close" looked like. So the densest stretch of road has to leave
    // headroom for the camp braziers and fires that share the window.
    const sites = realSites();
    let crowded = 0;
    for (const anchor of sites) {
      let near = 0;
      for (const other of sites) {
        if (Math.hypot(other.x - anchor.x, other.z - anchor.z) <= 100) near++;
      }
      crowded = Math.max(crowded, near);
    }
    expect(crowded).toBeGreaterThan(8); // the busy stretches are genuinely busy
    expect(crowded).toBeLessThanOrEqual(NIGHT_LIGHT_STATIC_SLOTS - 8);
  });

  it('never crowds two lamps together, anywhere on the network', () => {
    // Junctions, hairpins and roads running in parallel are where a pair of
    // posts used to end up almost touching. The floor holds across the whole
    // network, not just the crossing the unit case builds.
    expect(closestPair(realSites())).toBeGreaterThanOrEqual(18);
  });

  it('turns every lamp on the network toward the road it lights', () => {
    // The facing yaw is only useful if stepping along it actually approaches
    // the PAINTED track, on meandering real roads rather than a test chord.
    for (const site of realSites()) {
      const here = roadDistance(site.x, site.z);
      const ahead = stepTowardRoad(site, 1);
      expect(roadDistance(ahead.x, ahead.z)).toBeLessThan(here);
    }
  });

  it('produces the identical layout twice (no hidden global state)', () => {
    const probes = (): StreetlampProbes => ({
      groundAt: (x, z) => terrainHeight(x, z, SEED),
      // Deliberately NOT resolvePosition: the shipped grid already carries the
      // lamp posts, so the point of this case (the planner itself holds no
      // state between runs) needs a probe that is the same on both passes.
      blocked: () => false,
      roadClear: roadDistance,
    });
    const content = getActiveWorldContent();
    const towns = content.zones.map((zone) => ({
      x: zone.hub.x,
      z: zone.hub.z,
      radius: zone.hub.radius,
    }));
    const plan = () => planStreetlamps(content.roads, towns, probes());
    expect(plan()).toEqual(plan());
    // and the memoized shipped list is one object, handed out unchanged
    expect(realSites()).toBe(realSites());
  });
});

describe('roadDistance follows the active custom-world roads', () => {
  it('drops the built-in smooth-road cache after a content swap', () => {
    const customRoads = [
      [
        { x: 1000, z: 1000 },
        { x: 1000, z: 1200 },
      ],
    ];
    setActiveWorldContent({ ...BUILTIN_WORLD, roads: customRoads });
    try {
      expect(roadDistance(1004, 1100)).toBeLessThan(12);
      const plan = planStreetlamps(customRoads, [], {
        ...openGround(customRoads),
        roadClear: roadDistance,
      });
      expect(plan.sites.length).toBeGreaterThan(0);
    } finally {
      setActiveWorldContent(null);
    }
  });
});

describe('lampCarriesLight (which posts get a real point light)', () => {
  it('lights one post in three, so the shared budget still has room', () => {
    expect(LAMP_LIGHT_STRIDE).toBe(3);
    const lit = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(lampCarriesLight);
    expect(lit).toEqual([0, 3, 6]);
  });

  it('always lights the first post of a zone, so a small zone is never dark', () => {
    expect(lampCarriesLight(0)).toBe(true);
  });
});
