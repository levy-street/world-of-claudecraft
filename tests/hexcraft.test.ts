import { describe, expect, it } from 'vitest';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const DOT_IDS = ['corruption', 'curse_of_agony', 'siphon_life'] as const;

function warlockSim(spec: 'affliction' | 'demonology' | 'destruction', seed = 170_741): Sim {
  const sim = new Sim({ seed, playerClass: 'warlock', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_401): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 10,
  });
  target.hostile = true;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  sim.player.facing = 0;
  sim.targetEntity(target.id);
  return target;
}

function applyDot(sim: Sim, target: Entity, abilityId: (typeof DOT_IDS)[number]): void {
  const meta = sim.meta(sim.playerId);
  const ability = sim.resolvedAbility(abilityId);
  if (!meta || !ability) throw new Error(`missing ${abilityId}`);
  sim.ctx.runEffects(sim.player, meta, target, ability);
}

function ownedDot(target: Entity, sourceId: number, abilityId: (typeof DOT_IDS)[number]) {
  const dot = target.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === abilityId && aura.sourceId === sourceId,
  );
  if (!dot) throw new Error(`missing ${abilityId} DoT`);
  return dot;
}

function channelToEnd(sim: Sim): void {
  sim.castAbility('drain_life');
  expect(sim.player.castingAbility).toBe('drain_life');
  for (let tick = 0; tick < 20 * 7; tick++) sim.tick();
}

describe('Hexcraft Creeping Rot', () => {
  it('authors a valid Consume duration weave without a new resource or proc draw', () => {
    const affliction = TALENTS.warlock.specs.find((spec) => spec.id === 'affliction');

    expect(validateTalentTree(TALENTS.warlock)).toEqual([]);
    expect(affliction?.signature).toBe('siphon_life');
    expect(affliction?.mastery.name).toBe('Creeping Rot');
    expect(affliction?.mastery.description).toContain('Each landed tick of Consume');
    expect(affliction?.mastery.effect).toEqual({
      global: { dotDmgPct: 0.1 },
      ability: [
        {
          ability: 'drain_life',
          addEffects: [
            { type: 'extendDot', dot: 'corruption', seconds: 1, maxBonus: 3 },
            { type: 'extendDot', dot: 'curse_of_agony', seconds: 1, maxBonus: 3 },
            { type: 'extendDot', dot: 'siphon_life', seconds: 1, maxBonus: 3 },
          ],
        },
      ],
    });
  });

  it('extends all three owned afflictions on landed Consume ticks and caps each application', () => {
    const sim = warlockSim('affliction');
    const target = targetFor(sim);
    for (const dotId of DOT_IDS) applyDot(sim, target, dotId);
    const baseDurations = Object.fromEntries(
      DOT_IDS.map((dotId) => [dotId, ownedDot(target, sim.player.id, dotId).duration]),
    );

    channelToEnd(sim);

    for (const dotId of DOT_IDS) {
      const dot = ownedDot(target, sim.player.id, dotId);
      expect(dot.extendedBy).toBe(3);
      expect(dot.duration).toBe(baseDurations[dotId] + 3);
    }

    sim.player.resource = sim.player.maxResource;
    sim.player.gcdRemaining = 0;
    channelToEnd(sim);
    for (const dotId of DOT_IDS) {
      const dot = ownedDot(target, sim.player.id, dotId);
      expect(dot.extendedBy).toBe(3);
      expect(dot.duration).toBe(baseDurations[dotId] + 3);
    }
  });

  it("leaves another caster's matching DoT and absent afflictions untouched", () => {
    const sim = warlockSim('affliction');
    const target = targetFor(sim);
    applyDot(sim, target, 'corruption');
    target.auras.push({
      id: 'corruption',
      name: 'Blackrot',
      kind: 'dot',
      remaining: 18,
      duration: 18,
      value: 1,
      sourceId: 777,
      school: 'shadow',
    });

    channelToEnd(sim);

    expect(ownedDot(target, sim.player.id, 'corruption').extendedBy).toBe(3);
    const foreign = target.auras.find((aura) => aura.id === 'corruption' && aura.sourceId === 777);
    expect(foreign).toMatchObject({ duration: 18, remaining: expect.any(Number) });
    expect(target.auras.some((aura) => aura.id === 'curse_of_agony')).toBe(false);
    expect(target.auras.some((aura) => aura.id === 'siphon_life')).toBe(false);
  });

  it('keeps the extension spec-gated and adds no RNG draws to the channel', () => {
    const run = (spec: 'affliction' | 'demonology') => {
      const sim = warlockSim(spec, 170_742);
      const target = targetFor(sim, spec === 'affliction' ? 97_402 : 97_403);
      applyDot(sim, target, 'corruption');
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      channelToEnd(sim);
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        extendedBy: ownedDot(target, sim.player.id, 'corruption').extendedBy ?? 0,
      };
    };

    const affliction = run('affliction');
    const sibling = run('demonology');
    expect(affliction.draws).toEqual(sibling.draws);
    expect(affliction.extendedBy).toBe(3);
    expect(sibling.extendedBy).toBe(0);
  });

  it('drops the Consume extension immediately after a live spec change', () => {
    const sim = warlockSim('affliction', 170_743);
    const target = targetFor(sim, 97_404);
    applyDot(sim, target, 'corruption');

    sim.player.inCombat = false;
    expect(sim.applyTalents({ spec: 'demonology', rows: {} })).toBe(true);
    sim.player.resource = sim.player.maxResource;
    sim.player.gcdRemaining = 0;
    channelToEnd(sim);

    expect(ownedDot(target, sim.player.id, 'corruption').extendedBy ?? 0).toBe(0);
  });

  it('localizes the visible Creeping Rot identity in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Creeping Rot', language)).not.toBe('Creeping Rot');
    }
  });
});
