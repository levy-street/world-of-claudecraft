import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { onHotExpired } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function druidSim(spec: 'balance' | 'feral' | 'restoration' = 'restoration', seed = 178_121): Sim {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.hp = Math.max(1, sim.player.maxHp - 500);
  sim.targetEntity(sim.player.id);
  return sim;
}

function aura(sim: Sim, id: string) {
  return sim.player.auras.find((candidate) => candidate.id === id);
}

function finishWildbloom(sim: Sim): void {
  for (let tick = 0; tick < 260 && aura(sim, 'rejuvenation'); tick++) {
    updateAuras(sim.ctx, sim.player);
  }
}

describe("Groveheart Grove's Gift", () => {
  it('authors a valid, explicitly gated HoT-to-direct-heal weave', () => {
    const restoration = TALENTS.druid.specs.find((spec) => spec.id === 'restoration');

    expect(validateTalentTree(TALENTS.druid)).toEqual([]);
    expect(restoration?.signature).toBe('swiftmend');
    expect(restoration?.mastery.name).toBe("Grove's Gift");
    expect(restoration?.mastery.description).toContain('Wildbloom');
    expect(restoration?.mastery.description).toContain('instant Second Bloom');
    expect(restoration?.mastery.effect).toEqual({
      global: { hotHealPct: 0.25 },
      procs: [
        {
          id: 'dru_groves_gift',
          name: "Grove's Gift",
          spec: 'restoration',
          requiresKnownAbility: 'regrowth',
          school: 'nature',
          trigger: { on: 'hotExpired', ability: 'rejuvenation' },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_cast_instant',
              abilities: ['regrowth'],
              duration: 8,
            },
          ],
        },
      ],
    });
    expect(druidSim().player.resourceType).toBe('mana');
  });

  it('opens one instant Second Bloom when Wildbloom completes naturally', () => {
    const sim = druidSim();
    sim.castAbility('rejuvenation');
    expect(aura(sim, 'rejuvenation')).toBeDefined();

    finishWildbloom(sim);

    expect(aura(sim, 'rejuvenation')).toBeUndefined();
    expect(aura(sim, 'dru_groves_gift')).toMatchObject({
      name: "Grove's Gift",
      kind: 'next_cast_instant',
      remaining: 8,
      duration: 8,
      value: 0,
      empowerAbilities: ['regrowth'],
      sourceId: sim.player.id,
      school: 'nature',
    });

    const secondBloom = sim.resolvedAbility('regrowth');
    if (!secondBloom) throw new Error('missing Second Bloom');
    const manaBefore = sim.player.resource;
    sim.player.gcdRemaining = 0;
    sim.castAbility('regrowth');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(manaBefore - secondBloom.cost);
    expect(aura(sim, 'dru_groves_gift')).toBeUndefined();
  });

  it('does not reward consuming Wildbloom early with Swiftmend', () => {
    const sim = druidSim();
    sim.castAbility('rejuvenation');
    expect(aura(sim, 'rejuvenation')).toBeDefined();
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('swiftmend');

    expect(aura(sim, 'rejuvenation')).toBeUndefined();
    expect(aura(sim, 'dru_groves_gift')).toBeUndefined();
  });

  it('refreshes Wildbloom without granting the window before the new expiry', () => {
    const sim = druidSim();
    sim.castAbility('rejuvenation');
    for (let tick = 0; tick < 120; tick++) updateAuras(sim.ctx, sim.player);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('rejuvenation');
    for (let tick = 0; tick < 120; tick++) updateAuras(sim.ctx, sim.player);

    expect(aura(sim, 'rejuvenation')).toBeDefined();
    expect(aura(sim, 'dru_groves_gift')).toBeUndefined();
    finishWildbloom(sim);
    expect(aura(sim, 'dru_groves_gift')).toBeDefined();
  });

  it('requires Groveheart, known Second Bloom, and the exact completed HoT', () => {
    for (const sim of [druidSim('balance'), druidSim('feral')]) {
      onHotExpired(sim.ctx, sim.player, 'rejuvenation', sim.player);
      expect(aura(sim, 'dru_groves_gift')).toBeUndefined();
    }

    const withoutPayoff = druidSim();
    const meta = withoutPayoff.meta(withoutPayoff.playerId);
    if (!meta) throw new Error('missing Druid metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'regrowth');
    onHotExpired(withoutPayoff.ctx, withoutPayoff.player, 'rejuvenation', withoutPayoff.player);
    expect(aura(withoutPayoff, 'dru_groves_gift')).toBeUndefined();

    const wrongHot = druidSim();
    onHotExpired(wrongHot.ctx, wrongHot.player, 'regrowth', wrongHot.player);
    expect(aura(wrongHot, 'dru_groves_gift')).toBeUndefined();
  });

  it('clears the healing window when Groveheart is left', () => {
    const sim = druidSim();
    onHotExpired(sim.ctx, sim.player, 'rejuvenation', sim.player);
    expect(aura(sim, 'dru_groves_gift')).toBeDefined();

    expect(sim.applyTalents({ spec: 'balance', rows: {} })).toBe(true);

    expect(aura(sim, 'dru_groves_gift')).toBeUndefined();
  });

  it('adds no proc draws and replays the healing window exactly', () => {
    const run = () => {
      const sim = druidSim('restoration', 178_122);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onHotExpired(sim.ctx, sim.player, 'rejuvenation', sim.player);
      sim.ctx.rng.setObserver(null);
      const gift = aura(sim, 'dru_groves_gift');
      return { draws, window: gift ? [gift.kind, gift.remaining] : null };
    };

    expect(run()).toEqual({ draws: [], window: ['next_cast_instant', 8] });
    expect(run()).toEqual(run());
  });

  it("localizes Grove's Gift in every required non-Latin locale", () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle("Grove's Gift", language)).not.toBe("Grove's Gift");
    }
  });
});
