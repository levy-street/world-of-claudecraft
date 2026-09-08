// Native shield performance with offline leg IK. No runtime solver or root motion.
// node scripts/build_warrior_contact_anims.mjs [--preview]
import { mkdir, writeFile } from 'node:fs/promises';
import { dedup, prune } from '@gltf-transform/functions';
import { Object3D, Quaternion, Vector3 } from 'three';
import {
  bakeClip,
  blendValue,
  createGlbIO,
  indexClip,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const io = await createGlbIO();
const doc = await io.read('public/models/chars/players/knight.glb');
const root = doc.getRoot();
const donors = ['Idle', 'Shield_Bash'].map((name) => indexClip(root, name));
for (const donor of donors) {
  for (const channel of donor.values()) {
    if (channel.path !== 'rotation') continue;
    const values = new Float32Array(channel.values.length);
    for (let i = 0; i < values.length; i += 4) {
      const norm = Math.hypot(...channel.values.slice(i, i + 4));
      if (!(norm > 0)) throw new Error('Invalid native quaternion');
      for (let c = 0; c < 4; c++) values[i + c] = channel.values[i + c] / norm;
    }
    channel.values = values;
  }
}
const keys = [...new Set(donors.flatMap((donor) => [...donor.keys()]))];
const idle = samplePose(donors[0], 0.3);
const rig = new Object3D();
const objects = new Map(root.listNodes().map((node) => [node, new Object3D()]));
const bones = new Map();
for (const [node, object] of objects) {
  object.name = node.getName();
  object.position.fromArray(node.getTranslation());
  object.quaternion.fromArray(node.getRotation()).normalize();
  object.scale.fromArray(node.getScale());
  (objects.get(node.getParentNode()) ?? rig).add(object);
  bones.set(object.name, object);
}
function applyPose(pose) {
  for (const [key, value] of pose) {
    const [name, path] = key.split('|');
    const bone = bones.get(name);
    if (path === 'translation') bone.position.fromArray(value);
    if (path === 'rotation') bone.quaternion.fromArray(value).normalize();
    if (path === 'scale') bone.scale.fromArray(value);
  }
  rig.updateMatrixWorld(true);
}
const position = (bone) => bone.getWorldPosition(new Vector3());
const orientation = (bone) => bone.getWorldQuaternion(new Quaternion());
applyPose(idle);
const legs = ['l', 'r'].map((side) => {
  const upper = bones.get(`upperleg.${side}`);
  const lower = bones.get(`lowerleg.${side}`);
  const foot = bones.get(`foot.${side}`);
  const hip = position(upper),
    knee = position(lower),
    ankle = position(foot);
  const axis = ankle.clone().sub(hip).normalize();
  const bend = knee
    .clone()
    .sub(hip)
    .addScaledVector(axis, -knee.clone().sub(hip).dot(axis))
    .normalize();
  return {
    upper,
    lower,
    foot,
    ankle,
    bend,
    rotation: orientation(foot),
    a: hip.distanceTo(knee),
    b: knee.distanceTo(ankle),
  };
});
function setWorldRotation(bone, rotation) {
  bone.quaternion.copy(orientation(bone.parent).invert().multiply(rotation)).normalize();
  rig.updateMatrixWorld(true);
}
function pointJoint(bone, child, target) {
  const origin = position(bone);
  const from = position(child).sub(origin).normalize();
  const to = target.clone().sub(origin).normalize();
  setWorldRotation(bone, new Quaternion().setFromUnitVectors(from, to).multiply(orientation(bone)));
}
let maxFootError = 0;
function plantFeet(pose) {
  applyPose(pose);
  for (const leg of legs) {
    const hip = position(leg.upper);
    const axis = leg.ankle.clone().sub(hip);
    const distance = axis.length();
    if (distance >= leg.a + leg.b || distance <= Math.abs(leg.a - leg.b))
      throw new Error('Authored hip pose puts planted foot outside native leg reach');
    axis.normalize();
    const along = (leg.a ** 2 - leg.b ** 2 + distance ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, leg.a ** 2 - along ** 2));
    const bend = leg.bend.clone().addScaledVector(axis, -leg.bend.dot(axis)).normalize();
    const knee = hip.clone().addScaledVector(axis, along).addScaledVector(bend, height);
    pointJoint(leg.upper, leg.lower, knee);
    pointJoint(leg.lower, leg.foot, leg.ankle);
    setWorldRotation(leg.foot, leg.rotation);
    maxFootError = Math.max(maxFootError, position(leg.foot).distanceTo(leg.ankle));
    for (const bone of [leg.upper, leg.lower, leg.foot])
      pose.set(`${bone.name}|rotation`, bone.quaternion.toArray());
  }
  return pose;
}
function shieldPose(time, hipOffset) {
  const source = samplePose(donors[1], time);
  const pose = new Map(keys.map((key) => [key, [...(source.get(key) ?? idle.get(key))]]));
  // The donor supplies native arm/chest rotations, while root, sockets and leg
  // translations retain the rest dimensions. The hips transfer weight into contact.
  for (const key of keys) if (!key.endsWith('|rotation')) pose.set(key, [...idle.get(key)]);
  pose.set(
    'hips|translation',
    idle.get('hips|translation').map((v, i) => v + hipOffset[i]),
  );
  return pose;
}
const guard = shieldPose(0, [0, -0.008, -0.01]);
const chamber = shieldPose(0.14, [0, -0.025, -0.035]);
const drive = shieldPose(0.32, [0, -0.008, 0.045]);
const recoil = shieldPose(0.5, [0, -0.012, 0.015]);
const beats = [
  [0, idle],
  [0.045, guard],
  [0.085, chamber],
  [0.15, drive],
  [0.18, drive],
  [0.275, recoil],
  [0.44, guard],
  [0.68, idle],
];
const first = plantFeet(new Map([...idle].map(([key, value]) => [key, [...value]])));
const timeline = [[0, (key) => first.get(key)]];
for (let b = 1; b < beats.length; b++) {
  const [start, from] = beats[b - 1],
    [end, to] = beats[b];
  // Dense offline sampling preserves the foot lock between exported keys too.
  const steps = Math.max(2, Math.ceil((end - start) * 180));
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const weight = b === 3 ? t * t : t * t * (3 - 2 * t);
    const pose = plantFeet(
      new Map(keys.map((key) => [key, blendValue(key, from.get(key), to.get(key), weight)])),
    );
    timeline.push([start + (end - start) * t, (key) => pose.get(key)]);
  }
}
if (!Number.isFinite(maxFootError) || maxFootError > 1e-5)
  throw new Error(`Foot lock error ${maxFootError}`);
const clip = bakeClip(doc, {
  clipName: 'Warrior_Shieldcrack',
  channelKeys: keys,
  timeline,
  donorFor: (key) => donors.find((donor) => donor.has(key))?.get(key),
}).animation;
await mkdir('tmp/warrior-contact-authoring', { recursive: true });
if (process.argv.includes('--preview'))
  await io.write('tmp/warrior-contact-authoring/knight_contact_preview.glb', doc);
stripToAnimationsOnly(doc, [clip]);
await doc.transform(prune(), dedup());
const output = 'public/models/chars/players/warrior_contact_anims.glb';
await io.write(output, doc);
const report = {
  output,
  clip: clip.getName(),
  frames: timeline.length,
  channels: keys.length,
  maxFootError,
};
await writeFile(
  'tmp/warrior-contact-authoring/report.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report));
