// The Highwatch training dummy: a stationary, near-immortal practice target. It is
// attackable (so it counts for damage and the combat meters) but never aggros, moves,
// or retaliates; it drops combat and heals to full a few seconds after the last hit,
// and respawns on its own short timer if somehow felled.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function dummyOf(sim: Sim): Entity {
  const d = [...sim.entities.values()].find((e) => e.templateId === 'training_dummy' && !e.dead);
  if (!d) throw new Error('training dummy not spawned');
  return d;
}

function meleePlayerAt(sim: Sim, x: number, z: number): number {
  const pid = sim.addPlayer('warrior', 'Tester', { autoEquip: true });
  sim.setPlayerLevel(20, pid); // cap level: an even fight with the level-20 dummy
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
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
    const player = sim.entities.get(pid)!;
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
    const player = sim.entities.get(pid)!;
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

  it('records Goad threat without turning and eventually releases combat', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    const pid = meleePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const player = sim.entities.get(pid)!;
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

  it('keeps Defiant Bellow inert and fully repairs any hostile dummy state', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    const pid = meleePlayerAt(sim, d.pos.x + 1, d.pos.z);
    const player = sim.entities.get(pid)!;
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
    const player = sim.entities.get(pid)!;
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
    expect(back).toBeDefined();
    expect(back!.hp).toBe(back!.maxHp);
  });
});
