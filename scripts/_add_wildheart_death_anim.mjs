// Re-cut the baked takes in the five Wildheart Basin troll GLBs, the same
// build-time clip surgery _add_cantor_hit_anim.mjs and the Orkadia orc script
// used: the retarget batch shipped a 8.46s 'Death' that is rotation-only,
// arms-only, and loop-closed (final keyframe == first == standing pose), and a
// 6.6s 'Attack' whose strike peak sits ~2s in. visual.ts plays death as a
// clamped LoopOnce and snap-seeds corpses to the LAST frame, so the corpse
// froze standing; the ravager's 2.25s swing cadence reset the attack one-shot
// before its peak, so no swing ever read. Fixes baked here, in the data:
//
//   Death  - replaced with a synthesized ~1.8s topple: the body tips about its
//            left-right axis while the hips sink to the floor, with a small
//            impact bounce, ending clamped flat. The last keyframe IS the
//            corpse pose.
//   Attack - trimmed to the measured strike window [1.0s, 3.0s] (ramp-up
//            67deg..132deg peak..follow-through on R_Upperarm), rebased to 2.0s.
//   Hit    - trimmed to the first 0.7s of the flinch (house convention is a
//            0.45-0.7s hit-react; the one-shot fade-out supplies the recovery).
//
//   node scripts/_add_wildheart_death_anim.mjs [in.glb] [out.glb]
//
// With no args it edits all five creature GLBs in place; with args it processes
// the one file. Byte-stable from the FIRST pass: 'Death' is dropped and
// re-authored AFTER the trims (matching the accessor order a guard-skipping
// re-run reproduces, so f(raw) == f(f(raw)) and re-runs never invalidate the
// minted media-manifest hashes), and the trims skip clips already at game
// length. Meshopt encoder/decoder are registered like the cantor script (these
// particular GLBs ship uncompressed with WebP textures, which the write
// preserves).
//
// AXIS NOTE: this is the 41-joint Tripo biped (Root/Hip/Pelvis/Waist/...),
// authored facing local +X, every wildheart VisualDef corrects with
// yaw: -Math.PI/2 (manifest.ts). Nothing here hardcodes that frame: the topple
// axis, per-bone slump directions, and the tip angle that lands the spine flat
// are all derived from the rig's measured rest orientation, and the written
// file is re-loaded and checked (spine within 20deg of horizontal at the final
// keyframe) before the script reports success.
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const DEFAULT_FILES = [
  'wildheart_stalker',
  'wildheart_ravager',
  'wildheart_hexcaller',
  'wildheart_beastmaster',
  'wildheart_high_priest',
].map((n) => `public/models/creatures/${n}.glb`);
const FILES =
  process.argv[2] !== undefined
    ? [[process.argv[2], process.argv[3] ?? process.argv[2]]]
    : DEFAULT_FILES.map((f) => [f, f]);

// The batch is authored facing local +X with +Y up; the fall is onto the back.
const FACING = [1, 0, 0];
const UP = [0, 1, 0];

// --- clip windows ------------------------------------------------------------
// Attack: measured on all five (identical retarget): near-stillness to 1.0s,
// windup 1.0-2.0 (R_Upperarm 14deg -> 132deg), strike snap 2.0-2.2, hold to
// ~3.0, then 3.5s of drift back to idle. Keep [1.0, 3.0].
const ATTACK_WINDOW = [1.0, 3.0];
const ATTACK_TRIMMED_BELOW = 3.5; // re-run guard: an already-cut clip is ~2.0s
// Hit: the 1.29s take plateaus at ~33deg from 0.5-0.9s; keep the rise and let
// the one-shot fade-out play the recovery.
const HIT_WINDOW = [0, 0.7];
const HIT_TRIMMED_BELOW = 0.8;

// --- death timeline ----------------------------------------------------------
// The tip accelerates (a fall), the sink lags then catches up, the ground hit
// rebounds slightly (tip eases off / hips pop up a touch), and everything
// settles on the last (clamped) key.
const D_TIMES = [0, 0.18, 0.55, 0.95, 1.25, 1.5, 1.8];
const D_TIP = [0, 0.04, 0.3, 0.75, 1.0, 0.97, 1.0]; // fraction of the full topple
const D_SINK = [0, 0.0, 0.1, 0.55, 1.0, 0.92, 1.0]; // fraction of the ground drop
const D_LIMP = [0, 0.05, 0.3, 0.7, 0.95, 1.0, 1.0]; // secondary slump follows the fall
// Stop the hips this far short of dead-flat; the spine slump closes the rest.
const TIP_MARGIN = 0.06; // rad
// Final hip height as a fraction of the standing hip height (the hip joint sits
// inside the body, so ~a third of standing height rests the back on the floor).
const HIP_REST_FRACTION = 0.35;

// Secondary bones slumped about the same (body-relative) left-right axis,
// layered on rest, so the plank of a rigid hip-only rotation reads as a limp
// collapse. Signs are derived per bone below: knees flex, the head lolls back,
// the arms settle to the ground beside the body. Bones the clip does not
// target would hold whatever pose was live at death (or bind pose for a corpse
// entering interest), so the arms are included to pin the whole corpse.
const SLUMP_BONES = [
  { name: 'Waist', peak: 0.1 },
  { name: 'Spine01', peak: 0.12 },
  { name: 'Spine02', peak: 0.12 },
  { name: 'NeckTwist01', peak: 0.16 },
  { name: 'Head', peak: 0.28 },
  { name: 'L_Calf', peak: 0.3 },
  { name: 'R_Calf', peak: 0.26 },
  { name: 'L_Upperarm', peak: 0.15 },
  { name: 'R_Upperarm', peak: 0.13 },
  { name: 'L_Forearm', peak: 0.12 },
  { name: 'R_Forearm', peak: 0.1 },
  { name: 'L_Hand', peak: 0.08 },
  { name: 'R_Hand', peak: 0.08 },
];

// --- vector / quaternion helpers (Hamilton product; a*b applies b then a) ----
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]]; // unit quaternions only
const qAboutAxis = (axis, angle) => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const qRotate = (q, v) => {
  const [x, y, z, w] = q;
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [
    v[0] + w * t[0] + y * t[2] - z * t[1],
    v[1] + w * t[1] + z * t[0] - x * t[2],
    v[2] + w * t[2] + x * t[1] - y * t[0],
  ];
};

// Rest world rotation / position. Every node in this batch has unit scale
// (asserted in processFile), so plain quaternion accumulation is exact.
function restWorldRotation(node, override) {
  const chain = [];
  for (let p = node; p; p = p.getParentNode()) chain.unshift(p);
  let q = [0, 0, 0, 1];
  for (const p of chain) q = qMul(q, override?.get(p)?.rotation ?? p.getRotation());
  return q;
}
function restWorldPosition(node, override) {
  const chain = [];
  for (let p = node; p; p = p.getParentNode()) chain.unshift(p);
  let pos = [0, 0, 0];
  let q = [0, 0, 0, 1];
  for (const p of chain) {
    const t = override?.get(p)?.translation ?? p.getTranslation();
    const r = qRotate(q, t);
    pos = [pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]];
    q = qMul(q, override?.get(p)?.rotation ?? p.getRotation());
  }
  return pos;
}

function clipDuration(anim) {
  let max = 0;
  for (const s of anim.listSamplers()) {
    const times = s.getInput()?.getArray();
    if (times && times.length) max = Math.max(max, times[times.length - 1]);
  }
  return max;
}

function addChannel(doc, buffer, anim, node, path, times, values, tag) {
  const input = doc
    .createAccessor(`${tag}_t`)
    .setType('SCALAR')
    .setArray(new Float32Array(times))
    .setBuffer(buffer);
  const output = doc
    .createAccessor(`${tag}_v`)
    .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
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
      doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
    );
}

// Dispose accessors owned by `anims` unless another animation still samples
// them. Disposing an Animation leaves its input/output accessors orphaned in
// the buffer (prune does not reclaim them), so re-runs would grow the GLB
// without this.
function disposeOwnedAccessors(root, anims) {
  const keep = new Set();
  const dropped = new Set(anims);
  for (const other of root.listAnimations()) {
    if (dropped.has(other)) continue;
    for (const s of other.listSamplers()) {
      keep.add(s.getInput());
      keep.add(s.getOutput());
    }
  }
  const dead = new Set();
  for (const anim of anims) {
    for (const s of anim.listSamplers()) {
      for (const acc of [s.getInput(), s.getOutput()]) {
        if (acc && !keep.has(acc)) dead.add(acc);
      }
    }
  }
  for (const acc of dead) acc.dispose();
}

// Cut [t0, t1] out of every sampler and rebase to 0, interpolating exact
// boundary values (LINEAR only; the batch has no STEP/CUBICSPLINE samplers).
function trimAnimation(doc, buffer, anim, t0, t1, tag) {
  const oldAccessors = new Set();
  const newInputByOld = new Map();
  for (const s of anim.listSamplers()) {
    if (s.getInterpolation() !== 'LINEAR') {
      console.error(`${anim.getName()}: unsupported interpolation ${s.getInterpolation()}`);
      process.exit(1);
    }
    const inputAcc = s.getInput();
    const outputAcc = s.getOutput();
    const times = Array.from(inputAcc.getArray());
    const values = Array.from(outputAcc.getArray());
    const stride = values.length / times.length;
    const isRot = s.getOutput().getType() === 'VEC4';

    const sampleAt = (t) => {
      if (t <= times[0]) return values.slice(0, stride);
      if (t >= times[times.length - 1]) return values.slice(-stride);
      let i = 1;
      while (times[i] < t) i++;
      const f = (t - times[i - 1]) / (times[i] - times[i - 1]);
      const a = values.slice((i - 1) * stride, i * stride);
      const b = values.slice(i * stride, (i + 1) * stride);
      // Quaternion neighbours may be stored in opposite hemispheres (the
      // runtime slerp takes the short way); mirror b before blending.
      const sign = isRot && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
      const out = a.map((v, k) => v * (1 - f) + sign * b[k] * f);
      if (isRot) {
        const n = Math.hypot(out[0], out[1], out[2], out[3]);
        return out.map((v) => v / n);
      }
      return out;
    };

    const newTimes = [0];
    const newValues = [...sampleAt(t0)];
    for (let i = 0; i < times.length; i++) {
      if (times[i] <= t0 + 1e-4 || times[i] >= t1 - 1e-4) continue;
      newTimes.push(times[i] - t0);
      newValues.push(...values.slice(i * stride, (i + 1) * stride));
    }
    newTimes.push(t1 - t0);
    newValues.push(...sampleAt(t1));

    let newInput = newInputByOld.get(inputAcc);
    if (!newInput) {
      newInput = doc
        .createAccessor(`${tag}_t`)
        .setType('SCALAR')
        .setArray(new Float32Array(newTimes))
        .setBuffer(buffer);
      newInputByOld.set(inputAcc, newInput);
    }
    const newOutput = doc
      .createAccessor(`${tag}_v`)
      .setType(outputAcc.getType())
      .setArray(new Float32Array(newValues))
      .setBuffer(buffer);
    oldAccessors.add(inputAcc);
    oldAccessors.add(outputAcc);
    s.setInput(newInput).setOutput(newOutput);
  }
  // The caller disposes these once no clip references them anymore.
  return oldAccessors;
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

async function processFile(inPath, outPath) {
  const sizeBefore = statSync(inPath).size;
  const doc = await io.read(inPath);
  const root = doc.getRoot();
  for (const node of root.listNodes()) {
    if (node.getScale().some((s) => Math.abs(s - 1) > 1e-4)) {
      console.error(`${inPath}: non-unit node scale on ${node.getName()}`);
      process.exit(1);
    }
  }
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const buffer = root.listBuffers()[0];
  const need = (name) => {
    const node = byName.get(name);
    if (!node) {
      console.error(`${inPath}: bone not found: ${name}`);
      process.exit(1);
    }
    return node;
  };

  // --- Attack / Hit trims ----------------------------------------------------
  // Trimmed BEFORE the Death re-author on purpose: a re-run drops and
  // re-appends Death after these guard-skipped trims, so authoring Death last
  // on the first pass too means pass one already produces the byte-stable
  // accessor order a re-run reproduces (f(raw) == f(f(raw))). With Death
  // authored first, the first pass permutes accessors relative to every later
  // pass and silently invalidates freshly minted media-manifest hashes.
  for (const [clipName, window, guard, tag] of [
    ['Attack', ATTACK_WINDOW, ATTACK_TRIMMED_BELOW, 'whAttackTrim'],
    ['Hit', HIT_WINDOW, HIT_TRIMMED_BELOW, 'whHitTrim'],
  ]) {
    const anim = root.listAnimations().find((a) => a.getName() === clipName);
    if (!anim) {
      console.error(`${inPath}: missing clip ${clipName}`);
      process.exit(1);
    }
    if (clipDuration(anim) < guard) continue; // already trimmed
    const old = trimAnimation(doc, buffer, anim, window[0], window[1], tag);
    const keep = new Set();
    for (const other of root.listAnimations()) {
      for (const s of other.listSamplers()) {
        keep.add(s.getInput());
        keep.add(s.getOutput());
      }
    }
    for (const acc of old) if (!keep.has(acc)) acc.dispose();
  }

  // --- Death: drop the loop-closed take, author the topple -------------------
  const priorDeath = root.listAnimations().filter((a) => a.getName() === 'Death');
  disposeOwnedAccessors(root, priorDeath);
  for (const anim of priorDeath) anim.dispose();

  const hip = need('Hip');
  const waist = need('Waist');
  const fallDir = FACING.map((v) => -v); // onto the back
  const tipAxis = cross(UP, fallDir); // body-relative left-right axis, world frame

  // Tip angle that lands the measured rest spine on the horizon: rotate the
  // rest spine direction (Waist local +Y in world) about tipAxis until its
  // vertical component is gone, i.e. the in-plane angle left to reach -facing.
  const spineDir = qRotate(restWorldRotation(waist), [0, 1, 0]);
  const spinePlane = [dot(spineDir, FACING), dot(spineDir, UP)];
  const tipPeak = Math.PI - Math.atan2(spinePlane[1], spinePlane[0]) - TIP_MARGIN;

  const hipParentRot = restWorldRotation(hip.getParentNode());
  const hipRest = hip.getRotation();
  const hipT = hip.getTranslation();
  const hipHeight = restWorldPosition(hip)[1];
  const sinkWorld = Math.max(0, hipHeight * (1 - HIP_REST_FRACTION));
  const downLocal = qRotate(qInv(hipParentRot), [0, -1, 0]);
  const preRot = (angle) =>
    qMul(qMul(qInv(hipParentRot), qAboutAxis(tipAxis, angle)), hipParentRot);

  const death = doc.createAnimation('Death');
  addChannel(
    doc,
    buffer,
    death,
    hip,
    'rotation',
    D_TIMES,
    D_TIP.flatMap((f) => qMul(preRot(tipPeak * f), hipRest)),
    'whDeathHipRot',
  );
  addChannel(
    doc,
    buffer,
    death,
    hip,
    'translation',
    D_TIMES,
    D_SINK.flatMap((f) => [
      hipT[0] + downLocal[0] * sinkWorld * f,
      hipT[1] + downLocal[1] * sinkWorld * f,
      hipT[2] + downLocal[2] * sinkWorld * f,
    ]),
    'whDeathHipPos',
  );
  for (const { name, peak } of SLUMP_BONES) {
    const node = need(name);
    const rest = node.getRotation();
    const parentRot = restWorldRotation(node.getParentNode());
    // Bend about the body's left-right axis, signed so the bone tip moves
    // toward the fall (knees flex, the head and arms settle with the body).
    // Bones lying along the tip axis get no useful signal; keep them positive.
    const tipDir = qRotate(restWorldRotation(node), [0, 1, 0]);
    const swing = dot(cross(tipAxis, tipDir), fallDir);
    const sign = Math.abs(swing) < 0.05 ? 1 : Math.sign(swing);
    const slumpRot = (angle) => qMul(qMul(qInv(parentRot), qAboutAxis(tipAxis, angle)), parentRot);
    addChannel(
      doc,
      buffer,
      death,
      node,
      'rotation',
      D_TIMES,
      D_LIMP.flatMap((f) => qMul(slumpRot(sign * peak * f), rest)),
      `whDeathSlump_${name}`,
    );
  }

  await io.write(outPath, doc);
  const sizeAfter = statSync(outPath).size;
  console.log(
    `wrote ${outPath} (tip ${((tipPeak * 180) / Math.PI).toFixed(1)}deg, sink ${sinkWorld.toFixed(
      3,
    )}, ${sizeBefore} -> ${sizeAfter} bytes)`,
  );
  await verifyFile(outPath);
}

// Reload the written GLB and measure what the renderer will actually clamp on:
// clip inventory + durations, the Death end-vs-start deviation (the original
// regression measured 0.0000), and the final-keyframe spine attitude.
async function verifyFile(path) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  const anims = root.listAnimations();
  const names = anims.map((a) => a.getName());
  for (const required of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Cast', 'Jump']) {
    if (!names.includes(required)) {
      console.error(`${path}: VERIFY FAIL missing clip ${required}`);
      process.exit(1);
    }
  }
  const death = anims.find((a) => a.getName() === 'Death');
  const attack = anims.find((a) => a.getName() === 'Attack');
  const hit = anims.find((a) => a.getName() === 'Hit');
  const deathDur = clipDuration(death);
  let endVsStart = 0;
  const finalPose = new Map();
  for (const ch of death.listChannels()) {
    const s = ch.getSampler();
    const values = s.getOutput().getArray();
    const times = s.getInput().getArray();
    const stride = values.length / times.length;
    for (let c = 0; c < stride; c++) {
      endVsStart = Math.max(endVsStart, Math.abs(values[values.length - stride + c] - values[c]));
    }
    const node = ch.getTargetNode();
    const entry = finalPose.get(node) ?? {};
    entry[ch.getTargetPath()] = Array.from(values.slice(-stride));
    finalPose.set(node, entry);
  }
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const waist = byName.get('Waist');
  const hip = byName.get('Hip');
  const spineEnd = qRotate(restWorldRotation(waist, finalPose), [0, 1, 0]);
  const spineFromHorizontal = (Math.asin(Math.abs(spineEnd[1])) * 180) / Math.PI;
  const hipEndY = restWorldPosition(hip, finalPose)[1];
  const hipRestY = restWorldPosition(hip)[1];
  console.log(
    `  verify: Death ${deathDur.toFixed(2)}s endVsStart ${endVsStart.toFixed(3)} ` +
      `spine ${spineFromHorizontal.toFixed(1)}deg-from-horizontal ` +
      `hipY ${hipRestY.toFixed(3)} -> ${hipEndY.toFixed(3)} | ` +
      `Attack ${clipDuration(attack).toFixed(2)}s Hit ${clipDuration(hit).toFixed(2)}s`,
  );
  if (deathDur < 1.6 || deathDur > 2.0) {
    console.error(`${path}: VERIFY FAIL death duration ${deathDur}`);
    process.exit(1);
  }
  if (endVsStart < 0.25) {
    console.error(`${path}: VERIFY FAIL death still loop-closed (${endVsStart})`);
    process.exit(1);
  }
  if (spineFromHorizontal > 20) {
    console.error(`${path}: VERIFY FAIL corpse spine ${spineFromHorizontal}deg from horizontal`);
    process.exit(1);
  }
  if (hipEndY > hipRestY * 0.5) {
    console.error(`${path}: VERIFY FAIL hips still airborne (${hipEndY})`);
    process.exit(1);
  }
}

for (const [inPath, outPath] of FILES) await processFile(inPath, outPath);
