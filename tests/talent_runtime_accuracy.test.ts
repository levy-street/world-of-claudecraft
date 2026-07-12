import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function teleport(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos.x = x;
  entity.pos.z = z;
  entity.pos.y = groundHeight(x, z, sim.cfg.seed);
  entity.prevPos = { ...entity.pos };
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(entity);
}

function addMob(sim: Sim, id: number, x: number, z: number): Entity {
  const mob = createMob(id, MOBS.forest_wolf, 20, {
    x,
    y: groundHeight(x, z, sim.cfg.seed),
    z,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 100_000;
  mob.moveSpeed = 0;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

type SpellFx = Extract<SimEvent, { type: 'spellfx' }>;

function shieldRun(ability: 'holy_shield' | 'aura_surge') {
  const sim = new Sim({ seed: 41, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(20);
  if (ability === 'holy_shield') {
    expect(sim.setSpec('protection')).toBe(true);
  } else {
    expect(sim.applyTalents({ spec: null, rows: { 20: 'pal_r20_aura_mastery' } })).toBe(true);
  }
  const player = sim.player;
  teleport(sim, player, 0, -40);

  const primary = addMob(sim, 9200, 3, -40);
  // Add the higher id first. Both candidates are exactly 4 yd from the primary,
  // so the lower id must win independent of entity insertion order.
  const tiedHigh = addMob(sim, 9102, 3, -36);
  const tiedLow = addMob(sim, 9101, 7, -40);
  const untouched = addMob(sim, 9103, 13, -40);
  sim.targetEntity(primary.id);
  player.resource = player.maxResource;

  const projectiles: SpellFx[] = [];
  const damaged: number[] = [];
  const damageTicks: number[] = [];
  let primaryWasSilenced = false;
  sim.castAbility(ability);
  for (let i = 0; i < 20 * 4; i++) {
    for (const event of sim.tick()) {
      if (event.type === 'spellfx' && event.fx === 'projectile' && event.school === 'holy') {
        projectiles.push(event);
      }
      if (
        event.type === 'damage' &&
        event.sourceId === player.id &&
        (event.ability === 'Hallowed Wall' || event.ability === 'Dawnward Ricochet') &&
        event.amount > 0
      ) {
        damaged.push(event.targetId);
        damageTicks.push(i);
        if (event.targetId === primary.id) {
          primaryWasSilenced = primary.auras.some((a) => a.kind === 'silence');
        }
      }
    }
  }
  return {
    damaged,
    damageTicks,
    player,
    primary,
    primaryWasSilenced,
    projectiles,
    tiedHigh,
    tiedLow,
    untouched,
  };
}

describe('talent runtime accuracy', () => {
  it('Hallowed Wall is a real deterministic three-target shield chain', () => {
    const first = shieldRun('holy_shield');
    expect(first.damaged).toEqual([first.primary.id, first.tiedLow.id, first.tiedHigh.id]);
    expect(first.damaged).not.toContain(first.untouched.id);
    expect(new Set(first.damageTicks)).toHaveLength(3);
    expect(first.projectiles.map((event) => [event.sourceId, event.targetId])).toEqual([
      [first.player.id, first.primary.id],
      [first.primary.id, first.tiedLow.id],
      [first.tiedLow.id, first.tiedHigh.id],
    ]);

    const replay = shieldRun('holy_shield');
    expect(replay.damaged).toEqual(first.damaged);
    expect(replay.projectiles).toEqual(first.projectiles);
  });

  it('a shield chain rolls a spell-damage weapon proc once on its primary impact', () => {
    const sim = new Sim({ seed: 41, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('protection')).toBe(true);
    const player = sim.player;
    teleport(sim, player, 0, -40);
    const primary = addMob(sim, 9250, 3, -40);
    const bounceOne = addMob(sim, 9251, 6, -40);
    const bounceTwo = addMob(sim, 9252, 9, -40);
    // Keep the proc weapon in PlayerMeta as well as on the entity. The sim
    // recalculates equipment-backed stats each tick, so mutating only the
    // render mirror would be replaced before the projectile lands.
    const meta = sim.meta(player.id);
    if (!meta) throw new Error('missing player metadata');
    meta.equipment.mainhand = 'deathless_heartwood';
    player.mainhandItemId = 'deathless_heartwood';
    const rng = sim.ctx.rng as typeof sim.ctx.rng & { chance: (probability: number) => boolean };
    let fifteenPercentRolls = 0;
    rng.chance = (probability: number) => {
      if (probability !== 0.15) return true;
      fifteenPercentRolls++;
      return true;
    };
    sim.targetEntity(primary.id);
    player.resource = player.maxResource;
    expect(player.gcdRemaining).toBe(0);
    sim.castAbility('holy_shield');
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    const immediateErrors = sim
      .drainEvents()
      .filter((event) => event.type === 'error' || event.type === 'castStop');
    expect(immediateErrors).toEqual([]);
    const trace: SimEvent[] = [];
    for (let i = 0; i < 20 * 3; i++) trace.push(...sim.tick());

    expect(player.mainhandItemId).toBe('deathless_heartwood');
    expect(player.dead).toBe(false);
    expect(primary.dead).toBe(false);
    expect(sim.ctx.entities.get(primary.id)).toBe(primary);
    expect(sim.ctx.pendingProjectiles).toHaveLength(0);
    expect(trace.some((event) => event.type === 'damage')).toBe(true);
    expect(fifteenPercentRolls).toBe(1);
    expect(primary.hp).toBeLessThan(primary.maxHp);
    expect(primary.auras.some((a) => a.id === 'deathbloom')).toBe(true);
    expect(bounceOne.auras.some((a) => a.id === 'deathbloom')).toBe(false);
    expect(bounceTwo.auras.some((a) => a.id === 'deathbloom')).toBe(false);
  });

  it("Giant's Momentum counts rage paid by a queued Reaver Strike", () => {
    const sim = new Sim({ seed: 47, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 20: 'war_r20_giants_momentum' } })).toBe(true);
    const target = addMob(sim, 9260, sim.player.pos.x, sim.player.pos.z + 3);
    sim.targetEntity(target.id);
    sim.player.resource = sim.player.maxResource;
    sim.player.cooldowns.set('mortal_strike', 30);
    sim.castAbility('heroic_strike');
    let ticks = 0;
    while (sim.player.queuedOnSwing && ticks < 20) {
      sim.tick();
      ticks++;
    }
    expect(sim.player.queuedOnSwing).toBeNull();
    expect(sim.player.cooldowns.get('mortal_strike')).toBeCloseTo(30 - ticks * 0.05 - 1.5, 5);
  });

  it('Dawnward Ricochet replaces Radiant Swell with a bouncing shield and primary silence', () => {
    const result = shieldRun('aura_surge');
    expect(result.damaged).toEqual([result.primary.id, result.tiedLow.id, result.tiedHigh.id]);
    expect(result.primaryWasSilenced).toBe(true);
    expect(result.untouched.hp).toBe(result.untouched.maxHp);
  });

  it('Gladesong heals nearby allies on every channel tick', () => {
    const sim = new Sim({ seed: 29, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 20: 'dru_r20_tranquility' } })).toBe(true);
    const allyId = sim.addPlayer('warrior', 'Ally');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');
    sim.setPlayerLevel(20, allyId);
    teleport(sim, sim.player, 0, -40);
    teleport(sim, ally, 5, -40);
    sim.player.hp = Math.round(sim.player.maxHp * 0.4);
    ally.hp = Math.round(ally.maxHp * 0.4);
    const playerBefore = sim.player.hp;
    const allyBefore = ally.hp;
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('tranquility');
    const healedTargets: number[] = [];
    for (let i = 0; i < 20 * 5; i++) {
      for (const event of sim.tick()) {
        if (event.type === 'heal2' && event.ability === 'Gladesong') {
          healedTargets.push(event.targetId);
        }
      }
    }
    expect(healedTargets.filter((id) => id === sim.playerId)).toHaveLength(4);
    expect(healedTargets.filter((id) => id === allyId)).toHaveLength(4);
    expect(sim.player.hp).toBeGreaterThan(playerBefore);
    expect(ally.hp).toBeGreaterThan(allyBefore);
  });

  it('a discounted spell can start with its actual discounted mana cost', () => {
    const sim = new Sim({ seed: 7, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    const target = addMob(sim, 9300, sim.player.pos.x + 3, sim.player.pos.z);
    sim.targetEntity(target.id);
    const cost = sim.resolvedAbility('fire_blast')?.cost;
    if (cost === undefined) throw new Error('missing Cinderfall');
    const discountedCost = Math.ceil(cost * 0.5);
    sim.player.resource = discountedCost;
    sim.player.auras.push({
      id: 'test_cheap_cinderfall',
      name: 'Test Discount',
      kind: 'next_cast_cheap',
      remaining: 10,
      duration: 10,
      value: 0.5,
      sourceId: sim.playerId,
      school: 'arcane',
      empowerAbilities: ['fire_blast'],
    });
    sim.castAbility('fire_blast');
    expect(sim.player.resource).toBe(0);
    expect(sim.player.auras.some((a) => a.id === 'test_cheap_cinderfall')).toBe(false);
  });

  it('Twisted Faith requires the named Dirge of Decay rather than any caster DoT', () => {
    const run = (dotId: string | null) => {
      const sim = new Sim({ seed: 13, playerClass: 'priest', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.applyTalents({ spec: null, rows: { 5: 'pri_r5_twisted_faith' } })).toBe(true);
      const target = addMob(sim, 9400, sim.player.pos.x, sim.player.pos.z + 4);
      if (dotId) {
        target.auras.push({
          id: dotId,
          name: 'Test DoT',
          kind: 'dot',
          remaining: 20,
          duration: 20,
          value: 1,
          tickInterval: 10,
          tickTimer: 10,
          sourceId: sim.playerId,
          school: 'shadow',
        });
      }
      const meta = sim.ctx.players.get(sim.playerId);
      const resolved = sim.resolvedAbility('mind_blast');
      if (!meta || !resolved) throw new Error('missing priest state');
      const before = target.hp;
      runEffects(sim.ctx, sim.player, meta, target, resolved);
      return before - target.hp;
    };

    const noDot = run(null);
    expect(run('corruption')).toBe(noDot);
    expect(run('shadow_word_pain')).toBeGreaterThan(noDot * 1.2);
  });

  it('Viperfletch deals 50% of the actual Fell Shot hit over three one-second ticks', () => {
    const sim = new Sim({ seed: 17, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 14: 'hun_r14_serpents_venom' } })).toBe(true);
    const target = addMob(sim, 9500, sim.player.pos.x, sim.player.pos.z + 4);
    const meta = sim.ctx.players.get(sim.playerId);
    const resolved = sim.resolvedAbility('arcane_shot');
    if (!meta || !resolved) throw new Error('missing hunter state');
    sim.player.critChance = 0;
    const before = target.hp;
    runEffects(sim.ctx, sim.player, meta, target, resolved);
    const directDamage = before - target.hp;
    const venom = target.auras.find((a) => a.kind === 'dot' && a.id === 'arcane_shot');
    expect(venom?.school).toBe('nature');
    expect(venom?.tickInterval).toBe(1);
    expect(venom?.duration).toBe(3);
    expect(venom?.value).toBe(Math.max(1, Math.round((directDamage * 0.5) / 3)));
  });

  it('Cinder Jolt detonation counts the pending next tick in remaining damage', () => {
    const run = (tickTimer: number) => {
      const sim = new Sim({ seed: 19, playerClass: 'shaman', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.applyTalents({ spec: null, rows: { 14: 'sha_r14_improved_flame_shock' } })).toBe(
        true,
      );
      const target = addMob(sim, 9600, sim.player.pos.x, sim.player.pos.z + 4);
      target.auras.push({
        id: 'flame_shock',
        name: 'Cinder Jolt',
        kind: 'dot',
        remaining: 5,
        duration: 12,
        value: 10,
        tickInterval: 3,
        tickTimer,
        sourceId: sim.playerId,
        school: 'fire',
      });
      const meta = sim.ctx.players.get(sim.playerId);
      const resolved = sim.resolvedAbility('earth_shock');
      if (!meta || !resolved) throw new Error('missing shaman state');
      const before = target.hp;
      runEffects(sim.ctx, sim.player, meta, target, resolved);
      return before - target.hp;
    };

    // With 5 sec remaining, a next tick in 1 sec leaves two ticks. A next tick
    // in 3 sec leaves one. The direct Earthen Jolt hit is identical in both runs.
    expect(run(1) - run(3)).toBe(10);
  });
});
