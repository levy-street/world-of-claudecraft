import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// renderer.ts's side of the Drakelands kit lane (drakelands_kit_lane.ts). A
// real Renderer needs a WebGL context no unit test has, so the lane and the
// build guard are tested directly (tests/drakelands_kit_lane.test.ts) and this
// pins the CONTRACT only the coordinator can break: the zone prepare starts the
// kit beside its terrain and awaits it before any feature builds, so the
// fortress (whose colliders the sim builds from the same placement table) is
// never built from missing templates, and a failed load leaves the zone
// unprepared for the next prepare to retry instead of skipping the features.
const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

function slice(startText: string, endText: string): string {
  const start = source.indexOf(startText);
  expect(start, startText).toBeGreaterThan(-1);
  const end = source.indexOf(endText, start);
  expect(end, endText).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('renderer Drakelands kit seam', () => {
  const prepare = slice('  prepareZoneAt(', '\n  /** Stage wall-times');

  it('starts the kit load with the zone prepare, beside the terrain build', () => {
    const loadAt = prepare.indexOf('const kitLoad = drakelandsKitLoadFor(zone.biome);');
    const terrainAt = prepare.indexOf('await this.terrainView.ensureZone(');
    expect(loadAt).toBeGreaterThan(-1);
    expect(terrainAt).toBeGreaterThan(loadAt);
    expect(source.match(/drakelandsKitLoadFor\(/g)?.length).toBe(1);
  });

  it('awaits the kit before the features build and before the zone counts as prepared', () => {
    const terrainAt = prepare.indexOf('await this.terrainView.ensureZone(');
    const awaitAt = prepare.indexOf('if (kitLoad) await kitLoad;');
    const buildAt = prepare.indexOf('this.ensureZoneFeatures(zone);');
    const preparedAt = prepare.indexOf('this.preparedZones.add(zone.id);');
    expect(awaitAt).toBeGreaterThan(terrainAt);
    expect(buildAt).toBeGreaterThan(awaitAt);
    expect(preparedAt).toBeGreaterThan(buildAt);
    // Nothing swallows a failed load between the await and the zone's
    // residency: the rejection must reach the caller so the zone stays
    // unprepared and the next prepare retries the load.
    expect(prepare.slice(0, preparedAt)).not.toMatch(/kitLoad[^;]*\.catch\(/);
    expect(prepare.slice(awaitAt, buildAt)).not.toMatch(/\bcatch\b/);
  });

  it('builds zone features from that one prepare only', () => {
    expect(source.match(/this\.ensureZoneFeatures\(/g)?.length).toBe(1);
    expect(source.match(/\bbuildEmberFeatures\b/g)?.length).toBe(3);
    expect(source).toContain(
      "this.emberFeatures = this.timedBuild('buildEmberFeatures', buildEmberFeatures);",
    );
  });

  it('prefetches and holds on the zone-streaming recheck cadence, with the prepare queue inputs', () => {
    const body = slice(
      'private queueVisibleZonePrepares(horizon: number): void {',
      '\n  private evictFarZoneIfConstrained(',
    );
    const guardAt = body.indexOf(
      'if (!claimZoneStreamRecheck(this.visibleZoneCheck, cameraX, cameraZ, horizon)) return;',
    );
    const zonesAt = body.indexOf('const zones = this.sim.cfg.world?.zones ?? ZONES;');
    const recheckAt = body.indexOf(
      'const kitHolds = drakelandsKitRecheck(zones, cameraX, cameraZ, horizon, this.visibleZoneCheck);',
    );
    const nearAt = body.indexOf(
      'const near = zonesWithinStreamingHorizon(zones, cameraX, cameraZ, horizon, forwardX, forwardZ);',
    );
    expect(guardAt).toBeGreaterThan(-1);
    expect(zonesAt).toBeGreaterThan(guardAt);
    expect(recheckAt).toBeGreaterThan(zonesAt);
    // Same zones and the same horizon as the prepare queue it leads.
    expect(nearAt).toBeGreaterThan(recheckAt);
    expect(source.match(/drakelandsKitRecheck\(/g)?.length).toBe(1);
  });

  it('keeps a zone that awaits the kit out of the one-at-a-time lane', () => {
    // A prepare awaiting a download would hold the lane, and every zone queued
    // behind it would stay unprepared: the queue filters it out instead, and
    // the paths that must build it now call prepareZoneAt directly.
    const body = slice(
      'private queueVisibleZonePrepares(horizon: number): void {',
      '\n  private evictFarZoneIfConstrained(',
    );
    const queue = body.slice(body.indexOf('this.visibleZonePrepareQueue = near.filter('));
    expect(queue).toContain('!this.preparedZones.has(zone.id) &&');
    expect(queue).toContain('!this.pendingZonePrepares.has(zone.id) &&');
    expect(queue).toContain('!kitHolds(zone.biome),');
    expect(queue.indexOf('!kitHolds(zone.biome),')).toBeLessThan(
      queue.indexOf('this.pumpVisibleZonePrepareQueue();'),
    );
  });
});
