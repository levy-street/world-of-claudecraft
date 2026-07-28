// Synthesize a 'Death' collapse (and a short 'Hit' flinch) into the three
// Orkadia orc GLBs (black/blue/red), the same approach _add_cantor_hit_anim.mjs
// used for the Stone Cantor: the Tripo rigs ship Idle/Walk/Sprint/Punch/Sword
// takes only, no death or hit-react, so ORC_TRIPO used to alias death to the
// idle pose. This authors the missing clips on the shipped Mixamo-named skeleton
// (mixamorig:Hips ... mixamorig:Head).
//
//   node scripts/_add_orc_death_anim.mjs [in.glb] [out.glb]
//
// With no args it edits all three creature GLBs in place; with args it processes
// the one file. Idempotent: existing 'Death'/'Hit' clips are dropped before
// re-authoring, and the shipped locomotion/attack takes are untouched. Meshopt
// compression is preserved on write (the encoder is registered like the cantor
// script) so the GLBs stay small.
//
// Death: the whole body tips about its own left-right axis (the arms span local
// X, so a rotation about world X reads as a forward/backward fall, never a
// sideways slump) while the hips sink toward the floor, ending clamped flat.
// visual.ts plays death as a clamped LoopOnce, so the last frame is the resting
// corpse pose.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const DEFAULT_FILES = ['black_orc', 'blue_orc', 'red_orc'].map(
  (n) => `public/models/creatures/${n}.glb`,
);
const FILES =
  process.argv[2] !== undefined
    ? [[process.argv[2], process.argv[3] ?? process.argv[2]]]
    : DEFAULT_FILES.map((f) => [f, f]);

// --- quaternion helpers (Hamilton product; a*b applies b then a) -------------
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qAboutX = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];

// --- minimal TRS -> world-matrix eval (to measure standing hip/foot height) --
const trs = (t, q, s) => {
  const [x, y, z, w] = q;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2,
    yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  const [sx, sy, sz] = s;
  // column-major 4x4 (glTF/three convention)
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
};
const matMul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const worldY = (node) => {
  let m = trs(node.getTranslation(), node.getRotation(), node.getScale());
  for (let p = node.getParentNode(); p; p = p.getParentNode())
    m = matMul(trs(p.getTranslation(), p.getRotation(), p.getScale()), m);
  return m[13];
};

// --- clip timelines ----------------------------------------------------------
// Death: ~1.15s. The tip accelerates (a fall under gravity), the sink lags and
// then catches up, and both settle on the last (clamped) key.
const D_TIMES = [0, 0.14, 0.42, 0.72, 0.95, 1.15];
const D_TIP = [0, 0.04, 0.24, 0.62, 0.98, 1.0]; // fraction of the full topple
const D_SINK = [0, 0.0, 0.08, 0.42, 0.9, 1.0]; // fraction of the ground drop
const D_LIMP = [0, 0.05, 0.25, 0.65, 0.95, 1.0]; // secondary slump follows the fall
const TIP_PEAK = -1.5; // rad (~86deg): flat on the back, a touch short of vertical

// Secondary bones slumped in each joint's LOCAL X (pitch), layered on rest, so
// the plank of a rigid hip-only rotation reads as a limp collapse instead.
const SLUMP_BONES = [
  { name: 'mixamorig:Spine', peak: 0.1 },
  { name: 'mixamorig:Spine1', peak: 0.12 },
  { name: 'mixamorig:Spine2', peak: 0.12 },
  { name: 'mixamorig:Neck', peak: 0.18 },
  { name: 'mixamorig:Head', peak: 0.3 },
  { name: 'mixamorig:LeftLeg', peak: 0.28 }, // knees buckle
  { name: 'mixamorig:RightLeg', peak: 0.24 },
];

// Hit: a fast spine/neck/head flinch that settles back to rest (cantor's shape).
const H_TIMES = [0, 0.08, 0.26, 0.45];
const H_ENV = [0, 1, 0.3, 0];
const FLINCH_BONES = [
  { name: 'mixamorig:Spine1', peak: -0.1 },
  { name: 'mixamorig:Spine2', peak: -0.14 },
  { name: 'mixamorig:Neck', peak: -0.18 },
  { name: 'mixamorig:Head', peak: -0.24 },
];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

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

async function processFile(inPath, outPath) {
  const doc = await io.read(inPath);
  const root = doc.getRoot();
  // Idempotency: drop a prior Death/Hit AND the accessors it owns. Disposing an
  // Animation leaves its input/output accessors orphaned in the buffer (prune
  // does not reclaim them), so re-runs would grow the GLB without this.
  for (const anim of root.listAnimations()) {
    const n = anim.getName();
    if (n !== 'Death' && n !== 'Hit') continue;
    for (const s of anim.listSamplers()) {
      s.getInput()?.dispose();
      s.getOutput()?.dispose();
    }
    anim.dispose();
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

  // Ground drop: from the standing hip height down to a hand-span above the
  // floor so the toppled body rests on the ground rather than floating at hip
  // height. Feet sit below the GLB origin (renderer re-seats them to y=0), so
  // the standing hip height in the GLB frame is that foot depth.
  const hips = need('mixamorig:Hips');
  const hipT = hips.getTranslation();
  const hipRest = hips.getRotation();
  const footDepth = worldY(need('mixamorig:LeftFoot')) - worldY(hips); // negative
  const sinkWorld = Math.max(0.2, -footDepth - 0.12); // meters, world frame
  // Armature is +90deg about X at 0.01 scale, so a world -Y drop of `d` is a
  // hips-local +Z of 100*d (inverse scale, inverse armature rotation).
  const sinkLocalZ = 100 * sinkWorld;

  const death = doc.createAnimation('Death');
  // Hips: world-X topple (pre-multiply) + downward sink (local +Z).
  addChannel(
    doc,
    buffer,
    death,
    hips,
    'rotation',
    D_TIMES,
    D_TIP.flatMap((f) => qMul(qAboutX(TIP_PEAK * f), hipRest)),
    'orcDeathHipRot',
  );
  addChannel(
    doc,
    buffer,
    death,
    hips,
    'translation',
    D_TIMES,
    D_SINK.flatMap((f) => [hipT[0], hipT[1], hipT[2] + sinkLocalZ * f]),
    'orcDeathHipPos',
  );
  for (const { name, peak } of SLUMP_BONES) {
    const node = need(name);
    const rest = node.getRotation();
    addChannel(
      doc,
      buffer,
      death,
      node,
      'rotation',
      D_TIMES,
      D_LIMP.flatMap((f) => qMul(rest, qAboutX(peak * f))),
      `orcDeathSlump_${name}`,
    );
  }

  const hit = doc.createAnimation('Hit');
  for (const { name, peak } of FLINCH_BONES) {
    const node = need(name);
    const rest = node.getRotation();
    addChannel(
      doc,
      buffer,
      hit,
      node,
      'rotation',
      H_TIMES,
      H_ENV.flatMap((amount) => qMul(rest, qAboutX(peak * amount))),
      `orcHit_${name}`,
    );
  }

  await io.write(outPath, doc);
  const clips = root.listAnimations().map((a) => a.getName());
  console.log(`wrote ${outPath} (sink ${sinkWorld.toFixed(2)}m) clips: ${clips.join(', ')}`);
}

for (const [inPath, outPath] of FILES) await processFile(inPath, outPath);
