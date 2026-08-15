// Guard + behavioral coverage for the standalone skin-atlas KTX2 conversion
// (scripts/assets/compress_standalone_textures.mjs) and its runtime consumer,
// loadKtx2Texture (src/render/assets/loader.ts) via loadSkinTexInto
// (src/render/characters/assets.ts).
//
// loadTexture()'s standalone-image path had no compressed-texture equivalent:
// every one of the ~34 1024x1024 player skin atlases under
// public/textures/skins/ decoded to a full RGBA bitmap, well over 100 MB on
// its own (see the eagerSkinAtlases comment in
// src/render/characters/assets.ts). This suite pins that every atlas
// SKINS/SKIN_EMISSIVE actually load has a real, valid `.ktx2` sibling on
// disk, that the compression script's file-selection logic matches what is
// actually shipped, and that the runtime loader really requests the
// compressed sibling instead of the PNG.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildKtxCreateArgs,
  isConvertibleSkinPng,
  ktx2SiblingPath,
} from '../scripts/assets/lib/standalone_texture_compression_core.mjs';
import { MAX_LOAD_ATTEMPTS } from '../src/render/assets/load_retry';
import { SKIN_EMISSIVE, SKINS, SKINS_DIR } from '../src/render/characters/manifest';

const ROOT = path.resolve(__dirname, '..');
const SKIN_TEX_DIR = path.join(ROOT, 'public', SKINS_DIR);
// The KTX2 file identifier (KTX-Software's own `ktx create` header): U+00AB
// "KTX 20" U+00BB CR LF SUB LF, 12 bytes.
const KTX2_MAGIC = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function* walkPngs(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkPngs(p);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) yield p;
  }
}

describe('standalone skin atlas KTX2 compression (shipped assets)', () => {
  it('ships a valid KTX2 sibling for every atlas SKINS/SKIN_EMISSIVE actually load', () => {
    const referenced = new Set<string>();
    for (const list of Object.values(SKINS)) {
      for (const u of list) if (u?.startsWith(`${SKINS_DIR}/`)) referenced.add(u);
    }
    for (const list of Object.values(SKIN_EMISSIVE)) {
      for (const u of list) if (u?.startsWith(`${SKINS_DIR}/`)) referenced.add(u);
    }
    // Tight vacuity floor (tests/CLAUDE.md): the exact count the source
    // comments cite, so a dropped or renamed entry cannot hide silently.
    expect(referenced.size).toBe(34);

    for (const url of referenced) {
      const pngPath = path.join(ROOT, 'public', url);
      expect(fs.existsSync(pngPath), `${url} missing from disk`).toBe(true);
      const ktx2Path = ktx2SiblingPath(pngPath);
      expect(fs.existsSync(ktx2Path), `${url}: missing .ktx2 sibling`).toBe(true);
      const header = fs.readFileSync(ktx2Path).subarray(0, KTX2_MAGIC.length);
      expect(header.equals(KTX2_MAGIC), `${ktx2Path} is not a valid KTX2 file`).toBe(true);
    }
  });

  it('converts every PNG under textures/skins/ except base.png, the unused thumbnail source', () => {
    const files = [...walkPngs(SKIN_TEX_DIR)];
    const convertible = files.filter((f) => isConvertibleSkinPng(path.basename(f)));
    const skipped = files.filter((f) => !isConvertibleSkinPng(path.basename(f)));
    // Vacuity: base.png really exists in the tree (one per class dir), so the
    // skip rule is actually exercised, not vacuously true over an empty set.
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((f) => path.basename(f) === 'base.png')).toBe(true);
    expect(convertible.length).toBe(34);

    for (const f of convertible) {
      expect(fs.existsSync(ktx2SiblingPath(f)), f).toBe(true);
    }
    // base.png must never grow a stray .ktx2 sibling: nothing loads it.
    for (const f of skipped) {
      expect(fs.existsSync(ktx2SiblingPath(f)), `${f} has an unexpected .ktx2 sibling`).toBe(false);
    }
  });

  it('the .png source survives conversion (never replaced): fernando.png stays real', () => {
    // visual_manifest.test.ts pins this exact raw path for the Bursar
    // Fernando easter egg; the compression script must never delete it.
    const atlas = SKINS.npc_fernando?.[0];
    expect(atlas).toBe('textures/skins/rogue/fernando.png');
    expect(fs.existsSync(path.join(ROOT, 'public', atlas as string))).toBe(true);
  });
});

describe('standalone_texture_compression_core (pure logic)', () => {
  it('buildKtxCreateArgs: sRGB Basis-LZ, mipmapped, alpha-aware format selection', () => {
    expect(buildKtxCreateArgs({ hasAlpha: true, srcPath: 'a.png', dstPath: 'a.ktx2' })).toEqual([
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
      'a.png',
      'a.ktx2',
    ]);
    const noAlpha = buildKtxCreateArgs({ hasAlpha: false, srcPath: 'a.png', dstPath: 'a.ktx2' });
    expect(noAlpha[noAlpha.indexOf('--format') + 1]).toBe('R8G8B8_SRGB');
  });

  it('ktx2SiblingPath swaps the extension without touching the rest of the path', () => {
    expect(ktx2SiblingPath('/a/b/alt_a.png')).toBe('/a/b/alt_a.ktx2');
    expect(() => ktx2SiblingPath('/a/b/alt_a.PNG')).not.toThrow();
    expect(() => ktx2SiblingPath('/a/b/alt_a.webp')).toThrow();
  });

  it('isConvertibleSkinPng excludes only base.png', () => {
    expect(isConvertibleSkinPng('alt_a.png')).toBe(true);
    expect(isConvertibleSkinPng('fernando.png')).toBe(true);
    expect(isConvertibleSkinPng('base.png')).toBe(false);
    expect(isConvertibleSkinPng('base.PNG')).toBe(false);
    expect(isConvertibleSkinPng('alt_a.webp')).toBe(false);
  });
});

describe('loadKtx2Texture (src/render/assets/loader.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('memoizes: a second call for the same url reuses the exact same promise/result', async () => {
    let calls = 0;
    const fakeTex = { isCompressedTexture: true };
    vi.doMock('../src/render/assets/ktx2_support', () => ({
      ktx2Loader: () => ({
        load: (_url: string, onLoad: (t: unknown) => void) => {
          calls++;
          onLoad(fakeTex);
        },
      }),
    }));
    const { loadKtx2Texture } = await import('../src/render/assets/loader');
    const a = await loadKtx2Texture('textures/skins/knight/alt_a.ktx2');
    const b = await loadKtx2Texture('textures/skins/knight/alt_a.ktx2');
    expect(a).toBe(fakeTex);
    expect(b).toBe(a);
    expect(calls).toBe(1);
  });

  it('retries a transient failure before resolving, following the same backoff loadGltf uses', async () => {
    let calls = 0;
    const fakeTex = { isCompressedTexture: true };
    vi.doMock('../src/render/assets/ktx2_support', () => ({
      ktx2Loader: () => ({
        load: (
          _url: string,
          onLoad: (t: unknown) => void,
          _onProgress: unknown,
          onError: () => void,
        ) => {
          calls++;
          if (calls < MAX_LOAD_ATTEMPTS) onError();
          else onLoad(fakeTex);
        },
      }),
    }));
    const { loadKtx2Texture } = await import('../src/render/assets/loader');
    const result = await loadKtx2Texture('textures/skins/knight/alt_a.ktx2');
    expect(result).toBe(fakeTex);
    expect(calls).toBe(MAX_LOAD_ATTEMPTS);
  });

  it('rejects once every attempt fails', async () => {
    vi.doMock('../src/render/assets/ktx2_support', () => ({
      ktx2Loader: () => ({
        load: (_url: string, _onLoad: unknown, _onProgress: unknown, onError: () => void) =>
          onError(),
      }),
    }));
    const { loadKtx2Texture } = await import('../src/render/assets/loader');
    await expect(loadKtx2Texture('textures/skins/knight/alt_a.ktx2')).rejects.toThrow(
      'ktx2 texture load failed',
    );
  });
});

describe('loadSkinTexInto routes textures/skins/ atlases through the KTX2 loader', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('boot-loads every eager skin atlas via loadKtx2Texture with a .ktx2 url, never via loadTexture', async () => {
    const ktx2Calls: string[] = [];
    const textureCalls: string[] = [];
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => new Promise(() => undefined)),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadTexture: vi.fn((url: string) => {
        textureCalls.push(url);
        return Promise.resolve(new THREE.Texture());
      }),
      loadKtx2Texture: vi.fn((url: string) => {
        ktx2Calls.push(url);
        return Promise.resolve(new THREE.Texture());
      }),
      releaseGltf: vi.fn(),
    }));

    await import('../src/render/characters/assets');
    // The boot sweep is registerPreload(loadSkinTexInto(...)): loadSkinTexInto
    // itself calls the (synchronous, already-called-by-now) loader eagerly at
    // import; flush one microtask turn so every mocked promise settles.
    await Promise.resolve();
    await Promise.resolve();

    // Matches the "34 skin atlases" boot-sweep count pinned above: the mech
    // chromas are lazyPreload and never reach this eager sweep.
    expect(ktx2Calls.length).toBe(34);
    for (const url of ktx2Calls) {
      expect(url.startsWith(`${SKINS_DIR}/`), url).toBe(true);
      expect(url.endsWith('.ktx2'), url).toBe(true);
    }
    expect(textureCalls.length).toBe(0);
  });
});
