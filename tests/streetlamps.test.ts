import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildLampFixtureGeometry, buildLampGlassGeometry } from '../src/render/streetlamps';

// The lamp fixture is five primitives merged into one instanced draw.
// mergeGeometries returns NULL for a mixed indexed/non-indexed set (Three's
// polyhedra come back non-indexed while the lathe primitives are indexed), and
// the builder turns that into a throw, which fails the whole scene build at
// boot. That is exactly the kind of break a unit test should catch instead of a
// screenshot run, so the merge is pinned here.

describe('the streetlamp fixture geometry', () => {
  it('merges into a single indexed draw', () => {
    const geo = buildLampFixtureGeometry();
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo.getIndex()).not.toBeNull();
    // one merged part, so one instanced draw per town rather than five
    expect(geo.groups).toHaveLength(0);
    geo.dispose();
  });

  it('stands on the ground and reaches streetlamp height', () => {
    const geo = buildLampFixtureGeometry();
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) throw new Error('lamp fixture has no bounding box');
    // Local origin is the post's foot, so the fixture must not sink below it.
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    // Taller than a character (about 1.8 yd) and short of a building eave.
    expect(box.max.y).toBeGreaterThan(3);
    expect(box.max.y).toBeLessThan(4.5);
    // and slim: a post, not a pillar
    expect(box.max.x - box.min.x).toBeLessThan(1);
    geo.dispose();
  });

  it('hangs the glass inside the housing, not beside it', () => {
    const fixture = buildLampFixtureGeometry();
    const glass = buildLampGlassGeometry();
    fixture.computeBoundingBox();
    glass.computeBoundingBox();
    const fixtureBox = fixture.boundingBox;
    const glassBox = glass.boundingBox;
    if (!fixtureBox || !glassBox) throw new Error('lamp geometry has no bounding box');
    // the lit glass sits up in the lantern head, above the post
    expect(glassBox.min.y).toBeGreaterThan(fixtureBox.max.y * 0.7);
    expect(glassBox.max.y).toBeLessThan(fixtureBox.max.y);
    // and on the post's axis
    expect(Math.abs(glassBox.min.x + glassBox.max.x) / 2).toBeLessThan(0.01);
    fixture.dispose();
    glass.dispose();
  });
});
