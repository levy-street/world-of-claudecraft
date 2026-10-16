import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeCameraInterior,
  clampChaseCameraToInterior,
  interiorCameraInternalsForTest,
  interiorLensInAir,
  registerCameraInterior,
} from '../src/render/interior_camera';
import {
  interiorContains,
  interiorHoldsEye,
  interiorSegmentFraction,
} from '../src/render/interior_camera_core';
import {
  newTavernShellState,
  TAVERN_SHELL_PARTS,
  type TavernShellPart,
  tavernShellOcclusion,
} from '../src/render/mirefen_tavern_core';
import {
  eyeInTavernAir,
  mirefenTavernCameraInterior,
  TAVERN_FRONT_DOOR_BOX,
  TAVERN_HALL_AIR_TOP,
  TAVERN_INTERIOR_LOCAL,
  TAVERN_TOWER_AIR_TOP,
  TAVERN_TOWER_SHAFT,
  tavernBoxToWorld,
} from '../src/render/mirefen_tavern_interior_core';
import {
  TAVERN_BAR_PLATFORM,
  TAVERN_CHANDELIER,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_HOOD,
  TAVERN_LANTERNS,
  TAVERN_PROPS,
  TAVERN_STAGE,
  TAVERN_TOWER,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';
import {
  tavernHallWalls,
  tavernTowerWallSegments,
  tavernWingWalls,
} from '../src/sim/mirefen_tavern';

// The Mirefen tavern's interior for the indoor camera (src/render/mirefen_tavern_interior_core.ts)
// and the clamp over it (src/render/interior_camera.ts): the air never reaches into a wall, the
// barrel racks, the wall fireplace or the tower's ring, and nothing hangs down into it (the
// hood, the chandelier, the lanterns and the hammer beams all stand over it: no timber crosses
// the room where the camera flies); at the tight spots (the arch, the nook, the stage, behind
// the bar, the hearth pit, the hall's corners, a booth), for every orbit a player can take, the
// clamped camera stays in the air with its whole sight line to the player in it; and walking in
// and out through the front door, at every camera a player uses, the lens follows through the
// doorway without a snap, a dive into the head or a rise over its outdoor height, and the
// building never opens as a cutaway round the player.

const T = TAVERN_TOWER;
const vol = mirefenTavernCameraInterior();

afterEach(() => interiorCameraInternalsForTest.reset());

/** A local point to the world. */
function world(lx: number, ly: number, lz: number): THREE.Vector3 {
  const w = tavernToWorld(lx, lz);
  return new THREE.Vector3(w.x, TAVERN_FLOOR_Y + ly, w.z);
}

describe('tavern interior boxes', () => {
  it('turns local boxes into the world the way the model is turned', () => {
    const b = tavernBoxToWorld([1, 2, 0, 3, 4, 6]);
    const lo = tavernToWorld(2, 4);
    const hi = tavernToWorld(1, 6);
    expect(b).toEqual([lo.x, hi.x, TAVERN_FLOOR_Y, TAVERN_FLOOR_Y + 3, lo.z, hi.z]);
  });

  it('never reaches into a wall, the barrel racks, the fireplace or the tower ring', {
    timeout: 60000,
  }, () => {
    const walls = [...tavernHallWalls(), ...tavernWingWalls()];
    const fire = TAVERN_PROPS.find((p) => p.kind === 'fireplace');
    if (!fire) throw new Error('fireplace');
    const racks = TAVERN_PROPS.filter((p) => p.kind === 'barrels');
    expect(racks.length).toBeGreaterThan(0);
    const ring = tavernTowerWallSegments();
    const inRing = (x: number, z: number): boolean =>
      ring.some((s) => {
        const dx = x - s.x;
        const dz = z - s.z;
        const c = Math.cos(s.rot);
        const sn = Math.sin(s.rot);
        // the segment's local z runs out along the radius (atan2(dx, dz) = rot)
        const along = dx * c - dz * sn;
        const out = dx * sn + dz * c;
        return Math.abs(along) < s.hw - 0.12 && Math.abs(out) < s.hd - 0.02;
      });
    const E = 0.02;
    for (let i = 0; i < TAVERN_INTERIOR_LOCAL.length; i++) {
      const [x0, x1, y0, , z0, z1] = TAVERN_INTERIOR_LOCAL[i];
      for (let x = x0 + E; x <= x1 - E; x += 0.4) {
        for (let z = z0 + E; z <= z1 - E; z += 0.4) {
          const shaft = TAVERN_TOWER_SHAFT;
          if (i === shaft.box && Math.hypot(x - shaft.x, z - shaft.z) > shaft.r) continue;
          for (const [wx0, wx1, wz0, wz1] of walls) {
            const hit = x > wx0 + E && x < wx1 - E && z > wz0 + E && z < wz1 - E;
            // the front door's box runs out through the wall's opening only
            expect(hit, `box ${i} in a wall at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
          }
          for (const r of racks) {
            const top = TAVERN_BAR_PLATFORM.lift + r.height;
            const hit =
              x > r.x - (r.hw ?? 0) + E &&
              x < r.x + (r.hw ?? 0) - E &&
              z > r.z - (r.hd ?? 0) + E &&
              z < r.z + (r.hd ?? 0) - E &&
              y0 < top;
            expect(hit, `box ${i} in a barrel rack at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(
              false,
            );
          }
          const breast =
            x > fire.x - (fire.hw ?? 0) + E &&
            z > fire.z - (fire.hd ?? 0) + E &&
            z < fire.z + (fire.hd ?? 0) - E &&
            y0 < TAVERN_HALL.eave;
          expect(breast, `box ${i} in the fireplace`).toBe(false);
          expect(
            inRing(x, z),
            `box ${i} in the tower ring at ${x.toFixed(2)}, ${z.toFixed(2)}`,
          ).toBe(false);
        }
      }
    }
  });

  it('keeps every hung thing and every roof timber over the air: nothing crosses the room', () => {
    // the hammer beams (the lowest roof timber) a yard and more over the air's top
    expect(TAVERN_HALL.truss - TAVERN_HALL_AIR_TOP).toBeGreaterThanOrEqual(1);
    // the copper hood over the hearth, the wheel chandelier's hub under its ring, and each
    // lantern's foot under its body, all over the air
    expect(TAVERN_HOOD.rimY - 0.1).toBeGreaterThan(TAVERN_HALL_AIR_TOP);
    expect(TAVERN_CHANDELIER.y - 0.35).toBeGreaterThan(TAVERN_HALL_AIR_TOP);
    for (const l of TAVERN_LANTERNS) {
      expect(l.y - 0.42 * 0.76 - 0.05, `lantern at ${l.x}, ${l.z}`).toBeGreaterThan(
        TAVERN_HALL_AIR_TOP,
      );
    }
    // the hall's boxes all stop at the air's top, the nook's under its crown of candles
    for (let i = 0; i < TAVERN_INTERIOR_LOCAL.length; i++) {
      const top = TAVERN_INTERIOR_LOCAL[i][3];
      if (i === TAVERN_TOWER_SHAFT.box) expect(top).toBe(TAVERN_TOWER_AIR_TOP);
      else expect(top, `box ${i}`).toBeLessThanOrEqual(TAVERN_HALL_AIR_TOP);
    }
    expect(TAVERN_TOWER_AIR_TOP).toBeLessThan(T.wallTop);
  });

  it('holds the eye in the hall and the nook, never on the porch or in the doorway alone', () => {
    const at = (lx: number, lz: number, feet = 0) => {
      const w = tavernToWorld(lx, lz);
      return interiorHoldsEye(vol, w.x, TAVERN_FLOOR_Y + feet + 2, w.z);
    };
    expect(at(0, 0)).toBe(true);
    expect(at(0, 4.5, -0.45)).toBe(true); // the hearth pit
    expect(at(-3, -14)).toBe(true); // the arch
    expect(at(T.x, T.z)).toBe(true); // the nook's rose
    expect(at(T.x + 3.5, T.z - 2)).toBe(true); // in the nook by its bench
    expect(at(-12, -11, TAVERN_STAGE.lift)).toBe(true); // on the stage
    expect(at(0, 13.6)).toBe(false); // in the doorway's thickness
    expect(at(0, 15.5)).toBe(false); // the porch
    expect(at(-20, 0)).toBe(false); // outside
    expect(at(10, -20)).toBe(false); // the closed kitchen behind the hatch
    expect(at(9.5, -12.6, TAVERN_BAR_PLATFORM.lift)).toBe(true); // at the hatch, between the racks
    expect(eyeInTavernAir(0, 2, 13.6)).toBe(false);
    expect(eyeInTavernAir(0, 2, 12.8)).toBe(true);
    expect(TAVERN_INTERIOR_LOCAL[TAVERN_FRONT_DOOR_BOX][5]).toBe(TAVERN_HALL.z1);
    // the doorway's threshold is the front wall's thickness
    expect(vol.thresholds).toHaveLength(1);
    expect(vol.thresholds[0]).toBeCloseTo(TAVERN_HALL.wall, 9);
  });
});

/** The tight spots: local feet (x, feetY, z). */
const SPOTS: readonly [string, number, number, number][] = [
  ['the arch into the nook', -3, 0, -14],
  ['the arch approach', -1.5, 0, -8],
  ["the nook's rose", T.x, 0, T.z],
  ["the nook's bench, its back to the wall", T.x + 3.6, 0, T.z - 3.4],
  ['on the stage', -13.5, TAVERN_STAGE.lift, -12.2],
  ['in the wall booth', -11.4, 0, -4.6],
  ['behind the bar', 9, 0.5, -8.8],
  ['at the kitchen hatch', 9.5, 0.5, -12.6],
  ['in the hearth pit', 0, -0.45, 4.5],
  ["the hall's back corner", -14.4, 0, -7.6],
  ["the hall's front corner", 14.4, 0, 12.4],
];

describe('the indoor camera at the tight spots', () => {
  for (const [name, lx, feet, lz] of SPOTS) {
    it(`keeps every orbit inside, its sight line clear: ${name}`, () => {
      registerCameraInterior(vol);
      const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
      const self = world(lx, feet, lz);
      let best = 0;
      for (let k = 0; k < 24; k++) {
        const yaw = (k / 24) * Math.PI * 2;
        for (const pitch of [-0.15, 0.3, 0.7, 1.2]) {
          for (const dist of [5, 12, 22]) {
            const look = new THREE.Vector3(self.x, self.y + 2, self.z);
            cam.position.set(
              look.x - Math.sin(yaw) * Math.cos(pitch) * dist,
              Math.max(look.y + Math.sin(pitch) * dist, self.y + 0.6),
              look.z - Math.cos(yaw) * Math.cos(pitch) * dist,
            );
            const eye = look.clone();
            clampChaseCameraToInterior(cam, look, self, 1 / 60, true);
            const c = cam.position;
            expect(interiorContains(vol, c.x, c.y, c.z), `${yaw} ${pitch} ${dist}`).toBe(true);
            // the whole sight line from the player's eye to the lens stays in the air (a cut
            // to the eyes in a corner no framing escapes stands at the eye itself)
            expect(
              interiorSegmentFraction(vol, eye.x, eye.y, eye.z, c.x, c.y, c.z, 0),
              `sight line ${yaw} ${pitch} ${dist}`,
            ).toBe(1);
            best = Math.max(best, c.distanceTo(eye));
          }
        }
      }
      // however tight the spot, some orbit keeps a real third-person view
      expect(best).toBeGreaterThan(3.5);
    });
  }

  it('looks into the nook from the arch without changing the requested pitch', () => {
    registerCameraInterior(vol);
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
    const self = world(-3, 0, -14);
    const look = new THREE.Vector3(self.x, self.y + 2, self.z);
    const target = world(-1.5, 0, -20);
    const yaw = Math.atan2(target.x - self.x, target.z - self.z);
    const dist = 14;
    const pitch = 0.55;
    cam.position.set(
      look.x - Math.sin(yaw) * Math.cos(pitch) * dist,
      look.y + Math.sin(pitch) * dist,
      look.z - Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    clampChaseCameraToInterior(cam, look, self, 1 / 60, true);
    const c = cam.position;
    expect(interiorContains(vol, c.x, c.y, c.z)).toBe(true);
    expect(c.y - TAVERN_FLOOR_Y).toBeLessThan(TAVERN_HALL_AIR_TOP);
    // The ceiling shortens the boom, not the player's viewing angle.
    expect(c.distanceTo(look)).toBeLessThan(dist);
    expect(c.distanceTo(look)).toBeGreaterThan(12);
    expect(Math.asin((c.y - look.y) / c.distanceTo(look))).toBeCloseTo(pitch, 6);
  });

  it("keeps the nook's crown and cone over a camera looking down into it", () => {
    registerCameraInterior(vol);
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
    const self = world(T.x, 0, T.z);
    const look = new THREE.Vector3(self.x, self.y + 2, self.z);
    cam.position.set(look.x, look.y + 16, look.z);
    clampChaseCameraToInterior(cam, look, self, 1 / 60, true);
    expect(cam.position.y - TAVERN_FLOOR_Y).toBeLessThan(TAVERN_TOWER_AIR_TOP);
  });
});

/** The default chase camera (pitch 0.32, 12 yards) behind a player at local (lx, ly, lz),
 *  turned `yaw` round the tavern's local frame (0: the camera out along local +z, toward the
 *  front door), gliding for `frames` frames; returns the settled boom. */
function settledBoom(
  lx: number,
  ly: number,
  lz: number,
  yaw: number,
  frames = 90,
  pitch = 0.32,
  dist = 12,
): number {
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
  const self = world(lx, ly, lz);
  // local (sin yaw, cos yaw) to the world: local z runs along world +x, local x along -z
  const wx = Math.cos(yaw) * Math.cos(pitch) * dist;
  const wz = -Math.sin(yaw) * Math.cos(pitch) * dist;
  let look = new THREE.Vector3();
  for (let i = 0; i < frames; i++) {
    look = new THREE.Vector3(self.x, self.y + 2, self.z);
    cam.position.set(look.x + wx, look.y + Math.sin(pitch) * dist, look.z + wz);
    clampChaseCameraToInterior(cam, look, self, 1 / 60, i === 0);
  }
  expect(interiorContains(vol, cam.position.x, cam.position.y, cam.position.z)).toBe(true);
  return cam.position.distanceTo(look);
}

describe('the indoor camera in the open common room', () => {
  it('keeps the full chase distance in the middle of the room, every way round', () => {
    registerCameraInterior(vol);
    for (let k = 0; k < 8; k++) {
      const yaw = (k / 8) * Math.PI * 2;
      expect(settledBoom(-4, 0, 0, yaw), `yaw ${k}`).toBeGreaterThan(11);
      expect(settledBoom(0, 0, -2, yaw), `yaw ${k}`).toBeGreaterThan(11);
    }
  });

  it('keeps a real third-person distance at the bar and the hearth pit', () => {
    registerCameraInterior(vol);
    for (let k = 0; k < 8; k++) {
      const yaw = (k / 8) * Math.PI * 2;
      expect(settledBoom(7, 0.5, -3.5, yaw), `bar ${k}`).toBeGreaterThan(6);
      expect(settledBoom(0, -0.45, 4.5, yaw), `hearth ${k}`).toBeGreaterThan(9);
    }
  });

  it('shortens a steep camera consistently under the hall ceiling', () => {
    registerCameraInterior(vol);
    // the owner's own camera, pitched well up and zoomed out, in the middle of the hall
    for (let k = 0; k < 8; k++) {
      const yaw = (k / 8) * Math.PI * 2;
      const boom = settledBoom(0, 0, -1, yaw, 90, 0.75, 14);
      expect(boom, `yaw ${k}`).toBeGreaterThan(9);
      expect(boom, `yaw ${k}`).toBeLessThan(10);
    }
  });
});

/** The parts whose cut would open the building round the player as a cutaway. */
const CUTAWAY: readonly TavernShellPart[] = [
  'HallWallFront',
  'HallWallFrontLeft',
  'HallWallFrontRight',
  'HallRoof',
  'HallWallLeft',
  'HallWallRight',
];

/** Walk the player at a brisk 7 yards a second along local x = `lx` from lz0 to lz1 (the eye
 *  only: no collision), the camera `dist` yards behind at `pitch`, frame by frame; returns
 *  what every frame drew. */
function walkThroughDoor(lz0: number, lz1: number, pitch: number, dist: number, lx = 0) {
  registerCameraInterior(vol);
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
  const shell = newTavernShellState();
  const dt = 1 / 60;
  const step = Math.sign(lz1 - lz0) * 7 * dt;
  const frames: {
    lz: number;
    boom: number;
    height: number;
    lens: THREE.Vector3;
    indoors: boolean;
    lensIn: boolean;
    cut: TavernShellPart[];
  }[] = [];
  for (let lz = lz0; (lz1 - lz) * Math.sign(step) > 0; lz += step) {
    const self = world(lx, 0, lz);
    const look = new THREE.Vector3(self.x, self.y + 2, self.z);
    // the camera behind the player, the way it walks: out of the door walking in (local +z,
    // world +x), into the room walking out
    const back = Math.sign(step) < 0 ? 1 : -1;
    cam.position.set(
      look.x + back * Math.cos(pitch) * dist,
      look.y + Math.sin(pitch) * dist,
      look.z,
    );
    const eye = look.clone();
    clampChaseCameraToInterior(cam, look, self, dt, false);
    const c = cam.position.clone();
    const indoors = activeCameraInterior() !== null;
    const lensIn = interiorLensInAir();
    tavernShellOcclusion(eye.x, eye.y, eye.z, c.x, c.y, c.z, shell, indoors ? lensIn : undefined);
    frames.push({
      lz,
      boom: c.distanceTo(eye),
      height: c.y - eye.y,
      lens: c,
      indoors,
      lensIn,
      cut: TAVERN_SHELL_PARTS.filter((_, i) => shell.occluded[i]),
    });
  }
  return frames;
}

describe('walking in and out through the front door', () => {
  // the default camera, the owner's (pitched up, zoomed out), a low close one
  const CAMERAS: readonly [string, number, number][] = [
    ['the default camera', 0.32, 12],
    ['a steep, far camera', 0.75, 18],
    ['a low, close camera', 0.12, 6],
  ];
  for (const [name, pitch, dist] of CAMERAS) {
    it(`follows through the door walking in, no snap, dive or cutaway: ${name}`, () => {
      const frames = walkThroughDoor(26, -12, pitch, dist);
      const outdoorHeight = Math.sin(pitch) * dist;
      let prev: (typeof frames)[number] | null = null;
      let lowestOutside = Infinity;
      let indoorsFrames = 0;
      for (const f of frames) {
        // never a pop: the lens moves a fraction of a yard a frame, the player 0.12
        if (prev) expect(f.lens.distanceTo(prev.lens), `at ${f.lz.toFixed(2)}`).toBeLessThan(0.45);
        // never over its outdoor height (no dollhouse view from above the roof)
        expect(f.height, `at ${f.lz.toFixed(2)}`).toBeLessThanOrEqual(outdoorHeight + 1e-6);
        // never a dive into the head: the camera keeps a real distance the whole way
        expect(f.boom, `at ${f.lz.toFixed(2)}`).toBeGreaterThan(Math.min(dist, 9) * 0.6);
        // the building never opens round the player as a cutaway
        for (const part of CUTAWAY) {
          expect(f.cut.includes(part), `${part} at ${f.lz.toFixed(2)}`).toBe(false);
        }
        if (f.indoors) {
          indoorsFrames++;
          // while the lens follows through the door from outside it only comes down (and its
          // sight line threads the doorway: no wall between it and the player)
          if (!f.lensIn) {
            expect(f.height, `at ${f.lz.toFixed(2)}`).toBeLessThanOrEqual(lowestOutside + 1e-6);
            lowestOutside = f.height;
          }
        }
        prev = f;
      }
      expect(indoorsFrames).toBeGreaterThan(60);
      // deep in the hall the lens stands in its air
      const last = frames[frames.length - 1];
      expect(last.lensIn).toBe(true);
    });

    it(`hands the camera back walking out, no snap or cutaway: ${name}`, () => {
      const frames = walkThroughDoor(6, 30, pitch, dist);
      let prev: (typeof frames)[number] | null = null;
      for (const f of frames) {
        if (prev) expect(f.lens.distanceTo(prev.lens), `at ${f.lz.toFixed(2)}`).toBeLessThan(0.45);
        if (f.indoors) {
          for (const part of CUTAWAY) {
            expect(f.cut.includes(part), `${part} at ${f.lz.toFixed(2)}`).toBe(false);
          }
        }
        prev = f;
      }
      // out on the road the camera is the requested one again, to the bit
      const last = frames[frames.length - 1];
      expect(last.indoors).toBe(false);
      expect(last.boom).toBeCloseTo(dist, 6);
    });
  }

  it('keeps the rest of the hall uncapped: the door head holds only a camera walking in', () => {
    // a player who walked in, then off to the side of the door deep in the room: the steep, far
    // camera behind toward the front wall is flattened only by the room, never held down to
    // the door's head
    walkThroughDoor(24, 8, 0.75, 18);
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
    const self = world(-9, 0, -2);
    let look = new THREE.Vector3();
    for (let i = 0; i < 90; i++) {
      look = new THREE.Vector3(self.x, self.y + 2, self.z);
      cam.position.set(look.x + Math.cos(0.75) * 18, look.y + Math.sin(0.75) * 18, look.z);
      clampChaseCameraToInterior(cam, look, self, 1 / 60, false);
    }
    expect(interiorCameraInternalsForTest.state().cap).toBeLessThan(1e-3);
    // the same spot in the middle of the front of the hall, just past the door's reach
    const mid = world(0, 0, -6);
    for (let i = 0; i < 90; i++) {
      look = new THREE.Vector3(mid.x, mid.y + 2, mid.z);
      cam.position.set(look.x + Math.cos(0.75) * 18, look.y + Math.sin(0.75) * 18, look.z);
      clampChaseCameraToInterior(cam, look, mid, 1 / 60, false);
    }
    expect(interiorCameraInternalsForTest.state().cap).toBeLessThan(1e-3);
  });

  it('brings the lens in to the room when the player stops just inside the door', () => {
    const frames = walkThroughDoor(20, 11.5, 0.32, 12);
    expect(frames[frames.length - 1].indoors).toBe(true);
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
    const self = world(0, 0, 11.5);
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i < 150; i++) {
      const look = new THREE.Vector3(self.x, self.y + 2, self.z);
      cam.position.set(look.x + Math.cos(0.32) * 12, look.y + Math.sin(0.32) * 12, look.z);
      clampChaseCameraToInterior(cam, look, self, 1 / 60, false);
      if (prev) expect(cam.position.distanceTo(prev), `frame ${i}`).toBeLessThan(0.45);
      prev = cam.position.clone();
    }
    expect(interiorLensInAir()).toBe(true);
    const c = cam.position;
    const eye = new THREE.Vector3(self.x, self.y + 2, self.z);
    expect(interiorSegmentFraction(vol, eye.x, eye.y, eye.z, c.x, c.y, c.z, 0)).toBe(1);
  });
});
