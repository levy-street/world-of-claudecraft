// Unit test for skinAwareBounds (src/guide/viewer/model.ts), the load-bearing primitive
// behind the /wiki/models turntable fix. It exists because several creature rigs have a
// scaled/animated armature whose SKINNED mesh sits far from the raw (pre-skinning) geometry
// box: framing or centering off Box3.setFromObject (which reads that raw box) renders them
// blank. skinAwareBounds instead walks each skinned vertex through its bones, so it tracks
// the POSED mesh. three's applyBoneTransform is CPU-only, so this runs in plain Node (no
// WebGL): we build a synthetic SkinnedMesh, pose a bone, and assert the bounds follow.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { skinAwareBounds } from '../src/guide/viewer/model';

// A unit quad in the XY plane, every vertex bound fully to a single bone, wrapped in a root.
function makeRig(): { root: THREE.Object3D; bone: THREE.Bone; mesh: THREE.SkinnedMesh } {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const count = positions.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const skinIndex = new Uint16Array(count * 4); // all weight on bone 0
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) skinWeight[i * 4] = 1;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  const bone = new THREE.Bone();
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  const root = new THREE.Object3D();
  root.add(bone);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));
  root.updateMatrixWorld(true);
  return { root, bone, mesh };
}

// The same quad rig, but nested under an ancestor inside a Scene and bound while the ancestor
// sits at the origin (so the SkinnedMesh's bindMatrixInverse is captured at identity). Moving
// the ancestor AFTER bind is what makes bindMatrixInverse go stale unless a scene-level
// updateMatrixWorld refreshes it: the exact condition skinAwareBounds' callers must satisfy.
function makeNestedRig(): {
  scene: THREE.Scene;
  ancestor: THREE.Object3D;
  root: THREE.Object3D;
  bone: THREE.Bone;
} {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const count = positions.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) skinWeight[i * 4] = 1;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  const bone = new THREE.Bone();
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  const root = new THREE.Object3D();
  root.add(bone);
  root.add(mesh);
  const ancestor = new THREE.Object3D();
  ancestor.add(root);
  const scene = new THREE.Scene();
  scene.add(ancestor);
  scene.updateMatrixWorld(true); // ancestor at the origin: mesh.matrixWorld is identity here
  mesh.bind(new THREE.Skeleton([bone])); // so bindMatrixInverse is captured at identity
  scene.updateMatrixWorld(true);
  return { scene, ancestor, root, bone };
}

const center = (b: THREE.Box3): THREE.Vector3 => b.getCenter(new THREE.Vector3());
const size = (b: THREE.Box3): THREE.Vector3 => b.getSize(new THREE.Vector3());

describe('skinAwareBounds', () => {
  it('measures the bind pose at the geometry box', () => {
    const { root } = makeRig();
    const b = skinAwareBounds(root);
    expect(center(b).x).toBeCloseTo(0, 5);
    expect(center(b).y).toBeCloseTo(0, 5);
    expect(size(b).x).toBeCloseTo(2, 5);
    expect(size(b).y).toBeCloseTo(2, 5);
  });

  it('tracks the POSED mesh when a bone moves (the flinging-rig case)', () => {
    const { root, bone } = makeRig();
    // At bind the skinned mesh sits on the origin (the geometry box).
    expect(center(skinAwareBounds(root)).x).toBeCloseTo(0, 5);

    // The idle clip displaces the armature: the skinned mesh moves far from the bind box. The
    // mesh node itself does not move (its matrixWorld stays identity), so a non-skin-aware
    // walk would leave the bounds at the origin; only following the BONE tracks the pose.
    bone.position.set(10, 4, 0);
    root.updateMatrixWorld(true);

    const posed = skinAwareBounds(root);
    expect(center(posed).x).toBeCloseTo(10, 4);
    expect(center(posed).y).toBeCloseTo(4, 4);
  });

  it('reflects a scaled armature (the box the bind skeleton would otherwise shrink)', () => {
    const { root, bone } = makeRig();
    bone.scale.set(3, 3, 3);
    root.updateMatrixWorld(true);

    const posed = skinAwareBounds(root);
    // The skinned quad is now 3x: ~6 units across, not the raw geometry's 2.
    expect(size(posed).x).toBeCloseTo(6, 3);
    expect(size(posed).y).toBeCloseTo(6, 3);
    expect(posed.isEmpty()).toBe(false);
  });

  // Pins the ACTUAL /wiki/models blank-rig regression: a posed rig whose ancestor moved after
  // bind needs a SCENE-level updateMatrixWorld (which refreshes SkinnedMesh.bindMatrixInverse)
  // before measuring. skinAwareBounds' own internal root.updateWorldMatrix does NOT refresh it,
  // so scene.ts must call scene.updateMatrixWorld first. If someone "simplifies" that back to a
  // mid-tree root.updateWorldMatrix, the bounds land thousands of units off and this fails. The
  // makeRig cases above cannot catch it: their mesh node never moves after bind, so
  // bindMatrixInverse stays valid and the two update paths agree.
  it('needs a scene-level updateMatrixWorld for a rig whose ancestor moved after bind', () => {
    const { scene, ancestor, root, bone } = makeNestedRig();
    const SHIFT = 5000;
    ancestor.position.x = SHIFT; // ancestor moves AFTER bind: bindMatrixInverse is now stale
    bone.position.set(10, 0, 0); // and the idle pose displaces the bone

    // skinAwareBounds internally does only root.updateWorldMatrix(true, true), which refreshes
    // matrixWorld but NOT bindMatrixInverse, so this reproduces the stale-bind (blank) path.
    const stale = skinAwareBounds(root);

    // The fix: a scene-level updateMatrixWorld refreshes bindMatrixInverse before measuring.
    scene.updateMatrixWorld(true);
    const fresh = skinAwareBounds(root);

    // Correct posed center sits at ancestor shift plus the bone displacement.
    expect(center(fresh).x).toBeCloseTo(SHIFT + 10, 1);
    expect(center(fresh).y).toBeCloseTo(0, 1);
    // The stale path mismeasures by about the ancestor shift, landing far off frame.
    expect(Math.abs(center(stale).x - (SHIFT + 10))).toBeGreaterThan(SHIFT / 2);
  });
});
