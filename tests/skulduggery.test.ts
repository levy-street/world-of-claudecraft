import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const OPENERS = ['ambush', 'garrote', 'cheap_shot'];

function rogueSim(spec: 'assassination' | 'combat' | 'subtlety' = 'subtlety'): Sim {
  const sim = new Sim({ seed: 170741, playerClass: 'rogue', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_405, MOBS.forest_wolf, 20, {
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
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
  return target;
}

function fixedMeleeRolls(sim: Sim): void {
  const rng = sim.ctx.rng as typeof sim.ctx.rng & {
    next(): number;
    range(min: number, max: number): number;
    chance(probability: number): boolean;
  };
  rng.next = () => 0.9;
  rng.range = (min) => min;
  rng.chance = () => false;
}

function maskfallDamage(sim: Sim, target: Entity): number {
  fixedMeleeRolls(sim);
  sim.player.weapon = { ...sim.player.weapon, min: 100, max: 100 };
  const before = target.hp;
  sim.castAbility('hemorrhage');
  return before - target.hp;
}

describe('Skulduggery False Face', () => {
  it('authors a valid stealth-to-burst mastery while preserving its critical rating axis', () => {
    const spec = TALENTS.rogue.specs.find((candidate) => candidate.id === 'subtlety');

    expect(validateTalentTree(TALENTS.rogue)).toEqual([]);
    expect(spec?.mastery.name).toBe('False Face');
    expect(spec?.mastery.description).toContain("Using Lurker's Strike, Throat Wire, or Gut Punch");
    expect(spec?.mastery.description).toContain('next Maskfall');
    expect(spec?.mastery.effect).toEqual({
      global: { critDmgPhysPct: 0.4 },
      stats: { agiPct: 0.1 },
      proc: {
        id: 'rog_false_face',
        name: 'False Face',
        spec: 'subtlety',
        requiresKnownAbility: 'hemorrhage',
        school: 'shadow',
        trigger: { on: 'castNth', n: 1, abilities: OPENERS },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_ability_damage',
            abilities: ['hemorrhage'],
            duration: 8,
            dmgPct: 0.5,
          },
        ],
      },
    });
  });

  it('turns the signature into front-loaded Maskfall damage instead of another bleed tool', () => {
    expect(ABILITIES.hemorrhage).toMatchObject({
      id: 'hemorrhage',
      name: 'Maskfall',
      cost: 35,
      awardsCombo: 1,
      effects: [{ type: 'weaponStrike', bonus: 52 }],
    });
    expect(ABILITIES.hemorrhage.effects).toHaveLength(1);
    expect(ABILITIES.hemorrhage.description).not.toContain('bleed');
  });

  it('opens one visible eight-second Maskfall window from each stealth opener with zero proc draws', () => {
    const run = (abilityId: string) => {
      const sim = rogueSim();
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      onCastCompleted(sim.ctx, sim.player, abilityId, sim.player);
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        aura: sim.player.auras.find((candidate) => candidate.id === 'rog_false_face'),
      };
    };

    for (const abilityId of OPENERS) {
      const result = run(abilityId);
      expect(result.draws, abilityId).toBe(0);
      expect(result.aura, abilityId).toMatchObject({
        kind: 'next_ability_damage',
        remaining: 8,
        duration: 8,
        value: 0.5,
        empowerAbilities: ['hemorrhage'],
      });
      expect(run(abilityId)).toEqual(run(abilityId));
    }
  });

  it('plays a real Duskveil opener into Maskfall using energy and combo points', () => {
    const sim = rogueSim();
    const target = targetFor(sim);
    fixedMeleeRolls(sim);

    sim.castAbility('stealth');
    expect(sim.player.auras.some((aura) => aura.kind === 'stealth')).toBe(true);
    sim.castAbility('cheap_shot');
    expect(sim.player.comboPoints).toBe(2);
    expect(sim.player.resource).toBe(40);
    expect(sim.player.auras.some((aura) => aura.id === 'rog_false_face')).toBe(true);

    sim.player.gcdRemaining = 0;
    const hpBefore = target.hp;
    sim.castAbility('hemorrhage');

    expect(target.hp).toBeLessThan(hpBefore);
    expect(sim.player.resource).toBe(5);
    expect(sim.player.comboPoints).toBe(3);
    expect(sim.player.auras.some((aura) => aura.id === 'rog_false_face')).toBe(false);
  });

  it('makes one landed Maskfall 50% stronger without empowering another weapon strike', () => {
    const baseline = rogueSim();
    const baselineDamage = maskfallDamage(baseline, targetFor(baseline));

    const sim = rogueSim();
    const target = targetFor(sim);
    onCastCompleted(sim.ctx, sim.player, 'ambush', sim.player);
    const empoweredDamage = maskfallDamage(sim, target);

    expect(empoweredDamage).toBeGreaterThanOrEqual(Math.floor(baselineDamage * 1.5));
    expect(empoweredDamage).toBeLessThanOrEqual(Math.ceil(baselineDamage * 1.5));
    expect(sim.player.auras.some((aura) => aura.id === 'rog_false_face')).toBe(false);

    const scoped = rogueSim();
    onCastCompleted(scoped.ctx, scoped.player, 'ambush', scoped.player);
    expect(
      scoped.player.auras.find((aura) => aura.id === 'rog_false_face')?.empowerAbilities,
    ).toEqual(['hemorrhage']);
  });

  it('ignores unrelated casts and does not arm outside Skulduggery or before Maskfall is learned', () => {
    const unrelated = rogueSim();
    onCastCompleted(unrelated.ctx, unrelated.player, 'sinister_strike', unrelated.player);
    expect(unrelated.player.auras.some((aura) => aura.id === 'rog_false_face')).toBe(false);

    const withoutSignature = rogueSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Skulduggery metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'hemorrhage');
    for (const sim of [rogueSim('assassination'), rogueSim('combat'), withoutSignature]) {
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      onCastCompleted(sim.ctx, sim.player, 'ambush', sim.player);
      sim.ctx.rng.setObserver(null);
      expect(draws).toBe(0);
      expect(sim.player.auras.some((aura) => aura.id === 'rog_false_face')).toBe(false);
    }
  });

  it('expires naturally and clears immediately when Skulduggery is left', () => {
    const expired = rogueSim();
    onCastCompleted(expired.ctx, expired.player, 'ambush', expired.player);
    for (let tick = 0; tick < 161; tick++) expired.tick();
    expect(expired.player.auras.some((aura) => aura.id === 'rog_false_face')).toBe(false);

    const changedSpec = rogueSim();
    onCastCompleted(changedSpec.ctx, changedSpec.player, 'ambush', changedSpec.player);
    expect(changedSpec.applyTalents({ spec: 'assassination', rows: {} })).toBe(true);
    expect(changedSpec.player.auras.some((aura) => aura.id === 'rog_false_face')).toBe(false);
  });

  it('ships Maskfall and False Face in all five non-Latin fills', async () => {
    try {
      for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
        await ensureLocaleLoaded(language);
        setLanguage(language);
        expect(tEntity({ kind: 'ability', id: 'hemorrhage', field: 'name' })).not.toBe('Maskfall');
        expect(localizeTalentTitle('False Face', language)).not.toBe('False Face');
      }
    } finally {
      setLanguage('en');
    }
  });
});
