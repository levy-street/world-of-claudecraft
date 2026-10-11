// The pure parts of the head pack split (scripts/assets/woc_character/woc_head_pack_split.mjs):
// its copy of the catalog's file rule must name the same file woc_head_catalog.ts
// (wocHeadPieceUrl) does for every piece of both head types, and its lossless normal path must
// re-encode EVERY 8-bit octahedral code onto itself through the real meshopt encoder, so a
// rebuild never re-quantizes a normal. The shipped files themselves are checked by
// tests/woc_head_split_files.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptEncoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  fileOfPiece,
  normalsForCodes,
  octahedralNormalCodes,
  parseGlb,
} from '../scripts/assets/woc_character/woc_head_pack_split.mjs';
import {
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_SITES,
  type WocHeadType,
  wocHeadAllNodes,
  wocHeadBaseNode,
  wocHeadCoreUrl,
  wocHeadPieceUrl,
  wocHeadPiercingNode,
  wocHeadVariantNodes,
} from '../src/render/characters/woc_head_catalog';

const TYPES: WocHeadType[] = ['a', 'b'];

beforeAll(async () => {
  await MeshoptEncoder.ready;
});

describe('woc head pack split: the file rule', () => {
  it.each(TYPES)('files every Type %s piece where the catalog serves it from', (type) => {
    const want = new Map<string, string>();
    const core = path.posix.basename(wocHeadCoreUrl(type));
    want.set(wocHeadBaseNode(type), core);
    for (const site of WOC_PIERCING_SITES) want.set(wocHeadPiercingNode(type, site), core);
    for (const slot of WOC_HEAD_SLOTS) {
      for (const { id } of WOC_HEAD_TYPES[type].slots[slot]) {
        const url = wocHeadPieceUrl(type, slot, id);
        for (const node of wocHeadVariantNodes(type, slot, id)) {
          want.set(node, path.posix.basename(url ?? ''));
        }
      }
    }
    // the map covers the whole library, and the script agrees on every node
    expect([...want.keys()].sort()).toEqual([...wocHeadAllNodes(type)].sort());
    for (const [node, file] of want) expect(fileOfPiece(node), node).toEqual({ type, file });
  });

  it('refuses a name outside the export contract', () => {
    expect(() => fileOfPiece('Character_Body')).toThrow(/not a head piece name/);
    expect(() => fileOfPiece('WocHead_A_hat_tall')).toThrow(/unknown head slot/);
    expect(() => fileOfPiece('WocHead_A_nose')).toThrow(/without a variant id/);
    // hair and facial hair are centred pieces: a paired one would get a file of its own
    expect(() => fileOfPiece('WocHead_B_hair_twins_L')).toThrow(/centred/);
  });
});

describe('woc head pack split: lossless normals', () => {
  it('re-encodes every 8-bit octahedral code onto itself', () => {
    const codes = new Int8Array(255 * 255 * 4);
    let n = 0;
    for (let u = -127; u <= 127; u++) {
      for (let v = -127; v <= 127; v++) {
        codes.set([u, v, 127, 0], n * 4);
        n++;
      }
    }
    const normals = normalsForCodes(codes);
    const padded = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) padded.set(normals.subarray(i * 3, i * 3 + 3), i * 4);
    const encoded = new Int8Array(MeshoptEncoder.encodeFilterOct(padded, n, 4, 8).buffer);
    const moved: string[] = [];
    for (let i = 0; i < n; i++) {
      const same =
        encoded[i * 4] === codes[i * 4] &&
        encoded[i * 4 + 1] === codes[i * 4 + 1] &&
        encoded[i * 4 + 2] === 127;
      if (!same) moved.push(`${codes[i * 4]},${codes[i * 4 + 1]}`);
    }
    // the fold edge included: a zero component there must keep the sign its code carries
    expect(moved.slice(0, 5), `${moved.length} codes moved`).toEqual([]);
  });

  it('reads the stored codes of every shipped normal, and refuses a normal stored otherwise', () => {
    const glb = parseGlb(readFileSync(path.join(__dirname, '..', 'public', wocHeadCoreUrl('a'))));
    const json = glb.json as {
      accessors: { count: number; bufferView: number }[];
      bufferViews: { extensions?: { EXT_meshopt_compression?: { filter?: string } } }[];
      meshes: { primitives: { attributes: Record<string, number | undefined> }[] }[];
    };
    const normals = json.meshes
      .flatMap((m) => m.primitives.map((p) => p.attributes.NORMAL))
      .filter((i): i is number => i !== undefined);
    expect(normals.length).toBeGreaterThan(0);
    const codes = octahedralNormalCodes(glb);
    expect(codes, 'the core stores its normals as octahedral codes').not.toBeNull();
    expect([...(codes?.keys() ?? [])].sort((a, b) => a - b)).toEqual(
      [...new Set(normals)].sort((a, b) => a - b),
    );
    for (const [index, c] of codes ?? []) {
      expect(c.length, `accessor ${index}`).toBe(json.accessors[index].count * 4);
    }
    // the same file with one normal's filter dropped: no codes to recover, so no FILTER path
    const view = json.bufferViews[json.accessors[normals[0]].bufferView];
    const meshopt = view.extensions?.EXT_meshopt_compression;
    if (meshopt) meshopt.filter = undefined;
    expect(octahedralNormalCodes(glb)).toBeNull();
  });
});
