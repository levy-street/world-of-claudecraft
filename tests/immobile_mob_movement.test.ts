// An immobile mob must not be MOVED, and above all must not be dropped to the
// ground, by the shared movement step.
//
// Sim.moveToward ends every one of its paths by snapping pos.y to the terrain,
// and it did that even when the horizontal step was zero, which is the only
// step an immobile mob ever takes. For the seventeen stationary templates that
// stand on the floor anyway (eggs, dummies, a bell, quest NPCs) the snap was a
// no-op, which is why it went unseen. The eighteenth is the Deepglass Tidesow:
// an inert mob whose position is owned by the deepball physics and whose
// correct y is a hundred feet in the air. Once a strike put it in combat, the
// chase arm ran this every tick and wrote the ball onto the slate. The match
// restored pos immediately, so the sim looked right, but prevPos had already
// captured the floor, and the renderer interpolates prevPos -> pos, so the
// drawn ball strobed between the slate and the bell every single frame.
//
// The idle-wander arm in mob/locomotion.ts already carried this rule; chase,
// flee and evade did not. The guard now lives in the one place all four meet.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// moveToward is private on Sim, so this is a structural view rather than an
// intersection: `Sim & { moveToward(...) }` collapses to `never` against the
// private member of the same name.
interface SimInternals {
  nextId: number;
  addEntity(e: Entity): void;
  moveToward(e: Entity, dest: { x: number; y: number; z: number }, speed: number): boolean;
}

const inner = (sim: Sim): SimInternals => sim as unknown as SimInternals;

const AIR_Y = 40;
const DEST = { x: 30, y: 0.3, z: 30 };

function makeSim(): SimInternals {
  return inner(new Sim({ seed: 99, playerClass: 'warrior', autoEquip: true }));
}

function spawn(sim: SimInternals, templateId: string): Entity {
  const template = MOBS[templateId];
  if (!template) throw new Error(`no mob template ${templateId}`);
  const mob = createMob(sim.nextId++, template, 5, { x: 0, y: AIR_Y, z: 0 });
  sim.addEntity(mob);
  return mob;
}

describe('immobile mobs are never moved by the shared movement step', () => {
  it('leaves an immobile mob exactly where it is, in the air', () => {
    const sim = makeSim();
    const dummy = spawn(sim, 'training_dummy');
    expect(dummy.moveSpeed).toBe(0);

    const arrived = sim.moveToward(dummy, DEST, dummy.moveSpeed * 0.35);

    expect(arrived).toBe(false); // it can never get there
    expect(dummy.pos.y).toBe(AIR_Y); // and it is NOT snapped to the terrain
    expect(dummy.pos.x).toBe(0);
    expect(dummy.pos.z).toBe(0);
  });

  it('still turns it to face the destination, which is the half worth keeping', () => {
    const sim = makeSim();
    const dummy = spawn(sim, 'training_dummy');
    dummy.facing = 0;
    sim.moveToward(dummy, DEST, 0);
    // Anything but the untouched 0: a dummy under attack should still look at
    // what is hitting it.
    expect(dummy.facing).not.toBe(0);
    expect(dummy.facing).toBeCloseTo(Math.atan2(DEST.x, DEST.z), 5);
  });

  it('covers the Tidesow, whose correct height is nowhere near the ground', () => {
    const sim = makeSim();
    const ball = spawn(sim, 'deepglass_ball');
    expect(ball.moveSpeed).toBe(0);
    sim.moveToward(ball, DEST, ball.moveSpeed);
    expect(ball.pos.y).toBe(AIR_Y);
  });

  it('leaves a mob that CAN move alone: it walks, and it does land on the ground', () => {
    const sim = makeSim();
    const walker = Object.values(MOBS).find((m) => (m.moveSpeed ?? 0) > 0);
    if (!walker) throw new Error('no mobile mob template to contrast against');
    const mob = spawn(sim, walker.id);

    sim.moveToward(mob, DEST, mob.moveSpeed);

    expect(Math.hypot(mob.pos.x, mob.pos.z)).toBeGreaterThan(0);
    expect(mob.pos.y).toBeLessThan(AIR_Y); // the ground snap is intact for movers
  });
});
