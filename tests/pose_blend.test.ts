import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import type { TimelineRow } from '../scripts/anim/pose_blend.mjs';
import {
  bakeClip,
  blendValue,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  lerpV,
  mergePoses,
  poseValue,
  pushPoseRamp,
  sampleChannel,
  samplePose,
  slerpQ,
  stripToAnimationsOnly,
} from '../scripts/anim/pose_blend.mjs';

describe('pose_blend math', () => {
  it('lerpV interpolates component-wise', () => {
    expect(lerpV([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]);
    expect(lerpV([1, 1], [1, 1], 0.7)).toEqual([1, 1]);
  });

  it('slerpQ returns the start endpoint at t=0 and the end endpoint at t=1', () => {
    const a = [0, 0, 0, 1];
    const b = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90deg around Y
    expect(slerpQ(a, b, 0)).toEqual(a);
    const end = slerpQ(a, b, 1);
    expect(end[0]).toBeCloseTo(b[0], 6);
    expect(end[1]).toBeCloseTo(b[1], 6);
    expect(end[2]).toBeCloseTo(b[2], 6);
    expect(end[3]).toBeCloseTo(b[3], 6);
  });

  it('slerpQ stays unit-length mid-interpolation and matches the halfway-angle quaternion', () => {
    const a = [0, 0, 0, 1];
    const b = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90deg around Y
    const mid = slerpQ(a, b, 0.5);
    expect(Math.hypot(...mid)).toBeCloseTo(1, 6);
    // halfway between 0deg and 90deg around Y is 45deg around Y
    expect(mid[0]).toBeCloseTo(0, 6);
    expect(mid[1]).toBeCloseTo(Math.sin(Math.PI / 8), 6);
    expect(mid[2]).toBeCloseTo(0, 6);
    expect(mid[3]).toBeCloseTo(Math.cos(Math.PI / 8), 6);
  });

  it('slerpQ takes the short path when the dot product is negative', () => {
    const a = [0, 0, 0, 1];
    const b = [0, 0, 0, -1]; // same rotation as a, opposite sign (long way if taken naively)
    const mid = slerpQ(a, b, 0.5);
    expect(mid[3]).toBeGreaterThan(0);
    expect(Math.hypot(...mid)).toBeCloseTo(1, 6);
  });

  it('easing curves hit their bookends and stay within [0,1]', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 6);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(easeOutCubic(t)).toBeGreaterThanOrEqual(0);
      expect(easeOutCubic(t)).toBeLessThanOrEqual(1);
      expect(easeInOutQuad(t)).toBeGreaterThanOrEqual(0);
      expect(easeInOutQuad(t)).toBeLessThanOrEqual(1);
    }
  });

  it('blendValue dispatches to slerp for rotation keys and lerp otherwise', () => {
    const rot = blendValue('bone|rotation', [0, 0, 0, 1], [0, 0, 0, -1], 0.5);
    expect(Math.hypot(...rot)).toBeCloseTo(1, 6);
    const pos = blendValue('bone|translation', [0, 0, 0], [2, 0, 0], 0.5);
    expect(pos).toEqual([1, 0, 0]);
  });

  it('pushPoseRamp appends N eased [time, valueFor] rows blending between two static poses', () => {
    const fromPose = new Map([['bone|translation', [0, 0, 0]]]);
    const toPose = new Map([['bone|translation', [10, 0, 0]]]);
    const timeline: TimelineRow[] = [];
    pushPoseRamp(timeline, {
      fromTime: 0,
      toTime: 1,
      steps: 4,
      ease: (t) => t, // linear, easiest to assert exactly
      fromPose,
      toPose,
      fallback: undefined,
    });
    expect(timeline).toHaveLength(4);
    expect(timeline.map(([t]) => t)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(timeline[1][1]('bone|translation', 'bone')).toEqual([5, 0, 0]);
    expect(timeline[3][1]('bone|translation', 'bone')).toEqual([10, 0, 0]);
  });

  it('poseValue falls back to the fallback pose then to null', () => {
    const pose = new Map([['a|translation', [1, 2, 3]]]);
    const fallback = new Map([['b|translation', [9, 9, 9]]]);
    expect(poseValue(pose, 'a|translation', fallback)).toEqual([1, 2, 3]);
    expect(poseValue(pose, 'b|translation', fallback)).toEqual([9, 9, 9]);
    expect(poseValue(pose, 'c|translation', fallback)).toBeNull();
  });

  it('mergePoses unions donor poses, earlier poses winning on a shared key', () => {
    const first = new Map([
      ['a|translation', [1, 1, 1]],
      ['shared|translation', [2, 2, 2]],
    ]);
    const second = new Map([
      ['shared|translation', [9, 9, 9]],
      ['b|translation', [3, 3, 3]],
    ]);
    const merged = mergePoses(first, second);
    expect(merged.get('a|translation')).toEqual([1, 1, 1]);
    expect(merged.get('b|translation')).toEqual([3, 3, 3]);
    expect(merged.get('shared|translation')).toEqual([2, 2, 2]);
    expect(merged.size).toBe(3);
  });

  it('mergePoses with no poses returns an empty pose', () => {
    expect(mergePoses().size).toBe(0);
  });

  it('sampleChannel clamps to the endpoints and lerps in between', () => {
    const ch = {
      path: 'translation',
      times: new Float32Array([0, 1, 2]),
      values: new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0]),
      size: 3,
    };
    expect(sampleChannel(ch, -1)).toEqual([0, 0, 0]);
    expect(sampleChannel(ch, 3)).toEqual([20, 0, 0]);
    expect(sampleChannel(ch, 0.5)).toEqual([5, 0, 0]);
  });
});

/**
 * A minimal synthetic 2-node rig (root + one rotating bone) with three named
 * donor clips (Idle/Reach/Hold, each a 2-key rotation-only animation on
 * "arm.r") plus an unattached mesh, so the clip-authoring/stripping tests
 * below don't depend on the real (gitignored, not present in every
 * checkout/worktree) KayKit source pack.
 */
function buildSyntheticRigDocument() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const root = doc.createNode('root');
  const arm = doc.createNode('arm.r').setTranslation([0, 1, 0]);
  root.addChild(arm);
  doc.createScene().addChild(root);

  function addClip(name: string, angleAt0: number, angleAt1: number) {
    const anim = doc.createAnimation(name);
    const times = doc
      .createAccessor(`${name}_t`)
      .setType('SCALAR')
      .setArray(new Float32Array([0, 1]))
      .setBuffer(buffer);
    const q0 = [0, Math.sin(angleAt0 / 2), 0, Math.cos(angleAt0 / 2)];
    const q1 = [0, Math.sin(angleAt1 / 2), 0, Math.cos(angleAt1 / 2)];
    const values = doc
      .createAccessor(`${name}_r`)
      .setType('VEC4')
      .setArray(new Float32Array([...q0, ...q1]))
      .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(times)
      .setOutput(values)
      .setInterpolation('LINEAR');
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(arm)
      .setTargetPath('rotation')
      .setSampler(sampler);
    anim.addSampler(sampler).addChannel(channel);
    return anim;
  }

  addClip('Idle', 0, 0);
  addClip('Reach', 0, Math.PI / 2);
  addClip('Hold', Math.PI / 2, Math.PI / 2);

  const mesh = doc.createMesh('TestMesh');
  root.setMesh(mesh);

  return { doc, root, arm };
}

describe('pose_blend clip authoring (synthetic rig fixture)', () => {
  it('indexes a donor clip and samples its channel values at an arbitrary time', () => {
    const { doc } = buildSyntheticRigDocument();
    const idleIdx = indexClip(doc.getRoot(), 'Idle');
    expect(idleIdx.size).toBe(1);

    const reachIdx = indexClip(doc.getRoot(), 'Reach');
    const pose = samplePose(reachIdx, 0.5);
    const value = pose.get('arm.r|rotation');
    expect(value?.[0]).toBeCloseTo(0, 6);
    expect(value?.[1]).toBeCloseTo(Math.sin(Math.PI / 8), 6);
    expect(value?.[3]).toBeCloseTo(Math.cos(Math.PI / 8), 6);
  });

  it('throws for a donor clip name that does not exist on the rig', () => {
    const { doc } = buildSyntheticRigDocument();
    expect(() => indexClip(doc.getRoot(), 'Nope')).toThrow(/donor clip missing/);
  });

  it('bakes a new clip from an authored timeline, then strips donors/mesh/skin', () => {
    const { doc } = buildSyntheticRigDocument();
    const root = doc.getRoot();
    const idleIdx = indexClip(root, 'Idle');
    const reachIdx = indexClip(root, 'Reach');
    const holdIdx = indexClip(root, 'Hold');
    const channelKeys = new Set([...idleIdx.keys(), ...reachIdx.keys(), ...holdIdx.keys()]);
    expect(channelKeys.size).toBe(1);

    const pIdle = samplePose(idleIdx, 0);
    const pHold = samplePose(holdIdx, 0);
    const timeline: TimelineRow[] = [
      [0, (k) => poseValue(pIdle, k, pHold)],
      [1, (k) => poseValue(pHold, k, pIdle)],
    ];
    const { animation, authored, times } = bakeClip(doc, {
      clipName: 'Test_Clip',
      channelKeys,
      timeline,
      donorFor: (key) => holdIdx.get(key) ?? idleIdx.get(key),
    });
    expect(authored).toBe(1);
    expect([...times]).toEqual([0, 1]);
    expect(root.listAnimations().map((a) => a.getName())).toContain('Test_Clip');
    // 4 animations exist pre-strip: Idle, Reach, Hold (donors) + Test_Clip.
    expect(root.listAnimations()).toHaveLength(4);

    stripToAnimationsOnly(doc, [animation]);
    expect(root.listAnimations()).toEqual([animation]);
    expect(root.listMeshes()).toEqual([]);
    expect(root.listSkins()).toEqual([]);
    // the node hierarchy the kept animation targets survives stripping.
    expect(root.listNodes().map((n) => n.getName())).toEqual(
      expect.arrayContaining(['root', 'arm.r']),
    );
  });

  it('throws when no timeline row authors a value for any channel', () => {
    const { doc } = buildSyntheticRigDocument();
    const root = doc.getRoot();
    const idx = indexClip(root, 'Idle');
    expect(() =>
      bakeClip(doc, {
        clipName: 'Empty',
        channelKeys: idx.keys(),
        timeline: [[0, () => null]],
        donorFor: (key) => idx.get(key),
      }),
    ).toThrow(/no channels authored/);
  });
});
