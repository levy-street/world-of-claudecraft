import { describe, expect, it } from 'vitest';
import {
  type EastbrookRoofVisibilityTarget,
  eastbrookCameraSegmentHitsRoof,
} from '../src/render/eastbrook_town_visibility_core';

// The camera fade on an Eastbrook building, for a sealed one and for a walk-in
// one (an open doorway the player walks through, eastbrook_layout.ts walkIn).
// A building 10 wide and 8 deep, unturned, at the origin, its roof line 6 up.

function target(walkIn: boolean): EastbrookRoofVisibilityTarget {
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
  return eastbrookCameraSegmentHitsRoof(
    target(walkIn),
    eye.x,
    eye.y,
    eye.z,
    camera.x,
    camera.y,
    camera.z,
  );
}

describe('the Eastbrook building camera fade', () => {
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
});
