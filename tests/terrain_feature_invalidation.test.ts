// Contract test for invalidateTerrainFeatures(): the terrain-feature
// shortlists (src/sim/world.ts) memoize WHICH hubs/lakes/camps can reach each
// 64yd cell, keyed by content identity, and the per-sample gates then read
// LIVE feature positions. An EDITOR-style in-place move therefore takes
// effect immediately in the departure direction (the live gate fails at the
// old spot) but is INVISIBLE in the arrival direction: a camp moved into a
// cell whose shortlist was built without it is never considered until the
// invalidator drops the cache. Hosts never mutate content in place (custom
// maps deep-clone), so the sim/server never need the invalidator; the editor
// calls it from rebuildTerrainFull/afterCampsChanged/terrainEditsMutated.
import { afterEach, describe, expect, it } from 'vitest';
import { getActiveWorldContent } from '../src/sim/data';
import { invalidateTerrainFeatures, terrainHeight } from '../src/sim/world';

const SEED = 20061;

describe('invalidateTerrainFeatures', () => {
  const content = getActiveWorldContent();
  const camp = content.camps[0];
  const saved = { x: camp.center.x, z: camp.center.z };

  afterEach(() => {
    camp.center.x = saved.x;
    camp.center.z = saved.z;
    invalidateTerrainFeatures();
  });

  it('a camp moved into a cell is invisible until invalidated, then flattens it', () => {
    // A destination far from every authored feature, plus a probe point on
    // what will become the camp's flatten apron (partial blend).
    const dest = { x: saved.x + 2500, z: saved.z };
    const probeX = dest.x + camp.radius * 1.2;
    const probeZ = dest.z;

    // First sample builds the probe cell's shortlist WITHOUT the camp.
    const rawGround = terrainHeight(probeX, probeZ, SEED);

    // Editor-style mutation: move the camp onto the destination IN PLACE.
    // The stale shortlist still omits it, so the probe is unchanged even
    // though the live gate would now pass: this is why the invalidator and
    // its editor hooks exist.
    camp.center.x = dest.x;
    camp.center.z = dest.z;
    expect(terrainHeight(probeX, probeZ, SEED)).toBe(rawGround);

    // The editor's mutation hooks call this; the rebuilt shortlist now
    // includes the moved camp and its flatten pulls the probe's height.
    invalidateTerrainFeatures();
    const flattened = terrainHeight(probeX, probeZ, SEED);
    expect(flattened).not.toBe(rawGround);

    // Restoring + invalidating reproduces the original bit-exactly.
    camp.center.x = saved.x;
    camp.center.z = saved.z;
    invalidateTerrainFeatures();
    expect(terrainHeight(probeX, probeZ, SEED)).toBe(rawGround);
  });
});
