import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { orderedSwordmasterTargets } from '../src/sim/combat/swordmaster';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta, ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function harness(seed = 4242): { sim: TestSim; player: Entity; meta: PlayerMeta } {
  const sim = new Sim({ seed, playerClass: 'swordmaster' }) as unknown as TestSim;
  sim.setPlayerLevel(20);
  for (const entity of sim.ctx.entities.values()) {
    if (entity.kind === 'mob') entity.dead = true;
  }
  const player = sim.player;
  player.facing = 0;
  const meta = sim.players.get(player.id);
  if (!meta) throw new Error('missing SwordMaster metadata');
  return { sim, player, meta };
}

function spawnTarget(
  sim: TestSim,
  player: Entity,
  dx: number,
  dz: number,
  templateId = 'forest_wolf',
): Entity {
  const mob = createMob(sim.nextId++, MOBS[templateId], 1, {
    x: player.pos.x + dx,
    y: player.pos.y,
    z: player.pos.z + dz,
  });
  mob.maxHp = 50000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

function resolve(sim: TestSim, abilityId: string, playerId: number): ResolvedAbility {
  const ability = sim.ctx.resolvedAbility(abilityId, playerId) as ResolvedAbility | null;
  if (!ability) throw new Error(`${abilityId} did not resolve`);
  return ability;
}

function abilityDamage(
  events: SimEvent[],
  ability: string,
): Extract<SimEvent, { type: 'damage' }>[] {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'damage' }> =>
      event.type === 'damage' && event.ability === ability,
  );
}

describe('SwordMaster paired strikes', () => {
  it('resolves the main hand first and the equipped off hand second', () => {
    const { sim, player, meta } = harness();
    const target = spawnTarget(sim, player, 0, 3);
    const resolved = resolve(sim, 'twin_slash', player.id);
    const calls: Parameters<SimContext['meleeSwing']>[] = [];
    const originalSwing = sim.ctx.meleeSwing;
    sim.ctx.meleeSwing = (...args) => {
      calls.push(args);
      return originalSwing(...args);
    };

    runEffects(sim.ctx, player, meta, target, resolved);

    const damage = abilityDamage(sim.drainEvents(), 'Twin Slash');
    expect(damage.map((event) => event.targetId)).toEqual([target.id, target.id]);
    expect(calls).toHaveLength(2);
    expect(calls[0][4]).toMatchObject({ weaponMult: 0.75 });
    expect(calls[0][4].weapon).toBeUndefined();
    expect(calls[1][4]).toMatchObject({
      weapon: player.offhandWeapon,
      weaponMult: 0.55,
      apSwingSpeed: player.offhandWeapon?.speed,
    });
  });

  it('stops the paired and area sequence when lethal spiked hide kills the attacker', () => {
    const run = (withLaterTarget: boolean) => {
      const { sim, player, meta } = harness(4242);
      const first = spawnTarget(sim, player, 0, 2, 'wild_boar');
      const later = withLaterTarget ? spawnTarget(sim, player, 0, 3) : null;
      player.hp = 1;
      player.mainhandItemId = 'kingsbane_last_oath';
      const resolved = resolve(sim, 'blade_dance', player.id);
      const targetCalls: number[] = [];
      const originalSwing = sim.ctx.meleeSwing;
      sim.ctx.meleeSwing = (...args) => {
        targetCalls.push(args[1].id);
        return originalSwing(...args);
      };
      const draws: number[] = [];
      sim.rng.setObserver((draw) => draws.push(draw));

      runEffects(sim.ctx, player, meta, null, resolved);
      sim.rng.setObserver(null);
      const events = sim.drainEvents();

      return {
        dead: player.dead,
        draws,
        targetCalls,
        firstId: first.id,
        laterHp: later?.hp,
        laterMaxHp: later?.maxHp,
        procDamage: events.filter(
          (event) => event.type === 'damage' && event.ability === 'Chain Arc',
        ),
      };
    };

    const isolated = run(false);
    const area = run(true);
    expect(area.dead).toBe(true);
    expect(area.targetCalls).toEqual([area.firstId]);
    expect(area.laterHp).toBe(area.laterMaxHp);
    expect(area.procDamage).toEqual([]);
    expect(area.draws).toEqual(isolated.draws);
    expect(area.draws).toHaveLength(3);
  });
});

describe('SwordMaster area ordering', () => {
  it('emits the authored activation cue when an area attack has no targets', () => {
    const { sim } = harness(1801);

    sim.castAbility('crescent_sweep');

    const events = sim.drainEvents();
    expect(events).toContainEqual({
      type: 'spellfx',
      sourceId: sim.player.id,
      targetId: sim.player.id,
      school: 'physical',
      fx: 'flourish',
      ability: 'crescent_sweep',
    });
    expect(events.some((event) => event.type === 'damage')).toBe(false);
  });

  it('selects front-facing targets by distance and then id before applying the cap', () => {
    const { sim, player } = harness();
    const far = spawnTarget(sim, player, 0, 4);
    const tiedLow = spawnTarget(sim, player, -1, 3);
    const tiedHigh = spawnTarget(sim, player, 1, 3);
    const nearest = spawnTarget(sim, player, 0, 2);
    spawnTarget(sim, player, 0, -1);

    const ordered = orderedSwordmasterTargets(sim.ctx, player, {
      type: 'dualWeaponAoe',
      mainhandMult: 1,
      offhandMult: 1,
      radius: 6,
      frontal: true,
      maxTargets: 3,
    });

    expect(ordered.map((target) => target.id)).toEqual([nearest.id, tiedLow.id, tiedHigh.id]);
    expect(ordered).not.toContain(far);
  });

  it('Crescent Sweep strikes each of only five selected targets twice in stable order', () => {
    const { sim, player, meta } = harness(7331);
    const targets = [
      spawnTarget(sim, player, 0, 1),
      spawnTarget(sim, player, 0, 2),
      spawnTarget(sim, player, 0, 3),
      spawnTarget(sim, player, 0, 4),
      spawnTarget(sim, player, 0, 5),
      spawnTarget(sim, player, 1, 5),
    ];
    const resolved = resolve(sim, 'crescent_sweep', player.id);

    runEffects(sim.ctx, player, meta, null, resolved);

    const damage = abilityDamage(sim.drainEvents(), 'Crescent Sweep');
    expect(damage.map((event) => event.targetId)).toEqual(
      targets.slice(0, 5).flatMap((target) => [target.id, target.id]),
    );
    expect(targets[5].hp).toBe(targets[5].maxHp);
  });

  it('replays the same target and damage sequence with the same seed and draw count', () => {
    const run = (): { events: SimEvent[]; draws: number } => {
      const { sim, player, meta } = harness(9901);
      spawnTarget(sim, player, -1, 2);
      spawnTarget(sim, player, 1, 2);
      spawnTarget(sim, player, 0, 3);
      const resolved = resolve(sim, 'crescent_sweep', player.id);
      let draws = 0;
      sim.rng.setObserver(() => {
        draws++;
      });
      runEffects(sim.ctx, player, meta, null, resolved);
      sim.rng.setObserver(null);
      return { events: abilityDamage(sim.drainEvents(), 'Crescent Sweep'), draws };
    };

    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.draws).toBeGreaterThan(0);
  });
});
