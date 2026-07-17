import { describe, expect, it } from 'vitest';
import { onPetHit } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

function hunterSim(
  spec: 'beast_mastery' | 'marksmanship' | 'survival' = 'beast_mastery',
  level = 20,
): Sim {
  const sim = new Sim({ seed: 170731, playerClass: 'hunter', autoEquip: false });
  sim.setPlayerLevel(level);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, distance = 10): Entity {
  const target = createMob(97_101, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  target.hostile = true;
  target.stats = { ...target.stats, armor: 0 };
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  return target;
}

function ownedPetFor(sim: Sim): Entity {
  const pet = createMob(97_102, MOBS.forest_wolf, 20, sim.player.pos);
  pet.ownerId = sim.playerId;
  sim.entities.set(pet.id, pet);
  sim.rebucket(pet);
  return pet;
}

describe('Packlord Packbond', () => {
  it('authors a valid pet-fed mastery with an eight-second mana payoff', () => {
    const spec = TALENTS.hunter.specs.find((candidate) => candidate.id === 'beast_mastery');

    expect(validateTalentTree(TALENTS.hunter)).toEqual([]);
    expect(spec?.mastery.name).toBe('Packbond');
    expect(spec?.mastery.description).toContain('Every 3rd landed pet attack');
    expect(spec?.mastery.description).toContain('Howling Rage');
    expect(spec?.mastery.description).toContain('Fell Shot');
    expect(spec?.mastery.effect.proc).toEqual({
      id: 'hun_packbond',
      name: 'Packbond',
      spec: 'beast_mastery',
      requiresKnownAbility: 'bestial_wrath',
      school: 'nature',
      trigger: { on: 'petHitNth', n: 3 },
      responses: [
        { kind: 'cooldownRefund', ability: 'bestial_wrath', seconds: 4 },
        {
          kind: 'empowerNext',
          aura: 'next_cast_free',
          abilities: ['arcane_shot'],
          duration: 8,
        },
      ],
    });
  });

  it('fires on every third landed pet hit with a replayable zero-draw cadence', () => {
    const run = (): { cooldown: number; counter: number; draws: number } => {
      const sim = hunterSim();
      const target = targetFor(sim);
      sim.player.cooldowns.set('bestial_wrath', 60);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      for (let hit = 0; hit < 7; hit++) onPetHit(sim.ctx, sim.player, target);

      sim.ctx.rng.setObserver(null);
      return {
        cooldown: sim.player.cooldowns.get('bestial_wrath') ?? 0,
        counter: sim.player.procState?.counters.hun_packbond ?? 0,
        draws,
      };
    };

    expect(run()).toEqual({ cooldown: 52, counter: 1, draws: 0 });
    expect(run()).toEqual(run());
  });

  it('advances only for positive direct damage from an owned pet', () => {
    const sim = hunterSim();
    const target = targetFor(sim);
    const pet = ownedPetFor(sim);

    sim.dealDamage(pet, target, 0, false, 'physical', 'Pet Test', 'hit');
    sim.dealDamage(pet, target, 10, false, 'physical', 'Pet Test', 'hit', false, undefined, false);
    expect(sim.player.procState?.counters.hun_packbond).toBeUndefined();

    sim.dealDamage(pet, target, 10, false, 'physical', 'Pet Test', 'hit');
    sim.dealDamage(pet, target, 10, false, 'physical', 'Pet Test', 'hit');
    expect(sim.player.procState?.counters.hun_packbond).toBe(2);
    sim.dealDamage(pet, target, 10, false, 'physical', 'Pet Test', 'hit');

    expect(sim.player.procState?.counters.hun_packbond).toBe(0);
    expect(sim.player.auras.find((aura) => aura.id === 'hun_packbond')).toMatchObject({
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      empowerAbilities: ['arcane_shot'],
    });
  });

  it('does not feed Packbond after the pet owner dies', () => {
    const sim = hunterSim();
    const target = targetFor(sim);
    const pet = ownedPetFor(sim);
    sim.player.dead = true;

    for (let hit = 0; hit < 3; hit++) {
      sim.dealDamage(pet, target, 10, false, 'physical', 'Pet Test', 'hit');
    }

    expect(sim.player.procState?.counters.hun_packbond).toBeUndefined();
    expect(sim.player.auras.some((aura) => aura.id === 'hun_packbond')).toBe(false);
  });

  it('counts a companion hit that ends a duel at the one-health guard', () => {
    const sim = hunterSim();
    const pet = ownedPetFor(sim);
    const rivalId = sim.addPlayer('warrior', 'Rival');
    const rival = sim.entities.get(rivalId);
    if (!rival) throw new Error('missing duel rival');
    const duel = { a: sim.playerId, b: rivalId, state: 'active' as const, timer: 0 };
    sim.ctx.duels.set(sim.playerId, duel);
    sim.ctx.duels.set(rivalId, duel);

    sim.dealDamage(pet, rival, 1, false, 'physical', 'Pet Test', 'hit');
    sim.dealDamage(pet, rival, 1, false, 'physical', 'Pet Test', 'hit');
    sim.dealDamage(pet, rival, rival.hp + 100, false, 'physical', 'Pet Test', 'hit');

    expect(rival.hp).toBe(1);
    expect(sim.player.procState?.counters.hun_packbond).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_packbond')).toBe(true);
  });

  it('gates the counter before the signature is learned and outside Packlord', () => {
    const withoutSignature = hunterSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Packlord metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'bestial_wrath');
    const cases = [hunterSim('marksmanship'), hunterSim('survival'), withoutSignature];
    for (const sim of cases) {
      const target = targetFor(sim);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      for (let hit = 0; hit < 3; hit++) onPetHit(sim.ctx, sim.player, target);
      sim.ctx.rng.setObserver(null);

      expect(draws).toBe(0);
      expect(sim.player.procState?.counters.hun_packbond ?? 0).toBe(0);
      expect(sim.player.auras.some((aura) => aura.id === 'hun_packbond')).toBe(false);
    }
  });

  it('spends the visible Packbond window on one free mobile Fell Shot', () => {
    const sim = hunterSim();
    const target = targetFor(sim);
    for (let hit = 0; hit < 3; hit++) onPetHit(sim.ctx, sim.player, target);
    sim.targetEntity(target.id);
    sim.player.facing = 0;
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;

    sim.castAbility('arcane_shot');

    expect(sim.player.resource).toBe(0);
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.auras.some((aura) => aura.id === 'hun_packbond')).toBe(false);
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
  });

  it('clears both the visible window and partial cadence when Packlord is left', () => {
    const sim = hunterSim();
    const target = targetFor(sim);
    onPetHit(sim.ctx, sim.player, target);
    onPetHit(sim.ctx, sim.player, target);
    onPetHit(sim.ctx, sim.player, target);
    onPetHit(sim.ctx, sim.player, target);
    expect(sim.player.procState?.counters.hun_packbond).toBe(1);
    expect(sim.player.auras.some((aura) => aura.id === 'hun_packbond')).toBe(true);

    expect(sim.applyTalents({ spec: 'marksmanship', rows: {} })).toBe(true);

    expect(sim.player.procState?.counters.hun_packbond).toBeUndefined();
    expect(sim.player.auras.some((aura) => aura.id === 'hun_packbond')).toBe(false);
  });

  it('localizes the visible Packbond window in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Packbond', language)).not.toBe('Packbond');
    }
  });
});
