import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const GROVE_COVENANT_ID = 'dru_r11_improved_mark';

function druidSim(
  options: { selected?: boolean; spec?: 'balance' | 'feral' | 'restoration'; seed?: number } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 178_131, playerClass: 'druid', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'restoration',
      rows: options.selected === false ? {} : { 11: GROVE_COVENANT_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.hp = Math.max(1, sim.player.maxHp - 500);
  sim.targetEntity(sim.player.id);
  return sim;
}

function covenant(sim: Sim) {
  return sim.player.auras.find((aura) => aura.id === 'dru_grove_covenant');
}

function finishCast(sim: Sim): void {
  for (let tick = 0; tick < 200 && sim.player.castingAbility; tick++) sim.tick();
  expect(sim.player.castingAbility).toBeNull();
}

describe('Groveheart talent: Grove Covenant', () => {
  it('replaces the flat cadence ward without changing either row peer', () => {
    const row = ROW_TREES.druid.find((candidate) => candidate.level === 11);
    const option = row?.options.find((candidate) => candidate.id === GROVE_COVENANT_ID);

    expect(validateTalentTree(TALENTS.druid)).toEqual([]);
    expect(validateRowTree(ROW_TREES.druid)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      ['dru_r11_innervate', 'Lifesap'],
      ['dru_r11_furor', 'Formrush'],
      [GROVE_COVENANT_ID, 'Grove Covenant'],
    ]);
    expect(row?.options[0].effect).toEqual({ grant: { ability: 'innervate' } });
    expect(row?.options[1].effect).toEqual({
      proc: {
        id: 'dru_wildsurge',
        name: 'Formrush',
        trigger: {
          on: 'castNth',
          n: 1,
          abilities: ['bear_form', 'cat_form', 'travel_form'],
        },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_cheap',
            abilities: ['maul', 'swipe', 'claw', 'rake', 'ferocious_bite', 'rip'],
            duration: 8,
            costPct: 0.5,
          },
        ],
      },
    });
    expect(option?.effect).toEqual({
      proc: {
        id: 'dru_grove_covenant',
        name: 'Grove Covenant',
        requiresKnownAbility: 'rejuvenation',
        school: 'nature',
        trigger: { on: 'castNth', n: 1, abilities: ['healing_touch', 'regrowth'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_cheap',
            abilities: ['rejuvenation'],
            duration: 8,
            costPct: 0.5,
          },
        ],
      },
    });
  });

  it('plays a completed Wildmend into one half-mana Wildbloom', () => {
    const sim = druidSim();
    sim.castAbility('healing_touch');
    finishCast(sim);

    expect(covenant(sim)).toMatchObject({
      name: 'Grove Covenant',
      kind: 'next_cast_cheap',
      duration: 8,
      value: 0.5,
      empowerAbilities: ['rejuvenation'],
      sourceId: sim.player.id,
      school: 'nature',
    });
    expect(covenant(sim)?.remaining).toBeCloseTo(7.95);

    const wildbloom = sim.resolvedAbility('rejuvenation');
    if (!wildbloom) throw new Error('missing Wildbloom');
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    const manaBefore = sim.player.resource;
    sim.castAbility('rejuvenation');

    expect(sim.player.resource).toBe(manaBefore - Math.ceil(wildbloom.cost * 0.5));
    expect(covenant(sim)).toBeUndefined();
  });

  it('also accepts a completed Second Bloom and refreshes, rather than stacks, the window', () => {
    const sim = druidSim();
    onCastCompleted(sim.ctx, sim.player, 'healing_touch', sim.player);
    const first = covenant(sim);
    if (!first) throw new Error('missing first Grove Covenant window');
    first.remaining = 2;

    onCastCompleted(sim.ctx, sim.player, 'regrowth', sim.player);

    expect(sim.player.auras.filter((aura) => aura.id === 'dru_grove_covenant')).toHaveLength(1);
    expect(covenant(sim)?.remaining).toBe(8);
  });

  it('requires the selected option, known Wildbloom, and an exact completed direct heal', () => {
    const unselected = druidSim({ selected: false });
    onCastCompleted(unselected.ctx, unselected.player, 'healing_touch', unselected.player);
    expect(covenant(unselected)).toBeUndefined();

    const withoutWildbloom = druidSim();
    const meta = withoutWildbloom.meta(withoutWildbloom.playerId);
    if (!meta) throw new Error('missing Druid metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'rejuvenation');
    onCastCompleted(
      withoutWildbloom.ctx,
      withoutWildbloom.player,
      'healing_touch',
      withoutWildbloom.player,
    );
    expect(covenant(withoutWildbloom)).toBeUndefined();

    const wrongCast = druidSim();
    onCastCompleted(wrongCast.ctx, wrongCast.player, 'rejuvenation', wrongCast.player);
    expect(covenant(wrongCast)).toBeUndefined();
  });

  it('keeps the shared row useful to every Druid spec', () => {
    for (const spec of ['balance', 'feral', 'restoration'] as const) {
      const sim = druidSim({ spec });
      onCastCompleted(sim.ctx, sim.player, 'regrowth', sim.player);
      expect(covenant(sim), spec).toMatchObject({
        kind: 'next_cast_cheap',
        empowerAbilities: ['rejuvenation'],
      });
    }
  });

  it('clears its discount when the row choice is removed', () => {
    const sim = druidSim();
    onCastCompleted(sim.ctx, sim.player, 'healing_touch', sim.player);
    expect(covenant(sim)).toBeDefined();

    expect(sim.applyTalents({ spec: 'restoration', rows: {} })).toBe(true);

    expect(covenant(sim)).toBeUndefined();
  });

  it('adds no proc draws and replays the discount exactly', () => {
    const run = () => {
      const sim = druidSim({ seed: 178_132 });
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'regrowth', sim.player);
      sim.ctx.rng.setObserver(null);
      const discount = covenant(sim);
      return {
        draws,
        window: discount ? [discount.kind, discount.remaining, discount.value] : null,
      };
    };

    expect(run()).toEqual({ draws: [], window: ['next_cast_cheap', 8, 0.5] });
    expect(run()).toEqual(run());
  });

  it('fills Grove Covenant in English and every required non-Latin locale', () => {
    expect(localizeTalentTitle('Grove Covenant', 'en')).toBe('Grove Covenant');
    expect(
      (['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const).map((language) =>
        localizeTalentTitle('Grove Covenant', language),
      ),
    ).toEqual(['林地盟约', '林地盟約', '木立の盟約', '수풀의 맹약', 'Завет рощи']);
  });
});
