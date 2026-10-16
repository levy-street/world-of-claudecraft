// The hand-keyed animation libraries (scripts/assets/woc_keyed_anims): every
// keyed clip re-solved and baked on both fits, checked for continuity, contact
// and grip quality, and the committed libraries checked against a fresh build.
// It runs on demand, not in CI, on a solved cache (the build fills it; solving every
// clip from cold takes about ten minutes, far past any test allowance):
//   node scripts/assets/woc_keyed_anims/build.mjs --all
//   WOC_KEYED_AUTHORING=1 npx vitest run tests/woc_keyed_anims_authoring.test.mjs
// CI checks the shipped libraries themselves (tests/woc_autoattacks.test.ts).
import fs from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { authorClip } from '../scripts/assets/woc_keyed_anims/author.mjs';
import {
  buildLibrary,
  glbIO,
  SHIPPED_DIR,
  wocRig,
} from '../scripts/assets/woc_keyed_anims/build.mjs';
import { CATALOG, SHIPPED_CLIPS } from '../scripts/assets/woc_keyed_anims/catalog.mjs';
import { bindModel } from '../scripts/assets/woc_keyed_anims/keyed/anatomy.mjs';
import { keyedSpec, keyedSpecCached } from '../scripts/assets/woc_keyed_anims/keyed/index.mjs';
import { jointPoint, worldPose } from '../scripts/assets/woc_keyed_anims/kinematics.mjs';

const AUTHORING = Boolean(process.env.WOC_KEYED_AUTHORING);
const CLIPS = Object.keys(CATALOG);
let io;
const rigs = {};
beforeAll(async () => {
  if (!AUTHORING) return;
  io = await glbIO();
  for (const fit of ['male', 'female']) rigs[fit] = await wocRig(io, fit);
  const cold = [];
  for (const fit of ['male', 'female']) {
    const model = bindModel(rigs[fit]);
    for (const name of CLIPS) if (!keyedSpecCached(model, fit, name)) cold.push(`${fit}/${name}`);
  }
  if (cold.length)
    throw new Error(
      `${cold.length} keyed clips are not solved yet (${cold[0]}, ...): run ` +
        'node scripts/assets/woc_keyed_anims/build.mjs --all first, then rerun',
    );
});

it('solves a bent two-bone chain without changing either segment length', () => {
  const origin = new Vector3(0, 0, 0),
    target = new Vector3(0.3, 0, 0);
  const joint = jointPoint(origin, target, new Vector3(0, 1, 0), 0.2, 0.2);
  expect(joint.distanceTo(origin)).toBeCloseTo(0.2, 8);
  expect(joint.distanceTo(target)).toBeCloseTo(0.2, 8);
  expect(joint.y).toBeGreaterThan(0);
});

describe.skipIf(!AUTHORING).each(['male', 'female'])('%s hand-keyed authoring', (fit) => {
  it('authors every clip with finite unit rotations and unchanged limb/socket transforms', () => {
    const rig = rigs[fit];
    for (const name of CLIPS) {
      const clip = authorClip(rig, fit, name);
      expect(clip.frames).toBeGreaterThan(2);
      // A strike's fastest frame may turn a joint further: the reference stabs and
      // whips turn the upper arm up to 70 degrees in one 60 Hz frame.
      const snap = CATALOG[name].family === 'attack' ? Math.PI / 3 : Math.PI / 4;
      for (const b of rig) {
        const track = clip.tracks[b.name];
        for (let frame = 0; frame < clip.frames; frame++) {
          const label = `${fit}/${clip.name}/${b.name}/${frame}`;
          expect(track.t[frame].every(Number.isFinite), label).toBe(true);
          expect(track.q[frame].every(Number.isFinite), label).toBe(true);
          expect(Math.hypot(...track.q[frame]), label).toBeCloseTo(1, 5);
          if (frame > 0)
            expect(
              new Quaternion(...track.q[frame - 1])
                .normalize()
                .angleTo(new Quaternion(...track.q[frame]).normalize()),
              `${label}: joint snap`,
            ).toBeLessThan(snap);
          if (b.name !== 'hips') expect(track.t[frame], label).toEqual(b.t);
          if (/^(handslot|hand\.)/.test(b.name)) expect(track.q[frame], label).toEqual(b.q);
        }
      }
      if (clip.loop)
        for (const b of rig) {
          const track = clip.tracks[b.name];
          expect(
            new Vector3(...track.t[0]).distanceTo(new Vector3(...track.t.at(-1))),
            clip.name,
          ).toBeLessThan(1e-5);
          expect(
            new Quaternion(...track.q[0])
              .normalize()
              .angleTo(new Quaternion(...track.q.at(-1)).normalize()),
            clip.name,
          ).toBeLessThan(1e-5);
        }
    }
  }, 60000);

  // Hand-keyed clips, evaluated from the same baked 60 Hz tracks the
  // exporter writes. Contact points are the floor points under the heel and the
  // toe joint, carried by the foot and toe bones.
  function bakedWorld(clip, rig, frame) {
    return worldPose(
      rig,
      Object.fromEntries(
        rig.map((b) => [
          b.name,
          { t: clip.tracks[b.name].t[frame], q: clip.tracks[b.name].q[frame] },
        ]),
      ),
    );
  }
  function contactPoints(rig) {
    const bind = worldPose(rig, {});
    const points = {};
    for (const side of ['l', 'r']) {
      const foot = bind.get(`foot.${side}`),
        toes = bind.get(`toes.${side}`);
      const local = (b, p) => p.clone().sub(b.p).applyQuaternion(b.q.clone().invert());
      points[side] = {
        heel: [`foot.${side}`, local(foot, new Vector3(foot.p.x, 0, foot.p.z - 0.055))],
        ball: [`toes.${side}`, local(toes, new Vector3(toes.p.x, 0, toes.p.z))],
      };
    }
    return (world, side, label) => {
      const [bone, offset] = points[side][label];
      const b = world.get(bone);
      return offset.clone().applyQuaternion(b.q).add(b.p);
    };
  }

  // Keyed clips that stand still: every planted heel and ball holds still.
  // (Stepping clips pivot or drag a foot on purpose; locomotion slides at speed.)
  const STILL_FEET = [
    'Woc_Idle',
    'Woc_Crouch_Idle',
    'Woc_Talk',
    'Woc_Emote_Nod',
    'Woc_Emote_Beckon',
    'Woc_Emote_Shake_Head',
    'Woc_Emote_Laugh',
    'Woc_Attack_1H_0',
    'Woc_Attack_Bow',
    'Woc_Attack_Rifle',
    'Woc_Attack_Dual',
    'Woc_Attack_Dual#main',
    'Woc_Attack_Dual#off',
  ];
  it('holds planted contacts still in standing clips and keeps every foot above the floor', () => {
    const rig = rigs[fit],
      at = contactPoints(rig);
    for (const name of STILL_FEET) {
      const clip = authorClip(rig, fit, name);
      let previous = null;
      for (let frame = 0; frame < clip.frames; frame++) {
        const world = bakedWorld(clip, rig, frame);
        const now = {};
        for (const side of ['l', 'r'])
          for (const label of ['heel', 'ball']) {
            const p = at(world, side, label);
            expect(p.y, `${name}/${side}.${label}/${frame} floor`).toBeGreaterThan(-0.002);
            now[`${side}.${label}`] = p;
            const before = previous?.[`${side}.${label}`];
            // A point on the floor in both frames must not slide (0.5 mm per frame).
            if (before && p.y < 0.0015 && before.y < 0.0015)
              expect(
                Math.hypot(p.x - before.x, p.z - before.z),
                `${name}/${side}.${label}/${frame} slide`,
              ).toBeLessThan(0.0005);
          }
        previous = now;
      }
    }
  }, 20000);

  it('moves each planted run foot back at the runtime run speed and lifts it clear to swing', () => {
    const rig = rigs[fit],
      at = contactPoints(rig);
    const anatomy = JSON.parse(fs.readFileSync('scripts/assets/woc_character/export_split.json'));
    // RUN_SPEED 7 yd/s at timeScale 1, on a 2.86 yd tall WOC player.
    const speed = 7 / (2.86 / anatomy.anatomyTop[fit]);
    const clip = authorClip(rig, fit, 'Woc_Run');
    const planted = { l: 0, r: 0 },
      airborne = { l: 0, r: 0 };
    let previous = null;
    for (let frame = 0; frame < clip.frames; frame++) {
      const world = bakedWorld(clip, rig, frame);
      const now = {};
      for (const side of ['l', 'r'])
        for (const label of ['heel', 'ball']) now[`${side}.${label}`] = at(world, side, label);
      for (const [key, p] of Object.entries(now)) {
        const side = key[0],
          before = previous?.[key];
        expect(p.y, `${key}/${frame} floor`).toBeGreaterThan(-0.002);
        if (!before) continue;
        if (p.y < 0.0015 && before.y < 0.0015) {
          planted[side]++;
          expect((p.z - before.z) * clip.fps, `${key}/${frame} stance speed`).toBeCloseTo(
            -speed,
            2,
          );
          expect(Math.abs(p.x - before.x), `${key}/${frame} stance drift`).toBeLessThan(0.0005);
        } else if (p.y > 0.05) airborne[side]++;
      }
      previous = now;
    }
    // Both feet plant for several frames and spend most of the cycle swinging.
    for (const side of ['l', 'r']) {
      expect(planted[side], side).toBeGreaterThanOrEqual(6);
      expect(airborne[side], side).toBeGreaterThan(planted[side]);
    }
  }, 20000);

  it('closes every keyed loop exactly, in pose and in joint velocity', () => {
    const rig = rigs[fit];
    for (const name of CLIPS.filter((clip) => CATALOG[clip].loop)) {
      const clip = authorClip(rig, fit, name);
      for (const b of rig) {
        const q = clip.tracks[b.name].q.map((v) => new Quaternion(...v).normalize());
        expect(q[0].angleTo(q.at(-1)), `${name}/${b.name} seam pose`).toBeLessThan(1e-6);
        // Velocity into the seam matches velocity out of it: a keyed loop is a
        // periodic spline, so the seam may happen to be its sharpest turn, but a
        // velocity jump there would far exceed the clip's largest frame-to-frame
        // change elsewhere (at least 0.06 degrees a frame, so a joint that barely
        // moves is not held to its own rounding).
        const into = q.at(-2).angleTo(q.at(-1)),
          out = q[0].angleTo(q[1]);
        let step = 0.001;
        for (let f = 2; f < q.length; f++)
          step = Math.max(step, Math.abs(q[f - 1].angleTo(q[f]) - q[f - 2].angleTo(q[f - 1])));
        expect(Math.abs(into - out), `${name}/${b.name} seam velocity`).toBeLessThanOrEqual(
          1.25 * step + 1e-6,
        );
      }
    }
  }, 20000);

  it('resolves every held-prop key within its forearm and wrist limits', () => {
    const model = bindModel(rigs[fit]);
    // blade.mjs anatomy limits; a clip may widen them (`bladeLimits`), as a stab
    // or a two-handed grip bends the wrist further toward the little finger.
    const BASE = { sup: [-100, 130], flex: [-65, 75], dev: [-35, 20] };
    let checked = 0;
    for (const name of CLIPS) {
      const { spec, residuals } = keyedSpec(model, fit, name);
      if (!residuals.length) continue;
      checked++;
      // Most anchors land within 8 degrees; in-between keys may trade a little aim
      // for forearm continuity, never past the resolver's hard limit.
      const misses = residuals.map((r) => r.missDeg).sort((a, b) => a - b);
      expect(misses[Math.floor(misses.length / 2)], name).toBeLessThanOrEqual(8);
      for (const r of residuals)
        expect(r.missDeg, `${name} blade key ${r.t}`).toBeLessThanOrEqual(25);
      const limits = { ...BASE, ...spec.bladeLimits };
      const within = (v, [lo, hi], label) => {
        expect(v, label).toBeGreaterThanOrEqual(lo - 1e-6);
        expect(v, label).toBeLessThanOrEqual(hi + 1e-6);
      };
      for (const key of spec.keys)
        for (const side of ['l', 'r']) {
          if (key.forearm?.[side] !== undefined)
            within(key.forearm[side], limits.sup, `${name}@${key.t} forearm.${side}`);
          if (key.wrist?.[side]) {
            within(key.wrist[side][0], limits.flex, `${name}@${key.t} wrist.${side} flex`);
            within(key.wrist[side][1], limits.dev, `${name}@${key.t} wrist.${side} deviation`);
          }
        }
    }
    expect(checked).toBeGreaterThan(20);
  }, 20000);

  it('keeps sword tips out of the floor beyond the reference clearance', () => {
    // The tip sits 0.62 rig units out along the grip's +Y (measured on the real
    // sword prop). The reference swings dip a blade up to 6 cm into the floor in
    // two cuts; the keyed swings stay within 7 cm.
    const swords = {
      Woc_Attack_1H_0: ['r'],
      Woc_Attack_1H_1: ['r'],
      Woc_Attack_1H_Stab: ['r'],
      Woc_Attack_Thrown: ['r'],
      Woc_Attack_Offhand: ['r', 'l'],
      Woc_Attack_Offhand_Stab: ['r', 'l'],
      Woc_Attack_Dual: ['r', 'l'],
      'Woc_Attack_Dual#main': ['r', 'l'],
      'Woc_Attack_Dual#off': ['r', 'l'],
    };
    for (const [name, sides] of Object.entries(swords)) {
      const clip = authorClip(rigs[fit], fit, name);
      for (let frame = 0; frame < clip.frames; frame++) {
        const world = bakedWorld(clip, rigs[fit], frame);
        for (const side of sides) {
          const slot = world.get(`handslot.${side}`);
          const tip = new Vector3(0, 1.344, 0).multiply(slot.s).applyQuaternion(slot.q).add(slot.p);
          expect(tip.y, `${name} ${side} tip ${frame}`).toBeGreaterThan(-0.07);
        }
      }
    }
  }, 20000);

  it('keeps the support hand on the haft through every keyed two-handed swing', () => {
    const model = bindModel(rigs[fit]);
    const twoHanded = CLIPS.filter((clip) => ['twohand', 'long'].includes(CATALOG[clip].weapon));
    expect(twoHanded).toHaveLength(5);
    for (const name of twoHanded) {
      const { spec } = keyedSpec(model, fit, name);
      expect(spec.grip?.hand, name).toBe('l');
      // Piecewise-linear hold on the haft (1 held); a swing may let go.
      const hold = (t) => {
        const points = spec.grip.weight ?? [];
        if (!points.length || t <= points[0][0]) return points[0]?.[1] ?? 1;
        for (let i = 1; i < points.length; i++)
          if (t <= points[i][0])
            return (
              points[i - 1][1] +
              ((points[i][1] - points[i - 1][1]) * (t - points[i - 1][0])) /
                (points[i][0] - points[i - 1][0])
            );
        return points.at(-1)[1];
      };
      const clip = authorClip(rigs[fit], fit, name);
      let previous = null;
      for (let frame = 0; frame < clip.frames; frame++) {
        if (hold(frame / clip.fps) < 1) {
          previous = null;
          continue;
        }
        const world = bakedWorld(clip, rigs[fit], frame);
        const held = world.get('handslot.r'),
          grip = world.get('handslot.l');
        const axis = new Vector3(0, 1, 0).applyQuaternion(held.q);
        const offset = grip.p.clone().sub(held.p);
        const fromHaft = offset.addScaledVector(axis, -offset.dot(axis)).length();
        // On the haft (the hand slot sits off the bone's axis; the reference holds a
        // polearm's slot up to 0.31 off it), never jumping off it as fast as the
        // reference's own support hand does (up to 0.048 a frame).
        expect(fromHaft, `${name}/${frame} off the haft`).toBeLessThan(
          CATALOG[name].weapon === 'long' ? 0.32 : 0.25,
        );
        if (previous !== null)
          expect(Math.abs(fromHaft - previous), `${name}/${frame} grip jump`).toBeLessThan(0.035);
        previous = fromHaft;
      }
    }
  }, 20000);
});

describe.skipIf(!AUTHORING)('shipped hand-keyed libraries', () => {
  it('commits exactly the libraries the keys build', async () => {
    for (const fit of ['male', 'female']) {
      const { doc } = await buildLibrary(rigs[fit], fit, SHIPPED_CLIPS);
      const fresh = Buffer.from(await io.writeBinary(doc));
      const committed = fs.readFileSync(`${SHIPPED_DIR}/woc_${fit}.glb`);
      expect(fresh.equals(committed), `woc_${fit}.glb is stale: rebuild it (README)`).toBe(true);
    }
  }, 60000);
});

describe.skipIf(!AUTHORING)('keyed clips differ by fit', () => {
  it('authors distinct male and female poses for every keyed clip', () => {
    for (const name of CLIPS) {
      const male = authorClip(rigs.male, 'male', name),
        female = authorClip(rigs.female, 'female', name);
      // Different poses (cycle lengths follow each fit's import, sometimes equal).
      const differs = male.tracks.chest.q.some(
        (q, i) =>
          i < female.frames &&
          new Quaternion(...q).angleTo(new Quaternion(...female.tracks.chest.q[i])) > 0.05,
      );
      expect(differs, name).toBe(true);
    }
  }, 20000);
});
