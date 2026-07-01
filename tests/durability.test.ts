import { describe, expect, it } from 'vitest';
import {
  currentDurabilityForSlot,
  damageEquippedDurability,
  durabilityReadout,
  equipmentRepairCost,
  maxDurabilityForItem,
  normalizeEquipmentDurability,
} from '../src/sim/durability';
import * as items from '../src/sim/items';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function vendorPlayer(sim: Sim) {
  const pid = sim.addPlayer('warrior', 'Fixit');
  const anySim = sim as unknown as {
    entities: Map<number, Entity>;
    players: Map<
      number,
      {
        copper: number;
        equipment: Record<string, string>;
        equipmentDurability: Record<string, number>;
      }
    >;
    rebucket(e: Entity): void;
  };
  const merchant = [...anySim.entities.values()].find(
    (e) =>
      e.kind === 'npc' && (e as unknown as { templateId?: string }).templateId === 'trader_wilkes',
  );
  if (!merchant) throw new Error('merchant not found');
  const player = anySim.entities.get(pid);
  if (!player) throw new Error('player not found');
  player.pos.x = merchant.pos.x + 2;
  player.pos.z = merchant.pos.z;
  anySim.rebucket(player);
  const meta = anySim.players.get(pid);
  if (!meta) throw new Error('meta not found');
  return { pid, meta, player };
}

function eventsOf<T extends SimEvent['type']>(
  events: SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('equipment durability helpers', () => {
  it('treats absent current durability as full and persists only damaged slots', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeTruthy();
    if (!meta) return;

    const mainhandMax = maxDurabilityForItem(meta.equipment.mainhand);
    const chestMax = maxDurabilityForItem(meta.equipment.chest);
    expect(mainhandMax).toBeGreaterThan(0);
    expect(chestMax).toBeGreaterThan(0);
    expect(currentDurabilityForSlot(meta, 'mainhand')).toBe(mainhandMax);

    meta.equipmentDurability = {
      mainhand: mainhandMax - 3,
      chest: chestMax,
      helmet: 12,
    };
    expect(normalizeEquipmentDurability(meta.equipment, meta.equipmentDurability)).toEqual({
      mainhand: mainhandMax - 3,
    });
  });

  it('applies deterministic death-style durability loss to equipped gear', () => {
    const sim = new Sim({ seed: 2, playerClass: 'warrior' });
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeTruthy();
    if (!meta) return;

    const mainhandMax = maxDurabilityForItem(meta.equipment.mainhand);
    const chestMax = maxDurabilityForItem(meta.equipment.chest);
    const changed = damageEquippedDurability(meta);

    expect(changed.mainhand).toBe(mainhandMax - Math.ceil(mainhandMax * 0.1));
    expect(changed.chest).toBe(chestMax - Math.ceil(chestMax * 0.1));
    expect(meta.equipmentDurability).toEqual(changed);
  });
});

describe('vendor repair', () => {
  it('repairs damaged equipped gear at a nearby merchant and charges the purse', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true });
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    const mainhandMax = maxDurabilityForItem(meta.equipment.mainhand);
    const chestMax = maxDurabilityForItem(meta.equipment.chest);
    meta.equipmentDurability = { mainhand: mainhandMax - 5, chest: chestMax - 10 };
    const cost = equipmentRepairCost(meta as never).total;
    meta.copper = cost;

    items.repairAll(ctx, pid);

    expect(meta.copper).toBe(0);
    expect(meta.equipmentDurability).toEqual({});
    const events = sim.drainEvents();
    expect(events).toContainEqual({ type: 'vendor', action: 'repair', pid });
    expect(eventsOf(events, 'loot')[0]?.text).toBe(`Repaired your equipment for ${cost}c.`);
  });

  it('requires a nearby merchant and enough copper', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Far');
    const meta = sim.meta(pid);
    expect(meta).toBeTruthy();
    if (!meta) return;
    const mainhandMax = maxDurabilityForItem(meta.equipment.mainhand);
    meta.equipmentDurability = { mainhand: mainhandMax - 10 };
    meta.copper = 1000;

    items.repairAll(ctxOf(sim), pid);
    expect(eventsOf(sim.drainEvents(), 'error')[0]?.text).toBe('There is no merchant nearby.');

    const near = vendorPlayer(sim);
    const nearMax = maxDurabilityForItem(near.meta.equipment.mainhand);
    near.meta.equipmentDurability = { mainhand: nearMax - 10 };
    near.meta.copper = 0;
    items.repairAll(ctxOf(sim), near.pid);
    expect(eventsOf(sim.drainEvents(), 'error')[0]?.text).toBe('Not enough money.');
  });

  it('routes /durability and /repair through chat commands', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', noPlayer: true });
    const { pid, meta } = vendorPlayer(sim);
    const mainhand = meta.equipment.mainhand;
    expect(mainhand).toBeTruthy();
    const mainhandMax = maxDurabilityForItem(mainhand);
    meta.equipmentDurability = { mainhand: mainhandMax - 7 };
    const cost = equipmentRepairCost(meta as never).total;
    meta.copper = cost;

    sim.chat('/durability', pid);
    expect(eventsOf(sim.drainEvents(), 'error')[0]?.text).toBe(durabilityReadout(meta as never));

    sim.chat('/repair', pid);
    expect(meta.equipmentDurability).toEqual({});
    expect(eventsOf(sim.drainEvents(), 'vendor')[0]?.action).toBe('repair');
  });
});

describe('equipment durability lifecycle', () => {
  it('resets a slot when a replacement is equipped or unequipped', () => {
    const sim = new Sim({ seed: 6, playerClass: 'warrior', noPlayer: true });
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('cryptbone_helm', 1, pid);
    items.equipItem(ctx, 'cryptbone_helm', pid);
    const helmMax = maxDurabilityForItem('cryptbone_helm');
    meta.equipmentDurability.helmet = helmMax - 5;

    sim.addItem('roadwardens_helm', 1, pid);
    items.equipItem(ctx, 'roadwardens_helm', pid);
    expect(meta.equipmentDurability.helmet).toBeUndefined();

    meta.equipmentDurability.helmet = maxDurabilityForItem('roadwardens_helm') - 5;
    expect(items.unequipItem(ctx, 'helmet', pid)).toBe(true);
    expect(meta.equipmentDurability.helmet).toBeUndefined();
  });
});
