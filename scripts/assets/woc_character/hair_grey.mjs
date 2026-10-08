// Grey hair textures for the WOC head packs (woc_head_pack_compress.mjs, 2026-10-03). The head
// tint (src/render/characters/woc_head_tint.ts) draws a hair, scalp cap or beard texel as the
// chosen colour at the texel's LINEAR luminance over its material's reference, and reads nothing
// else of the texel: its hue never reaches the screen. So every texture that only hair-role
// materials sample ships as that luminance alone, in grey, and its one encode (ETC1S: a block is
// a base colour and a brightness ramp) has no hue left to spend bits on.
//
// Per texel: the sRGB bytes decoded to linear, the Rec. 709 luminance taken, encoded back to an
// sRGB byte and written to all three channels; alpha is kept. The GPU decodes the sRGB texture,
// so the shader reads the luminance the colour texel had, to within the 8 bit step. The tint
// references (woc_head_look_core.ts WOC_HEAD_TINT_TABLE) are medians of that same luminance,
// measured on the colour paint, so the grey keeps them.
import { PropertyType } from '@gltf-transform/core';
import sharp from 'sharp';

/** Rec. 709 luminance weights over LINEAR rgb (the shader's). */
export const WOC_HAIR_LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

/** How a grey hair texture encodes (ktx_encode.mjs): ETC1S (Basis-LZ) at its top quality level
 *  and compression level 5, sRGB, mip levels generated. ETC1S is NEVER for a normal or packed
 *  data map, and nothing but a grey hair texture takes these settings. */
export const WOC_HAIR_GREY_KTX = Object.freeze({
  codec: 'etc1s',
  srgb: true,
  qlevel: 255,
  clevel: 5,
});

/** The sRGB transfer, decoded (three's SRGBToLinear), over 0..1. */
function srgbToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4;
}

/** The sRGB transfer, encoded, over 0..1. */
function linearToSrgb(l) {
  return l < 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
}

const DECODED = Float64Array.from({ length: 256 }, (_v, i) => srgbToLinear(i / 255));

/** An sRGB byte as linear 0..1. */
export function srgbByteToLinear(byte) {
  return DECODED[byte];
}

/** A linear 0..1 value as the nearest sRGB byte (clamped). */
export function linearToSrgbByte(linear) {
  return Math.min(255, Math.max(0, Math.round(linearToSrgb(Math.max(0, linear)) * 255)));
}

/** The grey sRGB byte of one sRGB texel: its linear luminance, encoded back. */
export function greyTexelByte(r, g, b) {
  const [wr, wg, wb] = WOC_HAIR_LUMA;
  return linearToSrgbByte(wr * DECODED[r] + wg * DECODED[g] + wb * DECODED[b]);
}

/** A copy of interleaved 8 bit texels (3 or 4 channels) with every texel's rgb its grey byte and
 *  its alpha (4 channels) kept. */
export function greyTexels(data, channels) {
  if (channels !== 3 && channels !== 4) {
    throw new Error(`hair grey: ${channels} channel texels (3 or 4 expected)`);
  }
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += channels) {
    const grey = greyTexelByte(data[i], data[i + 1], data[i + 2]);
    out[i] = grey;
    out[i + 1] = grey;
    out[i + 2] = grey;
    if (channels === 4) out[i + 3] = data[i + 3];
  }
  return out;
}

/** A PNG master in grey (greyTexels), as a lossless PNG of the master's size: rgb, or rgba when
 *  the master has alpha (sharp decodes every 8 bit PNG, a greyscale one too, to one of the
 *  two). Anything but 8 bit channels is refused rather than converted. */
export async function greyPng(png) {
  const input = Buffer.from(png);
  const meta = await sharp(input).metadata();
  if (meta.depth !== 'uchar') throw new Error(`hair grey: a ${meta.depth} PNG (8 bit expected)`);
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
  const grey = greyTexels(data, info.channels);
  const out = await sharp(Buffer.from(grey.buffer, grey.byteOffset, grey.byteLength), {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(out);
}

/** Whether the runtime draws a material through the hair transfer: the head tint's own rule
 *  (woc_head_look_core.ts wocHeadTintRef: every hair_ material is a measured hair row or falls
 *  back to its type's hair reference), so a hairstyle's strands, its scalp cap and every beard. */
export function isHairRoleMaterial(name) {
  return name.toLowerCase().startsWith('hair_');
}

/** The textures of a pack that ship grey: each sampled ONLY as the base colour of hair-role
 *  materials. Never a normal or data map, and never a texture a material of another role
 *  samples too (the core atlas, which carries skin, eyes and brows). Document order. */
export function hairGreyTextures(doc) {
  const graph = doc.getGraph();
  return doc
    .getRoot()
    .listTextures()
    .filter((tex) => {
      const uses = graph
        .listParentEdges(tex)
        .filter((edge) => edge.getParent().propertyType !== PropertyType.ROOT);
      return (
        uses.length > 0 &&
        uses.every(
          (edge) =>
            edge.getParent().propertyType === PropertyType.MATERIAL &&
            edge.getName() === 'baseColorTexture' &&
            isHairRoleMaterial(edge.getParent().getName()),
        )
      );
    });
}
