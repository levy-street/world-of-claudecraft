// Slippery ground (src/sim/slippery_ground.ts): the pure slide step, the
// shared motion kernel's ice momentum on the live Sim (a run builds, a stop
// slides on, a turn swings wide, never faster than a run), its bit-for-bit
// parity with the client-shaped kernel the online prediction runs, and the
// movement override epoch bumping on the ice's edge without ever marking the
// player overridden.

import { describe, expect, it } from 'vitest';
import {
  createMovementOverrideSessionState,
  type MovementOverrideSessionState,
  updateMovementOverrideEpochs,
} from '../server/movement_override_epoch';
import { moverHeight, resolveMovement } from '../src/sim/colliders';
import { BUILTIN_WORLD } from '../src/sim/data';
import { moveSpeedMult, type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import {
  SLIPPERY_DEFAULT_GRIP,
  SLIPPERY_GROUND_AURA,
  SLIPPERY_REST_SPEED,
  slideVelocity,
  slipperyGrip,
} from '../src/sim/slippery_ground';
import {
  type Aura,
  DT,
  type Entity,
  type MoveInput,
  RUN_SPEED,
  type WorldContent,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const SEED = 42;
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function ice(grip?: number): Aura {
  return {
    id: SLIPPERY_GROUND_AURA,
    name: 'Rime-Slick',
    kind: 'slow',
    remaining: 600,
    duration: 600,
    value: 1,
    ...(grip !== undefined ? { value2: grip } : {}),
    sourceId: 0,
    school: 'frost',
  };
}

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

function makeSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world: WORLD });
  sim.setPlayerLevel(60);
  const p = sim.player;
  p.pos.x = 0;
  p.pos.z = -40;
  p.pos.y = terrainHeight(0, -40, SEED);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = true;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  p.facing = 0;
  return sim;
}

function hold(sim: Sim, input: MoveInput, ticks: number): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('no meta');
  for (let i = 0; i < ticks; i++) {
    Object.assign(meta.moveInput, input);
    sim.tick();
  }
}

function clientDeps(seed: number): PlayerMotionDeps {
  return {
    seed,
    moveSpeedMult: (e) => moveSpeedMult(e, 0),
    resolveMove: (fromX, fromZ, nx, nz, r, e, ignoreFences) =>
      resolveMovement(seed, fromX, fromZ, nx, nz, r, ignoreFences, undefined, moverHeight(e), 0),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}

describe('slippery ground: the pure slide step', () => {
  it('steers toward the wish by at most the grip, as a vector, capped', () => {
    const out = { x: 0, z: 0 };
    slideVelocity(0, 0, 0, 7, 8, 7, DT, out);
    expect(out.z).toBeCloseTo(8 * DT, 9);
    expect(out.x).toBe(0);
    // A reversal only bleeds the grip's worth a tick: the turn swings wide.
    slideVelocity(0, 7, 0, -7, 8, 7, DT, out);
    expect(out.z).toBeCloseTo(7 - 8 * DT, 9);
    // Never faster than the cap.
    slideVelocity(7, 7, 7, 7, 1000, 7, DT, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(7, 9);
    // No keys: a crawl under the rest speed stops dead.
    slideVelocity(0, SLIPPERY_REST_SPEED * 0.5, 0, 0, 0.01, 7, DT, out);
    expect(out.z).toBe(0);
  });

  it('reads the grip off the aura (value2) or the default, 0 off the ice', () => {
    expect(slipperyGrip({ auras: [] })).toBe(0);
    expect(slipperyGrip({ auras: [ice()] })).toBe(SLIPPERY_DEFAULT_GRIP);
    expect(slipperyGrip({ auras: [ice(5)] })).toBe(5);
  });
});

describe('slippery ground: the motion kernel on the live Sim', () => {
  it('builds a run, slides on after the keys let go, and never outruns a run', () => {
    const plain = makeSim();
    const slick = makeSim();
    slick.player.auras.push(ice());
    // A held run for one second.
    hold(plain, mi({ forward: true }), 20);
    hold(slick, mi({ forward: true }), 20);
    const plainRun = plain.player.pos.z - -40;
    const slickRun = slick.player.pos.z - -40;
    expect(plainRun).toBeCloseTo(RUN_SPEED, 1);
    // Building speed costs ground on the ice.
    expect(slickRun).toBeLessThan(plainRun - 1);
    // Let go: the plain body stops dead, the slick one slides on.
    const plainStop = plain.player.pos.z;
    const slickStop = slick.player.pos.z;
    hold(plain, mi(), 20);
    hold(slick, mi(), 20);
    expect(plain.player.pos.z).toBeCloseTo(plainStop, 6);
    expect(slick.player.pos.z - slickStop).toBeGreaterThan(1.5);
    // ...and comes to rest.
    expect(slick.player.vx).toBe(0);
    expect(slick.player.vz).toBe(0);
    // Every step stayed within a run's reach.
    const s2 = makeSim();
    s2.player.auras.push(ice(1000));
    for (let i = 0; i < 40; i++) {
      const before = { ...s2.player.pos };
      hold(s2, mi({ forward: true }), 1);
      expect(
        Math.hypot(s2.player.pos.x - before.x, s2.player.pos.z - before.z),
      ).toBeLessThanOrEqual(RUN_SPEED * DT + 1e-6);
    }
  });

  it('clears the ground velocity the moment the ice is gone', () => {
    const sim = makeSim();
    sim.player.auras.push(ice());
    hold(sim, mi({ forward: true }), 20);
    sim.player.auras = sim.player.auras.filter((a) => a.id !== SLIPPERY_GROUND_AURA);
    const z = sim.player.pos.z;
    hold(sim, mi(), 2);
    expect(sim.player.vz).toBe(0);
    expect(sim.player.pos.z).toBeCloseTo(z, 6);
  });

  it('steps the client-shaped kernel bit for bit with the live Sim on the ice', () => {
    const sim = makeSim();
    sim.player.auras.push(ice());
    const deps = clientDeps(SEED);
    const p = sim.player;
    const actor: Entity = { ...p, pos: { ...p.pos }, prevPos: { ...p.prevPos } };
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('no meta');
    const script: Partial<MoveInput>[] = [
      ...Array(25).fill({ forward: true }),
      ...Array(10).fill({ forward: true, turnLeft: true }),
      ...Array(15).fill({ strafeRight: true }),
      ...Array(20).fill({}),
    ];
    for (const [i, step] of script.entries()) {
      const input = mi(step);
      Object.assign(meta.moveInput, input);
      actor.prevPos = { ...actor.pos };
      stepPlayerMotion(deps, actor, input);
      sim.tick();
      expect(actor.pos.x, `tick ${i} x`).toBe(p.pos.x);
      expect(actor.pos.z, `tick ${i} z`).toBe(p.pos.z);
      expect(actor.vx, `tick ${i} vx`).toBe(p.vx);
      expect(actor.vz, `tick ${i} vz`).toBe(p.vz);
    }
  });
});

describe('slippery ground: the movement override epoch', () => {
  it('marks the player overridden on the ice (prediction stands down) and bumps on its edge', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const session: MovementOverrideSessionState = {
      pid: sim.playerId,
      movementWireVersion: 2,
      ...createMovementOverrideSessionState(),
    };
    updateMovementOverrideEpochs(sim, [session]);
    const e0 = session.movementOverrideEpoch;
    sim.player.auras.push(ice());
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(e0 + 1);
    expect(session.movementOverrideActive).toBe(true);
    // Standing on it: no further bump.
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(e0 + 1);
    sim.player.auras = [];
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(e0 + 2);
    expect(session.movementOverrideActive).toBe(false);
  });
});
