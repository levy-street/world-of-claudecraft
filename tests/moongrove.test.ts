import { describe, expect, it } from 'vitest';
import { onSpellHit } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function druidSim(spec: 'balance' | 'feral' | 'restoration' = 'balance', seed = 178_101): Sim {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_801, MOBS.forest_wolf, 20, {
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

describe('Moongrove Moonrage', () => {
  it('authors a valid, explicitly gated nature-to-lunar relay', () => {
    const balance = TALENTS.druid.specs.find((spec) => spec.id === 'balance');

    expect(validateTalentTree(TALENTS.druid)).toEqual([]);
    expect(balance?.signature).toBe('moonkin_form');
    expect(balance?.mastery.name).toBe('Moonrage');
    expect(balance?.mastery.description).toContain('landed Wildbolt');
    expect(balance?.mastery.description).toContain('Lunar Tempest or Skyfall');
    expect(balance?.mastery.effect.procs).toHaveLength(2);
    for (const proc of balance?.mastery.effect.procs ?? []) {
      expect(proc.spec).toBe('balance');
      expect(proc.requiresKnownAbility).toBe('moonkin_form');
    }
    expect(druidSim().player.resourceType).toBe('mana');
  });

  it('arms the scoped lunar discount only after a landed Wildbolt', () => {
    const sim = druidSim();
    const target = targetFor(sim);

    onSpellHit(sim.ctx, sim.player, 'wrath', target, 40);

    expect(sim.player.auras.find((aura) => aura.id === 'dru_moonrage_lunar')).toMatchObject({
      name: 'Moonrage',
      kind: 'next_cast_cheap',
      remaining: 8,
      duration: 8,
      value: 0.5,
      empowerAbilities: ['moonfire', 'starfire'],
      sourceId: sim.player.id,
      school: 'nature',
    });
  });

  it('turns a lunar spell into one mobile Wildbolt without discounting its mana', () => {
    const baseline = druidSim();
    const baselineTarget = targetFor(baseline);
    baseline.targetEntity(baselineTarget.id);
    baseline.castAbility('wrath');
    expect(baseline.player.castingAbility).toBe('wrath');

    const sim = druidSim();
    const target = targetFor(sim);
    onSpellHit(sim.ctx, sim.player, 'moonfire', target, 20);
    const wildbolt = sim.resolvedAbility('wrath');
    if (!wildbolt) throw new Error('missing Wildbolt');
    const manaBefore = sim.player.resource;

    sim.castAbility('wrath');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(manaBefore - wildbolt.cost);
    expect(sim.player.auras.some((aura) => aura.id === 'dru_moonrage_wild')).toBe(false);
  });

  it('charges half mana for one Lunar Tempest or Skyfall and consumes only that window', () => {
    for (const abilityId of ['moonfire', 'starfire'] as const) {
      const sim = druidSim();
      const target = targetFor(sim);
      onSpellHit(sim.ctx, sim.player, 'wrath', target, 40);
      const lunar = sim.resolvedAbility(abilityId);
      if (!lunar) throw new Error(`missing ${abilityId}`);
      const manaBefore = sim.player.resource;

      sim.castAbility(abilityId);
      for (let tick = 0; tick < 200 && sim.player.castingAbility; tick++) sim.tick();

      expect(sim.player.resource).toBe(manaBefore - Math.ceil(lunar.cost * 0.5));
      expect(sim.player.auras.some((aura) => aura.id === 'dru_moonrage_lunar')).toBe(false);
    }
  });

  it('requires Moongrove, known Moonwing Form, and an explicitly listed landed spell', () => {
    const withoutSignature = druidSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Druid metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'moonkin_form');

    for (const sim of [druidSim('feral'), druidSim('restoration'), withoutSignature]) {
      const target = targetFor(sim);
      onSpellHit(sim.ctx, sim.player, 'wrath', target, 40);
      onSpellHit(sim.ctx, sim.player, 'moonfire', target, 20);
      expect(sim.player.auras.some((aura) => aura.id.startsWith('dru_moonrage_'))).toBe(false);
    }

    const wrongSpell = druidSim();
    onSpellHit(wrongSpell.ctx, wrongSpell.player, 'entangling_roots', targetFor(wrongSpell), 20);
    expect(wrongSpell.player.auras.some((aura) => aura.id.startsWith('dru_moonrage_'))).toBe(false);
  });

  it('clears both handoff windows when Moongrove is left', () => {
    const sim = druidSim();
    const target = targetFor(sim);
    onSpellHit(sim.ctx, sim.player, 'wrath', target, 40);
    onSpellHit(sim.ctx, sim.player, 'moonfire', target, 20);
    expect(sim.player.auras.filter((aura) => aura.id.startsWith('dru_moonrage_'))).toHaveLength(2);

    expect(sim.applyTalents({ spec: 'feral', rows: {} })).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id.startsWith('dru_moonrage_'))).toBe(false);
  });

  it('adds no proc draws and replays the relay state exactly', () => {
    const run = () => {
      const sim = druidSim('balance', 178_102);
      const target = targetFor(sim);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onSpellHit(sim.ctx, sim.player, 'wrath', target, 40);
      onSpellHit(sim.ctx, sim.player, 'starfire', target, 80);
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        windows: sim.player.auras
          .filter((aura) => aura.id.startsWith('dru_moonrage_'))
          .map((aura) => [aura.id, aura.kind, aura.remaining]),
      };
    };

    expect(run()).toEqual({
      draws: [],
      windows: [
        ['dru_moonrage_lunar', 'next_cast_cheap', 8],
        ['dru_moonrage_wild', 'next_cast_instant', 8],
      ],
    });
    expect(run()).toEqual(run());
  });

  it('localizes Moonrage in every required non-Latin locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Moonrage', language)).not.toBe('Moonrage');
    }
  });
});
