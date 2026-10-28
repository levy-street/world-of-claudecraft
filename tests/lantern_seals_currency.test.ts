// Lantern Seals are a currency (src/sim/lantern_seals.ts), not a bag item, in
// the Heroic Marks shape: the inventory hub credits PlayerMeta.lanternSeals, the
// bag capacity gates treat the id as costing no space, a contract pays into the
// balance even with full bags, the quartermaster debits the balance, a
// pre-currency save folds its legacy stacks in on load, and the balance persists
// and rides the `gcon` self key to the online client.

import { describe, expect, it } from 'vitest';
import { emitQuestSelfKeys } from '../server/quest_snapshot_wire';
import { bagPools, countFit, fitsAll } from '../src/sim/bags';
import { LANTERN_SEAL_ITEM_ID } from '../src/sim/content/guild_contracts';
import { creditCurrencyGrant, isCurrencyGrantId } from '../src/sim/currency_grants';
import { BUILTIN_WORLD } from '../src/sim/data';
import { guildContractsForWeek, onKillForGuildContracts } from '../src/sim/guild_contracts';
import {
  absorbLegacyLanternSealSlots,
  creditLanternSeals,
  sanitizeLanternSeals,
  spendLanternSeals,
} from '../src/sim/lantern_seals';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';

const QUIET_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

const makeSim = () =>
  new Sim({ seed: 31, playerClass: 'warrior', noPlayer: true, world: QUIET_WORLD });

function fillBags(sim: Sim, pid: number): void {
  const meta = sim.meta(pid)!;
  meta.inventory = Array.from({ length: sim.bagCapacity }, () => ({
    itemId: 'worn_sword',
    count: 1,
  }));
}

function bagSeals(sim: Sim, pid: number): number {
  return sim
    .meta(pid)!
    .inventory.filter((slot) => slot.itemId === LANTERN_SEAL_ITEM_ID)
    .reduce((n, slot) => n + slot.count, 0);
}

describe('lantern seals: the pure currency helpers', () => {
  it('names lantern_seal as a currency grant beside the Heroic Mark', () => {
    // The persisted save token: frozen to the legacy item id.
    expect(LANTERN_SEAL_ITEM_ID).toBe('lantern_seal');
    expect(isCurrencyGrantId(LANTERN_SEAL_ITEM_ID)).toBe(true);
    expect(isCurrencyGrantId('heroic_mark')).toBe(true);
    expect(isCurrencyGrantId('reins_lantern_hall_destrier')).toBe(false);
  });

  it('routes each currency id onto its own counter', () => {
    const holder: { heroicMarks?: number; lanternSeals?: number } = {};
    creditCurrencyGrant(holder, LANTERN_SEAL_ITEM_ID, 4);
    creditCurrencyGrant(holder, 'heroic_mark', 2);
    creditCurrencyGrant(holder, 'worn_sword', 9);
    expect(holder).toEqual({ lanternSeals: 4, heroicMarks: 2 });
  });

  it('clamps, credits and spends whole non-negative amounts', () => {
    expect(sanitizeLanternSeals(7.9)).toBe(7);
    expect(sanitizeLanternSeals(-1)).toBe(0);
    expect(sanitizeLanternSeals('9')).toBe(0);
    expect(sanitizeLanternSeals(Number.NaN)).toBe(0);
    const holder: { lanternSeals?: number } = {};
    creditLanternSeals(holder, 3.7);
    creditLanternSeals(holder, -5);
    expect(holder.lanternSeals).toBe(3);
    expect(spendLanternSeals(holder, 4)).toBe(false);
    expect(spendLanternSeals(holder, 0)).toBe(false);
    expect(holder.lanternSeals).toBe(3);
    expect(spendLanternSeals(holder, 3)).toBe(true);
    expect(holder.lanternSeals).toBe(0);
  });

  it('folds legacy bag AND bank stacks into the balance and removes them', () => {
    const meta = {
      lanternSeals: 2,
      inventory: [
        { itemId: LANTERN_SEAL_ITEM_ID, count: 30 },
        { itemId: 'worn_sword', count: 1 },
        { itemId: LANTERN_SEAL_ITEM_ID, count: 5 },
      ],
      bank: { inventory: [{ itemId: LANTERN_SEAL_ITEM_ID, count: 6 }] },
    };
    expect(absorbLegacyLanternSealSlots(meta)).toBe(41);
    expect(meta.lanternSeals).toBe(43);
    expect(meta.inventory).toEqual([{ itemId: 'worn_sword', count: 1 }]);
    expect(meta.bank.inventory).toEqual([]);
    expect(absorbLegacyLanternSealSlots(meta)).toBe(0);
    expect(meta.lanternSeals).toBe(43);
  });
});

describe('lantern seals: never a bag slot', () => {
  it('fits seals whole into full bags and credits the counter through the hub', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Packed');
    fillBags(sim, pid);
    const meta = sim.meta(pid)!;
    const pools = bagPools(meta.bags);
    expect(sim.canAddItem(LANTERN_SEAL_ITEM_ID, 500, pid)).toBe(true);
    expect(countFit(meta.inventory, pools, LANTERN_SEAL_ITEM_ID, 9)).toBe(9);
    expect(fitsAll(meta.inventory, pools, [{ itemId: LANTERN_SEAL_ITEM_ID, count: 9 }])).toBe(true);
    sim.drainEvents();
    sim.addItem(LANTERN_SEAL_ITEM_ID, 5, pid);
    expect(meta.lanternSeals).toBe(5);
    expect(meta.inventory).toHaveLength(sim.bagCapacity);
    expect(bagSeals(sim, pid)).toBe(0);
    const receipt = (sim.drainEvents() as SimEvent[]).find(
      (event) => event.type === 'loot' && event.pid === pid,
    );
    expect(receipt).toMatchObject({ type: 'loot', text: 'You receive: Lantern Seal x5.' });
  });

  it('pays a contract into the balance even when the bags are full', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    // a reset day whose week posts the named-boss contract below
    let week = 0;
    while (!guildContractsForWeek(`wk_${week}`).some((c) => c.id === 'gc_boss_morthen')) week++;
    sim.resetDay = new Date(Date.UTC(2026, 8, 1 + week * 7)).toISOString().slice(0, 10);
    const pid = sim.player.id;
    fillBags(sim, pid);
    const meta = sim.meta(pid)!;
    const contract = guildContractsForWeek(`wk_${week}`).find((c) => c.id === 'gc_boss_morthen')!;
    const boss = { id: 999_999, kind: 'mob', templateId: contract.mobId } as Entity;
    onKillForGuildContracts(sim.ctx, boss, false, [meta], [], [], () => {});
    expect(meta.lanternSeals).toBe(contract.seals);
    expect(bagSeals(sim, pid)).toBe(0);
    // the IWorld read the Guild Hall and the Currencies tab draw
    expect(sim.guildContracts.seals).toBe(contract.seals);
  });
});

describe('lantern seals: persistence and the legacy-save fold', () => {
  it('saves the balance, omits it at zero, and restores it', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Saver');
    expect('lanternSeals' in sim.serializeCharacter(pid)!).toBe(false);
    sim.addItem(LANTERN_SEAL_ITEM_ID, 14, pid);
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.lanternSeals).toBe(14);
    expect(saved.inventory.some((slot) => slot.itemId === LANTERN_SEAL_ITEM_ID)).toBe(false);
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state: saved });
    expect(sim2.meta(pid2)!.lanternSeals).toBe(14);
  });

  it('loads a pre-currency save: bag and bank seal stacks become the balance', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Veteran');
    const legacy = sim.serializeCharacter(pid)!;
    legacy.inventory = [...legacy.inventory, { itemId: LANTERN_SEAL_ITEM_ID, count: 20 }];
    legacy.bank = {
      ...(legacy.bank ?? { inventory: [], purchasedSlots: 0, bonusSlots: 0 }),
      inventory: [{ itemId: LANTERN_SEAL_ITEM_ID, count: 4 }],
    } as typeof legacy.bank;
    legacy.lanternSeals = 1;
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Veteran', { state: legacy });
    const meta = sim2.meta(pid2)!;
    expect(meta.lanternSeals).toBe(25);
    expect(bagSeals(sim2, pid2)).toBe(0);
    expect(meta.bank.inventory.some((slot) => slot.itemId === LANTERN_SEAL_ITEM_ID)).toBe(false);
    const resaved = sim2.serializeCharacter(pid2)!;
    expect(resaved.lanternSeals).toBe(25);
    expect(resaved.inventory.some((slot) => slot.itemId === LANTERN_SEAL_ITEM_ID)).toBe(false);
  });

  it('loads a corrupt saved balance as zero', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Corrupt');
    const saved = { ...sim.serializeCharacter(pid)!, lanternSeals: -40 };
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Corrupt', { state: saved });
    expect(sim2.meta(pid2)!.lanternSeals).toBe(0);
  });
});

describe('lantern seals: the online mirror', () => {
  it('ships the balance inside the gcon self key', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Wired');
    sim.addItem(LANTERN_SEAL_ITEM_ID, 9, pid);
    const sent = new Map<string, unknown>();
    emitQuestSelfKeys((key, value) => sent.set(key, value), sim, sim.meta(pid)!);
    expect(sent.get('gcon')).toMatchObject({ seals: 9 });
  });
});
