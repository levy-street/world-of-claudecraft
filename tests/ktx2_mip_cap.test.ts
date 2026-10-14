// Pins for src/render/assets/ktx2_mip_cap.ts: the iPhone-only KTX2 mip cap
// that drops the levels above 512 of character-side textures before their first
// upload. Real THREE.CompressedTexture instances in plain Node: the level-drop
// arithmetic, the shared `image` dims, idempotency on clones sharing a Source,
// the root and prefix policy pinned to literals, the phone-class gate, and the
// loader wiring (behavioral through mocked loaders, plus a source-order pin).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  capCompressedMips,
  capGltfKtx2Mips,
  isIosPhoneUserAgent,
  KTX2_MIP_CAP_MAX_DIM,
  KTX2_MIP_CAP_MODEL_ROOTS,
  KTX2_MIP_CAP_TEXTURE_PREFIXES,
  ktx2MipCapFor,
} from '../src/render/assets/ktx2_mip_cap';
import {
  KTX2_MIP_EXEMPT_MODEL_ROOTS,
  KTX2_MIP_RELEASABLE_MODEL_ROOTS,
} from '../src/render/assets/ktx2_mip_release';
import { collectObjectTextures } from '../src/render/material_texture_slots';
import { collectNonResidentTextures } from '../src/render/texture_prep_core';
import { collectPrewarmTextures } from '../src/render/texture_prewarm';
import { stripComments } from './helpers/strip_comments';

const ROOT = path.resolve(__dirname, '..');

// The spoofed identities the gate must tell apart. The iPhone one is the iOS 18
// WKWebView string the native shell sends (no "Safari/" token).
const UA = {
  iphoneApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ipod: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  // iPadOS desktop-class browsing: a Mac user agent, told apart only by touch
  // (gfx.ts maps MacIntel plus touch to the iOS memory profile).
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
} as const;

const PHONE = { iosMemoryProfile: true, iosPhone: true } as const;

interface Level {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A full KTX2-style chain down to 1x1, one buffer per level like KTX2Loader. */
function chain(width: number, height: number): Level[] {
  const levels: Level[] = [];
  let w = width;
  let h = height;
  for (;;) {
    levels.push({ width: w, height: h, data: new Uint8Array(Math.max(16, (w * h) / 2)) });
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return levels;
}

function compressed(width: number, height = width): THREE.CompressedTexture {
  return new THREE.CompressedTexture(
    chain(width, height) as unknown as ImageData[],
    width,
    height,
    THREE.RGBA_ASTC_4x4_Format,
  );
}

const mipsOf = (tex: THREE.Texture): Level[] => tex.mipmaps as unknown as Level[];
const dimsOf = (tex: THREE.Texture): [number, number] => {
  const image = tex.image as { width: number; height: number };
  return [image.width, image.height];
};

describe('capCompressedMips: level-drop arithmetic', () => {
  it('keeps 10 of the 11 levels of a 1024 chain, from its 512 level down', () => {
    const tex = compressed(1024);
    const original = [...mipsOf(tex)];
    expect(original).toHaveLength(11);
    expect(capCompressedMips(tex, 512)).toBe(true);
    const kept = mipsOf(tex);
    expect(kept).toHaveLength(10);
    // The surviving entries are the SAME level objects (no re-transcode, no copy).
    for (const [i, level] of kept.entries()) expect(level).toBe(original[i + 1]);
    expect([kept[0]?.width, kept[0]?.height]).toEqual([512, 512]);
    expect([kept[9]?.width, kept[9]?.height]).toEqual([1, 1]);
  });

  it('keeps 10 of the 13 levels of a 4096 chain', () => {
    const tex = compressed(4096);
    expect(mipsOf(tex)).toHaveLength(13);
    expect(capCompressedMips(tex, 512)).toBe(true);
    expect(mipsOf(tex)).toHaveLength(10);
    expect(mipsOf(tex)[0]?.width).toBe(512);
  });

  it('caps the LONGER side of a non-square chain: 2048x1024 becomes 512x256', () => {
    const tex = compressed(2048, 1024);
    expect(mipsOf(tex)).toHaveLength(12);
    expect(capCompressedMips(tex, 512)).toBe(true);
    expect(mipsOf(tex)).toHaveLength(10);
    expect([mipsOf(tex)[0]?.width, mipsOf(tex)[0]?.height]).toEqual([512, 256]);
    expect(dimsOf(tex)).toEqual([512, 256]);
  });

  it('leaves a chain already at or under the cap untouched', () => {
    for (const size of [512, 256, 64]) {
      const tex = compressed(size);
      const array = tex.mipmaps;
      const before = [...mipsOf(tex)];
      expect(capCompressedMips(tex, 512), `${size}`).toBe(false);
      expect(tex.mipmaps).toBe(array);
      expect(mipsOf(tex)).toEqual(before);
      expect(dimsOf(tex)).toEqual([size, size]);
    }
  });

  it('never drops the last level: a single-level 1024 texture stays as it is', () => {
    const level = { width: 1024, height: 1024, data: new Uint8Array(16) };
    const tex = new THREE.CompressedTexture(
      [level] as unknown as ImageData[],
      1024,
      1024,
      THREE.RGBA_ASTC_4x4_Format,
    );
    expect(capCompressedMips(tex, 512)).toBe(false);
    expect(mipsOf(tex)).toEqual([level]);
    expect(dimsOf(tex)).toEqual([1024, 1024]);
  });

  it('keeps one level when every level exceeds the cap', () => {
    const tex = new THREE.CompressedTexture(
      [
        { width: 2048, height: 2048, data: new Uint8Array(16) },
        { width: 1024, height: 1024, data: new Uint8Array(16) },
      ] as unknown as ImageData[],
      2048,
      2048,
      THREE.RGBA_ASTC_4x4_Format,
    );
    expect(capCompressedMips(tex, 512)).toBe(true);
    expect(mipsOf(tex).map((l) => l.width)).toEqual([1024]);
    expect(dimsOf(tex)).toEqual([1024, 1024]);
  });

  it('trims the level array IN PLACE, so no other holder of it keeps the dropped levels', () => {
    const tex = compressed(1024);
    const array = tex.mipmaps;
    capCompressedMips(tex, 512);
    expect(tex.mipmaps).toBe(array);
    expect((array as unknown as Level[])[0]?.width).toBe(512);
  });

  it('pins the shipped cap to 512', () => {
    expect(KTX2_MIP_CAP_MAX_DIM).toBe(512);
  });
});

describe('capCompressedMips: image dims and shared sources', () => {
  it('updates the image dims three sizes the upload from', () => {
    const tex = compressed(1024);
    capCompressedMips(tex, 512);
    expect(dimsOf(tex)).toEqual([512, 512]);
    // The image IS the shared Source data: the dims live there, not on a copy.
    expect(tex.source.data).toBe(tex.image);
    expect((tex.source.data as { width: number }).width).toBe(512);
  });

  it('trims every clone sharing a Source, and is idempotent on each', () => {
    const tex = compressed(1024);
    const clone = tex.clone();
    // What GLTFLoader relies on (a texture sharing an image source is a clone):
    // one Source, but each texture its own level array.
    expect(clone.source).toBe(tex.source);
    expect(clone.mipmaps).not.toBe(tex.mipmaps);
    expect(capCompressedMips(tex, 512)).toBe(true);
    // The shared image already says 512, but the clone's own array does not:
    // the idempotency check reads the array, never the image.
    expect(dimsOf(clone)).toEqual([512, 512]);
    expect(mipsOf(clone)[0]?.width).toBe(1024);
    expect(capCompressedMips(clone, 512)).toBe(true);
    expect(mipsOf(clone)[0]?.width).toBe(512);
    expect(mipsOf(clone)[0]).toBe(mipsOf(tex)[0]);
    expect(capCompressedMips(tex, 512)).toBe(false);
    expect(capCompressedMips(clone, 512)).toBe(false);
    expect(mipsOf(tex)).toHaveLength(10);
    expect(mipsOf(clone)).toHaveLength(10);
    expect(dimsOf(tex)).toEqual([512, 512]);
  });

  it('leaves non-KTX2 and container textures alone', () => {
    // A decoded image texture (a GLB-embedded WebP, a weapon-skin image).
    const plain = new THREE.Texture({ width: 1024, height: 1024 } as unknown as HTMLImageElement);
    expect(capCompressedMips(plain, 512)).toBe(false);
    expect(dimsOf(plain)).toEqual([1024, 1024]);
    // A raw RGBA surface (the stubble and makeup decals), even with levels.
    const data = new THREE.DataTexture(new Uint8Array(1024 * 1024 * 4), 1024, 1024);
    data.mipmaps = chain(1024, 1024) as unknown as ImageData[];
    expect(capCompressedMips(data, 512)).toBe(false);
    expect(mipsOf(data)).toHaveLength(11);
    // Array and cube containers are outside the 2D contract this module knows.
    const array = new THREE.CompressedArrayTexture(
      chain(1024, 1024) as unknown as ImageData[],
      1024,
      1024,
      2,
      THREE.RGBA_ASTC_4x4_Format,
    );
    expect(capCompressedMips(array, 512)).toBe(false);
    expect(mipsOf(array)).toHaveLength(11);
    const faces = Array.from({ length: 6 }, () => ({ width: 1024, height: 1024 }));
    const cube = new THREE.CompressedCubeTexture(
      faces as unknown as THREE.CompressedTexture[],
      THREE.RGBA_ASTC_4x4_Format,
    );
    cube.mipmaps = chain(1024, 1024) as unknown as ImageData[];
    expect(capCompressedMips(cube, 512)).toBe(false);
    expect(mipsOf(cube)).toHaveLength(11);
    // Malformed shapes fail soft.
    expect(capCompressedMips(null, 512)).toBe(false);
    expect(capCompressedMips({ isCompressedTexture: true }, 512)).toBe(false);
    expect(
      capCompressedMips({ isCompressedTexture: true, mipmaps: [{ width: 1024 }, {}] }, 512),
    ).toBe(false);
  });
});

describe('capGltfKtx2Mips: the parsed-GLB walk', () => {
  function material(maps: Partial<Record<string, THREE.Texture>>): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial();
    Object.assign(mat, maps);
    return mat;
  }

  it('trims every compressed map of every material, clones included, and nothing else', () => {
    const albedo = compressed(1024);
    const albedoClone = albedo.clone(); // same image, other sampler
    const normal = compressed(2048);
    const specular = compressed(1024); // KHR_materials_specular lands off the basic slots
    const small = compressed(512);
    const decoded = new THREE.Texture({ width: 1024, height: 1024 } as unknown as HTMLImageElement);
    const scene = new THREE.Group();
    scene.add(
      new THREE.Mesh(new THREE.BufferGeometry(), material({ map: albedo, normalMap: normal })),
    );
    const multi = new THREE.Mesh(new THREE.BufferGeometry(), [
      material({ map: albedoClone, emissiveMap: decoded }),
      material({ map: small }),
    ]);
    const physical = new THREE.MeshPhysicalMaterial();
    physical.specularIntensityMap = specular;
    scene.add(multi, new THREE.Mesh(new THREE.BufferGeometry(), physical));

    expect(capGltfKtx2Mips({ scene }, 512)).toBe(4);
    for (const tex of [albedo, albedoClone, normal, specular]) {
      expect(mipsOf(tex)[0]?.width).toBe(512);
    }
    expect(mipsOf(small)).toHaveLength(10);
    expect(dimsOf(decoded)).toEqual([1024, 1024]);
    // A second walk (a second consumer, a re-entry) finds nothing to do.
    expect(capGltfKtx2Mips({ scene }, 512)).toBe(0);
  });

  it('leaves a texture only the GLTF cache holds whole, and no upload path can reach it', () => {
    // GLTFLoader keeps the pre-clone original of a KHR_texture_transform (or
    // shared-source) clone in its own cache while the material holds the
    // clone. The walk stays on the scene graph, so that original keeps its
    // chain; it is safe because every upload path enumerates textures from
    // the scene graph's materials, and no material references it.
    const original = compressed(1024);
    const onBody = original.clone();
    const onTrim = original.clone();
    onTrim.channel = 1;
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material({ map: onBody })));
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material({ normalMap: onTrim })));
    // What a loaded GLB carries besides its scene is never walked.
    const gltf = { scene, cache: { original } };
    const originalLevels = [...mipsOf(original)];

    expect(capGltfKtx2Mips(gltf, 512)).toBe(2);
    expect(mipsOf(original)).toEqual(originalLevels);
    expect(mipsOf(original)[0]?.width).toBe(1024);

    // Every GL path finds its textures by walking the scene graph's materials:
    // the boot and gate collection, the secondary contexts' prewarm, and the
    // gate's upload lane. The original is in none of them, and every texture
    // they do hand to a context has its level array and the shared image in
    // agreement.
    const uploadable = new Set<THREE.Texture>(collectObjectTextures(scene, false));
    collectPrewarmTextures(scene, uploadable);
    const lane = collectNonResidentTextures({ get: () => undefined }, scene) as THREE.Texture[];
    for (const tex of lane) uploadable.add(tex);
    expect([...uploadable].sort((a, b) => a.id - b.id)).toEqual(
      [onBody, onTrim].sort((a, b) => a.id - b.id),
    );
    expect(uploadable.has(original)).toBe(false);
    for (const tex of uploadable) {
      const top = mipsOf(tex)[0];
      expect([top?.width, top?.height]).toEqual(dimsOf(tex));
      expect(dimsOf(tex)).toEqual([512, 512]);
    }
  });

  it('never reads the GLTF parser, so it survives a loader that drops it', () => {
    // A loaded GLB may reach its consumers without the parser; the same read
    // shapes a parser-free loader bans are pinned out of this module here.
    const code = stripComments(
      fs.readFileSync(path.join(ROOT, 'src/render/assets/ktx2_mip_cap.ts'), 'utf8'),
    );
    for (const pattern of [
      /\.\s*parser\b/,
      /\[\s*['"`]parser['"`]\s*\]/,
      /\{[^{}]*\bparser\b[^{}]*\}\s*=/,
      /\bgetDependenc(?:y|ies)\s*\(/,
      /\.\s*associations\b/,
    ]) {
      expect(pattern.test(code), String(pattern)).toBe(false);
    }
  });

  it('fails soft on partial GLTF shapes', () => {
    expect(capGltfKtx2Mips({}, 512)).toBe(0);
    expect(capGltfKtx2Mips({ scene: {} }, 512)).toBe(0);
    expect(capGltfKtx2Mips({ scene: new THREE.Group() }, 512)).toBe(0);
  });
});

describe('policy: which textures, on which devices', () => {
  it('pins the capped roots and prefixes to literals', () => {
    // Moving a root in or out is a conscious, visible trade on the phone: the
    // membership is written out, not derived.
    expect([...KTX2_MIP_CAP_MODEL_ROOTS]).toEqual(['chars', 'creatures', 'mounts', 'weapons']);
    expect([...KTX2_MIP_CAP_TEXTURE_PREFIXES]).toEqual(['textures/skins/']);
  });

  it('caps only roots whose CPU mips are never released', () => {
    // A released texture restores by re-transcoding its source into the FULL
    // chain; a capped root must never be one ktx2_mip_release.ts can release.
    for (const root of KTX2_MIP_CAP_MODEL_ROOTS) {
      expect(KTX2_MIP_EXEMPT_MODEL_ROOTS, root).toContain(root);
      expect(KTX2_MIP_RELEASABLE_MODEL_ROOTS, root).not.toContain(root);
    }
  });

  it('answers 512 for the capped roots and the skin atlases on the iPhone profile', () => {
    for (const root of KTX2_MIP_CAP_MODEL_ROOTS) {
      expect(ktx2MipCapFor(`models/${root}/x.glb`, PHONE), root).toBe(512);
      expect(ktx2MipCapFor(`/media/models/${root}/x.0123456789ab.glb`, PHONE), root).toBe(512);
      expect(ktx2MipCapFor(`capacitor://localhost/models/${root}/x.glb`, PHONE), root).toBe(512);
    }
    expect(ktx2MipCapFor('models/chars/enemies/necromancer.glb', PHONE)).toBe(512);
    expect(ktx2MipCapFor('textures/skins/knight/alt_a.ktx2', PHONE)).toBe(512);
    expect(ktx2MipCapFor('/media/textures/skins/barbarian/alt_a.917430e577be.ktx2', PHONE)).toBe(
      512,
    );
  });

  it('leaves every other root and texture at full resolution, even on the iPhone', () => {
    const others = [
      ...KTX2_MIP_RELEASABLE_MODEL_ROOTS.map((root) => `models/${root}/x.glb`),
      'models/tools/pickaxe.glb',
      'models/vfx/fragment.glb',
      'models/futuredir/x.glb',
      '/env/vale_day_2k.ktx2',
      'textures/terrain/grass.ktx2',
      'textures/skins_extra/x.ktx2',
      'models/mech/skins/red.png',
    ];
    for (const url of others) expect(ktx2MipCapFor(url, PHONE), url).toBeNull();
  });

  it('is off unless BOTH the iOS memory profile and a phone-class device hold', () => {
    const url = 'models/chars/x.glb';
    expect(ktx2MipCapFor(url, { iosMemoryProfile: true, iosPhone: false })).toBeNull();
    expect(ktx2MipCapFor(url, { iosMemoryProfile: false, iosPhone: true })).toBeNull();
    expect(ktx2MipCapFor(url, { iosMemoryProfile: false, iosPhone: false })).toBeNull();
  });

  it('calls a device a phone only for an iPhone or iPod user agent', () => {
    expect(isIosPhoneUserAgent(UA.iphoneApp)).toBe(true);
    expect(isIosPhoneUserAgent(UA.iphoneSafari)).toBe(true);
    expect(isIosPhoneUserAgent(UA.ipod)).toBe(true);
    expect(isIosPhoneUserAgent(UA.ipad)).toBe(false);
    expect(isIosPhoneUserAgent(UA.ipadDesktop)).toBe(false);
    expect(isIosPhoneUserAgent(UA.android)).toBe(false);
    expect(isIosPhoneUserAgent(UA.desktop)).toBe(false);
    expect(isIosPhoneUserAgent(undefined)).toBe(false);
    expect(isIosPhoneUserAgent('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Loader wiring, behavioral: the real loader.ts with the user agent stubbed
// before its module graph evaluates (the gate settles once at load, exactly as
// GFX.iosMemoryProfile does), the loaders mocked to hand back real textures.

interface Device {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}
const DEVICES: Record<'iphone' | 'ipad' | 'ipadDesktop' | 'android' | 'desktop', Device> = {
  iphone: { userAgent: UA.iphoneApp, platform: 'iPhone', maxTouchPoints: 5 },
  ipad: { userAgent: UA.ipad, platform: 'iPad', maxTouchPoints: 5 },
  ipadDesktop: { userAgent: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 },
  android: { userAgent: UA.android, platform: 'Linux armv8l', maxTouchPoints: 5 },
  desktop: { userAgent: UA.desktop, platform: 'Linux x86_64', maxTouchPoints: 0 },
};

interface LoaderUnderTest {
  loadGltf: (url: string) => Promise<unknown>;
  loadKtx2Texture: (url: string) => Promise<THREE.CompressedTexture>;
  classifiedTopWidth: (number | undefined)[];
  dismissedTopWidth: (number | undefined)[];
  iosMemoryProfile: boolean;
}

async function loaderOn(
  device: Device,
  gltfFor: () => unknown,
  ktx2For: () => THREE.CompressedTexture,
): Promise<LoaderUnderTest> {
  vi.resetModules();
  vi.stubGlobal('navigator', { ...device, hardwareConcurrency: 4 });
  const classifiedTopWidth: (number | undefined)[] = [];
  const dismissedTopWidth: (number | undefined)[] = [];
  vi.doMock('three/addons/loaders/GLTFLoader.js', () => ({
    GLTFLoader: class {
      setMeshoptDecoder(): void {}
      setKTX2Loader(): void {}
      load(_url: string, onLoad: (g: unknown) => void): void {
        onLoad(gltfFor());
      }
    },
  }));
  vi.doMock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: {} }));
  vi.doMock('../src/render/assets/ktx2_support', () => ({
    ktx2Loader: () => ({
      load: (_url: string, onLoad: (t: unknown) => void) => onLoad(ktx2For()),
    }),
  }));
  // Records what classification SEES, so the order (cap first) is proven by
  // behavior, not only by source position.
  vi.doMock('../src/render/assets/ktx2_mip_release', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/render/assets/ktx2_mip_release')>();
    return {
      ...actual,
      classifyGltfKtx2Textures: (gltf: { scene: THREE.Object3D }, url: string) => {
        gltf.scene.traverse((o) => {
          const map = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined)?.map;
          if (map) classifiedTopWidth.push(mipsOf(map)[0]?.width);
        });
        actual.classifyGltfKtx2Textures(gltf, url);
      },
      dismissKtx2Source: (tex: THREE.Texture) => {
        dismissedTopWidth.push(mipsOf(tex)[0]?.width);
        actual.dismissKtx2Source(tex);
      },
    };
  });
  const loader = await import('../src/render/assets/loader');
  const { GFX } = await import('../src/render/gfx');
  return {
    loadGltf: loader.loadGltf,
    loadKtx2Texture: loader.loadKtx2Texture,
    classifiedTopWidth,
    dismissedTopWidth,
    iosMemoryProfile: GFX.iosMemoryProfile,
  };
}

function gltfWith(tex: THREE.Texture): { scene: THREE.Group } {
  const scene = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  mat.map = tex;
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), mat));
  return { scene };
}

describe('loader wiring (behavioral)', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('three/addons/loaders/GLTFLoader.js');
    vi.doUnmock('three/addons/libs/meshopt_decoder.module.js');
    vi.doUnmock('../src/render/assets/ktx2_support');
    vi.doUnmock('../src/render/assets/ktx2_mip_release');
    vi.resetModules();
  });

  it('on an iPhone: caps a character GLB before classification and a skin atlas before dismissal', async () => {
    let glbTex = compressed(1024);
    let atlas = compressed(1024);
    const l = await loaderOn(
      DEVICES.iphone,
      () => gltfWith(glbTex),
      () => atlas,
    );
    expect(l.iosMemoryProfile).toBe(true);

    await l.loadGltf('models/chars/humans/knight.glb');
    expect(mipsOf(glbTex)[0]?.width).toBe(512);
    expect(dimsOf(glbTex)).toEqual([512, 512]);
    expect(l.classifiedTopWidth).toEqual([512]);

    const loadedAtlas = await l.loadKtx2Texture('textures/skins/knight/alt_a.ktx2');
    expect(loadedAtlas).toBe(atlas);
    expect(mipsOf(atlas)[0]?.width).toBe(512);
    expect(l.dismissedTopWidth).toEqual([512]);

    // Other roots and standalone textures keep their full chain on the phone.
    glbTex = compressed(1024);
    await l.loadGltf('models/props/crate.glb');
    expect(mipsOf(glbTex)[0]?.width).toBe(1024);
    atlas = compressed(1024);
    await l.loadKtx2Texture('/env/vale_day_2k.ktx2');
    expect(mipsOf(atlas)[0]?.width).toBe(1024);
  });

  it.each([
    ['iPad', DEVICES.ipad, true],
    ['iPadOS desktop-class', DEVICES.ipadDesktop, true],
    ['Android', DEVICES.android, false],
    ['desktop', DEVICES.desktop, false],
  ] as const)(
    'on %s: every texture reaches classification byte-identical',
    async (_label, device, ios) => {
      const glbTex = compressed(1024);
      const atlas = compressed(1024);
      const glbLevels = [...mipsOf(glbTex)];
      const atlasLevels = [...mipsOf(atlas)];
      const glbArray = glbTex.mipmaps;
      const l = await loaderOn(
        device,
        () => gltfWith(glbTex),
        () => atlas,
      );
      // The iPads really are on the iOS memory profile: only the phone sub-gate
      // keeps them out, which is what this case pins.
      expect(l.iosMemoryProfile).toBe(ios);
      await l.loadGltf('models/chars/humans/knight.glb');
      await l.loadKtx2Texture('textures/skins/knight/alt_a.ktx2');
      expect(glbTex.mipmaps).toBe(glbArray);
      expect(mipsOf(glbTex)).toHaveLength(glbLevels.length);
      for (const [i, level] of mipsOf(glbTex).entries()) expect(level).toBe(glbLevels[i]);
      for (const [i, level] of mipsOf(atlas).entries()) expect(level).toBe(atlasLevels[i]);
      expect(dimsOf(glbTex)).toEqual([1024, 1024]);
      expect(dimsOf(atlas)).toEqual([1024, 1024]);
      expect(l.classifiedTopWidth).toEqual([1024]);
      expect(l.dismissedTopWidth).toEqual([1024]);
    },
  );
});

describe('loader wiring (source order pin, anchor style per docs/qa-gate.md)', () => {
  const loaderSrc = stripComments(
    fs.readFileSync(path.join(ROOT, 'src/render/assets/loader.ts'), 'utf8'),
  );
  const block = (anchor: string, until: string): string => {
    const start = loaderSrc.indexOf(anchor);
    expect(start, anchor).toBeGreaterThanOrEqual(0);
    const end = loaderSrc.indexOf(until, start + anchor.length);
    expect(end, until).toBeGreaterThan(start);
    return loaderSrc.slice(start, end);
  };

  it('caps a parsed GLB in its resolve chain, after the polish and before classification', () => {
    const chainSrc = block('export function loadGltf(', 'export function releaseGltf(');
    const neutralize = chainSrc.indexOf('neutralizeGltfTransmission(gltf);');
    const cap = chainSrc.indexOf('capGltfKtx2Mips(gltf, ');
    const classify = chainSrc.indexOf('classifyGltfKtx2Textures(gltf, resolved);');
    expect(cap).toBeGreaterThan(neutralize);
    expect(classify).toBeGreaterThan(cap);
    expect(chainSrc).toContain('ktx2MipCapFor(resolved, ktx2MipCapProfile)');
  });

  it('caps a standalone KTX2 in its resolve chain, before the source dismissal', () => {
    const chainSrc = block(
      'export function loadKtx2Texture(',
      'export function releaseKtx2Texture(',
    );
    const cap = chainSrc.indexOf('capCompressedMips(tex, ');
    const dismiss = chainSrc.indexOf('dismissKtx2Source(tex);');
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(dismiss).toBeGreaterThan(cap);
    expect(chainSrc).toContain('ktx2MipCapFor(resolved, ktx2MipCapProfile)');
  });

  it('settles the gate once, at module load, from the iOS profile and the user agent', () => {
    const decl = block('const ktx2MipCapProfile', ';\n');
    expect(decl).toContain('iosMemoryProfile: GFX.iosMemoryProfile');
    expect(decl).toContain('isIosPhoneUserAgent(');
    expect(decl).toContain('navigator.userAgent');
  });
});
