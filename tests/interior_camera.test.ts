import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeCameraInterior,
  clampChaseCameraToInterior,
  constrainInteriorCameraDraw,
  hideSelfInCloseCamera,
  interiorCameraInternalsForTest,
  interiorHidesNameplate,
  interiorLensInAir,
  registerCameraInterior,
  restoreInteriorCameraDraw,
} from '../src/render/interior_camera';
import {
  type CameraInterior,
  cameraInterior,
  INTERIOR_BOOM_MAX_LAG,
  interiorContains,
  interiorSegmentFraction,
} from '../src/render/interior_camera_core';

// The indoor chase-camera clamp's driver (src/render/interior_camera.ts): the registry, the
// per-frame clamp (a glide both ways: a quick bounded pull-in and an eased release; the clamp
// blended in over the threshold; walking in, the lens following through the door, threading
// it, then coming in; outdoors untouched), the look point brought back to the eye across a
// wall, the draw-time re-check of a shaken camera and its exact restore, and the nameplate
// gate for bodies outside; and the same clamp in a room turned to any angle.

// one room x 0..10, z 0..10, y 0..5, its front door out of the -z wall (x 4..6, z -1..1.5)
const ROOM = cameraInterior(
  'room',
  [
    [0, 10, 0, 5, 0, 10],
    [4, 6, 0, 3, -1, 1.5],
  ],
  [{ box: 1, axis: 2, side: -1 }],
);

function camera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
}

/** One updateCamera frame: the desired camera `c` and the look point over feet `self`. */
function frame(
  cam: THREE.PerspectiveCamera,
  self: THREE.Vector3,
  c: [number, number, number],
  dt = 1 / 60,
  reduced = false,
): THREE.Vector3 {
  const look = new THREE.Vector3(self.x, self.y + 2, self.z);
  cam.position.set(c[0], c[1], c[2]);
  clampChaseCameraToInterior(cam, look, self, dt, reduced);
  return look;
}

/** Hold one pose for `n` frames (the glide settles in well under half a second). */
function settle(
  cam: THREE.PerspectiveCamera,
  self: THREE.Vector3,
  c: [number, number, number],
  n = 60,
): THREE.Vector3 {
  let look = frame(cam, self, c);
  for (let i = 1; i < n; i++) look = frame(cam, self, c);
  return look;
}

afterEach(() => interiorCameraInternalsForTest.reset());

describe('indoor camera clamp', () => {
  it('leaves the camera untouched outdoors (the no-pull-in rule holds outside interiors)', () => {
    const cam = camera();
    // nothing registered: nothing moves, wherever the camera would stand
    frame(cam, new THREE.Vector3(5, 0, 5), [-20, 3, 5]);
    expect(cam.position.toArray()).toEqual([-20, 3, 5]);
    // a room registered, the player out on the road: still nothing moves
    registerCameraInterior(ROOM);
    frame(cam, new THREE.Vector3(5, 0, -20), [5, 6, -30]);
    expect(cam.position.toArray()).toEqual([5, 6, -30]);
    expect(activeCameraInterior()).toBe(null);
  });

  it('pulls the camera in to stay inside while the player is indoors', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    const self = new THREE.Vector3(8, 0, 5);
    // the desired camera out past the +x wall: pulled in along the ray, inside the wall
    // (a comfortable boom there is, so no lift), gliding there over a few frames
    const roomy = new THREE.Vector3(5, 0, 5);
    settle(cam, roomy, [20, 2, 5], 30);
    expect(activeCameraInterior()?.id).toBe('room');
    expect(interiorLensInAir()).toBe(true);
    expect(cam.position.x).toBeLessThan(10);
    expect(cam.position.x).toBeGreaterThan(8);
    expect(cam.position.y).toBeCloseTo(2, 6);
    expect(interiorContains(ROOM, cam.position.x, cam.position.y, cam.position.z)).toBe(true);
    // through the ceiling: stays under it
    settle(cam, self, [8, 20, 5], 30);
    expect(cam.position.y).toBeLessThan(5);
    // a camera already inside: left where it is (once the release from the ceiling settles)
    for (let i = 0; i < 120; i++) frame(cam, self, [3, 3, 5]);
    expect(cam.position.x).toBeCloseTo(3, 3);
    expect(cam.position.y).toBeCloseTo(3, 3);
  });

  it('frames a cramped spot comfortably, and glides into the framing', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    // against the +x wall, the camera wanted out past it: cramped, so it finds a framing
    const self = new THREE.Vector3(9, 0, 5);
    const eye = new THREE.Vector3(9, 2, 5);
    frame(cam, self, [20, 2, 5], 1 / 60, true);
    const framed = cam.position.clone();
    expect(framed.distanceTo(eye)).toBeGreaterThan(2.5);
    expect(interiorContains(ROOM, framed.x, framed.y, framed.z)).toBe(true);
    // a fresh approach without reduced motion glides there over frames, not at once
    interiorCameraInternalsForTest.reset();
    registerCameraInterior(ROOM);
    settle(cam, new THREE.Vector3(5, 0, 5), [1, 2, 5]);
    frame(cam, self, [20, 2, 5]);
    const first = cam.position.clone();
    expect(first.distanceTo(framed)).toBeGreaterThan(0.2);
    // the quick pull-in lags the wall by at most its cap, never a view out past the room
    expect(first.x).toBeLessThan(10 + INTERIOR_BOOM_MAX_LAG);
    for (let i = 0; i < 150; i++) frame(cam, self, [20, 2, 5]);
    expect(cam.position.distanceTo(framed)).toBeLessThan(0.05);
    expect(interiorLensInAir()).toBe(true);
  });

  it('glides a pull-in both ways: bounded per frame, never snapping, and back in the air fast', () => {
    // a big hall (its +x wall at 30), the player 5 yards off that wall
    registerCameraInterior(cameraInterior('big', [[0, 30, 0, 12, 0, 30]]));
    const cam = camera();
    const self = new THREE.Vector3(25, 0, 15);
    const eye = new THREE.Vector3(25, 2, 15);
    // settled looking over the open hall, then swung round toward the +x wall
    settle(cam, self, [17, 2, 15]);
    expect(cam.position.distanceTo(eye)).toBeCloseTo(8, 3);
    let prev = cam.position.distanceTo(eye);
    let outside = 0;
    for (let i = 0; i < 30; i++) {
      frame(cam, self, [33, 2, 15]);
      const boom = cam.position.distanceTo(eye);
      // never longer than it was, never lagging the wall past the cap
      expect(boom).toBeLessThanOrEqual(prev + 1e-9);
      expect(cam.position.x).toBeLessThan(30 + INTERIOR_BOOM_MAX_LAG);
      if (!interiorLensInAir()) outside++;
      prev = boom;
    }
    // the lens is back in the air within a few frames (a tenth of a second at most)
    expect(outside).toBeLessThanOrEqual(6);
    expect(cam.position.x).toBeLessThan(30);
    expect(cam.position.distanceTo(eye)).toBeGreaterThan(4.5);
    // and swung back to the open room it glides out: bounded speed, converging
    prev = cam.position.distanceTo(eye);
    for (let i = 0; i < 90; i++) {
      frame(cam, self, [17, 2, 15]);
      const boom = cam.position.distanceTo(eye);
      expect(boom).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(boom - prev).toBeLessThan(0.8); // under 48 yards a second
      prev = boom;
    }
    expect(cam.position.distanceTo(eye)).toBeCloseTo(8, 2);
  });

  it('keeps the lens in the room while the camera turns near a wall, a fast swing for a moment', () => {
    registerCameraInterior(cameraInterior('big', [[0, 30, 0, 12, 0, 30]]));
    const cam = camera();
    const self = new THREE.Vector3(27, 0, 15);
    for (const [rate, most] of [
      [1.5, 2],
      [6, 4],
    ] as const) {
      let run = 0;
      let longest = 0;
      for (let i = 0; i < 600; i++) {
        const yaw = (rate * i) / 60;
        const c: [number, number, number] = [
          27 - Math.sin(yaw) * Math.cos(0.32) * 12,
          2 + Math.sin(0.32) * 12,
          15 - Math.cos(yaw) * Math.cos(0.32) * 12,
        ];
        frame(cam, self, c);
        if (i < 60) continue;
        run = interiorLensInAir() ? 0 : run + 1;
        longest = Math.max(longest, run);
      }
      // a steady turn never leaves the room; a whip round leaves it for a few frames at most
      // (the shell's cutaway covers those)
      expect(longest, `turning at ${rate} rad/s`).toBeLessThanOrEqual(most);
    }
  });

  it('settles the lens in the room when the player stops on the threshold', () => {
    // a hall behind its front door (the door's outside face at z = -1)
    registerCameraInterior(
      cameraInterior(
        'hall',
        [
          [0, 20, 0, 8, 0, 30],
          [8, 12, 0, 4, -1, 1.5],
        ],
        [{ box: 1, axis: 2, side: -1 }],
      ),
    );
    const cam = camera();
    // walked in from the road and stopped just over the sill
    for (let z = -5; z < 0.8; z += 7 / 60)
      frame(cam, new THREE.Vector3(10, 0, z), [10, 5, z - 9.8]);
    const self = new THREE.Vector3(10, 0, 0.8);
    frame(cam, self, [10, 5, -9]);
    let prev = cam.position.clone();
    for (let i = 0; i < 120; i++) {
      frame(cam, self, [10, 5, -9]);
      // a glide, never a snap (the lens sweeps round along the wall to a comfortable view)
      expect(cam.position.distanceTo(prev), `frame ${i}`).toBeLessThan(0.6);
      prev = cam.position.clone();
    }
    // stopped just over the sill, the lens that followed through the door has come in to the
    // room a moment later (the through-door hold eases out once the player stands still)
    expect(interiorLensInAir()).toBe(true);
    expect(interiorCameraInternalsForTest.state().through).toBe(0);
    expect(interiorCameraInternalsForTest.state().firstPerson).toBe(false);
  });

  it('forgets a framing when the player leaves at once (a teleport), never easing from it', () => {
    registerCameraInterior(cameraInterior('shaft', [[0, 3, 0, 30, 0, 3]]));
    const cam = camera();
    const inside = new THREE.Vector3(1.5, 0, 1.5);
    // cramped in the shaft: the camera lifts
    settle(cam, inside, [9.5, 3, 1.5], 120);
    expect(interiorCameraInternalsForTest.state().lift).toBeGreaterThan(0.2);
    // teleported far out, then back in by a walk from just outside
    frame(cam, new THREE.Vector3(60, 0, 60), [70, 3, 60]);
    frame(cam, new THREE.Vector3(1.5, 0, -2), [9.5, 3, -2]);
    frame(cam, new THREE.Vector3(1.5, 0, 0.5), [1.5, 3.5, -10]);
    expect(activeCameraInterior()?.id).toBe('shaft');
    // the first frame in starts from no framing (one frame's glide toward a new one at most)
    expect(Math.abs(interiorCameraInternalsForTest.state().lift)).toBeLessThan(0.11);
    expect(Math.abs(interiorCameraInternalsForTest.state().swing)).toBeLessThan(0.11);
  });

  it('follows through the door walking in: never a snap, never into the back of the head', () => {
    // a deep hall behind its front door (the door's outside face at z = -1)
    const hall = cameraInterior(
      'hall',
      [
        [0, 20, 0, 8, 0, 30],
        [8, 12, 0, 4, -1, 1.5],
      ],
      [{ box: 1, axis: 2, side: -1 }],
    );
    registerCameraInterior(hall);
    const cam = camera();
    const dt = 1 / 60;
    let prev: THREE.Vector3 | null = null;
    let least = Infinity;
    let wasIndoors = false;
    let lowestOutside = Infinity;
    // walk in at a brisk 7 yards a second, the camera 10 yards behind, out the door
    for (let z = -6; z < 16; z += 7 * dt) {
      const self = new THREE.Vector3(10, 0, z);
      const look = frame(cam, self, [10, 2 + 3, z - Math.sqrt(100 - 9)], dt);
      const boom = cam.position.distanceTo(look);
      const indoors = activeCameraInterior() !== null;
      if (indoors) {
        least = Math.min(least, boom);
        // no one-frame jump anywhere on the way in, not even stepping over the sill
        if (prev !== null) expect(cam.position.distanceTo(prev), `at ${z}`).toBeLessThan(0.6);
        if (!interiorLensInAir()) {
          // following through the door: its sight line threads the doorway (never a wall),
          // and the lens only ever comes down while it is still outside
          const c = cam.position;
          expect(
            interiorSegmentFraction(hall, look.x, look.y, look.z, c.x, c.y, c.z, 0, 1),
            `at ${z}`,
          ).toBe(1);
          expect(c.y, `at ${z}`).toBeLessThanOrEqual(lowestOutside + 1e-9);
          lowestOutside = c.y;
        }
      }
      if (indoors && !wasIndoors) {
        // the first frame indoors keeps the camera out behind, following through the door
        expect(boom).toBeGreaterThan(9);
        expect(interiorLensInAir()).toBe(false);
      }
      wasIndoors = indoors;
      prev = cam.position.clone();
    }
    // never into the back of the head: the whole distance all the way in
    expect(least).toBeGreaterThan(9);
    // and once the requested lens is in the hall, so is the drawn one
    expect(interiorLensInAir()).toBe(true);
  });

  it('eases back out when the view clears, never overshooting', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    const self = new THREE.Vector3(8, 0, 5);
    frame(cam, self, [20, 2, 5]);
    const pulled = cam.position.distanceTo(new THREE.Vector3(8, 2, 5));
    // swing the camera round to the open room behind: it glides out, not jumps
    frame(cam, self, [1, 2, 5]);
    const first = cam.position.distanceTo(new THREE.Vector3(8, 2, 5));
    expect(first).toBeGreaterThan(pulled);
    expect(first).toBeLessThan(7);
    for (let i = 0; i < 120; i++) frame(cam, self, [1, 2, 5]);
    expect(cam.position.x).toBeCloseTo(1, 3);
  });

  it('releases smoothly after walking out, then leaves the camera alone', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    // deep in the room (arrived there, not walked in), facing in, the camera wanted out
    // through the front door: held in
    settle(cam, new THREE.Vector3(5, 0, 9), [5, 2, -12]);
    expect(interiorCameraInternalsForTest.state().through).toBe(0);
    expect(cam.position.z).toBeGreaterThan(-1);
    // walk out through the door: the boom opens as the clamp blends out, then eases free
    for (let z = 9; z > -0.5; z -= 0.1) frame(cam, new THREE.Vector3(5, 0, z), [5, 2, z - 21]);
    const self = new THREE.Vector3(5, 0, -0.5);
    frame(cam, self, [5, 2, -14.5]);
    expect(activeCameraInterior()).toBe(null);
    expect(cam.position.z).toBeGreaterThan(-14.5);
    for (let i = 0; i < 90; i++) frame(cam, self, [5, 2, -14.5]);
    expect(cam.position.toArray()).toEqual([5, 2, -14.5]);
    // reduced motion releases at once
    frame(cam, new THREE.Vector3(5, 0, 2), [5, 2, -12], 1 / 60, true);
    frame(cam, self, [5, 2, -14.5], 1 / 60, true);
    expect(cam.position.toArray()).toEqual([5, 2, -14.5]);
  });

  it('brings the look point back to the eye when it lags across a wall', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    const self = new THREE.Vector3(9, 0, 5);
    const look = new THREE.Vector3(11, 2, 5); // the lagged pivot, outside the +x wall
    cam.position.set(4, 3, 5);
    clampChaseCameraToInterior(cam, look, self, 1 / 60, false);
    expect(look.toArray()).toEqual([9, 2, 5]);
    expect(interiorContains(ROOM, cam.position.x, cam.position.y, cam.position.z)).toBe(true);
  });

  it('re-checks a shaken camera before the draw and restores the shaken pose after it', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    settle(cam, new THREE.Vector3(8, 0, 5), [20, 2, 5]);
    const clamped = cam.position.clone();
    // a shake pushes the lens toward the wall
    cam.position.x += 0.6;
    const shaken = cam.position.clone();
    constrainInteriorCameraDraw(cam);
    expect(cam.position.x).toBeLessThanOrEqual(clamped.x + 1e-6);
    restoreInteriorCameraDraw(cam);
    expect(cam.position.toArray()).toEqual(shaken.toArray());
    // a shake into the room is drawn as it is
    cam.position.copy(clamped).x -= 0.6;
    const inward = cam.position.clone();
    constrainInteriorCameraDraw(cam);
    expect(cam.position.toArray()).toEqual(inward.toArray());
    restoreInteriorCameraDraw(cam);
    expect(cam.position.toArray()).toEqual(inward.toArray());
  });

  it('leaves a far camera (the editor) alone at draw time', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    frame(cam, new THREE.Vector3(8, 0, 5), [20, 2, 5]);
    cam.position.set(40, 30, 40);
    constrainInteriorCameraDraw(cam);
    expect(cam.position.toArray()).toEqual([40, 30, 40]);
  });

  it('forgets an interior when its building drops it', () => {
    const drop = registerCameraInterior(ROOM);
    const cam = camera();
    frame(cam, new THREE.Vector3(8, 0, 5), [20, 2, 5]);
    expect(activeCameraInterior()).not.toBe(null);
    drop();
    expect(activeCameraInterior()).toBe(null);
    expect(interiorCameraInternalsForTest.interiors()).toHaveLength(0);
  });
});

describe('the close-camera self hide', () => {
  it("hides the player's body when a closet leaves the camera in its head, and shows it after", () => {
    // a closet a body barely turns round in: no framing escapes it
    registerCameraInterior(
      cameraInterior('closet', [
        [0, 1.6, 0, 3.2, 0, 1.6],
        [1.6, 12, 0, 5, -5, 5],
      ]),
    );
    const cam = camera();
    const group = new THREE.Group();
    const look = frame(cam, new THREE.Vector3(0.8, 0, 0.8), [-6, 4, 0.8], 1 / 60, true);
    hideSelfInCloseCamera(group, cam);
    expect(group.visible).toBe(false);
    // the cut to the eyes: the lens at the eye, aimed out the way the requested camera looks
    expect(cam.position.distanceTo(new THREE.Vector3(0.8, 2, 0.8))).toBeLessThan(1e-9);
    expect(look.x).toBeGreaterThan(0.8 + 3.5);
    expect(look.distanceTo(cam.position)).toBeCloseTo(4, 6);
    expect(look.y).toBeLessThan(2);
    // the view's own pass shows it next frame; out in the room the camera draws back
    group.visible = true;
    frame(cam, new THREE.Vector3(8, 0, 0), [2, 3, 0], 1 / 60, true);
    hideSelfInCloseCamera(group, cam);
    expect(group.visible).toBe(true);
  });

  it('never hides anything outdoors', () => {
    const cam = camera();
    const group = new THREE.Group();
    frame(cam, new THREE.Vector3(0, 0, 0), [0.2, 2.1, 0.2]);
    hideSelfInCloseCamera(group, cam);
    expect(group.visible).toBe(true);
  });
});

describe('the overlays that consult the indoor gate', () => {
  it('gates the nameplates and the chat bubbles of bodies outside', () => {
    const painter = readFileSync(
      path.join(__dirname, '..', 'src/render/nameplate_painter.ts'),
      'utf8',
    );
    expect(painter).toContain(
      'if (interiorHidesNameplate(this.camera, p.x, p.y, p.z, this.tmpV.y)) continue;',
    );
    const bubbles = readFileSync(
      path.join(__dirname, '..', 'src/render/chat_bubble_layer.ts'),
      'utf8',
    );
    expect(bubbles).toContain('interiorHidesNameplate(camera, bx, e.pos.y, bz, by)');
    const renderer = readFileSync(path.join(__dirname, '..', 'src/render/renderer.ts'), 'utf8');
    expect(renderer).toContain(
      'interiorCam.hideSelfInCloseCamera(this.views.get(this.sim.playerId)?.group, this.camera);',
    );
  });
});

describe('indoor nameplates', () => {
  it('hides a body outside behind the walls, keeps one seen through the door or inside', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    settle(cam, new THREE.Vector3(5, 0, 5), [5, 2.5, 8]);
    // a troll outside behind the -x wall: hidden
    expect(interiorHidesNameplate(cam, -10, 0, 5, 2.8)).toBe(true);
    // one on the road straight out of the front door: seen through the doorway
    expect(interiorHidesNameplate(cam, 5, 0, -12, 1.5)).toBe(false);
    // the innkeeper inside: always kept
    expect(interiorHidesNameplate(cam, 2, 0, 2, 2.8)).toBe(false);
  });

  it('lets the eye decide while the lens still follows through the doorway', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    // walked in over the sill, the camera still out behind on the road
    frame(cam, new THREE.Vector3(5, 0, -4), [5, 4, -13]);
    frame(cam, new THREE.Vector3(5, 0, 0.5), [5, 4, -9]);
    expect(activeCameraInterior()?.id).toBe('room');
    expect(interiorLensInAir()).toBe(false);
    // a troll behind the room (the building between it and the lens) stays hidden; one on
    // the road out of the door keeps its plate
    expect(interiorHidesNameplate(cam, 5, 0, 22, 2.8)).toBe(true);
    expect(interiorHidesNameplate(cam, 5, 0, -12, 1.5)).toBe(false);
    // one beside the door outside, seen by the lens past the building, keeps its plate
    expect(interiorHidesNameplate(cam, 1, 0, -2, 1.5)).toBe(false);
  });

  it('outdoors, hides only a body inside that the walls hide from the camera', () => {
    registerCameraInterior(ROOM);
    const cam = camera();
    // high over the door: the sight line to the body inside clears the door's head, so the
    // wall over it hides the body; a body outside is never gated
    frame(cam, new THREE.Vector3(5, 0, -20), [5, 6, -30]);
    expect(interiorHidesNameplate(cam, 5, 0, 5, 2.8)).toBe(true);
    expect(interiorHidesNameplate(cam, -10, 0, 5, 2.8)).toBe(false);
    // low, looking in through the doorway: the body inside keeps its plate
    frame(cam, new THREE.Vector3(5, 0, -20), [5, 2, -30]);
    expect(interiorHidesNameplate(cam, 5, 0, 5, 2.8)).toBe(false);
  });
});

describe('a room turned to any angle', () => {
  // The room above and a deep hall, each stood in its own frame at Eastbrook's bank anchor and
  // turned the smithy's 20 degrees and the bank's 225: every pose below is written in the
  // unturned room's axes and turned into the world, and every answer is read back in them.
  const ORIGIN = { x: -61.99, z: -118.33 };
  const TURNS = [(20 * Math.PI) / 180, (225 * Math.PI) / 180];
  const HALL = cameraInterior(
    'hall',
    [
      [0, 20, 0, 8, 0, 30],
      [8, 12, 0, 4, -1, 1.5],
    ],
    [{ box: 1, axis: 2, side: -1 }],
    new Map(),
    'preserve-angle',
  );

  function turned(of: CameraInterior, yaw: number): CameraInterior {
    return cameraInterior(of.id, of.boxes, of.openings, new Map(), of.framing, {
      x: ORIGIN.x,
      z: ORIGIN.z,
      yaw,
    });
  }

  /** A point of the unturned room's axes in the world, turned `yaw`. */
  function world(yaw: number, x: number, y: number, z: number): THREE.Vector3 {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return new THREE.Vector3(ORIGIN.x + x * c + z * s, y, ORIGIN.z - x * s + z * c);
  }

  /** A world point back in the unturned room's axes. */
  function local(yaw: number, p: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const dx = p.x - ORIGIN.x;
    const dz = p.z - ORIGIN.z;
    return new THREE.Vector3(dx * c - dz * s, p.y, dx * s + dz * c);
  }

  type Pose = readonly [number, number, number];
  /** The feet and the desired camera, in the room's own axes, one frame each. */
  type Step = readonly [Pose, Pose];

  /** One scripted run of the real clamp over `vol` (turned `yaw`, or as it is for null): per
   *  frame, the drawn camera and look point in the room's own axes, and its verdicts. */
  function run(vol: CameraInterior, yaw: number | null, steps: readonly Step[]) {
    interiorCameraInternalsForTest.reset();
    registerCameraInterior(vol);
    const cam = camera();
    const into = (p: Pose) => (yaw === null ? new THREE.Vector3(...p) : world(yaw, ...p));
    const back = (p: THREE.Vector3) => (yaw === null ? p.clone() : local(yaw, p));
    return steps.map(([feet, want]) => {
      const c = into(want);
      const look = frame(cam, into(feet), [c.x, c.y, c.z]);
      return {
        pos: back(cam.position),
        look: back(look),
        indoors: activeCameraInterior() !== null,
        inAir: interiorLensInAir(),
        firstPerson: interiorCameraInternalsForTest.state().firstPerson,
        contained: interiorContains(vol, cam.position.x, cam.position.y, cam.position.z),
      };
    });
  }

  /** Walk in through the front door (x 4 to 6 at the -z wall) from the road with the camera
   *  behind, stand by the walls and under the ceiling with the camera wanted out through them,
   *  back into a cramped spot, orbit, then walk out through the door again. */
  function script(door: number, depth: number): Step[] {
    const steps: Step[] = [];
    for (let z = -6; z < depth; z += 7 / 60) {
      steps.push([
        [door, 0, z],
        [door, 5, z - Math.sqrt(91)],
      ]);
    }
    for (let i = 0; i < 30; i++)
      steps.push([
        [8, 0, 5],
        [20, 2, 5],
      ]);
    for (let i = 0; i < 30; i++)
      steps.push([
        [8, 0, 5],
        [8, 20, 5],
      ]);
    for (let i = 0; i < 60; i++)
      steps.push([
        [9, 0, 5],
        [20, 2, 5],
      ]);
    for (let i = 0; i < 120; i++) {
      const yaw = (3 * i) / 60;
      steps.push([
        [7, 0, 5],
        [7 - Math.sin(yaw) * 7.6, 2 + 2.5, 5 - Math.cos(yaw) * 7.6],
      ]);
    }
    // (never on the threshold's face at z 0, 0.03 off it at the nearest: a pose exactly on a
    // face is a tie the turn's rounding may tip either way)
    for (let z = 5.03; z > -4; z -= 0.1) {
      steps.push([
        [door, 0, z],
        [door, 2, z - 21],
      ]);
    }
    for (let i = 0; i < 90; i++)
      steps.push([
        [door, 0, -4],
        [door, 2, -25],
      ]);
    return steps;
  }

  it('draws the camera in a turned room exactly where it draws it in the unturned one', () => {
    for (const [of, door, depth] of [
      [ROOM, 5, 8],
      [HALL, 10, 16],
    ] as const) {
      const steps = script(door, depth);
      const flat = run(of, null, steps);
      // the script does what it says: in and out, pulled in, out through the door and back
      expect(flat.filter((f) => f.indoors).length, of.id).toBeGreaterThan(300);
      expect(flat.filter((f) => f.indoors && !f.inAir).length, of.id).toBeGreaterThan(0);
      expect(flat.at(-1)?.indoors, of.id).toBe(false);
      for (const yaw of TURNS) {
        const twin = run(turned(of, yaw), yaw, steps);
        for (const [i, f] of flat.entries()) {
          const t = twin[i];
          const at = `${of.id} turned ${yaw}, frame ${i}`;
          expect(t.pos.distanceTo(f.pos), at).toBeLessThan(1e-6);
          expect(t.look.distanceTo(f.look), at).toBeLessThan(1e-6);
          expect([t.indoors, t.inAir, t.firstPerson, t.contained], at).toEqual([
            f.indoors,
            f.inAir,
            f.firstPerson,
            f.contained,
          ]);
        }
      }
    }
  });

  it('keeps the lens inside the turned room, short of the wall it would pass', () => {
    for (const yaw of TURNS) {
      const room = turned(ROOM, yaw);
      registerCameraInterior(room);
      const cam = camera();
      const self = world(yaw, 5, 0, 5);
      const out = world(yaw, 20, 2, 5);
      // the desired camera out past the turned +x wall: pulled in along the ray, inside it
      settle(cam, self, [out.x, out.y, out.z], 30);
      expect(activeCameraInterior()?.id).toBe('room');
      expect(interiorLensInAir()).toBe(true);
      const c = local(yaw, cam.position);
      expect(c.x, `${yaw}`).toBeLessThan(10);
      expect(c.x, `${yaw}`).toBeGreaterThan(8);
      expect(c.z, `${yaw}`).toBeCloseTo(5, 6);
      expect(interiorContains(room, cam.position.x, cam.position.y, cam.position.z)).toBe(true);
      // the desired camera stood ten yards and more out past that wall: the clamp brought it
      // in nearly all the way
      expect(cam.position.distanceTo(out)).toBeGreaterThan(9);
      interiorCameraInternalsForTest.reset();
    }
  });

  it('follows through a turned front door walking in: no snap, never into the back of the head', () => {
    for (const yaw of TURNS) {
      interiorCameraInternalsForTest.reset();
      const hall = turned(HALL, yaw);
      registerCameraInterior(hall);
      const cam = camera();
      const dt = 1 / 60;
      let prev: THREE.Vector3 | null = null;
      let least = Infinity;
      let wasIndoors = false;
      let firstIn = Infinity;
      for (let z = -6; z < 16; z += 7 * dt) {
        const want = world(yaw, 10, 5, z - Math.sqrt(91));
        const look = frame(cam, world(yaw, 10, 0, z), [want.x, want.y, want.z], dt);
        const indoors = activeCameraInterior() !== null;
        if (indoors) {
          least = Math.min(least, cam.position.distanceTo(look));
          if (prev !== null)
            expect(cam.position.distanceTo(prev), `${yaw} at ${z}`).toBeLessThan(0.6);
          if (!wasIndoors) firstIn = z;
          // following through the turned door its sight line threads the doorway
          if (!interiorLensInAir()) {
            const c = cam.position;
            expect(
              interiorSegmentFraction(hall, look.x, look.y, look.z, c.x, c.y, c.z, 0, 1),
              `${yaw} at ${z}`,
            ).toBe(1);
          }
        }
        wasIndoors = indoors;
        prev = cam.position.clone();
      }
      // indoors only past the threshold (the door's thickness runs to z 0), and the whole
      // distance kept all the way in, the lens in the hall at the end
      expect(firstIn, `${yaw}`).toBeGreaterThan(0);
      expect(firstIn, `${yaw}`).toBeLessThan(0.3);
      expect(least, `${yaw}`).toBeGreaterThan(9);
      expect(interiorLensInAir(), `${yaw}`).toBe(true);
    }
  });

  it('gates the nameplates through a turned door, never through its walls', () => {
    for (const yaw of TURNS) {
      interiorCameraInternalsForTest.reset();
      registerCameraInterior(turned(ROOM, yaw));
      const cam = camera();
      const want = world(yaw, 5, 2.5, 8);
      settle(cam, world(yaw, 5, 0, 5), [want.x, want.y, want.z]);
      const plate = (x: number, z: number, y: number) => {
        const p = world(yaw, x, 0, z);
        return interiorHidesNameplate(cam, p.x, 0, p.z, y);
      };
      // a troll behind the turned -x wall: hidden; one on the road out of the turned front
      // door: seen through it; the innkeeper inside: kept
      expect(plate(-10, 5, 2.8), `${yaw}`).toBe(true);
      expect(plate(5, -12, 1.5), `${yaw}`).toBe(false);
      expect(plate(2, 2, 2.8), `${yaw}`).toBe(false);
    }
  });

  it('leaves the camera to the bit for a player outside a turned hall', () => {
    for (const yaw of TURNS) {
      interiorCameraInternalsForTest.reset();
      registerCameraInterior(turned(HALL, yaw));
      const cam = camera();
      // on the road, on the porch, in the doorway's thickness, and behind the hall's side
      // wall with the boom straight through it
      const outside: readonly Step[] = [
        [
          [10, 0, -12],
          [10, 9, 6],
        ],
        [
          [10, 0, -2.5],
          [10, 5, 8],
        ],
        [
          [10, 0, -0.5],
          [10, 6, 12],
        ],
        [
          [-6, 0, 15],
          [12, 8, 15],
        ],
      ];
      for (const [feet, want] of outside) {
        const c = world(yaw, ...want);
        cam.position.copy(c);
        const self = world(yaw, ...feet);
        const look = new THREE.Vector3(self.x, self.y + 2, self.z);
        clampChaseCameraToInterior(cam, look, self, 1 / 60, true);
        expect(cam.position.toArray(), `${yaw}: ${feet}`).toEqual(c.toArray());
        expect(look.toArray()).toEqual([self.x, self.y + 2, self.z]);
        expect(activeCameraInterior()).toBe(null);
      }
      // ...while a player a stride inside it, the same boom out through the side wall, is
      // held in the turned hall (the hall is live in its frame, not merely missed)
      const want = world(yaw, -8, 6, 15);
      cam.position.copy(want);
      const self = world(yaw, 2, 0, 15);
      clampChaseCameraToInterior(
        cam,
        new THREE.Vector3(self.x, self.y + 2, self.z),
        self,
        1 / 60,
        true,
      );
      expect(activeCameraInterior()?.id, `${yaw}`).toBe('hall');
      expect(local(yaw, cam.position).x, `${yaw}`).toBeGreaterThan(0);
    }
  });
});
