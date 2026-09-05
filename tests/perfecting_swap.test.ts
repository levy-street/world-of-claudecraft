import { describe, expect, it, vi } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { STATIONS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { recalcPlayerStats } from '../src/sim/entity';
import { isUniqueEquipped } from '../src/sim/equipment_rules';
import { activeItemInstanceStats } from '../src/sim/item_instance_stats';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import { isPerfectingBound, resolveUnbind } from '../src/sim/professions/commission';
import { enchantedPayloadFor, replacedEnchantPayloadFor } from '../src/sim/professions/enchanting';
import { capturePerfectItemRef } from '../src/sim/professions/perfecting_copy';
import { perfectingInfoFrom, resolvePerfectingAttempt } from '../src/sim/professions/perfecting';
import { perfectingSwapInfoFrom, swapPerfectingRanks } from '../src/sim/professions/perfecting_swap';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const CHEST = 'crucible_str_mail_chest';
const WAIST = 'crucible_str_mail_waist';

function fixture(sourceRank = 4, targetRank = 1) {
  const sim = new Sim({ seed: 85, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  const pid = sim.playerId;
  const meta = sim.players.get(pid) as PlayerMeta;
  const e = sim.player;
  meta.craftSkills.armorcrafting = 125;
  e.pos = { ...STATIONS.find((s) => s.type === 'forge')!.pos };
  const instance = (rank: number, bonus: number): ItemInstancePayload => ({
    signer: 'Artisan', perfectingBonus: { str: bonus },
    ...(rank === 4 ? { perfected: true, rolled: { stats: { str: bonus } } } : rank > 0 ? { perfecting: rank } : {}),
  });
  meta.inventory = [
    { itemId: CHEST, count: 1, instance: instance(sourceRank, 2), craftedRecipeId: `recipe_${CHEST}` },
    { itemId: WAIST, count: 1, instance: instance(targetRank, 1), craftedRecipeId: `recipe_${WAIST}` },
  ];
  const reads = () => ({ inventory: meta.inventory, equipment: meta.equipment, equipmentInstances: meta.equipmentInstance });
  const request = () => ({
    source: capturePerfectItemRef(reads(), { bag: 0, itemId: CHEST }),
    target: capturePerfectItemRef(reads(), { bag: 1, itemId: WAIST }),
  });
  const view = () => perfectingSwapInfoFrom({ ...reads(), ...request(), craftSkills: meta.craftSkills, dead: e.dead, inCombat: e.inCombat, pos: e.pos });
  return { sim, pid, meta, e, reads, request, view };
}

describe('Perfecting rank exchange', () => {
  it('exchanges four and one ranks without charging or drawing, binds both, and rejects replay', () => {
    const w = fixture();
    const request = w.request();
    const draws = vi.spyOn(w.sim.rng, 'next');
    const revision = w.meta.wireRev;
    const copper = w.meta.copper;
    expect(w.view()?.reason).toBeUndefined();
    expect(swapPerfectingRanks(w.sim.ctx, w.pid, request).ok).toBe(true);
    expect(w.meta.inventory[0].instance).toMatchObject({ perfecting: 1, perfectingBound: true, boundTo: w.pid, perfectingBonus: { str: 2 } });
    expect(w.meta.inventory[0].instance?.perfected).toBeUndefined();
    expect(w.meta.inventory[0].instance?.rolled?.stats?.str ?? 0).toBe(0);
    expect(w.meta.inventory[1].instance).toMatchObject({ perfected: true, perfectingBound: true, boundTo: w.pid, rolled: { stats: { str: 1 } } });
    expect(w.meta.inventory).toHaveLength(2);
    expect(w.meta.copper).toBe(copper);
    expect(w.meta.wireRev).toBe(revision + 1);
    expect(draws).not.toHaveBeenCalled();
    const after = JSON.stringify(w.meta.inventory);
    expect(swapPerfectingRanks(w.sim.ctx, w.pid, request)).toMatchObject({ ok: false, reason: 'no_item' });
    expect(JSON.stringify(w.meta.inventory)).toBe(after);
    expect(w.meta.wireRev).toBe(revision + 1);
  });

  it('keeps zero-rank donors permanently bound and preserves unknown provenance on repeated swaps', () => {
    const w = fixture(4, 0);
    Object.assign(w.meta.inventory[0].instance!, { name: 'My Hammer', rolled: { quality: 'legendary', stats: { str: 2 } }, futureRecord: { value: 7 }, boundTo: 991 });
    for (let n = 0; n < 20; n++) expect(swapPerfectingRanks(w.sim.ctx, w.pid, w.request()).ok).toBe(true);
    expect(w.meta.inventory[0].instance).toMatchObject({ perfected: true, rolled: { quality: 'legendary', stats: { str: 2 } }, name: 'My Hammer', boundTo: 991, futureRecord: { value: 7 } });
    swapPerfectingRanks(w.sim.ctx, w.pid, w.request());
    const donor = w.meta.inventory[0].instance!;
    expect(donor.perfecting).toBeUndefined();
    expect(donor.perfected).toBeUndefined();
    expect(isPerfectingBound(donor)).toBe(true);
    expect(isUniqueEquipped(ITEMS[CHEST], donor)).toBe(true);
    expect(resolveUnbind(STATIONS, w.meta, w.e.pos, CHEST)).toMatchObject({ ok: false, reason: 'unbind_perfecting' });
    expect(w.meta.inventory[0].craftedRecipeId).toBe(`recipe_${CHEST}`);
  });

  it.each(['dead', 'combat', 'station', 'skill', 'same', 'equal', 'missing_pin', 'stale_target', 'wrong_collection', 'bad_bonus'])(
    'refuses %s atomically before any write', (fault) => {
      const w = fixture();
      const request = w.request();
      if (fault === 'dead') w.e.dead = true;
      if (fault === 'combat') w.e.inCombat = true;
      if (fault === 'station') w.e.pos = { x: -50000, y: 0, z: -50000 };
      if (fault === 'skill') w.meta.craftSkills.armorcrafting = 124;
      if (fault === 'same') request.target = request.source;
      if (fault === 'missing_pin') delete request.target.copy;
      if (fault === 'stale_target') w.meta.inventory[1].instance!.signer = 'Changed';
      if (fault === 'wrong_collection') { w.meta.inventory[1].itemId = 'crucible_tank_mail_waist'; request.target = capturePerfectItemRef(w.reads(), { bag: 1, itemId: 'crucible_tank_mail_waist' }); }
      if (fault === 'equal') { w.meta.inventory[0].instance = { perfecting: 1, perfectingBonus: { str: 2 } }; request.source = capturePerfectItemRef(w.reads(), { bag: 0, itemId: CHEST }); }
      if (fault === 'bad_bonus') { delete w.meta.inventory[0].instance!.perfectingBonus; request.source = capturePerfectItemRef(w.reads(), { bag: 0, itemId: CHEST }); }
      const before = JSON.stringify(w.meta.inventory);
      const revision = w.meta.wireRev;
      const draws = vi.spyOn(w.sim.rng, 'next');
      expect(swapPerfectingRanks(w.sim.ctx, w.pid, request).ok).toBe(false);
      expect(JSON.stringify(w.meta.inventory)).toBe(before);
      expect(w.meta.wireRev).toBe(revision);
      expect(draws).not.toHaveBeenCalled();
    },
  );

  it('deactivates and restores the worn Perfected enchant, keeping replacement arithmetic exact', () => {
    const w = fixture(4, 0);
    const enchanted = enchantedPayloadFor(w.meta.inventory[0].instance, ENCHANTS.enchant_lucent_infusion);
    w.meta.equipment.chest = CHEST;
    w.meta.equipmentInstance.chest = enchanted;
    w.meta.inventory.splice(0, 1);
    w.e.level = 20;
    recalcPlayerStats(w.e, w.meta.cls, w.meta.equipment, w.sim.ctx.playerMods(w.meta), w.meta.equipmentInstance);
    const before = w.e.stats.sta;
    const request = () => ({ source: capturePerfectItemRef(w.reads(), { slot: 'chest' }), target: capturePerfectItemRef(w.reads(), { bag: 0, itemId: WAIST }) });
    expect(swapPerfectingRanks(w.sim.ctx, w.pid, request()).ok).toBe(true);
    expect(w.e.stats.sta).toBe(before - 13);
    expect(w.meta.equipmentInstance.chest?.enchant).toBe('enchant_lucent_infusion');
    expect(activeItemInstanceStats(w.meta.equipmentInstance.chest)?.sta ?? 0).toBe(0);
    expect(swapPerfectingRanks(w.sim.ctx, w.pid, request()).ok).toBe(true);
    expect(w.e.stats.sta).toBe(before);
    swapPerfectingRanks(w.sim.ctx, w.pid, request());
    const next = { ...ENCHANTS.enchant_lucent_infusion, id: 'test_ordinary', requiresPerfected: undefined, statBonus: { sta: 7 } };
    const replaced = replacedEnchantPayloadFor(w.meta.equipmentInstance.chest!, next);
    expect(replaced.rolled?.stats?.sta).toBe(7);
    expect(activeItemInstanceStats(replaced)?.sta).toBe(7);
  });

  it('lets a promoted donor earn ranks again without a second promotion bill', () => {
    const w = fixture(4, 0);
    Object.assign(w.meta.inventory[0].instance!, { name: 'My Hammer', rolled: { quality: 'legendary', stats: { str: 2 } } });
    swapPerfectingRanks(w.sim.ctx, w.pid, w.request());
    const ref = { bag: 0, itemId: CHEST };
    const info = perfectingInfoFrom({ ...w.reads(), ref, craftSkills: w.meta.craftSkills });
    expect(info).toMatchObject({ promoted: true, perfected: false });
    expect(info?.materials.map((m) => m.itemId)).toEqual(['makers_ember', 'sundered_essence', 'prismglass_setting']);
    for (const itemId of ['makers_ember', 'sundered_essence', 'prismglass_setting']) w.sim.addItem(itemId, 4, w.pid);
    vi.spyOn(w.sim.rng, 'next').mockReturnValue(0);
    for (let n = 0; n < 4; n++) resolvePerfectingAttempt(w.sim.ctx, w.pid, ref);
    expect(w.meta.inventory[0].instance).toMatchObject({ perfected: true, name: 'My Hammer', rolled: { quality: 'legendary', stats: { str: 2 } } });
  });

  it('round-trips the bounded contribution and permanent binding without sharing nested state', () => {
    const w = fixture(4, 0);
    swapPerfectingRanks(w.sim.ctx, w.pid, w.request());
    const saved = w.sim.serializeCharacter(w.pid)!;
    const restored = new Sim({ seed: 85, noPlayer: true, world: EMPTY_TEST_WORLD });
    const pid = restored.addPlayer('warrior', 'Restored', { state: saved });
    const meta = restored.players.get(pid)!;
    expect(meta.inventory[0].instance).toEqual(w.meta.inventory[0].instance);
    meta.inventory[0].instance!.perfectingBonus!.str = 100;
    expect(w.meta.inventory[0].instance!.perfectingBonus!.str).toBe(2);
    const malformed = sanitizeItemInstancePayloadOnLoad({ perfectingBound: 'yes', perfectingBonus: { str: Number.NaN }, signer: 'Artisan' });
    expect(malformed.dropped).toEqual(['perfectingBound', 'perfectingBonus']);
    expect(malformed.payload).toEqual({ signer: 'Artisan' });
  });
});
