// A REAL CharacterVisual on a fixture WOC body, with only asset IO stubbed: the shared
// harness of the suites that drive the visual.ts host itself (the far LOD's head in
// tests/woc_far_lod_head.test.ts, the merged draws in tests/woc_merge_visual.test.ts).
// The loader is mocked to hand back fixture scenes (a two-bone base ending at the neck,
// an armor file, Type A's SPLIT head library through woc_head_split_fixture.ts), the
// fixture manifest is installed on one visual key, and every module the visual reaches
// is imported fresh, so each harness is its own module world: its own caches, its own
// linked-program records, its own clock.
//
// A consumer is a happy-dom suite (`// @vitest-environment happy-dom`), calls
// `wocVisualHarness()` per case and `releaseWocVisualHarness()` in its afterEach.
import * as THREE from 'three';
import { expect, vi } from 'vitest';
import type { WocCharacterManifest } from '../../src/render/characters/woc_character_manifest';
import { wocHeadAllUrls } from '../../src/render/characters/woc_head_catalog';
import type { Entity } from '../../src/sim/types';
import { splitHeadScene, wocHeadNodesByFile } from './woc_head_split_fixture';

/** The visual key the fixture body is installed on. */
export const KEY = 'player_paladin';

/** A standing idle frame (armory_preview.ts IDLE_STATE). */
export const IDLE = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
} as never;

/** The fixture body: a helm (it hides the hair) and a chest, both from the one armor
 *  file of the `fixture` set. */
export const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: { head: { label: 'Head' }, chest: { label: 'Chest' } },
  items: {
    original_helm: {
      label: 'Helm',
      slot: 'head',
      set: 'fixture',
      nodes: ['Helm'],
      hidesAppearance: ['hair'],
    },
    original_chest: { label: 'Chest', slot: 'chest', set: 'fixture', nodes: ['Chest'] },
  },
  defaultEquipment: { head: 'original_helm', chest: 'original_chest' },
  animationNames: ['Idle'],
};

/** The same body with a part in every dressable slot (FULL_KIT_PARTS): what a kit of
 *  several materials folds into. */
export const fullKitManifest: WocCharacterManifest = {
  ...manifest,
  armorSlots: {
    head: { label: 'Head' },
    arms: { label: 'Arms' },
    hands: { label: 'Hands' },
    chest: { label: 'Chest' },
    waist: { label: 'Waist' },
    feet: { label: 'Feet' },
  },
  items: {
    original_helm: {
      label: 'Helm',
      slot: 'head',
      set: 'fixture',
      nodes: ['Helm'],
      hidesAppearance: ['hair'],
    },
    original_shoulders: {
      label: 'Shoulders',
      slot: 'arms',
      set: 'fixture',
      nodes: ['Shoulder_L', 'Shoulder_R'],
    },
    original_gloves: { label: 'Gloves', slot: 'hands', set: 'fixture', nodes: ['Gloves'] },
    original_chest: { label: 'Chest', slot: 'chest', set: 'fixture', nodes: ['Chest'] },
    original_waist: { label: 'Waist', slot: 'waist', set: 'fixture', nodes: ['Waist'] },
    original_boots: {
      label: 'Boots',
      slot: 'feet',
      set: 'fixture',
      nodes: ['Boot_L', 'Boot_R'],
    },
  },
  defaultEquipment: {
    head: 'original_helm',
    arms: 'original_shoulders',
    hands: 'original_gloves',
    chest: 'original_chest',
    waist: 'original_waist',
    feet: 'original_boots',
  },
};

/** The equipment that fills every slot of the full kit (any item id dresses a slot with
 *  the body's own piece for it: woc_parts_core.ts wocArmorAssetFor). */
export const FULL_KIT_EQUIPPED = {
  helmet: 'any-helm',
  shoulder: 'any-shoulders',
  gloves: 'any-gloves',
  chest: 'any-chest',
  waist: 'any-waist',
  feet: 'any-boots',
} as const;

/** The full kit's three file materials (the names earn no worn detail layer:
 *  worn_stone.ts riggedWornFamilyFor) and the part meshes each draws once the file is
 *  prepared: the two boots are one item on one material, so the armor binder folds them
 *  into one skinned mesh (rig_merge.ts, `<first>_bodymerged`). The helm and the
 *  shoulders are RIGID parts (on the head bone and on the root bone); the rest skinned.
 *  The gloves are alone on their material: a batch of one, which no merge touches. */
export const FULL_KIT_PARTS = {
  kit_plate: ['Chest', 'Helm', 'Shoulder_L', 'Shoulder_R'],
  kit_hide: ['Boot_L_bodymerged', 'Waist'],
  kit_trim: ['Gloves'],
} as const;

/** Per-vertex morph deltas (relative, pack units) the head base carries: each
 *  moves the whole base along y by a distinct amount, so its baked centroid says
 *  which morphs the far pose froze. */
export const BASE_DELTA: Readonly<Record<string, number>> = {
  FS_Chin_Softness: 0.5,
  FS_Bald_Crown: -0.3,
  FS_Tuck_swept: 0.2,
};
export const BASE = 'WocHead_A_base';
export const SWEPT = 'WocHead_A_hair_swept';
export const BOXED = 'WocHead_A_beard_boxed';
export const NOSE = 'WocHead_A_nose_default';
export const BROW_L = 'WocHead_A_brows_relaxed_L';
export const LIP_RING = 'WocHead_A_piercing_lip';
/** The seven sites of the `full` piercing preset (woc_head_catalog.ts). */
export const FULL_PIERCINGS = ['lobe_l', 'lobe_r', 'rim_l', 'rim_r', 'nostril', 'brow', 'lip'].map(
  (site) => `WocHead_A_piercing_${site}`,
);
/** An eye ships much as Type B's does: its textured eyeball and its flat-coloured
 *  eyeliner are two meshes under one piece node. Both eyes' liners share ONE material
 *  here, so two folded meshes meet on one slot. The meshes of a piece of several
 *  materials are NOT named after their piece (a loader names them after the mesh, not
 *  the node), so what a mesh folds as has to come from the piece node above it. */
export const BALL_L = 'eyeball_default_L';
export const BALL_R = 'eyeball_default_R';
export const LINER_L = 'eyeliner_default_L';
export const LINER_R = 'eyeliner_default_R';
/** The quiff ships as the real one does: its strands and its fitted scalp cap are two
 *  meshes under one piece node, each on a material and a texture of its own. */
export const HAIR_QUIFF = 'WocHead_A_hair_quiff';
export const QUIFF_STRANDS = 'quiff_strands';
export const QUIFF_SCALP = 'quiff_cap';
/** The undercut's two materials sample ONE texture. */
export const HAIR_UNDERCUT = 'WocHead_A_hair_undercut';
export const UNDERCUT_STRANDS = 'undercut_strands';
export const UNDERCUT_SCALP = 'undercut_cap';
/** The textured meshes Type A's default look draws (a material each)... */
export const TEXTURED_MESHES = [
  BASE,
  SWEPT,
  BOXED,
  NOSE,
  'WocHead_A_mouth_default',
  BROW_L,
  'WocHead_A_brows_relaxed_R',
  'WocHead_A_ears_default_L',
  'WocHead_A_ears_default_R',
  BALL_L,
  BALL_R,
] as const;
/** ...and its flat-coloured ones (one material between them). */
export const FLAT_MESHES = [LINER_L, LINER_R] as const;
export const DEFAULT_MESHES = [...TEXTURED_MESHES, ...FLAT_MESHES] as const;
/** The materials those meshes draw with: the far groups the head cost when each
 *  material was a group, and the slots of its merged material now. */
export const DEFAULT_MATERIALS = TEXTURED_MESHES.length + 1;
/** Vertices of the body's box, and of the armor's. */
export const BOX = 24;
/** The eyeliner's own morph delta (along y, pack units): a flat-coloured piece that is
 *  posed too. */
export const LINER_CHIN_DELTA = 0.25;

/** The core atlas's white cell, as the build records it on every core material
 *  (scripts/assets/woc_character/head_atlas.mjs). */
export const WHITE = [0.75, 0.25] as const;
/** The eyeliner's flat colour (linear). */
export const LINER = [0.005, 0.005, 0.006] as const;
/** The piercings' flat colour (linear), on the one material they share. */
export const GOLD = [1, 0.66, 0.22] as const;

/** What keeps a fixture core piece out of the merged material (woc_head_merge.ts
 *  wocHeadMergeFold): a texture of its own instead of the atlas, or an alpha cut-out. */
export type Unfoldable = 'own-texture' | 'cutout';

interface HeadKit {
  readonly atlas: THREE.Texture;
  /** The eyeliner's material, shared by both eyes. */
  readonly liner: THREE.MeshStandardMaterial;
  readonly gold: THREE.MeshStandardMaterial;
  readonly unfoldable: Readonly<Record<string, Unfoldable>>;
  /** Every material two sided, as Type B's head ships (Type A's head and eyeballs are
   *  one sided). */
  readonly allTwoSided: boolean;
}

function texture(name: string): THREE.Texture {
  const t = new THREE.Texture();
  t.name = name;
  return t;
}

function box(size: number, segments = 1): THREE.BufferGeometry {
  return new THREE.BoxGeometry(size, size, size, segments, 1, 1);
}

/** A head mesh's box: 24, 32 or 40 vertices by its name, so no two neighbours in the
 *  bake's walk are sure to weigh the same and a slot written by the wrong mesh's count
 *  lands on the wrong vertices. */
function headBox(mesh: string, size: number): THREE.BufferGeometry {
  return box(size, 1 + (mesh.length % 3));
}

/** One uv per textured fixture mesh, on every vertex of it, so a baked far vertex
 *  says which mesh it was cut from. Dyadic (exact in a Float32) and never the white
 *  cell's, a body's or the armor's. */
const MESH_UV = new Map<string, readonly [number, number]>();
export function meshUv(mesh: string): readonly [number, number] {
  let uv = MESH_UV.get(mesh);
  if (!uv) {
    const n = MESH_UV.size;
    uv = [(n % 32) / 64, 0.5 + Math.floor(n / 32) / 64];
    MESH_UV.set(mesh, uv);
  }
  return uv;
}

function taggedBox(mesh: string, size: number): THREE.BufferGeometry {
  const g = headBox(mesh, size);
  const uv = g.getAttribute('uv');
  const [u, v] = meshUv(mesh);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return g;
}

/** The fixture rig: a root bone and a head bone above it, under `scene`. */
function rigBones(scene: THREE.Object3D): { root: THREE.Bone; head: THREE.Bone } {
  const root = new THREE.Bone();
  root.name = 'root';
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, 2, 0);
  root.add(head);
  scene.add(root);
  return { root, head };
}

/** Weight every vertex of a geometry to the rig's first joint (the root bone). */
function skinToRoot(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}

/** The WOC base: a skinned body on a two-bone rig, ending at the neck (no head of its own). */
function baseSource() {
  const scene = new THREE.Group();
  const { root, head } = rigBones(scene);
  const body = new THREE.SkinnedMesh(
    skinToRoot(box(1)),
    new THREE.MeshStandardMaterial({ map: texture('body') }),
  );
  body.name = 'Character_Body';
  scene.add(body);
  scene.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([root, head]));
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
}

/** The armor file of `manifest`: a helm and a chest, rigid on the root bone, on one
 *  material. */
function armorSource() {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'root';
  scene.add(bone);
  const material = new THREE.MeshStandardMaterial({ map: texture('armor') });
  for (const [name, y] of [
    ['Helm', 2.2],
    ['Chest', 0.2],
  ] as const) {
    const mesh = new THREE.Mesh(box(0.6), material);
    mesh.name = name;
    mesh.position.y = y;
    bone.add(mesh);
  }
  return { scene, animations: [] };
}

/** The armor file of `fullKitManifest` (FULL_KIT_PARTS), on its own copy of the rig:
 *  three materials, rigid parts on two bones and skinned parts between them. A skinned
 *  part sits at the origin and carries its place in its vertices, as the shipped ones
 *  do (a merged mesh skins from the model's origin). */
function fullKitSource() {
  const scene = new THREE.Group();
  const { root, head } = rigBones(scene);
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([root, head]);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const materialOf = (name: string): THREE.MeshStandardMaterial => {
    let m = materials.get(name);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ name, map: texture(name) });
      materials.set(name, m);
    }
    return m;
  };
  const rigid = (name: string, material: string, bone: THREE.Bone, x: number, y: number) => {
    const mesh = new THREE.Mesh(box(0.3), materialOf(material));
    mesh.name = name;
    mesh.position.set(x, y, 0);
    bone.add(mesh);
  };
  const skinned = (name: string, material: string, x: number, y: number) => {
    const geometry = box(0.4);
    geometry.translate(x, y, 0);
    const mesh = new THREE.SkinnedMesh(skinToRoot(geometry), materialOf(material));
    mesh.name = name;
    scene.add(mesh);
    mesh.bind(skeleton);
  };
  rigid('Helm', 'kit_plate', head, 0, 0.4);
  rigid('Shoulder_L', 'kit_plate', root, 0.6, 1.6);
  rigid('Shoulder_R', 'kit_plate', root, -0.6, 1.6);
  skinned('Chest', 'kit_plate', 0, 1.2);
  skinned('Waist', 'kit_hide', 0, 0.7);
  skinned('Boot_L', 'kit_hide', 0.2, 0.1);
  skinned('Boot_R', 'kit_hide', -0.2, 0.1);
  skinned('Gloves', 'kit_trim', 0.8, 1);
  return { scene, animations: [] };
}

/** A hairstyle or beard mesh: its own two sided material (named with its tint role) on
 *  its own texture, as the hair and beard files ship. */
function hairMesh(mesh: string, material: string, map: THREE.Texture): THREE.Mesh {
  const m = new THREE.Mesh(
    taggedBox(mesh, 0.05),
    new THREE.MeshStandardMaterial({
      name: material,
      map,
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  m.name = mesh;
  return m;
}

/** A hairstyle of two materials: a piece node holding its strands (`<style>_strands`)
 *  and its scalp cap (`<style>_cap`), each texture named after its mesh. */
function twoMaterialHair(piece: string, capMap: (strands: THREE.Texture) => THREE.Texture) {
  const style = piece.slice('WocHead_A_hair_'.length);
  const strands = texture(`${style}_strands`);
  const node = new THREE.Group();
  node.name = piece;
  node.add(hairMesh(`${style}_strands`, `hair_${style}`, strands));
  node.add(hairMesh(`${style}_cap`, `hair_${style}_scalp`, capMap(strands)));
  return node;
}

/** A flat-coloured mesh: no texture and no uv at all, as the packs ship them. `chin`
 *  gives it a chin morph of its own (a relative delta along y). */
function flatMesh(name: string, material: THREE.Material, chin = 0): THREE.Mesh {
  const g = headBox(name, 0.05);
  g.deleteAttribute('uv');
  const m = new THREE.Mesh(g, material);
  m.name = name;
  if (chin !== 0) {
    const n = g.getAttribute('position').count;
    const d = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) d[i * 3 + 1] = chin;
    g.morphAttributes.position = [new THREE.Float32BufferAttribute(d, 3)];
    g.morphTargetsRelative = true;
    m.morphTargetDictionary = { FS_Chin_Softness: 0 };
    m.morphTargetInfluences = [0];
  }
  return m;
}

/** A flat-coloured, two sided core material, recording the atlas's white cell as the
 *  build does. */
function flatMaterial(
  name: string,
  color: readonly [number, number, number],
  surface: { roughness: number; metalness: number },
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ name, ...surface, side: THREE.DoubleSide });
  material.color.setRGB(color[0], color[1], color[2]);
  material.userData.wocHeadAtlas = { white: [...WHITE] };
  return material;
}

/** A core piece's textured material: named with its tint role, on the ONE core atlas
 *  unless the case keeps it out of the fold. `closed` is a piece Type A ships one sided
 *  (the head itself, an eyeball); the open ones (brows, ears, mouth, nose) are two sided. */
function coreMaterial(
  mesh: string,
  role: string,
  kit: HeadKit,
  closed = false,
): THREE.MeshStandardMaterial {
  const how = kit.unfoldable[mesh];
  const material = new THREE.MeshStandardMaterial({
    name: `${role}_${mesh}`,
    map: how === 'own-texture' ? texture(mesh) : kit.atlas,
    roughness: 0.6,
    side: closed && !kit.allTwoSided ? THREE.FrontSide : THREE.DoubleSide,
  });
  if (how === 'cutout') material.alphaTest = 0.5;
  material.userData.wocHeadAtlas = { white: [...WHITE] };
  return material;
}

/** One of Type A's head pieces, as the split library ships them since the core atlas:
 *  every textured core mesh (the base, brows, ears, eyeballs, mouth, nose) on its own
 *  material, named with its tint role, all sampling ONE atlas; the eyeliner and the
 *  piercings flat-coloured, with no uv at all; a hairstyle or a beard on a texture of
 *  its own. The head and the eyeballs are one sided, everything else two sided. */
function pieceMesh(name: string, kit: HeadKit): THREE.Object3D {
  const slot = /^WocHead_A_([a-z]+)/.exec(name)?.[1] ?? '';
  if (name === HAIR_QUIFF) return twoMaterialHair(name, () => texture(QUIFF_SCALP));
  if (name === HAIR_UNDERCUT) return twoMaterialHair(name, (strands) => strands);
  if (slot === 'hair' || slot === 'beard') return hairMesh(name, `hair_${name}`, texture(name));
  // the gold's name earns it the worn metal layer on the tier derivation, which the
  // merged material does not carry: a piercing never folds (woc_head_merge.ts mergeable)
  if (slot === 'piercing') return flatMesh(name, kit.gold);
  if (slot === 'eyes') {
    const shape = name.slice('WocHead_A_eyes_'.length);
    const node = new THREE.Group();
    node.name = name;
    const ball = new THREE.Mesh(
      taggedBox(`eyeball_${shape}`, 0.05),
      coreMaterial(`eyeball_${shape}`, 'eye', kit, true),
    );
    ball.name = `eyeball_${shape}`;
    node.add(ball);
    node.add(flatMesh(`eyeliner_${shape}`, kit.liner, LINER_CHIN_DELTA));
    return node;
  }
  const isBase = name === BASE;
  const g = taggedBox(name, isBase ? 0.4 : 0.05);
  const targets = isBase ? Object.keys(BASE_DELTA) : [];
  g.morphAttributes.position = targets.map((t) => {
    const n = g.getAttribute('position').count;
    const d = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) d[i * 3 + 1] = BASE_DELTA[t];
    return new THREE.Float32BufferAttribute(d, 3);
  });
  g.morphTargetsRelative = true;
  const m = new THREE.Mesh(g, coreMaterial(name, slot === 'brows' ? 'brow' : 'skin', kit, isBase));
  m.name = name;
  if (targets.length > 0) {
    m.morphTargetDictionary = Object.fromEntries(targets.map((t, i) => [t, i]));
    m.morphTargetInfluences = targets.map(() => 0);
  }
  return m;
}

/** Type A's split head library: each file a `head` node carrying the pieces it ships. */
const HEAD_FILES = wocHeadNodesByFile('a');
function headFile(
  url: string,
  unfoldable: Readonly<Record<string, Unfoldable>>,
  allTwoSided: boolean,
) {
  const nodes = HEAD_FILES.get(url);
  if (!nodes) throw new Error(`no head file ${url}`);
  // the liner's surface is off the matte band on purpose (roughness) and a little
  // metallic, so a row that carries the far tier's own derivation is told from one
  // that carries the file's raw values, or the merged material's
  const kit: HeadKit = {
    atlas: texture('atlas'),
    liner: flatMaterial('liner', LINER, { roughness: 0.95, metalness: 0.25 }),
    gold: flatMaterial('metal_gold', GOLD, { roughness: 0.3, metalness: 1 }),
    unfoldable,
    allTwoSided,
  };
  return splitHeadScene(nodes, (name) => pieceMesh(name, kit));
}

/** A world player on the fixture body, wearing `app`. */
export const player = (app: Record<string, unknown>): Entity =>
  ({
    kind: 'player',
    id: 7,
    templateId: 'paladin',
    color: 0xffffff,
    skin: 0,
    mainhandItemId: null,
    offhandItemId: null,
    auras: [],
    modularAppearance: app,
  }) as unknown as Entity;

/** One compile-gate request a harness visual made: what it asked to link, and the
 *  settle the case calls when the link is over (`ready`: the gate's own proof that it
 *  linked; omitted, the gate vouches for it, as a host without a proof does). */
export interface HarnessGate {
  readonly target: THREE.Object3D;
  readonly settle: (ready?: () => boolean) => void;
}

export interface WocVisualHarnessOptions {
  /** False: no head file ever lands (every fetch hangs). */
  headPack?: boolean;
  /** Head files whose landing the case releases (`releases`). */
  held?: readonly string[];
  /** Head files whose fetch fails. */
  failed?: readonly string[];
  unfoldable?: Readonly<Record<string, Unfoldable>>;
  allTwoSided?: boolean;
  /** The low tier: every character material is rebuilt as a Lambert. */
  lowTier?: boolean;
  /** The body and its armor file: `manifest` and its helm and chest (the default), or
   *  `fullKitManifest` and its seven parts on three materials. */
  kit?: 'pair' | 'full';
  /** Every fixture geometry ships coarser levels (the WOC_lod contract, as the loader's
   *  plugin stores them: fixtureLodLevels), its box groups cleared as a glTF primitive has
   *  none. Off: no file carries a level, as before. */
  lods?: boolean;
}

/** The fixture's coarser levels of one geometry: mid every other triangle of its own index,
 *  far every fourth (a fixture box has a multiple of four triangles, so far is a quarter). */
export function fixtureLodLevels(
  geometry: THREE.BufferGeometry,
): { mid: THREE.BufferAttribute; far: THREE.BufferAttribute } | null {
  const index = geometry.index;
  if (!index || index.count < 12) return null;
  const mid: number[] = [];
  const far: number[] = [];
  for (let t = 0; t < index.count / 3; t++) {
    const tri = [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)];
    if (t % 2 === 0) mid.push(...tri);
    if (t % 4 === 0) far.push(...tri);
  }
  return {
    mid: new THREE.BufferAttribute(new Uint16Array(mid), 1),
    far: new THREE.BufferAttribute(new Uint16Array(far), 1),
  };
}

export async function wocVisualHarness(opts: WocVisualHarnessOptions = {}) {
  vi.resetModules();
  const headPack = opts.headPack !== false;
  const body = opts.kit === 'full' ? fullKitManifest : manifest;
  /** A held head file's landing, released by the case. */
  const releases = new Map<string, () => void>();
  // this module world's level store: what the loader's plugin would fill for a file
  const lodStore = opts.lods ? await import('../../src/render/assets/geometry_lod') : null;
  const withLods = <T extends { scene: THREE.Object3D }>(gltf: T): T => {
    if (!lodStore) return gltf;
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const levels = mesh.isMesh ? fixtureLodLevels(mesh.geometry) : null;
      if (!levels) return;
      mesh.geometry.clearGroups();
      lodStore.setGeometryLod(mesh.geometry, levels);
    });
    return gltf;
  };
  const file = (url: string) =>
    withLods(headFile(url, opts.unfoldable ?? {}, opts.allTwoSided ?? false));
  vi.doMock('../../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) => {
      if (url.includes('/armor/')) {
        return Promise.resolve(withLods(opts.kit === 'full' ? fullKitSource() : armorSource()));
      }
      if (url.includes('head_type_')) {
        if (!headPack) return new Promise(() => undefined);
        if (opts.failed?.includes(url)) return Promise.reject(new Error('offline'));
        if (opts.held?.includes(url)) {
          return new Promise((resolve) => releases.set(url, () => resolve(file(url))));
        }
        return Promise.resolve(file(url));
      }
      return Promise.resolve(withLods(baseSource()));
    }),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn((url: string) => Promise.resolve(texture(url))),
    loadKtx2Texture: vi.fn((url: string) => Promise.resolve(texture(url))),
    releaseGltf: vi.fn(),
  }));
  if (opts.lowTier) {
    // the low tier rebuilds every character material as a Lambert (assets.ts buildTintedClone)
    const gfx = await import('../../src/render/gfx');
    gfx.activateGfxProfile({
      ...gfx.getActiveGfxProfile(),
      settings: gfx.gfxInternalsForTest.settingsFor('low', { search: '?gfx=low' }),
    });
  }
  const { VISUALS } = await import('../../src/render/characters/manifest');
  VISUALS[KEY] = {
    ...VISUALS[KEY],
    wocCharacter: body,
    clips: { idle: 'Idle', walk: 'Idle', run: 'Idle', attack: ['Idle'], death: 'Idle' },
  };
  const assets = await import('../../src/render/characters/assets');
  await assets.charactersReady();
  await vi.waitFor(() => expect(assets.visualAssetsResident(KEY)).toBe(true));
  const { currentWocArmorTier } = await import('../../src/render/characters/woc_armor_dressing');
  const armor = await import('../../src/render/characters/woc_armor_packs');
  const { wocArmorPackUrl } = await import('../../src/render/characters/woc_armor_core');
  const kit = wocArmorPackUrl('male', 'fixture', currentWocArmorTier());
  armor.ensureWocArmorPack(kit);
  await vi.waitFor(() => expect(armor.wocArmorPackResident(kit)).toBe(true));
  const heads = await import('../../src/render/characters/woc_head_packs');
  if (headPack) {
    // the whole library resident (but any held file), so every look is born with its head
    const landed = wocHeadAllUrls('a').filter(
      (url) => !opts.held?.includes(url) && !opts.failed?.includes(url),
    );
    for (const url of landed) heads.ensureWocHeadFile(url);
    await vi.waitFor(() => expect(heads.wocHeadFilesResident(landed)).toBe(true));
  }
  const { CharacterVisual } = await import('../../src/render/characters/visual');
  const modular = await import('../../src/render/characters/modular');
  const look = await import('../../src/render/characters/woc_head_look_core');
  const tint = await import('../../src/render/characters/woc_head_tint');
  const merge = await import('../../src/render/characters/woc_head_merge');
  const armorMerge = await import('../../src/render/characters/woc_armor_merge');
  const worn = await import('../../src/render/worn_stone');
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const gates: HarnessGate[] = [];
  /** A far-ready WOC visual wearing `app`, dressed bare, its far mesh minted and
   *  linked (the gate settled, the reveal taken on the next setFar). */
  const farVisual = (app: Record<string, unknown>, equipped: Record<string, string> = {}) => {
    const v = new CharacterVisual(KEY, 0xffffff, 0);
    v.setFarBakeGate((target, settle) => gates.push({ target, settle }));
    v.setWocEquipment(equipped, false);
    v.setWocHeadLook(app);
    now += 40; // a fresh bake-budget window per build
    v.setFar(true);
    for (const gate of gates.splice(0)) gate.settle();
    v.setFar(true);
    return v;
  };
  /** A look's four colours, as the tint layers hold them (linear). */
  const colorsOf = (app: Record<string, unknown>) => {
    const norm = modular.normalizeAppearance(app);
    return {
      skin: [...look.hexToLinear(modular.skinColor(norm))],
      eye: [...look.hexToLinear(modular.eyeColor(norm))],
      hair: [...look.hexToLinear(modular.hairColor(norm))],
      brow: [...look.hexToLinear(modular.browColor(norm))],
    };
  };
  /** The far tier's own derivation of a head material: what a far group drawing it wore
   *  when each piece was a draw, and what its slot's row is read off now. */
  const farSurface = (material: THREE.Material) =>
    merge.wocHeadMergeSurfaceOf(
      assets.tintedFarMaterials(VISUALS[KEY], 0xffffff, [material], [false])[0],
    );
  /** Tinted far clones some visual still holds (the shared cache's claimed entries). */
  const claimed = () =>
    assets.tintedMaterialInternalsForTest.cacheSize() -
    assets.tintedMaterialInternalsForTest.cacheIdleSize();
  return {
    CharacterVisual,
    heads,
    releases,
    DEFAULT_APPEARANCE: modular.DEFAULT_APPEARANCE,
    WOC_BODY_SKIN_REF: look.WOC_BODY_SKIN_REF,
    wocHeadTintOf: tint.wocHeadTintOf,
    wocHeadMergedTintOf: tint.wocHeadMergedTintOf,
    surfaceOf: merge.wocHeadMergeSurfaceOf,
    riggedWornFamilyFor: worn.riggedWornFamilyFor,
    /** The merged draws' shared geometry caches (their leases), this module world's. */
    headMergeCache: merge.wocHeadMergeInternalsForTest.cache,
    armorMergeCache: armorMerge.wocArmorMergeInternalsForTest.cache,
    /** The file material an attached armor mesh hangs with (woc_armor_packs.ts). */
    armorFileMaterial: armor.wocArmorFileMaterial,
    colorsOf,
    farSurface,
    claimed,
    normScale: assets.prepareVisual(KEY).normScale,
    gates,
    farVisual,
    nextFrame: (elapsed = 40) => {
      now += elapsed;
    },
  };
}

export type WocVisualHarness = Awaited<ReturnType<typeof wocVisualHarness>>;
export type WocHarnessVisual = InstanceType<WocVisualHarness['CharacterVisual']>;

/** A consumer's afterEach: put the spied clock back and let go of the loader mock. */
export function releaseWocVisualHarness(): void {
  vi.restoreAllMocks();
  vi.doUnmock('../../src/render/assets/loader');
}
