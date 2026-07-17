import { describe, expect, it } from 'vitest';
import { onSpellCrit } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const FIRE_CRIT_ABILITIES = ['immolate', 'searing_pain', 'conflagrate', 'chaos_bolt'] as const;
const SHADOW_CRIT_ABILITIES = ['shadow_bolt', 'shadowburn', 'death_coil'] as const;

function warlockSim(
  spec: 'affliction' | 'demonology' | 'destruction' = 'destruction',
  seed = 170_748,
): Sim {
  const sim = new Sim({ seed, playerClass: 'warlock', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_418): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 10,
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

function runAbility(sim: Sim, target: Entity, abilityId: string): void {
  const meta = sim.meta(sim.playerId);
  const ability = sim.resolvedAbility(abilityId);
  if (!meta || !ability) throw new Error(`missing ${abilityId}`);
  sim.ctx.runEffects(sim.player, meta, target, ability);
}

function advanceCastAndProjectile(sim: Sim): void {
  for (
    let tick = 0;
    tick < 200 && (sim.player.castingAbility !== null || sim.ctx.pendingProjectiles.length > 0);
    tick++
  ) {
    sim.tick();
  }
  expect(sim.player.castingAbility).toBeNull();
  expect(sim.ctx.pendingProjectiles).toHaveLength(0);
}

describe('Ruination Desolation', () => {
  it('authors a valid cross-school critical relay without a new resource', () => {
    const spec = TALENTS.warlock.specs.find((candidate) => candidate.id === 'destruction');

    expect(validateTalentTree(TALENTS.warlock)).toEqual([]);
    expect(spec?.signature).toBe('conflagrate');
    expect(spec?.mastery.name).toBe('Desolation');
    expect(spec?.mastery.description).toContain('Direct Fire critical strikes');
    expect(spec?.mastery.description).toContain('direct Shadow critical strikes');
    expect(spec?.mastery.effect).toEqual({
      global: { critDmgSpellPct: 0.5 },
      stats: { crit: 0.02 },
      procs: [
        {
          id: 'wlk_desolation_gloom',
          name: 'Desolation',
          spec: 'destruction',
          requiresKnownAbility: 'conflagrate',
          school: 'fire',
          trigger: { on: 'spellCrit', abilities: [...FIRE_CRIT_ABILITIES] },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_cast_instant',
              abilities: ['shadow_bolt'],
              duration: 8,
            },
          ],
        },
        {
          id: 'wlk_desolation_conflagrate',
          name: 'Desolation',
          spec: 'destruction',
          requiresKnownAbility: 'conflagrate',
          school: 'shadow',
          trigger: { on: 'spellCrit', abilities: [...SHADOW_CRIT_ABILITIES] },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_cast_free',
              abilities: ['conflagrate'],
              duration: 8,
            },
          ],
        },
      ],
    });
    expect(warlockSim().player.resourceType).toBe('mana');
  });

  it('routes only explicit direct Fire and Shadow critical strikes to their payoffs', () => {
    const sim = warlockSim();
    const target = targetFor(sim);

    for (const abilityId of FIRE_CRIT_ABILITIES) {
      onSpellCrit(sim.ctx, sim.player, abilityId, target);
      expect(sim.player.auras.find((aura) => aura.id === 'wlk_desolation_gloom')).toMatchObject({
        kind: 'next_cast_instant',
        empowerAbilities: ['shadow_bolt'],
        duration: 8,
      });
      sim.player.auras = sim.player.auras.filter((aura) => aura.id !== 'wlk_desolation_gloom');
    }

    for (const abilityId of SHADOW_CRIT_ABILITIES) {
      onSpellCrit(sim.ctx, sim.player, abilityId, target);
      expect(
        sim.player.auras.find((aura) => aura.id === 'wlk_desolation_conflagrate'),
      ).toMatchObject({
        kind: 'next_cast_free',
        empowerAbilities: ['conflagrate'],
        duration: 8,
      });
      sim.player.auras = sim.player.auras.filter(
        (aura) => aura.id !== 'wlk_desolation_conflagrate',
      );
    }

    onSpellCrit(sim.ctx, sim.player, 'drain_life', target);
    expect(sim.player.auras.some((aura) => aura.id.startsWith('wlk_desolation_'))).toBe(false);
  });

  it('acquires both relay windows through real critical spell damage and ignores non-criticals', () => {
    const critical = warlockSim();
    const criticalTarget = targetFor(critical, 97_419);
    criticalTarget.level = 1;
    critical.player.stats.int = 2_000;

    critical.castAbility('searing_pain');
    advanceCastAndProjectile(critical);
    expect(critical.player.auras.find((aura) => aura.id === 'wlk_desolation_gloom')).toMatchObject({
      kind: 'next_cast_instant',
      empowerAbilities: ['shadow_bolt'],
    });

    critical.player.resource = critical.player.maxResource;
    critical.player.gcdRemaining = 0;
    critical.player.stats.int = 2_000;
    critical.castAbility('shadow_bolt');
    advanceCastAndProjectile(critical);
    expect(
      critical.player.auras.find((aura) => aura.id === 'wlk_desolation_conflagrate'),
    ).toMatchObject({ kind: 'next_cast_free', empowerAbilities: ['conflagrate'] });

    const nonCritical = warlockSim();
    const nonCriticalTarget = targetFor(nonCritical, 97_420);
    nonCriticalTarget.level = 1;
    nonCritical.player.stats.int = -100;
    nonCritical.castAbility('searing_pain');
    advanceCastAndProjectile(nonCritical);
    nonCritical.player.resource = nonCritical.player.maxResource;
    nonCritical.player.gcdRemaining = 0;
    nonCritical.castAbility('shadow_bolt');
    advanceCastAndProjectile(nonCritical);

    expect(nonCritical.player.auras.some((aura) => aura.id.startsWith('wlk_desolation_'))).toBe(
      false,
    );
  });

  it('gates both relay windows by Ruination and the known Conflagrate signature', () => {
    const withoutSignature = warlockSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Ruination metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'conflagrate');

    for (const sim of [warlockSim('affliction'), warlockSim('demonology'), withoutSignature]) {
      const target = targetFor(sim, 97_421 + sim.player.id);
      onSpellCrit(sim.ctx, sim.player, 'immolate', target);
      onSpellCrit(sim.ctx, sim.player, 'shadow_bolt', target);

      expect(sim.player.auras.some((aura) => aura.id.startsWith('wlk_desolation_'))).toBe(false);
    }
  });

  it('spends the Shadow-crit window on a free Conflagrate that consumes Burning Pact', () => {
    const sim = warlockSim();
    const target = targetFor(sim, 97_422);
    runAbility(sim, target, 'immolate');
    expect(
      target.auras.some(
        (aura) => aura.id === 'immolate' && aura.kind === 'dot' && aura.sourceId === sim.player.id,
      ),
    ).toBe(true);
    onSpellCrit(sim.ctx, sim.player, 'shadow_bolt', target);
    sim.player.resource = 0;

    sim.castAbility('conflagrate');

    expect(sim.player.resource).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_desolation_conflagrate')).toBe(false);
    for (let tick = 0; tick < 100 && sim.ctx.pendingProjectiles.length > 0; tick++) sim.tick();
    expect(sim.ctx.pendingProjectiles).toHaveLength(0);
    expect(
      target.auras.some(
        (aura) => aura.id === 'immolate' && aura.kind === 'dot' && aura.sourceId === sim.player.id,
      ),
    ).toBe(false);
  });

  it('spends full mana on the instant Gloom Bolt opened by a Fire critical strike', () => {
    const sim = warlockSim();
    const target = targetFor(sim, 97_423);
    const bolt = sim.resolvedAbility('shadow_bolt');
    if (!bolt) throw new Error('missing Gloom Bolt');
    onSpellCrit(sim.ctx, sim.player, 'immolate', target);
    const manaBefore = sim.player.resource;

    sim.castAbility('shadow_bolt');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(manaBefore - bolt.cost);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_desolation_gloom')).toBe(false);
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
  });

  it('adds no proc draws and replays coexisting relay windows exactly', () => {
    const run = () => {
      const sim = warlockSim('destruction', 170_749);
      const target = targetFor(sim, 97_424);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onSpellCrit(sim.ctx, sim.player, 'immolate', target);
      onSpellCrit(sim.ctx, sim.player, 'shadow_bolt', target);
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        auras: sim.player.auras
          .filter((aura) => aura.id.startsWith('wlk_desolation_'))
          .map((aura) => [aura.id, aura.kind, aura.remaining]),
      };
    };

    expect(run()).toEqual(run());
    expect(run().draws).toEqual([]);
    expect(run().auras).toHaveLength(2);
  });

  it('clears both visible relay windows when Ruination is left', () => {
    const sim = warlockSim();
    const target = targetFor(sim, 97_425);
    onSpellCrit(sim.ctx, sim.player, 'immolate', target);
    onSpellCrit(sim.ctx, sim.player, 'shadow_bolt', target);
    expect(sim.player.auras.filter((aura) => aura.id.startsWith('wlk_desolation_'))).toHaveLength(
      2,
    );

    expect(sim.applyTalents({ spec: 'affliction', rows: {} })).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id.startsWith('wlk_desolation_'))).toBe(false);
  });

  it('localizes the visible Desolation identity in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Desolation', language)).not.toBe('Desolation');
    }
  });
});
