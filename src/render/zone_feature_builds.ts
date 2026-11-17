// Zone feature builds for the renderer's zone prepares (renderer.ts
// ensureZoneFeatures, prepareZoneAt).
//
// Every zone feature builder used to run in one main-thread call when its
// zone streamed in, so walking into a new zone cost one long frame per
// builder: Veiled Hollow's flora was 161 ms on the calibrated desktop proxy
// and 222 ms on the reference phone. A builder written as a stepped build
// (stepped_build_core.ts) is now prebuilt here during a BACKGROUND prepare,
// in idle slices the size the terrain lane uses, beside the zone's terrain
// build, and the renderer's synchronous ensureZoneFeatures takes the finished
// view instead of building it. A gating prepare (behind the loading cover)
// does not prebuild: it runs the builder in one call as before, which also
// covers a prebuild still in flight when a gating caller builds the feature
// first (the prebuild stops and its result is dropped).
//
// Every builder call is timed into the build ledger under
// `zone:features:<name>`; a prebuild records each slice, so the ledger's
// worst entry is the worst frame the build cost.

import { buildFenFeaturesSteps } from './fen_features';
import { buildGaleFeaturesSteps } from './gale_features';
import { idleSlot } from './idle_queue';
import { buildJungleFeaturesSteps } from './jungle_features';
import { buildRealmFloraSteps } from './realm_flora';
import {
  IDLE_SLICE_MS,
  IDLE_SLICE_TIMEOUT_MS,
  runBuildInSlices,
  type SteppedBuild,
} from './stepped_build_core';

/** The lane's slice and idle-slot wait (stepped_build_core.ts). */
export const FEATURE_SLICE_MS = IDLE_SLICE_MS;
export const FEATURE_IDLE_TIMEOUT_MS = IDLE_SLICE_TIMEOUT_MS;

/** The stepped builders per biome, by the builder name ensureZoneFeatures
 *  times them under. */
const STEPPED: Record<string, readonly [string, (seed: number) => SteppedBuild<unknown>][]> = {
  dusk: [['buildRealmFlora', (seed) => buildRealmFloraSteps(seed)]],
  fen: [['buildFenFeatures', (seed) => buildFenFeaturesSteps(seed)]],
  jungle: [['buildJungleFeatures', (seed) => buildJungleFeaturesSteps(seed)]],
  gale: [['buildGaleFeatures', (seed) => buildGaleFeaturesSteps(seed)]],
};

export interface ZoneFeatureBuildHost {
  /** Into the renderer's build ledger. Pass a wrapper that reads the ledger's
   *  record at CALL time, never the bound function: perf tooling (the orbit
   *  bench) wraps `buildLedger.record` after boot, and a function captured at
   *  construction would bypass it, so its walks saw no zone builds at all. */
  record(kind: string, ms: number, atMs: number): void;
  /** True once the renderer is shutting down: a prebuild stops between slices. */
  stopped(): boolean;
  now?(): number;
  yieldSlice?(): Promise<void>;
}

export class ZoneFeatureBuilds {
  private readonly ready = new Map<string, unknown>();
  private readonly inFlight = new Map<string, Promise<void>>();
  /** Builders whose view the renderer already holds: never prebuilt again.
   *  Permanent, because the renderer never drops a zone feature view; if
   *  feature eviction lands, clear the name there or a revisit falls back to
   *  the one-frame build. */
  private readonly built = new Set<string>();

  constructor(private readonly host: ZoneFeatureBuildHost) {}

  /** Prebuild, in idle slices, the stepped features `biome` needs and the
   *  renderer has not built yet. Resolves when they are ready (or stopped). */
  prebuild(biome: string, seed: number): Promise<void> {
    const jobs = (STEPPED[biome] ?? []).map(([name, steps]) => {
      if (this.built.has(name) || this.ready.has(name)) return undefined;
      let job = this.inFlight.get(name);
      if (!job) {
        job = this.slice(name, steps(seed)).finally(() => this.inFlight.delete(name));
        this.inFlight.set(name, job);
      }
      return job;
    });
    return Promise.all(jobs).then(() => undefined);
  }

  /** The view for `name`: a finished prebuild when there is one, else `run()`
   *  timed in this call. */
  build<T>(name: string, run: () => T): T {
    this.built.add(name);
    if (this.ready.has(name)) {
      const view = this.ready.get(name) as T;
      this.ready.delete(name);
      return view;
    }
    const now = this.host.now ?? (() => performance.now());
    const started = now();
    const view = run();
    this.host.record(`zone:features:${name}`, now() - started, started);
    return view;
  }

  private async slice(name: string, steps: SteppedBuild<unknown>): Promise<void> {
    const view = await runBuildInSlices(steps, FEATURE_SLICE_MS, {
      now: this.host.now ?? (() => performance.now()),
      yieldSlice: this.host.yieldSlice ?? (() => idleSlot(FEATURE_IDLE_TIMEOUT_MS)),
      // A gating prepare built it meanwhile: stop rather than finish a copy.
      cancelled: () => this.host.stopped() || this.built.has(name),
      onSlice: (started, ms) => this.host.record(`zone:features:${name}`, ms, started),
    });
    if (view !== undefined && !this.built.has(name)) this.ready.set(name, view);
  }
}
