// The crowd prefetch (src/render/characters/woc_crowd_prefetch_core.ts and
// woc_crowd_prefetch.ts; step two of the loading model in src/render/CLAUDE.md "Asset
// loading"): right after the first painted world frame the rest of the crowd set is fetched
// ahead of need, as background work, on a profile with the memory for it.
//
//   - WHAT: every hairstyle and facial hair file, every shipped armor set of both fits at the
//     tier other characters draw, every under-armor atlas. Derived from the catalogs. Never
//     a top file, never an entry-critical file.
//   - WHO: nobody on a constrained profile (phones, iOS): nothing is prefetched there.
//   - HOW: background loads, once per plan; a file a body asks for meanwhile is promoted on
//     the same fetch; a failed prefetch costs its first wearer nothing.
//   - WHEN: from startStreamedCharacterPreloads (the first painted frame), never on the
//     launcher and never when the entry lane opens.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { WOC_SHIPPED_SETS } from '../src/render/characters/woc_armor_catalog';
import {
  parseWocArmorPackUrl,
  WOC_SPLIT_DIR,
  wocArmorPackUrl,
} from '../src/render/characters/woc_armor_core';
import {
  wocCrowdHeadFileUrls,
  wocCrowdPrefetchPlan,
  wocCrowdPrefetchSignature,
} from '../src/render/characters/woc_crowd_prefetch_core';
import { wocEntryBodyUrls, wocEntryHeadCoreUrls } from '../src/render/characters/woc_entry_core';
import {
  WOC_HEAD_TYPES,
  wocHeadAllUrls,
  wocHeadCoreUrl,
  wocHeadPieceUrl,
} from '../src/render/characters/woc_head_catalog';

// The network, stubbed once for the file: the loader double keeps the real loader's contract
// (ONE promise per url however often and however it is asked for, a failed one evicted) and
// records the class every ask was made at.
interface Wire {
  /** Every loadGltf call, in order, with the class it was asked at. */
  calls: { url: string; priority: string }[];
  /** Every loadKtx2Texture call, in order, with the class it was asked at. */
  textures: { url: string; priority: string }[];
  /** How often a file was really put on the wire (a cache miss), however often asked for. */
  fetches(url: string): number;
  load(url: string, opts?: { priority?: string }): Promise<unknown>;
  land(url: string): void;
  fail(url: string): void;
}

const net = vi.hoisted(() => ({
  wire: null as null | {
    textures: { url: string; priority: string }[];
    load(url: string, opts?: { priority?: string }): Promise<unknown>;
  },
}));

vi.mock('../src/render/assets/loader', async () => {
  const three = await import('three');
  return {
    loadGltf: (url: string, opts?: { priority?: string }) => net.wire?.load(url, opts),
    loadTexture: async () => new three.Texture(),
    loadKtx2Texture: async (url: string, opts?: { priority?: string }) => {
      net.wire?.textures.push({ url, priority: opts?.priority ?? 'demand' });
      return new three.CompressedTexture([], 4, 4);
    },
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
  const textures: Wire['textures'] = [];
  const fetched: string[] = [];
  const cache = new Map<string, Promise<unknown>>();
  const settle = new Map<string, { resolve: (g: unknown) => void; reject: (e: unknown) => void }>();
  const wire: Wire = {
    calls,
    textures,
    fetches: (url) => fetched.filter((u) => u === url).length,
    load: (url, opts) => {
      calls.push({ url, priority: opts?.priority ?? 'demand' });
      let p = cache.get(url);
      if (!p) {
        fetched.push(url);
        p = held(url)
          ? new Promise((resolve, reject) => settle.set(url, { resolve, reject }))
          : Promise.resolve(parse());
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

const isWoc = (url: string): boolean => url.startsWith(`${WOC_SPLIT_DIR}/`);
const publicPath = (url: string): string => path.resolve(__dirname, '..', 'public', url);
const bytes = (urls: readonly string[]): number =>
  urls.reduce((sum, url) => sum + statSync(publicPath(url)).size, 0);
/** The KTX2 sibling an under-armor atlas url is served as (loadSkinTexInto). */
const ktx2Of = (url: string): string => `${url.slice(0, -'.png'.length)}.ktx2`;

const DESKTOP_HIGH = { tier: 'high', constrainedMemory: false };
const DESKTOP_MEDIUM = { tier: 'medium', constrainedMemory: false };
const DESKTOP_LOW = { tier: 'low', constrainedMemory: false };
const PHONE = { tier: 'high', constrainedMemory: true };

const FITS = ['male', 'female'] as const;
const ENTRY = new Set([...wocEntryBodyUrls(), ...wocEntryHeadCoreUrls()]);

describe('the crowd prefetch plan (woc_crowd_prefetch_core.ts)', () => {
  it('fetches every hairstyle and facial hair file: the head library less its cores', () => {
    const hair = wocCrowdHeadFileUrls();
    for (const type of ['a', 'b'] as const) {
      // the whole split library of a type is its core plus what the prefetch names
      expect(
        [...hair.filter((u) => u.includes(`head_type_${type}_`)), wocHeadCoreUrl(type)].sort(),
      ).toEqual([...wocHeadAllUrls(type)].sort());
      // and every pick the face builder offers resolves into it (or to no file)
      for (const slot of ['hair', 'beard'] as const) {
        for (const variant of WOC_HEAD_TYPES[type].slots[slot]) {
          const url = wocHeadPieceUrl(type, slot, variant.id);
          if (url) expect(hair, `${type} ${slot} ${variant.id}`).toContain(url);
        }
      }
    }
    expect(new Set(hair).size).toBe(hair.length);
    expect(wocCrowdPrefetchPlan(DESKTOP_HIGH).headFiles).toEqual(hair);
  });

  it.each([
    ['high', DESKTOP_HIGH, 'medium'],
    ['medium', DESKTOP_MEDIUM, 'medium'],
    ['low', DESKTOP_LOW, 'low'],
  ] as const)(
    'fetches every shipped set of both fits at the tier a crowd draws on the %s preset',
    (_name, profile, tier) => {
      const plan = wocCrowdPrefetchPlan(profile);
      // named here from the catalog and the url helper, never from the list under test
      const expected = FITS.flatMap((fit) =>
        WOC_SHIPPED_SETS.map((set) => wocArmorPackUrl(fit, set, tier)),
      );
      expect([...plan.armorPacks].sort()).toEqual([...expected].sort());
      expect(plan.armorPacks).toHaveLength(18);
      for (const url of plan.armorPacks) {
        expect(parseWocArmorPackUrl(url)?.tier, url).toBe(tier);
        // the top detail of a set is the local player's and the previews': never prefetched
        expect(url.endsWith('_top.glb'), url).toBe(false);
      }
      expect(wocCrowdPrefetchSignature(profile)).toBe(tier);
    },
  );

  it('fetches the under-armor atlas of every class body that wears one', () => {
    const atlases = wocCrowdPrefetchPlan(DESKTOP_HIGH).underArmorAtlases;
    // eight classes of two fits: the warrior's suit has no cloth under its plate
    expect(atlases).toHaveLength(16);
    expect(new Set(atlases).size).toBe(16);
    for (const url of atlases) {
      expect(url).toMatch(/^textures\/skins\/woc\/(female_)?[a-z]+_underarmor\.png$/);
      expect(url.includes('warrior'), url).toBe(false);
    }
    // the same atlases whatever the preset: they have one tier
    expect(wocCrowdPrefetchPlan(DESKTOP_LOW).underArmorAtlases).toEqual(atlases);
  });

  it('prefetches nothing on a constrained profile, whatever its preset', () => {
    for (const tier of ['low', 'medium', 'high']) {
      const plan = wocCrowdPrefetchPlan({ tier, constrainedMemory: true });
      expect(plan.headFiles).toEqual([]);
      expect(plan.armorPacks).toEqual([]);
      expect(plan.underArmorAtlases).toEqual([]);
    }
    expect(wocCrowdPrefetchSignature(PHONE)).toBe('none');
    // the iOS memory profile is a phone even where only that flag is set
    const ios = { tier: 'high', constrainedMemory: false, iosMemoryProfile: true };
    expect(wocCrowdPrefetchPlan(ios)).toEqual(wocCrowdPrefetchPlan(PHONE));
    expect(wocCrowdPrefetchSignature(ios)).toBe('none');
  });

  it('prefetches nothing for a browser that asks to save data, on any preset', () => {
    for (const tier of ['low', 'medium', 'high']) {
      const saver = { tier, constrainedMemory: false, saveData: true };
      expect(wocCrowdPrefetchPlan(saver)).toEqual(wocCrowdPrefetchPlan(PHONE));
      expect(wocCrowdPrefetchSignature(saver)).toBe('none');
    }
    // the hint switched off (or unknown) is the plain desktop plan
    expect(wocCrowdPrefetchPlan({ ...DESKTOP_HIGH, saveData: false })).toEqual(
      wocCrowdPrefetchPlan(DESKTOP_HIGH),
    );
  });

  it('names only files that ship, and nothing world entry already loaded', () => {
    for (const profile of [DESKTOP_HIGH, DESKTOP_LOW]) {
      const plan = wocCrowdPrefetchPlan(profile);
      for (const url of [...plan.headFiles, ...plan.armorPacks]) {
        expect(isWoc(url), url).toBe(true);
        expect(ENTRY.has(url), `${url} is entry-critical`).toBe(false);
        expect(existsSync(publicPath(url)), `${url} is not on disk`).toBe(true);
        expect(MEDIA_ASSETS[url], `${url} is not in the media manifest`).toBeTruthy();
      }
      for (const url of plan.underArmorAtlases) {
        expect(existsSync(publicPath(ktx2Of(url))), `${ktx2Of(url)} is not on disk`).toBe(true);
      }
    }
  });

  it('stays the size the review priced: the crowd set less what entry loaded', () => {
    // PR 4360 review, "A new loading model": 13.41 MB on Low and 20.77 MB above for
    // everything it takes to draw any other player, of which world entry now loads 4.43 MB.
    const size = (profile: { tier: string; constrainedMemory: boolean }): number => {
      const plan = wocCrowdPrefetchPlan(profile);
      return (
        bytes(plan.headFiles) + bytes(plan.armorPacks) + bytes(plan.underArmorAtlases.map(ktx2Of))
      );
    };
    const MB = 1024 * 1024;
    expect(size(DESKTOP_LOW)).toBeLessThan(9.25 * MB);
    expect(size(DESKTOP_HIGH)).toBeLessThan(16.75 * MB);
    expect(size(DESKTOP_HIGH)).toBeGreaterThan(size(DESKTOP_LOW));
  });
});

// ---------------------------------------------------------------------------------------
// The runner (woc_crowd_prefetch.ts), over the real head store and the real armor store.
// ---------------------------------------------------------------------------------------

async function runner() {
  vi.resetModules();
  const wire = installWire(() => true);
  const prefetch = await import('../src/render/characters/woc_crowd_prefetch');
  const heads = await import('../src/render/characters/woc_head_packs');
  const armor = await import('../src/render/characters/woc_armor_packs');
  const atlases: string[] = [];
  const start = (profile: { tier: string; constrainedMemory: boolean }): number =>
    prefetch.startWocCrowdPrefetch(profile, (url) => atlases.push(url));
  const asksOf = (url: string): string[] =>
    wire.calls.filter((c) => c.url === url).map((c) => c.priority);
  return { wire, prefetch, heads, armor, atlases, start, asksOf };
}

afterEach(() => {
  vi.resetModules();
});

describe('startWocCrowdPrefetch', () => {
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logged.mockRestore();
  });

  it('asks for the whole plan once, every model as background work', async () => {
    const r = await runner();
    const plan = wocCrowdPrefetchPlan(DESKTOP_HIGH);
    expect(r.prefetch.wocCrowdPrefetchStarted()).toBe(false);
    const asked = r.start(DESKTOP_HIGH);
    expect(asked).toBe(
      plan.headFiles.length + plan.armorPacks.length + plan.underArmorAtlases.length,
    );
    expect(r.prefetch.wocCrowdPrefetchStarted()).toBe(true);
    // each hairstyle, beard and armor pack exactly once, and never as a demand: one stray
    // demand would put a file nobody is waiting for ahead of one somebody is
    for (const url of [...plan.headFiles, ...plan.armorPacks]) {
      expect(r.asksOf(url), url).toEqual(['background']);
      expect(r.wire.fetches(url), url).toBe(1);
    }
    // nothing else on the wire: no top file, no base, no head core
    expect([...new Set(r.wire.calls.map((c) => c.url))].sort()).toEqual(
      [...plan.headFiles, ...plan.armorPacks].sort(),
    );
    // the atlases go to their own store's loader
    expect([...r.atlases].sort()).toEqual([...plan.underArmorAtlases].sort());
  });

  it('runs once per plan: a second ask on the same profile starts nothing', async () => {
    const r = await runner();
    r.start(DESKTOP_HIGH);
    const calls = r.wire.calls.length;
    const atlases = r.atlases.length;
    expect(r.start(DESKTOP_HIGH)).toBe(0);
    // the high and the medium preset draw a crowd at the same tier: the same plan
    expect(r.start(DESKTOP_MEDIUM)).toBe(0);
    expect(r.wire.calls.length).toBe(calls);
    expect(r.atlases.length).toBe(atlases);
  });

  it('plans again when a preset change moves the tier a crowd draws, fetching no file twice', async () => {
    const r = await runner();
    r.start(DESKTOP_HIGH);
    const medium = wocCrowdPrefetchPlan(DESKTOP_HIGH);
    const low = wocCrowdPrefetchPlan(DESKTOP_LOW);
    expect(r.start(DESKTOP_LOW)).toBeGreaterThan(0);
    for (const url of low.armorPacks) {
      expect(r.asksOf(url), url).toEqual(['background']);
      expect(r.wire.fetches(url), url).toBe(1);
    }
    // what the first plan already asked for is on one fetch still
    for (const url of [...medium.armorPacks, ...medium.headFiles]) {
      expect(r.wire.fetches(url), url).toBe(1);
    }
  });

  it('asks for nothing at all on a constrained profile', async () => {
    const r = await runner();
    expect(r.start(PHONE)).toBe(0);
    expect(r.wire.calls).toEqual([]);
    expect(r.atlases).toEqual([]);
  });

  it('asks for nothing under the Save-Data hint, read off the browser by the runner', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    try {
      const r = await runner();
      expect(r.start(DESKTOP_HIGH)).toBe(0);
      expect(r.wire.calls).toEqual([]);
      expect(r.atlases).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
    // the hint absent (or false): the plan runs
    vi.stubGlobal('navigator', { connection: { saveData: false } });
    try {
      const plain = await runner();
      expect(plain.start(DESKTOP_HIGH)).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks for nothing with the prefetch switched off (?woccrowdprefetch=off), and never counts as started', async () => {
    // render_dev_flags reads location once at module load: the runner imports it fresh
    vi.stubGlobal('location', { search: '?woccrowdprefetch=off' });
    try {
      const r = await runner();
      expect(r.prefetch.WOC_CROWD_PREFETCH_FLAG).toBe('woccrowdprefetch');
      expect(r.start(DESKTOP_HIGH)).toBe(0);
      expect(r.wire.calls).toEqual([]);
      expect(r.atlases).toEqual([]);
      // not started: a later graphics change re-plans nothing either
      expect(r.prefetch.wocCrowdPrefetchStarted()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    // the flag is the only thing that stopped it
    const on = await runner();
    expect(on.start(DESKTOP_HIGH)).toBeGreaterThan(0);
  });

  it('hands a prefetched hair file to the head store when it lands, with no second fetch', async () => {
    const r = await runner();
    r.start(DESKTOP_HIGH);
    const [hair, other] = wocCrowdHeadFileUrls();
    expect(r.heads.wocHeadFileState(hair)).toBe('idle');
    r.wire.land(hair);
    await vi.waitFor(() => expect(r.heads.wocHeadFileResident(hair)).toBe(true));
    expect(r.wire.fetches(hair)).toBe(1);
    expect(r.heads.wocHeadFileState(other)).toBe('idle');
  });

  it('lets a wearer ask for a hair file the prefetch still holds: a demand, on the same fetch', async () => {
    const r = await runner();
    r.start(DESKTOP_HIGH);
    const hair = wocCrowdHeadFileUrls()[2];
    const before = r.wire.calls.length;
    // the first body that wears it asks the store, which asks the loader as a demand: that
    // is what moves the waiting background load up (tests/render_asset_load_priority.test.ts)
    r.heads.ensureWocHeadFile(hair);
    expect(r.wire.calls.slice(before)).toEqual([{ url: hair, priority: 'demand' }]);
    expect(r.heads.wocHeadFileState(hair)).toBe('loading');
    r.wire.land(hair);
    await vi.waitFor(() => expect(r.heads.wocHeadFileResident(hair)).toBe(true));
    expect(r.wire.fetches(hair)).toBe(1);
  });

  it('never lets a failed hair prefetch stop a wearer asking for the file again', async () => {
    const r = await runner();
    r.start(DESKTOP_HIGH);
    const hair = wocCrowdHeadFileUrls()[0];
    r.wire.fail(hair);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // the failure was nobody's ask of the head store: no cooldown stands between the first
    // wearer and the file
    expect(r.heads.wocHeadFileState(hair)).toBe('idle');
    const before = r.wire.calls.length;
    r.heads.ensureWocHeadFile(hair);
    expect(r.wire.calls.slice(before)).toEqual([{ url: hair, priority: 'demand' }]);
    expect(r.wire.fetches(hair)).toBe(2);
  });

  it('lets a wearer ask for an armor pack the prefetch still holds: a demand, on the same fetch', async () => {
    const r = await runner();
    r.start(DESKTOP_HIGH);
    const pack = wocArmorPackUrl('female', 'mage', 'medium');
    expect(r.asksOf(pack)).toEqual(['background']);
    // a character walks into view wearing the set before its prefetch got a slot
    r.armor.ensureWocArmorPack(pack);
    expect(r.asksOf(pack)).toEqual(['background', 'demand']);
    expect(r.wire.fetches(pack)).toBe(1);
    // ...once: a body that asks every frame does not ask the loader every frame
    r.armor.ensureWocArmorPack(pack);
    expect(r.asksOf(pack)).toEqual(['background', 'demand']);
    r.wire.land(pack);
    await vi.waitFor(() => expect(r.armor.wocArmorPackResident(pack)).toBe(true));
    expect(r.wire.fetches(pack)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
// The wiring: the prefetch as characters/assets.ts starts it, through the REAL preload
// registry and the REAL character assets module (a fresh copy of each per case).
// ---------------------------------------------------------------------------------------

async function world() {
  vi.resetModules();
  const wire = installWire(isWoc);
  const preload = await import('../src/render/assets/preload');
  const gfx = await import('../src/render/gfx');
  const assets = await import('../src/render/characters/assets');
  const core = await import('../src/render/characters/woc_armor_core');
  return { wire, preload, assets, gfx, core };
}

describe('the crowd prefetch starts with the first painted frame', () => {
  it('starts nothing on the launcher and nothing when the entry lane opens', async () => {
    const { wire, preload } = await world();
    const crowd = wocCrowdPrefetchPlan(DESKTOP_HIGH);
    const crowdFiles = new Set([...crowd.headFiles, ...crowd.armorPacks]);
    expect(wire.calls.filter((c) => crowdFiles.has(c.url))).toEqual([]);
    preload.beginDeferredPreloads();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wire.calls.filter((c) => crowdFiles.has(c.url))).toEqual([]);
    expect(wire.textures.filter((t) => t.url.includes('_underarmor'))).toEqual([]);
  });

  it('is started by the post-entry stream kick, as background work, once', async () => {
    const { wire, assets, gfx, core } = await world();
    // Node is an unconstrained profile: the plan is the desktop one at this build's preset
    expect(gfx.GFX.constrainedMemory).toBe(false);
    const plan = wocCrowdPrefetchPlan(gfx.GFX);
    expect(plan.armorPacks).toHaveLength(18);
    const tier = core.wocArmorTierFor(gfx.GFX, 'crowd');
    assets.startStreamedCharacterPreloads();
    const asksOf = (url: string): string[] =>
      wire.calls.filter((c) => c.url === url).map((c) => c.priority);
    for (const url of [...plan.headFiles, ...plan.armorPacks]) {
      expect(asksOf(url), url).toEqual(['background']);
    }
    for (const url of plan.armorPacks) expect(parseWocArmorPackUrl(url)?.tier, url).toBe(tier);
    // the 16 atlases, each as its KTX2 sibling, as background work on the texture queue
    expect(wire.textures.map((t) => t.url).sort()).toEqual(
      plan.underArmorAtlases.map(ktx2Of).sort(),
    );
    expect(new Set(wire.textures.map((t) => t.priority))).toEqual(new Set(['background']));
    // and the kick is idempotent: a second call starts nothing more
    const calls = wire.calls.length;
    const textures = wire.textures.length;
    assets.startStreamedCharacterPreloads();
    expect(wire.calls.length).toBe(calls);
    expect(wire.textures.length).toBe(textures);
  });

  it('asks for a prefetched atlas as a demand when a body wears it', async () => {
    const { wire, assets } = await world();
    assets.startStreamedCharacterPreloads();
    const atlas = wocCrowdPrefetchPlan(DESKTOP_HIGH).underArmorAtlases[0];
    const asks = (): string[] =>
      wire.textures.filter((t) => t.url === ktx2Of(atlas)).map((t) => t.priority);
    expect(asks()).toEqual(['background']);
    // still streaming: the wearer's own ask reaches the loader as a demand, which is what
    // promotes the waiting load (tests/render_asset_load_priority.test.ts)
    void assets.ensureAtlasByUrl(atlas);
    expect(asks()).toEqual(['background', 'demand']);
  });
});
