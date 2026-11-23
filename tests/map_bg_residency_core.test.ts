import { describe, expect, it } from 'vitest';
import {
  MAP_BG_BOUNDED_CAPACITY,
  MapBgResidentCache,
  mapBgResidencyPolicy,
} from '../src/ui/map_bg_residency_core';

interface Plate {
  zoneId: string;
  released: number;
}

function harness(iosMemoryProfile: boolean) {
  let current = '';
  const released: string[] = [];
  const cache = new MapBgResidentCache<Plate>(
    mapBgResidencyPolicy(iosMemoryProfile),
    (plate) => {
      plate.released++;
      released.push(plate.zoneId);
    },
    () => current,
  );
  let commits = 0;
  const plate = (zoneId: string): Plate => ({ zoneId, released: 0 });
  return {
    cache,
    released,
    commits: () => commits,
    setCurrent(zoneId: string) {
      current = zoneId;
    },
    commit(zoneId: string) {
      commits++;
      cache.set(zoneId, plate(zoneId));
    },
    // What the HUD does on a zone crossing: the crossing prewarm commits the
    // plate when it is missing, then the minimap reads it every medium tick.
    enter(zoneId: string) {
      current = zoneId;
      if (!cache.has(zoneId)) {
        commits++;
        cache.set(zoneId, plate(zoneId));
      }
      cache.get(zoneId);
    },
  };
}

const TOUR = [
  'eastbrook_vale',
  'mirefen_marsh',
  'thornpeak_heights',
  'veiled_hollow',
  'drakelands',
  'frostveil',
  'amberfall',
  'willowfen',
  'nightbloom',
  'wraithwood',
  'palmreach',
  'evergarden',
  'galecrest',
  'farshore_isle',
  'proving_shore',
];

describe('map background residency policy', () => {
  it('leaves every non-iOS host on the session-long cache (desktop and Android pin)', () => {
    expect(mapBgResidencyPolicy(false)).toEqual({
      capacity: null,
      retainDecodedPlates: true,
      prewarmPreparedZones: true,
    });
  });

  it('bounds the iOS memory profile to three drawn zones, one copy each, no streamed prewarm', () => {
    expect(MAP_BG_BOUNDED_CAPACITY).toBe(3);
    expect(mapBgResidencyPolicy(true)).toEqual({
      capacity: 3,
      retainDecodedPlates: false,
      prewarmPreparedZones: false,
    });
  });
});

describe('MapBgResidentCache, unbounded profile', () => {
  it('keeps every committed zone for the session and never releases one', () => {
    const h = harness(false);
    for (const zoneId of TOUR) h.enter(zoneId);
    for (const zoneId of TOUR) h.enter(zoneId);
    expect(h.cache.size).toBe(TOUR.length);
    expect(h.released).toEqual([]);
    expect(h.commits()).toBe(TOUR.length);
    for (const zoneId of TOUR) expect(h.cache.get(zoneId)?.zoneId).toBe(zoneId);
  });
});

describe('MapBgResidentCache, bounded profile', () => {
  it('holds at most three zones over a whole tour and releases each dropped plate once', () => {
    const h = harness(true);
    for (const zoneId of TOUR) {
      h.enter(zoneId);
      expect(h.cache.size).toBeLessThanOrEqual(MAP_BG_BOUNDED_CAPACITY);
    }
    expect(h.cache.size).toBe(3);
    expect(h.released).toEqual(TOUR.slice(0, TOUR.length - 3));
    for (const zoneId of h.released) {
      expect(h.cache.has(zoneId)).toBe(false);
      expect(h.cache.get(zoneId)).toBeUndefined();
    }
    for (const zoneId of TOUR.slice(-3)) expect(h.cache.has(zoneId)).toBe(true);
  });

  it('never reloads while walking back and forth over one border', () => {
    const h = harness(true);
    for (let i = 0; i < 10; i++) h.enter(i % 2 === 0 ? 'eastbrook_vale' : 'mirefen_marsh');
    expect(h.commits()).toBe(2);
    expect(h.released).toEqual([]);
  });

  it('releases the least recently DRAWN zone, not the oldest commit', () => {
    const h = harness(true);
    h.enter('eastbrook_vale');
    h.commit('mirefen_marsh');
    h.commit('drakelands');
    h.cache.get('mirefen_marsh'); // the world map is showing it
    h.cache.get('eastbrook_vale'); // the minimap draws the current zone
    h.commit('frostveil');
    expect(h.released).toEqual(['drakelands']);
  });

  it('does not count a bookkeeping has() as a draw', () => {
    const h = harness(true);
    h.enter('eastbrook_vale');
    h.commit('mirefen_marsh');
    h.commit('drakelands');
    for (let i = 0; i < 5; i++) h.cache.has('mirefen_marsh');
    h.cache.get('drakelands');
    h.commit('frostveil');
    expect(h.released).toEqual(['mirefen_marsh']);
  });

  it('keeps a zone the world map redraws while the player crosses other zones', () => {
    const h = harness(true);
    h.enter('eastbrook_vale');
    h.commit('drakelands');
    for (const zoneId of ['mirefen_marsh', 'thornpeak_heights', 'veiled_hollow']) {
      h.cache.get('drakelands'); // the open map redraws on the medium band
      h.enter(zoneId);
    }
    expect(h.cache.has('drakelands')).toBe(true);
    expect(h.cache.has('veiled_hollow')).toBe(true);
    expect(h.cache.size).toBe(3);
  });

  it('never releases the current zone, even when it is the least recently drawn', () => {
    const h = harness(true);
    h.enter('eastbrook_vale');
    // The world map browses three other zones while the minimap is not painting.
    h.commit('drakelands');
    h.commit('frostveil');
    h.commit('amberfall');
    h.commit('willowfen');
    expect(h.cache.has('eastbrook_vale')).toBe(true);
    expect(h.cache.has('willowfen')).toBe(true);
    expect(h.released).toEqual(['drakelands', 'frostveil']);
  });

  it('reloads a released zone as a fresh commit', () => {
    const h = harness(true);
    for (const zoneId of TOUR.slice(0, 5)) h.enter(zoneId);
    expect(h.cache.has('eastbrook_vale')).toBe(false);
    const before = h.commits();
    h.enter('eastbrook_vale');
    expect(h.commits()).toBe(before + 1);
    expect(h.cache.get('eastbrook_vale')?.released).toBe(0);
  });
});
