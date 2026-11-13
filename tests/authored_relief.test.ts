// The raised ground of an authored interior (src/render/authored_relief.ts, lifted out of
// dungeon.ts): the risers under lifted rooms, the stair runs across doors that join rooms
// of different lift, and the standable ledges. The sim stands a body on the same layout
// tables (sim/rift/authored.ts authoredLiftAt), so what is drawn has to be that surface:
// each step's top is the sim's ramp at the step's own middle, and a ledge's top is the
// collider's. A palace cuts all of it from its painted stone once its kit has loaded, and
// from the plain slab until then.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DungeonLayout } from '../src/sim/dungeon_layout';
import { authoredLiftAt, doorRampHalf } from '../src/sim/rift/authored';

const kit = vi.hoisted(() => ({ loaded: false }));
const PALACE_STONE = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../src/render/palace_tile_kit', async () => {
  const three = await import('three');
  PALACE_STONE.current = new three.MeshStandardMaterial({ name: 'palace-slab' });
  return {
    // the kit's contract: a palace variant, and only once its wall piece has loaded
    palaceSlabMaterial: (variant: string) =>
      (variant === 'dawnhold' || variant === 'lastkeep') && kit.loaded
        ? PALACE_STONE.current
        : undefined,
    palaceSlabBox: (width: number, height: number, depth: number) => {
      const box = new three.BoxGeometry(width, height, depth);
      box.userData.palaceSlab = true;
      return box;
    },
  };
});

import { addAuthoredLedges, addAuthoredRelief } from '../src/render/authored_relief';

type Box = THREE.Mesh<THREE.BoxGeometry, THREE.Material>;

const layoutOf = (partial: Pick<DungeonLayout, 'rooms' | 'doors' | 'ledges'>): DungeonLayout =>
  partial as DungeonLayout;

/** A room on the ground with a room three yards up to its north, through one door. */
const NORTH_SOUTH = layoutOf({
  rooms: [
    { id: 'low', x0: -5, x1: 5, z0: 0, z1: 10 },
    { id: 'high', x0: -5, x1: 5, z0: 10, z1: 20, lift: 3 },
  ],
  doors: [{ x: 0, z: 10, hw: 2, hd: 1 }],
});

/** A room on the ground with a room 1.8 yards up to its east. */
const WEST_EAST = layoutOf({
  rooms: [
    { id: 'low', x0: 0, x1: 10, z0: 0, z1: 10 },
    { id: 'high', x0: 10, x1: 20, z0: 0, z1: 10, lift: 1.8 },
  ],
  doors: [{ x: 10, z: 5, hw: 1.5, hd: 2 }],
});

const boxes = (group: THREE.Group): Box[] => group.children as Box[];
const sizeOf = (mesh: Box) => mesh.geometry.parameters;
const topOf = (mesh: Box): number => mesh.position.y + sizeOf(mesh).height / 2;

afterEach(() => {
  kit.loaded = false;
});

describe('the risers and stair runs of an authored floor', () => {
  it('adds nothing to a floor with no lifted room', () => {
    const group = new THREE.Group();
    addAuthoredRelief(
      group,
      layoutOf({ rooms: [{ id: 'flat', x0: 0, x1: 4, z0: 0, z1: 4 }], doors: [] }),
      'citadel',
    );
    expect(group.children).toHaveLength(0);
  });

  it('stands a riser under the lifted room, a yard past its walls and a hair under its tiles', () => {
    const group = new THREE.Group();
    addAuthoredRelief(group, NORTH_SOUTH, 'citadel');
    const riser = boxes(group)[0];
    expect(sizeOf(riser)).toMatchObject({ width: 12, depth: 12 });
    expect(sizeOf(riser).height).toBeCloseTo(2.98, 10);
    expect(riser.position.toArray()).toEqual([0, 1.49, 15]);
    expect(topOf(riser)).toBeCloseTo(3 - 0.02, 10);
  });

  it('runs steps across a north to south door whose tops are the sim ramp at each step', () => {
    const group = new THREE.Group();
    addAuthoredRelief(group, NORTH_SOUTH, 'citadel');
    const door = NORTH_SOUTH.doors?.[0];
    if (!door) throw new Error('the fixture has a door');
    const steps = boxes(group).slice(1);
    // the ramp is 1.5 yards of run a yard of rise (doorRampHalf), cut in 0.9 yard treads
    const half = doorRampHalf(door.hd, 3);
    expect(half).toBe(4.5);
    expect(steps).toHaveLength(10);
    steps.forEach((step, i) => {
      expect(step.position.x).toBe(door.x);
      expect(step.position.z).toBeCloseTo(door.z - half + (i + 0.5) * 0.9, 10);
      expect(sizeOf(step).width).toBe(door.hw * 2 + 1);
      // what you climb is what the sim stands you on
      expect(topOf(step)).toBeCloseTo(
        authoredLiftAt(NORTH_SOUTH.rooms ?? [], NORTH_SOUTH.doors ?? [], door.x, step.position.z),
        10,
      );
    });
    // it climbs, from just over the low floor to just under the high one
    const tops = steps.map(topOf);
    expect(tops[0]).toBeCloseTo(0.15, 10);
    expect(tops[9]).toBeCloseTo(2.85, 10);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  it('runs steps across a west to east door along x, on the same rule', () => {
    const group = new THREE.Group();
    addAuthoredRelief(group, WEST_EAST, 'citadel');
    const door = WEST_EAST.doors?.[0];
    if (!door) throw new Error('the fixture has a door');
    const steps = boxes(group).slice(1);
    const half = doorRampHalf(door.hw, 1.8);
    expect(half).toBe(3);
    expect(steps).toHaveLength(7);
    steps.forEach((step, i) => {
      expect(step.position.z).toBe(door.z);
      expect(step.position.x).toBeCloseTo(door.x - half + (i + 0.5) * (6 / 7), 10);
      expect(sizeOf(step).depth).toBe(door.hd * 2 + 1);
      expect(topOf(step)).toBeCloseTo(
        authoredLiftAt(WEST_EAST.rooms ?? [], WEST_EAST.doors ?? [], step.position.x, door.z),
        10,
      );
    });
  });

  it('cuts a short ramp into its seven treads and a long one into sixteen, never more', () => {
    const rise = (lift: number): number => {
      const group = new THREE.Group();
      addAuthoredRelief(
        group,
        layoutOf({
          rooms: [
            { id: 'low', x0: -5, x1: 5, z0: 0, z1: 10 },
            { id: 'high', x0: -5, x1: 5, z0: 10, z1: 20, lift },
          ],
          doors: [{ x: 0, z: 10, hw: 2, hd: 1 }],
        }),
        'citadel',
      );
      return group.children.length - 1;
    };
    // a door's ramp is never shorter than three yards a side (doorRampHalf), so the
    // fewest treads a rise can have is those six yards in 0.9 yard treads
    expect(rise(0.4)).toBe(7);
    expect(rise(12)).toBe(16);
  });
});

describe('the ledges of an authored floor', () => {
  const WITH_LEDGE = layoutOf({
    rooms: NORTH_SOUTH.rooms,
    doors: NORTH_SOUTH.doors,
    ledges: [{ x: 0, z: 15, hw: 1, hd: 0.6, top: 2 }],
  });

  it('adds nothing to a floor with no ledge', () => {
    const group = new THREE.Group();
    addAuthoredLedges(group, NORTH_SOUTH, 'citadel');
    expect(group.children).toHaveLength(0);
  });

  it('draws a shelf whose top is the collider, on the lifted room it stands in, over a bracket', () => {
    const group = new THREE.Group();
    addAuthoredLedges(group, WITH_LEDGE, 'citadel');
    const [slab, post] = boxes(group);
    expect(group.children).toHaveLength(2);
    // three yards of room lift plus the shelf's own two
    expect(topOf(slab)).toBeCloseTo(5, 10);
    expect(sizeOf(slab)).toMatchObject({ width: 2, height: 0.5, depth: 1.2 });
    expect(slab.castShadow).toBe(true);
    // the bracket fills from the ground to the shelf's underside
    expect(post.position.y - sizeOf(post).height / 2).toBeCloseTo(0, 10);
    expect(topOf(post)).toBeCloseTo(4.5, 10);
  });
});

describe('the stone it is cut from', () => {
  const WITH_LEDGE = layoutOf({
    rooms: NORTH_SOUTH.rooms,
    doors: NORTH_SOUTH.doors,
    ledges: [{ x: 0, z: 15, hw: 1, hd: 0.6, top: 2 }],
  });
  const build = (variant: string): Box[] => {
    const group = new THREE.Group();
    addAuthoredRelief(group, WITH_LEDGE, variant);
    addAuthoredLedges(group, WITH_LEDGE, variant);
    return boxes(group);
  };

  it('is the palace painted stone, in palace boxes, once the kit has loaded', () => {
    kit.loaded = true;
    const built = build('dawnhold');
    expect(built).toHaveLength(13);
    for (const mesh of built) {
      expect(mesh.material).toBe(PALACE_STONE.current);
      expect(mesh.geometry.userData.palaceSlab).toBe(true);
    }
  });

  it('is the plain slab in a palace whose kit has not loaded yet', () => {
    const built = build('dawnhold');
    expect(built).toHaveLength(13);
    for (const mesh of built) {
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(mesh.geometry.userData.palaceSlab).toBeUndefined();
    }
  });

  it('is the plain slab on every other authored floor, kit or no kit', () => {
    kit.loaded = true;
    const built = build('citadel');
    expect(built).toHaveLength(13);
    for (const mesh of built) {
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(mesh.geometry.userData.palaceSlab).toBeUndefined();
    }
  });
});
