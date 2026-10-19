// Gourdlight Eve's road lanterns (src/sim/seasonal_road_lanterns.ts), pinned against the
// LIVE world: every route between the event cities (and down to Old Thatchgrin's field)
// is lit, every post stands on the verge and never on the road, never in water, beside a
// bridge, inside a building, a tree, a town's own dressing or the boss field, spaced and
// alternating sides; and the renderer draws them only while the event runs.
import { describe, expect, it } from 'vitest';
import {
  ROAD_SEGMENT_MAX,
  ROAD_SEGMENT_SPAN,
  roadLanternSegments,
} from '../src/render/seasonal_road_lanterns_core';
import { isBlocked } from '../src/sim/colliders';
import {
  GOURDLIGHT_DECOR_CITIES,
  GOURDLIGHT_ROAD_LANTERNS,
} from '../src/sim/content/gourdlight_eve_decor';
import { CAMPS, getActiveWorldContent } from '../src/sim/data';
import { resolveScarecrowField } from '../src/sim/seasonal/scarecrow_field';
import { chapelAt } from '../src/sim/seasonal_decor_exclusions';
import { DECOR_ROAD_CLEARANCE } from '../src/sim/seasonal_decor_layout';
import {
  ROAD_LANTERN_BAND,
  ROAD_LANTERN_CAMP_HEART,
  ROAD_LANTERN_COLLIDER_CLEARANCE,
  ROAD_LANTERN_FIELD_CLEARANCE,
  ROAD_LANTERN_MIN_SPACING,
  ROAD_LANTERN_TOWN_MARGIN,
  ROAD_LANTERN_TREE_CLEARANCE,
  resolveSeasonalRoadLanterns,
  roadLanternJob,
  seasonalRoadLanterns,
} from '../src/sim/seasonal_road_lanterns';
import {
  generateDecorationsInBounds,
  groundHeight,
  roadDistance,
  WATER_LEVEL,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const lanterns = seasonalRoadLanterns(WORLD_SEED);

describe('the road lanterns between the Gourdlight Eve cities', () => {
  it('light every route, sparsely (a lantern every 30 to 50 yards, not a fence)', () => {
    for (const route of GOURDLIGHT_ROAD_LANTERNS.routes) {
      const own = lanterns.filter((l) => l.route === route.id);
      // the field road is short; the city-to-city roads are hundreds of yards
      expect(own.length, route.id).toBeGreaterThanOrEqual(route.id === 'eastbrook_field' ? 2 : 5);
      for (let i = 1; i < own.length; i++) {
        const gap = Math.hypot(own[i].x - own[i - 1].x, own[i].z - own[i - 1].z);
        expect(gap, `${route.id} #${i}`).toBeGreaterThanOrEqual(ROAD_LANTERN_MIN_SPACING);
        expect(gap, `${route.id} #${i}`).toBeLessThanOrEqual(70);
      }
    }
    expect(lanterns.length).toBeLessThanOrEqual(40);
  });

  it('alternate sides of the road', () => {
    for (const route of GOURDLIGHT_ROAD_LANTERNS.routes) {
      const own = lanterns.filter((l) => l.route === route.id);
      let flips = 0;
      for (let i = 1; i < own.length; i++) if (own[i].side !== own[i - 1].side) flips++;
      expect(flips, route.id).toBeGreaterThanOrEqual(Math.ceil((own.length - 1) * 0.75));
    }
  });

  it('stand on the verge: off the road surface, never on the painted track', () => {
    for (const l of lanterns) {
      const r = roadDistance(l.x, l.z);
      expect(r, l.anchor).toBeGreaterThanOrEqual(ROAD_LANTERN_BAND[0]);
      expect(r, l.anchor).toBeGreaterThan(DECOR_ROAD_CLEARANCE);
      expect(r, l.anchor).toBeLessThanOrEqual(ROAD_LANTERN_BAND[1]);
      // the carved face looks back at the road: a step along the yaw comes nearer it
      expect(
        roadDistance(l.x + Math.sin(l.yaw) * 2, l.z + Math.cos(l.yaw) * 2),
        l.anchor,
      ).toBeLessThan(r);
    }
  });

  it('keep clear of buildings, trees, water, bridges and chapels, on the ground', () => {
    for (const l of lanterns) {
      expect(isBlocked(WORLD_SEED, l.x, l.z, ROAD_LANTERN_COLLIDER_CLEARANCE), l.anchor).toBe(
        false,
      );
      expect(groundHeight(l.x, l.z, WORLD_SEED), l.anchor).toBeGreaterThan(WATER_LEVEL + 0.6);
      expect(l.y).toBeCloseTo(groundHeight(l.x, l.z, WORLD_SEED), 5);
      expect(chapelAt(l.x, l.z), l.anchor).toBeNull();
      // never in the heart of a mob camp
      for (const c of CAMPS) {
        expect(Math.hypot(c.center.x - l.x, c.center.z - l.z), l.anchor).toBeGreaterThanOrEqual(
          c.radius * ROAD_LANTERN_CAMP_HEART,
        );
      }
      const t = ROAD_LANTERN_TREE_CLEARANCE;
      const trees = generateDecorationsInBounds(WORLD_SEED, {
        minX: l.x - t,
        maxX: l.x + t,
        minZ: l.z - t,
        maxZ: l.z + t,
      }).filter((d) => Math.hypot(d.x - l.x, d.z - l.z) < t);
      expect(trees, l.anchor).toEqual([]);
      // no bridge: no water anywhere in a ring round the post out past the road
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (const reach of [4, 8, 12]) {
          const h = groundHeight(l.x + Math.sin(a) * reach, l.z + Math.cos(a) * reach, WORLD_SEED);
          expect(h, `${l.anchor} ring ${reach}`).toBeGreaterThan(WATER_LEVEL);
        }
      }
    }
  });

  it('never stand in a town (its own dressing) or inside the boss field', () => {
    const zones = getActiveWorldContent().zones;
    const field = resolveScarecrowField(WORLD_SEED);
    expect(field).not.toBeNull();
    for (const l of lanterns) {
      for (const rule of GOURDLIGHT_DECOR_CITIES) {
        const hub = zones.find((z) => z.id === rule.zoneId)?.hub;
        if (!hub) continue;
        expect(Math.hypot(l.x - hub.x, l.z - hub.z), l.anchor).toBeGreaterThanOrEqual(
          rule.radius + ROAD_LANTERN_TOWN_MARGIN,
        );
      }
      if (field) {
        expect(Math.hypot(l.x - field.x, l.z - field.z), l.anchor).toBeGreaterThanOrEqual(
          ROAD_LANTERN_FIELD_CLEARANCE,
        );
      }
    }
  });

  it('keep every pair apart, across routes too', () => {
    for (let i = 0; i < lanterns.length; i++) {
      for (let j = i + 1; j < lanterns.length; j++) {
        const d = Math.hypot(lanterns[i].x - lanterns[j].x, lanterns[i].z - lanterns[j].z);
        expect(d, `${lanterns[i].anchor} ~ ${lanterns[j].anchor}`).toBeGreaterThanOrEqual(
          ROAD_LANTERN_MIN_SPACING,
        );
      }
    }
  });

  it('is deterministic (the same world and seed resolve the same posts)', () => {
    expect(resolveSeasonalRoadLanterns(WORLD_SEED)).toEqual([...lanterns]);
  });

  it('resolves over several frames as a job (graph, then one route a step), same answer', () => {
    const seed = WORLD_SEED + 7;
    const job = roadLanternJob(seed);
    let steps = 0;
    while (!job.step()) steps++;
    expect(steps).toBe(GOURDLIGHT_ROAD_LANTERNS.routes.length);
    expect(job.result).toEqual(resolveSeasonalRoadLanterns(seed));
    // a resolved world finishes on its first step
    const again = roadLanternJob(seed);
    expect(again.step()).toBe(true);
    expect(again.result).toBe(job.result);
  });
});

describe('the road lanterns draw runs (seasonal_road_lanterns_core.ts)', () => {
  it('cover every post once, one route per run, short enough to range', () => {
    const runs = roadLanternSegments(lanterns);
    expect(runs.flatMap((r) => r.lanterns)).toEqual([...lanterns]);
    for (const run of runs) {
      expect(run.lanterns.length).toBeLessThanOrEqual(ROAD_SEGMENT_MAX);
      expect(new Set(run.lanterns.map((l) => l.route)).size).toBe(1);
      const first = run.lanterns[0];
      for (const l of run.lanterns) {
        expect(Math.hypot(l.x - first.x, l.z - first.z)).toBeLessThanOrEqual(ROAD_SEGMENT_SPAN);
      }
    }
  });
});
