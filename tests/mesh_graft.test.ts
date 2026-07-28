// The mesh graft: borrowing a class body's own meshes onto its level-20 armor rig,
// which is the same 25-joint mixamorig skeleton in a different GLB.
//
// The claim worth pinning is not "a mesh appeared" but "it skins IDENTICALLY".
// So the core case builds two rigs with matching bone names, grafts across, poses
// both the same way, and compares actual skinned vertex positions.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hasArmoredBody, VISUALS } from '../src/render/characters/manifest';
import { bonesByName, graftSkinnedNodes, retargetBones } from '../src/render/characters/mesh_graft';
import { ALL_CLASSES } from '../src/sim/types';

/** A two-bone rig plus a skinned quad weighted entirely to the upper bone, the
 *  shape of a rigid-capped head on these chibi bodies. */
function makeRig(): { root: THREE.Object3D; mesh: THREE.SkinnedMesh } {
  const lower = new THREE.Bone();
  lower.name = 'mixamorigNeck';
  const upper = new THREE.Bone();
  upper.name = 'mixamorigHead';
  upper.position.set(0, 1, 0);
  lower.add(upper);

  const root = new THREE.Object3D();
  root.add(lower);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 1.2, 0, 0.3, 1.5, 0, -0.3, 1.5, 0.2], 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );

  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'Head';
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([lower, upper]));
  root.updateMatrixWorld(true);
  return { root, mesh };
}

/** Every vertex of `mesh` after skinning, in its own local space. */
function skinnedVertices(mesh: THREE.SkinnedMesh): number[] {
  const position = mesh.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  const out: number[] = [];
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position as THREE.BufferAttribute, i);
    mesh.applyBoneTransform(i, v);
    out.push(v.x, v.y, v.z);
  }
  return out;
}

/** Bend the head bone, so the comparison is against a POSED rig, not the rest one
 *  where a broken bind would still look correct. */
function pose(root: THREE.Object3D, angle: number): void {
  const head = root.getObjectByName('mixamorigHead');
  if (!head) throw new Error('rig is missing mixamorigHead');
  head.rotation.set(angle, angle * 0.5, 0);
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) sm.skeleton.update();
  });
}

describe('mesh graft', () => {
  it('skins a grafted mesh identically to the rig it came from', () => {
    const source = makeRig();
    const target = makeRig();
    // Nothing of the source's own is reused: the target keeps its own bones.
    const { grafted, skipped } = graftSkinnedNodes(target.root, source.root, ['Head']);

    expect(skipped).toEqual([]);
    expect(grafted).toHaveLength(1);
    expect(grafted[0].skeleton.bones.map((b) => b.name)).toEqual([
      'mixamorigNeck',
      'mixamorigHead',
    ]);
    // The grafted mesh rides the TARGET's bones, not the source's.
    const targetHeadBone = target.root.getObjectByName('mixamorigHead');
    expect(grafted[0].skeleton.bones[1]).toBe(targetHeadBone);
    expect(grafted[0].skeleton.bones[1]).not.toBe(source.root.getObjectByName('mixamorigHead'));

    // Pose the two rigs DIFFERENTLY first. A graft that quietly kept the source's
    // bones would still match when both are posed alike, so drive them apart and
    // require the grafted head to follow the TARGET.
    pose(source.root, 0);
    pose(target.root, 0.6);
    const rest = [0, 1.2, 0, 0.3, 1.5, 0, -0.3, 1.5, 0.2];
    const followsTarget = skinnedVertices(grafted[0]);
    expect(followsTarget.some((v, i) => Math.abs(v - rest[i]) > 0.05)).toBe(true);
    expect(followsTarget).not.toEqual(skinnedVertices(source.mesh));

    // Now bring the source to the same pose: the graft must reproduce it exactly.
    pose(source.root, 0.6);
    const expected = skinnedVertices(source.mesh);
    const actual = skinnedVertices(grafted[0]);

    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
  });

  it('refuses a mesh whose bones the target rig does not have', () => {
    const source = makeRig();
    const target = makeRig();
    const head = target.root.getObjectByName('mixamorigHead');
    if (head) head.name = 'someOtherRigHead';

    const { grafted, skipped } = graftSkinnedNodes(target.root, source.root, ['Head']);

    expect(grafted).toEqual([]);
    expect(skipped).toEqual([{ name: 'Head', reason: 'target rig is missing one of its bones' }]);
  });

  it('reports a name that is absent or is not skinned, instead of throwing', () => {
    const source = makeRig();
    const plain = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    plain.name = 'Head_Prop';
    source.root.add(plain);

    const { grafted, skipped } = graftSkinnedNodes(makeRig().root, source.root, [
      'Head_Missing',
      'Head_Prop',
    ]);

    expect(grafted).toEqual([]);
    expect(skipped).toEqual([
      { name: 'Head_Missing', reason: 'not in the source GLB' },
      { name: 'Head_Prop', reason: 'not a skinned mesh' },
    ]);
  });

  it('shares one retargeted skeleton across meshes that rode the same source one', () => {
    const source = makeRig();
    const second = new THREE.SkinnedMesh(source.mesh.geometry, source.mesh.material);
    second.name = 'Head_Hair';
    source.root.add(second);
    source.root.updateMatrixWorld(true);
    second.bind(source.mesh.skeleton, source.mesh.bindMatrix);

    const { grafted } = graftSkinnedNodes(makeRig().root, source.root, ['Head', 'Head_Hair']);

    expect(grafted).toHaveLength(2);
    // Eleven head variants must not cost eleven bone textures.
    expect(grafted[0].skeleton).toBe(grafted[1].skeleton);
  });

  it('retargetBones keeps the source order and rejects an incomplete target', () => {
    const source = makeRig();
    const target = makeRig();

    const ok = retargetBones(source.mesh.skeleton, bonesByName(target.root));
    expect(ok?.map((b) => b.name)).toEqual(['mixamorigNeck', 'mixamorigHead']);

    const partial = bonesByName(target.root);
    partial.delete('mixamorigNeck');
    expect(retargetBones(source.mesh.skeleton, partial)).toBeNull();
  });
});

describe('level-20 armored bodies', () => {
  // Six classes wear a mask or an open hat and must show the character's own head;
  // three wear a helm that encloses the skull, where drawing it is pure waste.
  const OPEN_HELM = ['hunter', 'rogue', 'priest', 'mage', 'warlock', 'druid'];
  const CLOSED_HELM = ['warrior', 'paladin', 'shaman'];
  it('covers every class that ships an armored body', () => {
    const armored = ALL_CLASSES.filter((cls) => hasArmoredBody(cls));
    expect([...armored].sort()).toEqual([...OPEN_HELM, ...CLOSED_HELM].sort());
  });

  it.each(OPEN_HELM)('%s grafts its class body head in under the mask or hat', (cls) => {
    const def = VISUALS[`player_${cls}_armored`];
    const base = VISUALS[`player_${cls}`];

    expect(def.graftUrl).toBe(base.url);
    // The head is only useful if the cosmetics descriptor survives to toggle and
    // tint it, and the picker names those meshes.
    expect(def.cosmetics).toBe(base.cosmetics);
    expect(def.cosmetics?.faces.length).toBeGreaterThan(0);
    // A body chroma must reach the plates only, never the grafted head's atlas.
    expect(def.skinMeshNames).toContain('Armor_Torso');
    expect(def.skinMeshNames?.some((n) => n.startsWith('Head'))).toBe(false);
  });

  it.each(CLOSED_HELM)('%s wears an enclosing helm and grafts no head', (cls) => {
    const def = VISUALS[`player_${cls}_armored`];

    expect(def.graftUrl).toBeUndefined();
    expect(def.cosmetics).toBeUndefined();
  });

  it('preloads every graft source with the rest of the manifest', async () => {
    const { manifestUrls } = await import('../src/render/characters/manifest');
    const urls = new Set(manifestUrls());

    for (const cls of OPEN_HELM) {
      const def = VISUALS[`player_${cls}_armored`];
      // An unpreloaded graft source throws "character asset not preloaded" the
      // first time someone equips the set.
      expect(urls.has(def.graftUrl as string)).toBe(true);
    }
  });
});
