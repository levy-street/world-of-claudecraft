import { afterEach, assert, describe, expect, it } from 'vitest';
import { applyPoisonCoats } from '../src/sim/combat/poison_coating';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { formatAbilityImbueDamage } from '../src/ui/ability_imbue_text';
import { setLanguage } from '../src/ui/i18n';

afterEach(() => setLanguage('en'));

describe('weapon-coat tooltip amounts', () => {
  it.each([
    { level: 20, specialized: false, text: '4', ticks: [4, 8, 12, 16, 20] },
    { level: 14, specialized: true, text: '4.28', ticks: [4, 9, 13, 17, 21] },
    { level: 20, specialized: true, text: '4.4', ticks: [4, 9, 13, 18, 22] },
  ])(
    'keeps the contribution used by all five live stacks at level $level (spec: $specialized)',
    ({ level, specialized, text, ticks }) => {
      const sim = new Sim({
        seed: 3,
        playerClass: 'rogue',
        world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
      });
      sim.setPlayerLevel(level);
      if (specialized) expect(sim.setSpec('assassination')).toBe(true);
      sim.castAbility('deadly_poison');
      for (let i = 0; i < 5; i++) sim.tick();
      expect(sim.player.auras.some((a) => a.id === 'deadly_poison')).toBe(true);
      const resolved = sim.resolvedAbility('deadly_poison');
      assert(resolved);
      const imbue = resolved.effects.find((e) => e.type === 'imbue');
      assert(imbue);
      expect(formatAbilityImbueDamage(imbue)).toBe(text);
      const amount = abilityEffectText(resolved);
      expect(amount).toBe(text);
      expect(abilityDisplayDescription(resolved, amount)).toContain(
        `Each stack deals ${text} Nature damage every 2 sec.`,
      );

      const target = createMob(34000, MOBS.forest_wolf, 10, {
        ...sim.player.pos,
        x: sim.player.pos.x + 2,
      });
      target.hp = target.maxHp = 100000;
      sim.ctx.addEntity(target);
      for (const damage of ticks) {
        applyPoisonCoats(sim.ctx, sim.player, target);
        sim.drainEvents();
        const events = Array.from({ length: 40 }, () => sim.tick()).flat();
        expect(events.filter((e) => e.type === 'damage' && e.targetId === target.id)).toEqual([
          expect.objectContaining({
            sourceId: sim.player.id,
            ability: 'Festering Venom',
            amount: damage,
          }),
        ]);
      }
    },
  );

  it('keeps localized decimal punctuation for the per-stack contribution', () => {
    const sim = new Sim({ seed: 3, playerClass: 'rogue' });
    sim.setPlayerLevel(14);
    expect(sim.setSpec('assassination')).toBe(true);
    setLanguage('de_DE');
    const resolved = sim.resolvedAbility('deadly_poison');
    assert(resolved);
    expect(abilityEffectText(resolved)).toBe('4,28');
  });

  it('preserves flat poison amounts with and without Redhanded', () => {
    const sim = new Sim({ seed: 3, playerClass: 'rogue' });
    sim.setPlayerLevel(20);
    const base = sim.resolvedAbility('instant_poison');
    assert(base);
    expect(abilityEffectText(base)).toBe('14');
    expect(sim.setSpec('assassination')).toBe(true);
    const specialized = sim.resolvedAbility('instant_poison');
    assert(specialized);
    expect(abilityEffectText(specialized)).toBe('15');
  });
});
