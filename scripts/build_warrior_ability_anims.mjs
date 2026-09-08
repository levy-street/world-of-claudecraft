// Native Heroic Leap: compact launch, tucked apex, downward commitment,
// planted landing at exactly .60 seconds and weighted recovery. Native bone
// poses are baked offline; simulation owns the .60-second world trajectory.
// node scripts/build_warrior_ability_anims.mjs [--preview]
import { mkdir } from 'node:fs/promises';
import { dedup, prune } from '@gltf-transform/functions';
import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import {
  bakeClip,
  blendValue,
  createGlbIO,
  indexClip,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';
import { bakeWarriorRush } from './anim/warrior_rush.mjs';

const io = createGlbIO();
const doc = await io.read('public/models/chars/players/knight.glb');
const root = doc.getRoot();
const contacts = await io.read('public/models/chars/players/warrior_contact_anims.glb');
const donors = [
  indexClip(root, 'Idle'),
  indexClip(root, 'Jump_Idle'),
  indexClip(contacts.getRoot(), 'Warrior_Furious_Mending'),
];
for (const donor of donors)
  for (const channel of donor.values()) {
    if (channel.path !== 'rotation') continue;
    const values = new Float32Array(channel.values.length);
    for (let i = 0; i < values.length; i += 4) {
      const length = Math.hypot(...channel.values.slice(i, i + 4));
      if (!(length > 0)) throw Error('Invalid native rotation');
      for (let c = 0; c < 4; c++) values[i + c] = channel.values[i + c] / length;
    }
    channel.values = values;
  }
const keys = [...new Set(donors.flatMap((d) => [...d.keys()]))];
const idle = samplePose(donors[0], 0.3),
  guard = samplePose(donors[2], 0.15);
const rig = new Object3D(),
  objects = new Map(root.listNodes().map((n) => [n, new Object3D()])),
  bones = new Map();
for (const [node, object] of objects) {
  object.name = node.getName();
  object.position.fromArray(node.getTranslation());
  object.quaternion.fromArray(node.getRotation()).normalize();
  object.scale.fromArray(node.getScale());
  (objects.get(node.getParentNode()) ?? rig).add(object);
  bones.set(object.name, object);
}
function apply(pose) {
  for (const [key, value] of pose) {
    const [name, path] = key.split('|'),
      b = bones.get(name);
    if (path === 'translation') b.position.fromArray(value);
    else if (path === 'rotation') b.quaternion.fromArray(value).normalize();
    else b.scale.fromArray(value);
  }
  rig.updateMatrixWorld(true);
}
const pos = (b) => b.getWorldPosition(new Vector3()),
  rot = (b) => b.getWorldQuaternion(new Quaternion());
function worldRotation(b, q) {
  b.quaternion.copy(b.parent.getWorldQuaternion(new Quaternion()).invert().multiply(q)).normalize();
  rig.updateMatrixWorld(true);
}
function pointJoint(b, child, target) {
  const origin = pos(b),
    from = pos(child).sub(origin).normalize(),
    to = target.clone().sub(origin).normalize();
  worldRotation(b, new Quaternion().setFromUnitVectors(from, to).multiply(rot(b)));
}
apply(idle);
const legs = ['l', 'r'].map((side) => {
  const upper = bones.get(`upperleg.${side}`),
    lower = bones.get(`lowerleg.${side}`),
    foot = bones.get(`foot.${side}`);
  const hip = pos(upper),
    knee = pos(lower),
    ankle = pos(foot),
    axis = ankle.clone().sub(hip).normalize();
  return {
    upper,
    lower,
    foot,
    ankle,
    rotation: rot(foot),
    a: hip.distanceTo(knee),
    b: knee.distanceTo(ankle),
    bend: knee.clone().sub(hip).addScaledVector(axis, -knee.clone().sub(hip).dot(axis)).normalize(),
  };
});
let maxFootError = 0;
function plant(pose) {
  apply(pose);
  for (const leg of legs) {
    const hip = pos(leg.upper),
      axis = leg.ankle.clone().sub(hip),
      distance = axis.length();
    if (distance >= leg.a + leg.b || distance <= Math.abs(leg.a - leg.b))
      throw Error('Unreachable landing foot');
    axis.normalize();
    const along = (leg.a ** 2 - leg.b ** 2 + distance ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, leg.a ** 2 - along ** 2));
    const bend = leg.bend.clone().addScaledVector(axis, -leg.bend.dot(axis)).normalize();
    const knee = hip.clone().addScaledVector(axis, along).addScaledVector(bend, height);
    pointJoint(leg.upper, leg.lower, knee);
    pointJoint(leg.lower, leg.foot, leg.ankle);
    worldRotation(leg.foot, leg.rotation);
    maxFootError = Math.max(maxFootError, pos(leg.foot).distanceTo(leg.ankle));
    for (const b of [leg.upper, leg.lower, leg.foot])
      pose.set(`${b.name}|rotation`, b.quaternion.toArray());
  }
  return pose;
}
function forwardLeftGrip(pose, amount) {
  apply(pose);
  const upper = bones.get('upperarm.l'),
    lower = bones.get('lowerarm.l'),
    wrist = bones.get('wrist.l');
  const shoulder = pos(upper),
    elbow = pos(lower),
    hand = pos(wrist),
    rotation = rot(wrist);
  const target = hand.clone().add(new Vector3(0, 0, amount));
  const a = shoulder.distanceTo(elbow),
    b = elbow.distanceTo(hand),
    axis = target.clone().sub(shoulder),
    distance = axis.length();
  if (distance >= a + b || distance <= Math.abs(a - b)) throw Error('Unreachable forward grip');
  axis.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance),
    height = Math.sqrt(Math.max(0, a * a - along * along));
  const bend = elbow.clone().sub(shoulder);
  bend.addScaledVector(axis, -bend.dot(axis)).normalize();
  pointJoint(
    upper,
    lower,
    shoulder.clone().addScaledVector(axis, along).addScaledVector(bend, height),
  );
  pointJoint(lower, wrist, target);
  worldRotation(wrist, rotation);
  for (const bone of [upper, lower, wrist])
    pose.set(`${bone.name}|rotation`, bone.quaternion.toArray());
  return pose;
}
function rotate(pose, name, x, y = 0, z = 0) {
  const key = `${name}|rotation`,
    q = new Quaternion().fromArray(pose.get(key));
  q.multiply(
    new Quaternion().setFromEuler(
      new Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180),
    ),
  ).normalize();
  pose.set(key, q.toArray());
}
function braced(drop, lean) {
  const pose = new Map(keys.map((key) => [key, [...(guard.get(key) ?? idle.get(key))]]));
  for (const key of keys)
    if (/^(root|hips|.*leg\.[lr]|foot\.[lr]|toes\.[lr])\|/.test(key) || !key.endsWith('|rotation'))
      pose.set(key, [...idle.get(key)]);
  pose.set(
    'hips|translation',
    idle.get('hips|translation').map((v, i) => v + (i === 1 ? -drop : i === 2 ? 0.035 : 0)),
  );
  rotate(pose, 'chest', lean);
  rotate(pose, 'head', -lean * 0.65);
  return plant(pose);
}
const coil = braced(0.055, 8),
  landing = braced(0.08, 16),
  recover = braced(0.04, 5);
const apex = samplePose(donors[1], 0.5);
// Keep the weapon-safe native upper guard while the rig's own jump supplies
// the airborne lower body. Added hip/knee folding tightens the jump silhouette.
for (const key of keys)
  if (
    /^(chest|spine|head|neck|upperarm\.[lr]|lowerarm\.[lr]|wrist\.[lr]|hand\.[lr])\|rotation$/.test(
      key,
    )
  )
    apex.set(key, [...guard.get(key)]);
rotate(apex, 'upperleg.l', -18);
rotate(apex, 'upperleg.r', -12);
rotate(apex, 'lowerleg.l', 24);
rotate(apex, 'lowerleg.r', 18);
rotate(apex, 'chest', -8);
rotate(apex, 'head', 5);
const descent = new Map([...apex].map(([k, v]) => [k, [...v]]));
rotate(descent, 'chest', 18);
rotate(descent, 'head', -10);
const beats = [
  [0, idle],
  [0.045, coil],
  [0.14, apex],
  [0.3, apex],
  [0.43, descent],
  [0.6, landing],
  [0.65, landing],
  [0.84, recover],
  [0.96, idle],
];
const timeline = [];
for (let i = 0; i < beats.length - 1; i++) {
  const [start, a] = beats[i],
    [end, b] = beats[i + 1];
  const count = Math.max(2, Math.ceil((end - start) * 120));
  for (let step = 0; step < count; step++) {
    const u = step / count,
      eased = u * u * (3 - 2 * u),
      time = start + (end - start) * u;
    let pose = new Map(keys.map((k) => [k, blendValue(k, a.get(k), b.get(k), eased)]));
    // Feet stay world-planted through the actual landing and recovery. Airborne
    // bones are authored in rig space; no duplicate world/root trajectory.
    if (time >= 0.6) pose = plant(pose);
    const gripGain = Math.min(1, time / 0.14, (0.96 - time) / 0.12);
    pose = forwardLeftGrip(pose, 0.1 * Math.max(0, gripGain));
    timeline.push([time, (k) => pose.get(k)]);
  }
}
timeline.push([0.96, (k) => idle.get(k)]);
const { animation } = bakeClip(doc, {
  clipName: 'Warrior_Heroic_Leap',
  channelKeys: keys,
  timeline,
  donorFor: (k) => donors[0].get(k) ?? donors[1].get(k),
});
const rush = bakeWarriorRush(doc, contacts.getRoot());
await mkdir('tmp', { recursive: true });
if (process.argv.includes('--preview'))
  await io.write('tmp/warrior_ability_anims_preview.glb', doc);
stripToAnimationsOnly(doc, [animation, rush]);
await doc.transform(prune(), dedup());
await io.write('public/models/chars/players/warrior_ability_anims.glb', doc);
console.log(
  JSON.stringify({
    clips: ['Warrior_Heroic_Leap', 'Warrior_Rush_Loop'],
    landingSeconds: 0.6,
    duration: 0.96,
    maxFootError,
    samples: timeline.length,
  }),
);
