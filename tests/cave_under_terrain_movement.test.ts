import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { CaveDef, WorldContent } from '../src/sim/types';
import { onCaveSheet, terrainHeight, terrainSteepness } from '../src/sim/world';

// Walking INSIDE a cave tube that runs under sculpted terrain: the mover is on
// the cave sheet, so the SURFACE gradient overhead must never freeze or slide
// them (the old steepGround check read the surface steepness even underground,
// which walled off every tunnel dug under a hillside).

const SEED = 20061;

afterEach(() => {
  setActiveWorldContent(null);
});

describe('player movement on the cave sheet under steep terrain', () => {
  // A straight tube along +x at z = 40, floor well below the surface, buried
  // under a steep stamp-built hill whose falloff band crosses the tube.
  function makeContent(): { content: WorldContent; floorY: number } {
    const surface = terrainHeightAt(0, 40);
    const floorY = surface - 8;
    const cave: CaveDef = {
      id: 'under_hill',
      nodes: [
        { x: -30, y: floorY, z: 40, radius: 4 },
        { x: 30, y: floorY, z: 40, radius: 4 },
      ],
    };
    const content: WorldContent = {
      ...BUILTIN_WORLD,
      waterLevel: -100, // keep the swim path out of this test
      caves: [cave],
      // Hill centered 10yd north of the tube: at (0, 40) the surface sits on
      // the steepest part of the smooth falloff (slope ~4.5 >> climb limit).
      terrainEdits: [{ x: 0, z: 50, radius: 20, delta: 60, falloff: 'smooth' }],
    };
    return { content, floorY };
  }

  function terrainHeightAt(x: number, z: number): number {
    setActiveWorldContent({ ...BUILTIN_WORLD });
    const h = terrainHeight(x, z, SEED);
    setActiveWorldContent(null);
    return h;
  }

  it('sanity: the surface above the tube is unwalkably steep, the mover is on the cave sheet', () => {
    const { content, floorY } = makeContent();
    setActiveWorldContent(content);
    expect(terrainSteepness(0, 40, SEED)).toBeGreaterThan(1.5);
    expect(onCaveSheet(0, 40, SEED, floorY)).toBe(true);
  });

  it('forward input moves the player along the tube (no surface-steepness freeze)', () => {
    const { content, floorY } = makeContent();
    setActiveWorldContent(content);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
    const p = sim.player;
    // Stand on the cave floor mid-tube, facing +x along the bore.
    p.pos.x = 0;
    p.pos.z = 40;
    p.pos.y = floorY;
    p.prevPos = { ...p.pos };
    p.onGround = true;
    p.fallStartY = p.pos.y;
    p.facing = Math.PI / 2; // facing = (sin f, cos f) -> +x
    sim.moveInput.forward = true;
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    // Two seconds of run: well over a yard of progress, still on the tube floor.
    expect(p.pos.x).toBeGreaterThan(2);
    expect(Math.abs(p.pos.y - floorY)).toBeLessThan(1.5);
    expect(Math.abs(p.pos.z - 40)).toBeLessThan(2);
  });

  it('the player can jump on the cave floor under a steep surface', () => {
    const { content, floorY } = makeContent();
    setActiveWorldContent(content);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
    const p = sim.player;
    p.pos.x = 0;
    p.pos.z = 40;
    p.pos.y = floorY;
    p.prevPos = { ...p.pos };
    p.onGround = true;
    p.fallStartY = p.pos.y;
    sim.moveInput.jump = true;
    sim.tick();
    expect(p.onGround).toBe(false); // the jump actually launched
  });
});

describe('cave side walls are solid', () => {
  // A flush tube on LEVELED flat ground (floor == surface): the worst case for
  // wall collision, because stepping out of the footprint lands on terrain at
  // exactly the floor height ? no climb gate can save you. The horseshoe wall
  // itself must block: headroom shrinks to 0 at the lateral edge.
  const FLAT_Y = 10;

  function makeFlushContent(): { content: WorldContent } {
    const cave: CaveDef = {
      id: 'flush_tube',
      nodes: [
        { x: -30, y: FLAT_Y, z: 40, radius: 4 },
        { x: 30, y: FLAT_Y, z: 40, radius: 4 },
      ],
    };
    const content: WorldContent = {
      ...BUILTIN_WORLD,
      waterLevel: -100,
      caves: [cave],
      terrainEdits: [{ x: 0, z: 40, radius: 100, delta: FLAT_Y, falloff: 'flat', mode: 'level' }],
    };
    return { content };
  }

  function simOnFloor(content: WorldContent, x: number, z: number): Sim {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
    const p = sim.player;
    p.pos.x = x;
    p.pos.z = z;
    p.pos.y = FLAT_Y;
    p.prevPos = { ...p.pos };
    p.onGround = true;
    p.fallStartY = p.pos.y;
    p.facing = Math.PI / 2; // forward = +x (along the tube)
    return sim;
  }

  it('strafing into the side wall stops at the arch instead of phasing out', () => {
    const { content } = makeFlushContent();
    setActiveWorldContent(content);
    const sim = simOnFloor(content, 0, 40);
    sim.moveInput.strafeRight = true; // right of +x facing = +z, toward the wall
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    // Footprint edge is z = 44; standing headroom (1.8yd) runs out near
    // z ~ 43.4. Without wall collision the player walks clean out (z > 45).
    expect(sim.player.pos.z).toBeLessThan(43.7);
    expect(sim.player.pos.z).toBeGreaterThan(42.5); // did approach the wall
    expect(Math.abs(sim.player.pos.y - FLAT_Y)).toBeLessThan(1.5);
  });

  it('walking into the exterior shell flank from outside is blocked', () => {
    const { content } = makeFlushContent();
    setActiveWorldContent(content);
    const sim = simOnFloor(content, 0, 48); // on flat ground north of the tube
    sim.moveInput.strafeLeft = true; // left of +x facing = -z, toward the tube
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    // The rock shell starts at the footprint edge (z = 44): never inside.
    expect(sim.player.pos.z).toBeGreaterThan(43.8);
    expect(sim.player.pos.z).toBeLessThan(45.5); // did reach the shell
  });

  it('walking out through the OPEN mouth still works (fully past the rim)', () => {
    const { content } = makeFlushContent();
    setActiveWorldContent(content);
    const sim = simOnFloor(content, 27, 40);
    sim.moveInput.forward = true; // +x, out the open end at x = 30
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    // The footprint apron ends at x = 34: clean exit means well beyond it,
    // not stalled in the mouth ring (the wall band must not cover the apron).
    expect(sim.player.pos.x).toBeGreaterThan(35);
    expect(Math.abs(sim.player.pos.y - FLAT_Y)).toBeLessThan(1.5);
  });

  it('walking IN through the OPEN mouth is smooth too (no jump needed)', () => {
    const { content } = makeFlushContent();
    setActiveWorldContent(content);
    const sim = simOnFloor(content, 37, 40); // on terrain past the mouth
    sim.player.facing = -Math.PI / 2; // forward = -x, into the tube
    sim.moveInput.forward = true;
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(sim.player.pos.x).toBeLessThan(26); // deep inside the tube
    expect(Math.abs(sim.player.pos.y - FLAT_Y)).toBeLessThan(1.5);
  });
});

describe('cave mouth lips are stepped, not jumped', () => {
  // A tube whose mouth sits under a Hole-tool cutout with a small height
  // mismatch between the tube floor and the terrain outside ? the common
  // hand-authored case. Walking must simply step the lip in both directions.
  const FLAT_Y = 10;

  function makeLipContent(floorY: number): WorldContent {
    const cave: CaveDef = {
      id: 'lip_tube',
      nodes: [
        { x: 0, y: floorY, z: 40, radius: 4 },
        { x: 30, y: floorY, z: 40, radius: 4 },
      ],
    };
    return {
      ...BUILTIN_WORLD,
      waterLevel: -100,
      caves: [cave],
      holes: [{ x: 28, y: FLAT_Y, z: 40, radius: 6 }],
      terrainEdits: [{ x: 0, z: 40, radius: 100, delta: FLAT_Y, falloff: 'flat', mode: 'level' }],
    };
  }

  function walker(content: WorldContent, x: number, y: number, facing: number): Sim {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
    const p = sim.player;
    p.pos.x = x;
    p.pos.z = 40;
    p.pos.y = y;
    p.prevPos = { ...p.pos };
    p.onGround = true;
    p.fallStartY = p.pos.y;
    p.facing = facing;
    sim.moveInput.forward = true;
    return sim;
  }

  it('walks IN over a floor that sits a step ABOVE the cut terrain', () => {
    const floorY = FLAT_Y + 0.8;
    const content = makeLipContent(floorY);
    setActiveWorldContent(content);
    const sim = walker(content, 37, FLAT_Y, -Math.PI / 2); // -x, into the mouth
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(sim.player.pos.x).toBeLessThan(26); // inside, past the hole
    expect(Math.abs(sim.player.pos.y - floorY)).toBeLessThan(1.5); // on the floor
  });

  it('walks OUT over terrain that sits a step ABOVE the floor', () => {
    const floorY = FLAT_Y - 0.8;
    const content = makeLipContent(floorY);
    setActiveWorldContent(content);
    const sim = walker(content, 25, floorY, Math.PI / 2); // +x, out the mouth
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(36); // out on the terrain
    expect(Math.abs(sim.player.pos.y - FLAT_Y)).toBeLessThan(1.5);
  });
});
