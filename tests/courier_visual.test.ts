import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COURIER_HEIGHT,
  CourierVisual,
  courierAnimationClips,
  courierPreloadInternalsForTest,
} from '../src/render/courier_visual';

afterEach(() => courierPreloadInternalsForTest.setSourceForTest(null));

function setup() {
  const source = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  source.add(new THREE.Mesh(geometry, material));
  for (const name of ['WingLeft', 'WingRight']) {
    const wing = new THREE.Group();
    wing.name = name;
    source.add(wing);
  }
  courierPreloadInternalsForTest.setSourceForTest(source);
  const scene = new THREE.Scene();
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const gate = vi.fn(() => pending);
  const ground = vi.fn(() => 7);
  const view = new CourierVisual(scene, ground, gate);
  return { view, source, scene, gate, ground, finish, geometry, material };
}

describe('CourierVisual lifecycle', () => {
  it('gates the first attach and reuses the same root across snapshots and journeys', async () => {
    const { view, scene, gate, finish, source, ground } = setup();
    const info = {
      phase: 'outbound' as const,
      x: 4,
      z: 8,
      travelDistance: 8,
      remainingDistance: 30,
    };
    view.update(info, 0.05, true);
    expect(scene.children).toEqual([view.root]);
    expect(view.root.visible).toBe(false);
    view.update({ ...info, x: 5 }, 0.05, true);
    expect(view.root.visible).toBe(false);
    expect(view.root.position.toArray()).toEqual([5, 9, 8]);
    expect(ground).toHaveBeenLastCalledWith(5, 8);
    expect(view.root.rotation.y).toBe(Math.PI / 2);
    expect(source.getObjectByName('WingLeft')?.rotation.z).toBe(0);
    finish();
    await Promise.resolve();
    expect(view.root.visible).toBe(true);
    view.update(null, 0.05, false);
    expect(view.root.children[0].visible).toBe(false);
    view.update(info, 0.05, true);
    expect(view.root.children[0].visible).toBe(true);
    expect(gate).toHaveBeenCalledTimes(1);
    view.dispose();
  });
  it('does not resurrect a cancelled journey when its gate finishes late', async () => {
    const { view, finish } = setup();
    view.update({ phase: 'ready', x: 0, z: 0 }, 0, false);
    view.update(null, 0, false);
    finish();
    await Promise.resolve();
    expect(view.root.children[0].visible).toBe(false);
    view.dispose();
  });
  it('cancels pending reveal on disposal without disposing shared asset resources', async () => {
    const { view, finish, scene, geometry, material } = setup();
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    view.update({ phase: 'returning', x: 3, z: 1 }, 0.05, false);
    view.dispose();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.children).toEqual([]);
    expect(view.root.visible).toBe(false);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    view.update({ phase: 'ready', x: 0, z: 0 }, 0.05, false);
    expect(scene.children).toEqual([]);
  });
  it('adds nothing until the deferred asset is ready', () => {
    const { view, scene, gate } = setup();
    courierPreloadInternalsForTest.setSourceForTest(null);
    view.update({ phase: 'ready', x: 0, z: 0 }, 0.05, false);
    expect(scene.children).toEqual([]);
    expect(gate).not.toHaveBeenCalled();
    view.dispose();
  });
});

describe('courier rig and animation ownership', () => {
  it('removes only the copied Fly root hover track', () => {
    const track = new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0.46, 0, 0, 0.46, 0]);
    const rotation = new THREE.QuaternionKeyframeTrack('root.quaternion', [0], [0, 0, 0, 1]);
    const fly = new THREE.AnimationClip('Fly', 1, [track, rotation]);
    const idle = new THREE.AnimationClip('Idle', 1, [track]);
    const [copy, idleCopy] = courierAnimationClips([fly, idle]);
    expect(copy.tracks.map((item) => item.name)).toEqual(['root.quaternion']);
    expect(idleCopy.tracks).toHaveLength(1);
    expect(fly.tracks).toHaveLength(2);
    expect(copy.tracks[0]).not.toBe(rotation);
  });
  it('owns skeletons, preserves textures, normalizes posed height, and releases only owned resources', () => {
    const model = new THREE.Group();
    const bone = new THREE.Bone();
    bone.name = 'root';
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
    );
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const skin = new THREE.SkinnedMesh(geometry, material);
    skin.add(bone);
    skin.bind(new THREE.Skeleton([bone]));
    model.add(skin);
    const clips = ['Idle', 'Run', 'Fly'].map(
      (name) =>
        new THREE.AnimationClip(name, 1, [
          new THREE.QuaternionKeyframeTrack(
            'root.quaternion',
            [0, 1],
            [0, 0, 0, 1, 0, 0.2, 0, Math.sqrt(0.96)],
          ),
        ]),
    );
    courierPreloadInternalsForTest.setSourceForTest(model, clips);
    const scene = new THREE.Scene();
    const view = new CourierVisual(
      scene,
      () => 0,
      async () => {},
    );
    const second = new CourierVisual(
      scene,
      () => 0,
      async () => {},
    );
    view.update({ phase: 'ready', x: 0, z: 0 }, 0, false);
    second.update({ phase: 'ready', x: 0, z: 0 }, 0, false);
    const firstSkin = view.root.children[0].children[0] as THREE.SkinnedMesh;
    const secondSkin = second.root.children[0].children[0] as THREE.SkinnedMesh;
    expect(firstSkin.skeleton).not.toBe(skin.skeleton);
    expect(firstSkin.skeleton.bones[0]).not.toBe(secondSkin.skeleton.bones[0]);
    expect(firstSkin.material).toBe(material);
    expect(firstSkin.geometry).toBe(geometry);
    expect(view.root.children[0].scale.y * 2).toBeCloseTo(COURIER_HEIGHT);
    const otherPose = secondSkin.skeleton.bones[0].quaternion.clone();
    view.update(
      { phase: 'outbound', x: 8, z: 0, travelDistance: 8, remainingDistance: 40 },
      0.1,
      false,
    );
    expect(firstSkin.skeleton.bones[0].quaternion.equals(otherPose)).toBe(false);
    expect(secondSkin.skeleton.bones[0].quaternion.equals(otherPose)).toBe(true);
    expect(view.root.position.y).toBe(2);
    const still = firstSkin.skeleton.bones[0].quaternion.clone();
    view.update(
      { phase: 'outbound', x: 9, z: 0, travelDistance: 8, remainingDistance: 39 },
      0.1,
      true,
    );
    expect(firstSkin.skeleton.bones[0].quaternion.equals(still)).toBe(true);
    const dispose = vi.spyOn(firstSkin.skeleton, 'dispose');
    const sourceDispose = vi.spyOn(skin.skeleton, 'dispose');
    const textureDispose = vi.spyOn(material.map!, 'dispose');
    view.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();
    second.dispose();
  });
});
