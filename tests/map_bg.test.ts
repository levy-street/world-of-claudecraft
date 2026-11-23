import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The baked-plate loader's residency half (src/ui/map_bg.ts): whether a decoded
// plate outlives its canvas copy, and the HUD cache it hands out. The loader
// only touches `Image`/`HTMLImageElement`, so two stubbed globals stand in for
// the browser; the graphics profile comes from the real gfx module.

class FakeImage {
  static created: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 480;
  naturalHeight = 480;
  private readonly attrs = new Map<string, string>();
  constructor() {
    FakeImage.created.push(this);
  }
  set src(value: string) {
    this.attrs.set('src', value);
  }
  get src(): string {
    return this.attrs.get('src') ?? '';
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
}

// An image whose decode() the test settles by hand, recording whether a caller
// saw it decoded (the WebKit and Chrome decode() contract: resolve once the
// bitmap is ready to draw, reject when it cannot be decoded).
class DecodingImage extends FakeImage {
  decoded = false;
  decodeCalls = 0;
  private settle: { resolve: () => void; reject: () => void } | null = null;
  decode(): Promise<void> {
    this.decodeCalls++;
    return new Promise((resolve, reject) => {
      this.settle = {
        resolve: () => {
          this.decoded = true;
          resolve();
        },
        reject: () => reject(new Error('EncodingError')),
      };
    });
  }
  finishDecode(): void {
    this.settle?.resolve();
  }
  failDecode(): void {
    this.settle?.reject();
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let restoreGfx: (() => void) | null = null;

async function loadMapBg(
  profile: { iosMemoryProfile: boolean; constrainedMemory: boolean },
  imageClass: typeof FakeImage = FakeImage,
) {
  vi.resetModules();
  FakeImage.created = [];
  vi.stubGlobal('Image', imageClass);
  vi.stubGlobal('HTMLImageElement', FakeImage);
  const gfx = await import('../src/render/gfx');
  restoreGfx = gfx.gfxInternalsForTest.overrideSettings(profile);
  return import('../src/ui/map_bg');
}

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  vi.unstubAllGlobals();
});

const DESKTOP = { iosMemoryProfile: false, constrainedMemory: false };
// An Android phone under the constrained-browser rule: constrainedMemory is
// true there, but the map residency keys off the iOS profile only.
const ANDROID_CONSTRAINED = { iosMemoryProfile: false, constrainedMemory: true };
const IOS = { iosMemoryProfile: true, constrainedMemory: true };

function fakeCanvas(): HTMLCanvasElement {
  return { width: 480, height: 480 } as HTMLCanvasElement;
}

describe('map_bg on every non-iOS host (unchanged behavior)', () => {
  for (const [label, profile] of [
    ['desktop', DESKTOP],
    ['constrained Android', ANDROID_CONSTRAINED],
  ] as const) {
    it(`${label}: keeps the decoded plate and serves a repeat load from it`, async () => {
      const mapBg = await loadMapBg(profile);
      const cache = mapBg.createMapBgCache(() => 'eastbrook_vale');
      expect(cache.policy.capacity).toBeNull();
      expect(cache.policy.prewarmPreparedZones).toBe(true);
      const ready: unknown[] = [];
      mapBg.loadBakedMapBg(
        'eastbrook_vale',
        (img) => ready.push(img),
        () => ready.push('miss'),
      );
      expect(FakeImage.created).toHaveLength(1);
      const img = FakeImage.created[0];
      expect(img.src).toBe('/map_bg/eastbrook_vale.webp');
      img.onload?.();
      mapBg.loadBakedMapBg(
        'eastbrook_vale',
        (again) => ready.push(again),
        () => ready.push('miss'),
      );
      expect(ready).toEqual([img, img]);
      expect(FakeImage.created).toHaveLength(1);
      expect(img.hasAttribute('src')).toBe(true);
      expect(img.onload).not.toBeNull();
    });

    it(`${label}: hands the plate over at load without awaiting decode()`, async () => {
      const mapBg = await loadMapBg(profile, DecodingImage);
      mapBg.createMapBgCache(() => 'eastbrook_vale');
      const ready: unknown[] = [];
      mapBg.loadBakedMapBg(
        'eastbrook_vale',
        (img) => ready.push(img),
        () => ready.push('miss'),
      );
      const img = FakeImage.created[0] as DecodingImage;
      img.onload?.();
      expect(ready).toEqual([img]);
      expect(img.decodeCalls).toBe(0);
    });

    it(`${label}: never releases a committed background`, async () => {
      const mapBg = await loadMapBg(profile);
      const cache = mapBg.createMapBgCache(() => 'z0');
      const canvases = Array.from({ length: 15 }, fakeCanvas);
      for (const [i, canvas] of canvases.entries()) cache.set(`z${i}`, canvas);
      expect(cache.size).toBe(15);
      for (const canvas of canvases) expect([canvas.width, canvas.height]).toEqual([480, 480]);
    });
  }
});

describe('map_bg on the iOS memory profile', () => {
  it('decodes the plate before any caller copies it, then lets it go', async () => {
    const mapBg = await loadMapBg(IOS, DecodingImage);
    mapBg.createMapBgCache(() => 'eastbrook_vale');
    const seen: { img: unknown; decoded: boolean; hadSrc: boolean }[] = [];
    const onReady = (plate: HTMLImageElement) => {
      const img = plate as unknown as DecodingImage;
      seen.push({ img, decoded: img.decoded, hadSrc: img.hasAttribute('src') });
    };
    mapBg.loadBakedMapBg('drakelands', onReady, () => {});
    const img = FakeImage.created[0] as DecodingImage;
    img.onload?.();
    expect(img.decodeCalls).toBe(1);
    expect(seen).toEqual([]);
    // A caller arriving while the decode runs joins the same load.
    mapBg.loadBakedMapBg('drakelands', onReady, () => {});
    expect(FakeImage.created).toHaveLength(1);
    img.finishDecode();
    await flush();
    expect(seen).toEqual([
      { img, decoded: true, hadSrc: true },
      { img, decoded: true, hadSrc: true },
    ]);
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.onload).toBeNull();
  });

  it('falls back to the plain copy when decode() rejects', async () => {
    const mapBg = await loadMapBg(IOS, DecodingImage);
    mapBg.createMapBgCache(() => 'eastbrook_vale');
    const out: unknown[] = [];
    mapBg.loadBakedMapBg(
      'drakelands',
      (img) => out.push(img),
      () => out.push('miss'),
    );
    const img = FakeImage.created[0] as DecodingImage;
    img.onload?.();
    expect(img.decodeCalls).toBe(1);
    expect(out).toEqual([]);
    img.failDecode();
    await flush();
    expect(out).toEqual([img]);
    expect(img.decoded).toBe(false);
    expect(img.hasAttribute('src')).toBe(false);
    // The rejected plate is not remembered as missing: the next need loads it again.
    mapBg.loadBakedMapBg(
      'drakelands',
      (again) => out.push(again),
      () => out.push('miss'),
    );
    expect(FakeImage.created).toHaveLength(2);
  });

  it('without decode() hands the plate over at load, then lets it go', async () => {
    const mapBg = await loadMapBg(IOS);
    mapBg.createMapBgCache(() => 'eastbrook_vale');
    const seen: { img: unknown; hadSrc: boolean }[] = [];
    const onReady = (img: HTMLImageElement) =>
      seen.push({ img, hadSrc: (img as unknown as FakeImage).hasAttribute('src') });
    // Two callers join one in-flight load: both copy the plate before it goes.
    mapBg.loadBakedMapBg('drakelands', onReady, () => {});
    mapBg.loadBakedMapBg('drakelands', onReady, () => {});
    expect(FakeImage.created).toHaveLength(1);
    const img = FakeImage.created[0];
    img.onload?.();
    expect(seen).toEqual([
      { img, hadSrc: true },
      { img, hadSrc: true },
    ]);
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.onload).toBeNull();
    expect(img.onerror).toBeNull();
  });

  it('reloads a released plate through the same baked URL', async () => {
    const mapBg = await loadMapBg(IOS);
    mapBg.createMapBgCache(() => 'eastbrook_vale');
    mapBg.loadBakedMapBg(
      'drakelands',
      () => {},
      () => {},
    );
    FakeImage.created[0].onload?.();
    const again: unknown[] = [];
    mapBg.loadBakedMapBg(
      'drakelands',
      (img) => again.push(img),
      () => again.push('miss'),
    );
    expect(FakeImage.created).toHaveLength(2);
    expect(FakeImage.created[1].src).toBe('/map_bg/drakelands.webp');
    expect(again).toEqual([]);
    FakeImage.created[1].onload?.();
    expect(again).toEqual([FakeImage.created[1]]);
  });

  it('remembers a missing plate, as every host does', async () => {
    const mapBg = await loadMapBg(IOS);
    mapBg.createMapBgCache(() => 'eastbrook_vale');
    const out: string[] = [];
    mapBg.loadBakedMapBg(
      'drakelands',
      () => out.push('ready'),
      () => out.push('miss'),
    );
    FakeImage.created[0].onerror?.();
    mapBg.loadBakedMapBg(
      'drakelands',
      () => out.push('ready'),
      () => out.push('miss'),
    );
    expect(out).toEqual(['miss', 'miss']);
    expect(FakeImage.created).toHaveLength(1);
  });

  it('bounds the HUD cache and frees a released canvas backing store', async () => {
    const mapBg = await loadMapBg(IOS);
    const cache = mapBg.createMapBgCache(() => 'eastbrook_vale');
    expect(cache.policy).toEqual({
      capacity: 3,
      retainDecodedPlates: false,
      prewarmPreparedZones: false,
    });
    const home = fakeCanvas();
    const left = fakeCanvas();
    cache.set('eastbrook_vale', home);
    cache.set('drakelands', left);
    cache.set('mirefen_marsh', fakeCanvas());
    cache.set('thornpeak_heights', fakeCanvas());
    expect(cache.has('drakelands')).toBe(false);
    expect([left.width, left.height]).toEqual([0, 0]);
    expect([home.width, home.height]).toEqual([480, 480]);
  });
});

describe('Hud wiring (src/ui/hud.ts)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('builds its per-zone background cache through the residency policy', () => {
    expect(hud).toContain('private readonly mapBgCache = createMapBgCache(() => this.lastZoneId);');
  });

  it('asks the policy before prewarming a zone the renderer prepared', () => {
    expect(hud).toMatch(
      /queueMapBgPrewarm\(zoneId: string\): void \{\s*if \(this\.mapBgCache\.has\(zoneId\) \|\| !this\.mapBgCache\.policy\.prewarmPreparedZones\) return;/,
    );
  });
});
