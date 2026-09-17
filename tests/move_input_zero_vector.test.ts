// Opposed movement keys held together (forward with back, strafe-left with
// strafe-right) net to a zero vector. The integrator must treat that as not
// moving: the v0.43.0 cast-move gate counted "any key held" as movement, so the
// zero vector reached the direction normalization, 0 / 0 became NaN, and the
// server position went NaN (the world froze for that player because a NaN
// position matches nothing in the interest scope, and unstuck later landed on
// an arbitrary graveyard). Pinned through the real Sim and through the gate.
import { describe, expect, it } from 'vitest';
import { hasMovementInput } from '../src/sim/combat/cast_move_gate';
import { sanitizeMoveInput } from '../src/sim/move_input';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';

const emptyMoveInput = () => sanitizeMoveInput({});

function finite(p: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function rig(cls: PlayerClass = 'shaman') {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer(cls, 'Opposed') as number;
  sim.setPlayerLevel(20, pid);
  // Let the spawn settle onto the ground before the input arrives.
  for (let i = 0; i < 10; i++) sim.tick();
  const me = sim.entities.get(pid) as Entity;
  const meta = sim.meta(pid)!;
  return { sim, pid, me, meta };
}

describe('opposed movement keys net to no movement', () => {
  it('hasMovementInput ignores keys that cancel each other', () => {
    const inp = emptyMoveInput();
    expect(hasMovementInput(inp)).toBe(false);
    inp.forward = true;
    inp.back = true;
    expect(hasMovementInput(inp)).toBe(false);
    inp.strafeLeft = true;
    inp.strafeRight = true;
    expect(hasMovementInput(inp)).toBe(false);
    // One side alone, or an uncancelled axis beside a cancelled one, moves.
    inp.back = false;
    expect(hasMovementInput(inp)).toBe(true);
    const strafeOnly = emptyMoveInput();
    strafeOnly.strafeRight = true;
    expect(hasMovementInput(strafeOnly)).toBe(true);
    const turnOnly = emptyMoveInput();
    turnOnly.turnLeft = true;
    turnOnly.jump = true;
    expect(hasMovementInput(turnOnly)).toBe(false);
  });

  it('forward plus back held together leaves the server position finite and in place', () => {
    const { sim, me, meta } = rig();
    const start = { ...me.pos };
    meta.moveInput.forward = true;
    meta.moveInput.back = true;
    for (let i = 0; i < 40; i++) {
      sim.tick();
      expect(finite(me.pos), `tick ${i + 1}: ${JSON.stringify(me.pos)}`).toBe(true);
    }
    expect(me.pos.x).toBeCloseTo(start.x, 6);
    expect(me.pos.z).toBeCloseTo(start.z, 6);
    // Releasing one key moves again, so the guard did not freeze the body.
    meta.moveInput.back = false;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(finite(me.pos)).toBe(true);
    expect(Math.hypot(me.pos.x - start.x, me.pos.z - start.z)).toBeGreaterThan(1);
  });

  it('strafe-left plus strafe-right held together is the same no-op', () => {
    const { sim, me, meta } = rig('mage');
    const start = { ...me.pos };
    meta.moveInput.strafeLeft = true;
    meta.moveInput.strafeRight = true;
    for (let i = 0; i < 40; i++) {
      sim.tick();
      expect(finite(me.pos), `tick ${i + 1}: ${JSON.stringify(me.pos)}`).toBe(true);
    }
    expect(me.pos.x).toBeCloseTo(start.x, 6);
    expect(me.pos.z).toBeCloseTo(start.z, 6);
  });

  it('opposed keys do not break a hard cast, because the body never moves', () => {
    const { sim, pid, me, meta } = rig('mage');
    // Fireball needs a hostile target: take the nearest living hostile mob and
    // stand it in front of the caster so the cast starts deterministically.
    const mob = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && !e.dead && e.hostile,
    ) as Entity;
    expect(mob).toBeDefined();
    mob.pos = { x: me.pos.x + 8, y: me.pos.y, z: me.pos.z };
    mob.prevPos = { ...mob.pos };
    sim.rebucket(mob);
    me.targetId = mob.id;
    sim.castAbilityOn('fireball', mob.id, pid);
    expect(me.castingAbility).toBe('fireball');
    meta.moveInput.forward = true;
    meta.moveInput.back = true;
    sim.tick();
    sim.tick();
    expect(me.castingAbility).toBe('fireball');
    expect(finite(me.pos)).toBe(true);
  });
});
