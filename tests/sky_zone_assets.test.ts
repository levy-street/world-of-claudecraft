import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadHdr = vi.fn(
  async (_url: string, _opts?: { maxWidth?: number }) => new THREE.DataTexture(),
);
const loadTexture = vi.fn(async () => new THREE.Texture());
const releaseHdr = vi.fn((_url: string, _opts?: { maxWidth?: number }) => undefined);
const releaseTexture = vi.fn();

describe('zone-scoped sky assets', () => {
  beforeEach(() => {
    vi.resetModules();
    loadHdr.mockClear();
    loadTexture.mockClear();
    releaseHdr.mockClear();
    releaseTexture.mockClear();
    vi.doMock('../src/render/gfx', () => ({ GFX: { standardMaterials: true } }));
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(),
      loadHdr,
      loadTexture,
      releaseGltf: vi.fn(),
      releaseHdr,
      releaseTexture,
    }));
    vi.doMock('../src/render/textures', () => ({
      cloudTexture: vi.fn(() => new THREE.Texture()),
      skyTexture: vi.fn(() => new THREE.Texture()),
    }));
  });

  it('loads only requested biomes and deduplicates repeated calls', async () => {
    const { ensureSkyBiomeAssets, hasSkyHdriAssets } = await import('../src/render/sky');

    expect(loadHdr).not.toHaveBeenCalled();
    await ensureSkyBiomeAssets(['vale', 'vale']);
    // The visible dome keeps its high-resolution HDR while PMREM uses a
    // separate 1k source, so one biome intentionally requests two HDR assets.
    expect(loadHdr).toHaveBeenCalledTimes(2);
    expect(loadHdr).toHaveBeenNthCalledWith(1, '/env/vale_day_2k.hdr');
    expect(loadHdr).toHaveBeenNthCalledWith(2, '/env/vale_day_1k.hdr', { maxWidth: 512 });
    // All shipped backdrop strengths are zero: dead 8k panoramas must not be
    // fetched merely because their biome's HDRI is requested.
    expect(loadTexture).not.toHaveBeenCalled();
    expect(hasSkyHdriAssets(['vale'])).toBe(true);
    expect(hasSkyHdriAssets(['marsh'])).toBe(false);

    await ensureSkyBiomeAssets(['vale']);
    expect(loadHdr).toHaveBeenCalledTimes(2);
    expect(loadTexture).not.toHaveBeenCalled();
  });

  it('classifies a dome-arrived biome as non-resident until its env HDR lands', async () => {
    const sky = await import('../src/render/sky');
    const biomes = sky.skyBiomesAt(0, 0);
    // The dome (2k) and env (1k, maxWidth 512) fetches settle independently:
    // resolve every dome immediately, hang every env until released.
    const releaseEnv: Array<(tex: THREE.DataTexture) => void> = [];
    loadHdr.mockImplementation((url) =>
      url.includes('_1k.hdr')
        ? new Promise<THREE.DataTexture>((resolve) => {
            releaseEnv.push(resolve);
          })
        : Promise.resolve(new THREE.DataTexture()),
    );
    try {
      const pending = sky.ensureSkyBiomeAssets(biomes);
      // Let the settled dome fetches land in their store; the envs stay in flight.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50));
      for (const biome of biomes) {
        // The regression trap: BOTH texture accessors read non-null here
        // (envTexture falls back to the dome HDR), so neither can probe env
        // residency. The predicate must still say NOT resident, or the
        // prewarm would PMREM the full-size dome fallback and cache that
        // wrong prefilter for the session.
        expect(view.domeTexture(biome)).not.toBeNull();
        expect(view.envTexture(biome)).not.toBeNull();
        expect(view.skyBiomeAssetsResident(biome)).toBe(false);
      }
      for (const release of releaseEnv) release(new THREE.DataTexture());
      await pending;
      for (const biome of biomes) {
        expect(view.skyBiomeAssetsResident(biome)).toBe(true);
      }
    } finally {
      loadHdr.mockImplementation(async () => new THREE.DataTexture());
    }
  });

  // Residency: the stores used to grow for a whole session (one 2k dome HDR is
  // ~16.8 MB of CPU pixels plus the same on the GPU, times the shipped keys).
  it('releases exactly the asked biomes and lets a later ensure re-fetch', async () => {
    const sky = await import('../src/render/sky');
    await sky.ensureSkyBiomeAssets(['vale', 'marsh']);
    // North of the Sowfield bowl, so the dome's start pair is the vale alone
    // (the Vale Cup practice sky overlaps the world origin).
    const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50), 0, 40);
    const marshDome = view.domeTexture('marsh');
    const marshEnv = view.envTexture('marsh');
    if (!marshDome || !marshEnv) throw new Error('expected the marsh sky to be resident');
    const domeDisposed = vi.spyOn(marshDome, 'dispose');
    const envDisposed = vi.spyOn(marshEnv, 'dispose');

    expect(sky.releaseSkyBiomeAssets(['marsh'])).toEqual(['marsh']);

    expect(domeDisposed).toHaveBeenCalled();
    expect(envDisposed).toHaveBeenCalled();
    expect(sky.hasSkyHdriAssets(['marsh'])).toBe(false);
    expect(sky.residentSkyBiomes()).not.toContain('marsh');
    // The unrelated biome keeps everything.
    expect(sky.hasSkyHdriAssets(['vale'])).toBe(true);
    expect(sky.residentSkyBiomes()).toContain('vale');
    // Dispose and loader-cache release are one step, or the next ensure would
    // be handed the disposed texture straight back out of the promise cache.
    expect(releaseHdr).toHaveBeenCalledWith('/env/marsh_overcast_2k.hdr', undefined);
    expect(releaseHdr).toHaveBeenCalledWith('/env/marsh_overcast_1k.hdr', { maxWidth: 512 });
    expect(releaseHdr).not.toHaveBeenCalledWith('/env/vale_day_2k.hdr', undefined);

    // The per-biome fetch memo is gone too, so the re-ensure really re-fetches.
    loadHdr.mockClear();
    await sky.ensureSkyBiomeAssets(['marsh']);
    expect(loadHdr).toHaveBeenCalledTimes(2);
    expect(loadHdr).toHaveBeenNthCalledWith(1, '/env/marsh_overcast_2k.hdr');
    expect(sky.hasSkyHdriAssets(['marsh'])).toBe(true);
  });

  it('refuses to release a biome bound into a live dome until that dome is gone', async () => {
    const sky = await import('../src/render/sky');
    const startBiomes = sky.skyBiomesAt(0, 0);
    await sky.ensureSkyBiomeAssets(startBiomes);
    const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50), 0, 0);
    for (const biome of startBiomes) expect(sky.currentDomeBiomes()).toContain(biome);

    // The second line of defense behind the renderer's pinned set.
    expect(sky.releaseSkyBiomeAssets([...startBiomes])).toEqual([]);
    expect(sky.hasSkyHdriAssets(startBiomes)).toBe(true);
    expect(releaseHdr).not.toHaveBeenCalled();

    view.dispose();
    expect(sky.currentDomeBiomes()).toEqual([]);
    expect(sky.releaseSkyBiomeAssets([...startBiomes])).toEqual([...startBiomes]);
    expect(sky.hasSkyHdriAssets(startBiomes)).toBe(false);
  });

  it('never disposes an HDR two biome keys share through an aliased url', async () => {
    // beach reuses the vale day sky, cave/volcano the marsh overcast: loadHdr
    // hands both keys the SAME decoded texture, so a per-key dispose would
    // blank the other key's dome.
    const decoded = new Map<string, THREE.DataTexture>();
    loadHdr.mockImplementation(async (url: string, opts?: { maxWidth?: number }) => {
      const key = `${url}|${opts?.maxWidth ?? ''}`;
      const existing = decoded.get(key);
      if (existing) return existing;
      const tex = new THREE.DataTexture();
      decoded.set(key, tex);
      return tex;
    });
    try {
      const sky = await import('../src/render/sky');
      await sky.ensureSkyBiomeAssets(['vale', 'beach']);
      const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50), 0, 40);
      const shared = view.domeTexture('vale');
      if (!shared) throw new Error('expected the vale sky to be resident');
      expect(view.domeTexture('beach')).toBe(shared);
      const disposed = vi.spyOn(shared, 'dispose');

      expect(sky.releaseSkyBiomeAssets(['beach'])).toEqual(['beach']);
      expect(disposed).not.toHaveBeenCalled();
      expect(releaseHdr).not.toHaveBeenCalledWith('/env/vale_day_2k.hdr', undefined);
      expect(sky.hasSkyHdriAssets(['vale'])).toBe(true);
      expect(sky.hasSkyHdriAssets(['beach'])).toBe(false);

      // Once the last claimant goes, the texture and its cache entry go too.
      view.dispose();
      expect(sky.releaseSkyBiomeAssets(['vale'])).toEqual(['vale']);
      expect(disposed).toHaveBeenCalled();
      expect(releaseHdr).toHaveBeenCalledWith('/env/vale_day_2k.hdr', undefined);
    } finally {
      loadHdr.mockImplementation(async () => new THREE.DataTexture());
    }
  });

  it('holds the dome on its last bound pair when a target biome is not resident', async () => {
    // The fail-soft that makes eviction safe: setCameraPos refuses to step the
    // blend onto a missing HDR, so the sky freezes on the pair it has instead
    // of sampling an undefined uniform (a black dome).
    const sky = await import('../src/render/sky');
    await sky.ensureSkyBiomeAssets(['vale', 'marsh']);
    const view = sky.buildSky(false, new THREE.Vector3(90, 140, 50), 0, 40);
    const uniforms = (view.dome.material as THREE.ShaderMaterial).uniforms;
    const boundA = uniforms.uSkyA.value;
    const boundB = uniforms.uSkyB.value;
    expect(boundA).toBeTruthy();

    expect(sky.releaseSkyBiomeAssets(['marsh'])).toEqual(['marsh']);
    // Deep inside the marsh band, whose sky is now gone.
    expect(() => view.setCameraPos(0, 400, 1 / 20)).not.toThrow();
    expect(uniforms.uSkyA.value).toBe(boundA);
    expect(uniforms.uSkyB.value).toBe(boundB);
  });

  it('maps every sky key to the rectangles it is drawn over', async () => {
    const sky = await import('../src/render/sky');
    const { SOWFIELD_CENTER } = await import('../src/sim/vale_cup_layout');
    const regions = sky.skyResidencyRegions();
    // One region per zone (several zones share the vale sky) plus the two
    // place-keyed windows.
    expect(regions.filter((region) => region.key === 'vale').length).toBeGreaterThan(1);

    const isle = regions.find((region) => region.key === 'farshore');
    if (!isle) throw new Error('expected a Farshore sky region');
    // Pinned against biomeBlendAt itself: the window must cover exactly where
    // the isle sky enters the blend, or residency and the dome would drift.
    expect(sky.skyBiomesAt(isle.minX + 5, 0)).toContain('farshore');
    expect(sky.skyBiomesAt(isle.minX - 5, 0)).not.toContain('farshore');
    expect(sky.skyBiomesAt(isle.maxX - 5, 0)).toContain('farshore');
    expect(sky.skyBiomesAt(isle.maxX + 5, 0)).not.toContain('farshore');
    expect(sky.skyBiomesAt(300, isle.minZ + 5)).toContain('farshore');
    expect(sky.skyBiomesAt(300, isle.minZ - 5)).not.toContain('farshore');
    expect(sky.skyBiomesAt(300, isle.maxZ - 5)).toContain('farshore');
    expect(sky.skyBiomesAt(300, isle.maxZ + 5)).not.toContain('farshore');

    const cup = regions.find((region) => region.key === 'vale_cup');
    if (!cup) throw new Error('expected a Vale Cup sky region');
    expect(sky.skyBiomesAt(SOWFIELD_CENTER.x, SOWFIELD_CENTER.z)).toContain('vale_cup');
    // The rect covers the whole 120 yd disc (over-covering at the corners).
    expect(cup.minX).toBeLessThanOrEqual(SOWFIELD_CENTER.x - 119);
    expect(cup.maxX).toBeGreaterThanOrEqual(SOWFIELD_CENTER.x + 119);
    expect(cup.minZ).toBeLessThanOrEqual(SOWFIELD_CENTER.z - 119);
    expect(cup.maxZ).toBeGreaterThanOrEqual(SOWFIELD_CENTER.z + 119);
    expect(sky.skyBiomesAt(SOWFIELD_CENTER.x + 125, SOWFIELD_CENTER.z)).not.toContain('vale_cup');
  });

  it('renders the shipping HDRI dome after opaques at far depth', async () => {
    const { buildSky, ensureSkyBiomeAssets, skyBiomesAt, SKY_BACKGROUND_RENDER_ORDER } =
      await import('../src/render/sky');
    await ensureSkyBiomeAssets(skyBiomesAt(0, 0));

    const sky = buildSky(false, new THREE.Vector3(90, 140, 50));
    const material = sky.dome.material as THREE.ShaderMaterial;
    expect(SKY_BACKGROUND_RENDER_ORDER).toBe(1000);
    expect(sky.dome.renderOrder).toBe(1000);
    expect(material.depthWrite).toBe(false);
    expect(material.vertexShader).toContain(
      'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    );
    expect(material.vertexShader).toContain('gl_Position.z = gl_Position.w;');
  });

  it('recovers a half-loaded biome: dome lands, env fails terminally, a later ensure completes it', async () => {
    // Review round 2: the successful arm leaves the biome resident (its dome
    // bytes are real and evictable) but NOT ready, the failed ensure clears
    // its task memo, and a later residency pass must re-fetch the missing arm
    // to full readiness once the loader recovers.
    const sky = await import('../src/render/sky');
    loadHdr.mockImplementation(async (url: string) => {
      if (url.includes('_1k.hdr')) throw new Error('env fetch failed terminally');
      return new THREE.DataTexture();
    });
    await expect(sky.ensureSkyBiomeAssets(['marsh'])).rejects.toThrow('env fetch failed');
    expect(sky.residentSkyBiomes()).toContain('marsh');
    expect(sky.readySkyBiomes()).not.toContain('marsh');

    // Connectivity returns: the same ensure entry point (what the residency
    // lane re-runs) completes the missing arm.
    loadHdr.mockImplementation(async () => new THREE.DataTexture());
    await sky.ensureSkyBiomeAssets(['marsh']);
    expect(sky.readySkyBiomes()).toContain('marsh');
  });

  it('gives every reachable sky key a residency region, so none can become always-evictable', async () => {
    // The residency plan keeps a biome by the distance to its nearest region
    // rectangle; a key with NO region has no distance, is never inside the
    // keep radius, and would be evicted on every recheck and re-fetched on
    // every approach forever. Every sky key REACHABLE in a world must
    // therefore map to a region: zone biomes through the zones the renderer
    // passes (the LIVE world's list, so a custom map's paint-only biome is
    // covered too), the place-keyed skies through their override windows.
    const sky = await import('../src/render/sky');
    const { ZONES } = await import('../src/sim/data');
    const builtIn = new Set(sky.skyResidencyRegions().map((r: { key: string }) => r.key));
    for (const zone of ZONES) {
      expect(builtIn.has(zone.biome), `zone biome ${zone.biome} has no residency region`).toBe(
        true,
      );
    }
    for (const key of ['farshore', 'vale_cup']) {
      expect(builtIn.has(key), `place-keyed sky ${key} has no residency region`).toBe(true);
    }
    // The custom-map arm: a paint-only biome present in the PASSED zone list
    // gets a region, which is what makes the renderer's live-zone wiring
    // sufficient for editor worlds.
    const custom = sky.skyResidencyRegions([
      { id: 'z', biome: 'beach', zMin: 0, zMax: 100, xMin: 0, xMax: 100 },
    ] as never);
    expect(custom.some((r: { key: string }) => r.key === 'beach')).toBe(true);
    // And the residency lane derives its list from the live world, not static
    // ZONES: the renderer's host view supplies the zones, the driver passes
    // exactly those to skyResidencyRegions.
    const { readFileSync } = await import('node:fs');
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('liveZones: () => this.sim.cfg.world?.zones ?? ZONES');
    const driver = readFileSync(
      new URL('../src/render/sky_residency_driver.ts', import.meta.url),
      'utf8',
    );
    expect(driver).toContain('skyResidencyRegions(this.host.liveZones())');
    expect(driver).toContain('new Set(this.host.liveZones().map((zone) => zone.biome))');
  });

  it('refuses to release a biome a warm lane pinned, until every pin is gone', async () => {
    // Fetch protection ends when ensureSkyBiomeAssets settles, but a warm
    // lane (zone prepare, residency ensure) still hands the decoded texture
    // to idle uploads and PMREM frames later: releasing in that window
    // disposes a texture about to be re-uploaded, minting GPU backing no
    // store owns. Pins cover that window, refcounted so overlapping lanes
    // compose.
    const sky = await import('../src/render/sky');
    await sky.ensureSkyBiomeAssets(['marsh']);
    expect(sky.residentSkyBiomes()).toContain('marsh');

    const unpinPrepare = sky.pinSkyBiomeAssets(['marsh']);
    const unpinEnsure = sky.pinSkyBiomeAssets(['marsh']);
    expect(sky.releaseSkyBiomeAssets(['marsh'])).toEqual([]);
    expect(sky.residentSkyBiomes()).toContain('marsh');

    unpinPrepare();
    expect(sky.releaseSkyBiomeAssets(['marsh'])).toEqual([]);

    // A double unpin is idempotent: it must not steal the other lane's pin.
    unpinPrepare();
    expect(sky.releaseSkyBiomeAssets(['marsh'])).toEqual([]);

    unpinEnsure();
    expect(sky.releaseSkyBiomeAssets(['marsh'])).toEqual(['marsh']);
    expect(sky.residentSkyBiomes()).not.toContain('marsh');
  });

  it('a shadowless recheck sweeps the resident HDR stores and the derived env RTs', async () => {
    // A downgrade rebuild (Medium or higher to Low) leaves the module stores
    // populated while the residency lane's ensure arm is gated off; the
    // shadowless branch must still run the evict half or the decoded HDRs
    // leak for the whole Low session. Behavioral, through the real driver and
    // the real stores: only the renderer host is faked.
    const sky = await import('../src/render/sky');
    const { SkyResidencyDriver } = await import('../src/render/sky_residency_driver');
    const { GFX } = await import('../src/render/gfx');
    await sky.ensureSkyBiomeAssets(['marsh']);
    expect(sky.residentSkyBiomes()).toContain('marsh');
    (GFX as { standardMaterials: boolean }).standardMaterials = false;

    const rt = { texture: {}, dispose: vi.fn() };
    const envRTs = new Map([['marsh', rt]]);
    const forbidden = (what: string) => () => {
      throw new Error(`the shadowless arm must not reach ${what}`);
    };
    const driver = new SkyResidencyDriver({
      isShutdown: () => false,
      lifecycleGeneration: () => 0,
      scene: () => ({ environment: null }),
      skyView: forbidden('the sky view'),
      envRTs: () => envRTs,
      envBiome: () => 'vale',
      envTransition: () => ({ current: 'vale', pending: null }),
      preparedZones: () => new Set<string>(),
      liveZones: () => [],
      zoneIdAt: () => null,
      prewarmTextureInIdle: forbidden('an idle prewarm'),
      runPmrem: forbidden('pmrem'),
      idleSlot: forbidden('an idle slot'),
    } as never);

    driver.updateSkyResidency(0, 0);

    expect(sky.residentSkyBiomes()).not.toContain('marsh');
    expect(releaseHdr).toHaveBeenCalledWith('/env/marsh_overcast_2k.hdr', undefined);
    expect(rt.dispose).toHaveBeenCalled();
    expect(envRTs.size).toBe(0);
  });
});
