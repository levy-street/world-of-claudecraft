import { describe, expect, it, vi } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { STATIONS } from '../src/sim/content/professions';
import { recipeForResultItem } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { recalcPlayerStats } from '../src/sim/entity';
import { isUniqueEquipped } from '../src/sim/equipment_rules';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import { activeItemInstanceStats } from '../src/sim/item_instance_stats';
import { isPerfectingBound, resolveUnbind } from '../src/sim/professions/commission';
import { enchantedPayloadFor, replacedEnchantPayloadFor } from '../src/sim/professions/enchanting';
import { perfectingInfoFrom, resolvePerfectingAttempt } from '../src/sim/professions/perfecting';
import { withPerfectingBonus } from '../src/sim/professions/perfecting_bonus';
import { capturePerfectItemRef } from '../src/sim/professions/perfecting_copy';
import {
  perfectingSwapInfoFrom,
  swapPerfectingRanks,
} from '../src/sim/professions/perfecting_swap';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const CHEST = 'crucible_str_mail_chest';
const WAIST = 'crucible_str_mail_waist';

function fixture(sourceRank = 4, targetRank = 1) {
  const sim = new Sim({
    seed: 85,
    playerClass: 'warrior',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.playerId;
  const meta = sim.players.get(pid) as PlayerMeta;
  const e = sim.player;
  meta.craftSkills.armorcrafting = 125;
  e.pos = { ...STATIONS.find((s) => s.type === 'forge')!.pos, y: 0 };
  const instance = (rank: number, bonus: number): ItemInstancePayload => ({
    signer: 'Artisan',
    perfectingBonus: { str: bonus },
    ...(rank === 4
      ? { perfected: true, rolled: { stats: { str: bonus } } }
      : rank > 0
        ? { perfecting: rank }
        : {}),
  });
  meta.inventory = [
    {
      itemId: CHEST,
      count: 1,
      instance: instance(sourceRank, 2),
      craftedRecipeId: `recipe_${CHEST}`,
    },
    {
      itemId: WAIST,
      count: 1,
      instance: instance(targetRank, 1),
      craftedRecipeId: `recipe_${WAIST}`,
    },
  ];
  const reads = () => ({
    inventory: meta.inventory,
    equipment: meta.equipment,
    equipmentInstances: meta.equipmentInstance,
  });
  const request = () => ({
    source: capturePerfectItemRef(reads(), { bag: 0, itemId: CHEST }),
    target: capturePerfectItemRef(reads(), { bag: 1, itemId: WAIST }),
  });
  const view = () =>
    perfectingSwapInfoFrom({
      ...reads(),
      ...request(),
      craftSkills: meta.craftSkills,
      dead: e.dead,
      inCombat: e.inCombat,
      pos: e.pos,
    });
  return { sim, pid, meta, e, reads, request, view };
}

function mintedRankPayload(itemId: string, rank: number, pid: number): ItemInstancePayload {
  const recipe = recipeForResultItem(itemId);
  if (!recipe) throw new Error('fixture recipe missing');
  const stats: Record<string, number> =
    itemId === CHEST ? { str: 7, sta: 11, armor: 19 } : { str: 3, sta: 5, armor: 13 };
  const payload = withPerfectingBonus(ITEMS[itemId], recipe, {
    signer: 'Artisan',
    rolled: { quality: 'epic', stats },
  });
  if (rank > 0) {
    payload.perfectingBound = true;
    payload.boundTo = pid;
  }
  if (rank === 4) {
    payload.perfected = true;
    for (const [stat, value] of Object.entries(payload.perfectingBonus ?? {})) {
      if (value > 0) stats[stat] = (stats[stat] ?? 0) + value;
    }
  } else if (rank > 0) payload.perfecting = rank;
  return payload;
}

function mintedRankFixture(sourceRank: number, targetRank: number) {
  const w = fixture(sourceRank, targetRank);
  w.meta.inventory[0].instance = mintedRankPayload(CHEST, sourceRank, w.pid);
  w.meta.inventory[1].instance = mintedRankPayload(WAIST, targetRank, w.pid);
  return w;
}

const MALFORMED_PROGRESS: readonly {
  label: string;
  rank: number;
  corrupt: (payload: ItemInstancePayload) => void;
}[] = [
  {
    label: 'fractional rank',
    rank: 2,
    corrupt: (p) => {
      p.perfecting = 1.5;
    },
  },
  {
    label: 'negative rank',
    rank: 2,
    corrupt: (p) => {
      p.perfecting = -1;
    },
  },
  {
    label: 'rank four without Perfected',
    rank: 2,
    corrupt: (p) => {
      p.perfecting = 4;
    },
  },
  {
    label: 'rank above four',
    rank: 2,
    corrupt: (p) => {
      p.perfecting = 5;
    },
  },
  {
    label: 'Perfected plus rank zero',
    rank: 4,
    corrupt: (p) => {
      p.perfecting = 0;
    },
  },
  {
    label: 'Perfected plus rank three',
    rank: 4,
    corrupt: (p) => {
      p.perfecting = 3;
    },
  },
  {
    label: 'Perfected without a contribution',
    rank: 4,
    corrupt: (p) => {
      delete p.perfectingBonus;
    },
  },
  {
    label: 'fractional contribution',
    rank: 2,
    corrupt: (p) => {
      p.perfectingBonus = { str: 0.5 };
    },
  },
  {
    label: 'insufficient stored Perfected stats',
    rank: 4,
    corrupt: (p) => {
      p.rolled = { stats: { str: 0, sta: 1 } };
    },
  },
  {
    label: 'missing stored Perfected stats',
    rank: 4,
    corrupt: (p) => {
      delete p.rolled;
    },
  },
  {
    label: 'nonfinite stored Perfected stats',
    rank: 4,
    corrupt: (p) => {
      p.rolled = { stats: { str: Number.POSITIVE_INFINITY, sta: 1 } };
    },
  },
];

describe('Perfecting rank exchange', () => {
  it.each([
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 2, 2, 0],
    [0, 3, 3, 0],
    [0, 4, 4, 0],
    [1, 0, 0, 1],
    [1, 1, 1, 1],
    [1, 2, 2, 1],
    [1, 3, 3, 1],
    [1, 4, 4, 1],
    [2, 0, 0, 2],
    [2, 1, 1, 2],
    [2, 2, 2, 2],
    [2, 3, 3, 2],
    [2, 4, 4, 2],
    [3, 0, 0, 3],
    [3, 1, 1, 3],
    [3, 2, 2, 3],
    [3, 3, 3, 3],
    [3, 4, 4, 3],
    [4, 0, 0, 4],
    [4, 1, 1, 4],
    [4, 2, 2, 4],
    [4, 3, 3, 4],
    [4, 4, 4, 4],
  ])(
    'covers source rank %i and target rank %i',
    (sourceRank, targetRank, nextSource, nextTarget) => {
      const w = mintedRankFixture(sourceRank, targetRank);
      const source = w.meta.inventory[0].instance;
      if (!source?.rolled) throw new Error('fixture source missing');
      source.name = 'A Name Kept';
      source.rolled.quality = 'legendary';
      source.perfectingBound = true;
      source.boundTo = 991;
      const before = structuredClone(w.meta.inventory);
      const beforeStats = w.e.stats;
      const revision = w.meta.wireRev;
      const copper = w.meta.copper;
      const draws = vi.spyOn(w.sim.rng, 'next');
      try {
        const result = swapPerfectingRanks(w.sim.ctx, w.pid, w.request());
        if (sourceRank === targetRank) {
          expect(result).toMatchObject({ ok: false, reason: 'same_rank' });
          expect(w.meta.inventory).toEqual(before);
          expect(w.e.stats).toBe(beforeStats);
          expect(w.meta.wireRev).toBe(revision);
          return;
        }
        expect(result.ok).toBe(true);
        const first = w.meta.inventory[0].instance;
        const second = w.meta.inventory[1].instance;
        const ranks = [first, second].map((p) => (p?.perfected ? 4 : (p?.perfecting ?? 0)));
        expect(ranks).toEqual([nextSource, nextTarget]);
        expect(ranks[0] + ranks[1]).toBe(sourceRank + targetRank);
        expect(first).toMatchObject({
          name: 'A Name Kept',
          perfectingBound: true,
          boundTo: 991,
          perfectingBonus: { str: 1, sta: 1 },
          rolled: { quality: 'legendary' },
        });
        expect(second).toMatchObject({
          perfectingBound: true,
          boundTo: w.pid,
          perfectingBonus: { str: 1, sta: 1 },
          rolled: { quality: 'epic' },
        });
        expect(first?.rolled?.stats).toEqual(
          nextSource === 4 ? { str: 8, sta: 12, armor: 19 } : { str: 7, sta: 11, armor: 19 },
        );
        expect(second?.rolled?.stats).toEqual(
          nextTarget === 4 ? { str: 4, sta: 6, armor: 13 } : { str: 3, sta: 5, armor: 13 },
        );
        expect(first?.perfectingBonus).toEqual(before[0].instance?.perfectingBonus);
        expect(second?.perfectingBonus).toEqual(before[1].instance?.perfectingBonus);
        expect(isUniqueEquipped(ITEMS[CHEST], first)).toBe(true);
        expect(isUniqueEquipped(ITEMS[WAIST], second)).toBe(false);
        expect(second?.name).toBeUndefined();
        for (const [payload, rank] of [
          [first, nextSource],
          [second, nextTarget],
        ] as const) {
          expect(payload?.perfected).toBe(rank === 4 ? true : undefined);
          expect(payload?.perfecting).toBe(rank > 0 && rank < 4 ? rank : undefined);
          expect(isPerfectingBound(payload)).toBe(true);
        }
        expect(w.meta.wireRev).toBe(revision + 1);
        expect(swapPerfectingRanks(w.sim.ctx, w.pid, w.request()).ok).toBe(true);
        expect(w.meta.inventory).toEqual(
          before.map((slot) => ({
            ...slot,
            instance: {
              ...slot.instance,
              perfectingBound: true,
              boundTo: slot.instance?.boundTo ?? w.pid,
            },
          })),
        );
        expect(w.meta.wireRev).toBe(revision + 2);
      } finally {
        expect(w.meta.copper).toBe(copper);
        expect(draws).not.toHaveBeenCalled();
        draws.mockRestore();
      }
    },
  );

  describe.each(['source', 'target'] as const)('%s progress validation', (side) => {
    it.each(MALFORMED_PROGRESS)('refuses $label without writes or RNG', ({ rank, corrupt }) => {
      const w = mintedRankFixture(1, 2);
      const index = side === 'source' ? 0 : 1;
      const itemId = index === 0 ? CHEST : WAIST;
      const payload = mintedRankPayload(itemId, rank, w.pid);
      corrupt(payload);
      w.meta.inventory[index].instance = payload;
      // Capture AFTER corruption, so admission reaches progress validation,
      // not a stale-copy denial that would leave the malformed branch untested.
      const request = w.request();
      const before = structuredClone(w.reads());
      const inventory = w.meta.inventory;
      const equipmentInstances = w.meta.equipmentInstance;
      const stats = w.e.stats;
      const revision = w.meta.wireRev;
      const copper = w.meta.copper;
      const draws = vi.spyOn(w.sim.rng, 'next');
      try {
        expect(w.view().reason).toBe('invalid_progress');
        expect(swapPerfectingRanks(w.sim.ctx, w.pid, request)).toMatchObject({
          ok: false,
          reason: 'invalid_progress',
        });
        expect(w.reads()).toEqual(before);
        expect(w.meta.inventory).toBe(inventory);
        expect(w.meta.equipmentInstance).toBe(equipmentInstances);
        expect(w.e.stats).toBe(stats);
        expect(w.meta.wireRev).toBe(revision);
        expect(w.meta.copper).toBe(copper);
        expect(draws).not.toHaveBeenCalled();
      } finally {
        draws.mockRestore();
      }
    });

    it.each([0, 1, 2, 3])(
      'accepts non-Perfected rank %i without a recorded contribution',
      (rank) => {
        const otherRank = rank === 1 ? 0 : 1;
        const w = mintedRankFixture(
          side === 'source' ? rank : otherRank,
          side === 'target' ? rank : otherRank,
        );
        const index = side === 'source' ? 0 : 1;
        const payload = w.meta.inventory[index].instance;
        if (!payload) throw new Error('fixture payload missing');
        delete payload.perfectingBonus;
        const stats = structuredClone(payload.rolled?.stats);
        const draws = vi.spyOn(w.sim.rng, 'next');
        try {
          expect(w.view().reason).toBeUndefined();
          expect(swapPerfectingRanks(w.sim.ctx, w.pid, w.request()).ok).toBe(true);
          expect(w.meta.inventory[index].instance).toMatchObject({
            perfectingBonus: { str: 1, sta: 1 },
            perfectingBound: true,
            boundTo: w.pid,
            rolled: { stats },
          });
          expect(draws).not.toHaveBeenCalled();
        } finally {
          draws.mockRestore();
        }
      },
    );
  });

  it('exchanges four and one ranks without charging or drawing, binds both, and rejects replay', () => {
    const w = fixture();
    const request = w.request();
    const draws = vi.spyOn(w.sim.rng, 'next');
    const revision = w.meta.wireRev;
    const copper = w.meta.copper;
    expect(w.view()?.reason).toBeUndefined();
    expect(swapPerfectingRanks(w.sim.ctx, w.pid, request).ok).toBe(true);
    expect(w.meta.inventory[0].instance).toMatchObject({
      perfecting: 1,
      perfectingBound: true,
      boundTo: w.pid,
      perfectingBonus: { str: 2 },
    });
    expect(w.meta.inventory[0].instance?.perfected).toBeUndefined();
    expect(w.meta.inventory[0].instance?.rolled?.stats?.str ?? 0).toBe(0);
    expect(w.meta.inventory[1].instance).toMatchObject({
      perfected: true,
      perfectingBound: true,
      boundTo: w.pid,
      rolled: { stats: { str: 1 } },
    });
    expect(w.meta.inventory).toHaveLength(2);
    expect(w.meta.copper).toBe(copper);
    expect(w.meta.wireRev).toBe(revision + 1);
    expect(draws).not.toHaveBeenCalled();
    const after = JSON.stringify(w.meta.inventory);
    const replay = swapPerfectingRanks(w.sim.ctx, w.pid, request);
    expect(replay).toMatchObject({ ok: false, reason: 'no_item', request });
    expect(replay.request?.source.copy).not.toBe(request.source.copy);
    expect(JSON.stringify(w.meta.inventory)).toBe(after);
    expect(w.meta.wireRev).toBe(revision + 1);
  });

  it('keeps zero-rank donors permanently bound and preserves unknown provenance on repeated swaps', () => {
    const w = fixture(4, 0);
    Object.assign(w.meta.inventory[0].instance!, {
      name: 'My Hammer',
      rolled: { quality: 'legendary', stats: { str: 2 } },
      futureRecord: { value: 7 },
      boundTo: 991,
    });
    for (let n = 0; n < 20; n++)
      expect(swapPerfectingRanks(w.sim.ctx, w.pid, w.request()).ok).toBe(true);
    expect(w.meta.inventory[0].instance).toMatchObject({
      perfected: true,
      rolled: { quality: 'legendary', stats: { str: 2 } },
      name: 'My Hammer',
      boundTo: 991,
      futureRecord: { value: 7 },
    });
    swapPerfectingRanks(w.sim.ctx, w.pid, w.request());
    const donor = w.meta.inventory[0].instance!;
    expect(donor.perfecting).toBeUndefined();
    expect(donor.perfected).toBeUndefined();
    expect(isPerfectingBound(donor)).toBe(true);
    expect(isUniqueEquipped(ITEMS[CHEST], donor)).toBe(true);
    expect(resolveUnbind(STATIONS, w.meta, w.e.pos, CHEST)).toMatchObject({
      ok: false,
      reason: 'unbind_perfecting',
    });
    expect(w.meta.inventory[0].craftedRecipeId).toBe(`recipe_${CHEST}`);
  });

  it.each([
    'dead',
    'combat',
    'cast',
    'channel',
    'locked',
    'station',
    'skill',
    'same',
    'equal',
    'missing_pin',
    'stale_target',
    'wrong_collection',
    'bad_bonus',
    'stack',
  ])('refuses %s atomically before any write', (fault) => {
    const w = fixture();
    const request = w.request();
    if (fault === 'dead') w.e.dead = true;
    if (fault === 'combat') w.e.inCombat = true;
    if (fault === 'cast') w.e.castingAbility = 'crafting';
    if (fault === 'channel') w.e.channeling = true;
    if (fault === 'locked') {
      w.meta.inventory[1].instance!.locked = true;
      request.target = capturePerfectItemRef(w.reads(), { bag: 1, itemId: WAIST });
    }
    if (fault === 'stack') {
      w.meta.inventory[1].count = 2;
      request.target = capturePerfectItemRef(w.reads(), { bag: 1, itemId: WAIST });
    }
    if (fault === 'station') w.e.pos = { x: -50000, y: 0, z: -50000 };
    if (fault === 'skill') w.meta.craftSkills.armorcrafting = 124;
    if (fault === 'same') request.target = request.source;
    if (fault === 'missing_pin') delete request.target.copy;
    if (fault === 'stale_target') w.meta.inventory[1].instance!.signer = 'Changed';
    if (fault === 'wrong_collection') {
      w.meta.inventory[1].itemId = 'crucible_tank_mail_waist';
      request.target = capturePerfectItemRef(w.reads(), {
        bag: 1,
        itemId: 'crucible_tank_mail_waist',
      });
    }
    if (fault === 'equal') {
      w.meta.inventory[0].instance = { perfecting: 1, perfectingBonus: { str: 2 } };
      request.source = capturePerfectItemRef(w.reads(), { bag: 0, itemId: CHEST });
    }
    if (fault === 'bad_bonus') {
      delete w.meta.inventory[0].instance!.perfectingBonus;
      request.source = capturePerfectItemRef(w.reads(), { bag: 0, itemId: CHEST });
    }
    const before = JSON.stringify(w.meta.inventory);
    const revision = w.meta.wireRev;
    const draws = vi.spyOn(w.sim.rng, 'next');
    expect(swapPerfectingRanks(w.sim.ctx, w.pid, request).ok).toBe(false);
    expect(JSON.stringify(w.meta.inventory)).toBe(before);
    expect(w.meta.wireRev).toBe(revision);
    expect(draws).not.toHaveBeenCalled();
  });

  it('deactivates and restores the worn Perfected enchant, keeping replacement arithmetic exact', () => {
    const w = fixture(4, 0);
    const enchanted = enchantedPayloadFor(
      w.meta.inventory[0].instance,
      ENCHANTS.enchant_lucent_infusion,
    );
    w.meta.equipment.chest = CHEST;
    w.meta.equipmentInstance.chest = enchanted;
    w.meta.inventory.splice(0, 1);
    w.e.level = 20;
    recalcPlayerStats(
      w.e,
      w.meta.cls,
      w.meta.equipment,
      w.sim.ctx.playerMods(w.meta),
      w.meta.equipmentInstance,
    );
    const before = w.e.stats.sta;
    const request = () => ({
      source: capturePerfectItemRef(w.reads(), { slot: 'chest' }),
      target: capturePerfectItemRef(w.reads(), { bag: 0, itemId: WAIST }),
    });
    expect(swapPerfectingRanks(w.sim.ctx, w.pid, request()).ok).toBe(true);
    expect(w.e.stats.sta).toBe(before - 13);
    expect(w.meta.equipmentInstance.chest?.enchant).toBe('enchant_lucent_infusion');
    expect(activeItemInstanceStats(w.meta.equipmentInstance.chest)?.sta ?? 0).toBe(0);
    expect(swapPerfectingRanks(w.sim.ctx, w.pid, request()).ok).toBe(true);
    expect(w.e.stats.sta).toBe(before);
    swapPerfectingRanks(w.sim.ctx, w.pid, request());
    const next = ENCHANTS.enchant_chest_greater_stamina;
    const replaced = replacedEnchantPayloadFor(w.meta.equipmentInstance.chest!, next);
    expect(replaced.rolled?.stats?.sta).toBe(7);
    expect(activeItemInstanceStats(replaced)?.sta).toBe(7);
  });

  it('lets a promoted donor earn ranks again without a second promotion bill', () => {
    const w = fixture(4, 0);
    Object.assign(w.meta.inventory[0].instance!, {
      name: 'My Hammer',
      rolled: { quality: 'legendary', stats: { str: 2 } },
    });
    swapPerfectingRanks(w.sim.ctx, w.pid, w.request());
    const ref = { bag: 0, itemId: CHEST };
    const info = perfectingInfoFrom({ ...w.reads(), ref, craftSkills: w.meta.craftSkills });
    expect(info).toMatchObject({ promoted: true, perfected: false });
    expect(info?.materials.map((m) => m.itemId)).toEqual([
      'makers_ember',
      'sundered_essence',
      'prismglass_setting',
    ]);
    for (const itemId of ['makers_ember', 'sundered_essence', 'prismglass_setting'])
      w.sim.addItem(itemId, 4, w.pid);
    vi.spyOn(w.sim.rng, 'next').mockReturnValue(0);
    for (let n = 0; n < 4; n++) resolvePerfectingAttempt(w.sim.ctx, w.pid, ref);
    expect(w.meta.inventory[0].instance).toMatchObject({
      perfected: true,
      name: 'My Hammer',
      rolled: { quality: 'legendary', stats: { str: 2 } },
    });
  });

  it('round-trips the bounded contribution and permanent binding without sharing nested state', () => {
    const w = fixture(4, 0);
    swapPerfectingRanks(w.sim.ctx, w.pid, w.request());
    const saved = w.sim.serializeCharacter(w.pid)!;
    const restored = new Sim({
      seed: 85,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = restored.addPlayer('warrior', 'Restored', { state: saved });
    const meta = restored.players.get(pid)!;
    expect(meta.inventory[0].instance).toEqual(w.meta.inventory[0].instance);
    meta.inventory[0].instance!.perfectingBonus!.str = 100;
    expect(w.meta.inventory[0].instance!.perfectingBonus!.str).toBe(2);
    const malformed = sanitizeItemInstancePayloadOnLoad({
      perfectingBound: 'yes',
      perfectingBonus: { str: Number.NaN },
      signer: 'Artisan',
    });
    expect(malformed.dropped).toEqual(['perfectingBound', 'perfectingBonus']);
    expect(malformed.payload).toEqual({ signer: 'Artisan' });
  });
});
