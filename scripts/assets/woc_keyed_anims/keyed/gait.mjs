// Shared IK-foot gait machinery for hand-keyed locomotion (run, walk, backpedal,
// crouch, backward run). A gait clip supplies its timing, foot paths and body
// keys; this module plants each foot so it travels at exactly the clip's ground
// speed against the direction of travel while it rolls through its stance pitch
// (heel strike, flat, heel rise, or ball first for backward steps), and joins
// the authored swing path to both ends of the stance with matching velocity.
//
// Foot positions are expressed in the travel frame: `along` (+ in the travel
// direction), `lateral` (+ away from the body's midline) and height. The feet
// keep facing the body's forward (+Z) whatever the travel direction.
import { Vector3 } from 'three';
import { groundAnkle } from './anatomy.mjs';
import { hermitePath } from './spline.mjs';

const SIDES = { l: 'r', r: 'l' };

/** The opposite step: swap sides and mirror lateral, yaw and roll values. */
export function mirrorKey(key) {
  const out = {};
  for (const [name, value] of Object.entries(key)) {
    if (name === 'p' || name === 't' || name === 'ease') continue;
    if (name === 'pelvis')
      out.pelvis = {
        pos: value.pos && [-value.pos[0], value.pos[1], value.pos[2]],
        rot: value.rot && [value.rot[0], -value.rot[1], -value.rot[2]],
      };
    else if (name === 'reach')
      out.reach = Object.fromEntries(
        Object.entries(value).map(([s, { at, elbow }]) => [
          SIDES[s],
          { at: [-at[0], at[1], at[2]], elbow: [-elbow[0], elbow[1], elbow[2]] },
        ]),
      );
    else if (Array.isArray(value)) out[name] = [value[0], -value[1], -value[2]];
    else out[name] = Object.fromEntries(Object.entries(value).map(([s, v]) => [SIDES[s], v]));
  }
  if (key.ease !== undefined) out.ease = key.ease;
  return out;
}

const smooth = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * Builds a looping gait clip spec.
 *  spec.period, spec.stance: cycle and per-foot stance seconds.
 *  spec.speed: ground speed in rig units per second.
 *  spec.travel: [x, z] unit direction the body moves (default forward [0, 1]).
 *  spec.contact: `along` of the ground anchor at touchdown (+ ahead of the home).
 *  spec.track: lateral half-distance between the feet; spec.home: optional [x, z]
 *    offset of both feet's home; spec.toeOut: foot yaw (+ out) in degrees.
 *  spec.stancePitch: [fraction of stance, pitch] keys through the stance.
 *  spec.swing: [fraction of swing, along, height, ankle flex, lateral?] keys.
 *  spec.leftContact: cycle phase of the left touchdown (default 0); the right
 *    touches down half a cycle later.
 *  spec.half: body keys at cycle phase `p` for half a cycle, mirrored for the
 *    other step; or spec.cycle: body keys at `p` for the whole cycle.
 *  spec.knee: { stance, swing } knee-out degrees.
 */
export function gaitClip(spec, model, extra = {}) {
  const T = spec.period;
  const stance = spec.stance / T;
  const speed = spec.speed;
  const travel = new Vector3(spec.travel?.[0] ?? 0, 0, spec.travel?.[1] ?? 1).normalize();
  const home = spec.home ?? [0, 0];
  // Keys may sit at any phase; the spline wraps a loop's neighbours across the seam.
  const at = (p) => (((p % 1) + 1) % 1) * T;
  const keys = [];
  if (spec.half) {
    for (const key of spec.half) {
      const { p, ...pose } = key;
      keys.push({ t: at(p), ...pose });
      keys.push({ t: at(p + 0.5), ...mirrorKey(key) });
    }
  } else
    for (const key of spec.cycle) {
      const { p, ...pose } = key;
      keys.push({ t: at(p), ...pose });
    }

  const stancePitch = hermitePath(spec.stancePitch, 0, 0);
  const homeOf = (side) =>
    new Vector3(home[0] + (side === 'l' ? spec.track : -spec.track), 0, home[1]);
  // Lateral axis points away from the midline for each foot.
  const outward = (side) => new Vector3(side === 'l' ? 1 : -1, 0, 0);
  // Ground state of a foot `s` (0..1) through its stance.
  const grounded = (side, s) => {
    const along = spec.contact - s * stance * T * speed;
    const anchor = homeOf(side).addScaledVector(travel, along);
    const pitch = stancePitch(s);
    return {
      anchor: anchor.toArray(),
      pitch,
      ankle: groundAnkle(model, side, anchor.toArray(), pitch, spec.toeOut),
    };
  };
  // Swing ankle path in the travel frame, joined to stance with matching velocity.
  const swingSeconds = (1 - stance) * T;
  const paths = {};
  for (const side of ['l', 'r']) {
    const eps = 1e-4;
    const toFrame = (v, origin = true) => {
      const d = origin ? v.clone().sub(homeOf(side)) : v.clone();
      // Lateral is measured across the travel direction, away from the midline.
      const across = new Vector3(travel.z, 0, -travel.x);
      const sign = across.dot(outward(side)) >= 0 ? 1 : -1;
      return { along: d.dot(travel), lateral: sign * d.dot(across), height: d.y, across, sign };
    };
    const off = grounded(side, 1).ankle,
      offPrev = grounded(side, 1 - eps).ankle;
    const on = grounded(side, 0).ankle,
      onNext = grounded(side, eps).ankle;
    const vOff = off
      .clone()
      .sub(offPrev)
      .divideScalar(eps * stance * T);
    const vOn = onNext
      .clone()
      .sub(on)
      .divideScalar(eps * stance * T);
    const fOff = toFrame(off),
      fOn = toFrame(on);
    const dOff = toFrame(vOff, false),
      dOn = toFrame(vOn, false);
    const axis = (k, start, end, vStart, vEnd) =>
      hermitePath(
        [[0, start], ...spec.swing.map((s) => [s[0], s[k]]), [1, end]],
        vStart * swingSeconds,
        vEnd * swingSeconds,
      );
    const lateralKeys = spec.swing.filter((s) => s[4] !== undefined);
    paths[side] = {
      along: axis(1, fOff.along, fOn.along, dOff.along, dOn.along),
      height: axis(2, fOff.height, fOn.height, dOff.height, dOn.height),
      flex: hermitePath(
        [
          [0, spec.swingFlex?.[0] ?? -28],
          ...spec.swing.map((s) => [s[0], s[3]]),
          [1, spec.swingFlex?.[1] ?? 10],
        ],
        0,
        0,
      ),
      // A toed-out foot rolling over its ball moves the ankle sideways, so the
      // swing joins that too, easing through the track width midway (or through
      // authored lateral keys).
      lateral: hermitePath(
        [
          [0, fOff.lateral],
          ...(lateralKeys.length ? lateralKeys.map((s) => [s[0], s[4]]) : [[0.5, 0]]),
          [1, fOn.lateral],
        ],
        dOff.lateral * swingSeconds,
        dOn.lateral * swingSeconds,
      ),
      across: fOff.across.clone().multiplyScalar(fOff.sign),
    };
  }
  const offPitch = spec.stancePitch.at(-1)[1],
    onPitch = spec.stancePitch[0][1];
  const leftContact = spec.leftContact ?? 0;
  const air = spec.air ?? [0.04, 0.16, 0.86, 0.14];

  function footAt(side, seconds) {
    const phase = (((seconds / T - leftContact + (side === 'r' ? 0.5 : 0)) % 1) + 1) % 1;
    if (phase < stance) {
      const g = grounded(side, phase / stance);
      return { pos: g.anchor, pitch: g.pitch, yaw: spec.toeOut, knee: spec.knee.stance };
    }
    const u = (phase - stance) / (1 - stance);
    const path = paths[side];
    const ankle = homeOf(side)
      .addScaledVector(travel, path.along(u))
      .addScaledVector(path.across, path.lateral(u));
    ankle.y = path.height(u);
    return {
      ankle: ankle.toArray(),
      flex: path.flex(u),
      // Blend from the planted roll into the shin-relative ankle and back.
      air: smooth((u - air[0]) / air[1]) * (1 - smooth((u - air[2]) / air[3])),
      pitch: u < 0.5 ? offPitch : onPitch,
      yaw: spec.toeOut,
      // The toes stay curled from the push-off, then relax.
      toe: offPitch < 0 ? -offPitch * (1 - smooth((u - 0.08) / 0.22)) : 0,
      knee: spec.knee.stance + (spec.knee.swing - spec.knee.stance) * Math.sin(Math.PI * u),
    };
  }

  return {
    duration: T,
    loop: true,
    family: 'gait',
    armForm: 'swing',
    keys,
    lag: spec.lag ?? {
      arm: 0.02,
      clav: 0.02,
      elbow: 0.04,
      forearm: 0.05,
      wrist: 0.06,
      chest: 0.01,
      neck: 0.02,
      head: 0.035,
    },
    pose(sampled, seconds) {
      return { ...sampled, foot: { l: footAt('l', seconds), r: footAt('r', seconds) } };
    },
    meta: { speed, stance },
    ...extra,
  };
}

/** Ground speed in rig units per second for a game speed in yards per second. */
export function rigSpeed(anatomy, fit, yardsPerSecond) {
  // A WOC player stands 2.86 yd tall; anatomyTop is that height in rig units.
  return yardsPerSecond / (2.86 / anatomy.anatomyTop[fit]);
}
