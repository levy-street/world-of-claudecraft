// v0.27.1 fury rage economy fix. Before it, Twinstrike (free, +8, 2 charges),
// Bloodletting (free, +12), and Bladed Gyre (free, +5 to +10) were ALL
// rage-positive, Anger Management added +25%/+15%, and warrior auto-attacks ran
// a hidden 9x mint instead of the classic 7.5x scale: ~13-17 rage/s of income
// against Red Harvest's 80 cost, an 80-rage spender every ~6 seconds. The fix
// makes Bloodletting the one generating builder and restores the shared scale.
import { describe, expect, it } from 'vitest';
import { WARRIOR_ROWS } from '../src/sim/content/warrior_rows';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { MAX_LEVEL, rageConversion, rageGenAuraMult } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

function furyWarrior(): AnySim {
  const sim = new Sim({ seed: 2712, playerClass: 'warrior' }) as AnySim;
  sim.setPlayerLevel(MAX_LEVEL);
  expect(sim.setSpec('fury')).toBe(true);
  return sim;
}

function dummyMob(sim: AnySim): Entity {
  const mob = [...sim.entities.values()].find(
    (e): e is Entity => (e as Entity).kind === 'mob' && !(e as Entity).dead,
  );
  if (!mob) throw new Error('no mob to hit');
  mob.hp = 1_000_000;
  mob.maxHp = 1_000_000;
  return mob;
}

describe('v0.27.1 warrior rage economy', () => {
  it('warrior auto-attack rage is back on the classic 7.5x outgoing scale', () => {
    const sim = furyWarrior();
    const mob = dummyMob(sim);
    sim.player.resource = 0;
    // A white hit: ability null, physical school, the auto-attack mint path.
    sim.dealDamage(sim.player, mob, 40, false, 'physical', null, 'hit');
    // The literal 7.5 is the pin: the talents-v2 era ran a warrior-only 9x here.
    // The stance aura multiplier (Battle Stance is on by default) is read live so
    // this pin stays about the base scale, not stance policy.
    expect(sim.player.resource).toBeCloseTo(
      ((7.5 * 40) / rageConversion(MAX_LEVEL)) * rageGenAuraMult(sim.player),
      5,
    );
  });

  it('Bloodletting is the one generating builder: +12, Twinstrike +4, the spin +0', () => {
    const bloodthirst = ABILITIES.bloodthirst.effects.find(
      (eff: any) => eff.type === 'gainResource',
    );
    expect(bloodthirst).toMatchObject({ amount: 12 });

    const twinstrike = ABILITIES.raging_gale.effects.find(
      (eff: any) => eff.type === 'gainResource',
    );
    expect(twinstrike).toMatchObject({ amount: 4 });

    const whirlwindMints = ABILITIES.whirlwind.effects.some(
      (eff: any) => eff.type === 'gainResource' || eff.rageOnHit !== undefined,
    );
    expect(whirlwindMints).toBe(false);
  });

  it('Anger Management is trimmed to +10% auto / +5% ability rage', () => {
    const row = WARRIOR_ROWS.flatMap((tier) => tier.options).find(
      (option) => option.id === 'war_row_anger_management',
    );
    expect(row).toBeDefined();
    expect(row?.effect).toEqual({ global: { autoRagePct: 0.1, abilityRagePct: 0.05 } });
  });
});
