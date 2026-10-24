// The Emissary's Cache (src/sim/emissary_cache.ts): the Normal raid pool per
// class, and opening one through the ordinary item-use path.
import { describe, expect, it } from 'vitest';
import { DUNGEON_MOBS } from '../src/sim/content/dungeons';
import { NYTHRAXIS_RAID_BOSS_ID } from '../src/sim/content/heroic_loot';
import { IGNIVAR_LOOT_ITEM_IDS } from '../src/sim/content/ignivar_loot';
import { ITEMS } from '../src/sim/data';
import {
  EMISSARY_CACHE_ITEM_ID,
  EMISSARY_CACHE_MARKS,
  emissaryCachePoolForClass,
  emissaryCacheRaidPool,
} from '../src/sim/emissary_cache';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

describe('the cache pool', () => {
  it('holds only Normal epic raid gear: Nythraxis drops and the Crucible tables, no tokens, recipes, heroic copies, or Crucible tier pieces', () => {
    const pool = emissaryCacheRaidPool();
    expect(pool.length).toBeGreaterThan(20);
    expect(new Set(pool).size).toBe(pool.length);
    for (const id of pool) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.quality, id).toBe('epic');
      expect(def.kind, id).not.toBe('tool');
      expect(def.kind, id).not.toBe('recipe');
      expect(def.slot, id).toBeDefined();
      expect(def.heroicOf, id).toBeUndefined();
      if (IGNIVAR_LOOT_ITEM_IDS.includes(id)) expect(def.set, id).toBeUndefined();
    }
    expect(pool).toContain('bonewrought_greatsword');
    expect(pool).toContain('seal_of_the_forgewall');
    expect(pool).not.toContain('slagbreaker_helmet');
    expect(pool).not.toContain('pattern_duskforged_warblade');
    expect(pool).not.toContain('pattern_voidbound_grimoire');
    expect(pool.some((id) => ITEMS[id].kind === 'recipe')).toBe(false);
    expect(pool.some((id) => IGNIVAR_LOOT_ITEM_IDS.includes(id))).toBe(true);
    expect(pool.some((id) => id.startsWith('sigil_'))).toBe(false);
  });

  it('includes every Nythraxis tier piece but no Crucible tier piece', () => {
    const pool = new Set(emissaryCacheRaidPool());
    const nythraxisSets = (DUNGEON_MOBS[NYTHRAXIS_RAID_BOSS_ID]?.loot ?? [])
      .map((entry) => entry.itemId)
      .filter((id): id is string => !!id && !!ITEMS[id]?.set && !ITEMS[id]?.heroicOf);
    expect(nythraxisSets.length).toBeGreaterThan(0);
    for (const id of nythraxisSets) expect(pool.has(id), id).toBe(true);
    expect(pool.has('crownforged_dreadhelm')).toBe(true);
    expect(pool.has('bramblehide_harness')).toBe(true);
    const crucibleSets = IGNIVAR_LOOT_ITEM_IDS.filter((id) => ITEMS[id]?.set);
    expect(crucibleSets.length).toBeGreaterThan(0);
    for (const id of crucibleSets) expect(pool.has(id), id).toBe(false);
  });

  it('gives every class a non-empty pool it can wear', () => {
    for (const cls of CLASSES) {
      const pool = emissaryCachePoolForClass(cls);
      expect(pool.length, cls).toBeGreaterThan(0);
      for (const id of pool) {
        const locked = ITEMS[id].requiredClass;
        expect(!locked || locked.includes(cls), `${cls} ${id}`).toBe(true);
      }
    }
    expect(emissaryCachePoolForClass('shaman')).toContain('stormkindled_chain');
    expect(emissaryCachePoolForClass('mage')).not.toContain('stormkindled_chain');
  });
});

describe('opening a cache', () => {
  it('consumes one cache and hands over a class piece plus the marks, drawing the sim rng', () => {
    const sim = new Sim({ seed: 11, playerClass: 'mage', devCommands: true });
    sim.tick();
    const meta = sim.meta(sim.playerId)!;
    sim.useItem(EMISSARY_CACHE_ITEM_ID);
    expect(sim.countItem(EMISSARY_CACHE_ITEM_ID)).toBe(0);
    sim.chat(`/dev give ${EMISSARY_CACHE_ITEM_ID} 2`);
    expect(sim.countItem(EMISSARY_CACHE_ITEM_ID)).toBe(2);
    const marks = sim.heroicMarks;
    const before = new Map(
      emissaryCachePoolForClass(meta.cls).map((id) => [id, sim.countItem(id)] as const),
    );
    sim.useItem(EMISSARY_CACHE_ITEM_ID);
    expect(sim.countItem(EMISSARY_CACHE_ITEM_ID)).toBe(1);
    expect(sim.heroicMarks).toBe(marks + EMISSARY_CACHE_MARKS);
    const gained = [...before].filter(([id, count]) => sim.countItem(id) === count + 1);
    expect(gained).toHaveLength(1);
    expect(ITEMS[gained[0][0]].requiredClass ?? ['mage']).toContain('mage');
    // The same seed opens the same piece: the draw is the sim's own rng.
    const twin = new Sim({ seed: 11, playerClass: 'mage', devCommands: true });
    twin.tick();
    twin.chat(`/dev give ${EMISSARY_CACHE_ITEM_ID} 2`);
    twin.useItem(EMISSARY_CACHE_ITEM_ID);
    expect(twin.countItem(gained[0][0])).toBe(sim.countItem(gained[0][0]));
  });
});
