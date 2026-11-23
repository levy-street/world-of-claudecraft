// Hands on the Emberbristle Broom's handle (src/render/characters/ride_grip_ik.ts), round 11.
//
// The playtest: the hands "sometimes move on their own" and the LEFT hand shows its palm
// instead of gripping. Both came from the round-10 solve being RELATIVE to whatever pose the
// seated clip left the arm in: each bone was turned by the smallest rotation that pointed
// it at its target, so the arm's twist (and the hand's roll, which was never set at all) was
// the clip's, frame by frame, and the two mirrored arms came out twisted differently.
//
// Pinned here on a rig built like the WOC body (bones down +Y, the elbow's rest bend about
// local X, a handslot under each hand turned like the shipped one, both arms mirrored):
//   - the handslot (where a weapon's grip sits in the fist) lands ON the handle, its grip
//     axis along the handle, for BOTH hands, with the back of the hand up and out: a fist
//     round the stick, never a palm turned to the camera;
//   - the answer is ABSOLUTE: however the clip posed the arm this frame, the solved arm is
//     the same (so nothing moves on its own), and the two hands mirror each other;
//   - the grip's place along the handle eases rather than snaps when the shoulder moves.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyRideGrip,
  newRideGripState,
  type RideArms,
  resolveRideArms,
} from '../src/render/characters/ride_grip_ik';

const v = () => new THREE.Vector3();
const q = () => new THREE.Quaternion();

/** A WOC-like rider: root, chest, and two mirrored arms (clavicle, upper, fore, wrist, hand,
 *  handslot), names as three sanitizes the GLB's ("upperarm.l" -> "upperarml"). */
function rider(): { root: THREE.Object3D; arms: RideArms } {
  const root = new THREE.Object3D();
  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.set(0, 1.3, 0);
  root.add(chest);
  for (const side of ['l', 'r'] as const) {
    const s = side === 'l' ? 1 : -1;
    const clav = new THREE.Bone();
    clav.name = `clavicle${side}`;
    clav.position.set(0.02 * s, 0.12, 0.014);
    // T-pose: the arm out to its own side
    clav.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * (Math.PI / 2));
    const upper = new THREE.Bone();
    upper.name = `upperarm${side}`;
    upper.position.set(0, 0.133, 0);
    const fore = new THREE.Bone();
    fore.name = `lowerarm${side}`;
    fore.position.set(0, 0.3, 0);
    // the elbow's rest bend: about local +X, the same sign on both mirrored arms
    fore.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.26);
    const wrist = new THREE.Bone();
    wrist.name = `wrist${side}`;
    wrist.position.set(0, 0.3, 0);
    const hand = new THREE.Bone();
    hand.name = `hand${side}`;
    hand.position.set(0, 0.021, 0);
    const slot = new THREE.Bone();
    slot.name = `handslot${side}`;
    slot.position.set(0.007 * s, 0.035, 0);
    slot.quaternion.set(0.487, -0.484 * s, -0.38 * s, 0.62).normalize();
    chest.add(clav);
    clav.add(upper);
    upper.add(fore);
    fore.add(wrist);
    wrist.add(hand);
    hand.add(slot);
  }
  root.updateMatrixWorld(true);
  const arms = resolveRideArms(root, ['upperarml', 'upperarmr'], ['lowerarml', 'lowerarmr']);
  if (!arms) throw new Error('arms');
  return { root, arms };
}

const GRIP = { forward: 0.45, up: 1.0, stagger: 0.18 };

/** What a seated clip might do to the arm this frame: any old twist and swing. */
function scramble(arms: RideArms, seed: number): void {
  const e = new THREE.Euler();
  let i = 0;
  for (const arm of [arms.left, arms.right]) {
    for (const bone of [arm.upper, arm.fore, arm.wrist]) {
      const a = Math.sin(seed * 12.9 + i * 78.2) * 0.9;
      const b = Math.cos(seed * 4.1 + i * 3.7) * 0.9;
      const c = Math.sin(seed * 1.3 + i * 9.1) * 0.9;
      bone.quaternion.setFromEuler(e.set(a, b, c));
      i++;
    }
  }
}

function solved(root: THREE.Object3D, arms: RideArms) {
  applyRideGrip(root, arms, GRIP, 1);
  root.updateMatrixWorld(true);
  const out = [];
  for (const arm of [arms.left, arms.right]) {
    const slot = arm.slot as THREE.Object3D;
    const pos = slot.getWorldPosition(v());
    const quat = slot.getWorldQuaternion(q());
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const wrist = arm.wrist.getWorldPosition(v());
    out.push({ pos, quat, axis, wrist });
  }
  return out;
}

describe('hands round the broom handle', () => {
  it('closes both fists ON the handle, the grip axis along it', () => {
    const { root, arms } = rider();
    const handleY = GRIP.up;
    for (const hand of solved(root, arms)) {
      // on the handle line (the rider's own +Z through the grip height), within a centimetre
      expect(Math.abs(hand.pos.y - handleY)).toBeLessThan(0.01);
      expect(Math.abs(hand.pos.x)).toBeLessThan(0.05);
      // the fist's grip axis runs along the handle, thumb side forward
      expect(hand.axis.z).toBeGreaterThan(0.99);
    }
  });

  it('turns the back of BOTH hands up (no palm to the camera), mirrored', () => {
    const { root, arms } = rider();
    const [left, right] = solved(root, arms);
    // the wrist sits above the handle on each side: knuckles up, the palm round the stick
    expect(left.wrist.y).toBeGreaterThan(left.pos.y);
    expect(right.wrist.y).toBeGreaterThan(right.pos.y);
    // the left hand mirrors the right across the rider's midline
    expect(left.wrist.x).toBeCloseTo(-right.wrist.x, 2);
    expect(left.wrist.y).toBeCloseTo(right.wrist.y, 2);
    expect(Math.sign(left.wrist.x)).toBe(1);
  });

  it('gives the same arm whatever pose the clip left it in (nothing moves on its own)', () => {
    const { root, arms } = rider();
    scramble(arms, 1);
    root.updateMatrixWorld(true);
    const a = solved(root, arms);
    for (let seed = 2; seed < 6; seed++) {
      scramble(arms, seed);
      root.updateMatrixWorld(true);
      const b = solved(root, arms);
      for (let i = 0; i < 2; i++) {
        expect(b[i].pos.distanceTo(a[i].pos), `seed ${seed}`).toBeLessThan(1e-4);
        expect(Math.abs(b[i].quat.dot(a[i].quat)), `seed ${seed}`).toBeGreaterThan(0.99999);
        expect(b[i].wrist.distanceTo(a[i].wrist)).toBeLessThan(1e-4);
      }
    }
  });

  it('a short arm rolls its shoulder in and still closes on the handle', () => {
    const { root, arms } = rider();
    // a handle low enough that the straight arm alone falls a few centimetres short
    const low = { forward: 0.3, up: 0.74, stagger: 0 };
    applyRideGrip(root, arms, low, 1);
    root.updateMatrixWorld(true);
    for (const arm of [arms.left, arms.right]) {
      const at = (arm.slot as THREE.Object3D).getWorldPosition(v());
      expect(Math.abs(at.y - low.up), arm.upper.name).toBeLessThan(0.01);
    }
  });

  it('keeps the bone lengths: a reach, never a stretch', () => {
    const { root, arms } = rider();
    solved(root, arms);
    for (const arm of [arms.left, arms.right]) {
      const s = arm.upper.getWorldPosition(v());
      const e = arm.fore.getWorldPosition(v());
      const w = arm.wrist.getWorldPosition(v());
      expect(s.distanceTo(e)).toBeCloseTo(0.3, 5);
      expect(e.distanceTo(w)).toBeCloseTo(0.3, 5);
    }
  });

  it("eases the grip's place along the handle when the shoulders move", () => {
    const { root, arms } = rider();
    const state = newRideGripState();
    // far enough forward that each hand sits at the edge of its reach
    const far = { forward: 1.4, up: 1.0, stagger: 0 };
    applyRideGrip(root, arms, far, 1, state, 1 / 60);
    root.updateMatrixWorld(true);
    const before = (arms.left.slot as THREE.Object3D).getWorldPosition(v());
    // a sudden lean pulls the shoulder back a hand's width
    const chest = root.getObjectByName('chest') as THREE.Object3D;
    chest.position.z -= 0.08;
    root.updateMatrixWorld(true);
    applyRideGrip(root, arms, far, 1, state, 1 / 60);
    root.updateMatrixWorld(true);
    const after = (arms.left.slot as THREE.Object3D).getWorldPosition(v());
    // one frame later the hand has slid only part of the way, not jumped the full 8 cm
    expect(before.z - after.z).toBeGreaterThan(0);
    expect(before.z - after.z).toBeLessThan(0.04);
  });

  it('a zero blend moves nothing, and a frozen rig is left alone', () => {
    const { root, arms } = rider();
    const before = arms.left.wrist.getWorldPosition(v());
    applyRideGrip(root, arms, GRIP, 0);
    root.updateMatrixWorld(true);
    expect(arms.left.wrist.getWorldPosition(v()).distanceTo(before)).toBeLessThan(1e-9);
    root.matrixWorldAutoUpdate = false;
    const rest = arms.left.upper.quaternion.clone();
    applyRideGrip(root, arms, GRIP, 1);
    expect(arms.left.upper.quaternion.equals(rest)).toBe(true);
  });
});
