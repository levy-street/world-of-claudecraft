import { readFileSync } from 'node:fs';
import { type Animation, type Node, NodeIO, type Root } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';

const FILE = new URL('../public/models/creatures/druid_cat_form.glb', import.meta.url);
const CLIPS = [
  'Attack_Left',
  'Attack_Right',
  'Bite',
  'Death',
  'Fall',
  'Finisher',
  'Hit_Left',
  'Idle_Look',
  'Jump',
  'Land',
  'Pounce',
  'ProwlIdle',
  'ProwlWalk',
  'Run',
  'Swim',
  'Walk',
  'WalkBack',
];
const LOOPS = ['Idle_Look', 'Walk', 'WalkBack', 'Run', 'ProwlIdle', 'ProwlWalk', 'Fall', 'Swim'];
let root: Root;
const clip = (name: string) => root.listAnimations().find((a) => a.getName() === name)!;
const duration = (a: Animation) =>
  Math.max(
    ...a.listSamplers().map((s) => {
      const input = s.getInput()!;
      return input.getScalar(input.getCount() - 1);
    }),
  );

/** Read normalized accessors, including meshopt's signed-short quaternions.
 *  Sampling raw getArray() values would hide broken rotation playback. */
function matricesAt(a: Animation, time: number): Map<Node, Matrix4> {
  const trs = new Map(
    root.listNodes().map((n) => [
      n,
      {
        translation: [...n.getTranslation()],
        rotation: [...n.getRotation()],
        scale: [...n.getScale()],
      },
    ]),
  );
  for (const channel of a.listChannels()) {
    const node = channel.getTargetNode()!;
    const path = channel.getTargetPath()!;
    if (path === 'weights') throw new Error('Unexpected morph channel');
    const sampler = channel.getSampler()!;
    const input = sampler.getInput()!;
    const output = sampler.getOutput()!;
    let right = 0;
    while (right < input.getCount() - 1 && input.getScalar(right) < time) right++;
    const left = Math.max(0, right - 1);
    const t0 = input.getScalar(left),
      t1 = input.getScalar(right);
    const u = t0 === t1 ? 0 : Math.max(0, Math.min(1, (time - t0) / (t1 - t0)));
    const v0 = output.getElement(left, []),
      v1 = output.getElement(right, []);
    trs.get(node)![path] =
      path === 'rotation'
        ? new Quaternion().fromArray(v0).slerp(new Quaternion().fromArray(v1), u).toArray()
        : v0.map((v, i) => v + (v1[i] - v) * u);
  }
  const result = new Map<Node, Matrix4>();
  const visit = (n: Node): Matrix4 => {
    const hit = result.get(n);
    if (hit) return hit;
    const p = trs.get(n)!;
    const m = new Matrix4().compose(
      new Vector3().fromArray(p.translation),
      new Quaternion().fromArray(p.rotation),
      new Vector3().fromArray(p.scale),
    );
    const parent = n.getParentNode();
    if (parent) m.premultiply(visit(parent));
    result.set(n, m);
    return m;
  };
  for (const n of root.listNodes()) visit(n);
  return result;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  root = (
    await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .read(FILE.pathname)
  ).getRoot();
});

function skinnedBounds(a: Animation, time: number): Box3 {
  const skin = root.listSkins()[0];
  const poses = matricesAt(a, time);
  const inverse = skin.getInverseBindMatrices()!;
  const matrices = skin.listJoints().map((joint, i) =>
    poses
      .get(joint)!
      .clone()
      .multiply(new Matrix4().fromArray(inverse.getElement(i, []))),
  );
  const primitive = root.listMeshes()[0].listPrimitives()[0];
  const position = primitive.getAttribute('POSITION')!;
  const weights = primitive.getAttribute('WEIGHTS_0')!;
  const indices = primitive.getAttribute('JOINTS_0')!;
  const bounds = new Box3();
  for (let i = 0; i < position.getCount(); i++) {
    const vertex = new Vector3().fromArray(position.getElement(i, []));
    const w = weights.getElement(i, []),
      j = indices.getElement(i, []);
    const posed = new Vector3();
    for (let k = 0; k < 4; k++)
      posed.addScaledVector(vertex.clone().applyMatrix4(matrices[j[k]]), w[k]);
    expect(posed.toArray().every(Number.isFinite)).toBe(true);
    bounds.expandByPoint(posed);
  }
  return bounds;
}

describe('druid cat shipping animation asset', () => {
  it('ships the complete vocabulary with bounded, valid deformation and GPU-compressed texture', () => {
    expect(root.listAnimations().map((a) => a.getName())).toEqual(CLIPS);
    expect(root.listSkins()).toHaveLength(1);
    const joints = root.listSkins()[0].listJoints();
    expect(joints).toHaveLength(49);
    expect(joints.every((n) => n.getName().startsWith('DEF-'))).toBe(true);
    // Parent shear caused the original seated-pose export mismatch.
    expect(new Set(joints.map((n) => n.getParentNode()?.getName()))).toEqual(
      new Set(['DruidCat_Rig']),
    );
    const inverse = root.listSkins()[0].getInverseBindMatrices()!;
    expect(inverse.getCount()).toBe(joints.length);
    for (let i = 0; i < inverse.getCount(); i++) {
      const values = inverse.getElement(i, []);
      expect(values.every(Number.isFinite)).toBe(true);
      expect(Math.abs(new Matrix4().fromArray(values).determinant())).toBeGreaterThan(0.01);
    }
    expect(root.listMeshes()).toHaveLength(1);
    const primitives = root.listMeshes()[0].listPrimitives();
    expect(primitives).toHaveLength(1);
    const primitive = primitives[0];
    expect(primitive.getIndices()!.getCount() / 3).toBe(6684);
    expect(primitive.getAttribute('POSITION')!.getCount()).toBe(6771);
    const weights = primitive.getAttribute('WEIGHTS_0')!;
    const indices = primitive.getAttribute('JOINTS_0')!;
    expect(weights.getElementSize()).toBe(4);
    expect(primitive.getAttribute('WEIGHTS_1')).toBeNull();
    for (let i = 0; i < weights.getCount(); i++) {
      const w = weights.getElement(i, []);
      expect(w.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
      expect(indices.getElement(i, []).every((v) => v >= 0 && v < joints.length)).toBe(true);
    }
    expect(root.listTextures().length).toBeGreaterThan(0);
    expect(root.listTextures().every((t) => t.getMimeType() === 'image/ktx2')).toBe(true);
    expect(root.listExtensionsUsed().map((e) => e.extensionName)).toContain(
      'EXT_meshopt_compression',
    );
    // The atlas is ETC1S on purpose, a deliberate exception to the Tripo
    // baseColor rule in scripts/assets/compress_glb_textures.mjs (the cat's
    // material is tripo_mat_..., so a resweep through that script would route it
    // back to UASTC: 1.19 MB for the atlas alone). The owning encode step is
    // scripts/assets/druid_cat/encode_ktx2.mjs, and this 1 MB ceiling is the pin
    // that catches the re-route: the shipped file is 888 KB, a UASTC re-encode
    // lands near 1.9 MB.
    expect(readFileSync(FILE).byteLength).toBeLessThan(1024 * 1024);
  });

  it('deforms the actual skin into grounded seated and collapsed poses', () => {
    const standing = skinnedBounds(clip('Idle_Look'), 0);
    expect(standing.min.y).toBeGreaterThan(-0.001);
    expect(standing.max.y).toBeCloseTo(0.6372, 2);
    for (const [name, t] of [
      ['Run', 0],
      ['Death', 1.2],
    ] as const) {
      const bounds = skinnedBounds(clip(name), t);
      expect(bounds.min.y, name).toBeGreaterThan(-0.002);
      expect(bounds.min.y, name).toBeLessThan(0.015);
      expect(bounds.getSize(new Vector3()).length(), name).toBeGreaterThan(0.6);
      if (name === 'Death') expect(bounds.max.y).toBeLessThan(0.35);
    }
    // The longer run cycle has a deliberate airborne suspension phase.
    expect(skinnedBounds(clip('Run'), 0.2).min.y).toBeGreaterThan(0.02);
  });

  it('crouches the stalk: prowl clips carry the hips well below the stand with the paws planted', () => {
    const skin = root.listSkins()[0];
    const hips = skin.listJoints().find((node) => node.getName() === 'DEF-spine')!;
    const hipsY = (name: string, t: number) => matricesAt(clip(name), t).get(hips)!.elements[13];
    const standHips = hipsY('Idle_Look', 0);
    expect(standHips).toBeGreaterThan(0.1);
    for (let i = 0; i <= 8; i++) {
      const idleT = (duration(clip('ProwlIdle')) * i) / 8;
      const walkT = (duration(clip('ProwlWalk')) * i) / 8;
      // A visible crouch: the pelvis drops by at least a third of its standing
      // height (the kernel's PROWL_CROUCH lands it near half), for the whole loop.
      expect(hipsY('ProwlIdle', idleT), `ProwlIdle hips at ${i}/8`).toBeLessThan(standHips * 0.67);
      // The moving stalk keeps a wider stance for the step, so it pins against
      // the plain Walk at the same phase: the pelvis rides at least a tenth
      // lower and the back and head at least a tenth lower (the un-crouched
      // v2 export had both ratios at 1.0).
      expect(hipsY('ProwlWalk', walkT), `ProwlWalk hips at ${i}/8`).toBeLessThan(
        hipsY('Walk', (duration(clip('Walk')) * i) / 8) * 0.9,
      );
      expect(skinnedBounds(clip('ProwlWalk'), walkT).max.y, `ProwlWalk top at ${i}/8`).toBeLessThan(
        skinnedBounds(clip('Walk'), (duration(clip('Walk')) * i) / 8).max.y * 0.9,
      );
      // The drop goes through the paw IK, so nothing sinks under the ground plane.
      expect(
        skinnedBounds(clip('ProwlIdle'), idleT).min.y,
        `ProwlIdle floor at ${i}/8`,
      ).toBeGreaterThan(-0.012);
      expect(
        skinnedBounds(clip('ProwlWalk'), walkT).min.y,
        `ProwlWalk floor at ${i}/8`,
      ).toBeGreaterThan(-0.012);
    }
  });

  it('keeps standing idle legs in the original bind pose and restores attack endpoints', () => {
    const skin = root.listSkins()[0];
    // The exporter writes the original rest transforms as node defaults.
    // Inverse bind matrices also include meshopt's vertex dequantization.
    const legBones = skin
      .listJoints()
      .map((node) => ({
        node,
        rest: new Matrix4().fromArray(node.getWorldMatrix()),
      }))
      .filter(({ node }) => /^DEF-(front_)?(thigh|shin|foot|toe)\./.test(node.getName()));
    expect(legBones.length).toBeGreaterThan(12);
    // ProwlIdle is the one standing idle that leaves the bind stance: the
    // stalk crouch folds every leg (pinned below), so it is excluded here.
    for (const name of ['Idle_Look']) {
      for (let i = 0; i <= 12; i++) {
        const posed = matricesAt(clip(name), (duration(clip(name)) * i) / 12);
        for (const { node, rest } of legBones) {
          expect(
            Math.max(...rest.elements.map((v, j) => Math.abs(v - posed.get(node)!.elements[j]))),
            `${name} ${node.getName()}`,
          ).toBeLessThan(0.0005);
        }
      }
    }
    for (const name of [
      'Attack_Left',
      'Attack_Right',
      'Bite',
      'Finisher',
      'Pounce',
      'Hit_Left',
      'Land',
    ]) {
      const posed = matricesAt(clip(name), duration(clip(name)));
      for (const { node, rest } of legBones) {
        expect(
          Math.max(...rest.elements.map((v, j) => Math.abs(v - posed.get(node)!.elements[j]))),
          name,
        ).toBeLessThan(0.0005);
      }
    }
  });

  it('contains distinct moving attacks, reactions and recoveries instead of static clip placeholders', () => {
    const delta = (a: Map<Node, Matrix4>, b: Map<Node, Matrix4>) =>
      Math.max(
        ...[...a].flatMap(([n, m]) =>
          m.elements.map((v, i) => Math.abs(v - b.get(n)!.elements[i])),
        ),
      );
    for (const name of [
      'Attack_Left',
      'Attack_Right',
      'Bite',
      'Finisher',
      'Hit_Left',
      'Death',
      'Pounce',
    ]) {
      const a = clip(name),
        initial = matricesAt(a, 0);
      const motion = Math.max(
        ...[0.2, 0.4, 0.6, 0.8, 1].map((t) => delta(initial, matricesAt(a, duration(a) * t))),
      );
      expect(motion, name).toBeGreaterThan(0.05);
    }
    expect(
      delta(matricesAt(clip('Attack_Left'), 0.23), matricesAt(clip('Attack_Right'), 0.23)),
    ).toBeGreaterThan(0.1);
    expect(
      delta(matricesAt(clip('Bite'), 0.25), matricesAt(clip('Finisher'), 0.25)),
    ).toBeGreaterThan(0.1);
    // No coordinated bone translation may smuggle a jump arc into the flat rig.
    const pelvis = root.listNodes().find((n) => n.getName() === 'DEF-spine.004')!;
    for (const name of ['Walk', 'WalkBack', 'Run', 'ProwlWalk', 'Jump']) {
      const a = clip(name),
        origin = new Vector3().setFromMatrixPosition(matricesAt(a, 0).get(pelvis)!);
      for (let i = 0; i <= 12; i++) {
        const p = new Vector3().setFromMatrixPosition(
          matricesAt(a, (duration(a) * i) / 12).get(pelvis)!,
        );
        expect(Math.hypot(p.x - origin.x, p.z - origin.z), name).toBeLessThan(0.04);
        // The v13/v14 gallop raises the whole body over planted legs with high
        // hindquarters (the pelvis peaks about 0.15 above its frame-0 height, a
        // quarter of the raw body); a smuggled jump arc would clear the whole
        // body height, so Run alone gets the wider cap.
        expect(Math.abs(p.y - origin.y), name).toBeLessThan(name === 'Run' ? 0.2 : 0.08);
      }
    }
  });

  it('has finite, normalized channels, positive durations and no animated scene root', () => {
    for (const a of root.listAnimations()) {
      expect(duration(a), a.getName()).toBeGreaterThan(0.3);
      for (const c of a.listChannels()) {
        expect(c.getTargetNode()!.getName()).toMatch(/^DEF-/);
        const sampler = c.getSampler()!;
        expect(sampler.getInterpolation()).toBe('LINEAR');
        const input = sampler.getInput()!,
          output = sampler.getOutput()!;
        expect(input.getScalar(0)).toBe(0);
        for (let i = 0; i < input.getCount(); i++) {
          if (i) expect(input.getScalar(i)).toBeGreaterThan(input.getScalar(i - 1));
          const v = output.getElement(i, []);
          expect(v.every(Number.isFinite), a.getName()).toBe(true);
          if (c.getTargetPath() === 'rotation') expect(Math.hypot(...v)).toBeCloseTo(1, 3);
        }
      }
    }
  });

  it('closes every loop and holds the airborne pose through the landing boundary', () => {
    const maxGap = (a: Map<Node, Matrix4>, b: Map<Node, Matrix4>) =>
      Math.max(
        ...[...a].flatMap(([n, m]) =>
          m.elements.map((v, i) => Math.abs(v - b.get(n)!.elements[i])),
        ),
      );
    for (const name of LOOPS) {
      const a = clip(name);
      expect(maxGap(matricesAt(a, 0), matricesAt(a, duration(a))), name).toBeLessThan(0.0005);
    }
    const held = matricesAt(clip('Jump'), 0.4);
    expect(maxGap(held, matricesAt(clip('Jump'), 11 / 30))).toBeLessThan(0.0005);
    expect(maxGap(held, matricesAt(clip('Land'), 0))).toBeLessThan(0.0005);
    expect(maxGap(held, matricesAt(clip('Fall'), 0.5))).toBeLessThan(0.0005);
  });

  it.each([
    ['Walk', 27, 0.48, [0, 0.5, 0.75, 0.25], 2.78992],
    ['WalkBack', 30, 0.25, [0, 0.5, 0.75, 0.25], 4.82101],
    ['Run', 18, 0.22, [0.48, 0.54, 0, 0.06], 9.13075],
    ['ProwlWalk', 30, 0.22, [0, 0.5, 0.5, 0], 5.47846],
  ] as const)(
    '%s matches measured paw contact speed without vertical skating',
    (name, frames, duty, shifts, ref) => {
      const a = clip(name),
        scale = 1.92 / 0.63720703125;
      const samples = Array.from({ length: frames + 1 }, (_, i) => matricesAt(a, i / 30));
      let checked = 0;
      for (const [index, boneName] of [
        'DEF-front_toe.L',
        'DEF-front_toe.R',
        'DEF-toe.L',
        'DEF-toe.R',
      ].entries()) {
        const n = root.listNodes().find((n) => n.getName() === boneName)!;
        for (let i = 0; i < frames; i++) {
          const u = (i / frames + shifts[index]) % 1,
            v = ((i + 1) / frames + shifts[index]) % 1;
          if (!(u > 0.00001 && u < v && v < duty - 0.00001)) continue;
          const p0 = new Vector3().setFromMatrixPosition(samples[i].get(n)!);
          const p1 = new Vector3().setFromMatrixPosition(samples[i + 1].get(n)!);
          expect(Math.abs(p0.y - (index < 2 ? 0.043 : 0.044))).toBeLessThan(0.002);
          expect(Math.abs(p1.y - p0.y) * scale).toBeLessThan(0.002);
          const direction = name === 'WalkBack' ? 1 : -1;
          expect(Math.abs((p1.z - p0.z) * direction * 30 * scale - ref)).toBeLessThan(0.035);
          checked++;
        }
      }
      expect(checked).toBeGreaterThanOrEqual(7);
      expect(VISUALS.form_cat.height).toBe(1.92);
      const actualRef =
        name === 'Walk'
          ? VISUALS.form_cat.walkRef
          : name === 'WalkBack'
            ? VISUALS.form_cat.walkBackRef
            : name === 'Run'
              ? VISUALS.form_cat.runRef
              : VISUALS.form_cat.prowlRef;
      expect(actualRef).toBe(ref);
    },
  );
});
