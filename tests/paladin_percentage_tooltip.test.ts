import { describe, expect, it } from 'vitest';
import { defaultBuild } from '../src/sim/content/talents';
import { grantDevotion } from '../src/sim/paladin_devotion';
import { Sim } from '../src/sim/sim';
import { abilityEffectText } from '../src/ui/hud';

function tooltipValue(sim: Sim, abilityId: string): string {
  const ability = sim.resolvedAbility(abilityId);
  if (!ability) throw new Error(`missing ability ${abilityId}`);
  return abilityEffectText(ability, { spellPower: 10_000, rangedPower: 0, attackPower: 0 });
}

describe('Paladin maximum-health percentage tooltips', () => {
  it('renders Ward of Faith as 25% base and 35% with Enduring Protection', () => {
    const base = new Sim({ seed: 901, playerClass: 'paladin', autoEquip: true });
    base.setPlayerLevel(20);
    expect(tooltipValue(base, 'divine_protection')).toBe('25');

    const enduring = new Sim({ seed: 902, playerClass: 'paladin', autoEquip: true });
    enduring.setPlayerLevel(20);
    const build = defaultBuild('paladin', 20);
    build.rows[8] = 'pal_r8_enduring_protection';
    expect(enduring.applyTalents(build)).toBe(true);
    expect(tooltipValue(enduring, 'divine_protection')).toBe('35');

    enduring.castAbility('divine_protection');
    expect(enduring.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'divine_protection',
        kind: 'absorb',
        value: Math.round(enduring.player.maxHp * 0.35),
        duration: 15,
      }),
    );
  });

  it('renders Last Rite and both Holy Shield states as percentages, never zero', () => {
    const sim = new Sim({ seed: 903, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('protection')).toBe(true);

    expect(tooltipValue(sim, 'lay_on_hands')).toBe('100');
    expect(tooltipValue(sim, 'holy_shield')).toBe('10');

    grantDevotion(sim.player, 20);
    sim.castAbility('divine_ascension');
    expect(tooltipValue(sim, 'holy_shield')).toBe('15');
  });
});
