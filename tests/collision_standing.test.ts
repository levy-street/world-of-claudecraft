import { afterEach, describe, expect, it } from 'vitest';
import { invalidateStaticColliders } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { ColliderVolume, PlacedAsset, WorldContent } from '../src/sim/types';
import { groundHeightNear } from '../src/sim/world';

// Standing on and walking across authored collision: a baked box top / plane /
// ramp deck is walkable ground (you stand on it and step onto it), not a wall
// that shoves you off its side. Terrain cliffs stay unclimbable.

const SEED = 20061;
const FLAT_Y = 10;
const CX = 0;
const CZ = 40;

// Flatten a wide disc to FLAT_Y so every height below is exact, and drop the
// water line so nothing swims.
function flatWorld(extra: Partial<WorldContent>): WorldContent {
  return {
    ...BUILTIN_WORLD,
    waterLevel: -100,
    placements: [],
    colliderVolumes: [],
    terrainEdits: [{ x: CX, z: CZ, radius: 200, delta: FLAT_Y, falloff: 'flat', mode: 'level' }],
    ...extra,
  };
}

// A baked-box platform placement: hitboxes drive the Y-banded OBB (top at
// FLAT_Y + y + hy), no legacy circle. `topAbove` = how high the top sits above
// the flat ground.
function boxPlacement(topAbove: number, hx = 8, hz = 4): PlacedAsset {
  const hy = topAbove / 2;
  return {
    assetId: 'props/test_platform',
    path: '/models/props/test_platform.glb',
    x: CX,
    z: CZ,
    rotY: 0,
    scale: 1,
    collide: true,
    collideRadius: 1,
    hitboxes: [{ x: 0, y: hy, z: 0, hx, hy, hz }],
  } as unknown as PlacedAsset;
}

function warriorOnFloor(
  content: WorldContent,
  x: number,
  z: number,
  y: number,
  facing: number,
): Sim {
  setActiveWorldContent(content);
  invalidateStaticColliders();
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = y;
  p.prevPos = { ...p.pos };
  p.onGround = true;
  p.fallStartY = p.pos.y;
  p.facing = facing;
  return sim;
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('baked box tops are walkable floor (groundHeightNear)', () => {
  it('lifts a mover onto a box top within a step of the feet', () => {
    const content = flatWorld({ placements: [boxPlacement(0.6)] });
    setActiveWorldContent(content);
    invalidateStaticColliders();
    // Standing at ground level, a 0.6-high box top is within one step: the
    // floor rises onto it (you step up), not stays at terrain.
    expect(groundHeightNear(CX, CZ, SEED, FLAT_Y)).toBeCloseTo(FLAT_Y + 0.6, 4);
    // Off the footprint: plain flat ground.
    expect(groundHeightNear(CX + 30, CZ, SEED, FLAT_Y)).toBeCloseTo(FLAT_Y, 4);
  });

  it('a TALL box is a wall from the ground but a floor from above', () => {
    const content = flatWorld({ placements: [boxPlacement(2)] });
    setActiveWorldContent(content);
    invalidateStaticColliders();
    // From the ground the 2yd top is out of step reach: not lifted (it walls).
    expect(groundHeightNear(CX, CZ, SEED, FLAT_Y)).toBeCloseTo(FLAT_Y, 4);
    // With the feet already up on top, it IS the floor (you stand on it).
    expect(groundHeightNear(CX, CZ, SEED, FLAT_Y + 2)).toBeCloseTo(FLAT_Y + 2, 4);
  });
});

describe('a player stands on a box instead of being kicked off', () => {
  it('stays on top of a 2yd box placed under the feet', () => {
    const content = flatWorld({ placements: [boxPlacement(2)] });
    const sim = warriorOnFloor(content, CX, CZ, FLAT_Y + 2, Math.PI / 2);
    for (let i = 0; i < 20; i++) sim.tick(); // one second, no input
    // Without the fix the box top is not ground, so the player snaps down to
    // terrain (FLAT_Y) and the OBB shoves them off sideways.
    expect(sim.player.pos.y).toBeGreaterThan(FLAT_Y + 1.5);
    expect(sim.player.onGround).toBe(true);
    expect(Math.hypot(sim.player.pos.x - CX, sim.player.pos.z - CZ)).toBeLessThan(1);
  });

  it('walks up ONTO a low box and stands on its top (step-up gate)', () => {
    // Top 0.6 above ground: too high for the old climb gate (0.6 / step > the
    // slope limit) so the player used to be walled at the edge; now it is a
    // one-step authored surface, so they step onto it and walk across.
    const content = flatWorld({ placements: [boxPlacement(0.6)] });
    const sim = warriorOnFloor(content, CX - 6, CZ, FLAT_Y, Math.PI / 2); // facing +x
    sim.moveInput.forward = true;
    for (let i = 0; i < 24; i++) sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(CX - 2); // advanced onto the box, not stuck at its edge
    expect(sim.player.pos.y).toBeGreaterThan(FLAT_Y + 0.4); // standing on the top
    expect(sim.player.onGround).toBe(true);
  });
});

describe('ramps: a tilted plane is a walkable slope up and down', () => {
  // A plane tilted on its local X axis is a ramp (see collider_volumes.test).
  // rotZ = atan(1.7) -> slope 1.7: steep enough that the OLD height-delta climb
  // gate walled it off (> 1.5), but each tick's rise is within one step, so the
  // fixed gate treats it as a designed ramp and lets the player walk it.
  const tilt = Math.atan(1.7);
  function rampWorld(): WorldContent {
    const plane: ColliderVolume = {
      kind: 'plane',
      x: CX,
      z: CZ,
      rotY: 0,
      rotZ: tilt,
      sizeX: 16,
      sizeY: 7, // lifts the low end up near the flat ground (see test math)
      sizeZ: 8,
    };
    return flatWorld({ colliderVolumes: [plane] });
  }

  it('walks UP the ramp (the floor and the player both climb)', () => {
    const content = rampWorld();
    // Enter at the low end (world x ~ -4, floor ~ flat ground) heading +x uphill.
    const sim = warriorOnFloor(content, CX - 4, CZ, FLAT_Y, Math.PI / 2);
    sim.moveInput.forward = true;
    // 16 ticks keeps the player mid-deck (the deck top is near x = +4); without
    // the fix the steep terrain UNDER the deck freezes them at the entry.
    for (let i = 0; i < 16; i++) sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(CX); // made real progress up the deck
    expect(sim.player.pos.y).toBeGreaterThan(FLAT_Y + 3); // climbed several yards
    expect(sim.player.onGround).toBe(true); // still walking the deck, not sliding off
  });

  it('walks DOWN the ramp without getting stuck or launched', () => {
    const content = rampWorld();
    // Start partway up (world x ~ +2), facing -x, and walk down toward the low end.
    const sim = warriorOnFloor(content, CX + 2, CZ, FLAT_Y + 3.4, -Math.PI / 2);
    const y0 = sim.player.pos.y;
    sim.moveInput.forward = true;
    for (let i = 0; i < 30; i++) sim.tick();
    expect(sim.player.pos.x).toBeLessThan(CX + 1); // moved down-slope
    expect(sim.player.pos.y).toBeLessThan(y0 - 1); // descended
    expect(sim.player.onGround).toBe(true); // stayed grounded (did not fall off)
  });
});

describe('an elevated flat plane is a stable bridge deck', () => {
  // The reported bug: standing on a collider plane, the player floated and
  // drifted because the sim read the terrain UNDER the deck (steepness slide +
  // wall-standoff + a climb-gate freeze) instead of the flat deck it stands on.
  it('walks straight across a raised deck without drifting or falling off', () => {
    const floor = FLAT_Y + 2; // plane raised 2yd over the flat ground
    const content = flatWorld({
      colliderVolumes: [{ kind: 'plane', x: CX, z: CZ, rotY: 0, sizeX: 40, sizeY: 2, sizeZ: 16 }],
    });
    setActiveWorldContent(content);
    invalidateStaticColliders();
    expect(groundHeightNear(CX, CZ, SEED, floor)).toBeCloseTo(floor, 4); // the deck is the floor
    const sim = warriorOnFloor(content, CX - 8, CZ, floor, Math.PI / 2); // facing +x
    sim.moveInput.forward = true;
    for (let i = 0; i < 24; i++) sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(CX); // walked across, never frozen at the entry
    expect(Math.abs(sim.player.pos.z - CZ)).toBeLessThan(1); // straight line: no sideways drift
    expect(Math.abs(sim.player.pos.y - floor)).toBeCloseTo(0, 1); // stayed exactly on the deck
    expect(sim.player.onGround).toBe(true);
  });
});

describe('the plane collision floor matches where the deck is drawn (Fix B)', () => {
  it('folds in the gizmo Y-lift (offsetY) and the detached frozen ground', () => {
    // Lifted: floor = terrain + offsetY + sizeY, so collision tracks the raised
    // overlay instead of sitting down at the terrain (the "floating" gap).
    setActiveWorldContent(
      flatWorld({
        colliderVolumes: [
          { kind: 'plane', x: CX, z: CZ, rotY: 0, sizeX: 20, sizeY: 1, sizeZ: 20, offsetY: 4 },
        ],
      }),
    );
    invalidateStaticColliders();
    expect(groundHeightNear(CX, CZ, SEED, FLAT_Y + 5)).toBeCloseTo(FLAT_Y + 5, 4); // 10 + 4 + 1
    // Detached: the frozen groundY replaces live terrain.
    setActiveWorldContent(
      flatWorld({
        colliderVolumes: [
          {
            kind: 'plane',
            x: CX,
            z: CZ,
            rotY: 0,
            sizeX: 20,
            sizeY: 1,
            sizeZ: 20,
            detached: true,
            groundY: 30,
          },
        ],
      }),
    );
    invalidateStaticColliders();
    expect(groundHeightNear(CX, CZ, SEED, 31)).toBeCloseTo(31, 4); // 30 + 0 + 1
  });
});

describe('a Collision Master ramp deck is walkable, not walled by a collide circle', () => {
  // A placement with a walkable ramp deck (the per-placement `ramps` a CM ramp
  // volume derives) used to also get a legacy collide CIRCLE that walled the
  // player off their own ramp. The deck raises the floor; nothing should block.
  function stepsWorld(y1: number): WorldContent {
    return {
      ...BUILTIN_WORLD,
      waterLevel: -100,
      colliderVolumes: [],
      placements: [
        {
          assetId: 'props/steps',
          path: '/models/props/steps.glb',
          x: CX,
          z: CZ,
          rotY: 0,
          scale: 1,
          collide: true,
          collideRadius: 1,
          ramps: [{ x: 0, z: 0, hx: 3, hz: 2, y0: 0, y1 }], // deck rises along model +X
        } as unknown as PlacedAsset,
      ],
      terrainEdits: [{ x: CX, z: CZ, radius: 200, delta: FLAT_Y, falloff: 'flat', mode: 'level' }],
    } as unknown as WorldContent;
  }

  it('walks UP a ~45° step deck instead of getting stuck at a collide circle', () => {
    const content = stepsWorld(6); // rise 6 over 6yd = slope 1.0
    const sim = warriorOnFloor(content, CX - 3, CZ, FLAT_Y, Math.PI / 2);
    sim.moveInput.forward = true;
    for (let i = 0; i < 14; i++) sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(CX); // advanced across the deck, not stuck at ~x=-1.5
    expect(sim.player.pos.y).toBeGreaterThan(FLAT_Y + 3); // climbed the steps
  });

  it('walks DOWN the step deck without getting stuck', () => {
    const content = stepsWorld(6);
    const sim = warriorOnFloor(content, CX + 3, CZ, FLAT_Y + 6, -Math.PI / 2); // top, facing -x
    const y0 = sim.player.pos.y;
    sim.moveInput.forward = true;
    for (let i = 0; i < 16; i++) sim.tick();
    expect(sim.player.pos.x).toBeLessThan(CX); // descended toward the bottom
    expect(sim.player.pos.y).toBeLessThan(y0 - 3);
  });
});
