// Build a second hit-reaction clip for every KayKit-family rig (issue #2889):
// visual.ts's playHit() already picks randomly from ClipMap.hit (a string[]),
// but every kaykit()/skeletonClips() consumer today ships exactly one entry
// (Hit_A), so the randomness is live and unused. This authors Hit_B_Stagger,
// a brief off-balance lean synthesized by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off donor poses already baked into each
// rig's OWN clip library: Idle (the bookend) and Running_Strafe_Right (the
// lean donor, sampled early to read as a reactive stagger, not a strafe
// run). No Blender: same technique as scripts/build_mage_ability_anims.mjs.
//
// Every distinct GLB file reached by kaykit()/skeletonClips() in
// src/render/characters/manifest.ts ships identical Idle (1.067s), Hit_A
// (0.667s), and Running_Strafe_Left/Right (0.8s) clips (verified: same clip
// names, same durations, across all 10 player-family files AND the 5
// skeleton/necromancer-family files). The skeleton family's Idle/Hit_A/
// Running_Strafe_* channel-key sets are a strict SUPERSET of the player
// family's (54 extra IK control-bone channels: IK-foot/IK-toe/control-*-roll/
// elbowIK/kneeIK/handIK/heelIK; every core deform-bone key the player rig
// animates is present under the identical name on the skeleton rig too), so
// one script parameterized by source path, run once per file, is correct and
// safe for the whole family.
//
// Usage: node scripts/build_kaykit_hit_variety_anims.mjs [--preview]
// Output (production): one <basename>_hit_variety_anims.glb per source,
// alongside the source (0 meshes/skins, 1 clip: Hit_B_Stagger).
// Output (--preview): tmp/knight_hit_variety_preview.glb only (the
// representative rig; every source shares the identical technique and
// timestamps, verified above, so one visual check stands for the family).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  createGlbIO,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  mergePoses,
  poseValue,
  pushPoseRamp,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PREVIEW = process.argv.includes('--preview');

const SOURCES = [
  { src: 'chars/players/knight.glb', out: 'chars/players/knight_hit_variety_anims.glb' },
  { src: 'chars/players/paladin.glb', out: 'chars/players/paladin_hit_variety_anims.glb' },
  { src: 'chars/players/ranger.glb', out: 'chars/players/ranger_hit_variety_anims.glb' },
  { src: 'chars/players/rogue.glb', out: 'chars/players/rogue_hit_variety_anims.glb' },
  { src: 'chars/players/mage.glb', out: 'chars/players/mage_hit_variety_anims.glb' },
  { src: 'chars/players/barbarian.glb', out: 'chars/players/barbarian_hit_variety_anims.glb' },
  { src: 'chars/players/druid.glb', out: 'chars/players/druid_hit_variety_anims.glb' },
  {
    src: 'chars/players/mage_classic.glb',
    out: 'chars/players/mage_classic_hit_variety_anims.glb',
  },
  {
    src: 'chars/players/rogue_hooded.glb',
    out: 'chars/players/rogue_hooded_hit_variety_anims.glb',
  },
  {
    src: 'chars/players/Mech/characters/CombatMech.glb',
    out: 'chars/players/Mech/characters/CombatMech_hit_variety_anims.glb',
  },
  {
    src: 'chars/enemies/skeleton_minion.glb',
    out: 'chars/enemies/skeleton_minion_hit_variety_anims.glb',
  },
  {
    src: 'chars/enemies/skeleton_rogue.glb',
    out: 'chars/enemies/skeleton_rogue_hit_variety_anims.glb',
  },
  {
    src: 'chars/enemies/skeleton_warrior.glb',
    out: 'chars/enemies/skeleton_warrior_hit_variety_anims.glb',
  },
  {
    src: 'chars/enemies/skeleton_mage.glb',
    out: 'chars/enemies/skeleton_mage_hit_variety_anims.glb',
  },
  { src: 'chars/enemies/necromancer.glb', out: 'chars/enemies/necromancer_hit_variety_anims.glb' },
];

const io = createGlbIO();

async function bakeOne({ src, out }, writePreview) {
  const doc = await io.read(resolve(ROOT, 'public/models', src));
  const root = doc.getRoot();

  const idleIdx = indexClip(root, 'Idle');
  const strafeIdx = indexClip(root, 'Running_Strafe_Right');
  const allKeys = new Set([...idleIdx.keys(), ...strafeIdx.keys()]);
  const donorFor = (key) => strafeIdx.get(key) ?? idleIdx.get(key);

  // Donor poses, sampled within each clip's real duration (Idle 1.067s,
  // Running_Strafe_Right 0.8s, identical across all 15 sources, verified).
  const P_idle = samplePose(idleIdx, 0.3);
  const P_leanIn = samplePose(strafeIdx, 0.15); // off-balance shift begins
  const P_leanPeak = samplePose(strafeIdx, 0.45); // peak stagger displacement
  const P_all = mergePoses(P_idle, P_leanIn, P_leanPeak);

  const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
  pushPoseRamp(timeline, {
    fromTime: 0,
    toTime: 0.1,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_leanIn,
    fallback: P_all,
  });
  pushPoseRamp(timeline, {
    fromTime: 0.1,
    toTime: 0.22,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_leanIn,
    toPose: P_leanPeak,
    fallback: P_all,
  });
  timeline.push([0.3, (k) => poseValue(P_leanPeak, k, P_all)]); // brief off-balance hold
  pushPoseRamp(timeline, {
    fromTime: 0.3,
    toTime: 0.52,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_leanPeak,
    toPose: P_idle,
    fallback: P_all,
  });

  const { animation } = bakeClip(doc, {
    clipName: 'Hit_B_Stagger',
    channelKeys: allKeys,
    timeline,
    donorFor,
  });

  if (writePreview) {
    const previewOut = resolve(ROOT, 'tmp/knight_hit_variety_preview.glb');
    await io.write(previewOut, doc);
    console.log(`wrote preview (mesh + skin + clip): ${previewOut}`);
    return;
  }

  stripToAnimationsOnly(doc, [animation]);
  await doc.transform(prune(), dedup());
  const outPath = resolve(ROOT, 'public/models', out);
  await io.write(outPath, doc);
  console.log(`wrote ${outPath}`);
}

if (PREVIEW) {
  await bakeOne(SOURCES[0], true);
} else {
  for (const entry of SOURCES) await bakeOne(entry, false);
}
