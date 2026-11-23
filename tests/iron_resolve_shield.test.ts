// Iron Resolve (warrior Protection): a flat 20 rage buys a shield worth 20
// percent of the caster's maximum health at cast time, 25 percent for a
// Forgewall 2-piece wearer. Proven through live casts on a real Sim, with the
// tooltip figure read off the same resolved ability the dispatch consumes.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { abilityEffectText } from '../src/ui/ability_description';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

const SET_SLOTS = ['helmet', 'shoulder'] as const;

function protSim(forgewall2pc: boolean, level = 25, seed = 4410): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('prot')).toBe(true);
  if (forgewall2pc) {
    for (const slot of SET_SLOTS) {
      sim.addItem(`forgewall_${slot}`, 1);
      sim.equipItem(`forgewall_${slot}`);
    }
  }
  return sim;
}

function tooltipPct(sim: Sim): string {
  const ability = expectDefined(sim.resolvedAbility('iron_resolve'), 'iron_resolve');
  return abilityEffectText(ability, {
    spellPower: 0,
    healPower: 10_000,
    rangedPower: 0,
    attackPower: 10_000,
  });
}

function castShield(sim: Sim, rage: number) {
  sim.player.resource = rage;
  sim.castAbility('iron_resolve');
  return expectDefined(
    sim.player.auras.find((a) => a.id === 'iron_resolve'),
    'iron_resolve shield',
  );
}

describe('Iron Resolve: a maximum-health shield for a flat 20 rage', () => {
  it('absorbs 20 percent of max health and spends exactly 20 rage, however full the bar', () => {
    for (const rage of [20, 60, 100]) {
      const sim = protSim(false);
      const shield = castShield(sim, rage);
      expect(shield.kind).toBe('absorb');
      expect(shield.value).toBe(Math.round(sim.player.maxHp * 0.2));
      expect(shield.duration).toBe(10);
      expect(sim.player.resource, `rage left from ${rage}`).toBe(rage - 20);
    }
  });

  it('scales with the health pool at cast time', () => {
    const small = protSim(false, 15);
    const big = protSim(false);
    expect(big.player.maxHp).toBeGreaterThan(small.player.maxHp);
    const smallShield = castShield(small, 40);
    const bigShield = castShield(big, 40);
    expect(smallShield.value).toBe(Math.round(small.player.maxHp * 0.2));
    expect(bigShield.value).toBe(Math.round(big.player.maxHp * 0.2));
    expect(bigShield.value).toBeGreaterThan(smallShield.value);
  });

  it('refuses below 20 rage', () => {
    const sim = protSim(false);
    sim.player.resource = 19;
    sim.castAbility('iron_resolve');
    expect(sim.player.auras.some((a) => a.id === 'iron_resolve')).toBe(false);
    expect(sim.player.resource).toBe(19);
    expect(sim.player.cooldowns.get('iron_resolve') ?? 0).toBe(0);
  });

  it('Forgewall 2-piece raises the shield to 25 percent of max health', () => {
    const sim = protSim(true);
    const shield = castShield(sim, 40);
    expect(shield.value).toBe(Math.round(sim.player.maxHp * 0.25));
    expect(sim.player.resource).toBe(20);
  });

  it('prints the same percentage the cast grants, with and without the set', () => {
    expect(tooltipPct(protSim(false))).toBe('20');
    expect(tooltipPct(protSim(true))).toBe('25');
  });
});
