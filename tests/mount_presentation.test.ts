import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterVisual } from '../src/render/characters';
import type { AnimState } from '../src/render/characters/anim_state';
import {
  type MountPresentationHost,
  type MountPresentationInputs,
  updateMountPresentation,
} from '../src/render/mount_presentation';
import type { MountVisualSpec } from '../src/render/mount_visuals';
import type { Vfx } from '../src/render/vfx';

// Regression coverage for the mountCompilePending safeguard ported into the
// extracted mount_presentation.ts helper (renderer.ts's old inline pass used
// to gate the attitude/seat/ambient-fx block on it directly; the extraction
// dropped the gate). A rider must never be carried onto a still-compiling
// mount's attitude or seat bone, or he floats/glitches against a mount
// nobody can see yet (the mount root itself stays hidden by mountCompilePending
// at the renderer's visibility write site, src/render/renderer.ts).

function seatBoneSpec(): MountVisualSpec {
  return {
    jumpTips: false,
    visualKey: 'mount_test_seat_bone',
    seat: 1.2,
    seatFwd: 0,
    groundLift: 0,
    rigged: true,
    bobAmp: 0,
    bobHz: 0,
    bobIdle: false,
    bobShape: 'hop',
    fx: 'slime',
    lamps: [],
    seatBone: { bone: 'chair', offset: [0, 0, 0] },
    glows: [],
    ride: null,
  };
}

function rig(): {
  v: MountPresentationHost;
  rider: THREE.Object3D;
  mountUpdate: ReturnType<typeof vi.fn>;
} {
  const group = new THREE.Group();
  const rider = new THREE.Object3D();
  const mountRoot = new THREE.Object3D();
  // A seat that has moved off the model origin, the way a real seat-bone
  // mount's chair does: if seatRiderOnBone runs, the rider ends up here.
  const chair = new THREE.Object3D();
  chair.name = 'chair';
  chair.position.set(0.3, 1.2, -0.4);
  mountRoot.add(chair);
  group.add(rider);
  group.add(mountRoot);
  const mountUpdate = vi.fn();
  const mountVisual = {
    root: mountRoot,
    update: mountUpdate,
    advanceOffscreen: vi.fn(),
  } as unknown as CharacterVisual;
  const v: MountPresentationHost = {
    group,
    visual: { root: rider },
    mountVisual,
    mountLift: 1.2,
    rocketSledJumpPitch: 0,
    mountJumpPitch: 0,
    mountWheels: undefined,
    mountPullerVisual: null,
    mountLamps: null,
    mountGlows: null,
    mountSeatBone: null,
    mountCompilePending: false,
    mountPivot: false,
    mountSuspension: undefined,
    mountExhaust: null,
  };
  return { v, rider, mountUpdate };
}

const anim: AnimState = {
  speed: 0,
  moving: true,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

function inputs(
  vfx: Vfx,
  overrides: Partial<MountPresentationInputs> = {},
): MountPresentationInputs {
  return {
    spec: seatBoneSpec(),
    shown: true,
    mountKey: 'test_seat_bone',
    anim,
    airborne: false,
    moving: true,
    facing: 0,
    dyRaw: 0,
    rawSpeed: 0,
    time: 0,
    present: true,
    animate: true,
    vfx,
    enginePhase: null,
    groundSample: () => 0,
    dt: 1 / 20,
    ...overrides,
  };
}

function fakeVfx(): Vfx {
  return {
    mountSlimeTrail: vi.fn(),
    mountExhaust: vi.fn(),
  } as unknown as Vfx;
}

describe('updateMountPresentation: mountCompilePending safeguard', () => {
  it('carries the rider onto the seat bone and fires ambient fx once the mount is presented', () => {
    const { v, rider } = rig();
    const vfx = fakeVfx();
    updateMountPresentation(v, inputs(vfx));
    expect(rider.position.x).toBeCloseTo(0.3);
    expect(rider.position.y).toBeCloseTo(1.2);
    expect(rider.position.z).toBeCloseTo(-0.4);
    expect(vfx.mountSlimeTrail).toHaveBeenCalledOnce();
  });

  it('holds the rider off the compiling mount instead of carrying it onto an invisible seat bone', () => {
    const { v, rider, mountUpdate } = rig();
    v.mountCompilePending = true;
    const vfx = fakeVfx();
    updateMountPresentation(v, inputs(vfx));
    expect(rider.position.x).toBe(0);
    expect(rider.position.y).toBe(0);
    expect(rider.position.z).toBe(0);
    expect(vfx.mountSlimeTrail).not.toHaveBeenCalled();
    // Gait/wheel/lamp bookkeeping still runs while hidden, so the rig is
    // fully caught up the instant the compile clears and reveals it.
    expect(mountUpdate).toHaveBeenCalledOnce();
  });

  it('resumes carrying the rider on the seat bone the frame the compile clears', () => {
    const { v, rider } = rig();
    v.mountCompilePending = true;
    updateMountPresentation(v, inputs(fakeVfx()));
    expect(rider.position.y).toBe(0);
    v.mountCompilePending = false;
    updateMountPresentation(v, inputs(fakeVfx()));
    expect(rider.position.y).toBeCloseTo(1.2);
  });
});
