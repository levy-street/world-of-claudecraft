import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeTalentTitle, tTalent } from '../src/ui/talent_i18n';

const VIGILS_REFRAIN_ID = 'pal_r11_guardians_favor';

function vigilSim(
  options: { selected?: boolean; spec?: 'holy' | 'protection' | 'retribution'; seed?: number } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 178_431, playerClass: 'paladin', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'protection',
      rows: options.selected === false ? {} : { 11: VIGILS_REFRAIN_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  sim.player.spellPower = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_851, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 3,
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

function vigilsRefrain(sim: Sim) {
  return sim.player.auras.find((aura) => aura.id === 'pal_vigils_refrain');
}

describe("Vigil talent: Vigil's Refrain", () => {
  it('replaces the shield-consumed cooldown refund without changing either row peer', () => {
    const row = ROW_TREES.paladin.find((candidate) => candidate.level === 11);
    const option = row?.options.find((candidate) => candidate.id === VIGILS_REFRAIN_ID);

    expect(validateTalentTree(TALENTS.paladin)).toEqual([]);
    expect(validateRowTree(ROW_TREES.paladin)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      ['pal_r11_divine_wisdom', 'Third Benediction'],
      [VIGILS_REFRAIN_ID, "Vigil's Refrain"],
      ['pal_r11_greater_blessing', 'Afterglow Aegis'],
    ]);
    expect(option?.effect).toEqual({
      proc: {
        id: 'pal_vigils_refrain',
        name: "Vigil's Refrain",
        spec: 'protection',
        requiresKnownAbility: 'holy_shield',
        school: 'holy',
        trigger: { on: 'castNth', n: 1, abilities: ['holy_shield'] },
        responses: [
          { kind: 'cooldownRefund', ability: 'holy_taunt', seconds: 'reset' },
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['judgement'],
            duration: 8,
          },
        ],
      },
    });
  });

  it('plays Hallowed Wall into a fresh Sacred Goad and one free Verdict', () => {
    const sim = vigilSim();
    targetFor(sim);
    sim.player.cooldowns.set('holy_taunt', 10);

    sim.castAbility('holy_shield');

    expect(sim.player.cooldowns.has('holy_taunt')).toBe(false);
    expect(vigilsRefrain(sim)).toMatchObject({
      name: "Vigil's Refrain",
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['judgement'],
      sourceId: sim.player.id,
      school: 'holy',
    });

    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('seal_of_righteousness');
    sim.player.gcdRemaining = 0;
    sim.player.resource = 0;
    sim.castAbility('judgement');

    expect(sim.player.resource).toBe(0);
    expect(sim.player.cooldowns.get('judgement')).toBe(10);
    expect(vigilsRefrain(sim)).toBeUndefined();
  });

  it('requires the selected row, Vigil, a known Hallowed Wall, and the exact cast', () => {
    const unselected = vigilSim({ selected: false });
    onCastCompleted(unselected.ctx, unselected.player, 'holy_shield', unselected.player);
    expect(vigilsRefrain(unselected)).toBeUndefined();

    for (const spec of ['holy', 'retribution'] as const) {
      const sim = vigilSim({ spec });
      onCastCompleted(sim.ctx, sim.player, 'holy_shield', sim.player);
      expect(vigilsRefrain(sim)).toBeUndefined();
    }

    const withoutSignature = vigilSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Paladin metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'holy_shield');
    onCastCompleted(withoutSignature.ctx, withoutSignature.player, 'holy_shield');
    expect(vigilsRefrain(withoutSignature)).toBeUndefined();

    const wrongCast = vigilSim();
    onCastCompleted(wrongCast.ctx, wrongCast.player, 'judgement', wrongCast.player);
    expect(vigilsRefrain(wrongCast)).toBeUndefined();
  });

  it('clears its free Verdict window if the stable row choice is removed', () => {
    const sim = vigilSim();
    onCastCompleted(sim.ctx, sim.player, 'holy_shield', sim.player);
    expect(vigilsRefrain(sim)).toBeDefined();

    expect(sim.applyTalents({ spec: 'protection', rows: {} })).toBe(true);

    expect(vigilsRefrain(sim)).toBeUndefined();
  });

  it('adds no proc draws and replays the threat handoff exactly', () => {
    const run = () => {
      const sim = vigilSim({ seed: 178_432 });
      sim.player.cooldowns.set('holy_taunt', 10);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'holy_shield', sim.player);
      sim.ctx.rng.setObserver(null);
      const window = vigilsRefrain(sim);
      return {
        draws,
        tauntCooldown: sim.player.cooldowns.get('holy_taunt') ?? 0,
        window: window ? [window.kind, window.remaining] : null,
      };
    };

    expect(run()).toEqual({ draws: [], tauntCooldown: 0, window: ['next_cast_free', 8] });
    expect(run()).toEqual(run());
  });

  it("fills Vigil's Refrain in English and every required non-Latin locale", () => {
    expect(localizeTalentTitle("Vigil's Refrain", 'en')).toBe("Vigil's Refrain");
    expect(
      (['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const).map((language) =>
        localizeTalentTitle("Vigil's Refrain", language),
      ),
    ).toEqual(['守望复唱', '守望複唱', '見張りの反唱', '경계의 후렴', 'Припев дозора']);
  });

  it("renders Vigil's Refrain copy in every required non-Latin locale", async () => {
    const choice = ROW_TREES.paladin
      .flatMap((row) => row.options)
      .find((option) => option.id === VIGILS_REFRAIN_ID);
    if (!choice) throw new Error("missing Vigil's Refrain choice");
    try {
      for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
        await ensureLocaleLoaded(language);
        setLanguage(language);
        const description = tTalent({ kind: 'talentChoice', choice, field: 'description' });
        expect(description).not.toBe(choice.description);
        expect(description).toContain('8');
      }
    } finally {
      setLanguage('en');
    }
  });
});
