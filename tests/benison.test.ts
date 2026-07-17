import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { onCastCompleted, onHotExpired } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const LAST_BLESSING_ID = 'pri_r17_improved_fortitude';

function benisonSim(
  options: { spec?: 'discipline' | 'holy' | 'shadow'; lastBlessing?: boolean; seed?: number } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 178_511, playerClass: 'priest', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'holy',
      rows: options.lastBlessing === false ? {} : { 17: LAST_BLESSING_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  sim.player.spellPower = 0;
  sim.player.hp = Math.max(1, sim.player.maxHp - 500);
  sim.targetEntity(sim.player.id);
  return sim;
}

function aura(sim: Sim, id: string) {
  return sim.player.auras.find((candidate) => candidate.id === id);
}

function finishLingeringGrace(sim: Sim): void {
  for (let tick = 0; tick < 400 && aura(sim, 'renew'); tick++) {
    updateAuras(sim.ctx, sim.player);
  }
}

describe('Benison Grave Mercy', () => {
  it('authors a valid, explicitly gated signature-to-HoT weave', () => {
    const holy = TALENTS.priest.specs.find((spec) => spec.id === 'holy');

    expect(validateTalentTree(TALENTS.priest)).toEqual([]);
    expect(holy?.signature).toBe('holy_nova');
    expect(holy?.mastery.name).toBe('Grave Mercy');
    expect(holy?.mastery.description).toContain('Sunburst Canticle');
    expect(holy?.mastery.description).toContain('Lingering Grace');
    expect(holy?.mastery.effect).toEqual({
      global: { healPct: 0.2 },
      proc: {
        id: 'pri_grave_mercy',
        name: 'Grave Mercy',
        spec: 'holy',
        requiresKnownAbility: 'holy_nova',
        school: 'holy',
        trigger: { on: 'castNth', n: 1, abilities: ['holy_nova'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['renew'],
            duration: 8,
          },
        ],
      },
    });
    expect(benisonSim().player.resourceType).toBe('mana');
  });

  it('turns Sunburst Canticle into one free Lingering Grace', () => {
    const sim = benisonSim();
    const sunburst = sim.resolvedAbility('holy_nova');
    if (!sunburst) throw new Error('missing Benison signature ability');
    const manaBefore = sim.player.resource;

    sim.castAbility('holy_nova');

    expect(sim.player.resource).toBe(manaBefore - sunburst.cost);
    expect(aura(sim, 'pri_grave_mercy')).toMatchObject({
      name: 'Grave Mercy',
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['renew'],
      sourceId: sim.player.id,
      school: 'holy',
    });

    sim.player.gcdRemaining = 0;
    sim.player.resource = 0;
    sim.castAbility('renew');

    expect(sim.player.resource).toBe(0);
    expect(aura(sim, 'renew')).toBeDefined();
    expect(aura(sim, 'pri_grave_mercy')).toBeUndefined();
  });

  it('lets a free Lingering Grace mature into one instant full-mana prayer', () => {
    const sim = benisonSim();
    sim.castAbility('holy_nova');
    sim.player.gcdRemaining = 0;
    sim.player.resource = 0;
    sim.castAbility('renew');
    expect(aura(sim, 'renew')).toBeDefined();

    finishLingeringGrace(sim);

    expect(aura(sim, 'renew')).toBeUndefined();
    expect(aura(sim, 'pri_last_blessing')).toMatchObject({
      name: 'Last Blessing',
      kind: 'next_cast_instant',
      duration: 8,
      empowerAbilities: ['heal', 'flash_heal'],
      sourceId: sim.player.id,
      school: 'holy',
    });

    const prayer = sim.resolvedAbility('heal');
    if (!prayer) throw new Error('missing Benison direct heal');
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    const manaBefore = sim.player.resource;
    sim.castAbility('heal');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(manaBefore - prayer.cost);
    expect(aura(sim, 'pri_last_blessing')).toBeUndefined();
  });

  it('gates Grave Mercy and Last Blessing to their intended specs and abilities', () => {
    for (const spec of ['discipline', 'shadow'] as const) {
      const sim = benisonSim({ spec });
      onCastCompleted(sim.ctx, sim.player, 'holy_nova', sim.player);
      expect(aura(sim, 'pri_grave_mercy')).toBeUndefined();
    }

    const withoutSignature = benisonSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Priest metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'holy_nova');
    onCastCompleted(
      withoutSignature.ctx,
      withoutSignature.player,
      'holy_nova',
      withoutSignature.player,
    );
    expect(aura(withoutSignature, 'pri_grave_mercy')).toBeUndefined();

    const wrongCast = benisonSim();
    onCastCompleted(wrongCast.ctx, wrongCast.player, 'renew', wrongCast.player);
    expect(aura(wrongCast, 'pri_grave_mercy')).toBeUndefined();

    for (const spec of ['discipline', 'holy'] as const) {
      const sim = benisonSim({ spec });
      onHotExpired(sim.ctx, sim.player, 'renew', sim.player);
      expect(aura(sim, 'pri_last_blessing')).toBeDefined();
    }
    const shadow = benisonSim({ spec: 'shadow' });
    onHotExpired(shadow.ctx, shadow.player, 'renew', shadow.player);
    expect(aura(shadow, 'pri_last_blessing')).toBeUndefined();

    const unselected = benisonSim({ lastBlessing: false });
    onHotExpired(unselected.ctx, unselected.player, 'renew', unselected.player);
    expect(aura(unselected, 'pri_last_blessing')).toBeUndefined();

    const wrongHot = benisonSim();
    onHotExpired(wrongHot.ctx, wrongHot.player, 'healing_stream', wrongHot.player);
    expect(aura(wrongHot, 'pri_last_blessing')).toBeUndefined();
  });

  it('clears both Benison handoffs when their gates are removed', () => {
    const sim = benisonSim();
    onCastCompleted(sim.ctx, sim.player, 'holy_nova', sim.player);
    onHotExpired(sim.ctx, sim.player, 'renew', sim.player);
    expect(aura(sim, 'pri_grave_mercy')).toBeDefined();
    expect(aura(sim, 'pri_last_blessing')).toBeDefined();

    expect(sim.applyTalents({ spec: 'shadow', rows: { 17: LAST_BLESSING_ID } })).toBe(true);

    expect(aura(sim, 'pri_grave_mercy')).toBeUndefined();
    expect(aura(sim, 'pri_last_blessing')).toBeUndefined();
  });

  it('adds no proc draws and replays both handoffs exactly', () => {
    const run = () => {
      const sim = benisonSim({ seed: 178_512 });
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'holy_nova', sim.player);
      onHotExpired(sim.ctx, sim.player, 'renew', sim.player);
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        windows: sim.player.auras
          .filter((entry) => entry.id === 'pri_grave_mercy' || entry.id === 'pri_last_blessing')
          .map((entry) => [entry.id, entry.kind, entry.remaining]),
      };
    };

    expect(run()).toEqual({
      draws: [],
      windows: [
        ['pri_grave_mercy', 'next_cast_free', 8],
        ['pri_last_blessing', 'next_cast_instant', 8],
      ],
    });
    expect(run()).toEqual(run());
  });

  it('fills both Benison titles in every required non-Latin locale', () => {
    const languages = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;
    for (const language of languages) {
      expect(localizeTalentTitle('Grave Mercy', language)).not.toBe('Grave Mercy');
    }
    expect(languages.map((language) => localizeTalentTitle('Last Blessing', language))).toEqual([
      '最后祝福',
      '最後祝福',
      '最後の祝福',
      '마지막 축복',
      'Последнее благословение',
    ]);
  });
});
