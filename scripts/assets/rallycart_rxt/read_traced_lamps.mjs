#!/usr/bin/env node
// Read a hand-traced lamp outline back out of a render, and turn it into lens
// parameters.
//
// This is the step that makes "mark it by eye" rigorous. The outline is drawn
// by a human on a picture of the car, so it owes nothing to the artifacted
// paint or the triangle soup underneath, and the maths here only ever runs on
// that clean input. Fitting a curve to a deliberate stroke is a completely
// different proposition from fitting one to AI-generated noise.
//
// The render was orthographic and rendered at its frame's true aspect, so a
// pixel converts to model x and y by linear arithmetic with no depth term.
//
// Usage: node scripts/assets/rallycart_rxt/read_traced_lamps.mjs <traced.png>

import sharp from 'sharp';

// Must match the --trace view in render_rear_views.mjs.
const FRAME = { left: -0.34, right: 0.34, bottom: 0.15, top: 0.35 };

/** The sweep axis the runtime uses, so angles come out directly usable. */
const AXIS_X = 0.16;
const AXIS_Z = -0.34;

/** Depth of the rear panel from the axis, for converting a marked x into an
 *  angle about that axis. The panel sits near z = -0.47. */
const PANEL_Z = -0.47;

function isGreen(r, g, b) {
  return g > 170 && r < 140 && b < 140 && g - Math.max(r, b) > 60;
}

/** Midpoints of the first and last green run on a row, which is the stroke's
 *  own centreline rather than its outer edge. */
function edgesOnRow(data, width, channels, y, x0, x1) {
  const runs = [];
  let start = -1;
  for (let x = x0; x <= x1; x++) {
    const o = (y * width + x) * channels;
    const green = isGreen(data[o], data[o + 1], data[o + 2]);
    if (green && start < 0) start = x;
    if ((!green || x === x1) && start >= 0) {
      runs.push((start + (green ? x : x - 1)) / 2);
      start = -1;
    }
  }
  if (runs.length < 2) return null;
  return [runs[0], runs[runs.length - 1]];
}

/** Least-squares fit of the superellipse exponent to a traced half-width
 *  profile. |s|^n + |t|^n = 1, so s = (1 - |t|^n)^(1/n). */
function fitRoundness(profile) {
  let best = { n: 2, err: Number.POSITIVE_INFINITY };
  for (let n = 1.6; n <= 12; n += 0.05) {
    let err = 0;
    for (const { t, s } of profile) {
      const model = (1 - Math.abs(t) ** n) ** (1 / n);
      if (!Number.isFinite(model)) continue;
      err += (model - s) ** 2;
    }
    if (err < best.err) best = { n, err };
  }
  return best;
}

const file = process.argv[2];
if (!file) {
  console.error('usage: read_traced_lamps.mjs <traced.png>');
  process.exit(2);
}

const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const toX = (px) => FRAME.left + (px / width) * (FRAME.right - FRAME.left);
const toY = (py) => FRAME.top - (py / height) * (FRAME.top - FRAME.bottom);

console.log(`${file}  ${width}x${height}`);

// Split into the two lamps by which half of the image they sit in; they are
// separated by the whole boot lid, so a midline split cannot go wrong.
for (const [label, x0, x1] of [
  ['LEFT  (model -x)', 0, Math.floor(width / 2) - 1],
  ['RIGHT (model +x)', Math.floor(width / 2), width - 1],
]) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const e = edgesOnRow(data, width, channels, y, x0, x1);
    if (e) rows.push({ y, left: e[0], right: e[1] });
  }
  if (rows.length < 8) {
    console.log(`\n${label}: no traced outline found`);
    continue;
  }

  const top = rows[0].y;
  const bottom = rows[rows.length - 1].y;
  const minX = Math.min(...rows.map((r) => r.left));
  const maxX = Math.max(...rows.map((r) => r.right));

  const y1 = toY(top);
  const y0 = toY(bottom);
  const xLo = toX(minX);
  const xHi = toX(maxX);

  // Half-width profile, normalised, for the roundness fit. Rows right at the
  // very top and bottom are the stroke's own cap and carry no width
  // information, so trim a little.
  const trim = Math.max(1, Math.round((bottom - top) * 0.04));
  const widest = maxX - minX;
  const profile = [];
  for (const r of rows) {
    if (r.y < top + trim || r.y > bottom - trim) continue;
    const t = ((r.y - top) / (bottom - top)) * 2 - 1;
    profile.push({ t, s: (r.right - r.left) / widest });
  }
  const round = fitRoundness(profile);

  // Convert the marked x extents into angles about the sweep axis, on the rear
  // panel. Mirrored for the left lamp so both read as the same span.
  const side = xHi < 0 ? -1 : 1;
  const angle = (x) => Math.atan2((x - side * AXIS_X) * side, AXIS_Z - PANEL_Z);

  console.log(`\n${label}`);
  console.log(`  traced px: x ${minX.toFixed(0)}..${maxX.toFixed(0)}, y ${top}..${bottom}`);
  console.log(
    `  model:     x ${xLo.toFixed(4)}..${xHi.toFixed(4)}, y ${y0.toFixed(4)}..${y1.toFixed(4)}`,
  );
  console.log(`  height ${(y1 - y0).toFixed(4)}, width ${(xHi - xLo).toFixed(4)}`);
  console.log(`  corner roundness (superellipse n): ${round.n.toFixed(2)}`);
  console.log(`  inner-edge angle ${angle(side > 0 ? xLo : xHi).toFixed(3)} rad`);
  console.log(
    `  outer-edge angle ${angle(side > 0 ? xHi : xLo).toFixed(3)} rad  (before any wrap)`,
  );
}

console.log('');
console.log('The outer-edge angle is what the DEAD ASTERN view can see. The lamp keeps');
console.log('going around the corner past that, and this view cannot measure how far,');
console.log('so the sweep end stays a separate judgement.');
