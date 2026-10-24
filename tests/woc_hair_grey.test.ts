// The WOC head packs' grey hair textures (scripts/assets/woc_character/hair_grey.mjs, run by
// woc_head_pack_compress.mjs): a texel turns into the sRGB byte of its own LINEAR Rec. 709
// luminance in all three channels, alpha kept, so the head tint (which reads nothing of a hair
// texel but that luminance: src/render/characters/woc_head_tint.ts) draws the grey texel as it
// drew the colour one, to within the 8 bit step; a PNG master comes back grey at its own size
// and channels; only a texture that hair-role materials alone sample as their base colour is
// picked (the runtime's own hair rule, never a normal or data map, never the core atlas); and
// the encode those textures take (ETC1S, quality 255, compression level 5) leaves every other
// encode's command, and so its cache key, as it was.
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  greyPng,
  greyTexelByte,
  greyTexels,
  hairGreyTextures,
  isHairRoleMaterial,
  linearToSrgbByte,
  srgbByteToLinear,
  WOC_HAIR_GREY_KTX,
  WOC_HAIR_LUMA,
} from '../scripts/assets/woc_character/hair_grey.mjs';
import { encoderSettings, ktxArgs } from '../scripts/assets/woc_character/ktx_encode.mjs';
import { WOC_HEAD_TINT_TABLE, wocHeadTintRef } from '../src/render/characters/woc_head_look_core';

/** The sRGB transfer, decoded, over a continuous 0..255 value (the test's own copy). */
const decode = (v: number): number => {
  const c = Math.min(255, Math.max(0, v)) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** The linear Rec. 709 luminance of an sRGB byte triple. */
const luminance = (r: number, g: number, b: number): number =>
  0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);

describe('greyTexelByte: a texel as its linear luminance', () => {
  it('turns known texels into their grey bytes', () => {
    // the weights the shader takes its luminance with
    expect([...WOC_HAIR_LUMA]).toEqual([0.2126, 0.7152, 0.0722]);
    // an auburn strand texel: linear 0.5776, 0.1878, 0.0452 -> luminance 0.2604 -> sRGB 140
    expect(greyTexelByte(200, 120, 60)).toBe(140);
    // the primaries land on their Rec. 709 luminance
    expect(greyTexelByte(255, 0, 0)).toBe(127);
    expect(greyTexelByte(0, 255, 0)).toBe(220);
    expect(greyTexelByte(0, 0, 255)).toBe(76);
    expect(greyTexelByte(0, 0, 0)).toBe(0);
    expect(greyTexelByte(255, 255, 255)).toBe(255);
  });

  it('leaves a grey texel as it is', () => {
    for (let g = 0; g < 256; g++) expect(greyTexelByte(g, g, g), `grey ${g}`).toBe(g);
  });

  it('keeps every texel luminance to within the 8 bit step', () => {
    let worst = 0;
    for (let r = 0; r < 256; r += 5) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 5) {
          const l = luminance(r, g, b);
          const grey = greyTexelByte(r, g, b);
          // the luminance lies inside the span of linear values that round to this byte
          expect(l, `${r} ${g} ${b}`).toBeGreaterThanOrEqual(decode(grey - 0.5) - 1e-12);
          expect(l, `${r} ${g} ${b}`).toBeLessThanOrEqual(decode(grey + 0.5) + 1e-12);
          // so what the shader decodes is the colour texel's luminance, give or take that
          worst = Math.max(worst, Math.abs(srgbByteToLinear(grey) - l));
        }
      }
    }
    // the largest half step of the sRGB curve, at the top of its range
    expect(worst).toBeLessThanOrEqual(decode(255) - decode(254.5) + 1e-12);
    expect(worst).toBeGreaterThan(0);
  });

  it('round-trips the sRGB transfer on every byte', () => {
    for (let v = 0; v < 256; v++) {
      expect(srgbByteToLinear(v), `byte ${v}`).toBeCloseTo(decode(v), 10);
      expect(linearToSrgbByte(srgbByteToLinear(v)), `byte ${v}`).toBe(v);
    }
    // clamped: nothing outside 0..255 comes out
    expect(linearToSrgbByte(-0.25)).toBe(0);
    expect(linearToSrgbByte(4)).toBe(255);
  });
});

describe('greyTexels and greyPng', () => {
  it('greys interleaved rgb and rgba texels, alpha kept, the input untouched', () => {
    const rgba = Uint8Array.from([200, 120, 60, 77, 255, 0, 0, 255, 9, 9, 9, 0]);
    const before = rgba.slice();
    expect([...greyTexels(rgba, 4)]).toEqual([140, 140, 140, 77, 127, 127, 127, 255, 9, 9, 9, 0]);
    expect(rgba).toEqual(before);
    expect([...greyTexels(Uint8Array.from([0, 255, 0, 0, 0, 255]), 3)]).toEqual([
      220, 220, 220, 76, 76, 76,
    ]);
    expect(() => greyTexels(new Uint8Array(4), 2)).toThrow(/2 channel/);
  });

  it('turns a PNG master grey at its own size and channels, losslessly', async () => {
    const rgb = Buffer.from([200, 120, 60, 255, 0, 0, 0, 255, 0, 30, 20, 10]);
    const png = await sharp(rgb, { raw: { width: 2, height: 2, channels: 3 } })
      .png()
      .toBuffer();
    const grey = await greyPng(new Uint8Array(png));
    const { data, info } = await sharp(Buffer.from(grey))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([2, 2, 3]);
    expect([...data]).toEqual([
      ...[140, 140, 140],
      ...[127, 127, 127],
      ...[220, 220, 220],
      ...Array(3).fill(greyTexelByte(30, 20, 10)),
    ]);
    // an alpha channel survives as it was
    const rgba = Buffer.from([200, 120, 60, 10, 0, 0, 255, 200]);
    const withAlpha = await greyPng(
      new Uint8Array(
        await sharp(rgba, { raw: { width: 2, height: 1, channels: 4 } })
          .png()
          .toBuffer(),
      ),
    );
    const out = await sharp(Buffer.from(withAlpha)).raw().toBuffer({ resolveWithObject: true });
    expect(out.info.channels).toBe(4);
    expect([...out.data]).toEqual([140, 140, 140, 10, 76, 76, 76, 200]);
    // a greyscale master comes back the grey it was, as rgb
    const mono = new Uint8Array(
      await sharp(Buffer.from([5, 250]), { raw: { width: 2, height: 1, channels: 1 } })
        .toColourspace('b-w')
        .png()
        .toBuffer(),
    );
    expect((await sharp(Buffer.from(mono)).metadata()).channels).toBe(1);
    const fromMono = await sharp(Buffer.from(await greyPng(mono)))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(fromMono.info.channels).toBe(3);
    expect([...fromMono.data]).toEqual([5, 5, 5, 250, 250, 250]);
    // a 16 bit master is refused, never quietly cut to 8 bits
    const deep = await sharp(Buffer.alloc(2 * 3 * 2, 0x80), {
      raw: { width: 2, height: 1, channels: 3 },
    })
      .toColourspace('rgb16')
      .png()
      .toBuffer();
    expect((await sharp(deep).metadata()).depth).toBe('ushort');
    await expect(greyPng(new Uint8Array(deep))).rejects.toThrow(/8 bit expected/);
  });
});

describe('hairGreyTextures: which textures ship grey', () => {
  it('picks a texture only hair-role materials sample as their base colour', () => {
    const doc = new Document();
    const strands = doc.createTexture('strands');
    const scalp = doc.createTexture('scalp');
    const beard = doc.createTexture('beard');
    const shared = doc.createTexture('shared');
    const normal = doc.createTexture('normal');
    const glowing = doc.createTexture('glowing');
    const orphan = doc.createTexture('orphan');
    const atlas = doc.createTexture('atlas');
    doc.createMaterial('hair_quiff').setBaseColorTexture(strands).setNormalTexture(normal);
    doc.createMaterial('hair_quiff_scalp').setBaseColorTexture(scalp);
    // seven beards on one shared image, and one named in another case (the runtime's hair
    // rule lowercases the name)
    doc.createMaterial('hair_beard_boxed').setBaseColorTexture(beard);
    doc.createMaterial('Hair_Beard_Chin').setBaseColorTexture(beard);
    // a texture a hair material shares with a material of another role keeps its colour
    doc.createMaterial('hair_mohawk').setBaseColorTexture(shared);
    doc.createMaterial('brow_L').setBaseColorTexture(shared);
    // a texture a hair material samples as anything but its base colour, too
    doc.createMaterial('hair_long').setBaseColorTexture(glowing);
    doc.createMaterial('hair_swept').setEmissiveTexture(glowing);
    // and the core atlas the skin, eyes and brows draw from
    doc.createMaterial('skin_head').setBaseColorTexture(atlas);
    doc.createMaterial('eye_L').setBaseColorTexture(atlas);
    expect(hairGreyTextures(doc)).toEqual([strands, scalp, beard]);
    expect(hairGreyTextures(doc)).not.toContain(orphan);
  });

  it("is the runtime's hair rule, row for row of the tint table", () => {
    for (const type of ['a', 'b'] as const) {
      const names = Object.keys(WOC_HEAD_TINT_TABLE[type]);
      expect(names.some(isHairRoleMaterial), type).toBe(true);
      for (const name of [...names, 'hair_new_style', 'Hair_X', 'liner_L', 'metal_gold']) {
        expect(isHairRoleMaterial(name), `${type} ${name}`).toBe(
          wocHeadTintRef(type, name)?.role === 'hair',
        );
      }
    }
  });
});

describe('the grey hair encode (ktx_encode.mjs)', () => {
  it('is ETC1S at quality 255 and compression level 5, sRGB, with its mip levels', () => {
    expect(WOC_HAIR_GREY_KTX).toEqual({ codec: 'etc1s', srgb: true, qlevel: 255, clevel: 5 });
    expect(ktxArgs(WOC_HAIR_GREY_KTX, 'in.png', 'out.ktx2')).toEqual([
      'create',
      '--format',
      'R8G8B8A8_SRGB',
      '--assign-tf',
      'srgb',
      '--generate-mipmap',
      '--encode',
      'basis-lz',
      '--clevel',
      '5',
      '--qlevel',
      '255',
      'in.png',
      'out.ktx2',
    ]);
  });

  it('leaves every other encode its command as it was (the cache keys hold)', () => {
    // the low armor tier's ETC1S names no compression level: still level 1, quality 128
    expect(ktxArgs(encoderSettings('color', 'low'), 'in.png', 'out.ktx2')).toEqual([
      'create',
      '--format',
      'R8G8B8A8_SRGB',
      '--assign-tf',
      'srgb',
      '--generate-mipmap',
      '--encode',
      'basis-lz',
      '--clevel',
      '1',
      '--qlevel',
      '128',
      'in.png',
      'out.ktx2',
    ]);
    // the head core's UASTC
    expect(ktxArgs({ codec: 'uastc', srgb: true, rdo: 2 }, 'in.png', 'out.ktx2')).toEqual([
      'create',
      '--format',
      'R8G8B8A8_SRGB',
      '--assign-tf',
      'srgb',
      '--generate-mipmap',
      '--encode',
      'uastc',
      '--uastc-quality',
      '2',
      '--zstd',
      '18',
      '--uastc-rdo',
      '--uastc-rdo-l',
      '2',
      'in.png',
      'out.ktx2',
    ]);
  });
});
