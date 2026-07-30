import { afterEach, describe, expect, it } from 'vitest';
import { advanceClimb, CLIMB_MIN_OVERHEAD, climbDuration, tryStartClimb } from '../src/sim/climb';
import {
  campCrateShape,
  DOCK_HUT_ROOF_TOP,
  isBlocked,
  MANTLE_REACH,
  MAX_BODY_RADIUS,
  STALL_CANOPY_EAVE,
  STALL_CANOPY_TOP,
  SUPPORT_OVERLAP,
  supportHeightAt,
} from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { MAX_STEP_HEIGHT } from '../src/sim/physics';
import { findLedgeGrab, LEDGE_GRAB_MAX, LEDGE_GRAB_MIN } from '../src/sim/physics/ledge';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import { graveHeight, graveOffset } from '../src/sim/prop_layout';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight, terrainSteepnessAt, WATER_LEVEL } from '../src/sim/world';

// The ledge climb completes the traversal ladder: step over the low, vault the
// mid, CLIMB the high, and everything above that is a wall.

const SEED = 42;
const R = PLAYER_BODY_RADIUS;

afterEach(() => {
  setActiveWorldContent(null);
});

function world(props: Partial<WorldContent['props']>): WorldContent {
  return { ...BUILTIN_WORLD, props: { ...BUILTIN_WORLD.props, ...props } };
}

// Flat, dry, collider-free ground to build fixtures on.
function findFlatSpot(): { x: number; z: number } {
  for (let x = -110; x <= 110; x += 3) {
    for (let z = -110; z <= 110; z += 3) {
      if (terrainHeight(x, z, SEED) < WATER_LEVEL + 2) continue;
      let ok = true;
      for (let dz = -3; dz <= 5 && ok; dz += 1) {
        if (terrainSteepnessAt(x, z + dz, SEED) > 0.3) ok = false;
        if (isBlocked(SEED, x, z + dz, 2.2)) ok = false;
      }
      if (ok) return { x, z };
    }
  }
  throw new Error('no flat spot');
}

const SPOT = findFlatSpot();

// Stricter than findFlatSpot: an interior spot with a near-zero terrain grade,
// for the one test below that reads an exact overhead value (not just whether
// a collider is present) off a wide (dz -3..5) probe span.
function findLevelSpot(): { x: number; z: number } {
  for (let x = -40; x <= 40; x += 3) {
    for (let z = -40; z <= 40; z += 3) {
      if (terrainHeight(x, z, SEED) < WATER_LEVEL + 2) continue;
      let ok = true;
      for (let dz = -3; dz <= 5 && ok; dz += 1) {
        if (terrainSteepnessAt(x, z + dz, SEED) > 0.3) ok = false;
        if (isBlocked(SEED, x, z + dz, 2.2)) ok = false;
      }
      if (ok) return { x, z };
    }
  }
  throw new Error('no level spot');
}
const q = (over: Partial<Parameters<typeof findLedgeGrab>[0]> = {}) => ({
  seed: SEED,
  radius: R,
  facing: 0, // +z
  vx: 0,
  vz: 4,
  ...over,
});

describe('ledge detection', () => {
  it('finds nothing on open ground', () => {
    setActiveWorldContent(world({}));
    const g = groundHeight(SPOT.x, SPOT.z, SEED);
    expect(findLedgeGrab(q(), SPOT.x, g, SPOT.z)).toBeNull();
  });

  it('grabs a crate stack that is too tall to vault', () => {
    // A camp crate top sits ~1.14-1.27 above its ground (per-point roll):
    // walking body is stopped by it, and this is exactly what a climb is for.
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const grab = findLedgeGrab(q(), SPOT.x, g, SPOT.z);
    expect(grab).not.toBeNull();
    if (!grab) return;
    expect(grab.topY - g).toBeGreaterThan(MAX_STEP_HEIGHT);
    expect(grab.topY - g).toBeLessThanOrEqual(LEDGE_GRAB_MAX + 1e-6);
  });

  it('refuses a ledge below the step height (that is a stride, not a climb)', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Feet already level with most of the crate: the gap is under the minimum.
    const grab = findLedgeGrab(
      q(),
      SPOT.x,
      g + campCrateShape(SPOT.x, cz, 0).top - LEDGE_GRAB_MIN + 0.05,
      SPOT.z,
    );
    expect(grab).toBeNull();
  });

  it('refuses a ledge beyond arm reach', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Feet far below the top: out of reach even with arms extended.
    expect(findLedgeGrab(q(), SPOT.x, g - 1.2, SPOT.z)).toBeNull();
  });

  it('never grabs a full-height blocker (a wall is not a ledge)', () => {
    const cz = SPOT.z + 1.4;
    const placed = {
      ...world({}),
      placements: [
        { path: '/models/props/x.glb', x: SPOT.x, z: cz, rotY: 0, scale: 1, collideRadius: 1 },
      ],
    } as WorldContent;
    setActiveWorldContent(placed);
    const g = groundHeight(SPOT.x, cz, SEED);
    for (let up = 0; up <= 2.5; up += 0.25) {
      expect(findLedgeGrab(q(), SPOT.x, g + up, SPOT.z)).toBeNull();
    }
  });

  it('uses real motion as intent, not just where the body looks', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Facing the crate but flying away from it: nothing to grab.
    const away = findLedgeGrab(q({ vx: 0, vz: -5 }), SPOT.x, g, SPOT.z);
    expect(away).toBeNull();
    // Same pose, drifting slowly: facing decides, and the crate is ahead.
    const slow = findLedgeGrab(q({ vx: 0, vz: 0.1 }), SPOT.x, g, SPOT.z);
    expect(slow).not.toBeNull();
  });
});

describe('the climb move', () => {
  const makeBody = (x: number, y: number, z: number): Entity =>
    ({
      pos: { x, y, z },
      prevPos: { x, y, z },
      facing: 0,
      vx: 0,
      vy: 0,
      vz: 4,
      onGround: false,
      jumping: true,
      fallStartY: y,
      dead: false,
      ghost: false,
      auras: [],
      climb: null,
    }) as unknown as Entity;

  it('rises before it pulls forward, and lands standing on the surface', () => {
    // An above-the-head lip: the stall canopy's gable end (ridge 2.54), the
    // ridge turned along z so the approach meets the high line. Crates are
    // silent-vault territory now (CLIMB_MIN_OVERHEAD).
    const cz = SPOT.z + 2.2;
    setActiveWorldContent(world({ stalls: [{ x: SPOT.x, z: cz, rot: Math.PI / 2, r: 1.7 }] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Mid-jump feet: a 2.54 ridge sits above the ground-level grab band
    // (LEDGE_GRAB_MAX above the FEET), exactly like a real jump at a canopy.
    const startY = g + 0.6;
    const p = makeBody(SPOT.x, startY, SPOT.z);
    expect(tryStartClimb(p, SEED)).toBe(true);
    const target = p.climb ? { ...p.climb.to } : null;
    const duration = p.climb ? p.climb.duration : 0;
    expect(target).not.toBeNull();
    if (!target) return;
    // The pull's pacing scales with its height.
    expect(duration).toBeCloseTo(climbDuration(target.y - startY), 6);

    const startZ = p.pos.z;
    let midRiseFraction = 0;
    let midForwardFraction = 0;
    let ticks = 0;
    while (advanceClimb(p) && ticks < 40) {
      ticks++;
      if (ticks === 3) {
        midRiseFraction = (p.pos.y - startY) / (target.y - startY);
        midForwardFraction = (p.pos.z - startZ) / (target.z - startZ);
      }
      // Never overshoots the destination on any axis.
      expect(p.pos.y).toBeLessThanOrEqual(target.y + 1e-6);
    }
    // Early in the move the body is mostly UP, not yet over the edge: that
    // ordering is what makes it read as a mantle and not a diagonal slide.
    expect(midRiseFraction).toBeGreaterThan(midForwardFraction + 0.15);
    expect(ticks).toBeLessThanOrEqual(Math.ceil(duration * 20) + 1);
    expect(p.climb).toBeNull();
    expect(p.onGround).toBe(true);
    expect(p.pos.y).toBeCloseTo(target.y, 6);
    expect(p.vy).toBe(0);
  });

  it('does not start while the jump is still rising', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const p = makeBody(SPOT.x, g, SPOT.z);
    p.vy = 5; // just launched
    expect(tryStartClimb(p, SEED)).toBe(false);
  });

  it('never starts from the ground, from a corpse, or under crowd control', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const grounded = makeBody(SPOT.x, g, SPOT.z);
    grounded.onGround = true;
    expect(tryStartClimb(grounded, SEED)).toBe(false);

    const dead = makeBody(SPOT.x, g, SPOT.z);
    dead.dead = true;
    expect(tryStartClimb(dead, SEED)).toBe(false);

    const stunned = makeBody(SPOT.x, g, SPOT.z);
    stunned.auras = [{ kind: 'stun', value: 1, remaining: 3 }] as Entity['auras'];
    expect(tryStartClimb(stunned, SEED)).toBe(false);
  });

  it('a crate hop stays a silent vault: the pull-up needs a lip above the head', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Even with the grab probe perfectly placed mid-air beside the crate,
    // the climb refuses a lip below CLIMB_MIN_OVERHEAD over the floor: the
    // mantle owns it, so no full-body pull-up animation ever plays there.
    const p = makeBody(SPOT.x, g + 0.3, SPOT.z);
    expect(tryStartClimb(p, SEED)).toBe(false);
    expect(p.climb).toBeNull();
  });

  it('a lip inside the vault ceiling stays a silent vault, even below the stall roof ridge', () => {
    // CLIMB_MIN_OVERHEAD must track the true vault ceiling (jump apex plus
    // MANTLE_REACH): anything the silent vault already reaches should never
    // be forced into the scripted climb. Probe a point partway up the stall
    // canopy's pitched gable, well short of its 2.54 ridge, so the overhead
    // above the floor lands inside vault reach.
    //
    // The shared SPOT fixture (used everywhere else in this file, where only
    // "flat enough to be collider-free" matters) can resolve to a spot with a
    // subtle residual terrain grade that this probe is sensitive to (it reads
    // an exact overhead value, not just presence/absence of a collider), so
    // this one test finds its own interior, near-zero-grade spot instead.
    const spot = findLevelSpot();
    const sz = spot.z + 2.2;
    setActiveWorldContent(world({ stalls: [{ x: spot.x, z: sz, rot: 0, r: 1.7 }] }));
    const bodyZ = sz - 0.6 - (R + 0.5);
    const startY = groundHeight(spot.x, bodyZ, SEED) + 0.6;
    const grab = findLedgeGrab(q(), spot.x, startY, bodyZ);
    expect(grab).not.toBeNull();
    if (!grab) return;
    const floorY = Math.max(
      groundHeight(spot.x, bodyZ, SEED),
      supportHeightAt(SEED, spot.x, bodyZ, R, startY + 1e-3),
    );
    const overhead = grab.topY - floorY;
    const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
    // Comfortably inside the vault ceiling, so the silent vault already
    // carries the body up here without any scripted animation.
    expect(overhead).toBeLessThan(apex + MANTLE_REACH);
    expect(overhead).toBeGreaterThan(1); // clear of the step/vault floor too

    const p = makeBody(spot.x, startY, bodyZ);
    expect(tryStartClimb(p, SEED)).toBe(false);
    expect(p.climb).toBeNull();
  });

  it('drops the body when a stun lands mid-climb', () => {
    const cz = SPOT.z + 2.2;
    setActiveWorldContent(world({ stalls: [{ x: SPOT.x, z: cz, rot: Math.PI / 2, r: 1.7 }] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const p = makeBody(SPOT.x, g + 0.6, SPOT.z);
    expect(tryStartClimb(p, SEED)).toBe(true);
    advanceClimb(p);
    advanceClimb(p);
    p.auras = [{ kind: 'stun', value: 1, remaining: 3 }] as Entity['auras'];
    expect(advanceClimb(p)).toBe(false);
    expect(p.climb).toBeNull();
    expect(p.onGround).toBe(false); // falls, rather than finishing the pull
  });
});

describe('the climb through a live Sim', () => {
  it('carries a jumping player onto a crate they could not vault', () => {
    const cz = SPOT.z + 1.6;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    p.pos.x = SPOT.x;
    p.pos.z = SPOT.z - 1.2;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    p.facing = 0;
    p.onGround = true;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing meta');
    const crateTop = groundHeight(SPOT.x, cz, SEED) + campCrateShape(SPOT.x, cz, 0).top;
    let reachedTop = false;
    for (let i = 0; i < 60; i++) {
      Object.assign(meta.moveInput, {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: true,
      });
      sim.tick();
      if (p.onGround && Math.abs(p.pos.y - crateTop) < 0.05) reachedTop = true;
    }
    expect(reachedTop).toBe(true);
  });
});

describe('the support query across grid-cell boundaries', () => {
  it('holds a body in the neighbouring cell of the prop that supports it', () => {
    // The grid registers every collider into all cells its bounds inflated
    // by MAX_BODY_RADIUS touch, so the kernel's single-cell support read is
    // complete even when the body stands across a 16 yd cell boundary from
    // the prop. Straddle one deliberately: crate fully inside cell [16, 32),
    // body in cell [0, 16), inside the support reach.
    const crateX = 16.7;
    const crateZ = 8;
    setActiveWorldContent(world({ crates: [[crateX, crateZ]] }));
    const shape = campCrateShape(crateX, crateZ, 0);
    const top = groundHeight(crateX, crateZ, SEED) + shape.top;
    const bodyX = 15.95; // the other side of the x = 16 boundary
    expect(Math.floor(bodyX / 16)).not.toBe(Math.floor(crateX / 16));
    expect(crateX - shape.r).toBeGreaterThan(16); // footprint fully past it
    expect(supportHeightAt(SEED, bodyX, crateZ, R, top + 0.01)).toBeCloseTo(top, 6);
  });

  it('pins the registration margin that makes single-cell reads complete', () => {
    // Support reaches r * SUPPORT_OVERLAP beyond a collider's bounds, and the
    // slope glue adds at most one tick's stride: both must stay inside the
    // grid's MAX_BODY_RADIUS insertion margin or a cell read could miss.
    const maxTickStride = 0.5; // generous over the real ~0.35 (run speed x DT)
    expect(R * SUPPORT_OVERLAP + maxTickStride).toBeLessThanOrEqual(MAX_BODY_RADIUS);
  });
});

describe('the climb against real world geometry', () => {
  it('a graveyard cross is too tall to vault, and the climb reaches it', () => {
    setActiveWorldContent(null);
    // The traversal ladder, checked against content rather than a fixture:
    // apex + mantle clears most things, and the tall stones are what is left
    // for the climb. If this inverts, the climb has nothing to do in the world.
    const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
    const vaultReach = apex + MANTLE_REACH;
    const climbReach = apex + LEDGE_GRAB_MAX;
    const crossHeight = graveHeight(1); // the cross in the grid's cycle
    expect(crossHeight).toBeGreaterThan(vaultReach);
    expect(crossHeight).toBeLessThanOrEqual(climbReach);
    // No dead band in the ladder: everything below the climb's above-the-head
    // floor is inside the silent vault's reach from flat ground, so gating
    // the pull-up on tall lips never makes any height unreachable. Pinned
    // to the exact vault ceiling, not just "under it": a looser bound let
    // CLIMB_MIN_OVERHEAD drift stale under a later MANTLE_REACH tune and
    // still pass.
    expect(CLIMB_MIN_OVERHEAD).toBeCloseTo(vaultReach, 6);
    // And the cross itself still earns the pull-up.
    expect(crossHeight).toBeGreaterThanOrEqual(CLIMB_MIN_OVERHEAD);
  });

  it('carries a player from the ground onto a real graveyard cross', () => {
    setActiveWorldContent(null);
    // Eastbrook's cemetery, stone 1: a cross, and the anchor stone beside it
    // is deliberately uncollided (a Spirit Healer stands there).
    const gy = { x: -14, z: -14 };
    const off = graveOffset(1);
    const sx = gy.x + off.x;
    const sz = gy.z + off.z;
    const top = groundHeight(sx, sz, SEED) + graveHeight(1);

    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    p.pos.x = sx;
    p.pos.z = sz - 1.6;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    p.facing = 0; // +z, at the stone
    p.onGround = true;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing meta');

    let climbed = false;
    let reachedTop = false;
    for (let i = 0; i < 80; i++) {
      Object.assign(meta.moveInput, {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: true,
      });
      sim.tick();
      if (p.climb) climbed = true;
      if (p.onGround && Math.abs(p.pos.y - top) < 0.1) reachedTop = true;
    }
    expect(climbed).toBe(true);
    expect(reachedTop).toBe(true);
  });
});

describe('the climb onto the town roofs', () => {
  it('stall canopies and the dock hut roof sit above vault reach, inside climb reach', () => {
    // The whole point of the standable roofs: too tall to jump-vault, exactly
    // what the grab-and-pull is for. If either bound inverts, the roof is
    // either trivially hoppable or unreachable decoration again.
    const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
    for (const top of [STALL_CANOPY_TOP, DOCK_HUT_ROOF_TOP]) {
      expect(top).toBeGreaterThan(apex + MANTLE_REACH);
      expect(top).toBeLessThanOrEqual(apex + LEDGE_GRAB_MAX);
    }
  });

  it('paces the pull by its height, inside a mantle rhythm at both ends', () => {
    expect(climbDuration(2.2)).toBeGreaterThan(climbDuration(1.0));
    expect(climbDuration(LEDGE_GRAB_MIN)).toBeGreaterThanOrEqual(0.35);
    expect(climbDuration(LEDGE_GRAB_MAX)).toBeLessThanOrEqual(0.75);
  });

  it('vaults the stall awning edge, walks up the gable, and climbs the gable end', () => {
    const sz = SPOT.z + 2.6;
    setActiveWorldContent(world({ stalls: [{ x: SPOT.x, z: sz, rot: 0, r: 1.7 }] }));
    const g = groundHeight(SPOT.x, sz, SEED);

    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing meta');

    const step = (input: Partial<Record<string, boolean>>, ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        Object.assign(
          meta.moveInput,
          {
            forward: false,
            back: false,
            turnLeft: false,
            turnRight: false,
            strafeLeft: false,
            strafeRight: false,
            jump: false,
          },
          input,
        );
        sim.tick();
      }
    };
    const teleportTo = (x: number, z: number, facing: number) => {
      p.pos.x = x;
      p.pos.z = z;
      p.pos.y = terrainHeight(x, z, SEED);
      p.prevPos = { ...p.pos };
      p.fallStartY = p.pos.y;
      p.facing = facing;
      p.onGround = true;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.climb = null;
    };

    // FRONT approach (+z at the awning's low edge): the 1.5 eave is a vault,
    // and the gable then walks up toward the 2.54 ridge.
    teleportTo(SPOT.x, sz - 1.25 - 1.4, 0);
    let onAwning = false;
    for (let i = 0; i < 100 && !onAwning; i++) {
      step({ forward: true, jump: true }, 1);
      const rel = p.pos.y - g;
      if (p.onGround && rel > STALL_CANOPY_EAVE - 0.05 && rel <= STALL_CANOPY_TOP + 0.05) {
        onAwning = true;
      }
    }
    expect(onAwning).toBe(true);
    const before = p.pos.y - g;
    step({ forward: true }, 3);
    const after = p.pos.y - g;
    expect(p.onGround).toBe(true);
    expect(after).toBeGreaterThan(before + 0.1); // riding the gable upward
    expect(after).toBeLessThanOrEqual(STALL_CANOPY_TOP + 0.01);

    // SIDE approach (the gable END face, +x): the surface at the ridge line
    // is the full 2.54 there, out of vault reach, so the grab-and-climb is
    // the way up.
    teleportTo(SPOT.x - 1.55 - 1.4, sz, Math.PI / 2);
    let climbed = false;
    let onRoofFromSide = false;
    for (let i = 0; i < 120 && !onRoofFromSide; i++) {
      step({ forward: true, jump: true }, 1);
      if (p.climb) climbed = true;
      const rel = p.pos.y - g;
      if (p.onGround && rel > STALL_CANOPY_EAVE - 0.05) onRoofFromSide = true;
    }
    expect(climbed).toBe(true);
    expect(onRoofFromSide).toBe(true);
  });

  it('a grounded walk still collides with the stall full-height', () => {
    const sz = SPOT.z + 2.6;
    setActiveWorldContent(world({ stalls: [{ x: SPOT.x, z: sz, rot: 0, r: 1.7 }] }));
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    p.pos.x = SPOT.x;
    p.pos.z = sz - 1.7 - 1.4;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    p.facing = 0;
    p.onGround = true;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing meta');
    for (let i = 0; i < 80; i++) {
      Object.assign(meta.moveInput, {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
      });
      sim.tick();
    }
    // Walked into the stall and stopped at its rim, never through or onto it.
    expect(p.pos.z).toBeLessThan(sz - 1.6);
    expect(p.pos.y).toBeLessThan(groundHeight(p.pos.x, p.pos.z, SEED) + 0.5);
  });
});
