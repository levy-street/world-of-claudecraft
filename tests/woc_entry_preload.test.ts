// The WOC player files of world entry (src/render/characters/woc_entry_core.ts and
// woc_entry_preload.ts; the loading model in src/render/CLAUDE.md "Asset loading").
//
//   - The entry-critical set is the minimum to draw ANY player: both body fits' base and
//     animation library and both head cores, DERIVED from the manifest and the head catalog.
//   - Nothing of it starts on the launcher: it rides the DEFERRED preload lane, which opens
//     when the player presses Play, and assetsReady() then waits for it before the Renderer
//     exists. A critical file that cannot be fetched fails the entry.
//   - Nothing else of a player is asked for there: the hairstyles, the facial hair, the armor
//     sets and the under-armor atlases are the crowd prefetch's, after the first painted frame
//     (tests/woc_crowd_prefetch.test.ts).
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { VISUALS } from '../src/render/characters/manifest';
import {
  parseWocArmorPackUrl,
  WOC_SPLIT_DIR,
  wocAnimsUrl,
  wocBaseUrl,
} from '../src/render/characters/woc_armor_core';
import { wocCrowdHeadFileUrls } from '../src/render/characters/woc_crowd_prefetch_core';
import {
  wocEntryBodyUrls,
  wocEntryFits,
  wocEntryHeadCoreUrls,
  wocVisualKeys,
} from '../src/render/characters/woc_entry_core';
import { loadWocEntryFiles } from '../src/render/characters/woc_entry_preload';
import { wocHeadCoreUrl } from '../src/render/characters/woc_head_catalog';
import * as headStore from '../src/render/characters/woc_head_packs';
import { wocKeyedAnimsUrl } from '../src/render/characters/woc_keyed_animations';
import { ALL_CLASSES } from '../src/sim/types';

// The network, stubbed once for the file: the loader double keeps the real loader's contract
// (ONE promise per url however often and however it is asked for, a failed one evicted) and
// delegates to the wire the running test installed.
interface Wire {
  /** Every loadGltf call, in order, with the class it was asked at. */
  calls: { url: string; priority: string }[];
  /** How often a file was really put on the wire (a cache miss), however often asked for. */
  fetches(url: string): number;
  load(url: string, opts?: { priority?: string }): Promise<unknown>;
  land(url: string): void;
  fail(url: string): void;
}

const net = vi.hoisted(() => ({
  wire: null as null | { load(url: string, opts?: { priority?: string }): Promise<unknown> },
}));

vi.mock('../src/render/assets/loader', async () => {
  const three = await import('three');
  return {
    loadGltf: (url: string, opts?: { priority?: string }) => net.wire?.load(url, opts),
    // every other registrant of the lanes settles, so only the WOC files decide a wait
    loadTexture: async () => new three.Texture(),
    loadKtx2Texture: async () => new three.CompressedTexture([], 4, 4),
    releaseGltf: () => undefined,
    releaseTexture: () => undefined,
    releaseKtx2Texture: () => undefined,
  };
});

const parse = (): unknown => ({ scene: new THREE.Group(), animations: [] });

/** A fresh wire. Files matching `held` stay on it until the test lands or fails them; every
 *  other file lands at once. */
function installWire(held: (url: string) => boolean): Wire {
  const calls: Wire['calls'] = [];
  const fetched: string[] = [];
  const cache = new Map<string, Promise<unknown>>();
  const settle = new Map<string, { resolve: (g: unknown) => void; reject: (e: unknown) => void }>();
  const wire: Wire = {
    calls,
    fetches: (url) => fetched.filter((u) => u === url).length,
    load: (url, opts) => {
      calls.push({ url, priority: opts?.priority ?? 'demand' });
      let p = cache.get(url);
      if (!p) {
        fetched.push(url);
        p = held(url)
          ? new Promise((resolve, reject) => settle.set(url, { resolve, reject }))
          : Promise.resolve(parse());
        // a failed load leaves the cache, as the real loader evicts it
        p.catch(() => cache.delete(url));
        cache.set(url, p);
      }
      return p;
    },
    land: (url) => settle.get(url)?.resolve(parse()),
    fail: (url) => settle.get(url)?.reject(new Error(`asset load failed: ${url}`)),
  };
  net.wire = wire;
  return wire;
}

/** Whether a promise has settled by now (every chain already queued has run). */
async function settled(p: Promise<unknown>): Promise<'pending' | 'resolved' | 'rejected'> {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  p.then(
    () => {
      state = 'resolved';
    },
    () => {
      state = 'rejected';
    },
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return state;
}

const isWoc = (url: string): boolean => url.startsWith(`${WOC_SPLIT_DIR}/`);
const BODIES = wocEntryBodyUrls();
const CORES = wocEntryHeadCoreUrls();
const CRITICAL = [...BODIES, ...CORES];
/** The rest of the head library (every hairstyle and facial hair file): never entry's. */
const NOT_ENTRY = wocCrowdHeadFileUrls();

const publicPath = (url: string): string => path.resolve(__dirname, '..', 'public', url);
const bytes = (urls: readonly string[]): number =>
  urls.reduce((sum, url) => sum + statSync(publicPath(url)).size, 0);

describe('the WOC entry file sets (woc_entry_core.ts)', () => {
  it('covers every WOC body: both fits of every class', () => {
    const keys = wocVisualKeys();
    // every class ships a body of each fit, and each is a WOC def
    expect(keys).toHaveLength(ALL_CLASSES.length * 2);
    for (const cls of ALL_CLASSES) {
      expect(keys).toContain(`player_${cls}`);
      expect(keys).toContain(`player_${cls}_female`);
    }
    expect([...wocEntryFits()].sort()).toEqual(['female', 'male']);
  });

  // The Tideglass Colossus's Reflections are glass copies of each class's WOC body: the
  // same manifest and files, so they need nothing entry does not already hold, and they are
  // no player, so entry never prepares them.
  it('keeps the class-body Reflections out of the entry set, on files it already holds', () => {
    const critical = new Set([...wocEntryBodyUrls(), ...wocEntryHeadCoreUrls()]);
    for (const cls of ALL_CLASSES) {
      const key = `temple_reflection_${cls}`;
      const def = VISUALS[key];
      expect(def.wocCharacter, key).toBe(VISUALS[`player_${cls}`].wocCharacter);
      expect(def.tint, key).toBe(0x7fb2ff);
      expect(critical.has(def.url), key).toBe(true);
      expect(wocVisualKeys(), key).not.toContain(key);
    }
  });

  it('awaits the minimum to draw any player: each fit base, library and head core', () => {
    // named here from the file helpers, never from the list under test
    const bodies = (['male', 'female'] as const).flatMap((fit) => [
      wocBaseUrl(fit),
      wocAnimsUrl(fit),
      wocKeyedAnimsUrl(fit),
    ]);
    expect([...wocEntryBodyUrls()].sort()).toEqual([...bodies].sort());
    expect([...wocEntryHeadCoreUrls()].sort()).toEqual(
      [wocHeadCoreUrl('a'), wocHeadCoreUrl('b')].sort(),
    );
    // ...and it is what every WOC def builds from: no player body needs a file outside it
    const critical = new Set([...wocEntryBodyUrls(), ...wocEntryHeadCoreUrls()]);
    for (const key of wocVisualKeys()) {
      const def = VISUALS[key];
      for (const url of [def.url, ...(def.animUrls ?? [])]) {
        expect(critical.has(url), `${key} builds from ${url}`).toBe(true);
      }
      const type = def.wocCharacter?.fit === 'female' ? 'b' : 'a';
      expect(critical.has(wocHeadCoreUrl(type)), `${key} head core`).toBe(true);
    }
  });

  it('names only files that ship, and never an armor set or a hairstyle', () => {
    const all = [...wocEntryBodyUrls(), ...wocEntryHeadCoreUrls()];
    expect(all).toHaveLength(8);
    expect(NOT_ENTRY.length).toBeGreaterThan(0);
    for (const url of NOT_ENTRY) expect(all, url).not.toContain(url);
    for (const url of all) {
      expect(url.startsWith(`${WOC_SPLIT_DIR}/`), url).toBe(true);
      expect(parseWocArmorPackUrl(url), `${url} is an armor file`).toBeNull();
      expect(existsSync(publicPath(url)), `${url} is not on disk`).toBe(true);
      expect(MEDIA_ASSETS[url], `${url} is not in the media manifest`).toBeTruthy();
    }
  });

  it('keeps world entry lighter than the player bodies the release preloaded at boot', () => {
    // The release preloaded 10.58 MB of player bodies before the launcher drew (PR 4360
    // review, census). The whole entry-critical set is under half of that (each fit's
    // hand-keyed movement and autoattack library adds about 0.32 MB), and a player
    // arriving from the launcher already holds their own fit: the other fit is what is added.
    const critical = bytes([...wocEntryBodyUrls(), ...wocEntryHeadCoreUrls()]);
    expect(critical).toBeLessThan(5 * 1024 * 1024);
    const fitBytes = (fit: 'male' | 'female'): number =>
      bytes([
        wocBaseUrl(fit),
        wocAnimsUrl(fit),
        wocKeyedAnimsUrl(fit),
        wocHeadCoreUrl(fit === 'female' ? 'b' : 'a'),
      ]);
    expect(fitBytes('male') + fitBytes('female')).toBe(critical);
    expect(fitBytes('female')).toBeLessThan(2.75 * 1024 * 1024);
    expect(fitBytes('male')).toBeLessThan(2.25 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------------------
// The lane's task itself (woc_entry_preload.ts loadWocEntryFiles), over the real head store.
// ---------------------------------------------------------------------------------------

/** The character store's half: one deferred load per body file, landed or failed by the test. */
function bodyLoads() {
  const asked: string[] = [];
  const pending = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>();
  return {
    asked,
    load: (url: string): Promise<void> => {
      asked.push(url);
      return new Promise<void>((resolve, reject) => pending.set(url, { resolve, reject }));
    },
    land: (url: string) => pending.get(url)?.resolve(),
    fail: (url: string) => pending.get(url)?.reject(new Error(`asset load failed: ${url}`)),
  };
}

describe('loadWocEntryFiles', () => {
  let wire: Wire;
  let bodies: ReturnType<typeof bodyLoads>;
  const land = (url: string): void => (BODIES.includes(url) ? bodies.land(url) : wire.land(url));
  const fail = (url: string): void => (BODIES.includes(url) ? bodies.fail(url) : wire.fail(url));
  const asksOf = (url: string): string[] =>
    wire.calls.filter((c) => c.url === url).map((c) => c.priority);

  beforeEach(() => {
    headStore.resetWocHeadFilesForTest();
    wire = installWire(() => true);
    bodies = bodyLoads();
  });

  it('asks for the critical files at once, as demands, and for nothing else', async () => {
    void loadWocEntryFiles(bodies.load);
    // on the wire before the call returns: each body through the character store, each
    // head core through the head store
    expect([...bodies.asked].sort()).toEqual([...BODIES].sort());
    for (const url of CORES) expect(asksOf(url).length, url).toBeGreaterThan(0);
    // ...and nothing follows it: not a microtask later, not a task later
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // EVERY ask of a core is a demand, each fetched once
    for (const url of CORES) {
      expect(new Set(asksOf(url)), url).toEqual(new Set(['demand']));
      expect(wire.fetches(url), url).toBe(1);
    }
    // no hairstyle, no facial hair, no armor set: the rest of the crowd set waits for the
    // first painted frame (woc_crowd_prefetch.ts)
    for (const url of NOT_ENTRY) expect(asksOf(url), url).toEqual([]);
    expect([...new Set(wire.calls.map((c) => c.url))].sort()).toEqual([...CORES].sort());
  });

  it.each(CRITICAL)('settles only once %s, the last critical file, has landed', async (last) => {
    const task = loadWocEntryFiles(bodies.load);
    for (const url of CRITICAL) if (url !== last) land(url);
    expect(await settled(task)).toBe('pending');
    land(last);
    expect(await settled(task)).toBe('resolved');
    // the head cores are resident in the head store, where a build looks for them
    for (const url of CORES) expect(headStore.wocHeadFileResident(url), url).toBe(true);
    // and no hairstyle or beard was waited for (or asked for at all)
    for (const url of NOT_ENTRY) expect(headStore.wocHeadFileState(url), url).toBe('idle');
  });

  it.each(CRITICAL)('rejects when %s cannot be fetched', async (bad) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const task = loadWocEntryFiles(bodies.load);
    for (const url of CRITICAL) {
      if (url === bad) fail(url);
      else land(url);
    }
    await expect(task).rejects.toThrow(bad);
    errors.mockRestore();
  });

  it('asks for nothing that is already resident (a core the launcher fetched)', async () => {
    headStore.setWocHeadFileForTest(CORES[0], parse() as never);
    const task = loadWocEntryFiles(bodies.load);
    await Promise.resolve();
    expect(asksOf(CORES[0])).toEqual([]);
    // and the resident core is not waited for
    for (const url of CRITICAL) if (url !== CORES[0]) land(url);
    expect(await settled(task)).toBe('resolved');
  });
});

describe('loadWocHeadFile (the awaited load of one head file)', () => {
  const core = wocHeadCoreUrl('a');
  let wire: Wire;

  beforeEach(() => {
    headStore.resetWocHeadFilesForTest();
    wire = installWire(() => true);
  });

  it('resolves only once the file is resident in the store', async () => {
    const load = headStore.loadWocHeadFile(core);
    expect(await settled(load)).toBe('pending');
    expect(headStore.wocHeadFileState(core)).toBe('loading');
    wire.land(core);
    await expect(load).resolves.toBeUndefined();
    expect(headStore.wocHeadFileResident(core)).toBe(true);
    // a resident file answers at once, with no further ask of the loader
    const before = wire.calls.length;
    await expect(headStore.loadWocHeadFile(core)).resolves.toBeUndefined();
    expect(wire.calls.length).toBe(before);
  });

  it('shares the fetch a kick already started', async () => {
    headStore.ensureWocHeadFile(core);
    const load = headStore.loadWocHeadFile(core);
    wire.land(core);
    await expect(load).resolves.toBeUndefined();
    expect(headStore.wocHeadFileResident(core)).toBe(true);
    expect(wire.fetches(core)).toBe(1);
  });

  it('rejects when the fetch fails, and asks again at once however recent the failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = headStore.loadWocHeadFile(core);
    wire.fail(core);
    await expect(first).rejects.toThrow(core);
    expect(headStore.wocHeadFileState(core)).toBe('failed');
    // a kick sits out the cooldown...
    headStore.ensureWocHeadFile(core);
    expect(wire.fetches(core)).toBe(1);
    // ...an awaited ask does not: pressing Play is a new ask
    const second = headStore.loadWocHeadFile(core);
    expect(wire.fetches(core)).toBe(2);
    expect(headStore.wocHeadFileState(core)).toBe('loading');
    wire.land(core);
    await expect(second).resolves.toBeUndefined();
    expect(headStore.wocHeadFileResident(core)).toBe(true);
    errors.mockRestore();
  });
});

// ---------------------------------------------------------------------------------------
// The lanes: the task as characters/assets.ts registers it, through the REAL preload
// registry and the REAL character assets module (a fresh copy of each per case).
// ---------------------------------------------------------------------------------------

async function world() {
  vi.resetModules();
  const wire = installWire(isWoc);
  const preload = await import('../src/render/assets/preload');
  const assets = await import('../src/render/characters/assets');
  const heads = await import('../src/render/characters/woc_head_packs');
  return { wire, preload, assets, heads };
}

afterEach(() => {
  vi.resetModules();
});

describe('the WOC entry files ride the deferred lane', () => {
  it('starts nothing of them on the launcher', async () => {
    const { wire, preload } = await world();
    // importing the character assets is all the launcher does: the eager boot set is on
    // the wire, and no WOC file is
    expect(wire.calls.length).toBeGreaterThan(50);
    expect(wire.calls.filter((c) => isWoc(c.url))).toEqual([]);
    expect(preload.preloadInternalsForTest.begun()).toBe(false);
    expect(preload.preloadInternalsForTest.pendingDeferred()).toBeGreaterThan(0);
    // and the launcher's own gate neither waits for them nor fetches them
    await expect(preload.assetsReady()).resolves.toBeUndefined();
    expect(wire.calls.filter((c) => isWoc(c.url))).toEqual([]);
  });

  it('opens with the lane, and holds the entry for the critical files alone', async () => {
    const { wire, preload, assets, heads } = await world();
    preload.beginDeferredPreloads();
    const ready = preload.assetsReady();
    await Promise.resolve();
    const asked = new Map<string, Set<string>>();
    for (const call of wire.calls.filter((c) => isWoc(c.url))) {
      asked.set(call.url, (asked.get(call.url) ?? new Set()).add(call.priority));
    }
    for (const url of CRITICAL) expect(asked.get(url), url).toEqual(new Set(['demand']));
    // nothing else of the split files: no hairstyle and no armor set is fetched at entry
    expect([...asked.keys()].sort()).toEqual([...CRITICAL].sort());

    // all but one critical file landed: the Renderer must not be built yet
    for (const url of CRITICAL.slice(1)) wire.land(url);
    expect(await settled(ready)).toBe('pending');
    wire.land(CRITICAL[0]);
    expect(await settled(ready)).toBe('resolved');
    // both fits build from resident files, with their head cores in the head store
    for (const key of wocVisualKeys()) {
      expect(assets.visualAssetsResident(key, false), key).toBe(true);
    }
    for (const url of CORES) expect(heads.wocHeadFileResident(url), url).toBe(true);
    // and the entry settled without one hairstyle or beard being asked for
    for (const url of NOT_ENTRY) expect(heads.wocHeadFileState(url), url).toBe('idle');
  });

  it('fails the entry when a critical file cannot be fetched', async () => {
    const { wire, preload } = await world();
    preload.beginDeferredPreloads();
    const ready = preload.assetsReady();
    // a body file, through the character store's own failure path
    const bad = wocBaseUrl('female');
    for (const url of CRITICAL) {
      if (url === bad) wire.fail(url);
      else wire.land(url);
    }
    await expect(ready).rejects.toThrow(bad);
  });
});
