// Balgath, the Mirefen world boss: the shipped asset and wiring contract.
//
// The failure this exists to catch is silent in every other layer. A rebake that renames
// or drops a clip, or a manifest edit naming a clip the GLB does not carry, produces no
// build error and no load error: the mixer simply finds no action and the rig sits in
// BIND POSE the first time the mechanic fires, in a raid, in production. So both halves
// are pinned here, the clip names actually inside the GLB and the manifest source that
// names them, plus the cross-layer welds nothing else can see.
//
// The body is the Blender-built cyclops (scripts/assets/balgath_cyclops/, shipped by its
// ship.mjs): one GLB carrying its own 56-bone rig and all 25 clips. The rig faces +Z and
// stands about 14 of its own units tall; the geometry checks below read it by forward
// kinematics on the SHIPPED file, so they also cover the export and the meshopt pass.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createGlbIO, indexClip, sampleChannel } from '../scripts/anim/pose_blend.mjs';
import { BALGATH_BOULDER_OVERHEAD } from '../src/render/balgath_ranged_fx_core';
import { EYE_WARD_BLIND_ABILITY, EYE_WARD_BLINDED_AURA_ID } from '../src/sim/mob/eye_ward';
import { loadRigPoser, type PosedSkeleton } from './helpers/gltf_pose';

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, '..');
const RIG = resolve(ROOT, 'public/models/creatures/balgath_cyclops.glb');
const MANIFEST = resolve(ROOT, 'src/render/characters/manifest.ts');
const ZONE = resolve(ROOT, 'src/sim/content/zone2.ts');

function glbJson(path: string): {
  animations?: Array<{ name?: string }>;
  meshes?: Array<{ primitives: Array<{ material?: number }> }>;
  materials?: Array<{
    name?: string;
    emissiveTexture?: unknown;
    pbrMetallicRoughness?: { baseColorTexture?: unknown };
  }>;
  images?: Array<{ mimeType?: string }>;
  skins?: Array<{ joints: number[] }>;
  nodes: Array<{ name?: string }>;
  extensionsRequired?: string[];
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

const num = (src: string, re: RegExp): number => {
  const v = Number(src.match(re)?.[1]);
  expect(Number.isFinite(v), `${re} matched nothing`).toBe(true);
  return v;
};

/** Every clip the build authors, and what each is FOR. Exhaustive on purpose: a clip
 *  dropped from the GLB is a mechanic with no animation. */
const SHIPPED = [
  'Idle', // breathes, looks round the raid, blinks
  'Walk', // the combat gait (feet planted at BALGATH_WALK_REF)
  'Run', // the warpath travel gait
  'Balgath_Swipe', // the ordinary backhand
  'Balgath_Punch', // the ordinary stepping hook
  'Balgath_Clobber', // the ordinary two-fisted club
  'Balgath_Smash', // the telegraphed circle-smash payoff
  'Balgath_Stomp', // the telegraphed shockwave stomp
  'Balgath_Hammer', // whack-a-mole: ONE fist up, held, dropped on a snapshot
  'Balgath_Cleave', // the low arm dragged across the ground
  'Balgath_Barrowsweep', // the mid-run backhand: its legs are the Run cycle's
  'Balgath_Barrowfall', // the warpath arrival slam
  'Balgath_Toss', // the boulder toss: dig, heave overhead, hurl (release at 1.45s)
  'Balgath_EyeFlare', // the glare and the scry channel
  'Balgath_Roar', // the enrage flourish
  'Balgath_Burden', // the palms pressing the Barrow Burden down
  'Balgath_Starwake', // on his knees, fists into the fen: Wake of the Fallen Star
  'Balgath_Blinded', // the pike in his eye: the stagger
  'Balgath_BlindedLoop', // ...and the hunched groping he holds while blind
  'Balgath_Mend', // Barrowmend, mud over the wounds (ships unwired, see the ClipMap)
  'Hit', // flinch
  'Balgath_Death', // the backward topple, held as his corpse (tests/balgath_death.test.ts)
  'Balgath_Sleep', // the night: folded into a mound and breathing
  'Balgath_Wake', // the dawn rise, out of the sleep pose
  'Jump',
];

/** The Toss's authored release frame (clip_library.py toss): the renderer launches its
 *  boulder from his fists here, so it is a contract, not a detail. */
const TOSS_RELEASE_SEC = 1.45;
/** The cleave's authored crossing (clip_library.py cleave): the arm passes straight ahead. */
const CLEAVE_CROSS_SEC = 1.5;

/** Standing height of the rig in its own units (the build's idle measurement). */
const RIG_HEIGHT = 13.96;

describe('balgath world boss assets', () => {
  it('ships every authored clip inside the one GLB, and no donor files', () => {
    expect(clipNames(RIG).sort()).toEqual([...SHIPPED].sort());
    for (const retired of ['balgath_ability_anims.glb', 'balgath_clip_donor.glb']) {
      expect(existsSync(resolve(ROOT, 'public/models/creatures', retired)), retired).toBe(false);
    }
    // ...and no def points at them any more: the clips bind to the rig they were authored on.
    expect(defBlock('mob_balgath_cyclops')).not.toContain('animUrls');
    expect(defBlock('form_foreman')).not.toContain('animUrls');
  });

  it('is the 56-bone Blender rig with its body and glow materials, KTX2 throughout', () => {
    expect(jointNames(RIG)).toHaveLength(56);
    for (const bone of ['Hips', 'Head', 'EyeCore', 'R_Hand', 'L_Hand', 'R_Foot', 'L_Foot'])
      expect(jointNames(RIG), bone).toContain(bone);
    const json = glbJson(RIG);
    expect((json.materials ?? []).map((m) => m.name).sort()).toEqual([
      'BalgathBody',
      'BalgathGlow',
    ]);
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    expect(json.extensionsRequired ?? []).toContain('KHR_texture_basisu');
  });

  it('draws the burning iris through the glow ramp, pupil dark and centre white-hot', async () => {
    // The Blender material lights the iris with a vertex-colour layer the glTF export drops,
    // and three's emissive term never reads vertex colour anyway, so ship.mjs rebuilds the
    // colour as a coordinate into a ramp texture the glow material samples as both its base
    // colour and its emissive map. A plain re-export reverts this to a flat white ball.
    const json = glbJson(RIG);
    const glow = (json.materials ?? []).find((m) => m.name === 'BalgathGlow');
    expect(glow?.emissiveTexture, 'the glow has no emissive ramp').toBeDefined();
    expect(glow?.pbrMetallicRoughness?.baseColorTexture).toBeDefined();
    const root = (await createGlbIO().read(RIG)).getRoot();
    const prim = root
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .find((p) => p.getMaterial()?.getName() === 'BalgathGlow');
    const uv = prim?.getAttribute('TEXCOORD_0');
    expect(uv, 'the glow primitive has no ramp coordinate').toBeTruthy();
    const us: number[] = [];
    const el = [0, 0];
    for (let i = 0; i < (uv?.getCount() ?? 0); i++) us.push((uv?.getElement(i, el) ?? el)[0]);
    // The slit pupil (black), the white-hot centre, and the teal body of iris and veins.
    expect(us.filter((u) => u < 0.03).length, 'no pupil').toBeGreaterThan(10);
    expect(us.filter((u) => u > 0.9).length, 'no hot centre').toBeGreaterThan(0);
    expect(us.filter((u) => u > 0.25 && u < 0.5).length, 'no teal').toBeGreaterThan(500);
  });

  it('names only clips the shipped GLB actually carries', () => {
    const available = new Set(clipNames(RIG));
    const named = [...clipMapSource().matchAll(/'([A-Z][A-Za-z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const clip of named) expect(available, `clip '${clip}' is not shipped`).toContain(clip);
  });

  it('keeps the big slams OUT of the ordinary attack rotation', () => {
    // A boss who plays his telegraphed circle-smash on every auto-attack teaches the raid
    // that the animation means nothing, which is the opposite of what a telegraph is for.
    const map = clipMapSource();
    const start = map.indexOf('attack: [');
    const attackLine = map.slice(start, map.indexOf(']', start));
    for (const swing of ['Balgath_Swipe', 'Balgath_Punch', 'Balgath_Clobber'])
      expect(attackLine).toContain(swing);
    for (const slam of ['Balgath_Smash', 'Balgath_Stomp', 'Balgath_Hammer', 'Balgath_Cleave'])
      expect(attackLine).not.toContain(slam);
  });

  it('routes each telegraphed slam off the windup cue the sim actually emits', () => {
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

  it('plays the blind stagger off the cue the sim emits, then holds the groping loop', () => {
    // The stagger is a one-shot on the blind edge; the loop holds in place of his idle for
    // as long as the Blinded aura rides. Both keys are the sim's own exports, so a rename
    // on either side turns this red instead of leaving him standing in his idle blind.
    const map = clipMapSource();
    expect(map).toContain(`${EYE_WARD_BLIND_ABILITY}: 'Balgath_Blinded'`);
    expect(map).toContain(`idleByAura: { ${EYE_WARD_BLINDED_AURA_ID}: 'Balgath_BlindedLoop' }`);
  });

  it('names Sleep and Wake exactly once, each in the slot the slumber state plays it from', () => {
    const map = clipMapSource().replace(/\/\/.*$/gm, '');
    const mentions = (clip: string) => map.match(new RegExp(`'${clip}'`, 'g')) ?? [];
    expect(map).toContain("sleep: 'Balgath_Sleep'");
    expect(mentions('Balgath_Sleep'), 'Sleep is named outside the sleep slot').toHaveLength(1);
    expect(map).toContain("wake: 'Balgath_Wake'");
    expect(mentions('Balgath_Wake'), 'Wake is named outside the wake slot').toHaveLength(1);
  });

  it('loops the sleep in place and wakes out of its exact first pose', async () => {
    // The sleep loop holds from dusk to dawn, so its wrap has to be invisible, and the wake
    // fires on the edge the loop was playing across, so ITS first key must equal the loop's
    // first key or he jumps to a new pose the frame he wakes. Checked on the shipped,
    // meshopt-quantized channels the mixer reads, to the quantization's own step.
    const root = (await createGlbIO().read(RIG)).getRoot();
    const sleep = indexClip(root, 'Balgath_Sleep');
    const wake = indexClip(root, 'Balgath_Wake');
    expect(sleep.size, 'the sleep loop drives almost nothing').toBeGreaterThan(40);
    let loop = 0;
    for (const ch of sleep.values()) loop = Math.max(loop, ch.times[ch.times.length - 1]);
    expect(loop).toBeGreaterThan(3.2);
    expect(loop).toBeLessThan(4.0);
    const apart = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    // The hanging gear (loincloth, wrist chain, tally cord, belly) is follow-through the
    // build SIMULATES per clip, so its state at a clip's first frame is whatever its spring
    // settled to; the crossfade into the wake carries it. The skeleton is what must seam.
    const SPRUNG = /^(Loin|R_Chain|Tally|Belly)/;
    let breathing = 0;
    for (const [key, ch] of sleep) {
      if (SPRUNG.test(key)) continue;
      const first = sampleChannel(ch, 0);
      expect(apart(sampleChannel(ch, loop), first), `${key} pops at the loop point`).toBeLessThan(
        2e-3,
      );
      const edge = wake.get(key);
      if (edge) {
        expect(apart(sampleChannel(edge, 0), first), `${key} seams on the wake edge`).toBeLessThan(
          2e-3,
        );
      }
      // A breath, not a held frame: somewhere in the loop he is somewhere else (sampled at
      // eighths, since a loop of two breaths is back at its start at the half).
      let moved = 0;
      for (let k = 1; k < 8; k++)
        moved = Math.max(moved, apart(sampleChannel(ch, (loop * k) / 8), first));
      if (moved > 1e-3) breathing++;
    }
    expect(breathing, 'the sleep loop never moves').toBeGreaterThan(5);
  });

  it('sleeps folded low with his soles on the ground, never hovering above it', async () => {
    const poser = await loadRigPoser(RIG, RIG);
    const stand = poser.pose('Idle', 0.5);
    const asleep = poser.pose('Balgath_Sleep', 0);
    const sole = (p: PosedSkeleton) =>
      Math.min(...['R_Foot', 'L_Foot', 'R_Toes', 'L_Toes'].map((b) => p.at(b)[1]));
    expect(sole(asleep), 'the sleeping soles float above his idle sole line').toBeLessThanOrEqual(
      sole(stand) + 0.05,
    );
    // Folded: the head sits far lower over the hips than standing and further FORWARD of
    // them (the rig faces +Z) than above them: a spine pitched past 45 degrees, not a bow.
    const rise = (p: PosedSkeleton) => p.at('Head')[1] - p.at('Hips')[1];
    expect(rise(asleep)).toBeLessThan(rise(stand) * 0.3);
    expect(asleep.at('Head')[2] - asleep.at('Hips')[2]).toBeGreaterThan(rise(asleep));
  });

  it('is reachable through MOB_KEYS, and therefore NOT lazily preloaded', () => {
    const src = readFileSync(MANIFEST, 'utf8');
    const keysStart = src.indexOf('MOB_KEYS: Record');
    expect(keysStart, 'MOB_KEYS moved or was renamed').toBeGreaterThan(-1);
    const keys = src.slice(keysStart, src.indexOf('\n};', keysStart));
    expect(keys).toContain("balgath_cyclops: 'mob_balgath_cyclops'");
    expect(defBlock('mob_balgath_cyclops')).not.toContain('lazyPreload');
  });

  it('keeps the sim scale and the measured gait references in agreement', () => {
    const manifest = readFileSync(MANIFEST, 'utf8');
    const declared = num(manifest, /export const BALGATH_SCALE = ([\d.]+);/);
    expect(num(templateSource(), /scale: ([\d.]+),/)).toBe(declared);
  });

  it('measures his gait refs off the planted foot of the shipped cycles', async () => {
    // A planted foot slides back at exactly the speed the body must travel for it not to
    // skate, so the refs are that speed through the normalize-and-scale chain. Read off the
    // shipped file, so a re-keyed Walk or Run that nobody re-measured turns this red.
    const manifest = readFileSync(MANIFEST, 'utf8');
    const chain = (3.2 / RIG_HEIGHT) * num(manifest, /export const BALGATH_SCALE = ([\d.]+);/);
    const poser = await loadRigPoser(RIG, RIG);
    for (const [clip, ref] of [
      ['Walk', num(manifest, /const BALGATH_WALK_REF = ([\d.]+);/)],
      ['Run', num(manifest, /const BALGATH_RUN_REF = ([\d.]+);/)],
    ] as const) {
      const planted = plantedSpeed(poser, clip) * chain;
      expect(planted / ref, `${clip} ref ${ref} vs planted ${planted.toFixed(2)}`).toBeGreaterThan(
        0.95,
      );
      expect(planted / ref).toBeLessThan(1.05);
    }
  });

  it('runs its warpath in the RUN gait and its combat in the walk, inside both clamps', () => {
    const template = templateSource();
    const manifest = readFileSync(MANIFEST, 'utf8');
    const moveSpeed = num(template, /moveSpeed: ([\d.]+),/);
    const travel = moveSpeed * num(template, /travelSpeedMult: ([\d.]+),/);
    const walkRef = num(manifest, /const BALGATH_WALK_REF = ([\d.]+);/);
    const runRef = num(manifest, /const BALGATH_RUN_REF = ([\d.]+);/);
    // GAIT_RUN_ENTER is 5.2 (src/render/locomotion.ts): combat below it, travel above.
    expect(moveSpeed, 'combat speed would cross into the run gait').toBeLessThan(5.2);
    expect(travel, 'travel speed would stay in the walk gait').toBeGreaterThan(5.2);
    expect(moveSpeed / walkRef).toBeGreaterThan(0.6);
    expect(moveSpeed / walkRef).toBeLessThan(1.8);
    expect(travel / runRef).toBeGreaterThan(0.6);
    expect(travel / runRef).toBeLessThan(1.6);
    expect(travel, 'a boss nobody can outrun has no counterplay').toBeLessThan(7);
  });

  it('plays the mid-run backhand at exactly the rate its own legs were sampled at', () => {
    const template = templateSource();
    const manifest = readFileSync(MANIFEST, 'utf8');
    const travel =
      num(template, /moveSpeed: ([\d.]+),/) * num(template, /travelSpeedMult: ([\d.]+),/);
    const runRef = num(manifest, /const BALGATH_RUN_REF = ([\d.]+);/);
    expect(num(manifest, /mob_warpath_swipe: ([\d.]+),/)).toBeCloseTo(travel / runRef, 1);
  });

  it('routes each warpath and aimed-slam cue off the ability id the sim actually emits', () => {
    const map = clipMapSource();
    const warpath = readFileSync(resolve(ROOT, 'src/sim/mob/warpath.ts'), 'utf8');
    const slams = readFileSync(resolve(ROOT, 'src/sim/mob/boss_slams.ts'), 'utf8');
    const fxCore = readFileSync(resolve(ROOT, 'src/render/balgath_fx_core.ts'), 'utf8');
    for (const [ability, clip] of [
      ['mob_warpath_swipe', 'Balgath_Barrowsweep'],
      ['mob_warpath_wreck', 'Balgath_Barrowfall'],
    ]) {
      expect(map, `${ability} is not mapped`).toContain(`${ability}: '${clip}'`);
      expect(warpath, `${ability} is never emitted`).toContain(`'${ability}'`);
    }
    for (const [ability, clip] of [
      ['mob_balgath_hammer', 'Balgath_Hammer'],
      ['mob_balgath_cleave', 'Balgath_Cleave'],
    ]) {
      expect(map, `${ability} has no pose`).toContain(`${ability}: '${clip}'`);
      expect(slams, `${ability} is never emitted`).toContain(`'${ability}'`);
      expect(fxCore, `${ability} has no ground effect`).toContain(`'${ability}'`);
    }
  });

  it('routes the ranged kit off the ability ids the sim actually emits', () => {
    const map = clipMapSource();
    const ranged = readFileSync(resolve(ROOT, 'src/sim/mob/boss_ranged_mechanics.ts'), 'utf8');
    for (const [ability, clip] of [
      ['mob_balgath_boulder', 'Balgath_Toss'],
      ['mob_balgath_glare', 'Balgath_EyeFlare'],
      ['mob_balgath_burden', 'Balgath_Burden'],
    ]) {
      expect(map, `${ability} has no pose`).toContain(`${ability}: '${clip}'`);
      expect(ranged, `${ability} is never emitted`).toContain(`'${ability}'`);
    }
    expect(map).toContain(
      `mob_balgath_boulder: { hand: 'both', color: 0xb08a5a, rise: 0.4, seconds: ${TOSS_RELEASE_SEC}, radius:`,
    );
  });

  it('lands the hammer unscaled on its windup and the cleave arm on its lengthened one', async () => {
    // The hammer is authored with its blow on the 1.3s template windup. The cleave's arm
    // crosses straight ahead at 1.5s of its clip and the windup is longer than that, so it
    // plays slowed by exactly windup / crossing: the arm must still cross the instant the
    // arc resolves, not before it with the boss frozen through the rest of his telegraph.
    const template = templateSource();
    const map = clipMapSource();
    const hammerWind = num(template, /hammer: \{[\s\S]*?windup: ([\d.]+),/);
    const cleaveWind = num(template, /cleave: \{[\s\S]*?windup: ([\d.]+),/);
    expect(hammerWind).toBe(1.3);
    expect(num(map, /mob_balgath_hammer: ([\d.]+),/)).toBe(1);
    const cleaveScale = num(map, /mob_balgath_cleave: ([\d.]+),/);
    expect(CLEAVE_CROSS_SEC / cleaveScale).toBeCloseTo(cleaveWind, 2);
    // ...and the glow on his right fist burns for the whole of the lengthened wind.
    expect(map).toMatch(
      new RegExp(`mob_balgath_cleave: \\{ hand: 'r', [^}]*seconds: ${cleaveWind}, `),
    );
    // The crossing is where the clip says it is: the right fist passes straight ahead.
    const poser = await loadRigPoser(RIG, RIG);
    let crossT = -1;
    let prev = Number.NEGATIVE_INFINITY;
    const dur = poser.duration('Balgath_Cleave');
    for (let i = 0; i <= 250; i++) {
      const t = (dur * i) / 250;
      const h = poser.pose('Balgath_Cleave', t).at('R_Hand');
      const brg = (Math.atan2(h[0], h[2]) * 180) / Math.PI;
      if (prev < 0 && brg >= 0 && t > 0.8) {
        crossT = t;
        break;
      }
      prev = brg;
    }
    expect(Math.abs(crossT - CLEAVE_CROSS_SEC), `the arm crosses at ${crossT}`).toBeLessThan(0.1);
  });

  it('scrapes the cleave along the ground instead of swinging it through the air', async () => {
    const poser = await loadRigPoser(RIG, RIG);
    const dur = poser.duration('Balgath_Cleave');
    const samples: { t: number; up: number; brg: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = (dur * i) / 60;
      const p = poser.pose('Balgath_Cleave', t);
      const fist = p.at('R_Hand');
      samples.push({ t, up: fist[1], brg: (Math.atan2(fist[0], fist[2]) * 180) / Math.PI });
    }
    // Wrist under a fifth of his height: the fist below it is on the ground.
    const low = samples.filter((s) => s.up < RIG_HEIGHT * 0.2);
    expect(low.length, 'the fist never reaches the ground').toBeGreaterThan(6);
    const span = Math.max(...low.map((s) => s.t)) - Math.min(...low.map((s) => s.t));
    expect(span, 'the ground contact is a tap, not a scrape').toBeGreaterThan(0.5);
    const brgs = low.map((s) => s.brg);
    expect(Math.max(...brgs) - Math.min(...brgs), 'a plant, not a drag').toBeGreaterThan(60);
  });

  it('never swings the hammer arm through his own head', async () => {
    const poser = await loadRigPoser(RIG, RIG);
    const dur = poser.duration('Balgath_Hammer');
    let worst = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 40; i++) {
      const p = poser.pose('Balgath_Hammer', (dur * i) / 40);
      const fist = p.at('R_Hand');
      const head = p.at('Head');
      if (fist[1] < head[1]) continue;
      worst = Math.min(worst, Math.hypot(fist[0] - head[0], fist[2] - head[2]));
    }
    expect(worst, 'the hammer never lifts above his head at all').toBeLessThan(9e9);
    expect(worst, 'the raised fist crosses onto his own head').toBeGreaterThan(RIG_HEIGHT * 0.15);
  });

  it('draws the cleave telegraph at the width the cleave actually hits', () => {
    const halfDeg = num(templateSource(), /halfArcDeg: ([\d.]+),/);
    const fxCore = readFileSync(resolve(ROOT, 'src/render/balgath_fx_core.ts'), 'utf8');
    const drawnDeg = num(fxCore, /BALGATH_CLEAVE_HALF_ARC = \((\d+) \* Math\.PI\)/);
    expect(drawnDeg).toBe(halfDeg);
  });

  it('lights a fist for every slam whose windup a raid has to read, at a fist size', () => {
    // `radius` is BONE-LOCAL: the rig's normalize (3.2 over its ~14-unit body) and the
    // entity scale (4.2) sit between it and the screen. Target world radius about 0.65.
    const map = clipMapSource();
    for (const ability of ['mob_balgath_hammer', 'mob_balgath_cleave', 'mob_pulse_windup']) {
      expect(map, `${ability} winds up with no fist cue`).toContain(`${ability}: { hand:`);
    }
    const radii = [...map.matchAll(/radius: ([\d.]+) \}/g)].map((m) => Number(m[1]));
    expect(radii.length).toBeGreaterThan(2);
    const chain = (3.2 / RIG_HEIGHT) * 4.2;
    for (const r of radii) {
      expect(r * chain, 'a glow this big renders as a beach ball').toBeLessThan(1);
      expect(r * chain, 'a glow this small is invisible from raid distance').toBeGreaterThan(0.4);
    }
  });

  it('faces +Z like every game rig, so it carries no yaw correction', async () => {
    // The Tripo body rested facing +X and needed a quarter turn; this one is authored facing
    // +Z. The proof is in the gait itself: a planted foot slides BACKWARDS, -Z, under a body
    // walking forward.
    expect(defBlock('mob_balgath_cyclops')).not.toContain('yaw:');
    expect(defBlock('form_foreman')).not.toContain('yaw:');
    const poser = await loadRigPoser(RIG, RIG);
    expect(plantedVelocityZ(poser, 'Walk')).toBeLessThan(0);
  });

  it('telegraphs its mechanics, which is the whole counterplay', () => {
    expect(templateSource()).toMatch(/telegraphedMechanics: [\d.]+,/);
  });

  it('plays the toss unscaled, releasing inside the windup and standing again as it lands', async () => {
    const map = clipMapSource();
    expect(map).toContain('mob_balgath_boulder: 1,');
    const windup = num(templateSource(), /boulder: \{[\s\S]*?windup: ([\d.]+),/);
    const poser = await loadRigPoser(RIG, RIG);
    const dur = poser.duration('Balgath_Toss');
    expect(TOSS_RELEASE_SEC).toBeLessThan(windup);
    expect(dur).toBeGreaterThan(TOSS_RELEASE_SEC + 0.5);
    expect(Math.abs(dur - windup), 'the recovery should end as the boulder lands').toBeLessThan(
      0.1,
    );
  });

  it('reads as a toss, and the renderer holds the boulder where his fists are', async () => {
    const poser = await loadRigPoser(RIG, RIG);
    const sole = poser.pose('Balgath_Toss', 0).at('R_Foot')[1];
    const hands = (p: PosedSkeleton) => [p.at('R_Hand'), p.at('L_Hand')];
    const dig = poser.pose('Balgath_Toss', 0.55);
    for (const h of hands(dig)) {
      expect(h[1] - sole, 'the fists never reach the ground to dig').toBeLessThan(1);
      expect(h[2] - dig.at('R_Foot')[2], 'the dig is not ahead of his feet').toBeGreaterThan(2);
    }
    const overhead = poser.pose('Balgath_Toss', 1.1);
    const [ro, lo] = hands(overhead);
    for (const h of [ro, lo]) {
      expect(h[1] - overhead.at('Head')[1], 'never above his head').toBeGreaterThan(2);
    }
    expect(Math.hypot(ro[0] - lo[0], ro[1] - lo[1], ro[2] - lo[2])).toBeGreaterThan(3);
    // The renderer's overhead point (in entity-scale units) rides just above his wrists.
    const wrists = ((ro[1] + lo[1]) / 2) * (3.2 / RIG_HEIGHT);
    expect(BALGATH_BOULDER_OVERHEAD.height).toBeGreaterThan(wrists);
    expect(BALGATH_BOULDER_OVERHEAD.height).toBeLessThan(wrists + 0.5);
    const release = poser.pose('Balgath_Toss', TOSS_RELEASE_SEC);
    for (const h of hands(release)) {
      expect(h[2] - release.at('Head')[2], 'the arms are not thrown out ahead').toBeGreaterThan(1);
      expect(h[1] - sole, 'the release is not at a throwing height').toBeGreaterThan(5);
    }
  });

  it('holds the glare at full stretch as the beam fires', async () => {
    // EyeFlare is shared with the generic cast slot, so the glare slows it: the moment the
    // eye flares widest (EyeCore's scale peak) divided by the wired timescale has to land in
    // the last beat before the windup resolves.
    const map = clipMapSource();
    const scale = num(map, /mob_balgath_glare: ([\d.]+),/);
    const windup = num(templateSource(), /glare: \{[\s\S]*?windup: ([\d.]+),/);
    const root = (await createGlbIO().read(RIG)).getRoot();
    const eye = indexClip(root, 'Balgath_EyeFlare').get('EyeCore|scale');
    expect(eye, 'the glare never flares the eye').toBeDefined();
    let peakT = 0;
    let peak = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= 260; i++) {
      const v = sampleChannel(eye as NonNullable<typeof eye>, i / 100)[0];
      if (v > peak) {
        peak = v;
        peakT = i / 100;
      }
    }
    const landed = peakT / scale;
    expect(landed).toBeLessThanOrEqual(windup + 0.1);
    expect(landed).toBeGreaterThan(windup - 0.4);
  });

  it('lands the Starwake fists on the end of the bar', () => {
    const map = clipMapSource();
    expect(map).toContain("castByAbility: { 'Wake of the Fallen Star': 'Balgath_Starwake' }");
    const scale = num(map, /castTimeScaleByAbility: \{ 'Wake of the Fallen Star': ([\d.]+) \}/);
    const warn = num(templateSource(), /starwake: \{[\s\S]*?warn: ([\d.]+),/);
    // The fists go into the fen at 1.40s of the authored clip (clip_library.py starwake).
    expect(1.4 / scale).toBeCloseTo(warn, 1);
  });
});

/** Mean planted-foot horizontal speed through a gait clip, rig units per second. */
function plantedSpeed(poser: Awaited<ReturnType<typeof loadRigPoser>>, clip: string): number {
  return Math.abs(plantedVelocityZ(poser, clip));
}

/** Median forward (Z) velocity of each foot over its contact samples, averaged. */
function plantedVelocityZ(poser: Awaited<ReturnType<typeof loadRigPoser>>, clip: string): number {
  const dur = poser.duration(clip);
  const steps = 240;
  const out: number[] = [];
  for (const foot of ['L_Toes', 'R_Toes']) {
    const track: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (dur * i) / steps;
      const p = poser.pose(clip, t).at(foot);
      track.push([t, p[1], p[2]]);
    }
    const ys = track.map((s) => s[1]);
    const floor = Math.min(...ys);
    const band = 0.03 * (Math.max(...ys) - floor) + 1e-6;
    const v: number[] = [];
    for (let i = 1; i < track.length; i++) {
      if (track[i][1] > floor + band || track[i - 1][1] > floor + band) continue;
      v.push((track[i][2] - track[i - 1][2]) / (track[i][0] - track[i - 1][0]));
    }
    v.sort((a, b) => a - b);
    out.push(v[Math.floor(v.length / 2)]);
  }
  return out.reduce((a, b) => a + b, 0) / out.length;
}
