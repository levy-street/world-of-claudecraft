import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import { generateProceduralItem } from '../src/sim/loot/procedural';
import { unbindItem } from '../src/sim/professions/commission';
import {
  ENCHANTING_GAIN_TIER_BY_QUALITY,
  isDisenchantable,
  resolveApplyEnchant,
  resolveDisenchant,
} from '../src/sim/professions/enchanting';
import { professionItemLevel, professionItemQuality } from '../src/sim/professions/item_instance';
import { isSalvageable, resolveSalvage } from '../src/sim/professions/salvage';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';

const BASE_ID = 'iron_broadsword';
const ENCHANT_ID = 'enchant_weapon_might';
const UID_COMMON = 'pi1:profession-authority:2001';
const UID_LEGENDARY = 'pi1:profession-authority:2002';

function generated(
  uid: string,
  seed: number,
  rarity: 'common' | 'legendary',
  extras: Omit<ItemInstancePayload, 'procedural'> = {},
): ItemInstancePayload {
  return {
    ...extras,
    ...generateProceduralItem({
      seed,
      uid,
      context: {
        source: 'dungeon',
        sourceEntityId: 91,
        sourceSpawnSequence: seed,
        lootSlotIndex: seed % 3,
      },
      basePoolId: 'initial_dungeon_boss',
      rarityTableId: 'initial_dungeon_boss',
      sourceItemLevel: 40,
      forcedItemLevel: 40,
      forcedBaseId: BASE_ID,
      forcedRarity: rarity,
    }).instance,
  };
}

function world(): { sim: Sim; pid: number; meta: PlayerMeta } {
  const sim = new Sim({ seed: 112233, playerClass: 'warrior', autoEquip: false });
  const pid = sim.playerId;
  const meta = sim.meta(pid);
  if (!meta) throw new Error('missing player');
  meta.inventory = [];
  meta.autoEquip = false;
  return { sim, pid, meta };
}

function addPair(
  sim: Sim,
  pid: number,
  commonExtras: Omit<ItemInstancePayload, 'procedural'> = {},
  legendaryExtras: Omit<ItemInstancePayload, 'procedural'> = {},
): void {
  sim.addItemInstance(BASE_ID, generated(UID_COMMON, 201, 'common', commonExtras), pid);
  sim.addItemInstance(BASE_ID, generated(UID_LEGENDARY, 202, 'legendary', legendaryExtras), pid);
}

function copy(meta: PlayerMeta, uid: string): ItemInstancePayload | undefined {
  return meta.inventory.find((slot) => slot.instance?.procedural?.uid === uid)?.instance;
}

describe('procedural profession server authority', () => {
  it('derives profession rarity and tier from the authoritative generated copy', () => {
    const payload = generated(UID_LEGENDARY, 202, 'legendary');
    expect(professionItemQuality(ITEMS[BASE_ID], payload)).toBe('legendary');
    expect(professionItemLevel(ITEMS[BASE_ID], payload)).toBe(20);
  });

  it('keeps generated held off-hands in both profession material sinks', () => {
    expect(ITEMS.gravecaller_focus.kind).toBe('held_offhand');
    expect(isDisenchantable(ITEMS.gravecaller_focus)).toBe(true);
    expect(isSalvageable(ITEMS.gravecaller_focus)).toBe(true);
  });

  it('credits procedural rarity to discovery deeds on grant', () => {
    const { sim, pid, meta } = world();
    sim.addItemInstance(BASE_ID, generated(UID_LEGENDARY, 202, 'legendary'), pid);
    expect(meta.deedStats.itemsDiscovered.has(BASE_ID)).toBe(true);
    expect(meta.deedStats.visited.has('quality:legendary')).toBe(true);
  });
  it('disenchants only the selected UID and uses that copy rarity for rewards and skill', () => {
    const { sim, pid, meta } = world();
    addPair(sim, pid);

    const result = resolveDisenchant(sim.ctx, pid, BASE_ID, UID_LEGENDARY);

    expect(result).toMatchObject({
      ok: true,
      materialItemId: 'arcane_shard',
      secondaryItemId: 'resonant_steel',
    });
    expect(copy(meta, UID_COMMON)).toBeDefined();
    expect(copy(meta, UID_LEGENDARY)).toBeUndefined();
    expect(meta.craftSkills.enchanting).toBeGreaterThan(0);
    expect(ENCHANTING_GAIN_TIER_BY_QUALITY.legendary).toBe(4);
  });

  it('salvages only the selected UID and prices the yield from that copy', () => {
    const { sim, pid, meta } = world();
    addPair(sim, pid);

    const result = resolveSalvage(sim.ctx, pid, BASE_ID, UID_LEGENDARY);

    expect(result.ok).toBe(true);
    expect(result.materialItemId).toBe('spider_leg');
    expect(result.count).toBeGreaterThanOrEqual(8);
    expect(copy(meta, UID_COMMON)).toBeDefined();
    expect(copy(meta, UID_LEGENDARY)).toBeUndefined();
  });

  it('applies and replaces enchants only on the selected bagged UID', () => {
    const { sim, pid, meta } = world();
    addPair(sim, pid);
    for (const reagent of ENCHANTS[ENCHANT_ID].reagents) {
      sim.addItem(reagent.itemId, reagent.count, pid);
    }

    const result = resolveApplyEnchant(
      sim.ctx,
      pid,
      BASE_ID,
      ENCHANT_ID,
      undefined,
      undefined,
      UID_LEGENDARY,
    );

    expect(result.ok).toBe(true);
    expect(copy(meta, UID_COMMON)?.enchant).toBeUndefined();
    expect(copy(meta, UID_LEGENDARY)?.enchant).toBe(ENCHANT_ID);
  });

  it('rejects a stale or forged UID before inventory, reagents, RNG, skill, or gold change', () => {
    const { sim, pid, meta } = world();
    addPair(sim, pid);
    for (const reagent of ENCHANTS[ENCHANT_ID].reagents) {
      sim.addItem(reagent.itemId, reagent.count, pid);
    }
    const before = structuredClone(sim.serializeCharacter(pid));

    expect(resolveDisenchant(sim.ctx, pid, BASE_ID, 'pi1:forged').reason).toBe('not_held');
    expect(resolveSalvage(sim.ctx, pid, BASE_ID, 'pi1:forged').reason).toBe('not_held');
    expect(
      resolveApplyEnchant(sim.ctx, pid, BASE_ID, ENCHANT_ID, undefined, undefined, 'pi1:forged')
        .reason,
    ).toBe('not_held');
    expect(meta.inventory).toEqual(before?.inventory);
    expect(meta.copper).toBe(before?.copper);
    expect(meta.craftSkills).toEqual(before?.craftSkills);
  });

  it('unbinds only the selected UID and charges its procedural rarity fee', () => {
    const { sim, pid, meta } = world();
    addPair(sim, pid, { bindOnTrade: true, boundTo: pid }, { bindOnTrade: true, boundTo: pid });
    const station = sim.stationPlacements[0];
    const entity = sim.entities.get(pid);
    if (!station || !entity) throw new Error('missing station fixture');
    entity.pos = { ...entity.pos, ...station.pos };
    entity.prevPos = { ...entity.pos };
    meta.copper = 50_000;

    const result = unbindItem(sim.ctx, BASE_ID, pid, UID_LEGENDARY);

    expect(result).toMatchObject({ ok: true, fee: 40_000 });
    expect(copy(meta, UID_COMMON)?.boundTo).toBe(pid);
    expect(copy(meta, UID_LEGENDARY)?.boundTo).toBeUndefined();
    expect(meta.copper).toBe(10_000);
  });
});
