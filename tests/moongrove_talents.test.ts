import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const TYPHOON_ID = 'dru_r8_typhoon';

function druidSim(
  options: { selected?: boolean; spec?: 'balance' | 'feral' | 'restoration'; seed?: number } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 178_111, playerClass: 'druid', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'balance',
      rows: options.selected === false ? {} : { 8: TYPHOON_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_811, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 4,
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

describe('Moongrove talent: Typhoon', () => {
  it('upgrades the stable grant without changing either row peer', () => {
    const row = ROW_TREES.druid.find((candidate) => candidate.level === 8);
    const option = row?.options.find((candidate) => candidate.id === TYPHOON_ID);

    expect(validateTalentTree(TALENTS.druid)).toEqual([]);
    expect(validateRowTree(ROW_TREES.druid)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      [TYPHOON_ID, 'Typhoon'],
      ['dru_r8_improved_roots', 'Briar Ambush'],
      ['dru_r8_brutal_bash', 'Brutal Bash'],
    ]);
    expect(option?.effect).toEqual({
      grant: { ability: 'typhoon' },
      proc: {
        id: 'dru_typhoon_relay',
        name: 'Typhoon',
        spec: 'balance',
        requiresKnownAbility: 'typhoon',
        school: 'nature',
        trigger: { on: 'castNth', n: 1, abilities: ['typhoon'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['hurricane'],
            duration: 8,
          },
        ],
      },
    });
  });

  it('plays Typhoon into one free Galeheart channel', () => {
    const sim = druidSim();
    const target = targetFor(sim);
    const distanceBefore = Math.hypot(
      target.pos.x - sim.player.pos.x,
      target.pos.z - sim.player.pos.z,
    );

    sim.castAbility('typhoon');

    expect(
      Math.hypot(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z),
    ).toBeGreaterThan(distanceBefore);
    expect(sim.player.auras.find((aura) => aura.id === 'dru_typhoon_relay')).toMatchObject({
      name: 'Typhoon',
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['hurricane'],
    });

    sim.player.gcdRemaining = 0;
    sim.player.resource = 0;
    sim.castAbility('hurricane');

    expect(sim.player.channeling).toBe(true);
    expect(sim.player.resource).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'dru_typhoon_relay')).toBe(false);
  });

  it('requires the selected option, Moongrove, and known Typhoon', () => {
    const unselected = druidSim({ selected: false });
    onCastCompleted(unselected.ctx, unselected.player, 'typhoon');
    expect(unselected.player.auras.some((aura) => aura.id === 'dru_typhoon_relay')).toBe(false);

    for (const spec of ['feral', 'restoration'] as const) {
      const sim = druidSim({ spec });
      expect(sim.resolvedAbility('typhoon')).not.toBeNull();
      onCastCompleted(sim.ctx, sim.player, 'typhoon');
      expect(sim.player.auras.some((aura) => aura.id === 'dru_typhoon_relay')).toBe(false);
    }

    const withoutKnownGrant = druidSim();
    const meta = withoutKnownGrant.meta(withoutKnownGrant.playerId);
    if (!meta) throw new Error('missing Druid metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'typhoon');
    onCastCompleted(withoutKnownGrant.ctx, withoutKnownGrant.player, 'typhoon');
    expect(withoutKnownGrant.player.auras.some((aura) => aura.id === 'dru_typhoon_relay')).toBe(
      false,
    );
  });

  it('adds no proc draws and replays the free-channel window exactly', () => {
    const run = () => {
      const sim = druidSim({ seed: 178_112 });
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'typhoon');
      sim.ctx.rng.setObserver(null);
      const aura = sim.player.auras.find((candidate) => candidate.id === 'dru_typhoon_relay');
      return { draws, duration: aura?.remaining ?? 0 };
    };

    expect(run()).toEqual({ draws: [], duration: 8 });
    expect(run()).toEqual(run());
  });

  it('localizes Typhoon in every required non-Latin locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Typhoon', language)).not.toBe('Typhoon');
    }
  });
});
