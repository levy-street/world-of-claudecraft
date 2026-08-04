import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so importing server/game (for wireEntity) needs no Postgres,
// mirroring tests/mounts.test.ts / tests/snapshots.test.ts.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { wireEntity } from '../server/game';
import { isBlocked, resolveMovement } from '../src/sim/colliders';
import { MOUNT_SUMMON_SECONDS, summonMountItem, toggleMount } from '../src/sim/mounts';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import {
  isSwimming,
  moveSpeedMult,
  type PlayerMotionDeps,
  stepPlayerMotion,
} from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type MoveInput } from '../src/sim/types';
import { groundHeight, isInWaterBody, terrainHeight, waterLevelAt } from '../src/sim/world';

const SEED = 42;

function makeSim(): Sim {
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
}

// A level-60 rider standing on flat vale ground near the hub. Level 60 makes every
// hub mob trivial-con (TRIVIAL_LEVEL_GAP), so nothing proximity-aggros the player
// and cancels a summon mid-channel; the grag-bear reins (level-10 gate) are owned.
function joinRider(sim: Sim, opts: { level?: number; x?: number; z?: number } = {}): number {
  const pid = sim.addPlayer('warrior', 'Rider');
  sim.tick();
  sim.setPlayerLevel(opts.level ?? 60, pid);
  const p = sim.entities.get(pid)!;
  const x = opts.x ?? 0;
  const z = opts.z ?? -40;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, SEED);
  p.prevPos = { ...p.pos };
  // Req 5: riding skill required; set it so transition tests stay focused on
  // channel timing and water/combat gate behavior, not the riding-skill gate.
  const meta = sim.players.get(pid);
  if (meta) meta.ridingTrained = true;
  sim.addItem('reins_grag_bear', 1, pid);
  return pid;
}

// The number of updateMountTransition decrements a channel of `seconds` takes,
// computed with the exact float sequence the source uses (`rem -= DT` until <= 0),
// so the tick-count pins stay decisive without a fragile hand-rounded literal.
function channelTicks(seconds: number): number {
  let rem = seconds;
  let n = 0;
  while (rem > 0) {
    rem -= DT;
    n++;
  }
  return n;
}

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  ...over,
});

// The client dep shape (pure static collision, aura-only speed, no live-Sim
// callbacks), identical to tests/player_motion.test.ts and src/render/self_motion.ts.
function clientDeps(seed: number): PlayerMotionDeps {
  return {
    seed,
    moveSpeedMult: (e) => moveSpeedMult(e, 0),
    resolveMove: (fromX, fromZ, nx, nz, r, _e, ignoreFences) =>
      resolveMovement(seed, fromX, fromZ, nx, nz, r, ignoreFences),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}

const isDeep = (x: number, z: number, seed: number): boolean => {
  const wl = waterLevelAt(x, z, SEED);
  return Number.isFinite(wl) && groundHeight(x, z, seed) < wl - PLAYER_SWIM_DEPTH;
};

// A genuinely deep lake cell (waterLevelAt finite AND ground under swim depth), with
// its swim-surface height. findDeepWater in player_motion.test keys off terrainHeight;
// the mount water-wall keys off waterLevelAt (a DECLARED lake), so this finder does too.
function findDeepLake(seed: number): { x: number; z: number; surfaceY: number } {
  for (let z = -300; z <= 300; z += 4) {
    for (let x = -300; x <= 300; x += 4) {
      const wl = waterLevelAt(x, z, SEED);
      if (
        // scan DECLARED lakes only: the open sea is deep water too now, but a
        // sea cell found first can sit 50+ yards from any walkable shore and
        // the axis walk below never reaches land
        isInWaterBody(x, z) &&
        Number.isFinite(wl) &&
        groundHeight(x, z, seed) < wl - PLAYER_SWIM_DEPTH &&
        !isBlocked(seed, x, z, 1)
      ) {
        return { x, z, surfaceY: wl - 0.75 };
      }
    }
  }
  throw new Error('no deep lake found');
}

// A shore cell (not deep, walkable) one step from deep water, plus the facing that
// points forward INTO the water. Walks out from a deep lake cell along each axis and
// returns the first shore it reaches; the facing convention is forward = (sin f, cos f).
function findMountShore(seed: number): { x: number; z: number; facing: number } {
  const dw = findDeepLake(seed);
  const dirs = [
    { dx: 0.25, dz: 0, facing: -Math.PI / 2 }, // shore at +x, water toward -x
    { dx: -0.25, dz: 0, facing: Math.PI / 2 }, // shore at -x, water toward +x
    { dx: 0, dz: 0.25, facing: Math.PI }, // shore at +z, water toward -z
    { dx: 0, dz: -0.25, facing: 0 }, // shore at -z, water toward +z
  ];
  for (const dir of dirs) {
    for (let step = 1; step <= 200; step++) {
      const lx = dw.x + dir.dx * step;
      const lz = dw.z + dir.dz * step;
      if (isBlocked(seed, lx, lz, 0.6)) break;
      if (!isDeep(lx, lz, seed)) {
        // reached the shore; deep water sits one cell back toward the lake
        if (isDeep(lx - dir.dx * 2, lz - dir.dz * 2, seed)) {
          return { x: lx, z: lz, facing: dir.facing };
        }
        break;
      }
    }
  }
  throw new Error('no mountable shore found near a deep lake');
}

describe('mount summon/dismount transition', () => {
  it('completes a mount summon after MOUNT_SUMMON_SECONDS of ticks, then rides', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;

    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(true);
    // The channel starts; the live mount is NOT flipped yet.
    expect(e.mountKey).toBe('');
    expect(e.mountCastRemaining).toBeCloseTo(MOUNT_SUMMON_SECONDS, 5);
    expect(e.mountCastKey).toBe('grag_bear');

    let ticks = 0;
    while (e.mountKey === '' && ticks < 200) {
      sim.tick();
      ticks++;
    }
    expect(e.mountKey).toBe('grag_bear');
    expect(e.mountCastRemaining).toBe(0);
    expect(e.mountCastKey).toBe('');
    // driven purely by sim.tick(), so this pins that the coordinator wires the driver
    expect(ticks).toBe(channelTicks(MOUNT_SUMMON_SECONDS));
    // and it was never combat-cancelled (trivial-con hub mobs never engaged)
    expect(e.inCombat).toBe(false);
  });

  it('cancels the summon channel when the player moves (move-to-cancel)', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;
    const meta = sim.meta(pid)!;

    summonMountItem(sim.ctx, pid, 'grag_bear');
    expect(e.mountCastRemaining).toBeGreaterThan(0); // channel started
    expect(e.mountCastKey).toBe('grag_bear');

    // Apply forward movement input - after one tick the summon should be cancelled.
    meta.moveInput.forward = true;
    sim.tick();
    expect(e.mountCastRemaining).toBe(0);
    expect(e.mountCastKey).toBe('');
    expect(e.mountKey).toBe(''); // never mounted
  });

  it('ignores a second toggle while a summon is already channelling', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;

    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(true);
    const rem = e.mountCastRemaining;
    expect(summonMountItem(sim.ctx, pid, 'grag_bear')).toBe(false);
    expect(e.mountCastRemaining).toBe(rem); // channel untouched
    expect(e.mountCastKey).toBe('grag_bear');
    expect(e.mountKey).toBe('');
  });

  it('cancels an in-flight summon on entering combat and never mounts', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;

    summonMountItem(sim.ctx, pid, 'grag_bear');
    sim.tick(); // one tick of channel progress
    expect(e.mountCastRemaining).toBeGreaterThan(0);

    e.inCombat = true; // a hit lands mid-summon
    sim.tick();
    expect(e.mountCastRemaining).toBe(0);
    expect(e.mountCastKey).toBe('');
    expect(e.mountKey).toBe(''); // cancelled, not mounted

    // it stays unmounted afterward: the cancelled channel does not resume
    e.inCombat = false;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(e.mountKey).toBe('');
  });

  it('clears the summon channel when the player dies mid-transition', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;

    summonMountItem(sim.ctx, pid, 'grag_bear');
    sim.tick();
    expect(e.mountCastRemaining).toBeGreaterThan(0);

    (sim as unknown as { handleDeath(e: Entity, k: Entity | null): void }).handleDeath(e, null);
    expect(e.mountCastRemaining).toBe(0);
    expect(e.mountCastKey).toBe('');
    expect(e.mountKey).toBe('');
  });

  it('dismounts INSTANTLY with no channel, and never roots the player', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;
    const meta = sim.meta(pid)!;
    e.mountKey = 'grag_bear'; // start already mounted (skip the summon)

    expect(toggleMount(sim.ctx, pid)).toBe(true);
    // No channel at all: off the mount on the same call, not after N ticks.
    expect(e.mountKey).toBe('');
    expect(e.mountCastRemaining).toBe(0);
    expect(e.mountCastKey).toBe('');

    // The old put-away channel rooted the player for its duration. Nothing roots
    // them now, so movement input applies on the very next tick.
    meta.moveInput.forward = true;
    const start = { x: e.pos.x, z: e.pos.z };
    sim.tick();
    expect(
      Math.hypot(e.pos.x - start.x, e.pos.z - start.z),
      'a just-dismounted player moves immediately',
    ).toBeGreaterThan(0);
  });

  it('force-dismounts a mounted player teleported into deep water', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;
    e.mountKey = 'grag_bear';

    const lake = findDeepLake(SEED);
    e.pos.x = lake.x;
    e.pos.z = lake.z;
    e.pos.y = lake.surfaceY; // treading the surface
    e.prevPos = { ...e.pos };
    expect(isSwimming(e, SEED)).toBe(true); // the teleport really put it in deep water

    sim.tick();
    expect(e.mountKey).toBe(''); // no ground mount swims
    expect(e.mountCastRemaining).toBe(0);
  });
});

describe('mounted deep-water wall (kernel)', () => {
  it('walls a mounted player out of deep water while an unmounted one swims in', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Rider');
    sim.tick();
    sim.setPlayerLevel(60, pid);
    const template = sim.entities.get(pid)!;
    const shore = findMountShore(SEED);
    const groundY = groundHeight(shore.x, shore.z, SEED);
    const clone = (mountKey: string): Entity => ({
      ...template,
      pos: { x: shore.x, y: groundY, z: shore.z },
      prevPos: { x: shore.x, y: groundY, z: shore.z },
      facing: shore.facing,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      jumping: false,
      fallStartY: groundY,
      castingAbility: null,
      sitting: false,
      ghost: false,
      auras: [],
      mountKey,
      mountCastRemaining: 0,
      mountCastKey: '',
    });

    const deps = clientDeps(SEED);
    const mounted = clone('grag_bear');
    const unmounted = clone('');
    const input = mi({ forward: true });
    for (let i = 0; i < 40; i++) {
      mounted.prevPos = { ...mounted.pos };
      unmounted.prevPos = { ...unmounted.pos };
      stepPlayerMotion(deps, mounted, input);
      stepPlayerMotion(deps, unmounted, input);
    }

    // the ground mount never steps off dry land into swimming depth
    expect(isDeep(mounted.pos.x, mounted.pos.z, SEED)).toBe(false);
    expect(isSwimming(mounted, SEED)).toBe(false);
    // the unmounted player crosses the same line and ends up swimming
    expect(isSwimming(unmounted, SEED)).toBe(true);
  });
});

describe('mount transition on the entity wire', () => {
  it('keeps the active mount on the identity mnt field', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;
    e.mountKey = 'grag_bear';

    expect(wireEntity(e).mnt).toBe('grag_bear');
  });

  it('carries mcr/mck during a summon and omits them when idle', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;

    // idle: neither field rides the wire
    const idle = wireEntity(e);
    expect(idle).not.toHaveProperty('mcr');
    expect(idle).not.toHaveProperty('mck');

    // mid-summon: both ride (mcr rounded to 2dp, mck names the summoned mount)
    summonMountItem(sim.ctx, pid, 'grag_bear');
    sim.tick();
    const summoning = wireEntity(e);
    expect(typeof summoning.mcr).toBe('number');
    expect(summoning.mcr as number).toBeGreaterThan(0);
    expect(summoning.mck).toBe('grag_bear');
  });

  it('a dismount puts NO channel on the wire (it is instant)', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;
    e.mountKey = 'grag_bear';

    toggleMount(sim.ctx, pid);
    const dismounted = wireEntity(e);
    // Both channel fields are omitted, and so is mnt: there is nothing to mirror
    // because the dismount already completed.
    expect(dismounted).not.toHaveProperty('mcr');
    expect(dismounted).not.toHaveProperty('mck');
    expect(dismounted).not.toHaveProperty('mnt');
  });
});

describe('attack auto-dismount', () => {
  it('casting any ability while mounted instantly dismounts the player', () => {
    const sim = makeSim();
    const pid = joinRider(sim);
    const e = sim.entities.get(pid)!;

    // Arrange: player is fully mounted (skip the summon channel)
    e.mountKey = 'grag_bear';
    expect(e.mountKey).toBe('grag_bear');

    // Act: cast a warrior self-buff (no target required, instant)
    sim.castAbility('battle_shout', pid);

    // Assert: player is dismounted immediately
    expect(e.mountKey).toBe('');
  });
});
