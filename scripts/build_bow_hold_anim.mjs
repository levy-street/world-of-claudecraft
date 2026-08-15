// Build the hunter's held-bow CAST pose clip GLB.
//
// A cast-time shot (Long Draw, castTime 3.0) is a HELD base state, so the rig
// plays a looping clip for its whole duration. Every class gets `Spellcasting`
// from the shared kaykit() ClipMap, which is a caster's arm-circling gesture:
// a hunter mid-draw looked like a mage waving at a bow. This clip is the pose
// that state should hold instead, a static full draw.
//
// Unlike build_bow_anims.mjs, this script needs NO external donor pack. The
// KayKit source (2H_Ranged_Aiming, 2H_Ranged_Reload) is not in this repo and
// the shipped rigs were trimmed to a small clip set that omits it, so the draw
// hold is not reachable from anything on disk EXCEPT the clip we already
// authored from it: bow_anims.glb keyframes the full-draw hold at 0.46 to 0.55
// (see the timeline in build_bow_anims.mjs). This resamples our own output at
// that moment, which keeps the two clips defined by construction to share a
// pose, so a re-bake of the draw cannot silently drift from the hold.
//
//   node scripts/build_bow_hold_anim.mjs
//
// Input:  public/models/chars/players/bow_anims.glb  (clip: Bow_Draw_Shot)
// Output: public/models/chars/players/bow_hold_anim.glb (clip: Bow_Draw_Hold)

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export const HOLD_CLIP_NAME = 'Bow_Draw_Hold';
export const SOURCE_CLIP_NAME = 'Bow_Draw_Shot';
/** Inside the authored draw's hold window (0.46 to 0.55 in build_bow_anims.mjs),
 *  far enough off 0.46 that a linear segment ending there is fully settled. */
export const HOLD_SAMPLE_AT = 0.5;
/** The held pose is static, so two keys are enough; the second exists only so
 *  the clip has a positive duration and can loop like any other base state. */
export const HOLD_DURATION = 1;

const IN = resolve(ROOT, 'public/models/chars/players/bow_anims.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/bow_hold_anim.glb');

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(IN);
const root = doc.getRoot();

const source = root.listAnimations().find((a) => a.getName() === SOURCE_CLIP_NAME);
if (!source) throw new Error(`${IN} has no ${SOURCE_CLIP_NAME} clip`);

/** Sample one channel at absolute time t: the last key at or before t, then a
 *  linear/slerp blend into the next. The source is authored LINEAR throughout
 *  (build_bow_anims.mjs sets it explicitly), so this reproduces exactly what
 *  the mixer shows at that instant. */
function sampleAt(times, values, size, t, isRotation) {
  const n = times.length;
  if (n === 0) return null;
  if (t <= times[0]) return [...values.slice(0, size)];
  if (t >= times[n - 1]) return [...values.slice((n - 1) * size, n * size)];
  let i = 0;
  while (i < n - 1 && times[i + 1] < t) i++;
  const span = times[i + 1] - times[i];
  const f = span > 1e-9 ? (t - times[i]) / span : 0;
  const a = [...values.slice(i * size, (i + 1) * size)];
  const b = [...values.slice((i + 1) * size, (i + 2) * size)];
  if (!isRotation) return a.map((v, k) => v + (b[k] - v) * f);
  // shortest-arc slerp
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    const out = [
      a[0] + (bx - a[0]) * f,
      a[1] + (by - a[1]) * f,
      a[2] + (bz - a[2]) * f,
      a[3] + (bw - a[3]) * f,
    ];
    const len = Math.hypot(...out) || 1;
    return out.map((v) => v / len);
  }
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - f) * theta) / s;
  const wb = Math.sin(f * theta) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

const buffer = root.listBuffers()[0];
const hold = doc.createAnimation(HOLD_CLIP_NAME);
const times = new Float32Array([0, HOLD_DURATION]);
const input = doc
  .createAccessor(`${HOLD_CLIP_NAME}_times`)
  .setArray(times)
  .setType('SCALAR')
  .setBuffer(buffer);

let authored = 0;
for (const channel of source.listChannels()) {
  const node = channel.getTargetNode();
  const path = channel.getTargetPath();
  const sampler = channel.getSampler();
  if (!node || !sampler) continue;
  const inArr = sampler.getInput().getArray();
  const outArr = sampler.getOutput().getArray();
  const size = path === 'rotation' ? 4 : 3;
  const pose = sampleAt(inArr, outArr, size, HOLD_SAMPLE_AT, path === 'rotation');
  if (!pose) continue;
  const output = doc
    .createAccessor(`${HOLD_CLIP_NAME}_${node.getName()}_${path}`)
    // Same pose at both keys: a static hold, not a drift.
    .setArray(new Float32Array([...pose, ...pose]))
    .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
    .setBuffer(buffer);
  const holdSampler = doc
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation('LINEAR');
  hold
    .addSampler(holdSampler)
    .addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(holdSampler),
    );
  authored++;
}
if (authored === 0) throw new Error('no channels authored');

// Drop the source clip: this GLB ships the hold only (the draw already ships in
// bow_anims.glb, and duplicating it would bind two actions to the same name).
for (const a of root.listAnimations()) {
  if (a === hold) continue;
  for (const channel of a.listChannels()) channel.dispose();
  for (const sampler of a.listSamplers()) sampler.dispose();
  a.dispose();
}
for (const mesh of root.listMeshes()) mesh.dispose();
for (const skin of root.listSkins()) skin.dispose();

await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
console.log(`channels authored: ${authored}, sampled ${SOURCE_CLIP_NAME} at ${HOLD_SAMPLE_AT}s`);
