// Hand placement keys, resolved into keyed arm angles: an animator poses the
// hand with an IK handle, then keys the joints, so the motion between keys
// still follows FK arcs. A key may carry
//   reach: { r: { at: [x, y, z], elbow: [x, y, z] } }   or   { at, elbowAt: [x, y, z] }
// where `at` is the hand (handslot) position, x and z relative to the pelvis's
// ground point and y above the floor, and `elbow` is the direction the elbow
// points (body axes: +X left, +Y up, +Z forward). The resolved key gets the
// arm's direction, twist and elbow flexion; forearm and wrist stay free for
// blade keys or authored values. A blade key on a placed hand may swing the
// elbow about the shoulder-to-hand line (blade.mjs) to aim the weapon. Arms
// swinging through the hanging position (a run) should set
// `spec.armForm = 'swing'` so keys come out as flex/abd, which interpolate fore
// and aft instead of sweeping out to the side.
import { Vector3 } from 'three';
import { makeAnatomySolver } from './anatomy.mjs';
import { keyedTrack } from './spline.mjs';

const D = Math.PI / 180;

/**
 * Arm angles that put the hand slot on `target` (world) with the elbow toward
 * `hint` (body axes), for the torso already posed in `pose`. Returns the arm
 * controls, elbow flexion and the remaining distance to the target.
 */
export function placeArm(model, solver, pose, side, target, hint, armForm, warm = null) {
  const bind = model.world;
  const length = (a, b) => bind.get(a).p.distanceTo(bind.get(b).p);
  const trial = {
    ...pose,
    arm: { ...pose.arm, [side]: { raise: 0, plane: 0, twist: 0 } },
    elbow: { ...pose.elbow, [side]: 0 },
  };
  let { world } = solver.solve(trial);
  const shoulder = world.get(`upperarm.${side}`).p.clone();
  const la = length(`upperarm.${side}`, `lowerarm.${side}`);
  const lb = length(`lowerarm.${side}`, `wrist.${side}`);
  const clavQ = world
    .get(`clavicle.${side}`)
    .q.clone()
    .multiply(bind.get(`clavicle.${side}`).q.clone().invert());
  let wristTarget = target.clone();
  let best = null;
  for (let pass = 0; pass < 3; pass++) {
    const toWrist = wristTarget.clone().sub(shoulder);
    const dist = Math.min(la + lb - 1e-4, Math.max(Math.abs(la - lb) + 1e-4, toWrist.length()));
    const axis = toWrist.clone().normalize();
    const pole = new Vector3(...hint).normalize();
    pole.addScaledVector(axis, -pole.dot(axis));
    // A hint along the reach line (an elbow keyed onto a straight arm) carries
    // no direction; the elbow then hangs down and back, as a straight arm's would.
    if (pole.lengthSq() < 1e-8)
      pole.set(0, -1, -0.5).addScaledVector(axis, -axis.dot(new Vector3(0, -1, -0.5)));
    if (pole.lengthSq() < 1e-8) throw Error(`Elbow hint parallel to the reach (${side})`);
    pole.normalize();
    const along = (la * la - lb * lb + dist * dist) / (2 * dist);
    const height = Math.sqrt(Math.max(0, la * la - along * along));
    const elbowPos = shoulder.clone().addScaledVector(axis, along).addScaledVector(pole, height);
    // Upper-arm direction in the clavicle's carried frame, as the left-arm controls.
    const dir = elbowPos.clone().sub(shoulder).normalize().applyQuaternion(clavQ.clone().invert());
    if (side === 'r') dir.x = -dir.x;
    const direction =
      armForm === 'swing'
        ? {
            flex: Math.asin(Math.max(-1, Math.min(1, dir.z))) / D,
            abd: Math.atan2(dir.x, -dir.y) / D,
          }
        : {
            raise: Math.acos(Math.max(-1, Math.min(1, -dir.y))) / D,
            plane: Math.atan2(dir.z, dir.x) / D,
          };
    // Twist and elbow flexion place the hand on its cone about the upper arm.
    const fit = (twist, flex) => {
      trial.arm[side] = { ...direction, twist };
      trial.elbow[side] = flex;
      ({ world } = solver.solve(trial));
      return world.get(`handslot.${side}`).p.distanceTo(target);
    };
    let current = { twist: 0, flex: 60, err: Infinity };
    // A warm start (the previous frame's arm) keeps per-frame solves continuous.
    if (warm) current = { twist: warm.twist, flex: warm.flex, err: fit(warm.twist, warm.flex) };
    else
      for (let twist = -180; twist < 180; twist += 12)
        for (let flex = 0; flex <= 150; flex += 10) {
          const err = fit(twist, flex);
          if (err < current.err) current = { twist, flex, err };
        }
    for (let step = 6; step >= 0.1; step /= 2) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const [dt, df] of [
          [step, 0],
          [-step, 0],
          [0, step],
          [0, -step],
        ]) {
          const flex = Math.max(0, Math.min(150, current.flex + df));
          const err = fit(current.twist + dt, flex);
          if (err < current.err - 1e-9) {
            current = { twist: current.twist + dt, flex, err };
            improved = true;
          }
        }
      }
    }
    best = { direction, ...current };
    // Correct for the hand slot's offset from the wrist and solve again.
    fit(best.twist, best.flex);
    wristTarget = wristTarget.clone().add(target.clone().sub(world.get(`handslot.${side}`).p));
    if (best.err < 1e-3) break;
  }
  const twist = warm ? best.twist : ((((best.twist + 180) % 360) + 360) % 360) - 180;
  return {
    arm: {
      ...Object.fromEntries(
        Object.entries(best.direction).map(([k, v]) => [k, Number(v.toFixed(2))]),
      ),
      twist: Number(twist.toFixed(2)),
    },
    elbow: Number(best.flex.toFixed(2)),
    error: best.err,
  };
}

/** World target of a reach key at the sampled pose. */
export function reachTarget(model, pose, at) {
  const pelvis = pose.pelvis?.pos ?? model.world.get('hips').p.toArray();
  return new Vector3(pelvis[0] + at[0], at[1], pelvis[2] + at[2]);
}

/** Rotate an elbow hint about the shoulder-to-hand line by `degrees` (arm swivel). */
export function swivelHint(hint, shoulder, target, degrees) {
  const axis = target.clone().sub(shoulder).normalize();
  return new Vector3(...hint).applyAxisAngle(axis, degrees * D).toArray();
}

/** Returns the clip spec with every `reach` key turned into arm and elbow keys. */
export function resolveReachKeys(spec, model) {
  if (!spec.keys.some((k) => k.reach)) return { spec, residuals: [] };
  const base = keyedTrack(
    spec.keys.map(({ reach, blade, bladeFace, bladeRange, ...key }) => key),
    { ...spec, lag: {} },
  );
  const solver = makeAnatomySolver(model);
  const residuals = [];
  const keys = spec.keys.map((key) => {
    if (!key.reach) return key;
    const { reach, ...rest } = key;
    const out = {
      ...rest,
      arm: { ...rest.arm },
      elbow: { ...rest.elbow },
      placed: { ...rest.placed },
    };
    for (const [side, { at, elbow, elbowAt }] of Object.entries(reach)) {
      const pose = base.sample(key.t);
      const target = reachTarget(model, pose, at);
      // `elbowAt` places the elbow itself (relative to the pelvis ground point,
      // like `at`); the hint then points from the shoulder toward it.
      const hint = elbowAt
        ? reachTarget(model, pose, elbowAt)
            .sub(solver.solve(pose).world.get(`upperarm.${side}`).p)
            .toArray()
        : elbow;
      const placed = placeArm(model, solver, pose, side, target, hint, spec.armForm);
      residuals.push({ t: key.t, side, error: Number(placed.error.toFixed(4)) });
      // Out of reach: the arm points at the target fully extended, like an IK
      // handle pulled too far; the residual is reported so the key gets fixed.
      out.arm[side] = placed.arm;
      out.elbow[side] = placed.elbow;
      out.placed[side] = { at, elbow: hint };
    }
    return out;
  });
  unwrapTwist(keys);
  return { spec: { ...spec, keys }, residuals };
}

/**
 * Keep each arm's twist (and its swing plane) continuous across keys: a solve
 * is only unique mod 360, and a plane keyed at 152 then -164 would otherwise
 * swing the arm the long way round between them.
 */
export function unwrapTwist(keys) {
  for (const side of ['l', 'r'])
    for (const angle of ['twist', 'plane']) {
      let previous = null;
      for (const key of [...keys].sort((a, b) => a.t - b.t)) {
        const value = key.arm?.[side]?.[angle];
        if (value === undefined) continue;
        if (previous !== null) {
          let unwrapped = value;
          while (unwrapped - previous > 180) unwrapped -= 360;
          while (unwrapped - previous < -180) unwrapped += 360;
          key.arm[side][angle] = unwrapped;
        }
        previous = key.arm[side][angle];
      }
    }
}
