import type * as THREE from 'three';
import type { ZoneDef } from '../sim/types';
import { GFX } from './gfx';
import {
  currentDomeBiomes,
  ensurePaintedClouds,
  ensurePaintedNightSky,
  ensureSkyBiomeAssets,
  pinSkyBiomeAssets,
  readySkyBiomes,
  releaseSkyBiomeAssets,
  residentSkyBiomes,
  type SkyKey,
  type SkyView,
  skyResidencyRegions,
} from './sky';
import { computeSkyResidencyPlan } from './sky_residency_core';

/**
 * The slice of renderer state the sky residency lane drives. Every member is a
 * read-through call, never a snapshot taken at construction: skyView is rebuilt
 * by the renderer's build step, envBiome and envTransition move under an IBL
 * ease, and this lane reads them across awaits that settle frames later.
 */
export interface SkyResidencyHost {
  /** True once the renderer began tearing down; rechecked after every await. */
  isShutdown(): boolean;
  /** Bumped when a graphics rebuild retires the renderer behind this driver. */
  lifecycleGeneration(): number;
  scene(): THREE.Scene;
  skyView(): SkyView;
  envRTs(): Map<SkyKey, THREE.WebGLRenderTarget>;
  envBiome(): SkyKey;
  envTransition(): { readonly current: SkyKey; readonly pending: SkyKey | null };
  preparedZones(): ReadonlySet<string>;
  /** The LIVE world's zones (an editor map's, not the static ZONES table). */
  liveZones(): readonly ZoneDef[];
  zoneIdAt(x: number, z: number): string | null;
  prewarmTextureInIdle(texture: THREE.Texture | null): Promise<void>;
  /** ensureEnvironmentBiome as one indivisible unit on the shared GPU queue.
   *  Resolves with whatever the queue returns; this lane only awaits it. */
  runPmrem(biome: SkyKey, label: string): Promise<unknown>;
  /** One prepareZoneSky-grade idle slot (the same timeout and deferral cap). */
  idleSlot(): Promise<unknown>;
}

/**
 * Bounds the per-biome sky stores as the camera travels: evicts the decoded
 * HDRs (plus their prefiltered environments) of biomes left far behind, and
 * restores any biome that came back inside the streaming horizon. The pure
 * hysteresis policy lives in sky_residency_core.ts; this is the driver that
 * owns the caches, the in-flight set, and the renderer-side effects.
 */
export class SkyResidencyDriver {
  constructor(private readonly host: SkyResidencyHost) {}

  // Sky keys that are a ZONE's biome, so the residency lane re-creates exactly
  // what the zone prepare lane would have: prepareZoneSky PMREMs zone.biome, and
  // the two place-keyed skies (farshore, vale_cup) have never had an env RT.
  // Same LIVE-zones source as the region list below (review round 1): an
  // editor zone's paint-only biome must also reach the PMREM arm of the
  // residency ensure, not only its keep region.
  private zoneSkyBiomesCache: ReadonlySet<SkyKey> | null = null;
  private zoneSkyBiomes(): ReadonlySet<SkyKey> {
    this.zoneSkyBiomesCache ??= new Set(this.host.liveZones().map((zone) => zone.biome));
    return this.zoneSkyBiomesCache;
  }
  // Derived lazily from the LIVE world's zones, not the static ZONES table: a
  // custom map (the editor) can place a paint-only biome (beach, desert,
  // volcano, cave) that no built-in realm declares, and a resident sky key
  // with no region would be evicted on every recheck and re-fetched on every
  // arrival, forever.
  private skyResidencyRegionListCache: ReturnType<typeof skyResidencyRegions> | null = null;
  private skyResidencyRegionList(): ReturnType<typeof skyResidencyRegions> {
    this.skyResidencyRegionListCache ??= skyResidencyRegions(this.host.liveZones());
    return this.skyResidencyRegionListCache;
  }
  private readonly skyResidencyEnsuring = new Set<SkyKey>();
  // Painted-night warms in flight (warmPaintedNight), and the keys whose night
  // fetch came back empty on this renderer: those keep the day sky's own darkened
  // night rather than re-asking the network on every recheck.
  private readonly paintedNightWarming = new Set<SkyKey>();
  private readonly paintedNightAbandoned = new Set<SkyKey>();

  /** Drop one biome's prefiltered environment render target once its sky assets
   *  have been released. Never touches the bound IBL (the pinned set already
   *  keeps its biome out of the plan; this is the same second line of defense
   *  releaseSkyBiomeAssets keeps for the dome), and never disposes a target the
   *  aliased sky urls still share with a biome that stayed resident. */
  private evictEnvironmentBiome(biome: SkyKey): void {
    const target = this.host.envRTs().get(biome);
    if (!target) return;
    if (
      biome === this.host.envBiome() ||
      biome === this.host.envTransition().current ||
      biome === this.host.envTransition().pending
    ) {
      return;
    }
    if (this.host.scene().environment === target.texture) return;
    this.host.envRTs().delete(biome);
    for (const remaining of this.host.envRTs().values()) {
      if (remaining === target) return;
    }
    target.dispose();
  }

  /** Re-fetch and re-warm one biome's sky assets after an eviction (or for a
   *  biome whose zone was never prepared), on prepareZoneSky's idle discipline
   *  and WITHOUT touching preparedZones: this lane owns the sky half only, and
   *  a prepared zone must never re-run a whole-zone prepare. */
  private ensureSkyResidency(biome: SkyKey): void {
    if (this.host.isShutdown() || this.skyResidencyEnsuring.has(biome)) return;
    this.skyResidencyEnsuring.add(biome);
    // Pinned for the whole warm, not just the fetch: a later plan on this
    // same lane could otherwise evict and dispose the decoded texture while
    // the idle-paced uploads below still hold it, and re-uploading a disposed
    // texture mints GPU backing no store owns.
    const unpin = pinSkyBiomeAssets([biome]);
    // Every step below yields, and the fetch can settle long after a graphics
    // rebuild replaced this renderer: guard the lifecycle like the boot resume
    // lane, or ensureEnvironmentBiome would re-mint GPU state on a dead one.
    const generation = this.host.lifecycleGeneration();
    const live = (): boolean =>
      !this.host.isShutdown() && generation === this.host.lifecycleGeneration();
    void (async () => {
      await ensureSkyBiomeAssets([biome]);
      if (!live()) return;
      // Nothing arrived: a tier that fetches no HDRIs at all, or a fetch that
      // failed. Warming from here would PMREM the dome fallback (see the sky
      // module's residency predicate) and burn an idle slot per recheck.
      if (!this.host.skyView().skyBiomeAssetsResident(biome)) return;
      // Uploads are cache-elided per texture, so a biome the streaming lane
      // warmed in the meantime costs nothing here.
      await this.host.prewarmTextureInIdle(this.host.skyView().envTexture(biome));
      if (!live()) return;
      if (this.zoneSkyBiomes().has(biome)) {
        await this.host.idleSlot();
        if (!live()) return;
        await this.host.runPmrem(biome, `sky-residency-pmrem:${biome}`);
        if (!live()) return;
      }
      await this.host.prewarmTextureInIdle(this.host.skyView().domeTexture(biome));
    })()
      .catch((err) => {
        console.warn(`Sky residency ensure failed: ${biome}`, err);
      })
      .finally(() => {
        unpin();
        this.skyResidencyEnsuring.delete(biome);
      });
  }

  /** Fetch, upload and hand to the dome one biome's painted night sky
   *  (sky_painted_core.ts): the same pinned, generation-guarded, idle-paced shape
   *  as ensureSkyResidency, for the optional night layer of a sky already on
   *  screen. The upload is one queued idle unit, never a live-frame bind: the dome
   *  keeps the slot on its day placeholder until admitPaintedNight, then fades the
   *  night in. */
  private warmPaintedNight(biome: SkyKey): void {
    if (this.host.isShutdown() || this.paintedNightWarming.has(biome)) return;
    if (this.paintedNightAbandoned.has(biome)) return;
    this.paintedNightWarming.add(biome);
    const unpin = pinSkyBiomeAssets([biome]);
    const generation = this.host.lifecycleGeneration();
    const live = (): boolean =>
      !this.host.isShutdown() && generation === this.host.lifecycleGeneration();
    void (async () => {
      const texture = await ensurePaintedNightSky(biome);
      if (!live()) return;
      if (!texture) {
        this.paintedNightAbandoned.add(biome);
        return;
      }
      await this.host.prewarmTextureInIdle(texture);
      if (!live()) return;
      this.host.skyView().admitPaintedNight(biome, texture);
    })()
      .catch((err) => {
        console.warn(`Painted night sky warm failed: ${biome}`, err);
      })
      .finally(() => {
        unpin();
        this.paintedNightWarming.delete(biome);
      });
  }

  // The painted cloud atlas warm (sky_clouds_core.ts) in flight, and whether its fetch
  // came back empty on this renderer (the dome then keeps the painted day sky alone).
  private paintedCloudsWarming = false;
  private paintedCloudsAbandoned = false;

  /** Fetch, upload and hand to the dome the painted cloud atlas, the same idle-paced,
   *  generation-guarded shape as warmPaintedNight: the upload is one queued idle unit, never
   *  a live-frame bind, and the dome fades the clouds in once it is admitted. */
  private warmPaintedClouds(): void {
    if (this.host.isShutdown() || this.paintedCloudsWarming || this.paintedCloudsAbandoned) return;
    this.paintedCloudsWarming = true;
    const generation = this.host.lifecycleGeneration();
    const live = (): boolean =>
      !this.host.isShutdown() && generation === this.host.lifecycleGeneration();
    void (async () => {
      const texture = await ensurePaintedClouds();
      if (!live()) return;
      if (!texture) {
        this.paintedCloudsAbandoned = true;
        return;
      }
      await this.host.prewarmTextureInIdle(texture);
      if (!live()) return;
      this.host.skyView().admitPaintedClouds(texture);
    })()
      .catch((err) => {
        console.warn('Painted cloud atlas warm failed', err);
      })
      .finally(() => {
        this.paintedCloudsWarming = false;
      });
  }

  /**
   * Bound the per-biome sky stores: release the decoded HDRs (plus their
   * prefiltered environments) of biomes the camera has left far behind, and
   * bring back any biome inside the streaming horizon that is missing. Runs on
   * the zone-streaming recheck cadence, never per frame; the hysteresis band
   * between the two radii lives in sky_residency_core.ts.
   */
  updateSkyResidency(cameraX: number, cameraZ: number): void {
    if (this.host.isShutdown()) return;
    // The shadowless tiers never fetch sky HDRIs (ensureSkyBiomeAssets
    // early-returns), so nothing can ever become ready there: without this
    // gate the ensure arm would re-enqueue an async no-op for every prepared
    // biome on every recheck, forever (review round 2). But a DOWNGRADE
    // rebuild (Medium or higher to Low) arrives here with the module HDR
    // stores still populated: renderer shutdown unbinds the dome and disposes
    // its own PMREM targets, while the decoded HDRs and their loader entries
    // belong to the sky module and this lane is their only release path. So
    // sweep instead of just returning: on a fresh Low session the resident
    // set is empty and this is free, and running on the recheck cadence also
    // catches a pre-downgrade fetch that settles after the rebuild (release
    // refuses an in-flight biome, so the late completion lands first and is
    // swept on the next pass).
    if (!GFX.standardMaterials) {
      for (const biome of releaseSkyBiomeAssets(residentSkyBiomes())) {
        this.evictEnvironmentBiome(biome);
      }
      return;
    }
    // Only a PREPARED zone's sky is this lane's to restore: an unprepared one
    // still belongs to the streaming lane, which fetches it inside its own
    // prepare. A region's centre always resolves to the zone that owns it, for
    // the place-keyed windows (the Farshore isle, the Sowfield bowl) too.
    const ensurable = new Set<SkyKey>();
    for (const region of this.skyResidencyRegionList()) {
      if (ensurable.has(region.key)) continue;
      const zoneId = this.host.zoneIdAt(
        (region.minX + region.maxX) / 2,
        (region.minZ + region.maxZ) / 2,
      );
      if (zoneId !== null && this.host.preparedZones().has(zoneId)) ensurable.add(region.key);
    }
    // One read of the live ease state, so the pending arm still narrows below.
    const envTransition = this.host.envTransition();
    const plan = computeSkyResidencyPlan<SkyKey>({
      regions: this.skyResidencyRegionList(),
      cameraX,
      cameraZ,
      ensurable,
      resident: residentSkyBiomes(),
      // Full readiness alone suppresses a re-fetch; any-asset residency alone
      // drives eviction (the half-loaded recovery split, review round 2).
      ready: readySkyBiomes(),
      // The dome's live pair plus whatever the IBL is bound to (or easing
      // toward): releasing either would blank a surface currently on screen.
      pinned: [
        ...currentDomeBiomes(),
        this.host.envBiome(),
        envTransition.current,
        ...(envTransition.pending !== null ? [envTransition.pending] : []),
      ],
    });
    for (const biome of releaseSkyBiomeAssets(plan.evict)) this.evictEnvironmentBiome(biome);
    for (const biome of plan.ensure) this.ensureSkyResidency(biome);
    // The painted nights of the skies this dome draws: fetched at background
    // priority and uploaded on the idle lane once their day sky is on screen, so
    // a session pays for the night only where it can see it (released with the
    // day set when the eviction above lets the biome go).
    for (const biome of this.host.skyView().paintedNightsToWarm()) this.warmPaintedNight(biome);
    // The painted clouds of a sky this dome draws, the same way (kept for the session once
    // uploaded: one atlas, shared by every sky that carries clouds).
    if (this.host.skyView().paintedCloudsToWarm()) this.warmPaintedClouds();
  }
}
