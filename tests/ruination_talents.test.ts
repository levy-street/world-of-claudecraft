import { describe, expect, it } from 'vitest';
import { onSpellHit } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const RUINBOLT_ID = 'wlk_r20_chaos_bolt';

function warlockSim(
  options: {
    selected?: boolean;
    spec?: 'affliction' | 'demonology' | 'destruction';
    seed?: number;
  } = {},
): Sim {
  const sim = new Sim({ seed: options.seed ?? 170_750, playerClass: 'warlock', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'destruction',
      rows: options.selected === false ? {} : { 20: RUINBOLT_ID },
    }),
  ).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_426): Entity {
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
  sim.targetEntity(target.id);
  sim.player.facing = 0;
  return target;
}

function advanceCastAndProjectile(sim: Sim): void {
  for (
    let tick = 0;
    tick < 200 && (sim.player.castingAbility !== null || sim.ctx.pendingProjectiles.length > 0);
    tick++
  ) {
    sim.tick();
  }
  expect(sim.player.castingAbility).toBeNull();
  expect(sim.ctx.pendingProjectiles).toHaveLength(0);
}

describe('Ruination talent: Ruinbolt', () => {
  it('keeps the Warlock trees valid and turns the stable grant into a burst relay', () => {
    const row = ROW_TREES.warlock.find((candidate) => candidate.level === 20);
    const option = row?.options.find((candidate) => candidate.id === RUINBOLT_ID);

    expect(validateTalentTree(TALENTS.warlock)).toEqual([]);
    expect(validateRowTree(ROW_TREES.warlock)).toEqual([]);
    expect(row?.options.map((candidate) => [candidate.id, candidate.name])).toEqual([
      [RUINBOLT_ID, 'Ruinbolt'],
      ['wlk_r20_grimoire_of_haste', 'Hellglass Ward'],
      ['wlk_r20_curse_mastery', 'Hexstorm'],
    ]);
    expect(option?.effect).toEqual({
      grant: { ability: 'chaos_bolt' },
      proc: {
        id: 'wlk_ruinbolt_relay',
        name: 'Ruinbolt',
        requiresKnownAbility: 'chaos_bolt',
        school: 'fire',
        trigger: { on: 'spellHit', abilities: ['chaos_bolt'] },
        responses: [{ kind: 'cooldownRefund', ability: 'shadowburn', seconds: 'reset' }],
      },
    });
  });

  it('plays the full Duskfire, Ruinbolt, Duskfire sequence on landed damage', () => {
    const sim = warlockSim();
    targetFor(sim);

    sim.castAbility('shadowburn');
    advanceCastAndProjectile(sim);
    expect(sim.player.cooldowns.get('shadowburn')).toBeGreaterThan(0);

    sim.player.resource = sim.player.maxResource;
    sim.player.gcdRemaining = 0;
    sim.castAbility('chaos_bolt');
    expect(sim.player.castingAbility).toBe('chaos_bolt');
    advanceCastAndProjectile(sim);
    expect(sim.player.cooldowns.has('shadowburn')).toBe(false);

    sim.player.resource = sim.player.maxResource;
    sim.player.gcdRemaining = 0;
    sim.castAbility('shadowburn');
    expect(sim.player.cooldowns.get('shadowburn')).toBe(15);
  });

  it('requires both the selected grant and a landed Ruinbolt hit', () => {
    const selected = warlockSim();
    const target = targetFor(selected, 97_427);
    selected.player.cooldowns.set('shadowburn', 12);
    onSpellHit(selected.ctx, selected.player, 'immolate', target);
    expect(selected.player.cooldowns.get('shadowburn')).toBe(12);
    onSpellHit(selected.ctx, selected.player, 'chaos_bolt', target);
    expect(selected.player.cooldowns.has('shadowburn')).toBe(false);

    const unselected = warlockSim({ selected: false });
    const unselectedTarget = targetFor(unselected, 97_428);
    unselected.player.cooldowns.set('shadowburn', 12);
    onSpellHit(unselected.ctx, unselected.player, 'chaos_bolt', unselectedTarget);
    expect(unselected.player.cooldowns.get('shadowburn')).toBe(12);

    const withoutKnownGrant = warlockSim();
    const meta = withoutKnownGrant.meta(withoutKnownGrant.playerId);
    if (!meta) throw new Error('missing Warlock metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'chaos_bolt');
    const knownTarget = targetFor(withoutKnownGrant, 97_429);
    withoutKnownGrant.player.cooldowns.set('shadowburn', 12);
    onSpellHit(withoutKnownGrant.ctx, withoutKnownGrant.player, 'chaos_bolt', knownTarget);
    expect(withoutKnownGrant.player.cooldowns.get('shadowburn')).toBe(12);
  });

  it('retains the grant and reset for Hexcraft and Pactbound', () => {
    for (const spec of ['affliction', 'demonology'] as const) {
      const sim = warlockSim({ spec });
      const target = targetFor(sim, spec === 'affliction' ? 97_430 : 97_431);
      expect(sim.resolvedAbility('chaos_bolt')).not.toBeNull();
      sim.player.cooldowns.set('shadowburn', 10);

      onSpellHit(sim.ctx, sim.player, 'chaos_bolt', target);

      expect(sim.player.cooldowns.has('shadowburn')).toBe(false);
    }
  });

  it('adds no proc draws and replays the cooldown reset exactly', () => {
    const run = () => {
      const sim = warlockSim({ seed: 170_751 });
      const target = targetFor(sim, 97_432);
      sim.player.cooldowns.set('shadowburn', 9);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onSpellHit(sim.ctx, sim.player, 'chaos_bolt', target);
      sim.ctx.rng.setObserver(null);
      return { draws, cooldown: sim.player.cooldowns.get('shadowburn') ?? 0 };
    };

    expect(run()).toEqual({ draws: [], cooldown: 0 });
    expect(run()).toEqual(run());
  });

  it('localizes Ruinbolt in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Ruinbolt', language)).not.toBe('Ruinbolt');
    }
  });
});
