import { describe, expect, it } from 'vitest';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { ABILITIES } from '../src/sim/data';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type TestSim = Sim & {
  players: Map<number, PlayerMeta>;
  swingIntervalMult(entity: Entity): number;
};

function swordmaster(level: number): { sim: TestSim; player: Entity; meta: PlayerMeta } {
  const sim = new Sim({ seed: 88, playerClass: 'swordmaster' }) as TestSim;
  sim.setPlayerLevel(level);
  const player = sim.player;
  const meta = sim.players.get(player.id);
  if (!meta) throw new Error('missing SwordMaster metadata');
  player.resource = player.maxResource;
  return { sim, player, meta };
}

describe('Sword Aura', () => {
  it('authors the exact 2 sec cast, 20 Energy cost, 120 sec cooldown, and 300 sec buff', () => {
    expect(ABILITIES.sword_aura).toMatchObject({
      id: 'sword_aura',
      class: 'swordmaster',
      castTime: 2,
      cost: 20,
      cooldown: 120,
      castFx: 'weaponAura',
      effects: [{ type: 'selfBuff', kind: 'buff_str_agi', value: 12, duration: 300 }],
    });
  });

  it('finishes only after 2 sec and grants exactly 12 Strength and 12 Agility for the full aura duration', () => {
    const { sim, player, meta } = swordmaster(5);
    const before = { str: player.stats.str, agi: player.stats.agi, ap: player.attackPower };

    castAbility(sim.ctx, 'sword_aura', player.id);
    expect(player.castingAbility).toBe('sword_aura');
    expect(player.castTotal).toBe(2);
    expect(player.auras.some((aura) => aura.id === 'sword_aura')).toBe(false);

    for (let tick = 0; tick < 39; tick++) updateCasting(sim.ctx, player, meta);
    expect(player.castingAbility).toBe('sword_aura');
    expect(player.auras.some((aura) => aura.id === 'sword_aura')).toBe(false);

    updateCasting(sim.ctx, player, meta);
    const aura = player.auras.find((candidate) => candidate.id === 'sword_aura');
    expect(player.castingAbility).toBeNull();
    expect(aura).toMatchObject({
      kind: 'buff_str_agi',
      value: 12,
      duration: 300,
      remaining: 300,
      school: 'arcane',
    });
    expect(player.resource).toBe(80);
    expect(player.cooldowns.get('sword_aura')).toBe(120);
    expect(player.stats.str).toBe(before.str + 12);
    expect(player.stats.agi).toBe(before.agi + 12);
    expect(player.attackPower).toBe(before.ap + 24);
  });
});

describe('SwordMaster speed and haste', () => {
  it('Quickening shortens the live swing interval by exactly its 25% haste divisor', () => {
    const { sim, player } = swordmaster(11);
    castAbility(sim.ctx, 'quickening', player.id);

    expect(player.auras.find((aura) => aura.id === 'quickening')).toMatchObject({
      kind: 'buff_haste',
      value: 1.25,
      duration: 12,
    });
    expect(sim.swingIntervalMult(player)).toBeCloseTo(1 / 1.25, 8);
  });
});
