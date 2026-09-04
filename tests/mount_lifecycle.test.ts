import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CharacterVisual } from '../src/render/characters';
import { type MountViewState, placeRider, seatRiderOnBone } from '../src/render/mount_lifecycle';
import { type MountVisualSpec, mountVisualSpec } from '../src/render/mount_visuals';
import { MOUNT_KEYS } from '../src/sim/content/mounts';

// The rider seat rule of src/render/mount_lifecycle.ts, driven on bare
// three.js objects: a moving seat (a mount with a seatBone) puts the rider on
// the bone, and the fixed-lift fallback resets EVERYTHING that seat wrote,
// x included, so a dismount mid-stride cannot leave the rider offset for the
// life of the view.

const troll = (): MountVisualSpec => {
  const spec = mountVisualSpec('lanternback_troll');
  if (!spec?.seatBone) throw new Error('the troll rides a seat bone');
  return spec;
};
const horse = (): MountVisualSpec => {
  const spec = mountVisualSpec('valorsteed');
  if (!spec || spec.seatBone) throw new Error('the horse is a fixed-lift saddle');
  return spec;
};

function rig(): { v: MountViewState; rider: THREE.Object3D; chair: THREE.Object3D } {
  const group = new THREE.Group();
  const rider = new THREE.Object3D();
  const mountRoot = new THREE.Object3D();
  const chair = new THREE.Object3D();
  chair.name = 'chair';
  // A seat that has rolled sideways mid-stride: a lateral offset AND a lean.
  chair.position.set(0.3, 1.2, -0.4);
  chair.rotation.z = 0.5;
  mountRoot.add(chair);
  group.add(rider);
  group.add(mountRoot);
  const v: MountViewState = {
    group,
    mountVisual: { root: mountRoot } as unknown as CharacterVisual,
    mountVisualKey: 'mount_lanternback_troll',
    mountLamps: null,
    mountGlows: null,
    mountCompilePending: false,
    mountSeatBone: null,
    mountPullerVisual: null,
  };
  return { v, rider, chair };
}

describe('seatRiderOnBone', () => {
  it('parks the rider at the seat offset in the bone frame, rebased into group space', () => {
    const { v, rider, chair } = rig();
    const spec = troll();
    expect(seatRiderOnBone(v.group, rider, v.mountVisual!.root, spec, v)).toBe(true);
    const expected = new THREE.Vector3(...spec.seatBone!.offset);
    chair.updateWorldMatrix(true, false);
    expected.applyMatrix4(chair.matrixWorld);
    expect(rider.position.distanceTo(expected)).toBeLessThan(1e-6);
    // The rider took the seat's lean with it, and the lookup is cached.
    expect(rider.quaternion.equals(new THREE.Quaternion())).toBe(false);
    expect(v.mountSeatBone).toBe(chair);
  });

  it('declines a mount with no seat bone so the caller falls back to the fixed lift', () => {
    const { v, rider } = rig();
    expect(seatRiderOnBone(v.group, rider, v.mountVisual!.root, horse(), v)).toBe(false);
    expect(rider.position.length()).toBe(0);
  });
});

describe('placeRider', () => {
  it('resets x, y, z and the rotation on dismount after a bone seat', () => {
    const { v, rider } = rig();
    placeRider(v, rider, troll(), troll().seat, 0);
    expect(rider.position.x).not.toBe(0);
    placeRider(v, rider, null, 0, 0);
    expect(rider.position.toArray()).toEqual([0, 0, 0]);
    expect(rider.quaternion.equals(new THREE.Quaternion())).toBe(true);
  });

  it('holds a fixed-lift saddle at lift plus bob and the authored forward shift, x at zero', () => {
    const { v, rider } = rig();
    placeRider(v, rider, troll(), troll().seat, 0); // leave a stale x behind
    const spec = horse();
    placeRider(v, rider, spec, spec.seat, 0.05);
    expect(rider.position.x).toBe(0);
    expect(rider.position.y).toBeCloseTo(spec.seat + 0.05, 9);
    expect(rider.position.z).toBe(spec.seatFwd);
  });
});

describe('mount visual spec flags', () => {
  it('only the rickshaw tips off a jump; every other mount keeps a level body', () => {
    for (const key of MOUNT_KEYS) {
      expect(mountVisualSpec(key)?.jumpTips, key).toBe(key === 'rickshaw_mount');
    }
  });
});
