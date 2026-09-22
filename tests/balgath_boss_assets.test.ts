// Balgath, the Mirefen world boss: the shipped asset and wiring contract.
//
// The failure this exists to catch is silent in every other layer. A rebake that renames
// or drops a clip, or a manifest edit naming a clip the GLB does not carry, produces no
// build error and no load error: the mixer simply finds no action and the rig sits in
// BIND POSE the first time the mechanic fires, in a raid, in production. So both halves
// are pinned here, the clip names actually inside the GLBs and the manifest source that
// names them, plus the cross-layer welds nothing else can see.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGlbIO, indexClip, sampleChannel } from '../scripts/anim/pose_blend.mjs';
import { loadRigPoser, type PosedSkeleton } from './helpers/gltf_pose';

const ROOT = resolve(__dirname, '..');
const RIG = resolve(ROOT, 'public/models/creatures/balgath_cyclops.glb');
const ABILITIES = resolve(ROOT, 'public/models/creatures/balgath_ability_anims.glb');
const DONOR = resolve(ROOT, 'public/models/creatures/balgath_clip_donor.glb');
const MANIFEST = resolve(ROOT, 'src/render/characters/manifest.ts');
const ZONE = resolve(ROOT, 'src/sim/content/zone2.ts');

function glbJson(path: string): {
  animations?: Array<{ name?: string; channels?: Array<{ target: { node?: number } }> }>;
  meshes?: unknown[];
  skins?: Array<{ joints: number[] }>;
  nodes: Array<{ name?: string }>;
} {
  const buf = readFileSync(path);
  // glTF binary: 12-byte header, then chunks of [length u32][type u32][data]. The JSON
  // chunk is always first per the spec.
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
}
const clipNames = (path: string): string[] =>
  (glbJson(path).animations ?? []).map((a) => a.name ?? '');
function jointNames(path: string): string[] {
  const json = glbJson(path);
  return (json.skins?.[0]?.joints ?? []).map((i) => json.nodes[i].name as string);
}

/** The shared BALGATH ClipMap literal, as source text. */
function clipMapSource(): string {
  const src = readFileSync(MANIFEST, 'utf8');
  const start = src.indexOf('const BALGATH: ClipMap = {');
  expect(start, 'the shared BALGATH ClipMap is missing').toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n};', start));
}

/** A named VisualDef object literal, as source text. */
function defBlock(key: string): string {
  const src = readFileSync(MANIFEST, 'utf8');
  const start = src.indexOf(`${key}: {`);
  expect(start, `${key} is missing from VISUALS`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n  },', start));
}

/** The mob template literal, as source text. */
function templateSource(): string {
  const zone = readFileSync(ZONE, 'utf8');
  const start = zone.indexOf('balgath_cyclops: {');
  expect(start, 'the balgath_cyclops template is missing').toBeGreaterThan(-1);
  return zone.slice(start, zone.indexOf('\n  },', start));
}

// The authored set, and what each is FOR. A clip dropped from this list is a mechanic
// with no animation, so the list is exhaustive on purpose.
const AUTHORED = [
  'Balgath_Smash', // the telegraphed circle-smash payoff
  'Balgath_Stomp', // the telegraphed shockwave stomp
  'Balgath_EyeFlare', // the scry channel under the cast bar
  'Balgath_Blinded', // the low-level counterplay, loops for the debuff
  'Balgath_Roar', // the enrage flourish
  'Balgath_Sleep', // the night: folded into a mound and breathing, loops until dawn
  'Balgath_Wake', // the dawn rise, out of the sleep pose
  'Balgath_Swipe', // the ORDINARY auto-attack, kept small so the slams stay rare
  'Balgath_Barrowsweep', // the mid-run backhand: its legs are sampled off the Run cycle
  'Balgath_Barrowfall', // the warpath arrival slam, timed to its own telegraph fuse
  'Balgath_Hammer', // whack-a-mole: ONE fist up, held, dropped on a snapshot
  'Balgath_Cleave', // the low arc, authored as a body twist at the root
];

/** What the Tripo creature lane retargeted onto the rig. */
const RETARGETED = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Cast', 'Jump'];

describe('balgath world boss assets', () => {
  it('ships every retargeted clip on the rig', () => {
    const names = clipNames(RIG);
    for (const clip of RETARGETED) expect(names).toContain(clip);
  });

  it('ships every authored clip in the donor GLB', () => {
    expect(clipNames(ABILITIES).sort()).toEqual([...AUTHORED].sort());
  });

  it('keeps the ability donor mesh-free so it composes instead of shadowing', () => {
    // A donor carrying its own mesh and skin would be a second complete body loaded
    // beside the rig, and its inherited Idle/Walk would shadow the rig's own.
    const json = glbJson(ABILITIES);
    expect(json.meshes ?? []).toHaveLength(0);
    expect(json.skins ?? []).toHaveLength(0);
  });

  it('keeps the clip-authoring donor rig, mesh-free, so the clips stay reproducible', () => {
    // The authored clips were sampled from the FOREMAN candidate's retargeted poses. That
    // body lost the design bake-off and its mesh is deleted; this stripped rig is what is
    // left of it, and without it scripts/build_balgath_anims.mjs cannot run at all.
    const names = clipNames(DONOR);
    for (const clip of RETARGETED) expect(names).toContain(clip);
    expect(glbJson(DONOR).meshes ?? [], 'the donor must stay mesh-free').toHaveLength(0);
    expect(readFileSync(resolve(ROOT, 'scripts/build_balgath_anims.mjs'), 'utf8')).toContain(
      'balgath_clip_donor.glb',
    );
  });

  it('targets only bones the rig actually has, which is what lets the clips bind', () => {
    // The authored poses play on the cyclops only because three.js binds a clip to a
    // skeleton BY NODE NAME, and the two Tripo auto-rigs came back with the same joints
    // under the same names. This is that assumption made explicit: every node the shipped
    // clips drive must be a joint on the rig they are composed onto. A re-generated rig
    // with one renamed joint would bind that channel to nothing and the boss would sit in
    // bind pose the first time the mechanic fired, with no error anywhere.
    // Compared against the rig's whole NODE graph, not just its skin joints: three binds
    // a track by name against the object it is mounted on, and the clips legitimately
    // drive the armature root as well as the 41 skinned bones.
    expect(jointNames(RIG)).toHaveLength(41);
    const rig = new Set((glbJson(RIG).nodes ?? []).map((n) => n.name).filter(Boolean) as string[]);
    const json = glbJson(ABILITIES);
    const targeted = new Set<string>();
    for (const anim of json.animations ?? [])
      for (const ch of anim.channels ?? []) {
        const name = ch.target.node === undefined ? undefined : json.nodes[ch.target.node]?.name;
        if (name) targeted.add(name);
      }
    expect(targeted.size, 'the donor drives no bones at all').toBeGreaterThan(20);
    for (const bone of targeted)
      expect(rig, `clip bone '${bone}' is not on the rig`).toContain(bone);
  });

  it('names only clips the shipped GLBs actually carry', () => {
    const available = new Set([...clipNames(RIG), ...clipNames(ABILITIES)]);
    const named = [...clipMapSource().matchAll(/'([A-Z][A-Za-z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const clip of named) expect(available, `clip '${clip}' is not shipped`).toContain(clip);
  });

  it('never names the folded Attack clip', () => {
    // The slash retarget collapsed this body. The clip is still in the rig GLB because it
    // came with the retarget, so the only thing between it and a raid seeing it is that
    // the ClipMap does not mention it.
    expect(clipMapSource()).not.toContain("'Attack'");
  });

  it('keeps the big slams OUT of the ordinary attack rotation', () => {
    // A boss who plays his telegraphed circle-smash on every auto-attack teaches the raid
    // that the animation means nothing, which is the opposite of what a telegraph is for.
    const map = clipMapSource();
    const start = map.indexOf('attack: [');
    const attackLine = map.slice(start, map.indexOf(']', start));
    expect(attackLine).toContain('Balgath_Swipe');
    expect(attackLine).not.toContain('Balgath_Smash');
    expect(attackLine).not.toContain('Balgath_Stomp');
  });

  it('routes each telegraphed slam off the windup cue the sim actually emits', () => {
    // These ability ids are not player abilities: they are the cue the sim fires when it
    // draws a ground ring (mob/locomotion.ts). If the two sides ever disagree, the ring
    // still draws and the boss just stands in it doing nothing.
    const map = clipMapSource();
    const loco = readFileSync(resolve(ROOT, 'src/sim/mob/locomotion.ts'), 'utf8');
    for (const [ability, clip] of [
      ['mob_pulse_windup', 'Balgath_Smash'],
      ['mob_stomp_windup', 'Balgath_Stomp'],
    ]) {
      expect(map, `${ability} is not mapped`).toContain(`${ability}: '${clip}'`);
      expect(loco, `${ability} is never emitted`).toContain(`'${ability}'`);
    }
  });

  it('holds the encounter-only clips out of the generic slots', () => {
    // Blinded holds for as long as a debuff lasts, and Sleep/Wake are the night; any of the
    // three landing in attack/hit/flourish would be picked at random mid-fight. Blinded is
    // driven by the encounter and stays unnamed. Sleep and Wake ARE named, but each exactly
    // once and only in the slot the slumber state plays it from: `sleep` loops while the
    // asleep bit rides and `wake` fires once on the asleep-to-awake edge. Comments are
    // stripped first so prose about a clip cannot stand in for the slot.
    const map = clipMapSource().replace(/\/\/.*$/gm, '');
    expect(map).not.toContain('Balgath_Blinded');
    const mentions = (clip: string) => map.match(new RegExp(`'${clip}'`, 'g')) ?? [];
    expect(map).toContain("sleep: 'Balgath_Sleep'");
    expect(mentions('Balgath_Sleep'), 'Sleep is named outside the sleep slot').toHaveLength(1);
    expect(map).toContain("wake: 'Balgath_Wake'");
    expect(mentions('Balgath_Wake'), 'Wake is named outside the wake slot').toHaveLength(1);
  });

  it('loops the sleep in place and wakes out of its exact first pose', async () => {
    // The sleep loop holds from dusk to dawn, so its wrap has to be invisible: the last
    // sampled key equals the first on every channel, exactly, not to a tolerance. And the
    // wake fires on the edge the loop was playing across, so ITS first key must equal the
    // loop's first key channel for channel, or he jumps to a new pose the frame he wakes.
    // Checked on the shipped channels rather than on a build-script constant, because it is
    // the baked Float32 data the mixer reads.
    const root = (await createGlbIO().read(ABILITIES)).getRoot();
    const sleep = indexClip(root, 'Balgath_Sleep');
    const wake = indexClip(root, 'Balgath_Wake');
    expect(sleep.size, 'the sleep loop drives almost nothing').toBeGreaterThan(40);
    let loop = 0;
    for (const ch of sleep.values()) loop = Math.max(loop, ch.times[ch.times.length - 1]);
    expect(loop).toBeGreaterThan(3.2);
    expect(loop).toBeLessThan(4.0);
    let breathing = 0;
    for (const [key, ch] of sleep) {
      const first = sampleChannel(ch, 0);
      expect(sampleChannel(ch, loop), `${key} pops at the loop point`).toEqual(first);
      const edge = wake.get(key);
      expect(edge, `the wake does not drive ${key}, so the edge would drop it`).toBeDefined();
      expect(
        sampleChannel(edge as NonNullable<typeof edge>, 0),
        `${key} seams on the wake edge`,
      ).toEqual(first);
      if (sampleChannel(ch, loop / 2).some((v, i) => Math.abs(v - first[i]) > 1e-4)) breathing++;
    }
    // ...and it is a breath, not a held frame: mid-loop he is somewhere else.
    expect(breathing, 'the sleep loop never moves').toBeGreaterThan(5);
  });

  it('sleeps folded low with his soles in the ground, never hovering above it', async () => {
    // From across the fen the sleeping boss has to pass for a boulder, and up close the one
    // thing that breaks a held pose is a hover. Every donor on this rig keeps the Hip at a
    // fixed height and folds the legs UP under it, so a crouch blended out of them floats
    // unless the build sinks the Hip (build_balgath_anims.mjs `sunk`); the circle-smash's
    // impact frame hovers for exactly that reason and gets away with it by being brief.
    // Measured against his own retargeted Idle, the pose prepareVisual takes the sole line
    // from, so "the ground" here is the ground the renderer will stand him on.
    const poser = await loadRigPoser(RIG, ABILITIES);
    const own = await loadRigPoser(RIG, RIG);
    const stand = own.pose('Idle', 0.5);
    const asleep = poser.pose('Balgath_Sleep', 0);
    const sole = (p: PosedSkeleton) =>
      Math.min(...['R_Foot', 'L_Foot', 'R_ToeBase', 'L_ToeBase'].map((b) => p.at(b)[1]));
    expect(sole(asleep), 'the sleeping soles float above his idle sole line').toBeLessThanOrEqual(
      sole(stand) + 0.005,
    );
    // Folded: the head sits far lower over the hip than standing, and further FORWARD of it
    // than above it (the rig faces +X), which is a spine pitched past 45 degrees, not a bow.
    const rise = (p: PosedSkeleton) => p.at('Head')[1] - p.at('Hip')[1];
    expect(rise(asleep)).toBeLessThan(rise(stand) * 0.6);
    expect(asleep.at('Head')[0] - asleep.at('Hip')[0]).toBeGreaterThan(rise(asleep));
  });

  it('is reachable through MOB_KEYS, and therefore NOT lazily preloaded', () => {
    // These move together or world entry crashes: preload sets are tier-independent and
    // read synchronously at entry, so a reachable-but-lazy def fails with "asset not
    // preloaded". Without the MOB_KEYS row he silently renders as the generic elemental
    // family fallback instead, which is the quieter half of the same bug.
    const src = readFileSync(MANIFEST, 'utf8');
    const keysStart = src.indexOf('MOB_KEYS: Record');
    expect(keysStart, 'MOB_KEYS moved or was renamed').toBeGreaterThan(-1);
    const keys = src.slice(keysStart, src.indexOf('\n};', keysStart));
    expect(keys).toContain("balgath_cyclops: 'mob_balgath_cyclops'");
    expect(defBlock('mob_balgath_cyclops')).not.toContain('lazyPreload');
  });

  it('keeps the sim scale and the measured gait references in agreement', () => {
    // The refs are only correct AT the scale they were measured at, and the sim owns the
    // scale while render owns the refs. `src/sim/` may never import from `src/render/`, so
    // this weld replaces the import it cannot have. Drift is silent, and shows up only as
    // feet that skate.
    const manifest = readFileSync(MANIFEST, 'utf8');
    const declared = manifest.match(/export const BALGATH_SCALE = ([\d.]+);/)?.[1];
    expect(declared, 'BALGATH_SCALE is missing').toBeTruthy();
    const simScale = templateSource().match(/scale: ([\d.]+),/)?.[1];
    expect(simScale, 'the mob template has no scale').toBeTruthy();
    expect(Number(simScale)).toBe(Number(declared));
  });

  it('keeps his move speed under the gait threshold that would break his stride', () => {
    // 5.2 is the renderer's GAIT_RUN_ENTER. Above it he crosses into the run clip and
    // flip-flops across that boundary mid-chase. walkRef is what his cycle is timed
    // against, and exceeding walkRef * 1.8 pins the clip at its clamp and skates: that
    // exact combination is what made him read as jogging in place at the previous tuning.
    const speed = Number(templateSource().match(/moveSpeed: ([\d.]+),/)?.[1]);
    expect(speed).toBeGreaterThan(0);
    expect(speed, 'would cross into the run gait').toBeLessThan(5.2);
    const walkRef = Number(
      readFileSync(MANIFEST, 'utf8').match(/const BALGATH_WALK_REF = ([\d.]+);/)?.[1],
    );
    expect(walkRef).toBeGreaterThan(0);
    expect(speed / walkRef, 'walk clip would be pinned at its clamp').toBeLessThan(1.8);
  });

  it('routes each warpath cue off the ability id the sim actually emits', () => {
    // Same weld as the telegraphed slams above, for the two mechanics his warpath owns
    // (src/sim/mob/warpath.ts). These ids are not castable abilities: they are cue names
    // agreed between the emitter and this map, and nothing else checks them. Disagree and
    // the mechanic still resolves while the boss plays his ordinary swing, which is the
    // kind of wrong that survives a playtest.
    const map = clipMapSource();
    const warpath = readFileSync(resolve(ROOT, 'src/sim/mob/warpath.ts'), 'utf8');
    for (const [ability, clip] of [
      ['mob_warpath_swipe', 'Balgath_Barrowsweep'],
      ['mob_warpath_wreck', 'Balgath_Barrowfall'],
    ]) {
      expect(map, `${ability} is not mapped`).toContain(`${ability}: '${clip}'`);
      expect(warpath, `${ability} is never emitted`).toContain(`'${ability}'`);
    }
  });

  it('runs its warpath in the RUN gait and its combat in the walk', () => {
    // The one thing that made him read as skating was a clip pinned at its clamp. He now
    // has two speeds and they must land in different gait bands with the clip rate inside
    // the clamp on BOTH sides: combat under GAIT_RUN_ENTER on the walk reference, travel
    // above it on the run reference. Neither the sim nor the renderer can see the other
    // half of this, so it is checked here or not at all.
    const template = templateSource();
    const manifest = readFileSync(MANIFEST, 'utf8');
    const moveSpeed = Number(template.match(/moveSpeed: ([\d.]+),/)?.[1]);
    const travelMult = Number(template.match(/travelSpeedMult: ([\d.]+),/)?.[1]);
    const walkRef = Number(manifest.match(/const BALGATH_WALK_REF = ([\d.]+);/)?.[1]);
    const runRef = Number(manifest.match(/const BALGATH_RUN_REF = ([\d.]+);/)?.[1]);
    expect(moveSpeed).toBeGreaterThan(0);
    expect(travelMult).toBeGreaterThan(1);
    const travel = moveSpeed * travelMult;
    // GAIT_RUN_ENTER is 5.2 (src/render/locomotion.ts): combat below it, travel above.
    expect(moveSpeed, 'combat speed would cross into the run gait').toBeLessThan(5.2);
    expect(travel, 'travel speed would stay in the walk gait').toBeGreaterThan(5.2);
    // locomotionTimeScale clamps the run to [0.6, 1.6] and the walk to [0.6, 1.8]; a rate
    // outside the clamp is a clip pinned at its limit, which is a skate by construction.
    expect(moveSpeed / walkRef).toBeGreaterThan(0.6);
    expect(moveSpeed / walkRef).toBeLessThan(1.8);
    expect(travel / runRef).toBeGreaterThan(0.6);
    expect(travel / runRef).toBeLessThan(1.6);
    // He must also stay outrunnable: every telegraphed circle in this fight assumes a
    // player can walk out of it, and a boss faster than a 7 u/s run cannot be left.
    expect(travel, 'a boss nobody can outrun has no counterplay').toBeLessThan(7);
  });

  it('plays the mid-run backhand at exactly the rate its own legs were sampled at', () => {
    // Barrowsweep is a COMPOSITE: its lower body is the Run cycle, its upper body an
    // authored swing, because the renderer plays an attack as a full-body one-shot and an
    // ordinary swing clip would freeze a travelling boss's legs while the sim kept sliding
    // him. That only holds while the one-shot's timescale matches what the locomotion
    // state machine would have picked for the run clip at travel speed. Drift them apart
    // and the composite skates for exactly as long as the swing lasts.
    const template = templateSource();
    const manifest = readFileSync(MANIFEST, 'utf8');
    const travel =
      Number(template.match(/moveSpeed: ([\d.]+),/)?.[1]) *
      Number(template.match(/travelSpeedMult: ([\d.]+),/)?.[1]);
    const runRef = Number(manifest.match(/const BALGATH_RUN_REF = ([\d.]+);/)?.[1]);
    const wired = Number(manifest.match(/mob_warpath_swipe: ([\d.]+),/)?.[1]);
    expect(wired).toBeGreaterThan(0);
    expect(wired).toBeCloseTo(travel / runRef, 1);
  });

  it('keeps the two aimed slams authored in Blender, not blended out of donor poses', () => {
    // These two escalated to real keyframing for a reason the rig can be asked about: the
    // retargeted donor set carries no horizontal swing and no one-armed gesture at all, so
    // a hammer and a low sweep cannot be sampled out of it. The versions this replaced were
    // built by masking half the body out of a two-armed overhead chop.
    const data = JSON.parse(
      readFileSync(resolve(ROOT, 'scripts/anim_data/balgath_slam_clips.json'), 'utf8'),
    );
    for (const clip of ['Balgath_Hammer', 'Balgath_Cleave']) {
      expect(Object.keys(data.clips), `${clip} is not authored`).toContain(clip);
      expect(data.clips[clip].times.length, `${clip} has no frames`).toBeGreaterThan(30);
    }
    // The build must SOURCE them from that data rather than re-deriving them, or the
    // authored motion is silently replaced by whatever the pose blender produces.
    const build = readFileSync(resolve(ROOT, 'scripts/build_balgath_anims.mjs'), 'utf8');
    expect(build).toContain('balgath_slam_clips.json');
    expect(build).toContain("blenderClip('Balgath_Hammer')");
    expect(build).toContain("blenderClip('Balgath_Cleave')");
  });

  it('never authors a track on the parentless root bone', () => {
    // The falling-forward bug, as a gate. The axis conversion bakes into the parentless
    // bone's pose matrix, so sampling it writes a constant quarter-turn root track that
    // pitches the whole model forward for as long as the one-shot plays. That shipped once
    // on another rig; it is cheap to make impossible here.
    const data = JSON.parse(
      readFileSync(resolve(ROOT, 'scripts/anim_data/balgath_slam_clips.json'), 'utf8'),
    );
    const rootless = (glbJson(RIG).nodes ?? []).map((n) => n.name);
    expect(data.bones, 'the authored bone list names the root').not.toContain('Root');
    for (const clip of Object.values(data.clips) as { rotation: Record<string, unknown> }[]) {
      expect(Object.keys(clip.rotation)).not.toContain('Root');
    }
    // ...and every bone it DOES name has to exist on the rig, or the track binds to nothing.
    for (const bone of data.bones as string[]) {
      expect(rootless, `authored bone '${bone}' is not on the rig`).toContain(bone);
    }
  });

  it('lands each authored slam on its own template windup', () => {
    // Both are wired at timeScale 1, so the clip's contact frame IS the moment the blast
    // resolves. The clip has to be long enough to contain that frame with recovery after
    // it; a clip shorter than its windup clamps on the last pose and the boss stands
    // frozen through the rest of his own telegraph.
    const template = templateSource();
    const data = JSON.parse(
      readFileSync(resolve(ROOT, 'scripts/anim_data/balgath_slam_clips.json'), 'utf8'),
    );
    const hammerWind = Number(template.match(/hammer: \{[\s\S]*?windup: ([\d.]+),/)?.[1]);
    const cleaveWind = Number(template.match(/cleave: \{[\s\S]*?windup: ([\d.]+),/)?.[1]);
    expect(hammerWind).toBeGreaterThan(0);
    expect(cleaveWind).toBeGreaterThan(0);
    expect(data.clips.Balgath_Hammer.duration).toBeGreaterThan(hammerWind);
    expect(data.clips.Balgath_Cleave.duration).toBeGreaterThan(cleaveWind);
  });

  it('never swings the hammer arm through his own head', async () => {
    // A defect that shipped, and a measurement that can see it. This rig has an enormous
    // head (0.226 radius on a 0.55-tall body) and short arms, so raising the fist onto the
    // CENTRELINE buries the forearm in the skull. The first authored cut did exactly that,
    // on the beats that are held on screen for the whole windup, and it read as "nicely
    // centred overhead" in every metric I had at the time.
    //
    // The geometric tell is simple: while the fist is above head height it must stay OFF
    // the body axis. Nothing else in the suite can see this, because it is the composition
    // of a raise and a lateral that is wrong, not either one.
    const poser = await loadRigPoser(RIG, ABILITIES);
    const dur = poser.duration('Balgath_Hammer');
    let worst = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 40; i++) {
      const p = poser.pose('Balgath_Hammer', (dur * i) / 40);
      const fist = p.at('R_Hand');
      const head = p.at('Head');
      const foot = p.at('R_Foot');
      if (fist[1] < head[1]) continue; // only the raised part of the swing can reach it
      // Horizontal distance from the body axis, taken at the head's own centre.
      const off = Math.hypot(fist[0] - head[0], fist[2] - head[2]);
      worst = Math.min(worst, off);
      void foot;
    }
    expect(worst, 'the hammer never lifts above his head at all').toBeLessThan(9e9);
    expect(worst, 'the raised fist crosses onto his own head').toBeGreaterThan(0.12);
  });

  it('scrapes the cleave along the ground instead of swinging it through the air', async () => {
    // The mechanic is beaten by JUMPING, so the thing a player has to clear must be visibly
    // ON the floor for long enough to read. A fist that whips past at hip height in three
    // frames is a swing, and a swing teaches the raid to walk backwards instead.
    const poser = await loadRigPoser(RIG, ABILITIES);
    const dur = poser.duration('Balgath_Cleave');
    const samples: { t: number; up: number; brg: number }[] = [];
    for (let i = 0; i <= 50; i++) {
      const t = (dur * i) / 50;
      const p = poser.pose('Balgath_Cleave', t);
      const fist = p.at('R_Hand');
      const foot = p.at('R_Foot');
      samples.push({
        t,
        up: fist[1] - foot[1],
        brg: (Math.atan2(fist[2], fist[0]) * 180) / Math.PI,
      });
    }
    // A contiguous stretch where the fist is genuinely low, and it has to be LONG.
    const low = samples.filter((s) => s.up < 0.2);
    expect(low.length, 'the fist never reaches the ground').toBeGreaterThan(6);
    const span = Math.max(...low.map((s) => s.t)) - Math.min(...low.map((s) => s.t));
    expect(span, 'the ground contact is a tap, not a scrape').toBeGreaterThan(0.5);
    // ...and it must TRAVEL while it is down there, or it is a plant rather than a drag.
    const brgs = low.map((s) => s.brg);
    const swept = Math.max(...brgs) - Math.min(...brgs);
    expect(swept, 'the fist sits still on the ground instead of dragging').toBeGreaterThan(60);
  });

  it('routes each AIMED slam off the ability id the sim actually emits', () => {
    // Third weld of the same kind, for the two hand-aimed attacks. These ids are agreed
    // between three files that cannot import each other: the sim emits them, the ClipMap
    // picks a pose from them, and the FX router picks an arc or a crater from them. Nothing
    // but this test can see all three at once, and a disagreement is silent in every one.
    const map = clipMapSource();
    const slams = readFileSync(resolve(ROOT, 'src/sim/mob/boss_slams.ts'), 'utf8');
    const fxCore = readFileSync(resolve(ROOT, 'src/render/balgath_fx_core.ts'), 'utf8');
    for (const [ability, clip] of [
      ['mob_balgath_hammer', 'Balgath_Hammer'],
      ['mob_balgath_cleave', 'Balgath_Cleave'],
    ]) {
      expect(map, `${ability} has no pose`).toContain(`${ability}: '${clip}'`);
      expect(slams, `${ability} is never emitted`).toContain(`'${ability}'`);
      expect(fxCore, `${ability} has no ground effect`).toContain(`'${ability}'`);
    }
  });

  it('draws the cleave telegraph at the width the cleave actually hits', () => {
    // The renderer draws the arc from its own constant and the sim damages from the
    // template's, because src/render may not import a SimContext consumer. If they drift,
    // the ring promises one wedge and the arm sweeps another, which is worse than no
    // telegraph: the raid dodges the wrong way with confidence.
    const halfDeg = Number(templateSource().match(/halfArcDeg: ([\d.]+),/)?.[1]);
    expect(halfDeg).toBeGreaterThan(0);
    const fxCore = readFileSync(resolve(ROOT, 'src/render/balgath_fx_core.ts'), 'utf8');
    const drawnDeg = Number(fxCore.match(/BALGATH_CLEAVE_HALF_ARC = \((\d+) \* Math\.PI\)/)?.[1]);
    expect(drawnDeg, 'the render half-arc constant moved or was renamed').toBeGreaterThan(0);
    expect(drawnDeg).toBe(halfDeg);
  });

  it('lights a fist for every slam whose windup a raid has to read', () => {
    // The glow is the only cue that says WHICH hand, and therefore whether the ring on the
    // ground belongs to one player or to everybody. A telegraphed slam without one is a
    // mechanic the raid can only read from the floor.
    const map = clipMapSource();
    for (const ability of ['mob_balgath_hammer', 'mob_balgath_cleave', 'mob_pulse_windup']) {
      expect(map, `${ability} winds up with no fist cue`).toContain(`${ability}: { hand:`);
    }
  });

  it('keeps the fist glow the size of a fist', () => {
    // `radius` is BONE-LOCAL and gets multiplied twice on the way to the screen: by the
    // visual's normScale (3.85 on this rig) and again by the entity's scale (4.2). The
    // first cut used 0.11, which is a 3.5-unit ball across the chest of a 13-unit body; at
    // 0.04 it measures 1.29 units in-engine, which is a fist. Nothing else can catch this
    // because both multipliers live on the render side and neither is in the ClipMap.
    // The glow specs live on the shared BALGATH ClipMap, not the VisualDef.
    const radii = [...clipMapSource().matchAll(/radius: ([\d.]+) \}/g)].map((m) => Number(m[1]));
    expect(radii.length, 'no charge-glow radii found to check').toBeGreaterThan(2);
    for (const r of radii) {
      expect(r, 'a bone-local glow radius this big renders as a beach ball').toBeLessThan(0.06);
      expect(r, 'a glow this small is invisible from raid distance').toBeGreaterThan(0.02);
    }
  });

  it('swings the Tripo rig onto the +Z facing convention', () => {
    // The rig came off the creature lane resting facing +X, and the game sets
    // group.rotation.y straight from the sim's facing, where 0 means +Z. Without the yaw
    // offset the mesh is drawn a quarter turn off its own heading: he runs north with his
    // body pointing east, feet cycling forward while he slides sideways.
    //
    // Nothing else can catch this. The sim's facing is exactly right (measured at 0.000
    // rad of error against velocity over hundreds of moving ticks), the renderer's group
    // rotation is exactly right, and a still frame of a symmetrical stone body reads fine
    // from most angles. Only the composition of the two is wrong, and only in motion.
    expect(defBlock('mob_balgath_cyclops')).toContain('yaw: -Math.PI / 2');
  });

  it('telegraphs its mechanics, which is the whole counterplay', () => {
    // Without this his AoEs fire instantly with no ring, and "walk out of the circle"
    // stops being something a player can do.
    expect(templateSource()).toMatch(/telegraphedMechanics: [\d.]+,/);
  });
});
