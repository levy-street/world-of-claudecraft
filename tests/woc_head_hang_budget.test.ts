// What a WOC body carries of its head, counted on the SHIPPED library (S2 of the PR 4360
// review): every file's node and primitive structure is read off its own GLB JSON chunk
// and rebuilt as a structural replica (one piece node per shipped node, one mesh per
// primitive, the shipped material names and sharing), hung on a replica of the shipped
// base rig through the REAL store and dressing (woc_head_packs.ts, woc_head_dressing.ts).
//
// Before the change a body hung every resident file of its type whole (hangWocHead with
// the type's whole library, which is what assembleModel's step did): reproduced here as
// the "before" arm, on the same replicas. After it, a body hangs the pieces its look
// draws. Measured on the files shipped with the PR (2026-10-05), a world body in its
// type's default look, the whole library resident:
//
//   Type A (male):   head   90 nodes / 67 meshes / 38 tint clones  ->  18 / 13 / 14
//   Type B (female): head  106 nodes / 80 meshes / 41 tint clones  ->  18 / 14 / 13
//   whole body (the 36 nodes of the base rig and body, bare of armor):
//                    A 126 nodes / 68 meshes -> 54 / 14,   B 142 / 81 -> 54 / 15
//
// (nodes: every Object3D under the head bone, wrappers, piece nodes and meshes; a tint
// clone is counted per file material, which is what the tier derivation keeps for these
// files: every piece of a slot shares one material and one program shape.)
//
// The pins below hold the AFTER arm to exactly what a look draws, for every variant of
// every slot, and to a ceiling for the heaviest look the catalog can build, so a change
// that lets undrawn pieces back into the graph fails here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
}));

import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import { wocBaseUrl } from '../src/render/characters/woc_armor_core';
import {
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_IDS,
  WOC_PIERCING_PRESETS,
  type WocHeadLook,
  type WocHeadType,
  wocHeadAllUrls,
  wocHeadPiercingNode,
  wocHeadVariantNodes,
  wocHeadVisibleNodes,
} from '../src/render/characters/woc_head_catalog';
import {
  WocHeadDressing,
  type WocHeadDressingHost,
  wocHeadTintTarget,
} from '../src/render/characters/woc_head_dressing';
import {
  hangWocHead,
  hangWocHeadAtBuild,
  resetWocHeadFilesForTest,
  setWocHeadFileForTest,
  wocHeadFileMaterial,
} from '../src/render/characters/woc_head_packs';

const TYPES: WocHeadType[] = ['a', 'b'];

interface GlbJson {
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; mesh?: number; skin?: number; children?: number[] }[];
  meshes?: { primitives: { material?: number }[] }[];
  materials?: { name?: string; doubleSided?: boolean }[];
  skins?: { joints: number[] }[];
}

/** The JSON chunk of a GLB served from public/. */
function glbJson(url: string): GlbJson {
  const buf = readFileSync(path.resolve(__dirname, '..', 'public', url));
  expect(buf.readUInt32LE(0), `${url}: GLB magic`).toBe(0x46546c67);
  expect(buf.readUInt32LE(16), `${url}: first chunk is JSON`).toBe(0x4e4f534a);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

/** GLTFLoader's node-name sanitizing, as far as these files need it (`handslot.l`). */
const sanitized = (name: string | undefined): string => (name ?? '').replace(/[.\s]/g, '');

const TINY = new THREE.BoxGeometry(0.01, 0.01, 0.01);

/**
 * A structural replica of one shipped head file: a `head` node carrying one piece node
 * per shipped `WocHead_` node, a mesh per primitive (a node of several primitives is a
 * group of them, as GLTFLoader builds it), on one material object per shipped material,
 * shared exactly as the file shares it. Also what each piece weighs in the graph.
 */
function replicaFile(url: string): { gltf: GLTF; meshesOf: Map<string, number> } {
  const json = glbJson(url);
  const materials = (json.materials ?? []).map((m) => {
    const out = new THREE.MeshStandardMaterial({ name: m.name ?? '' });
    out.side = m.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    return out;
  });
  const scene = new THREE.Group();
  const head = new THREE.Object3D();
  head.name = 'head';
  scene.add(head);
  const meshesOf = new Map<string, number>();
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined || !node.name?.startsWith('WocHead_')) continue;
    const prims = json.meshes?.[node.mesh]?.primitives ?? [];
    const mesh = (at: number): THREE.Mesh => {
      const material = materials[prims[at].material ?? -1] ?? new THREE.MeshStandardMaterial();
      return new THREE.Mesh(TINY, material);
    };
    let piece: THREE.Object3D;
    if (prims.length === 1) piece = mesh(0);
    else {
      piece = new THREE.Group();
      prims.forEach((_, at) => {
        const child = mesh(at);
        child.name = `${node.name}_${at}`;
        piece.add(child);
      });
    }
    piece.name = node.name;
    head.add(piece);
    meshesOf.set(node.name, prims.length);
  }
  return { gltf: { scene, animations: [] } as unknown as GLTF, meshesOf };
}

/** A structural replica of a shipped base file: its whole node hierarchy (the rig's
 *  joints as bones) with its body as a skinned mesh bound to them. */
function replicaBase(fit: 'male' | 'female'): THREE.Object3D {
  const json = glbJson(wocBaseUrl(fit));
  const nodes = json.nodes ?? [];
  const joints = new Set(json.skins?.[0]?.joints ?? []);
  const objects = nodes.map((node, at) => {
    let out: THREE.Object3D;
    if (node.mesh !== undefined) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const count = geometry.getAttribute('position').count;
      geometry.setAttribute(
        'skinIndex',
        new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
      );
      const weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) weights[i * 4] = 1;
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      out = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ name: 'body' }));
    } else out = joints.has(at) ? new THREE.Bone() : new THREE.Group();
    out.name = sanitized(node.name);
    return out;
  });
  nodes.forEach((node, at) => {
    for (const child of node.children ?? []) objects[at].add(objects[child]);
  });
  const root = objects[json.scenes?.[0]?.nodes?.[0] ?? 0];
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([...joints].map((at) => objects[at] as THREE.Bone));
  for (const object of objects) {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) (object as THREE.SkinnedMesh).bind(skeleton);
  }
  return root;
}

/** One type's shipped library, resident, with each piece's mesh count. */
function install(type: WocHeadType): Map<string, number> {
  const meshesOf = new Map<string, number>();
  for (const url of wocHeadAllUrls(type)) {
    const file = replicaFile(url);
    setWocHeadFileForTest(url, file.gltf);
    for (const [name, n] of file.meshesOf) meshesOf.set(name, n);
  }
  return meshesOf;
}

/** What a model carries: every node and mesh of the whole body, and of its head alone
 *  (everything under the `head` bone). */
function census(model: THREE.Object3D) {
  const count = (root: THREE.Object3D) => {
    let nodes = 0;
    let meshes = 0;
    root.traverse((o) => {
      nodes++;
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    return { nodes, meshes };
  };
  const head = model.getObjectByName('head');
  if (!head) throw new Error('the base rig has no head bone');
  const under = count(head);
  // the bone itself is the rig's
  return { body: count(model), head: { nodes: under.nodes - 1, meshes: under.meshes } };
}

const fakeHost = (model: THREE.Object3D): WocHeadDressingHost => ({
  model,
  adopt: (_node, retint) => retint(),
  forget: () => undefined,
  reveal: (_node, live) => live(true),
  relive: () => undefined,
  baseMaterial: (mesh) => mesh.material,
  rigDrawn: () => true,
});

const fitOf = (type: WocHeadType): 'male' | 'female' => WOC_HEAD_TYPES[type].fit;
const appOf = (type: WocHeadType, look: WocHeadLook): Record<string, unknown> => ({
  ...DEFAULT_APPEARANCE,
  gender: fitOf(type),
  headHair: look.hair,
  headBeard: look.beard,
  headNose: look.nose,
  headMouth: look.mouth,
  headBrows: look.brows,
  headEars: look.ears,
  headEyes: look.eyes,
  headPiercing: look.piercing,
});

/** BEFORE: the body as it was built, every resident file of its type hung whole, and the
 *  tint clones its dressing then wrapped (one per tinted material on the model). */
function carriedBefore(type: WocHeadType) {
  const model = replicaBase(fitOf(type));
  hangWocHead(model, type);
  return { ...census(model), tintClones: tintedMaterials(model, type) };
}

/** How many tint clones a dressing wraps for what is ON `model`: one per tinted material
 *  (the dressing's own clone key: source material, role, surface, reference). The old
 *  dressing wrapped the whole hung library this way; the BEFORE arm is that rule applied
 *  to the model as it used to be built, since that dressing no longer exists to be run. */
function tintedMaterials(model: THREE.Object3D, type: WocHeadType): number {
  const wraps = new Set<string>();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const tint = wocHeadTintTarget(mesh, type);
    if (!tint) return;
    const source = wocHeadFileMaterial(mesh) ?? (mesh.material as THREE.Material);
    wraps.add(`${source.uuid}|${tint.role}|${tint.surface ?? ''}|${tint.ref.join(',')}`);
  });
  return wraps.size;
}

/** AFTER: a world body in `look`, born and dressed as the world view does it. */
function carriedAfter(type: WocHeadType, look: WocHeadLook) {
  const model = replicaBase(fitOf(type));
  const app = appOf(type, look);
  hangWocHeadAtBuild(model, fitOf(type), 'lod0', app);
  // what the build itself hung, before any dressing pass could take a piece off again
  const built = census(model).head;
  const dressing = new WocHeadDressing(fakeHost(model), type, 'lod0', app);
  dressing.retint();
  dressing.setBareStandIn(true);
  dressing.setAppearance(app);
  expect(dressing.isLive, JSON.stringify(look)).toBe(true);
  const dressed = census(model);
  // the build hangs the look and nothing else: the dressing has nothing to prune
  expect(built, JSON.stringify(look)).toEqual(dressed.head);
  return {
    ...dressed,
    tintClones: dressing.tintClones,
    tinted: tintedMaterials(model, type),
    drawn: dressing.drawnNames,
  };
}

/** The heaviest look a type's catalog can build: per slot the variant of most meshes,
 *  and the piercing preset of most. */
function heaviestLook(type: WocHeadType, meshesOf: ReadonlyMap<string, number>): WocHeadLook {
  const weigh = (nodes: readonly string[]): number =>
    nodes.reduce((n, node) => n + (meshesOf.get(node) ?? 0), 0);
  const look = { ...WOC_HEAD_TYPES[type].defaults };
  for (const slot of WOC_HEAD_SLOTS) {
    let best = -1;
    for (const v of WOC_HEAD_TYPES[type].slots[slot]) {
      const weight = weigh(wocHeadVariantNodes(type, slot, v.id));
      if (weight > best) {
        best = weight;
        look[slot] = v.id;
      }
    }
  }
  let best = -1;
  for (const id of WOC_PIERCING_IDS) {
    const weight = weigh(WOC_PIERCING_PRESETS[id].map((site) => wocHeadPiercingNode(type, site)));
    if (weight > best) {
      best = weight;
      look.piercing = id;
    }
  }
  return look;
}

/**
 * The ceilings: the head of the heaviest look either type's catalog can build today
 * (Type B's: its nine face pieces, the eyes three primitives each, a two primitive
 * hairstyle, a beard, seven piercings, three wrappers). Lower them when the library
 * sheds meshes; a pin that has to go UP because undrawn pieces came back into the graph
 * is the regression this file exists for.
 */
const HEAD_MESH_CEILING = 23;
const HEAD_NODE_CEILING = 29;

afterEach(() => resetWocHeadFilesForTest());

describe('what a WOC world body carries of the shipped head library', () => {
  it.each(TYPES)(
    'Type %s: the default look hangs its own pieces, a fraction of what a body used to carry',
    (type) => {
      const meshesOf = install(type);
      const was = carriedBefore(type);
      const now = carriedAfter(type, WOC_HEAD_TYPES[type].defaults);
      // before: the whole library, every piece of every file
      expect(was.head.meshes).toBe([...meshesOf.values()].reduce((a, b) => a + b, 0));
      // after: exactly the meshes of the pieces the look draws
      const drawn = wocHeadVisibleNodes(type, WOC_HEAD_TYPES[type].defaults, { helm: false });
      expect([...now.drawn].sort()).toEqual([...drawn].sort());
      expect(now.head.meshes).toBe(drawn.reduce((n, node) => n + (meshesOf.get(node) ?? 0), 0));
      // the numbers this file's header reports (re-measure it when they move)
      const report = `${was.head.nodes}/${was.head.meshes}/${was.tintClones} -> ${now.head.nodes}/${now.head.meshes}/${now.tintClones}`;
      expect(report).toBe(type === 'a' ? '90/67/38 -> 18/13/14' : '106/80/41 -> 18/14/13');
      expect(`${was.body.nodes}/${was.body.meshes} -> ${now.body.nodes}/${now.body.meshes}`).toBe(
        type === 'a' ? '126/68 -> 54/14' : '142/81 -> 54/15',
      );
      // at least four in five of the head's nodes, meshes and half its tint clones are gone
      expect(now.head.meshes * 4).toBeLessThan(was.head.meshes);
      expect(now.head.nodes * 4).toBeLessThan(was.head.nodes);
      expect(now.tintClones * 2).toBeLessThan(was.tintClones);
      expect(now.head.meshes).toBeLessThanOrEqual(HEAD_MESH_CEILING);
      expect(now.head.nodes).toBeLessThanOrEqual(HEAD_NODE_CEILING);
    },
  );

  it.each(TYPES)(
    'Type %s: every variant of every slot hangs exactly what it draws, never a piece more',
    (type) => {
      const meshesOf = install(type);
      const def = WOC_HEAD_TYPES[type];
      const looks: WocHeadLook[] = [];
      for (const slot of WOC_HEAD_SLOTS) {
        for (const v of def.slots[slot]) looks.push({ ...def.defaults, [slot]: v.id });
      }
      for (const id of WOC_PIERCING_IDS) looks.push({ ...def.defaults, piercing: id });
      expect(looks.length).toBeGreaterThan(30);
      for (const look of looks) {
        const now = carriedAfter(type, look);
        const drawn = wocHeadVisibleNodes(type, look, { helm: false });
        const label = JSON.stringify(look);
        expect([...now.drawn].sort(), label).toEqual([...drawn].sort());
        expect(now.head.meshes, label).toBe(
          drawn.reduce((n, node) => n + (meshesOf.get(node) ?? 0), 0),
        );
        // a wrapper per file of the look, a node per piece, a mesh per primitive of a piece
        // of several: nothing else under the head bone
        const files = 1 + (look.hair === 'bald' ? 0 : 1) + (look.beard === 'none' ? 0 : 1);
        const groups = drawn.filter((node) => (meshesOf.get(node) ?? 0) > 1);
        expect(now.head.nodes, label).toBe(
          files + drawn.length + groups.reduce((n, node) => n + (meshesOf.get(node) ?? 0), 0),
        );
        expect(now.head.meshes, label).toBeLessThanOrEqual(HEAD_MESH_CEILING);
        expect(now.head.nodes, label).toBeLessThanOrEqual(HEAD_NODE_CEILING);
        // exactly a tint clone per tinted material on the body (its own skin included):
        // none kept for a piece that is not hung, so never the library's
        expect(now.tintClones, label).toBe(now.tinted);
        expect(now.tintClones, label).toBeLessThanOrEqual(1 + now.head.meshes);
      }
    },
  );

  it('the heaviest look either catalog can build IS the ceiling, a third of what every body used to carry', () => {
    const heaviest = TYPES.map((type) => {
      const meshesOf = install(type);
      const now = carriedAfter(type, heaviestLook(type, meshesOf));
      const was = carriedBefore(type);
      // even the heaviest look is under a third of what every body of its type carried
      expect(now.head.meshes * 3, type).toBeLessThan(was.head.meshes);
      expect(now.head.nodes * 3, type).toBeLessThan(was.head.nodes);
      resetWocHeadFilesForTest();
      return now.head;
    });
    // a ceiling with slack to spare pins nothing: it is the measured worst case exactly
    expect(Math.max(...heaviest.map((head) => head.meshes))).toBe(HEAD_MESH_CEILING);
    expect(Math.max(...heaviest.map((head) => head.nodes))).toBe(HEAD_NODE_CEILING);
  });
});
