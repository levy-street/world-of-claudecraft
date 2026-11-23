import { describe, expect, it } from 'vitest';
import {
  type FenbridgeBuildingVisibilityTarget,
  fenbridgeCameraSegmentHitsBuilding,
} from '../src/render/fenbridge_town_visibility_core';

// The camera fade on a Fenbridge building, for a sealed one and for a walk-in
// one (an open doorway the player walks through). A building 10 wide and 8
// deep, unturned, at the origin, its roof line 6 up.

function target(walkIn: boolean): FenbridgeBuildingVisibilityTarget {
  return {
    x: 0,
    z: 0,
    halfWidth: 5,
    halfDepth: 4,
    cosine: 1,
    sine: 0,
    topY: 6,
    cullRadius: 8,
    walkIn,
  };
}

const INSIDE = { x: 1, y: 1.5, z: 1 };
const INSIDE_TOO = { x: -3, y: 3, z: -2 };
const OUTSIDE = { x: 1, y: 3, z: 12 };
const OVER_THE_ROOF = { x: 1, y: 9, z: 2 };
const FAR_SIDE = { x: 1, y: 1.5, z: -12 };

function hits(
  walkIn: boolean,
  eye: { x: number; y: number; z: number },
  camera: { x: number; y: number; z: number },
): boolean {
  return fenbridgeCameraSegmentHitsBuilding(
    target(walkIn),
    eye.x,
    eye.y,
    eye.z,
    camera.x,
    camera.y,
    camera.z,
  );
}

describe('the Fenbridge building camera fade', () => {
  it('keeps a walk-in building solid while the player and the camera are both inside', () => {
    expect(hits(true, INSIDE, INSIDE_TOO)).toBe(false);
    // the same two points fade a sealed building, which nobody stands inside
    expect(hits(false, INSIDE, INSIDE_TOO)).toBe(true);
  });

  it('fades a walk-in building when the camera is outside its walls or over its roof', () => {
    expect(hits(true, INSIDE, OUTSIDE)).toBe(true);
    expect(hits(true, INSIDE, OVER_THE_ROOF)).toBe(true);
  });

  it('fades either kind when it stands between a player outside and the camera', () => {
    for (const walkIn of [true, false]) {
      expect(hits(walkIn, OUTSIDE, FAR_SIDE), `walkIn ${walkIn}`).toBe(true);
      expect(hits(walkIn, OUTSIDE, INSIDE), `walkIn ${walkIn}: camera inside`).toBe(true);
      // nothing in the way: player and camera on the same open side
      expect(hits(walkIn, OUTSIDE, { x: 4, y: 4, z: 16 }), `walkIn ${walkIn}: clear view`).toBe(
        false,
      );
    }
  });

  it('keeps a walk-in building solid while its door frames the view in from outside', () => {
    // a door 2 wide and 4 high through the +z wall (z 4), the box its camera air opens with
    const withDoor: FenbridgeBuildingVisibilityTarget = {
      ...target(true),
      doorways: [[-1, 1, 0, 4, 3.5, 4.5]],
    };
    const fade = (
      eye: { x: number; y: number; z: number },
      camera: { x: number; y: number; z: number },
    ) =>
      fenbridgeCameraSegmentHitsBuilding(
        withDoor,
        eye.x,
        eye.y,
        eye.z,
        camera.x,
        camera.y,
        camera.z,
      );
    // a step in, the camera still out on the step behind: it looks in through the door
    const stepIn = { x: 0, y: 1.6, z: 3.6 };
    expect(fade(stepIn, { x: 0, y: 3, z: 12 })).toBe(false);
    // the same without the doorway known: the old rule fades the whole building
    expect(hits(true, stepIn, { x: 0, y: 3, z: 12 })).toBe(true);
    // a camera off to the side looks through the wall beside the door: it still fades
    expect(fade(stepIn, { x: 14, y: 3, z: 8 })).toBe(true);
    // ...and one high over the lintel looks through the wall above it
    expect(fade(stepIn, { x: 0, y: 30, z: 6 })).toBe(true);
    // a sealed building never reads a doorway
    expect(
      fenbridgeCameraSegmentHitsBuilding(
        { ...withDoor, walkIn: false },
        stepIn.x,
        stepIn.y,
        stepIn.z,
        0,
        3,
        12,
      ),
    ).toBe(true);
  });

  it('reads a turned building doorways in its own frame', () => {
    // the same building stood at (12, -7) and turned the Eastbrook smithy's 20 degrees and the
    // bank's 225; its door, 2 wide through the +z wall, authored in its camera air's frame,
    // whose origin (the model's anchor) stands 2 yards along its own +x from the middle of
    // the walls
    for (const rotation of [(20 * Math.PI) / 180, (225 * Math.PI) / 180]) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      /** A point of the building's own axes (off the middle of its walls) in the world. */
      const at = (x: number, y: number, z: number) => ({
        x: 12 + x * cos + z * sin,
        y,
        z: -7 - x * sin + z * cos,
      });
      const anchor = at(2, 0, 0);
      const turned: FenbridgeBuildingVisibilityTarget = {
        ...target(true),
        x: 12,
        z: -7,
        cosine: cos,
        sine: sin,
        doorways: [[-3, -1, 0, 4, 3.5, 4.5]],
        doorwayFrame: { x: anchor.x, z: anchor.z, cos, sin },
      };
      const fade = (
        eye: { x: number; y: number; z: number },
        camera: { x: number; y: number; z: number },
      ) =>
        fenbridgeCameraSegmentHitsBuilding(
          turned,
          eye.x,
          eye.y,
          eye.z,
          camera.x,
          camera.y,
          camera.z,
        );
      // a step in, the camera out behind on the step: it looks in through the turned door
      expect(fade(at(0, 1.6, 3.6), at(0, 3, 12)), `${rotation}`).toBe(false);
      expect(fade(at(0.85, 1.6, 3.6), at(0.85, 3, 12)), `${rotation}`).toBe(false);
      // a hand past the door's jamb, inside the world box round the turned door, it looks
      // through the wall: it fades
      expect(fade(at(1.15, 1.6, 3.6), at(1.15, 3, 12)), `${rotation}`).toBe(true);
      // off to the side, and high over the lintel: through the wall, it fades
      expect(fade(at(0, 1.6, 3.6), at(14, 3, 8)), `${rotation}`).toBe(true);
      expect(fade(at(0, 1.6, 3.6), at(0, 30, 6)), `${rotation}`).toBe(true);
    }
  });
});
