import { describe, expect, it } from 'vitest';
import { hasMovementInput } from '../src/sim/combat/cast_move_gate';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { MoveInput, WorldContent } from '../src/sim/types';

// Holding two opposing movement keys (strafe left + strafe right, forward +
// back) sums to a zero wish vector. It used to still count as "moving", so
// player_motion normalised the zero vector into NaN, and the NaN pose guard
// snapped the body back to its start-of-tick pose every tick with vy and
// fallStartY reset: a player could hover mid-air and land with no fall damage.

const SEED = 42;
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const DROP = 30; // yards, well past FALL_SAFE_DISTANCE

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
  ...over,
});

interface FallResult {
  ticks: number;
  damage: number;
  lowestY: number;
  startY: number;
}

function dropPlayer(input: MoveInput): FallResult {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world: WORLD });
  sim.setPlayerLevel(60);
  const p = sim.player;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('missing player meta');
  p.pos.y += DROP;
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = false;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  const startY = p.pos.y;
  const hp0 = p.hp;
  Object.assign(meta.moveInput, input);
  let ticks = 0;
  let lowestY = startY;
  while (!p.onGround && ticks < 400) {
    sim.tick();
    ticks++;
    lowestY = Math.min(lowestY, p.pos.y);
  }
  return { ticks, damage: hp0 - p.hp, lowestY, startY };
}

describe('opposing movement keys', () => {
  it('cancel out to no movement input on each axis', () => {
    expect(hasMovementInput(mi({ strafeLeft: true, strafeRight: true }))).toBe(false);
    expect(hasMovementInput(mi({ forward: true, back: true }))).toBe(false);
    expect(
      hasMovementInput(mi({ forward: true, back: true, strafeLeft: true, strafeRight: true })),
    ).toBe(false);
    expect(hasMovementInput(mi({ strafeLeft: true }))).toBe(true);
    expect(hasMovementInput(mi({ forward: true, back: true, strafeRight: true }))).toBe(true);
    expect(hasMovementInput(mi({ strafeLeft: true, strafeRight: true, forward: true }))).toBe(true);
  });

  it('holding strafe left and right mid-air falls and takes fall damage like no input', () => {
    const idle = dropPlayer(mi());
    expect(idle.ticks).toBeLessThan(400);
    expect(idle.damage).toBeGreaterThan(0);

    const both = dropPlayer(mi({ strafeLeft: true, strafeRight: true }));
    expect(both.lowestY).toBeLessThan(both.startY - DROP / 2);
    expect(both.ticks).toBe(idle.ticks);
    expect(both.damage).toBe(idle.damage);
  });

  it('holding forward and back mid-air falls and takes fall damage like no input', () => {
    const idle = dropPlayer(mi());
    const both = dropPlayer(mi({ forward: true, back: true }));
    expect(both.ticks).toBe(idle.ticks);
    expect(both.damage).toBe(idle.damage);
  });
});
