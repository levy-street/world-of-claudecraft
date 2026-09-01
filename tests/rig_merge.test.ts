// Skinned-rig part merging: the merge is only sound if a rebaked vertex skins to
// the exact same world position it did against its own bind data. These tests pin
// that equivalence, and pin that parts we cannot prove safe are left unmerged.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  animatedNodeNames,
  BIND_EPS,
  mergeSkinnedParts,
  REBIND_EPS,
  rebakeGeometry,
  rebakeMatrix,
  solveRebindTransform,
} from '../src/render/characters/rig_merge';

/** three's skinning, evaluated on the CPU: out = bindInv * SUM w_i (B_i * I_i) * bind * p */
function skinVertex(mesh: THREE.SkinnedMesh, index: number, bones: THREE.Bone[]): THREE.Vector3 {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const inverses = mesh.skeleton.boneInverses;

  const skinVertexPos = new THREE.Vector4(
    pos.getX(index),
    pos.getY(index),
    pos.getZ(index),
    1,
  ).applyMatrix4(mesh.bindMatrix);

  const acc = new THREE.Vector4(0, 0, 0, 0);
  const boneMatrix = new THREE.Matrix4();
  for (let c = 0; c < 4; c++) {
    const w = sw.getComponent(index, c);
    if (w === 0) continue;
    const b = si.getComponent(index, c);
    boneMatrix.multiplyMatrices(bones[b].matrixWorld, inverses[b]);
    const t = skinVertexPos.clone().applyMatrix4(boneMatrix).multiplyScalar(w);
    acc.add(t);
  }
  const out = acc.applyMatrix4(mesh.bindMatrixInverse);
  return new THREE.Vector3(out.x, out.y, out.z);
}

/** Two bones in a small hierarchy, posed away from rest so skinning is non-trivial. */
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

/** A one-triangle skinned part bound with `inverses`. */
function makePart(
  bones: THREE.Bone[],
  inverses: THREE.Matrix4[],
  positions: number[],
  material: THREE.Material = new THREE.MeshBasicMaterial(),
  morphs?: Record<string, number[]>,
): THREE.SkinnedMesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], 4),
  );
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([0.7, 0.3, 0, 0, 0.4, 0.6, 0, 0, 0.5, 0.5, 0, 0], 4),
  );
  geo.setIndex([0, 1, 2]);
  if (morphs) {
    const names = Object.keys(morphs);
    geo.morphTargetsRelative = true;
    geo.morphAttributes.position = names.map(
      (n) => new THREE.Float32BufferAttribute(morphs[n], 3) as THREE.BufferAttribute,
    );
  }
  const mesh = new THREE.SkinnedMesh(geo, material);
  const skeleton = new THREE.Skeleton(bones, inverses);
  mesh.bind(skeleton, new THREE.Matrix4());
  if (morphs) {
    const names = Object.keys(morphs);
    mesh.morphTargetDictionary = Object.fromEntries(names.map((n, i) => [n, i]));
    mesh.morphTargetInfluences = names.map(() => 0);
  }
  return mesh;
}

describe('solveRebindTransform', () => {
  it('recovers the single transform relating two bind-data sets', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    const t = new THREE.Matrix4().makeScale(0.46, 0.46, 0.46).setPosition(0.05, -0.2, 0.11);
    const part = canon.map((m) => new THREE.Matrix4().copy(m).multiply(t));

    const solved = solveRebindTransform(canon, part);
    expect(solved).not.toBeNull();
    for (let i = 0; i < 16; i++) expect(solved!.elements[i]).toBeCloseTo(t.elements[i], 6);
  });

  it('returns the identity when both parts share bind data', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    const solved = solveRebindTransform(canon, restInverses(bones));
    expect(solved).not.toBeNull();
    for (let i = 0; i < 16; i++)
      expect(solved!.elements[i]).toBeCloseTo(new THREE.Matrix4().elements[i], 6);
  });

  it('rejects bind data that no single transform explains', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    // bone 0 scaled, bone 1 translated: no single T satisfies both
    const part = [
      new THREE.Matrix4().copy(canon[0]).multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5)),
      new THREE.Matrix4().copy(canon[1]).multiply(new THREE.Matrix4().makeTranslation(1, 2, 3)),
    ];
    expect(solveRebindTransform(canon, part)).toBeNull();
  });

  it('rejects a deviation only just above the tolerance', () => {
    // The gross counterexample above deviates by ~0.5 to 3.0, so it would still
    // be rejected by a tolerance loosened by four orders of magnitude. This case
    // sits just above REBIND_EPS instead, so it is the one that actually pins the
    // constant: it goes green the moment someone widens REBIND_EPS.
    const bones = makeBones();
    const canon = restInverses(bones);
    const t = new THREE.Matrix4().makeScale(0.46, 0.46, 0.46);
    const part = canon.map((m) => new THREE.Matrix4().copy(m).multiply(t));
    // perturb ONE element of ONE bone by 100x the tolerance (still 5 orders of
    // magnitude tighter than the 1e-2-scale deviation a real re-export causes,
    // and 5 orders LOOSER than the ~1e-7 float residual the real GLBs carry)
    part[1].elements[13] += REBIND_EPS * 100;

    expect(solveRebindTransform(canon, part)).toBeNull();
  });

  it('pins the tolerances themselves, so a loosened guard cannot pass silently', () => {
    // Every other assertion here compares against these constants, so without a
    // literal pin the whole suite moves with them: widening REBIND_EPS to 1e-1
    // would let genuinely different bind poses merge into a corrupted skin with
    // every test still green.
    expect(REBIND_EPS).toBe(1e-4);
    expect(BIND_EPS).toBe(1e-3);
  });

  it('rejects mismatched bone counts and empty bind data', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    expect(solveRebindTransform(canon, [canon[0]])).toBeNull();
    expect(solveRebindTransform([], [])).toBeNull();
  });
});

describe('rebakeGeometry', () => {
  it('makes a part skin identically against the canonical skeleton', () => {
    const bones = makeBones();
    const canonInverses = restInverses(bones);
    // the part carries its own quantization-baked bind data
    const t = new THREE.Matrix4().makeScale(0.46, 0.31, 0.6).setPosition(0.05, -0.2, 0.11);
    const partInverses = canonInverses.map((m) => new THREE.Matrix4().copy(m).multiply(t));

    const positions = [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7];
    const part = makePart(bones, partInverses, positions);
    const canon = makePart(bones, canonInverses, positions);

    const solved = solveRebindTransform(canonInverses, partInverses);
    expect(solved).not.toBeNull();
    const m = rebakeMatrix(canon.bindMatrix, part.bindMatrix, solved!);

    // rebaked geometry, bound to the CANONICAL skeleton
    const rebaked = new THREE.SkinnedMesh(
      rebakeGeometry(part.geometry, m),
      part.material as THREE.Material,
    );
    rebaked.bind(new THREE.Skeleton(bones, canonInverses), canon.bindMatrix);

    for (let i = 0; i < 3; i++) {
      const before = skinVertex(part, i, bones);
      const after = skinVertex(rebaked, i, bones);
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.y).toBeCloseTo(before.y, 5);
      expect(after.z).toBeCloseTo(before.z, 5);
    }
  });

  it('dequantizes normalized integer sources and keeps bone indices integral', () => {
    const bones = makeBones();
    const inverses = restInverses(bones);
    const part = makePart(bones, inverses, [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7]);
    // a quantized uv, exactly as the GLB pipeline emits it
    part.geometry.setAttribute(
      'uv',
      new THREE.Uint16BufferAttribute(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2, true),
    );

    const out = rebakeGeometry(part.geometry, new THREE.Matrix4());
    const uv = out.attributes.uv;
    expect(uv.array).toBeInstanceOf(Float32Array);
    expect(uv.getX(1)).toBeCloseTo(1, 4);
    expect(out.attributes.skinIndex.array).toBeInstanceOf(Uint16Array);
    expect(out.attributes.skinIndex.getY(0)).toBe(1);
  });

  it('carries relative morph deltas through the linear part of the rebake', () => {
    // A glTF morph target is a DISPLACEMENT (morphTargetsRelative), so it takes
    // the rebake's rotation and scale and never its translation. Applying the
    // full matrix would offset every blendshape by the part's own dequantization
    // origin, which reads as a face that jumps the moment a slider leaves zero.
    const bones = makeBones();
    const inverses = restInverses(bones);
    const part = makePart(bones, inverses, [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7]);
    part.geometry.morphTargetsRelative = true;
    part.geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
    ];
    const m = new THREE.Matrix4().makeScale(2, 3, 4).setPosition(10, 20, 30);

    const out = rebakeGeometry(part.geometry, m);

    expect(out.morphTargetsRelative).toBe(true);
    const delta = out.morphAttributes.position?.[0];
    expect(delta?.getX(0)).toBeCloseTo(2, 5);
    expect(delta?.getY(1)).toBeCloseTo(3, 5);
    expect(delta?.getZ(2)).toBeCloseTo(4, 5);
    // the translation must NOT have leaked into a displacement
    expect(delta?.getY(0)).toBeCloseTo(0, 5);
  });

  it('transforms an absolute morph target by the whole matrix', () => {
    const bones = makeBones();
    const part = makePart(bones, restInverses(bones), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    part.geometry.morphTargetsRelative = false;
    part.geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
    ];

    const out = rebakeGeometry(
      part.geometry,
      new THREE.Matrix4().makeScale(2, 3, 4).setPosition(10, 20, 30),
    );

    expect(out.morphTargetsRelative).toBe(false);
    expect(out.morphAttributes.position?.[0]?.getX(0)).toBeCloseTo(12, 5);
    expect(out.morphAttributes.position?.[0]?.getY(0)).toBeCloseTo(20, 5);
  });

  it('leaves a morph-free geometry morph-free', () => {
    // three defines USE_MORPHTARGETS on PRESENCE, so minting an empty list here
    // would relink every rebaked part against a program it does not need.
    const bones = makeBones();
    const part = makePart(bones, restInverses(bones), [0, 0, 0, 1, 0, 0, 0, 1, 0]);

    const out = rebakeGeometry(part.geometry, new THREE.Matrix4());

    expect(Object.keys(out.morphAttributes)).toEqual([]);
  });
});

describe('mergeSkinnedParts', () => {
  function rig(partInverseFactory: (canon: THREE.Matrix4[], i: number) => THREE.Matrix4[]) {
    const bones = makeBones();
    const canonInverses = restInverses(bones);
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const material = new THREE.MeshBasicMaterial();
    const parts = [0, 1, 2].map((i) =>
      makePart(
        bones,
        partInverseFactory(canonInverses, i),
        [0.2, 0.6, -0.1 * i, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7],
        material,
      ),
    );
    for (const p of parts) root.add(p);
    return { root, bones, parts };
  }

  const countSkinned = (root: THREE.Object3D) => {
    let n = 0;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) n++;
    });
    return n;
  };

  it('extracts animated scene-node names from Three animation tracks', () => {
    const clip = new THREE.AnimationClip('wrapper motion', 1, [
      new THREE.VectorKeyframeTrack('wrapper.position', [0, 1], [0, 0, 0, 1, 0, 0]),
    ]);

    expect(animatedNodeNames([clip])).toEqual(new Set(['wrapper']));
  });

  it('collapses per-primitive bind data into one mesh, one skeleton', () => {
    const { root } = rig((canon, i) => {
      const t = new THREE.Matrix4().makeScale(0.4 + i * 0.1, 0.4 + i * 0.1, 0.4 + i * 0.1);
      return canon.map((m) => new THREE.Matrix4().copy(m).multiply(t));
    });
    expect(countSkinned(root)).toBe(3);

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(1);
    const skeletons = new Set<THREE.Skeleton>();
    let merged: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        skeletons.add(sm.skeleton);
        merged = sm;
      }
    });
    expect(skeletons.size).toBe(1);
    expect(merged!.name).toMatch(/_bodymerged$/);
    // three triangles of three vertices folded into one buffer
    expect(merged!.geometry.attributes.position.count).toBe(9);
    expect(merged!.geometry.index!.count).toBe(9);
  });

  it('preserves the skinned pose of every merged vertex', () => {
    const { root, bones, parts } = rig((canon, i) => {
      const t = new THREE.Matrix4().makeScale(0.4 + i * 0.1, 0.5, 0.6).setPosition(i * 0.1, 0, 0);
      return canon.map((m) => new THREE.Matrix4().copy(m).multiply(t));
    });
    const before = parts.flatMap((p) => [0, 1, 2].map((i) => skinVertex(p, i, bones)));

    mergeSkinnedParts(root);

    let merged: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) merged = o as THREE.SkinnedMesh;
    });
    for (let i = 0; i < before.length; i++) {
      const after = skinVertex(merged!, i, bones);
      expect(after.x).toBeCloseTo(before[i].x, 4);
      expect(after.y).toBeCloseTo(before[i].y, 4);
      expect(after.z).toBeCloseTo(before[i].z, 4);
    }
  });

  it('merges static sibling wrappers with the same world transform', () => {
    const { root, bones, parts } = rig((canon, i) => {
      const t = new THREE.Matrix4().makeScale(0.4 + i * 0.1, 0.5, 0.6).setPosition(i * 0.1, 0, 0);
      return canon.map((m) => new THREE.Matrix4().copy(m).multiply(t));
    });
    for (const part of parts) {
      const wrapper = new THREE.Group();
      root.add(wrapper);
      wrapper.add(part);
    }
    root.updateMatrixWorld(true);
    const before = parts.flatMap((part) =>
      [0, 1, 2].map((index) => skinVertex(part, index, bones).applyMatrix4(part.matrixWorld)),
    );

    mergeSkinnedParts(root, new Set());

    expect(countSkinned(root)).toBe(1);
    const mergedMeshes: THREE.SkinnedMesh[] = [];
    root.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
        mergedMeshes.push(object as THREE.SkinnedMesh);
      }
    });
    const merged = mergedMeshes[0];
    if (!merged) throw new Error('sibling-wrapper merge produced no mesh');
    merged.updateMatrixWorld(true);
    for (let i = 0; i < before.length; i++) {
      const after = skinVertex(merged, i, bones).applyMatrix4(merged.matrixWorld);
      expect(after.x).toBeCloseTo(before[i].x, 4);
      expect(after.y).toBeCloseTo(before[i].y, 4);
      expect(after.z).toBeCloseTo(before[i].z, 4);
    }
  });

  it('keeps sibling wrappers separate when an animation targets either chain', () => {
    const { root, parts } = rig((canon) => canon.map((matrix) => matrix.clone()));
    for (let i = 0; i < parts.length; i++) {
      const wrapper = new THREE.Group();
      wrapper.name = `wrapper_${i}`;
      root.add(wrapper);
      wrapper.add(parts[i]);
    }

    mergeSkinnedParts(root, new Set(['wrapper_1']));

    expect(countSkinned(root)).toBe(2);
  });

  it('keeps a directly animated mesh out of a sibling-wrapper merge', () => {
    const { root, parts } = rig((canon) => canon.map((matrix) => matrix.clone()));
    for (let i = 0; i < parts.length; i++) {
      const wrapper = new THREE.Group();
      parts[i].name = `mesh_${i}`;
      root.add(wrapper);
      wrapper.add(parts[i]);
    }

    mergeSkinnedParts(root, new Set(['mesh_1']));

    expect(countSkinned(root)).toBe(2);
  });

  it('does not merge wrappers under different grandparents', () => {
    const { root, parts } = rig((canon) => canon.map((matrix) => matrix.clone()));
    const left = new THREE.Group();
    const right = new THREE.Group();
    root.add(left, right);
    for (let i = 0; i < parts.length; i++) {
      const wrapper = new THREE.Group();
      (i < 2 ? left : right).add(wrapper);
      wrapper.add(parts[i]);
    }

    mergeSkinnedParts(root, new Set());

    expect(countSkinned(root)).toBe(2);
  });

  it('does not merge meshes whose wrapper visibility differs', () => {
    const { root, parts } = rig((canon) => canon.map((matrix) => matrix.clone()));
    for (let i = 0; i < parts.length; i++) {
      const wrapper = new THREE.Group();
      wrapper.visible = i !== 1;
      root.add(wrapper);
      wrapper.add(parts[i]);
    }

    mergeSkinnedParts(root, new Set());

    expect(countSkinned(root)).toBe(2);
  });

  it('does not merge sibling wrappers with different world transforms', () => {
    const { root, parts } = rig((canon) => canon.map((matrix) => matrix.clone()));
    for (let i = 0; i < parts.length; i++) {
      const wrapper = new THREE.Group();
      wrapper.position.x = i;
      root.add(wrapper);
      wrapper.add(parts[i]);
    }

    mergeSkinnedParts(root, new Set());

    expect(countSkinned(root)).toBe(3);
  });

  it('leaves parts whose bind data no single transform explains unmerged', () => {
    const { root } = rig((canon, i) =>
      i === 2
        ? // bone 0 and bone 1 pulled apart independently: unmergeable
          [
            new THREE.Matrix4()
              .copy(canon[0])
              .multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5)),
            new THREE.Matrix4()
              .copy(canon[1])
              .multiply(new THREE.Matrix4().makeTranslation(1, 2, 3)),
          ]
        : canon.map((m) => m.clone()),
    );

    mergeSkinnedParts(root);

    // the two safe parts merge; the third survives on its own
    expect(countSkinned(root)).toBe(2);
  });

  it('never merges across different materials', () => {
    const bones = makeBones();
    const canonInverses = restInverses(bones);
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const pos = [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7];
    root.add(makePart(bones, canonInverses, pos, new THREE.MeshBasicMaterial()));
    root.add(makePart(bones, canonInverses, pos, new THREE.MeshBasicMaterial()));

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(2);
  });

  it('skips hidden parts, leaving them addressable', () => {
    const { root, parts } = rig((canon) => canon.map((m) => m.clone()));
    parts[2].visible = false;

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(2); // one merged body + the hidden part
    expect(parts[2].parent).toBe(root);
  });

  it('never merges parts bound with a different bind matrix', () => {
    // The single-T algebra assumes the parts' bind matrices are equal, and
    // mergeSkinnedParts checks it. Without that guard the rebake would solve for
    // the wrong pre-transform and skin the part into a broken pose.
    const { root, parts } = rig((canon) => canon.map((m) => m.clone()));
    parts[2].bind(parts[2].skeleton, new THREE.Matrix4().makeTranslation(0, 5, 0));

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(2); // the two matching parts merge; the odd one stands alone
    expect(parts[2].parent).toBe(root);
  });

  it('refuses a bucket whose morph targets cannot be named', () => {
    // A merged buffer has ONE target list driven by index, so a part is only
    // placeable on it through its target NAMES. Merging an unnamed target by
    // position would move the wrong blendshape, silently.
    const { root, parts } = rig((canon) => canon.map((m) => m.clone()));
    parts[2].geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute(new Float32Array(9), 3),
    ];

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(3);
    expect(parts[2].geometry.morphAttributes.position).toHaveLength(1);
  });

  it('merges parts with different morph targets onto one union list', () => {
    // The composed body's nine skin parts each carry the subset of the body
    // sliders that reaches them (two on a hand, six on the torso). Merging them
    // is the whole point of the union plan.
    const bones = makeBones();
    const inverses = restInverses(bones);
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const pos = [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7];
    const arm = makePart(bones, inverses, pos, material, {
      body_elbows_up: [0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 0],
    });
    const torso = makePart(bones, inverses, pos, material, {
      body_chest_up: [0, 0.25, 0, 0, 0.25, 0, 0, 0.25, 0],
    });
    const hair = makePart(bones, inverses, pos, material);
    root.add(arm, torso, hair);

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(1);
    let merged: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) merged = o as THREE.SkinnedMesh;
    });
    const mesh = merged as unknown as THREE.SkinnedMesh;
    expect(mesh.morphTargetDictionary).toEqual({ body_elbows_up: 0, body_chest_up: 1 });
    expect(mesh.morphTargetInfluences).toEqual([0, 0]);
    expect(mesh.geometry.morphTargetsRelative).toBe(true);
    const targets = mesh.geometry.morphAttributes.position;
    expect(targets).toHaveLength(2);
    expect(targets?.[0]?.count).toBe(9);
    // the arm's slider moves the arm's three vertices and nothing else
    expect(targets?.[0]?.getX(0)).toBeCloseTo(0.5, 5);
    expect(targets?.[0]?.getX(3)).toBeCloseTo(0, 5);
    expect(targets?.[0]?.getX(6)).toBeCloseTo(0, 5);
    // ...and the torso's slider moves only the torso's
    expect(targets?.[1]?.getY(0)).toBeCloseTo(0, 5);
    expect(targets?.[1]?.getY(3)).toBeCloseTo(0.25, 5);
    expect(targets?.[1]?.getY(6)).toBeCloseTo(0, 5);
  });

  it('never merges across a differing partition key', () => {
    // The merged mesh has ONE name, so a fact a later pass reads off the node
    // name (lipstick on the mouth's lips, the jewel and band material rules)
    // must be uniform inside a bucket.
    const bones = makeBones();
    const inverses = restInverses(bones);
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const pos = [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7];
    const ear = makePart(bones, inverses, pos, material);
    ear.name = 'M_Ear_round';
    const lips = makePart(bones, inverses, pos, material);
    lips.name = 'M_Mouth_neutral_0';
    root.add(ear, lips);

    mergeSkinnedParts(root, undefined, {
      partitionKey: (mesh) => (mesh.name.includes('_Mouth_') ? 'mouth' : 'part'),
    });

    expect(countSkinned(root)).toBe(2);
  });

  it('refuses a bucket whose parts disagree on morph relativity', () => {
    const bones = makeBones();
    const inverses = restInverses(bones);
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const pos = [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7];
    const a = makePart(bones, inverses, pos, material, { jaw_up: [1, 0, 0, 1, 0, 0, 1, 0, 0] });
    const b = makePart(bones, inverses, pos, material, { jaw_up: [1, 0, 0, 1, 0, 0, 1, 0, 0] });
    b.geometry.morphTargetsRelative = false;
    root.add(a, b);

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(2);
  });

  it('carries the canonical render flags onto the merged mesh', () => {
    // visual.ts owns culling/draw order for the rig; the merged part stands in
    // for the canonical one and must present to the renderer identically.
    const { root, parts } = rig((canon) => canon.map((m) => m.clone()));
    parts[0].frustumCulled = false;
    parts[0].castShadow = true;
    parts[0].receiveShadow = true;
    parts[0].renderOrder = 3;
    parts[0].layers.set(2);
    parts[0].userData.bodyMesh = true;

    mergeSkinnedParts(root);

    let merged: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) merged = o as THREE.SkinnedMesh;
    });
    expect(merged!.frustumCulled).toBe(false);
    expect(merged!.castShadow).toBe(true);
    expect(merged!.receiveShadow).toBe(true);
    expect(merged!.renderOrder).toBe(3);
    expect(merged!.layers.mask).toBe(parts[0].layers.mask);
    expect(merged!.userData.bodyMesh).toBe(true);
  });
});
