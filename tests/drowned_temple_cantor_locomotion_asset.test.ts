import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { sourceFingerprint } from '../scripts/assets/temple_laverock_locomotion/fingerprint.mjs';
import {
  contacts,
  type MeasuredRig,
  normalizedScale,
  player,
  readRig,
} from '../scripts/assets/temple_laverock_locomotion/measure.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { CANTOR_GUIDE } from '../src/sim/content/drowned_temple_cantor';

describe('Laverock original-rig locomotion bank', () => {
  let body: MeasuredRig;
  let bank: MeasuredRig;
  let scale: number;
  beforeAll(async () => {
    body = await readRig('public/models/creatures/temple_laverock.glb');
    bank = await readRig('public/models/creatures/temple_laverock_locomotion.glb');
    scale = normalizedScale(body);
  });

  it('contains only Walk and Run, without replacing the model or textures', () => {
    expect(VISUALS.npc_laverock.height).toBe(3.75);
    expect(VISUALS.npc_laverock.clips.walk).toBe('Walk');
    expect(VISUALS.npc_laverock.clips.run).toBe('Run');
    expect(CANTOR_GUIDE.follow.walkSpeed).toBe(3.2);
    expect(CANTOR_GUIDE.follow.runSpeed).toBe(7);
    expect(VISUALS.npc_laverock.animUrls).toEqual([
      'models/creatures/temple_laverock_locomotion.glb',
    ]);
    expect(
      bank.document
        .getRoot()
        .listAnimations()
        .map((a) => a.getName())
        .sort(),
    ).toEqual(['Run', 'Walk']);
    expect(bank.document.getRoot().listMeshes()).toHaveLength(0);
    expect(bank.document.getRoot().listTextures()).toHaveLength(0);
    const buffer = readFileSync('public/models/creatures/temple_laverock_locomotion.glb');
    expect(buffer.length).toBeLessThan(150_000);
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(
      '43ca4a7f2eb6b19279465c939e6a81cfa82a436cd655ef2cab10b438d02f001e',
    );
    expect(
      bank.document
        .getRoot()
        .listNodes()
        .find((node) => node.getName() === 'LaverockRig')
        ?.getExtras(),
    ).toEqual({ laverockLocomotionSourceSha256: sourceFingerprint() });
  });

  it('keeps every joint rest transform and every keyed translation compatible with the shipped body', () => {
    const original = new Map(
      body.document
        .getRoot()
        .listNodes()
        .map((node) => [node.getName(), node]),
    );
    const nodes = bank.document.getRoot().listNodes();
    expect(nodes).toHaveLength(67);
    for (const node of nodes) {
      const target = original.get(node.getName());
      expect(target, node.getName()).toBeDefined();
      expect(node.getParentNode()?.getName()).toBe(target?.getParentNode()?.getName());
      for (const [actual, expected] of [
        [node.getTranslation(), target?.getTranslation()],
        [node.getRotation(), target?.getRotation()],
        [node.getScale(), target?.getScale()],
      ] as const) {
        for (let i = 0; i < actual.length; i++)
          expect(actual[i]).toBeCloseTo(expected?.[i] ?? NaN, 4);
      }
    }
    // Absolute translation channels must not shorten a limb when the clips
    // are applied to the original body; only Root has moving translations.
    for (const animation of bank.document.getRoot().listAnimations()) {
      for (const channel of animation.listChannels()) {
        const target = channel.getTargetNode();
        if (channel.getTargetPath() !== 'translation' || target?.getName() === 'Root') continue;
        const expected = original.get(target?.getName() ?? '')?.getTranslation();
        const values = channel.getSampler()?.getOutput()?.getArray() ?? [];
        for (let i = 0; i < values.length; i++)
          expect(values[i]).toBeCloseTo(expected?.[i % 3] ?? NaN, 4);
      }
    }
  });

  it.each([
    { name: 'Walk', stance: 0.6, speed: 1.848751 },
    { name: 'Run', stance: 0.4, speed: 4.468026 },
  ])(
    '$name matches measured planted-foot travel and stays above the floor',
    ({ name, stance, speed }) => {
      const animation = bank.document
        .getRoot()
        .listAnimations()
        .find((a) => a.getName() === name);
      expect(animation).toBeDefined();
      const measured = contacts(bank, animation!, scale, stance);
      expect(measured.speed).toBeCloseTo(speed, 5);
      const ref = name === 'Run' ? VISUALS.npc_laverock.runRef : VISUALS.npc_laverock.walkRef;
      expect(ref).toBeCloseTo(measured.speed, 5);
      expect(measured.max - measured.min).toBeLessThan(0.1);
      expect(measured.ankleMin).toBeGreaterThan(0.09);
      expect(measured.ankleMin).toBeLessThan(0.11);
      expect(measured.ankleMax).toBeGreaterThan(measured.ankleMin + 0.15);
      expect(measured.seam).toBeLessThan(0.00001);
    },
  );

  it.each(['Walk', 'Run'])(
    '%s closes its whole rig loop and keeps the arms and staff steady',
    (name) => {
      const animation = bank.document
        .getRoot()
        .listAnimations()
        .find((a) => a.getName() === name)!;
      const duration = Math.max(
        ...animation.listSamplers().map((s) => s.getInput()!.getMax([])[0]),
      );
      const sample = player(bank, animation);
      sample(0);
      const first = [...bank.objects.values()].map((object) => ({
        position: object.getWorldPosition(new Vector3()),
        rotation: object.getWorldQuaternion(new Quaternion()),
      }));
      sample(duration);
      [...bank.objects.values()].forEach((object, i) => {
        expect(object.getWorldPosition(new Vector3()).distanceTo(first[i].position)).toBeLessThan(
          0.01,
        );
        expect(object.getWorldQuaternion(new Quaternion()).angleTo(first[i].rotation)).toBeLessThan(
          0.02,
        );
      });
      const bones = [...bank.objects.values()].filter(
        (object) =>
          /^(L_|R_)(Clavicle|UpperArm|Forearm|Hand)$/.test(object.name) || object.name === 'Staff',
      );
      expect(bones.length).toBeGreaterThanOrEqual(8);
      for (const bone of bones) {
        const rotations: Quaternion[] = [];
        for (let i = 0; i <= Math.round(duration * 24); i++) {
          sample(Math.min(i / 24, duration));
          rotations.push(bone.getWorldQuaternion(new Quaternion()));
        }
        const velocity = rotations.slice(1).map((rotation, i) => {
          const delta = rotation.clone().multiply(rotations[i].clone().invert());
          if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
          const sin = Math.hypot(delta.x, delta.y, delta.z);
          const angle = (2 * Math.atan2(sin, delta.w) * 180) / Math.PI;
          return new Vector3(delta.x, delta.y, delta.z).multiplyScalar(
            sin > 1e-9 ? angle / sin : 0,
          );
        });
        // Include the seam: a cycle must stay smooth when it plays again.
        const wrapped = [...velocity, velocity[0], velocity[1]];
        const acceleration = wrapped.slice(1).map((v, i) => v.clone().sub(wrapped[i]));
        for (let i = 1; i < acceleration.length - 1; i++) {
          if (
            acceleration[i - 1].dot(acceleration[i]) >= 0 ||
            acceleration[i].dot(acceleration[i + 1]) >= 0
          )
            continue;
          const tremor = Math.min(
            acceleration[i - 1].length(),
            acceleration[i].length(),
            acceleration[i + 1].length(),
          );
          expect(tremor, name + ' ' + bone.name).toBeLessThanOrEqual(2.5);
        }
      }
    },
  );
});
