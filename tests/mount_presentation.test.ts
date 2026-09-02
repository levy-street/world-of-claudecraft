// The mount step's WIRING, not its math.
//
// The pure numbers already have decisive coverage in tests/mount_visuals.test.ts.
// What was untested is the part that makes the feature's headline claims true:
// that the roll is driven by DISPLACEMENT rather than velocity, that the facing
// projection turns world-space motion into the mount's own frame, that the stone
// is lifted off the ground by exactly its radius, and that the spin lands on the
// axis a forward roll actually turns about. Every one of those is a single line
// in updateMountPresentation, and a regression in any of them (`stepX: vx / dt`
// is the obvious one) passes the whole rest of the suite.
//
// The three.js objects are faked: the function only ever writes `.rotation.x`
// and `.position.y` on a root and calls `update`/particle sinks, so a plain
// object records exactly what a real Object3D would have received, with no GPU
// and no renderer.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import {
  fillMountAnimState,
  type MountFrameInputs,
  type MountPresentationFx,
  type MountPresentationView,
  updateMountPresentation,
} from '../src/render/mount_presentation';
import { MOUNT_VISUAL_SPECS } from '../src/render/mount_visuals';

const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

const BOULDER = MOUNT_VISUAL_SPECS.riftbound_boulder;
const HORSE = MOUNT_VISUAL_SPECS.valorsteed;
const HOVER = MOUNT_VISUAL_SPECS.aether_hover_cycle;

function fakeVisual() {
  return {
    root: { rotation: { x: 0 }, position: { y: 0 } },
    update: vi.fn(),
  };
}

function fakeState(over: Partial<AnimState> = {}): AnimState {
  return {
    speed: 0,
    moving: false,
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
    ...over,
  } as AnimState;
}

let mount: ReturnType<typeof fakeVisual>;
let riderVisual: ReturnType<typeof fakeVisual>;
let view: MountPresentationView;
let fx: MountPresentationFx & {
  mountSlimeTrail: ReturnType<typeof vi.fn>;
  mountExhaust: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mount = fakeVisual();
  riderVisual = fakeVisual();
  view = {
    group: { position: { x: 1, y: 2, z: 3 } },
    mountLift: BOULDER.seat,
    mountRoll: 0,
    mountJumpPitch: 0,
  } as unknown as MountPresentationView;
  fx = { mountSlimeTrail: vi.fn(), mountExhaust: vi.fn() } as unknown as typeof fx;
});

function run(over: Partial<MountFrameInputs> = {}, rider: AnimState = fakeState()) {
  const input: MountFrameInputs = {
    mount: mount as never,
    riderVisual: riderVisual as never,
    spec: BOULDER,
    dt: 1 / 60,
    timeSec: 0,
    animate: true,
    moving: true,
    airborne: false,
    facing: 0,
    stepX: 0,
    stepZ: 0,
    verticalVelocity: 0,
    ...over,
  };
  const scratch = fakeState();
  fillMountAnimState(scratch, rider, input.spec, input.airborne);
  updateMountPresentation(view, scratch, fx, input);
  return input;
}

/** Fill then step, the way the renderer does either side of its gate. */
function fillMountAnimStateAndStep(
  v: MountPresentationView,
  rider: AnimState,
  scratch: AnimState,
  sinks: MountPresentationFx,
  input: MountFrameInputs,
): void {
  fillMountAnimState(scratch, rider, input.spec, input.airborne);
  updateMountPresentation(v, scratch, sinks, input);
}

describe('rolling mount wiring', () => {
  it('rolls from this frame DISPLACEMENT, not from a velocity', () => {
    // Half a yard of travel on a 0.8-yard stone is 0.625 rad, whatever dt was.
    // This is the pin that kills `stepX: vx / dt` at the call site: dividing by
    // a 1/60 frame would roll 60x as far and every other test would still pass.
    run({ stepZ: 0.5, dt: 1 / 60 });
    expect(mount.root.rotation.x).toBeCloseTo(0.625, 10);

    view.mountRoll = 0;
    mount.root.rotation.x = 0;
    run({ stepZ: 0.5, dt: 1 / 10 });
    expect(mount.root.rotation.x, 'the same travel rolls the same amount at any dt').toBeCloseTo(
      0.625,
      10,
    );
  });

  it('projects world displacement into the mount own frame through facing', () => {
    // Facing 0 points at +Z, so +Z travel is pure forward.
    run({ stepZ: 0.5, facing: 0 });
    const straight = mount.root.rotation.x;

    // Facing PI/2 points at +X, so the SAME travel expressed as +X must roll
    // identically. Without the projection this reads as a strafe.
    view.mountRoll = 0;
    mount.root.rotation.x = 0;
    run({ stepX: 0.5, facing: Math.PI / 2 });
    expect(mount.root.rotation.x).toBeCloseTo(straight, 10);
  });

  it('spins about X, positively, so the crown travels the way the rider faces', () => {
    run({ stepZ: 0.4 });
    expect(mount.root.rotation.x).toBeGreaterThan(0);
    // Backing up unrolls it, wrapped into one turn.
    view.mountRoll = 0;
    run({ stepZ: -0.4 });
    expect(mount.root.rotation.x).toBeCloseTo(Math.PI * 2 - 0.5, 10);
  });

  it('accumulates across frames instead of restating one frame', () => {
    run({ stepZ: 0.2 });
    const first = view.mountRoll;
    run({ stepZ: 0.2 });
    expect(view.mountRoll).toBeCloseTo(first * 2, 10);
    expect(mount.root.rotation.x).toBe(view.mountRoll);
  });

  it('rests the stone exactly one radius off the ground, and the rider on its crown', () => {
    run();
    expect(mount.root.position.y).toBeCloseTo(BOULDER.rollRadius, 10);
    expect(riderVisual.root.position.y).toBeCloseTo(BOULDER.seat, 10);
    // Two radii: the rider stands ON the stone, not inside it.
    expect(riderVisual.root.position.y).toBeCloseTo(mount.root.position.y * 2, 10);
  });
});

describe('non-rolling mounts are untouched by the roll path', () => {
  it('never rotates or lifts a saddle mount, however far it travels', () => {
    view.mountLift = HORSE.seat;
    run({ spec: HORSE, stepX: 9, stepZ: 9 });
    expect(mount.root.rotation.x).toBe(0);
    expect(mount.root.position.y).toBe(0);
    expect(view.mountRoll).toBe(0);
    expect(riderVisual.root.position.y).toBeCloseTo(HORSE.seat, 10);
  });

  it('clears a leftover roll when the same view swaps to a saddle mount', () => {
    // The view outlives the mount: mountVisual is rebuilt on a mount swap
    // (mountVisualKey mismatch) but the view, and its mountRoll, survive. The
    // roll is composed onto every mount's pitch axis, so a stale value becomes
    // a permanent pitch on a mount whose jumpTips is false and which therefore
    // has no path that relaxes it. Start from a rolled stone, not from zero,
    // which is exactly what the neighbouring saddle test cannot see.
    run({ stepZ: 1 });
    expect(view.mountRoll, 'the boulder rolled first').toBeCloseTo(1 / BOULDER.rollRadius, 10);

    view.mountLift = HORSE.seat;
    run({ spec: HORSE, stepX: 3, stepZ: 3 });
    expect(view.mountRoll).toBe(0);
    expect(mount.root.rotation.x, 'no inherited pitch on the saddle mount').toBe(0);
    expect(mount.root.position.y).toBe(0);
  });

  it('still bobs the hover cycle, and floats its rider with it', () => {
    view.mountLift = HOVER.seat;
    // Quarter of a 1.1 Hz cycle: the sine peaks at the full amplitude.
    run({ spec: HOVER, timeSec: 0.25 / HOVER.bobHz, moving: false });
    expect(mount.root.position.y).toBeCloseTo(HOVER.bobAmp, 5);
    expect(riderVisual.root.position.y).toBeCloseTo(HOVER.seat + HOVER.bobAmp, 5);
  });
});

describe('mount animation inputs and particles', () => {
  it('drives the mount clips from the RIDER locomotion, but the real airborne flag', () => {
    const rider = fakeState({ speed: 7, moving: true, running: true, swimming: true });
    const scratch = fakeState();
    fillMountAnimStateAndStep(view, rider, scratch, fx, {
      mount: mount as never,
      riderVisual: riderVisual as never,
      spec: BOULDER,
      dt: 1 / 60,
      timeSec: 0,
      animate: true,
      moving: true,
      // The rider's own airborne is suppressed while mounted; the MOUNT carries
      // the jump, so the step must take the real flag rather than the rider's.
      airborne: true,
      facing: 0,
      stepX: 0,
      stepZ: 0,
      verticalVelocity: 0,
    });
    expect(scratch.speed).toBe(7);
    expect(scratch.running).toBe(true);
    expect(scratch.swimming).toBe(true);
    expect(scratch.airborne).toBe(true);
    expect(rider.airborne, 'the rider state is read, never written').toBe(false);
    expect(mount.update).toHaveBeenCalledWith(1 / 60, scratch, true);
  });

  it('does not carry a treading rider backpedal into the mount own clips', () => {
    // The renderer forces st.backwards true for a treading rider. A rolling
    // mount is clipless today so nothing reads it, but a future rigged roller
    // would play its backpedal cycle while rolling FORWARD.
    const rider = fakeState({ moving: true, backwards: true });
    const scratch = fakeState();
    fillMountAnimStateAndStep(view, rider, scratch, fx, {
      mount: mount as never,
      riderVisual: riderVisual as never,
      spec: BOULDER,
      dt: 1 / 60,
      timeSec: 0,
      animate: true,
      moving: true,
      airborne: false,
      facing: 0,
      stepX: 0,
      stepZ: 0,
      verticalVelocity: 0,
    });
    expect(scratch.backwards).toBe(false);

    // A rider genuinely backpedalling a SADDLE mount still passes it through.
    view.mountLift = HORSE.seat;
    const saddleScratch = fakeState();
    fillMountAnimStateAndStep(view, rider, saddleScratch, fx, {
      mount: mount as never,
      riderVisual: riderVisual as never,
      spec: HORSE,
      dt: 1 / 60,
      timeSec: 0,
      animate: true,
      moving: true,
      airborne: false,
      facing: 0,
      stepX: 0,
      stepZ: 0,
      verticalVelocity: 0,
    });
    expect(saddleScratch.backwards).toBe(true);
  });

  it('emits each mount own particles and nobody else', () => {
    run({ spec: MOUNT_VISUAL_SPECS.stalkglider_snail, moving: true });
    expect(fx.mountSlimeTrail).toHaveBeenCalledTimes(1);
    expect(fx.mountExhaust).not.toHaveBeenCalled();

    run({ spec: MOUNT_VISUAL_SPECS.stalkglider_snail, moving: false });
    expect(fx.mountSlimeTrail, 'a standing snail paints nothing').toHaveBeenCalledTimes(1);

    run({ spec: HOVER, moving: false });
    expect(fx.mountExhaust).toHaveBeenCalledTimes(1);

    run({ spec: BOULDER, moving: true });
    expect(fx.mountSlimeTrail).toHaveBeenCalledTimes(1);
    expect(fx.mountExhaust).toHaveBeenCalledTimes(1);
  });
});

describe('the renderer half of the tread (source pin)', () => {
  it('is the only consumer of the treading flag, and it is still wired', () => {
    // Deleting this one line leaves the rider standing frozen on a rolling
    // stone with the entire suite green, because every other assertion about
    // treading is about the pure function that computes the flag.
    expect(renderer).toContain('if (pose.treading) st.backwards = true;');
    expect(renderer).toContain(
      'const pose = riderPoseFlags(e.mountKey, riderMounted, resting, moving);',
    );
    expect(renderer).toContain('st.sitting = pose.sitting;');
  });

  it('routes the mounted emote gate through the mount pose, not the seated flag', () => {
    // Standing the rider up opens this gate as a side effect; the mounted arm
    // is what makes that a decision instead of an accident, and reverting it to
    // a bare !st.sitting would silently hand every future standing mount the
    // same capability.
    expect(renderer).toContain('(riderMounted ? pose.mayEmote : !st.sitting);');
  });

  it('leaves the boulder rider inside the water-contact gate, on purpose', () => {
    // The wake and splash spawn at the entity position, which is the stone
    // contact patch, so this reads as the boulder displacing water. Pinned
    // because it is a behaviour no other mount has and nothing else asserts it.
    const start = renderer.indexOf('const touchesWater =');
    expect(start).toBeGreaterThan(-1);
    const gate = renderer.slice(start, renderer.indexOf(';', start));
    expect(gate).toContain('!st.sitting');
    expect(gate, 'a riderMounted term here would suppress it again').not.toContain('riderMounted');
  });
});
