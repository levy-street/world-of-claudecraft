// Held-weapon direction keys, resolved into keyed joint angles: the way an
// animator poses a prop with an aim helper and then keys the joints. Between
// keys the joints interpolate, so the blade swings on natural arcs.
//
// Each blade key may use the forearm's rotation (-100 to 130 degrees of
// supination) and the wrist's flexion (-65 to 75) and deviation (-35 ulnar to
// 20 radial). On a hand placed with `reach` the elbow may also swing up to 75
// degrees about the shoulder-to-hand line, keeping the hand where it was put;
// on a free arm the upper arm may turn up to 30 degrees from its authored twist.
// Many joint combinations point a blade the same way, so all keys are solved
// together: candidate solutions per key, then the sequence with the least joint
// travel between neighbouring keys (scaled by the time between them) and the
// least strain away from neutral. That keeps the forearm from flipping between
// distant solutions on consecutive keys. A key the arm can only approach is
// reported with its miss; a gross miss is an error, so the arm key gets fixed
// instead of the wrist breaking.
import { Vector3 } from 'three';
import { armDirection, makeAnatomySolver } from './anatomy.mjs';
import { placeArm, reachTarget, swivelHint, unwrapTwist } from './reach.mjs';
import { keyedTrack } from './spline.mjs';

// Aim within TOLERANCE is on target; up to HARD_LIMIT is reported as a warning.
const TOLERANCE = 8;
const HARD_LIMIT = 25;
const TWIST_RANGE = 30;
const SWIVEL = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
const LIMITS = { sup: [-100, 130], flex: [-65, 75], dev: [-35, 20] };
const JOINTS = ['twist', 'sup', 'flex', 'dev'];
// Relative cost of travel per joint: wrist motion is more visible than roll.
const TRAVEL = { twist: 1, sup: 0.8, flex: 1.5, dev: 2 };
const KEEP = 400;

const grid = (low, high, step) => {
  const out = [];
  for (let v = low; v <= high + 1e-9; v += step) out.push(v);
  return out;
};
const strain = (p, twist0) =>
  0.04 * Math.abs(p.flex) +
  0.08 * Math.abs(p.dev) +
  (p.phi === undefined ? 0.05 * Math.abs(p.twist - twist0) : 0.03 * Math.abs(p.phi));
const aimCost = (miss) => miss + 2 * Math.max(0, miss - TOLERANCE / 2);
const local = (s, p) => aimCost(p.miss) + strain(p, s.twist0);
// Whole-arm travel (opt-in per clip with `bladeTravel: 'arm'`): the angle the
// upper arm turns through and the elbow's change count as well, so neighbouring
// keys do not pick distant elbow swivels that make the arm sweep between them.
const armTravel = (a, b) => {
  if (!a.arm || !b.arm) return 0;
  const turn = (armDirection(a.arm).angleTo(armDirection(b.arm)) * 180) / Math.PI;
  return turn + 0.5 * Math.abs(a.elbowFlex - b.elbowFlex);
};
// A clip whose hands mostly hold still weighs travel higher (`bladeSteady`, 1 by
// default), so a held hand keeps one grip rather than chasing each key's last
// few degrees through a different forearm/wrist split, which reads as a wobble.
const travelFor =
  (mode, weight = 1) =>
  (a, b, dt) =>
    weight *
    (travel(a, b, dt) + (mode === 'arm' ? (armTravel(a, b) * 0.008) / Math.max(dt, 0.02) : 0));
const travel = (a, b, dt) =>
  (JOINTS.reduce((sum, j) => sum + TRAVEL[j] * Math.abs(a[j] - b[j]), 0) * 0.008) /
  Math.max(dt, 0.02);

/** Returns the clip spec with every `blade` key turned into arm, forearm and wrist keys. */
export function resolveBladeKeys(spec, model) {
  if (!spec.keys.some((k) => k.blade)) return { spec: strip(spec), residuals: [] };
  const base = keyedTrack(
    spec.keys.map(({ blade, bladeFace, placed, bladeRange, ...key }) => key),
    { ...spec, lag: {} },
  );
  const solver = makeAnatomySolver(model);
  const step = travelFor(spec.bladeTravel, spec.bladeSteady);
  const indexed = spec.keys.map((key, index) => ({ key, index }));
  const sides = [...new Set(spec.keys.flatMap((k) => Object.keys(k.blade ?? {})))];
  const resolved = new Map();
  const residuals = [];
  for (const side of sides) {
    const bladeKeys = indexed
      .filter(({ key }) => key.blade?.[side])
      .sort((a, b) => a.key.t - b.key.t);
    const stages = bladeKeys.map(({ key, index }) => {
      const target = new Vector3(...key.blade[side]).normalize();
      const pose = base.sample(key.t);
      pose.arm = { ...pose.arm, [side]: { ...pose.arm?.[side] } };
      pose.elbow = { ...pose.elbow };
      pose.forearm = { ...pose.forearm };
      pose.wrist = { ...pose.wrist };
      const twist0 = pose.arm[side].twist ?? 0;
      const placed = key.placed?.[side];
      // An optional facing (`bladeFace`) also turns the prop about its own axis:
      // the slot's +Z is aimed at it, as seen across the blade. A bow's limbs
      // and a crossbow's stock need this; a sword's edge does not.
      const face = key.bladeFace?.[side] ? new Vector3(...key.bladeFace[side]) : null;
      const slotAt = (p) => {
        if (p.arm) {
          pose.arm[side] = p.arm;
          pose.elbow[side] = p.elbowFlex;
        } else pose.arm[side] = { ...pose.arm[side], twist: p.twist };
        pose.forearm[side] = p.sup;
        pose.wrist[side] = [p.flex, p.dev];
        return solver.solve(pose).world.get(`handslot.${side}`).q;
      };
      const bladeAt = (p) => new Vector3(0, 1, 0).applyQuaternion(slotAt(p));
      const across = (v, axis) => v.clone().addScaledVector(axis, -v.dot(axis)).normalize();
      const miss = (p) => {
        const q = slotAt(p);
        const blade = new Vector3(0, 1, 0).applyQuaternion(q);
        const aim = (blade.angleTo(target) * 180) / Math.PI;
        if (!face) return aim;
        const facing = across(new Vector3(0, 0, 1).applyQuaternion(q), blade);
        return aim + (0.5 * facing.angleTo(across(face, blade)) * 180) / Math.PI;
      };
      // Arm options: elbow swivels for a placed hand, twist offsets for a free arm.
      const arms = [];
      if (placed) {
        const handTarget = reachTarget(model, pose, placed.at);
        const shoulder = solver.solve(pose).world.get(`upperarm.${side}`).p.clone();
        for (const phi of SWIVEL) {
          const hint = swivelHint(placed.elbow, shoulder, handTarget, phi);
          const arm = placeArm(model, solver, pose, side, handTarget, hint, spec.armForm);
          arms.push({ phi, arm: arm.arm, elbowFlex: arm.elbow, twist: arm.arm.twist });
        }
      } else
        for (const twist of grid(
          Math.max(-180, twist0 - TWIST_RANGE),
          Math.min(180, twist0 + TWIST_RANGE),
          10,
        ))
          arms.push({ twist });
      // A key may narrow the forearm/wrist range (`bladeRange`) to choose a grip
      // family, such as a pronated forehand, without changing the anatomy limits.
      const range = { ...LIMITS, ...spec.bladeLimits, ...key.bladeRange?.[side] };
      let candidates = [];
      for (const arm of arms)
        for (const sup of grid(...range.sup, 15))
          for (const flex of grid(...range.flex, 14))
            for (const dev of grid(...range.dev, 11)) {
              const p = { ...arm, sup, flex, dev };
              candidates.push({ ...p, miss: miss(p) });
            }
      // Aim and continuity trade off: candidates within twice the tolerance stay
      // in play (aim past half the tolerance costs triple), so a key can give up a
      // few degrees rather than roll the forearm half a turn between close keys.
      const near = candidates.filter((c) => c.miss <= TOLERANCE * 2);
      candidates = near.length ? near : candidates.sort((a, b) => a.miss - b.miss).slice(0, 60);
      candidates.sort((a, b) => local({ twist0 }, a) - local({ twist0 }, b));
      candidates = candidates.slice(0, KEEP);
      return { key, index, twist0, miss, bladeAt, candidates, range };
    });
    // Shortest path through the candidates. Identical first and last keys (the
    // guard a one-shot leaves from and returns to) share one solution.
    const pose0 = (k) => JSON.stringify({ ...k, t: 0, ease: 0 });
    const same = stages.length > 1 && pose0(stages[0].key) === pose0(stages.at(-1).key);

    let best = null;
    for (const start of same ? stages[0].candidates.slice(0, 60) : [null]) {
      let layer = (start ? [start] : stages[0].candidates).map((p) => ({
        p,
        cost: local(stages[0], p),
        path: [p],
      }));
      for (let i = 1; i < stages.length; i++) {
        const dt = stages[i].key.t - stages[i - 1].key.t;
        const options = same && i === stages.length - 1 ? [start] : stages[i].candidates;
        layer = options.map((p) => {
          let pick = null;
          for (const prev of layer) {
            const cost = prev.cost + step(prev.p, p, dt);
            if (!pick || cost < pick.cost) pick = { cost, prev };
          }
          return { p, cost: pick.cost + local(stages[i], p), path: [...pick.prev.path, p] };
        });
      }
      for (const end of layer) if (!best || end.cost < best.cost) best = end;
    }
    // Refine forearm and wrist on a finer step, staying near the chosen path.
    const refined = best.path.map((choice, i) => {
      const stage = stages[i];
      const neighbours = [best.path[i - 1], best.path[i + 1]].filter(Boolean);
      const cost = (p) =>
        aimCost(stage.miss(p)) +
        strain(p, stage.twist0) +
        neighbours.reduce((sum, n) => sum + 0.3 * step(n, p, 1), 0);
      const free = choice.arm ? ['sup', 'flex', 'dev'] : JOINTS;
      const limits = {
        twist: [stage.twist0 - TWIST_RANGE, stage.twist0 + TWIST_RANGE],
        ...stage.range,
      };
      let current = { ...choice, value: cost(choice) };
      for (let step = 6; step >= 0.25; step /= 2) {
        let improved = true;
        while (improved) {
          improved = false;
          for (const j of free)
            for (const sign of [-1, 1]) {
              const p = { ...current };
              p[j] = Math.max(limits[j][0], Math.min(limits[j][1], p[j] + sign * step));
              const value = cost(p);
              if (value < current.value - 1e-9) {
                current = { ...p, value };
                improved = true;
              }
            }
        }
      }
      return current;
    });
    if (same) refined[refined.length - 1] = refined[0];
    refined.forEach((current, i) => {
      const stage = stages[i];
      const m = stage.miss(current);
      residuals.push({ t: stage.key.t, side, missDeg: Number(m.toFixed(1)) });
      if (m > HARD_LIMIT)
        throw Error(
          `Blade key at ${stage.key.t}s (${side}) misses by ${m.toFixed(1)} deg within the arm's ` +
            `limits (nearest [${stage
              .bladeAt(current)
              .toArray()
              .map((v) => v.toFixed(2))
              .join(', ')}]): adjust the arm`,
        );
      if (!resolved.has(stage.index)) resolved.set(stage.index, {});
      resolved.get(stage.index)[side] = current;
    });
  }
  const keys = spec.keys.map((key, index) => {
    const { blade, bladeFace, placed, bladeRange, ...rest } = key;
    if (!blade) return rest;
    const out = {
      ...rest,
      arm: { ...rest.arm },
      elbow: { ...rest.elbow },
      forearm: { ...rest.forearm },
      wrist: { ...rest.wrist },
    };
    for (const [side, p] of Object.entries(resolved.get(index))) {
      out.arm[side] = p.arm
        ? { ...p.arm }
        : { ...out.arm[side], twist: Number(p.twist.toFixed(2)) };
      if (p.arm) out.elbow[side] = p.elbowFlex;
      out.forearm[side] = Number(p.sup.toFixed(2));
      out.wrist[side] = [Number(p.flex.toFixed(2)), Number(p.dev.toFixed(2))];
    }
    return out;
  });
  unwrapTwist(keys);
  const lag = { ...spec.lag };
  for (const [path, seconds] of Object.entries(spec.lag ?? {})) {
    const match = /^blade\.(l|r)$/.exec(path);
    if (!match) continue;
    delete lag[path];
    lag[`forearm.${match[1]}`] ??= seconds;
    lag[`wrist.${match[1]}`] ??= seconds;
  }
  return { spec: { ...spec, keys, lag }, residuals };
}

/** Drops the reach bookkeeping from clips without blade keys. */
function strip(spec) {
  return { ...spec, keys: spec.keys.map(({ placed, ...key }) => key) };
}
