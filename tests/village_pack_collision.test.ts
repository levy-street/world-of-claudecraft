// The village pack collides with its walls, not with a circle.
//
// The reported symptom was "the assets are not hooked up to the custom
// collision": placing a `medieval_village_v2` building gave you a fat disc the
// size of its widest point, so you were walled well short of the wall and could
// not walk through a doorway. TWO independent causes, both fixed:
//
//  1. sim/colliders.ts emitted `{type:'circle', r: collideRadius}` for EVERY
//     placement, the baked-box arm had been dropped, so no asset's real shape
//     ever reached movement.
//  2. the pack had no bake at all (349 assets, 0 entries) because
//     scripts/assets/bake_collision.mjs stopped being re-run after it landed.
//
// This pins the outcome: a wall blocks where it is drawn, an opening stays
// open, and ground cover is still soft.

import { describe, expect, it } from 'vitest';
import { bakedBoxesForPath } from '../src/sim/asset_collision';
import { invalidateStaticColliders, MANTLE_REACH, resolvePosition } from '../src/sim/colliders';
import { getActiveWorldContent } from '../src/sim/data';
import type { PlacedAsset } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 4242;

/** An empty patch of open world where the baseline resolver is the identity. */
const AT = ((): { x: number; z: number } => {
  for (let z = 900; z < 1400; z += 7) {
    for (let x = -450; x < 450; x += 11) {
      const res = resolvePosition(SEED, x, z, 2, false, undefined, {
        y: groundHeight(x, z, SEED),
        lift: 0,
      });
      if (res.x === x && res.z === z) return { x, z };
    }
  }
  throw new Error('no clear open-world spot found');
})();

function withPlacements(placements: PlacedAsset[], fn: () => void): void {
  const content = getActiveWorldContent();
  const prev = content.placements;
  content.placements = placements;
  invalidateStaticColliders();
  try {
    fn();
  } finally {
    content.placements = prev;
    invalidateStaticColliders();
  }
}

const place = (id: string, extra: Partial<PlacedAsset> = {}): PlacedAsset => ({
  path: `/models/${id}.glb`,
  x: AT.x,
  z: AT.z,
  rotY: 0,
  scale: 1,
  collideRadius: 3, // the fat legacy circle this replaces
  ...extra,
});

/** Does a body of radius 0.4 get pushed out at `dx` yards along +X? */
function blockedAt(dx: number, dz = 0): boolean {
  const y = groundHeight(AT.x, AT.z, SEED);
  const res = resolvePosition(SEED, AT.x + dx, AT.z + dz, 0.4, false, undefined, {
    y,
    lift: MANTLE_REACH,
  });
  return Math.hypot(res.x - (AT.x + dx), res.z - (AT.z + dz)) > 1e-4;
}

/**
 * Whether THIS placement is what blocks a point, controlling for whatever the
 * built-in world already has there. The clear-spot scan only guarantees the
 * anchor itself is open, so a bare "is it blocked out here" assertion can be
 * answered by unrelated scenery several yards away.
 */
function blockedByPlacement(p: PlacedAsset, dx: number, dz = 0): boolean {
  let without = true;
  withPlacements([], () => {
    without = blockedAt(dx, dz);
  });
  let withIt = true;
  withPlacements([p], () => {
    withIt = blockedAt(dx, dz);
  });
  return withIt && !without;
}

describe('medieval_village_v2 collision', () => {
  it('bakes the pack at all', () => {
    // The regression that started it: this returned null for all 349 assets.
    for (const id of [
      'medieval_village_v2/buildings/HouseBase_01',
      'medieval_village_v2/buildings/CastleFence_02',
      'medieval_village_v2/props/Barrel_01',
      'medieval_village_v2/nature/Tree_01',
    ]) {
      const boxes = bakedBoxesForPath(`/models/${id}.glb`);
      expect(boxes, id).not.toBeNull();
      expect(boxes?.length, id).toBeGreaterThan(0);
    }
  });

  it('blocks a wall at its body, not out at the legacy circle', () => {
    // CastleWall_01 bakes as one thin 2.25yd panel: 0.81yd across its face,
    // 0.08yd thick. At scale 3 that reaches ~1.2yd along its face and ~0.12yd
    // through it, nothing like the 3yd disc the placement still carries.
    const wall = place('medieval_village_v2/buildings/CastleWall_01', { scale: 3 });
    expect(blockedByPlacement(wall, 0)).toBe(true);
    // Through the panel's thin axis, past its face plus a body radius, and
    // still deep inside the legacy circle that used to wall the player off.
    expect(blockedByPlacement(wall, 0, 1.5)).toBe(false);
    expect(blockedByPlacement(wall, 2.5)).toBe(false);
  });

  it('lets a foundation slab be stepped onto rather than walled', () => {
    // HouseBase_01 bakes to a single 0.75yd course, under the step band, so a
    // walking body rises onto it. That is the point of banding the boxes: the
    // same table gives a 2.25yd wall a wall and a doorstep a step.
    const slab = place('medieval_village_v2/buildings/HouseBase_01');
    expect(blockedByPlacement(slab, 0)).toBe(false);
  });

  it('leaves a fence a fence: thin, not a disc', () => {
    const fence = place('medieval_village_v2/buildings/CastleFence_02', { scale: 2 });
    // 3yd off the panel is past its body but well inside the legacy disc.
    expect(blockedByPlacement(fence, 0, 3)).toBe(false);
  });

  it('keeps ground cover soft', () => {
    // A bush must NOT gain hugging boxes: brushing past one is the behaviour.
    expect(bakedBoxesForPath('/models/foliage/bush.glb')).toBeNull();
  });

  it('still honours a maker override on a pack asset', () => {
    // collideCustom means "I chose this footprint": the bake must not win.
    const barrel = place('medieval_village_v2/props/Barrel_01', {
      collideCustom: true,
      collideRadius: 3,
    });
    // 2yd out is far past a barrel's body but inside the authored 3yd disc.
    expect(blockedByPlacement(barrel, 2)).toBe(true);
    // And without the override the same point is clear: the bake really is
    // tighter than the circle, which is the whole change.
    const plain = place('medieval_village_v2/props/Barrel_01', { collideRadius: 3 });
    expect(blockedByPlacement(plain, 2)).toBe(false);
  });
});
