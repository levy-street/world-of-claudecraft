#!/usr/bin/env node
// Render the back of the Rallycart so a lamp shape can be marked BY EYE.
//
// The tail lights defeated every attempt to find them by maths, and the reason
// is now understood: the mesh is generated from a neural field, so it has no
// edge flow, and its automatic unwrap is thousands of UV islands with a median
// width of 8 texels. There is no coherent lamp region to read in texture space
// and no clean topology to trace in geometry space. Fitting anything to that is
// negotiating with noise.
//
// So do not look for the lamp in the data. Look at the CAR. Render it, mark the
// lamp on the picture, and cast those marks back onto the mesh. Whatever
// surface is actually there is what the ray hits, so the wrap around the corner
// needs no special handling: it is just where the rays land.
//
// ORTHOGRAPHIC, and rendered at the frame's own ASPECT RATIO. Ortho makes every
// pixel map to a model x and y by linear arithmetic, with no depth term. True
// aspect matters just as much: a wide frame squeezed into a square image
// stretches the car, and anything traced on a stretched picture comes back
// distorted when it is converted to model units.
//
// Usage:
//   node scripts/assets/rallycart_rxt/render_rear_views.mjs [out-dir]
//   ... --trace     one clean undistorted band of both lamps, to draw on
//   ... --no-lens   omit the lens overlay

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { ktx2TranscoderScriptTag } from '../../lib/ktx2_assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODEL = path.join(root, 'public/models/mounts/rallycart_rxt.glb');
const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '/mnt/e';
const PX = 1400;
const TRACE = process.argv.includes('--trace');
const SHOW_LENSES = !TRACE && !process.argv.includes('--no-lens');

// The rear of the car in MODEL units. The chassis spans x -0.300..0.295 and
// y 0.065..0.460; the wheels reach y 0 and x +-0.298.
const FRAME = { left: -0.34, right: 0.34, bottom: 0.02, top: 0.5 };

// The band holding both lamps, with margin so there is room to draw outside
// them if the shape wants to be bigger than what is painted.
const TRACE_FRAME = { left: -0.34, right: 0.34, bottom: 0.15, top: 0.35 };

const LENS_BASE = {
  y0: 0.223,
  y1: 0.2854,
  gap: 0.006,
  smooth: 3,
  round: 5.5,
  segU: 44,
  segV: 18,
  castFrom: 0.4,
};
const LENSES = [
  { ...LENS_BASE, axisX: 0.16, axisZ: -0.34, angle0: -0.022, angle1: 1.0 },
  { ...LENS_BASE, axisX: -0.16, axisZ: -0.34, angle0: 0.022, angle1: -1.0 },
];

const ROUND_SWEEP = [2.5, 3.5, 6];
const NORMAL_VIEWS = ROUND_SWEEP.map((r) => ({
  name: `lamps_round_${String(r).replace('.', 'p')}`,
  yaw: 0,
  pitch: 0,
  frame: { left: -0.34, right: 0.34, bottom: 0.13, top: 0.31 },
  round: r,
  note: `corner roundness ${r}`,
})).concat([
  {
    name: 'lamp_right_closeup',
    yaw: 0,
    pitch: 0,
    width: 1200,
    frame: { left: 0.11, right: 0.32, bottom: 0.19, top: 0.32 },
    note: 'one lamp, true aspect',
  },
  { name: 'rear_straight', yaw: 0, pitch: 0, note: 'orthographic, dead astern' },
  { name: 'rear_quarter_left', yaw: 0.6, pitch: 0.12, note: 'left lamp turning the corner' },
  { name: 'rear_quarter_right', yaw: -0.6, pitch: 0.12, note: 'right lamp turning the corner' },
]);

const TRACE_VIEWS = [
  {
    name: 'TRACE_rear_band',
    yaw: 0,
    pitch: 0,
    frame: TRACE_FRAME,
    width: 2400,
    note: 'both lamps, undistorted, no overlay: draw on THIS one',
  },
];

const VIEWS = TRACE ? TRACE_VIEWS : NORMAL_VIEWS;

mkdirSync(outDir, { recursive: true });

const built = await esbuild.build({
  entryPoints: [path.join(root, 'scripts/assets/rallycart_rxt/rear_view_entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const html = `<!doctype html><html><head><meta charset="utf8"><style>html,body{margin:0}</style></head><body>${ktx2TranscoderScriptTag(root)}<script>${built.outputFiles[0].text}</script></body></html>`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 180000,
  args: [
    '--no-sandbox',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
  ],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.setViewport({ width: PX, height: PX });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });

  const glb = readFileSync(MODEL).toString('base64');
  for (const view of VIEWS) {
    const frame = view.frame ?? FRAME;
    const width = view.width ?? PX;
    const height = Math.max(
      1,
      Math.round((width * (frame.top - frame.bottom)) / (frame.right - frame.left)),
    );
    await page.setViewport({ width, height });
    const dataUrl = await page.evaluate(
      (b64, v, w, h) => window.renderRear(b64, v, w, h),
      glb,
      {
        ...frame,
        yaw: view.yaw,
        pitch: view.pitch,
        lenses: SHOW_LENSES ? LENSES.map((l) => ({ ...l, round: view.round ?? l.round })) : [],
      },
      width,
      height,
    );
    const file = path.join(outDir, `rallycart_${view.name}.png`);
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote ${file}  (${width}x${height})`);
    console.log(`  ${view.note}`);
    console.log(
      `  model x = ${frame.left} + (px / ${width}) * ${(frame.right - frame.left).toFixed(3)}`,
    );
    console.log(
      `  model y = ${frame.top} - (py / ${height}) * ${(frame.top - frame.bottom).toFixed(3)}`,
    );
  }
  console.log('');
  console.log('px, py are measured from the TOP-LEFT of the image.');
  console.log('The camera looks along +z, so image-left is model -x: the LEFT of the');
  console.log("picture is the car's own left side.");
} finally {
  await browser.close();
}
