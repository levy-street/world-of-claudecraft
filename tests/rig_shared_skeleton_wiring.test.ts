// The shared-skeleton rebind is only worth anything where it is CALLED, and
// three of its four call sites are invisible to a unit test of the module: the
// cached variant, the clone every compose makes (SkeletonUtils re-splits what
// the variant unified), the per-URL fixed rig, and its clone. These tests drive
// the real assemble pipeline against a stub GLTF so deleting any of them reds.
//
// The stub is a real skinned rig with the property the shipped GLBs have: every
// part carries its OWN inverse bind matrices, differing from a canonical part's
// by one constant transform (the per-primitive dequantization the quantization
// pipeline bakes in). Without that there is nothing to rebind.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISUALS, type VisualDef } from '../src/render/characters/manifest';
import {
  DEFAULT_APPEARANCE,
  MODULAR_WARRIOR_KEY,
  type ModularLook,
} from '../src/render/characters/modular';

type AssetsModule = typeof import('../src/render/characters/assets');

/** Two bones in a small hierarchy, posed away from rest. */
function makeBones(): THREE.Bone[] {
  const root = new THREE.Bone();
  root.name = 'StubRoot';
  const child = new THREE.Bone();
  child.name = 'StubSpine';
  root.add(child);
  child.position.set(0, 1, 0);
  root.position.set(0.3, 0.1, -0.2);
  root.rotation.set(0.2, 0.4, -0.1);
  child.rotation.set(-0.3, 0.15, 0.25);
  root.updateMatrixWorld(true);
  return [root, child];
}

function partGeometry(part: string, z: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0.2, 0.6, z, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7], 3),
  );
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
  // The marker the assertions read: `rebakeGeometry` mints a FRESH
  // BufferGeometry and carries no userData, so a part still holding this tag is
  // a part the rebind left alone.
  geo.userData.stubPart = part;
  return geo;
}

/** A parsed scene shaped like the shipped rigs: one skin per part, each with its
 *  own dequantization baked into its inverse bind matrices. Part order matters:
 *  the head is deliberately NOT first, so a rebind that ignores
 *  `preferCanonical` rebakes it. */
function stubScene(): THREE.Group {
  const scene = new THREE.Group();
  const bones = makeBones();
  scene.add(bones[0]);
  const canon = bones.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert());
  const skin = new THREE.MeshStandardMaterial({ name: 'mod_skin' });
  const detail = new THREE.MeshStandardMaterial({ name: 'mod_skin_detail' });
  const parts: [string, THREE.Material][] = [
    ['M_Ear_round', skin],
    ['M_Head', skin],
    ['M_Torso', detail],
    ['M_ArmL', detail],
    ['M_ArmR', detail],
  ];
  parts.forEach(([name, material], i) => {
    const t = new THREE.Matrix4()
      .makeScale(0.4 + i * 0.09, 0.5 + i * 0.07, 0.6)
      .setPosition(i * 0.11, -0.03 * i, 0.07);
    const mesh = new THREE.SkinnedMesh(partGeometry(name, -0.05 * i), material);
    mesh.name = name;
    mesh.bind(
      new THREE.Skeleton(
        bones,
        canon.map((m) => new THREE.Matrix4().copy(m).multiply(t)),
      ),
      new THREE.Matrix4(),
    );
    scene.add(mesh);
  });
  scene.updateMatrixWorld(true);
  return scene;
}

const skeletonsOf = (root: THREE.Object3D): Set<THREE.Skeleton> => {
  const out = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && sm.skeleton) out.add(sm.skeleton);
  });
  return out;
};

function meshNamed(root: THREE.Object3D, name: string): THREE.SkinnedMesh {
  const hit = root.getObjectByName(name) as THREE.SkinnedMesh | undefined;
  if (!hit) throw new Error(`no mesh named ${name} in the composed root`);
  return hit;
}

function skinnedNames(root: THREE.Object3D): string[] {
  const out: string[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o.name);
  });
  return out;
}

/** A bare-body look: KNIGHT_FULL's closed helm drops the ears, and the ear is
 *  what puts a NON-head part first in traversal order. */
const BARE: ModularLook = { app: DEFAULT_APPEARANCE, worn: {} };

describe('the shared-skeleton rebind is wired into every assemble path', () => {
  let assets: AssetsModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve({ scene: stubScene(), animations: [] })),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    }));
    assets = (await import('../src/render/characters/assets')) as AssetsModule;
    await assets.charactersReady();
  });

  afterEach(() => {
    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });

  it('leaves a composed body with ONE skeleton, on the clone every compose makes', () => {
    // SkeletonUtils.clone gives EVERY SkinnedMesh a Skeleton of its own, so the
    // cached variant being unified proves nothing about what a character draws.
    const def = VISUALS[MODULAR_WARRIOR_KEY];
    const root = assets.assembleModular(def, BARE, null, null, { skipDecals: true });

    expect(skeletonsOf(root).size).toBe(1);
    // ...and it really is a multi-part body, or one skeleton is trivially true
    expect(skinnedNames(root).length).toBeGreaterThan(1);
  }, 20000);

  it('never rebakes the composed head, whichever part comes first', () => {
    // The head's buffer is the identity the stubble and makeup decal cuts are
    // cached on (modularHeadFor), so it is the one part the rebind must adopt as
    // its canonical bind space rather than pre-transform. The ear precedes it in
    // the stub, so dropping `preferCanonical: isComposedHead` rebakes the head.
    const def = VISUALS[MODULAR_WARRIOR_KEY];
    const root = assets.assembleModular(def, BARE, null, null, { skipDecals: true });

    const head = meshNamed(root, 'M_Head');
    expect(head.geometry.userData.stubPart).toBe('M_Head');
    // the parts around it DID pay the rebake, so the marker means something
    const ear = meshNamed(root, 'M_Ear_round');
    expect(ear.geometry.userData.stubPart).toBeUndefined();
  }, 20000);

  it('shares the head buffer across two composes of one part set', () => {
    const def = VISUALS[MODULAR_WARRIOR_KEY];
    const first = assets.assembleModular(def, BARE, null, null, { skipDecals: true });
    const second = assets.assembleModular(def, BARE, null, null, { skipDecals: true });

    expect(meshNamed(second, 'M_Head').geometry).toBe(meshNamed(first, 'M_Head').geometry);
    expect(skeletonsOf(first).size).toBe(1);
    expect(skeletonsOf(second).size).toBe(1);
    // ...and the two bodies do NOT share a skeleton: each clone owns its own,
    // which is what CharacterVisual.dispose frees.
    expect([...skeletonsOf(second)][0]).not.toBe([...skeletonsOf(first)][0]);
  }, 20000);

  it('keeps the head and the mouth off the parts they share a material with', () => {
    // The merge partition, seen through the pipeline rather than through a
    // source grep: `mod_skin` is on the head AND the ear, and they must not
    // fold into one mesh with one name; the three `mod_skin_detail` body parts
    // must.
    const def = VISUALS[MODULAR_WARRIOR_KEY];
    const root = assets.assembleModular(def, BARE, null, null, { skipDecals: true });

    const names = skinnedNames(root);
    expect(names).toContain('M_Head');
    expect(names).toContain('M_Ear_round');
    expect(names.filter((n) => n.endsWith('_bodymerged'))).toHaveLength(1);
    expect(names).not.toContain('M_Torso');
    expect(names).not.toContain('M_ArmL');
  }, 20000);

  it('leaves a FIXED rig with one skeleton, and rebakes it once per asset', () => {
    // The fixed arm has its own two call sites: the per-URL optimized scene and
    // the clone assembleModel returns. Deleting the clone-side call re-splits
    // the skeletons; deleting the per-URL one moves the rebake into every
    // clone, so two bodies stop sharing the buffer.
    const fixed = Object.values(VISUALS).find(
      (d) => !d.modular && d.url.startsWith('models/chars/players/'),
    ) as VisualDef;
    expect(fixed).toBeDefined();

    const first = assets.assembleModel(fixed);
    const second = assets.assembleModel(fixed);

    expect(skeletonsOf(first).size).toBe(1);
    const names = skinnedNames(first);
    expect(names.length).toBeGreaterThan(1);
    // The LAST part, never the first: the first IS the canonical bind space, so
    // it is not rebaked whichever call site did the work, and asserting on it
    // would prove nothing about where that work happened.
    const rebaked = names[names.length - 1];
    expect(meshNamed(second, rebaked).geometry).toBe(meshNamed(first, rebaked).geometry);
  }, 20000);
});
