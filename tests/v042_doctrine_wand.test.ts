import { describe, expect, it, vi } from 'vitest';
import { rangedSwing } from '../src/sim/combat/auto_attack';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';

describe('Doctrine wand damage isolation', () => {
  // Independent literals (156/120/120), including the holy/shadow sibling
  // controls staying at the base 120.
  it.each([
    ['discipline', 156],
    ['holy', 120],
    ['shadow', 120],
  ] as const)('%s applies its factor once to the complete wand hit', (spec, expected) => {
    const sim = new Sim({
      seed: 42042,
      playerClass: 'priest',
      autoEquip: false,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    sim.setPlayerLevel(20);
    expect(sim.setSpec(spec)).toBe(true);
    const p = sim.player;
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...p.pos, z: p.pos.z + 15 });
    mob.hp = mob.maxHp = 100000;
    sim.addEntity(mob);
    p.rangedPower = 140;
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
    const damage = vi.spyOn(sim.ctx, 'dealDamage');
    rangedSwing(sim.ctx, p, mob, { min: 100, max: 100, speed: 2, wand: true, school: 'holy' });
    expect(damage).not.toHaveBeenCalled();
    for (let i = 0; i < 90; i++) advancePendingProjectiles(sim.ctx);
    expect(damage.mock.calls.filter((call) => call[5] === 'Wand')[0]?.[2]).toBe(expected);
  });
});
