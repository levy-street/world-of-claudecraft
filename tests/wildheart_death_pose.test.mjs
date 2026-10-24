import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

// The three troll rigs the basin still draws. The Beastmaster and Zulgar wear
// their art-guide bodies now, with their own authored deaths.
const names = ['stalker', 'ravager', 'hexcaller'];
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

function poseOf(clip, last) {
  const pose = new Map();
  for (const channel of clip.listChannels()) {
    const output = channel.getSampler().getOutput();
    const values = output.getArray();
    const size = output.getElementSize();
    const node = channel.getTargetNode();
    const entry = pose.get(node) ?? {};
    entry[channel.getTargetPath()] = Array.from(last ? values.slice(-size) : values.slice(0, size));
    pose.set(node, entry);
  }
  return pose;
}

function position(node, pose) {
  const chain = [];
  for (let parent = node; parent; parent = parent.getParentNode()) chain.unshift(parent);
  const matrix = new Matrix4();
  for (const bone of chain) {
    const key = pose.get(bone) ?? {};
    matrix.multiply(
      new Matrix4().compose(
        new Vector3().fromArray(key.translation ?? bone.getTranslation()),
        new Quaternion().fromArray(key.rotation ?? bone.getRotation()),
        new Vector3().fromArray(key.scale ?? bone.getScale()),
      ),
    );
  }
  return new Vector3().setFromMatrixPosition(matrix);
}

describe('Wildheart shipped corpse poses', () => {
  it.each(names)('%s collapses with arms beside the torso and a complete pose', async (name) => {
    const root = (await io.read(`public/models/creatures/wildheart_${name}.glb`)).getRoot();
    const death = root.listAnimations().find((clip) => clip.getName() === 'Death');
    const final = poseOf(death, true);
    const first = poseOf(death, false);
    const idle = poseOf(
      root.listAnimations().find((clip) => clip.getName() === 'Idle'),
      false,
    );
    const nodes = new Map(root.listNodes().map((node) => [node.getName(), node]));
    const at = (name) => position(nodes.get(name), final);
    const torso = at('NeckTwist01').sub(at('Waist')).normalize();
    for (const side of ['L', 'R']) {
      const upperarm = at(`${side}_Forearm`)
        .sub(at(`${side}_Upperarm`))
        .normalize();
      // An arms-out T has a near-zero longitudinal component. A limp upper arm
      // points down the body toward the hips, even after the whole rig topples.
      expect(upperarm.dot(torso), `${side} arm must fall alongside the torso`).toBeLessThan(-0.55);
      const thigh = at(`${side}_Calf`)
        .sub(at(`${side}_Thigh`))
        .normalize();
      const calf = at(`${side}_Foot`)
        .sub(at(`${side}_Calf`))
        .normalize();
      expect(thigh.dot(calf), `${side} knee remains relaxed rather than rigid`).toBeLessThan(0.98);
    }
    expect(Math.abs(torso.y), 'corpse lies down').toBeLessThan(0.45);
    const standingHip = position(nodes.get('Hip'), new Map()).y;
    expect(at('Hip').y, 'hips settle near the ground').toBeLessThan(standingHip * 0.5);
    expect(at('Head').y, 'head stays above the floor').toBeGreaterThan(0);
    for (const [node, pose] of idle) {
      for (const [path, value] of Object.entries(pose)) {
        for (let i = 0; i < value.length; i++) {
          expect(first.get(node)[path][i], `${node.getName()} starts in Idle`).toBeCloseTo(
            value[i],
            5,
          );
        }
      }
    }
    for (const skin of root.listSkins()) {
      for (const joint of skin.listJoints()) {
        expect(
          final.get(joint)?.rotation,
          `${joint.getName()} cannot inherit bind/previous action`,
        ).toBeDefined();
      }
    }
  });

  it.each(names)('%s reproduces the shipping GLB byte for byte', (name) => {
    const temp = mkdtempSync(join(tmpdir(), 'wildheart-death-'));
    try {
      const source = `public/models/creatures/wildheart_${name}.glb`;
      const output = join(temp, `${name}.glb`);
      execFileSync(process.execPath, ['scripts/_add_wildheart_death_anim.mjs', source, output]);
      expect(readFileSync(output).equals(readFileSync(source))).toBe(true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
