import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const RED_HAZE_ID = 'dru_r20_berserk';
const FORM_ATTACKS = ['maul', 'swipe', 'claw', 'rake', 'ferocious_bite', 'rip'] as const;

function druidSim(
  options: { selected?: boolean; spec?: 'balance' | 'feral' | 'restoration'; seed?: number } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 178_211, playerClass: 'druid', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'feral',
      rows: options.selected === false ? {} : { 20: RED_HAZE_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetFor(sim: Sim): Entity {
  const target = createMob(97_831, MOBS.forest_wolf, 20, {
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
  sim.player.facing = 0;
  return target;
}

function enterBear(sim: Sim): void {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('bear_form');
  sim.player.gcdRemaining = 0;
}

describe('Wildfang talent: Red Haze', () => {
  it('upgrades the stable grant without changing either capstone peer', () => {
    const row = ROW_TREES.druid.find((candidate) => candidate.level === 20);
    const option = row?.options.find((candidate) => candidate.id === RED_HAZE_ID);

    expect(validateTalentTree(TALENTS.druid)).toEqual([]);
    expect(validateRowTree(ROW_TREES.druid)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      ['dru_r20_improved_hurricane', 'Storm Refrain'],
      [RED_HAZE_ID, 'Red Haze'],
      ['dru_r20_tranquility', 'Gladesong'],
    ]);
    expect(option?.effect).toEqual({
      grant: { ability: 'berserk' },
      proc: {
        id: 'dru_red_haze_relay',
        name: 'Red Haze',
        spec: 'feral',
        requiresKnownAbility: 'berserk',
        school: 'physical',
        trigger: { on: 'castNth', n: 1, abilities: ['berserk'] },
        responses: [
          { kind: 'cooldownRefund', ability: 'feral_charge', seconds: 'reset' },
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: [...FORM_ATTACKS],
            duration: 8,
          },
        ],
      },
    });
  });

  it('plays Red Haze into a free Bonecrush and a fresh Primal Surge guard', () => {
    const sim = druidSim();
    const target = targetFor(sim);
    enterBear(sim);
    sim.player.cooldowns.set('feral_charge', 60);

    sim.castAbility('berserk');

    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'berserk', kind: 'buff_ap', value: 81 }),
    );
    expect(sim.player.cooldowns.has('feral_charge')).toBe(false);
    expect(sim.player.auras.find((aura) => aura.id === 'dru_red_haze_relay')).toMatchObject({
      kind: 'next_cast_free',
      remaining: 8,
      empowerAbilities: [...FORM_ATTACKS],
    });

    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    sim.castAbility('maul');
    expect(sim.player.queuedOnSwing).toBe('maul');
    expect(sim.player.queuedOnSwingFree).toBe(true);
    const rng = sim.ctx.rng as typeof sim.ctx.rng & { next(): number };
    rng.next = () => 0.99;
    sim.player.swingTimer = 0;
    for (let tick = 0; tick < 20 && sim.player.queuedOnSwing; tick++) sim.tick();

    expect(sim.player.queuedOnSwing).toBeNull();
    expect(sim.player.resource).toBeLessThan(15);
    expect(target.auras.some((aura) => aura.id === 'dru_primal_heart_bleed')).toBe(true);

    sim.player.resource = 0;
    sim.castAbility('feral_charge');
    expect(sim.player.resource).toBe(50);
    expect(target.auras.some((aura) => aura.id === 'dru_primal_heart_bleed')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === 'dru_primal_heart_guard')).toBe(true);
  });

  it('requires the selected option, Wildfang, and known Red Haze', () => {
    const unselected = druidSim({ selected: false });
    unselected.player.cooldowns.set('feral_charge', 60);
    onCastCompleted(unselected.ctx, unselected.player, 'berserk');
    expect(unselected.player.cooldowns.get('feral_charge')).toBe(60);
    expect(unselected.player.auras.some((aura) => aura.id === 'dru_red_haze_relay')).toBe(false);

    for (const spec of ['balance', 'restoration'] as const) {
      const sim = druidSim({ spec });
      expect(sim.resolvedAbility('berserk')).not.toBeNull();
      sim.player.cooldowns.set('feral_charge', 60);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('berserk');
      expect(sim.player.auras).toContainEqual(
        expect.objectContaining({ id: 'berserk', kind: 'buff_ap', value: 70 }),
      );
      expect(sim.player.cooldowns.get('feral_charge')).toBe(60);
      expect(sim.player.auras.some((aura) => aura.id === 'dru_red_haze_relay')).toBe(false);
    }

    const withoutKnownGrant = druidSim();
    const meta = withoutKnownGrant.meta(withoutKnownGrant.playerId);
    if (!meta) throw new Error('missing Druid metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'berserk');
    withoutKnownGrant.player.cooldowns.set('feral_charge', 60);
    onCastCompleted(withoutKnownGrant.ctx, withoutKnownGrant.player, 'berserk');
    expect(withoutKnownGrant.player.cooldowns.get('feral_charge')).toBe(60);
    expect(withoutKnownGrant.player.auras.some((aura) => aura.id === 'dru_red_haze_relay')).toBe(
      false,
    );
  });

  it('adds no proc draws and replays the reset and free-attack window exactly', () => {
    const run = () => {
      const sim = druidSim({ seed: 178_212 });
      sim.player.cooldowns.set('feral_charge', 60);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onCastCompleted(sim.ctx, sim.player, 'berserk');
      sim.ctx.rng.setObserver(null);
      const aura = sim.player.auras.find((candidate) => candidate.id === 'dru_red_haze_relay');
      return {
        draws,
        cooldown: sim.player.cooldowns.get('feral_charge') ?? 0,
        duration: aura?.remaining ?? 0,
      };
    };

    expect(run()).toEqual({ draws: [], cooldown: 0, duration: 8 });
    expect(run()).toEqual(run());
  });

  it('localizes Red Haze in every required non-Latin locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Red Haze', language)).not.toBe('Red Haze');
    }
  });
});
