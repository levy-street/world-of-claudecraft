// The head core's one colour atlas (scripts/assets/woc_character/head_atlas.mjs, run by
// woc_head_pack_compress.mjs): its pure helpers (the wrap fold, the block aligned crop,
// the packer and the bin search, which nodes are core pieces), the atlas step itself over
// a small synthetic pack (every textured core material on ONE texture, each texel copied
// where its remapped uv now points, a white cell recorded on every core material, hair
// untouched), and the two SHIPPED cores: one image, one texture, every material on it,
// every material carrying the white cell a merged face gives its flat-coloured pieces
// (src/render/characters/woc_head_merge.ts). Then the atlas's own mip levels (which cell a
// texel of a level stands for, what it holds, and that a level never holds the black
// between the cells), the inputs the step refuses, and the 16 bit uvs an atlas keeps
// through the pack-wide quantization.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type Accessor,
  Document,
  type Material,
  NodeIO,
  type Primitive,
  type Texture,
} from '@gltf-transform/core';
import {
  ALL_EXTENSIONS,
  KHRMaterialsClearcoat,
  KHRTextureTransform,
} from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  atlasHeadCore,
  cropSpan,
  HEAD_ATLAS_BLOCK,
  HEAD_ATLAS_GUTTER,
  HEAD_ATLAS_MARGIN,
  HEAD_ATLAS_UV_BITS,
  type HeadAtlasCellRect,
  type HeadAtlasLevel,
  type HeadAtlasLevelCell,
  type HeadAtlasPoint,
  type HeadAtlasRect,
  headAtlasCoverage,
  headAtlasLevelPngs,
  headAtlasLevelSizes,
  headAtlasMipLevels,
  headAtlasTexelCells,
  headAtlasUvCode,
  holdHeadAtlasUvs,
  isHeadCorePiece,
  packRects,
  releaseHeadAtlasUvs,
  smallestBin,
  wrapTexel,
} from '../scripts/assets/woc_character/head_atlas.mjs';
import { type WocHeadType, wocHeadCoreUrl } from '../src/render/characters/woc_head_catalog';
import { wocHeadNodesByFile } from './helpers/woc_head_split_fixture';

const TYPES: WocHeadType[] = ['a', 'b'];

// glTF sampler wrap modes
const CLAMP = 33071;
const REPEAT = 10497;
const MIRROR = 33648;
type Wrap = typeof CLAMP | typeof REPEAT | typeof MIRROR;

describe('isHeadCorePiece', () => {
  it('takes the base head and every slot that rides the core file', () => {
    for (const name of [
      'WocHead_A_base',
      'WocHead_B_base',
      'WocHead_A_eyes_default_L',
      'WocHead_B_eyes_almond_R',
      'WocHead_A_brows_arched_L',
      'WocHead_A_nose_broad',
      'WocHead_B_mouth_cupids_bow',
      'WocHead_A_ears_pointed_R',
      'WocHead_A_piercing_lobe_l',
    ]) {
      expect(isHeadCorePiece(name), name).toBe(true);
    }
  });

  it('never takes a hairstyle, a beard, or anything that is not a head piece', () => {
    for (const name of [
      'WocHead_A_hair_swept',
      'WocHead_B_hair_braid',
      'WocHead_A_beard_boxed',
      'WocHead_B_beard_handlebar',
      'Character_Body',
      'head',
      '',
      // the slot is a whole word of a WocHead_<T>_ name
      'WocHead_A_basement',
      'WocHead_A_eyeshadow_x',
      'Prop_WocHead_A_base',
      'WocHead_a_base',
    ]) {
      expect(isHeadCorePiece(name), name).toBe(false);
    }
  });

  it.each(TYPES)('agrees with the file the catalog ships every Type %s node in', (type) => {
    const core = wocHeadCoreUrl(type);
    const byFile = wocHeadNodesByFile(type);
    let coreNodes = 0;
    let otherNodes = 0;
    for (const [url, nodes] of byFile) {
      for (const node of nodes) {
        expect(isHeadCorePiece(node), node).toBe(url === core);
        if (url === core) coreNodes++;
        else otherNodes++;
      }
    }
    // both arms are real: a core of dozens of pieces, and hair and beard files beside it
    expect(coreNodes).toBeGreaterThan(20);
    expect(otherNodes).toBeGreaterThan(10);
  });
});

describe('wrapTexel', () => {
  it('clamps to the edge texel', () => {
    expect([-9, -1, 0, 3, 7, 8, 100].map((i) => wrapTexel(i, 8, CLAMP))).toEqual([
      0, 0, 0, 3, 7, 7, 7,
    ]);
  });

  it('repeats, negatives included', () => {
    expect([-17, -9, -8, -1, 0, 3, 7, 8, 9, 17].map((i) => wrapTexel(i, 8, REPEAT))).toEqual([
      7, 7, 0, 7, 0, 3, 7, 0, 1, 1,
    ]);
  });

  it('mirrors about each edge, negatives included', () => {
    // past the right edge the texels come back in reverse, then forward again
    expect([7, 8, 9, 15, 16, 17, 23, 24].map((i) => wrapTexel(i, 8, MIRROR))).toEqual([
      7, 7, 6, 0, 0, 1, 7, 7,
    ]);
    // past the left edge too: texel -1 is texel 0's mirror image
    expect([-1, -2, -8, -9, -16, -17].map((i) => wrapTexel(i, 8, MIRROR))).toEqual([
      0, 1, 7, 7, 0, 0,
    ]);
  });

  it('always lands inside the source, whatever the mode', () => {
    for (const wrap of [CLAMP, REPEAT, MIRROR, 0]) {
      for (const size of [1, 5, 8]) {
        for (let i = -3 * size - 2; i <= 3 * size + 2; i++) {
          const at = wrapTexel(i, size, wrap);
          expect(Number.isInteger(at) && at >= 0 && at < size, `${wrap} ${size} ${i}`).toBe(true);
          // inside the source every mode is the identity
          if (i >= 0 && i < size) expect(at).toBe(i);
        }
      }
    }
  });

  it('treats an unknown mode as clamp', () => {
    expect(wrapTexel(-4, 8, 0)).toBe(0);
    expect(wrapTexel(12, 8, 0)).toBe(7);
  });
});

describe('cropSpan', () => {
  it('pins the constants the crop is built from', () => {
    // literal: a block of the atlas holds the texels the same block of the source held
    expect(HEAD_ATLAS_BLOCK).toBe(4);
    expect(HEAD_ATLAS_MARGIN).toBe(2);
    expect(HEAD_ATLAS_GUTTER).toBe(8);
    // the gutter keeps cells on the block grid
    expect(HEAD_ATLAS_GUTTER % HEAD_ATLAS_BLOCK).toBe(0);
  });

  it('covers the texels the bounds touch plus the margin, opened out to whole blocks', () => {
    // texels 16..32 of 64, less and plus the margin: 14..34, on the block grid 12..36
    expect(cropSpan(0.25, 0.5, 64)).toEqual({ origin: 12, length: 24 });
    // already on the grid after the margin: 6 - 2 = 4 to 10 + 2 = 12
    expect(cropSpan(6 / 64, 10 / 64, 64)).toEqual({ origin: 4, length: 8 });
    // one texel past a block edge costs a whole block
    expect(cropSpan(6 / 64, 11 / 64, 64)).toEqual({ origin: 4, length: 12 });
    expect(cropSpan(5 / 64, 10 / 64, 64)).toEqual({ origin: 0, length: 12 });
    // a single point still takes the margin both ways
    expect(cropSpan(0.5, 0.5, 64)).toEqual({ origin: 28, length: 8 });
  });

  it('is never clamped to the source: a crop may start before it and end past it', () => {
    // the whole texture: the margin reaches one block out on each side
    expect(cropSpan(0, 1, 64)).toEqual({ origin: -4, length: 72 });
    // a uv that runs past the edge (the copy reads those texels through the wrap mode)
    expect(cropSpan(-0.25, 1.25, 16)).toEqual({ origin: -8, length: 32 });
    expect(cropSpan(-1.5, -1.25, 16)).toEqual({ origin: -28, length: 12 });
  });

  it('keeps both ends on the block grid, and never crops inside the bounds', () => {
    for (const size of [16, 64, 100, 256]) {
      for (const [lo, hi] of [
        [0, 1],
        [0.013, 0.977],
        [0.31, 0.32],
        [-0.4, 0.2],
        [0.9, 1.6],
        [0.123456, 0.654321],
      ]) {
        const { origin, length } = cropSpan(lo, hi, size);
        const what = `${lo}..${hi} of ${size}`;
        expect(Math.abs(origin % HEAD_ATLAS_BLOCK), what).toBe(0);
        expect(length % HEAD_ATLAS_BLOCK, what).toBe(0);
        expect(length, what).toBeGreaterThanOrEqual(HEAD_ATLAS_BLOCK);
        // every texel the bounds touch, and the margin beyond, is inside
        expect(origin, what).toBeLessThanOrEqual(Math.floor(lo * size) - HEAD_ATLAS_MARGIN);
        expect(origin + length, what).toBeGreaterThanOrEqual(
          Math.ceil(hi * size) + HEAD_ATLAS_MARGIN,
        );
        // and no more than a block of slack at either end
        expect(Math.floor(lo * size) - HEAD_ATLAS_MARGIN - origin, what).toBeLessThan(
          HEAD_ATLAS_BLOCK,
        );
        expect(origin + length - (Math.ceil(hi * size) + HEAD_ATLAS_MARGIN), what).toBeLessThan(
          HEAD_ATLAS_BLOCK,
        );
      }
    }
  });

  it('answers one block for bounds that are inside out', () => {
    expect(cropSpan(0.5, 0.25, 64).length).toBe(HEAD_ATLAS_BLOCK);
  });
});

/** Assert `placed` puts every rect inside the W x H bin and none over another. */
function expectPacked(
  rects: readonly HeadAtlasRect[],
  W: number,
  H: number,
  placed: readonly HeadAtlasPoint[] | null,
): void {
  expect(placed, 'packed').not.toBeNull();
  const at = placed ?? [];
  expect(at).toHaveLength(rects.length);
  rects.forEach((r, i) => {
    const p = at[i];
    expect(
      p.x >= 0 && p.y >= 0 && p.x + r.w <= W && p.y + r.h <= H,
      `rect ${i} (${r.w} x ${r.h}) at ${p.x},${p.y} inside ${W} x ${H}`,
    ).toBe(true);
    for (let j = 0; j < i; j++) {
      const q = at[j];
      const s = rects[j];
      const apart = p.x + r.w <= q.x || q.x + s.w <= p.x || p.y + r.h <= q.y || q.y + s.h <= p.y;
      expect(apart, `rect ${i} over rect ${j}`).toBe(true);
    }
  });
}

describe('packRects', () => {
  it('places every rect inside the bin, none over another', () => {
    const rects = [
      { w: 40, h: 24 },
      { w: 24, h: 24 },
      { w: 16, h: 48 },
      { w: 24, h: 24 },
      { w: 8, h: 8 },
      { w: 64, h: 16 },
      { w: 12, h: 36 },
      { w: 24, h: 24 },
    ];
    expectPacked(rects, 96, 96, packRects(rects, 96, 96));
    // the same set in a roomier and in a lopsided bin
    expectPacked(rects, 256, 64, packRects(rects, 256, 64));
    expectPacked(rects, 64, 256, packRects(rects, 64, 256));
  });

  it('answers each origin in INPUT order, whatever order it packed them in', () => {
    // the tall one packs first and takes the corner; only its own origin fits it there
    const rects = [
      { w: 4, h: 8 },
      { w: 16, h: 16 },
    ];
    const placed = packRects(rects, 20, 16);
    expectPacked(rects, 20, 16, placed);
    expect(placed).toEqual([
      { x: 16, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('fills a bin exactly', () => {
    const four = Array.from({ length: 4 }, () => ({ w: 8, h: 8 }));
    expectPacked(four, 16, 16, packRects(four, 16, 16));
    const strips = [
      { w: 16, h: 4 },
      { w: 16, h: 8 },
      { w: 16, h: 4 },
    ];
    expectPacked(strips, 16, 16, packRects(strips, 16, 16));
  });

  it('answers null when the rects cannot fit', () => {
    // wider, or taller, than the bin
    expect(packRects([{ w: 17, h: 4 }], 16, 16)).toBeNull();
    expect(packRects([{ w: 4, h: 17 }], 16, 16)).toBeNull();
    // more area than the bin holds
    expect(
      packRects(
        [
          { w: 16, h: 16 },
          { w: 16, h: 16 },
          { w: 16, h: 16 },
        ],
        32,
        16,
      ),
    ).toBeNull();
    // enough area, and no way to lay them out
    expect(
      packRects(
        [
          { w: 12, h: 12 },
          { w: 12, h: 12 },
        ],
        16,
        20,
      ),
    ).toBeNull();
    // one rect too many for an exact fit
    const five = Array.from({ length: 5 }, () => ({ w: 8, h: 8 }));
    expect(packRects(five, 16, 16)).toBeNull();
  });

  it('is deterministic, and packs nothing as nothing', () => {
    const rects = [
      { w: 24, h: 24 },
      { w: 24, h: 24 },
      { w: 40, h: 8 },
      { w: 8, h: 40 },
    ];
    expect(packRects(rects, 64, 64)).toEqual(packRects(rects, 64, 64));
    expect(packRects([], 16, 16)).toEqual([]);
  });
});

describe('smallestBin', () => {
  /** Every bin on the 16 texel grid (sides up to `max`) smaller in area than W x H. */
  function smallerBins(W: number, H: number, max: number): [number, number][] {
    const out: [number, number][] = [];
    for (let w = 16; w <= max; w += 16) {
      for (let h = 16; h <= max; h += 16) if (w * h < W * H) out.push([w, h]);
    }
    return out;
  }

  it('picks sides on the 16 texel grid, no bigger than the rects need', () => {
    expect(smallestBin([{ w: 20, h: 20 }])).toEqual({ W: 32, H: 32, placed: [{ x: 0, y: 0 }] });
    expect(smallestBin([{ w: 40, h: 8 }])).toEqual({ W: 48, H: 16, placed: [{ x: 0, y: 0 }] });
    expect(smallestBin([{ w: 16, h: 16 }])).toEqual({ W: 16, H: 16, placed: [{ x: 0, y: 0 }] });
  });

  it('takes the smallest area first, then the squarer bin', () => {
    // four blocks fit 32 x 32 and 64 x 16 alike: the square one wins
    const four = Array.from({ length: 4 }, () => ({ w: 16, h: 16 }));
    const square = smallestBin(four);
    expect([square?.W, square?.H]).toEqual([32, 32]);
    // three blocks: a 48 x 16 strip (768) beats the 32 x 32 square (1024)
    const three = Array.from({ length: 3 }, () => ({ w: 16, h: 16 }));
    const strip = smallestBin(three);
    expect((strip?.W ?? 0) * (strip?.H ?? 0)).toBe(768);
  });

  it('answers a packing that is valid in the bin it names, and no smaller bin packs', () => {
    const sets: HeadAtlasRect[][] = [
      [
        { w: 40, h: 24 },
        { w: 24, h: 24 },
        { w: 16, h: 48 },
        { w: 24, h: 24 },
      ],
      [
        { w: 100, h: 20 },
        { w: 20, h: 100 },
        { w: 24, h: 24 },
      ],
      // the shape of a real core: one big cell, a row of small ones, the white cell
      [
        { w: 144, h: 120 },
        ...Array.from({ length: 6 }, () => ({ w: 40, h: 28 })),
        { w: 24, h: 24 },
      ],
    ];
    for (const rects of sets) {
      const bin = smallestBin(rects);
      expect(bin).not.toBeNull();
      const { W, H, placed } = bin ?? { W: 0, H: 0, placed: [] };
      expect(W % 16).toBe(0);
      expect(H % 16).toBe(0);
      expectPacked(rects, W, H, placed);
      // minimal on its grid: nothing of a smaller area takes the same rects
      for (const [w, h] of smallerBins(W, H, Math.max(W, H) * 2)) {
        expect(packRects(rects, w, h), `${w} x ${h} under ${W} x ${H}`).toBeNull();
      }
    }
  });

  it('answers null for a rect no atlas side holds', () => {
    expect(smallestBin([{ w: 2049, h: 16 }])).toBeNull();
    expect(smallestBin([{ w: 16, h: 2049 }])).toBeNull();
    // the largest side is still an atlas
    const edge = smallestBin([{ w: 2048, h: 16 }]);
    expect([edge?.W, edge?.H]).toEqual([2048, 16]);
  });
});

// ---------------------------------------------------------------------------
// The atlas step, end to end over a synthetic pack
// ---------------------------------------------------------------------------

interface Image {
  width: number;
  height: number;
  /** RGBA, row major from the top (the glTF uv origin). */
  data: Uint8Array;
}

/** An image whose every texel has a colour of its own (`paint` answers r, g, b, a). */
function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Image {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

const png = (img: Image): Promise<Buffer> =>
  sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png()
    .toBuffer();

async function decode(bytes: Uint8Array): Promise<Image> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

const texel = (img: Image, x: number, y: number): number[] => [
  ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];

/** The uv of the CENTRE of texel (x, y) of a w x h source: a point lookup there reads
 *  exactly that texel (and one past the edge reads through the wrap mode). */
const centre = (x: number, y: number, w: number, h: number): [number, number] => [
  (x + 0.5) / w,
  (y + 0.5) / h,
];

/** A core pack in miniature: a `head` node carrying pieces, PNG masters for textures. */
function pack() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const head = doc.createNode('head');
  doc.createScene('Scene').addChild(head);
  const texture = async (name: string, img: Image): Promise<Texture> =>
    doc
      .createTexture(name)
      .setImage(new Uint8Array(await png(img)))
      .setMimeType('image/png');
  const material = (
    name: string,
    tex: Texture | null,
    wrapS: Wrap = REPEAT,
    wrapT: Wrap = REPEAT,
  ): Material => {
    const m = doc.createMaterial(name).setRoughnessFactor(0.6).setMetallicFactor(0);
    if (tex) {
      m.setBaseColorTexture(tex);
      m.getBaseColorTextureInfo()?.setWrapS(wrapS).setWrapT(wrapT);
    }
    return m;
  };
  const uvAccessor = (uvs: readonly [number, number][]): Accessor =>
    doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(new Float32Array(uvs.flat()));
  /** One piece node: a mesh of one primitive on `mat`, its uv one accessor entry per vertex. */
  const piece = (name: string, mat: Material, uv: Accessor | null): Primitive => {
    const count = uv ? uv.getCount() : 3;
    const prim = doc
      .createPrimitive()
      .setAttribute(
        'POSITION',
        doc
          .createAccessor()
          .setType('VEC3')
          .setBuffer(buffer)
          .setArray(new Float32Array(count * 3)),
      )
      .setMaterial(mat);
    if (uv) prim.setAttribute('TEXCOORD_0', uv);
    head.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
    return prim;
  };
  return { doc, texture, material, uvAccessor, piece };
}

const uvsOf = (prim: Primitive): [number, number][] => {
  const acc = prim.getAttribute('TEXCOORD_0');
  const out: [number, number][] = [];
  for (let i = 0; i < (acc?.getCount() ?? 0); i++) {
    const el = acc?.getElement(i, [0, 0]) ?? [0, 0];
    out.push([el[0], el[1]]);
  }
  return out;
};

/** The skin source: 32 x 32, clamped, every texel its own colour. */
const SKIN = image(32, 32, (x, y) => [x * 8 + 1, y * 8 + 2, 40, 255]);
/** The eye source: 16 x 16, repeated across and mirrored down, with a transparent
 *  column (a core material is OPAQUE: a source's alpha never reached a pixel). */
const EYE = image(16, 16, (x, y) => [250 - x * 16, y * 16 + 7, 200, x === 5 ? 0 : 255]);
const HAIR = image(8, 8, (x, y) => [x * 30, y * 30, 90, 255]);

/** Texels each piece's vertices sit on (some past the source's edge). */
const BASE_TEXELS: [number, number][] = [
  [8, 8],
  [23, 9],
  [12, 23],
  [16, 16],
];
const NOSE_TEXELS: [number, number][] = [
  [9, 22],
  [10, 23],
  [8, 20],
];
const EYE_TEXELS: [number, number][] = [
  [-4, -4],
  [19, 7],
  [5, 0],
  [-1, -1],
  [16, 3],
  [0, 8],
];

async function synthetic() {
  const p = pack();
  const skinTex = await p.texture('SkinSource', SKIN);
  const eyeTex = await p.texture('EyeSource', EYE);
  const hairTex = await p.texture('HairSource', HAIR);
  const skinHead = p.material('skin_head', skinTex, CLAMP, CLAMP).setExtras({ keep: 'me' });
  const skinNose = p.material('skin_nose', skinTex, CLAMP, CLAMP).setDoubleSided(true);
  const eye = p.material('eye_L', eyeTex, REPEAT, MIRROR);
  const gold = p.material('metal_gold', null).setBaseColorFactor([1, 0.66, 0.22, 1]);
  const hair = p.material('hair_swept', hairTex);
  const base = p.piece(
    'WocHead_A_base',
    skinHead,
    p.uvAccessor(BASE_TEXELS.map(([x, y]) => centre(x, y, 32, 32))),
  );
  const nose = p.piece(
    'WocHead_A_nose_default',
    skinNose,
    p.uvAccessor(NOSE_TEXELS.map(([x, y]) => centre(x, y, 32, 32))),
  );
  // the two eyes share ONE uv accessor (mirrored twins): it must be remapped once
  const eyeUv = p.uvAccessor(EYE_TEXELS.map(([x, y]) => centre(x, y, 16, 16)));
  const eyeL = p.piece('WocHead_A_eyes_default_L', eye, eyeUv);
  const eyeR = p.piece('WocHead_A_eyes_default_R', eye, eyeUv);
  const stud = p.piece('WocHead_A_piercing_lip', gold, null);
  const hairUvs: [number, number][] = [
    [0.1, 0.2],
    [0.9, 0.3],
    [0.5, 0.8],
  ];
  const hairPiece = p.piece('WocHead_A_hair_swept', hair, p.uvAccessor(hairUvs));
  return {
    ...p,
    textures: { skinTex, eyeTex, hairTex },
    materials: { skinHead, skinNose, eye, gold, hair },
    prims: { base, nose, eyeL, eyeR, stud, hairPiece },
    hairUvs,
  };
}

describe('atlasHeadCore', () => {
  it('packs every textured core material onto ONE atlas, texel for texel', async () => {
    const s = await synthetic();
    const summary = await atlasHeadCore(s.doc);
    expect(summary).not.toBeNull();
    const atlasTex = s.materials.skinHead.getBaseColorTexture();
    expect(atlasTex?.getName()).toBe('WocHead_A_core_atlas');
    expect(atlasTex?.getMimeType()).toBe('image/png');
    // every textured core material samples it, clamped (an atlas never repeats)
    for (const mat of [s.materials.skinHead, s.materials.skinNose, s.materials.eye]) {
      expect(mat.getBaseColorTexture(), mat.getName()).toBe(atlasTex);
      expect(mat.getBaseColorTextureInfo()?.getWrapS(), mat.getName()).toBe(CLAMP);
      expect(mat.getBaseColorTextureInfo()?.getWrapT(), mat.getName()).toBe(CLAMP);
    }
    // the sources are gone from the pack: the atlas and the hairstyle's own texture remain
    expect(
      s.doc
        .getRoot()
        .listTextures()
        .map((t) => t.getName())
        .sort(),
    ).toEqual(['HairSource', 'WocHead_A_core_atlas']);
    expect(s.textures.skinTex.isDisposed()).toBe(true);
    expect(s.textures.eyeTex.isDisposed()).toBe(true);

    expect(summary?.atlas).toBe('WocHead_A_core_atlas');
    expect(summary?.sources).toBe(2);
    expect(summary?.materials).toBe(3);
    const atlas = await decode(atlasTex?.getImage() ?? new Uint8Array());
    expect(summary?.size).toEqual([atlas.width, atlas.height]);
    expect(atlas.width % 16).toBe(0);
    expect(atlas.height % 16).toBe(0);

    // each vertex still samples the texel it sampled, through its remapped uv
    const sampled = (prim: Primitive): number[][] =>
      uvsOf(prim).map(([u, v]) => {
        expect(u >= 0 && u <= 1 && v >= 0 && v <= 1, `uv ${u},${v} inside the atlas`).toBe(true);
        return texel(atlas, Math.floor(u * atlas.width), Math.floor(v * atlas.height));
      });
    const opaque = (rgba: number[]): number[] => [rgba[0], rgba[1], rgba[2], 255];
    expect(sampled(s.prims.base)).toEqual(BASE_TEXELS.map(([x, y]) => texel(SKIN, x, y)));
    expect(sampled(s.prims.nose)).toEqual(NOSE_TEXELS.map(([x, y]) => texel(SKIN, x, y)));
    // the eye's uvs run past its edge: each reads the texel its wrap modes folded it to,
    // its colour as stored and its alpha dropped
    const eyeWant = EYE_TEXELS.map(([x, y]) =>
      opaque(texel(EYE, wrapTexel(x, 16, REPEAT), wrapTexel(y, 16, MIRROR))),
    );
    expect(eyeWant[0]).toEqual(opaque(texel(EYE, 12, 3)));
    expect(eyeWant[2]).toEqual([170, 7, 200, 255]);
    expect(sampled(s.prims.eyeL)).toEqual(eyeWant);
    // the twin shares the accessor: remapped once, never twice
    expect(s.prims.eyeR.getAttribute('TEXCOORD_0')).toBe(s.prims.eyeL.getAttribute('TEXCOORD_0'));
    expect(sampled(s.prims.eyeR)).toEqual(eyeWant);
  });

  it('copies each cell with a gutter of the source own neighbours, on the block grid', async () => {
    const s = await synthetic();
    const summary = await atlasHeadCore(s.doc);
    const atlas = await decode(
      s.materials.skinHead.getBaseColorTexture()?.getImage() ?? new Uint8Array(),
    );
    const cells = summary?.cells ?? [];
    expect(cells.map((c) => c.texture)).toEqual(['SkinSource', 'EyeSource']);
    const sources = { SkinSource: SKIN, EyeSource: EYE };
    const wraps = { SkinSource: [CLAMP, CLAMP], EyeSource: [REPEAT, MIRROR] };
    for (const cell of cells) {
      const name = cell.texture as keyof typeof sources;
      const src = sources[name];
      const [cx, cy, cw, ch] = cell.crop;
      expect(cell.source).toEqual([src.width, src.height]);
      // the crop and the cell both sit on the 4 x 4 block grid
      for (const n of [cx, cy, cw, ch, ...cell.at]) {
        expect(Math.abs(n % HEAD_ATLAS_BLOCK), `${name} ${n}`).toBe(0);
      }
      // every texel of the cell AND of its gutter is the source texel its wrap folds to
      const g = HEAD_ATLAS_GUTTER;
      let wrong = 0;
      for (let y = -g; y < ch + g; y++) {
        for (let x = -g; x < cw + g; x++) {
          const want = texel(
            src,
            wrapTexel(cx + x, src.width, wraps[name][0]),
            wrapTexel(cy + y, src.height, wraps[name][1]),
          );
          const got = texel(atlas, cell.at[0] + x, cell.at[1] + y);
          if (got[0] !== want[0] || got[1] !== want[1] || got[2] !== want[2] || got[3] !== 255) {
            wrong++;
          }
        }
      }
      expect(wrong, `${name}: texels that differ from the source`).toBe(0);
    }
    // the skin crop is the rectangle its uvs reach, never the whole source
    expect(cells[0].crop).toEqual([4, 4, 24, 24]);
    // the eye crop reaches past the source on every side it was sampled past
    expect(cells[1].crop).toEqual([-8, -8, 32, 20]);
  });

  it('records a white cell on every core material, textured or not', async () => {
    const s = await synthetic();
    const summary = await atlasHeadCore(s.doc);
    const white = summary?.white ?? [0, 0];
    expect(white).toHaveLength(2);
    const atlas = await decode(
      s.materials.skinHead.getBaseColorTexture()?.getImage() ?? new Uint8Array(),
    );
    // its centre sits on a texel corner, and the whole cell with its gutter round it
    // is white
    const wx = Math.round(white[0] * atlas.width);
    const wy = Math.round(white[1] * atlas.height);
    expect(white[0] * atlas.width).toBeCloseTo(wx, 9);
    expect(white[1] * atlas.height).toBeCloseTo(wy, 9);
    const reach = 4 + HEAD_ATLAS_GUTTER;
    for (let y = wy - reach; y < wy + reach; y++) {
      for (let x = wx - reach; x < wx + reach; x++) {
        expect(texel(atlas, x, y), `${x},${y}`).toEqual([255, 255, 255, 255]);
      }
    }
    for (const mat of [s.materials.skinHead, s.materials.skinNose, s.materials.eye]) {
      expect(mat.getExtras().wocHeadAtlas, mat.getName()).toEqual({ white });
    }
    // the untextured core material too (a merged face maps it onto the cell), and it
    // stays untextured: its flat colour takes no atlas space
    expect(s.materials.gold.getExtras().wocHeadAtlas).toEqual({ white });
    expect(s.materials.gold.getBaseColorTexture()).toBeNull();
    expect(s.materials.gold.getBaseColorFactor()).toEqual([1, 0.66, 0.22, 1]);
    // what a material already carried stays
    expect(s.materials.skinHead.getExtras()).toEqual({ keep: 'me', wocHeadAtlas: { white } });
    expect(s.materials.skinHead.getName()).toBe('skin_head');
    expect(s.materials.skinHead.getRoughnessFactor()).toBe(0.6);
    expect(s.materials.skinNose.getDoubleSided()).toBe(true);
  });

  it('leaves a hairstyle untouched: its texture, its uvs, its material', async () => {
    const s = await synthetic();
    await atlasHeadCore(s.doc);
    expect(s.materials.hair.getBaseColorTexture()).toBe(s.textures.hairTex);
    expect(s.textures.hairTex.isDisposed()).toBe(false);
    expect(s.materials.hair.getBaseColorTextureInfo()?.getWrapS()).toBe(REPEAT);
    expect(s.materials.hair.getExtras()).toEqual({});
    const after = uvsOf(s.prims.hairPiece);
    s.hairUvs.forEach(([u, v], i) => {
      expect(after[i][0]).toBeCloseTo(u, 6);
      expect(after[i][1]).toBeCloseTo(v, 6);
    });
  });

  it('builds the same atlas from the same pack', async () => {
    const one = await synthetic();
    const two = await synthetic();
    const a = await atlasHeadCore(one.doc);
    const b = await atlasHeadCore(two.doc);
    expect(a).toEqual(b);
    const bytes = (s: typeof one): Uint8Array =>
      s.materials.skinHead.getBaseColorTexture()?.getImage() ?? new Uint8Array();
    expect(Buffer.from(bytes(one)).equals(Buffer.from(bytes(two)))).toBe(true);
    expect(uvsOf(one.prims.base)).toEqual(uvsOf(two.prims.base));
  });

  it('answers null, and touches nothing, for a pack with no textured core piece', async () => {
    const p = pack();
    const hairTex = await p.texture('HairSource', HAIR);
    const hair = p.material('hair_swept', hairTex);
    const gold = p.material('metal_gold', null);
    const uvs: [number, number][] = [
      [0.1, 0.2],
      [0.9, 0.3],
      [0.5, 0.8],
    ];
    const hairPiece = p.piece('WocHead_A_hair_swept', hair, p.uvAccessor(uvs));
    p.piece('WocHead_A_piercing_lip', gold, null);
    expect(await atlasHeadCore(p.doc)).toBeNull();
    expect(p.doc.getRoot().listTextures()).toHaveLength(1);
    expect(p.doc.getRoot().listTextures()[0]).toBe(hairTex);
    expect(gold.getExtras()).toEqual({});
    expect(uvsOf(hairPiece)[1][0]).toBeCloseTo(0.9, 6);
  });

  it('refuses a core it cannot atlas, naming why', async () => {
    const texelUv = (): [number, number][] => [
      centre(1, 1, 8, 8),
      centre(6, 2, 8, 8),
      centre(3, 6, 8, 8),
    ];
    // a blended core material: the atlas is opaque
    const blend = pack();
    const blendMat = blend
      .material('skin_head', await blend.texture('Src', HAIR))
      .setAlphaMode('BLEND');
    blend.piece('WocHead_A_base', blendMat, blend.uvAccessor(texelUv()));
    await expect(atlasHeadCore(blend.doc)).rejects.toThrow(
      /skin_head is BLEND, the atlas is opaque/,
    );
    // a hairstyle drawing with a core material: its texture would move under it
    const shared = pack();
    const sharedMat = shared.material('skin_head', await shared.texture('Src', HAIR));
    shared.piece('WocHead_A_base', sharedMat, shared.uvAccessor(texelUv()));
    shared.piece('WocHead_A_hair_swept', sharedMat, shared.uvAccessor(texelUv()));
    await expect(atlasHeadCore(shared.doc)).rejects.toThrow(
      /WocHead_A_hair_swept shares a core material/,
    );
    // a textured core piece with no uv to remap
    const bare = pack();
    bare.piece('WocHead_A_base', bare.material('skin_head', await bare.texture('Src', HAIR)), null);
    await expect(atlasHeadCore(bare.doc)).rejects.toThrow(
      /WocHead_A_base is textured but has no TEXCOORD_0/,
    );
    // one texture sampled with two wrap modes: no single gutter is right for both
    const wraps = pack();
    const wrapTex = await wraps.texture('Src', HAIR);
    wraps.piece(
      'WocHead_A_base',
      wraps.material('skin_head', wrapTex, CLAMP, CLAMP),
      wraps.uvAccessor(texelUv()),
    );
    wraps.piece(
      'WocHead_A_nose_default',
      wraps.material('skin_nose', wrapTex, REPEAT, CLAMP),
      wraps.uvAccessor(texelUv()),
    );
    await expect(atlasHeadCore(wraps.doc)).rejects.toThrow(/Src is sampled with two wrap modes/);
    // a source that is no longer a PNG master (the atlas must run before the encode)
    const encoded = pack();
    const ktx = await encoded.texture('Src', HAIR);
    ktx.setMimeType('image/ktx2');
    encoded.piece(
      'WocHead_A_base',
      encoded.material('skin_head', ktx),
      encoded.uvAccessor(texelUv()),
    );
    await expect(atlasHeadCore(encoded.doc)).rejects.toThrow(/Src is not a PNG master/);
  });
});

// ---------------------------------------------------------------------------
// The atlas's own mip levels
// ---------------------------------------------------------------------------

const srgbToLinear = (code: number): number => {
  const c = code / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** The 8 bit sRGB code of a linear light value (the test's own arithmetic). */
const linearToSrgb = (v: number): number =>
  Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));

const solid = (w: number, h: number, rgb: readonly [number, number, number]): Image =>
  image(w, h, () => [rgb[0], rgb[1], rgb[2], 255]);

/** One cell of a hand-built atlas: `img` with its texel (0, 0) on the atlas pixel `at`. */
function levelCell(
  img: Image | null,
  rect: HeadAtlasCellRect,
  at: [number, number] = [rect.x, rect.y],
  wrapS: Wrap = CLAMP,
  wrapT: Wrap = CLAMP,
): HeadAtlasLevelCell {
  const source = img && { data: img.data, width: img.width, height: img.height, wrapS, wrapT };
  return { rect, source, at };
}

const levelTexel = (level: HeadAtlasLevel, x: number, y: number): number[] => [
  ...level.data.subarray((y * level.width + x) * 4, (y * level.width + x) * 4 + 4),
];

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

describe('headAtlasLevelSizes', () => {
  it('halves each side, rounds down, never under one, and ends at 1 x 1', () => {
    // literal: the chain of the shipped Type A atlas
    expect(headAtlasLevelSizes(2032, 880)).toEqual([
      [2032, 880],
      [1016, 440],
      [508, 220],
      [254, 110],
      [127, 55],
      [63, 27],
      [31, 13],
      [15, 6],
      [7, 3],
      [3, 1],
      [1, 1],
    ]);
    // the short side stays at one while the long side still halves
    expect(headAtlasLevelSizes(2, 16)).toEqual([
      [2, 16],
      [1, 8],
      [1, 4],
      [1, 2],
      [1, 1],
    ]);
    expect(headAtlasLevelSizes(1, 1)).toEqual([[1, 1]]);
  });
});

describe('headAtlasTexelCells', () => {
  it('gives a texel to the cell under it, and one over no cell to the nearest', () => {
    // 64 x 16: a cell at each end, 32 texels of nothing between them; texels 8 wide
    const cells = [
      { x: 0, y: 0, w: 16, h: 16 },
      { x: 48, y: 0, w: 16, h: 16 },
    ];
    const { owner, mixed } = headAtlasTexelCells(64, 16, 8, 2, cells);
    expect([...owner]).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1]);
    expect(mixed.size).toBe(0);
    // down as well as across: the nothing below a cell is that cell's
    const top = [{ x: 0, y: 0, w: 8, h: 4 }];
    expect([...headAtlasTexelCells(8, 16, 1, 2, top).owner]).toEqual([0, 0]);
  });

  it('keeps a texel whole for the cell that holds at least half of what it covers', () => {
    const left = { x: 0, y: 0, w: 8, h: 8 };
    const right = { x: 8, y: 0, w: 8, h: 8 };
    // the 1 x 1 level of a 16 x 8 atlas, half and half: the first of the two, never a mix
    for (const pair of [
      [left, right],
      [right, left],
    ]) {
      const { owner, mixed } = headAtlasTexelCells(16, 8, 1, 1, pair);
      expect([...owner]).toEqual([0]);
      expect(mixed.size).toBe(0);
    }
    // the larger share wins whatever the order: 10 texels against 6
    const wide = { x: 0, y: 0, w: 10, h: 8 };
    const narrow = { x: 10, y: 0, w: 6, h: 8 };
    expect([...headAtlasTexelCells(16, 8, 1, 1, [narrow, wide]).owner]).toEqual([1]);
    expect([...headAtlasTexelCells(16, 8, 1, 1, [wide, narrow]).owner]).toEqual([0]);
    // unused space is not a share: a cell under a sixth of the texel, and nothing else, has it
    expect([...headAtlasTexelCells(24, 8, 1, 1, [{ x: 0, y: 0, w: 4, h: 8 }]).owner]).toEqual([0]);
  });

  it('mixes a texel no cell holds half of, each cell by its share', () => {
    const thirds = [0, 8, 16].map((x) => ({ x, y: 0, w: 8, h: 8 }));
    const { owner, mixed } = headAtlasTexelCells(24, 8, 1, 1, thirds);
    expect([...owner]).toEqual([-1]);
    expect((mixed.get(0) ?? []).map(([cell]) => cell)).toEqual([0, 1, 2]);
    for (const [, share] of mixed.get(0) ?? []) expect(share).toBeCloseTo(1 / 3, 12);
    // one level up each cell has a texel to itself again
    const up = headAtlasTexelCells(24, 8, 3, 1, thirds);
    expect([...up.owner]).toEqual([0, 1, 2]);
    expect(up.mixed.size).toBe(0);
    // shares follow the area, and a cell that is not under the texel has none
    const uneven = [
      { x: 0, y: 0, w: 8, h: 8 },
      { x: 8, y: 0, w: 6, h: 8 },
      { x: 14, y: 0, w: 6, h: 8 },
      { x: 0, y: 8, w: 20, h: 8 },
    ];
    const parts = headAtlasTexelCells(20, 16, 1, 2, uneven);
    expect([...parts.owner]).toEqual([-1, 3]);
    const shares = parts.mixed.get(0) ?? [];
    expect(shares.map(([cell]) => cell)).toEqual([0, 1, 2]);
    expect(shares.map(([, share]) => share)).toEqual([
      expect.closeTo(0.4, 12),
      expect.closeTo(0.3, 12),
      expect.closeTo(0.3, 12),
    ]);
  });

  it('measures a texel by the uv range it covers, not by a whole number of texels', () => {
    // 11 wide, 2 texels: each covers 5.5. The second holds 2.5 texels of the first cell and 3
    // of the other; a span of 5 from texel 5 would hold 3 and 2, and go to the first
    const cells = [
      { x: 0, y: 0, w: 8, h: 2 },
      { x: 8, y: 0, w: 3, h: 2 },
    ];
    expect([...headAtlasTexelCells(11, 2, 2, 1, cells).owner]).toEqual([0, 1]);
  });
});

describe('headAtlasCoverage', () => {
  /** The map as rows of digits (0: nobody reads the pixel). */
  const rows = (cover: Uint8Array, W: number): string[] => {
    const out: string[] = [];
    for (let y = 0; y < cover.length / W; y++)
      out.push(cover.subarray(y * W, (y + 1) * W).join(''));
    return out;
  };

  it('marks the pixels a triangle covers, and a texel and a half around it', () => {
    // a right triangle, its legs along x = 4 and y = 4 and 8 long
    const cover = headAtlasCoverage(16, 16, [[4, 4, 12, 4, 4, 12]]);
    const at = (x: number, y: number): number => cover[y * 16 + x];
    // inside it
    expect(at(5, 5)).toBe(1);
    expect(at(10, 4)).toBe(1);
    // its long side runs through pixel 7,8's corner: the pixels beyond are read while their
    // centre is within reach (0.71 for 8,8; 2.12 for 9,9)
    expect(at(8, 8)).toBe(1);
    expect(at(9, 9)).toBe(0);
    // beside a leg: a centre 1.5 out is read, one 2.5 out is not
    expect(at(2, 5)).toBe(1);
    expect(at(1, 5)).toBe(0);
    expect(at(5, 2)).toBe(1);
    expect(at(5, 1)).toBe(0);
    // far from it
    expect(at(14, 14)).toBe(0);
    expect(at(0, 0)).toBe(0);
    // wound the other way it reads the same pixels
    expect([...headAtlasCoverage(16, 16, [[4, 4, 4, 12, 12, 4]])]).toEqual([...cover]);
  });

  it('answers each pixel with the cell that reads it, by its index', () => {
    const cover = headAtlasCoverage(12, 4, [[1, 1, 3, 1, 1, 3], [], [9, 1, 11, 1, 9, 3]]);
    // each long side cuts its corner: a pixel past it is read while its centre is in reach
    expect(rows(cover, 12)).toEqual([
      '111110033333',
      '111110033333',
      '111100033333',
      '111000033330',
    ]);
  });

  it('reads a triangle of no area along its line, and one of no size at its point', () => {
    // three corners on one line (y = 4): the rows whose centres are within 1.5 of it
    const line = headAtlasCoverage(12, 8, [[2, 4, 6, 4, 10, 4]]);
    expect(rows(line, 12)).toEqual([
      '000000000000',
      '000000000000',
      '111111111111',
      '111111111111',
      '111111111111',
      '111111111111',
      '000000000000',
      '000000000000',
    ]);
    // and only as far along it as its ends reach
    const short = headAtlasCoverage(12, 8, [[5, 4, 6, 4, 7, 4]]);
    expect(rows(short, 12)[3]).toBe('000111111000');
    // three corners on one point: the box a texel and a half around it
    const point = headAtlasCoverage(8, 8, [[4, 4, 4, 4, 4, 4]]);
    expect(rows(point, 8)).toEqual([
      '00000000',
      '00000000',
      '00111100',
      '00111100',
      '00111100',
      '00111100',
      '00000000',
      '00000000',
    ]);
  });

  it('clips a triangle that leaves the atlas, and reads nothing with no triangles', () => {
    const cover = headAtlasCoverage(4, 4, [[-10, -10, 30, -10, -10, 30]]);
    expect([...cover]).toEqual(new Array(16).fill(1));
    expect([...headAtlasCoverage(4, 4, [[], []])]).toEqual(new Array(16).fill(0));
    expect([...headAtlasCoverage(4, 4, [])]).toEqual(new Array(16).fill(0));
  });
});

describe('headAtlasTexelCells, by who reads a texel', () => {
  // 32 x 8, two texels of 16: the first cell lies under 12 of the first texel, the second
  // cell under the other 4 and under all of the second texel
  const cells = [
    { x: 0, y: 0, w: 12, h: 8 },
    { x: 12, y: 0, w: 20, h: 8 },
  ];
  /** A map in which cell `c` reads the columns [x0, x1) of every row. */
  const columns = (...spans: [number, number, number][]): Uint8Array => {
    const cover = new Uint8Array(32 * 8);
    for (const [c, x0, x1] of spans) {
      for (let y = 0; y < 8; y++) cover.fill(c + 1, y * 32 + x0, y * 32 + x1);
    }
    return cover;
  };

  it('gives a texel to the cell that reads it, over the cell that lies under more of it', () => {
    // by what lies under them: one each
    expect([...headAtlasTexelCells(32, 8, 2, 1, cells).owner]).toEqual([0, 1]);
    // only the second cell reads the first texel (its uvs run to its left edge, the first
    // cell's islands are nowhere near): it has both
    const lone = headAtlasTexelCells(32, 8, 2, 1, cells, columns([1, 12, 16]));
    expect([...lone.owner]).toEqual([1, 1]);
    expect(lone.mixed.size).toBe(0);
  });

  it('weighs a read by the bilinear tap that makes it', () => {
    // both cells read the first texel: the first from columns 8 to 12 (3.5 of a tap a row),
    // the second from columns 12 to 16 (2.5): the first has more than half, so all of it;
    // the second texel takes 0.5 and 1.5, and is the second cell's
    const both = headAtlasTexelCells(32, 8, 2, 1, cells, columns([0, 8, 12], [1, 12, 16]));
    expect([...both.owner]).toEqual([0, 1]);
    expect(both.mixed.size).toBe(0);
    // one column each, 7 and 8, either side of the first texel's centre: a whole tap and
    // 0.97 of one a row, so the first cell's by a hair; the 0.03 that is left of column 8's
    // tap is all the second texel is read by
    const near = headAtlasTexelCells(32, 8, 2, 1, cells, columns([0, 7, 8], [1, 8, 9]));
    expect([...near.owner]).toEqual([0, 1]);
    // the other way round the second cell reads the first texel more
    const swapped = headAtlasTexelCells(32, 8, 2, 1, cells, columns([1, 7, 8], [0, 8, 9]));
    expect([...swapped.owner]).toEqual([1, 0]);
  });

  it('mixes a texel no reader has half of, by what each reads', () => {
    const three = [0, 8, 16].map((x) => ({ x, y: 0, w: 8, h: 8 }));
    const cover = new Uint8Array(24 * 8);
    // the middle column of each cell, every row: three equal readers of the one texel
    for (let y = 0; y < 8; y++) for (const c of [0, 1, 2]) cover[y * 24 + c * 8 + 4] = c + 1;
    const { owner, mixed } = headAtlasTexelCells(24, 8, 1, 1, three, cover);
    expect([...owner]).toEqual([-1]);
    expect((mixed.get(0) ?? []).map(([cell]) => cell)).toEqual([0, 1, 2]);
    for (const [, share] of mixed.get(0) ?? []) expect(share).toBeCloseTo(1 / 3, 6);
    // twice the reading for one of them: half of it all, so it is that cell's whole
    for (let y = 0; y < 8; y++) cover[y * 24 + 3] = 1;
    for (let y = 0; y < 8; y++) cover[y * 24 + 20] = 0;
    expect([...headAtlasTexelCells(24, 8, 1, 1, three, cover).owner]).toEqual([0]);
  });

  it('falls back to what lies under a texel nobody reads', () => {
    // nothing read anywhere: exactly the answer with no map at all
    const blank = new Uint8Array(32 * 8);
    expect([...headAtlasTexelCells(32, 8, 2, 1, cells, blank).owner]).toEqual([0, 1]);
    expect([...headAtlasTexelCells(32, 8, 4, 1, cells, blank).owner]).toEqual([
      ...headAtlasTexelCells(32, 8, 4, 1, cells).owner,
    ]);
    // read in one texel only: the others still go by what lies under them
    const part = headAtlasTexelCells(32, 8, 4, 1, cells, columns([1, 26, 30]));
    expect([...part.owner]).toEqual([0, 0, 1, 1]);
  });
});

describe('headAtlasMipLevels', () => {
  it('holds no grey at any level of a black cell and a white one, inside either or out', () => {
    // 64 x 32: black on the left, 24 texels of nothing, white (the larger cell) on the right
    const levels = headAtlasMipLevels(64, 32, [
      levelCell(solid(8, 8, [0, 0, 0]), { x: 0, y: 0, w: 16, h: 32 }, [0, 0], REPEAT, REPEAT),
      levelCell(
        solid(8, 8, [255, 255, 255]),
        { x: 40, y: 0, w: 24, h: 32 },
        [40, 0],
        REPEAT,
        REPEAT,
      ),
    ]);
    expect(levels.map((l) => [l.width, l.height])).toEqual([
      [32, 16],
      [16, 8],
      [8, 4],
      [4, 2],
      [2, 1],
      [1, 1],
    ]);
    const seen = { inBlack: 0, inWhite: 0, between: 0, astride: 0 };
    for (const level of levels) {
      const step = 64 / level.width;
      for (let y = 0; y < level.height; y++) {
        for (let x = 0; x < level.width; x++) {
          const got = levelTexel(level, x, y);
          const what = `${level.width} x ${level.height} texel ${x},${y}`;
          const x0 = x * step;
          const x1 = x0 + step;
          const black = Math.max(0, Math.min(x1, 16) - x0);
          const white = Math.max(0, x1 - Math.max(x0, 40));
          if (black === 0 && white === 0) {
            // over no cell: the nearer one's colour, the first of two as near
            const centre = (x0 + x1) / 2;
            expect(got, what).toEqual(centre - 16 <= 40 - centre ? BLACK : WHITE);
            seen.between++;
          } else if (black > 0 && white > 0) {
            // over both: the one that holds more of it, whole
            expect(got, what).toEqual(black >= white ? BLACK : WHITE);
            seen.astride++;
          } else {
            // over one cell (all of the texel or part of it): that cell's, never darkened or
            // lightened by what lies beside it
            expect(got, what).toEqual(black > 0 ? BLACK : WHITE);
            if (black > 0) seen.inBlack++;
            else seen.inWhite++;
          }
        }
      }
    }
    // every arm ran
    expect(seen).toEqual({ inBlack: 171, inWhite: 257, between: 254, astride: 1 });
    // literal: the 8 x 4 level across (the tie at texel 3 goes to the first cell), and the
    // one texel that is over both cells at once, which the larger cell takes whole
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((x) => levelTexel(levels[2], x, 0)[0])).toEqual([
      0, 0, 0, 0, 255, 255, 255, 255,
    ]);
    expect(levelTexel(levels[5], 0, 0)).toEqual(WHITE);
  });

  it('averages in linear light', () => {
    // a one texel checker of black and white: half the LIGHT is code 188, half the code is 128
    const checker = image(16, 16, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const [level1] = headAtlasMipLevels(16, 16, [levelCell(checker, { x: 0, y: 0, w: 16, h: 16 })]);
    expect(linearToSrgb(0.5)).toBe(188);
    expect([level1.width, level1.height]).toEqual([8, 8]);
    for (let i = 0; i < 64; i++) {
      expect([...level1.data.subarray(i * 4, i * 4 + 4)], `texel ${i}`).toEqual([
        188, 188, 188, 255,
      ]);
    }
  });

  it('averages over the uv range a texel covers, by area', () => {
    // black but for one white column at texel 2, 11 wide: a level 1 texel covers 2.2 texels,
    // so the column is the last 0.2 of the first (one part in 11) and the first 0.8 of the
    // second (four parts in 11); whole texel spans would make it a third or a half of one
    const bar = image(11, 2, (x) => (x === 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const levels = headAtlasMipLevels(11, 2, [levelCell(bar, { x: 0, y: 0, w: 11, h: 2 })]);
    expect(levels.map((l) => [l.width, l.height])).toEqual([
      [5, 1],
      [2, 1],
      [1, 1],
    ]);
    expect([linearToSrgb(1 / 11), linearToSrgb(4 / 11), linearToSrgb(2 / 11)]).toEqual([
      85, 162, 118,
    ]);
    expect([0, 1, 2, 3, 4].map((x) => levelTexel(levels[0], x, 0)[0])).toEqual([85, 162, 0, 0, 0]);
    // level 2: one texel of the first 5.5, none of the rest; the last level: one of all 11
    expect([0, 1].map((x) => levelTexel(levels[1], x, 0)[0])).toEqual([118, 0]);
    expect(levelTexel(levels[2], 0, 0)).toEqual([85, 85, 85, 255]);
  });

  it('reads past a cell through its source wrap modes, as the source own chain did', () => {
    // four bands, two texels each; the cell sits in the middle of a 16 wide atlas, so the
    // texels left of it cover source texels -4 and -3, the ones right of it 10 and 11
    const BANDS: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ];
    const bands = image(8, 4, (x) => [...BANDS[x >> 1], 255] as [number, number, number, number]);
    const ends = (wrap: Wrap): number[][] => {
      const cell = levelCell(bands, { x: 4, y: 0, w: 8, h: 4 }, [4, 0], wrap, CLAMP);
      const [level1] = headAtlasMipLevels(16, 4, [cell]);
      return [levelTexel(level1, 0, 0).slice(0, 3), levelTexel(level1, 7, 0).slice(0, 3)];
    };
    // clamped: the edge bands carry on
    expect(ends(CLAMP)).toEqual([BANDS[0], BANDS[3]]);
    // repeated: the far side comes round
    expect(ends(REPEAT)).toEqual([BANDS[2], BANDS[1]]);
    // mirrored: the near side comes back
    expect(ends(MIRROR)).toEqual([BANDS[1], BANDS[2]]);
    // and down the other axis by its own mode
    const rows = image(
      4,
      8,
      (_x, y) => [...BANDS[y >> 1], 255] as [number, number, number, number],
    );
    const cell = levelCell(rows, { x: 0, y: 4, w: 4, h: 8 }, [0, 4], CLAMP, REPEAT);
    const [down] = headAtlasMipLevels(4, 16, [cell]);
    expect(levelTexel(down, 0, 0).slice(0, 3)).toEqual(BANDS[2]);
    expect(levelTexel(down, 0, 7).slice(0, 3)).toEqual(BANDS[1]);
  });

  it('mixes the cells under a texel no cell holds half of, in linear light', () => {
    const colours: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ];
    const cells = colours.map((rgb, i) =>
      levelCell(solid(8, 8, rgb), { x: i * 8, y: 0, w: 8, h: 8 }),
    );
    const levels = headAtlasMipLevels(24, 8, cells);
    expect(levels.map((l) => [l.width, l.height])).toEqual([
      [12, 4],
      [6, 2],
      [3, 1],
      [1, 1],
    ]);
    // down to a texel a cell every texel is one cell's
    expect([0, 1, 2].map((x) => levelTexel(levels[2], x, 0).slice(0, 3))).toEqual(colours);
    // the last texel is a third of each
    expect(linearToSrgb(1 / 3)).toBe(156);
    expect(levelTexel(levels[3], 0, 0)).toEqual([156, 156, 156, 255]);
  });

  it('gives the texel between two cells to the one whose pieces read it', () => {
    // 32 x 8: black under the first 12 texels, white under the other 20. The 2 texel level's
    // first texel lies mostly over black; only the white cell's pieces read it
    const cells = [
      levelCell(solid(4, 4, [0, 0, 0]), { x: 0, y: 0, w: 12, h: 8 }, [0, 0], REPEAT, REPEAT),
      levelCell(
        solid(4, 4, [255, 255, 255]),
        { x: 12, y: 0, w: 20, h: 8 },
        [12, 0],
        REPEAT,
        REPEAT,
      ),
    ];
    const cover = headAtlasCoverage(32, 8, [[], [22, 2, 30, 2, 22, 6]]);
    const two = (levels: HeadAtlasLevel[]): number[] => {
      const level = levels[levels.length - 2];
      expect([level.width, level.height]).toEqual([2, 1]);
      return [levelTexel(level, 0, 0)[0], levelTexel(level, 1, 0)[0]];
    };
    expect(two(headAtlasMipLevels(32, 8, cells))).toEqual([0, 255]);
    expect(two(headAtlasMipLevels(32, 8, cells, cover))).toEqual([255, 255]);
    // where a texel is narrower than the room between the cells nothing changes: level 1
    const fine = headAtlasMipLevels(32, 8, cells, cover)[0];
    expect([0, 5, 6, 15].map((x) => levelTexel(fine, x, 0)[0])).toEqual([0, 0, 255, 255]);
  });

  it('keeps a flat colour exactly, and reads a cell with no source as white', () => {
    const levels = headAtlasMipLevels(16, 8, [
      levelCell(solid(4, 4, [10, 20, 30]), { x: 0, y: 0, w: 8, h: 8 }, [0, 0], REPEAT, REPEAT),
      levelCell(null, { x: 8, y: 0, w: 8, h: 8 }),
    ]);
    for (const level of levels.slice(0, 3)) {
      expect(levelTexel(level, 0, 0)).toEqual([10, 20, 30, 255]);
      expect(levelTexel(level, level.width - 1, level.height - 1)).toEqual(WHITE);
    }
  });
});

describe('atlasHeadCore mip levels', () => {
  /** The atlas of the synthetic pack: its summary, its texture and every level, decoded. */
  async function built() {
    const s = await synthetic();
    const summary = await atlasHeadCore(s.doc);
    const atlasTex = s.materials.skinHead.getBaseColorTexture();
    if (!summary || !atlasTex) throw new Error('the synthetic pack has an atlas');
    const pngs = headAtlasLevelPngs(atlasTex) ?? [];
    const levels = await Promise.all(pngs.map((bytes) => decode(bytes)));
    return { s, summary, atlasTex, pngs, levels };
  }

  it('hands the encoder every level of the atlas, level 0 the texture itself', async () => {
    const { s, summary, atlasTex, pngs, levels } = await built();
    expect(summary.levels).toEqual(headAtlasLevelSizes(summary.size[0], summary.size[1]));
    expect(summary.levels[0]).toEqual(summary.size);
    expect(summary.levels[summary.levels.length - 1]).toEqual([1, 1]);
    expect(summary.levels.length).toBeGreaterThan(5);
    expect(levels.map((l) => [l.width, l.height])).toEqual(summary.levels);
    // level 0 is the atlas texture's own image, byte for byte
    expect(Buffer.from(pngs[0]).equals(Buffer.from(atlasTex.getImage() ?? []))).toBe(true);
    // every level is opaque
    for (const level of levels) {
      for (let i = 3; i < level.data.length; i += 4) expect(level.data[i]).toBe(255);
    }
    // a texture the step did not build has none: the encoder generates that one's
    expect(headAtlasLevelPngs(s.textures.hairTex)).toBeNull();
  });

  it('builds each level from the cells own sources, never from the black between them', async () => {
    const { summary, levels } = await built();
    const blues = (l: Image): number[] =>
      Array.from({ length: l.width * l.height }, (_v, i) => l.data[i * 4 + 2]);
    // level 0 keeps its black background: no uv reaches it there
    expect(Math.min(...blues(levels[0]))).toBe(0);
    // below it nothing is darker than the darkest source: the skin's blue is 40 everywhere,
    // the eye's 200, the white cell's 255
    for (const level of levels.slice(1)) {
      expect(Math.min(...blues(level)), `${level.width} x ${level.height}`).toBeGreaterThanOrEqual(
        40,
      );
    }
    // and while a texel is no wider than the grid the cells sit on, it is one cell's exactly
    expect(new Set(blues(levels[1]))).toEqual(new Set([40, 200, 255]));

    /** The linear light mean of one channel of `img` over the source texels xs x ys. */
    const mean = (img: Image, xs: number[], ys: number[], ch: number): number => {
      let sum = 0;
      for (const y of ys) for (const x of xs) sum += srgbToLinear(texel(img, x, y)[ch]);
      return linearToSrgb(sum / (xs.length * ys.length));
    };
    const [skin, eye] = summary.cells;
    // the skin cell's first texel of level 1: the source texels its crop starts on
    expect(skin.crop.slice(0, 2)).toEqual([4, 4]);
    const skinAt = texel(levels[1], skin.at[0] / 2, skin.at[1] / 2);
    expect(skinAt).toEqual([mean(SKIN, [4, 5], [4, 5], 0), mean(SKIN, [4, 5], [4, 5], 1), 40, 255]);
    // not the top left source texel copied: a real average of four different texels
    expect(skinAt.slice(0, 2)).not.toEqual(texel(SKIN, 4, 4).slice(0, 2));
    // the eye cell's crop starts 8 texels before its source: level 1 reads those texels
    // repeated across and mirrored down, as level 0 does
    expect(eye.crop.slice(0, 2)).toEqual([-8, -8]);
    const xs = [-8, -7].map((x) => wrapTexel(x, 16, REPEAT));
    const ys = [-8, -7].map((y) => wrapTexel(y, 16, MIRROR));
    expect([xs, ys]).toEqual([
      [8, 9],
      [7, 6],
    ]);
    expect(texel(levels[1], eye.at[0] / 2, eye.at[1] / 2)).toEqual([
      mean(EYE, xs, ys, 0),
      mean(EYE, xs, ys, 1),
      200,
      255,
    ]);
    // level 2, a texel of 4 x 4 source texels deeper in the skin cell
    expect(texel(levels[2], skin.at[0] / 4 + 2, skin.at[1] / 4 + 3)).toEqual([
      mean(SKIN, [12, 13, 14, 15], [16, 17, 18, 19], 0),
      mean(SKIN, [12, 13, 14, 15], [16, 17, 18, 19], 1),
      40,
      255,
    ]);
  });

  it('gives a texel to the cell whose pieces read it, not the one that lies under more of it', async () => {
    const { summary, levels } = await built();
    // the atlas: the skin cell top left, the white cell top right, the eye cell below them
    expect(summary.size).toEqual([64, 80]);
    expect(summary.cells.map((c) => c.at)).toEqual([
      [8, 8],
      [8, 48],
    ]);
    expect(summary.white).toEqual([52 / 64, 12 / 80]);
    // its 2 x 2 level: the top right texel covers 32 to 64 across and 0 to 40 down. The white
    // cell lies under 576 of those texels and the skin cell under 320, but nothing reads the
    // white cell there and the skin's triangle does: the texel is the skin's (blue 40), where
    // by what lies under it it would be white
    const two = levels[5];
    expect([two.width, two.height]).toEqual([2, 2]);
    expect(texel(two, 1, 0)[2]).toBe(40);
    // the triangles are read where the uvs were MOVED to: the eye's sit in the eye's cell, 40
    // texels down, not at the top of the atlas where its source uvs would put them
    const four = levels[4];
    expect([four.width, four.height]).toEqual([4, 5]);
    expect(texel(four, 0, 0)[2]).toBe(40);
    expect(texel(four, 0, 3)[2]).toBe(200);
  });

  it('keeps the white cell white in every level its texels are its own', async () => {
    const { summary, levels } = await built();
    const wx = Math.round(summary.white[0] * summary.size[0]);
    const wy = Math.round(summary.white[1] * summary.size[1]);
    // the cell and its gutter are 24 texels: a texel up to 8 wide beside its centre is inside
    for (const k of [0, 1, 2, 3]) {
      expect(texel(levels[k], wx >> k, wy >> k), `level ${k}`).toEqual(WHITE);
    }
    // its gutter is its own to the corner: the level 1 texel over atlas texels 40 to 42
    // across and 22 to 24 down is nearer to the skin's crop than to the white cell's
    expect([wx, wy]).toEqual([52, 12]);
    expect(texel(levels[1], 20, 11)).toEqual(WHITE);
    // and the skin's gutter beside it is the skin's: its last texel before the white cell
    // (atlas texels 38 to 40) is a texel from the white cell and 7 from the skin's crop
    expect(texel(levels[1], 19, 5)[2]).toBe(40);
  });

  it('builds the same levels from the same pack', async () => {
    const one = await built();
    const two = await built();
    expect(one.pngs).toHaveLength(two.pngs.length);
    one.pngs.forEach((bytes, k) => {
      expect(Buffer.from(bytes).equals(Buffer.from(two.pngs[k])), `level ${k}`).toBe(true);
    });
  });
});

describe('atlasHeadCore refusals', () => {
  const texelUv = (): [number, number][] => [
    centre(1, 1, 8, 8),
    centre(6, 2, 8, 8),
    centre(3, 6, 8, 8),
  ];
  const textureNames = (doc: Document): string[] =>
    doc
      .getRoot()
      .listTextures()
      .map((t) => t.getName());

  it('refuses a texture transform on a core colour map', async () => {
    // the cell is cut from the raw uvs and the uvs move into it: the transform would go on
    // being applied on top of the moved uvs
    const p = pack();
    const mat = p.material('skin_head', await p.texture('Src', HAIR));
    const transform = p.doc.createExtension(KHRTextureTransform).createTransform();
    mat
      .getBaseColorTextureInfo()
      ?.setExtension('KHR_texture_transform', transform.setScale([2, 2]));
    const prim = p.piece('WocHead_A_base', mat, p.uvAccessor(texelUv()));
    await expect(atlasHeadCore(p.doc)).rejects.toThrow(/skin_head carries KHR_texture_transform/);
    // refused before anything changed
    expect(textureNames(p.doc)).toEqual(['Src']);
    expect(uvsOf(prim)[1][0]).toBeCloseTo(6.5 / 8, 6);
  });

  it('refuses a core material that samples any map but its colour', async () => {
    // its uvs move into the atlas with the colour: the other map would stay behind them
    const slots: [string, (mat: Material, tex: Texture) => Material][] = [
      ['normal', (mat, tex) => mat.setNormalTexture(tex)],
      ['occlusion', (mat, tex) => mat.setOcclusionTexture(tex)],
      ['emissive', (mat, tex) => mat.setEmissiveTexture(tex)],
      ['metallic roughness', (mat, tex) => mat.setMetallicRoughnessTexture(tex)],
    ];
    for (const [slot, set] of slots) {
      const p = pack();
      const mat = set(
        p.material('skin_nose', await p.texture('Src', HAIR)),
        await p.texture('Other', HAIR),
      );
      p.piece('WocHead_A_nose_default', mat, p.uvAccessor(texelUv()));
      await expect(atlasHeadCore(p.doc), slot).rejects.toThrow(
        new RegExp(`skin_nose carries a ${slot} texture`),
      );
      expect(textureNames(p.doc), slot).toEqual(['Src', 'Other']);
      expect(mat.getBaseColorTexture()?.getName(), slot).toBe('Src');
    }
    // an extension's map too, named by the extension
    const coat = pack();
    const clearcoat = coat.doc
      .createExtension(KHRMaterialsClearcoat)
      .createClearcoat()
      .setClearcoatTexture(await coat.texture('Coat', HAIR));
    const coated = coat
      .material('skin_head', await coat.texture('Src', HAIR))
      .setExtension('KHR_materials_clearcoat', clearcoat);
    coat.piece('WocHead_A_base', coated, coat.uvAccessor(texelUv()));
    await expect(atlasHeadCore(coat.doc)).rejects.toThrow(
      /skin_head carries a KHR_materials_clearcoat texture/,
    );
    // an extension with no map of its own is no reason to refuse
    const plain = pack();
    const bare = plain.doc.createExtension(KHRMaterialsClearcoat).createClearcoat();
    const fine = plain
      .material('skin_head', await plain.texture('Src', HAIR))
      .setExtension('KHR_materials_clearcoat', bare.setClearcoatFactor(0.5));
    plain.piece('WocHead_A_base', fine, plain.uvAccessor(texelUv()));
    expect((await atlasHeadCore(plain.doc))?.materials).toBe(1);
  });

  it('refuses a uv accessor a core piece shares with a piece it must not move', async () => {
    // with a hairstyle on a material and a texture of its own: the hair's uvs would move into
    // the atlas under a texture that does not
    const shared = pack();
    const uv = shared.uvAccessor(texelUv());
    shared.piece(
      'WocHead_A_base',
      shared.material('skin_head', await shared.texture('Src', HAIR)),
      uv,
    );
    const hairPiece = shared.piece(
      'WocHead_A_hair_swept',
      shared.material('hair_swept', await shared.texture('HairSrc', HAIR)),
      uv,
    );
    await expect(atlasHeadCore(shared.doc)).rejects.toThrow(
      /WocHead_A_hair_swept shares a uv accessor with a core piece/,
    );
    expect(textureNames(shared.doc)).toEqual(['Src', 'HairSrc']);
    expect(uvsOf(hairPiece)[1][0]).toBeCloseTo(6.5 / 8, 6);
    // with another core piece on ANOTHER source: one accessor cannot move into two cells
    const two = pack();
    const both = two.uvAccessor(texelUv());
    const first = two.piece(
      'WocHead_A_base',
      two.material('skin_head', await two.texture('SrcA', HAIR)),
      both,
    );
    two.piece(
      'WocHead_A_nose_default',
      two.material('skin_nose', await two.texture('SrcB', HAIR)),
      both,
    );
    await expect(atlasHeadCore(two.doc)).rejects.toThrow(
      /WocHead_A_nose_default shares a uv accessor with a piece on another texture/,
    );
    expect(textureNames(two.doc)).toEqual(['SrcA', 'SrcB']);
    expect(uvsOf(first)[1][0]).toBeCloseTo(6.5 / 8, 6);
  });
});

// ---------------------------------------------------------------------------
// The atlas uvs' precision
// ---------------------------------------------------------------------------

/** Whether a 16 bit code sits on the grid a 12 bit quantization writes (bit replicated). */
const on12BitGrid = (code: number): boolean => (((code >> 4) << 4) | (code >> 12)) === code;

describe('the atlas uv precision', () => {
  it('stores a uv at 16 bits: a thirty second of a texel on the widest atlas', () => {
    // literal: the whole of the accessor's 16 bits
    expect(HEAD_ATLAS_UV_BITS).toBe(16);
    expect(headAtlasUvCode(0)).toBe(0);
    expect(headAtlasUvCode(1)).toBe(65535);
    // the nearest code, either side of half a step
    expect(headAtlasUvCode(100.4 / 65535)).toBe(100);
    expect(headAtlasUvCode(100.6 / 65535)).toBe(101);
    // the widest atlas the packer tries is 2048 texels: a code is a thirty second of a texel
    // there, where the 12 bits a pack-wide quantization leaves are half a texel
    expect(2048 / (2 ** HEAD_ATLAS_UV_BITS - 1)).toBeLessThan(1 / 8);
    expect(2048 / (2 ** HEAD_ATLAS_UV_BITS - 1)).toBeCloseTo(1 / 32, 5);
    expect(2048 / (2 ** 12 - 1)).toBeGreaterThan(1 / 2);
  });

  it('refuses a coordinate outside the atlas', () => {
    for (const u of [-0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => headAtlasUvCode(u), `${u}`).toThrow(/outside the atlas/);
    }
  });

  it('holds the atlas uvs out of the pack-wide quantization and writes them at 16 bits', async () => {
    const s = await synthetic();
    await atlasHeadCore(s.doc);
    // real geometry for the quantizer: distinct positions, and triangles listed last vertex
    // first so its reorder has vertices to move
    const buffer = s.doc.getRoot().listBuffers()[0];
    const all = Object.values(s.prims);
    all.forEach((prim, p) => {
      const count = prim.getAttribute('POSITION')?.getCount() ?? 0;
      const position = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) position.set([p + i, (i * 7) % 5, (i * 3) % 4], i * 3);
      prim.getAttribute('POSITION')?.setArray(position);
      const order: number[] = [];
      for (let i = count - 1; i >= 2; i--) order.push(i, i - 1, i - 2);
      prim.setIndices(
        s.doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array(order)),
      );
    });
    /** A primitive's uvs corner by corner, sorted (a reorder moves vertices and triangles). */
    const corners = (prim: Primitive): [number, number][] => {
      const uvs = uvsOf(prim);
      const index = [...(prim.getIndices()?.getArray() ?? [])];
      return index.map((i) => uvs[i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    };
    const core = [s.prims.base, s.prims.nose, s.prims.eyeL, s.prims.eyeR];
    const exact = core.map(corners);
    const exactCodes = core.map((prim) =>
      uvsOf(prim)
        .flat()
        .map(headAtlasUvCode)
        .sort((a, b) => a - b),
    );
    const hairExact = corners(s.prims.hairPiece);

    expect(holdHeadAtlasUvs(s.doc)).toBe(4);
    // out of the quantizer's reach: a core primitive has no TEXCOORD_0 for now, the hairstyle
    // and the untextured piercing are as they were
    for (const prim of core) expect(prim.getAttribute('TEXCOORD_0')).toBeNull();
    expect(s.prims.hairPiece.getAttribute('TEXCOORD_0')).not.toBeNull();
    expect(s.prims.stud.listSemantics()).toEqual(['POSITION']);

    // the pack-wide step itself (woc_head_pack_compress.mjs), loaded here so that sharp is up
    // before it (the import order tests/asset_pipeline.test.ts keeps for Windows)
    const { meshopt } = await import('@gltf-transform/functions');
    await MeshoptEncoder.ready;
    await s.doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    expect(releaseHeadAtlasUvs(s.doc)).toBe(4);

    const codesOf = (prim: Primitive): number[] => [
      ...(prim.getAttribute('TEXCOORD_0')?.getArray() ?? []),
    ];
    core.forEach((prim, p) => {
      const uv = prim.getAttribute('TEXCOORD_0');
      expect(uv?.getArray(), `core ${p}`).toBeInstanceOf(Uint16Array);
      expect(uv?.getNormalized(), `core ${p}`).toBe(true);
      expect(prim.listSemantics().sort(), `core ${p}`).toEqual(['POSITION', 'TEXCOORD_0']);
      // every corner within half a 16 bit step of where the atlas step put it
      const after = corners(prim);
      expect(after).toHaveLength(exact[p].length);
      after.forEach(([u, v], i) => {
        expect(Math.abs(u - exact[p][i][0]), `core ${p} corner ${i} u`).toBeLessThan(0.51 / 65535);
        expect(Math.abs(v - exact[p][i][1]), `core ${p} corner ${i} v`).toBeLessThan(0.51 / 65535);
      });
      // and its codes are the nearest ones to the uvs it was held with
      expect(
        codesOf(prim).sort((a, b) => a - b),
        `core ${p}`,
      ).toEqual(exactCodes[p]);
    });
    // the whole 16 bits are in use: not every core code sits on the 12 bit grid
    expect(core.flatMap(codesOf).some((code) => !on12BitGrid(code))).toBe(true);
    // the hairstyle went through the pack-wide step as it always did: 12 bits, on that grid
    const hairCodes = codesOf(s.prims.hairPiece);
    expect(s.prims.hairPiece.getAttribute('TEXCOORD_0')?.getArray()).toBeInstanceOf(Uint16Array);
    expect(hairCodes).toHaveLength(6);
    expect(hairCodes.every(on12BitGrid)).toBe(true);
    corners(s.prims.hairPiece).forEach(([u, v], i) => {
      expect(Math.abs(u - hairExact[i][0])).toBeLessThan(0.6 / 4095);
      expect(Math.abs(v - hairExact[i][1])).toBeLessThan(0.6 / 4095);
    });
  });

  it('holds nothing in a pack with no atlas', async () => {
    const p = pack();
    const hairPiece = p.piece(
      'WocHead_A_hair_swept',
      p.material('hair_swept', await p.texture('HairSource', HAIR)),
      p.uvAccessor([
        [0.1, 0.2],
        [0.9, 0.3],
        [0.5, 0.8],
      ]),
    );
    expect(await atlasHeadCore(p.doc)).toBeNull();
    expect(holdHeadAtlasUvs(p.doc)).toBe(0);
    expect(releaseHeadAtlasUvs(p.doc)).toBe(0);
    expect(hairPiece.listSemantics().sort()).toEqual(['POSITION', 'TEXCOORD_0']);
    expect(hairPiece.getAttribute('TEXCOORD_0')?.getArray()).toBeInstanceOf(Float32Array);
  });
});

// ---------------------------------------------------------------------------
// The shipped cores
// ---------------------------------------------------------------------------

interface GlbMaterial {
  name?: string;
  alphaMode?: string;
  extras?: { wocHeadAtlas?: { white?: unknown } };
  pbrMetallicRoughness?: {
    baseColorTexture?: { index?: number; texCoord?: number };
    metallicRoughnessTexture?: unknown;
  };
  normalTexture?: unknown;
  occlusionTexture?: unknown;
  emissiveTexture?: unknown;
}

interface GlbJson {
  images?: { name?: string; mimeType?: string; bufferView?: number }[];
  bufferViews?: { byteOffset?: number; byteLength: number }[];
  textures?: { sampler?: number }[];
  samplers?: { wrapS?: number; wrapT?: number }[];
  materials?: GlbMaterial[];
}

/** The JSON chunk of a GLB served from public/. */
function glbJson(url: string): GlbJson {
  const buf = readFileSync(path.resolve(__dirname, '..', 'public', url));
  expect(buf.readUInt32LE(0), `${url}: GLB magic`).toBe(0x46546c67);
  expect(buf.readUInt32LE(16), `${url}: first chunk is JSON`).toBe(0x4e4f534a);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

/** The bytes of the first image of a GLB served from public/ (its BIN chunk's slice). */
function glbImage(url: string): Buffer {
  const buf = readFileSync(path.resolve(__dirname, '..', 'public', url));
  const json = glbJson(url);
  const view = json.bufferViews?.[json.images?.[0].bufferView ?? -1];
  if (!view) throw new Error(`${url}: its first image is not embedded`);
  const bin = 20 + buf.readUInt32LE(12) + 8;
  return buf.subarray(bin + (view.byteOffset ?? 0), bin + (view.byteOffset ?? 0) + view.byteLength);
}

describe('the shipped head cores', () => {
  it.each(TYPES)('the Type %s atlas carries a whole chain of mip levels', (type) => {
    // a KTX2 header: the 12 byte identifier, then 32 bit fields, the width the third, the
    // height the fourth and the level count the eighth. A file short of levels would leave
    // the GPU to make them from the whole image, which bleeds between the cells
    const ktx = glbImage(wocHeadCoreUrl(type));
    expect(ktx.subarray(1, 7).toString('latin1')).toBe('KTX 20');
    const sizes = headAtlasLevelSizes(ktx.readUInt32LE(20), ktx.readUInt32LE(24));
    expect(ktx.readUInt32LE(40)).toBe(sizes.length);
    expect(sizes.length).toBe(11);
  });

  it.each(TYPES)('every Type %s atlas uv is stored at 16 bits', async (type) => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(path.resolve(__dirname, '..', 'public', wocHeadCoreUrl(type)));
    const seen = new Set<Accessor>();
    let codes = 0;
    let onGrid = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const uv = prim.getAttribute('TEXCOORD_0');
        if (!uv || !prim.getMaterial()?.getBaseColorTexture()) continue;
        expect(uv.getArray(), mesh.getName()).toBeInstanceOf(Uint16Array);
        expect(uv.getNormalized(), mesh.getName()).toBe(true);
        if (seen.has(uv)) continue;
        seen.add(uv);
        for (const code of uv.getArray() ?? []) {
          codes++;
          if (on12BitGrid(code)) onGrid++;
        }
      }
    }
    // a core quantized with the rest of its pack has EVERY code on the 12 bit grid (half a
    // texel on the atlas); a 16 bit code lands there one time in sixteen
    expect(codes).toBeGreaterThan(30000);
    expect(onGrid / codes).toBeLessThan(0.1);
  });

  it.each(TYPES)('Type %s ships ONE image and ONE texture: its core atlas', (type) => {
    const json = glbJson(wocHeadCoreUrl(type));
    expect(json.images).toHaveLength(1);
    expect(json.textures).toHaveLength(1);
    expect(json.images?.[0].name).toBe(`WocHead_${type.toUpperCase()}_core_atlas`);
    // an atlas never repeats: a uv at its edge must not bleed in the far side's cell
    const sampler = json.samplers?.[json.textures?.[0].sampler ?? -1];
    expect(sampler?.wrapS).toBe(CLAMP);
    expect(sampler?.wrapT).toBe(CLAMP);
  });

  it.each(TYPES)('every textured Type %s core material samples that texture', (type) => {
    const materials = glbJson(wocHeadCoreUrl(type)).materials ?? [];
    const textured = materials.filter((m) => m.pbrMetallicRoughness?.baseColorTexture);
    for (const m of textured) {
      const info = m.pbrMetallicRoughness?.baseColorTexture;
      expect(info?.index, m.name).toBe(0);
      expect(info?.texCoord ?? 0, m.name).toBe(0);
    }
    // not vacuous: the head, the brows, the ears, the lids, the eyeballs, the mouth and
    // the nose are textured, and the piercings' gold is not
    expect(textured.length).toBeGreaterThanOrEqual(10);
    expect(textured.map((m) => m.name)).toContain('skin_head');
    expect(materials.length).toBeGreaterThan(textured.length);
    expect(
      materials.filter((m) => !m.pbrMetallicRoughness?.baseColorTexture).map((m) => m.name),
    ).toContain('metal_gold');
  });

  it.each(TYPES)('every Type %s core material carries the white cell, one cell for all', (type) => {
    const materials = glbJson(wocHeadCoreUrl(type)).materials ?? [];
    expect(materials.length).toBeGreaterThan(0);
    const cells = new Set<string>();
    for (const m of materials) {
      const white = m.extras?.wocHeadAtlas?.white;
      expect(Array.isArray(white), m.name).toBe(true);
      const [u, v] = white as number[];
      expect(white as number[], m.name).toHaveLength(2);
      for (const n of [u, v]) {
        expect(
          typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1,
          `${m.name}: ${n}`,
        ).toBe(true);
      }
      cells.add(`${u},${v}`);
    }
    expect(cells.size).toBe(1);
  });

  it.each(TYPES)(
    'no Type %s core material carries what one merged material cannot draw',
    (type) => {
      // woc_head_merge.ts folds a piece only when its file material is opaque and has no
      // map but its colour: a base head that gained one would turn the merge off for
      // every character of the type, silently
      for (const m of glbJson(wocHeadCoreUrl(type)).materials ?? []) {
        expect(m.alphaMode ?? 'OPAQUE', m.name).toBe('OPAQUE');
        expect(m.normalTexture, m.name).toBeUndefined();
        expect(m.occlusionTexture, m.name).toBeUndefined();
        expect(m.emissiveTexture, m.name).toBeUndefined();
        expect(m.pbrMetallicRoughness?.metallicRoughnessTexture, m.name).toBeUndefined();
      }
    },
  );
});
