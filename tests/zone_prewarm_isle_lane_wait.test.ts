// A cold login on the Quartered Isle (iOS memory profile): the isle's creature
// bodies ride the paced isle lane (src/render/characters/rift_body_stream_core.ts,
// RiftBodyLanes, one fetch in flight), and the zone prewarm runs before that lane
// has fetched them. Before this the prewarm's mob arm (zone_prewarm_groups.ts
// buildEntityPrewarmGroup) asked visualAssetsResident WITH its fetch for every
// template, so each cold lane body went on the wire at once, outside the lane's
// pump; and the renderer then counted the zone as prewarmed although those
// templates were skipped, so nothing warmed them when their bodies landed.
//
// Pinned here, over the real asset store, the real lanes and the real wait
// (zone_prewarm_body_wait_core.ts), with only the GLB loader and the visual build
// stubbed: (a) the prewarm fetches no lane-held body, so the lane stays the only
// one putting them on the wire, one at a time; (b) each landing hands the zone
// back, the pass warms only the templates whose body is now resident, and the
// zone counts as prewarmed only once the last skipped body has landed. Plus the
// renderer wiring that feeds the wait (a source pin: the renderer is a thin
// consumer of these three calls).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity, ZoneDef } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

/** Two isle templates whose bodies only the isle draws (the isle lane, no Rift lane). */
const ISLE_TEMPLATES = ['rimeglass_bear', 'heatsworn_ember'] as const;
const ZONE = { id: 'quartered_isle' } as ZoneDef;

interface Call {
  url: string;
  priority: string;
}

/** The iOS profile over a loader whose loads wait on the wire until the test lands them. */
async function iosIsleWorld() {
  vi.resetModules();
  const calls: Call[] = [];
  const cache = new Map<string, Promise<unknown>>();
  const settle = new Map<string, { resolve: (g: unknown) => void; reject: (e: unknown) => void }>();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: (url: string, opts?: { priority?: string }) => {
      calls.push({ url, priority: opts?.priority ?? 'demand' });
      let p = cache.get(url);
      if (!p) {
        p = new Promise((resolve, reject) => settle.set(url, { resolve, reject }));
        // the loader's contract: a failed load is evicted, so the next ask refetches
        p.catch(() => cache.delete(url));
        cache.set(url, p);
      }
      return p;
    },
    loadTexture: () => new Promise(() => undefined),
    loadKtx2Texture: () => new Promise(() => undefined),
    releaseGltf: () => undefined,
  }));
  const built: string[] = [];
  vi.doMock('../src/render/characters', async (importOriginal) => {
    const THREE = await import('three');
    const actual = await importOriginal<typeof import('../src/render/characters')>();
    return {
      ...actual,
      createCharacterVisual: (e: { templateId: string }) => {
        built.push(e.templateId);
        return { root: new THREE.Group() };
      },
    };
  });
  const gfx = await import('../src/render/gfx');
  const restoreGfx = gfx.gfxInternalsForTest.overrideSettings({ iosMemoryProfile: true });
  const assets = await import('../src/render/characters/assets');
  const manifest = await import('../src/render/characters/manifest');
  const groups = await import('../src/render/zone_prewarm_groups');
  const land = async (url: string): Promise<void> => {
    settle.get(url)?.resolve({ scene: {}, animations: [] });
    await flush();
  };
  const fail = async (url: string): Promise<void> => {
    settle.get(url)?.reject(new Error(`asset load failed: ${url}`));
    await flush();
  };
  return { calls, built, land, fail, assets, manifest, groups, restoreGfx };
}

/** Run the promise chains and the zero-delay hand-back timers they queue. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

let restore: (() => void) | null = null;

afterEach(() => {
  vi.useRealTimers();
  restore?.();
  restore = null;
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/characters');
  vi.resetModules();
});

describe('a cold Quartered Isle login with two lane-held bodies unresolved', () => {
  it('keeps the bodies inside the lane, and warms the zone only once both have landed', async () => {
    const world = await iosIsleWorld();
    restore = world.restoreGfx;
    const { calls, built, land, assets, manifest, groups } = world;
    // The boot gate settles (the curtain's wait); the streamed bodies are not in it.
    for (const { url } of [...calls]) await land(url);
    const mobKey = (templateId: string) =>
      manifest.visualKeyFor({ kind: 'mob', templateId } as Entity);
    const bodyUrls = ISLE_TEMPLATES.map((id) => manifest.VISUALS[mobKey(id)].url);
    // a precondition, not the claim: both bodies are lane-held and still cold
    for (const url of bodyUrls)
      expect(
        calls.some((c) => c.url === url),
        url,
      ).toBe(false);
    for (const id of ISLE_TEMPLATES)
      expect(assets.visualAssetsResident(mobKey(id), false)).toBe(false);

    // The renderer's prewarmZoneAt, as its three calls into the wait drive it.
    const prewarmedZones = new Set<string>();
    const prewarmedMobTemplates = new Set<string>();
    const host = {
      sim: { player: { pos: { x: 0, y: 0, z: 0 } }, cfg: { playerClass: 'warrior' } },
      prewarmEntity: (kind: string, templateId: string) => ({ kind, templateId }) as Entity,
      storePooledObject: () => {},
      templateIdsInZone: () => [...ISLE_TEMPLATES],
      prewarmedMobTemplates,
      prewarmedNpcModels: new Set<string>(),
    };
    let passes = 0;
    const renderer = {
      async prewarmZoneAt(x: number, z: number): Promise<void> {
        if (wait.skips(ZONE.id)) return;
        passes++;
        const mob = groups.buildEntityPrewarmGroup(host, ZONE);
        wait.settle(ZONE.id, x, z, mob.coldKeys);
      },
    };
    const wait = groups.createZoneBodyWait(prewarmedZones, renderer);
    const off = assets.onCharacterAssetReady(() => wait.bodyArrived());

    // The entry prewarm runs under the curtain, before the first painted frame.
    await renderer.prewarmZoneAt(0, 0);
    // (a) neither body went on the wire: the prewarm only asked
    for (const url of bodyUrls)
      expect(
        calls.some((c) => c.url === url),
        url,
      ).toBe(false);
    expect(built).toEqual([]);
    // the zone is NOT prewarmed: it waits on the two bodies it skipped
    expect(prewarmedZones.has(ZONE.id)).toBe(false);
    expect(wait.waitingZoneIds()).toEqual([ZONE.id]);
    // and a zone-streaming call meanwhile runs no empty pass (nor asks for a fetch)
    await renderer.prewarmZoneAt(0, 0);
    expect(passes).toBe(1);

    // First painted frame, then the player is within reach of the isle: the lane opens.
    const beforeLane = calls.length;
    assets.startStreamedCharacterPreloads();
    const isle = { x: 0, z: 0 };
    const { QUARTERED_ISLE_ZONE } = await import('../src/sim/content/quartered_isle');
    isle.x = ((QUARTERED_ISLE_ZONE.xMin ?? 0) + (QUARTERED_ISLE_ZONE.xMax ?? 0)) / 2;
    isle.z = (QUARTERED_ISLE_ZONE.zMin + QUARTERED_ISLE_ZONE.zMax) / 2;
    const poll = () =>
      assets.pollRiftCharacterStream({
        riftFloor: null,
        treasureMap: null,
        player: { level: 1, pos: isle },
        entities: new Map(),
        entityRosterVersion: 0,
      });
    poll();

    // Walk the lane: land each body it puts on the wire, one at a time.
    const laneFetches: string[] = [];
    const warmedAt: Record<string, number> = {};
    for (let guard = 0; guard < 64; guard++) {
      const inFlight = calls
        .slice(beforeLane)
        // the post-entry stream asks at background priority; the lane as a demand
        .filter((c) => c.priority === 'demand')
        .map((c) => c.url)
        .filter((url) => !laneFetches.includes(url));
      // pacing: the lane holds at most one fetch in flight
      expect(inFlight.length).toBeLessThanOrEqual(1);
      if (inFlight.length === 0) break;
      laneFetches.push(inFlight[0]);
      await land(inFlight[0]);
      for (const id of ISLE_TEMPLATES)
        if (prewarmedMobTemplates.has(id) && warmedAt[id] === undefined)
          warmedAt[id] = laneFetches.length;
      // (b) the zone counts as prewarmed only once BOTH skipped bodies are resident
      const bothLanded = bodyUrls.every((url) => laneFetches.includes(url));
      expect(prewarmedZones.has(ZONE.id), `after ${inFlight[0]}`).toBe(bothLanded);
      poll();
    }
    off();

    // every isle body came through the lane, and each exactly once
    for (const url of bodyUrls) {
      expect(laneFetches).toContain(url);
      expect(calls.filter((c) => c.url === url)).toHaveLength(1);
    }
    // each template was warmed by the pass its own body's landing handed back
    for (const [i, id] of ISLE_TEMPLATES.entries())
      expect(warmedAt[id], id).toBe(laneFetches.indexOf(bodyUrls[i]) + 1);
    // built once each (neither is a pooled common template), nothing rebuilt
    expect([...built].sort()).toEqual([...ISLE_TEMPLATES].sort());
    expect(prewarmedZones.has(ZONE.id)).toBe(true);
    expect(wait.waitingZoneIds()).toEqual([]);
  });

  it('a lane fetch that fails is asked for again, and the zone still settles when it lands', async () => {
    vi.useFakeTimers();
    const world = await iosIsleWorld();
    restore = world.restoreGfx;
    const { calls, built, land, fail, assets, manifest, groups } = world;
    for (const { url } of [...calls]) await land(url);
    const key = manifest.visualKeyFor({ kind: 'mob', templateId: 'rimeglass_bear' } as Entity);
    const bodyUrl = manifest.VISUALS[key].url;
    const prewarmedZones = new Set<string>();
    const host = {
      sim: { player: { pos: { x: 0, y: 0, z: 0 } }, cfg: { playerClass: 'warrior' } },
      prewarmEntity: (kind: string, templateId: string) => ({ kind, templateId }) as Entity,
      storePooledObject: () => {},
      templateIdsInZone: () => ['rimeglass_bear'],
      prewarmedMobTemplates: new Set<string>(),
      prewarmedNpcModels: new Set<string>(),
    };
    const renderer = {
      async prewarmZoneAt(x: number, z: number): Promise<void> {
        if (wait.skips(ZONE.id)) return;
        wait.settle(ZONE.id, x, z, groups.buildEntityPrewarmGroup(host, ZONE).coldKeys);
      },
    };
    const wait = groups.createZoneBodyWait(prewarmedZones, renderer);
    const off = assets.onCharacterAssetReady(() => wait.bodyArrived());
    await renderer.prewarmZoneAt(0, 0);
    expect(wait.waitingZoneIds()).toEqual([ZONE.id]);

    const beforeLane = calls.length;
    assets.startStreamedCharacterPreloads();
    const { QUARTERED_ISLE_ZONE: isle } = await import('../src/sim/content/quartered_isle');
    const pos = { x: ((isle.xMin ?? 0) + (isle.xMax ?? 0)) / 2, z: (isle.zMin + isle.zMax) / 2 };
    const poll = () =>
      assets.pollRiftCharacterStream({
        riftFloor: null,
        treasureMap: null,
        player: { level: 1, pos },
        entities: new Map(),
        entityRosterVersion: 0,
      });
    // The lane walks its whole list: the bear's fetch fails, every other lands.
    const walked: string[] = [];
    poll();
    for (let guard = 0; guard < 64; guard++) {
      const next = calls
        .slice(beforeLane)
        .filter((c) => c.priority === 'demand' && !walked.includes(c.url))[0];
      if (!next) break;
      walked.push(next.url);
      if (next.url === bodyUrl) await fail(next.url);
      else await land(next.url);
      poll();
    }
    expect(walked).toContain(bodyUrl);
    // the lane has moved on and will not fetch it again; the zone still waits
    expect(assets.visualAssetsResident(key, false)).toBe(false);
    expect(prewarmedZones.has(ZONE.id)).toBe(false);
    expect(wait.settledOrWaiting(ZONE.id)).toBe(true);
    expect(calls.filter((c) => c.url === bodyUrl)).toHaveLength(1);

    // the store asks for the awaited file again after its cooldown...
    await vi.advanceTimersByTimeAsync(8_000);
    expect(calls.filter((c) => c.url === bodyUrl)).toHaveLength(2);
    // ...and its landing warms the bear and settles the zone
    await land(bodyUrl);
    expect(built).toEqual(['rimeglass_bear']);
    expect(prewarmedZones.has(ZONE.id)).toBe(true);
    expect(wait.waitingZoneIds()).toEqual([]);
    off();
  });

  it('a paced ask leaves a lane-held body alone, where the unpaced ask fetches it', async () => {
    const world = await iosIsleWorld();
    restore = world.restoreGfx;
    const { calls, assets, manifest } = world;
    const [bear, ember] = ISLE_TEMPLATES.map((templateId) =>
      manifest.visualKeyFor({ kind: 'mob', templateId } as Entity),
    );
    expect(assets.visualAssetsResident(bear, true, true)).toBe(false);
    expect(calls.some((c) => c.url === manifest.VISUALS[bear].url)).toBe(false);
    // the old prewarm ask: straight onto the wire, around the lane
    expect(assets.visualAssetsResident(ember)).toBe(false);
    expect(calls.filter((c) => c.url === manifest.VISUALS[ember].url)).toHaveLength(1);
  });
});

describe('the renderer feeds the wait', () => {
  const renderer = stripComments(
    readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
  );

  it('skips a waiting zone, settles each pass with its cold keys, and hears every arrival', () => {
    const method = renderer.slice(renderer.indexOf('  async prewarmZoneAt('));
    const body = method.slice(0, method.indexOf('\n  }\n'));
    expect(body).toContain('if (zoneId === null || this.zoneBodyWait.skips(zoneId)) return;');
    expect(body).toContain('this.zoneBodyWait.settle(zoneId, x, z, mobPrewarm.coldKeys);');
    // only settle writes the record: no pass marks a zone prewarmed past the wait
    expect(renderer).not.toContain('this.prewarmedZonePrograms.add(');
    // the entry prewarm settles its mob arm's cold keys the same way
    expect(renderer).toContain('entityPrewarmCold = built.coldKeys;');
    expect(renderer).toContain(
      'this.zoneBodyWait.settle(activeZone.id, p.pos.x, p.pos.z, entityPrewarmCold);',
    );
    // before the weapon-skin filter drops creature bodies
    const ready = renderer.slice(renderer.indexOf('private readonly onCharacterAssetReady'));
    expect(ready.indexOf('this.zoneBodyWait.bodyArrived();')).toBeGreaterThan(-1);
    expect(ready.indexOf('this.zoneBodyWait.bodyArrived();')).toBeLessThan(
      ready.indexOf('if (!isWeaponSkinModelUrl(url)) return;'),
    );
    // a context loss forgets the wait with the records it guards
    const records = renderer.slice(renderer.indexOf('zoneProgramRecords: () => ['));
    expect(records.slice(0, records.indexOf('],'))).toContain('this.zoneBodyWait');
  });
});
