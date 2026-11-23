// Frame-by-frame floor and flick report for one clip of a wolf GLB, skinned with
// standard glTF math (skin_pose.mjs), so it reads the shipped file exactly as the
// game draws it.
//
//   node scripts/assets/wolf_rig/clip_check.mjs <file.glb> <clip> [fps] [--donor <clips.glb>]
//
// --donor takes the clip from a mesh-free clip file instead, bound by joint name as
// the game binds a donor clip (a VisualDef's animUrls).
//
// Every frame prints the height above the ground of the lowest point of each region
// (paw soles, the lower limbs above them, the body, the tail), then the biggest
// single joint turn since the previous frame. The ground is where the game stands the
// wolf: the Idle's lowest point at the moment prepareVisual measures it (skin_pose.mjs
// idleGround). Negative heights go through the floor; a flick shows as one step far
// above its neighbours. The last lines give each region's lowest point over the clip
// and the biggest step.
import {
  biggestTurn,
  clipDuration,
  idleGround,
  localPose,
  lowestByRegion,
  REGIONS,
  readWolfGlb,
  rigOf,
} from './skin_pose.mjs';

const args = process.argv.slice(2);
const donorAt = args.indexOf('--donor');
const donorFile = donorAt >= 0 ? args.splice(donorAt, 2)[1] : null;
const [file, clipName, fpsArg] = args;
if (!file || !clipName) {
  console.error(
    'usage: node scripts/assets/wolf_rig/clip_check.mjs <file.glb> <clip> [fps] [--donor <clips.glb>]',
  );
  process.exit(2);
}
const fps = Number(fpsArg ?? 30);
const root = await readWolfGlb(file);
const clipRoot = donorFile ? await readWolfGlb(donorFile) : root;
const anim = clipRoot.listAnimations().find((a) => a.getName() === clipName);
if (!anim) {
  const names = clipRoot.listAnimations().map((a) => a.getName());
  console.error(`no clip '${clipName}' in ${donorFile ?? file}; clips: ${names.join(', ')}`);
  process.exit(2);
}
const rig = rigOf(root);
const ground = idleGround(rig, root);

const dur = clipDuration(anim);
const frames = Math.round(dur * fps);
const lowest = {};
let worst = { step: 0, bone: '', t: 0 };
let prev = null;
const unbound = new Set();
const fmt = (v) => (v === undefined ? '-' : v.toFixed(3)).padStart(9);
console.log(
  `${file} ${clipName}: ${dur.toFixed(2)} s at ${fps} fps, ground y ${ground.toFixed(3)}`,
);
console.log(`  t     ${REGIONS.map((r) => r.padStart(9)).join('')}   step`);
for (let f = 0; f <= frames; f++) {
  const t = Math.min(dur, f / fps);
  const pose = localPose(rig, anim, t);
  for (const name of pose.unbound) unbound.add(name);
  const low = lowestByRegion(rig, pose.local);
  const turn = prev ? biggestTurn(prev, pose.local) : { step: 0, bone: '' };
  prev = pose.local;
  if (turn.step > worst.step) worst = { ...turn, t };
  const heights = {};
  for (const r of REGIONS) {
    if (!(r in low)) continue;
    heights[r] = low[r] - ground;
    if (!(r in lowest) || heights[r] < lowest[r]) lowest[r] = heights[r];
  }
  const cells = REGIONS.map((r) => fmt(heights[r])).join('');
  console.log(`  ${t.toFixed(2)}  ${cells}   ${turn.step.toFixed(1).padStart(5)} ${turn.bone}`);
}
console.log(`  lowest${REGIONS.map((r) => fmt(lowest[r])).join('')}`);
console.log(
  `  biggest step ${worst.step.toFixed(1)} deg (${worst.bone} at ${worst.t.toFixed(2)} s)`,
);
if (unbound.size)
  console.log(`  UNBOUND channels (no joint of that name): ${[...unbound].join(', ')}`);
