import { describe, expect, it } from 'vitest';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  eyeInHouse,
  HOUSE_EYE_OVER_FEET,
  HOUSE_SHELL_PARTS,
  type HouseShellPart,
  houseFrame,
  houseShellOcclusion,
  newHouseShellState,
} from '../src/render/wyrmwatch_harbor_house_core';
import { HARBOR_HOUSE, HARBOR_HOUSE_INTERIOR } from '../src/sim/content/wyrmwatch_harbor_house';
import { WATER_LEVEL } from '../src/sim/world';

// The Harbormaster's House camera cutaway (src/render/wyrmwatch_harbor_house_core.ts). The
// chase camera never changes its distance (tests/graphics_overhaul_integration.test.ts), so
// indoors the walls between the camera and the player and the roof over its sight line are
// cut away, and outdoors the whole shell ghosts when it hides the player. Pins which parts
// go, for the orbits a player really takes, and that nothing is cut from a camera inside.

const H = HARBOR_HOUSE;
const I = HARBOR_HOUSE_INTERIOR;
const frame = houseFrame(WATER_LEVEL);
const floor = frame.floorY;
/** The eye over a player standing at (x, z) on the floor. */
const eye = (x: number, z: number) => ({ x, y: floor + HOUSE_EYE_OVER_FEET, z });
/** The chase camera's spot for a yaw, pitch and distance (renderer.ts: behind the eye). */
function cam(e: { x: number; y: number; z: number }, yaw: number, pitch: number, dist: number) {
  return {
    x: e.x - Math.sin(yaw) * Math.cos(pitch) * dist,
    y: e.y + Math.sin(pitch) * dist,
    z: e.z - Math.cos(yaw) * Math.cos(pitch) * dist,
  };
}
function decide(
  e: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
): { inside: boolean; floor: number; cut: HouseShellPart[] } {
  const s = houseShellOcclusion(e.x, e.y, e.z, c.x, c.y, c.z, WATER_LEVEL, newHouseShellState());
  return {
    inside: s.inside,
    floor: s.floor,
    cut: HOUSE_SHELL_PARTS.filter((_, i) => s.occluded[i]),
  };
}

describe('harbor house cutaway: indoors', () => {
  const mid = eye((I.x0 + I.x1) / 2, (I.z0 + I.z1) / 2);

  it('counts the eye over the floor, the doorway included, as indoors', () => {
    expect(eyeInHouse(mid.x, mid.y, mid.z, floor)).toBe(true);
    const door = eye(H.door.x, H.z + H.hd - 0.2);
    expect(eyeInHouse(door.x, door.y, door.z, floor)).toBe(true);
    // a swimmer under the stilts is not indoors; nor is a player on the yard
    expect(eyeInHouse(mid.x, WATER_LEVEL + HOUSE_EYE_OVER_FEET - 0.3, mid.z, floor)).toBe(false);
    const yard = eye(H.door.x, H.z + H.hd + 1.0);
    expect(eyeInHouse(yard.x, yard.y, yard.z, floor)).toBe(false);
  });

  it('cuts away only the wall the camera stands behind, and the roof over the sight line', () => {
    // looking north at the map from the room's middle: the camera is out past the door wall
    const north = decide(mid, cam(mid, Math.PI, 0.3, 12));
    expect(north.inside).toBe(true);
    expect(north.floor).toBe(0);
    expect(north.cut).toContain('HouseWallSouth');
    expect(north.cut).not.toContain('HouseWallNorth');
    expect(north.cut).not.toContain('HouseWallEast');
    expect(north.cut).not.toContain('HouseWallWest');
    // looking at the hearth (west): the sea wall goes
    const west = decide(mid, cam(mid, -Math.PI / 2, 0.3, 12));
    expect(west.cut).toContain('HouseWallEast');
    expect(west.cut).not.toContain('HouseWallWest');
    // looking out to sea (east): the land wall goes
    const east = decide(mid, cam(mid, Math.PI / 2, 0.3, 12));
    expect(east.cut).toContain('HouseWallWest');
    expect(east.cut).not.toContain('HouseWallEast');
    // a diagonal orbit cuts the two walls on its side
    const diag = decide(mid, cam(mid, Math.PI * 0.75, 0.3, 12));
    expect(diag.cut).toEqual(expect.arrayContaining(['HouseWallSouth', 'HouseWallWest']));
  });

  it('cuts the roof whenever the camera looks down through it, never from under the rafters', () => {
    // high over the room (the overhead orbit)
    expect(decide(mid, cam(mid, Math.PI, 1.1, 14)).cut).toContain('HouseRoof');
    // a camera zoomed in inside the room: nothing is cut, the rafters close overhead
    const close = cam(mid, Math.PI, 0.2, 3);
    expect(close.z).toBeLessThan(I.z1);
    expect(decide(mid, close).cut).toEqual([]);
    // looking up at the rafters from inside: the roof stays
    expect(decide(mid, cam(mid, Math.PI / 2, -0.3, 3)).cut).not.toContain('HouseRoof');
  });

  it('cuts nothing at all while every part stands clear of the sight line', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      expect(decide(mid, cam(mid, yaw, 0.1, 2)).cut, `yaw ${yaw}`).toEqual([]);
    }
  });
});

describe('harbor house cutaway: outdoors', () => {
  it('ghosts the whole shell when it stands between the camera and a player outside', () => {
    // on the yard before the door, looking south, the camera out over the house to the north:
    // the house hides the player
    const yard = eye(H.door.x + 1, H.z + H.hd + 2.5);
    const behind = decide(yard, cam(yard, 0, 0.25, 14));
    expect(behind.inside).toBe(false);
    expect(behind.floor).toBe(OCCLUDER_FADE_ALPHA);
    expect(behind.cut).toEqual([...HOUSE_SHELL_PARTS]);
    // looking at the house, the camera south of the player: nothing fades
    expect(decide(yard, cam(yard, Math.PI, 0.25, 12)).cut).toEqual([]);
  });

  it('never ghosts for a player standing against the house (the eye clearance)', () => {
    const against = eye(H.door.x + 2, H.z + H.hd + 0.6);
    expect(decide(against, cam(against, 0, 0.25, 12)).cut).toEqual([]);
  });

  it('leaves the house alone from the stair top and the pier', () => {
    const top = { x: 490.5, y: WATER_LEVEL + 8.5 + HOUSE_EYE_OVER_FEET, z: 1908.4 };
    expect(decide(top, cam(top, Math.PI, 0.35, 12)).cut).toEqual([]);
    const pier = eye(500, 1899.2);
    expect(decide(pier, cam(pier, -Math.PI / 2, 0.2, 12)).cut).toEqual([]);
  });
});
