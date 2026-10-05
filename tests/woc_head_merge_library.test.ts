// The SHIPPED head library against the merge's fold rule
// (src/render/characters/woc_head_merge_core.ts wocHeadMergeFoldPlan), read off each
// split file's own JSON chunk (no three.js): every look the catalog can pick folds into
// ONE merged material within the shader's slot table, whole but for its gold piercings,
// a two texture hairstyle's scalp cap on its own layer, Type B's eyeliner on the white
// cell, and only a head with a one sided piece asking for the back-face drop. A new
// piece kind, a material renamed into a worn surface family, or a look that outgrows
// the table fails here instead of quietly going back to a dozen draws.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
  WOC_HEAD_MERGE_LAYER,
  WOC_HEAD_MERGE_MAX_SLOTS,
  type WocHeadMergeFoldFacts,
  type WocHeadMergeFoldPlan,
  wocHeadMergeFoldPlan,
  wocHeadMergeOneSided,
} from '../src/render/characters/woc_head_merge_core';
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
