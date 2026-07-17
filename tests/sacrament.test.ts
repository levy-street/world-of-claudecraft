import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';

function sacramentSim(spec: 'holy' | 'protection' | 'retribution' = 'holy', seed = 178_401): Sim {
  const sim = new Sim({ seed, playerClass: 'paladin', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  sim.player.spellPower = 0;
  sim.player.hp = Math.max(1, sim.player.maxHp - 500);
  sim.targetEntity(sim.player.id);
  return sim;
}

function kindledFaith(sim: Sim) {
  return sim.player.auras.find((aura) => aura.id === 'pal_kindled_faith');
}

function weaveThreeHeals(sim: Sim): void {
  onCastCompleted(sim.ctx, sim.player, 'holy_light', sim.player);
  onCastCompleted(sim.ctx, sim.player, 'flash_of_light', sim.player);
  onCastCompleted(sim.ctx, sim.player, 'holy_light', sim.player);
}

describe('Sacrament Kindled Faith', () => {
  it('authors a valid mana-healing weave around the Holy Shock signature', () => {
    const holy = TALENTS.paladin.specs.find((spec) => spec.id === 'holy');

    expect(validateTalentTree(TALENTS.paladin)).toEqual([]);
    expect(holy?.signature).toBe('holy_shock');
    expect(holy?.mastery.name).toBe('Kindled Faith');
    expect(holy?.mastery.description).toContain('Every 3rd Mending Light or Lightmend');
    expect(holy?.mastery.description).toContain('Holy Shock');
    expect(holy?.mastery.effect).toEqual({
      global: { critDmgHealPct: 0.5 },
      proc: {
        id: 'pal_kindled_faith',
        name: 'Kindled Faith',
        spec: 'holy',
        requiresKnownAbility: 'holy_shock',
        school: 'holy',
        trigger: { on: 'castNth', n: 3, abilities: ['holy_light', 'flash_of_light'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['holy_shock'],
            duration: 10,
          },
        ],
      },
    });
    expect(sacramentSim().player.resourceType).toBe('mana');
  });

  it('opens one visible free Holy Shock window exactly on the third healing cast', () => {
    const run = () => {
      const sim = sacramentSim();
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'holy_light', sim.player);
      onCastCompleted(sim.ctx, sim.player, 'flash_of_light', sim.player);
      const beforeThird = kindledFaith(sim);
      onCastCompleted(sim.ctx, sim.player, 'holy_light', sim.player);
      sim.ctx.rng.setObserver(null);
      const window = kindledFaith(sim);
      return {
        draws,
        beforeThird: beforeThird ?? null,
        window: window
          ? [window.kind, window.remaining, window.duration, window.empowerAbilities]
          : null,
      };
    };

    expect(run()).toEqual({
      draws: [],
      beforeThird: null,
      window: ['next_cast_free', 10, 10, ['holy_shock']],
    });
    expect(run()).toEqual(run());
  });

  it('spends the free Holy Shock once while retaining its normal mana cost otherwise', () => {
    const sim = sacramentSim();
    weaveThreeHeals(sim);
    const holyShock = sim.resolvedAbility('holy_shock');
    if (!holyShock) throw new Error('missing Holy Shock');

    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    sim.castAbility('holy_shock');

    expect(sim.player.resource).toBe(0);
    expect(sim.player.cooldowns.get('holy_shock')).toBe(8);
    expect(kindledFaith(sim)).toBeUndefined();
    expect(holyShock.cost).toBe(55);
  });

  it('requires Sacrament, a known Holy Shock, and the listed healing casts', () => {
    const withoutSignature = sacramentSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Paladin metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'holy_shock');

    for (const sim of [sacramentSim('protection'), sacramentSim('retribution'), withoutSignature]) {
      weaveThreeHeals(sim);
      expect(kindledFaith(sim)).toBeUndefined();
    }

    const wrongCast = sacramentSim();
    for (let index = 0; index < 3; index++) {
      onCastCompleted(wrongCast.ctx, wrongCast.player, 'judgement', wrongCast.player);
    }
    expect(kindledFaith(wrongCast)).toBeUndefined();
  });

  it('clears the Sacrament-only window when leaving the spec', () => {
    const sim = sacramentSim();
    weaveThreeHeals(sim);
    expect(kindledFaith(sim)).toBeDefined();

    expect(sim.applyTalents({ spec: 'protection', rows: {} })).toBe(true);

    expect(kindledFaith(sim)).toBeUndefined();
  });
});
