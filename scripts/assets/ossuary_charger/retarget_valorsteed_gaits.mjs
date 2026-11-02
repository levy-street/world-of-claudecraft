// Give Wraith the Deadstrier the valorsteed's authored gaits (the same clips the
// Lantern Hall Destrier plays), retargeted onto the skeleton horse's own rig.
//
//   node scripts/assets/ossuary_charger/retarget_valorsteed_gaits.mjs [src.glb] [target.glb]
//
// src defaults to public/models/mounts/valorsteed.glb and target to
// public/models/mounts/ossuary_charger.glb (its clips are replaced in place).
//
// The two rigs share nothing but anatomy: the valorsteed is a 79-bone horse rig
// with five-bone legs, the charger a 16-bone Tripo auto-rig with two-bone legs
// (three on the rear left, whose thigh the auto-rig called Spine_2) and a head
// bone that roots at the muzzle. So the motion is carried over by meaning, not
// by bone, sampled at FPS from the source clip:
//
// - Legs: each target leg bone points along the matching stretch of the source
//   leg (shoulder or hip to knee or hock, knee to fetlock), as a world rotation
//   from that stretch's rest direction. Only rotations are written, so every
//   leg chain stays joined.
// - Hips, chest and tail copy the world rotation of the source bone that plays
//   that part; the root also takes the source hips' bob, scaled to this horse.
// - Neck and head copy the source neck's and head's world rotations, but turn
//   about THIS horse's withers and poll (the auto-rig's head joint sits at the
//   muzzle, so a plain copy would swing the skull about its nose). The neck
//   takes NECK_FOLLOW of the source neck's swing: this neck is short and rises
//   steeply, so the full gallop reach drove the skull down to the chest.
//
// Both rigs face +Z in glTF space with Y up. Every clip the source has is
// written under the same name (Idle, Walk, Run, Death); the charger's old clips
// are dropped first, so re-running is idempotent.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const SRC = process.argv[2] ?? 'public/models/mounts/valorsteed.glb';
const TARGET = process.argv[3] ?? 'public/models/mounts/ossuary_charger.glb';
const FPS = 30;

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

/** Load a GLB into three.js without its textures (three's loader cannot decode
 *  KTX2 or WebP under Node, and the motion does not need them). */
async function loadForMotion(path) {
  const doc = await io.read(path);
  for (const m of doc.getRoot().listMaterials()) {
    m.setBaseColorTexture(null);
    m.setNormalTexture(null);
    m.setMetallicRoughnessTexture(null);
    m.setEmissiveTexture(null);
    m.setOcclusionTexture(null);
  }
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) {
    if (
      ['KHR_texture_basisu', 'EXT_meshopt_compression', 'EXT_texture_webp'].includes(
        e.extensionName,
      )
    )
      e.dispose();
  }
  const bin = await io.writeBinary(doc);
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
}

const src = await loadForMotion(SRC);
const tgt = await loadForMotion(TARGET);
src.scene.updateMatrixWorld(true);
tgt.scene.updateMatrixWorld(true);

const node = (scene, name) => {
  const n = scene.getObjectByName(name);
  if (!n) throw new Error(`missing node ${name}`);
  return n;
};
const worldPos = (o) => o.getWorldPosition(new THREE.Vector3());
const worldQuat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

// --- the maps (three's runtime names: GLTFLoader strips '.' and ':') --------
// Target leg chains, root to hoof, with the source stretch each bone follows
// (pairs of source joints whose head positions span it).
const LEGS = [
  // front, +x side
  {
    side: 1,
    front: true,
    bones: ['tripo1_Right_Limb_0', 'tripo1_Right_Limb_1'],
    stretches: [
      ['c_thigh_b_dupli_001l_043', 'leg_stretch_dupli_001l_045'],
      ['leg_stretch_dupli_001l_045', 'toes_01_dupli_001l_046'],
    ],
  },
  // front, -x side
  {
    side: -1,
    front: true,
    bones: ['bone_12', 'bone_13'],
    stretches: [
      ['c_thigh_b_dupli_001r_050', 'leg_stretch_dupli_001r_052'],
      ['leg_stretch_dupli_001r_052', 'toes_01_dupli_001r_054'],
    ],
  },
  // rear, +x side: the auto-rig's Spine_2 is this leg's thigh
  {
    side: 1,
    front: false,
    bones: ['tripoSpine_2', 'tripo0_Right_Limb_0', 'tripo0_Right_Limb_1'],
    stretches: [
      ['c_thigh_bl_07', 'thigh_stretchl_08'],
      ['thigh_stretchl_08', 'leg_stretchl_09'],
      ['leg_stretchl_09', 'toes_01l_011'],
    ],
  },
  // rear, -x side
  {
    side: -1,
    front: false,
    bones: ['tripo1_Left_Limb_0', 'tripo1_Left_Limb_1'],
    stretches: [
      ['c_thigh_br_014', 'leg_stretchr_016'],
      ['leg_stretchr_016', 'toes_01r_018'],
    ],
  },
];
// Body bones that copy a source bone's world rotation.
const COPIES = [
  ['tripoSpine_0', 'spine_02x_022'], // chest, carries the front legs
  ['tripoSpine_1', 'rootx_02'], // hindquarters, carries the rear legs
  ['tripo0_Left_Limb_0', 'c_tail_00x_03'], // the tailbone
];
const ROOT = 'tripoRoot';
const SRC_HIPS = 'rootx_02';
const NECK = 'bone_15';
const HEAD = 'bone_14';
const SRC_NECK = 'neckx_027';
const SRC_NECK_BASE = 'c_subneck_1x_023';
const SRC_HEAD = 'headx_031';
const NECK_FOLLOW = 0.5;

// Check the sides line up: the source's +x legs must be the ones mapped to +x.
for (const leg of LEGS) {
  const s = worldPos(node(src.scene, leg.stretches[0][0])).x;
  const t = worldPos(node(tgt.scene, leg.bones[0])).x;
  if (Math.sign(s) !== leg.side || Math.sign(t) !== leg.side) {
    throw new Error(
      `leg side mismatch: ${leg.bones[0]} (${t.toFixed(3)}) vs ${leg.stretches[0][0]} (${s.toFixed(3)})`,
    );
  }
}
const srcHeadZ = worldPos(node(src.scene, SRC_HEAD)).z;
const srcHipZ = worldPos(node(src.scene, SRC_HIPS)).z;
if (srcHeadZ < srcHipZ) throw new Error('source rig does not face +Z');

// Scale from source to target: the hip-to-fetlock leg length (the gait's bob
// and stride live in the legs).
const legLength = (scene, top, hoof) =>
  worldPos(node(scene, top)).distanceTo(worldPos(node(scene, hoof)));
const SCALE =
  (legLength(tgt.scene, 'tripo1_Left_Limb_0', 'tripo1_Left_Limb_1') +
    worldPos(node(tgt.scene, 'tripo1_Left_Limb_1')).y) /
  legLength(src.scene, 'c_thigh_br_014', 'toes_01r_018');

// Pivots on THIS horse (rest, world): the root of the neck at the withers and the
// poll behind the skull (the neck bone's head is the poll on this rig).
const tgtPoll = worldPos(node(tgt.scene, NECK));
const tgtWithers = new THREE.Vector3(0, tgtPoll.y - 0.2, tgtPoll.z - 0.2);

// --- rest records -----------------------------------------------------------
const srcRest = new Map();
src.scene.traverse((o) => {
  if (o.isBone || o.type === 'Object3D') srcRest.set(o.name, { p: worldPos(o), q: worldQuat(o) });
});
const tgtBones = [];
tgt.scene.traverse((o) => {
  if (o.isBone) tgtBones.push(o);
});
const tgtRest = new Map(
  tgtBones.map((b) => [
    b.name,
    { p: worldPos(b), q: worldQuat(b), lp: b.position.clone(), lq: b.quaternion.clone() },
  ]),
);

// --- per frame --------------------------------------------------------------
const q = new THREE.Quaternion();
const v = new THREE.Vector3();

/** World rotation a source bone has turned through since rest. */
function srcTurn(name) {
  const rest = srcRest.get(name);
  return worldQuat(node(src.scene, name)).multiply(rest.q.clone().invert());
}
/** Movement of a source bone's head since rest, in target units. */
function srcShift(name) {
  return worldPos(node(src.scene, name)).sub(srcRest.get(name).p).multiplyScalar(SCALE);
}

/** Pose one target bone to a desired WORLD rotation (and position, if given). */
function setWorld(bone, worldQ, worldP) {
  const parent = bone.parent;
  parent.updateMatrixWorld(true);
  const parentQ = worldQuat(parent);
  bone.quaternion.copy(parentQ.invert().multiply(worldQ));
  if (worldP) bone.position.copy(parent.worldToLocal(worldP.clone()));
  bone.updateMatrixWorld(true);
}

function poseFrame() {
  for (const b of tgtBones) {
    const r = tgtRest.get(b.name);
    b.position.copy(r.lp);
    b.quaternion.copy(r.lq);
  }
  tgt.scene.updateMatrixWorld(true);
  // Root: the hips' turn, about the hips, plus their bob.
  const root = node(tgt.scene, ROOT);
  const rootRest = tgtRest.get(ROOT);
  const hipTurn = srcTurn(SRC_HIPS);
  const hipPivot = tgtRest.get('tripoSpine_1').p;
  setWorld(
    root,
    hipTurn.clone().multiply(rootRest.q),
    rootRest.p.clone().sub(hipPivot).applyQuaternion(hipTurn).add(hipPivot).add(srcShift(SRC_HIPS)),
  );
  for (const [t, s] of COPIES) setWorld(node(tgt.scene, t), srcTurn(s).multiply(tgtRest.get(t).q));
  // Neck: the source neck's turn about this horse's withers, carried by the chest.
  const chest = node(tgt.scene, 'tripoSpine_0');
  chest.updateMatrixWorld(true);
  const chestRest = tgtRest.get('tripoSpine_0');
  const withers = tgtWithers
    .clone()
    .sub(chestRest.p)
    .applyQuaternion(worldQuat(chest).multiply(chestRest.q.clone().invert()))
    .add(worldPos(chest));
  const neckTurn = new THREE.Quaternion().slerp(srcTurn(SRC_NECK), NECK_FOLLOW);
  const placeByNeck = (p) => p.clone().sub(tgtWithers).applyQuaternion(neckTurn).add(withers);
  // Head: the source head's turn about the poll, wherever the neck carried it.
  const headTurn = srcTurn(SRC_HEAD);
  const poll = placeByNeck(tgtPoll);
  const head = node(tgt.scene, HEAD);
  const headRest = tgtRest.get(HEAD);
  setWorld(
    head,
    headTurn.clone().multiply(headRest.q),
    headRest.p.clone().sub(tgtPoll).applyQuaternion(headTurn).add(poll),
  );
  const neck = node(tgt.scene, NECK);
  const neckRest = tgtRest.get(NECK);
  setWorld(neck, neckTurn.clone().multiply(neckRest.q), placeByNeck(neckRest.p));
  // Legs: each bone along its source stretch.
  for (const leg of LEGS) {
    leg.bones.forEach((name, i) => {
      const [a, b] = leg.stretches[i];
      const restDir = srcRest.get(b).p.clone().sub(srcRest.get(a).p).normalize();
      const nowDir = worldPos(node(src.scene, b))
        .sub(worldPos(node(src.scene, a)))
        .normalize();
      q.setFromUnitVectors(restDir, nowDir);
      setWorld(node(tgt.scene, name), q.clone().multiply(tgtRest.get(name).q));
    });
  }
}

// --- sample every source clip ---------------------------------------------
const mixer = new THREE.AnimationMixer(src.scene);
const baked = [];
for (const clip of src.animations) {
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  action.play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const times = new Float32Array(frames);
  const tracks = new Map(tgtBones.map((b) => [b.name, { t: [], r: [] }]));
  for (let f = 0; f < frames; f++) {
    const time = Math.min(clip.duration, f / FPS);
    times[f] = time;
    mixer.setTime(time);
    src.scene.updateMatrixWorld(true);
    poseFrame();
    for (const b of tgtBones) {
      const tr = tracks.get(b.name);
      tr.t.push(...b.position.toArray());
      tr.r.push(...b.quaternion.toArray());
    }
  }
  // Keep the quaternion track on one hemisphere so interpolation never flips.
  for (const tr of tracks.values()) {
    for (let i = 4; i < tr.r.length; i += 4) {
      const dot =
        tr.r[i] * tr.r[i - 4] +
        tr.r[i + 1] * tr.r[i - 3] +
        tr.r[i + 2] * tr.r[i - 2] +
        tr.r[i + 3] * tr.r[i - 1];
      if (dot < 0) for (let k = 0; k < 4; k++) tr.r[i + k] = -tr.r[i + k];
    }
  }
  baked.push({ name: clip.name, times, tracks });
  mixer.uncacheAction(clip);
}

// --- write the clips into the target GLB ------------------------------------
const doc = await io.read(TARGET);
const root = doc.getRoot();
for (const anim of root.listAnimations()) {
  for (const s of anim.listSamplers()) {
    s.getInput()?.dispose();
    s.getOutput()?.dispose();
  }
  anim.dispose();
}
const buffer = root.listBuffers()[0];
const nodesByRuntimeName = new Map(
  root.listNodes().map((n) => [THREE.PropertyBinding.sanitizeNodeName(n.getName()), n]),
);
// Written channels: the bones that move (rotation) and the ones placed by position.
const MOVES_POSITION = new Set([ROOT, HEAD, NECK]);
const ROTATES = new Set([
  ROOT,
  HEAD,
  NECK,
  ...COPIES.map(([t]) => t),
  ...LEGS.flatMap((l) => l.bones),
]);
for (const clip of baked) {
  const anim = doc.createAnimation(clip.name);
  const input = doc.createAccessor().setType('SCALAR').setArray(clip.times).setBuffer(buffer);
  for (const [name, tr] of clip.tracks) {
    if (!ROTATES.has(name)) continue;
    const target = nodesByRuntimeName.get(name);
    if (!target) throw new Error(`target GLB has no node for ${name}`);
    const channels = [['rotation', 'VEC4', tr.r]];
    if (MOVES_POSITION.has(name)) channels.push(['translation', 'VEC3', tr.t]);
    for (const [path, type, values] of channels) {
      const output = doc
        .createAccessor()
        .setType(type)
        .setArray(new Float32Array(values))
        .setBuffer(buffer);
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(output)
        .setInterpolation('LINEAR');
      anim
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(target)
            .setTargetPath(path)
            .setSampler(sampler),
        );
    }
  }
}
await io.write(TARGET, doc);
console.log(
  `retargeted ${baked.map((c) => `${c.name} ${c.times.at(-1).toFixed(2)}s`).join(', ')}`,
  `at scale ${SCALE.toFixed(4)} into ${TARGET}`,
);
