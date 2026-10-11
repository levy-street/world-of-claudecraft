// @vitest-environment happy-dom
// The spirit veil family against the shipped catalogue: every shape a released
// spirit can draw maps to a tuple of the pinned family, and the family holds
// nothing else. A new part whose morph count, attribute set, texture channel or
// blend mode is not listed fails HERE, at PR time; left to the runtime it would
// stop a ghost behind the effect gate (never a live link, but no longer
// immediate) and name the tuple on the dev channel.
//
// Who can be a released spirit: players only (spirit.ts releaseAtNearestGraveyard
// and the ghost logout restore are the only writers of `ghost`), never in a
// form, never mounted. So the census walks the player rigs (every `player_*`
// VisualDef, the mech included, with its attachments and its low-tier alias),
// every held model a player can carry (item weapons, offhands, weapon skins),
// the composed library as the real part selection and merge compose it, and
// the procedural shapes the rig adds (the baked far mesh and the face decals).
// The other veil users add the form rigs they wear, the quest visions (mobs on
// fixed player rigs) and the Pale Keeper's composed look.
//
// The composed library is modelled the way assets.ts modularVariant builds it:
// modularPartNames picks the nodes of a look, and mergeSkinnedParts folds the
// picked skinned meshes that share a material and a merge partition
// (modular_name_facts_core modularMergePartition) and an attribute set into
// one mesh padded to the UNION of their morph target names. The looks are the
// cross product of the factors that share a bucket (hair, brows, beard) and a
// one-at-a-time sweep of every other style, per gender and per armour loadout.
// Two halves hold that model to the real thing: a sample of looks is composed
// through the real GLTFLoader scene and the real mergeSkinnedParts and must
// reach exactly the model's keys, and the data facts the sweep leans on (armour and
// underclothing carry no morph target, the body is drawn under every loadout)
// are asserted, so a mixed loadout keys like the full sets that span it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { createSpiritVeilMaterial, spiritVeilKeysFor } from '../src/render/characters/ghost_veil';
import {
  ITEM_OFFHAND_MODELS,
  itemWeaponModelUrls,
  VISUALS,
  visualAssetUrlForGraphics,
  visualKeyFor,
  weaponSkinModelUrls,
} from '../src/render/characters/manifest';
import {
  ARMOR_SETS,
  ARMOR_SLOTS,
  type ArmorLoadout,
  BEARD_STYLES,
  BROW_STYLES,
  DEFAULT_APPEARANCE,
  EAR_STYLES,
  EARRING_STYLES,
  EYE_STYLES,
  fullSet,
  HAIR_STYLES,
  helmKind,
  MOUTH_STYLES,
  type ModularAppearance,
  modularPartNames,
  normalizeAppearance,
} from '../src/render/characters/modular';
import {
  MODULAR_HEAD_NODES,
  modularMergePartition,
} from '../src/render/characters/modular_name_facts_core';
import { NPC_LOOKS, npcLookFor, npcModularKeyFor } from '../src/render/characters/npc_looks';
import { mergeSkinnedParts } from '../src/render/characters/rig_merge';
import {
  SPIRIT_VEIL_FAMILY_KEYS,
  type SpiritVeilPass,
  type SpiritVeilShape,
  spiritVeilTupleKey,
} from '../src/render/characters/spirit_veil_family_core';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

interface GltfPrimitive {
  attributes: Record<string, number>;
  targets?: Record<string, number>[];
  material?: number;
}
interface GltfJson {
  nodes?: { name?: string; mesh?: number; skin?: number }[];
  meshes?: { name?: string; primitives: GltfPrimitive[]; extras?: { targetNames?: string[] } }[];
  materials?: {
    name?: string;
    alphaMode?: string;
    pbrMetallicRoughness?: { baseColorTexture?: { index: number; texCoord?: number } };
  }[];
}

/** One drawable a rig ends with: a primitive, or a merged bucket of them. */
interface Part {
  where: string;
  skinned: boolean;
  material: number | undefined;
  attributes: string;
  targetNames: string[];
  morphKinds: Set<string>;
}

const MODULAR_URL = 'models/chars/modular/warrior_modular.glb';
const jsonCache = new Map<string, GltfJson>();
// happy-dom replaces the global URL, which node:fs does not read as a path.
const publicPath = (url: string): string => resolve(process.cwd(), 'public', url);

function gltf(url: string): GltfJson {
  let json = jsonCache.get(url);
  if (!json) {
    json = glbJsonChunk(readFileSync(publicPath(url))) as GltfJson;
    jsonCache.set(url, json);
  }
  return json;
}

function nodeParts(url: string, nodeIndex: number): Part[] {
  const json = gltf(url);
  const node = json.nodes?.[nodeIndex];
  if (!node || node.mesh === undefined) return [];
  const mesh = json.meshes?.[node.mesh];
  if (!mesh) return [];
  // GLTFLoader names a single-primitive mesh after its node, and the meshes of
  // a multi-primitive part after the mesh datablock.
  const name = mesh.primitives.length === 1 ? (node.name ?? '') : (mesh.name ?? '');
  const names = mesh.extras?.targetNames ?? [];
  return mesh.primitives.map((prim) => {
    const targets = prim.targets ?? [];
    const kinds = new Set<string>();
    for (const target of targets) for (const kind of Object.keys(target)) kinds.add(kind);
    return {
      where: `${url}#${name}`,
      skinned: node.skin !== undefined,
      material: prim.material,
      attributes: Object.keys(prim.attributes).sort().join(','),
      targetNames: targets.map((_, i) => names[i] ?? `#${i}`),
      morphKinds: kinds,
    };
  });
}

function allParts(url: string): Part[] {
  const json = gltf(url);
  return (json.nodes ?? []).flatMap((_, index) => nodeParts(url, index));
}

function materialOf(url: string, part: Part) {
  return part.material === undefined ? undefined : gltf(url).materials?.[part.material];
}

/** The tuple keys a part draws once veiled: its colour (or decal) arm and,
 *  for a body, its depth pre-pass. */
function partKeys(url: string, part: Part): string[] {
  const material = materialOf(url, part);
  const texture = material?.pbrMetallicRoughness?.baseColorTexture;
  // The veil carries the source map on its own channel; only uv 0 is listed.
  expect(texture?.texCoord ?? 0, `${part.where} map channel`).toBe(0);
  // An alpha-tested source would lose its cutout under the veil, and a kept
  // shadow (Moonkin) would move to another depth variant: none ships today.
  expect(material?.alphaMode, `${part.where} alpha mode`).not.toBe('MASK');
  const attributes = new Set(part.attributes.split(','));
  const shape: SpiritVeilShape = {
    skinned: part.skinned,
    morphTargets: part.targetNames.length,
    morphPositions: part.morphKinds.has('POSITION'),
    morphNormals: part.morphKinds.has('NORMAL'),
    morphColors: part.morphKinds.has('COLOR_0'),
    normals: attributes.has('NORMAL'),
    positions: attributes.has('POSITION'),
    instanced: false,
    batched: false,
  };
  // A transparent source takes the decal variant (ghost_veil.ts).
  const pass: SpiritVeilPass = material?.alphaMode === 'BLEND' ? 'decal' : 'color';
  const keys = [spiritVeilTupleKey(pass, shape, texture !== undefined)];
  if (pass === 'color') keys.push(spiritVeilTupleKey('depth', shape, false));
  return keys;
}

/** The composed rig of one look: picked parts, merged per bucket. */
function composedParts(app: ModularAppearance, worn: ArmorLoadout): Part[] {
  const json = gltf(MODULAR_URL);
  const picked = new Set(modularPartNames(app, worn));
  const parts: Part[] = [];
  (json.nodes ?? []).forEach((node, index) => {
    if (node.name && picked.has(node.name)) parts.push(...nodeParts(MODULAR_URL, index));
  });
  const buckets = new Map<string, Part[]>();
  for (const part of parts) {
    const name = part.where.slice(part.where.indexOf('#') + 1);
    const key = part.skinned
      ? `${part.material}|${modularMergePartition(name)}`
      : `rigid:${part.where}:${buckets.size}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(part);
    else buckets.set(key, [part]);
  }
  const out: Part[] = [];
  for (const bucket of buckets.values()) {
    const sameAttributes = bucket.every((part) => part.attributes === bucket[0].attributes);
    if (bucket.length < 2 || !sameAttributes) {
      out.push(...bucket);
      continue;
    }
    const names: string[] = [];
    const kinds = new Set<string>();
    for (const part of bucket) {
      for (const name of part.targetNames) if (!names.includes(name)) names.push(name);
      for (const kind of part.morphKinds) kinds.add(kind);
    }
    out.push({
      ...bucket[0],
      where: `${bucket[0].where}+${bucket.length - 1}`,
      targetNames: names,
      morphKinds: kinds,
    });
  }
  return out;
}

function looks(): { app: ModularAppearance; worn: ArmorLoadout }[] {
  const out: { app: ModularAppearance; worn: ArmorLoadout }[] = [];
  const loadouts: ArmorLoadout[] = [{}, ...ARMOR_SETS.map((set) => fullSet(set))];
  for (const gender of ['male', 'female'] as const) {
    const base: ModularAppearance = { ...DEFAULT_APPEARANCE, gender };
    const sweeps: Partial<ModularAppearance>[] = [
      ...EYE_STYLES.map((eyeShape) => ({ eyeShape })),
      ...EAR_STYLES.map((ears) => ({ ears })),
      ...MOUTH_STYLES.map((mouth) => ({ mouth })),
      ...EARRING_STYLES.map((earrings) => ({ earrings })),
      { lashes: true },
      { lashes: false },
    ];
    for (const hair of HAIR_STYLES)
      for (const brows of BROW_STYLES)
        for (const beard of BEARD_STYLES) sweeps.push({ hair, brows, beard });
    for (const worn of loadouts) {
      for (const sweep of sweeps)
        out.push({ app: normalizeAppearance({ ...base, ...sweep }), worn });
    }
  }
  return out;
}

function playerRigUrls(): string[] {
  const urls = new Set<string>();
  for (const [key, def] of Object.entries(VISUALS)) {
    if (!key.startsWith('player_') || def.modular) continue;
    for (const url of [def.url, ...(def.attach ?? []).map((a) => a.url)]) {
      urls.add(url);
      urls.add(visualAssetUrlForGraphics(url, false));
    }
  }
  return [...urls];
}

function heldModelUrls(): string[] {
  return [
    ...new Set([
      ...itemWeaponModelUrls(),
      ...Object.values(ITEM_OFFHAND_MODELS).map((key) => `models/weapons/${key}.glb`),
      ...weaponSkinModelUrls(),
    ]),
  ];
}

// The rigs the other veil users draw on top of the player rigs above (the
// released-spirit palette's Pale Keeper and quest visions, the Ghost Wolf and
// Veilbound March palettes, stealth on the druid's cat, Moonkin on the sheep,
// and Soul Rend on whatever body a raider wears, so every form rig). A palette
// is uniform values only, so each needs nothing but its shapes in the family.
const VEILED_FORMS = Object.keys(VISUALS).filter((key) => key.startsWith('form_'));
// Every mob the renderer veils as a vision (ghost_style_core.ts routes by the
// `vision_` prefix), read off the mob table so a new one joins the census.
const VISION_TEMPLATES = Object.keys(MOBS).filter((id) => id.startsWith('vision_'));
const KEEPER = 'spirit_healer';

function formRigUrls(): string[] {
  const urls = new Set<string>();
  for (const key of VEILED_FORMS) {
    const def = VISUALS[key];
    for (const url of [def.url, ...(def.attach ?? []).map((a) => a.url)]) {
      urls.add(url);
      urls.add(visualAssetUrlForGraphics(url, false));
    }
  }
  return [...urls];
}

/** The keeper's composed look, as npc_looks.ts authors it, plus its props. */
function keeperParts(): { url: string; part: Part }[] {
  const look = NPC_LOOKS[KEEPER];
  const out = composedParts(normalizeAppearance(look.app), look.worn).map((part) => ({
    url: MODULAR_URL,
    part,
  }));
  for (const attach of VISUALS[npcModularKeyFor(KEEPER)].attach ?? []) {
    for (const part of allParts(attach.url)) out.push({ url: attach.url, part });
  }
  return out;
}

/** The shapes the rig mints at runtime, beside the GLB parts. */
function proceduralKeys(): Map<string, string> {
  const out = new Map<string, string>();
  // The baked far LOD (buildFarMeshes): one plain Mesh over an idle-pose bake
  // with normals and no morphs, its groups mapped or not.
  const far: SpiritVeilShape = {
    skinned: false,
    morphTargets: 0,
    morphPositions: false,
    morphNormals: false,
    morphColors: false,
    normals: true,
    positions: true,
    instanced: false,
    batched: false,
  };
  for (const key of [
    spiritVeilTupleKey('color', far, true),
    spiritVeilTupleKey('color', far, false),
    spiritVeilTupleKey('depth', far, false),
  ]) {
    out.set(key, 'far mesh');
  }
  // The stubble, scalp and makeup decals (stubble.ts / makeup.ts): the
  // composed head's own surface, skinned to its skeleton, carrying its position
  // morphs, its normals and a generated RGBA map, alpha-blended.
  const heads = allParts(MODULAR_URL).filter((part) =>
    MODULAR_HEAD_NODES.includes(part.where.slice(part.where.indexOf('#') + 1)),
  );
  expect(heads.length).toBe(MODULAR_HEAD_NODES.length);
  for (const head of heads) {
    const decal: SpiritVeilShape = {
      skinned: true,
      morphTargets: head.targetNames.length,
      morphPositions: head.targetNames.length > 0,
      morphNormals: false,
      morphColors: false,
      normals: true,
      positions: true,
      instanced: false,
      batched: false,
    };
    out.set(spiritVeilTupleKey('decal', decal, true), `face decal over ${head.where}`);
  }
  return out;
}

type Look = ReturnType<typeof looks>[number];

/** The first look to reach each distinct composed key set, filled by census(). */
const lookPerKeySet = new Map<string, Look>();

function census(): Map<string, string> {
  const needed = new Map<string, string>();
  const add = (keys: string[], where: string) => {
    for (const key of keys) if (!needed.has(key)) needed.set(key, where);
  };
  for (const url of [...playerRigUrls(), ...heldModelUrls()]) {
    for (const part of allParts(url)) add(partKeys(url, part), part.where);
  }
  for (const look of looks()) {
    const keys = new Set<string>();
    for (const part of composedParts(look.app, look.worn)) {
      const partKeyList = partKeys(MODULAR_URL, part);
      add(partKeyList, part.where);
      for (const key of partKeyList) keys.add(key);
    }
    const set = [...keys].sort().join(',');
    if (!lookPerKeySet.has(set)) lookPerKeySet.set(set, look);
  }
  for (const [key, where] of proceduralKeys()) add([key], where);
  for (const url of formRigUrls()) {
    for (const part of allParts(url)) add(partKeys(url, part), part.where);
  }
  for (const { url, part } of keeperParts()) add(partKeys(url, part), `${KEEPER} ${part.where}`);
  return needed;
}

describe('the spirit veil family covers the catalogue', () => {
  const needed = census();

  it('walks a real catalogue (the vacuity floor)', () => {
    expect(playerRigUrls().length).toBeGreaterThanOrEqual(10);
    expect(heldModelUrls().length).toBeGreaterThanOrEqual(70);
    expect(looks().length).toBeGreaterThan(1000);
  });

  it('maps every reachable shape to a pinned tuple', () => {
    const missing = [...needed].filter(([key]) => !SPIRIT_VEIL_FAMILY_KEYS.has(key));
    expect(missing.map(([key, where]) => `${key} <- ${where}`)).toEqual([]);
  });

  it('covers the other veil users: the forms they wear, the visions, the keeper', () => {
    // A vision is a mob drawn on a fixed player rig, which the walk above
    // already covers; a keeper is a composed NPC.
    expect(VISION_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const templateId of VISION_TEMPLATES) {
      const key = visualKeyFor({ kind: 'mob', templateId } as Entity);
      expect(key, templateId).toMatch(/^player_/);
      expect(VISUALS[key].modular, templateId).not.toBe(true);
    }
    expect(npcLookFor(KEEPER)).not.toBeNull();
    expect(keeperParts().length).toBeGreaterThan(5);
    expect(VEILED_FORMS).toEqual(
      expect.arrayContaining([
        'form_ghost_wolf',
        'form_sheep',
        'form_cat',
        'form_bear',
        'form_travel',
        'form_metamorph',
      ]),
    );
    const users = [
      ...formRigUrls().flatMap((url) => allParts(url).flatMap((part) => partKeys(url, part))),
      ...keeperParts().flatMap(({ url, part }) => partKeys(url, part)),
    ];
    expect(users.length).toBeGreaterThan(10);
    expect(users.filter((key) => !SPIRIT_VEIL_FAMILY_KEYS.has(key))).toEqual([]);
  });

  it('pins nothing the catalogue cannot reach', () => {
    const dead = [...SPIRIT_VEIL_FAMILY_KEYS].filter((key) => !needed.has(key));
    expect(dead).toEqual([]);
  });
});

/** The most morph targets any primitive of each part-library node carries. */
function nodeTargets(): Map<string, number> {
  const json = gltf(MODULAR_URL);
  const out = new Map<string, number>();
  (json.nodes ?? []).forEach((node, index) => {
    const parts = nodeParts(MODULAR_URL, index);
    if (node.name && parts.length > 0) {
      out.set(node.name, Math.max(...parts.map((part) => part.targetNames.length)));
    }
  });
  return out;
}

function nodeMaterialName(node: string): string | undefined {
  const index = (gltf(MODULAR_URL).nodes ?? []).findIndex((n) => n.name === node);
  const part = nodeParts(MODULAR_URL, index)[0];
  return part ? materialOf(MODULAR_URL, part)?.name : undefined;
}

describe('the composed sweep stands for every loadout', () => {
  const targets = nodeTargets();
  const single: ArmorLoadout[] = ARMOR_SLOTS.flatMap((slot) =>
    ARMOR_SETS.map((set): ArmorLoadout => ({ [slot]: set })),
  );

  it('armour and the underclothing it replaces carry no morph target', () => {
    // So whatever a mixed loadout folds together adds no target name to any
    // bucket: its armour and underclothing only ever key the 0-target tuples.
    let armour = 0;
    let replaced = 0;
    for (const gender of ['male', 'female'] as const) {
      const app = normalizeAppearance({ ...DEFAULT_APPEARANCE, gender });
      const bare = new Set(modularPartNames(app, {}));
      for (const worn of single) {
        const picked = new Set(modularPartNames(app, worn));
        for (const node of picked) {
          if (bare.has(node)) continue;
          armour++;
          expect(targets.get(node), node).toBe(0);
        }
        // What a helm removes (hair, ears, beard, earrings) the full sets sweep
        // per helm kind; what any other slot removes is underclothing.
        if (helmKind(worn) !== 'none') continue;
        for (const node of bare) {
          if (picked.has(node)) continue;
          replaced++;
          expect(targets.get(node), node).toBe(0);
        }
      }
    }
    expect(armour).toBeGreaterThan(50);
    expect(replaced).toBeGreaterThan(0);
  });

  it('draws the whole body, head and skin parts, under every loadout', () => {
    // The skin parts merge into one 14-target draw: a slot that hid a limb
    // would key a target count no full set reaches.
    for (const gender of ['male', 'female'] as const) {
      const app = normalizeAppearance({ ...DEFAULT_APPEARANCE, gender });
      const body = modularPartNames(app, {}).filter(
        (node) => nodeMaterialName(node) === 'mod_skin_detail' || MODULAR_HEAD_NODES.includes(node),
      );
      expect(body).toHaveLength(10);
      for (const worn of [...single, ...ARMOR_SETS.map((set) => fullSet(set))]) {
        const picked = new Set(modularPartNames(app, worn));
        for (const node of body) expect(picked.has(node), `${gender} ${node}`).toBe(true);
      }
    }
  });
});

describe('the census merge model against the real merge', () => {
  let scene: THREE.Object3D;
  beforeAll(async () => {
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    // A program is keyed by the map's presence, not its texels.
    loader.setKTX2Loader({
      load(_url: string, onLoad: (texture: THREE.Texture) => void) {
        onLoad(new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1));
      },
    } as never);
    const buffer = readFileSync(publicPath(MODULAR_URL));
    const glb = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    scene = (await loader.parseAsync(glb as ArrayBuffer, '')).scene;
  }, 60_000);

  /** The look as assets.ts modularVariant composes it, each mesh keyed the way
   *  the veil keys the draw it mounts there. */
  function realKeys(app: ModularAppearance, worn: ArmorLoadout): string[] {
    const root = cloneSkinned(scene);
    const keep = new Set(modularPartNames(app, worn));
    const drop: THREE.Object3D[] = [];
    root.traverse((object) => {
      if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
      if (keep.has(object.name) || (object.parent && keep.has(object.parent.name))) return;
      drop.push(object);
    });
    for (const object of drop) object.removeFromParent();
    mergeSkinnedParts(root, undefined, {
      partitionKey: (mesh) => modularMergePartition(mesh.name),
    });
    const keys: string[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const veil = createSpiritVeilMaterial(mesh.material as THREE.Material);
      keys.push(...(spiritVeilKeysFor(veil, mesh) ?? []));
      veil.dispose();
    });
    return [...new Set(keys)].sort();
  }

  // The key SET is what the census reads. The model folds more of a set's
  // zero-target armour pieces than the real merge (whose bind law refuses
  // some), and those key alike either way.
  const modelKeys = (app: ModularAppearance, worn: ArmorLoadout): string[] =>
    [...new Set(composedParts(app, worn).flatMap((part) => partKeys(MODULAR_URL, part)))].sort();

  it('keys a sample of looks, every loadout of both genders, exactly as the real merge does', () => {
    // One look per distinct key set the model produces (so every merged morph
    // count it claims meets the real merge), plus a stride floor that spans
    // every loadout of both genders.
    if (lookPerKeySet.size === 0) census();
    const sample = [...lookPerKeySet.values(), ...looks().filter((_, i) => i % 331 === 0)];
    const loadouts = new Set(
      sample.map(({ app, worn }) => `${app.gender}:${JSON.stringify(worn)}`),
    );
    expect(loadouts.size).toBe(2 * (ARMOR_SETS.length + 1));
    expect(lookPerKeySet.size).toBeGreaterThan(10);
    for (const { app, worn } of sample) {
      expect(modelKeys(app, worn), JSON.stringify({ app, worn })).toEqual(realKeys(app, worn));
    }
  });
});
