import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const AETHERWELL_ID = 'mag_r20_evocation';

function mageSim(
  options: { selected?: boolean; spec?: 'arcane' | 'fire' | 'frost'; seed?: number } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 177_311, playerClass: 'mage', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'arcane',
      rows: options.selected === false ? {} : { 20: AETHERWELL_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_621): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 8,
  });
  target.hostile = true;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  sim.targetEntity(target.id);
  sim.player.facing = 0;
  return target;
}

describe('Aethermancy talent: Aetherwell', () => {
  it('upgrades the stable mana grant into a valid burst relay without touching its row peers', () => {
    const row = ROW_TREES.mage.find((candidate) => candidate.level === 20);
    const option = row?.options.find((candidate) => candidate.id === AETHERWELL_ID);

    expect(validateTalentTree(TALENTS.mage)).toEqual([]);
    expect(validateRowTree(ROW_TREES.mage)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      ['mag_r20_deep_freeze', 'Deadfrost'],
      ['mag_r20_meteor', 'Skystone'],
      [AETHERWELL_ID, 'Aetherwell'],
    ]);
    expect(option?.effect).toEqual({
      grant: { ability: 'evocation' },
      proc: {
        id: 'mag_aetherwell_relay',
        name: 'Aetherwell',
        requiresKnownAbility: 'evocation',
        school: 'arcane',
        trigger: { on: 'castNth', n: 1, abilities: ['evocation'] },
        responses: [
          { kind: 'cooldownRefund', ability: 'arcane_power', seconds: 'reset' },
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['arcane_missiles'],
            duration: 8,
          },
        ],
      },
    });
  });

  it('plays Aether Surge, Aetherwell, Aether Surge, free Aether Darts', () => {
    const sim = mageSim();
    targetFor(sim);
    sim.castAbility('arcane_power');
    expect(sim.player.cooldowns.get('arcane_power')).toBe(90);
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;

    sim.castAbility('evocation');

    expect(sim.player.resource).toBe(220);
    expect(sim.player.cooldowns.has('arcane_power')).toBe(false);
    expect(sim.player.auras.find((aura) => aura.id === 'mag_aetherwell_relay')).toMatchObject({
      name: 'Aetherwell',
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['arcane_missiles'],
    });

    sim.player.gcdRemaining = 0;
    sim.castAbility('arcane_power');
    expect(sim.player.cooldowns.get('arcane_power')).toBe(90);
    sim.player.gcdRemaining = 0;
    const beforeDarts = sim.player.resource;
    sim.castAbility('arcane_missiles');

    expect(sim.player.channeling).toBe(true);
    expect(sim.player.resource).toBe(beforeDarts);
    expect(sim.player.auras.some((aura) => aura.id === 'mag_aetherwell_relay')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === 'mag_aetheric_flux')).toBe(false);
  });

  it('requires the selected grant and its known Aetherwell ability', () => {
    const unselected = mageSim({ selected: false });
    onCastCompleted(unselected.ctx, unselected.player, 'evocation');
    expect(unselected.player.auras.some((aura) => aura.id === 'mag_aetherwell_relay')).toBe(false);

    const withoutKnownGrant = mageSim();
    const meta = withoutKnownGrant.meta(withoutKnownGrant.playerId);
    if (!meta) throw new Error('missing Mage metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'evocation');
    withoutKnownGrant.player.cooldowns.set('arcane_power', 60);

    onCastCompleted(withoutKnownGrant.ctx, withoutKnownGrant.player, 'evocation');

    expect(withoutKnownGrant.player.cooldowns.get('arcane_power')).toBe(60);
    expect(withoutKnownGrant.player.auras.some((aura) => aura.id === 'mag_aetherwell_relay')).toBe(
      false,
    );
  });

  it('retains the mana grant and free Darts relay for Pyromancy and Cryomancy', () => {
    for (const spec of ['fire', 'frost'] as const) {
      const sim = mageSim({ spec });
      expect(sim.resolvedAbility('evocation')).not.toBeNull();
      sim.player.resource = 0;
      sim.player.gcdRemaining = 0;

      sim.castAbility('evocation');

      expect(sim.player.resource).toBe(220);
      expect(sim.player.auras.find((aura) => aura.id === 'mag_aetherwell_relay')).toMatchObject({
        kind: 'next_cast_free',
        empowerAbilities: ['arcane_missiles'],
      });
    }
  });

  it('adds no proc draws and replays the reset and free-cast window exactly', () => {
    const run = () => {
      const sim = mageSim({ seed: 177_312 });
      sim.player.cooldowns.set('arcane_power', 60);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'evocation');
      sim.ctx.rng.setObserver(null);
      const aura = sim.player.auras.find((candidate) => candidate.id === 'mag_aetherwell_relay');
      return {
        draws,
        cooldown: sim.player.cooldowns.get('arcane_power') ?? 0,
        duration: aura?.remaining ?? 0,
      };
    };

    expect(run()).toEqual({ draws: [], cooldown: 0, duration: 8 });
    expect(run()).toEqual(run());
  });

  it('localizes Aetherwell in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Aetherwell', language)).not.toBe('Aetherwell');
    }
  });
});
