// The far bake's head fold (src/render/characters/woc_far_head.ts) on real three
// objects, no bake and no visual: which hung head meshes of a bake's walk the merged
// material draws and with which slot (the piece a mesh belongs to comes from its piece
// NODE, never its own name), the white-cell uv a flat-coloured piece is handed on a
// scratch geometry (posed positions kept, the pack's geometry untouched), the textures
// and slot sources the tint needs, the walks that fold nothing, and the per-vertex slot
// attribute written in the order the bake laid the vertices out.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
}));

import {
  foldWocHeadForBake,
  poseWocHeadForBake,
  setWocFarHeadSlots,
} from '../src/render/characters/woc_far_head';
import { wocHeadAllUrls } from '../src/render/characters/woc_head_catalog';
import { wocHeadMergedSource } from '../src/render/characters/woc_head_merge';
import { WOC_HEAD_MERGE_LAYER } from '../src/render/characters/woc_head_merge_core';
import {
  hangWocHead,
  resetWocHeadFilesForTest,
  setWocHeadFileForTest,
  type WocHeadRig,
  wocHeadFileMaterial,
} from '../src/render/characters/woc_head_packs';
import { splitHeadScenes } from './helpers/woc_head_split_fixture';

const BASE = 'WocHead_A_base';
const NOSE = 'WocHead_A_nose_default';
const EYE_L = 'WocHead_A_eyes_default_L';
const EYE_R = 'WocHead_A_eyes_default_R';
const QUIFF = 'WocHead_A_hair_quiff';
const BEARD = 'WocHead_A_beard_boxed';
const RING = 'WocHead_A_piercing_lip';
/** The core atlas's white cell, as the build records it on every core material. */
const WHITE = [0.75, 0.25] as const;
/** The liner's own morph delta (along y). */
const LINER_LIFT = 0.5;

function texture(name: string): THREE.Texture {
  const t = new THREE.Texture();
  t.name = name;
  return t;
}

/** `count` vertices as a strip of triangles (indexed), at x = `x`. */
function strip(count: number, x = 0, uv = true): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) position.set([x, i, 0], i * 3);
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2).fill(0.5), 2));
  const index: number[] = [];
  for (let i = 0; i + 2 < count; i++) index.push(i, i + 1, i + 2);
  g.setIndex(index);
  return g;
}

interface Kit {
  readonly atlas: THREE.Texture;
  readonly liner: THREE.MeshStandardMaterial;
  /** Pieces kept out of the fold by an alpha cut-out. */
  readonly cutout: ReadonlySet<string>;
}

function coreMaterial(name: string, kit: Kit, piece: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name, map: kit.atlas });
  if (kit.cutout.has(piece)) m.alphaTest = 0.5;
  m.userData.wocHeadAtlas = { white: [...WHITE] };
  return m;
}

function named<T extends THREE.Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

/** One of Type A's pieces, shaped like the shipped files. A piece of several materials
 *  is a NODE named for the piece holding meshes named for something else (a loader
 *  names them after the mesh), and no two meshes have the same vertex count. */
function piece(name: string, kit: Kit): THREE.Object3D {
  const slot = /^WocHead_A_([a-z]+)/.exec(name)?.[1] ?? '';
  if (name === QUIFF) {
    const node = named(new THREE.Group(), name);
    const cut = new THREE.MeshStandardMaterial({ name: 'hair_quiff', map: texture('cut') });
    const cap = new THREE.MeshStandardMaterial({ name: 'hair_quiff_scalp', map: texture('cap') });
    node.add(named(new THREE.Mesh(strip(7), cut), 'mesh_40'));
    node.add(named(new THREE.Mesh(strip(4), cap), 'mesh_40_1'));
    return node;
  }
  if (slot === 'hair' || slot === 'beard') {
    const m = new THREE.MeshStandardMaterial({ name: `hair_${name}`, map: texture(name) });
    return named(new THREE.Mesh(strip(6), m), name);
  }
  if (slot === 'piercing') {
    // the gold's name earns the worn metal layer on the tier derivation: never folded
    const gold = new THREE.MeshStandardMaterial({ name: 'metal_gold' });
    gold.userData.wocHeadAtlas = { white: [...WHITE] };
    return named(new THREE.Mesh(strip(3, 0, false), gold), name);
  }
  if (slot === 'eyes') {
    const node = named(new THREE.Group(), name);
    node.add(named(new THREE.Mesh(strip(5), coreMaterial(`eye_${name}`, kit, name)), 'mesh_7'));
    // the liner: flat-coloured, no uv, one material for both eyes, and a morph of its own
    const g = strip(name.endsWith('_L') ? 8 : 9, 0, false);
    const lift = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 1; i < lift.length; i += 3) lift[i] = LINER_LIFT;
    g.morphAttributes.position = [new THREE.BufferAttribute(lift, 3)];
    g.morphTargetsRelative = true;
    const liner = named(new THREE.Mesh(g, kit.liner), 'mesh_7_1');
    liner.morphTargetDictionary = { FS_Chin_Softness: 0 };
    liner.morphTargetInfluences = [0];
    node.add(liner);
    return node;
  }
  const count = name === BASE ? 12 : 10;
  return named(new THREE.Mesh(strip(count), coreMaterial(`skin_${name}`, kit, name)), name);
}

/** A base-like model: a skinned body on a two-bone rig. */
function model(): THREE.Object3D {
  const root = new THREE.Group();
  const hips = named(new THREE.Bone(), 'hips');
  const head = named(new THREE.Bone(), 'head');
  hips.add(head);
  root.add(hips);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4),
  );
  const body = named(
    new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial()),
    'Character_Body',
  );
  root.add(body);
  root.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([hips, head]));
  return root;
}

/** A model with Type A's whole library hung, the pieces named in `shown` drawn. */
function dressed(shown: readonly string[], cutout: readonly string[] = []) {
  const liner = new THREE.MeshStandardMaterial({ name: 'liner' });
  liner.userData.wocHeadAtlas = { white: [...WHITE] };
  const kit: Kit = { atlas: texture('atlas'), liner, cutout: new Set(cutout) };
  const library = splitHeadScenes('a', (name) => piece(name, kit));
  for (const url of wocHeadAllUrls('a')) setWocHeadFileForTest(url, library.get(url) ?? null);
  const root = model();
  const rig = hangWocHead(root, 'a') as WocHeadRig;
  for (const [name, node] of rig.pieces) node.visible = shown.includes(name);
  /** The bake's walk: every drawn mesh of the model, in traversal order. */
  const walk = (): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (!p.visible) return;
      out.push(mesh);
    });
    return out;
  };
  /** The meshes of one drawn piece, in order. */
  const meshesOf = (name: string): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    rig.pieces.get(name)?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  };
  return { root, rig, kit, walk, meshesOf };
}

const LOOK = [BASE, NOSE, EYE_L, EYE_R, QUIFF, BEARD, RING];

beforeEach(() => resetWocHeadFilesForTest());
afterEach(() => resetWocHeadFilesForTest());

describe('foldWocHeadForBake', () => {
  it('folds nothing on a model with no hung head', () => {
    const scratch: THREE.BufferGeometry[] = [];
    expect(foldWocHeadForBake(model(), [], scratch)).toBeNull();
    expect(scratch).toEqual([]);
  });

  it('gives every drawn mesh the merged material can draw a slot, one per material', () => {
    const d = dressed(LOOK);
    const fold = foldWocHeadForBake(d.root, d.walk(), []);
    if (!fold) throw new Error('nothing folded');
    const [base] = d.meshesOf(BASE);
    const [nose] = d.meshesOf(NOSE);
    const [ballL, linerL] = d.meshesOf(EYE_L);
    const [ballR, linerR] = d.meshesOf(EYE_R);
    const [cut, cap] = d.meshesOf(QUIFF);
    const [beard] = d.meshesOf(BEARD);
    const [ring] = d.meshesOf(RING);
    const [body] = d.walk().filter((m) => m.name === 'Character_Body');
    // every head mesh but the piercing folds; the body is not a head mesh at all
    const folded = [base, nose, ballL, linerL, ballR, linerR, cut, cap, beard];
    expect([...fold.slotOf.keys()].sort((a, b) => a.id - b.id)).toEqual(
      [...folded].sort((a, b) => a.id - b.id),
    );
    expect(fold.slotOf.has(ring)).toBe(false);
    expect(fold.slotOf.has(body)).toBe(false);
    // the two liners share one material, and so one slot: eight slots for nine meshes
    expect(fold.slotOf.get(linerR)).toBe(fold.slotOf.get(linerL));
    expect(new Set(fold.slotOf.values()).size).toBe(8);
    expect(fold.slots).toHaveLength(8);
    // one source per slot, the very file material its meshes hang with
    expect(fold.slotSources).toHaveLength(8);
    for (const mesh of folded) {
      const at = fold.slotOf.get(mesh) ?? -1;
      expect(fold.slotSources[at], mesh.name).toBe(wocHeadFileMaterial(mesh));
      expect(fold.slots[at].material, mesh.name).toBe(wocHeadFileMaterial(mesh)?.uuid);
    }
    // the group draws with the merged source of the base head's own material
    const baseMaterial = wocHeadFileMaterial(base);
    if (!baseMaterial) throw new Error('the base head has no file material');
    expect(fold.source).toBe(wocHeadMergedSource(baseMaterial));
    expect(fold.source).not.toBe(baseMaterial);
  });

  it("takes a mesh's piece from its piece node, never from the mesh's own name", () => {
    const d = dressed(LOOK);
    const fold = foldWocHeadForBake(d.root, d.walk(), []);
    if (!fold) throw new Error('nothing folded');
    const [cut, cap] = d.meshesOf(QUIFF);
    // the hairstyle's two meshes are named for their glTF mesh, not for the hair piece:
    // read by their own names they would look like core pieces on the wrong texture
    expect([cut.name, cap.name]).toEqual(['mesh_40', 'mesh_40_1']);
    expect(fold.slots[fold.slotOf.get(cut) ?? -1].layer).toBe(WOC_HEAD_MERGE_LAYER.hair);
    expect(fold.slots[fold.slotOf.get(cap) ?? -1].layer).toBe(WOC_HEAD_MERGE_LAYER.scalp);
    expect(fold.hairMap?.name).toBe('cut');
    expect(fold.scalpMap?.name).toBe('cap');
    expect(fold.beardMap?.name).toBe(BEARD);
    const [beard] = d.meshesOf(BEARD);
    expect(fold.slots[fold.slotOf.get(beard) ?? -1].layer).toBe(WOC_HEAD_MERGE_LAYER.beard);
    const [ball] = d.meshesOf(EYE_L);
    expect(fold.slots[fold.slotOf.get(ball) ?? -1].layer).toBe(WOC_HEAD_MERGE_LAYER.atlas);
  });

  it('hands a flat-coloured piece the white cell on a scratch geometry, its posed positions kept', () => {
    const d = dressed(LOOK);
    const [, linerL] = d.meshesOf(EYE_L);
    const [, linerR] = d.meshesOf(EYE_R);
    const packL = linerL.geometry;
    // the far pose first, as the bake runs it: the liner's own morph is baked into a
    // scratch of its positions
    const scratch = poseWocHeadForBake(d.root, { morphs: { FS_Chin_Softness: 1 }, key: 'chin' });
    const posed = linerL.geometry;
    expect(posed).not.toBe(packL);
    const before = scratch.length;
    const fold = foldWocHeadForBake(d.root, d.walk(), scratch);
    if (!fold) throw new Error('nothing folded');
    // one more scratch per flat mesh, and the caller disposes them with the pose's
    expect(scratch).toHaveLength(before + 2);
    expect(scratch).toContain(linerL.geometry);
    expect(scratch).toContain(linerR.geometry);
    for (const liner of [linerL, linerR]) {
      const uv = liner.geometry.getAttribute('uv');
      const count = liner.geometry.getAttribute('position').count;
      expect(uv.count).toBe(count);
      expect(Array.from(uv.array)).toEqual(Array.from({ length: count }, () => [...WHITE]).flat());
    }
    // the posed positions ride along by reference, and the index with them
    expect(linerL.geometry).not.toBe(posed);
    expect(linerL.geometry.getAttribute('position')).toBe(posed.getAttribute('position'));
    expect(linerL.geometry.getAttribute('position').getY(0)).toBe(LINER_LIFT);
    expect(linerL.geometry.index).toBe(packL.index);
    // the pack's own geometry, shared by every character, is never written
    expect(packL.getAttribute('uv')).toBeUndefined();
    expect(packL.getAttribute('position').getY(0)).toBe(0);
    // a textured piece keeps the geometry it was posed with
    const [base] = d.meshesOf(BASE);
    expect(scratch).not.toContain(base.geometry);
  });

  it('folds only what the walk draws', () => {
    const d = dressed(LOOK);
    const [beard] = d.meshesOf(BEARD);
    // the beard is hung and visible, but this walk leaves it out (a caster-only bake)
    const walk = d.walk().filter((m) => m !== beard);
    const fold = foldWocHeadForBake(d.root, walk, []);
    expect(fold?.slotOf.has(beard)).toBe(false);
    expect(fold?.beardMap).toBeNull();
    expect(fold?.slots).toHaveLength(7);
    // a piece hung but not shown is not in any walk
    const bare = dressed([BASE, NOSE]);
    const hidden = bare.meshesOf(QUIFF);
    const folded = foldWocHeadForBake(bare.root, bare.walk(), []);
    expect(folded?.slots).toHaveLength(2);
    expect(hidden.some((m) => folded?.slotOf.has(m))).toBe(false);
    expect(folded?.hairMap).toBeNull();
  });

  it('folds nothing, and makes no scratch, when the rule refuses the head', () => {
    // the base head is the merged material's source: cut out, nothing folds
    const cut = dressed(LOOK, [BASE]);
    const scratch: THREE.BufferGeometry[] = [];
    const [, liner] = cut.meshesOf(EYE_L);
    const pack = liner.geometry;
    expect(foldWocHeadForBake(cut.root, cut.walk(), scratch)).toBeNull();
    expect(scratch).toEqual([]);
    expect(liner.geometry).toBe(pack);
    // one piece is nothing to merge
    const alone = dressed([BASE]);
    expect(foldWocHeadForBake(alone.root, alone.walk(), scratch)).toBeNull();
    // and a head with no base drawn has no source to merge onto
    const headless = dressed([NOSE, QUIFF, BEARD]);
    expect(foldWocHeadForBake(headless.root, headless.walk(), scratch)).toBeNull();
    expect(scratch).toEqual([]);
  });
});

describe('setWocFarHeadSlots', () => {
  it('writes each mesh its slot over ITS vertices, in the order the bake laid them out', () => {
    // three sources of 3, 5 and 2 vertices; the bake merged the first and the last
    // together (one group), so the middle one's vertices come after both
    const meshes = [3, 5, 2].map((count) => new THREE.Mesh(strip(count)));
    const slotOf = new Map<THREE.Mesh, number>([
      [meshes[0], 2],
      [meshes[2], 1],
    ]);
    const geo = strip(10);
    setWocFarHeadSlots(geo, meshes, [0, 2, 1], slotOf);
    const slot = geo.getAttribute('aWocHmSlot');
    expect(Array.from(slot.array)).toEqual([2, 2, 2, 1, 1, 0, 0, 0, 0, 0]);
    // one unsigned byte per vertex, read as the number it is
    expect(slot.array).toBeInstanceOf(Uint8Array);
    expect(slot.itemSize).toBe(1);
    expect(slot.normalized).toBe(false);
    expect(slot.count).toBe(geo.getAttribute('position').count);
  });

  it('reads the vertex counts off the geometries the bake read (a scratch included)', () => {
    const meshes = [new THREE.Mesh(strip(4)), new THREE.Mesh(strip(6))];
    // the second mesh was handed a scratch (a flat piece) before the bake: same count
    meshes[1].geometry = strip(6, 0, false);
    const geo = strip(10);
    setWocFarHeadSlots(geo, meshes, [1, 0], new Map([[meshes[1], 3]]));
    expect(Array.from(geo.getAttribute('aWocHmSlot').array)).toEqual([
      3, 3, 3, 3, 3, 3, 0, 0, 0, 0,
    ]);
  });
});
