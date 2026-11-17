import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// A deterministic stand-in for the realm flora stepped build: PIECES pieces
// of 2 ms each on the test clock, counting how often a build starts.
const flora = vi.hoisted(() => ({
  clock: { now: 0 },
  starts: 0,
  pieces: 12,
  fenStarts: 0,
  otherStarts: [] as string[],
}));
vi.mock('../src/render/jungle_features', () => ({
  *buildJungleFeaturesSteps(seed: number) {
    flora.otherStarts.push('jungle');
    yield;
    return { group: { name: `jungle-features:${seed}` } };
  },
}));
vi.mock('../src/render/gale_features', () => ({
  *buildGaleFeaturesSteps(seed: number) {
    flora.otherStarts.push('gale');
    yield;
    return { group: { name: `gale-features:${seed}` } };
  },
}));
vi.mock('../src/render/fen_features', () => ({
  *buildFenFeaturesSteps(seed: number) {
    flora.fenStarts++;
    yield;
    return { group: { name: `fen-features:${seed}` } };
  },
}));
vi.mock('../src/render/realm_flora', () => ({
  *buildRealmFloraSteps(seed: number) {
    flora.starts++;
    for (let i = 0; i < flora.pieces; i++) {
      flora.clock.now += 2;
      yield;
    }
    return { group: { name: `realm-flora:${seed}` } };
  },
}));

import { FEATURE_SLICE_MS, ZoneFeatureBuilds } from '../src/render/zone_feature_builds';

type Record = { kind: string; ms: number; at: number };

function lane(opts: { stopped?: () => boolean; yieldSlice?: () => Promise<void> } = {}) {
  const records: Record[] = [];
  const builds = new ZoneFeatureBuilds({
    record: (kind, ms, at) => records.push({ kind, ms, at }),
    stopped: opts.stopped ?? (() => false),
    now: () => flora.clock.now,
    yieldSlice: opts.yieldSlice ?? (async () => undefined),
  });
  return { builds, records };
}

describe('zone feature builds', () => {
  it('prebuilds a stepped feature in slices and hands the view to the renderer', async () => {
    flora.starts = 0;
    const { builds, records } = lane();
    await builds.prebuild('dusk', 42);
    const run = vi.fn(() => ({ group: { name: 'built in one call' } }));
    const view = builds.build('buildRealmFlora', run);
    expect(view).toEqual({ group: { name: 'realm-flora:42' } });
    expect(run).not.toHaveBeenCalled();
    // 24 ms of pieces in slices of at most the budget plus one 2 ms piece.
    expect(records.length).toBeGreaterThan(1);
    expect(records.every((r) => r.kind === 'zone:features:buildRealmFlora')).toBe(true);
    expect(records.every((r) => r.ms <= FEATURE_SLICE_MS + 2)).toBe(true);
    expect(records.reduce((sum, r) => sum + r.ms, 0)).toBe(24);
    // Never prebuilt again once the renderer holds it.
    await builds.prebuild('dusk', 42);
    expect(flora.starts).toBe(1);
  });

  it('builds in one timed call when no prebuild ran (a gating prepare)', () => {
    const { builds, records } = lane();
    const run = vi.fn(() => {
      flora.clock.now += 30;
      return 'fen';
    });
    expect(builds.build('buildFenFeatures', run)).toBe('fen');
    expect(run).toHaveBeenCalledOnce();
    expect(records).toEqual([
      { kind: 'zone:features:buildFenFeatures', ms: 30, at: flora.clock.now - 30 },
    ]);
  });

  it('drops a prebuild still in flight when a gating prepare builds the feature first', async () => {
    let release!: () => void;
    let gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { builds } = lane({
      yieldSlice: async () => {
        await gate;
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    const pending = builds.prebuild('dusk', 1);
    expect(builds.build('buildRealmFlora', () => 'gating')).toBe('gating');
    release();
    await pending;
    // Nothing stale was parked: a later call builds again instead of
    // returning the abandoned prebuild.
    expect(builds.build('buildRealmFlora', () => 'again')).toBe('again');
  });

  it('shares one prebuild between concurrent prepares of the same biome', async () => {
    flora.starts = 0;
    const { builds } = lane();
    await Promise.all([builds.prebuild('dusk', 3), builds.prebuild('dusk', 3)]);
    expect(flora.starts).toBe(1);
  });

  it('stops a prebuild when the renderer shuts down, keeping nothing', async () => {
    let stopped = false;
    let slices = 0;
    const { builds } = lane({
      stopped: () => stopped,
      yieldSlice: async () => {
        if (++slices === 2) stopped = true;
      },
    });
    await builds.prebuild('dusk', 5);
    expect(builds.build('buildRealmFlora', () => 'rebuilt')).toBe('rebuilt');
  });

  it('prebuilds the Willowfen dressing too', async () => {
    const { builds } = lane();
    await builds.prebuild('fen', 9);
    expect(flora.fenStarts).toBe(1);
    expect(builds.build('buildFenFeatures', () => 'one call')).toEqual({
      group: { name: 'fen-features:9' },
    });
  });

  it('prebuilds the Palm Reach and Galecrest dressing too', async () => {
    const { builds } = lane();
    await builds.prebuild('jungle', 4);
    await builds.prebuild('gale', 4);
    expect(flora.otherStarts).toEqual(['jungle', 'gale']);
    expect(builds.build('buildJungleFeatures', () => 'one call')).toEqual({
      group: { name: 'jungle-features:4' },
    });
    expect(builds.build('buildGaleFeatures', () => 'one call')).toEqual({
      group: { name: 'gale-features:4' },
    });
  });

  it('prebuilds nothing for a biome without stepped builders', async () => {
    const { builds, records } = lane();
    await builds.prebuild('frost', 1);
    expect(records).toEqual([]);
  });

  it('is wired into the renderer: the prebuild runs beside terrain, every builder goes through it', () => {
    const src = readFileSync('src/render/renderer.ts', 'utf8');
    const features = src.indexOf('const features = (async () => {');
    const prebuild = src.indexOf(
      'if (idlePace) await this.featureBuilds.prebuild(zone.biome, this.sim.cfg.seed);',
      features,
    );
    const ensure = src.indexOf('this.ensureZoneFeatures(zone);', prebuild);
    const terrain = src.indexOf('await this.terrainView.ensureZone(', features);
    const joined = src.indexOf('const featureGroups = await features;', terrain);
    expect(features).toBeGreaterThan(0);
    // The prebuild is awaited inside the features task, which starts before
    // terrain and is joined after it: terrain never waits for the flora.
    expect(prebuild).toBeGreaterThan(features);
    expect(ensure).toBeGreaterThan(prebuild);
    expect(terrain).toBeGreaterThan(ensure);
    expect(joined).toBeGreaterThan(terrain);
    // A prebuild that ends because the renderer shut down builds nothing.
    const method = src.slice(src.indexOf('private ensureZoneFeatures(zone: ZoneDef): void {'));
    expect(method.slice(0, 120)).toContain('if (this.shutdownStarted) return;');
    expect(src).toContain('return this.featureBuilds.build(name, () => build(this.sim.cfg.seed));');
    // The ledger is read at call time, so a later wrapper (the orbit bench's
    // build capture) sees every zone feature build.
    expect(src).toContain('record: (kind, ms, atMs) => this.buildLedger.record(kind, ms, atMs),');
  });
});
