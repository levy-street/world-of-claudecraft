// The foliage shadow-caster policy (src/render/foliage_shadow_core.ts).
//
// The regression these pin: the shadow-only tree clones were culled on a
// camera-radial window measured from a foliage bucket's NEAR EDGE. A bucket is
// a ~500x240 yard slab with a ~290 yard bounding radius, so that probe kept
// every slab whose centre sat within cap + 290 yards, six of them in town and
// ~670k submitted triangles, while the key light's shadow map is a 210 yard box
// centred on the player. This module answers the question that box actually
// asks, and the numbers below are taken from the shipped renderer (S = 105,
// near 30, far 480, SUN_ANCHOR (90, 62, 50), so a 31 degree sun 120.2 yards out).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attachPackedShadowGate,
  boxDistanceXZ,
  collapseProbeMoved,
  copyCollapseProbe,
  copyShadowVolumeBasis,
  createCollapseProbe,
  createShadowVolumeBasis,
  type PackedShadowGatedMesh,
  packShadowCasters,
  SHADOW_BOX_STRIDE,
  SHADOW_CASTER_MARGIN,
  SHADOW_REPACK_MOVE,
  type ShadowVolumeInput,
  setShadowVolumeBasis,
  shadowRowVisible,
  shadowVolumeIntersectsBox,
  shadowVolumeMoved,
} from '../src/render/foliage_shadow_core';

/** The shipped outdoor shadow camera, parsed rather than restated. */
function shippedShadowCamera(): { halfExtent: number; near: number; far: number } {
  const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
  const near = Number(/sun\.shadow\.camera\.near = ([\d.]+)/.exec(src)?.[1]);
  const far = Number(/sun\.shadow\.camera\.far = ([\d.]+)/.exec(src)?.[1]);
  const half = Number(/const S = LOW_GFX \? [\d.]+ : ([\d.]+);/.exec(src)?.[1]);
  expect(near, 'shadow camera near not found in renderer.ts').toBeGreaterThan(0);
  expect(far, 'shadow camera far not found in renderer.ts').toBeGreaterThan(near);
  expect(half, 'shadow ortho half extent not found in renderer.ts').toBeGreaterThan(0);
  return { halfExtent: half, near, far };
}

/** The shipped sun anchor, which fixes the noon light direction and distance. */
function shippedSun(): { x: number; y: number; z: number; distance: number } {
  const src = readFileSync(new URL('../src/render/gfx.ts', import.meta.url), 'utf8');
  const m = /SUN_ANCHOR = new THREE\.Vector3\((-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\)/.exec(src);
  expect(m, 'SUN_ANCHOR not found in gfx.ts').not.toBe(null);
  const [x, y, z] = [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])];
  const distance = Math.hypot(x, y, z);
  return { x: x / distance, y: y / distance, z: z / distance, distance };
}

const CAMERA = shippedShadowCamera();
const SUN = shippedSun();

function volume(over: Partial<ShadowVolumeInput> = {}): ShadowVolumeInput {
  return {
    dirX: SUN.x,
    dirY: SUN.y,
    dirZ: SUN.z,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    halfExtent: CAMERA.halfExtent,
    lightDistance: SUN.distance,
    near: CAMERA.near,
    far: CAMERA.far,
    ...over,
  };
}

const basisFor = (over: Partial<ShadowVolumeInput> = {}) =>
  setShadowVolumeBasis(createShadowVolumeBasis(), volume(over));

/** A tree-sized caster box at ground level. */
const tree = (x: number, z: number) => ({ cx: x, cy: 8, cz: z, hx: 6, hy: 9, hz: 6 });

const hits = (b: ReturnType<typeof basisFor>, t: ReturnType<typeof tree>): boolean =>
  shadowVolumeIntersectsBox(b, t.cx, t.cy, t.cz, t.hx, t.hy, t.hz);

describe('shadow volume basis: the box three actually renders', () => {
  it('accepts the shipped sun and rejects nothing usable', () => {
    const b = basisFor();
    expect(b.valid).toBe(true);
    // right is horizontal by construction (up x dir), so a caster's height can
    // never push it out of the box sideways.
    expect(b.rightY).toBe(0);
    expect(Math.hypot(b.rightX, b.rightY, b.rightZ)).toBeCloseTo(1, 12);
    expect(Math.hypot(b.upX, b.upY, b.upZ)).toBeCloseTo(1, 12);
    // an orthonormal basis: every pair is perpendicular
    expect(b.rightX * b.upX + b.rightY * b.upY + b.rightZ * b.upZ).toBeCloseTo(0, 12);
    expect(b.rightX * b.dirX + b.rightY * b.dirY + b.rightZ * b.dirZ).toBeCloseTo(0, 12);
    expect(b.upX * b.dirX + b.upY * b.dirY + b.upZ * b.dirZ).toBeCloseTo(0, 12);
    // depth window: the camera sits lightDistance out and sees near..far
    expect(b.depthMin).toBeCloseTo(SUN.distance - CAMERA.far, 6);
    expect(b.depthMax).toBeCloseTo(SUN.distance - CAMERA.near, 6);
  });

  it('keeps the tree the player is standing under', () => {
    expect(hits(basisFor(), tree(0, 0))).toBe(true);
    expect(hits(basisFor(), tree(4, -3))).toBe(true);
  });

  it('drops a tree past the box across the sun azimuth', () => {
    // The perpendicular axis is the tight one: the box is only halfExtent wide
    // there whatever the sun elevation.
    const b = basisFor();
    const perpX = b.rightX;
    const perpZ = b.rightZ;
    const reach = CAMERA.halfExtent + 6 + SHADOW_CASTER_MARGIN;
    expect(hits(b, tree(perpX * (reach - 5), perpZ * (reach - 5)))).toBe(true);
    expect(hits(b, tree(perpX * (reach + 5), perpZ * (reach + 5)))).toBe(false);
  });

  it('drops a tree past the box along the sun azimuth', () => {
    // Along the azimuth the box reaches halfExtent / sin(elevation), which for
    // the shipped 31 degree sun is a bit over 200 yards. The old near-edge probe
    // kept slabs whose centre was 590 yards out.
    const b = basisFor();
    const azimuth = Math.hypot(SUN.x, SUN.z);
    const ax = SUN.x / azimuth;
    const az = SUN.z / azimuth;
    expect(hits(b, tree(-ax * 150, -az * 150))).toBe(true);
    expect(hits(b, tree(-ax * 320, -az * 320))).toBe(false);
    expect(hits(b, tree(ax * 320, az * 320))).toBe(false);
    // the honest reach, pinned so a retune of S or the anchor shows up here
    let reach = 0;
    while (reach < 900 && hits(b, tree(-ax * (reach + 1), -az * (reach + 1)))) reach++;
    expect(reach).toBeGreaterThan(150);
    expect(reach).toBeLessThan(280);
  });

  it('a low sun stretches the box along the ground, as long shadows really do', () => {
    // Dawn: the same 210 yard box, tilted, reaches much further downsun. The
    // test that matters is that the cull follows the light rather than assuming
    // noon, so a caster that really does throw a long shadow keeps casting.
    const low = basisFor({ dirX: 0.995, dirY: 0.0998, dirZ: 0 });
    const noon = basisFor({ dirX: 0.3122, dirY: 0.95, dirZ: 0 });
    expect(hits(low, tree(-300, 0))).toBe(true);
    expect(hits(noon, tree(-300, 0))).toBe(false);
    // Even then the far plane bounds it: the shadow camera sits lightDistance
    // out and sees `far`, so nothing past far - lightDistance behind the player
    // reaches the map however low the sun gets.
    expect(hits(low, tree(-(CAMERA.far - SUN.distance) - 40, 0))).toBe(false);
  });

  it('refuses a light within a few degrees of straight up rather than guessing', () => {
    // three's lookAt perturbs its own basis there, so ours would stop describing
    // the same box. Invalid means "keep everything", never "drop everything".
    const b = setShadowVolumeBasis(createShadowVolumeBasis(), volume({ dirX: 0, dirZ: 0.01 }));
    expect(b.valid).toBe(false);
    expect(hits(b, tree(5000, 5000))).toBe(true);
  });

  it('treats a null, zero-extent or inverted volume as no volume', () => {
    expect(setShadowVolumeBasis(createShadowVolumeBasis(), null).valid).toBe(false);
    expect(basisFor({ halfExtent: 0 }).valid).toBe(false);
    expect(basisFor({ near: 500 }).valid).toBe(false);
  });

  it('follows the target, so the box belongs to the player and not to the origin', () => {
    const here = basisFor();
    const there = basisFor({ targetX: 600, targetZ: 600 });
    expect(hits(here, tree(0, 0))).toBe(true);
    expect(hits(there, tree(0, 0))).toBe(false);
    expect(hits(there, tree(600, 600))).toBe(true);
  });
});

describe('shadow row cull: distance measured to the slab, not to its bounding sphere', () => {
  // The shipped slab, measured from the real decoration buckets: about 500x240
  // yards, whose bounding sphere radius is ~290.
  const SLAB = { centerX: 250, centerY: 10, centerZ: 120, halfX: 250, halfY: 20, halfZ: 120 };
  const SPHERE_RADIUS = Math.hypot(500, 240) / 2 + 18;

  it('reports 0 while the player stands inside the slab footprint', () => {
    expect(boxDistanceXZ(250, 120, SLAB.centerX, SLAB.centerZ, SLAB.halfX, SLAB.halfZ)).toBe(0);
    expect(boxDistanceXZ(1, 120, SLAB.centerX, SLAB.centerZ, SLAB.halfX, SLAB.halfZ)).toBe(0);
  });

  it('reports the true gap to the nearest tree, where the sphere probe did not', () => {
    // Player 100 yards short of the slab's near edge, off to one side. Centre
    // distance minus the bounding radius reports it as already inside; the box
    // distance says 100, which is the number the cap is written against.
    const px = 250;
    const pz = SLAB.centerZ - SLAB.halfZ - 100;
    expect(boxDistanceXZ(px, pz, SLAB.centerX, SLAB.centerZ, SLAB.halfX, SLAB.halfZ)).toBeCloseTo(
      100,
      6,
    );
    const centreDist = Math.hypot(px - SLAB.centerX, pz - SLAB.centerZ);
    expect(centreDist - SPHERE_RADIUS).toBeLessThan(0);
  });

  it('keeps the slab the player stands in, which the centre rule used to drop', () => {
    // The bug the near-edge probe was added for: standing at the far corner of a
    // slab, the trees a few paces away are in a bucket whose CENTRE is ~280
    // yards off, so a centre-keyed cap deleted their shadows as one block.
    const px = SLAB.centerX - SLAB.halfX + 2;
    const pz = SLAB.centerZ - SLAB.halfZ + 2;
    const centreDist = Math.hypot(px - SLAB.centerX, pz - SLAB.centerZ);
    expect(centreDist).toBeGreaterThan(250); // what the centre rule saw
    expect(shadowRowVisible(SLAB, px, pz, 250, basisFor({ targetX: px, targetZ: pz }))).toBe(true);
  });

  it('still drops a slab once its nearest tree is past the cap', () => {
    const px = SLAB.centerX;
    const pz = SLAB.centerZ - SLAB.halfZ - 260;
    const b = basisFor({ targetX: px, targetZ: pz });
    expect(shadowRowVisible(SLAB, px, pz, 250, b)).toBe(false);
  });

  it('does not flip on a yard of drift while the near trees stay in range', () => {
    // The reported symptom was "shadows can just disappear on a small camera
    // shift". Walk a yard at a time toward a slab we are well inside the cap of.
    for (let gap = 20; gap >= 0; gap--) {
      const px = SLAB.centerX;
      const pz = SLAB.centerZ - SLAB.halfZ - gap;
      const b = basisFor({ targetX: px, targetZ: pz });
      expect(shadowRowVisible(SLAB, px, pz, 250, b), `gap ${gap}`).toBe(true);
    }
  });

  it('drops a slab the shadow box cannot reach even when it is inside the cap', () => {
    // The whole point: 260 yards away across the sun azimuth is well inside a
    // 300 yard cap and completely outside a 210 yard shadow map.
    const b = basisFor();
    const perp = { x: b.rightX, z: b.rightZ };
    const slab = {
      centerX: perp.x * 300,
      centerY: 10,
      centerZ: perp.z * 300,
      halfX: 60,
      halfY: 20,
      halfZ: 60,
    };
    expect(boxDistanceXZ(0, 0, slab.centerX, slab.centerZ, slab.halfX, slab.halfZ)).toBeLessThan(
      300,
    );
    expect(shadowRowVisible(slab, 0, 0, 300, b)).toBe(false);
    // ...and with no volume pushed it survives, because the fallback may only
    // ever be more generous than the truth.
    expect(shadowRowVisible(slab, 0, 0, 300, createShadowVolumeBasis())).toBe(true);
  });
});

describe('caster packing: only the instances that can cast are submitted', () => {
  function makeRow(positions: [number, number][]): {
    boxes: Float32Array;
    source: Float32Array;
    target: Float32Array;
  } {
    const boxes = new Float32Array(positions.length * SHADOW_BOX_STRIDE);
    const source = new Float32Array(positions.length * 16);
    positions.forEach(([x, z], i) => {
      const b = i * SHADOW_BOX_STRIDE;
      boxes[b] = x;
      boxes[b + 1] = 8;
      boxes[b + 2] = z;
      boxes[b + 3] = 6;
      boxes[b + 4] = 9;
      boxes[b + 5] = 6;
      // a recognisable matrix per instance: identity with the translation set
      source[i * 16] = 1;
      source[i * 16 + 5] = 1;
      source[i * 16 + 10] = 1;
      source[i * 16 + 12] = x;
      source[i * 16 + 14] = z;
      source[i * 16 + 15] = 1;
    });
    return { boxes, source, target: new Float32Array(source.length) };
  }

  /** No collapse window: the volume alone decides. */
  const noCollapse = createCollapseProbe();

  it('packs the survivors to the front and reports their count', () => {
    const b = basisFor();
    const away = 2000; // far outside any box, whatever the sun does
    const row = makeRow([
      [away, away],
      [0, 0],
      [away, -away],
      [10, -6],
    ]);
    const packed = packShadowCasters(b, row.boxes, 4, row.source, row.target, noCollapse);
    expect(packed).toBe(2);
    // the two survivors, in order, at the FRONT of the buffer
    expect(row.target[12]).toBe(0);
    expect(row.target[14]).toBe(0);
    expect(row.target[16 + 12]).toBe(10);
    expect(row.target[16 + 14]).toBe(-6);
  });

  it('cuts a slab-sized population down to the trees inside the map', () => {
    // 500x240 yards of forest on a 30 yard grid, the shipped slab shape, with
    // the player standing at one corner of it (the town case: the slab centres
    // sit at x = +-250, and the player is near x = 0). Submitting the slab means
    // paying for every one of these, which is what the 670k triangles were.
    const positions: [number, number][] = [];
    for (let x = 0; x <= 500; x += 30) {
      for (let z = 0; z <= 240; z += 30) positions.push([x, z]);
    }
    const row = makeRow(positions);
    const packed = packShadowCasters(
      basisFor(),
      row.boxes,
      positions.length,
      row.source,
      row.target,
      noCollapse,
    );
    // Trees at the corner still cast, so this is a cut and not a deletion.
    expect(packed).toBeGreaterThan(0);
    expect(packed).toBeLessThan(positions.length / 4);
  });

  it('drops a caster whose own tree has already collapsed to a sprite', () => {
    // The dawn case. The volume tilts flat and runs to its far plane, so a tree
    // 300 yards downsun is inside the shadow map, but the sprite swap sits at
    // 234 and foliage_impostor.ts leaves the sprite mesh castShadow false: a
    // full-geometry caster there is waste, and a shadow with no tree over it.
    const low = basisFor({ dirX: 0.995, dirY: 0.0998, dirZ: 0 });
    const row = makeRow([
      [-300, 0],
      [-100, 0],
    ]);
    expect(packShadowCasters(low, row.boxes, 2, row.source, row.target, noCollapse)).toBe(2);
    const swapped = { camX: 0, camZ: 0, collapseFar: 234 + SHADOW_CASTER_MARGIN };
    expect(packShadowCasters(low, row.boxes, 2, row.source, row.target, swapped)).toBe(1);
    expect(row.target[12]).toBe(-100);
  });

  it('measures the collapse from the CAMERA, as the collapse shader does', () => {
    // foliage_collapse.ts: distance(collapseOrigin, cameraPosition.xz). Keying
    // it on the player instead would drop a caster the shader still draws
    // whenever the camera is pulled back toward it.
    const low = basisFor({ dirX: 0.995, dirY: 0.0998, dirZ: 0 });
    const row = makeRow([[-300, 0]]);
    const behind = { camX: 80, camZ: 0, collapseFar: 234 };
    const ahead = { camX: -80, camZ: 0, collapseFar: 234 };
    expect(packShadowCasters(low, row.boxes, 1, row.source, row.target, behind)).toBe(0);
    expect(packShadowCasters(low, row.boxes, 1, row.source, row.target, ahead)).toBe(1);
  });

  it('copies everything when there is no volume, so a missing push cannot delete a shadow', () => {
    const row = makeRow([
      [9000, 9000],
      [0, 0],
    ]);
    const packed = packShadowCasters(
      createShadowVolumeBasis(),
      row.boxes,
      2,
      row.source,
      row.target,
      { camX: 0, camZ: 0, collapseFar: 10 },
    );
    expect(packed).toBe(2);
    expect(row.target[12]).toBe(9000);
    expect(row.target[16 + 12]).toBe(0);
  });
});

describe('repack cadence', () => {
  it('holds still for a stationary player and reacts to a real move', () => {
    const a = basisFor();
    const packed = createShadowVolumeBasis();
    copyShadowVolumeBasis(packed, a);
    expect(shadowVolumeMoved(basisFor({ targetX: 0.2, targetZ: 0.1 }), packed)).toBe(false);
    expect(shadowVolumeMoved(basisFor({ targetX: 4 }), packed)).toBe(true);
    // and to the sun swinging across the day, which moves the box's shape
    expect(shadowVolumeMoved(basisFor({ dirX: 0.6, dirY: 0.6, dirZ: 0.529 }), packed)).toBe(true);
  });

  it('always repacks when the volume appears or disappears', () => {
    const none = createShadowVolumeBasis();
    expect(shadowVolumeMoved(basisFor(), none)).toBe(true);
    expect(shadowVolumeMoved(none, basisFor())).toBe(true);
    expect(shadowVolumeMoved(none, createShadowVolumeBasis())).toBe(false);
  });

  it('stays inside the caster margin, so a stale pack is still a superset', () => {
    // The skipped-repack threshold must be smaller than the slack every caster
    // box carries, or a pack held over from last frame could miss a caster that
    // has since entered the box.
    const packed = createShadowVolumeBasis();
    copyShadowVolumeBasis(packed, basisFor());
    const justUnder = basisFor({ targetX: SHADOW_CASTER_MARGIN, targetZ: 0 });
    expect(shadowVolumeMoved(justUnder, packed)).toBe(true);
    expect(SHADOW_REPACK_MOVE).toBeLessThan(SHADOW_CASTER_MARGIN);
  });

  it('repacks for a camera that orbits a stationary player', () => {
    // The volume is centred on the PLAYER and the collapse is measured from the
    // CAMERA, so orbiting a standing character moves one and not the other. If
    // only the volume were watched, the collapse cut would go stale by the whole
    // boom length and could hold a caster for a tree that swapped back to real
    // geometry as the camera pulled toward it.
    const still = basisFor();
    const packedBasis = createShadowVolumeBasis();
    copyShadowVolumeBasis(packedBasis, still);
    expect(shadowVolumeMoved(still, packedBasis)).toBe(false);

    const probe = createCollapseProbe();
    probe.collapseFar = 234;
    const packedProbe = createCollapseProbe();
    copyCollapseProbe(packedProbe, probe);
    expect(collapseProbeMoved(probe, packedProbe)).toBe(false);
    expect(collapseProbeMoved({ camX: 14, camZ: 0, collapseFar: 234 }, packedProbe)).toBe(true);
    // and to the swap line itself moving, which the governor and fog both do
    expect(collapseProbeMoved({ camX: 0, camZ: 0, collapseFar: 200 }, packedProbe)).toBe(true);
    // ...but not to sub-threshold jitter, which the caster margin absorbs
    expect(collapseProbeMoved({ camX: 0.2, camZ: 0.1, collapseFar: 234.2 }, packedProbe)).toBe(
      false,
    );
  });
});

describe('packed shadow-pass gate', () => {
  const gated = (drawCount: number) => {
    const source = { drawCount };
    const mesh: PackedShadowGatedMesh = {
      count: 40,
      onBeforeShadow: null,
      onAfterShadow: null,
    };
    attachPackedShadowGate(mesh, source);
    return { mesh, source };
  };

  it('keeps the colour pass at zero and hands the shadow pass the packed count', () => {
    const { mesh } = gated(7);
    expect(mesh.count).toBe(0);
    expect(mesh.shadowPassFullCount).toBe(40);
    (mesh.onBeforeShadow as () => void)();
    expect(mesh.count).toBe(7);
    (mesh.onAfterShadow as () => void)();
    expect(mesh.count).toBe(0);
  });

  it('reads the count live, because the pack changes it every time the player moves', () => {
    const { mesh, source } = gated(7);
    source.drawCount = 2;
    (mesh.onBeforeShadow as () => void)();
    expect(mesh.count).toBe(2);
  });
});
