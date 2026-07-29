// The Thornhollow Fields TERRAIN: the stamp chain that turns the plan's flat
// rectangle into ground worth looking at, without moving a single lane.
//
// The shape is deliberately gentle, because the plan below it is combat-tuned
// and every route, sight line and cover angle was measured on flat ground:
//
//   keep terraces   each keep end sits on a full-width terrace two yards up,
//                   reached by a 16yd ramp that spans the whole field, so the
//                   fortresses read as high ground without pinching a lane;
//   the ruin bowl   the Ruin Courtyard dishes to about two yards down, which
//                   sinks the heart ruin's footing and makes the curtains loom
//                   over the crossing, and still leaves every gate ray sealed
//                   by the ruin's mass (its top clears the eye line by yards);
//   chamber rolls   soft mirrored swells in the two field chambers;
//   ground grain    a fine mirrored ripple, a couple of handspans at most, so
//                   the surface catches light instead of reading as a plane.
//
// Every stamp is authored as a POINT-MIRRORED pair (or is symmetric about the
// origin by construction), so the two halves of the field are the same ground.
// Slopes stay far under PLAYER_MAX_CLIMB_SLOPE (1.5) and, apart from the two
// terraces, under the physics step height, so nothing here gates a stride.
//
// Pure and deterministic: hashed scatter, no rng, no clock.

import { HALF_X, HALF_Z } from './field_plan.mjs';

/** How high each keep terrace stands over the ravine floor. */
export const KEEP_TERRACE_Y = 2;
/** How deep the Ruin Courtyard dishes at its heart. */
export const COURTYARD_DEPTH = -2.2;

/** Deterministic 0..1 hash; the render core's hash2, restated here so the
 *  builder stays a leaf. NOT gameplay randomness: static layout. */
function hash01(a, b) {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Mirror a stamp through the field centre. */
const mirrorStamp = (s) => ({ ...s, x: -s.x, z: -s.z });

/** A stamp and its point mirror, unless it is already centred. */
function pair(out, s) {
  out.push(s);
  if (Math.abs(s.x) > 1e-9 || Math.abs(s.z) > 1e-9) out.push(mirrorStamp(s));
}

/**
 * The full stamp chain, in application order. Order is load-bearing: the base
 * levels everything to the ravine floor, the big shapes land next, and the
 * grain rides on top as additive detail.
 */
export function terrainStamps() {
  const out = [];

  // 1. Level the whole rect to the ravine floor. Flat 'level' stamps, so the
  //    base height the chain starts from is irrelevant: the chain IS the field.
  for (const cx of [-HALF_X, HALF_X]) {
    for (const cz of [-HALF_Z, 0, HALF_Z]) {
      out.push({ x: cx, z: cz, radius: 170, delta: 0, falloff: 'flat', mode: 'level' });
    }
  }

  // 2. The Ruin Courtyard bowl: one broad dish centred on the heart ruin. Its
  //    rim fades out just past the curtain line, so the crossing walls stand on
  //    the shoulder and the courtyard reads as sunk ground rather than a pit.
  out.push({
    x: 0,
    z: 0,
    radius: 66,
    delta: COURTYARD_DEPTH,
    falloff: 'smooth',
    mode: 'level',
    hardness: 0.16,
  });

  // 3. The keep terraces: a row of overlapping level stamps along each end, so
  //    the plateau runs the FULL width of the field and the ramp off it is a
  //    single continuous front rather than a set of circular lobes.
  for (const sign of [-1, 1]) {
    for (const cx of [-48, -32, -16, 0, 16, 32, 48]) {
      out.push({
        x: cx,
        z: sign * (HALF_Z + 4),
        radius: 48,
        delta: KEEP_TERRACE_Y,
        falloff: 'smooth',
        mode: 'level',
        hardness: 0.62,
      });
    }
  }

  // 4. Chamber rolls: soft swells and hollows in the two field chambers, wide
  //    enough that a runner feels the ground breathe and shallow enough that
  //    nothing they fight around changes.
  const rolls = [
    { x: -30, z: -88, radius: 34, delta: 0.55 },
    { x: 22, z: -78, radius: 30, delta: -0.45 },
    { x: 38, z: -96, radius: 26, delta: 0.5 },
    { x: -6, z: -66, radius: 28, delta: -0.35 },
    { x: -44, z: -70, radius: 24, delta: 0.6 },
    { x: 30, z: -62, radius: 22, delta: 0.4 },
  ];
  for (const r of rolls) {
    pair(out, { ...r, falloff: 'smooth', mode: undefined, hardness: 0.1 });
  }

  // 4b. Chamber features: one size up from the rolls, so the field chambers
  //     read as ground with a shape rather than a plain with a ripple. A grassy
  //     knoll over each keep approach's west pocket, a soft hollow on the east
  //     approach, and a rise against the rampart before the curtain. All of it
  //     sits clear of the rune pads, the rubble formations, the barricades and
  //     the pinned landmark heights (the flag terraces, the chamber centre at
  //     z -80, the gate thresholds), and the slopes stay a stroll: cover walls
  //     and crates seat themselves on whatever ground this gives them.
  const features = [
    { x: -38, z: -104, radius: 20, delta: 1.1 },
    { x: 24, z: -88, radius: 18, delta: -0.8 },
    { x: 36, z: -70, radius: 16, delta: 0.9 },
  ];
  for (const f of features) {
    pair(out, { ...f, falloff: 'smooth', mode: undefined, hardness: 0.12 });
  }

  // 5. Ground grain: a fine mirrored ripple over the whole rect. Placed on a
  //    hashed lattice so it never lines up into visible rows, and capped at a
  //    couple of handspans so it can never gate a stride or tilt a wall.
  const GRAIN_ROWS = 13;
  const GRAIN_COLS = 5;
  for (let r = 0; r < GRAIN_ROWS; r++) {
    for (let c = 0; c < GRAIN_COLS; c++) {
      const jx = hash01(r * 3.7 + 1, c * 5.3 + 2);
      const jz = hash01(c * 7.1 + 3, r * 2.9 + 4);
      const jd = hash01(r * 11.3 + 5, c * 13.7 + 6);
      const x = -HALF_X + ((c + 0.5 + (jx - 0.5) * 0.8) * (HALF_X * 2)) / GRAIN_COLS;
      const z = -HALF_Z + ((r + 0.5 + (jz - 0.5) * 0.8) * HALF_Z) / GRAIN_ROWS;
      if (z > -2) continue; // the canonical half only; the mirror covers +z
      pair(out, {
        x: Math.round(x * 100) / 100,
        z: Math.round(z * 100) / 100,
        radius: 9 + Math.round(jd * 700) / 100,
        delta: Math.round((jd - 0.5) * 46) / 100,
        falloff: 'smooth',
        hardness: 0.15,
      });
    }
  }

  // Drop the undefined 'mode' keys the roll spread introduced: the compiler and
  // the sim both key off the property being absent, not undefined.
  return out.map((s) => {
    const o = { x: s.x, z: s.z, radius: s.radius, delta: s.delta, falloff: s.falloff };
    if (s.mode === 'level') o.mode = 'level';
    if (s.hardness !== undefined) o.hardness = s.hardness;
    return o;
  });
}
