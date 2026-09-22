// Measure a rig's natural walk/run world speed, so `VisualDef.walkRef` / `runRef`
// are MEASURED rather than guessed.
//
// Why this exists: `locomotionTimeScale` (src/render/characters/anim_state.ts)
// divides the body's real speed by these refs to pick the clip's playback rate,
// then clamps. A ref that is too low over-drives the cycle and the feet skate; too
// high and the character moon-walks. The defaults are tuned for the humanoid rigs,
// so any creature with a different stride or scale needs its own pair, and the
// dragonkin defs are the precedent for measuring instead of eyeballing (reusing the
// broodlord's refs on the larger matriarch over-strode her by 25%).
//
// The quantity being measured is the clip's OWN natural world speed:
//
//   ref = 2 * stride * normScale * entityScale / duration
//
// stride is the largest horizontal separation the two feet reach during the cycle
// (one step); doubled because a full cycle is two steps. normScale is what the
// renderer applies to bring the model to `VisualDef.height`, and entityScale is the
// mob template's own scale. Both scales matter because the matcher compares against
// a world-unit speed, so the same clip on a bigger body covers more ground.
//
// Usage:
//   node scripts/anim/measure_gait.mjs <glb> --height <VisualDef.height> [--scale N]
//                                      [--walk Walk] [--run Run]
//
// Output is the two numbers plus the intermediate terms, so a reviewer can check
// the arithmetic rather than trusting it. Nothing is written; this only reads.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SRC = argv.find(
  (a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true,
);
const HEIGHT = Number(flag('height', '0'));
const ENTITY_SCALE = Number(flag('scale', '1'));
const WALK = flag('walk', 'Walk');
const RUN = flag('run', 'Run');

if (!SRC || !HEIGHT) {
  console.error('usage: node scripts/anim/measure_gait.mjs <glb> --height <n> [--scale n]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
});
const doc = await io.read(SRC);
const root = doc.getRoot();

// --- matrix helpers (column-major 4x4, same convention as glTF) --------------
const mul = (a, b) => {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
};
const compose = (t, q, s) => {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const m = new Float64Array(16);
  m[0] = (1 - (y * y2 + z * z2)) * s[0];
  m[1] = (x * y2 + w * z2) * s[0];
  m[2] = (x * z2 - w * y2) * s[0];
  m[4] = (x * y2 - w * z2) * s[1];
  m[5] = (1 - (x * x2 + z * z2)) * s[1];
  m[6] = (y * z2 + w * x2) * s[1];
  m[8] = (x * z2 + w * y2) * s[2];
  m[9] = (y * z2 - w * x2) * s[2];
  m[10] = (1 - (x * x2 + y * y2)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
};

// --- clip sampling -----------------------------------------------------------
/** Nearest-key sample of a channel, which is enough for a max-separation search. */
function sampleAt(times, values, stride, t) {
  let i = 0;
  while (i < times.length - 1 && times[i + 1] < t) i++;
  return Array.from(values.slice(i * stride, i * stride + stride));
}

function clipByName(name) {
  return root.listAnimations().find((a) => a.getName() === name) ?? null;
}

/** node -> {T,R,S} at time t, falling back to the node's own rest transform. */
function poseAt(anim, t) {
  const pose = new Map();
  if (!anim) return pose;
  for (const channel of anim.listChannels()) {
    const node = channel.getTargetNode();
    const sampler = channel.getSampler();
    if (!node || !sampler) continue;
    const times = sampler.getInput().getArray();
    const values = sampler.getOutput().getArray();
    const path = channel.getTargetPath();
    const stride = path === 'rotation' ? 4 : 3;
    const entry = pose.get(node) ?? {};
    entry[path] = sampleAt(times, values, stride, t);
    pose.set(node, entry);
  }
  return pose;
}

/** World matrix of every node under the scene, honouring the sampled pose. */
function worldMatrices(pose) {
  const out = new Map();
  const walk = (node, parent) => {
    const p = pose.get(node) ?? {};
    const local = compose(
      p.translation ?? node.getTranslation(),
      p.rotation ?? node.getRotation(),
      p.scale ?? node.getScale(),
    );
    const world = parent ? mul(parent, local) : local;
    out.set(node, world);
    for (const child of node.listChildren()) walk(child, world);
  };
  for (const scene of root.listScenes()) for (const n of scene.listChildren()) walk(n, null);
  return out;
}

const FOOT_PATTERNS = [/foot/i, /ankle/i, /toe/i, /^l_?leg|^r_?leg/i];
function footNodes() {
  const nodes = root.listNodes().filter((n) => FOOT_PATTERNS.some((p) => p.test(n.getName())));
  // Prefer an explicit left/right pair over a longer ambiguous list.
  const left = nodes.find((n) => /(^|[^a-z])(l|left)([^a-z]|$)/i.test(n.getName()));
  const right = nodes.find((n) => /(^|[^a-z])(r|right)([^a-z]|$)/i.test(n.getName()));
  return left && right ? [left, right] : nodes.slice(0, 2);
}

const feet = footNodes();
if (feet.length < 2) {
  console.error(
    `could not identify two foot bones; saw: ${root
      .listNodes()
      .map((n) => n.getName())
      .join(', ')}`,
  );
  process.exit(1);
}
console.log(`feet: ${feet.map((f) => f.getName()).join(', ')}`);

/**
 * Bind-pose MESH height, which is what the renderer normalizes against.
 *
 * Deliberately not the bone bounds: a skeleton's topmost joint sits inside the
 * skull, well below the crown, and the toe joints sit above the sole, so bone
 * bounds under-measure the body and hand back a normalize scale that is far too
 * large (on this rig, 6.2 instead of ~3.6). Every ref derived from it would then
 * be inflated by the same factor and the gait would moon-walk.
 */
function restHeight() {
  let lo = Infinity;
  let hi = -Infinity;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      // A skinned primitive's vertices are already in skin space, so the
      // accessor's own extent IS the bind-pose extent.
      lo = Math.min(lo, pos.getMin([])[1]);
      hi = Math.max(hi, pos.getMax([])[1]);
    }
  }
  return Number.isFinite(hi - lo) ? hi - lo : 0;
}

function measure(clipName) {
  const anim = clipByName(clipName);
  if (!anim) return null;
  let duration = 0;
  for (const ch of anim.listChannels()) {
    const times = ch.getSampler()?.getInput()?.getArray();
    if (times?.length) duration = Math.max(duration, times[times.length - 1]);
  }
  if (duration <= 0) return null;
  let stride = 0;
  const STEPS = 60;
  for (let i = 0; i <= STEPS; i++) {
    const world = worldMatrices(poseAt(anim, (duration * i) / STEPS));
    const a = world.get(feet[0]);
    const b = world.get(feet[1]);
    if (!a || !b) continue;
    stride = Math.max(stride, Math.hypot(a[12] - b[12], a[14] - b[14]));
  }
  return { duration, stride };
}

const natural = restHeight();
const normScale = natural > 0 ? HEIGHT / natural : 1;
console.log(
  `rest height ${natural.toFixed(3)} -> VisualDef.height ${HEIGHT}, normScale ${normScale.toFixed(4)}`,
);
console.log(`entityScale ${ENTITY_SCALE}`);

for (const [label, clipName] of [
  ['walkRef', WALK],
  ['runRef', RUN],
]) {
  const m = measure(clipName);
  if (!m) {
    console.log(`${label}: clip '${clipName}' not found or has no keys`);
    continue;
  }
  const ref = (2 * m.stride * normScale * ENTITY_SCALE) / m.duration;
  console.log(
    `${label}: ${ref.toFixed(2)}  (clip '${clipName}': stride ${m.stride.toFixed(3)}, duration ${m.duration.toFixed(3)}s)`,
  );
}
