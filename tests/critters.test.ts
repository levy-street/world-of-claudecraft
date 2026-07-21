import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCritters,
  causewayPopScale,
  creatureForwardCorrectionYaw,
  critterPreloadInternalsForTest,
} from '../src/render/critters';

// The Eastbrook Vale / Mirefen Marsh boundary runs along the causeway at z=180.
// Ambient critters thin out across this band (see critters.ts), so the active
// pool tapers to a sparse floor centred on the crossing.
const CAUSEWAY_Z = 180;
const DUNGEON_X = 700; // x beyond DUNGEON_X_THRESHOLD (600) = indoors

describe('critter causeway population taper', () => {
  it('is full in the open vale/marsh and sparse on the causeway', () => {
    // Deep in Eastbrook and deep in Mirefen: full density.
    expect(causewayPopScale(0)).toBeCloseTo(1, 6);
    expect(causewayPopScale(360)).toBeCloseTo(1, 6);
    // On the causeway boundary: thinned to the floor.
    expect(causewayPopScale(CAUSEWAY_Z)).toBeLessThan(0.5);
    // Strictly fewer near the crossing than away from it.
    expect(causewayPopScale(CAUSEWAY_Z)).toBeLessThan(causewayPopScale(0));
  });

  it('tapers monotonically as the player approaches the causeway', () => {
    let prev = causewayPopScale(0);
    for (let z = 20; z <= CAUSEWAY_Z; z += 20) {
      const cur = causewayPopScale(z);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
  });

  it('never shows more critters than the tapered cap allows', () => {
    const { group, update } = buildCritters(1234);
    const pool = group.children.length;
    const countVisible = () => group.children.filter((m) => m.visible).length;
    // Settle the pool at each sample position, then assert the visible count
    // respects the per-position active cap.
    for (const z of [0, 120, CAUSEWAY_Z, 240, 360]) {
      for (let i = 0; i < 20; i++) update(0, z, 0.1);
      const cap = Math.round(pool * causewayPopScale(z));
      expect(countVisible()).toBeLessThanOrEqual(cap);
    }
  });

  it('hides the whole pool inside an instance', () => {
    const { group, update } = buildCritters(7);
    update(DUNGEON_X, 0, 0.1);
    expect(group.visible).toBe(false);
    update(0, 0, 0.1);
    expect(group.visible).toBe(true);
  });
});

// #1862: "bird and squirrel move sideways/backwards" turned out to be TWO
// distinct forward-axis bugs, not one. A horizontal-bounding-box heuristic
// (widest silhouette = forward) is not a valid proxy for nose-to-tail: it
// picked the wrong AXIS for the bird (its bbox is Z-long from wingspan, but
// the beak points +X) and had no way to pick the right SIGN for the squirrel
// (nose at +X needs -PI/2, not +PI/2, to land on +Z). Since this is a small,
// fixed set of exactly three species, the fix is an explicit per-species yaw
// table instead, verified against the live scene (see critters.ts for the
// derivation): rabbit's nose already leads +Z (no correction), while the
// squirrel's and bird's noses are both authored along +X (-PI/2 each).
describe('critter forward-axis correction (#1862)', () => {
  it('leaves rabbit_critter.glb alone: its nose already leads +Z', () => {
    expect(creatureForwardCorrectionYaw('rabbit')).toBe(0);
  });

  it('corrects squirrel_critter.glb: nose at +X needs -PI/2 to land on +Z', () => {
    expect(creatureForwardCorrectionYaw('squirrel')).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('corrects songbird_critter.glb: beak at +X needs -PI/2, not the +0 a bbox heuristic would give', () => {
    expect(creatureForwardCorrectionYaw('bird')).toBeCloseTo(-Math.PI / 2, 6);
  });
});

// The raw local axis each species' nose actually sits on BEFORE correction is
// applied (see critters.ts: rabbit's nose already leads +Z; squirrel's and
// the songbird's beak both sit on +X). `getWorldDirection` only ever reports
// an object's local +Z axis, which would trivially "pass" for any correction
// value since the correction itself is what's rotating that axis; to
// actually exercise the bug (wrong axis picked, or right axis wrong sign)
// the fixture must track the SAME raw axis a real GLB's nose sits on, then
// check where that raw axis lands after seatAndOrientCreatureInstance's
// correction plus the per-frame heading rotation are both applied.
const RAW_NOSE_LOCAL_AXIS: Record<'rabbit' | 'squirrel' | 'bird', THREE.Vector3> = {
  rabbit: new THREE.Vector3(0, 0, 1),
  squirrel: new THREE.Vector3(1, 0, 0),
  bird: new THREE.Vector3(1, 0, 0),
};

// Builds a critter field where ONLY the target species has a loaded fake
// GLB: buildCritters still randomly picks all three species, but the other
// two fall back to the merged-primitive mesh, which has no `children` (no
// group wrapper), so those instances are transparently skipped below via the
// `!inner` check. This isolates the measurement to real instances of exactly
// the one species under test, driven through the real per-frame
// wander/heading update path.
function measureNoseVelocityDots(species: 'rabbit' | 'squirrel' | 'bird'): number[] {
  const fakeScene = new THREE.Group();
  fakeScene.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4)));
  critterPreloadInternalsForTest.setLoadedForTest(species, fakeScene);
  const noseLocalAxis = RAW_NOSE_LOCAL_AXIS[species];
  const dots: number[] = [];
  for (let seed = 1; seed <= 10 && dots.length === 0; seed++) {
    const { group, update } = buildCritters(seed);
    const prevPos = new Map<THREE.Object3D, THREE.Vector3>();
    for (let i = 0; i < 60; i++) {
      update(0, 0, 0.1);
      for (const obj of group.children) {
        if (!obj.visible) continue;
        const inner = obj.children[0];
        const cur = obj.position.clone();
        const prev = prevPos.get(obj);
        prevPos.set(obj, cur);
        if (!inner || !prev) continue;
        const vel = cur.clone().sub(prev);
        vel.y = 0;
        if (vel.lengthSq() < 1e-8) continue; // not moving this tick
        vel.normalize();
        const worldQuat = new THREE.Quaternion();
        inner.getWorldQuaternion(worldQuat);
        const nose = noseLocalAxis.clone().applyQuaternion(worldQuat);
        nose.y = 0;
        if (nose.lengthSq() < 1e-8) continue;
        nose.normalize();
        dots.push(nose.dot(vel));
      }
    }
  }
  return dots;
}

// The regression the review asked for: prove the actual property #1862 cares
// about (a moving critter's nose points along its velocity), driven through
// the REAL per-frame update path, for all three species. This is stricter
// than pinning the correction constants above: it would have caught both the
// "stays broadside" bug (dot ~ 0) and the "faces backwards" bug (dot ~ -1).
describe('critter GLB nose points along its travel direction, not sideways or backwards (#1862)', () => {
  afterEach(() => critterPreloadInternalsForTest.clearLoadedForTest());

  for (const species of ['rabbit', 'squirrel', 'bird'] as const) {
    it(`${species}: nose direction has a strictly positive dot with its measured velocity`, () => {
      const dots = measureNoseVelocityDots(species);
      expect(dots.length).toBeGreaterThan(0);
      for (const dot of dots) expect(dot).toBeGreaterThan(0);
    });
  }
});

// The other half of #1862 ("critters clip trough the ground") is the seat
// correction. Every species re-seats its loaded GLB so the model's feet, not
// its (frequently vertically-centered) authoring origin, sit at local y=0.
describe('critter GLB seat correction removes ground clipping for every species (#1862)', () => {
  it('re-seats each species so its feet sit at local y=0, and it survives per-frame writes', () => {
    for (const species of ['rabbit', 'squirrel', 'bird'] as const) {
      const fakeScene = new THREE.Group();
      // Authored off-ground and vertically centered: box spans y in [0.35, 0.65].
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4));
      mesh.position.y = 0.5;
      fakeScene.add(mesh);
      critterPreloadInternalsForTest.setLoadedForTest(species, fakeScene);
    }
    try {
      const { group, update } = buildCritters(3);
      for (let i = 0; i < 30; i++) update(0, 0, 0.1);
      const withInner = group.children.filter((o) => o.visible && o.children.length > 0);
      expect(withInner.length).toBeGreaterThan(0);
      for (const obj of withInner) {
        const inner = obj.children[0];
        // Sink = 0: the model's own local bounding box now bottoms out at y=0,
        // not below (the per-frame heading write on the OUTER group cannot
        // have clobbered this since the correction lives on the inner clone).
        const box = new THREE.Box3().setFromObject(inner);
        expect(box.min.y).toBeCloseTo(0, 5);
      }
    } finally {
      critterPreloadInternalsForTest.clearLoadedForTest();
    }
  });
});
