import { describe, expect, it } from 'vitest';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { Sim } from '../src/sim/sim';
import { hotTickBonus } from '../src/sim/spell_scaling';
import type { Entity, PlayerClass } from '../src/sim/types';

// Healing scales with Spell Power the same way damage does: a direct heal takes the
// cast-time coefficient, a HoT takes the DoT (duration/15) coefficient split across
// its ticks. A HoT that RIDES a direct heal (Regrowth) suppresses the tick rider so
// the pair does not double-dip. This drives the real sim (not just the coeff math in
// spell_scaling.test.ts) to pin the effect_dispatch wiring for the heal/hot cases.

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(cls: PlayerClass, level: number, spellPower: number) {
  const sim = new Sim({ seed: 99, playerClass: cls, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(level);
  const p = sim.player as AnyEntity;
  const meta = sim.players.get(p.id);
  p.resource = p.maxResource;
  // A large HP pool with a deep deficit so nothing overheals and caps the delta.
  p.maxHp = 100000;
  p.hp = 1;
  p.spellPower = spellPower;
  return { sim, p, meta };
}

function castAndDrain(sim: AnySim, p: AnyEntity, meta: any, id: string): void {
  castAbility(sim.ctx, id, p.id);
  let n = 0;
  while (p.castingAbility && n++ < 1000) updateCasting(sim.ctx, p, meta);
}

function hotAura(p: AnyEntity, id: string): { value: number } {
  const a = p.auras.find((au: any) => au.id === id && au.kind === 'hot');
  if (!a) throw new Error(`no hot aura ${id}`);
  return a;
}

describe('heal Spell Power scaling (effect_dispatch heal/hot wiring)', () => {
  it('a direct heal (Lesser Heal) heals for more with Spell Power', () => {
    // Two identical seeded sims that differ ONLY by Spell Power (which draws no rng),
    // so the heal roll and crit outcome match; the whole delta is the SP rider.
    const zero = makeSim('priest', 12, 0);
    castAndDrain(zero.sim, zero.p, zero.meta, 'lesser_heal');
    const healedZero = zero.p.hp - 1;

    const buffed = makeSim('priest', 12, 300);
    castAndDrain(buffed.sim, buffed.p, buffed.meta, 'lesser_heal');
    const healedBuffed = buffed.p.hp - 1;

    expect(healedZero).toBeGreaterThan(0);
    expect(healedBuffed).toBeGreaterThan(healedZero);
  });

  it('a pure HoT (Renew) adds the DoT-coefficient rider to each tick', () => {
    const zero = makeSim('priest', 12, 0);
    castAndDrain(zero.sim, zero.p, zero.meta, 'renew');
    const baseTick = hotAura(zero.p, 'renew').value;

    const buffed = makeSim('priest', 12, 300);
    castAndDrain(buffed.sim, buffed.p, buffed.meta, 'renew');
    const buffedTick = hotAura(buffed.p, 'renew').value;

    // Renew is duration 15 / interval 3 at every rank.
    expect(buffedTick - baseTick).toBe(hotTickBonus(300, 15, 3));
    expect(hotTickBonus(300, 15, 3)).toBeGreaterThan(0);
  });

  it('a hybrid heal+HoT (Regrowth) does NOT double-dip: its HoT tick takes no rider', () => {
    const zero = makeSim('druid', 14, 0);
    castAndDrain(zero.sim, zero.p, zero.meta, 'regrowth');
    const baseTick = hotAura(zero.p, 'regrowth').value;

    const buffed = makeSim('druid', 14, 300);
    castAndDrain(buffed.sim, buffed.p, buffed.meta, 'regrowth');
    const buffedTick = hotAura(buffed.p, 'regrowth').value;

    // The direct component already took the cast-time coefficient, so the HoT tick is
    // identical with or without Spell Power (the anti-double-dip guard).
    expect(buffedTick).toBe(baseTick);
  });
});
