// Authoring an asset's collision must reach the copies already placed.
//
// The reported symptom: "the Collision Master collision is not loading on the
// models in the game". Measured on the shipped overworld, foliage/rock_1 had
// 14 authored volumes while 370 of its 385 placements still collided as a
// plain circle, because each placement carries the collision mode it was
// stamped with when it was placed and the sim honours that stamp.

import { describe, expect, it } from 'vitest';
import { planCollisionAdoption } from '../src/editor/collision_adopt_core';
import type { MapPlacement } from '../src/sim/map_doc';

const place = (extra: Partial<MapPlacement> = {}): MapPlacement =>
  ({ assetId: 'foliage/rock_1', x: 0, z: 0, rotY: 0, scale: 1, ...extra }) as MapPlacement;

describe('planCollisionAdoption', () => {
  it('adopts placements stamped with a simple footprint', () => {
    const plan = planCollisionAdoption(
      [place({ collisionMode: 'basic', collideRadius: 1.1, collideShape: 'square' })],
      'foliage/rock_1',
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].from).toBe('basic');
    expect(plan[0].patch.collisionMode).toBe('baked');
  });

  it('adopts legacy documents that never recorded a mode', () => {
    // collide + collideRadius with no collisionMode resolves to 'basic'.
    const plan = planCollisionAdoption(
      [place({ collide: true, collideRadius: 1.1 })],
      'foliage/rock_1',
    );
    expect(plan).toHaveLength(1);
  });

  it('overrides a hand-edited placement (clears its own boxes) and per-placement ramps', () => {
    // Reported: after Lock In the maker still had to click "Reset to baked"
    // on the copy they had hand-edited before the authored collision showed.
    const plan = planCollisionAdoption(
      [
        place({
          collide: true,
          collisionMode: 'baked',
          hitboxes: [{ x: 0, y: 0, z: 0, hx: 1, hy: 1, hz: 1 }],
        }),
        place({
          collide: true,
          collisionMode: 'basic',
          collideRadius: 1,
          ramps: [{ x: 0, z: 0, hx: 1, hz: 1, y0: 0, y1: 1 }] as never,
        }),
        place({ collide: true, collisionMode: 'basic', collideRadius: 1, ramps: [] as never }),
      ],
      'foliage/rock_1',
    );
    expect(plan).toHaveLength(3);
    expect(plan[0].patch).toEqual({
      collisionMode: 'baked',
      collideShape: undefined,
      clearHitboxes: true,
    });
    expect(plan[1].patch.clearRamps).toBe(true);
    expect(plan[1].patch.clearHitboxes).toBeUndefined();
    expect(plan[2].patch.clearRamps).toBeUndefined();
  });

  it('opts an explicit "no collision" copy back in, and skips clean already-baked ones', () => {
    const plan = planCollisionAdoption(
      [
        place({ collide: false, collisionMode: 'none' }),
        place({ collide: true, collisionMode: 'baked' }),
        place({ collide: true }),
      ],
      'foliage/rock_1',
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].index).toBe(0);
    expect(plan[0].from).toBe('none');
    expect(plan[0].patch.collide).toBe(true);
  });

  it('only touches the authored asset', () => {
    const plan = planCollisionAdoption(
      [
        place({ assetId: 'foliage/oak_2', collisionMode: 'basic', collideRadius: 1 }),
        place({ collisionMode: 'basic', collideRadius: 1 }),
      ],
      'foliage/rock_1',
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].index).toBe(1);
  });
});
