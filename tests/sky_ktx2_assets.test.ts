// Guard + behavioral coverage for the KTX2 UASTC HDR conversion of the biome
// sky domes (src/render/sky.ts) and their PMREM prefilter sources.
//
// A Radiance sky used to be fetched whole, RGBE-decoded in a worker, and
// uploaded as a half-float RGBA DataTexture: about 16.8 MB of CPU pixels plus
// the same on the GPU per resident biome. The shipped form is now KTX2 written
// by scripts/assets/compress_sky_hdr.mjs and requested through
// loadKtx2Texture, which uploads compressed blocks as-is.
//
// The referenced set is DERIVED from sky.ts rather than restated here (same
// precedent as tests/surface_texture_ktx2.test.ts reading terrain.ts), so a new
// sky fails this suite until its three files are encoded and manifested.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBasisuHdrArgs,
  SKY_HDR_STEMS,
  SKY_KTX2_VARIANTS,
  skyKtx2Jobs,
} from '../scripts/assets/lib/sky_hdr_compression_core.mjs';
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
 *  then versionNumber/descriptorBlockSize, then colorModel as the first byte. */
const DFD_COLOR_MODEL_OFFSET = 4 + 4 + 4;

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

/** Pixel dimensions each shipped variant must carry. The 512 source mirrors
 *  the `maxWidth: 512` downscale the Radiance PMREM path did at load time. */
const VARIANT_SIZE: Record<string, { width: number; height: number }> = {
  '2k': { width: 2048, height: 1024 },
  '1k': { width: 1024, height: 512 },
  '512': { width: 512, height: 256 },
};

const readSource = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Every `/env/*.ktx2` url sky.ts asks for, read off its three tables. */
function referencedSkyUrls(): string[] {
  const src = readSource('src/render/sky.ts');
  const urls = [...src.matchAll(/'(\/env\/[A-Za-z0-9_]+\.ktx2)'/g)].map((m) => m[1]);
  if (urls.length === 0) throw new Error('no /env/*.ktx2 urls found in sky.ts');
  return [...new Set(urls)];
}

const logicalUrl = (url: string): string => url.replace(/^\//, '');
const onDisk = (url: string): string => path.join(ROOT, 'public', logicalUrl(url));
const u32 = (buf: Buffer, off: number): number => buf.readUInt32LE(off);

/** 14 shipped skies, three variants each: the vacuity floor a dropped table
 *  entry or a half-finished encode run cannot hide under (tests/CLAUDE.md). */
const SHIPPED_SKY_FILES = 42;

describe('biome sky KTX2 assets (shipped)', () => {
  it('ships a valid KTX2 UASTC HDR file for every sky url sky.ts references', () => {
    const urls = referencedSkyUrls();
    expect(urls.length).toBe(SHIPPED_SKY_FILES);

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

  it('keeps every file well under the per-biome GPU budget the conversion exists for', () => {
    // UASTC HDR is one byte per pixel on ASTC HDR and BC6H alike, so a 2k dome
    // is 2 MB resident against the 16.8 MB a half-float RGBA upload cost. The
    // ON-DISK size is the download half of the same win and is checked here
    // because it is what a re-encode with the wrong flags would blow out.
    for (const url of referencedSkyUrls()) {
      const variant = url.slice(url.lastIndexOf('_') + 1, -'.ktx2'.length);
      const { width, height } = VARIANT_SIZE[variant];
      const gpuBytes = width * height;
      expect(gpuBytes, `${url} resident GPU bytes`).toBeLessThan(3 * 1024 * 1024);
      // zstd over UASTC HDR: the shipped set lands near 0.8 bytes per pixel.
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
    // The encoder cannot import the TypeScript tables, so its stem list is
    // restated; this is what keeps the two from drifting. A new sky added to
    // sky.ts but not to SKY_HDR_STEMS fails here, and so does a stem left
    // behind after its sky was retired (it would keep shipping dead bytes).
    const referenced = new Set(
      referencedSkyUrls().map((url) => {
        const base = url.slice('/env/'.length, -'.ktx2'.length);
        return base.slice(0, base.lastIndexOf('_'));
      }),
    );
    expect([...referenced].sort()).toEqual([...SKY_HDR_STEMS].sort());
  });

  it('plans one job per (sky, variant) pair, each reading a real .hdr master', () => {
    const jobs = skyKtx2Jobs();
    expect(jobs.length).toBe(SKY_HDR_STEMS.length * SKY_KTX2_VARIANTS.length);
    expect(jobs.length).toBe(SHIPPED_SKY_FILES);
    expect(new Set(jobs.map((j) => j.target)).size).toBe(jobs.length);
    // The two dome variants come from their own master; the PMREM source is
    // downscaled from the 1k one, never from the 2k (which would quadruple the
    // encode's input for a 512-wide output).
    const vale = jobs.filter((j) => j.stem === 'vale_day');
    expect(vale.map((j) => [j.variant, j.source, j.resample?.width ?? null])).toEqual([
      ['2k', 'vale_day_2k.hdr', null],
      ['1k', 'vale_day_1k.hdr', null],
      ['512', 'vale_day_1k.hdr', 512],
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
