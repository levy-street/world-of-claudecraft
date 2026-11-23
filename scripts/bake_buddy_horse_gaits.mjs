#!/usr/bin/env node
// Finish the horse buddy's clip pair (public/models/buddies/horse.glb).
//
// The rig came out of the asset_pipeline creature lane (Tripo quadruped
// auto-rig, job creature_horse_mtuz90nt). Its retargeted `preset:quadruped:walk`
// is a REAL walk this time (all twelve leg joints plus two spine joints swing
// through a 2.6 s cycle), so unlike scripts/bake_mount_gaits.mjs this script
// keeps that clip. What the retarget leaves static is everything above the
// shoulders and behind the hips: head, ears and tail hold their bind pose, and
// the lane has no quadruped idle preset at all, so it copied the walk under
// the Idle name (a buddy standing at heel would march on the spot).
//
// So, in place and idempotently:
//   - every clip except Walk is dropped (buddies ship exactly Idle + Walk,
//     BUDDY_CLIPS in src/render/characters/manifest.ts);
//   - Walk keeps its retargeted leg/spine channels and gains a head bob, ear
//     flick and tail swing layered on top (its own static 2-key channels on
//     those bones are replaced, never duplicated);
//   - Idle is authored from scratch against the bind pose: a breathing bob,
//     a slow head nod, ear flicks and a lazy tail sway.
// Every rotation key is rest * delta (the mount-gait contract), so no pose can
// leave the authored bind space, and re-running never compounds anything.
//
//   node scripts/bake_buddy_horse_gaits.mjs            (public/models/buddies/horse.glb)
//   node scripts/bake_buddy_horse_gaits.mjs <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

// Quaternion helpers ([x, y, z, w], Hamilton product), same math as
// scripts/bake_mount_gaits.mjs.
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (axis, angle) => {
  const h = angle / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
};
const qnorm = (q) => {
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
const rotv = (q, v) => {
  const [x, y, z, w] = q;
  const uvx = y * v[2] - z * v[1];
  const uvy = z * v[0] - x * v[2];
  const uvz = x * v[1] - y * v[0];
  const uuvx = y * uvz - z * uvy;
  const uuvy = z * uvx - x * uvz;
  const uuvz = x * uvy - y * uvx;
  return [v[0] + 2 * (w * uvx + uuvx), v[1] + 2 * (w * uvy + uuvy), v[2] + 2 * (w * uvz + uuvz)];
};
const DEG = Math.PI / 180;
// world axes: the rig faces +Z (nose at +0.45, tail root at -0.5), Y up
const AXES = { pitch: [1, 0, 0], yaw: [0, 1, 0], roll: [0, 0, 1] };
const wave = (u, phase = 0) => Math.sin((u + phase) * Math.PI * 2);

// Bone names as the Tripo auto-rig authored them (GLTFLoader strips the
// "tripo::" prefix at load, not here).
const BONES = {
  root: 'tripo::Root',
  neck: 'tripo::Head_0',
  head: 'tripo::Head_3',
  earL: 'bone_12',
  earR: 'bone_13',
  tail1: 'bone_36',
  tail2: 'tripo::Tail_0',
  spine: 'tripo::Spine_1',
};

// The layered channels this script owns. Anything already targeting one of
// these bones in a clip it touches is replaced (glTF forbids two channels on
// the same node + path inside one animation).
const OWNED = new Set(Object.values(BONES));

const IDLE = { dur: 3.6, keys: 25 };
const WALK_LAYER_KEYS = 27;

const [inPath = 'public/models/buddies/horse.glb', outPath = inPath] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
const buffer = root.listBuffers()[0] ?? doc.createBuffer();

const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const bone = (name) => {
  const n = nodes.get(name);
  if (!n) throw new Error(`horse rig: bone "${name}" not found`);
  return n;
};
const worldRot = (node) => {
  let q = [0, 0, 0, 1];
  for (let n = node; n; n = parentOf.get(n)) q = qmul([...n.getRotation()], q);
  return qnorm(q);
};

// 1. Drop every clip but the retargeted Walk.
let walk = null;
for (const anim of root.listAnimations()) {
  if (anim.getName() === 'Walk' && !walk) walk = anim;
  else anim.dispose();
}
if (!walk) throw new Error(`${inPath}: no Walk clip to build on`);

// 2. Strip the channels this script owns from Walk (idempotent re-runs, and
//    the retarget's static 2-key placeholders on the same bones).
for (const ch of walk.listChannels()) {
  const target = ch.getTargetNode();
  if (target && OWNED.has(target.getName())) {
    const sampler = ch.getSampler();
    ch.dispose();
    if (sampler) sampler.dispose();
  }
}
let walkDur = 0;
for (const s of walk.listSamplers()) walkDur = Math.max(walkDur, s.getInput().getMax([])[0]);

// channel authoring against a clip's own time base
function layer(anim, name, keys, dur) {
  const times = Float32Array.from({ length: keys }, (_, i) => (i / (keys - 1)) * dur);
  const input = doc
    .createAccessor(`${name}_layer_t`)
    .setType('SCALAR')
    .setArray(times)
    .setBuffer(buffer);
  const attach = (node, path, acc) => {
    const sampler = doc
      .createAnimationSampler()
      .setInterpolation('LINEAR')
      .setInput(input)
      .setOutput(acc);
    anim.addSampler(sampler);
    anim.addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
    );
  };
  // world-axis rotation delta applied on top of the bind rotation
  const rot = (node, fn) => {
    const rest = [...node.getRotation()];
    const rwp = worldRot(parentOf.get(node));
    const inv = qconj(rwp);
    const out = new Float32Array(keys * 4);
    let prev = null;
    for (let i = 0; i < keys; i++) {
      const u = times[i] / dur;
      let q = rest;
      for (const { axis, angle } of fn(u)) {
        q = qnorm(qmul(qmul(qmul(inv, qaxis(AXES[axis], angle)), rwp), q));
      }
      if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) {
        q = q.map((v) => -v);
      }
      prev = q;
      out.set(q, i * 4);
    }
    attach(
      node,
      'rotation',
      doc
        .createAccessor(`${name}_${node.getName()}_r`)
        .setType('VEC4')
        .setArray(out)
        .setBuffer(buffer),
    );
  };
  // vertical bob of a node, in world units, on top of its bind translation
  const bobY = (node, fn) => {
    const rest = [...node.getTranslation()];
    const inv = qconj(worldRot(parentOf.get(node)));
    const out = new Float32Array(keys * 3);
    for (let i = 0; i < keys; i++) {
      const d = rotv(inv, [0, fn(times[i] / dur), 0]);
      out.set([rest[0] + d[0], rest[1] + d[1], rest[2] + d[2]], i * 3);
    }
    attach(
      node,
      'translation',
      doc
        .createAccessor(`${name}_${node.getName()}_t`)
        .setType('VEC3')
        .setArray(out)
        .setBuffer(buffer),
    );
  };
  return { rot, bobY };
}

// 3. Walk: head bob at stride rate (two beats per cycle: one per diagonal
//    pair), ears pinned back a touch and flicking, tail swinging with the hips.
{
  const L = layer(walk, 'Walk', WALK_LAYER_KEYS, walkDur);
  L.rot(bone(BONES.neck), (u) => [{ axis: 'pitch', angle: 3 * DEG * wave(2 * u, 0.25) }]);
  L.rot(bone(BONES.head), (u) => [{ axis: 'pitch', angle: 2 * DEG * wave(2 * u, 0.4) }]);
  L.rot(bone(BONES.earL), (u) => [{ axis: 'roll', angle: 4 * DEG * wave(u, 0.1) }]);
  L.rot(bone(BONES.earR), (u) => [{ axis: 'roll', angle: -4 * DEG * wave(u, 0.6) }]);
  L.rot(bone(BONES.tail1), (u) => [{ axis: 'yaw', angle: 7 * DEG * wave(u) }]);
  L.rot(bone(BONES.tail2), (u) => [{ axis: 'yaw', angle: 6 * DEG * wave(u, 0.15) }]);
}

// 4. Idle: breathing, a slow nod, an ear flick each, a lazy tail.
{
  const idle = doc.createAnimation('Idle');
  const L = layer(idle, 'Idle', IDLE.keys, IDLE.dur);
  L.bobY(bone(BONES.root), (u) => 0.005 * wave(u));
  L.rot(bone(BONES.spine), (u) => [{ axis: 'roll', angle: 0.8 * DEG * wave(u, 0.1) }]);
  L.rot(bone(BONES.neck), (u) => [{ axis: 'pitch', angle: 2.5 * DEG * wave(u) }]);
  L.rot(bone(BONES.head), (u) => [{ axis: 'pitch', angle: 1.5 * DEG * wave(u, 0.08) }]);
  // one quick flick per ear per cycle, at different moments
  const flick = (u, at) => {
    const d = (u - at + 1) % 1;
    return d < 0.12 ? Math.sin((d / 0.12) * Math.PI) : 0;
  };
  L.rot(bone(BONES.earL), (u) => [{ axis: 'roll', angle: 9 * DEG * flick(u, 0.3) }]);
  L.rot(bone(BONES.earR), (u) => [{ axis: 'roll', angle: -9 * DEG * flick(u, 0.75) }]);
  L.rot(bone(BONES.tail1), (u) => [{ axis: 'yaw', angle: 8 * DEG * wave(u, 0.2) }]);
  L.rot(bone(BONES.tail2), (u) => [{ axis: 'yaw', angle: 7 * DEG * wave(u, 0.32) }]);
}

await io.write(outPath, doc);
const names = root.listAnimations().map((a) => `${a.getName()} (${a.listChannels().length} ch)`);
console.log(`${outPath}: ${names.join(', ')}; walk cycle ${walkDur.toFixed(2)} s`);
