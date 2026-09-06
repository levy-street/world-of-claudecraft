// One Skeleton (and so one GPU bone texture) per rig: the rebind is only sound
// if every rebaked vertex, and every blendshape on it, skins to the exact same
// world position it did against its own bind data. These tests pin that
// equivalence, pin the one-skeleton/one-texture outcome the renderer pays for,
// and pin that anything the algebra cannot prove is left alone.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { shareRigSkeleton } from '../src/render/characters/rig_shared_skeleton';
import { configureTightBoneTextures } from '../src/render/characters/skin_gpu_layout';

/** three's skinning, evaluated on the CPU, with the mesh's morph influences
 *  applied first: out = bindInv * SUM w_i (B_i * I_i) * bind * morphed(p). */
function skinVertex(mesh: THREE.SkinnedMesh, index: number, bones: THREE.Bone[]): THREE.Vector3 {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const inverses = mesh.skeleton.boneInverses;

  const local = new THREE.Vector3(pos.getX(index), pos.getY(index), pos.getZ(index));
  const targets = geo.morphAttributes.position ?? [];
  const influences = mesh.morphTargetInfluences ?? [];
  for (let t = 0; t < targets.length; t++) {
    const w = influences[t] ?? 0;
    if (w === 0) continue;
    const d = targets[t];
    if (!geo.morphTargetsRelative) local.multiplyScalar(1 - w);
    local.x += d.getX(index) * w;
    local.y += d.getY(index) * w;
    local.z += d.getZ(index) * w;
  }

  const skinVertexPos = new THREE.Vector4(local.x, local.y, local.z, 1).applyMatrix4(
    mesh.bindMatrix,
  );
  const acc = new THREE.Vector4(0, 0, 0, 0);
  const boneMatrix = new THREE.Matrix4();
  for (let c = 0; c < 4; c++) {
    const w = sw.getComponent(index, c);
    if (w === 0) continue;
    const b = si.getComponent(index, c);
    boneMatrix.multiplyMatrices(bones[b].matrixWorld, inverses[b]);
    acc.add(skinVertexPos.clone().applyMatrix4(boneMatrix).multiplyScalar(w));
  }
  const out = acc.applyMatrix4(mesh.bindMatrixInverse);
  return new THREE.Vector3(out.x, out.y, out.z);
}

function makeBones(): THREE.Bone[] {
  const root = new THREE.Bone();
  const child = new THREE.Bone();
  root.add(child);
  child.position.set(0, 1, 0);
  root.position.set(0.3, 0.1, -0.2);
  root.rotation.set(0.2, 0.4, -0.1);
  child.rotation.set(-0.3, 0.15, 0.25);
  root.updateMatrixWorld(true);
  return [root, child];
}

function restInverses(bones: THREE.Bone[]): THREE.Matrix4[] {
  return bones.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert());
}

interface PartOptions {
  material?: THREE.Material;
  bindMatrix?: THREE.Matrix4;
  morphs?: number[][];
  morphNames?: string[];
  name?: string;
}

/** A one-triangle skinned part bound with `inverses`. */
function makePart(
  bones: THREE.Bone[],
  inverses: THREE.Matrix4[],
  positions: number[],
  opts: PartOptions = {},
): THREE.SkinnedMesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], 4),
  );
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([0.7, 0.3, 0, 0, 0.4, 0.6, 0, 0, 0.5, 0.5, 0, 0], 4),
  );
  geo.setIndex([0, 1, 2]);
  if (opts.morphs) {
    geo.morphTargetsRelative = true;
    geo.morphAttributes.position = opts.morphs.map(
      (m) => new THREE.Float32BufferAttribute(m, 3) as THREE.BufferAttribute,
    );
  }
  const mesh = new THREE.SkinnedMesh(geo, opts.material ?? new THREE.MeshBasicMaterial());
  if (opts.name) mesh.name = opts.name;
  mesh.bind(new THREE.Skeleton(bones, inverses), opts.bindMatrix ?? new THREE.Matrix4());
  if (opts.morphs) {
    mesh.morphTargetInfluences = opts.morphs.map(() => 0);
    mesh.morphTargetDictionary = Object.fromEntries(
      (opts.morphNames ?? opts.morphs.map((_, i) => `t${i}`)).map((n, i) => [n, i]),
    );
  }
  return mesh;
}

/** Three parts, each carrying its own meshopt-style dequantization transform in
 *  its inverse bind matrices, exactly the shape the shipped GLBs have. */
function rig(partOptions: (index: number) => PartOptions = () => ({})): {
  root: THREE.Object3D;
  bones: THREE.Bone[];
  parts: THREE.SkinnedMesh[];
} {
  const bones = makeBones();
  const canon = restInverses(bones);
  const root = new THREE.Object3D();
  root.add(bones[0]);
  const parts = [0, 1, 2].map((i) => {
    const t = new THREE.Matrix4()
      .makeScale(0.4 + i * 0.15, 0.5 + i * 0.1, 0.6)
      .setPosition(i * 0.11, -0.05 * i, 0.07);
    return makePart(
      bones,
      canon.map((m) => new THREE.Matrix4().copy(m).multiply(t)),
      [0.2, 0.6, -0.1 * i, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7],
      partOptions(i),
    );
  });
  for (const p of parts) root.add(p);
  root.updateMatrixWorld(true);
  return { root, bones, parts };
}

const skeletonsOf = (root: THREE.Object3D): Set<THREE.Skeleton> => {
  const out = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && sm.skeleton) out.add(sm.skeleton);
  });
  return out;
};

describe('shareRigSkeleton', () => {
  it('leaves a composed rig with exactly one Skeleton and one bone texture', () => {
    const { root, parts } = rig();
    expect(skeletonsOf(root).size).toBe(3);

    const stats = shareRigSkeleton(root);

    expect(stats.skeletonsBefore).toBe(3);
    expect(stats.skeletonsAfter).toBe(1);
    expect(stats.rebound).toBe(2);
    expect(skeletonsOf(root).size).toBe(1);
    // Draw calls are NOT what this pass buys: every part still draws.
    expect(parts.every((p) => p.parent === root)).toBe(true);

    const textures = configureTightBoneTextures(root);
    expect(textures.skeletons).toBe(1);
    const boneTextures = new Set(
      [...skeletonsOf(root)].map((s) => s.boneTexture as THREE.DataTexture),
    );
    expect(boneTextures.size).toBe(1);
  });

  it('preserves the skinned pose of every rebound vertex', () => {
    const { root, bones, parts } = rig();
    const before = parts.flatMap((p) => [0, 1, 2].map((i) => skinVertex(p, i, bones)));

    shareRigSkeleton(root);
    root.updateMatrixWorld(true);

    const after = parts.flatMap((p) => [0, 1, 2].map((i) => skinVertex(p, i, bones)));
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x, 4);
      expect(after[i].y).toBeCloseTo(before[i].y, 4);
      expect(after[i].z).toBeCloseTo(before[i].z, 4);
    }
  });

  it('preserves the pose of a part bound with a different bind matrix', () => {
    // The merge refuses this case (its algebra adopts the canonical part's bind
    // matrix and so needs the two equal). The rebind keeps each part's own bind
    // matrix, so it must handle it, and a body part that moved would be the
    // loudest possible bug.
    const { root, bones, parts } = rig((i) =>
      i === 2 ? { bindMatrix: new THREE.Matrix4().makeTranslation(0, 5, -2) } : {},
    );
    const before = parts.flatMap((p) => [0, 1, 2].map((i) => skinVertex(p, i, bones)));

    const stats = shareRigSkeleton(root);

    expect(stats.skeletonsAfter).toBe(1);
    expect(stats.refused).toBe(0);
    // A frame runs updateMatrixWorld, and an ATTACHED SkinnedMesh (three's
    // default, and what GLTFLoader leaves) rederives bindMatrixInverse from its
    // matrixWorld there. Skipping it would read the transient value bind() just
    // wrote and measure a pose the renderer never draws.
    root.updateMatrixWorld(true);
    const after = parts.flatMap((p) => [0, 1, 2].map((i) => skinVertex(p, i, bones)));
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x, 4);
      expect(after[i].y).toBeCloseTo(before[i].y, 4);
      expect(after[i].z).toBeCloseTo(before[i].z, 4);
    }
  });

  it('carries morph targets through the rebake, deforming to the same pose', () => {
    // Every body and face part of the composed library carries slider morphs.
    // A rebake that dropped them would freeze every slider silently.
    const { root, bones, parts } = rig((i) =>
      i === 0 ? {} : { morphs: [[0.3, -0.2, 0.1, 0, 0.4, -0.15, -0.25, 0.05, 0.2]] },
    );
    for (const part of parts) if (part.morphTargetInfluences) part.morphTargetInfluences[0] = 0.63;
    const before = parts.flatMap((p) => [0, 1, 2].map((i) => skinVertex(p, i, bones)));

    shareRigSkeleton(root);
    root.updateMatrixWorld(true);

    expect(parts[1].geometry.morphAttributes.position).toHaveLength(1);
    expect(parts[1].geometry.morphTargetsRelative).toBe(true);
    const after = parts.flatMap((p) => [0, 1, 2].map((i) => skinVertex(p, i, bones)));
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x, 4);
      expect(after[i].y).toBeCloseTo(before[i].y, 4);
      expect(after[i].z).toBeCloseTo(before[i].z, 4);
    }
    // A rebake that merely COPIED the deltas would pass a pose check with the
    // influence at zero; pin that the delta actually moved.
    const rebaked = parts[1].geometry.morphAttributes.position?.[0];
    expect(rebaked?.getX(0)).not.toBeCloseTo(0.3, 5);
  });

  it('leaves the preferred canonical part geometry untouched', () => {
    // The head's buffer is the identity the decal cuts are cached against.
    const { root, parts } = rig((i) => ({ name: i === 2 ? 'M_Head' : `part_${i}` }));
    const headGeometry = parts[2].geometry;

    shareRigSkeleton(root, { preferCanonical: (mesh) => mesh.name === 'M_Head' });

    expect(parts[2].geometry).toBe(headGeometry);
    expect(parts[0].geometry).not.toBe(headGeometry);
    expect(skeletonsOf(root).size).toBe(1);
    expect([...skeletonsOf(root)][0]).toBe(parts[2].skeleton);
  });

  it('never pulls a mesh riding different bones onto the shared palette', () => {
    // A held prop on its own rig is a different rig, not a part of this one.
    const { root } = rig();
    const otherBones = makeBones();
    const prop = makePart(otherBones, restInverses(otherBones), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    root.add(prop);
    root.updateMatrixWorld(true);

    const stats = shareRigSkeleton(root);

    expect(stats.groups).toBe(2);
    expect(skeletonsOf(root).size).toBe(2);
    expect(prop.skeleton.bones).toEqual(otherBones);
  });

  it('refuses two rigs that only LOOK alike to the cheap bucket key', () => {
    // The bucket key is length plus the end joints, so two rigs agreeing on
    // those land in one bucket; skinning one against the other's bones would be
    // a broken pose, and the exact bone check is what stops it.
    const bones = makeBones();
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const canon = restInverses(bones);
    const mine = makePart(bones, canon, [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7]);
    // Same first and last Bone, same count, a DIFFERENT bone in the middle.
    const middle = new THREE.Bone();
    const impostorBones = [bones[0], middle, bones[1]];
    const mineThree = makePart(
      [bones[0], bones[1], bones[1]],
      [canon[0], canon[1], canon[1]],
      [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7],
    );
    const impostor = makePart(
      impostorBones,
      [canon[0], canon[1].clone(), canon[1]],
      [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7],
    );
    root.add(mine, mineThree, impostor);
    root.updateMatrixWorld(true);

    const stats = shareRigSkeleton(root);

    // mine rides two bones and buckets alone; the other two share a key
    expect(stats.refused).toBe(1);
    // three's Skeleton constructor slices the array, so compare the BONES
    expect(impostor.skeleton.bones[1]).toBe(middle);
    expect(impostor.skeleton).not.toBe(mineThree.skeleton);
  });

  it('refuses a part whose bind data no single transform explains', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const good = makePart(bones, canon, [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7]);
    const scaled = makePart(
      bones,
      canon.map((m) =>
        new THREE.Matrix4().copy(m).multiply(new THREE.Matrix4().makeScale(2, 2, 2)),
      ),
      [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7],
    );
    const broken = makePart(
      bones,
      [
        new THREE.Matrix4().copy(canon[0]).multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5)),
        new THREE.Matrix4().copy(canon[1]).multiply(new THREE.Matrix4().makeTranslation(1, 2, 3)),
      ],
      [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7],
    );
    root.add(good, scaled, broken);
    root.updateMatrixWorld(true);
    const brokenGeometry = broken.geometry;

    const stats = shareRigSkeleton(root);

    expect(stats.refused).toBe(1);
    expect(stats.skeletonsAfter).toBe(2);
    expect(broken.geometry).toBe(brokenGeometry);
    expect(good.skeleton).toBe(scaled.skeleton);
  });

  it('rebinds a SkeletonUtils clone of a shared rig without rebaking anything', () => {
    // Every compose goes through this: SkeletonUtils gives each mesh its own
    // Skeleton, re-splitting what the cached variant unified, but the clone's
    // inverses are the source's own array by reference.
    const { root, parts } = rig();
    shareRigSkeleton(root);
    const geometries = parts.map((p) => p.geometry);

    const clone = cloneSkinned(root);
    expect(skeletonsOf(clone).size).toBe(3);

    const stats = shareRigSkeleton(clone);

    expect(skeletonsOf(clone).size).toBe(1);
    expect(stats.rebaked).toBe(0);
    const cloneGeometries: THREE.BufferGeometry[] = [];
    clone.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) cloneGeometries.push(sm.geometry);
    });
    for (const geometry of cloneGeometries) expect(geometries).toContain(geometry);
  });
});
