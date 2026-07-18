import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { canDualWield, canDualWieldTwoHand } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';

function addWithoutAutoEquip(sim: Sim, itemId: string, count = 1): void {
  const meta = sim.meta(sim.player.id)!;
  meta.autoEquip = false;
  sim.addItem(itemId, count);
}

describe('v0.26 canonical right-click equip routing', () => {
  it('keeps ordinary one-hand routing in the mainhand for a non-dual-wielder', () => {
    const sim = new Sim({ seed: 2610, playerClass: 'paladin', autoEquip: true });
    addWithoutAutoEquip(sim, 'redbrook_blade');

    sim.equipItem('redbrook_blade');

    expect(sim.equipment.mainhand).toBe('redbrook_blade');
    expect(sim.equipment.offhand).toBeUndefined();
  });

  it('delegates Rogue one-hand routing to the canonical dual-wield rule', () => {
    const sim = new Sim({ seed: 2611, playerClass: 'rogue', autoEquip: true });
    addWithoutAutoEquip(sim, 'keen_dirk');

    sim.equipItem('keen_dirk');

    expect(canDualWield('rogue', null)).toBe(true);
    expect(sim.equipment.mainhand).toBe('rusty_dagger');
    expect(sim.equipment.offhand).toBe('keen_dirk');
  });

  it('routes a Fury one-hander to the offhand', () => {
    const sim = new Sim({ seed: 2612, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('fury')).toBe(true);
    addWithoutAutoEquip(sim, 'redbrook_blade');

    sim.equipItem('redbrook_blade');

    expect(canDualWield('warrior', 'fury')).toBe(true);
    expect(sim.equipment.mainhand).toBe('worn_sword');
    expect(sim.equipment.offhand).toBe('redbrook_blade');
  });

  it('uses the natural two-click Titan Grip flow and benches the illegal offhand on switch', () => {
    const sim = new Sim({ seed: 2613, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('fury')).toBe(true);
    addWithoutAutoEquip(sim, 'eastbrook_greatsword', 2);

    sim.equipItem('eastbrook_greatsword');
    sim.equipItem('eastbrook_greatsword');

    expect(canDualWieldTwoHand('warrior', 'fury')).toBe(true);
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBe('eastbrook_greatsword');
    expect(sim.player.offhandWeapon).toEqual(ITEMS.eastbrook_greatsword.weapon);

    expect(sim.setSpec('arms')).toBe(true);
    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBeUndefined();
    expect(sim.countItem('eastbrook_greatsword')).toBe(1);
  });
});
