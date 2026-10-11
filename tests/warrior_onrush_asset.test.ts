import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { expect, it } from 'vitest';

it('adds a grounded compression and recovery while preserving both existing movement clips', async () => {
  await MeshoptDecoder.ready;
  const doc = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .read('public/models/chars/players/warrior_ability_anims.glb');
  const root = doc.getRoot();
  const fingerprints: Record<string, string> = {
    Warrior_Heroic_Leap: '7ef82584a99656796bae6b90ac17f772394311c5b1fc7d5427e660d79bec308f',
    Warrior_Rush_Loop: 'ee8fc3ebda470a7421711628d8868319c921c745d6f48986c6948850cea824d8',
  };
  for (const [name, hash] of Object.entries(fingerprints)) {
    const clip = root.listAnimations().find((a) => a.getName() === name)!;
    const tracks = clip
      .listChannels()
      .map((channel) => [
        channel.getTargetNode()!.getName(),
        channel.getTargetPath(),
        Array.from(channel.getSampler()!.getInput()!.getArray()!),
        Array.from(channel.getSampler()!.getOutput()!.getArray()!),
      ]);
    expect(createHash('sha256').update(JSON.stringify(tracks)).digest('hex')).toBe(hash);
  }
  const arrival = root.listAnimations().find((a) => a.getName() === 'Warrior_Onrush_Arrival');
  expect(arrival).toBeDefined();
  const rig = new THREE.Group();
  const objects = new Map(root.listNodes().map((node) => [node, new THREE.Object3D()]));
  for (const [node, object] of objects) {
    object.name = node.getName();
    object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation());
    object.scale.fromArray(node.getScale());
    (objects.get(node.getParentNode()!) ?? rig).add(object);
  }
  const tracks = arrival!.listChannels().map((channel) => {
    const sampler = channel.getSampler()!;
    const path = channel.getTargetPath()!;
    const times = Float32Array.from(sampler.getInput()!.getArray()!);
    const values = Float32Array.from(sampler.getOutput()!.getArray()!);
    expect(Array.from(values).every(Number.isFinite)).toBe(true);
    expect(times[times.length - 1]).toBeCloseTo(0.3, 5);
    const interpolant =
      path === 'rotation'
        ? new THREE.QuaternionLinearInterpolant(times, values, 4)
        : new THREE.LinearInterpolant(times, values, 3);
    return { object: objects.get(channel.getTargetNode()!)!, path, interpolant };
  });
  const feet = ['foot.l', 'foot.r'].map((name) => rig.getObjectByName(name)!);
  const hips = rig.getObjectByName('hips')!;
  const rootBone = rig.getObjectByName('root')!;
  const anchors: THREE.Vector3[] = [];
  const pelvisHeights: number[] = [];
  let origin: THREE.Vector3 | undefined;
  for (let frame = 0; frame <= 150; frame++) {
    for (const track of tracks) {
      const value = track.interpolant.evaluate(frame * 0.002);
      if (track.path === 'rotation') track.object.quaternion.fromArray(value);
      else if (track.path === 'translation') track.object.position.fromArray(value);
      else track.object.scale.fromArray(value);
    }
    rig.updateMatrixWorld(true);
    pelvisHeights.push(hips.getWorldPosition(new THREE.Vector3()).y);
    const point = rootBone.getWorldPosition(new THREE.Vector3());
    origin ??= point.clone();
    expect(point.distanceTo(origin)).toBeLessThan(0.000001);
    for (let foot = 0; foot < feet.length; foot++) {
      const position = feet[foot].getWorldPosition(new THREE.Vector3());
      anchors[foot] ??= position.clone();
      expect(position.distanceTo(anchors[foot])).toBeLessThan(0.001);
    }
  }
  expect(Math.max(...pelvisHeights) - Math.min(...pelvisHeights)).toBeGreaterThan(0.05);
  expect(root.listMeshes()).toHaveLength(0);
});
