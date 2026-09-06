import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachMountLamps, disposeMountLamps, updateMountLamps } from '../src/render/mount_lamps';
import {
  MOUNT_LAMP_COLOR,
  MOUNT_LAMP_DISTANCE,
  MOUNT_LAMP_INTENSITY,
  MOUNT_LENS_COLOR,
  MOUNT_VISUAL_SPECS,
  type MountVisualSpec,
} from '../src/render/mount_visuals';

/** A stand-in rig: a root with the named joints hanging off it. */
function rigWith(...boneNames: string[]): THREE.Object3D {
  const root = new THREE.Object3D();
  root.name = 'root';
  for (const name of boneNames) {
    const bone = new THREE.Object3D();
    bone.name = name;
    root.add(bone);
  }
  return root;
}

const specWith = (lamps: MountVisualSpec['lamps']): MountVisualSpec => ({
  ...MOUNT_VISUAL_SPECS.valorsteed,
  lamps,
});

describe('mount lamps', () => {
  it('returns null for a mount that carries none, and for a rig missing the bone', () => {
    expect(attachMountLamps(rigWith('lantern_l'), specWith([]))).toBeNull();
    // A model swap that renamed the joint must degrade to an unlit lamp rather
    // than throw inside the per-frame render path.
    expect(
      attachMountLamps(rigWith('some_other_bone'), specWith([{ bone: 'lens', offset: [0, 0, 0] }])),
    ).toBeNull();
  });

  it('builds each light from the LAMP spec, not the shared lantern defaults', () => {
    const lamps = attachMountLamps(
      rigWith('lens'),
      specWith([
        {
          bone: 'lens',
          offset: [-0.011, 0.008, 0.011],
          color: 0x3d8cff,
          intensity: 2.6,
          distance: 6.5,
        },
      ]),
    );
    expect(lamps).not.toBeNull();
    const light = lamps!.lights[0];
    expect(light.color.getHex()).toBe(0x3d8cff);
    expect(light.distance).toBe(6.5);
    expect(lamps!.peaks).toEqual([2.6]);
    expect(light.position.toArray()).toEqual([-0.011, 0.008, 0.011]);
    // Born dark and hidden: the budget pass owns `visible` from the frame it
    // first ranks the light.
    expect(light.visible).toBe(false);
    expect(light.intensity).toBe(0);
    expect(light.userData.budgetDynamic).toBe(true);
    expect(light.parent?.name).toBe('lens');
  });

  it('falls back to the shared lantern constants when a lamp overrides nothing', () => {
    const lamps = attachMountLamps(
      rigWith('lantern_l'),
      specWith([{ bone: 'lantern_l', offset: [0, 0.681, 0] }]),
    )!;
    expect(lamps.lights[0].color.getHex()).toBe(MOUNT_LAMP_COLOR);
    expect(lamps.lights[0].distance).toBe(MOUNT_LAMP_DISTANCE);
    expect(lamps.peaks).toEqual([MOUNT_LAMP_INTENSITY]);
  });

  it('drives each light back to ITS OWN peak, so a bright and a dim lamp coexist', () => {
    // The whole point of the parallel `peaks` array: the budget zeroes a dynamic
    // light and never restores it, so a shared constant here would blow the dim
    // lamp up to lantern brightness every frame.
    const lamps = attachMountLamps(
      rigWith('lantern_l', 'lens'),
      specWith([
        { bone: 'lantern_l', offset: [0, 0.681, 0] },
        { bone: 'lens', offset: [0, 0, 0], intensity: 2.6, flicker: 'steady' },
      ]),
    )!;
    updateMountLamps(lamps, 1.234);
    // the lantern gutters around its peak...
    expect(lamps.lights[0].intensity).toBeGreaterThan(MOUNT_LAMP_INTENSITY * 0.7);
    expect(lamps.lights[0].intensity).toBeLessThan(MOUNT_LAMP_INTENSITY * 1.2);
    // ...the steady lens sits exactly on its own, much lower, peak
    expect(lamps.lights[1].intensity).toBe(2.6);
  });

  it('holds a steady lamp perfectly still while a flame lamp moves', () => {
    const lamps = attachMountLamps(
      rigWith('lantern_l', 'lens'),
      specWith([
        { bone: 'lantern_l', offset: [0, 0, 0] },
        { bone: 'lens', offset: [0, 0, 0], intensity: 2.6, flicker: 'steady' },
      ]),
    )!;
    const flame: number[] = [];
    const steady: number[] = [];
    for (const t of [0, 0.31, 0.77, 1.4, 2.05]) {
      updateMountLamps(lamps, t);
      flame.push(lamps.lights[0].intensity);
      steady.push(lamps.lights[1].intensity);
    }
    expect(new Set(steady).size).toBe(1); // enchanted glass has no wick
    expect(new Set(flame).size).toBeGreaterThan(1);
  });

  it('detaches and empties every parallel array on dispose', () => {
    const rig = rigWith('lens');
    const lamps = attachMountLamps(rig, specWith([{ bone: 'lens', offset: [0, 0, 0] }]))!;
    expect(rig.getObjectByName('lens')!.children).toHaveLength(1);
    disposeMountLamps(lamps);
    expect(rig.getObjectByName('lens')!.children).toHaveLength(0);
    expect(lamps.lights).toHaveLength(0);
    expect(lamps.peaks).toHaveLength(0);
    expect(lamps.flickers).toHaveLength(0);
  });

  it('wires the shipped Chimeglass spec through to one steady blue light', () => {
    const lamps = attachMountLamps(rigWith('lens'), MOUNT_VISUAL_SPECS.chimeglass_tortoise)!;
    expect(lamps.lights).toHaveLength(1);
    expect(lamps.lights[0].color.getHex()).toBe(MOUNT_LENS_COLOR);
    expect(lamps.flickers).toEqual([false]);
    updateMountLamps(lamps, 3.7);
    expect(lamps.lights[0].intensity).toBe(lamps.peaks[0]);
    expect(lamps.peaks[0]).toBeLessThan(MOUNT_LAMP_INTENSITY);
  });
});
