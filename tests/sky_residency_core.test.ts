import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeSkyResidencyPlan,
  SKY_EVICT_RADIUS,
  SKY_KEEP_RADIUS,
  type SkyResidencyRegion,
  zoneArrivalReady,
} from '../src/render/sky_residency_core';
import { INITIAL_SKY_PREWARM_RADIUS, MAX_OUTDOOR_FOG_FAR } from '../src/render/zone_streaming';

// The per-biome sky HDR stores used to grow for a whole session (a 2k dome
// DataTexture is ~16.8 MB of CPU pixels plus the same on the GPU, times the
// shipped sky keys). This is the policy that bounds them.

type Key = 'vale' | 'marsh' | 'peaks' | 'ember' | 'frost';

const region = (key: Key, minX: number, maxX: number, minZ: number, maxZ: number) =>
  ({ key, minX, maxX, minZ, maxZ }) satisfies SkyResidencyRegion<Key>;

describe('sky residency plan', () => {
  it('anchors its radii to the streaming envelope, with a keep/evict hysteresis band', () => {
    // KEEP is the ceiling of every horizon the background prepare lane can ask
    // for, so eviction can never fight the lane streaming those zones in.
    expect(SKY_KEEP_RADIUS).toBe(MAX_OUTDOOR_FOG_FAR);
    expect(SKY_EVICT_RADIUS).toBe(MAX_OUTDOOR_FOG_FAR + INITIAL_SKY_PREWARM_RADIUS);
    expect(SKY_EVICT_RADIUS).toBeGreaterThan(SKY_KEEP_RADIUS);
  });

  it('ensures a missing biome whose rectangle sits inside the keep radius', () => {
    const plan = computeSkyResidencyPlan<Key>({
      regions: [region('vale', -100, 100, -100, 100), region('marsh', -100, 100, 200, 400)],
      cameraX: 0,
      cameraZ: 0,
      resident: ['vale'],
      pinned: ['vale'],
    });
    expect(plan.ensure).toEqual(['marsh']);
    expect(plan.evict).toEqual([]);
  });

  it('orders the ensure list nearest first', () => {
    const plan = computeSkyResidencyPlan<Key>({
      regions: [
        region('marsh', -100, 100, 600, 700),
        region('peaks', -100, 100, 200, 300),
        region('vale', -100, 100, -100, 100),
      ],
      cameraX: 0,
      cameraZ: 0,
      resident: [],
      pinned: [],
    });
    expect(plan.ensure).toEqual(['vale', 'peaks', 'marsh']);
  });

  it('evicts a resident biome past the evict radius', () => {
    const far = SKY_EVICT_RADIUS + 10;
    const plan = computeSkyResidencyPlan<Key>({
      regions: [region('vale', -100, 100, -100, 100), region('ember', -100, 100, far, far + 100)],
      cameraX: 0,
      cameraZ: 0,
      resident: ['vale', 'ember'],
      pinned: ['vale'],
    });
    expect(plan.evict).toEqual(['ember']);
    expect(plan.ensure).toEqual([]);
  });

  it('holds a resident biome inside the hysteresis band instead of thrashing it', () => {
    const inBand = (SKY_KEEP_RADIUS + SKY_EVICT_RADIUS) / 2;
    const regions = [
      region('vale', -100, 100, -100, 100),
      region('ember', -100, 100, inBand, 9999),
    ];
    const plan = computeSkyResidencyPlan<Key>({
      regions,
      cameraX: 0,
      cameraZ: 0,
      resident: ['vale', 'ember'],
      pinned: [],
    });
    // Past KEEP, so it is not re-ensured; short of EVICT, so it is not dropped.
    expect(plan.evict).toEqual([]);
    expect(plan.ensure).toEqual([]);
    // ...and the same band is a no-op for a biome that is NOT resident.
    const missing = computeSkyResidencyPlan<Key>({
      regions,
      cameraX: 0,
      cameraZ: 0,
      resident: ['vale'],
      pinned: [],
    });
    expect(missing.ensure).toEqual([]);
    expect(missing.evict).toEqual([]);
  });

  it('never evicts a pinned biome, however far the camera has travelled', () => {
    const far = SKY_EVICT_RADIUS * 4;
    const plan = computeSkyResidencyPlan<Key>({
      regions: [region('vale', -100, 100, -100, 100), region('ember', -100, 100, far, far + 100)],
      cameraX: 0,
      cameraZ: far + 40,
      resident: ['vale', 'ember'],
      // The dome's live pair: their textures are bound into shader uniforms.
      pinned: ['vale'],
    });
    expect(plan.evict).toEqual([]);
  });

  it('measures a multi-zone biome by its NEAREST rectangle', () => {
    const far = SKY_EVICT_RADIUS + 200;
    const regions = [
      region('vale', -100, 100, far, far + 100),
      region('vale', -100, 100, -100, 100),
      region('marsh', -100, 100, far, far + 100),
    ];
    const plan = computeSkyResidencyPlan<Key>({
      regions,
      cameraX: 0,
      cameraZ: 0,
      resident: ['vale', 'marsh'],
      pinned: [],
    });
    expect(plan.evict).toEqual(['marsh']);
  });

  it('evicts a resident biome that no region draws any more', () => {
    const plan = computeSkyResidencyPlan<Key>({
      regions: [region('vale', -100, 100, -100, 100)],
      cameraX: 0,
      cameraZ: 0,
      resident: ['vale', 'frost'],
      pinned: [],
    });
    expect(plan.evict).toEqual(['frost']);
    // ...unless it is pinned, which outranks every distance rule.
    const pinnedPlan = computeSkyResidencyPlan<Key>({
      regions: [region('vale', -100, 100, -100, 100)],
      cameraX: 0,
      cameraZ: 0,
      resident: ['vale', 'frost'],
      pinned: ['frost'],
    });
    expect(pinnedPlan.evict).toEqual([]);
  });

  it('restricts the ensure arm to the keys the caller declared ensurable', () => {
    const regions = [region('vale', -100, 100, -100, 100), region('marsh', -100, 100, 200, 400)];
    const open = computeSkyResidencyPlan<Key>({
      regions,
      cameraX: 0,
      cameraZ: 0,
      resident: [],
      pinned: [],
    });
    expect(open.ensure).toEqual(['vale', 'marsh']);
    const restricted = computeSkyResidencyPlan<Key>({
      regions,
      cameraX: 0,
      cameraZ: 0,
      resident: [],
      pinned: [],
      ensurable: ['marsh'],
    });
    expect(restricted.ensure).toEqual(['marsh']);
    // An empty ensurable set is a real restriction, not "unset".
    const none = computeSkyResidencyPlan<Key>({
      regions,
      cameraX: 0,
      cameraZ: 0,
      resident: [],
      pinned: [],
      ensurable: [],
    });
    expect(none.ensure).toEqual([]);
  });

  it('returns empty plans for empty inputs', () => {
    const plan = computeSkyResidencyPlan<Key>({
      regions: [],
      cameraX: 0,
      cameraZ: 0,
      resident: [],
      pinned: [],
    });
    expect(plan).toEqual({ ensure: [], evict: [] });
  });

  it('accepts caller radii and keeps evict at or beyond keep', () => {
    const regions = [region('vale', -100, 100, 300, 400)];
    const kept = computeSkyResidencyPlan<Key>({
      regions,
      cameraX: 0,
      cameraZ: 0,
      resident: [],
      pinned: [],
      keepRadius: 400,
      evictRadius: 500,
    });
    expect(kept.ensure).toEqual(['vale']);
    // A caller-supplied evict radius under keep would let a biome be ensured
    // and evicted by the same plan: it is clamped up to keep instead.
    const clamped = computeSkyResidencyPlan<Key>({
      regions,
      cameraX: 0,
      cameraZ: 0,
      resident: ['vale'],
      pinned: [],
      keepRadius: 400,
      evictRadius: 10,
    });
    expect(clamped.evict).toEqual([]);
  });
});

it('suppresses an ensure only on FULL readiness, never on partial residency', () => {
  // The half-loaded recovery split (review round 2): a biome whose dome
  // landed while its env arm exhausted retries is resident (evictable) but
  // not ready, and MUST re-enter the ensure lane.
  const region = { key: 'vale', minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
  const plan = computeSkyResidencyPlan({
    regions: [region],
    cameraX: 5,
    cameraZ: 5,
    resident: ['vale'],
    ready: [],
    pinned: [],
  });
  expect(plan.ensure).toEqual(['vale']);
  expect(plan.evict).toEqual([]);

  const done = computeSkyResidencyPlan({
    regions: [region],
    cameraX: 5,
    cameraZ: 5,
    resident: ['vale'],
    ready: ['vale'],
    pinned: [],
  });
  expect(done.ensure).toEqual([]);

  // Omitting ready keeps the old resident-suppressed behavior.
  const legacy = computeSkyResidencyPlan({
    regions: [region],
    cameraX: 5,
    cameraZ: 5,
    resident: ['vale'],
    pinned: [],
  });
  expect(legacy.ensure).toEqual([]);
});

describe('renderer sky-residency driver', () => {
  const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
  const driver = readFileSync(
    new URL('../src/render/sky_residency_driver.ts', import.meta.url),
    'utf8',
  );

  it('runs the plan on the zone-streaming recheck cadence, not per frame', () => {
    // queueVisibleZonePrepares is the one path that already knows the camera
    // travelled ZONE_STREAM_RECHECK_DISTANCE; the call sits past that guard.
    const start = renderer.indexOf('private queueVisibleZonePrepares(horizon: number): void {');
    expect(start).toBeGreaterThan(0);
    const end = renderer.indexOf('\n  }', start);
    const body = renderer.slice(start, end);
    expect(body).toContain('this.skyResidency.updateSkyResidency(cameraX, cameraZ)');
    expect(body.indexOf('this.skyResidency.updateSkyResidency')).toBeGreaterThan(
      body.indexOf('this.visibleZoneCheckFar = horizon'),
    );
    expect(renderer.match(/\.updateSkyResidency\(/g)?.length).toBe(1);
  });

  it('reads the renderer state it drives through the host, never a snapshot', () => {
    // The driver lives outside the coordinator, so every member it needs comes
    // from the host view the renderer builds. Copies would go stale: skyView is
    // rebuilt by build(), and envBiome / envTransition move under an IBL ease.
    const start = renderer.indexOf('private readonly skyResidency = new SkyResidencyDriver({');
    expect(start).toBeGreaterThan(0);
    const host = renderer.slice(start, renderer.indexOf('\n  });', start));
    expect(host).toContain('isShutdown: () => this.shutdownStarted');
    expect(host).toContain('lifecycleGeneration: () => this.lifecycleGeneration');
    expect(host).toContain('skyView: () => this.skyView');
    expect(host).toContain('envBiome: () => this.envBiome');
    expect(host).toContain('envTransition: () => this.envTransition');
    expect(host).toContain('preparedZones: () => this.preparedZones');
    // The two renderer-owned lanes the driver borrows rather than reimplements.
    expect(host).toContain('() => this.ensureEnvironmentBiome(biome)');
    expect(host).toContain('idleSlot: () => idleSlot(IDLE_PREWARM_TIMEOUT_MS, {');
    expect(host).toContain('maxTimeoutDeferrals: 2');
  });

  it('pins the bound dome pair and the bound IBL out of the evict arm', () => {
    const start = driver.indexOf('  updateSkyResidency(cameraX: number, cameraZ: number): void {');
    expect(start).toBeGreaterThan(0);
    const end = driver.indexOf('\n  }', start);
    const body = driver.slice(start, end);
    expect(body).toContain('...currentDomeBiomes(),');
    expect(body).toContain('envTransition.current,');
    // The pending arm of an in-flight IBL ease is pinned too (review round 1).
    expect(body).toContain('envTransition.pending !== null');
    expect(body).toContain('resident: residentSkyBiomes()');
    // Only a prepared zone's sky is this lane's to restore.
    expect(body).toContain('this.host.preparedZones().has(zoneId)');
    expect(body).toContain('for (const biome of releaseSkyBiomeAssets(plan.evict))');
  });

  it('re-ensures on the idle prewarm discipline without re-preparing the zone', () => {
    const start = driver.indexOf('private ensureSkyResidency(biome: SkyKey): void {');
    expect(start).toBeGreaterThan(0);
    const end = driver.indexOf('\n  }\n', start);
    const body = driver.slice(start, end);
    // Same three steps prepareZoneSky's idle arm takes: chunked idle uploads
    // for both textures with the indivisible PMREM unit on the shared queue.
    expect(body).toContain('await ensureSkyBiomeAssets([biome])');
    expect(body).toContain('if (!this.host.skyView().skyBiomeAssetsResident(biome)) return;');
    expect(body).toContain(
      'await this.host.prewarmTextureInIdle(this.host.skyView().envTexture(biome))',
    );
    expect(body).toContain(
      'await this.host.prewarmTextureInIdle(this.host.skyView().domeTexture(biome))',
    );
    expect(body).toContain('await this.host.idleSlot()');
    expect(body).toMatch(/await this\.host\.runPmrem\(biome, `sky-residency-pmrem:\$\{biome}`\)/);
    // Never the whole-zone lane, and never a preparedZones write.
    expect(body).not.toContain('prepareZoneAt');
    expect(body).not.toContain('preparedZones');
    // Reentrancy: the fetch memo dedupes the download, this dedupes the warmup.
    expect(body).toContain('this.skyResidencyEnsuring.has(biome)');
    expect(body).toContain('this.skyResidencyEnsuring.add(biome)');
    expect(body).toContain('this.skyResidencyEnsuring.delete(biome)');
  });

  it('restores a prepared zone released sky on the blocking arrival path', () => {
    // prepareZoneAt short-circuits for a prepared zone, so without this the
    // dome would arrive frozen on the previous realm's pair after a teleport
    // back into a realm whose sky had been released.
    const start = renderer.indexOf('  prepareZoneAt(');
    expect(start).toBeGreaterThan(0);
    const guard = renderer.slice(start, renderer.indexOf('const pending =', start));
    expect(guard).toContain('this.preparedZones.has(zoneId)');
    expect(guard).toContain('this.skyView.skyBiomeAssetsResident(biome)');
    expect(guard).toContain(
      "return this.prepareZoneSky(zoneAt(x, z), x, z, opts?.pace === 'idle')",
    );
  });

  it('keeps the single-environment cap on constrained memory intact', () => {
    const start = driver.indexOf('private evictEnvironmentBiome(biome: SkyKey): void {');
    expect(start).toBeGreaterThan(0);
    const end = driver.indexOf('\n  }', start);
    const body = driver.slice(start, end);
    // The constrained profile keeps exactly one env RT for the session and it
    // is always the bound one (resolveEnvironmentPrefilterPlan seeds envBiome
    // from it), so these guards are what stop eviction from re-opening the cap.
    expect(body).toContain('biome === this.host.envTransition().current ||');
    expect(body).toContain('biome === this.host.envTransition().pending');
    expect(body).toContain('this.host.scene().environment === target.texture');
    // Aliased sky urls share one PMREM target across biome keys.
    expect(body).toContain('for (const remaining of this.host.envRTs().values())');
  });

  it('sweeps the module HDR stores on the shadowless tiers instead of just returning', () => {
    // A downgrade rebuild (Medium or higher to Low) reaches this lane with
    // the sky module's decoded HDRs still resident, and this lane is their
    // only release path: a bare return would retain them for the whole Low
    // session (review round 3). The recheck cadence also sweeps a
    // pre-downgrade fetch that settles after the rebuild.
    const start = driver.indexOf('  updateSkyResidency(cameraX: number, cameraZ: number): void {');
    expect(start).toBeGreaterThan(0);
    const body = driver.slice(start, driver.indexOf('\n  }', start));
    const gate = body.indexOf('if (!GFX.standardMaterials) {');
    expect(gate).toBeGreaterThan(-1);
    const gateBody = body.slice(gate, body.indexOf('return;', gate));
    expect(gateBody).toContain('releaseSkyBiomeAssets(residentSkyBiomes())');
    expect(gateBody).toContain('this.evictEnvironmentBiome(biome)');
  });

  it('pins the ensured biome across the whole warm, not just the fetch', () => {
    // Fetch protection (skyAssetsInFlight) ends when the fetch settles, but
    // the warm still hands the decoded texture to idle uploads and PMREM
    // frames later; an unpinned evict in that window disposes a texture about
    // to be re-uploaded (review round 3).
    const start = driver.indexOf('private ensureSkyResidency(biome: SkyKey): void {');
    expect(start).toBeGreaterThan(0);
    const body = driver.slice(start, driver.indexOf('\n  }\n', start));
    const pin = body.indexOf('const unpin = pinSkyBiomeAssets([biome]);');
    expect(pin).toBeGreaterThan(-1);
    expect(pin).toBeLessThan(body.indexOf('await ensureSkyBiomeAssets([biome])'));
    const finallyStart = body.indexOf('.finally(() => {');
    expect(finallyStart).toBeGreaterThan(-1);
    const finallyBody = body.slice(finallyStart);
    expect(finallyBody).toContain('unpin();');
    expect(finallyBody).toContain('this.skyResidencyEnsuring.delete(biome);');
  });

  it('gates arrival readiness on sky residency through the shared pure predicate', () => {
    // main.ts bails on isZoneReadyAt before ever calling prepareZoneAt, so a
    // revisit after eviction must read NOT ready or the recovery branch above
    // is unreachable from the arrival path (review round 3).
    const start = renderer.indexOf('isZoneReadyAt(x: number, z: number): boolean {');
    expect(start).toBeGreaterThan(0);
    const body = renderer.slice(start, renderer.indexOf('\n  }', start));
    expect(body).toContain('zoneArrivalReady({');
    expect(body).toContain('prepared: this.preparedZones.has(id)');
    expect(body).toContain('programsPrewarmed: this.prewarmedZonePrograms.has(id)');
    expect(body).toContain('standardMaterials: GFX.standardMaterials');
    expect(body).toContain(
      'skyBiomesAt(x, z).every((biome) => this.skyView.skyBiomeAssetsResident(biome))',
    );
  });

  it('the walked background arrival takes the idle sky arm, never the synchronous one', () => {
    // The background warm branch has no curtain: for a PREPARED zone (the
    // sky-only recovery) it must pass idle pacing, or prepareZoneSky's fast
    // arm pays a synchronous PMREM plus full uploads in live play. The
    // unprepared catch-up build keeps its historic escalating join.
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const branch = main.indexOf("zoneWarmupMode(displacement) === 'background'");
    expect(branch).toBeGreaterThan(0);
    const body = main.slice(branch, main.indexOf('return;', branch));
    expect(body).toContain('const skyOnlyRecovery = renderer.isZonePreparedAt(zoneX, zoneZ);');
    expect(body).toContain(
      ".prepareZoneAt(zoneX, zoneZ, undefined, skyOnlyRecovery ? { pace: 'idle' } : undefined)",
    );
  });

  it('prepareZoneSky pins and warms every place-keyed dome the arrival can see', () => {
    // Farshore and the Sowfield bowl draw a dome keyed off the zone biome;
    // warming only zone.biome left that dome to pay its full 2K upload on the
    // first live bind after the curtain (review round 3). PMREM stays on
    // zone.biome, and the pin holds until the warm settles either way.
    const start = renderer.indexOf('private async prepareZoneSky(');
    expect(start).toBeGreaterThan(0);
    const body = renderer.slice(start, renderer.indexOf('\n  }\n', start));
    expect(body).toContain('const skyKeys = skyBiomesAt(x, z);');
    expect(body).toContain('const unpin = pinSkyBiomeAssets(skyKeys);');
    expect(body).toContain(
      'for (const key of skyKeys) this.prewarmTexture(this.skyView.domeTexture(key));',
    );
    expect(body).toContain(
      'for (const key of skyKeys) await this.prewarmTextureInIdle(this.skyView.domeTexture(key));',
    );
    expect(body).toContain('} finally {');
    expect(body).toContain('unpin();');
  });
});

describe('zoneArrivalReady', () => {
  const base = { prepared: true, programsPrewarmed: true, standardMaterials: true };

  it('a revisit whose sky was evicted is NOT ready, so the arrival re-runs the sky half', () => {
    expect(zoneArrivalReady({ ...base, skyResident: () => false })).toBe(false);
  });

  it('a fully resident sky arrives ready', () => {
    expect(zoneArrivalReady({ ...base, skyResident: () => true })).toBe(true);
  });

  it('terrain and shader programs still gate, and the sky readout never runs for them', () => {
    // The predicate sits on a per-frame arrival check and the readout
    // allocates: lazy evaluation is part of the contract, not a style choice.
    let called = false;
    const probe = () => {
      called = true;
      return true;
    };
    expect(zoneArrivalReady({ ...base, prepared: false, skyResident: probe })).toBe(false);
    expect(zoneArrivalReady({ ...base, programsPrewarmed: false, skyResident: probe })).toBe(false);
    expect(called).toBe(false);
  });

  it('shadowless tiers never gate arrival on sky: their stores stay empty by design', () => {
    let called = false;
    expect(
      zoneArrivalReady({
        ...base,
        standardMaterials: false,
        skyResident: () => {
          called = true;
          return false;
        },
      }),
    ).toBe(true);
    expect(called).toBe(false);
  });
});
