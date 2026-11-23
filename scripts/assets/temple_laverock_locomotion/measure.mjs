// Measure shipped FK, including the model's actual skinned Idle bounds.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as T from 'three';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

export async function readRig(path) {
  const document = await io.read(path);
  const group = new T.Group();
  const objects = new Map();
  for (const node of document.getRoot().listNodes()) {
    const object = new T.Object3D();
    object.name = node.getName();
    object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation());
    object.scale.fromArray(node.getScale());
    objects.set(node, object);
  }
  for (const [node, object] of objects) {
    for (const child of node.listChildren()) object.add(objects.get(child));
  }
  for (const object of objects.values()) if (!object.parent) group.add(object);
  return { document, group, objects };
}

export function player(rig, animation) {
  const tracks = animation.listChannels().map((channel) => {
    const sampler = channel.getSampler();
    if (!['LINEAR', 'STEP'].includes(sampler.getInterpolation()))
      throw new Error('Nonlinear baked sampler');
    const path = channel.getTargetPath();
    const name = channel.getTargetNode().getName();
    const Track = path === 'rotation' ? T.QuaternionKeyframeTrack : T.VectorKeyframeTrack;
    return new Track(
      name + '.' + { rotation: 'quaternion', translation: 'position', scale: 'scale' }[path],
      sampler.getInput().getArray(),
      Array.from(sampler.getOutput().getArray(), (_, i) => component(sampler.getOutput(), i)),
      sampler.getInterpolation() === 'STEP' ? T.InterpolateDiscrete : T.InterpolateLinear,
    );
  });
  const mixer = new T.AnimationMixer(rig.group);
  const clip = new T.AnimationClip(animation.getName(), -1, tracks);
  const action = mixer.clipAction(clip).setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  return (time) => {
    mixer.setTime(time);
    rig.group.updateMatrixWorld(true);
  };
}

function component(accessor, index) {
  const array = accessor.getArray();
  const value = array[index];
  if (!accessor.getNormalized()) return value;
  if (array instanceof Uint16Array) return value / 65535;
  if (array instanceof Uint8Array) return value / 255;
  if (array instanceof Int16Array) return Math.max(-1, value / 32767);
  if (array instanceof Int8Array) return Math.max(-1, value / 127);
  return value;
}

export function normalizedScale(rig) {
  const idle = rig.document
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === 'Idle');
  // Match prepareVisual's mid-idle sample using the same Three.js interpolation.
  const duration = Math.max(...idle.listSamplers().map((s) => s.getInput().getMax([])[0]));
  player(rig, idle)(Math.min(0.5, duration * 0.5));
  const bounds = new T.Box3();
  for (const [node, object] of rig.objects) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    if (!skin) continue;
    const joints = skin?.listJoints();
    const inverses = skin?.getInverseBindMatrices()?.getArray();
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      const indices = primitive.getAttribute('JOINTS_0');
      const weights = primitive.getAttribute('WEIGHTS_0');
      for (let i = 0; i < positions.getCount(); i++) {
        const point = new T.Vector3(...[0, 1, 2].map((axis) => component(positions, i * 3 + axis)));
        const posed = new T.Vector3();
        if (skin && indices && weights) {
          for (let j = 0; j < 4; j++) {
            const joint = indices.getArray()[i * 4 + j];
            const matrix = new T.Matrix4().fromArray(inverses, joint * 16);
            matrix.premultiply(rig.objects.get(joints[joint]).matrixWorld);
            posed.addScaledVector(
              point.clone().applyMatrix4(matrix),
              component(weights, i * 4 + j),
            );
          }
        } else posed.copy(point).applyMatrix4(object.matrixWorld);
        bounds.expandByPoint(posed);
      }
    }
  }
  return 3.75 / (bounds.max.y - bounds.min.y);
}

export function contacts(rig, animation, scale, stance) {
  const sample = player(rig, animation);
  const duration = Math.max(...animation.listSamplers().map((s) => s.getInput().getMax([])[0]));
  const frames = [];
  for (let i = 0; i <= 120; i++) {
    sample((duration * i) / 120);
    const feet = ['L_Foot', 'R_Foot'].map((name) =>
      [...rig.objects]
        .find(([n]) => n.getName() === name)[1]
        .getWorldPosition(new T.Vector3())
        .multiplyScalar(scale),
    );
    frames.push(feet);
  }
  const velocities = [];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < 120; i++) {
      const phase = (i / 120 + side * 0.5) % 1;
      if (phase / stance < 0.15 || phase / stance > 0.7) continue;
      velocities.push((frames[i + 1][side].z - frames[i][side].z) / (duration / 120));
    }
  }
  return {
    duration,
    speed: Math.abs(velocities.reduce((a, b) => a + b, 0) / velocities.length),
    min: Math.min(...velocities),
    max: Math.max(...velocities),
    ankleMin: Math.min(...frames.flat().map((p) => p.y)),
    ankleMax: Math.max(...frames.flat().map((p) => p.y)),
    seam: Math.max(...frames[0].map((p, i) => p.distanceTo(frames[120][i]))),
  };
}

if (process.argv[1]?.endsWith('measure.mjs')) {
  const source = await readRig('public/models/creatures/temple_laverock.glb');
  const scale = normalizedScale(source);
  const bank = await readRig('public/models/creatures/temple_laverock_locomotion.glb');
  console.log(
    JSON.stringify(
      {
        scale,
        clips: bank.document
          .getRoot()
          .listAnimations()
          .map((a) => ({
            name: a.getName(),
            ...contacts(bank, a, scale, a.getName() === 'Run' ? 0.4 : 0.6),
          })),
      },
      null,
      2,
    ),
  );
}
