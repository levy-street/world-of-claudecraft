// EVERY solid asset on the authored battleground map collides off its baked box
// set, so Collision Master governs all of it.
//
// A placement can be made solid two ways. 'basic' pins it to a plain circle of
// a hand-written radius; 'baked' reads the asset's authored box set, which is
// what the Collision Master scene writes (data/asset_collision_overrides.json,
// plus the session overlay a Lock In applies to the live page). Only the second
// keeps the map wired to Collision Master, so nothing on this map uses the
// first, an asset with no bake gets baked rather than excused.

import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent, placementsToRenderAssets } from '../src/editor/custom_map';
import { createShippedMap } from '../src/editor/shipped_maps';
import { thornhollowMap } from '../src/editor/shipped_thornhollow';
import {
  applySessionCollisionOverride,
  boxesForAssetId,
  rampsForAssetId,
} from '../src/sim/asset_collision';
import { invalidateStaticColliders, isBlocked } from '../src/sim/colliders';
import { setActiveWorldContent } from '../src/sim/data';
import { effectiveCollisionMode } from '../src/sim/map_doc';

const SEED = 20061;
const map = thornhollowMap('Thornhollow', 'collision_test', 1);

afterEach(() => {
  setActiveWorldContent(null);
  invalidateStaticColliders();
});

describe('thornhollow: collision routing', () => {
  it('collides EVERY solid asset off its baked box set, with no exceptions', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const p of map.placements) {
      if (!p.collide || p.assetId.startsWith('collider/')) continue;
      checked++;
      const mode = effectiveCollisionMode(p);
      const boxes = boxesForAssetId(p.assetId);
      if (!boxes || boxes.length === 0) {
        // No bake means solid() had to fall back to a circle, which Collision
        // Master cannot reach. Bake the asset instead of accepting that.
        wrong.push(`${p.assetId} has NO BAKE (falls back to a circle)`);
      } else if (mode !== 'baked') {
        wrong.push(`${p.assetId} has a bake but collides '${mode}'`);
      }
      // DECLARED, not derived. effectiveCollisionMode() falls back to 'baked'
      // for a bare `collide: true`, so a placement can read as baked today and
      // silently become a circle the moment anything gives it a radius.
      if (p.collisionMode !== 'baked') {
        wrong.push(`${p.assetId} leaves collisionMode implicit (${p.collisionMode ?? 'unset'})`);
      }
      if (p.collideRadius !== undefined) {
        wrong.push(`${p.assetId} carries a hand-written collideRadius`);
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
    expect(checked).toBeGreaterThan(800);
  });

  it('draws a collision footprint for every solid placement', () => {
    // The editor's "Show collision footprints" overlay (render/placed_assets
    // refreshFootprint) draws per render entry, and it bails out on an
    // effective radius of 0, so a placement that collides but projects no
    // radius is INVISIBLE collision. This is what a maker sees when they turn
    // the overlay on, so it is worth holding.
    const assets = placementsToRenderAssets(map.placements, {
      hideHidden: true,
    });
    const solid = map.placements.filter((p) => p.collide && !p.assetId.startsWith('collider/'));
    const drawn = assets.filter((a) => a && (a.collideRadius ?? 0) > 0);
    expect(drawn).toHaveLength(solid.length);
  });

  it('is why a shipped map must not force the footprint overlay off', () => {
    // Opening a shipped map used to force the overlay off and persist that,
    // on the theory that a dense kit map becomes one wash of outlines. It does
    // not: a kit conversion's collision is `collider/<kind>` volumes, which
    // resolve to no model and are drawn by a different pass entirely, so the
    // dungeons render zero footprints, and the only maps the force-off ever
    // silenced were the ones with real placement collision.
    const kitConversions = ['hollow_crypt', 'nythraxis_raid_arena', 'litany_apse'] as const;
    return Promise.all(
      kitConversions.map(async (id) => {
        const kit = await createShippedMap(id, `fp_${id}`, 1);
        const assets = placementsToRenderAssets(kit.placements, {
          hideHidden: true,
        });
        expect(assets.filter((a) => a && (a.collideRadius ?? 0) > 0)).toHaveLength(0);
      }),
    );
  });

  it('gives the keep towers their blueprint collision and walkable arcade', () => {
    // city/wall_tower had no bake at all, so four keep towers were colliding as
    // 4.2yd circles. Its collision is now authored from the City Build
    // blueprint (solid shaft, six pillar bays, roof slab) with the arcade floor
    // as a walkable ramp deck, which a voxel bake could not have expressed.
    const boxes = boxesForAssetId('city/wall_tower');
    expect(boxes?.length).toBe(8);
    expect(rampsForAssetId('city/wall_tower')).toHaveLength(1);
    // Four corners per keep, two keeps.
    const towers = map.placements.filter((p) => p.name === 'Keep tower');
    expect(towers).toHaveLength(8);
    for (const t of towers) {
      expect(effectiveCollisionMode(t)).toBe('baked');
      expect(t.collideRadius).toBeUndefined();
    }
  });

  it('makes the solid things solid', () => {
    setActiveWorldContent(customMapToWorldContent(map));
    invalidateStaticColliders();
    const solidNames = [
      'Great tree',
      'Tree',
      'Pit rim',
      'Curtain wall',
      'Court wall',
      'Barbican',
      'Inner wall',
      'Fallen monument',
    ];
    for (const name of solidNames) {
      const p = map.placements.find((q) => q.name === name);
      expect(p, `no ${name} in the map`).toBeTruthy();
      if (!p) continue;
      expect(isBlocked(SEED, p.x, p.z, 0.5), `${name} at ${p.x},${p.z} does not block`).toBe(true);
    }
  });

  it('leaves the lanes, keep floors and pit floor walkable', () => {
    setActiveWorldContent(customMapToWorldContent(map));
    invalidateStaticColliders();
    for (const [x, z] of [
      [0, -142], // inside Crimson's keep, through the gate
      [0, -108], // the centre road
      [0, -70],
      [0, 0], // the pit floor... under the fallen monument, so offset:
      [8, 6],
      [0, 108],
      [0, 142],
    ]) {
      if (x === 0 && z === 0) continue;
      expect(isBlocked(SEED, x, z, 0.5), `blocked at ${x},${z}`).toBe(false);
    }
  });

  it('a Collision Master save changes what the map blocks', () => {
    setActiveWorldContent(customMapToWorldContent(map));
    invalidateStaticColliders();
    const tree = map.placements.find((p) => p.name === 'Tree' && p.assetId === 'foliage/oak_1');
    expect(tree, 'no oak in the inner wood').toBeTruthy();
    if (!tree) return;

    // A point well clear of the trunk, and free to begin with.
    const probe = { x: tree.x + 6, z: tree.z };
    expect(isBlocked(SEED, probe.x, probe.z, 0.5)).toBe(false);

    // Lock In a far wider footprint for that asset, exactly as the Collision
    // Master scene does on save; the same spot now blocks.
    const before = boxesForAssetId('foliage/oak_1');
    applySessionCollisionOverride('foliage/oak_1', {
      mode: 'baked',
      boxes: [{ x: 0, y: 1, z: 0, hx: 4, hy: 1, hz: 4 }],
    });
    invalidateStaticColliders();
    setActiveWorldContent(customMapToWorldContent(map));
    try {
      expect(isBlocked(SEED, probe.x, probe.z, 0.5)).toBe(true);
    } finally {
      applySessionCollisionOverride(
        'foliage/oak_1',
        before ? { mode: 'baked', boxes: before } : null,
      );
      invalidateStaticColliders();
    }
  });
});
