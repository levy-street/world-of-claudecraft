import { describe, expect, it } from 'vitest';
import { updateTimers } from '../../src/sim/combat/auras';
import { onCastCompleted } from '../../src/sim/combat/talent_procs';
import { rowForLevel, talentsFor } from '../../src/sim/content/talents';
import { Sim } from '../../src/sim/sim';

function maxLevelWarrior(): Sim {
  const sim = new Sim({ seed: 71, playerClass: 'warrior', autoEquip: false });
  sim.setPlayerLevel(20);
  return sim;
}

describe('canonical Talent V2 live mutations', () => {
  it('commits a spec immediately and increments wireRev exactly once', () => {
    const sim = maxLevelWarrior();
    const meta = sim.meta(sim.player.id)!;
    const fury = talentsFor('warrior')!.specs.find((spec) => spec.id === 'fury')!;
    const beforeRev = meta.wireRev;

    expect(sim.setSpec('fury')).toBe(true);
    expect(sim.talents).toEqual({ spec: 'fury', rows: {} });
    expect(sim.known.some((known) => known.def.id === fury.signature)).toBe(true);
    expect(meta.wireRev).toBe(beforeRev + 1);

    expect(sim.setSpec('fury')).toBe(true);
    expect(meta.wireRev).toBe(beforeRev + 1);
  });

  it('selects one option per unlocked row through the same choke point', () => {
    const sim = maxLevelWarrior();
    const meta = sim.meta(sim.player.id)!;
    const option = rowForLevel('warrior', 5)!.options[0];
    const beforeRev = meta.wireRev;

    expect(sim.selectTalentRow(5, option.id)).toBe(true);
    expect(sim.talents.rows[5]).toBe(option.id);
    expect(meta.wireRev).toBe(beforeRev + 1);

    expect(sim.selectTalentRow(5, option.id)).toBe(true);
    expect(meta.wireRev).toBe(beforeRev + 1);
    expect(sim.selectTalentRow(5, 'not_a_real_option')).toBe(false);
    expect(sim.talents.rows[5]).toBe(option.id);
    expect(meta.wireRev).toBe(beforeRev + 1);
  });

  it('preserves class-wide rows across spec switches and clears only rows on respec', () => {
    const sim = maxLevelWarrior();
    const meta = sim.meta(sim.player.id)!;
    const option = rowForLevel('warrior', 8)!.options[0];

    expect(sim.selectTalentRow(8, option.id)).toBe(true);
    expect(sim.setSpec('arms')).toBe(true);
    expect(sim.setSpec('fury')).toBe(true);
    expect(sim.talents).toEqual({ spec: 'fury', rows: { 8: option.id } });

    const beforeRev = meta.wireRev;
    expect(sim.respec()).toBe(true);
    expect(sim.talents).toEqual({ spec: 'fury', rows: {} });
    expect(meta.wireRev).toBe(beforeRev + 1);
    expect(sim.respec()).toBe(true);
    expect(meta.wireRev).toBe(beforeRev + 1);
  });

  it('keeps character restore silent and starts with a clean live revision', () => {
    const source = maxLevelWarrior();
    const option = rowForLevel('warrior', 5)!.options[0];
    expect(source.setSpec('arms')).toBe(true);
    expect(source.selectTalentRow(5, option.id)).toBe(true);
    const state = source.serializeCharacter(source.player.id)!;

    const restored = new Sim({ seed: 72, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Restored', { state });
    const meta = restored.meta(pid)!;
    const events = restored.tick();

    expect(meta.talents).toEqual({ spec: 'arms', rows: { 5: option.id } });
    expect(events.some((event) => event.type === 'learnAbility' && event.pid === pid)).toBe(false);
  });

  it('blocks loadout deletion in combat and rejects unsafe indexes', () => {
    const sim = maxLevelWarrior();
    expect(sim.saveLoadout('one', [])).toBe(0);
    expect(sim.saveLoadout('two', [])).toBe(1);
    sim.player.inCombat = true;

    expect(sim.deleteLoadout(1)).toBe(false);
    expect(sim.loadouts.map((loadout) => loadout.name)).toEqual(['one', 'two']);

    sim.player.inCombat = false;
    expect(sim.deleteLoadout(2 ** 32)).toBe(false);
    expect(sim.switchLoadout(1.5)).toBe(false);
    expect(sim.loadouts.map((loadout) => loadout.name)).toEqual(['one', 'two']);
  });

  it('marks successful metadata-only loadout mutations dirty for the online snapshot', () => {
    const sim = maxLevelWarrior();
    const meta = sim.meta(sim.player.id)!;
    const startRev = meta.wireRev;

    expect(sim.saveLoadout('one', ['attack'])).toBe(0);
    expect(meta.wireRev).toBe(startRev + 1);

    expect(sim.saveLoadout('two', ['battle_shout'])).toBe(1);
    expect(meta.wireRev).toBe(startRev + 2);

    // Both loadouts carry the same allocation, so this only changes activeLoadout.
    expect(sim.switchLoadout(0)).toBe(true);
    expect(meta.wireRev).toBe(startRev + 3);

    expect(sim.deleteLoadout(1)).toBe(true);
    expect(meta.wireRev).toBe(startRev + 4);
  });

  it('normalizes spent talent charges when a row is cleared without touching native charges', () => {
    const rogue = new Sim({ seed: 73, playerClass: 'rogue', autoEquip: false });
    rogue.setPlayerLevel(20);
    expect(rogue.selectTalentRow(11, 'rog_r11_endurance')).toBe(true);
    rogue.castAbility('sprint');
    rogue.castAbility('sprint');
    expect(rogue.player.abilityCharges?.sprint?.charges).toBe(0); // both stored uses spent
    expect(rogue.player.abilityCharges?.sprint?.maxCharges).toBe(2);

    // Clearing the row collapses the cap to 1: the pool bookkeeping drops and
    // the still-owed recharge keeps running as a plain cooldown (no free reset).
    expect(rogue.selectTalentRow(11, null)).toBe(true);
    expect(rogue.resolvedAbility('sprint')?.charges).toBeUndefined();
    expect(rogue.player.abilityCharges?.sprint).toBeUndefined();
    expect(rogue.player.cooldowns.has('sprint')).toBe(true);
    for (let tick = 0; tick < 6_001; tick++) updateTimers(rogue.player);
    expect(rogue.player.cooldowns.has('sprint')).toBe(false);

    // Picking the row while the ability sits on a plain cooldown converts that
    // cooldown into a recharge with ONE use spent: the new extra use is stored
    // and castable, the running timer is neither wiped nor reset.
    const adding = new Sim({ seed: 75, playerClass: 'rogue', autoEquip: false });
    adding.setPlayerLevel(20);
    adding.castAbility('sprint');
    expect(adding.player.cooldowns.has('sprint')).toBe(true);
    expect(adding.player.abilityCharges).toBeUndefined();
    expect(adding.selectTalentRow(11, 'rog_r11_endurance')).toBe(true);
    expect(adding.player.abilityCharges?.sprint?.charges).toBe(1);
    expect(adding.player.abilityCharges?.sprint?.maxCharges).toBe(2);
    expect(adding.player.cooldowns.has('sprint')).toBe(false); // a use is stored, pool open
    adding.castAbility('sprint');
    adding.castAbility('sprint'); // blocked: the pool is empty
    expect(adding.player.abilityCharges?.sprint?.charges).toBe(0);

    // An unrelated row pick leaves a native charge-limited pool (Twinstrike) alone.
    const warrior = maxLevelWarrior();
    expect(warrior.setSpec('fury')).toBe(true);
    warrior.player.abilityCharges = {
      raging_gale: { charges: 0, maxCharges: 2, recharge: 8, rechargeLength: 8 },
    };
    warrior.player.cooldowns.set('raging_gale', 8);
    expect(warrior.selectTalentRow(5, 'war_row_pursuit')).toBe(true);
    expect(warrior.resolvedAbility('raging_gale')?.charges).toBe(2);
    expect(warrior.player.abilityCharges?.raging_gale).toEqual({
      charges: 0,
      maxCharges: 2,
      recharge: 8,
      rechargeLength: 8,
    });
    expect(warrior.player.cooldowns.get('raging_gale')).toBe(8);
  });

  it('cleans removed proc payoffs and partial counters at the recompute choke point', () => {
    const rogue = new Sim({ seed: 74, playerClass: 'rogue', autoEquip: false });
    rogue.setPlayerLevel(20);
    expect(rogue.selectTalentRow(8, 'rog_r8_improved_gouge')).toBe(true);
    onCastCompleted(rogue.ctx, rogue.player, 'gouge', rogue.player);
    expect(rogue.player.auras.some((aura) => aura.id === 'rog_blindside_opening')).toBe(true);
    rogue.player.procState!.icds.rog_blindside_opening = 5;

    expect(rogue.selectTalentRow(8, 'rog_r8_smoke_screen')).toBe(true);
    expect(rogue.player.auras.some((aura) => aura.id === 'rog_blindside_opening')).toBe(false);
    expect(rogue.player.procState?.counters.rog_blindside_opening).toBeUndefined();
    expect(rogue.player.procState?.icds.rog_blindside_opening).toBeUndefined();

    expect(rogue.selectTalentRow(5, 'rog_r5_relentless_strikes')).toBe(true);
    onCastCompleted(rogue.ctx, rogue.player, 'sinister_strike');
    onCastCompleted(rogue.ctx, rogue.player, 'sinister_strike');
    expect(rogue.player.procState?.counters.rog_ceaseless_cuts).toBe(2);
    expect(rogue.selectTalentRow(5, 'rog_r5_opportunist')).toBe(true);
    expect(rogue.player.procState?.counters.rog_ceaseless_cuts).toBeUndefined();
  });
});
