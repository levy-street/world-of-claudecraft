import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

// Season 1 Armory weapon-skin behavior inside the deterministic sim: the same
// code resolves the active skin on every host, so these cover the offline path
// and the exact rules the server relies on (type match, loadout dormancy on a
// weapon-type swap, hunter's fixed ranged visual, and loadout seeding).

function newSim(cls: 'warrior' | 'hunter' | 'rogue') {
  const sim = new Sim({ seed: 5, playerClass: cls, playerName: 'Armory' });
  const pid = sim.primaryId;
  const e = sim.entities.get(pid);
  if (!e) throw new Error('no player entity');
  return { sim, pid, e };
}

describe('weapon skin sim behavior', () => {
  it('applies a matching-type skin to the equipped weapon and mirrors it on the entity', () => {
    const { sim, pid, e } = newSim('warrior');
    expect(e.mainhandItemId).toBe('worn_sword');
    expect(sim.setWeaponSkin(pid, 'ice_fang_sword')).toBe(true);
    expect(e.weaponSkinId).toBe('ice_fang_sword');
    expect(e.weaponSkinLoadout.sword).toBe('ice_fang_sword');
  });

  it('rejects a skin whose type does not match the equipped weapon', () => {
    const { sim, pid, e } = newSim('warrior');
    expect(sim.setWeaponSkin(pid, 'glaciersplit_axe')).toBe(false);
    expect(e.weaponSkinId).toBeNull();
    expect(sim.setWeaponSkin(pid, 'not_a_real_skin')).toBe(false);
  });

  it('parks the skin when a different weapon type is equipped and restores it on re-equip', () => {
    const { sim, pid, e } = newSim('warrior');
    sim.setWeaponSkin(pid, 'cinderbrand_sword');
    expect(e.weaponSkinId).toBe('cinderbrand_sword');
    sim.addItem('training_mace', 1, pid);
    sim.equipItem('training_mace', pid);
    expect(e.mainhandItemId).toBe('training_mace');
    expect(e.weaponSkinId).toBeNull(); // sword skin is dormant, not lost
    expect(e.weaponSkinLoadout.sword).toBe('cinderbrand_sword');
    sim.equipItem('worn_sword', pid);
    expect(e.weaponSkinId).toBe('cinderbrand_sword');
  });

  it('supports one applied skin per weapon type at once', () => {
    const { sim, pid, e } = newSim('warrior');
    sim.setWeaponSkin(pid, 'cinderbrand_sword');
    sim.addItem('training_mace', 1, pid);
    sim.equipItem('training_mace', pid);
    expect(sim.setWeaponSkin(pid, 'starfall_mace')).toBe(true);
    expect(e.weaponSkinId).toBe('starfall_mace');
    sim.equipItem('worn_sword', pid);
    expect(e.weaponSkinId).toBe('cinderbrand_sword');
    expect(Object.keys(e.weaponSkinLoadout).sort()).toEqual(['mace', 'sword']);
  });

  it('detaches by weapon type and re-resolves', () => {
    const { sim, pid, e } = newSim('warrior');
    sim.setWeaponSkin(pid, 'solheim_sword');
    expect(e.weaponSkinId).toBe('solheim_sword');
    expect(sim.setWeaponSkin(pid, null, 'sword')).toBe(true);
    expect(e.weaponSkinId).toBeNull();
    expect(e.weaponSkinLoadout.sword).toBeUndefined();
    // detaching an empty slot is a no-op
    expect(sim.setWeaponSkin(pid, null, 'sword')).toBe(false);
  });

  it('lets a hunter apply bow and crossbow skins, with the latest family displacing the other', () => {
    const { sim, pid, e } = newSim('hunter');
    expect(e.mainhandItemId).toBe('rusty_hatchet');
    // an axe skin does NOT apply: the hunter never displays the axe
    expect(sim.setWeaponSkin(pid, 'glaciersplit_axe')).toBe(false);
    expect(sim.setWeaponSkin(pid, 'winterbite')).toBe(true); // bow
    expect(e.weaponSkinId).toBe('winterbite');
    expect(sim.setWeaponSkin(pid, 'meteorlatch_crossbow')).toBe(true);
    expect(e.weaponSkinId).toBe('meteorlatch_crossbow');
    expect(e.weaponSkinLoadout).toEqual({ crossbow: 'meteorlatch_crossbow' });
    expect(sim.setWeaponSkin(pid, 'winterbite')).toBe(true);
    expect(e.weaponSkinId).toBe('winterbite');
    expect(e.weaponSkinLoadout).toEqual({ bow: 'winterbite' });
  });

  it('seeds a whole loadout (server join path) and drops mismatched entries', () => {
    const { sim, pid, e } = newSim('rogue');
    expect(e.mainhandItemId).toBe('rusty_dagger');
    sim.setWeaponSkinLoadout(pid, {
      dagger: 'astravyr_dagger',
      sword: 'ice_fang_sword',
      mace: 'astravyr_dagger', // wrong type for the slot: dropped
    });
    expect(e.weaponSkinId).toBe('astravyr_dagger');
    expect(e.weaponSkinLoadout).toEqual({ dagger: 'astravyr_dagger', sword: 'ice_fang_sword' });
  });
});

// Reported from live play: a dual-wielder whose only mace sits in the OFFHAND
// (a rogue keeps the dagger mainhand and the equip resolver parks a mace in the
// offhand) owned the legendary mace skin, saw it as owned in the store, and
// could never apply it. The rules read the mainhand alone, so the offhand mace
// never counted as "a mace equipped". Both hands count now.
describe('weapon skin on an offhand-only weapon type', () => {
  it('lets a rogue apply a mace skin when the mace is held in the offhand', () => {
    const { sim, pid, e } = newSim('rogue');
    sim.setPlayerLevel(30, pid);
    sim.addItem('forgefathers_warhammer', 1, pid);
    sim.equipItemToSlot('forgefathers_warhammer', 'offhand', pid);
    expect(e.mainhandItemId).toBe('rusty_dagger');
    expect(e.offhandItemId).toBe('forgefathers_warhammer');
    expect(sim.setWeaponSkin(pid, 'starfall_mace')).toBe(true);
    expect(e.weaponSkinId).toBe('starfall_mace');
    expect(e.weaponSkinLoadout.mace).toBe('starfall_mace');
  });

  it('prefers the mainhand type when both hands carry an applied skin', () => {
    const { sim, pid, e } = newSim('rogue');
    sim.setPlayerLevel(30, pid);
    sim.addItem('forgefathers_warhammer', 1, pid);
    sim.equipItemToSlot('forgefathers_warhammer', 'offhand', pid);
    sim.setWeaponSkin(pid, 'starfall_mace');
    expect(sim.setWeaponSkin(pid, 'astravyr_dagger')).toBe(true);
    expect(e.weaponSkinId).toBe('astravyr_dagger');
    // The mace skin stays parked and returns once the dagger skin is detached.
    expect(e.weaponSkinLoadout).toEqual({ dagger: 'astravyr_dagger', mace: 'starfall_mace' });
    expect(sim.setWeaponSkin(pid, null, 'dagger')).toBe(true);
    expect(e.weaponSkinId).toBe('starfall_mace');
  });

  it('re-resolves the offhand-held skin when the offhand is swapped out', () => {
    const { sim, pid, e } = newSim('rogue');
    sim.setPlayerLevel(30, pid);
    sim.addItem('forgefathers_warhammer', 1, pid);
    sim.equipItemToSlot('forgefathers_warhammer', 'offhand', pid);
    sim.setWeaponSkin(pid, 'starfall_mace');
    expect(e.weaponSkinId).toBe('starfall_mace');
    sim.unequipItem('offhand', pid);
    expect(e.offhandItemId).toBeNull();
    expect(e.weaponSkinId).toBeNull(); // dormant, not lost
    expect(e.weaponSkinLoadout.mace).toBe('starfall_mace');
  });
});
