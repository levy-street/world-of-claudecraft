// The Highwatch training dummy: a stationary, near-immortal practice target. It is
// attackable (so it counts for damage and the combat meters) but never aggros, moves,
// or retaliates; it drops combat and heals to full a few seconds after the last hit,
// and respawns on its own short timer if somehow felled.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';
import { type Entity, PLAYER_INTEREST_DROP_RADIUS } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type RebucketSim = Sim & {
  rebucket(entity: Entity): void;
};

// This suite only ever targets the fixed Highwatch training-dummy camp entry
// (zone3.ts: { mobId: 'training_dummy', center: {x:-40,z:648}, radius:0, count:1 })
// plus the hardcoded healer practice dummy (spawnHealerPracticeDummy, gated only on
// noPlayer+devCommands, spawned unconditionally regardless of cfg.world). No other
// camp, npc, or ground object is ever targeted or asserted on, so the full built-in
// world was pure Sim-construction overhead here.
const TRAINING_DUMMY_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === 'training_dummy'),
  npcs: {},
  groundObjects: [],
};

function makeWorld() {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    devCommands: true,
    world: TRAINING_DUMMY_TEST_WORLD,
  });
}

function dummyOf(sim: Sim): Entity {
  const d = [...sim.entities.values()].find((e) => e.templateId === 'training_dummy' && !e.dead);
  if (!d) throw new Error('training dummy not spawned');
  return d;
}

function healingDummyOf(sim: Sim): Entity {
  const d = [...sim.entities.values()].find((e) => e.friendlyPracticeTarget && !e.dead);
  if (!d) throw new Error('healing dummy not spawned');
  return d;
}

function entityById(sim: Sim, id: number): Entity {
  const entity = sim.entities.get(id);
  if (!entity) throw new Error(`entity ${id} not found`);
  return entity;
}

function moveEntityTo(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos.x = x;
  entity.pos.z = z;
  entity.pos.y = groundHeight(x, z, sim.cfg.seed);
  entity.prevPos = { ...entity.pos };
  (sim as RebucketSim).rebucket(entity);
}

function meleePlayerAt(sim: Sim, x: number, z: number): number {
  const pid = sim.addPlayer('warrior', 'Tester', { autoEquip: true });
  sim.setPlayerLevel(20, pid); // cap level: an even fight with the level-20 dummy
  moveEntityTo(sim, entityById(sim, pid), x, z);
  return pid;
}

function roguePlayerAt(sim: Sim, x: number, z: number): number {
  const pid = sim.addPlayer('rogue', 'Ivara', { autoEquip: true });
  sim.setPlayerLevel(18, pid);
  moveEntityTo(sim, entityById(sim, pid), x, z);
  return pid;
}

function priestPlayerAt(sim: Sim, x: number, z: number): number {
  const pid = sim.addPlayer('priest', 'Healer', { autoEquip: true });
  sim.setPlayerLevel(20, pid);
  moveEntityTo(sim, entityById(sim, pid), x, z);
  return pid;
}

describe('Highwatch training dummy', () => {
  it('spawns on the hill above Highwatch, attackable but inert', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    expect(d.hostile).toBe(true); // attackable
    expect(d.aiState).toBe('idle');
    expect(Math.round(d.pos.x)).toBe(-40);
    expect(Math.round(d.pos.z)).toBe(648);
    expect(d.maxHp).toBeGreaterThan(100000); // near-immortal
  });

  it('takes damage without ever aggroing or retaliating', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    const pid = meleePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const player = entityById(sim, pid);
    player.targetId = d.id;
    player.autoAttack = true;
    const startHp = d.hp;
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(d.hp).toBeLessThan(startHp); // damage landed and counts
    expect(d.aggroTargetId).toBe(null); // never aggros
    expect(d.aiState).toBe('idle'); // never moves to attack
    expect(player.hp).toBe(player.maxHp); // never fights back
  });

  it('drops combat and heals to full a few seconds after the last hit', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    const pid = meleePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const player = entityById(sim, pid);
    player.targetId = d.id;
    player.autoAttack = true;
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(d.hp).toBeLessThan(d.maxHp);
    // Stop hitting it; after the reset window it heals to full and leaves combat.
    player.autoAttack = false;
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(d.hp).toBe(d.maxHp);
    expect(d.inCombat).toBe(false);
  });

  it('continues an idle combat reset after the player leaves the culling radius', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
      world: TRAINING_DUMMY_TEST_WORLD,
    });
    const d = dummyOf(sim);
    const pid = meleePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const player = entityById(sim, pid);
    player.targetId = d.id;
    player.autoAttack = true;

    for (let i = 0; i < 20 * 4 && d.hp === d.maxHp; i++) sim.tick();
    expect(d.hp).toBeLessThan(d.maxHp);
    expect(d.inCombat).toBe(true);

    player.autoAttack = false;
    moveEntityTo(sim, player, d.pos.x + PLAYER_INTEREST_DROP_RADIUS + 20, d.pos.z);
    for (let i = 0; i < 20 * 7; i++) sim.tick();

    expect(d.hp).toBe(d.maxHp);
    expect(d.inCombat).toBe(false);
    expect(d.threat.size).toBe(0);
  });
  it('records Goad threat without turning and eventually releases combat', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    const pid = meleePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const player = entityById(sim, pid);
    player.targetId = d.id;

    sim.castAbility('taunt', pid);

    expect(d.threat.get(pid)).toBeGreaterThan(0);
    expect(d.aiState).toBe('idle');
    expect(d.aggroTargetId).toBe(null);
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(player.inCombat).toBe(false);
    expect(d.inCombat).toBe(false);
    expect(d.threat.size).toBe(0);
  });

  it('lets Smokestep escape dummy combat without keeping target pressure', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    const pid = roguePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const rogue = entityById(sim, pid);
    rogue.targetId = d.id;
    rogue.autoAttack = true;
    for (let i = 0; i < 20 * 4 && d.hp === d.maxHp; i++) sim.tick();

    expect(d.hp).toBeLessThan(d.maxHp);
    expect(rogue.inCombat).toBe(true);
    expect(rogue.autoAttack).toBe(true);
    expect(rogue.targetId).toBe(d.id);
    expect(d.threat.has(pid)).toBe(true);

    sim.castAbility('vanish', pid);

    expect(rogue.auras.some((a) => a.name === 'Smokestep' && a.kind === 'stealth')).toBe(true);
    expect(rogue.cooldowns.has('vanish')).toBe(true);
    expect(rogue.inCombat).toBe(false);
    expect(rogue.autoAttack).toBe(false);
    expect(rogue.targetId).toBeNull();
    expect(d.threat.has(pid)).toBe(false);
    expect(d.aggroTargetId).toBeNull();

    sim.tick();

    expect(rogue.auras.some((a) => a.name === 'Smokestep' && a.kind === 'stealth')).toBe(true);
    expect(rogue.inCombat).toBe(false);
    expect(rogue.autoAttack).toBe(false);
  });

  it('keeps Defiant Bellow inert and fully repairs any hostile dummy state', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    const pid = meleePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const player = entityById(sim, pid);
    expect(sim.setSpec('prot', pid)).toBe(true);

    sim.castAbility('defiant_bellow', pid);
    expect(d.threat.get(pid)).toBeGreaterThan(0);
    expect(d.aiState).toBe('idle');
    expect(d.aggroTargetId).toBe(null);

    d.aiState = 'attack';
    d.aggroTargetId = pid;
    d.forcedTargetId = pid;
    d.forcedTargetTimer = 6;
    d.threat.set(pid, 100);
    d.combatTimer = 0;
    for (let i = 0; i < 20 * 7; i++) sim.tick();

    expect(d.aiState).toBe('idle');
    expect(d.aggroTargetId).toBe(null);
    expect(d.forcedTargetId).toBe(null);
    expect(d.forcedTargetTimer).toBe(0);
    expect(d.threat.size).toBe(0);
    expect(player.inCombat).toBe(false);
  });

  it('respawns on its own short timer when felled', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    d.hp = 1; // set up a killing blow
    const pid = meleePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const player = entityById(sim, pid);
    player.targetId = d.id;
    player.autoAttack = true;
    for (let i = 0; i < 20 * 6 && !d.dead; i++) sim.tick();
    expect(d.dead).toBe(true);
    expect(d.respawnTimer).toBeLessThanOrEqual(10); // the fixed 10s dummy respawn
    // run past the respawn and confirm a fresh, full-health dummy is back
    for (let i = 0; i < 20 * 12; i++) sim.tick();
    const back = [...sim.entities.values()].find(
      (e) => e.templateId === 'training_dummy' && !e.dead,
    );
    if (!back) throw new Error('training dummy did not respawn');
    expect(back.hp).toBe(back.maxHp);
  });

  it('spawns a friendly healer practice dummy that friendly targeting can select', () => {
    const sim = makeWorld();
    const d = healingDummyOf(sim);
    const pid = priestPlayerAt(sim, d.pos.x - 6, d.pos.z);
    const priest = entityById(sim, pid);

    expect(d.hostile).toBe(false);
    expect(d.templateId).toBe('training_dummy');
    expect(d.name).toBe('Healing Dummy');
    expect(d.aiState).toBe('idle');
    expect(Math.round(d.pos.x)).toBe(-34);
    expect(Math.round(d.pos.z)).toBe(648);
    sim.tick();
    sim.targetNearestFriendly(pid);

    expect(priest.targetId).toBe(d.id);
    expect(priest.autoAttack).toBe(false);
    expect(sim.isHostileTo(priest, d)).toBe(false);
  });

  it('accepts repeated friendly heals without creating hostile combat', () => {
    const sim = makeWorld();
    const d = healingDummyOf(sim);
    const pid = priestPlayerAt(sim, d.pos.x - 5, d.pos.z);
    const priest = entityById(sim, pid);
    priest.targetId = d.id;

    for (let cast = 0; cast < 3; cast++) {
      sim.castAbility('lesser_heal', pid);
      for (let i = 0; i < 20 * 3; i++) sim.tick();
    }

    expect(d.hp).toBe(d.maxHp);
    expect(d.dead).toBe(false);
    expect(d.inCombat).toBe(false);
    expect(d.threat.size).toBe(0);
    expect(priest.inCombat).toBe(false);
    expect(priest.autoAttack).toBe(false);
  });
});
