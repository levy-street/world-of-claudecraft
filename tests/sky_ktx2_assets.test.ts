// Guard + behavioral coverage for the KTX2 conversion of the biome sky domes
// (src/render/sky.ts) and their PMREM prefilter sources: two families.
//
// HDR: a Radiance sky used to be fetched whole, RGBE-decoded in a worker, and
// uploaded as a half-float RGBA DataTexture: about 16.8 MB of CPU pixels plus
// the same on the GPU per resident biome. The shipped form is now KTX2 UASTC HDR
// written by scripts/assets/compress_sky_hdr.mjs and requested through
// loadKtx2Texture, which uploads compressed blocks as-is.
//
// LDR: the PAINTED vale skies (day and night) are LDR by nature, so they ship as
// UASTC LDR sRGB KTX2 written by scripts/assets/compress_sky_ldr.mjs from
// skies_in/; the sRGB transfer in their DFD is what makes the GPU decode them to
// the same linear light the HDR family feeds the dome.
//
// The referenced set is DERIVED from sky.ts rather than restated here (same
// precedent as tests/surface_texture_ktx2.test.ts reading terrain.ts), so a new
// sky fails this suite until its files are encoded and manifested.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBasisuHdrArgs,
  SKY_HDR_STEMS,
  SKY_KTX2_VARIANTS,
  skyKtx2Jobs,
} from '../scripts/assets/lib/sky_hdr_compression_core.mjs';
import {
  SKY_LDR_SOURCES,
  SKY_LDR_STEMS,
  skyLdrJobs,
} from '../scripts/assets/lib/sky_ldr_compression_core.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const ROOT = path.resolve(__dirname, '..');
const ENV_DIR = path.join(ROOT, 'public', 'env');

// The KTX2 file identifier, 12 bytes: U+00AB "KTX 20" U+00BB CR LF SUB LF.
const KTX2_MAGIC = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
// KTX2 header field offsets (khronos spec section 3.1), all little-endian u32.
const OFF_VK_FORMAT = 12;
const OFF_PIXEL_WIDTH = 20;
const OFF_PIXEL_HEIGHT = 24;
const OFF_LEVEL_COUNT = 40;
const OFF_SUPERCOMPRESSION = 44;
const OFF_DFD_BYTE_OFFSET = 48;
/** Basic DFD block layout: the u32 total size, then vendorId/descriptorType,
 *  then versionNumber/descriptorBlockSize, then colorModel, colorPrimaries and
 *  transferFunction as the first three bytes. */
const DFD_COLOR_MODEL_OFFSET = 4 + 4 + 4;
const DFD_PRIMARIES_OFFSET = DFD_COLOR_MODEL_OFFSET + 1;
const DFD_TRANSFER_OFFSET = DFD_COLOR_MODEL_OFFSET + 2;
/** The first sample's channelType byte: after the four colour-model bytes come the
 *  texel block dimensions (4) and bytesPlane (8), then the sample's bitOffset (2) and
 *  bitLength (1). Its low nibble is the UASTC channel set: 0 RGB, 3 RGBA. */
const DFD_SAMPLE0_CHANNEL_OFFSET = DFD_COLOR_MODEL_OFFSET + 4 + 4 + 8 + 3;
const KHR_DF_CHANNEL_UASTC_RGB = 0;
const KHR_DF_CHANNEL_UASTC_RGBA = 3;

const SS_ZSTD = 2;
/** VK_FORMAT_ASTC_4x4_SFLOAT_BLOCK_EXT. Basis UASTC HDR 4x4 is a subset of
 *  ASTC HDR and declares this format. */
const VK_FORMAT_ASTC_4x4_SFLOAT_BLOCK_EXT = 1000066000;
/** KHR_DF_MODEL_UASTC_HDR. This byte is the WHOLE fallback story: three's
 *  KTX2Loader keys `isBasisHDR` on (vkFormat, colorModel) and only then will it
 *  transcode to BC6H or RGBA half on a device without the ASTC HDR profile. A
 *  plain ASTC HDR encode carries KHR_DF_MODEL_ASTC (0xA6) instead, and three
 *  would upload it raw on EVERY device, black-skying the ones that cannot
 *  sample it. */
const KHR_DF_MODEL_UASTC_HDR = 0xa7;
/** The painted (LDR) family's DFD: Basis UASTC LDR (vkFormat UNDEFINED, colour
 *  model 166), sRGB transfer, BT.709 primaries. three's parseColorSpace maps
 *  exactly that (BT.709, sRGB) pair to SRGBColorSpace, which selects the sRGB
 *  internal format and so the GPU's decode to linear; a linear-tagged encode
 *  would hand the dome sRGB-encoded values as if they were light and wash the
 *  painted sky out. */
const VK_FORMAT_UNDEFINED = 0;
const KHR_DF_MODEL_UASTC = 166;
const KHR_DF_PRIMARIES_BT709 = 1;
const KHR_DF_TRANSFER_SRGB = 2;

/** Pixel dimensions each shipped variant must carry. The 512 source mirrors
 *  the `maxWidth: 512` downscale the Radiance PMREM path did at load time. */
const VARIANT_SIZE: Record<string, { width: number; height: number }> = {
  '2k': { width: 2048, height: 1024 },
  '1k': { width: 1024, height: 512 },
  '512': { width: 512, height: 256 },
};

const readSource = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Every `/env/*.ktx2` url sky.ts asks for, read off its tables (day, PMREM
 *  source and painted night). */
function referencedSkyUrls(): string[] {
  const src = readSource('src/render/sky.ts');
  const urls = [...src.matchAll(/'(\/env\/[A-Za-z0-9_]+\.ktx2)'/g)].map((m) => m[1]);
  if (urls.length === 0) throw new Error('no /env/*.ktx2 urls found in sky.ts');
  return [...new Set(urls)];
}

const logicalUrl = (url: string): string => url.replace(/^\//, '');
const onDisk = (url: string): string => path.join(ROOT, 'public', logicalUrl(url));
const u32 = (buf: Buffer, off: number): number => buf.readUInt32LE(off);
/** `/env/<stem>_<variant>.ktx2` split into its stem and variant. */
function splitSkyUrl(url: string): { stem: string; variant: string } {
  const base = url.slice('/env/'.length, -'.ktx2'.length);
  const cut = base.lastIndexOf('_');
  return { stem: base.slice(0, cut), variant: base.slice(cut + 1) };
}
const hdrUrls = (): string[] =>
  referencedSkyUrls().filter((url) => SKY_HDR_STEMS.includes(splitSkyUrl(url).stem));
const ldrUrls = (): string[] =>
  referencedSkyUrls().filter((url) => SKY_LDR_STEMS.includes(splitSkyUrl(url).stem));

/** 13 shipped HDR skies, three variants each, and the painted vale pair (day
 *  with its PMREM source, night dome-only): the vacuity floors a dropped table
 *  entry or a half-finished encode run cannot hide under (tests/CLAUDE.md). */
const SHIPPED_HDR_SKY_FILES = 39;
const SHIPPED_LDR_SKY_FILES = 5;

describe('biome sky KTX2 assets (shipped)', () => {
  it('sorts every sky url sky.ts references into exactly one family', () => {
    const urls = referencedSkyUrls();
    expect(urls.length).toBe(SHIPPED_HDR_SKY_FILES + SHIPPED_LDR_SKY_FILES);
    for (const url of urls) {
      const { stem } = splitSkyUrl(url);
      const families = [SKY_HDR_STEMS.includes(stem), SKY_LDR_STEMS.includes(stem)];
      expect(families.filter(Boolean), `${url}: in no family, or in both`).toHaveLength(1);
    }
  });

  it('ships a valid KTX2 UASTC HDR file for every HDR sky url sky.ts references', () => {
    const urls = hdrUrls();
    expect(urls.length).toBe(SHIPPED_HDR_SKY_FILES);

    for (const url of urls) {
      const file = onDisk(url);
      expect(fs.existsSync(file), `${url}: missing`).toBe(true);
      const buf = fs.readFileSync(file);
      expect(buf.subarray(0, KTX2_MAGIC.length).equals(KTX2_MAGIC), `${url} is not KTX2`).toBe(
        true,
      );

      // Basis UASTC HDR, not plain ASTC HDR: see KHR_DF_MODEL_UASTC_HDR above.
      expect(u32(buf, OFF_VK_FORMAT), `${url} vkFormat`).toBe(VK_FORMAT_ASTC_4x4_SFLOAT_BLOCK_EXT);
      const dfdOffset = u32(buf, OFF_DFD_BYTE_OFFSET);
      expect(buf[dfdOffset + DFD_COLOR_MODEL_OFFSET], `${url} DFD colorModel`).toBe(
        KHR_DF_MODEL_UASTC_HDR,
      );

      const variant = url.slice(url.lastIndexOf('_') + 1, -'.ktx2'.length);
      const size = VARIANT_SIZE[variant];
      expect(size, `${url}: unrecognized variant suffix`).toBeTruthy();
      expect(u32(buf, OFF_PIXEL_WIDTH), `${url} width`).toBe(size.width);
      expect(u32(buf, OFF_PIXEL_HEIGHT), `${url} height`).toBe(size.height);

      // One level, deliberately: the dome and the PMREM source both sample
      // with LinearFilter and never asked for a mip chain, so extra levels
      // would be bytes nothing reads.
      expect(u32(buf, OFF_LEVEL_COUNT), `${url} mip levels`).toBe(1);
      expect(u32(buf, OFF_SUPERCOMPRESSION), `${url} supercompression`).toBe(SS_ZSTD);
    }
  });

  it('ships a valid KTX2 UASTC LDR sRGB file for every painted sky url sky.ts references', () => {
    const urls = ldrUrls();
    expect(urls.length).toBe(SHIPPED_LDR_SKY_FILES);

    for (const url of urls) {
      const file = onDisk(url);
      expect(fs.existsSync(file), `${url}: missing`).toBe(true);
      const buf = fs.readFileSync(file);
      expect(buf.subarray(0, KTX2_MAGIC.length).equals(KTX2_MAGIC), `${url} is not KTX2`).toBe(
        true,
      );

      // Basis UASTC LDR: what three transcodes to ASTC, BC7 or ETC2 by device,
      // with an ungated RGBA8 rung under them (pinned in the ladder block below).
      expect(u32(buf, OFF_VK_FORMAT), `${url} vkFormat`).toBe(VK_FORMAT_UNDEFINED);
      const dfdOffset = u32(buf, OFF_DFD_BYTE_OFFSET);
      expect(buf[dfdOffset + DFD_COLOR_MODEL_OFFSET], `${url} DFD colorModel`).toBe(
        KHR_DF_MODEL_UASTC,
      );
      // sRGB: the GPU decodes to linear light, see KHR_DF_TRANSFER_SRGB above.
      expect(buf[dfdOffset + DFD_TRANSFER_OFFSET], `${url} DFD transfer`).toBe(
        KHR_DF_TRANSFER_SRGB,
      );
      expect(buf[dfdOffset + DFD_PRIMARIES_OFFSET], `${url} DFD primaries`).toBe(
        KHR_DF_PRIMARIES_BT709,
      );
      // A night whose painted stars were removed carries their density in ALPHA (the
      // dome's painted star layer reads it); every other painted sky is RGB.
      const { stem } = splitSkyUrl(url);
      const starDensity = SKY_LDR_SOURCES.find((source) => source.stem === stem)?.removeStars;
      expect(buf[dfdOffset + DFD_SAMPLE0_CHANNEL_OFFSET] & 0x0f, `${url} DFD channels`).toBe(
        starDensity ? KHR_DF_CHANNEL_UASTC_RGBA : KHR_DF_CHANNEL_UASTC_RGB,
      );

      const { variant } = splitSkyUrl(url);
      const size = VARIANT_SIZE[variant];
      expect(size, `${url}: unrecognized variant suffix`).toBeTruthy();
      expect(u32(buf, OFF_PIXEL_WIDTH), `${url} width`).toBe(size.width);
      expect(u32(buf, OFF_PIXEL_HEIGHT), `${url} height`).toBe(size.height);
      // One level: the dome magnifies the painting and the PMREM source is read
      // at its own size, and a single level under LinearFilter has no mip pick,
      // so the u wrap's derivative jump cannot draw a seam line.
      expect(u32(buf, OFF_LEVEL_COUNT), `${url} mip levels`).toBe(1);
      expect(u32(buf, OFF_SUPERCOMPRESSION), `${url} supercompression`).toBe(SS_ZSTD);
    }
  });

  it('keeps the painted sources committed beside the encoder, exactly 2:1', () => {
    // skies_in/ is the only master the painted skies have; the encoder stretches a
    // non-2:1 source to fill, so a wrong-aspect repaint is caught here first.
    for (const stem of SKY_LDR_STEMS) {
      const file = path.join(ROOT, 'skies_in', `${stem}.png`);
      expect(fs.existsSync(file), `${stem}.png removed`).toBe(true);
      const png = fs.readFileSync(file);
      // The PNG IHDR chunk: width and height as big-endian u32 at bytes 16 and 20.
      expect(png.subarray(12, 16).toString('latin1'), `${stem}.png IHDR`).toBe('IHDR');
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      expect(width, `${stem}.png aspect`).toBe(height * 2);
    }
  });

  it('keeps every file well under the per-biome GPU budget the conversion exists for', () => {
    // UASTC HDR is one byte per pixel on ASTC HDR and BC6H alike, so a 2k dome
    // is 2 MB resident against the 16.8 MB a half-float RGBA upload cost; UASTC
    // LDR is one byte per pixel too on ASTC and BC7 (half that on ETC1). The
    // ON-DISK size is the download half of the same win and is checked here
    // because it is what a re-encode with the wrong flags would blow out.
    for (const url of referencedSkyUrls()) {
      const variant = url.slice(url.lastIndexOf('_') + 1, -'.ktx2'.length);
      const { width, height } = VARIANT_SIZE[variant];
      const gpuBytes = width * height;
      expect(gpuBytes, `${url} resident GPU bytes`).toBeLessThan(3 * 1024 * 1024);
      // zstd over UASTC: the shipped HDR set lands near 0.8 bytes per pixel and
      // the painted set (RDO on) near 0.6.
      expect(fs.statSync(onDisk(url)).size, `${url} download size`).toBeLessThan(gpuBytes);
    }
  });

  it('registers every sky url in the media manifest, so assetUrl resolves it', () => {
    for (const url of referencedSkyUrls()) {
      expect(MEDIA_ASSETS[logicalUrl(url)], `${url} missing from the media manifest`).toBeTruthy();
    }
  });

  it('keeps the .hdr masters on disk: they are the encoder input, never a runtime fallback', () => {
    for (const job of skyKtx2Jobs()) {
      expect(fs.existsSync(path.join(ENV_DIR, job.source)), `${job.source} removed`).toBe(true);
    }
    // ...and nothing in the render tree loads them any more. The RGBE decode
    // worker and the half-float DataTexture upload it fed are the whole cost
    // this conversion removes, so a reintroduced Radiance arm is a regression,
    // not an addition.
    const sky = readSource('src/render/sky.ts');
    expect(sky).not.toMatch(/\/env\/[A-Za-z0-9_]+\.hdr/);
    const loader = readSource('src/render/assets/loader.ts');
    expect(loader).not.toContain('RGBELoader');
    expect(loader).not.toContain('loadHdr');
  });

  it('covers exactly the skies sky.ts references, in both directions', () => {
    // The encoders cannot import the TypeScript tables, so their stem lists are
    // restated; this is what keeps them from drifting. A new sky added to
    // sky.ts but to neither list fails here, and so does a stem left behind
    // after its sky was retired (it would keep shipping dead bytes): vale_day,
    // replaced by the painted vale, is exactly that case.
    const referenced = new Set(referencedSkyUrls().map((url) => splitSkyUrl(url).stem));
    expect([...referenced].sort()).toEqual([...SKY_HDR_STEMS, ...SKY_LDR_STEMS].sort());
    expect(SKY_HDR_STEMS).not.toContain('vale_day');
    // ...and per painted stem, exactly the variants its encoder writes: the env
    // sky is the PMREM source alone, the day and the night are dome-only.
    for (const source of SKY_LDR_SOURCES) {
      const variants = ldrUrls()
        .map(splitSkyUrl)
        .filter((entry) => entry.stem === source.stem)
        .map((entry) => entry.variant)
        .sort();
      expect(variants, source.stem).toEqual([...source.variants].sort());
    }
    expect(
      skyLdrJobs()
        .map((job) => `/env/${job.target}`)
        .sort(),
    ).toEqual(ldrUrls().sort());
  });

  it('plans one job per (sky, variant) pair, each reading a real .hdr master', () => {
    const jobs = skyKtx2Jobs();
    expect(jobs.length).toBe(SKY_HDR_STEMS.length * SKY_KTX2_VARIANTS.length);
    expect(jobs.length).toBe(SHIPPED_HDR_SKY_FILES);
    expect(new Set(jobs.map((j) => j.target)).size).toBe(jobs.length);
    // The two dome variants come from their own master; the PMREM source is
    // downscaled from the 1k one, never from the 2k (which would quadruple the
    // encode's input for a 512-wide output).
    const fen = jobs.filter((j) => j.stem === 'fen_day');
    expect(fen.map((j) => [j.variant, j.source, j.resample?.width ?? null])).toEqual([
      ['2k', 'fen_day_2k.hdr', null],
      ['1k', 'fen_day_1k.hdr', null],
      ['512', 'fen_day_1k.hdr', 512],
    ]);
  });

  it('builds basisu arguments that select UASTC HDR and bake the vertical flip', () => {
    const args = buildBasisuHdrArgs({ srcPath: 'in.hdr', dstPath: 'out.ktx2' });
    // -hdr is what produces the UASTC HDR color model the loader keys on.
    expect(args).toContain('-hdr');
    // A CompressedTexture cannot honor flipY at runtime and the sky sampled
    // through flipY = true as a DataTexture, so the flip is baked or the whole
    // dome samples upside down. There is no downstream correction.
    expect(args).toContain('-y_flip');
    // Single level: the runtime never generates mips for a compressed texture
    // and never asked for them here.
    expect(args).not.toContain('-mipmap');
    expect(args.slice(-2)).toEqual(['out.ktx2', 'in.hdr']);
    expect(args).not.toContain('-resample');

    const scaled = buildBasisuHdrArgs({
      srcPath: 'in.hdr',
      dstPath: 'out.ktx2',
      resample: { width: 512, height: 256 },
    });
    expect(scaled.join(' ')).toContain('-resample 512 256');
    expect(scaled).toContain('-y_flip');
  });
});

// The device ladder is the whole reason these files are Basis UASTC HDR rather
// than plain ASTC HDR, and none of it is our code: it lives in the installed
// three's KTX2Loader. There is no Radiance arm behind it any more, so a three
// bump that drops a rung black-skies every device on that rung, and nothing
// else in this repo would notice. Pinned against the installed bundle, the same
// way tests/three_compile_async_patch.test.ts pins its patch.
describe('the three KTX2 HDR fallback ladder the sky depends on', () => {
  const loaderSource = fs.readFileSync(
    path.join(ROOT, 'node_modules/three/examples/jsm/loaders/KTX2Loader.js'),
    'utf8',
  );

  /** One FORMAT_OPTIONS entry, as the fields this suite reasons about. */
  function hdrFormatOptions(): { gate: string | null; transcoderFormat: string }[] {
    const start = loaderSource.indexOf('const FORMAT_OPTIONS = [');
    expect(start, 'FORMAT_OPTIONS table not found in KTX2Loader').toBeGreaterThan(0);
    const table = loaderSource.slice(start, loaderSource.indexOf('\n\t];', start));
    return [...table.matchAll(/\{([^{}]*)\}/g)]
      .map((m) => m[1])
      .filter((body) => body.includes('BasisFormat.UASTC_HDR'))
      .map((body) => ({
        gate: body.match(/if:\s*'([A-Za-z0-9]+)'/)?.[1] ?? null,
        transcoderFormat: body.match(
          /transcoderFormat:\s*\[\s*TranscoderFormat\.([A-Za-z0-9_]+)/,
        )![1],
      }));
  }

  it('transcodes UASTC HDR to BC6H behind bptcSupported', () => {
    const bc6h = hdrFormatOptions().filter((o) => o.transcoderFormat === 'BC6H');
    expect(bc6h).toHaveLength(1);
    // Gated, and on exactly the flag assets/ktx2_support.ts probes for.
    expect(bc6h[0].gate).toBe('bptcSupported');
  });

  it('keeps an UNGATED RGBA half-float rung under it, so no device is left without a sky', () => {
    const options = hdrFormatOptions();
    const half = options.filter((o) => o.transcoderFormat === 'RGBA_HALF');
    expect(half).toHaveLength(1);
    // Ungated is the load-bearing half: a device with neither ASTC HDR nor BPTC
    // (today's iOS, most likely) reaches this rung and pays exactly what the
    // Radiance path already cost, which is why removing that path regresses
    // nobody's memory.
    expect(half[0].gate).toBeNull();
    // ...and it really is the LAST resort, not something that outranks BC6H.
    const priorities = [
      ...loaderSource.matchAll(
        /transcoderFormat:\s*\[\s*TranscoderFormat\.(BC6H|RGBA_HALF)[^}]*?priorityHDR:\s*(\d+)/gs,
      ),
    ].map((m) => [m[1], Number(m[2])] as const);
    const rank = Object.fromEntries(priorities);
    expect(rank.BC6H).toBeLessThan(rank.RGBA_HALF);
    // The sort that consumes those numbers is ascending, so lower really is
    // preferred; a flipped comparator would silently invert the ladder.
    expect(loaderSource).toContain('.sort( ( a, b ) => a.priorityHDR - b.priorityHDR )');
  });

  it('skips the transcoder entirely for Basis HDR only while the device exposes ASTC HDR', () => {
    // The top rung is not in FORMAT_OPTIONS at all: _createTexture uploads the
    // ASTC blocks raw when it can, and this is the condition that decides it.
    // If the `astcHDRSupported` conjunct were ever dropped, three would upload
    // ASTC HDR blocks to devices that cannot sample them.
    expect(loaderSource).toContain('isBasisHDR && ! this.workerConfig.astcHDRSupported');
    // isBasisHDR is the (vkFormat, DFD colorModel) pair the encoder writes, and
    // the same 0xA7 the shipped-file assertions above check byte for byte.
    expect(loaderSource).toContain('container.dataFormatDescriptor[ 0 ].colorModel === 0xA7');
  });
});

// The painted (LDR) skies lean on the same loader for two more facts: an UNGATED
// uncompressed rung under the UASTC ladder, so no device is left without the vale
// sky, and the (BT.709, sRGB) DFD pair mapping to SRGBColorSpace, which is what
// turns the sRGB-encoded painting into linear light in the GPU sampler. Pinned
// against the installed bundle like the HDR ladder above.
describe('the three KTX2 LDR path the painted skies depend on', () => {
  const loaderSource = fs.readFileSync(
    path.join(ROOT, 'node_modules/three/examples/jsm/loaders/KTX2Loader.js'),
    'utf8',
  );

  function uastcLdrFormatOptions(): { gate: string | null; transcoderFormat: string }[] {
    const start = loaderSource.indexOf('const FORMAT_OPTIONS = [');
    expect(start, 'FORMAT_OPTIONS table not found in KTX2Loader').toBeGreaterThan(0);
    const table = loaderSource.slice(start, loaderSource.indexOf('\n\t];', start));
    return [...table.matchAll(/\{([^{}]*)\}/g)]
      .map((m) => m[1])
      .filter((body) => /BasisFormat\.UASTC\b(?!_HDR)/.test(body))
      .map((body) => ({
        gate: body.match(/if:\s*'([A-Za-z0-9]+)'/)?.[1] ?? null,
        transcoderFormat:
          body.match(/transcoderFormat:\s*\[\s*TranscoderFormat\.([A-Za-z0-9_]+)/)?.[1] ?? '',
      }));
  }

  it('transcodes UASTC LDR to ASTC and BC7 behind their gates, with an ungated RGBA32 rung', () => {
    const options = uastcLdrFormatOptions();
    const byFormat = new Map(options.map((o) => [o.transcoderFormat, o.gate]));
    expect(byFormat.get('ASTC_4x4')).toBe('astcSupported');
    expect(byFormat.get('BC7_M5')).toBe('bptcSupported');
    expect(byFormat.has('RGBA32')).toBe(true);
    expect(byFormat.get('RGBA32')).toBeNull();
  });

  it('maps the BT.709 + sRGB DFD the encoder writes to SRGBColorSpace', () => {
    const start = loaderSource.indexOf('function parseColorSpace( container )');
    expect(start).toBeGreaterThan(0);
    const body = loaderSource.slice(start, loaderSource.indexOf('\n}', start));
    expect(body).toContain('dfd.colorPrimaries === KHR_DF_PRIMARIES_BT709');
    expect(body).toContain(
      'dfd.transferFunction === KHR_DF_TRANSFER_SRGB ? SRGBColorSpace : LinearSRGBColorSpace',
    );
  });
});
