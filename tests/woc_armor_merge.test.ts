// The three.js half of the merged WOC armor (src/render/characters/woc_armor_merge.ts) on
// real three objects, no WebGL: the fold itself (every part's vertices baked into the
// body's one bind so the merged mesh skins each exactly where its part draws it, under
// any pose: a part the real attach produced, a part on another skeleton with other
// inverses and another bind matrix, and a rigid part on its bone, mirrored), the plan
// (which drawn parts fold, and every case that keeps drawing by itself), the leased
// geometry cache (one buffer per kit, idle ones kept and capped), and one character's
// stand-in through the real attach (woc_armor_packs.ts): mounted hidden when its owner
// asks, standing in for its parts only once its reveal settled, parked under a blended
// effect overlay, and taken down with every part drawing again exactly as before. Only
// the loader is stubbed.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({ pending: new Map<string, (gltf: unknown) => void>() }));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(
    (url: string) =>
      new Promise((resolve) => {
        loads.pending.set(url, resolve);
      }),
  ),
  releaseGltf: vi.fn(),
}));

import { setBuildSpanSink } from '../src/render/build_spans';
import {
  hangWocRigidArmor,
  instantiateWocArmor,
  prepareWocArmor,
  wocRigBindOf,
  wocRigSkeletonOf,
} from '../src/render/characters/woc_armor_bind';
import { wocArmorPackUrl } from '../src/render/characters/woc_armor_core';
import {
  clearIdleWocArmorMerges,
  mergeWocArmorGeometry,
  planWocArmorMerge,
  retainWocArmorMerge,
  WOC_ARMOR_MERGED_KEY,
  WOC_ARMOR_MERGED_NAME,
  type WocArmorMergeBind,
  type WocArmorMergeCandidate,
  type WocArmorMergeHost,
  type WocArmorMergePart,
  type WocArmorMergePlan,
  WocArmorMergeRig,
  wocArmorDrawnParts,
  wocArmorMergeBindOf,
  wocArmorMergeBuilt,
  wocArmorMergeInternalsForTest,
} from '../src/render/characters/woc_armor_merge';
import {
  attachWocArmorPack,
  ensureWocArmorPack,
  releaseWocArmorContainer,
  wocArmorFileMaterial,
  wocArmorPackResident,
  wocArmorPieces,
} from '../src/render/characters/woc_armor_packs';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';

/** woc_armor_merge.ts MAX_IDLE_MERGES (not exported): the idle merged kits the cache
 *  keeps. Re-pin it here when that cap moves. */
const MAX_IDLE = 16;
/** The clock the build span and the armor store read. */
let now = 1000;

beforeEach(() => {
  wocArmorMergeInternalsForTest.reset();
  now += 100_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  setBuildSpanSink(null);
  vi.restoreAllMocks();
  wocArmorMergeInternalsForTest.reset();
});

// ---------------------------------------------------------------------------
// The fixture: a body on a small rig, and an armor file on its own copy of it
// ---------------------------------------------------------------------------

const BONES = ['root', 'spine', 'chest', 'head', 'shoulder'] as const;
type BoneName = (typeof BONES)[number];

/** root > spine > chest > head, and a shoulder off the chest, every bone with a rest
 *  offset and a rest rotation of its own. */
function boneTree(): { top: THREE.Bone; bones: Record<BoneName, THREE.Bone> } {
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONES) {
    bones[name] = new THREE.Bone();
    bones[name].name = name;
  }
  bones.root.add(bones.spine);
  bones.spine.add(bones.chest);
  bones.chest.add(bones.head, bones.shoulder);
  bones.root.position.set(0.02, 0.9, -0.03);
  bones.root.rotation.set(0.1, -0.2, 0.05);
  bones.spine.position.set(0, 0.25, 0.02);
  bones.spine.rotation.set(-0.15, 0.1, 0.2);
  bones.chest.position.set(0.01, 0.3, 0);
  bones.chest.rotation.set(0.2, 0.3, -0.1);
  bones.head.position.set(0, 0.35, 0.05);
  bones.head.rotation.set(-0.1, 0.4, 0.15);
  bones.shoulder.position.set(0.22, 0.2, -0.02);
  bones.shoulder.rotation.set(0.3, -0.25, 0.6);
  return { top: bones.root, bones };
}

const mat = (name: string): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial();
  m.name = name;
  return m;
};

/** A skinned part: a subdivided box at `at`, every vertex blended over two joint slots
 *  by where it sits. */
function skinnedBox(at: [number, number, number], slots: [number, number]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.2, 0.3, 0.16, 2, 3, 2);
  g.translate(...at);
  const pos = g.getAttribute('position');
  const joints = new Uint16Array(pos.count * 4);
  const weights = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const w = 0.5 + 0.5 * Math.sin(pos.getY(i) * 7 + pos.getX(i) * 3);
    joints[i * 4] = slots[0];
    joints[i * 4 + 1] = slots[1];
    weights[i * 4] = w;
    weights[i * 4 + 1] = 1 - w;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
  return g;
}

/** A geometry's attributes as a shipped rigid part carries them: normalized integers. */
function quantized(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pack = (
    name: string,
    out: Int16Array | Int8Array | Uint16Array,
    max: number,
    itemSize: number,
  ): void => {
    const src = g.getAttribute(name).array;
    for (let i = 0; i < out.length; i++) out[i] = Math.round(src[i] * max);
    g.setAttribute(name, new THREE.BufferAttribute(out, itemSize, true));
  };
  const count = g.getAttribute('position').count;
  pack('position', new Int16Array(count * 3), 32767, 3);
  pack('normal', new Int8Array(count * 3), 127, 3);
  pack('uv', new Uint16Array(count * 2), 65535, 2);
  return g;
}

/** The base's own quantization (a base file's vertices are quantized, and its inverse
 *  bind matrices carry the way back): a different size on every axis on purpose, so
 *  nothing in the fold can lean on the bind being a plain scale. */
const BASE_DEQUANT = new THREE.Matrix4()
  .makeTranslation(0.03, -0.4, 0.02)
  .multiply(new THREE.Matrix4().makeScale(1.6, 2.1, 1.3));

interface Body {
  model: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  skeleton: THREE.Skeleton;
}

/** The character: a body skinned to the rig, bound the way GLTFLoader binds (an
 *  identity bind matrix, the quantization in the inverses). */
function body(): Body {
  const model = new THREE.Group();
  const { top, bones } = boneTree();
  model.add(top);
  model.updateMatrixWorld(true);
  const list = BONES.map((name) => bones[name]);
  const inverses = list.map((bone) =>
    new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(BASE_DEQUANT),
  );
  const skeleton = new THREE.Skeleton(list, inverses);
  const mesh = new THREE.SkinnedMesh(
    skinnedBox([0, 1.2, 0], [1, 2]).applyMatrix4(new THREE.Matrix4().copy(BASE_DEQUANT).invert()),
    mat('body'),
  );
  mesh.name = 'Character_Body';
  model.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());
  return { model, bones, skeleton };
}

/** The file's bone order (never the base's) and its own quantization, folded into its
 *  inverse bind matrices the way gltf-transform writes a split file. */
const FILE_ORDER: readonly BoneName[] = ['head', 'root', 'shoulder', 'spine', 'chest'];
const FILE_DEQUANT = new THREE.Matrix4()
  .makeTranslation(0.05, -0.1, 0.02)
  .multiply(new THREE.Matrix4().makeScale(2, 2, 2));

interface ArmorFixture {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  atlas: THREE.Material;
  leather: THREE.Material;
  helm: THREE.Material;
}

/**
 * One armor file: a chest and a waist skinned on the set's atlas, boots skinned on a
 * material of their own, two shoulder pads hung rigid on the shoulder bone over ONE
 * geometry (the left one its mirror) on the atlas, and a helm rigid on the head bone on
 * its own material. Four parts share the atlas: one merged draw; the boots and the helm
 * are batches of one (or, `helmOnLeather`, a second batch of two on the boots' material).
 */
function armorFile(helmOnLeather = false): ArmorFixture {
  const scene = new THREE.Group();
  const { top, bones } = boneTree();
  scene.add(top);
  scene.updateMatrixWorld(true);
  const order = FILE_ORDER.map((name) => bones[name]);
  const inverses = order.map((bone) =>
    new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(FILE_DEQUANT),
  );
  const skin = new THREE.Skeleton(order, inverses);
  const quantize = new THREE.Matrix4().copy(FILE_DEQUANT).invert();
  const atlas = mat('atlas');
  const leather = mat('leather');
  const helm = mat('helm');
  const skinned = (
    name: string,
    at: [number, number, number],
    slots: [number, number],
    material: THREE.Material,
  ): void => {
    const part = new THREE.SkinnedMesh(skinnedBox(at, slots).applyMatrix4(quantize), material);
    part.name = name;
    scene.add(part);
    part.bind(skin, new THREE.Matrix4());
  };
  // slots address FILE_ORDER: chest 4, spine 3, root 1
  skinned('Armor_Test_Chest', [0, 1.5, 0], [4, 3], atlas);
  skinned('Armor_Test_Waist', [0, 1.1, 0.02], [3, 1], atlas);
  skinned('Armor_Test_Boots', [0, 0.2, 0], [1, 3], leather);
  const padGeometry = quantized(new THREE.BoxGeometry(1, 0.6, 0.8, 2, 2, 2));
  const pad = (name: string, side: 1 | -1): void => {
    const mesh = new THREE.Mesh(padGeometry, atlas);
    mesh.name = name;
    mesh.position.set(side * 0.06, 0.05, -0.01);
    mesh.rotation.set(0.2, side * 0.4, -0.3);
    // the node's scale is the pack's dequantization, and the left pad's mirrors it
    mesh.scale.set(side * 0.12, 0.1, 0.14);
    bones.shoulder.add(mesh);
  };
  pad('Armor_Test_Shoulder_L', -1);
  pad('Armor_Test_Shoulder_R', 1);
  const helmet = new THREE.Mesh(
    quantized(new THREE.BoxGeometry(1, 1, 1)),
    helmOnLeather ? leather : helm,
  );
  helmet.name = 'Armor_Test_Helm';
  helmet.position.set(0, 0.12, 0.01);
  helmet.scale.setScalar(0.11);
  bones.head.add(helmet);
  return { scene, animations: [], atlas, leather, helm };
}

/** Pose the rig away from rest: every bone turned, the shoulder moved, the root bone
 *  and the model itself turned, moved and (uniformly) scaled. */
function pose(b: Body, k: number): void {
  b.model.position.set(3 * k, 0.5, -2);
  b.model.rotation.set(0.1 * k, 1.1, -0.05);
  b.model.scale.setScalar(0.8 + 0.3 * k);
  b.bones.root.rotation.set(0.2 * k, 0.5, -0.1);
  b.bones.root.scale.setScalar(1.15);
  b.bones.spine.rotation.set(0.4, 0.2 * k, -0.3);
  b.bones.chest.rotation.set(-0.3, 0.6, 0.2 * k);
  b.bones.head.rotation.set(-0.2 * k, 0.7, 0.1);
  b.bones.shoulder.rotation.set(0.5, -0.4 * k, 0.9);
  b.bones.shoulder.position.set(0.25, 0.22, -0.05 * k);
  b.model.updateMatrixWorld(true);
}

/** Where a mesh draws vertex `i`: skinned as three's skinning chunk skins it (its own
 *  bind matrix, its skeleton's inverses, the live bones), or a rigid mesh's stored
 *  vertex, then its world matrix. */
function drawnPosition(mesh: THREE.Mesh, i: number): THREE.Vector3 {
  return mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
}

/** The direction a mesh draws a per-vertex direction in: three skins a normal (and a
 *  tangent) by the skin matrix itself, as a direction, and then takes a normal through
 *  the inverse transpose of the mesh's world matrix and a tangent through the matrix. */
function drawnDirection(mesh: THREE.Mesh, attribute: string, i: number): THREE.Vector3 {
  const d = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute(attribute), i);
  const skinned = mesh as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh) {
    const v = skinned.applyBoneTransform(i, new THREE.Vector4(d.x, d.y, d.z, 0));
    d.set(v.x, v.y, v.z);
  }
  const world =
    attribute === 'normal'
      ? new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
      : new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld);
  return d.applyMatrix3(world).normalize();
}

/** Which way each triangle of a mesh faces as drawn, against the normal it is drawn
 *  with: 1 when the stored winding and the normals agree, -1 when the mesh is drawn
 *  mirrored (three flips the front face for such a mesh). */
function facing(mesh: THREE.Mesh): number[] {
  const index = mesh.geometry.index;
  if (!index) throw new Error('no index');
  const out: number[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const [a, c, d] = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    const pa = drawnPosition(mesh, a);
    const face = drawnPosition(mesh, c).sub(pa).cross(drawnPosition(mesh, d).sub(pa));
    out.push(Math.sign(face.dot(drawnDirection(mesh, 'normal', a))));
  }
  return out;
}

/** A merged mesh over a plan's first batch, bound as the rig binds one. */
function mergedMesh(b: Body, bind: WocArmorMergeBind, plan: WocArmorMergePlan): THREE.SkinnedMesh {
  const batch = plan.batches[0];
  const merged = new THREE.SkinnedMesh(
    mergeWocArmorGeometry(batch.parts, bind.skeleton.bones.length),
    batch.material,
  );
  merged.bind(bind.skeleton, bind.bindMatrix);
  b.model.add(merged);
  return merged;
}

/** Assert the merged mesh draws every vertex of every folded part where the part does. */
function expectSameDraw(merged: THREE.SkinnedMesh, sources: readonly THREE.Mesh[]): void {
  let at = 0;
  for (const source of sources) {
    const count = source.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      const where = `${source.name} vertex ${i}`;
      expect(
        drawnPosition(merged, at + i).distanceTo(drawnPosition(source, i)),
        where,
      ).toBeLessThan(1e-5);
      expect(
        drawnDirection(merged, 'normal', at + i).distanceTo(drawnDirection(source, 'normal', i)),
        `${where} normal`,
      ).toBeLessThan(1e-5);
    }
    at += count;
  }
  expect(merged.geometry.getAttribute('position').count).toBe(at);
}

/**
 * Assert the merged mesh draws every triangle of every folded part, in order: each
 * part's own triangles offset to where its vertices landed, a flipped part's with its
 * winding turned, and nothing more.
 */
function expectSameTriangles(
  merged: THREE.Mesh,
  parts: readonly { mesh: THREE.Mesh; flip: boolean }[],
): void {
  const index = merged.geometry.index;
  if (!index) throw new Error('no index');
  const want: number[] = [];
  let at = 0;
  for (const { mesh, flip } of parts) {
    const own = mesh.geometry.index;
    const count = mesh.geometry.getAttribute('position').count;
    for (let k = 0; k < (own ? own.count : count); k += 3) {
      const [a, c, d] = own ? [own.getX(k), own.getX(k + 1), own.getX(k + 2)] : [k, k + 1, k + 2];
      want.push(at + a, at + (flip ? d : c), at + (flip ? c : d));
    }
    at += count;
  }
  expect(index.count).toBe(want.length);
  expect([...index.array]).toEqual(want);
}

/** The body's bind, or a failed test. */
function bindOf(b: Body): WocArmorMergeBind {
  const bind = wocArmorMergeBindOf(b.model);
  if (!bind) throw new Error('no rig');
  return bind;
}

/**
 * The parts of a file bound onto a body exactly as the armor store binds them
 * (woc_armor_bind.ts: prepared against the body's bind, instantiated on its skeleton,
 * the rigid ones hung on its bones), every part shown.
 */
function bound(b: Body, file: ArmorFixture): Map<string, WocArmorMergeCandidate> {
  const rig = wocRigBindOf(b.model);
  const skeleton = wocRigSkeletonOf(b.model);
  if (!rig || !skeleton) throw new Error('no rig');
  const prepared = prepareWocArmor(file.scene, rig, (mesh) => `node:${mesh.name}`);
  expect(prepared.refused).toEqual([]);
  const out = new Map<string, WocArmorMergeCandidate>();
  const container = new THREE.Group();
  b.model.add(container);
  for (const mesh of instantiateWocArmor(prepared.templates, skeleton, rig.bindMatrix)) {
    container.add(mesh);
    out.set(mesh.name, { mesh, material: mesh.material as THREE.Material, root: container });
  }
  for (const wrapper of hangWocRigidArmor(prepared.rigid, b.model)) {
    wrapper.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh)
        out.set(mesh.name, { mesh, material: mesh.material as THREE.Material, root: wrapper });
    });
  }
  return out;
}

const pick = (
  parts: Map<string, WocArmorMergeCandidate>,
  ...names: string[]
): WocArmorMergeCandidate[] =>
  names.map((name) => {
    const part = parts.get(name);
    if (!part) throw new Error(`no part ${name}`);
    return part;
  });

/** A skinned part the attach did NOT produce: its own Skeleton over the body's bones
 *  in another order (and a bone the body's skeleton does not drive, which only
 *  weightless slots name), its own quantization folded into its inverses (a different
 *  size on every axis), and a bind matrix that is no identity. */
const FOREIGN_DEQUANT = new THREE.Matrix4()
  .makeTranslation(0.04, -0.02, 0.07)
  .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, -0.2, 0.5)))
  .multiply(new THREE.Matrix4().makeScale(1.4, 0.7, 2.2));
const FOREIGN_BIND = new THREE.Matrix4()
  .makeTranslation(-0.1, 0.2, 0.05)
  .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.4, 0.1, 0.2)))
  .multiply(new THREE.Matrix4().makeScale(0.9, 1.2, 1.1));

function foreignPart(
  b: Body,
  material: THREE.Material,
  inverseOf: (bone: THREE.Bone, slot: number) => THREE.Matrix4 = (bone) =>
    b.skeleton.boneInverses[b.skeleton.bones.indexOf(bone)].clone().multiply(FOREIGN_DEQUANT),
): WocArmorMergeCandidate {
  const stray = new THREE.Bone();
  stray.name = 'stray';
  b.bones.root.add(stray);
  const order = [b.bones.chest, stray, b.bones.head, b.bones.root];
  const inverses = order.map((bone, slot) =>
    bone === stray ? new THREE.Matrix4().makeScale(3, 3, 3) : inverseOf(bone, slot),
  );
  // chest (its slot 0) and head (its slot 2); every vertex's third slot names the stray
  // bone at no weight
  const geometry = skinnedBox([0.05, 1.5, 0.02], [0, 2]);
  const joints = geometry.getAttribute('skinIndex');
  for (let i = 0; i < joints.count; i++) joints.setZ(i, 1);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'Armor_Test_Foreign';
  const root = new THREE.Group();
  b.model.add(root);
  root.add(mesh);
  mesh.bind(new THREE.Skeleton(order, inverses), FOREIGN_BIND);
  return { mesh, material, root };
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

describe('the fold: every part baked into the one bind', () => {
  it('skins each vertex exactly where its part draws it, under any pose', () => {
    const b = body();
    const file = armorFile();
    const parts = bound(b, file);
    const drawn = [
      ...pick(parts, 'Armor_Test_Chest', 'Armor_Test_Shoulder_L'),
      foreignPart(b, file.atlas),
      ...pick(parts, 'Armor_Test_Shoulder_R', 'Armor_Test_Waist'),
    ];
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    // two parts the real attach bound, one on another skeleton with other inverses and
    // another bind matrix, and two rigid pads on a bone: ONE draw
    expect(plan?.batches).toHaveLength(1);
    expect(plan?.sources).toEqual(drawn.map((c) => c.mesh));
    if (!plan) throw new Error('no plan');
    const merged = mergedMesh(b, bind, plan);
    for (const k of [1, 2]) {
      pose(b, k);
      expectSameDraw(merged, plan.sources);
    }
    // five parts in one buffer: every one keeps its own triangles, the mirrored pad's
    // turned, none written over another's
    expect(plan.batches[0].parts.map((p) => p.flip)).toEqual([false, true, false, false, false]);
    expectSameTriangles(merged, plan.batches[0].parts);
  });

  it('copies a part the real attach bound as stored, bit for bit: it already is in the bind', () => {
    const b = body();
    const parts = bound(b, armorFile());
    const drawn = pick(parts, 'Armor_Test_Chest', 'Armor_Test_Waist');
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    if (!plan) throw new Error('no plan');
    // the attach put every part on the body's own Skeleton, with its bind matrix
    for (const c of drawn) {
      expect((c.mesh as THREE.SkinnedMesh).skeleton).toBe(bind.skeleton);
      expect((c.mesh as THREE.SkinnedMesh).bindMatrix.equals(bind.bindMatrix)).toBe(true);
    }
    for (const part of plan.batches[0].parts) {
      expect(part.toBind).toBeNull();
      expect(part.normalToBind).toBeNull();
      expect(part.joints).toBeNull();
      expect(part.bone).toBeNull();
      expect(part.flip).toBe(false);
    }
    const merged = mergeWocArmorGeometry(plan.batches[0].parts, bind.skeleton.bones.length);
    let at = 0;
    for (const { mesh } of drawn) {
      const count = mesh.geometry.getAttribute('position').count;
      for (const [name, size] of [
        ['position', 3],
        ['normal', 3],
        ['uv', 2],
        ['skinIndex', 4],
        ['skinWeight', 4],
      ] as const) {
        const got = merged.getAttribute(name).array.subarray(at * size, (at + count) * size);
        expect([...got], `${mesh.name} ${name}`).toEqual([
          ...mesh.geometry.getAttribute(name).array,
        ]);
      }
      at += count;
    }
    // ...and its triangles follow, offset into the merged buffer
    const first = drawn[0].mesh.geometry;
    const firstIndex = first.index;
    if (!firstIndex || !merged.index) throw new Error('no index');
    expect([...merged.index.array.subarray(0, firstIndex.count)]).toEqual([...firstIndex.array]);
    const offset = first.getAttribute('position').count;
    const second = drawn[1].mesh.geometry.index;
    if (!second) throw new Error('no index');
    expect([...merged.index.array.subarray(firstIndex.count)]).toEqual(
      [...second.array].map((v) => v + offset),
    );
  });

  it('converts a part on another skeleton: its vertices through the one transform between the binds, its joints into the body order', () => {
    const b = body();
    const file = armorFile();
    const foreign = foreignPart(b, file.atlas);
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, [
      foreign,
      ...pick(bound(b, file), 'Armor_Test_Chest'),
    ]);
    const part = plan?.batches[0].parts[0];
    if (!plan || !part) throw new Error('no plan');
    expect(part.mesh).toBe(foreign.mesh);
    // p' = bind^-1 * T * bind_part * p, the body's bind matrix being the identity
    const expected = new THREE.Matrix4().copy(FOREIGN_DEQUANT).multiply(FOREIGN_BIND);
    expect(part.toBind).not.toBeNull();
    for (let i = 0; i < 16; i++) {
      expect(part.toBind?.elements[i], `element ${i}`).toBeCloseTo(expected.elements[i], 9);
    }
    // its bones are chest, (stray), head, root: the body's joints 2, 3 and 0, and the
    // weightless stray slot takes a joint that exists
    expect(part.joints).toEqual([2, 0, 3, 0]);
    const merged = mergeWocArmorGeometry(plan.batches[0].parts, bind.skeleton.bones.length);
    const joints = merged.getAttribute('skinIndex');
    const weights = merged.getAttribute('skinWeight');
    const own = foreign.mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < foreign.mesh.geometry.getAttribute('position').count; i++) {
      expect([joints.getX(i), joints.getY(i), joints.getZ(i), joints.getW(i)]).toEqual([
        2, 3, 0, 2,
      ]);
      expect([weights.getX(i), weights.getY(i), weights.getZ(i)]).toEqual([
        own.getX(i),
        own.getY(i),
        0,
      ]);
    }
  });

  it('weights a rigid part wholly to its bone, and flips the winding of a mirrored one', () => {
    const b = body();
    const parts = bound(b, armorFile());
    const drawn = pick(parts, 'Armor_Test_Shoulder_L', 'Armor_Test_Shoulder_R');
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    if (!plan) throw new Error('no plan');
    const shoulder = b.skeleton.bones.indexOf(b.bones.shoulder);
    expect(plan.batches[0].parts.map((p) => [p.bone, p.flip])).toEqual([
      [shoulder, true],
      [shoulder, false],
    ]);
    const merged = mergedMesh(b, bind, plan);
    const joints = merged.geometry.getAttribute('skinIndex');
    const weights = merged.geometry.getAttribute('skinWeight');
    for (let i = 0; i < joints.count; i++) {
      expect([joints.getX(i), joints.getY(i), joints.getZ(i), joints.getW(i)]).toEqual([
        shoulder,
        0,
        0,
        0,
      ]);
      expect([weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)]).toEqual([
        1, 0, 0, 0,
      ]);
    }
    pose(b, 1);
    expectSameDraw(merged, plan.sources);
    // every merged triangle faces the way its normals point (the merged mesh is not
    // mirrored), where the left pad's own triangles, as stored, face inward: three
    // flips the front face for a mirrored mesh, and the fold flips the winding instead
    const mergedFacing = facing(merged);
    expect(mergedFacing).toHaveLength(((drawn[0].mesh.geometry.index?.count ?? 0) * 2) / 3);
    expect(new Set(mergedFacing)).toEqual(new Set([1]));
    expect(new Set(facing(drawn[0].mesh))).toEqual(new Set([-1]));
    expect(new Set(facing(drawn[1].mesh))).toEqual(new Set([1]));
  });

  it('counts a mirror on the bone chain into a rigid part winding', () => {
    const b = body();
    const parts = bound(b, armorFile());
    // a rig whose shoulder bone is itself a mirror: one size on every axis, one negative
    b.bones.shoulder.scale.set(-1, 1, 1);
    const drawn = pick(parts, 'Armor_Test_Shoulder_L', 'Armor_Test_Shoulder_R');
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    if (!plan) throw new Error('no plan');
    // the left pad's own mirror and the bone's cancel; the right pad is mirrored by the
    // bone alone
    expect(plan.batches[0].parts.map((p) => p.flip)).toEqual([false, true]);
    const merged = mergedMesh(b, bind, plan);
    pose(b, 2);
    expectSameDraw(merged, plan.sources);
    expect(new Set(facing(merged))).toEqual(new Set([1]));
    expect(new Set(facing(drawn[0].mesh))).toEqual(new Set([1]));
    expect(new Set(facing(drawn[1].mesh))).toEqual(new Set([-1]));
  });

  it('reads a quantized part through its accessors and carries its uv as drawn', () => {
    const b = body();
    const parts = bound(b, armorFile());
    const drawn = pick(parts, 'Armor_Test_Chest', 'Armor_Test_Shoulder_R');
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    if (!plan) throw new Error('no plan');
    const merged = mergeWocArmorGeometry(plan.batches[0].parts, bind.skeleton.bones.length);
    const pad = drawn[1].mesh.geometry;
    // normalized integers, as a shipped rigid part stores them
    expect(pad.getAttribute('position').array).toBeInstanceOf(Int16Array);
    expect(pad.getAttribute('uv').array).toBeInstanceOf(Uint16Array);
    const at = drawn[0].mesh.geometry.getAttribute('position').count;
    const uv = merged.getAttribute('uv');
    expect(uv.array).toBeInstanceOf(Float32Array);
    for (let i = 0; i < pad.getAttribute('uv').count; i++) {
      expect(uv.getX(at + i)).toBeCloseTo(pad.getAttribute('uv').getX(i), 6);
      expect(uv.getY(at + i)).toBeCloseTo(pad.getAttribute('uv').getY(i), 6);
    }
    // plain float attributes, no morph targets: the program shape of a skinned part
    expect(Object.keys(merged.attributes).sort()).toEqual(
      ['normal', 'position', 'skinIndex', 'skinWeight', 'uv'].sort(),
    );
    expect(Object.keys(merged.morphAttributes)).toEqual([]);
    expect(merged.getAttribute('normal').normalized).toBe(false);
  });

  it('takes a tangent and a vertex colour through with their part', () => {
    const b = body();
    const file = armorFile();
    // every part of the batch carries both, as its layout demands
    const dress = (g: THREE.BufferGeometry): void => {
      const count = g.getAttribute('position').count;
      const tangent = new Float32Array(count * 4);
      const color = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const t = new THREE.Vector3(Math.sin(i), Math.cos(i * 2), Math.sin(i * 3 + 1)).normalize();
        tangent.set([t.x, t.y, t.z, i % 2 ? 1 : -1], i * 4);
        color.set([(i % 5) / 4, (i % 3) / 2, (i % 7) / 6], i * 3);
      }
      g.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
      g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    };
    file.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !mesh.geometry.getAttribute('tangent')) dress(mesh.geometry);
    });
    const parts = bound(b, file);
    const foreign = foreignPart(b, file.atlas);
    dress(foreign.mesh.geometry);
    const drawn = [...pick(parts, 'Armor_Test_Chest', 'Armor_Test_Shoulder_L'), foreign];
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    expect(plan?.batches[0].parts).toHaveLength(3);
    if (!plan) throw new Error('no plan');
    const merged = mergedMesh(b, bind, plan);
    pose(b, 2);
    let at = 0;
    for (const source of plan.sources) {
      const tangent = source.geometry.getAttribute('tangent');
      const color = source.geometry.getAttribute('color');
      for (let i = 0; i < tangent.count; i++) {
        const where = `${source.name} vertex ${i}`;
        expect(
          drawnDirection(merged, 'tangent', at + i).distanceTo(
            drawnDirection(source, 'tangent', i),
          ),
          where,
        ).toBeLessThan(1e-5);
        // the handedness and the colour ride through untouched
        expect(merged.geometry.getAttribute('tangent').getW(at + i)).toBe(tangent.getW(i));
        for (let c = 0; c < 3; c++) {
          expect(merged.geometry.getAttribute('color').getComponent(at + i, c)).toBe(
            color.getComponent(i, c),
          );
        }
      }
      at += tangent.count;
    }
    expectSameTriangles(merged, plan.batches[0].parts);
  });

  it('converts a part bound to the body skeleton through another bind matrix alone', () => {
    const b = body();
    const parts = bound(b, armorFile());
    const drawn = pick(parts, 'Armor_Test_Chest', 'Armor_Test_Waist');
    const chest = drawn[0].mesh as THREE.SkinnedMesh;
    // the same Skeleton and inverses, another bind matrix: it draws elsewhere, and the
    // merged mesh (bound with the body's own) must follow it there
    chest.bind(b.skeleton, FOREIGN_BIND);
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    if (!plan) throw new Error('no plan');
    const [first, second] = plan.batches[0].parts;
    expect(first.toBind).not.toBeNull();
    for (let i = 0; i < 16; i++) {
      expect(first.toBind?.elements[i]).toBeCloseTo(FOREIGN_BIND.elements[i], 12);
    }
    expect(first.joints).toBeNull();
    expect(second.toBind).toBeNull();
    const merged = mergedMesh(b, bind, plan);
    pose(b, 1);
    expectSameDraw(merged, plan.sources);
  });

  it('reads a rigid part through a frozen matrix, and an interleaved one through its accessors', () => {
    const b = body();
    const parts = bound(b, armorFile());
    const drawn = pick(parts, 'Armor_Test_Chest', 'Armor_Test_Shoulder_R', 'Armor_Test_Waist');
    // the pad's node no longer updates its matrix from position, quaternion and scale:
    // three draws it by the matrix as it stands, whatever those say since
    const pad = drawn[1].mesh;
    pad.updateMatrix();
    pad.matrixAutoUpdate = false;
    pad.position.set(9, 9, 9);
    pad.scale.setScalar(7);
    // the waist's floats interleaved in one buffer, as a loader may hand them over
    const waist = drawn[2].mesh.geometry;
    const count = waist.getAttribute('position').count;
    const packed = new Float32Array(count * 8);
    for (let i = 0; i < count; i++) {
      packed.set(
        [
          waist.getAttribute('position').getX(i),
          waist.getAttribute('position').getY(i),
          waist.getAttribute('position').getZ(i),
          waist.getAttribute('normal').getX(i),
          waist.getAttribute('normal').getY(i),
          waist.getAttribute('normal').getZ(i),
          waist.getAttribute('uv').getX(i),
          waist.getAttribute('uv').getY(i),
        ],
        i * 8,
      );
    }
    const buffer = new THREE.InterleavedBuffer(packed, 8);
    waist.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    waist.setAttribute('normal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    waist.setAttribute('uv', new THREE.InterleavedBufferAttribute(buffer, 2, 6));
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    expect(plan?.batches[0].parts).toHaveLength(3);
    if (!plan) throw new Error('no plan');
    const merged = mergedMesh(b, bind, plan);
    pose(b, 2);
    expectSameDraw(merged, plan.sources);
    expectSameTriangles(merged, plan.batches[0].parts);
    const uv = merged.geometry.getAttribute('uv');
    const at = uv.count - count;
    for (let i = 0; i < count; i++) {
      expect([uv.getX(at + i), uv.getY(at + i)]).toEqual([packed[i * 8 + 6], packed[i * 8 + 7]]);
    }
  });

  it('indexes a batch past 65535 vertices with 32 bits', () => {
    const big = (name: string, seed: number): WocArmorMergePart => {
      const count = 36_000;
      const position = new Float32Array(count * 3);
      for (let i = 0; i < position.length; i++) position[i] = Math.sin(i * 0.37 + seed);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(position, 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(count * 4), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
      const mesh = new THREE.SkinnedMesh(g, mat('big'));
      mesh.name = name;
      return { mesh, toBind: null, normalToBind: null, joints: null, bone: null, flip: false };
    };
    const one = mergeWocArmorGeometry([big('a', 0)], 5);
    expect(one.index?.array).toBeInstanceOf(Uint16Array);
    const parts = [big('a', 0), big('b', 1)];
    const merged = mergeWocArmorGeometry(parts, 5);
    expect(merged.getAttribute('position').count).toBe(72_000);
    expect(merged.index?.array).toBeInstanceOf(Uint32Array);
    expect(merged.index?.count).toBe(72_000);
    // the second part's triangles address its own vertices, past what 16 bits hold
    expect(merged.index?.getX(36_000)).toBe(36_000);
    expect(merged.index?.getX(71_999)).toBe(71_999);
    expect(merged.getAttribute('position').getX(36_000)).toBe(
      parts[1].mesh.geometry.getAttribute('position').getX(0),
    );
  });

  it('folds an unindexed part, sizes the joints for the skeleton, and bounds what it built', () => {
    const b = body();
    const parts = bound(b, armorFile());
    const drawn = pick(parts, 'Armor_Test_Chest', 'Armor_Test_Waist');
    const waist = drawn[1].mesh;
    waist.geometry = waist.geometry.toNonIndexed();
    const bind = bindOf(b);
    const plan = planWocArmorMerge(b.model, bind, drawn);
    if (!plan) throw new Error('no plan');
    const merged = mergedMesh(b, bind, plan);
    pose(b, 1);
    expectSameDraw(merged, plan.sources);
    const chest = drawn[0].mesh.geometry;
    const count = waist.geometry.getAttribute('position').count;
    expect(merged.geometry.index?.count).toBe((chest.index?.count ?? 0) + count);
    expect(merged.geometry.index?.array).toBeInstanceOf(Uint16Array);
    // a byte per joint while the skeleton fits one, as the parts' own attribute
    expect(merged.geometry.getAttribute('skinIndex').array).toBeInstanceOf(Uint8Array);
    const wide = mergeWocArmorGeometry(plan.batches[0].parts, 300);
    expect(wide.getAttribute('skinIndex').array).toBeInstanceOf(Uint16Array);
    // the bounds the host's cull sphere is centred on: around every folded vertex
    const sphere = merged.geometry.boundingSphere;
    const position = merged.geometry.getAttribute('position');
    if (!sphere) throw new Error('no bounds');
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i);
      expect(v.distanceTo(sphere.center)).toBeLessThanOrEqual(sphere.radius + 1e-6);
    }
    expect(merged.geometry.boundingBox?.isEmpty()).toBe(false);
  });

  it('does not depend on the pose it was planned in', () => {
    const b = body();
    const parts = bound(b, armorFile());
    const drawn = pick(parts, 'Armor_Test_Chest', 'Armor_Test_Shoulder_L', 'Armor_Test_Shoulder_R');
    const bind = bindOf(b);
    const rest = planWocArmorMerge(b.model, bind, drawn);
    pose(b, 2);
    const posed = planWocArmorMerge(b.model, bind, drawn);
    if (!rest || !posed) throw new Error('no plan');
    expect(posed.key).toBe(rest.key);
    const a = mergeWocArmorGeometry(rest.batches[0].parts, 5).getAttribute('position').array;
    const c = mergeWocArmorGeometry(posed.batches[0].parts, 5).getAttribute('position').array;
    expect([...c]).toEqual([...a]);
  });
});

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

describe('the plan: which drawn parts fold', () => {
  /** A body wearing the fixture file, and the plan for some of its parts. */
  function planned(
    names: string[],
    change?: (parts: Map<string, WocArmorMergeCandidate>, b: Body, file: ArmorFixture) => void,
    extra?: (b: Body, file: ArmorFixture) => WocArmorMergeCandidate[],
  ): { plan: WocArmorMergePlan | null; drawn: WocArmorMergeCandidate[] } {
    const b = body();
    const file = armorFile();
    const parts = bound(b, file);
    const more = extra?.(b, file) ?? [];
    change?.(parts, b, file);
    const drawn = [...pick(parts, ...names), ...more];
    return { plan: planWocArmorMerge(b.model, bindOf(b), drawn), drawn };
  }
  const folded = (plan: WocArmorMergePlan | null): string[][] =>
    (plan?.batches ?? []).map((batch) => batch.parts.map((p) => p.mesh.name));
  const ATLAS = [
    'Armor_Test_Chest',
    'Armor_Test_Shoulder_L',
    'Armor_Test_Shoulder_R',
    'Armor_Test_Waist',
  ];
  const KIT = [...ATLAS, 'Armor_Test_Boots', 'Armor_Test_Helm'];

  it('folds the parts on one file material into one draw, and leaves a batch of one alone', () => {
    const { plan, drawn } = planned(KIT);
    // six meshes, three materials: the four on the atlas fold, the boots and the helm
    // (one mesh each on its own material) keep drawing by themselves
    expect(folded(plan)).toEqual([ATLAS]);
    expect(plan?.sources.map((m) => m.name)).toEqual(ATLAS);
    expect(plan?.batches[0].material).toBe(drawn[0].material);
    expect(plan?.batches[0].caster).toBe(true);
    expect(plan?.batches[0].renderOrder).toBe(0);
    expect(plan?.batches[0].layers).toBe(1);
  });

  it('plans nothing when no two parts share a material', () => {
    expect(planned(['Armor_Test_Boots', 'Armor_Test_Helm']).plan).toBeNull();
    expect(planned(['Armor_Test_Chest']).plan).toBeNull();
    expect(planned([]).plan).toBeNull();
  });

  it('batches by the FILE material, whatever a host mounted on the meshes since', () => {
    const { plan } = planned(KIT, (parts) => {
      // the visual's material pass: a tier material per program shape, so the skinned
      // parts and the rigid ones end up on different objects derived from one source
      for (const c of parts.values()) {
        c.mesh.material = (c.mesh.material as THREE.Material).clone();
      }
    });
    expect(folded(plan)).toEqual([ATLAS]);
  });

  it('leaves a blended, depth-free or several-material mesh drawing by itself', () => {
    const cases: ((m: THREE.Material) => void)[] = [
      (m) => {
        m.transparent = true;
      },
      (m) => {
        m.depthWrite = false;
      },
      (m) => {
        m.depthTest = false;
      },
      (m) => {
        m.blending = THREE.AdditiveBlending;
      },
      (m) => {
        (m as THREE.MeshPhysicalMaterial).transmission = 0.5;
      },
    ];
    for (const spoil of cases) {
      // the file material itself: nothing on it folds
      expect(planned(ATLAS, (_parts, _b, file) => spoil(file.atlas)).plan).toBeNull();
    }
    // one part drawn with a list of materials: the other three still fold
    const several = planned(ATLAS, (parts) => {
      const chest = parts.get('Armor_Test_Chest');
      if (chest) chest.mesh.material = [chest.material, chest.material];
    });
    expect(folded(several.plan)).toEqual([ATLAS.slice(1)]);
  });

  it('leaves a part with morph targets, a partial draw range or an unknown attribute alone', () => {
    const spoils: ((g: THREE.BufferGeometry) => void)[] = [
      (g) => {
        g.morphAttributes.position = [g.getAttribute('position').clone()];
      },
      (g) => {
        g.setDrawRange(0, 6);
      },
      (g) => {
        g.setDrawRange(3, Number.POSITIVE_INFINITY);
      },
      (g) => {
        g.setAttribute(
          'aCustom',
          new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1),
        );
      },
    ];
    for (const spoil of spoils) {
      const { plan } = planned(ATLAS, (parts) => {
        const waist = parts.get('Armor_Test_Waist');
        if (waist) spoil(waist.mesh.geometry);
      });
      expect(folded(plan)).toEqual([ATLAS.slice(0, 3)]);
    }
  });

  it('leaves an instanced, batched or empty mesh alone', () => {
    const spoils: ((mesh: THREE.Mesh) => void)[] = [
      (mesh) => {
        (mesh as unknown as { isInstancedMesh: boolean }).isInstancedMesh = true;
      },
      (mesh) => {
        (mesh as unknown as { isBatchedMesh: boolean }).isBatchedMesh = true;
      },
      (mesh) => {
        const empty = new THREE.BufferGeometry();
        for (const name of Object.keys(mesh.geometry.attributes)) {
          const size = mesh.geometry.getAttribute(name).itemSize;
          empty.setAttribute(name, new THREE.BufferAttribute(new Float32Array(0), size));
        }
        mesh.geometry = empty;
      },
    ];
    for (const spoil of spoils) {
      const { plan } = planned(ATLAS, (parts) => {
        const waist = parts.get('Armor_Test_Waist');
        if (waist) spoil(waist.mesh);
      });
      expect(folded(plan)).toEqual([ATLAS.slice(0, 3)]);
    }
  });

  it('leaves a skinned part with skin attributes the fold cannot read alone', () => {
    const spoils: ((g: THREE.BufferGeometry) => void)[] = [
      // three components to a joint list
      (g) => {
        const count = g.getAttribute('position').count;
        g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(count * 3), 3));
      },
      // joints stored normalized: their accessors would hand back fractions
      (g) => {
        const count = g.getAttribute('position').count;
        g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(count * 4), 4, true));
      },
      (g) => {
        const count = g.getAttribute('position').count;
        g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      },
      (g) => {
        g.deleteAttribute('skinWeight');
      },
    ];
    for (const spoil of spoils) {
      const { plan } = planned(ATLAS, (parts) => {
        const waist = parts.get('Armor_Test_Waist');
        if (waist) spoil(waist.mesh.geometry);
      });
      expect(folded(plan)).toEqual([ATLAS.slice(0, 3)]);
    }
  });

  it('keeps parts that differ in what a draw has one of in separate draws', () => {
    // no uv on one skinned part: another program
    const noUv = planned(ATLAS, (parts) => {
      parts.get('Armor_Test_Waist')?.mesh.geometry.deleteAttribute('uv');
    });
    expect(folded(noUv.plan)).toEqual([ATLAS.slice(0, 3)]);
    // another draw order, other layers, no shadow: each its own batch
    const tweaks: ((mesh: THREE.Mesh) => void)[] = [
      (mesh) => {
        mesh.renderOrder = 2;
      },
      (mesh) => {
        mesh.layers.set(3);
      },
      (mesh) => {
        mesh.userData.shadowCaster = false;
      },
    ];
    for (const tweak of tweaks) {
      const { plan } = planned(ATLAS, (parts) => {
        for (const name of ['Armor_Test_Chest', 'Armor_Test_Waist']) {
          const part = parts.get(name);
          if (part) tweak(part.mesh);
        }
      });
      expect(folded(plan)).toEqual([
        ['Armor_Test_Chest', 'Armor_Test_Waist'],
        ['Armor_Test_Shoulder_L', 'Armor_Test_Shoulder_R'],
      ]);
    }
    const quiet = planned(ATLAS, (parts) => {
      for (const c of parts.values()) {
        c.mesh.userData.shadowCaster = false;
        c.mesh.renderOrder = 4;
        c.mesh.layers.set(2);
      }
    });
    expect(quiet.plan?.batches[0]).toMatchObject({ caster: false, renderOrder: 4, layers: 4 });
  });

  it('leaves out a skinned part no single transform converts', () => {
    // every bone's inverse off by a transform of its own: nothing maps it into the bind
    const { plan } = planned(ATLAS, undefined, (b, file) => [
      foreignPart(b, file.atlas, (bone, slot) =>
        b.skeleton.boneInverses[b.skeleton.bones.indexOf(bone)]
          .clone()
          .multiply(new THREE.Matrix4().makeTranslation(0.1 * (slot + 1), 0, 0)),
      ),
    ]);
    expect(folded(plan)).toEqual([ATLAS]);
  });

  it('leaves out a skinned part weighted to a bone the body does not drive', () => {
    const { plan } = planned(ATLAS, undefined, (b, file) => {
      const foreign = foreignPart(b, file.atlas);
      // give the stray slot (1) real weight
      const weights = foreign.mesh.geometry.getAttribute('skinWeight');
      weights.setZ(0, 0.25);
      return [foreign];
    });
    expect(folded(plan)).toEqual([ATLAS]);
  });

  it('leaves out a skinned part on another skeleton with a joint out of range, or no weight at all', () => {
    const wild = planned(ATLAS, undefined, (b, file) => {
      const foreign = foreignPart(b, file.atlas);
      // a weighted slot naming a joint its own skeleton does not have
      foreign.mesh.geometry.getAttribute('skinIndex').setX(0, 9);
      foreign.mesh.geometry.getAttribute('skinWeight').setX(0, 0.5);
      return [foreign];
    });
    expect(folded(wild.plan)).toEqual([ATLAS]);
    const weightless = planned(ATLAS, undefined, (b, file) => {
      const foreign = foreignPart(b, file.atlas);
      const weights = foreign.mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < weights.count; i++) weights.setXYZW(i, 0, 0, 0, 0);
      return [foreign];
    });
    expect(folded(weightless.plan)).toEqual([ATLAS]);
  });

  it('folds a part on a clone of the skeleton as stored: the same inverses, nothing to convert', () => {
    const b = body();
    const parts = bound(b, armorFile());
    const drawn = pick(parts, 'Armor_Test_Chest', 'Armor_Test_Waist');
    const chest = drawn[0].mesh as THREE.SkinnedMesh;
    // three's Skeleton.clone shares the inverses: another object, the same bind
    chest.bind(b.skeleton.clone(), chest.bindMatrix);
    const plan = planWocArmorMerge(b.model, bindOf(b), drawn);
    expect(plan?.batches[0].parts[0]).toMatchObject({ toBind: null, joints: null });
  });

  it('leaves out a skinned part that is detached, or does not sit at the model origin', () => {
    const detached = planned(ATLAS, (parts) => {
      const chest = parts.get('Armor_Test_Chest');
      if (chest) (chest.mesh as THREE.SkinnedMesh).bindMode = THREE.DetachedBindMode;
    });
    expect(folded(detached.plan)).toEqual([ATLAS.slice(1)]);
    const moved = planned(ATLAS, (parts) => {
      parts.get('Armor_Test_Waist')?.mesh.position.set(0, 0.01, 0);
    });
    expect(folded(moved.plan)).toEqual([ATLAS.slice(0, 3)]);
  });

  it('leaves out a rigid part on a non-uniformly scaled bone chain, on no bone, or under an object-space layer', () => {
    // a squashed ancestor of the shoulder bone: the skin matrix would bend the normals
    const squashed = planned(ATLAS, (_parts, b) => {
      b.bones.spine.scale.set(1, 1.3, 1);
    });
    expect(folded(squashed.plan)).toEqual([['Armor_Test_Chest', 'Armor_Test_Waist']]);
    // ...while a uniform scale on the chain is exact, and folds
    const grown = planned(ATLAS, (_parts, b) => {
      b.bones.spine.scale.setScalar(1.3);
    });
    expect(folded(grown.plan)).toEqual([ATLAS]);
    // a wrapper that does not hang on a joint of the body's skeleton
    const loose = planned(ATLAS, (parts, b) => {
      const pad = parts.get('Armor_Test_Shoulder_R');
      if (pad) b.model.add(pad.root);
    });
    expect(folded(loose.plan)).toEqual([ATLAS.filter((n) => n !== 'Armor_Test_Shoulder_R')]);
    // a node squashed flat (no way back from the bind to it), or a bone whose inverse
    // bind is no transform at all: nothing to bake the part with
    const flat = planned(ATLAS, (parts) => {
      parts.get('Armor_Test_Shoulder_R')?.mesh.scale.set(0, 0.1, 0.14);
    });
    expect(folded(flat.plan)).toEqual([ATLAS.filter((n) => n !== 'Armor_Test_Shoulder_R')]);
    const broken = planned(ATLAS, (_parts, b) => {
      b.skeleton.boneInverses[b.skeleton.bones.indexOf(b.bones.shoulder)].makeScale(0, 1, 1);
    });
    expect(folded(broken.plan)).toEqual([['Armor_Test_Chest', 'Armor_Test_Waist']]);
    const wild = planned(ATLAS, (_parts, b) => {
      b.skeleton.boneInverses[b.skeleton.bones.indexOf(b.bones.shoulder)].elements[0] = Number.NaN;
    });
    expect(folded(wild.plan)).toEqual([['Armor_Test_Chest', 'Armor_Test_Waist']]);
    // a material layer keyed on the raw vertex position (worn_stone.ts, object space)
    const worn = planned(ATLAS, (parts) => {
      const pad = parts.get('Armor_Test_Shoulder_L');
      if (!pad) return;
      const mounted = pad.material.clone();
      mounted.userData.surfaceDetailSpec = { family: 'metal', objectSpace: true };
      pad.mesh.material = mounted;
    });
    expect(folded(worn.plan)).toEqual([ATLAS.filter((n) => n !== 'Armor_Test_Shoulder_L')]);
  });

  it('keys two pads over one geometry apart by where each hangs', () => {
    const { plan, drawn } = planned(['Armor_Test_Shoulder_L', 'Armor_Test_Shoulder_R']);
    expect(drawn[0].mesh.geometry).toBe(drawn[1].mesh.geometry);
    const [left, right] = (plan?.key ?? '').split('|');
    expect(left).not.toBe(right);
    expect(left.startsWith(`${drawn[0].mesh.geometry.uuid}:${drawn[0].material.uuid}:r4:m`)).toBe(
      true,
    );
    expect(left.endsWith(';f')).toBe(true);
    expect(right.endsWith(';f')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The shared geometry cache
// ---------------------------------------------------------------------------

describe('the leased geometry cache', () => {
  const tiny = (): THREE.BufferGeometry => new THREE.BufferGeometry();

  it('builds a kit once, shares it between its wearers, and keeps it idle when the last leaves', () => {
    const build = vi.fn(tiny);
    expect(wocArmorMergeBuilt('kit')).toBe(false);
    const a = retainWocArmorMerge('kit', build);
    const c = retainWocArmorMerge('kit', build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(c.geometry).toBe(a.geometry);
    expect(wocArmorMergeInternalsForTest.cache.get('kit')?.refs).toBe(2);
    a.release();
    a.release(); // a second release of one lease is nothing
    expect(wocArmorMergeInternalsForTest.cache.get('kit')?.refs).toBe(1);
    c.release();
    expect(wocArmorMergeInternalsForTest.cache.get('kit')?.refs).toBe(0);
    expect(wocArmorMergeBuilt('kit')).toBe(true);
    retainWocArmorMerge('kit', build).release();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('drops the oldest idle kits past the cap, never one somebody draws', () => {
    const held = retainWocArmorMerge('held', tiny);
    const disposed = vi.spyOn(held.geometry, 'dispose');
    const first = retainWocArmorMerge('idle0', tiny);
    const firstDisposed = vi.spyOn(first.geometry, 'dispose');
    first.release();
    for (let i = 1; i <= MAX_IDLE; i++) retainWocArmorMerge(`idle${i}`, tiny).release();
    expect(wocArmorMergeBuilt('idle0')).toBe(false);
    expect(firstDisposed).toHaveBeenCalledTimes(1);
    expect(wocArmorMergeBuilt('idle1')).toBe(true);
    expect(wocArmorMergeBuilt('held')).toBe(true);
    expect(disposed).not.toHaveBeenCalled();
    expect(wocArmorMergeInternalsForTest.cache.size).toBe(MAX_IDLE + 1);
    held.release();
  });

  it('counts the oldest by when a kit was let go, not by when it was built', () => {
    const a = retainWocArmorMerge('a', tiny);
    const c = retainWocArmorMerge('b', tiny);
    // built a then b, let go b then a: b has been idle the longest
    c.release();
    a.release();
    for (let i = 0; i < MAX_IDLE - 1; i++) retainWocArmorMerge(`fill${i}`, tiny).release();
    expect(wocArmorMergeBuilt('b')).toBe(false);
    expect(wocArmorMergeBuilt('a')).toBe(true);
  });

  it('drops every idle kit on a profile change, and leaves a leased one to its holder', () => {
    const held = retainWocArmorMerge('held', tiny);
    const idle = retainWocArmorMerge('idle', tiny);
    const idleDisposed = vi.spyOn(idle.geometry, 'dispose');
    const heldDisposed = vi.spyOn(held.geometry, 'dispose');
    idle.release();
    clearIdleWocArmorMerges();
    expect(wocArmorMergeBuilt('idle')).toBe(false);
    expect(idleDisposed).toHaveBeenCalledTimes(1);
    expect(wocArmorMergeBuilt('held')).toBe(true);
    expect(heldDisposed).not.toHaveBeenCalled();
    held.release();
  });
});

// ---------------------------------------------------------------------------
// One character's stand-in, through the real attach
// ---------------------------------------------------------------------------

const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'merge-fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: {},
  items: {},
  defaultEquipment: {},
  animationNames: [],
};

let sets = 0;
/** A set name no other case has used: every case wears a file of its own. */
const freshSet = (): string => `mergekit${++sets}`;

/** Make a set's file resident (once) and attach it to a body through the armor store,
 *  every part shown, as a dressed body draws it. */
async function wear(
  b: Body,
  set: string,
  file: () => ArmorFixture = armorFile,
): Promise<THREE.Group> {
  // a file of its own (the high pack is assembled over the medium file: its own suite)
  const url = wocArmorPackUrl('male', set, 'medium');
  if (!wocArmorPackResident(url)) {
    ensureWocArmorPack(url);
    loads.pending.get(url)?.(file());
    await Promise.resolve();
    await Promise.resolve();
  }
  const container = attachWocArmorPack(b.model, url, set, manifest);
  if (!container) throw new Error(`${url} did not attach`);
  for (const piece of wocArmorPieces(container)) {
    piece.traverse((o) => {
      o.visible = true;
    });
  }
  return container;
}

/**
 * A host whose reveals wait (gated: the compile gate in flight) or land at once.
 * `hides` is whether the gate hides the node itself while it links, as the real one
 * does; `settle(false)` is a gate that gave up before the programs linked.
 */
function host(gated: boolean, hides = true) {
  const waiting: ((prepared: boolean) => void)[] = [];
  const h = {
    adopt: vi.fn((_node: THREE.Object3D): void => undefined),
    forget: vi.fn(),
    reveal: vi.fn((node: THREE.Object3D, live?: (prepared: boolean) => void) => {
      if (!gated) {
        live?.(true);
        return;
      }
      if (hides) node.visible = false;
      waiting.push((prepared) => {
        // the real gate drops the settle of a node detached meanwhile
        if (node.parent === null) return;
        node.visible = true;
        live?.(prepared);
      });
    }),
    settle: (prepared = true): void => {
      for (const reveal of waiting.splice(0)) reveal(prepared);
    },
  };
  return h satisfies WocArmorMergeHost & { settle(prepared?: boolean): void };
}

const CAMERA = new THREE.Layers();

/** The armor meshes a camera would be handed: visible up to the model, and on its layers. */
function drawnArmor(model: THREE.Object3D): string[] {
  const out: string[] = [];
  model.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.wocArmorPart && mesh.layers.test(CAMERA)) out.push(o.name);
  });
  return out.sort();
}

const wrapperOf = (model: THREE.Object3D): THREE.Object3D | undefined =>
  model.children.find((child) => child.name === WOC_ARMOR_MERGED_NAME);

const part = (model: THREE.Object3D, name: string): THREE.Mesh => {
  const found = model.getObjectByName(name) as THREE.Mesh | undefined;
  if (!found) throw new Error(`no ${name}`);
  return found;
};

const allMeshes = (model: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

/**
 * The visual's blended overlay (the ghost run, stealth): a transparent clone on every
 * mesh given, each remembered so `lift` puts back exactly what was mounted before.
 */
function overlay(meshes: readonly THREE.Mesh[]): { lift(): void } {
  const plain = new Map(meshes.map((mesh) => [mesh, mesh.material]));
  for (const mesh of meshes) {
    const ghost = (mesh.material as THREE.Material).clone();
    ghost.transparent = true;
    mesh.material = ghost;
  }
  return {
    lift(): void {
      for (const [mesh, material] of plain) mesh.material = material;
    },
  };
}

const KIT_DRAWN = [
  'Armor_Test_Boots',
  'Armor_Test_Chest',
  'Armor_Test_Helm',
  'Armor_Test_Shoulder_L',
  'Armor_Test_Shoulder_R',
  'Armor_Test_Waist',
];
const KIT_FOLDED = [
  'Armor_Test_Chest',
  'Armor_Test_Shoulder_L',
  'Armor_Test_Shoulder_R',
  'Armor_Test_Waist',
];
const KIT_MERGED = ['Armor_Test_Boots', 'Armor_Test_Helm', `${WOC_ARMOR_MERGED_NAME}_0`];

describe('the armor a model draws', () => {
  it('is every shown part of an attached file, by name, with the material its file hung it with', async () => {
    const b = body();
    await wear(b, freshSet());
    // a host's material pass since: the file material is still what the store answers
    const chest = part(b.model, 'Armor_Test_Chest');
    const atlas = chest.material;
    chest.material = (atlas as THREE.Material).clone();
    const drawn = wocArmorDrawnParts(b.model);
    expect(drawn.map((c) => c.mesh.name)).toEqual(KIT_DRAWN);
    expect(drawn.find((c) => c.mesh === chest)?.material).toBe(atlas);
    expect(wocArmorFileMaterial(chest)).toBe(atlas);
    // a skinned part hangs under its file's Group, a rigid one under its wrapper on a bone
    expect(drawn.find((c) => c.mesh === chest)?.root.parent).toBe(b.model);
    const pad = drawn.find((c) => c.mesh.name === 'Armor_Test_Shoulder_L');
    expect(pad?.root.parent).toBe(b.bones.shoulder);
    // the body itself is no armor
    expect(wocArmorFileMaterial(part(b.model, 'Character_Body'))).toBeNull();
  });

  it('leaves out a hidden part, and every part of a file still linking behind the gate', async () => {
    const b = body();
    const container = await wear(b, freshSet());
    part(b.model, 'Armor_Test_Waist').visible = false;
    part(b.model, 'Armor_Test_Helm').visible = false;
    expect(wocArmorDrawnParts(b.model).map((c) => c.mesh.name)).toEqual(
      KIT_DRAWN.filter((n) => n !== 'Armor_Test_Waist' && n !== 'Armor_Test_Helm'),
    );
    // the Group of skinned parts not revealed yet: only the rigid pads draw
    container.visible = false;
    expect(wocArmorDrawnParts(b.model).map((c) => c.mesh.name)).toEqual([
      'Armor_Test_Shoulder_L',
      'Armor_Test_Shoulder_R',
    ]);
    // ...and a rigid part's wrapper not revealed yet
    for (const piece of wocArmorPieces(container)) piece.visible = false;
    expect(wocArmorDrawnParts(b.model)).toEqual([]);
  });

  it('leaves out a rigid part whose bone is hidden above it: three draws nothing under a hidden node', async () => {
    const b = body();
    await wear(b, freshSet());
    // the chest bone carries the head and the shoulder: the pads and the helm go with it,
    // the skinned parts (under no bone) still draw
    b.bones.chest.visible = false;
    expect(wocArmorDrawnParts(b.model).map((c) => c.mesh.name)).toEqual([
      'Armor_Test_Boots',
      'Armor_Test_Chest',
      'Armor_Test_Waist',
    ]);
    expect(drawnArmor(b.model)).toEqual([
      'Armor_Test_Boots',
      'Armor_Test_Chest',
      'Armor_Test_Waist',
    ]);
  });

  it('never takes a head piece, which carries the armor tag too', async () => {
    const b = body();
    await wear(b, freshSet());
    part(b.model, 'Armor_Test_Chest').userData.wocHeadPart = true;
    expect(wocArmorDrawnParts(b.model).map((c) => c.mesh.name)).toEqual(
      KIT_DRAWN.filter((n) => n !== 'Armor_Test_Chest'),
    );
  });
});

describe('one character wearing a merged kit', () => {
  it('mounts hidden, and stands in for its parts only once its reveal settles', async () => {
    const b = body();
    await wear(b, freshSet());
    // a gate that does not hide what it links: the stand-in hides itself
    const h = host(true, false);
    const rig = new WocArmorMergeRig(h, b.model);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    expect(rig.sync()).toBe(true);
    // mounted and handed to the host, its programs still linking: the parts draw
    const wrapper = wrapperOf(b.model);
    expect(wrapper).toBeDefined();
    expect(wrapper?.visible).toBe(false);
    expect(h.adopt).toHaveBeenCalledWith(wrapper);
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.reveal.mock.calls[0][0]).toBe(wrapper);
    expect(rig.standing).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    // while it links, every poll leaves it be: one reveal, however long the gate takes
    rig.poll();
    rig.poll();
    expect(h.reveal).toHaveBeenCalledTimes(1);
    h.settle();
    // six draws became three: the four parts on the atlas are one mesh now
    expect(rig.standing).toBe(true);
    expect(wrapper?.visible).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
    for (const name of KIT_FOLDED) {
      const source = part(b.model, name);
      // out of the render lists by its layers, never by its visible flag
      expect(source.layers.mask).toBe(0);
      expect(source.visible).toBe(true);
    }
    expect(part(b.model, 'Armor_Test_Boots').layers.mask).toBe(1);
    expect(part(b.model, 'Armor_Test_Helm').layers.mask).toBe(1);
  });

  it('draws a skinned mesh on the body skeleton with the file material, and every vertex and triangle where its part did', async () => {
    const b = body();
    await wear(b, freshSet());
    const sources = KIT_FOLDED.map((name) => part(b.model, name));
    const atlas = wocArmorFileMaterial(sources[0]);
    const rig = new WocArmorMergeRig(host(false), b.model);
    rig.sync();
    expect(rig.standing).toBe(true);
    const [merged] = rig.meshes;
    expect(rig.meshes).toHaveLength(1);
    expect(merged.isSkinnedMesh).toBe(true);
    expect(merged.skeleton).toBe(b.skeleton);
    expect(merged.material).toBe(atlas);
    expect(merged.name).toBe('woc_armor_merged_0');
    expect(merged.userData).toEqual({ wocArmorPart: true, wocArmorMerged: true });
    expect(WOC_ARMOR_MERGED_KEY).toBe('wocArmorMerged');
    expect(WOC_ARMOR_MERGED_NAME).toBe('woc_armor_merged');
    expect(merged.parent).toBe(wrapperOf(b.model));
    expect(merged.parent?.parent).toBe(b.model);
    // a sort sphere of its own, the shared geometry's copied (three never skins every
    // vertex to find one, and a wearer never moves another's), and no cull on a
    // bind-pose sphere: the host's setup pads it and turns culling on
    expect(merged.boundingSphere).not.toBe(merged.geometry.boundingSphere);
    expect(merged.boundingSphere?.equals(merged.geometry.boundingSphere as THREE.Sphere)).toBe(
      true,
    );
    expect(merged.frustumCulled).toBe(false);
    // the armor tag keeps it out of the rig's body lookups, like the parts it folds
    expect(wocRigSkeletonOf(b.model)).toBe(b.skeleton);
    expect(wocArmorMergeBindOf(b.model)?.skeleton).toBe(b.skeleton);
    for (const k of [1, 2]) {
      pose(b, k);
      expectSameDraw(merged, sources);
    }
    // each part's triangles, the mirrored left pad's turned: three flips the front face
    // of a mesh whose world matrix mirrors, and the merged mesh's does not
    expectSameTriangles(
      merged,
      sources.map((mesh) => ({ mesh, flip: mesh.matrixWorld.determinant() < 0 })),
    );
    expect(sources.map((mesh) => mesh.matrixWorld.determinant() < 0)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it('mounts one merged mesh per file material, and gives every one of them back', async () => {
    const b = body();
    // the helm on the boots' material: two materials with parts to fold
    await wear(b, freshSet(), () => armorFile(true));
    const rig = new WocArmorMergeRig(host(false), b.model);
    rig.sync();
    expect(rig.meshes.map((mesh) => mesh.name)).toEqual([
      'woc_armor_merged_0',
      'woc_armor_merged_1',
    ]);
    const leatherParts = ['Armor_Test_Boots', 'Armor_Test_Helm'].map((n) => part(b.model, n));
    const atlasParts = KIT_FOLDED.map((n) => part(b.model, n));
    const leather = wocArmorFileMaterial(leatherParts[0]);
    const atlas = wocArmorFileMaterial(atlasParts[0]);
    expect(leather).not.toBe(atlas);
    expect(rig.meshes.map((mesh) => mesh.material)).toEqual([leather, atlas]);
    expect(rig.meshes.every((mesh) => mesh.parent === wrapperOf(b.model))).toBe(true);
    // six draws became two
    expect(drawnArmor(b.model)).toEqual(['woc_armor_merged_0', 'woc_armor_merged_1']);
    pose(b, 1);
    expectSameDraw(rig.meshes[0], leatherParts);
    expectSameDraw(rig.meshes[1], atlasParts);
    expect([...wocArmorMergeInternalsForTest.cache.values()].map((e) => e.refs)).toEqual([1, 1]);
    rig.drop();
    expect([...wocArmorMergeInternalsForTest.cache.values()].map((e) => e.refs)).toEqual([0, 0]);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    for (const mesh of [...leatherParts, ...atlasParts]) expect(mesh.layers.mask).toBe(1);
  });

  it('calls a waiting kit built only when every one of its buffers is', async () => {
    const set = freshSet();
    const file = (): ArmorFixture => armorFile(true);
    const a = body();
    await wear(a, set, file);
    // the first wearer with its helm off: only the atlas batch gets built
    part(a.model, 'Armor_Test_Helm').visible = false;
    new WocArmorMergeRig(host(false), a.model).sync();
    expect(wocArmorMergeInternalsForTest.cache.size).toBe(1);
    const c = body();
    await wear(c, set, file);
    const rig = new WocArmorMergeRig(host(false), c.model);
    rig.sync(false);
    // one of its two buffers exists, the other still has to be folded
    expect(rig.pendingBuilt).toBe(false);
    rig.mountPending();
    expect(wocArmorMergeInternalsForTest.cache.size).toBe(2);
    const d = body();
    await wear(d, set, file);
    const third = new WocArmorMergeRig(host(false), d.model);
    third.sync(false);
    expect(third.pendingBuilt).toBe(true);
  });

  it('carries the draw order, the layers and the caster flag of its parts onto the mounted mesh', async () => {
    const b = body();
    await wear(b, freshSet());
    for (const name of KIT_FOLDED) {
      const mesh = part(b.model, name);
      mesh.renderOrder = 4;
      mesh.layers.mask = 0b110;
      mesh.userData.shadowCaster = false;
    }
    const rig = new WocArmorMergeRig(host(false), b.model);
    rig.sync();
    const [merged] = rig.meshes;
    expect(merged.renderOrder).toBe(4);
    expect(merged.layers.mask).toBe(0b110);
    expect(merged.userData.shadowCaster).toBe(false);
    // ...and a caster carries no such flag at all
    const other = body();
    await wear(other, freshSet());
    const plain = new WocArmorMergeRig(host(false), other.model);
    plain.sync();
    expect('shadowCaster' in plain.meshes[0].userData).toBe(false);
    expect(plain.meshes[0].renderOrder).toBe(0);
  });

  it('restores every part exactly as it was when dropped, and tells the host', async () => {
    const b = body();
    await wear(b, freshSet());
    // the parts on layers of their own: the merged mesh draws on them, and they come back
    for (const name of KIT_FOLDED) part(b.model, name).layers.mask = 0b1010;
    const h = host(false);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    expect(rig.meshes[0].layers.mask).toBe(0b1010);
    const wrapper = wrapperOf(b.model);
    for (const name of KIT_FOLDED) expect(part(b.model, name).layers.mask).toBe(0);
    expect(rig.drop()).toBe(true);
    for (const name of KIT_FOLDED) expect(part(b.model, name).layers.mask).toBe(0b1010);
    expect(wrapperOf(b.model)).toBeUndefined();
    expect(wrapper?.parent).toBeNull();
    expect(h.forget).toHaveBeenCalledWith(wrapper);
    expect(rig.standing).toBe(false);
    expect(rig.meshes).toEqual([]);
    expect([...wocArmorMergeInternalsForTest.cache.values()].map((e) => e.refs)).toEqual([0]);
    expect(rig.drop()).toBe(false);
  });

  it('hides nothing when its reveal settles after it was dropped, or after another took its place', async () => {
    const b = body();
    await wear(b, freshSet());
    // a host that settles a reveal even for a node no longer attached: the rig's own guard
    const waiting: (() => void)[] = [];
    const h: WocArmorMergeHost = {
      adopt: () => undefined,
      forget: () => undefined,
      reveal: (_node, live) => {
        waiting.push(() => live?.(true));
      },
    };
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    rig.drop();
    for (const settle of waiting.splice(0)) settle();
    expect(rig.standing).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    for (const name of KIT_FOLDED) expect(part(b.model, name).layers.mask).toBe(1);
    // replaced while it linked: the waist came off, and the first stand-in's late settle
    // must not touch the second's parts (nor zero the waist it no longer folds)
    rig.sync();
    part(b.model, 'Armor_Test_Waist').visible = false;
    rig.sync();
    expect(waiting).toHaveLength(2);
    for (const settle of waiting.splice(0)) settle();
    expect(rig.standing).toBe(true);
    expect(part(b.model, 'Armor_Test_Waist').layers.mask).toBe(1);
    rig.drop();
    for (const name of KIT_FOLDED) expect(part(b.model, name).layers.mask).toBe(1);
  });

  it('wants nothing once dropped: a stand-in left waiting is forgotten with the mounted one', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(false);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync(false);
    expect(rig.isWaiting).toBe(true);
    expect(rig.mountable).toBe(true);
    expect(rig.pendingBuilt).toBe(false);
    // nothing was up, and nothing is wanted any more (its file is about to detach)
    expect(rig.drop()).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(rig.mountable).toBe(false);
    expect(rig.mountPending()).toBe(false);
    rig.poll();
    expect(wrapperOf(b.model)).toBeUndefined();
    expect(h.adopt).not.toHaveBeenCalled();
    // the next reconcile wants it again
    rig.sync();
    expect(rig.standing).toBe(true);
  });

  it('keeps the stand-in while the same parts draw, and reads their layers as they were', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(false);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    const [merged] = rig.meshes;
    // standing: its parts read zero layers now, and the plan must not mistake that for
    // a change (it would drop and rebuild on every pass)
    expect(rig.sync()).toBe(false);
    expect(rig.sync(false)).toBe(false);
    rig.poll();
    expect(rig.meshes[0]).toBe(merged);
    expect(rig.standing).toBe(true);
    expect(rig.isWaiting).toBe(false);
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(h.reveal).toHaveBeenCalledTimes(1);
  });

  it('takes a stand-in down when other meshes turn up under the same buffers', async () => {
    const b = body();
    const set = freshSet();
    const first = await wear(b, set);
    const rig = new WocArmorMergeRig(host(false), b.model);
    rig.sync();
    const old = KIT_FOLDED.map((name) => part(b.model, name));
    const [merged] = rig.meshes;
    // the file detached and attached again behind the rig's back: new part meshes over
    // the same geometry and material, so the very same key
    releaseWocArmorContainer(first);
    await wear(b, set);
    const fresh = KIT_FOLDED.map((name) => part(b.model, name));
    expect(fresh.every((mesh, i) => mesh !== old[i] && mesh.geometry === old[i].geometry)).toBe(
      true,
    );
    expect(rig.sync()).toBe(true);
    expect(rig.meshes[0]).not.toBe(merged);
    expect(rig.standing).toBe(true);
    // the new parts are the ones out of the render lists, the old ones were given back
    expect(fresh.map((mesh) => mesh.layers.mask)).toEqual([0, 0, 0, 0]);
    expect(old.map((mesh) => mesh.layers.mask)).toEqual([1, 1, 1, 1]);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('rebuilds from a standing stand-in on the layers its parts draw on, never the zero it left on them', async () => {
    const b = body();
    await wear(b, freshSet());
    part(b.model, 'Armor_Test_Waist').visible = false;
    const rig = new WocArmorMergeRig(host(false), b.model);
    rig.sync();
    const three = rig.meshes[0].geometry.getAttribute('position').count;
    // a part shown while the others stand hidden by their layers: it joins them (read
    // off the live masks it would look like a part on other layers, and stay out)
    part(b.model, 'Armor_Test_Waist').visible = true;
    expect(rig.sync()).toBe(true);
    expect(rig.standing).toBe(true);
    expect(rig.meshes[0].geometry.getAttribute('position').count).toBe(
      three + part(b.model, 'Armor_Test_Waist').geometry.getAttribute('position').count,
    );
    // ...and the new merged mesh draws: planned while its parts read zero, it is still
    // on the layers they had
    expect(rig.meshes[0].layers.mask).toBe(1);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
    // a part hidden while standing: the same, the other way
    part(b.model, 'Armor_Test_Shoulder_L').visible = false;
    expect(rig.sync()).toBe(true);
    expect(rig.meshes[0].layers.mask).toBe(1);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
    expect(part(b.model, 'Armor_Test_Shoulder_L').layers.mask).toBe(1);
  });

  it('drops at once on a change and waits when told not to build, then mounts when asked', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(false);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    // the dressing hides the waist: the stand-in still draws it, so it goes NOW
    part(b.model, 'Armor_Test_Waist').visible = false;
    expect(rig.sync(false)).toBe(true);
    expect(rig.standing).toBe(false);
    expect(rig.isWaiting).toBe(true);
    expect(wrapperOf(b.model)).toBeUndefined();
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN.filter((n) => n !== 'Armor_Test_Waist'));
    for (const name of KIT_FOLDED) expect(part(b.model, name).layers.mask).toBe(1);
    // the poll alone mounts nothing: its owner asks, when its budget allows
    rig.poll();
    expect(wrapperOf(b.model)).toBeUndefined();
    expect(rig.mountPending()).toBe(true);
    expect(rig.isWaiting).toBe(false);
    expect(rig.standing).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
    expect(part(b.model, 'Armor_Test_Waist').layers.mask).toBe(1);
    expect(rig.meshes[0].geometry.getAttribute('position').count).toBe(
      ['Armor_Test_Chest', 'Armor_Test_Shoulder_L', 'Armor_Test_Shoulder_R']
        .map((name) => part(b.model, name).geometry.getAttribute('position').count)
        .reduce((a, c) => a + c, 0),
    );
    // asked again with nothing waiting: nothing
    expect(rig.mountPending()).toBe(false);
    expect(h.adopt).toHaveBeenCalledTimes(2);
  });

  it('stands in for what draws when it mounts, whatever was planned while it waited', async () => {
    const b = body();
    await wear(b, freshSet());
    const rig = new WocArmorMergeRig(host(false), b.model);
    expect(rig.sync(false)).toBe(false);
    expect(rig.isWaiting).toBe(true);
    // a part hidden with nobody reconciling: the mount reads the parts again
    part(b.model, 'Armor_Test_Shoulder_R').visible = false;
    expect(rig.mountPending()).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
    expect(part(b.model, 'Armor_Test_Shoulder_R').layers.mask).toBe(1);
    // ...and nothing left to fold ends the wait
    const bare = body();
    await wear(bare, freshSet());
    const other = new WocArmorMergeRig(host(false), bare.model);
    other.sync(false);
    for (const name of KIT_FOLDED.slice(1)) part(bare.model, name).visible = false;
    expect(other.mountPending()).toBe(false);
    expect(other.isWaiting).toBe(false);
    expect(wrapperOf(bare.model)).toBeUndefined();
  });

  it('shares one buffer between two characters in one kit, and builds another for another kit', async () => {
    const set = freshSet();
    const a = body();
    const c = body();
    await wear(a, set);
    await wear(c, set);
    const first = new WocArmorMergeRig(host(false), a.model);
    const second = new WocArmorMergeRig(host(false), c.model);
    first.sync();
    second.sync(false);
    // somebody already built this kit: the second character's mount folds nothing
    expect(second.pendingBuilt).toBe(true);
    second.mountPending();
    expect(second.standing).toBe(true);
    expect(second.meshes[0].geometry).toBe(first.meshes[0].geometry);
    expect(second.meshes[0]).not.toBe(first.meshes[0]);
    expect(second.meshes[0].skeleton).not.toBe(first.meshes[0].skeleton);
    expect(second.meshes[0].boundingSphere).not.toBe(first.meshes[0].boundingSphere);
    expect(wocArmorMergeInternalsForTest.cache.size).toBe(1);
    expect([...wocArmorMergeInternalsForTest.cache.values()][0].refs).toBe(2);
    // a part less on one of them: another buffer, and the first keeps its own
    part(c.model, 'Armor_Test_Waist').visible = false;
    second.sync(false);
    expect(second.pendingBuilt).toBe(false);
    second.mountPending();
    expect(second.meshes[0].geometry).not.toBe(first.meshes[0].geometry);
    expect(wocArmorMergeInternalsForTest.cache.size).toBe(2);
    expect([...wocArmorMergeInternalsForTest.cache.values()].map((e) => e.refs)).toEqual([1, 1]);
    // dropped: both stay built for the next wearer
    first.drop();
    second.drop();
    expect([...wocArmorMergeInternalsForTest.cache.values()].map((e) => e.refs)).toEqual([0, 0]);
    first.sync(false);
    expect(first.pendingBuilt).toBe(true);
  });

  it('records every mount as its own span, a built kit included', async () => {
    const set = freshSet();
    const a = body();
    const c = body();
    await wear(a, set);
    await wear(c, set);
    const spans: [string, number, number][] = [];
    setBuildSpanSink((kind, ms, at) => spans.push([kind, ms, at]));
    new WocArmorMergeRig(host(false), a.model).sync();
    new WocArmorMergeRig(host(false), c.model).sync();
    // the fold on the first, the per-mesh setup alone on the second: both the frame's
    expect(spans).toEqual([
      ['view:woc-armor-merge', 0, now],
      ['view:woc-armor-merge', 0, now],
    ]);
    // nothing to fold records nothing (the new set's own first attach names its prepare, a
    // step of whatever build paid it: woc_armor_packs.ts)
    const bare = body();
    await wear(bare, freshSet());
    for (const name of KIT_FOLDED) part(bare.model, name).visible = false;
    new WocArmorMergeRig(host(false), bare.model).sync();
    expect(spans.filter(([kind]) => kind === 'view:woc-armor-merge')).toHaveLength(2);
  });

  it('parks under an effect overlay that blends, and stands again when it ends, with no rebuild', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(true);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    h.settle();
    expect(rig.standing).toBe(true);
    const [merged] = rig.meshes;
    const wrapper = wrapperOf(b.model);
    // the visual's ghost run: a blended clone on EVERY mesh of the body, the merged one
    // too, and then its word that the effects changed (nothing here reads materials per
    // frame: until the host says so, a poll finds nothing to do)
    const ghost = overlay(allMeshes(b.model));
    rig.poll();
    expect(rig.standing).toBe(true);
    rig.effectsChanged();
    // the parts draw by themselves at once (three sorts blended meshes by depth, one
    // merged mesh cannot); the stand-in stays mounted, hidden
    expect(rig.standing).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    expect(wrapperOf(b.model)).toBe(wrapper);
    expect(wrapper?.visible).toBe(false);
    for (const name of KIT_FOLDED) expect(part(b.model, name).layers.mask).toBe(1);
    rig.poll();
    expect(rig.sync()).toBe(false);
    expect(rig.sync(false)).toBe(false);
    expect(rig.standing).toBe(false);
    // the overlay ends, the very materials the gate linked are back: it stands on the
    // next poll, with no second mount and no second trip through the gate
    ghost.lift();
    rig.effectsChanged();
    expect(rig.standing).toBe(false);
    rig.poll();
    expect(rig.standing).toBe(true);
    expect(rig.meshes[0]).toBe(merged);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.forget).not.toHaveBeenCalled();
    expect(wocArmorMergeInternalsForTest.cache.size).toBe(1);
  });

  it('goes back to its parts the moment the host says its effects changed, and never stands from there', async () => {
    const b = body();
    await wear(b, freshSet());
    const rig = new WocArmorMergeRig(host(false), b.model);
    rig.sync();
    // an edge that changes nothing it wears (a buff glow): it stays
    rig.effectsChanged();
    expect(rig.standing).toBe(true);
    const ghost = overlay(allMeshes(b.model));
    rig.effectsChanged();
    expect(rig.standing).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    // the overlay lifted inside the host's own material pass: the poll stands it, not this
    ghost.lift();
    rig.effectsChanged();
    expect(rig.standing).toBe(false);
    rig.poll();
    expect(rig.standing).toBe(true);
  });

  it('parks on its parts wearing an overlay too, whatever the host left on the merged meshes', async () => {
    const b = body();
    await wear(b, freshSet());
    const rig = new WocArmorMergeRig(host(false), b.model);
    rig.sync();
    // a host that mounts its overlay on the parts alone
    const ghost = overlay(KIT_FOLDED.map((name) => part(b.model, name)));
    rig.effectsChanged();
    expect(rig.standing).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    rig.poll();
    expect(rig.standing).toBe(false);
    ghost.lift();
    rig.effectsChanged();
    rig.poll();
    expect(rig.standing).toBe(true);
  });

  it('links again when it comes out of an overlay wearing other materials than the gate linked', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(true);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    h.settle();
    const ghost = overlay(allMeshes(b.model));
    rig.effectsChanged();
    ghost.lift();
    // a skin landed meanwhile: the merged mesh wears a material the gate never saw
    rig.meshes[0].material = (rig.meshes[0].material as THREE.Material).clone();
    rig.effectsChanged();
    rig.poll();
    expect(rig.standing).toBe(false);
    expect(h.reveal).toHaveBeenCalledTimes(2);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    h.settle();
    expect(rig.standing).toBe(true);
  });

  it('is born parked when the host mounts an overlay on it ahead of the parts, and never thrashes', async () => {
    const b = body();
    await wear(b, freshSet());
    // the visual mid-swap: the effect is asked for, its clones still link, so the parts
    // keep their opaque materials while a mesh adopted NOW is given the blended one
    const h = host(true);
    let ghosts: { lift(): void } | null = null;
    h.adopt.mockImplementation((node: THREE.Object3D) => {
      ghosts = overlay(allMeshes(node));
    });
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    expect(rig.standing).toBe(false);
    // mounted once, never sent through the gate, the parts drawing: and it stays so
    for (let frame = 0; frame < 6; frame++) rig.poll();
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(h.reveal).not.toHaveBeenCalled();
    expect(h.forget).not.toHaveBeenCalled();
    expect(wrapperOf(b.model)?.visible).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    // the swap commits: the parts wear the overlay too, and nothing changes
    const parts = overlay(KIT_FOLDED.map((name) => part(b.model, name)));
    rig.effectsChanged();
    rig.poll();
    expect(h.reveal).not.toHaveBeenCalled();
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    // the effect ends: everything opaque again, and only now does it link and stand
    parts.lift();
    (ghosts as { lift(): void } | null)?.lift();
    rig.effectsChanged();
    rig.poll();
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(rig.standing).toBe(false);
    h.settle();
    expect(rig.standing).toBe(true);
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('waits to mount while its parts wear an overlay, and never mounts under one', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(false);
    const rig = new WocArmorMergeRig(h, b.model);
    const ghost = overlay(allMeshes(b.model));
    // planned under the overlay: wanted, but nothing to ask a mount for yet
    expect(rig.sync()).toBe(false);
    expect(rig.isWaiting).toBe(true);
    expect(rig.mountable).toBe(false);
    expect(rig.mountPending()).toBe(false);
    expect(rig.isWaiting).toBe(true);
    expect(h.adopt).not.toHaveBeenCalled();
    // the overlay lifts, and the host says so: now there is a mount to ask for
    ghost.lift();
    expect(rig.mountable).toBe(false);
    rig.effectsChanged();
    expect(rig.mountable).toBe(true);
    expect(rig.mountPending()).toBe(true);
    expect(rig.standing).toBe(true);
  });

  it('leaves the parts drawing when an overlay went on while its programs linked', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(true);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    const ghost = overlay(rig.meshes);
    h.settle();
    // the gate showed the wrapper: hidden again at once, never beside its parts
    expect(rig.standing).toBe(false);
    expect(wrapperOf(b.model)?.visible).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    // what the gate linked while other materials were on is anyone's guess: once the
    // overlay lifts, what it wears then goes through the gate before it stands
    ghost.lift();
    rig.effectsChanged();
    rig.poll();
    expect(rig.standing).toBe(false);
    expect(h.reveal).toHaveBeenCalledTimes(2);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    h.settle();
    expect(rig.standing).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('never draws beside its parts when a link settles on materials that changed under it', async () => {
    const b = body();
    await wear(b, freshSet());
    // a gate that shows what it linked but hides nothing itself
    const h = host(true, false);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    // a skin landed while it linked: another opaque material, one the gate was not asked for
    rig.meshes[0].material = (rig.meshes[0].material as THREE.Material).clone();
    h.settle();
    // the gate showed the wrapper: hidden again before anything draws, and linked anew
    expect(rig.standing).toBe(false);
    expect(wrapperOf(b.model)?.visible).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    expect(h.reveal).toHaveBeenCalledTimes(2);
    h.settle();
    expect(rig.standing).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('gives a gate that could not prepare its programs one more try, then keeps its parts', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(true);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    h.settle(false);
    // not linked: drawing it now would link on a live frame, and the parts are right
    // there. It stays mounted, hidden, and is asked for again from the next poll
    expect(rig.standing).toBe(false);
    expect(wrapperOf(b.model)?.visible).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    expect(h.reveal).toHaveBeenCalledTimes(1);
    rig.poll();
    expect(h.reveal).toHaveBeenCalledTimes(2);
    rig.poll();
    expect(h.reveal).toHaveBeenCalledTimes(2);
    // twice running on the very materials it was asked with: left in its parts
    h.settle(false);
    expect(rig.standing).toBe(false);
    expect(wrapperOf(b.model)).toBeUndefined();
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    expect([...wocArmorMergeInternalsForTest.cache.values()].map((e) => e.refs)).toEqual([0]);
    // the same kit is not tried again under this gate, whatever is polled or synced...
    rig.poll();
    expect(rig.sync()).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(h.reveal).toHaveBeenCalledTimes(2);
    // ...another kit is, and so is this one once the gate is replaced
    part(b.model, 'Armor_Test_Waist').visible = false;
    expect(rig.sync()).toBe(true);
    h.settle();
    expect(rig.standing).toBe(true);
    part(b.model, 'Armor_Test_Waist').visible = true;
    expect(rig.sync()).toBe(true);
    expect(rig.standing).toBe(false);
    expect(wrapperOf(b.model)).toBeUndefined();
    rig.gateChanged();
    expect(rig.sync()).toBe(true);
    h.settle();
    expect(rig.standing).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('stands on the second try when the first link came back unprepared', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(true);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    const wrapper = wrapperOf(b.model);
    h.settle(false);
    rig.poll();
    h.settle();
    // the same stand-in, never taken down in between
    expect(rig.standing).toBe(true);
    expect(wrapperOf(b.model)).toBe(wrapper);
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('counts misses in a row: a link that settled proven, or a replaced gate, starts again', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(true);
    const rig = new WocArmorMergeRig(h, b.model);
    /** Park it under an overlay and bring it back wearing other materials, so it links again. */
    const relink = (): void => {
      const ghost = overlay(allMeshes(b.model));
      rig.effectsChanged();
      ghost.lift();
      for (const mesh of rig.meshes) mesh.material = (mesh.material as THREE.Material).clone();
      rig.effectsChanged();
      rig.poll();
    };
    rig.sync();
    // one miss, then a proven link: it stands, and the miss is forgotten
    h.settle(false);
    rig.poll();
    h.settle();
    expect(rig.standing).toBe(true);
    // the next miss is a first one again: asked once more, not left in its parts
    relink();
    h.settle(false);
    expect(wrapperOf(b.model)).toBeDefined();
    // a replaced gate forgets it too: its own first miss is not the second
    rig.gateChanged();
    rig.poll();
    h.settle(false);
    expect(wrapperOf(b.model)).toBeDefined();
    rig.poll();
    h.settle(false);
    expect(wrapperOf(b.model)).toBeUndefined();
    expect(rig.sync()).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
  });

  it("counts each kit's misses by themselves: another kit's first is not this one's second", async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(true);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    h.settle(false);
    // the kit changes before it is asked for again: the new one's first miss is a first
    part(b.model, 'Armor_Test_Waist').visible = false;
    expect(rig.sync()).toBe(true);
    const wrapper = wrapperOf(b.model);
    h.settle(false);
    expect(wrapperOf(b.model)).toBe(wrapper);
    rig.poll();
    h.settle();
    expect(rig.standing).toBe(true);
  });

  it('asks again when an effect edge during the link is why the proof reads unprepared', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(true);
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    const wrapper = wrapperOf(b.model);
    const plain = rig.meshes.map((mesh) => mesh.material);
    // A buff glow lands while the kit links: opaque clones the gate was never asked for,
    // which is all its proof reads when it settles. No verdict on the kit, however often.
    for (let edge = 0; edge < 3; edge++) {
      for (const mesh of rig.meshes) mesh.material = (mesh.material as THREE.Material).clone();
      rig.effectsChanged();
      h.settle(false);
      expect(wrapperOf(b.model)).toBe(wrapper);
      expect(wrapper?.visible).toBe(false);
      expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
      rig.poll();
      expect(h.reveal).toHaveBeenCalledTimes(edge + 2);
    }
    // the glow ends while the last ask is in flight: what it wears then is asked for, and
    // it stands on that
    rig.meshes.forEach((mesh, i) => {
      mesh.material = plain[i];
    });
    rig.effectsChanged();
    h.settle();
    expect(rig.standing).toBe(false);
    expect(h.reveal).toHaveBeenCalledTimes(5);
    h.settle();
    expect(rig.standing).toBe(true);
    expect(wrapperOf(b.model)).toBe(wrapper);
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  /** A gate whose settles the test keeps, one by one: it hides the node while it links and
   *  shows it BEFORE it calls back, exactly as the visual's reveal does. */
  function flightHost() {
    const flights: (() => void)[] = [];
    const h: WocArmorMergeHost = {
      adopt: () => undefined,
      forget: () => undefined,
      reveal: (node, live) => {
        node.visible = false;
        flights.push(() => {
          if (node.parent === null) return;
          node.visible = true;
          live?.(true);
        });
      },
    };
    return { h, flights };
  }

  it('asks a replaced gate again for a link that was still in flight', async () => {
    const b = body();
    await wear(b, freshSet());
    const { h, flights } = flightHost();
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    rig.poll();
    expect(flights).toHaveLength(1);
    rig.gateChanged();
    rig.poll();
    expect(flights).toHaveLength(2);
    // the old ask settles first (one lane, in order) and its gate shows the wrapper: it
    // is not this link's, so it is hidden again and the parts go on drawing alone
    flights[0]();
    expect(rig.standing).toBe(false);
    expect(wrapperOf(b.model)?.visible).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    flights[1]();
    expect(rig.standing).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('stays hidden when a replaced gate settles a stand-in that was parked meanwhile', async () => {
    const b = body();
    await wear(b, freshSet());
    const { h, flights } = flightHost();
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    expect(flights).toHaveLength(1);
    // the gate is replaced, then a blended overlay lands: parked, and nothing asked again
    rig.gateChanged();
    const ghost = overlay(allMeshes(b.model));
    rig.effectsChanged();
    rig.poll();
    expect(flights).toHaveLength(1);
    // the old ask settles and shows the wrapper: it would draw blended beside its parts
    flights[0]();
    expect(rig.standing).toBe(false);
    expect(wrapperOf(b.model)?.visible).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    // the overlay ends: linked through the new gate, then standing
    ghost.lift();
    rig.effectsChanged();
    rig.poll();
    expect(flights).toHaveLength(2);
    flights[1]();
    expect(rig.standing).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('leaves a standing stand-in alone when a replaced gate settles late', async () => {
    const b = body();
    await wear(b, freshSet());
    const { h, flights } = flightHost();
    const rig = new WocArmorMergeRig(h, b.model);
    rig.sync();
    flights[0]();
    expect(rig.standing).toBe(true);
    const linked = rig.meshes.map((mesh) => mesh.material);
    // parked under an overlay, it comes back wearing other materials (a skin landed
    // meanwhile): those go through the gate before it stands
    const ghost = overlay(allMeshes(b.model));
    rig.effectsChanged();
    ghost.lift();
    for (const mesh of rig.meshes) mesh.material = (mesh.material as THREE.Material).clone();
    rig.effectsChanged();
    rig.poll();
    expect(flights).toHaveLength(2);
    expect(rig.standing).toBe(false);
    // the skin goes back while that ask is in flight, and the gate is replaced: what it
    // wears again is what the first gate linked, so it stands without asking
    rig.meshes.forEach((mesh, i) => {
      mesh.material = linked[i];
    });
    rig.gateChanged();
    rig.poll();
    expect(rig.standing).toBe(true);
    expect(flights).toHaveLength(2);
    // the superseded ask settles late: it must not hide a stand-in whose parts stepped aside
    flights[1]();
    expect(rig.standing).toBe(true);
    expect(wrapperOf(b.model)?.visible).toBe(true);
    expect(drawnArmor(b.model)).toEqual(KIT_MERGED);
  });

  it('leaves the kit in its parts when the mount throws, and gives back what it took', async () => {
    const b = body();
    await wear(b, freshSet());
    const h = host(false);
    h.adopt.mockImplementation(() => {
      throw new Error('adopt failed');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rig = new WocArmorMergeRig(h, b.model);
    // nothing escapes into the per-frame path that asked
    expect(rig.sync()).toBe(false);
    expect(rig.standing).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(rig.meshes).toEqual([]);
    expect(wrapperOf(b.model)).toBeUndefined();
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    expect([...wocArmorMergeInternalsForTest.cache.values()].map((e) => e.refs)).toEqual([0]);
    expect(logged).toHaveBeenCalledTimes(1);
    // ...and it is not tried again on every frame after
    h.adopt.mockImplementation(() => undefined);
    expect(rig.sync()).toBe(false);
    expect(rig.sync(false)).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(h.adopt).toHaveBeenCalledTimes(1);
  });

  it('mounts nothing for a kit with nothing to fold, and takes everything down on dispose', async () => {
    const b = body();
    await wear(b, freshSet());
    for (const name of KIT_FOLDED.slice(1)) part(b.model, name).visible = false;
    const h = host(false);
    const rig = new WocArmorMergeRig(h, b.model);
    expect(rig.sync()).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(wrapperOf(b.model)).toBeUndefined();
    expect(h.adopt).not.toHaveBeenCalled();
    for (const name of KIT_FOLDED) part(b.model, name).visible = true;
    rig.sync();
    expect(rig.standing).toBe(true);
    rig.dispose();
    expect(rig.standing).toBe(false);
    expect(rig.isWaiting).toBe(false);
    expect(drawnArmor(b.model)).toEqual(KIT_DRAWN);
    expect([...wocArmorMergeInternalsForTest.cache.values()].map((e) => e.refs)).toEqual([0]);
    // a model with no rig at all has nothing to bind a merged mesh to
    const bare = new WocArmorMergeRig(host(false), new THREE.Group());
    expect(bare.sync()).toBe(false);
    expect(bare.isWaiting).toBe(false);
  });
});
