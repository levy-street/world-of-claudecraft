// Graft the REAL Tripo death animation (retargeted by scripts/reanim_orc_death.mjs,
// artifacts under tmp/asset_pipeline/reanim_orc_death_*_orc/final.glb) into the
// original Orkadia orc GLBs, replacing ONLY the synthesized Death clip authored by
// scripts/_add_orc_death_anim.mjs. Every other clip, the mesh, textures, and the
// rig are left untouched.
//
//   node scripts/graft_orc_death.mjs [--write]
//
// Default is check mode: the skeletons are compared and a validation table is
// printed, but nothing is written. --write performs the graft, and ONLY when the
// retargeted rig is structurally identical to the shipped rig (same joint set,
// same node hierarchy by name), a name-remapped graft across different skeletons
// would produce garbage motion, so the script refuses and exits non-zero.
//
// Current reality (2026-07): the shipped orc GLBs use the original Tripo
// Mixamo-named skeleton (mixamorig:*, 22 joints) while the reanim pipeline
// re-rigged the model onto Tripo's biped rig (Hip/Waist/Pelvis/L_Thigh..., 41
// joints) before retargeting. The skeletons are NOT identical, so the graft is
// refused and the synthesized Death stays in place. Getting the real death onto
// these GLBs requires shipping the re-rigged model (the reverted approach) or
// retargeting onto the original Mixamo rig.
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const WRITE = process.argv.includes('--write');
const DEATH_MAX_SECONDS = 2.6;

const ORCS = ['black_orc', 'blue_orc', 'red_orc'].map((key) => ({
  key,
  original: `public/models/creatures/${key}.glb`,
  retargeted: `tmp/asset_pipeline/reanim_orc_death_${key}/final.glb`,
}));

const REQUIRED_CLIPS = [
  'Idle_Loop',
  'Walk_Loop',
  'Sprint_Loop',
  'Sword_Attack',
  'Punch_Jab',
  'Hit',
  'Death',
];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// --- structural skeleton comparison ------------------------------------------
// Hierarchy as a sorted list of "parent>child" name pairs plus the skin joint
// name set. Identical lists mean a name-keyed channel remap is well-defined.
function skeletonSignature(doc) {
  const root = doc.getRoot();
  const edges = [];
  for (const node of root.listNodes()) {
    const parent = node.getParentNode();
    edges.push(`${parent ? parent.getName() : ''}>${node.getName()}`);
  }
  edges.sort();
  const joints = root
    .listSkins()
    .flatMap((skin) => skin.listJoints().map((j) => j.getName()))
    .sort();
  return { nodeCount: root.listNodes().length, joints, edges };
}

function skeletonsIdentical(a, b) {
  if (a.nodeCount !== b.nodeCount) return false;
  if (a.joints.length !== b.joints.length) return false;
  return a.joints.join('') === b.joints.join('') && a.edges.join('') === b.edges.join('');
}

// --- animation helpers --------------------------------------------------------
function clipDuration(anim) {
  let max = 0;
  for (const sampler of anim.listSamplers()) {
    const input = sampler.getInput()?.getArray();
    if (input?.length) max = Math.max(max, input[input.length - 1]);
  }
  return max;
}

// Translation range of the named node across a clip (null when the clip has no
// translation channel for it, the retargets are rotation-only, inPlace:true).
function translationRange(anim, nodeName) {
  for (const channel of anim.listChannels()) {
    if (channel.getTargetNode()?.getName() !== nodeName) continue;
    if (channel.getTargetPath() !== 'translation') continue;
    const output = channel.getSampler()?.getOutput();
    if (!output) continue;
    const count = output.getCount();
    if (!count) continue;
    // getElement de-normalizes quantized accessors (meshopt output).
    const mins = [Infinity, Infinity, Infinity];
    const maxs = [-Infinity, -Infinity, -Infinity];
    const el = [];
    for (let i = 0; i < count; i++) {
      output.getElement(i, el);
      for (let axis = 0; axis < 3; axis++) {
        mins[axis] = Math.min(mins[axis], el[axis]);
        maxs[axis] = Math.max(maxs[axis], el[axis]);
      }
    }
    return maxs.map((m, axis) => +(m - mins[axis]).toFixed(4));
  }
  return null;
}

// Max angular deviation (radians) from the first keyframe on the named node's
// rotation channel, a rig-agnostic "does the joint really move" diff metric.
function rotationSwing(anim, nodeName) {
  for (const channel of anim.listChannels()) {
    if (channel.getTargetNode()?.getName() !== nodeName) continue;
    if (channel.getTargetPath() !== 'rotation') continue;
    const output = channel.getSampler()?.getOutput();
    if (!output || output.getCount() < 2) continue;
    const q0 = [];
    const el = [];
    output.getElement(0, q0);
    let max = 0;
    for (let i = 1; i < output.getCount(); i++) {
      output.getElement(i, el);
      const dot = Math.abs(q0[0] * el[0] + q0[1] * el[1] + q0[2] * el[2] + q0[3] * el[3]);
      max = Math.max(max, 2 * Math.acos(Math.min(1, dot)));
    }
    return +max.toFixed(4);
  }
  return null;
}

// Largest rotationSwing across every channel of a clip: proves the clip is
// real motion (not a frozen pose) regardless of which joint carries it.
function maxSwing(anim) {
  let max = 0;
  for (const channel of anim.listChannels()) {
    if (channel.getTargetPath() !== 'rotation') continue;
    const swing = rotationSwing(anim, channel.getTargetNode()?.getName());
    if (swing !== null) max = Math.max(max, swing);
  }
  return +max.toFixed(4);
}

// Copy an animation into another document, remapping channel targets by node
// name. Only valid once skeletonsIdentical() has passed.
function copyAnimationByName(doc, source, targetName) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const byName = new Map(root.listNodes().map((node) => [node.getName(), node]));

  const cloneAccessor = (src, tag) =>
    doc
      .createAccessor(tag)
      .setType(src.getType())
      .setArray(src.getArray().slice())
      .setNormalized(src.getNormalized())
      .setBuffer(buffer);

  const target = doc.createAnimation(targetName);
  const samplerMap = new Map();
  for (const sampler of source.listSamplers()) {
    const cloned = doc
      .createAnimationSampler()
      .setInterpolation(sampler.getInterpolation())
      .setInput(cloneAccessor(sampler.getInput(), `${targetName}_t`))
      .setOutput(cloneAccessor(sampler.getOutput(), `${targetName}_v`));
    samplerMap.set(sampler, cloned);
    target.addSampler(cloned);
  }

  let dropped = 0;
  for (const channel of source.listChannels()) {
    const sourceNode = channel.getTargetNode();
    const sampler = samplerMap.get(channel.getSampler());
    const mapped = sourceNode ? byName.get(sourceNode.getName()) : undefined;
    if (!mapped || !sampler) {
      dropped++;
      continue;
    }
    target.addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(mapped)
        .setTargetPath(channel.getTargetPath())
        .setSampler(sampler),
    );
  }
  return { target, dropped };
}

// Cut every channel of `anim` at maxSeconds, duplicating the last in-range key
// at the cut point so the pose holds (same policy as reanim_orc_death.mjs).
function trimAnimation(anim, maxSeconds) {
  const eps = 1e-6;
  for (const channel of anim.listChannels()) {
    const sampler = channel.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    if (!input || !output) continue;
    const times = Array.from(input.getArray());
    const values = Array.from(output.getArray());
    if (!times.length) continue;
    const stride = Math.round(values.length / times.length) || 1;

    let end = 0;
    while (end + 1 < times.length && times[end + 1] <= maxSeconds + eps) end++;
    const outTimes = times.slice(0, end + 1);
    const outValues = values.slice(0, (end + 1) * stride);
    if (outTimes[outTimes.length - 1] < maxSeconds - eps && end + 1 < times.length) {
      outTimes.push(maxSeconds);
      const start = end * stride;
      for (let i = 0; i < stride; i++) outValues.push(values[start + i] ?? 0);
    }
    input.setArray(new Float32Array(outTimes));
    output.setArray(new Float32Array(outValues));
  }
}

// Remove an animation AND its accessors (disposing the clip alone orphans the
// input/output accessors in the buffer; see _add_orc_death_anim.mjs).
function disposeAnimation(anim) {
  for (const sampler of anim.listSamplers()) {
    sampler.getInput()?.dispose();
    sampler.getOutput()?.dispose();
  }
  anim.dispose();
}

// --- per-orc pipeline ----------------------------------------------------------
const rows = [];
let refused = 0;

for (const orc of ORCS) {
  const row = { key: orc.key, graft: 'no', reason: '', deathDuration: '', bytes: '' };
  rows.push(row);

  const originalDoc = await io.read(orc.original);
  const retargetedDoc = await io.read(orc.retargeted);
  const originalRoot = originalDoc.getRoot();
  const retargetedRoot = retargetedDoc.getRoot();

  const beforeBytes = statSync(orc.original).size;
  const originalClips = originalRoot.listAnimations().map((a) => a.getName());
  const synthDeath = originalRoot.listAnimations().find((a) => a.getName() === 'Death');
  const realDeath = retargetedRoot.listAnimations().find((a) => a.getName() === 'Death');

  if (!realDeath) {
    row.reason = 'no Death clip in retargeted final.glb';
    refused++;
    continue;
  }

  const origSig = skeletonSignature(originalDoc);
  const newSig = skeletonSignature(retargetedDoc);
  const identical = skeletonsIdentical(origSig, newSig);

  // Diff metric: hip-node motion, old synthesized topple vs the real
  // retargeted fall (each in its own rig's local units, the shipped armature
  // is 0.01-scale; the retargets are rotation-only, hence the swing metric).
  const synthHipT = synthDeath ? translationRange(synthDeath, 'mixamorig:Hips') : null;
  const synthHipR = synthDeath ? rotationSwing(synthDeath, 'mixamorig:Hips') : null;
  const realHipT = translationRange(realDeath, 'Pelvis');
  const realHipR = rotationSwing(realDeath, 'Pelvis');
  const realMax = maxSwing(realDeath);
  console.log(`\n=== ${orc.key} ===`);
  console.log(`  original rig:  ${origSig.nodeCount} nodes, ${origSig.joints.length} joints`);
  console.log(`  retargeted rig: ${newSig.nodeCount} nodes, ${newSig.joints.length} joints`);
  console.log(`  skeletons identical: ${identical}`);
  console.log(
    `  old synthesized Death mixamorig:Hips: translation range ${synthHipT ? synthHipT.join(', ') : 'n/a'}, rotation swing ${synthHipR ?? 'n/a'} rad`,
  );
  console.log(
    `  real retargeted Death Pelvis:         translation range ${realHipT ? realHipT.join(', ') : 'n/a (rotation-only)'}, rotation swing ${realHipR ?? 'n/a'} rad; max joint swing ${realMax} rad`,
  );
  console.log(`  real Death duration in final.glb: ${clipDuration(realDeath).toFixed(3)}s`);

  if (!identical) {
    row.reason =
      `skeleton mismatch (orig ${origSig.nodeCount} nodes/${origSig.joints.length} joints ` +
      `vs retargeted ${newSig.nodeCount} nodes/${newSig.joints.length} joints; ` +
      'mixamorig:* vs Tripo biped names), graft would need a re-rig';
    refused++;
    continue;
  }

  if (!WRITE) {
    row.graft = 'ready (check mode)';
    row.reason = 'skeletons identical; re-run with --write to graft';
    continue;
  }

  // Graft: replace ONLY the synthesized Death.
  if (synthDeath) disposeAnimation(synthDeath);
  const { target: grafted, dropped } = copyAnimationByName(originalDoc, realDeath, 'Death');
  if (dropped > 0) {
    row.reason = `${dropped} Death channels had no named target in the original rig`;
    refused++;
    continue;
  }
  if (clipDuration(grafted) > DEATH_MAX_SECONDS) trimAnimation(grafted, DEATH_MAX_SECONDS);

  // Meshopt: the extension is already on the document and the encoder is
  // registered, so the write re-compresses like _add_orc_death_anim.mjs.
  await io.write(orc.original, originalDoc);

  // Re-read and validate the written file.
  const checkDoc = await io.read(orc.original);
  const checkRoot = checkDoc.getRoot();
  const clips = checkRoot.listAnimations().map((a) => a.getName());
  const clipSetOk =
    clips.length === REQUIRED_CLIPS.length &&
    REQUIRED_CLIPS.every((name) => clips.includes(name)) &&
    originalClips.filter((n) => n !== 'Death').every((n) => clips.includes(n));
  const death = checkRoot.listAnimations().find((a) => a.getName() === 'Death');
  const deathDuration = death ? clipDuration(death) : NaN;
  const meshopt = checkRoot
    .listExtensionsUsed()
    .some((ext) => ext.extensionName === 'EXT_meshopt_compression');
  const afterBytes = statSync(orc.original).size;

  row.deathDuration = `${deathDuration.toFixed(3)}s`;
  row.bytes = `${beforeBytes} -> ${afterBytes}`;
  const ok =
    clipSetOk && Number.isFinite(deathDuration) && deathDuration <= DEATH_MAX_SECONDS && meshopt;
  row.graft = ok ? 'yes' : 'FAILED VALIDATION';
  row.reason = ok
    ? `clips ${clipSetOk ? 'ok' : 'MISMATCH'}, meshopt ${meshopt ? 'ok' : 'MISSING'}`
    : `clipSetOk=${clipSetOk} duration=${deathDuration.toFixed(3)} meshopt=${meshopt}`;
  if (!ok) refused++;
}

console.log('\n=== graft summary ===');
console.log('orc         | graft | Death dur | bytes | note');
for (const row of rows) {
  console.log(
    `${row.key.padEnd(11)} | ${row.graft.padEnd(5)} | ${row.deathDuration.padEnd(9)} | ` +
      `${row.bytes.padEnd(5)} | ${row.reason}`,
  );
}

if (refused > 0) {
  console.log(
    `\n${refused} orc(s) not grafted; original GLBs were NOT modified. ` +
      'See the header comment for why.',
  );
  process.exit(1);
}
