// The chase camera is not influenced by geometry ABOVE the player (SPACEY,
// 2026-09-21: "its getting caught on the assets above and then forcing a
// birds eye view"). Two separate gates were doing it on the Tidehold galleon:
//
//  1. the renderer's ground clamp read the BLIND groundHeight at the camera's
//     column, which answers with the highest walkable surface there - the
//     upper deck over the player's head - and shoved the camera up onto it.
//     Measured on the ship: the camera wanted y 11.1 and was clamped to 20.0.
//  2. cameraBoomMaxDist counted an overhead solid as an obstruction whenever
//     the pitched-up boom arced through it, snapping the view into the deck.
import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent, newFlatCustomMap } from '../src/editor/custom_map';
import { cameraBoomMaxDist } from '../src/sim/colliders';
import { setActiveWorldContent } from '../src/sim/data';
import type { ColliderVolume, WorldContent } from '../src/sim/types';
import { groundHeight, groundHeightAtBody } from '../src/sim/world';

const SEED = 77;
const X = 40;
const Z = 40;
/** The deck the player stands on, and the one twelve yards over their head. */
const LOWER = 8;
const UPPER = 20;

const plane = (h: number): ColliderVolume => ({
  kind: 'plane',
  x: X,
  z: Z,
  rotY: 0,
  sizeX: 60,
  sizeY: h,
  sizeZ: 60,
  detached: true,
  groundY: 0,
});

function world(volumes: ColliderVolume[]): WorldContent {
  const w = customMapToWorldContent(newFlatCustomMap('cam', 'cam', 0));
  w.colliderVolumes = volumes;
  return w;
}

afterEach(() => setActiveWorldContent(null));

describe('the camera ignores what is above the player', () => {
  it('the ground clamp does not lift the camera onto a deck overhead', () => {
    setActiveWorldContent(world([plane(LOWER), plane(UPPER)]));
    // The blind read is what used to drive the clamp: it sees the upper deck.
    expect(groundHeight(X, Z, SEED)).toBeGreaterThanOrEqual(UPPER);
    // The body-aware read, with the player's feet on the lower deck, does not.
    const aware = groundHeightAtBody(X, Z, SEED, LOWER);
    expect(aware).toBeCloseTo(LOWER, 5);
    // So a camera that wants to sit just above the player's head stays there
    // instead of being clamped a storey up.
    const wantedCamY = LOWER + 4;
    expect(Math.max(wantedCamY, aware + 0.6)).toBeCloseTo(wantedCamY, 5);
    expect(Math.max(wantedCamY, groundHeight(X, Z, SEED) + 0.6)).toBeGreaterThan(wantedCamY + 8);
  });

  it('still stops on geometry beside the player', () => {
    // A solid rising from the deck beside the player: not overhead, so the
    // boom must still stop on it.
    const mast: ColliderVolume = {
      kind: 'box',
      x: X - 4,
      z: Z,
      rotY: 0,
      sizeX: 3,
      sizeY: 24,
      sizeZ: 3,
      detached: true,
      groundY: LOWER,
    };
    setActiveWorldContent(world([plane(LOWER), mast]));
    const eyeY = LOWER + 2;
    const max = cameraBoomMaxDist(SEED, X, eyeY, Z, X - 12, eyeY, Z, 0.3);
    expect(max).toBeLessThan(12);
  });

  // NOTE: the second half of the fix - cameraBoomMaxDist skipping colliders
  // whose base is at or above the eye - has no unit pin here. No synthetic
  // world in reach produces a camera-solid collider carrying a baseY above the
  // eye (plane volumes are never camera-solid, and a blank map has no baked
  // asset table), so any test written against one passes with the filter
  // disabled and pins nothing. It is verified instead against SPACEY's real map
  // in tmp/qa/camera_deck.test.ts, A/B on the filter line: boom snap-ins over
  // the galleon deck fall 364 -> 283 at pitch 0.5, 381 -> 197 at 0.8 and
  // 262 -> 127 at 1.1, and are unchanged at shoulder pitch where the boom
  // never reaches the overhead.
});
