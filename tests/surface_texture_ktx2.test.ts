// Guard + behavioral coverage for the KTX2 conversion of the standalone
// SURFACE textures the runtime references by URL: the terrain splat set
// (src/render/terrain.ts), the surface-detail families
// (src/render/worn_stone.ts) and the shared stone detail normal
// (src/render/detail_normals.ts).
//
// Those 1024x1024 ambientCG maps used to come through loadTexture, so each one
// decoded to a full RGBA bitmap (plus its generated mip chain) and stayed that
// way for the whole session. They now ship a `.ktx2` sibling written by
// scripts/assets/compress_standalone_textures.mjs and are requested through
// loadKtx2Texture, which uploads the compressed blocks as-is.
//
// The referenced set is DERIVED from the three sources rather than restated
// here (same precedent as compress_glb_textures.mjs reading weapon_vfx.ts for
// its exclusion list), so a new splat layer or a new surface-detail family
// fails this suite until its sibling is generated.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  blockAlignmentError,
  buildKtxCreateArgs,
  classifyStandaloneTexture,
  flippedSourcePath,
  isConvertibleSkinPng,
  isConvertibleStandaloneImage,
  ktx2SiblingPath,
  parseArgs,
} from '../scripts/assets/lib/standalone_texture_compression_core.mjs';
import { ktx2SiblingUrl } from '../src/render/assets/ktx2_sibling';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const ROOT = path.resolve(__dirname, '..');
const TERRAIN_DIR = 'textures/terrain';
const STRUCTURES_DIR = 'textures/structures';
// The KTX2 file identifier, 12 bytes: U+00AB "KTX 20" U+00BB CR LF SUB LF.
const KTX2_MAGIC = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
// KTX2 header field offsets (khronos spec section 3.1), all little-endian u32.
const OFF_PIXEL_WIDTH = 20;
const OFF_PIXEL_HEIGHT = 24;
const OFF_LEVEL_COUNT = 40;
const OFF_SUPERCOMPRESSION = 44;
/** supercompressionScheme enumerants this pipeline can emit. */
const SS_BASIS_LZ = 1;
const SS_ZSTD = 2;

const readSource = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Splat layers terrain.ts asks for, read off its prepareTerrainTex calls,
 *  with the srgb flag: the srgb=true COLOUR layers are pack sources for
 *  buildSplatAlbedoArray's drawImage and must stay raw (see below). */
function terrainReferencesWithFlags(): { logical: string; srgb: boolean }[] {
  const src = readSource('src/render/terrain.ts');
  const calls = [
    ...src.matchAll(/prepareTerrainTex\(\s*'[^']+',\s*'([^']+)',\s*(true|false)\s*\)/g),
  ].map((m) => ({ logical: `${TERRAIN_DIR}/${m[1]}`, srgb: m[2] === 'true' }));
  if (calls.length === 0) throw new Error('no prepareTerrainTex calls found in terrain.ts');
  return calls;
}

function terrainReferences(): string[] {
  return terrainReferencesWithFlags()
    .filter((c) => !c.srgb)
    .map((c) => c.logical);
}

/** The srgb=true colour layers: referenced, deliberately NOT converted. */
function terrainColourReferences(): string[] {
  return terrainReferencesWithFlags()
    .filter((c) => c.srgb)
    .map((c) => c.logical);
}

/** The one shared stone detail normal, read off its literal url. */
function detailNormalReferences(): string[] {
  const src = readSource('src/render/detail_normals.ts');
  const files = [...src.matchAll(/'\/textures\/terrain\/([A-Za-z0-9_]+\.(?:jpg|png))'/g)].map(
    (m) => `${TERRAIN_DIR}/${m[1]}`,
  );
  if (files.length === 0) throw new Error('no terrain texture url found in detail_normals.ts');
  return files;
}

/** Every channel map a surface-detail family CAN load: the FAMILIES prefixes
 *  (with their optional directory override) crossed with the channel suffixes
 *  prepareSurfaceDetailProfileAssets asks for. A family that does not ship a
 *  given channel (metal has no AmbientOcclusion map) simply has no source
 *  file, which the on-disk filter below drops; SHIPPED_SURFACE_TEXTURES is the
 *  floor that keeps that filter from quietly emptying the set. */
function wornStoneReferences(): string[] {
  const src = readSource('src/render/worn_stone.ts');
  const suffixes = [
    ...src.matchAll(/prepareFamilyTexture\(family,\s*'[a-z]+',\s*'([A-Za-z]+)'\)/g),
  ].map((m) => m[1]);
  if (suffixes.length === 0)
    throw new Error('no prepareFamilyTexture calls found in worn_stone.ts');

  const start = src.indexOf('const FAMILIES');
  if (start < 0) throw new Error('FAMILIES table not found in worn_stone.ts');
  const table = src.slice(start, src.indexOf('\n};', start));
  const families = [...table.matchAll(/prefix: '([A-Za-z0-9]+)',\s*(?:dir: '([^']+)',)?/g)];
  if (families.length === 0) throw new Error('FAMILIES extraction matched no prefixes');

  const out: string[] = [];
  for (const [, prefix, dir] of families) {
    const logicalDir = (dir ?? '/textures/structures/').replace(/^\/+/, '').replace(/\/+$/, '');
    for (const suffix of suffixes) out.push(`${logicalDir}/${prefix}_${suffix}.jpg`);
  }
  return out;
}

function referencedSurfaceTextures(): string[] {
  const all = [...terrainReferences(), ...detailNormalReferences(), ...wornStoneReferences()];
  return [...new Set(all)];
}

const onDisk = (logical: string): string => path.join(ROOT, 'public', logical);
const u32 = (buf: Buffer, off: number): number => buf.readUInt32LE(off);

// Tight vacuity floor (tests/CLAUDE.md): the exact number of distinct source
// images the three render modules reference and the conversion run produced.
// A dropped splat layer or family channel cannot hide under it.
const SHIPPED_SURFACE_TEXTURES = 32;
/** The one referenced source that stays a raw image, pinned below. */
const PACKED_DATA_TEXTURE = `${TERRAIN_DIR}/GroundAO_Packed.png`;

describe('surface texture KTX2 compression (shipped assets)', () => {
  it('ships a valid KTX2 sibling for every terrain/structure jpg the renderer references', () => {
    const referenced = referencedSurfaceTextures();
    const jpgs = referenced
      .filter((u) => u.endsWith('.jpg'))
      .filter((u) => fs.existsSync(onDisk(u)));
    expect(jpgs.length).toBe(SHIPPED_SURFACE_TEXTURES);

    for (const logical of jpgs) {
      const ktx2 = ktx2SiblingPath(onDisk(logical));
      expect(fs.existsSync(ktx2), `${logical}: missing .ktx2 sibling`).toBe(true);
      const buf = fs.readFileSync(ktx2);
      expect(buf.subarray(0, KTX2_MAGIC.length).equals(KTX2_MAGIC), `${ktx2} is not KTX2`).toBe(
        true,
      );
      expect(u32(buf, OFF_PIXEL_WIDTH), `${logical} width`).toBe(1024);
      expect(u32(buf, OFF_PIXEL_HEIGHT), `${logical} height`).toBe(1024);
      // A full 1024 -> 1 mip chain: the runtime never generates mips for a
      // compressed texture, so a single-level file would alias at distance.
      expect(u32(buf, OFF_LEVEL_COUNT), `${logical} mip levels`).toBe(11);
      // The .jpg source is never deleted or replaced.
      expect(fs.existsSync(onDisk(logical)), `${logical} source removed`).toBe(true);
    }
  });

  it('encodes each channel the way classifyStandaloneTexture says: UASTC+zstd for geometry, ETC1S for the rest', () => {
    const jpgs = referencedSurfaceTextures()
      .filter((u) => u.endsWith('.jpg'))
      .filter((u) => fs.existsSync(onDisk(u)));
    const seen = new Set<number>();
    for (const logical of jpgs) {
      const cls = classifyStandaloneTexture(path.basename(logical));
      expect(cls.channel, `${logical}: unrecognized channel suffix`).not.toBeNull();
      const buf = fs.readFileSync(ktx2SiblingPath(onDisk(logical)));
      const scheme = u32(buf, OFF_SUPERCOMPRESSION);
      expect(scheme, `${logical} supercompression`).toBe(
        cls.encoding === 'uastc' ? SS_ZSTD : SS_BASIS_LZ,
      );
      seen.add(scheme);
    }
    // Both arms are actually exercised by the shipped set.
    expect([...seen].sort()).toEqual([SS_BASIS_LZ, SS_ZSTD]);
  });

  it('registers every sibling in the media manifest, so assetUrl resolves the compressed url', () => {
    const jpgs = referencedSurfaceTextures()
      .filter((u) => u.endsWith('.jpg'))
      .filter((u) => fs.existsSync(onDisk(u)));
    for (const logical of jpgs) {
      const ktx2Url = ktx2SiblingUrl(logical);
      expect(MEDIA_ASSETS[ktx2Url], `${ktx2Url} missing from the media manifest`).toBeTruthy();
    }
  });

  it('leaves the six colour layers raw: they are drawImage pack sources for the splat albedo array', () => {
    // buildSplatAlbedoArray drawImages each colour layer into the packed
    // DataArrayTexture; a CompressedTexture's image is a plain descriptor
    // that passes a width check and then throws inside drawImage, which took
    // the renderer down at world build on every splat tier. The packed array
    // is the resident form wherever the colours load, so compressing the
    // pack source bought nothing anyway.
    const colours = terrainColourReferences();
    expect(colours.length).toBe(6);
    for (const logical of colours) {
      expect(fs.existsSync(onDisk(logical)), `${logical} source missing`).toBe(true);
      expect(
        fs.existsSync(ktx2SiblingPath(onDisk(logical))),
        `${logical} must not grow a .ktx2 sibling`,
      ).toBe(false);
      expect(MEDIA_ASSETS[ktx2SiblingUrl(logical)]).toBeUndefined();
    }
    // The route split in prepareTerrainTex: srgb (colour) stays loadTexture,
    // linear jpg goes compressed; and the pack guards drawability instead of
    // width-truthiness.
    const terrain = readSource('src/render/terrain.ts');
    expect(terrain).toContain(".endsWith('.jpg') && !srgb");
    expect(terrain).toContain('isCanvasDrawableImage(raw) ? raw : undefined');
  });

  it('leaves GroundAO_Packed.png raw: a packed DATA texture whose measured stats are shader constants', () => {
    const referenced = referencedSurfaceTextures();
    // Vacuity: the exclusion is only meaningful if terrain.ts really still
    // asks for this file.
    expect(referenced).toContain(PACKED_DATA_TEXTURE);
    expect(referenced.filter((u) => u.endsWith('.png'))).toEqual([PACKED_DATA_TEXTURE]);
    expect(fs.existsSync(onDisk(PACKED_DATA_TEXTURE))).toBe(true);
    expect(
      fs.existsSync(ktx2SiblingPath(onDisk(PACKED_DATA_TEXTURE))),
      'GroundAO_Packed.png must not grow a .ktx2 sibling',
    ).toBe(false);
    expect(MEDIA_ASSETS[`${TERRAIN_DIR}/GroundAO_Packed.ktx2`]).toBeUndefined();
  });

  it('pins the one channel a family does not ship, so the on-disk filter is exercised', () => {
    // worn_stone's metal family sets aoSpan 0 precisely because ambientCG
    // Metal013 ships no AmbientOcclusion map; the derived set must be filtered
    // by disk presence, not blindly required.
    expect(fs.existsSync(onDisk(`${STRUCTURES_DIR}/Metal013_NormalGL.jpg`))).toBe(true);
    expect(fs.existsSync(onDisk(`${STRUCTURES_DIR}/Metal013_AmbientOcclusion.jpg`))).toBe(false);
    expect(wornStoneReferences()).toContain(`${STRUCTURES_DIR}/Metal013_AmbientOcclusion.jpg`);
  });

  it('converts only the referenced pack files: the unused siblings beside them stay raw', () => {
    // Both pack directories ship spare maps no runtime module reads
    // (Bricks076B, Gravel024, the Rock026 Color/NormalGL variants' neighbours).
    // Converting a whole --dir would have shipped those too.
    const referenced = new Set(referencedSurfaceTextures());
    const spares: string[] = [];
    for (const dir of [TERRAIN_DIR, STRUCTURES_DIR]) {
      for (const name of fs.readdirSync(path.join(ROOT, 'public', dir))) {
        if (!name.endsWith('.jpg')) continue;
        const logical = `${dir}/${name}`;
        if (!referenced.has(logical)) spares.push(logical);
      }
    }
    expect(spares.length).toBeGreaterThan(0);
    for (const logical of spares) {
      expect(
        fs.existsSync(ktx2SiblingPath(onDisk(logical))),
        `${logical} is unreferenced and must stay raw`,
      ).toBe(false);
    }
  });
});

describe('surface texture runtime consumers request the compressed sibling', () => {
  it('worn_stone.ts and detail_normals.ts load only through loadKtx2Texture', () => {
    for (const rel of ['src/render/worn_stone.ts', 'src/render/detail_normals.ts']) {
      const src = readSource(rel);
      expect(src, rel).toContain('loadKtx2Texture(ktx2SiblingUrl(');
      expect(src.includes('loadTexture('), `${rel} still calls loadTexture`).toBe(false);
    }
  });

  it('terrain.ts routes jpgs to loadKtx2Texture and keeps the packed png on loadTexture', () => {
    const src = readSource('src/render/terrain.ts');
    expect(src).toContain('loadKtx2Texture(ktx2SiblingUrl(url), { repeat: true })');
    expect(src).toContain('loadTexture(url, { srgb, repeat: true })');
    expect(src).toContain("url.toLowerCase().endsWith('.jpg')");
  });
});

describe('ktx2SiblingUrl (src/render/assets/ktx2_sibling.ts)', () => {
  it('swaps a jpg or png url for its sibling and refuses anything else', () => {
    expect(ktx2SiblingUrl('/textures/terrain/Grass001_Color.jpg')).toBe(
      '/textures/terrain/Grass001_Color.ktx2',
    );
    expect(ktx2SiblingUrl('textures/skins/knight/alt_a.png')).toBe(
      'textures/skins/knight/alt_a.ktx2',
    );
    expect(() => ktx2SiblingUrl('/textures/terrain/Grass001_Color.webp')).toThrow(
      'no ktx2 sibling',
    );
    expect(() => ktx2SiblingUrl('/textures/terrain/Grass001_Color.ktx2')).toThrow(
      'no ktx2 sibling',
    );
  });

  it('agrees with the node-side ktx2SiblingPath the compression script writes', () => {
    const p = '/abs/public/textures/structures/Bark012_NormalGL.jpg';
    expect(ktx2SiblingUrl(p)).toBe(ktx2SiblingPath(p));
  });
});

describe('standalone_texture_compression_core: channel classification', () => {
  it('routes geometry channels to UASTC linear', () => {
    for (const name of [
      'Grass001_NormalGL.jpg',
      'Bricks076A_AmbientOcclusion.jpg',
      'Rock026_Displacement.jpg',
    ]) {
      expect(classifyStandaloneTexture(name), name).toMatchObject({
        encoding: 'uastc',
        transferFunction: 'linear',
      });
    }
  });

  it('routes color maps to ETC1S sRGB and the linear masks to ETC1S linear', () => {
    expect(classifyStandaloneTexture('Grass001_Color.jpg')).toEqual({
      channel: 'Color',
      encoding: 'basis-lz',
      transferFunction: 'srgb',
    });
    expect(classifyStandaloneTexture('Metal013_Roughness.jpg')).toEqual({
      channel: 'Roughness',
      encoding: 'basis-lz',
      transferFunction: 'linear',
    });
    expect(classifyStandaloneTexture('Metal013_Metalness.jpg')).toEqual({
      channel: 'Metalness',
      encoding: 'basis-lz',
      transferFunction: 'linear',
    });
  });

  it('keeps the unsuffixed skin atlases on the original ETC1S sRGB arm', () => {
    for (const name of ['alt_a.png', 'alt_suit_chrome.png', 'fernando.png']) {
      expect(classifyStandaloneTexture(name), name).toEqual({
        channel: null,
        encoding: 'basis-lz',
        transferFunction: 'srgb',
      });
    }
  });

  it('is case-insensitive on the suffix but never invents a channel', () => {
    expect(classifyStandaloneTexture('Foo_normalgl.jpg').encoding).toBe('uastc');
    expect(classifyStandaloneTexture('Foo_Normals.jpg').channel).toBeNull();
    expect(classifyStandaloneTexture('Color.jpg').channel).toBeNull();
  });
});

describe('standalone_texture_compression_core: ktx create arguments', () => {
  const src = 'a.jpg';
  const dst = 'a.ktx2';

  it('UASTC arm: zstd-supercompressed linear R8G8B8, mipmapped', () => {
    expect(
      buildKtxCreateArgs({
        hasAlpha: false,
        srcPath: src,
        dstPath: dst,
        encoding: 'uastc',
        transferFunction: 'linear',
      }),
    ).toEqual([
      'create',
      '--format',
      'R8G8B8_UNORM',
      '--encode',
      'uastc',
      '--uastc-quality',
      '2',
      '--zstd',
      '18',
      '--generate-mipmap',
      '--assign-tf',
      'linear',
      src,
      dst,
    ]);
  });

  it('ETC1S linear arm: no zstd (BasisLZ carries its own supercompression), no primaries', () => {
    const args = buildKtxCreateArgs({
      hasAlpha: false,
      srcPath: src,
      dstPath: dst,
      encoding: 'basis-lz',
      transferFunction: 'linear',
    });
    expect(args).toEqual([
      'create',
      '--format',
      'R8G8B8_UNORM',
      '--encode',
      'basis-lz',
      '--generate-mipmap',
      '--assign-tf',
      'linear',
      src,
      dst,
    ]);
    expect(args).not.toContain('--zstd');
  });

  it('ETC1S sRGB arm is unchanged and stays the default when no classification is passed', () => {
    const explicit = buildKtxCreateArgs({
      hasAlpha: true,
      srcPath: src,
      dstPath: dst,
      encoding: 'basis-lz',
      transferFunction: 'srgb',
    });
    expect(explicit).toEqual([
      'create',
      '--format',
      'R8G8B8A8_SRGB',
      '--encode',
      'basis-lz',
      '--generate-mipmap',
      '--assign-tf',
      'srgb',
      '--assign-primaries',
      'bt709',
      src,
      dst,
    ]);
    expect(buildKtxCreateArgs({ hasAlpha: true, srcPath: src, dstPath: dst })).toEqual(explicit);
    const opaque = buildKtxCreateArgs({ hasAlpha: false, srcPath: src, dstPath: dst });
    expect(opaque[opaque.indexOf('--format') + 1]).toBe('R8G8B8_SRGB');
  });
});

describe('standalone_texture_compression_core: flip, alignment and CLI parsing', () => {
  it('flippedSourcePath slugs the whole source path so two packs cannot collide', () => {
    const a = flippedSourcePath('/p/public/textures/terrain/Rock026_NormalGL.jpg', '/tmp');
    const b = flippedSourcePath('/p/public/textures/structures/Rock026_NormalGL.jpg', '/tmp');
    expect(a).not.toBe(b);
    expect(a.startsWith('/tmp/')).toBe(true);
    expect(a.endsWith('.flip.png')).toBe(true);
    expect(path.basename(a)).not.toContain('/');
    // Name determinism WITHIN a directory is fine and keeps failures legible;
    // isolation comes from the converter passing a private per-run mkdtemp
    // directory, pinned below, not from the name (review round 2).
    expect(flippedSourcePath('/p/public/textures/terrain/Rock026_NormalGL.jpg', '/tmp')).toBe(a);
    const converter = fs.readFileSync(
      path.join(ROOT, 'scripts/assets/compress_standalone_textures.mjs'),
      'utf8',
    );
    expect(converter).toContain("fs.mkdtempSync(path.join(os.tmpdir(), 'woc-flip-')");
    expect(converter).toContain('mode: 0o700');
    expect(converter).toContain('fs.rmSync(stagingDir, { recursive: true, force: true })');
  });

  it('blockAlignmentError accepts multiples of 4 and names what is wrong otherwise', () => {
    expect(blockAlignmentError(1024, 1024)).toBeNull();
    expect(blockAlignmentError(4, 8)).toBeNull();
    expect(blockAlignmentError(1023, 1024)).toContain('1023x1024');
    expect(blockAlignmentError(1024, 1022)).toContain('1024x1022');
    expect(blockAlignmentError(Number.NaN, 1024)).toContain('unreadable');
    expect(blockAlignmentError(0, 0)).toContain('unreadable');
  });

  it('parseArgs understands --flip alongside the existing switches', () => {
    expect(parseArgs([], '/d')).toMatchObject({ dir: '/d', dryRun: false, flip: false, jobs: 4 });
    const opts = parseArgs(['--flip', '--jobs', '2', 'a.jpg', 'b.png'], '/d');
    expect(opts.flip).toBe(true);
    expect(opts.jobs).toBe(2);
    expect(opts.files).toEqual(['a.jpg', 'b.png']);
    expect(parseArgs(['--dry-run'], '/d').flip).toBe(false);
  });

  it('the directory walk gate accepts jpg sources without loosening the base.png carve-out', () => {
    expect(isConvertibleStandaloneImage('Grass001_Color.jpg')).toBe(true);
    expect(isConvertibleStandaloneImage('alt_a.png')).toBe(true);
    expect(isConvertibleStandaloneImage('base.png')).toBe(false);
    expect(isConvertibleStandaloneImage('BASE.PNG')).toBe(false);
    expect(isConvertibleStandaloneImage('Grass001_Color.webp')).toBe(false);
    // The skins-only gate still refuses jpgs, so a --dir sweep of the skins
    // tree cannot silently widen.
    expect(isConvertibleSkinPng('Grass001_Color.jpg')).toBe(false);
  });

  it('ktx2SiblingPath now accepts jpg sources too, and still refuses the rest', () => {
    expect(ktx2SiblingPath('/a/b/Grass001_Color.jpg')).toBe('/a/b/Grass001_Color.ktx2');
    expect(ktx2SiblingPath('/a/b/Grass001_Color.JPG')).toBe('/a/b/Grass001_Color.ktx2');
    expect(ktx2SiblingPath('/a/b/alt_a.png')).toBe('/a/b/alt_a.ktx2');
    expect(() => ktx2SiblingPath('/a/b/alt_a.webp')).toThrow('not a convertible image path');
  });
});

describe('flip invocation pin', () => {
  it('keeps the flip-baked regen command greppable in the pipeline doc', () => {
    // The flip is the one property a regeneration can silently drop: every
    // byte-level assertion above still passes on an unflipped sibling while
    // sampling lands upside down (CompressedTexture cannot honor flipY, and
    // there is no downstream correction). Pin the canonical invocation in the
    // pipeline doc, and the flag itself in the CLI parser.
    const doc = fs.readFileSync(path.join(ROOT, 'scripts/assets/CLAUDE.md'), 'utf8');
    expect(doc).toContain('node scripts/assets/compress_standalone_textures.mjs --flip');
    const core = fs.readFileSync(
      path.join(ROOT, 'scripts/assets/lib/standalone_texture_compression_core.mjs'),
      'utf8',
    );
    expect(core).toContain("'--flip'");
  });
});
