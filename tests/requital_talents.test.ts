import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const OATHS_DUE_OPTION_ID = 'pal_r14_swift_verdicts';

function paladinSim(
  options: { spec?: 'holy' | 'protection' | 'retribution'; selectOathsDue?: boolean } = {},
): Sim {
  const sim = new Sim({ seed: 170729, playerClass: 'paladin', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'retribution',
      rows: options.selectOathsDue === false ? {} : { 14: OATHS_DUE_OPTION_ID },
    }),
  ).toBe(true);
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_003, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 3,
  });
  target.hostile = true;
  target.stats = { ...target.stats, armor: 0 };
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  return target;
}

function setMeleeRoll(sim: Sim, roll: number): void {
  const rng = sim.ctx.rng as typeof sim.ctx.rng & {
    next(): number;
    range(min: number, max: number): number;
    chance(probability: number): boolean;
  };
  rng.next = () => roll;
  rng.range = (min) => min;
  rng.chance = () => false;
}

function crusaderStrike(sim: Sim, target: Entity): number {
  const meta = sim.meta(sim.playerId);
  const strike = sim.resolvedAbility('crusader_strike');
  if (!meta || !strike) throw new Error('missing Requital strike data');
  const before = target.hp;
  sim.ctx.runEffects(sim.player, meta, target, strike);
  return before - target.hp;
}

describe("Requital Oath's Due", () => {
  it('keeps the shared row valid and replaces Swift Verdicts without changing its stable id', () => {
    const row = ROW_TREES.paladin.find((candidate) => candidate.level === 14);
    const oathsDue = row?.options.find((option) => option.id === OATHS_DUE_OPTION_ID);

    expect(validateTalentTree(TALENTS.paladin)).toEqual([]);
    expect(validateRowTree(ROW_TREES.paladin)).toEqual([]);
    expect(row?.options.map((option) => option.name)).toEqual([
      "Oath's Due",
      "Saint's Ire",
      'Oathwheel',
    ]);
    expect(oathsDue?.effect.ability).toBeUndefined();
    expect(oathsDue?.effect.proc).toEqual({
      id: 'pal_oaths_due',
      name: "Oath's Due",
      school: 'holy',
      spec: 'retribution',
      trigger: { on: 'castNth', n: 1, abilities: ['judgement'] },
      responses: [
        {
          kind: 'empowerNext',
          aura: 'next_ability_damage',
          abilities: ['crusader_strike'],
          duration: 7,
          dmgPct: 0.5,
        },
      ],
    });
    expect(row?.options.find((option) => option.name === 'Oathwheel')?.effect.proc).toMatchObject({
      trigger: { on: 'meleeSwingWhile', auraKind: 'imbue' },
      responses: [{ kind: 'cooldownRefund', ability: 'judgement', seconds: 0.5 }],
    });
  });

  it('opens the seven-second setup window without drawing RNG only for the selected Requital row', () => {
    const cases: Array<[Sim, string, boolean]> = [
      [paladinSim(), 'judgement', true],
      [paladinSim(), 'exorcism', false],
      [paladinSim({ selectOathsDue: false }), 'judgement', false],
      [paladinSim({ spec: 'holy' }), 'judgement', false],
      [paladinSim({ spec: 'protection' }), 'judgement', false],
    ];
    for (const [sim, abilityId, expected] of cases) {
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      onCastCompleted(sim.ctx, sim.player, abilityId);
      sim.ctx.rng.setObserver(null);

      expect(draws).toBe(0);
      expect(sim.player.auras.some((aura) => aura.id === 'pal_oaths_due')).toBe(expected);
    }
  });

  it('makes the next landed Crusader Strike significantly stronger and consumes the window', () => {
    const sim = paladinSim();
    const target = targetFor(sim);
    setMeleeRoll(sim, 0.9);

    const baseline = crusaderStrike(sim, target);
    target.hp = target.maxHp;
    onCastCompleted(sim.ctx, sim.player, 'judgement');
    const window = sim.player.auras.find((aura) => aura.id === 'pal_oaths_due');
    expect(window).toMatchObject({
      kind: 'next_ability_damage',
      remaining: 7,
      value: 0.5,
      empowerAbilities: ['crusader_strike'],
    });

    const empowered = crusaderStrike(sim, target);

    expect(empowered).toBeGreaterThan(baseline * 1.4);
    expect(empowered).toBeLessThan(baseline * 1.6);
    expect(sim.player.auras.some((aura) => aura.id === 'pal_oaths_due')).toBe(false);
  });

  it('keeps the setup window through a missed Crusader Strike and spends it on the next hit', () => {
    const sim = paladinSim();
    const target = targetFor(sim);
    onCastCompleted(sim.ctx, sim.player, 'judgement');

    setMeleeRoll(sim, 0);
    expect(crusaderStrike(sim, target)).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'pal_oaths_due')).toBe(true);

    setMeleeRoll(sim, 0.9);
    expect(crusaderStrike(sim, target)).toBeGreaterThan(0);
    expect(sim.player.auras.some((aura) => aura.id === 'pal_oaths_due')).toBe(false);
  });

  it('clears the spec-owned setup window when Requital is left', () => {
    const sim = paladinSim();
    onCastCompleted(sim.ctx, sim.player, 'judgement');
    expect(sim.player.auras.some((aura) => aura.id === 'pal_oaths_due')).toBe(true);

    expect(sim.applyTalents({ spec: 'holy', rows: { 14: OATHS_DUE_OPTION_ID } })).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id === 'pal_oaths_due')).toBe(false);
  });

  it("localizes Oath's Due in every non-Latin release locale", () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle("Oath's Due", language)).not.toBe("Oath's Due");
    }
  });
});
