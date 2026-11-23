// The Warrior kit's image sheets decode off the main thread
// (loadBitmapTexture, src/render/assets/loader.ts), and the texture a real
// WebGL driver holds must be the one the image-element path uploaded: same
// orientation, same unpremultiplied alpha, same colour bytes, same mip chain.
// Both arms run the production kit load (ensureWarriorKitAssets): the image
// arm with createImageBitmap removed, which is also the fallback a browser
// without it takes. Every sheet is uploaded by three and read back texel for
// texel, at level 0 and at a generated mip level.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/render/assets/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/assets/loader')>();
  const THREE = await import('three');
  return {
    ...actual,
    // The KTX2 sheets and the fragment GLB keep their own path; only the
    // image sheets are compared here.
    loadKtx2Texture: async () => new THREE.Texture(),
    loadGltf: async () => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry());
      return {
        scene: {
          updateMatrixWorld(): void {},
          getObjectByName: (name: string) => Object.assign(mesh, { name }),
        },
      };
    },
    releaseGltf: () => {},
  };
});

import { contactAssetInternalsForTest } from '../../src/render/ability_vfx/contact_assets';
import {
  BAKED_URLS,
  type BakedKind,
  bakedTexture,
  ensureWarriorKitAssets,
  productionAssetInternalsForTest,
  warriorBloodTexture,
  warriorPressureTexture,
  warriorRockTexture,
  warriorSteelTexture,
} from '../../src/render/ability_vfx/production_assets';
import { bitmapSheetReleased } from '../../src/render/assets/bitmap_sheet_release';

type Sheets = Map<string, THREE.Texture>;

async function loadKit(): Promise<Sheets> {
  productionAssetInternalsForTest.reset();
  contactAssetInternalsForTest.reset();
  await ensureWarriorKitAssets(false);
  const sheets: Sheets = new Map();
  for (const kind of Object.keys(BAKED_URLS) as BakedKind[]) {
    if (BAKED_URLS[kind].endsWith('.ktx2')) continue;
    const texture = bakedTexture(kind);
    if (texture) sheets.set(kind, texture);
  }
  for (const [name, texture] of [
    ['pressure', warriorPressureTexture()],
    ['blood', warriorBloodTexture()],
    ['steel', warriorSteelTexture()],
    ['rock', warriorRockTexture()],
  ] as const) {
    if (texture) sheets.set(name, texture);
  }
  return sheets;
}

let renderer: THREE.WebGLRenderer | null = null;
afterEach(() => {
  vi.unstubAllGlobals();
  renderer?.dispose();
  renderer = null;
  productionAssetInternalsForTest.reset();
  contactAssetInternalsForTest.reset();
});

function readLevel(texture: THREE.Texture, level: number): { width: number; bytes: Uint8Array } {
  const webgl = renderer as THREE.WebGLRenderer;
  webgl.initTexture(texture);
  const gl = webgl.getContext() as WebGL2RenderingContext;
  const handle = (webgl.properties.get(texture) as { __webglTexture: WebGLTexture }).__webglTexture;
  const image = texture.image as { width: number; height: number };
  const width = Math.max(1, image.width >> level);
  const height = Math.max(1, image.height >> level);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, handle, level);
  expect(gl.checkFramebufferStatus(gl.FRAMEBUFFER)).toBe(gl.FRAMEBUFFER_COMPLETE);
  const bytes = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  return { width, bytes };
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

function flippedRows(bytes: Uint8Array, width: number): Uint8Array {
  const row = width * 4;
  const rows = bytes.length / row;
  const out = new Uint8Array(bytes.length);
  for (let y = 0; y < rows; y++)
    out.set(bytes.subarray(y * row, (y + 1) * row), (rows - 1 - y) * row);
  return out;
}

describe('the Warrior kit sheets decoded off the main thread', () => {
  it('upload texel for texel what the image element path uploads', async () => {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    vi.stubGlobal('createImageBitmap', undefined);
    const image = await loadKit();
    vi.unstubAllGlobals();
    const bitmap = await loadKit();

    expect([...image.keys()].sort()).toEqual([...bitmap.keys()].sort());
    expect(image.size).toBe(11);
    for (const [name, reference] of image) {
      const decoded = bitmap.get(name) as THREE.Texture;
      expect(reference.image instanceof HTMLImageElement, `${name} image arm`).toBe(true);
      expect(decoded.image instanceof ImageBitmap, `${name} bitmap arm`).toBe(true);
      expect(decoded.colorSpace, name).toBe(reference.colorSpace);
      expect(decoded.generateMipmaps, name).toBe(reference.generateMipmaps);
      for (const level of reference.generateMipmaps ? [0, 3] : [0]) {
        const a = readLevel(reference, level);
        const b = readLevel(decoded, level);
        expect(firstDifference(a.bytes, b.bytes), `${name} level ${level}`).toBe(-1);
        if (level === 0) {
          // The sheet is not its own mirror, so a flip would show above.
          expect(firstDifference(a.bytes, flippedRows(a.bytes, a.width)), name).not.toBe(-1);
        }
      }
    }
  });

  it('decodes the released sheets again for a rebuilt renderer, texel for texel', async () => {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    vi.stubGlobal('createImageBitmap', undefined);
    const image = await loadKit();
    vi.unstubAllGlobals();
    const bitmap = await loadKit();
    const first = new Map(
      [...bitmap].map(([name, texture]) => [name, texture.image as ImageBitmap]),
    );
    for (const texture of bitmap.values()) readLevel(texture, 0);
    for (const [name, texture] of bitmap) {
      expect(bitmapSheetReleased(texture), `${name} released`).toBe(true);
      expect((first.get(name) as ImageBitmap).width, `${name} bitmap closed`).toBe(0);
    }
    // The graphics rebuild: a new renderer, whose kit asks for the assets
    // again before its recipe uploads a sheet.
    renderer.dispose();
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    await expect(ensureWarriorKitAssets(false)).resolves.toBe(true);
    for (const [name, reference] of image) {
      const decoded = bitmap.get(name) as THREE.Texture;
      expect(decoded.image instanceof ImageBitmap, `${name} decoded again`).toBe(true);
      expect(decoded.image).not.toBe(first.get(name));
      for (const level of reference.generateMipmaps ? [0, 3] : [0]) {
        const a = readLevel(reference, level);
        const b = readLevel(decoded, level);
        expect(firstDifference(a.bytes, b.bytes), `${name} level ${level}`).toBe(-1);
      }
    }
  });

  it('uploads a released sheet as empty storage with no GL error, then heals on its next use', async () => {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    vi.stubGlobal('createImageBitmap', undefined);
    const image = await loadKit();
    vi.unstubAllGlobals();
    const bitmap = await loadKit();
    for (const texture of bitmap.values()) readLevel(texture, 0);
    // A restored context re-uploads every texture it draws, released or not.
    renderer.dispose();
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
    const gl = renderer.getContext();
    const [name, decoded] = [...bitmap][0];
    readLevel(decoded, 0);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    await vi.waitFor(() => expect(decoded.image instanceof ImageBitmap).toBe(true));
    const a = readLevel(image.get(name) as THREE.Texture, 0);
    const b = readLevel(decoded, 0);
    expect(firstDifference(a.bytes, b.bytes), name).toBe(-1);
  });
});
