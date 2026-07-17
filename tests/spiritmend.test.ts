import { describe, expect, it } from 'vitest';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const TIDEFLOW_ID = 'sha_r17_improved_ghost_wolf';

function spiritmendSim(
  options: {
    spec?: 'elemental' | 'enhancement' | 'restoration';
    tideflow?: boolean;
    seed?: number;
  } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 178_521, playerClass: 'shaman', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'restoration',
      rows: options.tideflow === false ? {} : { 17: TIDEFLOW_ID },
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

function finishCast(sim: Sim, abilityId: string): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing Shaman metadata');
  sim.player.gcdRemaining = 0;
  sim.castAbility(abilityId);
  if (sim.player.castingAbility) {
    sim.player.castRemaining = 0;
    updateCasting(sim.ctx, sim.player, meta);
  }
}

describe('Spiritmend Cleansing Tides', () => {
  it('authors a valid, explicitly gated Chain-Heal-to-Mending relay', () => {
    const restoration = TALENTS.shaman.specs.find((spec) => spec.id === 'restoration');

    expect(validateTalentTree(TALENTS.shaman)).toEqual([]);
    expect(restoration?.signature).toBe('chain_heal');
    expect(restoration?.mastery.name).toBe('Cleansing Tides');
    expect(restoration?.mastery.description).toContain('Chain Heal');
    expect(restoration?.mastery.description).toContain('Mending Waters');
    expect(restoration?.mastery.effect).toEqual({
      ability: [
        { ability: 'chain_heal', costPct: -0.2 },
        { ability: 'healing_wave', costPct: -0.2 },
      ],
      proc: {
        id: 'sha_cleansing_tides',
        name: 'Cleansing Tides',
        spec: 'restoration',
        requiresKnownAbility: 'chain_heal',
        school: 'nature',
        trigger: { on: 'castNth', n: 1, abilities: ['chain_heal'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_cheap',
            abilities: ['healing_wave'],
            duration: 8,
            costPct: 0.5,
          },
        ],
      },
    });
    expect(spiritmendSim().player.resourceType).toBe('mana');
  });

  it('closes Chain Heal and Tideflow into a real mana-only healing rotation', () => {
    const sim = spiritmendSim();
    const chain = sim.resolvedAbility('chain_heal');
    const mending = sim.resolvedAbility('healing_wave');
    if (!chain || !mending) throw new Error('missing Spiritmend rotation abilities');

    const manaBeforeChain = sim.player.resource;
    finishCast(sim, 'chain_heal');
    expect(sim.player.resource).toBe(manaBeforeChain - chain.cost);
    expect(aura(sim, 'sha_cleansing_tides')).toMatchObject({
      name: 'Cleansing Tides',
      kind: 'next_cast_cheap',
      remaining: 8,
      duration: 8,
      value: 0.5,
      empowerAbilities: ['healing_wave'],
      sourceId: sim.player.id,
      school: 'nature',
    });

    sim.player.resource = sim.player.maxResource;
    const manaBeforeMending = sim.player.resource;
    finishCast(sim, 'healing_wave');
    expect(sim.player.resource).toBe(manaBeforeMending - Math.ceil(mending.cost * 0.5));
    expect(aura(sim, 'sha_cleansing_tides')).toBeUndefined();

    for (let cast = 2; cast <= 3; cast++) {
      sim.player.resource = sim.player.maxResource;
      finishCast(sim, 'healing_wave');
    }
    expect(aura(sim, 'sha_tideflow')).toMatchObject({
      name: 'Tideflow',
      kind: 'next_cast_instant',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['chain_heal'],
      sourceId: sim.player.id,
      school: 'nature',
    });

    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    const manaBeforeReturn = sim.player.resource;
    sim.castAbility('chain_heal');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(manaBeforeReturn - chain.cost);
    expect(aura(sim, 'sha_tideflow')).toBeUndefined();
    expect(aura(sim, 'sha_cleansing_tides')).toBeDefined();
  });

  it('gates both handoffs to Spiritmend, the signature, and their exact casts', () => {
    for (const spec of ['elemental', 'enhancement'] as const) {
      const sim = spiritmendSim({ spec });
      onCastCompleted(sim.ctx, sim.player, 'chain_heal', sim.player);
      for (let cast = 0; cast < 3; cast++) {
        onCastCompleted(sim.ctx, sim.player, 'healing_wave', sim.player);
      }
      expect(aura(sim, 'sha_cleansing_tides')).toBeUndefined();
      expect(aura(sim, 'sha_tideflow')).toBeUndefined();
    }

    const withoutSignature = spiritmendSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Shaman metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'chain_heal');
    onCastCompleted(
      withoutSignature.ctx,
      withoutSignature.player,
      'chain_heal',
      withoutSignature.player,
    );
    for (let cast = 0; cast < 3; cast++) {
      onCastCompleted(
        withoutSignature.ctx,
        withoutSignature.player,
        'healing_wave',
        withoutSignature.player,
      );
    }
    expect(aura(withoutSignature, 'sha_cleansing_tides')).toBeUndefined();
    expect(aura(withoutSignature, 'sha_tideflow')).toBeUndefined();

    const withoutTideflow = spiritmendSim({ tideflow: false });
    for (let cast = 0; cast < 3; cast++) {
      onCastCompleted(
        withoutTideflow.ctx,
        withoutTideflow.player,
        'healing_wave',
        withoutTideflow.player,
      );
    }
    expect(aura(withoutTideflow, 'sha_tideflow')).toBeUndefined();

    const wrongCast = spiritmendSim();
    onCastCompleted(wrongCast.ctx, wrongCast.player, 'lightning_bolt', wrongCast.player);
    expect(aura(wrongCast, 'sha_cleansing_tides')).toBeUndefined();
    expect(aura(wrongCast, 'sha_tideflow')).toBeUndefined();
  });

  it('clears both Spiritmend handoffs when their spec gate is removed', () => {
    const sim = spiritmendSim();
    onCastCompleted(sim.ctx, sim.player, 'chain_heal', sim.player);
    for (let cast = 0; cast < 3; cast++) {
      onCastCompleted(sim.ctx, sim.player, 'healing_wave', sim.player);
    }
    expect(aura(sim, 'sha_cleansing_tides')).toBeDefined();
    expect(aura(sim, 'sha_tideflow')).toBeDefined();

    expect(sim.applyTalents({ spec: 'elemental', rows: { 17: TIDEFLOW_ID } })).toBe(true);

    expect(aura(sim, 'sha_cleansing_tides')).toBeUndefined();
    expect(aura(sim, 'sha_tideflow')).toBeUndefined();
  });

  it('adds no proc draws and replays both handoffs exactly', () => {
    const run = () => {
      const sim = spiritmendSim({ seed: 178_522 });
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'chain_heal', sim.player);
      for (let cast = 0; cast < 3; cast++) {
        onCastCompleted(sim.ctx, sim.player, 'healing_wave', sim.player);
      }
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        windows: sim.player.auras
          .filter((entry) => entry.id === 'sha_cleansing_tides' || entry.id === 'sha_tideflow')
          .map((entry) => [entry.id, entry.kind, entry.remaining]),
      };
    };

    expect(run()).toEqual({
      draws: [],
      windows: [
        ['sha_cleansing_tides', 'next_cast_cheap', 8],
        ['sha_tideflow', 'next_cast_instant', 8],
      ],
    });
    expect(run()).toEqual(run());
  });

  it('fills both Spiritmend titles in every required non-Latin locale', () => {
    const languages = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;
    for (const language of languages) {
      expect(localizeTalentTitle('Cleansing Tides', language)).not.toBe('Cleansing Tides');
    }
    expect(languages.map((language) => localizeTalentTitle('Tideflow', language))).toEqual([
      '潮汐',
      '潮汐',
      '潮流',
      '조수',
      'Приливный поток',
    ]);
  });
});
