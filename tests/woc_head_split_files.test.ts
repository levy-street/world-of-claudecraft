// The WOC head library ships SPLIT (src/render/characters/woc_head_catalog.ts wocHeadAllUrls,
// cut from each compressed pack by scripts/assets/woc_character/woc_head_pack_split.mjs): the
// head files on disk are exactly the catalog's split files for both head types (no
// whole-library pack left behind, no stray or missing piece file), and each is a GLB whose
// pieces hang under the rig's `head` bone in the file the catalog's rule names. Reads each GLB's
// own JSON chunk (no three.js), so a renamed, dropped or misfiled piece fails here instead of
// silently drawing no hair. Each texture's KTX2 header is read too: the hair, scalp and beard
// textures ship grey as ETC1S (woc_head_pack_compress.mjs), the core atlas as UASTC.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readKtx2 } from '../scripts/assets/woc_character/ktx2_levels.mjs';
import {
  WOC_HEAD_BALD_CROWN_MORPH,
  WOC_HEAD_MORPHS,
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_SITES,
  type WocHeadType,
  wocHeadAllNodes,
  wocHeadAllUrls,
  wocHeadBaseNode,
  wocHeadCoreUrl,
  wocHeadPieceUrl,
  wocHeadPiercingNode,
  wocHeadVariantNodes,
} from '../src/render/characters/woc_head_catalog';

const TYPES: WocHeadType[] = ['a', 'b'];
const PUBLIC = path.resolve(__dirname, '..', 'public');
/** The split directory, read off the catalog's own URLs. */
const HEAD_DIR = path.posix.dirname(wocHeadCoreUrl('a'));

interface GlbJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; children?: number[]; mesh?: number }[];
  meshes?: {
    name?: string;
    extras?: { targetNames?: string[] };
    primitives: { material?: number; targets?: unknown[] }[];
  }[];
  materials?: unknown[];
  textures?: { source?: number; extensions?: Record<string, { source?: number } | undefined> }[];
  images?: unknown[];
}

/** The JSON chunk of a GLB served from public/. */
function glbJson(url: string): GlbJson {
  const buf = readFileSync(path.join(PUBLIC, url));
  expect(buf.readUInt32LE(0), `${url}: GLB magic`).toBe(0x46546c67);
  expect(buf.readUInt32LE(16), `${url}: first chunk is JSON`).toBe(0x4e4f534a);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

/** Each file of a type, with the nodes the catalog's rule puts in it. */
function expectedNodesByUrl(type: WocHeadType): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (url: string, nodes: string[]): void => {
    out.set(url, [...(out.get(url) ?? []), ...nodes]);
  };
  add(wocHeadCoreUrl(type), [wocHeadBaseNode(type)]);
  for (const site of WOC_PIERCING_SITES) {
    add(wocHeadCoreUrl(type), [wocHeadPiercingNode(type, site)]);
  }
  for (const slot of WOC_HEAD_SLOTS) {
    for (const { id } of WOC_HEAD_TYPES[type].slots[slot]) {
      const url = wocHeadPieceUrl(type, slot, id);
      if (url) add(url, wocHeadVariantNodes(type, slot, id));
    }
  }
  return out;
}

/** The names from the scene root down to a node's parent. */
function ancestors(json: GlbJson, index: number): string[] {
  const nodes = json.nodes ?? [];
  const parent = new Map<number, number>();
  nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parent.set(c, i);
  });
  const out: string[] = [];
  for (let at = parent.get(index); at !== undefined; at = parent.get(at)) {
    out.unshift(nodes[at].name ?? '');
  }
  return out;
}

/** Every image a texture references: its own `source` and each extension's (KTX2, WebP). */
function textureSources(tex: NonNullable<GlbJson['textures']>[number]): number[] {
  const all = [tex.source, ...Object.values(tex.extensions ?? {}).map((e) => e?.source)];
  return all.filter((s): s is number => typeof s === 'number');
}

/** A GLB's JSON (the parts a texture's codec is read through) and its BIN chunk. */
interface GlbChunks {
  json: {
    materials?: Record<string, unknown>[];
    textures?: NonNullable<GlbJson['textures']>;
    images?: { name?: string; bufferView: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  bin: Buffer;
}

function glbChunks(url: string): GlbChunks {
  const buf = readFileSync(path.join(PUBLIC, url));
  const jsonLength = buf.readUInt32LE(12);
  const binAt = 20 + jsonLength;
  expect(buf.readUInt32LE(binAt + 4), `${url}: second chunk is BIN`).toBe(0x004e4942);
  return {
    json: JSON.parse(buf.subarray(20, binAt).toString('utf8')) as GlbChunks['json'],
    bin: buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt)),
  };
}

/** Each texture index a file's materials sample, with every (material name, slot) sampling it. */
function textureUses(json: GlbChunks['json']): Map<number, { material: string; slot: string }[]> {
  const out = new Map<number, { material: string; slot: string }[]>();
  for (const m of json.materials ?? []) {
    const material = typeof m.name === 'string' ? m.name : '';
    const walk = (v: unknown, key?: string): void => {
      if (Array.isArray(v)) for (const x of v) walk(x);
      else if (v && typeof v === 'object') {
        const index = (v as { index?: unknown }).index;
        if (key?.endsWith('Texture') && typeof index === 'number') {
          out.set(index, [...(out.get(index) ?? []), { material, slot: key }]);
        }
        for (const [k, x] of Object.entries(v)) walk(x, k);
      }
    };
    walk(m);
  }
  return out;
}

/** KTX2 data format descriptor colour models, the sRGB transfer, and supercompression schemes. */
const KTX2 = { etc1s: 163, uastc: 166, srgb: 2, basisLz: 1, zstd: 2 } as const;

/** Texture indices a file's materials sample (any `*Texture` slot, extensions included). */
function sampledTextures(json: GlbJson): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown, key?: string): void => {
    if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === 'object') {
      const index = (v as { index?: unknown }).index;
      if (key?.endsWith('Texture') && typeof index === 'number') out.add(index);
      for (const [k, x] of Object.entries(v)) walk(x, k);
    }
  };
  for (const m of json.materials ?? []) walk(m);
  return out;
}

describe('woc head split files', () => {
  it('ships exactly the catalog split files for both head types', () => {
    const onDisk = readdirSync(path.join(PUBLIC, HEAD_DIR))
      .filter((f) => f.startsWith('head_'))
      .map((f) => `${HEAD_DIR}/${f}`)
      .sort();
    const catalog = [...wocHeadAllUrls('a'), ...wocHeadAllUrls('b')];
    expect(new Set(catalog).size).toBe(catalog.length);
    expect(onDisk).toEqual([...catalog].sort());
  });

  it.each(TYPES)(
    'every Type %s file hangs exactly its catalog pieces under the rig head',
    (type) => {
      const expected = expectedNodesByUrl(type);
      // the rule covers every file the type ships, and nothing else
      expect([...expected.keys()].sort()).toEqual([...wocHeadAllUrls(type)].sort());
      let chain: string[] | null = null;
      let baseMorphs: string[] | null = null;
      for (const [url, nodes] of expected) {
        const json = glbJson(url);
        const all = json.nodes ?? [];
        const heads = all.flatMap((n, i) => (n.name === 'head' ? [i] : []));
        expect(heads, `${url}: one head node`).toHaveLength(1);
        const children = (all[heads[0]].children ?? []).map((i) => all[i]);
        expect(children.map((n) => n.name ?? '').sort(), url).toEqual([...nodes].sort());
        // every mesh the file draws is one of those pieces (none elsewhere in the rig)
        expect(
          all.filter((n) => n.mesh !== undefined),
          url,
        ).toHaveLength(nodes.length);
        const drawn = new Set<number>();
        for (const node of children) {
          const mesh = json.meshes?.[node.mesh ?? -1];
          expect(mesh?.name, `${url}: ${node.name}'s mesh`).toBe(node.name);
          // morphs are looked up by name: one real name per morph target (a lost name
          // comes back as its index)
          const names = mesh?.extras?.targetNames ?? [];
          expect(
            names.filter((nm) => /^\d+$/.test(nm)),
            `${url}: ${node.name} target names`,
          ).toEqual([]);
          for (const prim of mesh?.primitives ?? []) {
            expect(prim.targets ?? [], `${url}: ${node.name} target names`).toHaveLength(
              prim.targets ? names.length : 0,
            );
            if (prim.material !== undefined) drawn.add(prim.material);
          }
          if (node.name === wocHeadBaseNode(type)) baseMorphs = names;
        }
        // the rig's bone chain above `head` is whole and the same in every file of the type
        const up = ancestors(json, heads[0]);
        const roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map((i) => all[i].name);
        expect(roots, `${url}: head sits under a scene root`).toContain(up[0]);
        chain ??= up;
        expect(up, url).toEqual(chain);
        // a file carries only the materials its pieces draw and the textures and images those
        // sample (nothing downloaded for nothing)
        const upTo = (n: number): number[] => Array.from({ length: n }, (_x, i) => i);
        const sorted = (xs: Iterable<number>): number[] => [...xs].sort((a, b) => a - b);
        expect(sorted(drawn), `${url}: materials`).toEqual(upTo(json.materials?.length ?? 0));
        expect(sorted(sampledTextures(json)), `${url}: textures`).toEqual(
          upTo(json.textures?.length ?? 0),
        );
        expect(
          sorted(new Set((json.textures ?? []).flatMap(textureSources))),
          `${url}: images`,
        ).toEqual(upTo(json.images?.length ?? 0));
      }
      expect(chain?.at(-1), 'head hangs from the neck bone').toBe('neck');
      // the face controls the runtime drives by name all ride the base head
      expect(baseMorphs, `${wocHeadBaseNode(type)} morphs`).toEqual(
        expect.arrayContaining([...Object.values(WOC_HEAD_MORPHS), WOC_HEAD_BALD_CROWN_MORPH]),
      );
    },
  );

  it.each(TYPES)(
    'every Type %s hair, scalp and beard texture ships grey as ETC1S, the core as UASTC',
    (type) => {
      // woc_head_pack_compress.mjs (hair_grey.mjs): a texture only hair-role materials sample as
      // their base colour is its luminance in grey, ETC1S sRGB with every mip level; ETC1S never
      // reaches the core atlas (skin, eyes and brows draw from it) or any other slot
      let grey = 0;
      for (const url of wocHeadAllUrls(type)) {
        const { json, bin } = glbChunks(url);
        const uses = textureUses(json);
        const core = url === wocHeadCoreUrl(type);
        (json.textures ?? []).forEach((tex, t) => {
          const users = uses.get(t) ?? [];
          const hairOnly =
            users.length > 0 &&
            users.every(
              (u) => u.slot === 'baseColorTexture' && u.material.toLowerCase().startsWith('hair_'),
            );
          // a hairstyle or beard file samples nothing else; a core never one of those
          expect(hairOnly, `${url} texture ${t}`).toBe(!core);
          for (const index of textureSources(tex)) {
            const image = json.images?.[index];
            const view = image ? json.bufferViews[image.bufferView] : undefined;
            expect(view, `${url} image ${index}`).toBeDefined();
            if (!image || !view) continue;
            const at = view.byteOffset ?? 0;
            const ktx = readKtx2(bin.subarray(at, at + view.byteLength));
            const what = `${url} ${image.name}`;
            if (hairOnly) {
              expect(ktx.dfd[12], what).toBe(KTX2.etc1s);
              expect(ktx.supercompressionScheme, what).toBe(KTX2.basisLz);
              expect(ktx.dfd[14], `${what}: sRGB`).toBe(KTX2.srgb);
              const side = Math.max(ktx.pixelWidth, ktx.pixelHeight);
              expect(ktx.levelCount, `${what}: mip levels`).toBe(Math.floor(Math.log2(side)) + 1);
              grey++;
            } else {
              expect(ktx.dfd[12], what).toBe(KTX2.uastc);
              expect(ktx.supercompressionScheme, what).toBe(KTX2.zstd);
            }
          }
        });
      }
      // every hairstyle file and both beard files carry at least one
      expect(grey).toBeGreaterThanOrEqual(wocHeadAllUrls(type).length - 1);
    },
  );

  it.each(TYPES)('every Type %s catalog node ships in exactly one file', (type) => {
    const shipped = wocHeadAllUrls(type).flatMap((url) => {
      const json = glbJson(url);
      const head = json.nodes?.find((n) => n.name === 'head');
      return (head?.children ?? []).map((i) => json.nodes?.[i]?.name ?? '');
    });
    expect([...shipped].sort()).toEqual([...wocHeadAllNodes(type)].sort());
  });
});
