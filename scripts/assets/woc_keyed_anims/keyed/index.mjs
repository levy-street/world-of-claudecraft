// Hand-keyed clips: every catalog clip, separately for each fit. Each module
// exports `clip(fit, model)` returning { duration, loop, family, keys, lag?,
// pose?(sampled, seconds), grip? } built only from authored values: key poses in
// anatomical controls (anatomy.mjs, or body-level beat targets via beat.mjs),
// interpolated per channel (spline.mjs), with held-blade directions resolved at
// keys (blade.mjs) and an optional two-hand grip held per frame (grip.mjs).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAnatomySolver } from './anatomy.mjs';
import { unarmed } from './attack_unarmed.mjs';
import * as attack1h from './attack1h.mjs';
import * as attack1h1 from './attack1h_1.mjs';
import { twoHand } from './attack2h.mjs';
import * as backpedal from './backpedal.mjs';
import { resolveBladeKeys } from './blade.mjs';
import { crouchIdle, crouchWalk } from './crouch.mjs';
import * as death from './death.mjs';
import { dualOff, dualPair } from './dual.mjs';
import { agree, beckon, bow as bowEmote, disagree, laugh, muscle, point, wave } from './emotes.mjs';
import { gripTrack } from './grip.mjs';
import { flyBack, flyForward, flyLeft, flyRight, hoverIdle } from './hover.mjs';
import * as idle from './idle.mjs';
import * as jump from './jump.mjs';
import { long0, long1, long2 } from './long_attacks.mjs';
import { offCut, offStab, stab, thrown } from './more_attacks.mjs';
import { bow, rifle } from './ranged.mjs';
import { resolveReachKeys } from './reach.mjs';
import { chat, sit } from './rest_poses.mjs';
import * as run from './run.mjs';
import * as runback from './runback.mjs';
import { keyedTrack } from './spline.mjs';
import { swim, swimBack, swimLeft, swimRight, tread } from './swim.mjs';
import * as walk from './walk.mjs';

export const KEYED = {
  Woc_Idle: idle,
  Woc_Run: run,
  Woc_Attack_1H_0: attack1h,
  Woc_Walk: walk,
  Woc_Walk_Back: backpedal,
  Woc_Run_Back: runback,
  Woc_Jump: jump,
  Woc_Death: death,
  Woc_Attack_1H_1: attack1h1,
  Woc_Attack_Unarmed_0: unarmed(0),
  Woc_Attack_Unarmed_1: unarmed(1),
  Woc_Attack_2H_0: twoHand(0),
  Woc_Attack_2H_1: twoHand(1),
  Woc_Attack_Rifle: rifle,
  Woc_Attack_Bow: bow,
  Woc_Attack_Dual: dualPair,
  'Woc_Attack_Dual#main': dualPair,
  'Woc_Attack_Dual#off': dualOff,
  Woc_Swim: swim,
  Woc_Swim_Idle: tread,
  Woc_Swim_Back: swimBack,
  Woc_Swim_Left: swimLeft,
  Woc_Swim_Right: swimRight,
  Woc_Emote_Wave: wave,
  Woc_Emote_Laugh: laugh,
  Woc_Emote_Flex: muscle,
  Woc_Emote_Bow: bowEmote,
  Woc_Emote_Nod: agree,
  Woc_Emote_Shake_Head: disagree,
  Woc_Emote_Beckon: beckon,
  Woc_Emote_Point: point,
  Woc_Sit: sit,
  Woc_Talk: chat,
  Woc_Attack_Thrown: thrown,
  Woc_Attack_Offhand: offCut,
  Woc_Attack_Offhand_Stab: offStab,
  Woc_Attack_1H_Stab: stab,
  Woc_Attack_Polearm_0: long0,
  Woc_Attack_Polearm_1: long1,
  Woc_Attack_Polearm_2: long2,
  Woc_Crouch_Idle: crouchIdle,
  Woc_Crouch_Forward: crouchWalk(0),
  Woc_Crouch_Back: crouchWalk(180),
  Woc_Crouch_Left: crouchWalk(90),
  Woc_Crouch_Right: crouchWalk(-90),
  Woc_Crouch_Forward_Left: crouchWalk(45),
  Woc_Crouch_Forward_Right: crouchWalk(-45),
  Woc_Crouch_Back_Left: crouchWalk(135),
  Woc_Crouch_Back_Right: crouchWalk(-135),
  Woc_Hover: hoverIdle,
  Woc_Fly_Forward: flyForward,
  Woc_Fly_Back: flyBack,
  Woc_Fly_Left: flyLeft,
  Woc_Fly_Right: flyRight,
};

// Blade resolution searches joint space; reuse it within one process per rig.
const resolvedSpecs = new WeakMap();

/** The clip spec with blade keys resolved to joint keys, plus their residuals. */
export function keyedSpec(model, fit, name) {
  if (!resolvedSpecs.has(model)) resolvedSpecs.set(model, new Map());
  const cache = resolvedSpecs.get(model);
  const key = `${fit}/${name}`;
  if (!cache.has(key))
    cache.set(
      key,
      solvedOnDisk(model, fit, name, KEYED[name].clip(fit, model), (raw) => {
        const reached = resolveReachKeys(raw, model);
        const bladed = resolveBladeKeys(reached.spec, model);
        return { ...bladed, reachResiduals: reached.residuals };
      }),
    );
  return cache.get(key);
}

// Solving reach and blade keys searches joint space and dominates a build, so a
// solved spec is kept on disk while its authored spec, the rig and the solver
// sources are unchanged. WOC_KEYED_NO_CACHE=1 solves everything afresh.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(HERE, '../../../../tmp/woc_keyed_anims/spec-cache');
const SOLVERS = ['anatomy.mjs', 'reach.mjs', 'blade.mjs', 'spline.mjs']
  .map((file) => fs.readFileSync(path.join(HERE, file), 'utf8'))
  .join('\n');
const rigDigests = new WeakMap();

function cachePath(model, fit, name, raw) {
  if (!rigDigests.has(model))
    rigDigests.set(model, createHash('sha256').update(JSON.stringify(model.rig)).digest('hex'));
  const hash = createHash('sha256')
    .update(SOLVERS)
    .update(rigDigests.get(model))
    .update(`${fit}/${name}`)
    .update(JSON.stringify(raw, (_, v) => (typeof v === 'function' ? v.toString() : v)))
    .digest('hex')
    .slice(0, 32);
  return path.join(CACHE_DIR, `${hash}.json`);
}

/** Whether a clip's solved spec is already on disk, without solving it. */
export function keyedSpecCached(model, fit, name) {
  if (process.env.WOC_KEYED_NO_CACHE) return false;
  return fs.existsSync(cachePath(model, fit, name, KEYED[name].clip(fit, model)));
}

function solvedOnDisk(model, fit, name, raw, solve) {
  if (process.env.WOC_KEYED_NO_CACHE) return solve(raw);
  const file = cachePath(model, fit, name, raw);
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...saved, spec: { ...raw, keys: saved.keys, lag: saved.lag } };
  }
  const solved = solve(raw);
  const { keys, lag } = solved.spec;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      keys,
      lag,
      residuals: solved.residuals,
      reachResiduals: solved.reachResiduals,
    }),
  );
  return solved;
}

/** Bakes a keyed clip at 60 Hz into local tracks for every rig bone. */
export function bakeKeyed(model, fit, name) {
  const { spec, residuals } = keyedSpec(model, fit, name);
  const track = keyedTrack(spec.keys, spec);
  const solver = makeAnatomySolver(model);
  const grip = spec.grip ? gripTrack(model, spec, track) : null;
  const frames = Math.round(spec.duration * 60) + 1;
  const fps = (frames - 1) / spec.duration;
  const tracks = Object.fromEntries(model.rig.map((b) => [b.name, { t: [], q: [] }]));
  for (let frame = 0; frame < frames; frame++) {
    const seconds = frame / fps;
    // A loop's last frame is its first, exactly.
    const sampled = track.sample(spec.loop && frame === frames - 1 ? 0 : seconds);
    const shaped = spec.pose ? spec.pose(sampled, seconds) : sampled;
    const pose = grip ? grip(shaped, seconds) : shaped;
    const { local } = solver.solve(pose);
    for (const b of model.rig) {
      tracks[b.name].t.push(local[b.name].t);
      tracks[b.name].q.push(local[b.name].q);
    }
  }
  return {
    name,
    duration: spec.duration,
    frames,
    fps,
    loop: spec.loop,
    family: spec.family,
    tracks,
    warnings: {
      ...Object.fromEntries(solver.warnings),
      ...Object.fromEntries(
        (keyedSpec(model, fit, name).reachResiduals ?? [])
          .filter((r) => r.error > 0.01)
          .map((r) => [`reach.${r.side}@${r.t}`, r.error]),
      ),
      ...Object.fromEntries(
        residuals.filter((r) => r.missDeg > 8).map((r) => [`blade.${r.side}@${r.t}`, r.missDeg]),
      ),
    },
    bladeResiduals: residuals,
  };
}
