import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BRAZIER_RIM_HEIGHT,
  buildBrazierCoalsGeometry,
  buildBrazierFixtureGeometry,
  buildBrazierFlameGeometry,
  buildFirePitCoalsGeometry,
  buildFirePitFlameGeometry,
  buildFirePitGeometry,
  planCampBraziers,
} from '../src/render/camp_braziers';
import { FIRE_BUILDING_FAMILIES } from '../src/render/night_accents_core';
import { buildLampFixtureGeometry } from '../src/render/streetlamps';
import { CAMPS, getActiveWorldContent, MOBS } from '../src/sim/data';
import { roadDistance, terrainHeight, WATER_LEVEL } from '../src/sim/world';

// camp_braziers: the burning fire standing at every fire-building mob camp
// without an authored campfire. Geometry merges are pinned for the same reason
// as the streetlamp's (a null merge fails the whole scene build at boot), and
// the placement is asserted against the real world content.

describe('the brazier fixture geometry', () => {
  it('merges into a single indexed draw', () => {
    const geo = buildBrazierFixtureGeometry();
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo.getIndex()).not.toBeNull();
    expect(geo.groups).toHaveLength(0);
    geo.dispose();
  });

  it('stands on the ground, heavier in girth than a streetlamp post', () => {
    const geo = buildBrazierFixtureGeometry();
    const lamp = buildLampFixtureGeometry();
    geo.computeBoundingBox();
    lamp.computeBoundingBox();
    const box = geo.boundingBox;
    const lampBox = lamp.boundingBox;
    if (!box || !lampBox) throw new Error('brazier geometry has no bounding box');
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.max.y).toBeCloseTo(BRAZIER_RIM_HEIGHT, 1);
    // "a bigger lamppost with a fire in it": it must not read SMALLER than the
    // scaled lamp in girth (the lamp is taller only through its thin finial)
    const lampWidth = lampBox.max.x - lampBox.min.x;
    expect(box.max.x - box.min.x).toBeGreaterThan(lampWidth);
    geo.dispose();
    lamp.dispose();
  });

  it('seats the coals inside the basket mouth, under the flame foot', () => {
    const fixture = buildBrazierFixtureGeometry();
    const coals = buildBrazierCoalsGeometry();
    fixture.computeBoundingBox();
    coals.computeBoundingBox();
    const fixtureBox = fixture.boundingBox;
    const coalsBox = coals.boundingBox;
    if (!fixtureBox || !coalsBox) throw new Error('brazier geometry has no bounding box');
    // the glowing bed sits up in the basket, near the rim
    expect(coalsBox.max.y).toBeGreaterThan(fixtureBox.max.y - 0.4);
    expect(coalsBox.max.y).toBeLessThan(fixtureBox.max.y + 0.2);
    // and inside the rim's spread
    expect(coalsBox.max.x).toBeLessThan(fixtureBox.max.x);
    fixture.dispose();
    coals.dispose();
  });
});

describe('the fire pit geometry', () => {
  it('merges into a single indexed draw', () => {
    const geo = buildFirePitGeometry();
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo.getIndex()).not.toBeNull();
    expect(geo.groups).toHaveLength(0);
    geo.dispose();
  });

  it('hugs the ground: a hearth, not a tower', () => {
    const geo = buildFirePitGeometry();
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) throw new Error('fire pit geometry has no bounding box');
    expect(box.max.y).toBeLessThan(1);
    // the stone ring spreads wider than it stands tall
    expect(box.max.x - box.min.x).toBeGreaterThan(box.max.y);
    geo.dispose();
  });

  it('keeps its coals low inside the stone ring', () => {
    const pit = buildFirePitGeometry();
    const coals = buildFirePitCoalsGeometry();
    pit.computeBoundingBox();
    coals.computeBoundingBox();
    const pitBox = pit.boundingBox;
    const coalsBox = coals.boundingBox;
    if (!pitBox || !coalsBox) throw new Error('fire pit geometry has no bounding box');
    expect(coalsBox.max.y).toBeLessThan(0.4);
    expect(coalsBox.max.x).toBeLessThan(pitBox.max.x);
    pit.dispose();
    coals.dispose();
  });

  it('builds flames the scenery-flame pass can animate, the pit burning wider', () => {
    const brazier = buildBrazierFlameGeometry();
    const pit = buildFirePitFlameGeometry();
    brazier.computeBoundingBox();
    pit.computeBoundingBox();
    const brazierBox = brazier.boundingBox;
    const pitBox = pit.boundingBox;
    if (!brazierBox || !pitBox) throw new Error('flame geometry has no bounding box');
    expect(brazierBox.max.y).toBeGreaterThan(1);
    expect(pitBox.max.y).toBeGreaterThan(brazierBox.max.y);
    brazier.dispose();
    pit.dispose();
  });
});

describe('planCampBraziers on the real world', () => {
  const plan = () => planCampBraziers(0);
  const fireBuildingCenters = () =>
    CAMPS.filter((camp) => {
      const family = MOBS[camp.mobId]?.family;
      return family !== undefined && FIRE_BUILDING_FAMILIES.has(family);
    });

  it('lights a bounded set of camps, deterministically', () => {
    const sites = plan();
    expect(sites.length).toBeGreaterThan(10);
    expect(sites.length).toBeLessThan(60);
    expect(plan()).toEqual(sites);
  });

  it('splits the fires between braziers and pits, neither kind a token', () => {
    const sites = plan();
    const braziers = sites.filter((site) => site.kind === 'brazier').length;
    const pits = sites.filter((site) => site.kind === 'firepit').length;
    expect(braziers + pits).toBe(sites.length);
    // a deterministic 50/50 roll: allow drift, refuse a collapse to one kind
    expect(braziers).toBeGreaterThanOrEqual(Math.floor(sites.length * 0.25));
    expect(pits).toBeGreaterThanOrEqual(Math.floor(sites.length * 0.25));
  });

  it('stands each fire at a FIRE-BUILDING camp, never a beast den', () => {
    const centers = fireBuildingCenters();
    for (const site of plan()) {
      let nearest = Infinity;
      for (const camp of centers) {
        const d = Math.hypot(camp.center.x - site.x, camp.center.z - site.z);
        if (d < nearest) nearest = d;
      }
      // at the centre, or on one of the small fallback rings beside it
      expect(nearest).toBeLessThanOrEqual(4.2 + 1e-6);
    }
  });

  it('never lights a drowned camp or the middle of a road', () => {
    const sites = plan();
    for (const site of sites) {
      expect(site.y).toBeGreaterThanOrEqual(WATER_LEVEL);
      expect(site.y).toBe(terrainHeight(site.x, site.z, 0));
      // a camp authored against a road slides its fire along the fallback
      // ring, so no fire stands in the middle of the painted track
      expect(roadDistance(site.x, site.z)).toBeGreaterThan(1.9);
    }
  });

  it('skips every camp an authored campfire already lights', () => {
    const sites = plan();
    const campfires = getActiveWorldContent().props.campfires;
    for (const site of sites) {
      for (const [x, z] of campfires) {
        expect(Math.hypot(x - site.x, z - site.z)).toBeGreaterThanOrEqual(12 - 4.2 - 1e-6);
      }
    }
  });
});
