// The Balgath pair as shipped: the boss (public/models/creatures/balgath_cyclops.glb) and the
// Knucklebone of Balgath's Shape of the Foreman (public/models/chars/forms/balgath_form.glb).
//
// Both come out of ONE Blender factory (scripts/assets/balgath_cyclops/: build.py builds the
// boss, form.py the form beside it) and one ship step (ship.mjs: the glow ramp, the
// optimize pass, KTX2). The form is the boss's own body cut to about a quarter of his
// triangles, on his own 56-bone rig, but with clips of its OWN for the gaits: his walk and
// run are a giant's lumber timed for thirteen yards of granite, and driven at a player's
// 7 yd/s they whirred in place. Its Walk and Run are re-keyed for a player-sized stride, so
// the legs plant; this file measures that off the shipped file.
//
// The bytes are pinned. A re-export or a re-ship (any change to the factory, the raw
// exports, ship.mjs or its encoder) means re-running ship.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning BYTES and SHA256 below.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createGlbIO } from '../scripts/anim/pose_blend.mjs';
import {
  ARM_TREMOR_LIMIT,
  armJitterFailures,
  armJitterReport,
  rotationJitter,
} from '../scripts/assets/balgath_cyclops/arm_jitter.mjs';
import {
  ARM_POSTURE_CLIPS,
  ARM_SEAM_OPEN,
  armPostureFailures,
  armSeamFailures,
  armSeamReport,
  clipArmPosture,
  OFF_ARM,
  offArmFailures,
  offArmReport,
  SEAM_GAP_MAX,
} from '../scripts/assets/balgath_cyclops/arm_posture.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { FOREMAN_SHAPE_SCALE } from '../src/sim/entity';
import { RUN_SPEED } from '../src/sim/types';
import { loadRigPoser } from './helpers/gltf_pose';

vi.setConfig({ testTimeout: 120_000 });

const ROOT = path.join(__dirname, '..');
const BOSS = 'public/models/creatures/balgath_cyclops.glb';
const FORM = 'public/models/chars/forms/balgath_form.glb';

const PINS = {
  [BOSS]: {
    bytes: 3_783_864,
    sha256: '57533e87247145af66d7a310c3f4d8bed3b5ef786a95964407f37cf4f85791d9',
  },
  [FORM]: {
    bytes: 1_558_288,
    sha256: 'bcffd9a47cf3a0f4fa9fd4b035bd5dba33ebc4a91ace523fa878b54ccb84a00d',
  },
} as const;

/** The clips the form carries: its own gaits plus the boss's swings, slams, glare and roar. */
const FORM_CLIPS = [
  'Idle',
  'Walk',
  'Run',
  'Balgath_Swipe',
  'Balgath_Punch',
  'Balgath_Clobber',
  'Balgath_Barrowsweep',
  'Balgath_Hammer',
  'Balgath_Stomp',
  'Balgath_Smash',
  'Balgath_EyeFlare',
  'Balgath_Roar',
  'Hit',
  'Jump',
  'Death',
];

/** Standing height of both rigs in their own units (the build's idle measurement). */
const RIG_HEIGHT = 13.96;

async function root(file: string) {
  return (await createGlbIO().read(path.join(ROOT, file))).getRoot();
}

function triangles(r: Awaited<ReturnType<typeof root>>): number {
  let n = 0;
  for (const mesh of r.listMeshes())
    for (const p of mesh.listPrimitives()) n += (p.getIndices()?.getCount() ?? 0) / 3;
  return n;
}

describe('the shipped Balgath pair', () => {
  it('pins both files byte for byte, the form well under the boss', () => {
    for (const [file, pin] of Object.entries(PINS)) {
      const bytes = readFileSync(path.join(ROOT, file));
      expect(bytes.length, file).toBe(pin.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(pin.sha256);
    }
    expect(PINS[FORM].bytes).toBeLessThan(PINS[BOSS].bytes / 2);
  });

  it('cuts the form to under a third of his triangles on the very same rig', async () => {
    const boss = await root(BOSS);
    const form = await root(FORM);
    expect(triangles(form)).toBeLessThan(triangles(boss) / 3);
    const joints = (r: typeof boss) =>
      r
        .listSkins()[0]
        .listJoints()
        .map((j) => j.getName());
    expect(joints(form)).toHaveLength(56);
    expect(joints(form)).toEqual(joints(boss));
  });

  it('ships the form its own clip set, death and gaits included', async () => {
    const names = (await root(FORM)).listAnimations().map((a) => a.getName());
    expect([...names].sort()).toEqual([...FORM_CLIPS].sort());
    // ...and the def names only clips the file carries.
    const clips = VISUALS.form_foreman.clips;
    const named = [
      clips.idle,
      clips.walk,
      clips.run,
      clips.death,
      clips.cast,
      clips.jump,
      clips.flourish,
      ...clips.attack,
      ...(clips.abilityAttack ?? []),
      ...(clips.hit ?? []),
    ];
    for (const clip of named) expect(names, `${clip}`).toContain(clip);
  });

  it('keeps every embedded texture KTX2 and the eye on the glow ramp', async () => {
    for (const file of [BOSS, FORM]) {
      const r = await root(file);
      for (const t of r.listTextures()) expect(t.getMimeType(), file).toBe('image/ktx2');
      const glow = r.listMaterials().find((m) => m.getName() === 'BalgathGlow');
      expect(glow?.getEmissiveTexture(), file).not.toBeNull();
      expect(glow?.getBaseColorTexture(), file).not.toBeNull();
    }
  });

  it("plants the form's feet at a player's run, inside the default clamps", async () => {
    // The owner's call: the legs have to move properly when running in the form. A planted
    // foot slides back at exactly the speed the body must travel, so the def's refs must be
    // that speed through the form's normalize (3.0 over the rig's height) and its
    // FOREMAN_SHAPE_SCALE, and a player's run must play the cycle near its natural rate.
    const def = VISUALS.form_foreman;
    const chain = (def.height / RIG_HEIGHT) * FOREMAN_SHAPE_SCALE;
    const poser = await loadRigPoser(path.join(ROOT, FORM), path.join(ROOT, FORM));
    for (const [clip, ref] of [
      ['Walk', def.walkRef],
      ['Run', def.runRef],
    ] as const) {
      const planted = plantedSpeed(poser, clip) * chain;
      expect(ref, clip).toBeDefined();
      expect(planted / (ref as number), `${clip}: planted ${planted.toFixed(2)}`).toBeGreaterThan(
        0.95,
      );
      expect(planted / (ref as number)).toBeLessThan(1.05);
    }
    const rate = RUN_SPEED / (def.runRef as number);
    expect(rate, 'the run cycle would whir').toBeLessThan(1.6);
    expect(rate, 'the run cycle would crawl').toBeGreaterThan(0.8);
    // The old donor-driven form needed its ceilings lifted to 3.9x to keep up; this one
    // runs inside the defaults.
    expect(def.runTimeScaleMax).toBeUndefined();
    expect(def.walkTimeScaleMax).toBeUndefined();
  });

  it("holds both bodies' arms steady in every clip, measured on the shipped bytes", async () => {
    // The owner's report: his arms shook nonstop, even standing still. The first build
    // keyed the upper arm flipping between two rolls about 11 degrees apart on
    // alternate frames (the arm clearance pass fed the per-frame bend limits), a 12 Hz
    // tremor in the Idle of both bodies (about 24 deg/frame^2 here). The measure reads
    // the shipped file, so a resample or quantization pass that roughened the motion
    // would fail here too.
    for (const file of [BOSS, FORM]) {
      const report = armJitterReport(await root(file));
      expect(report.length, file).toBeGreaterThan(10);
      expect(armJitterFailures(report), file).toEqual([]);
      const idle = report.find((r) => r.clip === 'Idle');
      expect(idle?.worst.tremor, `${file} Idle`).toBeLessThan(0.5);
      expect(idle?.worst.maxAccel, `${file} Idle breathes, nothing faster`).toBeLessThan(1);
    }
  });

  it('hangs both arms relaxed: elbows bent, palms on the thighs, in every resting loop', async () => {
    // The owner's report after the tremor fix: the arms hung "in a straight line", the
    // shoulders read as pushed forward and the palms faced backward. Measured on the
    // shipped bytes, every Idle frame was a locked elbow (3.6 degrees of bend, the
    // solver's full reach) with the palm 60 degrees off his thigh, mostly behind him:
    // the arm clearance pass held a hanging upper arm to its whole girth off the lat,
    // could never clear it, and shoved the wrist out to the end of its reach.
    for (const file of [BOSS, FORM]) {
      const r = await root(file);
      expect(armPostureFailures(r), file).toEqual([]);
      for (const clip of ARM_POSTURE_CLIPS) {
        expect(
          r.listAnimations().some((a) => a.getName() === clip),
          `${file} ${clip}`,
        ).toBe(true);
      }
      const idle = clipArmPosture(r, 'Idle');
      // a relaxed hang, not a flexed pose: bent, but nowhere near a right angle
      expect(idle.minElbowBend, `${file} Idle`).toBeGreaterThan(20);
      expect(Math.max(...idle.frames.map((f) => f.elbowBend)), `${file} Idle`).toBeLessThan(45);
      expect(idle.maxPalmOff, `${file} Idle palm`).toBeLessThan(28);
      // the palm must not face behind him (it read 0.8 of the way back)
      expect(idle.maxPalmBack, `${file} Idle palm`).toBeLessThan(0.25);
    }
  });

  it('starts and ends every action clip in the stance, so no crossfade swings an arm', async () => {
    // The owner's next report: standing was right, but "when he attacks, the arms move
    // like they did before". Every action clip still began and ended in the old locked,
    // out-turned arm (up to 52 degrees off the stance going in, 76 coming out), so the
    // 0.1 s crossfade swung the arm through the difference, and the three attack
    // variants chained through it (up to 65 degrees between one blow's end and the
    // next one's start).
    for (const file of [BOSS, FORM]) {
      const r = await root(file);
      expect(armSeamFailures(r), file).toEqual([]);
      const seams = armSeamReport(r);
      // every seam the open list does not name meets the stance to within a hair
      const closed = seams.filter((g) => !(`${g.clip}|${g.edge}` in ARM_SEAM_OPEN));
      expect(closed.length, file).toBeGreaterThan(15);
      for (const g of closed) {
        expect(g.gap, `${file} ${g.clip} ${g.edge} (${g.bone})`).toBeLessThan(SEAM_GAP_MAX);
      }
      // the attack variants chain: each one's end is the next one's start
      for (const clip of ['Balgath_Swipe', 'Balgath_Punch', 'Balgath_Clobber']) {
        for (const edge of ['start', 'end']) {
          const g = seams.find((s) => s.clip === clip && s.edge === edge);
          expect(g?.against, `${file} ${clip} ${edge}`).toBe('Idle');
          expect(g?.gap, `${file} ${clip} ${edge}`).toBeLessThan(1);
        }
      }
    }
  });

  it('keeps the off arm of a one-handed blow in the relaxed hang', async () => {
    // The arm that does not strike was written as fixed points in space, so a lean or a
    // turn of the torso dragged it straight (3.6 degrees of elbow in the Swipe, the
    // Punch, the Hammer and the Hit) with the palm up to 69 degrees off the thigh. It
    // now hangs from the posed shoulder and turns with the chest.
    for (const file of [BOSS, FORM]) {
      const r = await root(file);
      expect(offArmFailures(r), file).toEqual([]);
      const arms = offArmReport(r);
      expect(arms.map((o) => `${o.clip} ${o.side}`).sort(), file).toEqual(
        Object.entries(OFF_ARM)
          .flatMap(([clip, sides]) => sides.map((side) => `${clip} ${side}`))
          .sort(),
      );
      for (const o of arms) {
        expect(o.minElbowBend, `${file} ${o.clip} ${o.side}`).toBeGreaterThan(20);
      }
    }
  });

  it('starts every clip on its first key, so no loop stalls a frame at its seam', async () => {
    // The Blender export used to keep the action's frame 1 as t = 1/24 s: the mixer held
    // the first pose for that frame, and a loop (whose last key already IS its first
    // pose) stood still for two frames every cycle, a hitch in every stride.
    for (const file of [BOSS, FORM]) {
      for (const anim of (await root(file)).listAnimations()) {
        let first = Number.POSITIVE_INFINITY;
        for (const ch of anim.listChannels()) {
          first = Math.min(first, ch.getSampler()?.getInput()?.getMin([0])[0] ?? first);
        }
        expect(first, `${file} ${anim.getName()}`).toBeLessThan(1e-4);
      }
    }
  });

  it('scores a two-pose shake as tremor and a blow or a breath as none', () => {
    const about = (deg: number) => {
      const h = (deg * Math.PI) / 360;
      return [Math.sin(h), 0, 0, Math.cos(h)];
    };
    const n = 48;
    const shake = Array.from({ length: n }, (_, i) => about(i % 2 ? 6 : -6));
    const breath = Array.from({ length: n }, (_, i) => about(3 * Math.sin((2 * Math.PI * i) / n)));
    // a fist driven in over eight frames, stopped dead, held: one hard flip, no zig-zag
    const blow = Array.from({ length: n }, (_, i) => about(i < 8 ? 40 * (i / 8) ** 3 : 40));
    expect(rotationJitter(shake).tremor).toBeGreaterThan(ARM_TREMOR_LIMIT * 5);
    expect(rotationJitter(breath).tremor).toBeLessThan(0.1);
    expect(rotationJitter(blow).maxAccel).toBeGreaterThan(ARM_TREMOR_LIMIT * 4);
    expect(rotationJitter(blow).tremor).toBeLessThan(ARM_TREMOR_LIMIT);
  });

  it('rolls the shoulders a little on the march instead of swinging them', async () => {
    // The owner's second note: walking, the great shoulders swung like a sprinter's
    // (the chest twisted and side-bent ON TOP of the pelvis: about 18 degrees of yaw
    // and 15 of roll across the shoulder line in the boss's Walk). The spine now takes
    // the pelvis's turn back out.
    for (const file of [BOSS, FORM]) {
      const poser = await loadRigPoser(path.join(ROOT, file), path.join(ROOT, file));
      for (const [clip, yawMax, rollMax] of [
        ['Walk', SHOULDER_SWING.walkYaw, SHOULDER_SWING.walkRoll],
        ['Run', SHOULDER_SWING.runYaw, SHOULDER_SWING.runRoll],
      ] as const) {
        const { yaw, roll } = shoulderSwing(poser, clip);
        expect(yaw, `${file} ${clip} shoulder yaw, peak to peak`).toBeLessThan(yawMax);
        expect(roll, `${file} ${clip} shoulder roll, peak to peak`).toBeLessThan(rollMax);
        // ...but they still move with the stride: a frozen torso reads as a statue.
        expect(yaw, `${file} ${clip} shoulders frozen`).toBeGreaterThan(2);
      }
    }
  });

  it('wears the same measured eye anchor as the boss, on the glow iris', async () => {
    const boss = VISUALS.mob_balgath_cyclops.eyeGlow;
    const form = VISUALS.form_foreman.eyeGlow;
    expect(form?.bone).toBe(boss?.bone);
    expect(form?.offset).toEqual(boss?.offset);
    expect(form?.selfLitMaterial).toBe('BalgathGlow');
    expect(boss?.selfLitMaterial).toBe('BalgathGlow');
    // The anchor sits on the front of the iris: close to the nearest glow vertex in bind
    // space (world(Head) applied to the bone-local offset).
    for (const file of [BOSS, FORM]) {
      const r = await root(file);
      const head = r.listNodes().find((n) => n.getName() === 'Head');
      const m = head?.getWorldMatrix() ?? [];
      const o = boss?.offset ?? [0, 0, 0];
      const anchor = [0, 1, 2].map(
        (i) => m[i] * o[0] + m[4 + i] * o[1] + m[8 + i] * o[2] + m[12 + i],
      );
      const node = r.listNodes().find((n) =>
        n
          .getMesh()
          ?.listPrimitives()
          .some((p) => p.getMaterial()?.getName() === 'BalgathGlow'),
      );
      const prim = node
        ?.getMesh()
        ?.listPrimitives()
        .find((p) => p.getMaterial()?.getName() === 'BalgathGlow');
      const skin = node?.getSkin();
      // Quantized positions: world(joint0) * IBM(joint0) is the dequantize-into-bind map.
      const ibm = skin?.getInverseBindMatrices()?.getElement(0, new Array(16).fill(0)) ?? [];
      const j0 = skin?.listJoints()[0].getWorldMatrix() ?? [];
      const toBind = mul(j0, ibm);
      const pos = prim?.getAttribute('POSITION');
      let best = Number.POSITIVE_INFINITY;
      const el = [0, 0, 0];
      for (let i = 0; i < (pos?.getCount() ?? 0); i++) {
        pos?.getElement(i, el);
        const p = [0, 1, 2].map(
          (k) => toBind[k] * el[0] + toBind[4 + k] * el[1] + toBind[8 + k] * el[2] + toBind[12 + k],
        );
        best = Math.min(best, Math.hypot(p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]));
      }
      expect(best, `${file}: the eye glow floats off the iris`).toBeLessThan(0.15);
    }
  });
});

function mul(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** Peak-to-peak ceilings (degrees) of the shoulder line over a gait cycle. */
const SHOULDER_SWING = { walkYaw: 8, walkRoll: 6, runYaw: 8, runRoll: 6 } as const;

/** Peak-to-peak yaw and roll (degrees) of the line between the shoulders over a clip. */
function shoulderSwing(
  poser: Awaited<ReturnType<typeof loadRigPoser>>,
  clip: string,
): { yaw: number; roll: number } {
  const dur = poser.duration(clip);
  const yaw: number[] = [];
  const roll: number[] = [];
  for (let i = 0; i <= 96; i++) {
    const p = poser.pose(clip, (dur * i) / 96);
    const l = p.at('L_UpperArm');
    const r = p.at('R_UpperArm');
    const s = [l[0] - r[0], l[1] - r[1], l[2] - r[2]];
    // the rig faces +Z with +Y up: yaw turns the line about Y, roll tips it out of level
    yaw.push((Math.atan2(s[2], s[0]) * 180) / Math.PI);
    roll.push((Math.atan2(s[1], Math.hypot(s[0], s[2])) * 180) / Math.PI);
  }
  const span = (a: number[]) => Math.max(...a) - Math.min(...a);
  return { yaw: span(yaw), roll: span(roll) };
}

/** Median horizontal speed of each foot over its contact samples, averaged. */
function plantedSpeed(poser: Awaited<ReturnType<typeof loadRigPoser>>, clip: string): number {
  const dur = poser.duration(clip);
  const out: number[] = [];
  for (const foot of ['L_Toes', 'R_Toes']) {
    const track: number[][] = [];
    for (let i = 0; i <= 240; i++) {
      const t = (dur * i) / 240;
      const p = poser.pose(clip, t).at(foot);
      track.push([t, p[1], p[0], p[2]]);
    }
    const ys = track.map((s) => s[1]);
    const floor = Math.min(...ys);
    const band = 0.03 * (Math.max(...ys) - floor) + 1e-6;
    const v: number[] = [];
    for (let i = 1; i < track.length; i++) {
      if (track[i][1] > floor + band || track[i - 1][1] > floor + band) continue;
      const dt = track[i][0] - track[i - 1][0];
      v.push(Math.hypot(track[i][2] - track[i - 1][2], track[i][3] - track[i - 1][3]) / dt);
    }
    v.sort((a, b) => a - b);
    out.push(v[Math.floor(v.length / 2)]);
  }
  return out.reduce((a, b) => a + b, 0) / out.length;
}
