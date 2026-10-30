// The painted night sky's wiring (src/render/sky.ts + sky_residency_driver.ts):
// an optional per-key night layer, fetched at background priority once its day
// sky is on the dome, uploaded on the idle lane, faded in by the dome through the
// cycle's own night grade, and released with the day set. The pure curves are
// pinned in tests/sky_painted_core.test.ts; the day arms' residency rules in
// tests/sky_zone_assets.test.ts.
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const decoded = new Map<string, THREE.CompressedTexture>();
const loadKtx2Texture = vi.fn(
  async (url: string, _opts?: { repeat?: boolean; large?: boolean; priority?: string }) => {
    const existing = decoded.get(url);
    if (existing) return existing;
    const tex = new THREE.CompressedTexture([], 2, 1);
    decoded.set(url, tex);
    return tex;
  },
);
const releaseKtx2Texture = vi.fn((url: string, _opts?: { repeat?: boolean }) => {
  decoded.delete(url);
});
const GFX = { standardMaterials: true };

const NIGHT_2K = '/env/vale_painted_night_2k.ktx2';
// The vale's painted cloud atlas (sky_clouds_core.ts) warms through the same lane.
const CLOUDS = '/env/vale_painted_clouds.ktx2';
const SUN = new THREE.Vector3(90, 140, 50);
// Inside the vale, clear of every biome blend window.
const VALE_X = 0;
const VALE_Z = 40;

type Uniforms = Record<string, { value: unknown }>;
const uniformsOf = (view: { dome: THREE.Mesh }): Uniforms =>
  (view.dome.material as THREE.ShaderMaterial).uniforms as Uniforms;
const nightW = (u: Uniforms): THREE.Vector2 => u.uNightW.value as THREE.Vector2;

describe('the painted night sky', () => {
  beforeEach(() => {
    vi.resetModules();
    decoded.clear();
    loadKtx2Texture.mockClear();
    releaseKtx2Texture.mockClear();
    GFX.standardMaterials = true;
    vi.doMock('../src/render/gfx', () => ({ GFX }));
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(),
      loadKtx2Texture,
      loadTexture: vi.fn(async () => new THREE.Texture()),
      releaseGltf: vi.fn(),
      releaseKtx2Texture,
      releaseTexture: vi.fn(),
    }));
    vi.doMock('../src/render/textures', () => ({
      cloudTexture: vi.fn(() => new THREE.Texture()),
      skyTexture: vi.fn(() => new THREE.Texture()),
    }));
  });

  it('stays out of the day set: the boot and prepare fetches never ask for it', async () => {
    const sky = await import('../src/render/sky');
    await sky.ensureSkyBiomeAssets(['vale']);
    expect(loadKtx2Texture.mock.calls.map((call) => call[0])).toEqual([
      '/env/vale_painted_day_2k.ktx2',
      '/env/vale_painted_env_512.ktx2',
    ]);
    // Readiness (what arrival and the prewarm gate on) is the day pair alone.
    expect(sky.readySkyBiomes()).toContain('vale');
  });

  it('fetches at background priority off the dome lane, finished as a wrapping equirect', async () => {
    const sky = await import('../src/render/sky');
    expect(sky.hasPaintedNightSky('vale')).toBe(true);
    expect(sky.hasPaintedNightSky('beach')).toBe(true);
    expect(sky.hasPaintedNightSky('marsh')).toBe(false);

    const night = await sky.ensurePaintedNightSky('vale');
    expect(loadKtx2Texture).toHaveBeenCalledTimes(1);
    // Background, and NOT `large`: a background load on the one-slot dome lane
    // would hold the next biome crossing's demanded dome behind it.
    expect(loadKtx2Texture).toHaveBeenCalledWith(NIGHT_2K, { priority: 'background' });
    if (!night) throw new Error('expected the vale night');
    expect(night.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(night.wrapS).toBe(THREE.RepeatWrapping);
    expect(night.wrapT).not.toBe(THREE.RepeatWrapping);
    // Memoized: a second ensure reuses the resident texture.
    expect(await sky.ensurePaintedNightSky('vale')).toBe(night);
    expect(loadKtx2Texture).toHaveBeenCalledTimes(1);

    // A key without a night, and a profile that fetches no sky textures, get null
    // without touching the network.
    expect(await sky.ensurePaintedNightSky('marsh')).toBeNull();
    GFX.standardMaterials = false;
    expect(await sky.ensurePaintedNightSky('beach')).toBeNull();
    expect(loadKtx2Texture).toHaveBeenCalledTimes(1);
  });

  it('turns a failed fetch into null and drops the memo, so a later ensure retries', async () => {
    const sky = await import('../src/render/sky');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    loadKtx2Texture.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    try {
      expect(await sky.ensurePaintedNightSky('vale')).toBeNull();
      expect(sky.residentSkyBiomes()).not.toContain('vale');
      expect(await sky.ensurePaintedNightSky('vale')).not.toBeNull();
      expect(loadKtx2Texture).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('joins the residency accounting and is released with its biome, aliases kept', async () => {
    const sky = await import('../src/render/sky');
    const night = await sky.ensurePaintedNightSky('vale');
    if (!night) throw new Error('expected the vale night');
    // A biome holding only its night is still holding bytes: evictable, reported.
    expect(sky.residentSkyBiomes()).toContain('vale');
    expect(sky.readySkyBiomes()).not.toContain('vale');
    expect(sky.skyResidencyTextures()).toContain(night);

    // The beach aliases the vale's painting: one texture, two claimants.
    expect(await sky.ensurePaintedNightSky('beach')).toBe(night);
    const disposed = vi.spyOn(night, 'dispose');
    expect(sky.releaseSkyBiomeAssets(['beach'])).toEqual(['beach']);
    expect(disposed).not.toHaveBeenCalled();
    expect(releaseKtx2Texture).not.toHaveBeenCalledWith(NIGHT_2K);

    expect(sky.releaseSkyBiomeAssets(['vale'])).toEqual(['vale']);
    expect(disposed).toHaveBeenCalled();
    expect(releaseKtx2Texture).toHaveBeenCalledWith(NIGHT_2K);
    expect(sky.residentSkyBiomes()).toEqual([]);
    expect(sky.skyResidencyTextures()).toEqual([]);
  });

  it('refuses to release a biome while its night fetch is in flight', async () => {
    const sky = await import('../src/render/sky');
    let land: (tex: THREE.CompressedTexture) => void = () => undefined;
    loadKtx2Texture.mockImplementationOnce(
      () =>
        new Promise<THREE.CompressedTexture>((resolve) => {
          land = resolve;
        }),
    );
    const pending = sky.ensurePaintedNightSky('vale');
    expect(sky.releaseSkyBiomeAssets(['vale'])).toEqual([]);
    land(new THREE.CompressedTexture([], 2, 1));
    await pending;
    expect(sky.releaseSkyBiomeAssets(['vale'])).toEqual(['vale']);
  });

  it('binds nothing until the driver admits it, then fades it in through the night grade', async () => {
    const sky = await import('../src/render/sky');
    const { nightSkyDesat } = await import('../src/render/day_night_core');
    const { PAINTED_NIGHT_FADE_SEC, paintedNightWeight } = await import(
      '../src/render/sky_painted_core'
    );
    await sky.ensureSkyBiomeAssets(['vale']);
    const view = sky.buildSky(false, SUN, VALE_X, VALE_Z);
    const u = uniformsOf(view);
    const dayDome = u.uSkyA.value;
    expect(view.paintedNightsToWarm()).toEqual(['vale']);

    // Deep night, no night uploaded: the day sky's own darkened night, untouched.
    view.setCycle(SUN, 0, nightSkyDesat(1));
    view.setCameraPos(VALE_X, VALE_Z, 1);
    view.setStars(1, 0);
    expect(nightW(u).toArray()).toEqual([0, 0]);
    expect(u.uNightA.value).toBe(dayDome);
    // No painted night on screen yet: the classic stars whole, the painted layer off.
    expect(u.uStarAmt.value).toBe(1);
    expect(u.uPaintStarAmt.value).toBe(0);

    // A report for a texture the store does not hold is stale and ignored.
    view.admitPaintedNight('vale', new THREE.Texture());
    expect(view.paintedNightsToWarm()).toEqual(['vale']);

    const night = await sky.ensurePaintedNightSky('vale');
    if (!night) throw new Error('expected the vale night');
    view.admitPaintedNight('vale', night);
    expect(view.paintedNightsToWarm()).toEqual([]);
    // Bound at once, but faded in, never popped.
    view.setCameraPos(VALE_X, VALE_Z, 1 / 20);
    expect(u.uNightA.value).toBe(night);
    expect(nightW(u).x).toBeGreaterThan(0);
    expect(nightW(u).x).toBeLessThan(0.05);
    view.setCameraPos(VALE_X, VALE_Z, PAINTED_NIGHT_FADE_SEC);
    expect(nightW(u).x).toBeCloseTo(1, 12);
    // Same biome on both arms: both carry it.
    expect(nightW(u).y).toBeCloseTo(1, 12);
    // A fully shown painted night: its painted star layer replaces the classic field.
    view.setStars(1, 0);
    expect(u.uStarAmt.value).toBe(0);
    expect(u.uPaintStarAmt.value).toBe(1);
    view.setStars(0.6, 3);
    expect(u.uPaintStarAmt.value).toBeCloseTo(0.6, 12);

    // Through dusk the weight is the cycle's, and by day nothing shows.
    view.setCycle(SUN, 0.5, nightSkyDesat(0.65));
    expect(nightW(u).x).toBeCloseTo(paintedNightWeight(nightSkyDesat(0.65)), 12);
    view.setCycle(SUN, 0, nightSkyDesat(0));
    expect(nightW(u).toArray()).toEqual([0, 0]);
    view.setStars(0.25, 0);
    expect(u.uStarAmt.value).toBe(0.25);
    expect(u.uPaintStarAmt.value).toBe(0);

    // The night's u offset turns its glow to the midnight moon.
    expect(u.uNightOffA.value).toBeCloseTo(0.504 - 0.75, 6);
    view.dispose();
  });

  it('drops an admission whose texture was released, so a disposed texture is never bound', async () => {
    const sky = await import('../src/render/sky');
    const { nightSkyDesat } = await import('../src/render/day_night_core');
    await sky.ensureSkyBiomeAssets(['vale', 'marsh']);
    const night = await sky.ensurePaintedNightSky('vale');
    if (!night) throw new Error('expected the vale night');
    // Built over the marsh, so the vale is NOT bound and may be released.
    const view = sky.buildSky(false, SUN, 0, 400);
    view.admitPaintedNight('vale', night);
    expect(sky.releaseSkyBiomeAssets(['vale'])).toEqual(['vale']);
    // The vale comes back into the dome: the stale admission is not reused.
    await sky.ensureSkyBiomeAssets(['vale']);
    view.setCycle(SUN, 0, nightSkyDesat(1));
    for (let i = 0; i < 400; i++) view.setCameraPos(VALE_X, VALE_Z, 1 / 20);
    const u = uniformsOf(view);
    expect(u.uNightA.value).not.toBe(night);
    expect(u.uNightB.value).not.toBe(night);
    expect(nightW(u).toArray()).toEqual([0, 0]);
    expect(view.paintedNightsToWarm()).toContain('vale');
    view.dispose();
  });

  it('leaves every sky without a painted night exactly as it was, all night long', async () => {
    const sky = await import('../src/render/sky');
    const { nightSkyDesat } = await import('../src/render/day_night_core');
    await sky.ensureSkyBiomeAssets(['marsh']);
    const view = sky.buildSky(false, SUN, 0, 400);
    const u = uniformsOf(view);
    expect(view.paintedNightsToWarm()).toEqual([]);
    for (const amt of [0, 0.5, 0.9, 1]) {
      view.setCycle(SUN, 0, nightSkyDesat(amt));
      view.setCameraPos(0, 400, 1);
      view.setStars(0.731, 12);
      expect(nightW(u).toArray()).toEqual([0, 0]);
      expect(u.uStarAmt.value).toBe(0.731);
      expect(u.uPaintStarAmt.value).toBe(0);
    }
    view.dispose();
  });

  it('compiles the night as its own uniform-gated arm, after the night grade, before the glow', async () => {
    const { skyZoneHazeInternalsForTest } = await import('../src/render/sky');
    for (const haze of [false, true]) {
      const frag = skyZoneHazeInternalsForTest.skyFrag(haze);
      const grade = frag.indexOf('c *= uDayNight;');
      const arm = frag.indexOf('if (nightShare > 0.0) {');
      const glow = frag.indexOf('if (uDuskWarm > 0.001) {');
      const stars = frag.indexOf('if (uStarAmt > 0.001) {');
      expect(grade).toBeGreaterThan(-1);
      expect(arm).toBeGreaterThan(grade);
      expect(glow).toBeGreaterThan(arm);
      expect(stars).toBeGreaterThan(arm);
      // Its own grade, never the day sky's night multiply again.
      const block = frag.slice(arm, glow);
      expect(block).toContain('sampleSky(uNightA, dir, uNightOffA, uNightTune, 0.0)');
      expect(block).toContain('sampleSky(uNightB, dir, uNightOffB, uNightTune, 0.0)');
      expect(block).not.toContain('uDayNight');
      expect(block).not.toContain('uNightDesat');
      expect(block).toContain('c = c * (1.0 - nightShare) + night;');
    }
  });

  it('compiles the painted stars as one uniform-gated layer over the painted share only', async () => {
    const { skyZoneHazeInternalsForTest } = await import('../src/render/sky');
    const { PAINTED_STARS_GLSL, PAINTED_STARS_FUNCTIONS, PAINTED_STARS_DECLARATIONS } =
      await import('../src/render/sky_painted_stars_glsl');
    for (const [haze, palette] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      const frag = skyZoneHazeInternalsForTest.skyFrag(haze, palette);
      // One program: the layer is spliced in whole, its knobs baked as constants.
      expect(frag).toContain(PAINTED_STARS_DECLARATIONS);
      expect(frag).toContain(PAINTED_STARS_FUNCTIONS);
      expect(frag).toContain(PAINTED_STARS_GLSL);
      const classic = frag.indexOf('if (uStarAmt > 0.001) {');
      const painted = frag.indexOf('if (uPaintStarAmt > 0.001) {');
      const fogBand = frag.indexOf('c = mix(uFog, c,');
      const main = frag.indexOf('void main()');
      // After the classic field it replaces, before the horizon fog band covers the rim.
      expect(classic).toBeGreaterThan(main);
      expect(painted).toBeGreaterThan(classic);
      expect(fogBand).toBeGreaterThan(painted);
      // Its helpers are declared before main, after the night uniforms they read.
      expect(frag.indexOf('vec3 wocPaintStars(')).toBeLessThan(main);
      expect(frag.indexOf('uniform sampler2D uNightA;')).toBeLessThan(
        frag.indexOf('float wocPaintStarDensity('),
      );
    }
    // Crisp and stable: the screen-space derivative sizes every shape, read in uniform
    // control flow (inside the uniform gate, before any branch on the view direction).
    const gate = PAINTED_STARS_GLSL.indexOf('if (uPaintStarAmt > 0.001) {');
    const px = PAINTED_STARS_GLSL.indexOf('fwidth(dir)');
    const density = PAINTED_STARS_GLSL.indexOf('wocPaintStarDensity(paintUv)');
    const branch = PAINTED_STARS_GLSL.indexOf('if (paintUpper > 0.0');
    expect(gate).toBeGreaterThan(-1);
    expect(px).toBeGreaterThan(gate);
    expect(density).toBeGreaterThan(gate);
    expect(branch).toBeGreaterThan(Math.max(px, density));
    expect(PAINTED_STARS_FUNCTIONS).toContain('0.36 * px * px');
    // Where the painter put stars: the night texture's alpha, per bound arm.
    expect(PAINTED_STARS_FUNCTIONS).toContain(
      'texture2D(uNightA, vec2(uv.x + uNightOffA, uv.y)).a',
    );
    expect(PAINTED_STARS_FUNCTIONS).toContain(
      'texture2D(uNightB, vec2(uv.x + uNightOffB, uv.y)).a',
    );
    // Sine-free hash (stable for the fine grid's large cell indices), no pow anywhere,
    // and nothing that would read as a dome helper of the zone haze arm.
    expect(PAINTED_STARS_FUNCTIONS).not.toMatch(/\bsin\(dot\(/);
    for (const glsl of [PAINTED_STARS_FUNCTIONS, PAINTED_STARS_GLSL]) {
      expect(glsl).not.toContain('pow(');
      expect(glsl).not.toContain('wocSky');
      let depth = 0;
      for (const ch of glsl) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      expect(depth).toBe(0);
    }
  });

  it('the low tier keeps the day sky night: nothing to warm, nothing bound', async () => {
    const sky = await import('../src/render/sky');
    const view = sky.buildSky(true, SUN, VALE_X, VALE_Z);
    expect(view.paintedNightsToWarm()).toEqual([]);
    expect(() => view.admitPaintedNight('vale', new THREE.Texture())).not.toThrow();
    expect(loadKtx2Texture.mock.calls.map((call) => call[0])).not.toContain(NIGHT_2K);
    view.dispose();
  });
});

describe('the residency driver warms the night of the sky on screen', () => {
  beforeEach(() => {
    vi.resetModules();
    decoded.clear();
    loadKtx2Texture.mockClear();
    releaseKtx2Texture.mockClear();
    GFX.standardMaterials = true;
    vi.doMock('../src/render/gfx', () => ({ GFX }));
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(),
      loadKtx2Texture,
      loadTexture: vi.fn(async () => new THREE.Texture()),
      releaseGltf: vi.fn(),
      releaseKtx2Texture,
      releaseTexture: vi.fn(),
    }));
    vi.doMock('../src/render/textures', () => ({
      cloudTexture: vi.fn(() => new THREE.Texture()),
      skyTexture: vi.fn(() => new THREE.Texture()),
    }));
  });

  async function driverFor(view: unknown, uploads: THREE.Texture[], generation = { n: 0 }) {
    const { SkyResidencyDriver } = await import('../src/render/sky_residency_driver');
    const { ZONES } = await import('../src/sim/data');
    return new SkyResidencyDriver({
      isShutdown: () => false,
      lifecycleGeneration: () => generation.n,
      scene: () => ({ environment: null }),
      skyView: () => view,
      envRTs: () => new Map(),
      envBiome: () => 'vale',
      envTransition: () => ({ current: 'vale', pending: null }),
      // Every zone prepared, so the day arms need nothing from this lane.
      preparedZones: () => new Set(ZONES.map((zone) => zone.id)),
      liveZones: () => ZONES,
      zoneIdAt: () => null,
      prewarmTextureInIdle: async (texture: THREE.Texture | null) => {
        if (texture) uploads.push(texture);
      },
      runPmrem: async () => undefined,
      idleSlot: async () => undefined,
    } as never);
  }

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it('fetches, uploads on the idle lane, then admits; once per biome', async () => {
    const sky = await import('../src/render/sky');
    await sky.ensureSkyBiomeAssets(['vale']);
    const view = sky.buildSky(false, SUN, VALE_X, VALE_Z);
    const uploads: THREE.Texture[] = [];
    const driver = await driverFor(view, uploads);

    driver.updateSkyResidency(VALE_X, VALE_Z);
    // The lane pins the biome for its whole warm.
    expect(sky.releaseSkyBiomeAssets(['vale'])).toEqual([]);
    await settle();

    const night = decoded.get(NIGHT_2K);
    const clouds = decoded.get(CLOUDS);
    if (!night || !clouds) throw new Error('expected the night and the cloud fetches');
    // the night and the vale's cloud atlas, each uploaded once on the idle lane
    expect(uploads).toHaveLength(2);
    expect(uploads).toEqual(expect.arrayContaining([night, clouds]));
    expect(view.paintedNightsToWarm()).toEqual([]);
    expect(uniformsOf(view).uNightA.value).toBe(night);
    expect(view.paintedCloudsToWarm()).toBe(false);
    expect(uniformsOf(view).uClouds.value).toBe(clouds);
    // the residency budget counts the cloud atlas with the sky's other textures
    expect(sky.skyResidencyTextures()).toContain(clouds);

    // Nothing left to warm: a later recheck fetches and uploads nothing more.
    driver.updateSkyResidency(VALE_X, VALE_Z);
    await settle();
    expect(uploads).toHaveLength(2);
    expect(loadKtx2Texture.mock.calls.filter((call) => call[0] === NIGHT_2K)).toHaveLength(1);
    expect(loadKtx2Texture.mock.calls.filter((call) => call[0] === CLOUDS)).toHaveLength(1);
    view.dispose();
  });

  it('gives up on a night whose fetch failed rather than re-asking on every recheck', async () => {
    const sky = await import('../src/render/sky');
    await sky.ensureSkyBiomeAssets(['vale']);
    const view = sky.buildSky(false, SUN, VALE_X, VALE_Z);
    const uploads: THREE.Texture[] = [];
    const driver = await driverFor(view, uploads);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    loadKtx2Texture.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    try {
      driver.updateSkyResidency(VALE_X, VALE_Z);
      await settle();
      driver.updateSkyResidency(VALE_X, VALE_Z);
      await settle();
      expect(loadKtx2Texture.mock.calls.filter((call) => call[0] === NIGHT_2K)).toHaveLength(1);
      // no night was uploaded (the cloud atlas warms on its own, unaffected)
      expect(uploads.filter((texture) => texture !== decoded.get(CLOUDS))).toEqual([]);
      expect(view.paintedNightsToWarm()).toEqual(['vale']);
    } finally {
      warn.mockRestore();
      view.dispose();
    }
  });

  it('never admits into a renderer a graphics rebuild retired mid-warm', async () => {
    const sky = await import('../src/render/sky');
    await sky.ensureSkyBiomeAssets(['vale']);
    const view = sky.buildSky(false, SUN, VALE_X, VALE_Z);
    const uploads: THREE.Texture[] = [];
    const generation = { n: 0 };
    const driver = await driverFor(view, uploads, generation);
    driver.updateSkyResidency(VALE_X, VALE_Z);
    generation.n = 1;
    await settle();
    expect(uploads).toEqual([]);
    expect(view.paintedNightsToWarm()).toEqual(['vale']);
    view.dispose();
  });
});
