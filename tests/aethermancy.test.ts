import { describe, expect, it } from 'vitest';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { localizeTalentTitle, tTalent } from '../src/ui/talent_i18n';

const FLUX_BUILDERS = ['arcane_missiles', 'arcane_explosion'] as const;

function mageSim(spec: 'arcane' | 'fire' | 'frost' = 'arcane', seed = 177_301): Sim {
  const sim = new Sim({ seed, playerClass: 'mage', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_601): Entity {
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

function castAetherburst(sim: Sim): void {
  sim.player.gcdRemaining = 0;
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('arcane_explosion');
}

describe('Aethermancy Aetheric Flux', () => {
  it('authors a valid paid-mana bank and Aether Surge release', () => {
    const arcane = TALENTS.mage.specs.find((spec) => spec.id === 'arcane');

    expect(validateTalentTree(TALENTS.mage)).toEqual([]);
    expect(arcane?.signature).toBe('arcane_power');
    expect(arcane?.mastery.name).toBe('Aetheric Flux');
    expect(arcane?.mastery.description).toContain('Spending mana on Aether Darts or Aetherburst');
    expect(arcane?.mastery.description).toContain('up to 4');
    expect(arcane?.mastery.description).toContain('reduces Aether Surge cooldown by 10 sec');
    expect(arcane?.mastery.description).toContain('restores 5% of maximum mana per stack');
    expect(arcane?.mastery.effect).toEqual({
      global: { spellDmgPct: 0.15, spellHastePct: 0.1 },
      procs: [
        {
          id: 'mag_aetheric_flux',
          name: 'Aetheric Flux',
          spec: 'arcane',
          requiresKnownAbility: 'arcane_power',
          school: 'arcane',
          trigger: {
            on: 'resourceSpent',
            resourceType: 'mana',
            abilities: [...FLUX_BUILDERS],
          },
          responses: [
            { kind: 'stackAura', aura: 'aetheric_flux', maxStacks: 4, duration: 20 },
            { kind: 'cooldownRefund', ability: 'arcane_power', seconds: 10 },
          ],
        },
        {
          id: 'mag_aetheric_flux_release',
          name: 'Aetheric Flux',
          spec: 'arcane',
          requiresKnownAbility: 'arcane_power',
          school: 'arcane',
          trigger: { on: 'castNth', n: 1, abilities: ['arcane_power'] },
          responses: [
            {
              kind: 'consumeAuraStacksResource',
              auraId: 'mag_aetheric_flux',
              resourceType: 'mana',
              pctMaxPerStack: 0.05,
            },
          ],
        },
      ],
    });
    expect(mageSim().player.resourceType).toBe('mana');
  });

  it('builds visible Flux and refunds Aether Surge only when Aether Darts pays mana', () => {
    const sim = mageSim();
    targetFor(sim);
    const darts = sim.resolvedAbility('arcane_missiles');
    if (!darts) throw new Error('missing arcane_missiles');
    sim.player.cooldowns.set('arcane_power', 60);
    const before = sim.player.resource;

    sim.castAbility('arcane_missiles');

    expect(sim.player.channeling).toBe(true);
    expect(before - sim.player.resource).toBe(darts.cost);
    expect(sim.player.cooldowns.get('arcane_power')).toBe(50);
    expect(sim.player.auras.find((aura) => aura.id === 'mag_aetheric_flux')).toMatchObject({
      name: 'Aetheric Flux',
      kind: 'aetheric_flux',
      stacks: 1,
      remaining: 20,
      duration: 20,
      sourceId: sim.player.id,
      school: 'arcane',
    });
  });

  it('does not build Flux or refund Aether Surge when Aether Darts is free', () => {
    const sim = mageSim();
    targetFor(sim);
    sim.player.cooldowns.set('arcane_power', 60);
    sim.ctx.applyAura(sim.player, {
      id: 'test_free_darts',
      name: 'Test Free Darts',
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: sim.player.id,
      school: 'arcane',
      empowerAbilities: ['arcane_missiles'],
    });
    const before = sim.player.resource;

    sim.castAbility('arcane_missiles');

    expect(sim.player.channeling).toBe(true);
    expect(sim.player.resource).toBe(before);
    expect(sim.player.cooldowns.get('arcane_power')).toBe(60);
    expect(sim.player.auras.some((aura) => aura.id === 'mag_aetheric_flux')).toBe(false);
  });

  it('caps the bank at four and converts every stack into mana on Aether Surge', () => {
    const sim = mageSim();
    for (let cast = 0; cast < 5; cast++) castAetherburst(sim);

    expect(sim.player.auras.find((aura) => aura.id === 'mag_aetheric_flux')).toMatchObject({
      kind: 'aetheric_flux',
      stacks: 4,
      remaining: 20,
      duration: 20,
    });
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;

    sim.castAbility('arcane_power');

    expect(sim.player.resource).toBeCloseTo(sim.player.maxResource * 0.2);
    expect(sim.player.cooldowns.get('arcane_power')).toBe(90);
    expect(sim.player.auras.some((aura) => aura.id === 'mag_aetheric_flux')).toBe(false);
  });

  it('requires Aethermancy, the known signature, a listed builder, and positive mana spend', () => {
    for (const spec of ['fire', 'frost'] as const) {
      const sim = mageSim(spec);
      castAetherburst(sim);
      expect(sim.player.auras.some((aura) => aura.id === 'mag_aetheric_flux')).toBe(false);
    }

    const withoutSignature = mageSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Mage metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'arcane_power');
    castAetherburst(withoutSignature);
    expect(withoutSignature.player.auras.some((aura) => aura.id === 'mag_aetheric_flux')).toBe(
      false,
    );

    const unlisted = mageSim();
    unlisted.player.gcdRemaining = 0;
    unlisted.castAbility('arcane_power');
    expect(unlisted.player.auras.some((aura) => aura.id === 'mag_aetheric_flux')).toBe(false);
  });

  it('removes Flux when Aethermancy is left out of combat', () => {
    const sim = mageSim();
    castAetherburst(sim);
    expect(sim.player.auras.some((aura) => aura.id === 'mag_aetheric_flux')).toBe(true);

    expect(sim.applyTalents({ spec: 'fire', rows: {} })).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id === 'mag_aetheric_flux')).toBe(false);
  });

  it('adds no proc draws and replays the build-release cycle exactly', () => {
    const run = () => {
      const sim = mageSim('arcane', 177_302);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      castAetherburst(sim);
      sim.player.gcdRemaining = 0;
      sim.castAbility('arcane_power');
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        resource: sim.player.resource,
        flux: sim.player.auras.find((aura) => aura.id === 'mag_aetheric_flux')?.stacks ?? 0,
      };
    };

    const first = run();
    expect(first.draws).toEqual([]);
    expect(first.flux).toBe(0);
    expect(run()).toEqual(first);
  });

  it('localizes Aetheric Flux in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Aetheric Flux', language)).not.toBe('Aetheric Flux');
    }
  });

  it('localizes the Flux aura effect and keeps mana explicit in every non-Latin locale', async () => {
    const arcane = TALENTS.mage.specs.find((spec) => spec.id === 'arcane');
    if (!arcane) throw new Error('missing Aethermancy');
    await ensureLocaleLoaded('en');
    setLanguage('en');
    const values = { stacks: 2, max: 4, cooldown: 10, manaPct: 5 };
    const englishEffect = t('hudChrome.auraEffect.aethericFlux' as never, values);

    try {
      for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
        await ensureLocaleLoaded(language);
        setLanguage(language);
        expect(t('hudChrome.auraEffect.aethericFlux' as never, values)).not.toBe(englishEffect);
        expect(tTalent({ kind: 'talentMastery', spec: arcane, field: 'description' })).toContain(
          t('abilityUi.resources.mana'),
        );
      }
    } finally {
      setLanguage('en');
    }
  });
});
