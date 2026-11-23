// Two-hand grip: the support hand rides the weapon held in the other hand.
//
// The support hand is still posed by hand at keys (reach keys put it on the
// haft). At every one of those keys its hand slot is read in the weapon hand's
// slot frame; between keys that offset is interpolated and the support arm is
// solved onto it each frame by IK, so the hand stays on the haft while the
// weapon swings instead of drifting off it along its own joint-space path.
//   spec.grip = { hand: 'l', weight: [[t, w], ...] }
// `weight` (piecewise linear, default 1) lets the hand let go and take hold
// again; at weight 0 the keyed arm plays untouched.
import { Vector3 } from 'three';
import { makeAnatomySolver } from './anatomy.mjs';
import { placeArm } from './reach.mjs';

const lerp = (a, b, u) => a + (b - a) * u;
// Fraction of the arm's full reach where the soft-reach easing begins.
const SOFT_START = 0.9;
// Time constant (seconds) of the solved arm's follow-through.
const FOLLOW = 0.035;
// Furthest the follow-through may leave the hand from its solved place (rig units).
const SLIP = 0.012;
// Keyed elbow flexion (degrees) over which its bend direction becomes trusted.
const BENT = [10, 30];

function piecewise(points, t, fallback) {
  if (!points?.length) return fallback;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    const [t0, v0] = points[i - 1];
    if (t <= t1) return lerp(v0, v1, (t - t0) / (t1 - t0));
  }
  return points.at(-1)[1];
}

/** Per-frame grip solver for a clip spec whose keys are already resolved. */
export function gripTrack(model, spec, track) {
  const { hand } = spec.grip;
  const weapon = hand === 'l' ? 'r' : 'l';
  const solver = makeAnatomySolver(model);
  const bindP = (name) => model.world.get(name).p;
  const reach =
    bindP(`upperarm.${hand}`).distanceTo(bindP(`lowerarm.${hand}`)) +
    bindP(`lowerarm.${hand}`).distanceTo(bindP(`wrist.${hand}`)) +
    bindP(`wrist.${hand}`).distanceTo(bindP(`handslot.${hand}`));
  const slots = (pose) => {
    const { world } = solver.solve(pose);
    return { held: world.get(`handslot.${weapon}`), grip: world.get(`handslot.${hand}`), world };
  };
  // The support hand's place in the weapon hand's frame at each of its arm keys.
  const anchors = [...new Set(spec.keys.filter((k) => k.arm?.[hand]).map((k) => k.t))].sort(
    (a, b) => a - b,
  );
  if (!anchors.length) throw Error('grip: the support hand has no arm keys');
  const offsets = anchors.map((t) => {
    const { held, grip } = slots(track.sample(t));
    return grip.p.clone().sub(held.p).applyQuaternion(held.q.clone().invert());
  });
  // Between anchors the hand turns about the haft (the slot's +Y) and slides
  // along it, rather than cutting straight through the shaft as the weapon rolls.
  const around = (a, b, u) => {
    const ra = Math.hypot(a.x, a.z),
      rb = Math.hypot(b.x, b.z);
    const aa = Math.atan2(a.z, a.x);
    let turn = Math.atan2(b.z, b.x) - aa;
    turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
    const radius = lerp(ra, rb, u),
      angle = aa + turn * u;
    return new Vector3(radius * Math.cos(angle), lerp(a.y, b.y, u), radius * Math.sin(angle));
  };
  const offsetAt = (t) => {
    if (spec.loop) t = ((t % spec.duration) + spec.duration) % spec.duration;
    if (t <= anchors[0]) return offsets[0].clone();
    for (let i = 1; i < anchors.length; i++)
      if (t <= anchors[i]) {
        const u = (t - anchors[i - 1]) / (anchors[i] - anchors[i - 1]);
        return around(offsets[i - 1], offsets[i], u);
      }
    return offsets.at(-1).clone();
  };
  let warm = null;
  let lastPole = null;
  let settled = null;
  let settledAt = 0;
  return (pose, seconds) => {
    const weight = piecewise(spec.grip.weight, seconds, 1);
    if (weight <= 0) {
      warm = null;
      lastPole = null;
      settled = null;
      return pose;
    }
    const { held, world } = slots(pose);
    const shoulder = world.get(`upperarm.${hand}`).p;
    // Soft reach: near full extension the target is eased toward the shoulder,
    // so a straightening arm settles instead of snapping when the haft passes
    // the edge of its reach (the hand trails the haft by a centimetre or two).
    const target = offsetAt(seconds).applyQuaternion(held.q).add(held.p);
    const toTarget = target.clone().sub(shoulder);
    const distance = toTarget.length();
    const soft = SOFT_START * reach;
    if (distance > soft) {
      const room = reach - soft;
      const eased = soft + room * (1 - Math.exp(-(distance - soft) / room));
      target.copy(shoulder).addScaledVector(toTarget, eased / distance);
    }
    // The elbow points where the keyed arm points it, low-passed against the
    // previous frame so the pole cannot flip when the keyed elbow passes close
    // to the shoulder-to-hand line. A keyed arm that is nearly straight (or
    // locked a degree past straight, which reverses its bend) says nothing
    // about where the elbow points, so the last pole holds until it bends again.
    const axis = target.clone().sub(shoulder).normalize();
    const perp = (v) => v.clone().addScaledVector(axis, -v.dot(axis));
    const keyedPole = perp(world.get(`lowerarm.${hand}`).p.clone().sub(shoulder));
    let pole = keyedPole.lengthSq() > 1e-6 ? keyedPole.normalize() : null;
    const trust = Math.max(
      0,
      Math.min(1, ((pose.elbow?.[hand] ?? 0) - BENT[0]) / (BENT[1] - BENT[0])),
    );
    if (lastPole) {
      const previous = perp(lastPole);
      if (previous.lengthSq() > 1e-6) {
        previous.normalize();
        pole = pole
          ? previous.multiplyScalar(1 - 0.25 * trust).addScaledVector(pole, 0.25 * trust)
          : previous;
      }
    }
    if (!pole || pole.lengthSq() < 1e-8) pole = lastPole ?? new Vector3(0, -1, 0);
    pole.normalize();
    lastPole = pole.clone();
    const hint = pole.toArray();
    const keyed = { ...pose.arm[hand], flex: pose.elbow[hand] };
    const placed = placeArm(
      model,
      solver,
      pose,
      hand,
      target,
      hint,
      spec.armForm,
      warm ?? {
        twist: keyed.twist ?? 0,
        flex: keyed.flex ?? 0,
      },
    );
    warm = { twist: placed.arm.twist, flex: placed.elbow };
    // A short follow-through on the solved arm: where the haft jumps across the
    // arm's near-straight range in a frame, the elbow catches up over a few
    // frames instead of in one.
    // The lag is capped where it would pull the hand off the haft: in a fast
    // chop the arm keeps up, near a straight arm (where the elbow swings most
    // for the least hand travel) it still settles.
    const solvedArm = { ...placed.arm, elbow: placed.elbow };
    const follow =
      settled && seconds > settledAt ? 1 - Math.exp(-(seconds - settledAt) / FOLLOW) : 1;
    if (settled && follow < 1) {
      const previous = settled;
      const toward = (u) =>
        Object.fromEntries(Object.entries(solvedArm).map(([k, v]) => [k, lerp(previous[k], v, u)]));
      const handAt = ({ elbow, ...arm }) =>
        solver
          .solve({
            ...pose,
            arm: { ...pose.arm, [hand]: arm },
            elbow: { ...pose.elbow, [hand]: elbow },
          })
          .world.get(`handslot.${hand}`).p;
      const solvedHand = handAt(solvedArm);
      let u = follow;
      if (handAt(toward(u)).distanceTo(solvedHand) > SLIP) {
        let low = follow,
          high = 1;
        for (let i = 0; i < 8; i++) {
          const mid = (low + high) / 2;
          if (handAt(toward(mid)).distanceTo(solvedHand) > SLIP) low = mid;
          else high = mid;
        }
        u = high;
      }
      settled = toward(u);
    } else settled = solvedArm;
    settledAt = seconds;
    const blend = (a = 0, b = 0) => lerp(a, b, weight);
    const arm = Object.fromEntries(
      Object.keys(placed.arm).map((k) => [k, blend(pose.arm[hand]?.[k], settled[k])]),
    );
    return {
      ...pose,
      arm: { ...pose.arm, [hand]: arm },
      elbow: { ...pose.elbow, [hand]: blend(pose.elbow[hand], settled.elbow) },
    };
  };
}
