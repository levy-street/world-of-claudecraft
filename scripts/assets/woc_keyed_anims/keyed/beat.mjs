// Keys written as body-level beat targets instead of joint angles: where the
// pelvis sits and faces, how far the chest bends forward, turns and tips
// sideways over the hips, where the head looks, and where each hand and elbow
// is. A beat key turns one such target into this rig's controls: the bend and
// turn are shared across spine and chest, the look across neck and head (the
// split is this rig's own), and hands become `reach` keys placed by IK.
//
//   key(t, {
//     P: [x, y, z],            pelvis position (x, z over the ground origin)
//     r: [lean, yaw, side],    pelvis facing in world terms: + lean forward,
//                              + yaw to the character's left, + side tips the
//                              top toward the character's right
//     T: [fwd, twist, tilt],   chest over the hips, seen from the hips' heading
//                              (fwd above 90 folds the chest past horizontal)
//     H: [lean, yaw, side?],   head lean (+ down), heading and optional side tilt, world terms
//     hR, eR, hL, eL,          hand slot and elbow positions (reach.mjs frame)
//     ...                      any other key fields pass through unchanged
//   })
// The angles are read off the bones' own axes (Y along the bone, Z to the
// front), so the bind pose's built-in tilts are part of the solve.
import { Euler, Quaternion, Vector3 } from 'three';

const D = Math.PI / 180;
const body = ([pitch = 0, yaw = 0, roll = 0]) =>
  new Quaternion().setFromEuler(new Euler(pitch * D, yaw * D, -roll * D, 'YXZ'));
const round = (x) => Math.round(x * 2) / 2;
const SPINE_SHARE = 0.45;
const NECK_SHARE = 0.4;

const up = (q) => new Vector3(0, 1, 0).applyQuaternion(q);
const fwd = (q) => new Vector3(0, 0, 1).applyQuaternion(q);
const clampAsin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / D;
const heading = (q) => Math.atan2(fwd(q).x, fwd(q).z) / D;
const leanOf = (q) => clampAsin(up(q).z);
const sideOf = (q) => -clampAsin(up(q).x);
const wrap = (a) => ((a + 540) % 360) - 180;
const unturn = (deg) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -deg * D);

/** Solves n <= 3 linear equations (Gaussian elimination with pivoting). */
function linear(a, b) {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    if (Math.abs(m[c][c]) < 1e-9) return b.map(() => 0);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** Newton-solves control values until the measured values meet their targets. */
function settle(values, measure, targets) {
  const err = (v) => measure(v).map((g, k) => wrap(targets[k] - g));
  for (let i = 0; i < 25; i++) {
    const e = err(values);
    if (Math.max(...e.map(Math.abs)) < 0.05) break;
    const jac = e.map(() => []);
    values.forEach((_, k) => {
      const probe = values.map((v, j) => (j === k ? v + 0.5 : v));
      const ep = err(probe);
      ep.forEach((x, row) => {
        jac[row][k] = (e[row] - x) / 0.5;
      });
    });
    const step = linear(jac, e);
    const scale = Math.min(1, 20 / Math.max(1e-9, ...step.map(Math.abs)));
    values = values.map((v, k) => v + scale * step[k]);
  }
  return values;
}

export function beats(model) {
  const bindQ = (name) => model.world.get(name).q.clone();
  const hipsB = bindQ('hips'),
    chestB = bindQ('chest'),
    headB = bindQ('head');

  const pelvisRot = ([lean, yaw, side = 0]) => {
    const [pitch, roll] = settle(
      [lean, -side],
      ([p, r]) => {
        const q = body([p, yaw, r]).multiply(hipsB);
        return [leanOf(q), -sideOf(q)];
      },
      [lean, -side],
    );
    return [round(pitch), yaw, round(roll)];
  };

  const trunk = (rot, [targetFwd, twist, tilt]) => {
    const hips = body(rot);
    const facing = heading(hips.clone().multiply(hipsB));
    const split = ([p, y, r]) => {
      const spine = [p * SPINE_SHARE, y * SPINE_SHARE, r * SPINE_SHARE];
      return { spine, chest: [p - spine[0], y - spine[1], r - spine[2]] };
    };
    // A chest folded past horizontal (fwd > 90) is measured by the angle of its
    // up axis from vertical in the sagittal plane, and its heading then points
    // back, so the twist is read off the reversed heading.
    const folded = targetFwd > 90;
    const solved = settle(
      [targetFwd - rot[0], twist, -tilt],
      (v) => {
        const { spine, chest } = split(v);
        const q = hips.clone().multiply(body(spine)).multiply(body(chest)).multiply(chestB);
        const seen = unturn(facing).multiply(q);
        const lean = folded ? Math.atan2(up(seen).z, up(seen).y) / D : leanOf(seen);
        return [lean, heading(q) - facing - (folded ? 180 : 0), -sideOf(seen)];
      },
      [targetFwd, twist, -tilt],
    );
    const { spine, chest } = split(solved);
    return { spine: spine.map(round), chest: chest.map(round) };
  };

  // A third head value (side tilt) makes the solve three-way: a head thrown back
  // while turned far to one side tips sideways in its own frame.
  const look = (chestWorld, [lean, yaw, side]) => {
    const tilted = side !== undefined;
    const split = ([p, y, r = 0]) => {
      const neck = [p * NECK_SHARE, y * NECK_SHARE, r * NECK_SHARE];
      return { neck, head: [p - neck[0], y - neck[1], r - neck[2]] };
    };
    // Start from the turn and nod that the chest's own facing leaves to make up,
    // so the solve stays on the upright branch.
    const rest = chestWorld.clone().multiply(headB);
    // A face pointing at the floor (a prone swimmer) has no heading to start from.
    const turn = Math.abs(fwd(rest).y) < 0.9 ? wrap(yaw - heading(rest)) : 0;
    const measure = (v) => {
      const { neck, head } = split(v);
      const q = chestWorld.clone().multiply(body(neck)).multiply(body(head)).multiply(headB);
      return tilted ? [leanOf(q), heading(q), -sideOf(q)] : [leanOf(q), heading(q)];
    };
    const targets = tilted ? [lean, yaw, -side] : [lean, yaw];
    // Several look directions can read the same. Over a deeply folded chest the
    // first guess may miss or land on a head turned right round; only then are
    // other starts tried, keeping the smallest upright turn that meets the target.
    const miss = (v) => Math.max(...measure(v).map((g, k) => Math.abs(wrap(targets[k] - g))));
    const from = ([p, y]) => settle(tilted ? [p, y, 0] : [p, y], measure, targets);
    let solved = from([lean - leanOf(rest), turn]);
    if (miss(solved) > 1 || Math.abs(solved[0]) > 80 || Math.abs(solved[1]) > 120) {
      const options = [
        [lean - leanOf(rest), 0],
        [-60, 0],
        [60, 0],
      ]
        .map(from)
        .filter((v) => miss(v) <= 1 && Math.abs(v[0]) <= 80)
        .sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
      if (options.length) solved = options[0];
    }
    if (Math.abs(solved[0]) > 80) throw Error(`look: no upright head for lean ${lean} yaw ${yaw}`);
    const { neck, head } = split(solved);
    return { neck: neck.map(round), head: head.map(round) };
  };

  return (t, beat) => {
    const { P, r, T, H, hR, eR, hL, eL, ...rest } = beat;
    const key = { t, ...rest };
    let rot = null;
    if (r) {
      rot = pelvisRot(r);
      key.pelvis = { ...(P ? { pos: P } : {}), rot };
    } else if (P) key.pelvis = { pos: P };
    if (T) {
      if (!rot) throw Error(`beat @${t}: T needs r`);
      Object.assign(key, trunk(rot, T));
    }
    if (H) {
      if (!key.spine) throw Error(`beat @${t}: H needs T`);
      const chestWorld = body(rot).multiply(body(key.spine)).multiply(body(key.chest));
      Object.assign(key, look(chestWorld, H));
    }
    const reach = {};
    if (hR) reach.r = { at: hR, elbowAt: eR };
    if (hL) reach.l = { at: hL, elbowAt: eL };
    if (hR || hL) key.reach = { ...(rest.reach ?? {}), ...reach };
    return key;
  };
}

const flipX = (v) => (v ? [-v[0], v[1], v[2]] : v);
const swapSides = (o, fn = (v) => v) =>
  o && {
    ...(o.r !== undefined ? { l: fn(o.r) } : {}),
    ...(o.l !== undefined ? { r: fn(o.l) } : {}),
  };

/**
 * A beat target mirrored across the body's midline (left for right): the same
 * authored move performed to the other side. Feet keep their own side-relative
 * angles (yaw, knee) and swap sides with their positions flipped.
 */
export function mirrorBeat(beat) {
  const { P, r, T, H, hR, eR, hL, eL, foot, blade, bladeFace, ...rest } = beat;
  const out = { ...rest };
  if (P) out.P = flipX(P);
  if (r) out.r = [r[0], -r[1], -(r[2] ?? 0)];
  if (T) out.T = [T[0], -T[1], -T[2]];
  if (H) out.H = H.length > 2 ? [H[0], -H[1], -H[2]] : [H[0], -H[1]];
  if (hL) out.hR = flipX(hL);
  if (eL) out.eR = flipX(eL);
  if (hR) out.hL = flipX(hR);
  if (eR) out.eL = flipX(eR);
  for (const channel of ['clav', 'forearm', 'wrist', 'arm', 'elbow'])
    if (rest[channel]) out[channel] = swapSides(rest[channel]);
  if (foot)
    out.foot = swapSides(foot, (f) => ({
      ...f,
      ...(f.pos ? { pos: flipX(f.pos) } : {}),
      ...(f.ankle ? { ankle: flipX(f.ankle) } : {}),
    }));
  if (blade) out.blade = swapSides(blade, flipX);
  if (bladeFace) out.bladeFace = swapSides(bladeFace, flipX);
  return out;
}
