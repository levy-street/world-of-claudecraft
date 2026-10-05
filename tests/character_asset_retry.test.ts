// A host that waits on a body's files (src/render/characters/assets.ts visualAssetsResident:
// the launcher's creation and character-select previews, a roster portrait, the Armory
// stage) hears of them through the ready signal alone, and a fetch that FAILED fires none.
// Before this a dropped request ended nothing: the wait went on for good (PR 4360 review,
// B1: "a failed base or animation library never ends the wait"). The store now asks again
// by itself, 8 s after the failure (the cooldown the head files and the armor packs keep),
// for as long as a host is waiting, and asks made meanwhile start no fetch, so a host that
// asks every frame cannot keep a dead file on the wire.
//
// One copy of the character assets module serves the whole file (its import is the slow
// part), so every case waits on a body file of its OWN: no case can see another's state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The loader with its contract (one promise per url, a failed one evicted). Every load is
 *  held on the wire until a case lands or fails it. */
const wire = vi.hoisted(() => {
  const fetched: string[] = [];
  const cache = new Map<string, Promise<unknown>>();
  const settle = new Map<string, { resolve: (g: unknown) => void; reject: (e: unknown) => void }>();
  return {
    fetched,
    /** How often a file has been put on the wire (cache misses, not asks). */
    fetches: (url: string): number => fetched.filter((u) => u === url).length,
    load: (url: string): Promise<unknown> => {
      let p = cache.get(url);
      if (!p) {
        fetched.push(url);
        p = new Promise((resolve, reject) => settle.set(url, { resolve, reject }));
        p.catch(() => cache.delete(url));
        cache.set(url, p);
      }
      return p;
    },
    land: (url: string) => settle.get(url)?.resolve({ scene: {}, animations: [] }),
    fail: (url: string) => settle.get(url)?.reject(new Error(`asset load failed: ${url}`)),
  };
});

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: (url: string) => wire.load(url),
  loadTexture: () => new Promise(() => undefined),
  loadKtx2Texture: () => new Promise(() => undefined),
  releaseGltf: () => undefined,
}));

import {
  ensureCharacterUrl,
  onCharacterAssetReady,
  visualAssetsResident,
} from '../src/render/characters/assets';
import { wocAnimsUrl, wocBaseUrl } from '../src/render/characters/woc_armor_core';

const PLAYERS = 'models/chars/players';

/** Run the timers due in `ms` and the promise chains behind them. */
const advance = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a host waiting on a body whose fetch failed', () => {
  it('fetches the body files once while they are on the wire, however often it asks', () => {
    const [base, anims] = [wocBaseUrl('male'), wocAnimsUrl('male')];
    for (let frame = 0; frame < 5; frame++) {
      expect(visualAssetsResident('player_warrior')).toBe(false);
    }
    expect(wire.fetches(base)).toBe(1);
    expect(wire.fetches(anims)).toBe(1);
  });

  it('is asked for again by the store, 8 s after the failure, with no further ask from the host', async () => {
    const [base, anims] = [wocBaseUrl('female'), wocAnimsUrl('female')];
    const ready: string[] = [];
    const off = onCharacterAssetReady((url) => ready.push(url));
    // one ask, as a host with no frame loop makes it
    expect(visualAssetsResident('player_warrior_female')).toBe(false);
    wire.fail(base);
    wire.land(anims);
    await advance(0);
    expect(ready).toEqual([anims]);

    await advance(7_999);
    expect(wire.fetches(base)).toBe(1);
    await advance(1);
    expect(wire.fetches(base)).toBe(2);

    // it lands: the ready signal the waiting host builds on, and the wait is over
    wire.land(base);
    await advance(0);
    expect(ready).toEqual([anims, base]);
    expect(visualAssetsResident('player_warrior_female')).toBe(true);
    off();
  });

  it('starts no fetch for asks made inside the cooldown, even one every frame', async () => {
    const clips = `${PLAYERS}/mage_ability_anims.glb`;
    visualAssetsResident('player_mage_modular');
    expect(wire.fetches(clips)).toBe(1);
    wire.fail(clips);
    await advance(0);
    for (let frame = 0; frame < 400; frame++) {
      expect(visualAssetsResident('player_mage_modular')).toBe(false);
      await advance(16);
    }
    // 6.4 s of frames: still the one fetch that failed
    expect(wire.fetches(clips)).toBe(1);
    await advance(2_000);
    expect(wire.fetches(clips)).toBe(2);
  });

  it('keeps asking every 8 s while the file keeps failing, and stops once it lands', async () => {
    const clips = `${PLAYERS}/druid_ability_anims.glb`;
    visualAssetsResident('player_druid_modular');
    for (let round = 1; round <= 3; round++) {
      wire.fail(clips);
      await advance(0);
      await advance(7_999);
      expect(wire.fetches(clips)).toBe(round);
      await advance(1);
      expect(wire.fetches(clips)).toBe(round + 1);
    }
    wire.land(clips);
    await advance(60_000);
    expect(wire.fetches(clips)).toBe(4);
  });

  it('does not hold back the first ask for a failure nobody was waiting on', async () => {
    const clips = `${PLAYERS}/rogue_ability_anims.glb`;
    // the world's own miss path put the file on the wire, and it failed
    ensureCharacterUrl(clips);
    wire.fail(clips);
    await advance(0);
    expect(wire.fetches(clips)).toBe(1);
    // nothing retries it by itself: no host is waiting
    await advance(20_000);
    expect(wire.fetches(clips)).toBe(1);
    // a host's first ask starts the fetch at once
    visualAssetsResident('player_rogue_modular');
    expect(wire.fetches(clips)).toBe(2);
  });

  it('only asks when told to fetch, and a look alone arms nothing', async () => {
    const clips = `${PLAYERS}/shaman_ability_anims.glb`;
    expect(visualAssetsResident('player_shaman_modular', false)).toBe(false);
    expect(wire.fetches(clips)).toBe(0);
    ensureCharacterUrl(clips);
    wire.fail(clips);
    await advance(0);
    // asked about, never waited on: the failure is not retried
    expect(visualAssetsResident('player_shaman_modular', false)).toBe(false);
    await advance(30_000);
    expect(wire.fetches(clips)).toBe(1);
  });

  it('leaves the world path alone: a view retry still re-arms a failed body at once', async () => {
    // The world's own miss path (resolvedGltf, then the view-create retry cooldown per
    // entity) asks through ensureCharacterUrl, which no cooldown gates.
    const clips = `${PLAYERS}/warlock_ability_anims.glb`;
    visualAssetsResident('player_warlock_modular');
    wire.fail(clips);
    await advance(0);
    ensureCharacterUrl(clips);
    expect(wire.fetches(clips)).toBe(2);
  });
});

describe('a composed player def left out of the boot gate is fetched when a build asks', () => {
  // PR 4360 review, N12: the non-warrior `player_<class>_modular` defs are on demand now.
  // The one caller left (the dev outfit audit rig) lands a def through visualAssetsResident.
  const RANGER = `${PLAYERS}/ranger.glb`;
  const HUNTER_CLIPS = `${PLAYERS}/hunter_ability_anims.glb`;

  it('downloads nothing of it at boot, and all of it on the first ask', () => {
    // the boot set went on the wire when the module loaded
    expect(wire.fetched.length).toBeGreaterThan(50);
    expect(wire.fetches(RANGER)).toBe(0);
    expect(wire.fetches(HUNTER_CLIPS)).toBe(0);
    expect(visualAssetsResident('player_hunter_modular')).toBe(false);
    expect(wire.fetches(RANGER)).toBe(1);
    expect(wire.fetches(HUNTER_CLIPS)).toBe(1);
  });
});
