// Native-rig Fury performances: alternating committed blades, then a distinct
// low-to-high crossing finisher. Bake once; no per-frame retargeting or rig work.
// node scripts/build_fury_anims.mjs [--preview]
import { mkdir } from 'node:fs/promises';
import { dedup, prune } from '@gltf-transform/functions';
import { Euler, Quaternion } from 'three';
import { createHarvestStance } from './anim/harvest_pose.mjs';
import {
  bakeClip,
  blendValue,
  createGlbIO,
  indexClip,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';
import { createTwinstrikeStance } from './anim/twinstrike_pose.mjs';

const io = await createGlbIO();
const doc = await io.read('public/models/chars/players/knight.glb');
const root = doc.getRoot();
const names = [
  'Idle',
  '1H_Melee_Attack_Slice_Diagonal',
  'Dualwield_Melee_Attack_Chop',
  '2H_Melee_Attack_Chop',
];
const donors = names.map((name) => indexClip(root, name));
// Decode normalized quaternion storage before interpolation, including endpoints.
for (const donor of donors)
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
const keys = [...new Set(donors.flatMap((donor) => [...donor.keys()]))];
const idle = samplePose(donors[0], 0.3);
const harvestStance = createHarvestStance(root, idle);
const twinstrikeStance = createTwinstrikeStance(root, idle);
const sample = (donor, time) => samplePose(donors[donor], time);
const q = new Quaternion(),
  offset = new Quaternion(),
  euler = new Euler();
const degrees = Math.PI / 180;
function pose(right, left, turn, lean, spread = 0, torso = idle) {
  const result = new Map();
  for (const key of keys) {
    const [bone, path] = key.split('|');
    const arm = /arm|hand|wrist/.test(bone);
    const lower = /leg|foot|toes/.test(bone) || bone === 'root' || bone === 'hips';
    const source = lower ? idle : arm ? (bone.endsWith('.r') ? right : left) : torso;
    const value = [...(source.get(key) ?? idle.get(key))];
    if (path === 'rotation') {
      let x = 0,
        y = 0,
        z = 0;
      if (bone === 'chest') {
        x = lean;
        y = turn;
      }
      if (bone === 'spine') {
        x = lean * 0.35;
        y = turn * 0.35;
      }
      if (bone === 'head') {
        x = -lean * 0.45;
        y = -turn * 0.7;
      }
      if (bone === 'upperarm.r') z = spread;
      if (bone === 'upperarm.l') z = -spread;
      q.fromArray(value)
        .multiply(offset.setFromEuler(euler.set(x * degrees, y * degrees, z * degrees)))
        .normalize();
      q.toArray(value);
    }
    result.set(key, value);
  }
  return result;
}
const rightCoil = pose(sample(1, 0.27), sample(2, 0.28), -38, 3, 8);
const rightCut = pose(sample(1, 0.38), sample(2, 0.28), 35, 15, 2);
const leftCoil = pose(sample(1, 0.78), sample(2, 0.32), 42, 4, 14);
const leftCut = pose(sample(1, 0.88), sample(2, 0.87), -42, 18, 7);
// Preserve the native torso with the arm chains: the old Idle torso plus chop
// arms pointed both actual sword blades behind the caster at the impact peak.
const reapCut = pose(sample(1, 0.38), sample(2, 0.87), 12, 8, 8, sample(2, 0.87));
const harvestCoil = pose(sample(1, 0.27), sample(2, 0.28), -38, 5, 8);
const harvestFirst = pose(sample(1, 0.38), sample(2, 0.28), 35, 15, 2);
const harvestReverse = pose(sample(1, 0.78), sample(2, 0.32), 38, 5, 14);
const harvestSecond = pose(sample(1, 0.88), sample(2, 0.87), -40, 18, 7);
const harvestLow = pose(sample(2, 0.87), sample(2, 0.87), -5, 18, 5, sample(2, 0.87));
const harvestHigh = pose(sample(2, 0.28), sample(2, 0.28), 0, -12, 5, sample(2, 0.28));
const clips = [];
for (const [name, beats] of [
  [
    'Fury_Twinstrike',
    [
      [0, idle],
      [0.085, rightCoil],
      [0.15, rightCut],
      [0.172, rightCut],
      [0.26, leftCoil],
      [0.34, leftCut],
      [0.36, leftCut],
      [0.66, idle],
    ],
  ],
  [
    'Fury_Red_Harvest',
    [
      [0, idle],
      [0.075, harvestCoil],
      [0.15, harvestFirst],
      [0.166, harvestFirst],
      [0.245, harvestReverse],
      [0.32, harvestSecond],
      [0.337, harvestSecond],
      [0.42, harvestLow],
      [0.49, reapCut],
      [0.53, reapCut],
      [0.595, harvestHigh],
      [0.72, idle],
    ],
  ],
]) {
  const timeline = [[0, (key) => idle.get(key)]];
  for (let b = 1; b < beats.length; b++) {
    const [start, from] = beats[b - 1],
      [end, to] = beats[b];
    const steps = Math.max(2, Math.ceil((end - start) * 90));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      // Ease in/out retains distinct loaded poses without a robotic stop.
      const weight = t * t * (3 - 2 * t);
      const time = start + (end - start) * t;
      const blended = new Map(
        keys.map((key) => [key, blendValue(key, from.get(key), to.get(key), weight)]),
      );
      const authored =
        name === 'Fury_Red_Harvest'
          ? harvestStance(blended, time)
          : twinstrikeStance(blended, time);
      timeline.push([time, (key) => authored.get(key)]);
    }
  }
  clips.push(
    bakeClip(doc, {
      clipName: name,
      channelKeys: keys,
      timeline,
      donorFor: (key) => donors.find((donor) => donor.has(key))?.get(key),
    }).animation,
  );
}
if (process.argv.includes('--preview')) {
  await mkdir('tmp/fury-authoring', { recursive: true });
  await io.write('tmp/fury-authoring/knight_fury_preview.glb', doc);
}
stripToAnimationsOnly(doc, clips);
await doc.transform(prune(), dedup());
const output = 'public/models/chars/players/warrior_fury_anims.glb';
await io.write(output, doc);
console.log(
  JSON.stringify({ output, clips: clips.map((clip) => clip.getName()), channels: keys.length }),
);
