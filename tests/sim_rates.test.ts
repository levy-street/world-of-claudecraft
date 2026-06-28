import { describe, expect, it } from 'vitest';
import { MOBS, QUESTS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { applyRate, normalizeSimRates } from '../src/sim/rates';
import { Sim } from '../src/sim/sim';
import { simRatesFromEnv } from '../server/sim_rate_config';

describe('sim rates', () => {
  it('normalizes missing and invalid rate values to classic defaults', () => {
    expect(normalizeSimRates()).toEqual({ xp: 1, dropMoney: 1 });
    expect(normalizeSimRates({ xp: Number.NaN, dropMoney: -2 })).toEqual({
      xp: 1,
      dropMoney: 1,
    });
    expect(normalizeSimRates({ xp: 0.5, dropMoney: 0 })).toEqual({
      xp: 1,
      dropMoney: 1,
    });
  });

  it('rounds scaled awards and never returns negative amounts', () => {
    expect(applyRate(101, 1.5)).toBe(152);
    expect(applyRate(100, 0)).toBe(0);
    expect(applyRate(100, -5)).toBe(0);
  });

  it('parses server env rate variables', () => {
    expect(simRatesFromEnv({ RATE_XP: '2.5', RATE_DROP_MONEY: '3' })).toEqual({
      xp: 2.5,
      dropMoney: 3,
    });
    expect(simRatesFromEnv({ RATE_XP: 'nope', RATE_DROP_MONEY: '' })).toEqual({
      xp: 1,
      dropMoney: 1,
    });
    expect(simRatesFromEnv({ RATE_XP: '0.5', RATE_DROP_MONEY: '0' })).toEqual({
      xp: 1,
      dropMoney: 1,
    });
  });

  it('scales the base and rested portions of kill XP without faster pool drain', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', rates: { xp: 2 } });
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 50;

    sim.grantXp(50, meta, { fromKill: true });

    expect(sim.xp).toBe(200);
    expect(meta.lifetimeXp).toBe(200);
    expect(meta.restedXp).toBe(0);
    expect(sim.events.find((e) => e.type === 'xp')).toMatchObject({
      amount: 200,
      rested: 100,
    });
  });

  it('scales quest-style XP at award time without mutating the displayed base reward', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', rates: { xp: 2 } });
    const meta = sim.meta(sim.playerId)!;
    const quest = QUESTS.q_wolves;

    sim.grantXp(quest.xpReward, meta);

    expect(quest.xpReward).toBe(250);
    expect(sim.player.level).toBe(2);
    expect(meta.xp).toBe(100);
    expect(meta.lifetimeXp).toBe(500);
  });

  it('defaults sub-1 XP rates instead of suppressing the award', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', rates: { xp: 0 } });
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 50;

    sim.grantXp(50, meta, { fromKill: true });

    expect(meta.xp).toBe(100);
    expect(meta.lifetimeXp).toBe(100);
    expect(meta.restedXp).toBe(0);
  });

  it('scales copper drops without changing the deterministic roll', () => {
    function rolledCopper(rate: number): number {
      const sim = new Sim({
        seed: 77,
        playerClass: 'warrior',
        noPlayer: true,
        rates: { dropMoney: rate },
      });
      const pid = sim.addPlayer('warrior', 'Looter');
      const template = MOBS.forest_wolf;
      const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });

      rollLoot(sim.ctx, mob, sim.meta(pid)!);

      return mob.loot?.copper ?? 0;
    }

    const base = rolledCopper(1);
    expect(base).toBeGreaterThan(0);
    expect(rolledCopper(3)).toBe(base * 3);
    expect(rolledCopper(0)).toBe(base);
  });

  it('keeps rate-scaled rolls deterministic for the same seed', () => {
    const run = () => {
      const sim = new Sim({
        seed: 987,
        playerClass: 'warrior',
        noPlayer: true,
        rates: { xp: 1.75, dropMoney: 2.25 },
      });
      const pid = sim.addPlayer('warrior', 'Looter');
      const meta = sim.meta(pid)!;
      const mob = createMob(-1, MOBS.forest_wolf, MOBS.forest_wolf.minLevel, { x: 0, y: 0, z: 0 });
      rollLoot(sim.ctx, mob, meta);
      sim.grantXp(123, meta);
      return { copper: mob.loot?.copper ?? 0, xp: meta.xp, lifetimeXp: meta.lifetimeXp };
    };

    expect(run()).toEqual(run());
  });
});
