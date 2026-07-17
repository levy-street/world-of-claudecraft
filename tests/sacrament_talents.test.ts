import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeTalentTitle, tTalent } from '../src/ui/talent_i18n';

const DAWNS_REPLY_ID = 'pal_r5_crusaders_zeal';

function sacramentSim(
  options: { selected?: boolean; spec?: 'holy' | 'protection' | 'retribution'; seed?: number } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 178_411, playerClass: 'paladin', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'holy',
      rows: options.selected === false ? {} : { 5: DAWNS_REPLY_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  sim.player.spellPower = 0;
  sim.player.hp = Math.max(1, sim.player.maxHp - 500);
  sim.targetEntity(sim.player.id);
  return sim;
}

function dawnsReply(sim: Sim) {
  return sim.player.auras.find((aura) => aura.id === 'pal_dawns_reply');
}

function kindleHolyShock(sim: Sim): void {
  onCastCompleted(sim.ctx, sim.player, 'holy_light', sim.player);
  onCastCompleted(sim.ctx, sim.player, 'flash_of_light', sim.player);
  onCastCompleted(sim.ctx, sim.player, 'holy_light', sim.player);
}

function finishCast(sim: Sim): void {
  for (let tick = 0; tick < 200 && sim.player.castingAbility; tick++) sim.tick();
  expect(sim.player.castingAbility).toBeNull();
}

describe("Sacrament talent: Dawn's Reply", () => {
  it('replaces the flat Verdict mana return without changing either row peer', () => {
    const row = ROW_TREES.paladin.find((candidate) => candidate.level === 5);
    const option = row?.options.find((candidate) => candidate.id === DAWNS_REPLY_ID);

    expect(validateTalentTree(TALENTS.paladin)).toEqual([]);
    expect(validateRowTree(ROW_TREES.paladin)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      [DAWNS_REPLY_ID, "Dawn's Reply"],
      ['pal_r5_blessed_momentum', "Pilgrim's Light"],
      ['pal_r5_vengeful_exorcism', 'Ashen Sentence'],
    ]);
    expect(option?.effect).toEqual({
      proc: {
        id: 'pal_dawns_reply',
        name: "Dawn's Reply",
        spec: 'holy',
        requiresKnownAbility: 'holy_shock',
        school: 'holy',
        trigger: { on: 'castNth', n: 1, abilities: ['holy_shock'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_cheap',
            abilities: ['flash_of_light'],
            duration: 8,
            costPct: 0.5,
          },
        ],
      },
    });
  });

  it('plays a free Holy Shock into one half-mana Lightmend', () => {
    const sim = sacramentSim();
    kindleHolyShock(sim);
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;

    sim.castAbility('holy_shock');

    expect(dawnsReply(sim)).toMatchObject({
      name: "Dawn's Reply",
      kind: 'next_cast_cheap',
      remaining: 8,
      duration: 8,
      value: 0.5,
      empowerAbilities: ['flash_of_light'],
      sourceId: sim.player.id,
      school: 'holy',
    });

    const lightmend = sim.resolvedAbility('flash_of_light');
    if (!lightmend) throw new Error('missing Lightmend');
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    const manaBefore = sim.player.resource;
    sim.castAbility('flash_of_light');
    finishCast(sim);

    expect(sim.player.resource).toBe(manaBefore - Math.ceil(lightmend.cost * 0.5));
    expect(dawnsReply(sim)).toBeUndefined();
  });

  it('requires the selected row, Sacrament, a known Holy Shock, and the exact cast', () => {
    const unselected = sacramentSim({ selected: false });
    onCastCompleted(unselected.ctx, unselected.player, 'holy_shock', unselected.player);
    expect(dawnsReply(unselected)).toBeUndefined();

    for (const spec of ['protection', 'retribution'] as const) {
      const sim = sacramentSim({ spec });
      onCastCompleted(sim.ctx, sim.player, 'holy_shock', sim.player);
      expect(dawnsReply(sim)).toBeUndefined();
    }

    const withoutSignature = sacramentSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Paladin metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'holy_shock');
    onCastCompleted(withoutSignature.ctx, withoutSignature.player, 'holy_shock');
    expect(dawnsReply(withoutSignature)).toBeUndefined();

    const wrongCast = sacramentSim();
    onCastCompleted(wrongCast.ctx, wrongCast.player, 'holy_light', wrongCast.player);
    expect(dawnsReply(wrongCast)).toBeUndefined();
  });

  it('clears its discount if the stable row choice is removed', () => {
    const sim = sacramentSim();
    onCastCompleted(sim.ctx, sim.player, 'holy_shock', sim.player);
    expect(dawnsReply(sim)).toBeDefined();

    expect(sim.applyTalents({ spec: 'holy', rows: {} })).toBe(true);

    expect(dawnsReply(sim)).toBeUndefined();
  });

  it('adds no proc draws and replays the short healing window exactly', () => {
    const run = () => {
      const sim = sacramentSim({ seed: 178_412 });
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'holy_shock', sim.player);
      sim.ctx.rng.setObserver(null);
      const window = dawnsReply(sim);
      return {
        draws,
        window: window ? [window.kind, window.remaining, window.value] : null,
      };
    };

    expect(run()).toEqual({ draws: [], window: ['next_cast_cheap', 8, 0.5] });
    expect(run()).toEqual(run());
  });

  it("fills Dawn's Reply in English and every required non-Latin locale", () => {
    expect(localizeTalentTitle("Dawn's Reply", 'en')).toBe("Dawn's Reply");
    expect(
      (['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const).map((language) =>
        localizeTalentTitle("Dawn's Reply", language),
      ),
    ).toEqual(['黎明回应', '黎明回應', '暁の応え', '새벽의 응답', 'Ответ рассвета']);
  });

  it("renders Dawn's Reply copy in every required non-Latin locale", async () => {
    const choice = ROW_TREES.paladin
      .flatMap((row) => row.options)
      .find((option) => option.id === DAWNS_REPLY_ID);
    if (!choice) throw new Error("missing Dawn's Reply choice");
    try {
      for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
        await ensureLocaleLoaded(language);
        setLanguage(language);
        const description = tTalent({ kind: 'talentChoice', choice, field: 'description' });
        expect(description).not.toBe(choice.description);
        expect(description).toMatch(/50\s*%/);
        expect(description).toContain('8');
      }
    } finally {
      setLanguage('en');
    }
  });
});
