// The SHIPPED head library against the merge's fold rule
// (src/render/characters/woc_head_merge_core.ts wocHeadMergeFoldPlan), read off each
// split file's own JSON chunk (no three.js): every look the catalog can pick folds into
// ONE merged material within the shader's slot table, whole but for its gold piercings,
// a two texture hairstyle's scalp cap on its own layer, Type B's eyeliner on the white
// cell, and only a head with a one sided piece asking for the back-face drop. A new
// piece kind, a material renamed into a worn surface family, or a look that outgrows
// the table fails here instead of quietly going back to a dozen draws.
//
// And the same files through the GEOMETRY fold (woc_head_merge_fold.ts), parsed by the
// loader the game assembles (GLTFLoader, the meshopt decoder, the WOC_lod plugin; the
// textures taken out first, no transcoder runs headless): a real head is a chain of a
// dozen bands and more, and the chain builds the very geometry the fold builds whole.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { geometryLodOf, geometryLodVariant } from '../src/render/assets/geometry_lod';
import { wocLodPlugin } from '../src/render/assets/woc_lod_plugin';
import {
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_IDS,
  type WocHeadLook,
  type WocHeadType,
  wocHeadAllUrls,
  wocHeadBaseNode,
  wocHeadVisibleNodes,
} from '../src/render/characters/woc_head_catalog';
import { wocHeadTintRef } from '../src/render/characters/woc_head_look_core';
import {
  WOC_HEAD_MERGE_BAND_INDICES,
  WOC_HEAD_MERGE_BAND_VERTICES,
  WOC_HEAD_MERGE_LAYER,
  WOC_HEAD_MERGE_MAX_SLOTS,
  type WocHeadMergeFoldFacts,
  type WocHeadMergeFoldPlan,
  wocHeadMergeFoldPlan,
  wocHeadMergeFoldUnits,
  wocHeadMergeOneSided,
} from '../src/render/characters/woc_head_merge_core';
import {
  mergeWocHeadGeometry,
  WocHeadGeometryFold,
  type WocHeadMergePiece,
} from '../src/render/characters/woc_head_merge_fold';
import { riggedWornFamilyFor } from '../src/render/worn_stone';

const TYPES: WocHeadType[] = ['a', 'b'];

interface GlbMaterial {
  name?: string;
  alphaMode?: string;
  doubleSided?: boolean;
  extras?: { wocHeadAtlas?: { white?: unknown } };
  pbrMetallicRoughness?: {
    baseColorTexture?: { index?: number };
    metallicRoughnessTexture?: unknown;
  };
  normalTexture?: unknown;
  occlusionTexture?: unknown;
  emissiveTexture?: unknown;
}

interface GlbJson {
  nodes?: { name?: string; mesh?: number }[];
  meshes?: { primitives: { material?: number; attributes: Record<string, number> }[] }[];
  materials?: GlbMaterial[];
}

/** The JSON chunk of a GLB served from public/. */
function glbJson(url: string): GlbJson {
  const buf = readFileSync(path.resolve(__dirname, '..', 'public', url));
  expect(buf.readUInt32LE(0), `${url}: GLB magic`).toBe(0x46546c67);
  expect(buf.readUInt32LE(16), `${url}: first chunk is JSON`).toBe(0x4e4f534a);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

interface Library {
  /** Piece node name -> one fact per mesh it draws (a primitive each). */
  readonly pieces: ReadonlyMap<string, readonly WocHeadMergeFoldFacts[]>;
  /** Whether the base head's material carries the atlas's white cell. */
  readonly hasWhiteCell: boolean;
}

/** Every piece of a type's library as the fold rule sees it, from the files' JSON. */
function library(type: WocHeadType): Library {
  const pieces = new Map<string, WocHeadMergeFoldFacts[]>();
  let hasWhiteCell = false;
  for (const url of wocHeadAllUrls(type)) {
    const json = glbJson(url);
    for (const node of json.nodes ?? []) {
      if (node.mesh === undefined || !node.name) continue;
      const facts = (json.meshes?.[node.mesh]?.primitives ?? []).map((prim) => {
        const index = prim.material ?? -1;
        const material = json.materials?.[index] ?? {};
        const name = material.name ?? '';
        const texture = material.pbrMetallicRoughness?.baseColorTexture?.index;
        const tint = wocHeadTintRef(type, name);
        // what woc_head_merge.ts asks of a file material, as glTF spells it: opaque,
        // nothing but a colour map, no vertex colours, and a name the tier derivation
        // gives no worn surface layer to
        const mergeable =
          (material.alphaMode ?? 'OPAQUE') === 'OPAQUE' &&
          material.normalTexture === undefined &&
          material.occlusionTexture === undefined &&
          material.emissiveTexture === undefined &&
          material.pbrMetallicRoughness?.metallicRoughnessTexture === undefined &&
          prim.attributes.COLOR_0 === undefined &&
          riggedWornFamilyFor(name) === null;
        return {
          piece: node.name as string,
          material: `${url}#material${index}`,
          map: texture === undefined ? null : `${url}#texture${texture}`,
          mergeable,
          placeable: true,
          hasUv: prim.attributes.TEXCOORD_0 !== undefined,
          oneSided: material.doubleSided !== true,
          role: tint?.role ?? null,
          ref: tint?.ref ?? null,
        };
      });
      pieces.set(node.name, facts);
      if (node.name === wocHeadBaseNode(type)) {
        const base = json.materials?.[json.meshes?.[node.mesh]?.primitives[0]?.material ?? -1];
        hasWhiteCell = Array.isArray(base?.extras?.wocHeadAtlas?.white);
      }
    }
  }
  return { pieces, hasWhiteCell };
}

/** A look's drawn meshes in the order the dressing hands them to the merge (by piece
 *  name, a piece's own meshes in file order), and the plan the fold answers. */
function fold(
  lib: Library,
  type: WocHeadType,
  look: Partial<WocHeadLook>,
): { drawn: WocHeadMergeFoldFacts[]; plan: WocHeadMergeFoldPlan | null } {
  const nodes = [...wocHeadVisibleNodes(type, look, { helm: false })].sort();
  const drawn = nodes.flatMap((node) => {
    const facts = lib.pieces.get(node);
    expect(facts, `${node} ships in the library`).toBeDefined();
    return facts ?? [];
  });
  return { drawn, plan: wocHeadMergeFoldPlan(drawn, lib.hasWhiteCell) };
}

/** Every look worth folding: each hairstyle with each beard, then each variant of
 *  every other slot and each piercing preset on the default look. */
function looks(type: WocHeadType): Partial<WocHeadLook>[] {
  const def = WOC_HEAD_TYPES[type];
  const out: Partial<WocHeadLook>[] = [];
  for (const hair of def.slots.hair) {
    for (const beard of def.slots.beard) out.push({ hair: hair.id, beard: beard.id });
  }
  for (const slot of WOC_HEAD_SLOTS) {
    if (slot === 'hair' || slot === 'beard') continue;
    for (const variant of def.slots[slot]) out.push({ [slot]: variant.id });
  }
  for (const piercing of WOC_PIERCING_IDS) out.push({ piercing });
  return out;
}

const label = (look: Partial<WocHeadLook>): string => JSON.stringify(look);

describe('the shipped head library under the merge fold rule', () => {
  it.each(TYPES)('every Type %s look folds whole, but for its gold piercings', (type) => {
    const lib = library(type);
    expect(lib.hasWhiteCell).toBe(true);
    const all = looks(type);
    expect(all.length).toBeGreaterThan(80);
    let piercingsLeftOut = 0;
    for (const look of all) {
      const { drawn, plan } = fold(lib, type, look);
      expect(plan, label(look)).not.toBeNull();
      const folded = new Set(plan?.folded.map((f) => f.at));
      const leftOut = drawn.filter((_f, i) => !folded.has(i));
      // nothing but a piercing ever keeps drawing by itself
      expect(
        leftOut.filter((f) => !f.piece.includes('_piercing_')).map((f) => f.piece),
        label(look),
      ).toEqual([]);
      piercingsLeftOut += leftOut.length;
      // the base head is the merged material's source
      expect(drawn[plan?.base ?? -1]?.piece, label(look)).toBe(wocHeadBaseNode(type));
    }
    // the piercings ARE in the sweep (their gold takes the worn metal layer by its name)
    expect(piercingsLeftOut).toBeGreaterThan(0);
  });

  it.each([
    ['a', 14],
    ['b', 16],
  ] as const)("the fullest Type %s look takes %i of the shader's slots", (type, fullest) => {
    const lib = library(type);
    let most = 0;
    for (const look of looks(type)) {
      // the busiest head: this look's hair and beard over a full set of piercings
      const { plan } = fold(lib, type, { ...look, piercing: 'full' });
      most = Math.max(most, plan?.slots.length ?? 0);
    }
    // literal: the head, two brows, two ears, two eyelid shells, two eyeballs (and on
    // Type B two eyeliners), the mouth, the nose, a hairstyle and its scalp cap, a beard
    expect(most).toBe(fullest);
    expect(most).toBeLessThanOrEqual(WOC_HEAD_MERGE_MAX_SLOTS);
  });

  it.each(TYPES)("puts a two texture Type %s hairstyle's scalp cap on its own layer", (type) => {
    const lib = library(type);
    let capped = 0;
    for (const { id } of WOC_HEAD_TYPES[type].slots.hair) {
      const { drawn, plan } = fold(lib, type, { hair: id });
      const hair = (plan?.folded ?? []).filter((f) => drawn[f.at].piece.includes('_hair_'));
      const textures = new Set(drawn.filter((f) => f.piece.includes('_hair_')).map((f) => f.map));
      // every mesh of the hairstyle folds, one layer per texture it ships
      expect(hair.length, id).toBe(drawn.filter((f) => f.piece.includes('_hair_')).length);
      expect(new Set(hair.map((f) => f.layer)).size, id).toBe(textures.size);
      expect(textures.size, id).toBeLessThanOrEqual(2);
      if (textures.size === 2) {
        capped++;
        expect(
          hair.map((f) => f.layer),
          id,
        ).toEqual([WOC_HEAD_MERGE_LAYER.hair, WOC_HEAD_MERGE_LAYER.scalp]);
        expect(plan?.scalpMap, id).not.toBeNull();
        expect(plan?.scalpMap, id).not.toBe(plan?.hairMap);
      } else {
        expect(plan?.scalpMap ?? null, id).toBeNull();
      }
    }
    // both kinds ship: hairstyles on one texture, and hairstyles with a scalp cap
    expect(capped).toBeGreaterThan(0);
    expect(capped).toBeLessThan(WOC_HEAD_TYPES[type].slots.hair.length - 1);
  });

  it("folds Type B's untextured eyeliner onto the white cell", () => {
    const lib = library('b');
    const { drawn, plan } = fold(lib, 'b', {});
    const flat = (plan?.folded ?? []).filter((f) => f.flat).map((f) => drawn[f.at]);
    expect(flat.length).toBe(2);
    for (const f of flat) {
      expect(f.piece).toMatch(/^WocHead_B_eyes_/);
      expect(f.map).toBeNull();
    }
    // without the cell they would keep drawing by themselves: two more draws a head
    const without = wocHeadMergeFoldPlan(drawn, false);
    expect(without?.folded.length).toBe((plan?.folded.length ?? 0) - 2);
  });

  it('asks for the back-face drop only where a look has a one sided piece', () => {
    // Type A: its head, eyelids and eyeballs are one sided, whatever the look
    const a = library('a');
    for (const look of looks('a')) {
      const { plan } = fold(a, 'a', look);
      expect(wocHeadMergeOneSided(plan?.slots ?? []), label(look)).toBe(true);
    }
    // Type B: every piece two sided but the handlebar moustache
    const b = library('b');
    let dropped = 0;
    for (const look of looks('b')) {
      const { plan } = fold(b, 'b', look);
      const oneSided = wocHeadMergeOneSided(plan?.slots ?? []);
      expect(oneSided, label(look)).toBe(look.beard === 'handlebar');
      if (oneSided) dropped++;
    }
    expect(dropped).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The geometry fold on the shipped files
// ---------------------------------------------------------------------------

/** A GLB with every texture reference taken out of its JSON (the binary chunk as is):
 *  the fold reads geometry alone, and no KTX2 transcoder runs headless
 *  (tests/woc_armor_merge_assets.test.ts does the same for the armor). */
function withoutTextures(url: string): ArrayBuffer {
  const file = readFileSync(path.resolve(__dirname, '..', 'public', url));
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
  delete json.textures;
  delete json.images;
  delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
  }
  const keep = (list?: string[]): string[] =>
    (list ?? []).filter((name) => name !== 'KHR_texture_basisu');
  json.extensionsUsed = keep(json.extensionsUsed);
  json.extensionsRequired = keep(json.extensionsRequired);
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const chunk = Buffer.from(text);
  const rest = file.subarray(20 + jsonLength);
  const out = Buffer.alloc(20 + chunk.length + rest.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(chunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(out, 20);
  rest.copy(out, 20 + chunk.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** Every piece node of a type's shipped library, parsed, by its name. */
async function parsedLibrary(type: WocHeadType): Promise<Map<string, THREE.Object3D>> {
  await MeshoptDecoder.ready;
  const nodes = new Map<string, THREE.Object3D>();
  for (const url of wocHeadAllUrls(type)) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.register(wocLodPlugin);
    const gltf = await loader.parseAsync(withoutTextures(url), '');
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.name.startsWith('WocHead_')) nodes.set(o.name, o);
    });
  }
  return nodes;
}

/** A look's drawn meshes as the merge folds them: by piece name (the dressing's order),
 *  every mesh but a gold piercing's, each posed (every face control off its rest), one
 *  slot per material, an untextured piece on the white cell. `mid`: the pieces draw their
 *  mid level, as a crowd character's do. */
function foldPieces(
  nodes: ReadonlyMap<string, THREE.Object3D>,
  type: WocHeadType,
  look: Partial<WocHeadLook>,
  mid = false,
): WocHeadMergePiece[] {
  const pieces: WocHeadMergePiece[] = [];
  const slots = new Map<THREE.Material, number>();
  for (const name of [...wocHeadVisibleNodes(type, look, { helm: false })].sort()) {
    nodes.get(name)?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const material = mesh.isMesh ? (mesh.material as THREE.Material) : null;
      if (!material || riggedWornFamilyFor(material.name) !== null) return;
      if (!slots.has(material)) slots.set(material, slots.size);
      const influences = mesh.morphTargetInfluences;
      if (influences) {
        for (let t = 0; t < influences.length; t++)
          influences[t] = ((t * 37 + 11) % 100) / 100 - 0.3;
      }
      // a mesh of its own over the shared geometry (or its mid level), as a hung piece is
      const drawn = new THREE.Mesh(
        mid ? geometryLodVariant(mesh.geometry, 'mid') : mesh.geometry,
        material,
      );
      drawn.morphTargetInfluences = influences ? [...influences] : undefined;
      pieces.push({
        mesh: drawn,
        toRoot: mesh.matrixWorld.clone(),
        slot: slots.get(material) ?? 0,
        flatUv: mesh.geometry.getAttribute('uv') ? null : [0.5, 0.25],
      });
    });
  }
  return pieces;
}

const list = (a: THREE.BufferAttribute | null | undefined): number[] | null =>
  a ? Array.from(a.array) : null;

/** Everything a merged geometry is: its attributes, index, coarser levels and bounds. */
function wholeOf(geo: THREE.BufferGeometry) {
  const lod = geometryLodOf(geo);
  return {
    attributes: Object.keys(geo.attributes).sort(),
    position: list(geo.getAttribute('position') as THREE.BufferAttribute),
    normal: list(geo.getAttribute('normal') as THREE.BufferAttribute),
    uv: list(geo.getAttribute('uv') as THREE.BufferAttribute),
    slot: list(geo.getAttribute('aWocHmSlot') as THREE.BufferAttribute),
    index: list(geo.index),
    mid: list(lod?.mid),
    far: list(lod?.far),
    box: [geo.boundingBox?.min.toArray(), geo.boundingBox?.max.toArray()],
    sphere: [geo.boundingSphere?.center.toArray(), geo.boundingSphere?.radius],
  };
}

/** The looks folded here: every hairstyle under the default beard, every beard under
 *  the default hairstyle. */
function foldedLooks(type: WocHeadType): Partial<WocHeadLook>[] {
  const def = WOC_HEAD_TYPES[type];
  return [
    ...def.slots.hair.map((hair) => ({ hair: hair.id })),
    ...def.slots.beard.map((beard) => ({ beard: beard.id })),
  ];
}

describe('the shipped head library through the geometry fold', () => {
  it.each(TYPES)(
    'every Type %s head is a chain of bands, and the chain builds the very geometry the whole fold builds',
    async (type) => {
      const nodes = await parsedLibrary(type);
      const all = foldedLooks(type);
      expect(all.length).toBeGreaterThan(15);
      let levels = 0;
      for (const [n, look] of all.entries()) {
        // every other look at the crowd's level: the fold reads the pieces' SOURCES
        const mid = n % 2 === 1;
        const whole = wholeOf(mergeWocHeadGeometry(foldPieces(nodes, type, look, mid)));
        const fold = new WocHeadGeometryFold(foldPieces(nodes, type, look, mid));
        let calls = 0;
        let out: THREE.BufferGeometry | null = null;
        while (!out) {
          const before = [fold.foldedVertices, fold.foldedIndices];
          out = fold.step();
          calls++;
          // no unit folds more than its band
          expect(fold.foldedVertices - before[0], label(look)).toBeLessThanOrEqual(
            WOC_HEAD_MERGE_BAND_VERTICES,
          );
          expect(fold.foldedIndices - before[1], label(look)).toBeLessThanOrEqual(
            WOC_HEAD_MERGE_BAND_INDICES,
          );
        }
        // a real head is never one unit: a dozen bands and more, as the core counts them
        expect(fold.vertices, label(look)).toBeGreaterThan(6000);
        expect(calls, label(look)).toBe(wocHeadMergeFoldUnits(fold.vertices, fold.indices));
        expect(calls, label(look)).toBeGreaterThan(12);
        // identical: every attribute, the index, the coarser levels, the bounds
        const chained = wholeOf(out);
        expect(chained.position?.length, label(look)).toBe(fold.vertices * 3);
        expect(chained.index?.length, label(look)).toBe(fold.indices);
        expect(chained, label(look)).toEqual(whole);
        if (chained.mid && chained.far) levels++;
      }
      // the library ships its coarser levels: they were compared, not absent on both sides
      expect(levels).toBe(all.length);
    },
    60_000,
  );

  it.each([
    ['a', 13597, 30],
    ['b', 14297, 31],
  ] as const)(
    'the fullest Type %s head is %i vertices: %i units of the fold',
    async (type, vertices, units) => {
      const nodes = await parsedLibrary(type);
      const def = WOC_HEAD_TYPES[type];
      let most = { vertices: 0, indices: 0 };
      let least = Number.POSITIVE_INFINITY;
      for (const hair of def.slots.hair) {
        for (const beard of def.slots.beard) {
          const fold = new WocHeadGeometryFold(
            foldPieces(nodes, type, { hair: hair.id, beard: beard.id }),
          );
          if (fold.vertices > most.vertices) most = fold;
          least = Math.min(least, wocHeadMergeFoldUnits(fold.vertices, fold.indices));
        }
      }
      // literal: re-pin when the head library is rebuilt
      expect(most.vertices).toBe(vertices);
      expect(wocHeadMergeFoldUnits(most.vertices, most.indices)).toBe(units);
      // and the smallest head the catalog can pick is still a chain of many units
      expect(least).toBeGreaterThan(12);
    },
    60_000,
  );

  it('puts every folded vertex where its piece draws it, with its slot, and every triangle on its own vertices', async () => {
    // the whole fold held to the pieces themselves (the chain is held to it above): a
    // posed vertex through its placement, the slot of its material, its own index list
    // offset by the vertices before it and wound as its placement winds it
    const nodes = await parsedLibrary('b');
    const pieces = foldPieces(nodes, 'b', { hair: 'waves', beard: 'long' });
    const geo = mergeWocHeadGeometry(pieces);
    const position = geo.getAttribute('position');
    const slot = geo.getAttribute('aWocHmSlot');
    const index = geo.index as THREE.BufferAttribute;
    const at = new THREE.Vector3();
    const drawn = new THREE.Vector3();
    let v0 = 0;
    let i0 = 0;
    let checked = 0;
    for (const piece of pieces) {
      const source = piece.mesh.geometry;
      const count = source.getAttribute('position').count;
      for (let i = 0; i < count; i += 53) {
        piece.mesh.getVertexPosition(i, drawn).applyMatrix4(piece.toRoot);
        at.fromBufferAttribute(position, v0 + i);
        expect(at.distanceTo(drawn)).toBeLessThan(1e-6);
        expect(slot.getX(v0 + i)).toBe(piece.slot);
        checked++;
      }
      const own = source.index as THREE.BufferAttribute;
      const flip = piece.toRoot.determinant() < 0;
      for (let k = 0; k < own.count; k += 3 * 41) {
        const tri = [own.getX(k), own.getX(k + 1), own.getX(k + 2)];
        expect([index.getX(i0 + k), index.getX(i0 + k + 1), index.getX(i0 + k + 2)]).toEqual(
          (flip ? [tri[0], tri[2], tri[1]] : tri).map((v) => v0 + v),
        );
      }
      v0 += count;
      i0 += own.count;
    }
    expect(v0).toBe(position.count);
    expect(i0).toBe(index.count);
    expect(checked).toBeGreaterThan(250);
    // the levels are the pieces' own, one after another (a piece that ships no mid level
    // draws its level 0 there: the next finer one it carries)
    const mid = pieces.reduce(
      (n, p) =>
        n + (geometryLodOf(p.mesh.geometry)?.mid?.count ?? p.mesh.geometry.index?.count ?? 0),
      0,
    );
    expect(geometryLodOf(geo)?.mid?.count).toBe(mid);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(index.count);
  }, 60_000);
});
