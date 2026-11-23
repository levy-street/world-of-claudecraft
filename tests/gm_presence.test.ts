import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { gmHiddenFrom, isGmHidden, setGmHidden } from '../src/sim/gm_presence';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Staff invisibility (/visible off, src/sim/gm_presence.ts): no mob aggroes or
// keeps a hidden GM, no other player or pet can target them (hostile or
// friendly), and the flag outlives death so the corpse stays hidden. The
// snapshot half (canObserveEntity) reads the same gmHiddenFrom predicate.

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
  aggroMob(mob: Entity, target: Entity, social: boolean): boolean;
};

function world(): TestSim {
  const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  return sim;
}

function addMob(sim: TestSim, ownerId: number | null = null): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 3,
  });
  mob.ownerId = ownerId;
  mob.hostile = ownerId === null;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

// A rival in an active duel with the GM, so the pair is genuinely hostile and
// the test proves invisibility overrides even an explicit PvP arm.
function duelRival(sim: TestSim): Entity {
  const rivalId = sim.addPlayer('warrior', 'Rival');
  const duel = {
    a: sim.playerId,
    b: rivalId,
    state: 'active' as const,
    timer: 0,
    controlled: new Map(),
  };
  sim.ctx.duels.set(sim.playerId, duel);
  sim.ctx.duels.set(rivalId, duel);
  const rival = sim.entities.get(rivalId);
  if (!rival) throw new Error('rival missing');
  return rival;
}

function friend(sim: TestSim): Entity {
  const e = sim.entities.get(sim.addPlayer('priest', 'Friend'));
  if (!e) throw new Error('friend missing');
  return e;
}

describe('GM invisibility (gm_presence)', () => {
  it('releases every lock on the GM and their pet when hiding', () => {
    const sim = world();
    const gm = sim.player;
    const pet = addMob(sim, gm.id);
    const rival = duelRival(sim);
    const ally = friend(sim);
    const mob = addMob(sim);
    expect(sim.aggroMob(mob, gm, false)).toBe(true);
    rival.targetId = gm.id;
    rival.autoAttack = true;
    ally.targetId = pet.id;
    mob.forcedTargetId = gm.id;
    mob.forcedTargetTimer = 3;

    setGmHidden(sim.ctx, gm, true);

    expect(gm.gmHidden).toBe(true);
    expect(isGmHidden(sim.entities, pet)).toBe(true);
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.forcedTargetId).toBeNull();
    expect(mob.forcedTargetTimer).toBe(0);
    expect(rival.targetId).toBeNull();
    expect(rival.autoAttack).toBe(false);
    expect(ally.targetId).toBeNull();
  });

  it('makes the GM and their pet untargetable by anyone else, but not by the GM', () => {
    const sim = world();
    const gm = sim.player;
    const pet = addMob(sim, gm.id);
    const rival = duelRival(sim);
    const ally = friend(sim);
    expect(sim.isHostileTo(rival, gm)).toBe(true); // the duel arm, before hiding

    setGmHidden(sim.ctx, gm, true);

    expect(sim.isHostileTo(rival, gm)).toBe(false);
    expect(sim.isHostileTo(rival, pet)).toBe(false);
    expect(sim.ctx.isFriendlyTo(ally, gm)).toBe(false);
    expect(sim.ctx.isFriendlyTo(ally, pet)).toBe(false);
    expect(gmHiddenFrom(sim.entities, ally, gm)).toBe(true);
    // The GM still sees and supports their own pet, and the pet its owner.
    expect(gmHiddenFrom(sim.entities, gm, pet)).toBe(false);
    expect(gmHiddenFrom(sim.entities, pet, gm)).toBe(false);
    expect(sim.ctx.isFriendlyTo(gm, pet)).toBe(true);

    // A forged target command (the GM never reached that client) is refused.
    sim.targetEntity(gm.id, rival.id);
    expect(rival.targetId).toBeNull();
    sim.targetEntity(pet.id, ally.id);
    expect(ally.targetId).toBeNull();
  });

  it('keeps mobs from pulling or tracking a hidden GM', () => {
    const sim = world();
    const gm = sim.player;
    const mob = addMob(sim);
    setGmHidden(sim.ctx, gm, true);
    expect(sim.aggroMob(mob, gm, false)).toBe(false);
    expect(mob.aiState).toBe('idle');
    for (let i = 0; i < 40; i++) sim.tick();
    expect(mob.aggroTargetId).not.toBe(gm.id);
    expect(mob.targetId).not.toBe(gm.id);
  });

  it('stays hidden through death so the corpse is hidden too, and clears on reveal', () => {
    const sim = world();
    const gm = sim.player;
    const rival = duelRival(sim);
    setGmHidden(sim.ctx, gm, true);
    sim.dealDamage(null, gm, gm.maxHp + 1, false, 'physical', null, 'hit', true);
    expect(gm.dead).toBe(true);
    expect(gm.gmHidden).toBe(true);
    expect(gmHiddenFrom(sim.entities, rival, gm)).toBe(true);

    setGmHidden(sim.ctx, gm, false);
    expect('gmHidden' in gm).toBe(false); // inert again, nothing for parity to sample
    expect(gmHiddenFrom(sim.entities, rival, gm)).toBe(false);
  });
});
