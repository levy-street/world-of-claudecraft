// loadBitmapTexture (src/render/assets/loader.ts): a plain image texture whose
// decode runs inside createImageBitmap, off the main thread, so the upload
// that follows pays only the copy. The image-element path decodes inside the
// upload call instead (about 45 to 103 ms per Warrior kit sheet on an Intel
// HD 530). The uploaded texels must match that path exactly, which the
// real-driver half pins (tests/browser/bitmap_texture_pixels.browser.test.ts);
// here, the options that decide them, the fallbacks and the cache.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageBitmapDecodeSupported } from '../src/render/assets/image_bitmap_decode';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI_16 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15';
const SAFARI_17 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const FIREFOX_97 = 'Mozilla/5.0 (X11; Linux x86_64; rv:97.0) Gecko/20100101 Firefox/97.0';
const FIREFOX_130 = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const ELECTRON =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) worldofclaudecraft/0.44.0 Chrome/138.0.7204.0 Electron/37.0.0 Safari/537.36';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1';

describe('imageBitmapDecodeSupported', () => {
  it('decodes on Chromium, where the texel identity is proven', () => {
    expect(imageBitmapDecodeSupported(CHROME, true)).toBe(true);
    expect(imageBitmapDecodeSupported(EDGE, true)).toBe(true);
    expect(imageBitmapDecodeSupported(ELECTRON, true)).toBe(true);
    expect(imageBitmapDecodeSupported(CHROME.replace('Chrome/', 'HeadlessChrome/'), true)).toBe(
      true,
    );
  });

  it('keeps the image path on WebKit and Gecko, and without createImageBitmap', () => {
    expect(imageBitmapDecodeSupported(CHROME, false)).toBe(false);
    for (const agent of [SAFARI_16, SAFARI_17, IOS_CHROME, FIREFOX_97, FIREFOX_130, undefined])
      expect(imageBitmapDecodeSupported(agent, true), agent).toBe(false);
  });
});

const OPTIONS = {
  imageOrientation: 'flipY',
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
};

function stubBrowser(options: { userAgent?: string; bitmap?: boolean; decode?: () => unknown }) {
  const bitmap = { width: 4, height: 4, close: vi.fn() };
  const blob = { size: 1 };
  const fetch = vi.fn(async () => ({ ok: true, status: 200, blob: async () => blob }));
  const createImageBitmap = vi.fn(async () => (options.decode ? options.decode() : bitmap));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('navigator', { userAgent: options.userAgent ?? CHROME });
  if (options.bitmap !== false) vi.stubGlobal('createImageBitmap', createImageBitmap);
  else vi.stubGlobal('createImageBitmap', undefined);
  const imageTexture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
  const imageLoad = vi
    .spyOn(THREE.TextureLoader.prototype, 'load')
    .mockImplementation((_url, onLoad) => {
      onLoad?.(imageTexture);
      return imageTexture;
    });
  return { bitmap, blob, fetch, createImageBitmap, imageTexture, imageLoad };
}

describe('loadBitmapTexture', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('decodes into an ImageBitmap with the orientation, alpha and colour the image path uploads with', async () => {
    const b = stubBrowser({});
    const { loadBitmapTexture } = await import('../src/render/assets/loader');
    const texture = await loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    expect(texture.image).toBe(b.bitmap);
    expect(b.createImageBitmap).toHaveBeenCalledWith(b.blob, OPTIONS);
    // three never sets the unpack flips for an ImageBitmap, so the bitmap is
    // decoded flipped and unpremultiplied, and the texture says so.
    expect(texture.flipY).toBe(false);
    expect(texture.premultiplyAlpha).toBe(false);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.version).toBeGreaterThan(0);
    expect(b.imageLoad).not.toHaveBeenCalled();
  });

  it('decodes a data map without a colour space', async () => {
    stubBrowser({});
    const { loadBitmapTexture } = await import('../src/render/assets/loader');
    const texture = await loadBitmapTexture('/textures/vfx/production/warrior_pressure.webp');
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('decodes again for a request after a settled load, never handing out a released texture', async () => {
    const b = stubBrowser({});
    const { loadBitmapTexture } = await import('../src/render/assets/loader');
    const first = await loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    const second = await loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    expect(second).not.toBe(first);
    expect(b.createImageBitmap).toHaveBeenCalledTimes(2);
  });

  it('keys an sRGB and a linear request for one url apart', async () => {
    const b = stubBrowser({});
    const { loadBitmapTexture } = await import('../src/render/assets/loader');
    const srgb = await loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    const linear = await loadBitmapTexture('/textures/vfx/production/smoke.webp');
    expect(srgb).not.toBe(linear);
    expect(srgb.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(linear.colorSpace).toBe(THREE.NoColorSpace);
    expect(b.createImageBitmap).toHaveBeenCalledTimes(2);
  });

  it('fetches and decodes each url once, joining a second request', async () => {
    const b = stubBrowser({});
    const { loadBitmapTexture } = await import('../src/render/assets/loader');
    const first = loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    const second = loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    expect(await first).toBe(await second);
    expect(b.fetch).toHaveBeenCalledTimes(1);
    expect(b.createImageBitmap).toHaveBeenCalledTimes(1);
  });

  for (const [arm, stub] of [
    ['a browser without createImageBitmap', { bitmap: false }],
    ['Safari', { userAgent: SAFARI_17 }],
    ['Firefox', { userAgent: FIREFOX_130 }],
  ] as const) {
    it(`takes the image element path on ${arm}`, async () => {
      const b = stubBrowser(stub);
      const { loadBitmapTexture } = await import('../src/render/assets/loader');
      const texture = await loadBitmapTexture('/textures/vfx/production/smoke.webp', {
        srgb: true,
      });
      expect(texture).toBe(b.imageTexture);
      expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(b.fetch).not.toHaveBeenCalled();
      expect(b.createImageBitmap).not.toHaveBeenCalled();
    });
  }

  it('takes the image element path when createImageBitmap refuses the decode', async () => {
    const b = stubBrowser({
      decode: () => {
        throw new TypeError('The provided value is not a valid enum value');
      },
    });
    const { loadBitmapTexture } = await import('../src/render/assets/loader');
    const texture = await loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    expect(b.createImageBitmap).toHaveBeenCalledTimes(1);
    expect(texture).toBe(b.imageTexture);
  });

  it('evicts a load that failed on both paths, so a later request fetches again', async () => {
    vi.useFakeTimers();
    const b = stubBrowser({});
    b.fetch.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    b.imageLoad.mockImplementation((_url, _onLoad, _onProgress, onError) => {
      onError?.(new Error('offline'));
      return b.imageTexture;
    });
    const { loadBitmapTexture } = await import('../src/render/assets/loader');
    const first = loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    const failed = expect(first).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    await failed;
    const fetched = b.fetch.mock.calls.length;
    expect(fetched).toBeGreaterThan(0);
    const again = loadBitmapTexture('/textures/vfx/production/smoke.webp', { srgb: true });
    const failedAgain = expect(again).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    await failedAgain;
    expect(b.fetch.mock.calls.length).toBe(2 * fetched);
  });
});
