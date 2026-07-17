import { describe, expect, it } from 'vitest';
import { onPetHit, onSpellHit } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function warlockSim(
  spec: 'affliction' | 'demonology' | 'destruction' = 'demonology',
  seed = 170_745,
): Sim {
  const sim = new Sim({ seed, playerClass: 'warlock', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_409): Entity {
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

function ownedPetFor(sim: Sim, id = 97_410): Entity {
  const pet = createMob(id, MOBS.forest_wolf, 20, sim.player.pos);
  pet.ownerId = sim.playerId;
  sim.entities.set(pet.id, pet);
  sim.rebucket(pet);
  return pet;
}

describe('Pactbound Fiendlore', () => {
  it('authors a valid deterministic demon handoff without a new resource', () => {
    const spec = TALENTS.warlock.specs.find((candidate) => candidate.id === 'demonology');

    expect(validateTalentTree(TALENTS.warlock)).toEqual([]);
    expect(spec?.signature).toBe('metamorphosis');
    expect(spec?.mastery.name).toBe('Fiendlore');
    expect(spec?.mastery.description).toContain('Every 2nd landed demon attack');
    expect(spec?.mastery.description).toContain('Dread Aspect cooldown by 3 sec');
    expect(spec?.mastery.effect).toEqual({
      global: { petDmgSharePct: 0.2 },
      procs: [
        {
          id: 'wlk_fiendlore_handoff',
          name: 'Fiendlore',
          spec: 'demonology',
          requiresKnownAbility: 'metamorphosis',
          school: 'shadow',
          trigger: { on: 'petHitNth', n: 2 },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_cast_instant',
              abilities: ['shadow_bolt'],
              duration: 8,
            },
          ],
        },
        {
          id: 'wlk_fiendlore_pact',
          name: 'Fiendlore',
          spec: 'demonology',
          requiresKnownAbility: 'metamorphosis',
          school: 'shadow',
          trigger: { on: 'spellHit', abilities: ['shadow_bolt'] },
          responses: [{ kind: 'cooldownRefund', ability: 'metamorphosis', seconds: 3 }],
        },
      ],
    });
    expect(warlockSim().player.resourceType).toBe('mana');
  });

  it('arms the instant bolt on every second positive direct landed owned-demon hit', () => {
    const sim = warlockSim();
    const target = targetFor(sim);
    const pet = ownedPetFor(sim);
    let draws = 0;
    sim.ctx.rng.setObserver(() => draws++);

    sim.dealDamage(pet, target, 0, false, 'physical', 'Demon Test', 'hit');
    sim.dealDamage(
      pet,
      target,
      10,
      false,
      'physical',
      'Demon Test',
      'hit',
      false,
      undefined,
      false,
    );
    expect(sim.player.procState?.counters.wlk_fiendlore_handoff).toBeUndefined();

    sim.dealDamage(pet, target, 10, false, 'physical', 'Demon Test', 'hit');
    expect(sim.player.procState?.counters.wlk_fiendlore_handoff).toBe(1);
    sim.dealDamage(pet, target, 10, false, 'physical', 'Demon Test', 'hit');
    sim.ctx.rng.setObserver(null);

    expect(draws).toBe(0);
    expect(sim.player.procState?.counters.wlk_fiendlore_handoff).toBe(0);
    expect(sim.player.auras.find((aura) => aura.id === 'wlk_fiendlore_handoff')).toMatchObject({
      kind: 'next_cast_instant',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['shadow_bolt'],
    });
  });

  it('gates both halves by Pactbound and the known Dread Aspect signature', () => {
    const withoutSignature = warlockSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Pactbound metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'metamorphosis');

    for (const sim of [warlockSim('affliction'), warlockSim('destruction'), withoutSignature]) {
      const target = targetFor(sim, 97_411 + sim.player.id);
      sim.player.cooldowns.set('metamorphosis', 60);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      onPetHit(sim.ctx, sim.player, target);
      onPetHit(sim.ctx, sim.player, target);
      onSpellHit(sim.ctx, sim.player, 'shadow_bolt', target);
      sim.ctx.rng.setObserver(null);

      expect(draws).toBe(0);
      expect(sim.player.procState?.counters.wlk_fiendlore_handoff).toBeUndefined();
      expect(sim.player.auras.some((aura) => aura.id === 'wlk_fiendlore_handoff')).toBe(false);
      expect(sim.player.cooldowns.get('metamorphosis')).toBe(60);
    }
  });

  it('spends full mana on the instant handoff and lands it to advance Dread Aspect', () => {
    const sim = warlockSim();
    const target = targetFor(sim, 97_414);
    const bolt = sim.resolvedAbility('shadow_bolt');
    if (!bolt) throw new Error('missing Gloom Bolt');
    onPetHit(sim.ctx, sim.player, target);
    onPetHit(sim.ctx, sim.player, target);
    sim.player.cooldowns.set('metamorphosis', 60);
    const manaBefore = sim.player.resource;
    const timeBefore = sim.ctx.time;

    sim.castAbility('shadow_bolt');

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(manaBefore - bolt.cost);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_fiendlore_handoff')).toBe(false);
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);

    for (let tick = 0; tick < 100 && sim.ctx.pendingProjectiles.length > 0; tick++) sim.tick();
    expect(sim.ctx.pendingProjectiles).toHaveLength(0);
    expect(sim.player.cooldowns.get('metamorphosis')).toBeCloseTo(57 - (sim.ctx.time - timeBefore));
  });

  it('uses no proc draws and replays the two-part cadence exactly', () => {
    const run = () => {
      const sim = warlockSim('demonology', 170_746);
      const target = targetFor(sim, 97_415);
      sim.player.cooldowns.set('metamorphosis', 40);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onPetHit(sim.ctx, sim.player, target);
      onPetHit(sim.ctx, sim.player, target);
      onSpellHit(sim.ctx, sim.player, 'shadow_bolt', target);
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        cooldown: sim.player.cooldowns.get('metamorphosis'),
        aura: sim.player.auras.find((candidate) => candidate.id === 'wlk_fiendlore_handoff'),
      };
    };

    expect(run()).toEqual(run());
    expect(run().draws).toEqual([]);
  });

  it('clears the partial demon cadence and visible window when Pactbound is left', () => {
    const sim = warlockSim();
    const target = targetFor(sim, 97_416);
    onPetHit(sim.ctx, sim.player, target);
    onPetHit(sim.ctx, sim.player, target);
    onPetHit(sim.ctx, sim.player, target);
    expect(sim.player.procState?.counters.wlk_fiendlore_handoff).toBe(1);
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_fiendlore_handoff')).toBe(true);

    expect(sim.applyTalents({ spec: 'affliction', rows: {} })).toBe(true);

    expect(sim.player.procState?.counters.wlk_fiendlore_handoff).toBeUndefined();
    expect(sim.player.auras.some((aura) => aura.id === 'wlk_fiendlore_handoff')).toBe(false);
  });

  it('localizes the visible Fiendlore identity in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Fiendlore', language)).not.toBe('Fiendlore');
    }
  });
});
