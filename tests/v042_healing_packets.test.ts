import { describe, expect, it, vi } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { consumeMendingCurrent } from '../src/sim/combat/shaman_spiritmend';
import { BUILTIN_WORLD } from '../src/sim/data';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { directHealBonus, hotTickBonus } from '../src/sim/spell_scaling';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { AbilityEffect, PlayerClass } from '../src/sim/types';

function setup(cls: PlayerClass, spec: string, ability: string) {
  const sim = new Sim({
    seed: 42042,
    playerClass: cls,
    autoEquip: false,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  const player = sim.player;
  player.maxHp = 10000;
  player.hp = 100;
  player.healPower = 100;
  player.auras = [];
  vi.spyOn(sim.ctx, 'spellCrit').mockReturnValue(0);
  const meta = sim.ctx.players.get(player.id);
  const known = sim.resolvedAbility(ability);
  if (!meta || !known) throw new Error('missing healing fixture');
  const mods = sim.ctx.playerMods(meta);
  const healMult = resolveTalentHitMult(known.def, mods).healMult;
  sim.drainEvents();
  function apply(effect: AbilityEffect, castHealMult = 1) {
    if (!meta || !known) throw new Error('missing healing fixture');
    const resolved: ResolvedAbility = { ...known, effects: [effect] };
    runEffects(sim.ctx, player, meta, player, resolved, false, castHealMult);
    return sim.drainEvents().filter((event) => event.type === 'heal2');
  }
  return { sim, player, known, mods, healMult, apply };
}

describe('v0.42 primary healing packet integration', () => {
  it.each([
    ['shaman', 'restoration', 'healing_wave', 1.1],
    ['paladin', 'holy', 'holy_light', 1.1],
    ['druid', 'restoration', 'healing_touch', 1.05],
    ['shaman', 'elemental', 'healing_wave', 1],
    ['shaman', 'enhancement', 'healing_wave', 1],
    ['paladin', 'protection', 'holy_light', 1],
    ['paladin', 'retribution', 'holy_light', 1],
    ['druid', 'feral', 'healing_touch', 1],
    ['druid', 'balance', 'healing_touch', 1],
  ] as const)(
    'scales %s/%s %s full base-plus-power primary healing by %s',
    (cls, spec, ability, factor) => {
      const { player, known, healMult, apply } = setup(cls, spec, ability);
      const raw = 100 + directHealBonus(player.healPower, known.castTime, false, healMult);
      const events = apply({ type: 'heal', min: 100, max: 100, canCrit: false });
      expect(events[0]?.amount).toBe(Math.round(raw * factor));
    },
  );

  it('amplifies Current input once after the whole cast-scoped primary amount', () => {
    const { player, known, healMult, apply } = setup('shaman', 'restoration', 'healing_wave');
    const raw = 100 + directHealBonus(player.healPower, known.castTime, false, healMult);
    const expected = Math.round(Math.round(raw * 1.25) * 1.1);
    const events = apply({ type: 'heal', min: 100, max: 100, canCrit: false }, 1.25);
    expect(events[0]?.amount).toBe(expected);
    const pool = player.auras.find((aura) => aura.id === 'shaman_mending_current');
    expect(pool).toBeDefined();
    expect(pool?.value).toBe(Math.round(expected * 0.5));
  });

  it('scales a new HoT snapshot, including its power contribution', () => {
    const { player, mods, healMult, apply } = setup('druid', 'restoration', 'rejuvenation');
    const raw =
      150 + hotTickBonus(player.healPower, 12, 3, healMult * (1 + mods.global.hotHealPct));
    apply({ type: 'hot', total: 600, duration: 12, interval: 3 });
    const hot = player.auras.find((aura) => aura.id === 'rejuvenation');
    expect(hot?.value).toBe(Math.round(raw * 1.05));
  });

  it('scales the primary chain-heal base before falloff or pool harvest', () => {
    const { player, known, healMult, apply } = setup('shaman', 'restoration', 'chain_heal');
    const raw = 100 + directHealBonus(player.healPower, known.castTime, false, healMult);
    const events = apply({
      type: 'chainHeal',
      min: 100,
      max: 100,
      jumps: 0,
      radius: 10,
      falloff: 0.7,
    });
    expect(events[0]?.amount).toBe(Math.round(raw * 1.1));
  });

  it('leaves fixed maximum-health utility outside Sunmender primary amplification', () => {
    const { player, apply } = setup('paladin', 'holy', 'holy_light');
    const events = apply({ type: 'heal', min: 100, max: 100, casterMaxHpPct: 0.2, canCrit: false });
    expect(events[0]?.amount).toBe(Math.round(player.maxHp * 0.2));
  });
  it('scales each primary area heal including the area power coefficient', () => {
    const { player, known, healMult, apply } = setup('paladin', 'holy', 'holy_light');
    const raw = 100 + directHealBonus(player.healPower, known.castTime, true, healMult);
    const events = apply({ type: 'aoeHeal', min: 100, max: 100, radius: 10 });
    expect(events[0]?.amount).toBe(Math.round(raw * 1.1));
  });

  it('scales fixed healing from consuming a HoT, without scaling the consumed aura twice', () => {
    const { player, known, healMult, apply } = setup('druid', 'restoration', 'healing_touch');
    player.auras.push({
      id: 'test_consumed_hot',
      name: 'Test HoT',
      kind: 'hot',
      value: 300,
      remaining: 12,
      duration: 12,
      sourceId: player.id,
      school: 'nature',
    });
    const raw = 100 + directHealBonus(player.healPower, known.castTime, false, healMult);
    const events = apply({
      type: 'consumeAura',
      auraIds: ['test_consumed_hot'],
      heal: { min: 100, max: 100 },
    });
    expect(events[0]?.amount).toBe(Math.round(raw * 1.05));
    expect(player.auras.some((aura) => aura.id === 'test_consumed_hot')).toBe(false);
  });

  it('harvests an existing Current pool at its existing fraction without a second buff', () => {
    const { sim, player } = setup('shaman', 'restoration', 'healing_wave');
    player.auras.push({
      id: 'shaman_mending_current',
      name: 'Mending Current',
      kind: 'hot',
      value: 200,
      remaining: 12,
      duration: 12,
      sourceId: player.id,
      school: 'nature',
    });
    expect(consumeMendingCurrent(sim.ctx, player, player)).toBe(250);
    expect(sim.drainEvents().filter((event) => event.type === 'heal2')[0]?.amount).toBe(250);
  });
});
