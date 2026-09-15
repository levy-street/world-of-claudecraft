import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRuinousBrand, gainDesolation, gainRuin } from '../src/sim/combat/destruction';
import * as talentProcs from '../src/sim/combat/talent_procs';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { directHitBonus } from '../src/sim/spell_scaling';
import type { SimEvent } from '../src/sim/types';
import { abilityEffectText, formatAbilityNumber } from '../src/ui/ability_description';
import { MeterData } from '../src/ui/meters';

function setup(level = 20) {
  const sim = new Sim({ seed: 72, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(level);
  sim.setSpec('destruction');
  sim.tick();
  const p = sim.player;
  const primary = createMob(9801, MOBS.training_dummy, level, { ...p.pos, z: p.pos.z + 8 });
  const secondary = createMob(9802, MOBS.training_dummy, level, {
    ...p.pos,
    x: p.pos.x + 3,
    z: p.pos.z + 8,
  });
  for (const mob of [primary, secondary]) {
    mob.hostile = true;
    mob.hp = mob.maxHp = 1_000_000;
    mob.aiState = 'attack';
    mob.aggroTargetId = p.id;
    sim.ctx.addEntity(mob);
  }
  p.inCombat = true;
  p.hitBonus = 1;
  p.facing = 0;
  p.resource = p.maxResource;
  // Hit succeeds, every ordinary critical roll fails.
  vi.spyOn(sim.rng, 'chance').mockImplementation((chance) => chance >= 0.9);
  sim.targetEntity(primary.id);
  return { sim, p, primary, secondary };
}
function land(sim: Sim, id: string) {
  sim.castAbility(id);
  const events: SimEvent[] = [];
  for (let i = 0; i < 80; i++) events.push(...sim.tick());
  return events.filter((event) => event.type === 'damage');
}
afterEach(() => vi.restoreAllMocks());

describe('Destruction feedback tuning', () => {
  it('shows Gloom base and power damage after the same reduction at two gear levels', () => {
    const { sim } = setup();
    const res = sim.resolvedAbility('shadow_bolt')!;
    const effect = res.effects[0];
    if (effect.type !== 'directDamage') throw new Error('Missing Gloom hit');
    for (const spellPower of [0, 350]) {
      const bonus = directHitBonus(
        spellPower,
        res.def,
        res.castTime,
        false,
        res.outputScaling?.damage ?? 1,
        effect.spellPowerCoeff,
      );
      const base = `${formatAbilityNumber(effect.min * 0.8)} to ${formatAbilityNumber(effect.max * 0.8)}`;
      expect(
        abilityEffectText(res, { spellPower, healPower: 0, rangedPower: 0, attackPower: 0 }),
      ).toBe(base + (bonus ? ` (+${formatAbilityNumber(bonus * 0.8)})` : ''));
    }
  });
  it.each([
    [8, 2.2],
    [14, 2.7],
    [20, 3],
  ])(
    'Gloom rank at %i casts in 2 seconds and retains 80 percent total damage',
    (level, oldTime) => {
      const { sim } = setup(level);
      const res = sim.resolvedAbility('shadow_bolt')!;
      expect(res.castTime).toBeCloseTo(2 * 0.97);
      const eff = res.effects.find((effect) => effect.type === 'directDamage')!;
      if (eff.type !== 'directDamage') throw new Error('Missing direct hit');
      for (const power of [0, 70, 350]) {
        const oldBonus = directHitBonus(power, res.def, oldTime * 0.97);
        const newBonus = directHitBonus(
          power,
          res.def,
          res.castTime,
          false,
          1,
          eff.spellPowerCoeff,
        );
        expect((eff.min + newBonus) * (eff.damageMult ?? 1)).toBeCloseTo(
          (eff.min + oldBonus) * 0.8,
        );
      }
    },
  );
  it('keeps the starter Gloom cast time and resolves Desolation on the new Ruinbolt', () => {
    expect(ABILITIES.shadow_bolt.castTime).toBe(1.7);
    const { sim, p } = setup();
    expect(sim.resolvedAbility('chaos_bolt')?.castTime).toBe(2.3);
    gainDesolation(sim.ctx, p);
    gainRuin(sim.ctx, p, 3);
    sim.castAbility('chaos_bolt');
    expect(p.castTotal).toBeCloseTo(1.61);
    const hit = ABILITIES.chaos_bolt.effects[0];
    expect(hit).toMatchObject({ min: 192, max: 235, spellPowerCoeff: 2.5 / 3.5 });
  });
  it.each([false, true])(
    'landed Ruinbolt and its exact echo are critical (cross target %s)',
    (cross) => {
      const { sim, p, primary, secondary } = setup();
      applyRuinousBrand(sim.ctx, p, cross ? secondary : primary);
      gainRuin(sim.ctx, p, 3);
      const proc = vi.spyOn(talentProcs, 'onSpellCrit');
      const events = land(sim, 'chaos_bolt');
      const direct = events.find((event) => event.ability === 'Ruinbolt' && event.amount > 0)!;
      if (!direct) throw new Error(JSON.stringify(events));
      const echo = events.find((event) => event.ability === 'Ruinous Brand')!;
      expect(direct?.crit).toBe(true);
      expect(echo?.crit).toBe(true);
      expect(echo.amount).toBe(Math.round(direct.amount * (cross ? 0.5 : 0.25)));
      expect(echo.targetId).toBe(cross ? secondary.id : primary.id);
      const meter = new MeterData(0);
      for (const event of events) meter.onEvent(event, sim, new Set([p.id]), 1000);
      const breakdown = [...meter.current!.tallies.get(p.id)!.dmgByAbility.values()];
      expect(breakdown).toContainEqual({
        ability: 'Ruinous Brand',
        petName: null,
        amount: echo.amount,
      });
      expect(proc).toHaveBeenCalledTimes(1);
      expect(proc.mock.calls[0][2]).toBe('chaos_bolt');
    },
  );
  it.each([0, 350])('lands the complete 20 percent Gloom reduction at %i Spell Power', (power) => {
    const { sim } = setup();
    const res = sim.resolvedAbility('shadow_bolt')!;
    const effect = res.effects[0];
    if (effect.type !== 'directDamage') throw new Error('Missing Gloom hit');
    vi.spyOn(sim.rng, 'range').mockImplementation((min) => min);
    vi.spyOn(sim.ctx, 'spellCrit').mockImplementation((player) => {
      player.spellPower = power;
      return 0;
    });
    // Destruction's release multiplier is 1.21: its 10 percent legacy floor
    // plus the v0.42 Ruination bonus. The old rank-4 coefficient used its 3
    // percent faster, 2.91-second cast.
    const oldHit = effect.min + Math.round(power * (2.91 / 3.5) * 1.21);
    const events = land(sim, 'shadow_bolt');
    const hit = events.find((event) => event.ability === 'Gloom Bolt' && event.amount > 0)!;
    expect(hit.crit).toBe(false);
    expect(hit.amount).toBe(Math.round(oldHit * 0.8));
  });
  it('preserves critical damage bonuses and copies the larger critical exactly once', () => {
    const { sim, p } = setup();
    gainRuin(sim.ctx, p, 3);
    applyRuinousBrand(sim.ctx, p, sim.ctx.entities.get(9802)!);
    vi.spyOn(sim.rng, 'range').mockImplementation((min) => min);
    vi.spyOn(sim.ctx, 'spellCrit').mockImplementation((player) => {
      player.spellPower = 350;
      player.critDmgSpellBonus = 0.5;
      return 0;
    });
    const events = land(sim, 'chaos_bolt');
    const hit = events.find((event) => event.ability === 'Ruinbolt' && event.amount > 0)!;
    const echo = events.find((event) => event.ability === 'Ruinous Brand')!;
    expect(hit.amount).toBe(Math.round((232 + Math.round(350 * (2.5 / 3.5) * 1.21)) * 2));
    expect(echo.amount).toBe(Math.round(hit.amount * 0.5));
    expect(echo.crit).toBe(true);
  });
  it('a guaranteed critical does not bypass the spell hit roll or echo a resisted bolt', () => {
    const { sim, p, primary } = setup();
    applyRuinousBrand(sim.ctx, p, primary);
    gainRuin(sim.ctx, p, 3);
    vi.mocked(sim.rng.chance).mockReturnValue(false);
    const events = land(sim, 'chaos_bolt');
    expect(events.some((event) => event.kind === 'resist' && event.ability === 'Ruinbolt')).toBe(
      true,
    );
    expect(events.some((event) => event.amount > 0)).toBe(false);
  });
  it('copies the landed critical without applying Veil Mark a second time', () => {
    const { sim, p, primary } = setup();
    p.auras.push({
      id: 'veilbound_mark',
      name: 'Veil Mark',
      kind: 'dot',
      value: 0,
      remaining: 30,
      duration: 30,
      sourceId: primary.id,
      school: 'holy',
    });
    applyRuinousBrand(sim.ctx, p, primary);
    gainRuin(sim.ctx, p, 3);
    const events = land(sim, 'chaos_bolt');
    const hit = events.find((event) => event.ability === 'Ruinbolt' && event.amount > 0)!;
    const echo = events.find((event) => event.ability === 'Ruinous Brand')!;
    expect(hit.amount).toBeGreaterThan(0);
    expect(echo.amount).toBe(Math.round(hit.amount * 0.25));
    expect(echo.crit).toBe(true);
  });
  it('lets a normal Fire critical bank Ignite while an exact critical copy cannot', () => {
    const sim = new Sim({ seed: 93, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('fire');
    sim.tick();
    const p = sim.player;
    const target = createMob(9810, MOBS.training_dummy, 20, { ...p.pos, z: p.pos.z + 8 });
    target.hostile = true;
    target.hp = target.maxHp = 1_000_000;
    sim.ctx.addEntity(target);

    sim.ctx.dealDamage(
      p,
      target,
      300,
      true,
      'fire',
      'Test Fire Critical',
      'hit',
      false,
      undefined,
      true,
      false,
      false,
      'fireball',
    );
    expect(target.auras.some((aura) => aura.id === 'ignite')).toBe(true);

    target.auras = target.auras.filter((aura) => aura.id !== 'ignite');
    sim.ctx.dealDamage(
      p,
      target,
      300,
      true,
      'fire',
      'Resolved Critical Copy',
      'hit',
      false,
      undefined,
      true,
      false,
      false,
      null,
      false,
      undefined,
      true,
    );
    expect(target.auras.some((aura) => aura.id === 'ignite')).toBe(false);
  });
  it.each([false, true])(
    'Gloom echoes retain noncritical metadata even when Gloom crits: %s',
    (critical) => {
      const { sim, p, primary } = setup();
      vi.spyOn(sim.ctx, 'spellCrit').mockReturnValue(critical ? 1 : 0);
      applyRuinousBrand(sim.ctx, p, primary);
      const events = land(sim, 'shadow_bolt');
      const hit = events.find((event) => event.ability === 'Gloom Bolt' && event.amount > 0)!;
      const echo = events.find((event) => event.ability === 'Ruinous Brand')!;
      expect(hit.crit).toBe(critical);
      expect(echo.crit).toBe(false);
      expect(echo.amount).toBe(Math.round(hit.amount * 0.25));
    },
  );
});
