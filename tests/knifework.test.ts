import { describe, expect, it } from 'vitest';
import { onSpellHit } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function rogueSim(spec: 'assassination' | 'combat' | 'subtlety' = 'assassination'): Sim {
  const sim = new Sim({ seed: 170737, playerClass: 'rogue', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_401, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  target.hostile = true;
  target.stats = { ...target.stats, armor: 0 };
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  return target;
}

function faceAndTarget(sim: Sim, target: Entity): void {
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
  sim.player.gcdRemaining = 0;
}

describe('Knifework Redhanded', () => {
  it('authors a valid poison-to-finisher mastery without changing its rating axis', () => {
    const spec = TALENTS.rogue.specs.find((candidate) => candidate.id === 'assassination');

    expect(validateTalentTree(TALENTS.rogue)).toEqual([]);
    expect(spec?.mastery.name).toBe('Redhanded');
    expect(spec?.mastery.description).toContain('Landing Leaden Venom');
    expect(spec?.mastery.description).toContain('Dirt Nap or Bleed Out');
    expect(spec?.mastery.effect).toEqual({
      global: { dotDmgPct: 0.2 },
      stats: { crit: 0.03 },
      proc: {
        id: 'rog_redhanded',
        name: 'Redhanded',
        spec: 'assassination',
        requiresKnownAbility: 'crippling_poison',
        school: 'nature',
        trigger: { on: 'spellHit', abilities: ['crippling_poison'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['eviscerate', 'rupture'],
            duration: 8,
          },
        ],
      },
    });
  });

  it('opens one visible eight-second finisher window on a landed poison with zero proc draws', () => {
    const run = () => {
      const sim = rogueSim();
      const target = targetFor(sim);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      onSpellHit(sim.ctx, sim.player, 'crippling_poison', target);

      sim.ctx.rng.setObserver(null);
      const aura = sim.player.auras.find((candidate) => candidate.id === 'rog_redhanded');
      return {
        draws,
        aura: aura && {
          kind: aura.kind,
          remaining: aura.remaining,
          duration: aura.duration,
          empowerAbilities: aura.empowerAbilities,
        },
      };
    };

    expect(run()).toEqual({
      draws: 0,
      aura: {
        kind: 'next_cast_free',
        remaining: 8,
        duration: 8,
        empowerAbilities: ['eviscerate', 'rupture'],
      },
    });
    expect(run()).toEqual(run());
  });

  it('spends Redhanded on either a direct or bleed finisher while preserving combo-point costs', () => {
    for (const abilityId of ['eviscerate', 'rupture']) {
      const sim = rogueSim();
      const target = targetFor(sim);
      faceAndTarget(sim, target);
      sim.player.resource = 0;
      sim.player.comboPoints = 5;
      onSpellHit(sim.ctx, sim.player, 'crippling_poison', target);

      sim.castAbility(abilityId);

      expect(sim.player.resource).toBe(0);
      expect(sim.player.comboPoints).toBe(0);
      expect(sim.player.auras.some((aura) => aura.id === 'rog_redhanded')).toBe(false);
    }
  });

  it('does not spend the poison window on builders or utility', () => {
    const sim = rogueSim();
    onSpellHit(sim.ctx, sim.player, 'crippling_poison', sim.player);

    for (const abilityId of ['sinister_strike', 'gouge', 'vanish']) {
      expect(
        sim.player.auras.find((aura) => aura.id === 'rog_redhanded')?.empowerAbilities,
      ).not.toContain(abilityId);
    }
  });

  it('does not arm outside Knifework or before Leaden Venom is learned', () => {
    const withoutPoison = rogueSim();
    const meta = withoutPoison.meta(withoutPoison.playerId);
    if (!meta) throw new Error('missing Knifework metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'crippling_poison');

    for (const sim of [rogueSim('combat'), rogueSim('subtlety'), withoutPoison]) {
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      onSpellHit(sim.ctx, sim.player, 'crippling_poison', sim.player);
      sim.ctx.rng.setObserver(null);

      expect(draws).toBe(0);
      expect(sim.player.auras.some((aura) => aura.id === 'rog_redhanded')).toBe(false);
    }
  });

  it('expires naturally and clears immediately when Knifework is left', () => {
    const expired = rogueSim();
    onSpellHit(expired.ctx, expired.player, 'crippling_poison', expired.player);
    for (let tick = 0; tick < 161; tick++) expired.tick();
    expect(expired.player.auras.some((aura) => aura.id === 'rog_redhanded')).toBe(false);

    const changedSpec = rogueSim();
    onSpellHit(changedSpec.ctx, changedSpec.player, 'crippling_poison', changedSpec.player);
    expect(changedSpec.applyTalents({ spec: 'combat', rows: {} })).toBe(true);
    expect(changedSpec.player.auras.some((aura) => aura.id === 'rog_redhanded')).toBe(false);
  });

  it('ships the visible poison setup and Redhanded window in all five non-Latin fills', async () => {
    try {
      for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
        await ensureLocaleLoaded(language);
        setLanguage(language);
        expect(tEntity({ kind: 'ability', id: 'crippling_poison', field: 'name' })).not.toBe(
          'Leaden Venom',
        );
        expect(localizeTalentTitle('Redhanded', language)).not.toBe('Redhanded');
      }
    } finally {
      setLanguage('en');
    }
  });
});
