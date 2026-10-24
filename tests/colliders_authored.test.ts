// Direct unit coverage for the modules extracted out of src/sim/colliders.ts:
// the shape leaf (collider_shapes.ts), the parkour-height leaf
// (parkour_heights.ts), the fence dims, and the authored-map collider set
// (colliders_authored/: prism geometry, pass-under, the placement lane, the
// camera boom march). colliders.ts re-exports the public names, which the
// last block pins so './colliders' importers keep resolving the same values.
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Collider,
  colliderTopAt,
  type ObbCollider,
  type PrismCollider,
  rotY,
} from '../src/sim/collider_shapes';
import * as colliders from '../src/sim/colliders';
import {
  CAMERA_BOOM_STEP,
  cameraBoomClearDistance,
  emitPlacementBoxes,
  emitPlacementPrisms,
  insidePrism,
  passesUnder,
  prismBox,
  prismPolyAt,
  pushColliderVolumeColliders,
  pushOutPrism,
  pushPlacementColliders,
} from '../src/sim/colliders_authored';
import { cameraSolid } from '../src/sim/colliders_authored/camera_boom';
import {
  convexHullXZ,
  eulerMatrix,
  outlineWinding,
} from '../src/sim/colliders_authored/placement_geometry';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { FENCE_END_PAD, FENCE_HALF_DEPTH, FENCE_RAIL_HEIGHT } from '../src/sim/fence_dims';
import { MANTLE_REACH, moverHeight, passesOver } from '../src/sim/parkour_heights';
import type { PlacedAsset, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

afterEach(() => {
  setActiveWorldContent(null);
});

/** A 2 x 2 square prism centred on (10, 20), counter-clockwise. */
function squarePrism(extra: Partial<PrismCollider> = {}): PrismCollider {
  return {
    type: 'prism',
    x: 10,
    z: 20,
    poly: [-1, -1, 1, -1, 1, 1, -1, 1],
    br: Math.SQRT2,
    ...extra,
  };
}

function placement(extra: Partial<PlacedAsset>): PlacedAsset {
  return {
    path: 'test://unbaked',
    x: 5,
    z: 7,
    rotY: 0,
    scale: 1,
    detached: true,
    groundY: 3,
    ...extra,
  } as PlacedAsset;
}

function contentWith(extra: Partial<WorldContent>): WorldContent {
  return { ...BUILTIN_WORLD, ...extra };
}

describe('collider_shapes', () => {
  it('rotY follows the three.js rotation.y convention', () => {
    const r = rotY(1, 0, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.z).toBeCloseTo(-1, 12);
  });

  it('colliderTopAt: flat, full-height, and a falling OBB ridge', () => {
    const flat: Collider = { type: 'circle', x: 0, z: 0, r: 1, moveTopY: 2 };
    expect(colliderTopAt(flat, 0.5, 0)).toBe(2);
    expect(colliderTopAt({ type: 'circle', x: 0, z: 0, r: 1 }, 0, 0)).toBe(Infinity);
    const root: ObbCollider = {
      type: 'obb',
      x: 0,
      z: 0,
      hw: 2,
      hd: 0.5,
      rot: 0,
      moveTopY: 3,
      topSlope: { kind: 'ridge', pitch: 0, eaveY: 0, fall: 0.5 },
    };
    // The ridge falls 0.5 per yard from moveTopY at the -x end.
    expect(colliderTopAt(root, -2, 0)).toBeCloseTo(3, 12);
    expect(colliderTopAt(root, 0, 0)).toBeCloseTo(2, 12);
    expect(colliderTopAt(root, 2, 0)).toBeCloseTo(1, 12);
  });

  it('a sloped prism falls radially like a cone', () => {
    const p = squarePrism({ moveTopY: 4, topSlope: { kind: 'ridge', pitch: 1, eaveY: 2 } });
    expect(colliderTopAt(p, 10, 20)).toBe(4);
    expect(colliderTopAt(p, 10.6, 20.8)).toBeCloseTo(3, 12);
    expect(colliderTopAt(p, 15, 20)).toBe(2);
  });
});

describe('parkour_heights', () => {
  it('passesOver: standable lift, full height, and the balcony pass-under', () => {
    const crate: Collider = { type: 'circle', x: 0, z: 0, r: 1, moveTopY: 1, standable: true };
    expect(passesOver(crate, undefined, 0, 0)).toBe(false);
    expect(passesOver(crate, { y: 0, lift: 0 }, 0, 0)).toBe(false);
    expect(passesOver(crate, { y: 0.2, lift: MANTLE_REACH }, 0, 0)).toBe(true);
    const wall: Collider = { type: 'circle', x: 0, z: 0, r: 1 };
    expect(passesOver(wall, { y: 99, lift: 1 }, 0, 0)).toBe(false);
    const slab: Collider = { type: 'circle', x: 0, z: 0, r: 1, moveTopY: 5, passUnderY: 4 };
    expect(passesOver(slab, { y: 1.9, lift: 0 }, 0, 0)).toBe(true);
    expect(passesOver(slab, { y: 2, lift: 0 }, 0, 0)).toBe(false);
  });

  it('moverHeight grants no lift on the ground and the built-in band airborne', () => {
    setActiveWorldContent(null);
    expect(moverHeight({ pos: { y: 3 }, onGround: true })).toEqual({ y: 3, lift: 0 });
    expect(moverHeight({ pos: { y: 3 }, onGround: false })).toEqual({ y: 3, lift: MANTLE_REACH });
  });
});

describe('colliders_authored/prism', () => {
  it('insidePrism is a strict outline containment test', () => {
    const p = squarePrism();
    expect(insidePrism(p, 10, 20)).toBe(true);
    expect(insidePrism(p, 10.9, 20.9)).toBe(true);
    expect(insidePrism(p, 11.1, 20)).toBe(false);
  });

  it('prismBox covers the outline', () => {
    const b = prismBox(squarePrism({ poly: [0, -1, 3, -1, 3, 2, 0, 2], br: Math.hypot(3, 2) }));
    expect(b).toEqual({ x: 11.5, z: 20.5, hw: 1.5, hd: 1.5, rot: 0 });
  });

  it('prismPolyAt interpolates the loft at the feet height, else the union hull', () => {
    const lo = [-2, -2, 2, -2, 2, 2, -2, 2];
    const hi = [-1, -1, 1, -1, 1, 1, -1, 1];
    const p = squarePrism({ poly: lo, br: 2 * Math.SQRT2, polyLo: lo, polyHi: hi, baseY: 0 });
    // No moveTopY: no band to interpolate across.
    expect(prismPolyAt(p, 1)).toBe(p.poly);
    const banded = { ...p, moveTopY: 2 };
    expect(prismPolyAt(banded, undefined)).toBe(banded.poly);
    expect([...prismPolyAt(banded, 1)]).toEqual([-1.5, -1.5, 1.5, -1.5, 1.5, 1.5, -1.5, 1.5]);
    expect([...prismPolyAt(banded, 99)]).toEqual(hi);
  });

  it('pushOutPrism clears a body outside, and exits one inside through the near face', () => {
    const p = squarePrism();
    expect(pushOutPrism(p, 13, 20, 0.5)).toBeNull();
    const out = pushOutPrism(p, 11.2, 20, 0.5);
    expect(out?.x).toBeCloseTo(11.5, 12);
    expect(out?.z).toBeCloseTo(20, 12);
    const inside = pushOutPrism(p, 10.8, 20, 0.5);
    expect(inside?.x).toBeCloseTo(11.5, 12);
    expect(inside?.z).toBeCloseTo(20, 12);
  });
});

describe('colliders_authored/placement_geometry', () => {
  it('eulerMatrix is the identity at rest and a pure yaw matches rotY', () => {
    expect(eulerMatrix(0, 0, 0).map((v) => v + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const m = eulerMatrix(0, 0.7, 0);
    const r = rotY(2, 3, 0.7);
    expect(m[0] * 2 + m[2] * 3).toBeCloseTo(r.x, 12);
    expect(m[6] * 2 + m[8] * 3).toBeCloseTo(r.z, 12);
  });

  it('outlineWinding signs the winding; convexHullXZ drops interior points', () => {
    const ccw: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(outlineWinding(ccw)).toBeGreaterThan(0);
    expect(outlineWinding([...ccw].reverse())).toBeLessThan(0);
    const hull = convexHullXZ([...ccw, [0.5, 0.5]]);
    expect(hull).toHaveLength(4);
    expect(outlineWinding(hull)).toBeGreaterThan(0);
  });
});

describe('colliders_authored/placement_colliders', () => {
  it('emitPlacementPrisms keeps the outline counter-clockwise under a mirroring scale', () => {
    const out: Collider[] = [];
    const prism = { y0: 0, y1: 2, poly: [-1, -1, 1, -1, 1, 1, -1, 1] };
    emitPlacementPrisms(out, placement({ scaleX: -1 }), [prism], 3);
    expect(out).toHaveLength(1);
    const p = out[0] as PrismCollider;
    expect(p.type).toBe('prism');
    expect(p.baseY).toBe(3);
    expect(p.moveTopY).toBe(5);
    expect(p.standable).toBe(true);
    const pairs: [number, number][] = [];
    for (let i = 0; i < p.poly.length; i += 2) pairs.push([p.poly[i], p.poly[i + 1]]);
    expect(outlineWinding(pairs)).toBeGreaterThan(0);
    expect(insidePrism(p, 5, 7)).toBe(true);
  });

  it('emitPlacementBoxes bands a baked box and drops thin tall slivers from the standable set', () => {
    const out: Collider[] = [];
    emitPlacementBoxes(
      out,
      placement({}),
      [
        { x: 1, y: 1, z: 0, hx: 1, hy: 1, hz: 1 },
        { x: 0, y: 2, z: 0, hx: 1, hy: 2, hz: 0.1 },
      ],
      3,
    );
    expect(out).toHaveLength(2);
    const [box, sliver] = out as ObbCollider[];
    expect(box).toMatchObject({ type: 'obb', x: 6, z: 7, hw: 1, hd: 1, baseY: 3, moveTopY: 5 });
    expect(box.standable).toBe(true);
    expect(sliver.standable).toBe(false);
  });

  it('pushPlacementColliders: opt-in gate, lanes, and the dev attribution stamp', () => {
    const out: Collider[] = [];
    const content = contentWith({
      placements: [
        placement({ collideRadius: 0 }),
        placement({ collideRadius: 1.5 }),
        placement({ collideRadius: 1, collideShape: 'square', x: 20 }),
        placement({ collideRadius: 1, worldPropKind: 'fence', worldPropWidth: 4, x: 30 }),
        placement({ collideRadius: 1, path: 'test://baked', x: 40 }),
        placement({ collideRadius: 1, ramps: [{ x: 0, z: 0, hx: 1, hz: 1, y0: 0, y1: 1 }] }),
      ],
      assetCollision: { 'test://baked': [{ x: 0, y: 0.5, z: 0, hx: 1, hy: 0.5, hz: 1 }] },
    });
    pushPlacementColliders(out, content, 1);
    expect(out.map((c) => c.src)).toEqual([
      'test://unbaked#circle',
      'test://unbaked#square',
      'test://unbaked#fence',
      'test://baked#baked',
    ]);
    expect(out[0]).toMatchObject({ type: 'circle', r: 1.5, baseY: 3, cameraTopY: 6 });
    expect(out[1]).toMatchObject({ type: 'obb', x: 20, hw: 1, hd: 1, baseY: 3 });
    expect(out[2]).toMatchObject({
      type: 'obb',
      hw: 2 + FENCE_END_PAD,
      hd: FENCE_HALF_DEPTH,
      cameraTopY: 3 + FENCE_RAIL_HEIGHT,
      isFence: true,
    });
    expect(out[3]).toMatchObject({ type: 'obb', x: 40, baseY: 3, moveTopY: 4 });
  });

  it('pushColliderVolumeColliders emits boxes, walls and spheres, never planes', () => {
    const out: Collider[] = [];
    const base = { x: 100, z: 200, rotY: 0.3, sizeX: 4, sizeY: 3, sizeZ: 2 };
    pushColliderVolumeColliders(
      out,
      contentWith({
        colliderVolumes: [
          { kind: 'box', ...base },
          { kind: 'plane', ...base },
          { kind: 'wall', ...base },
          { kind: 'sphere', ...base },
        ],
      }),
      7,
    );
    const g = groundHeight(100, 200, 7);
    expect(out).toEqual([
      { type: 'obb', x: 100, z: 200, hw: 2, hd: 1, rot: 0.3, cameraTopY: g + 3, underY: g },
      { type: 'obb', x: 100, z: 200, hw: 2, hd: 1, rot: 0.3, cameraTopY: g + 3, underY: g },
      { type: 'circle', x: 100, z: 200, r: 2, cameraTopY: g + 4, underY: g },
    ]);
  });
});

describe('colliders_authored/pass_under', () => {
  it('baseY gates at every content, underY only on an authored map', () => {
    setActiveWorldContent(null);
    const based: Collider = { type: 'circle', x: 0, z: 0, r: 1, baseY: 10 };
    expect(passesUnder(based, 7)).toBe(true);
    expect(passesUnder(based, 7.7)).toBe(false);
    expect(passesUnder(based, undefined)).toBe(false);
    const surface: Collider = { type: 'circle', x: 0, z: 0, r: 1, underY: 10 };
    expect(passesUnder(surface, 0)).toBe(false);
    setActiveWorldContent(contentWith({ placements: [] }));
    expect(passesUnder(surface, 0)).toBe(true);
  });
});

describe('colliders_authored/camera_boom', () => {
  const circlePush = (c: Collider, x: number, z: number, r: number) => {
    if (c.type !== 'circle') return null;
    const d = Math.hypot(x - c.x, z - c.z);
    return d < c.r + r ? { x: c.x + c.r + r, z: c.z } : null;
  };

  it('cameraSolid skips thin posts and keeps walls and prisms', () => {
    expect(cameraSolid({ type: 'circle', x: 0, z: 0, r: 0.5 })).toBe(false);
    expect(cameraSolid({ type: 'circle', x: 0, z: 0, r: 0.9 })).toBe(true);
    expect(cameraSolid({ type: 'obb', x: 0, z: 0, hw: 0.2, hd: 1.2, rot: 0 })).toBe(true);
    expect(cameraSolid(squarePrism())).toBe(true);
  });

  it('stops short of a solid on the boom, ignores overhead and eye-holding ones', () => {
    const trunk: Collider = { type: 'circle', x: 5, z: 0, r: 1 };
    const overhead: Collider = { type: 'circle', x: 3, z: 0, r: 1, baseY: 2 };
    const holdsEye: Collider = { type: 'circle', x: 0, z: 0, r: 2 };
    const list = [holdsEye, overhead, trunk];
    const d = cameraBoomClearDistance(list, 0, 1.5, 0, 10, 1.5, 0, 0.3, circlePush);
    // The boom marches in equal steps of at most CAMERA_BOOM_STEP; the first
    // sample past x = 3.7 (inside the trunk's padded disc) stops it, one step
    // back off that sample.
    const steps = Math.ceil(10 / CAMERA_BOOM_STEP);
    const firstHit = Math.ceil((3.7 / 10) * steps) / steps;
    expect(d).toBeCloseTo(10 * firstHit - CAMERA_BOOM_STEP, 12);
    // Filtered in place to the one collider that can stop the boom.
    expect(list).toEqual([trunk]);
  });

  it('a short or clear boom is Infinity', () => {
    const trunk: Collider = { type: 'circle', x: 5, z: 0, r: 1 };
    expect(cameraBoomClearDistance([trunk], 0, 1, 0, 0.1, 1, 0, 0.3, circlePush)).toBe(Infinity);
    expect(cameraBoomClearDistance([trunk], 0, 1, 5, 10, 1, 5, 0.3, circlePush)).toBe(Infinity);
  });
});

describe('colliders.ts re-exports the moved names', () => {
  it('resolves the same bindings through the old path', () => {
    expect(colliders.colliderTopAt).toBe(colliderTopAt);
    expect(colliders.passesUnder).toBe(passesUnder);
    expect(colliders.prismPolyAt).toBe(prismPolyAt);
    expect(colliders.prismBox).toBe(prismBox);
    expect(colliders.insidePrism).toBe(insidePrism);
    expect(colliders.moverHeight).toBe(moverHeight);
    expect(colliders.MANTLE_REACH).toBe(MANTLE_REACH);
    expect(colliders.FENCE_HALF_DEPTH).toBe(FENCE_HALF_DEPTH);
  });
});
