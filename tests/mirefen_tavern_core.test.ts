import { describe, expect, it } from 'vitest';
import {
  eyeInTavern,
  hallRoofUnderside,
  mirefenTavernParts,
  newTavernShellState,
  TAVERN_EYE_OVER_FEET,
  TAVERN_FRONT_SPLIT,
  TAVERN_SHELL_PARTS,
  type TavernShellPart,
  tavernShellOcclusion,
  tavernShelters,
} from '../src/render/mirefen_tavern_core';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_PROPS,
  TAVERN_TOWER,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';

// The Mirefen tavern camera cutaway and tiers (src/render/mirefen_tavern_core.ts). Indoors the
// indoor camera clamp keeps the camera in the tavern's air (interior_camera.ts, the authored
// interior exception to tests/graphics_overhaul_integration.test.ts), so the outer shell never
// opens and only the bar's pillar, standing in the air, cuts away; outdoors (or while the lens
// follows a player in through the door) each part that hides the player ghosts, the front
// wall in three pieces and the porch on its own, and the open doorway hides nothing. Pins
// which parts go for the orbits a player really takes, and the tiers.

type P = { x: number; y: number; z: number };
/** The eye over a player standing at local (lx, lz) with feet at local height ly (world). */
const eye = (lx: number, lz: number, ly = 0): P => {
  const w = tavernToWorld(lx, lz);
  return { x: w.x, y: TAVERN_FLOOR_Y + ly + TAVERN_EYE_OVER_FEET, z: w.z };
};
/** A camera at local (lx, ly, lz), in the world. */
const cam = (lx: number, ly: number, lz: number): P => {
  const w = tavernToWorld(lx, lz);
  return { x: w.x, y: TAVERN_FLOOR_Y + ly, z: w.z };
};
/** The shell's decision for an eye and a lens; `indoors` is the camera clamp's verdict (the
 *  lens in the air), as the painter passes it, else the eye decides. */
function decide(
  e: P,
  c: P,
  indoors?: boolean,
): { inside: boolean; floor: number; cut: TavernShellPart[] } {
  const s = tavernShellOcclusion(e.x, e.y, e.z, c.x, c.y, c.z, newTavernShellState(), indoors);
  return {
    inside: s.inside,
    floor: s.floor,
    cut: TAVERN_SHELL_PARTS.filter((_, i) => s.occluded[i]),
  };
}

describe('tavern cutaway: indoors', () => {
  it('counts the hall, the doorway and the nook as indoors, the porch, road and kitchen not', () => {
    const inside = (lx: number, lz: number, ly = 0) =>
      eyeInTavern(lx, ly + TAVERN_EYE_OVER_FEET, lz);
    expect(inside(0, 0)).toBe(true);
    expect(inside(0, 13.9)).toBe(true); // the doorway
    expect(inside(TAVERN_TOWER.x + 3, TAVERN_TOWER.z)).toBe(true); // in the nook
    expect(inside(10, -22)).toBe(false); // the closed kitchen and cellar
    expect(inside(0, 15.5)).toBe(false); // the porch
    expect(inside(0, 22)).toBe(false); // the road
    expect(inside(-20, 0)).toBe(false); // outside the left wall
  });

  it('never opens the outer shell indoors, wherever the camera would stand', () => {
    // by the fire, a camera out past the front door, low: nothing (the clamp keeps it inside)
    let d = decide(eye(0, 8), cam(0, 5, 20));
    expect(d.inside).toBe(true);
    expect(d.floor).toBe(0);
    expect(d.cut).toEqual([]);
    // a camera out past the left wall and high over the eaves: the wall and roof stay
    d = decide(eye(-8, 0), cam(-22, 16, 0));
    expect(d.cut).toEqual([]);
    // at the arch into the nook, a camera high back over the hall: the back wall (whose far
    // end fronts the outside) stays whole
    d = decide(eye(-3, -14), cam(-3, 8.5, -2));
    expect(d.inside).toBe(true);
    expect(d.cut).toEqual([]);
    // a camera zoomed in inside the room: nothing is cut
    d = decide(eye(0, 6), cam(0, 5, 10));
    expect(d.cut).toEqual([]);
  });

  it("cuts the bar's pillar away on the sight line and hard by the lens, and only it", () => {
    const pillar = TAVERN_PROPS.find((p) => p.kind === 'pillar');
    if (!pillar) throw new Error('pillar');
    // at the bar, the camera over the room with the pillar between: it goes
    let d = decide(eye(7.5, -9, 0.5), cam(1.5, 6, -6.2));
    expect(d.inside).toBe(true);
    expect(d.cut).toEqual(['BarPillar']);
    // the lens beside the pillar (the pillar filling the foreground), not on the line: it goes
    d = decide(eye(9, -2), cam(pillar.x + 1.9, 4, pillar.z));
    expect(d.cut).toEqual(['BarPillar']);
    // clear of it: it stays
    d = decide(eye(9, -2), cam(9, 5, 8));
    expect(d.cut).toEqual([]);
  });

  it('takes the doorway threshold as outdoors (the camera clamps once a body is in the room)', () => {
    expect(decide(eye(0, 13.6), cam(0, 5, 20)).inside).toBe(false);
    expect(decide(eye(0, 12.8), cam(0, 5, 20)).inside).toBe(true);
  });

  it('keeps the tower wall whole for a player in the nook', () => {
    const T = TAVERN_TOWER;
    const d = decide(eye(T.x - 4, T.z - 1), cam(T.x - 14, 7, T.z - 3));
    expect(d.inside).toBe(true);
    expect(d.cut).not.toContain('TowerWall');
  });
});

describe('tavern cutaway: outdoors', () => {
  it('ghosts the parts that hide a player outside, and nothing when nothing hides him', () => {
    let d = decide(eye(-19, 0), cam(22, 10, 0));
    expect(d.inside).toBe(false);
    expect(d.floor).toBe(OCCLUDER_FADE_ALPHA);
    expect(d.cut).toContain('HallWallLeft');
    expect(d.cut).toContain('HallWallRight');
    d = decide(eye(0, 22), cam(0, 6, 32));
    expect(d.cut).toEqual([]);
  });

  it('hides nothing through the open doorway: a lens following a player in threads it', () => {
    // the player a few strides in, the lens out on the road behind at the door's head (the
    // clamp's verdict: the lens outside the air): the sight line runs out through the doorway
    // and crosses no part of the front
    for (const lz of [12.5, 11, 9, 7, 5]) {
      const d = decide(eye(0, lz), cam(0, 4.6, lz + 12), false);
      expect(d.inside, `${lz}`).toBe(false);
      expect(d.cut, `${lz}`).toEqual([]);
    }
    // a little off the door's middle and a little low: still through the door
    expect(decide(eye(1.2, 10), cam(-0.4, 3.8, 22), false).cut).toEqual([]);
  });

  it('ghosts only the piece of the front between the lens and the player, never the whole', () => {
    // a lens up over the door, the player just inside: only the gable over the door
    let d = decide(eye(0, 11), cam(0, 20, 20), false);
    expect(d.cut).toContain('HallWallFront');
    expect(d.cut).not.toContain('HallWallFrontLeft');
    expect(d.cut).not.toContain('HallWallFrontRight');
    expect(d.cut).not.toContain('HallRoof');
    // a lens out to the left of the door at an angle: only the wall left of the door
    d = decide(eye(0, 11), cam(-14, 4, 17), false);
    expect(d.cut).toEqual(['HallWallFrontLeft']);
    d = decide(eye(0, 11), cam(14, 4, 17), false);
    expect(d.cut).toEqual(['HallWallFrontRight']);
    // a player in the doorway under a lens high out behind: the porch's canopy alone
    d = decide(eye(0, 13.8), cam(0, 16, 24), false);
    expect(d.cut).toEqual(['HallPorch']);
    // (the front's three pieces meet beside the door's posts)
    expect(TAVERN_FRONT_SPLIT).toBeGreaterThan(TAVERN_DOOR.width / 2);
  });
});

describe('tavern roof and shelter', () => {
  it('reads the roof underside from its line, and the hammer beams along the walls', () => {
    expect(hallRoofUnderside(0, 0)).toBeGreaterThan(TAVERN_HALL.ridge - 1);
    expect(hallRoofUnderside(14, 0)).toBeLessThanOrEqual(TAVERN_HALL.truss);
    expect(hallRoofUnderside(8, 0)).toBeGreaterThan(TAVERN_HALL.truss);
    expect(hallRoofUnderside(40, 0)).toBe(Infinity);
  });

  it('shelters a body inside from the weather, never one on the porch', () => {
    const inHall = tavernToWorld(0, 5);
    expect(tavernShelters(inHall.x, TAVERN_FLOOR_Y, inHall.z)).toBe(true);
    const porch = tavernToWorld(0, 15.5);
    expect(tavernShelters(porch.x, TAVERN_FLOOR_Y, porch.z)).toBe(false);
  });

  it('keeps the whole building on every tier, trim from medium, clutter from high', () => {
    expect(mirefenTavernParts('low')).not.toContain('TavernTrim');
    expect(mirefenTavernParts('medium')).toContain('TavernTrim');
    expect(mirefenTavernParts('medium')).not.toContain('TavernClutter');
    expect(mirefenTavernParts('high')).toContain('TavernClutter');
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      for (const name of TAVERN_SHELL_PARTS) expect(mirefenTavernParts(tier)).toContain(name);
      expect(mirefenTavernParts(tier)).toContain('TavernLights');
      expect(mirefenTavernParts(tier)).toContain('TavernFurnishings');
    }
  });
});
