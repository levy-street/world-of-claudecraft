// PERMANENT REGRESSION PIN, promoted from the hostile audit that found it: a
// bank round trip used to launder the craft-provenance marker off an INSTANCED
// slot, defeating the craft-then-disenchant anti-farming gate. The instanced
// arm of moveBetweenContainers (src/sim/bank.ts) omitted craftedRecipeId from
// both countFit and addStacked while the plain arm right below it threaded it
// through, so a slot carrying BOTH carriers lost the marker. It affects the
// SHIPPED personal bank identically, which is why case 4 exists.
import { describe, expect, it } from 'vitest';
import { bankDeposit, bankWithdraw } from '../src/sim/bank';
import { ENCHANTS } from '../src/sim/content/enchants';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { enchantedPayloadFor, resolveDisenchant } from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import type { Entity, EquipSlot, WorldContent } from '../src/sim/types';

const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'] as const;
const WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: Object.fromEntries(BANKERS.map((id) => [id, BUILTIN_WORLD.npcs[id]])),
  groundObjects: [],
};
const GUILD_ID = 7;
// A shipped, disenchantable common weapon (tests/professions_enchanting.test.ts
// uses the same one) whose def is craft-provenance TRACKED
// (crafting.ts isCraftedDisenchantTrackedOutput: weapon/armor, quality != poor).
const WEAPON = 'moggers_copper_cudgel';
const RECIPE = 'recipe_moggers_copper_cudgel';

function officerAtBanker(): Sim {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false, world: WORLD });
  let banker: Entity | null = null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === BANKERS[0]) banker = e;
  }
  if (!banker) throw new Error('banker is not spawned');
  const p = sim.entities.get(sim.playerId);
  if (!p) throw new Error('missing player');
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'officer' });
  sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
  return sim;
}

const meta = (sim: Sim) => {
  const m = sim.players.get(sim.playerId);
  if (!m) throw new Error('missing meta');
  return m;
};

describe('a bank round trip must keep craft provenance on an INSTANCED slot', () => {
  it('0: the target weapon is guild-bank eligible (not quest/soulbound/noMarketList)', () => {
    const def = ITEMS[WEAPON];
    expect(def).toBeDefined();
    expect(def.kind).toBe('weapon');
    expect(def.quality).not.toBe('poor');
    expect(def.soulbound ?? false).toBe(false);
    expect(def.noMarketList ?? false).toBe(false);
  });

  // Reachability: equip a crafted copy, enchant it while WORN (the payload
  // enchanting.ts:694 writes, built here by the real exported
  // enchantedPayloadFor), then unequip through the real items.ts path.
  it('1: a crafted + worn-enchanted weapon unequips into a slot carrying BOTH instance and craftedRecipeId', () => {
    const sim = officerAtBanker();
    sim.setPlayerLevel(20); // the weapon requires level 7
    sim.unequipItem('mainhand' as never);
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({ itemId: WEAPON, count: 1, craftedRecipeId: RECIPE });

    sim.equipItem(WEAPON);
    // The equip carried the marker INTO the worn payload (items.ts equipmentPayloadFor).
    const worn = meta(sim).equipmentInstance;
    const slotKey = (Object.keys(worn) as EquipSlot[]).find(
      (k) => worn[k]?.craftedRecipeId === RECIPE,
    );
    expect(slotKey, 'worn payload should carry the marker').toBeDefined();

    // The real worn-enchant write (enchanting.ts:694), reagent gate skipped.
    if (!slotKey) throw new Error('no worn payload');
    const wornSlot = worn[slotKey];
    if (!wornSlot) throw new Error('no worn payload');
    worn[slotKey] = enchantedPayloadFor(wornSlot, ENCHANTS.enchant_weapon_might);
    expect(worn[slotKey]?.craftedRecipeId).toBe(RECIPE);
    expect(worn[slotKey]?.enchant).toBe('enchant_weapon_might');

    sim.unequipItem(slotKey);
    const back = meta(sim).inventory.find((s) => s.itemId === WEAPON);
    expect(back?.craftedRecipeId).toBe(RECIPE);
    expect(back?.instance).toBeDefined(); // BOTH carriers present: the vulnerable shape
  });

  it('2: a guild bank round trip of that slot MUST keep craftedRecipeId', () => {
    const sim = officerAtBanker();
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({
      itemId: WEAPON,
      count: 1,
      instance: enchantedPayloadFor(undefined, ENCHANTS.enchant_weapon_might),
      craftedRecipeId: RECIPE,
    });
    sim.guildBankDepositFor(sim.playerId, 0);
    expect(sim.guildBanks.get(GUILD_ID)?.inventory[0]?.craftedRecipeId).toBe(RECIPE);
    sim.guildBankWithdrawFor(sim.playerId, 0);
    expect(meta(sim).inventory[0]?.craftedRecipeId).toBe(RECIPE);
  });

  it('3: the round-tripped copy still disenchants for NO enchanting skill (the anti-farm gate)', () => {
    // Control: the marker intact denies the skill (the shipped anti-farm rule).
    const control = officerAtBanker();
    control.players.get(control.playerId)!.inventory.length = 0;
    control.players.get(control.playerId)!.inventory.push({
      itemId: WEAPON,
      count: 1,
      instance: enchantedPayloadFor(undefined, ENCHANTS.enchant_weapon_might),
      craftedRecipeId: RECIPE,
    });
    expect(resolveDisenchant(control.ctx, control.playerId, WEAPON).ok).toBe(true);
    expect(meta(control).craftSkills.enchanting ?? 0).toBe(0);

    // Attack: the same copy after ONE guild bank round trip.
    const sim = officerAtBanker();
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({
      itemId: WEAPON,
      count: 1,
      instance: enchantedPayloadFor(undefined, ENCHANTS.enchant_weapon_might),
      craftedRecipeId: RECIPE,
    });
    sim.guildBankDepositFor(sim.playerId, 0);
    sim.guildBankWithdrawFor(sim.playerId, 0);
    expect(resolveDisenchant(sim.ctx, sim.playerId, WEAPON).ok).toBe(true);
    // SAFE expectation: the round trip changed nothing, so still zero gain.
    expect(meta(sim).craftSkills.enchanting ?? 0).toBe(0);
  });

  it('4: the PERSONAL bank (shared moveBetweenContainers) keeps it too', () => {
    const sim = officerAtBanker();
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({
      itemId: WEAPON,
      count: 1,
      instance: enchantedPayloadFor(undefined, ENCHANTS.enchant_weapon_might),
      craftedRecipeId: RECIPE,
    });
    bankDeposit(sim.ctx, 0, undefined, sim.playerId);
    bankWithdraw(sim.ctx, 0, undefined, sim.playerId);
    expect(meta(sim).inventory[0]?.craftedRecipeId).toBe(RECIPE);
  });
});
