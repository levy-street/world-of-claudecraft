// The Three-side suspension pass. Three's Object3D needs no DOM, so the real
// scene-graph behavior tests in plain Node.
//
// The point of these cases is the part that is easy to get silently wrong: the
// module derives which way the vehicle faces and which side is its right from
// the rig itself, so a re-exported model on a different axis convention keeps
// working. A sign error there does not throw, it just leans the car the wrong
// way, which only a human looking at it would catch.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyVehicleSuspension,
  createVehicleSuspensionRig,
} from '../src/render/vehicle_suspension_fx';

/** A vehicle whose front is toward `frontZ` and whose right is toward `rightX`. */
function buildVehicle(frontZ = 1, rightX = 1) {
  const group = new THREE.Object3D();
  const mountRoot = new THREE.Object3D();
  const riderRoot = new THREE.Object3D();
  group.add(mountRoot);
  const corners: Record<string, THREE.Object3D> = {};
  for (const [name, x, z] of [
    ['Susp_FL', -rightX * 0.5, frontZ],
    ['Susp_FR', rightX * 0.5, frontZ],
    ['Susp_RL', -rightX * 0.5, -frontZ],
    ['Susp_RR', rightX * 0.5, -frontZ],
  ] as const) {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(x, 0, z);
    mountRoot.add(node);
    corners[name] = node;
  }
  return { group, mountRoot, riderRoot, corners };
}

const flat = () => 0;

const WHEEL_R = 0.1;
const HUB = 0.1;
const ARCH_Y = 0.25;
const SILL_Y = 0.05;
const PLATE_HALF = 0.03;

/**
 * A vehicle with real bodywork, so the envelope is MEASURED rather than
 * falling back. An arch plate sits over each wheel and a low sill runs down
 * the middle, which is what the underbody droop limit reads.
 */
function buildBodiedVehicle(archY: Record<string, number> = {}) {
  const group = new THREE.Object3D();
  const mountRoot = new THREE.Object3D();
  const riderRoot = new THREE.Object3D();
  const chassis = new THREE.Object3D();
  group.add(mountRoot);
  mountRoot.add(chassis);

  const addBox = (parent: THREE.Object3D, w: number, h: number, d: number, pos: number[]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    m.position.set(pos[0], pos[1], pos[2]);
    parent.add(m);
    return m;
  };
  // Low central sill: the lowest bodywork, and deliberately clear of every
  // wheel column so it cannot be mistaken for an arch.
  addBox(chassis, 0.2, 0.02, 0.4, [0, SILL_Y + 0.01, 0]);

  const corners: Record<string, THREE.Object3D> = {};
  for (const [name, x, z] of [
    ['FL', -0.5, 1],
    ['FR', 0.5, 1],
    ['RL', -0.5, -1],
    ['RR', 0.5, -1],
  ] as const) {
    const susp = new THREE.Object3D();
    susp.name = `Susp_${name}`;
    susp.position.set(x, HUB, z);
    chassis.add(susp);
    corners[name] = susp;
    // The wheel: as tall as it is deep, so the measured radius is WHEEL_R.
    addBox(susp, 0.08, WHEEL_R * 2, WHEEL_R * 2, [0, 0, 0]);
    // The arch above it, narrower than the tire so its verts land in the column.
    const y = archY[name] ?? ARCH_Y;
    addBox(chassis, 0.06, 0.02, PLATE_HALF * 2, [x, y + 0.01, z]);
  }
  return { group, mountRoot, riderRoot, chassis, corners };
}

/** The gap the measurement should find: arch underside down to the tire's
 *  CURVED crown at the nearest arch vertex, not to its bounding box. */
const expectedGap = (arch = ARCH_Y) =>
  arch - (HUB + Math.sqrt(WHEEL_R * WHEEL_R - PLATE_HALF * PLATE_HALF));

/** Run the pass to a settled state. */
function settle(
  rig: ReturnType<typeof createVehicleSuspensionRig>,
  v: ReturnType<typeof buildVehicle>,
  sample: (x: number, z: number) => number,
  grounded = true,
  frames = 240,
  spinning = true,
  facing = 0,
  dyRaw = 0,
) {
  for (let i = 0; i < frames; i++) {
    applyVehicleSuspension(
      rig!,
      v.group,
      v.mountRoot,
      v.riderRoot,
      1,
      0,
      grounded,
      spinning,
      facing,
      dyRaw,
      sample,
      1 / 60,
    );
  }
}

describe('vehicle suspension scene pass', () => {
  it('returns null for a mount with no suspension nodes', () => {
    const group = new THREE.Object3D();
    const mountRoot = new THREE.Object3D();
    group.add(mountRoot);
    expect(createVehicleSuspensionRig(mountRoot, group)).toBeNull();
  });

  it('measures wheelbase and track off the rig, in model units', () => {
    const v = buildVehicle(1, 1);
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    expect(rig.wheelbase).toBeCloseTo(2, 6);
    expect(rig.track).toBeCloseTo(1, 6);
  });

  it('records the model-to-world scale instead of baking it into the geometry', () => {
    // Model units must stay model units: the scale is carried separately so
    // sampled world heights can be divided by it on the way in. Folding it into
    // wheelbase/track is what makes travel come out 6x too large in game.
    const v = buildVehicle(1, 1);
    v.mountRoot.scale.setScalar(3);
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    expect(rig.wheelbase).toBeCloseTo(2, 6);
    expect(rig.track).toBeCloseTo(1, 6);
    expect(rig.unitScale).toBeCloseTo(3, 6);
  });

  it('derives the facing and handedness signs from the node layout', () => {
    const normal = buildVehicle(1, 1);
    const normalRig = createVehicleSuspensionRig(normal.mountRoot, normal.group)!;
    expect(normalRig.frontSign).toBe(1);
    expect(normalRig.rightSign).toBe(1);

    const flipped = buildVehicle(-1, -1);
    const flippedRig = createVehicleSuspensionRig(flipped.mountRoot, flipped.group)!;
    expect(flippedRig.frontSign).toBe(-1);
    expect(flippedRig.rightSign).toBe(-1);
  });

  it('lifts the nose when the ground rises ahead, whichever way the model faces', () => {
    for (const frontZ of [1, -1]) {
      const v = buildVehicle(frontZ, 1);
      const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
      // Ground climbs toward the vehicle's own front.
      settle(rig, v, (_x, z) => z * 0.1 * frontZ);

      // A probe bolted to the nose must end up ABOVE the body origin.
      const probe = new THREE.Object3D();
      probe.position.set(0, 0, frontZ);
      v.mountRoot.add(probe);
      v.group.updateWorldMatrix(true, true);
      expect(probe.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(0.05);
    }
  });

  it('lifts the right side when the ground rises to the right, either handedness', () => {
    for (const rightX of [1, -1]) {
      const v = buildVehicle(1, rightX);
      const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
      settle(rig, v, (x) => x * 0.1 * rightX);

      const probe = new THREE.Object3D();
      probe.position.set(rightX, 0, 0);
      v.mountRoot.add(probe);
      v.group.updateWorldMatrix(true, true);
      expect(probe.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(0.05);
    }
  });

  it('measures a model once and shares it with every later instance', () => {
    // The measuring sweep walks every vertex and builds a whole-body triangle
    // list per steered corner, which on a real vehicle is tens of thousands of
    // each. Paying that per instance hitched the frame on EVERY summon. Clones
    // share geometry, so the result is a property of the MODEL.
    const v = buildBodiedVehicle();
    v.group.updateWorldMatrix(true, true);
    const first = createVehicleSuspensionRig(v.mountRoot, v.group)!;

    // A second rider on the same vehicle: Object3D.clone() shares geometry,
    // exactly as the character asset clones do.
    const clonedRoot = v.mountRoot.clone();
    const secondGroup = new THREE.Object3D();
    secondGroup.add(clonedRoot);
    secondGroup.updateWorldMatrix(true, true);
    const second = createVehicleSuspensionRig(clonedRoot, secondGroup)!;

    // Same object, not merely equal: that is what proves it was not re-measured.
    expect(second.envelope).toBe(first.envelope);
    expect(second.steerLock).toBe(first.steerLock);

    // ...and the per-frame mutable state must NOT be shared, or two riders on
    // the same vehicle would drive each other's suspension.
    expect(second.state).not.toBe(first.state);
    expect(second.steerState).not.toBe(first.steerState);
    expect(second.nodes.fl).not.toBe(first.nodes.fl);
  });

  it('measures a different model separately', () => {
    // Fresh geometry (a re-export, or a different vehicle) must not collide
    // with a cached entry: the arch sits lower here, so the envelope differs.
    const tall = buildBodiedVehicle();
    tall.group.updateWorldMatrix(true, true);
    const tallRig = createVehicleSuspensionRig(tall.mountRoot, tall.group)!;

    const low = buildBodiedVehicle({ FL: ARCH_Y - 0.05 });
    low.group.updateWorldMatrix(true, true);
    const lowRig = createVehicleSuspensionRig(low.mountRoot, low.group)!;

    expect(lowRig.envelope).not.toBe(tallRig.envelope);
    expect(lowRig.envelope.corner.fl.bump).toBeLessThan(tallRig.envelope.corner.fl.bump);
  });

  it('measures bump against the tire crown, not its bounding box', () => {
    const v = buildBodiedVehicle();
    v.group.updateWorldMatrix(true, true);
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    // 0.85 of the real clearance: a spring that used all of it would put
    // rubber exactly on sheet metal at full travel.
    expect(rig.envelope.corner.fl.bump).toBeCloseTo(expectedGap() * 0.85, 5);
    // The naive answer (arch minus the top of the wheel's bounding box) is
    // SMALLER, because the box ignores the tire falling away either side.
    expect(rig.envelope.corner.fl.bump).toBeGreaterThan((ARCH_Y - (HUB + WHEEL_R)) * 0.85);
  });

  it('measures droop as the hub falling to underbody level', () => {
    const v = buildBodiedVehicle();
    v.group.updateWorldMatrix(true, true);
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    expect(rig.envelope.corner.rl.droop).toBeCloseTo((HUB - SILL_Y) * 0.85, 5);
  });

  it('gives each corner its own limit, so one tight arch binds only its wheel', () => {
    const v = buildBodiedVehicle({ FL: 0.22 });
    v.group.updateWorldMatrix(true, true);
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    expect(rig.envelope.corner.fl.bump).toBeCloseTo(expectedGap(0.22) * 0.85, 5);
    expect(rig.envelope.corner.fr.bump).toBeCloseTo(expectedGap() * 0.85, 5);
    expect(rig.envelope.corner.fl.bump).toBeLessThan(rig.envelope.corner.fr.bump);
  });

  it('gives a wheel already touching its arch no bump travel at all', () => {
    // Tripo models tend to jam the tires into the arches; an arch BELOW the
    // tire crown must read as zero room, never as negative room.
    const v = buildBodiedVehicle({ FL: 0.18 });
    v.group.updateWorldMatrix(true, true);
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    expect(expectedGap(0.18)).toBeLessThan(0);
    expect(rig.envelope.corner.fl.bump).toBe(0);
  });

  it('keeps travel inside the measured clearance whatever the mount scale', () => {
    // The regression that put the wheels through the fenders: travel is
    // computed in WORLD units but written onto a node living in MODEL space,
    // so a 6x mount normalization multiplied every spring by six.
    const v = buildBodiedVehicle();
    v.mountRoot.scale.setScalar(6);
    v.group.updateWorldMatrix(true, true);
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    expect(rig.unitScale).toBeCloseTo(6, 5);

    const rest = HUB;
    for (const grounded of [true, false]) {
      settle(rig, v, (x, z) => (x + z) * 4, grounded);
      for (const [key, c] of [
        ['FL', 'fl'],
        ['FR', 'fr'],
        ['RL', 'rl'],
        ['RR', 'rr'],
      ] as const) {
        const moved = v.corners[key].position.y - rest;
        expect(moved).toBeLessThanOrEqual(rig.envelope.corner[c].bump + 1e-9);
        expect(moved).toBeGreaterThanOrEqual(-rig.envelope.corner[c].droop - 1e-9);
      }
    }
  });

  it('holds a parked wheel where it stopped instead of letting it snap home', () => {
    // Three's AnimationMixer restores a property to its ORIGINAL value once the
    // last action animating it hits zero weight, so the wheels jump back to
    // their authored home angle the instant the locomotion clip lets go. The
    // Idle clip has no wheel channels at all, so nothing else puts them back.
    const v = buildVehicle();
    const wheel = new THREE.Object3D();
    wheel.name = 'Wheel_FL';
    v.corners.Susp_FL.add(wheel);
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;

    // Rolling: the clip owns the angle and we just watch it.
    const spun = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 2.1);
    wheel.quaternion.copy(spun);
    settle(rig, v, flat, true, 1, true);
    expect(wheel.quaternion.angleTo(spun)).toBeCloseTo(0, 6);

    // Stopped, and the mixer has restored the wheel to home behind our back.
    wheel.quaternion.identity();
    settle(rig, v, flat, true, 1, false);
    expect(wheel.quaternion.angleTo(spun)).toBeCloseTo(0, 6);
  });

  it('leaves a vehicle with no wheel nodes alone', () => {
    const v = buildVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    expect(rig.wheels.fl).toBeNull();
    expect(() => settle(rig, v, flat, true, 2, false)).not.toThrow();
  });

  it('adds travel to the mixer value instead of replacing it', () => {
    const v = buildVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    // One wheel over a bump: the ground is high under the front left only.
    const bumpy = (x: number, z: number) => (x < 0 && z > 0 ? 0.1 : 0);
    settle(rig, v, bumpy);
    const travel = rig.state.travel.fl;
    expect(Math.abs(travel)).toBeGreaterThan(1e-3);

    // A clip writes its own road texture onto the node each frame; the net
    // result must be the clip value PLUS our travel, not one clobbering the
    // other.
    const CLIP = 0.02;
    v.corners.Susp_FL.position.y = CLIP;
    applyVehicleSuspension(
      rig,
      v.group,
      v.mountRoot,
      v.riderRoot,
      1,
      0,
      true,
      true,
      0,
      0,
      bumpy,
      1 / 60,
    );
    expect(v.corners.Susp_FL.position.y).toBeCloseTo(CLIP + rig.state.travel.fl, 6);
  });

  it('does not accumulate on frames where the mixer did not run', () => {
    const v = buildVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    const bumpy = (x: number, z: number) => (x < 0 && z > 0 ? 0.1 : 0);
    settle(rig, v, bumpy);
    const settled = v.corners.Susp_FL.position.y;
    // Ten more frames with nobody else writing the node: it must hold, not drift.
    settle(rig, v, bumpy, true, 10);
    expect(v.corners.Susp_FL.position.y).toBeCloseTo(settled, 6);
  });

  it('carries the rider rigidly with the body', () => {
    const v = buildVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    const SEAT = 1.4;
    for (let i = 0; i < 240; i++) {
      applyVehicleSuspension(
        rig,
        v.group,
        v.mountRoot,
        v.riderRoot,
        SEAT,
        0,
        true,
        true,
        0,
        0,
        (x: number) => x * 0.1,
        1 / 60,
      );
    }
    // Same attitude as the body, and the seat point swung around the origin,
    // so the rider stays the same distance from the vehicle pivot.
    expect(v.riderRoot.rotation.x).toBeCloseTo(v.mountRoot.rotation.x, 6);
    expect(v.riderRoot.rotation.z).toBeCloseTo(v.mountRoot.rotation.z, 6);
    expect(v.riderRoot.position.length()).toBeCloseTo(SEAT, 6);
    // Rolled toward the low side, the seat must leave the centreline.
    expect(Math.abs(v.riderRoot.position.x)).toBeGreaterThan(1e-3);
  });

  it('eases upright and hangs the wheels when airborne', () => {
    const v = buildVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    settle(rig, v, (x) => x * 0.1);
    expect(Math.abs(rig.state.roll)).toBeGreaterThan(1e-3);

    settle(rig, v, flat, false);
    expect(rig.state.roll).toBeCloseTo(0, 4);
    expect(rig.state.pitch).toBeCloseTo(0, 4);
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect(rig.state.travel[c]).toBeCloseTo(-rig.envelope.corner[c].droop, 4);
    }
  });
});

/**
 * A vehicle with steering nodes between the travel node and the wheel, and a
 * radial wall of bodywork to each side of each front wheel so the lock has
 * something to measure against. The walls sit at deliberately different angles,
 * because a real car's two directions are not symmetric and the module must
 * carry the difference through rather than averaging it away.
 */
const WALL_POS = 0.5;
const WALL_NEG = 0.35;

function buildSteeredVehicle() {
  const group = new THREE.Object3D();
  const mountRoot = new THREE.Object3D();
  const riderRoot = new THREE.Object3D();
  const chassis = new THREE.Object3D();
  group.add(mountRoot);
  mountRoot.add(chassis);
  chassis.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.4)));

  const steer: Record<string, THREE.Object3D> = {};
  for (const [name, x, z] of [
    ['FL', -0.5, 1],
    ['FR', 0.5, 1],
    ['RL', -0.5, -1],
    ['RR', 0.5, -1],
  ] as const) {
    const susp = new THREE.Object3D();
    susp.name = `Susp_${name}`;
    susp.position.set(x, HUB, z);
    chassis.add(susp);

    let wheelParent: THREE.Object3D = susp;
    if (name === 'FL' || name === 'FR') {
      const node = new THREE.Object3D();
      node.name = `Steer_${name}`;
      susp.add(node);
      steer[name] = node;
      // Radial walls: thin across, long from the steering axis outward, so they
      // actually span the radii the tire occupies. A post out past the tread
      // measures nothing, since no ring of the wheel ever reaches it.
      for (const angle of [WALL_POS, -WALL_NEG]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.5, 0.4));
        wall.rotation.y = angle;
        wall.position.set(x + Math.sin(angle) * 0.2, HUB, z + Math.cos(angle) * 0.2);
        chassis.add(wall);
      }
      wheelParent = node;
    }
    // A narrow wheel on purpose. Bodywork buried inside the tire is skipped as
    // hidden, and a fat tire's own solid swallows anything close to straight
    // ahead, which would hide the test's own walls rather than the mesh flaw
    // the rule exists for.
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.02, WHEEL_R * 2, WHEEL_R * 2));
    wheel.name = `Wheel_${name}`;
    wheelParent.add(wheel);
  }
  return { group, mountRoot, riderRoot, chassis, steer };
}

/** Hold a turn at `yawRate` rad/s for `frames`, advancing facing as the sim
 *  would. */
function driveTurn(
  rig: NonNullable<ReturnType<typeof createVehicleSuspensionRig>>,
  v: ReturnType<typeof buildSteeredVehicle>,
  yawRate: number,
  frames = 240,
  facing = 0,
) {
  const dt = 1 / 60;
  for (let i = 0; i < frames; i++) {
    facing += yawRate * dt;
    applyVehicleSuspension(
      rig,
      v.group,
      v.mountRoot,
      v.riderRoot,
      1,
      0,
      true,
      true,
      facing,
      0,
      flat,
      dt,
    );
  }
  return facing;
}

describe('front wheel steering', () => {
  it('measures a lock off the bodywork rather than assuming one', () => {
    const v = buildSteeredVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    // Something was found on both sides, and it is tighter than the walls
    // themselves, since the tire's own leading edge reaches them first.
    expect(rig.steerLock.pos).toBeGreaterThan(0.05);
    expect(rig.steerLock.pos).toBeLessThan(WALL_POS);
    expect(rig.steerLock.neg).toBeGreaterThan(0.05);
    expect(rig.steerLock.neg).toBeLessThan(WALL_NEG);
    // The two walls are at different angles, so the two locks must differ.
    expect(rig.steerLock.pos).toBeGreaterThan(rig.steerLock.neg);
  });

  it('turns the front wheels with the yaw rate, and only the front wheels', () => {
    const v = buildSteeredVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    driveTurn(rig, v, Math.PI);
    expect(v.steer.FL.rotation.y).toBeCloseTo(rig.steerLock.pos, 6);
    expect(v.steer.FR.rotation.y).toBeCloseTo(rig.steerLock.pos, 6);
    // Nothing else in the rig is a steering node, and nothing else moved.
    expect(v.mountRoot.rotation.y).toBe(0);
  });

  it('turns the other way for the other turn key', () => {
    const v = buildSteeredVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    driveTurn(rig, v, -Math.PI);
    expect(v.steer.FL.rotation.y).toBeCloseTo(-rig.steerLock.neg, 6);
  });

  it('never turns past the measured lock, whatever the yaw rate', () => {
    const v = buildSteeredVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    // Far faster than any turn key: a mouse-look flick, or a network correction.
    driveTurn(rig, v, Math.PI * 12);
    expect(v.steer.FL.rotation.y).toBeLessThanOrEqual(rig.steerLock.pos + 1e-9);
  });

  it('does not read a freshly summoned mount as one frame of turn', () => {
    const v = buildSteeredVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    // First frame ever, at a facing far from zero: there is no previous frame to
    // difference against, and treating the whole heading as this frame's turn
    // would snap the wheels to full lock on summon.
    driveTurn(rig, v, 0, 1, 2.7);
    expect(v.steer.FL.rotation.y).toBe(0);
  });

  it('returns to center when the turn stops', () => {
    const v = buildSteeredVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    const facing = driveTurn(rig, v, Math.PI);
    expect(v.steer.FL.rotation.y).toBeGreaterThan(0.05);
    driveTurn(rig, v, 0, 240, facing);
    expect(v.steer.FL.rotation.y).toBeCloseTo(0, 6);
  });

  it('leaves a rig with no steering nodes alone', () => {
    const v = buildVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    expect(rig.steer.fl).toBe(null);
    // Still runs, and still costs nothing: every other mount in the game takes
    // this path.
    settle(rig, v, flat, true, 10, true, 1.2);
    expect(Number.isFinite(rig.state.pitch)).toBe(true);
  });
});

describe('landing squat', () => {
  /** Fly for a moment at a given descent speed, then touch down. */
  const land = (descent: number, framesAfter = 90) => {
    const v = buildVehicle();
    const rig = createVehicleSuspensionRig(v.mountRoot, v.group)!;
    settle(rig, v, flat);
    // Airborne and falling: dyRaw is the per-frame vertical delta.
    settle(rig, v, flat, false, 30, true, 0, -descent / 60);
    const curve: number[] = [];
    for (let i = 0; i < framesAfter; i++) {
      settle(rig, v, flat, true, 1, true, 0, 0);
      curve.push(rig.state.travel.fl);
    }
    return { rig, curve, peak: Math.max(...curve) };
  };

  it('compresses on touchdown and then evens out', () => {
    const { curve, peak, rig } = land(14);
    // Past neutral, not merely recovering from the droop it hung at in the
    // air. Measured against this rig's own bump travel, since a rig with no
    // bodywork to measure gets the fallback envelope and its numbers are tiny.
    expect(peak).toBeGreaterThan(rig.envelope.corner.fl.bump * 0.15);
    expect(curve.indexOf(peak)).toBeLessThan(20);
    expect(curve[curve.length - 1]).toBeCloseTo(0, 3);
  });

  it('reads the DESCENT, so a hard drop squats more than a gentle one', () => {
    expect(land(14).peak).toBeGreaterThan(land(7).peak * 1.5);
  });

  it('ignores a touchdown below the soft-landing speed', () => {
    // The same threshold the renderer uses to choose a footfall over a landing
    // thud: stepping off a kerb should not rock the car.
    expect(land(3).peak).toBeCloseTo(0, 4);
  });

  it('never squats a corner past its measured bump limit', () => {
    const { curve, rig } = land(40);
    for (const value of curve) {
      expect(value).toBeLessThanOrEqual(rig.envelope.corner.fl.bump + 1e-9);
    }
  });
});

describe('wheel spin', () => {
  /** Signed rotation about the x axis between two orientations. */
  const aboutX = (from: THREE.Quaternion, to: THREE.Quaternion) => {
    const rel = from.clone().invert().multiply(to);
    return 2 * Math.atan2(rel.x, rel.w);
  };

  /** A rig whose wheels are round-ish and clearly thin along x, so the axle is
   *  found the same way the real model's is. */
  const build = () => {
    const v = buildVehicle();
    const wheels: Record<string, THREE.Mesh> = {};
    for (const [name, node] of Object.entries(v.corners)) {
      // Rotate the GEOMETRY, not the node. The axle is read off the wheel's
      // own local mesh, which is also the frame the spin is applied in, so the
      // two agree; a node rotation would leave the mesh axis-aligned and the
      // measurement would find no axle at all. The real model bakes it too.
      const geom = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16).rotateZ(Math.PI / 2);
      const wheel = new THREE.Mesh(geom);
      wheel.name = name.replace('Susp_', 'Wheel_');
      node.add(wheel);
      wheels[wheel.name] = wheel;
    }
    return { v, wheels, rig: createVehicleSuspensionRig(v.mountRoot, v.group)! };
  };

  it('rolls the rear wheels against each other when turning on the spot', () => {
    const { v, wheels, rig } = build();
    const before = {
      rl: wheels.Wheel_RL.quaternion.clone(),
      rr: wheels.Wheel_RR.quaternion.clone(),
    };
    // Parked (spinning false) and turning left at the keyboard rate.
    settle(rig, v, flat, true, 30, false, 0, 0);
    let facing = 0;
    for (let i = 0; i < 30; i++) {
      facing += Math.PI / 60;
      settle(rig, v, flat, true, 1, false, facing, 0);
    }
    const rl = aboutX(before.rl, wheels.Wheel_RL.quaternion);
    const rr = aboutX(before.rr, wheels.Wheel_RR.quaternion);
    // Both turned, in opposite directions, by the same amount.
    expect(Math.abs(rl)).toBeGreaterThan(0.05);
    expect(Math.sign(rl)).toBe(-Math.sign(rr));
    expect(Math.abs(rl)).toBeCloseTo(Math.abs(rr), 6);
  });

  it('leaves the front wheels alone in a pivot: they steer, they do not roll', () => {
    const { v, wheels, rig } = build();
    const before = wheels.Wheel_FL.quaternion.clone();
    let facing = 0;
    for (let i = 0; i < 30; i++) {
      facing += Math.PI / 60;
      settle(rig, v, flat, true, 1, false, facing, 0);
    }
    expect(aboutX(before, wheels.Wheel_FL.quaternion)).toBeCloseTo(0, 9);
  });

  it('mirrors the whole thing when the car turns the other way', () => {
    const spin = (dir: number) => {
      const { v, wheels, rig } = build();
      const before = wheels.Wheel_RR.quaternion.clone();
      let facing = 0;
      for (let i = 0; i < 30; i++) {
        facing += (dir * Math.PI) / 60;
        settle(rig, v, flat, true, 1, false, facing, 0);
      }
      return aboutX(before, wheels.Wheel_RR.quaternion);
    };
    expect(Math.sign(spin(1))).toBe(-Math.sign(spin(-1)));
  });

  it('does not roll the wheels while pivoting in mid air', () => {
    // No ground under the tire, nothing for it to roll against.
    const { v, wheels, rig } = build();
    const before = wheels.Wheel_RL.quaternion.clone();
    let facing = 0;
    for (let i = 0; i < 30; i++) {
      facing += Math.PI / 60;
      settle(rig, v, flat, false, 1, false, facing, 0);
    }
    expect(aboutX(before, wheels.Wheel_RL.quaternion)).toBeCloseTo(0, 9);
  });
});
