import { describe, expect, it } from 'vitest';
import {
  resetLongCooldownsForRaidWipe,
  shouldResetRaidWipeCooldown,
} from '../src/sim/combat/raid_wipe_cooldowns';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';

describe('raid wipe cooldown recovery', () => {
  it('resets every cooldown of two minutes or longer', () => {
    expect(ABILITIES.army_of_the_dead.cooldown).toBe(120);
    expect(shouldResetRaidWipeCooldown('army_of_the_dead', 120)).toBe(true);
    expect(shouldResetRaidWipeCooldown('another_two_minute_ability', 120)).toBe(true);
    expect(shouldResetRaidWipeCooldown('long_raid_cooldown', 120.01)).toBe(true);
    expect(shouldResetRaidWipeCooldown('just_below_two_minutes', 119.99)).toBe(false);
    expect(shouldResetRaidWipeCooldown('short_cooldown', 45)).toBe(false);
  });

  it('clears eligible clocks and fully restores any eligible charge pool', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('demonology');
    const meta = sim.players.get(sim.playerId);
    if (!meta) throw new Error('Expected Warlock metadata');
    sim.player.cooldowns.set('army_of_the_dead', 91);
    sim.player.cooldowns.set('metamorphosis', 151);
    sim.player.cooldowns.set('reaping_command', 7);
    sim.player.abilityCharges = {
      metamorphosis: {
        charges: 0,
        maxCharges: 2,
        recharge: 151,
        rechargeLength: 180,
        recharges: [151, 170],
      },
    };

    resetLongCooldownsForRaidWipe(sim.player, meta.known);

    expect(sim.player.cooldowns.has('army_of_the_dead')).toBe(false);
    expect(sim.player.cooldowns.has('metamorphosis')).toBe(false);
    expect(sim.player.cooldowns.get('reaping_command')).toBe(7);
    expect(sim.player.abilityCharges.metamorphosis).toEqual({
      charges: 2,
      maxCharges: 2,
      recharge: 0,
      rechargeLength: 180,
      recharges: [],
    });
  });
});
