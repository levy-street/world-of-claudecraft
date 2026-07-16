import { describe, expect, it } from 'vitest';
import { cancelCast, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { rampedDrainTickDamage } from '../src/sim/combat/channel_effects';
import { rowForLevel, TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import type { Aura } from '../src/sim/types';

function runLitany(
  seed: number,
  talentId?: string,
): {
  amounts: number[];
  draws: number[];
  healthLost: number;
  duration: number;
  ticks: number;
} {
  const sim = new Sim({ seed, playerClass: 'priest', autoEquip: false });
  sim.setPlayerLevel(20);
  if (talentId) {
    expect(sim.applyTalents({ spec: null, rows: { 17: talentId } })).toBe(true);
  }
  sim.player.spellPower = 0;
  sim.player.resource = sim.player.maxResource;

  const target = createMob(90_001, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 25,
  });
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);

  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing priest metadata');
  const litany = sim.resolvedAbility('mind_flay');
  if (!litany?.def.channel) throw new Error('missing Litany channel');
  const { duration, ticks } = litany.def.channel;
  const draws: number[] = [];
  sim.rng.setObserver((value) => draws.push(value));

  sim.castAbility('mind_flay');
  expect(sim.player.castingAbility).toBe('mind_flay');
  for (let tick = 0; tick < 200 && sim.player.castingAbility; tick++) {
    updateCasting(sim.ctx, sim.player, meta);
    advancePendingProjectiles(sim.ctx);
  }
  for (let tick = 0; tick < 200 && sim.ctx.pendingProjectiles.length > 0; tick++) {
    advancePendingProjectiles(sim.ctx);
  }
  sim.rng.setObserver(null);

  const amounts = sim
    .drainEvents()
    .flatMap((event) =>
      event.type === 'damage' && event.ability === 'Litany of Woe' ? [event.amount] : [],
    );
  return { amounts, draws, healthLost: target.maxHp - target.hp, duration, ticks };
}

function runFinisher(
  talentId: string | undefined,
  clipAfterTicks = 0,
): { burstTargets: number[]; draws: number[]; primaryId: number; nearbyId: number } {
  const sim = new Sim({ seed: 54_821, playerClass: 'priest', autoEquip: false });
  sim.setPlayerLevel(20);
  if (talentId) {
    expect(sim.applyTalents({ spec: null, rows: { 17: talentId } })).toBe(true);
  }
  sim.player.spellPower = 0;
  sim.player.resource = sim.player.maxResource;

  const addTarget = (id: number, xOffset: number, zOffset: number) => {
    const target = createMob(id, MOBS.forest_wolf, 20, {
      x: sim.player.pos.x + xOffset,
      y: sim.player.pos.y,
      z: sim.player.pos.z + zOffset,
    });
    target.maxHp = 100_000;
    target.hp = target.maxHp;
    sim.entities.set(target.id, target);
    sim.rebucket(target);
    return target;
  };
  const primary = addTarget(91_001, 0, 25);
  const nearby = addTarget(91_002, 4, 25);
  addTarget(91_003, 10, 25);
  sim.targetEntity(primary.id);
  sim.player.facing = Math.atan2(
    primary.pos.x - sim.player.pos.x,
    primary.pos.z - sim.player.pos.z,
  );

  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing priest metadata');
  const draws: number[] = [];
  sim.rng.setObserver((value) => draws.push(value));
  sim.castAbility('mind_flay');
  for (let tick = 0; tick < 300 && sim.player.castingAbility; tick++) {
    updateCasting(sim.ctx, sim.player, meta);
    advancePendingProjectiles(sim.ctx);
    if (clipAfterTicks > 0 && (sim.player.channelTicksFired ?? 0) >= clipAfterTicks) {
      cancelCast(sim.ctx, sim.player);
    }
  }
  for (let tick = 0; tick < 200 && sim.ctx.pendingProjectiles.length > 0; tick++) {
    advancePendingProjectiles(sim.ctx);
  }
  sim.rng.setObserver(null);

  const burstTargets = sim
    .drainEvents()
    .flatMap((event) =>
      event.type === 'damage' && event.ability === 'Litany of Woe' && event.amount === 36
        ? [event.targetId]
        : [],
    )
    .sort((a, b) => a - b);
  return { burstTargets, draws, primaryId: primary.id, nearbyId: nearby.id };
}

function runMindfractureRefresh(talented: boolean): {
  own: Aura;
  foreign: Aura;
  draws: number[];
} {
  const sim = new Sim({ seed: 61_403, playerClass: 'priest', autoEquip: false });
  sim.setPlayerLevel(20);
  if (talented) {
    expect(sim.applyTalents({ spec: null, rows: { 14: 'pri_r14_deathless_dirge' } })).toBe(true);
  }
  sim.player.spellPower = 0;
  sim.player.critChance = 0;
  sim.player.resource = sim.player.maxResource;
  const target = createMob(92_001, MOBS.forest_wolf, 1, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 6,
  });
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(
    target.pos.x - sim.player.pos.x,
    target.pos.z - sim.player.pos.z,
  );

  const own: Aura = {
    id: 'shadow_word_pain',
    name: 'Dirge of Decay',
    kind: 'dot',
    remaining: 3,
    duration: 18,
    value: 9,
    tickInterval: 3,
    tickTimer: 1.25,
    sourceId: sim.playerId,
    school: 'shadow',
  };
  const foreign: Aura = { ...own, sourceId: 999_999 };
  target.auras.push(foreign, own);

  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing priest metadata');
  const draws: number[] = [];
  sim.rng.setObserver((value) => draws.push(value));
  sim.castAbility('mind_blast');
  for (let tick = 0; tick < 200 && sim.player.castingAbility; tick++) {
    updateCasting(sim.ctx, sim.player, meta);
  }
  for (let tick = 0; tick < 200 && sim.ctx.pendingProjectiles.length > 0; tick++) {
    advancePendingProjectiles(sim.ctx);
  }
  sim.rng.setObserver(null);
  return { own, foreign, draws };
}

describe('Litany of Woe channel effects', () => {
  it('ramps from the one-based tick ordinal without its own RNG', () => {
    expect(rampedDrainTickDamage(12, 0.3, 1)).toBe(12);
    expect(rampedDrainTickDamage(12, 0.3, 2)).toBe(16);
    expect(rampedDrainTickDamage(12, 0.3, 3)).toBe(19);
  });

  it('casts at 25 yards and emits three rising authoritative damage events', () => {
    const result = runLitany(17_216);

    expect(result.amounts).toEqual([12, 16, 19]);
    expect(result.healthLost).toBe(47);
    expect(result.draws).toHaveLength(3);
  });

  it('replays with the same damage and draw stream for the same seed', () => {
    const first = runLitany(82_133);
    const replay = runLitany(82_133);

    expect(replay.amounts).toEqual(first.amounts);
    expect(replay.draws).toEqual(first.draws);
  });

  it('triples duration and ticks with the level-17 Ninefold Litany choice', () => {
    const result = runLitany(39_109, 'pri_r17_ninefold_litany');

    expect(result.duration).toBe(9);
    expect(result.ticks).toBe(9);
    expect(result.amounts).toEqual([12, 16, 19, 23, 26, 30, 34, 37, 41]);
    expect(result.amounts.at(-1)).toBeGreaterThan(19);
    expect(result.draws).toHaveLength(9);
    expect(ABILITIES.mind_flay.channel).toEqual({ duration: 3, ticks: 3 });
  });

  it('places the Litany choice after its level-16 prerequisite and keeps the tree valid', () => {
    const row = rowForLevel('priest', 17);
    const choice = row?.options.find((option) => option.id === 'pri_r17_ninefold_litany');
    const finisher = row?.options.find((option) => option.id === 'pri_r17_woes_crescendo');

    expect(choice).toBeDefined();
    expect(choice?.effect.ability?.[0]?.ability).toBe('mind_flay');
    expect(finisher).toBeDefined();
    expect(finisher?.effect.ability?.[0]?.ability).toBe('mind_flay');
    expect(ABILITIES.mind_flay.learnLevel).toBeLessThanOrEqual(17);
    expect(validateTalentTree(TALENTS.priest)).toEqual([]);
  });

  it('bursts only after a talented full channel and does not add RNG draws', () => {
    const baseline = runFinisher(undefined);
    const full = runFinisher('pri_r17_woes_crescendo');
    const clipped = runFinisher('pri_r17_woes_crescendo', 2);
    const extendedOnly = runFinisher('pri_r17_ninefold_litany');

    expect(full.burstTargets).toEqual([full.primaryId, full.nearbyId]);
    expect(clipped.burstTargets).toEqual([]);
    expect(baseline.burstTargets).toEqual([]);
    expect(extendedOnly.burstTargets).toEqual([]);
    expect(full.draws).toEqual(baseline.draws);
    expect(clipped.draws).toHaveLength(2);
  });

  it('refreshes only the caster-owned Dirge with talented Mindfracture', () => {
    const baseline = runMindfractureRefresh(false);
    const talented = runMindfractureRefresh(true);

    expect(baseline.own.remaining).toBe(3);
    expect(talented.own).toMatchObject({
      remaining: 18,
      duration: 18,
      value: 9,
      tickTimer: 1.25,
    });
    expect(talented.foreign.remaining).toBe(3);
    expect(talented.draws).toEqual(baseline.draws);
  });

  it('places Deathless Dirge after both of its level prerequisites', () => {
    const row = rowForLevel('priest', 14);
    const choice = row?.options.find((option) => option.id === 'pri_r14_deathless_dirge');

    expect(choice?.effect.ability?.[0]?.ability).toBe('mind_blast');
    expect(ABILITIES.mind_blast.learnLevel).toBeLessThanOrEqual(14);
    expect(ABILITIES.shadow_word_pain.learnLevel).toBeLessThanOrEqual(14);
  });
});
