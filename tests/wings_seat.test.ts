// The wings back-cosmetic seat (src/render/characters/wings.ts): the prop is
// seated by matrix math, never hand-authored bone-space offsets, because the
// mixamorig bone axes are not world-aligned and the v02 rigs carry non-uniform
// ancestor scales. These pin the math contract, not the eyeball-tuned numbers.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boneLocalSeat, wingsSeatMatrix } from '../src/render/characters/wings';

describe('wings seat math', () => {
  it('boneLocalSeat inverts the bone transform: bone * local == desired', () => {
    // An awkward bone: rotated, scaled non-uniformly, and offset, like a real
    // mixamorig spine under a scaled root.
    const boneRelModel = new THREE.Matrix4().compose(
      new THREE.Vector3(0.1, 1.4, -0.05),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.9, -0.2)),
      new THREE.Vector3(0.02, 0.02, 0.02),
    );
    const desired = wingsSeatMatrix(new THREE.Vector3(0.1, 1.4, -0.05));
    const local = boneLocalSeat(boneRelModel, desired);

    const recomposed = boneRelModel.clone().multiply(local);
    for (let i = 0; i < 16; i++) {
      expect(recomposed.elements[i]).toBeCloseTo(desired.elements[i], 10);
    }
  });

  it('seats the prop centered on the spine axis, behind and below the bone', () => {
    const bonePos = new THREE.Vector3(0.07, 1.35, 0.04);
    const p = new THREE.Vector3().setFromMatrixPosition(wingsSeatMatrix(bonePos));
    // x centers on the model axis regardless of any bone x drift
    expect(p.x).toBe(0);
    // below the chibi spine bone (the prop pivot is at its base) and behind the back
    expect(p.y).toBeLessThan(bonePos.y);
    expect(p.z).toBeLessThan(bonePos.z);
  });

  it('yaws the prop 180 so the mount block presses against the back', () => {
    const m = wingsSeatMatrix(new THREE.Vector3(0, 1.4, 0));
    // The seat rotation sends +z (the prop's authored viewer-facing front)
    // to roughly -z (into the back), modulo the small fin pitch.
    const q = new THREE.Quaternion();
    m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(fwd.z).toBeLessThan(-0.9);
  });
});
