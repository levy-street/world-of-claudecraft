// Wind drift (src/sim/wind_drift.ts): the pure drift read off the aura, the
// shared motion kernel carrying a body on the live Sim (it drifts at the
// wind's speed, walks against it at its run less the wind, keeps casting
// while carried, is drawn toward a pull's point and stops short of it), its
// bit-for-bit parity with the client-shaped kernel the online prediction
// runs, and the server's step check allowing a walk plus the wind (no
// override epoch: the client keeps predicting through a blow).

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
  type Aura,
  DT,
  type Entity,
  type MoveInput,
  RUN_SPEED,
  type WorldContent,
} from '../src/sim/types';
import {
  WIND_DRIFT_AURA,
  WIND_PULL_AURA,
  WIND_PULL_STOP,
  windDrift,
  windDriftSpeed,
} from '../src/sim/wind_drift';
import { terrainHeight } from '../src/sim/world';

const SEED = 42;
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function wind(heading: number, speed: number): Aura {
  return {
    id: WIND_DRIFT_AURA,
    name: 'Bellows Wind',
    kind: 'internal_cd',
    remaining: 600,
    duration: 600,
    value: heading,
    value2: speed,
    sourceId: 0,
    school: 'nature',
  };
}

function pull(x: number, z: number, speed: number): Aura {
  return { ...wind(0, 0), id: WIND_PULL_AURA, value: x, value2: z, value3: speed };
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

describe('wind drift: the pure read', () => {
  it('reads a wind as heading and speed, a pull toward its point, nothing else', () => {
    const out = { x: 9, z: 9 };
    expect(windDrift({ auras: [], pos: { x: 0, y: 0, z: 0 } }, out)).toBe(false);
    expect(out).toEqual({ x: 0, z: 0 });
    expect(windDrift({ auras: [wind(Math.PI / 2, 3)], pos: { x: 0, y: 0, z: 0 } }, out)).toBe(true);
    expect(out.x).toBeCloseTo(3, 9);
    expect(out.z).toBeCloseTo(0, 9);
    // A pull draws toward its point at its speed, and stops short of it.
    expect(windDrift({ auras: [pull(0, 10, 4)], pos: { x: 0, y: 0, z: 0 } }, out)).toBe(true);
    expect(out.z).toBeCloseTo(4, 9);
    const near = { x: 0, y: 0, z: 10 - WIND_PULL_STOP * 0.9 };
    expect(windDrift({ auras: [pull(0, 10, 4)], pos: near }, out)).toBe(false);
    // Worn together, the pull wins (the indrawn breath replaces the blow).
    expect(
      windDrift({ auras: [wind(Math.PI / 2, 3), pull(0, 10, 4)], pos: { x: 0, y: 0, z: 0 } }, out),
    ).toBe(true);
    expect(out.x).toBeCloseTo(0, 9);
    expect(windDriftSpeed({ auras: [wind(0, 3), pull(0, 0, 4)] })).toBe(4);
    expect(windDriftSpeed({ auras: [] })).toBe(0);
  });
});

describe('wind drift: the motion kernel on the live Sim', () => {
  it('carries an idle body at the wind speed, and a walk against it makes headway', () => {
    const idle = makeSim();
    idle.player.auras.push(wind(Math.PI / 2, 3.2));
    const x0 = idle.player.pos.x;
    hold(idle, mi(), 40);
    const rate = (idle.player.pos.x - x0) / (40 * DT);
    expect(rate).toBeGreaterThan(3.2 - 0.4);
    expect(rate).toBeLessThan(3.2 + 0.4);
    // Facing into the wind (west) and running: a run less the wind.
    const walker = makeSim();
    walker.player.auras.push(wind(Math.PI / 2, 3.2));
    walker.player.facing = -Math.PI / 2;
    const w0 = walker.player.pos.x;
    hold(walker, mi({ forward: true }), 40);
    const per = (w0 - walker.player.pos.x) / (40 * DT);
    expect(per).toBeGreaterThan(RUN_SPEED - 3.2 - 0.4);
    expect(per).toBeLessThan(RUN_SPEED - 3.2 + 0.4);
  });

  it('keeps a cast going while the wind carries the caster (the drift is no input)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'mage', autoEquip: true, world: WORLD });
    sim.setPlayerLevel(20);
    const p = sim.player;
    p.castingAbility = 'frostbolt';
    p.castRemaining = 2;
    p.castTotal = 2;
    p.auras.push(wind(0, 3.5));
    const z0 = p.pos.z;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('no meta');
    Object.assign(meta.moveInput, mi());
    const deps: PlayerMotionDeps = {
      ...clientDeps(SEED),
      cancelCast: () => (p.castingAbility = null),
    };
    for (let i = 0; i < 10; i++) stepPlayerMotion(deps, p, mi());
    expect(p.pos.z).toBeGreaterThan(z0 + 1);
    expect(p.castingAbility).toBe('frostbolt');
  });

  it('draws a body toward a pull and stops it short of the point', () => {
    const sim = makeSim();
    const p = sim.player;
    const to = { x: p.pos.x, z: p.pos.z + 8 };
    p.auras.push(pull(to.x, to.z, 4));
    hold(sim, mi(), 60);
    const left = Math.hypot(p.pos.x - to.x, p.pos.z - to.z);
    expect(left).toBeGreaterThan(WIND_PULL_STOP - 0.25);
    expect(left).toBeLessThan(WIND_PULL_STOP + 0.25);
  });

  it('steps the client-shaped kernel bit for bit with the live Sim in the wind', () => {
    const sim = makeSim();
    sim.player.auras.push(wind(0.7, 3.2));
    const deps = clientDeps(SEED);
    const p = sim.player;
    const actor: Entity = { ...p, pos: { ...p.pos }, prevPos: { ...p.prevPos } };
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('no meta');
    const script: Partial<MoveInput>[] = [
      ...Array(20).fill({}),
      ...Array(20).fill({ forward: true }),
      ...Array(10).fill({ forward: true, turnLeft: true }),
      ...Array(10).fill({ jump: true }),
      ...Array(15).fill({ strafeRight: true }),
    ];
    for (const [i, step] of script.entries()) {
      const input = mi(step);
      Object.assign(meta.moveInput, input);
      actor.prevPos = { ...actor.pos };
      stepPlayerMotion(deps, actor, input);
      sim.tick();
      expect(actor.pos.x, `tick ${i} x`).toBe(p.pos.x);
      expect(actor.pos.z, `tick ${i} z`).toBe(p.pos.z);
      expect(actor.pos.y, `tick ${i} y`).toBe(p.pos.y);
    }
  });
});

describe('wind drift: the server step check', () => {
  it('never reads a walk carried by the wind as a server-driven move', () => {
    const sim = makeSim();
    const session: MovementOverrideSessionState = {
      pid: sim.playerId,
      movementWireVersion: 2,
      ...createMovementOverrideSessionState(),
    };
    updateMovementOverrideEpochs(sim, [session]);
    const e0 = session.movementOverrideEpoch;
    sim.player.auras.push(wind(0, 3.5));
    sim.player.facing = 0;
    for (let i = 0; i < 40; i++) {
      hold(sim, mi({ forward: true }), 1);
      updateMovementOverrideEpochs(sim, [session]);
    }
    // Downwind at a full run: faster than a run alone, never an override.
    expect(session.movementOverrideEpoch).toBe(e0);
    expect(session.movementOverrideActive).toBe(false);
  });
});
