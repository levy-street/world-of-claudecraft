// The animation library's size step (scripts/assets/woc_character/anim_timeline.mjs): every
// clip keeps every frame on ONE shared time accessor (constant channels on a shared two-key
// one), rotations sampled by slerp and kept sign-continuous, STEP channels held to the frame,
// old accessors disposed; the frame grid's float32 duration edge; the encoder precision
// wrapper; and the JSON members it drops (defaults only).
import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import {
  animEncoder,
  evaluateSampler,
  frameGrid,
  leanAnimJson,
  uniformTimeline,
} from '../scripts/assets/woc_character/anim_timeline.mjs';

const halfSqrt = Math.SQRT1_2;

/** One clip on two nodes: two rotation channels on different key times (one crossing the
 *  quaternion double cover), a constant translation and a STEP translation. */
function sampleDoc(): { doc: Document; inputs: unknown[]; outputs: unknown[] } {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const a = doc.createNode('a');
  const b = doc.createNode('b');
  doc.createScene().addChild(a).addChild(b);
  const acc = (type: 'SCALAR' | 'VEC3' | 'VEC4', values: number[]) =>
    doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
  const inputs = [
    acc('SCALAR', [0, 0.5, 1]),
    acc('SCALAR', [0, 1]),
    acc('SCALAR', [0, 0.25, 1]),
    acc('SCALAR', [0, 0.6]),
  ];
  const outputs = [
    // identity, 90 degrees about Y, then 180 degrees written as the NEGATED quaternion
    acc('VEC4', [0, 0, 0, 1, 0, halfSqrt, 0, halfSqrt, 0, -1, 0, 0]),
    acc('VEC4', [0, 0, 0, 1, halfSqrt, 0, 0, halfSqrt]),
    acc('VEC3', [1, 2, 3, 1, 2, 3, 1, 2, 3]),
    acc('VEC3', [0, 0, 0, 1, 0, 0]),
  ];
  const anim = doc.createAnimation('clip');
  const targets: [ReturnType<typeof doc.createNode>, 'rotation' | 'translation'][] = [
    [a, 'rotation'],
    [b, 'rotation'],
    [a, 'translation'],
    [b, 'translation'],
  ];
  targets.forEach(([node, path], i) => {
    const sampler = doc
      .createAnimationSampler()
      .setInput(inputs[i])
      .setOutput(outputs[i])
      .setInterpolation(i === 3 ? 'STEP' : 'LINEAR');
    anim.addSampler(sampler);
    anim.addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
    );
  });
  return { doc, inputs, outputs };
}

describe('woc animation timeline step', () => {
  it('builds a frame grid that ends exactly on the clip, float32 durations included', () => {
    const grid = frameGrid(1, 4);
    expect([...grid]).toEqual([0, 0.25, 0.5, 0.75, 1]);
    // 1.6 stored as float32 reads 1.6000000238: still 96 intervals at 60 fps, not 97
    const f32 = Math.fround(1.6);
    const long = frameGrid(f32, 60);
    expect(long.length).toBe(97);
    expect(long[96]).toBe(Math.fround(f32));
    // a zero-length clip still has a first and a last key
    expect(frameGrid(0, 60).length).toBe(2);
  });

  it('samples every channel of a clip onto one shared timeline and keeps the motion', async () => {
    const { doc, inputs, outputs } = sampleDoc();
    // the reference: every original channel evaluated on the same grid, before the step
    const grid = frameGrid(1, 4);
    const expected = doc
      .getRoot()
      .listAnimations()[0]
      .listSamplers()
      .map((s) => {
        const n = s.getOutput()?.getElementSize() ?? 0;
        const out = new Float32Array(grid.length * n);
        for (let i = 0; i < grid.length; i++) {
          evaluateSampler(
            s.getInput()?.getArray() ?? [],
            s.getOutput()?.getArray() ?? [],
            n,
            s.getInterpolation(),
            n === 4,
            grid[i],
            out,
            i * n,
          );
        }
        return out;
      });
    await doc.transform(uniformTimeline({ fps: 4 }));

    const samplers = doc.getRoot().listAnimations()[0].listSamplers();
    const [rotA, rotB, constant, step] = samplers;
    // the moving channels share ONE input, the grid
    expect(rotA.getInput()).toBe(rotB.getInput());
    expect(rotA.getInput()).toBe(step.getInput());
    expect([...(rotA.getInput()?.getArray() ?? [])]).toEqual([...grid]);
    // the constant channel rides a shared two-key input holding its one value
    expect(constant.getInput()).not.toBe(rotA.getInput());
    expect([...(constant.getInput()?.getArray() ?? [])]).toEqual([0, 1]);
    expect([...(constant.getOutput()?.getArray() ?? [])]).toEqual([1, 2, 3, 1, 2, 3]);
    for (const s of samplers) expect(s.getInterpolation()).toBe('LINEAR');

    // every moving channel holds exactly its old curve at every frame (rotations up to sign)
    [rotA, rotB, step].forEach((s, k) => {
      const want = expected[[0, 1, 3][k]];
      const got = s.getOutput()?.getArray() ?? [];
      const n = s.getOutput()?.getElementSize() ?? 0;
      for (let i = 0; i < grid.length; i++) {
        let dot = 0;
        for (let c = 0; c < n; c++) dot += want[i * n + c] * got[i * n + c];
        const sign = n === 4 && dot < 0 ? -1 : 1;
        for (let c = 0; c < n; c++) {
          expect(got[i * n + c]).toBeCloseTo(sign * want[i * n + c], 6);
        }
      }
    });
    // the STEP channel holds its first value until its second key's frame
    expect([...(step.getOutput()?.getArray() ?? [])].filter((_, i) => i % 3 === 0)).toEqual([
      0, 0, 0, 1, 1,
    ]);
    // rotations stay sign-continuous across the double cover the source crossed
    const q = rotA.getOutput()?.getArray() ?? [];
    for (let i = 1; i < grid.length; i++) {
      let dot = 0;
      for (let c = 0; c < 4; c++) dot += q[(i - 1) * 4 + c] * q[i * 4 + c];
      expect(dot).toBeGreaterThanOrEqual(0);
    }
    // the old accessors are gone
    const live = new Set(doc.getRoot().listAccessors());
    for (const old of [...inputs, ...outputs]) expect(live.has(old as never)).toBe(false);
  });

  it('wraps the meshopt encoder with the chosen filter precision', () => {
    const calls: unknown[][] = [];
    const base = {
      encodeFilterQuat: (...args: unknown[]) => {
        calls.push(['quat', ...args]);
        return new Uint8Array(0);
      },
      encodeFilterExp: (...args: unknown[]) => {
        calls.push(['exp', ...args]);
        return new Uint8Array(0);
      },
    };
    const encoder = animEncoder(base, 13, 16) as typeof base;
    const src = new Float32Array(8);
    encoder.encodeFilterQuat(src, 2, 16, 16);
    encoder.encodeFilterExp(src, 2, 12, 12, 'SharedComponent');
    expect(calls).toEqual([
      ['quat', src, 2, 16, 13],
      ['exp', src, 2, 12, 16, 'SharedComponent'],
    ]);
  });

  it('drops only the JSON members that restate a glTF default', () => {
    const json = {
      accessors: [
        { normalized: false, byteOffset: 0, count: 2 },
        { normalized: true, byteOffset: 8, count: 2 },
      ],
      bufferViews: [{ byteOffset: 0 }, { byteOffset: 16 }],
      animations: [{ samplers: [{ interpolation: 'LINEAR' }, { interpolation: 'STEP' }] }],
    };
    expect(leanAnimJson(json)).toBe(json);
    expect(json.accessors).toEqual([{ count: 2 }, { normalized: true, byteOffset: 8, count: 2 }]);
    expect(json.bufferViews).toEqual([{}, { byteOffset: 16 }]);
    expect(json.animations[0].samplers).toEqual([{}, { interpolation: 'STEP' }]);
  });
});
