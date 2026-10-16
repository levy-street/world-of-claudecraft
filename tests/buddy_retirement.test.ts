import { describe, expect, it } from 'vitest';
import {
  attachPendingBuddy,
  buddyItemId,
  grantBuddy,
  restoreBuddyCollection,
  serializeBuddyCollection,
  summonBuddy,
  useBuddyToken,
} from '../src/sim/buddies';
import { BUDDY_KEYS, buddyDef, normalizeBuddyKey } from '../src/sim/content/buddies';
import { BUDDY_TEMPLATE_IDS } from '../src/sim/content/buddy_mobs';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, NPCS } from '../src/sim/data';
import { useItem } from '../src/sim/items';
import { Sim } from '../src/sim/sim';
import { VENDOR_TEST_WORLD } from './sim_shared';

const RETIRED_KEYS = [
  'ember_fox',
  'moss_hare',
  'frog',
  'crimson_claw_crab',
  'golden_sentinel',
  'nightfang',
  'tuskhorn_boar',
  'emerald_wolf',
  'tiger',
  'cate_coin',
  'alon',
  'trollface',
  'ansem',
  'triple_t',
  'kekius',
  'solbot',
  'frostfire',
  'rocky',
  'proud_grunt',
  'loot_goblin',
  'penny_goldspark',
  'stag',
  'alpaca',
  'bull',
  'spider',
  'raptor',
  'skeleton',
  'crystal_tide',
  'phantom',
  'emberfall_phoenix',
];
const RETIRED_COSMETICS = [
  'stag_acorn',
  'stag_gilded',
  'moss_hare_verdant',
  'frog_sapphire',
  'proud_grunt_warlord',
];
const RETIRED_TOKENS = [
  ...RETIRED_KEYS.map((key) => `whistle_${key}`),
  'charm_stag_acorn',
  'charm_stag_gilded',
];

describe('retired buddies', () => {
  it('keeps the core buddies and restores Sapling for referral completion', () => {
    expect(BUDDY_KEYS).toEqual(['horse', 'crystal_lich', 'forgemaw', 'sapling']);
    expect([...BUDDY_TEMPLATE_IDS]).toEqual([
      'buddy_horse',
      'buddy_crystal_lich',
      'buddy_forgemaw',
      'buddy_sapling',
    ]);
    for (const key of RETIRED_KEYS) {
      expect(buddyDef(key)).toBeNull();
      expect(normalizeBuddyKey(key)).toBe('');
      expect(buddyItemId(key)).toBeNull();
    }
  });

  it('drops retired saved ownership, pending reveals, looks and last selection', () => {
    const restored = restoreBuddyCollection({
      owned: [...RETIRED_KEYS, 'horse', 'crystal_lich'],
      cosmetics: [...RETIRED_COSMETICS, 'crystal_lich_frostbound'],
      equipped: { frog: 'frog_sapphire', crystal_lich: 'crystal_lich_frostbound' },
      pending: [...RETIRED_KEYS, 'forgemaw'].map((key) => ({ key, source: 'instance' })),
      last: 'frog',
    });
    expect([...restored.owned]).toEqual(['horse', 'crystal_lich']);
    expect(restored.pending.map((entry) => entry.key)).toEqual(['forgemaw']);
    expect(restored.last).toBe('');
    expect(restored).not.toHaveProperty('cosmetics');
    expect(restored).not.toHaveProperty('equipped');
    expect(serializeBuddyCollection(restored)).toEqual({
      owned: ['horse', 'crystal_lich'],
      pending: [{ key: 'forgemaw', source: 'instance', x: 0, z: 0 }],
    });
  });

  it('refuses retired grants, summons and token use without consuming saved tokens', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: VENDOR_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Owner');
    const meta = sim.players.get(pid)!;
    for (const key of RETIRED_KEYS) {
      expect(grantBuddy(sim.ctx, pid, key)).toBe(false);
      expect(summonBuddy(sim.ctx, pid, key)).toBe(false);
      expect(attachPendingBuddy(sim.ctx, pid, key, 'world', { x: 0, z: 0 })).toBe(false);
    }
    for (const itemId of RETIRED_TOKENS) {
      expect(ITEMS[itemId]).toBeDefined();
      sim.addItem(itemId, 1, pid);
      useItem(sim.ctx, itemId, pid);
      expect(useBuddyToken(sim.ctx, pid, itemId)).toBe(false);
      expect(sim.countItem(itemId, pid), itemId).toBe(1);
      sim.removeItem(itemId, 1, pid);
    }
    expect(meta.buddies.owned.size).toBe(0);
    expect(meta.buddies.pending).toEqual([]);
    expect(sim.entities.get(pid)!.buddyKey).toBe('');
  });

  it('has no vendor or recipe acquisition for retired tokens', () => {
    const retired = new Set(RETIRED_TOKENS);
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) expect(retired.has(itemId), npc.id).toBe(false);
    }
    for (const row of HEROIC_VENDOR_STOCK) expect(retired.has(row.itemId)).toBe(false);
    for (const recipe of ALL_RECIPES)
      expect(retired.has(recipe.resultItemId), recipe.id).toBe(false);
  });
});
