// Split a three-view turnaround sheet (front, side, back left to right on a flat dark background)
// into the three views Tripo's multiview reads: each figure found against the background colour,
// all three cropped to one shared top and bottom so the views keep one scale and one ground line.
// The prompts ask for a LEFT side view, but every sheet draws its profile facing image-right, which
// shows the statue's RIGHT side: it is written as right.png, since feeding it to Tripo as the left
// view would build the statue mirrored.
//   node scripts/assets/smith_heart_hammer_colossi/split_views.mjs <sheet.png> <outDir>
import fs from 'node:fs';
import sharp from 'sharp';

const [sheet, outDir] = process.argv.slice(2);
if (!sheet || !outDir) throw new Error('usage: split_views.mjs <sheet> <outDir>');
const { data, info } = await sharp(sheet).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const px = (x, y) => {
  const p = (y * W + x) * 3;
  return [data[p], data[p + 1], data[p + 2]];
};
// The background: the median of the four corner patches.
const samples = [];
for (const [cx, cy] of [
  [4, 4],
  [W - 12, 4],
  [4, H - 12],
  [W - 12, H - 12],
])
  for (let y = cy; y < cy + 8; y++) for (let x = cx; x < cx + 8; x++) samples.push(px(x, y));
const bg = [0, 1, 2].map(
  (k) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1],
);
const fg = (x, y) => {
  const [r, g, b] = px(x, y);
  return Math.hypot(r - bg[0], g - bg[1], b - bg[2]) > 38;
};
// Column coverage, then the three widest runs of covered columns.
const cols = new Array(W).fill(0);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (fg(x, y)) cols[x]++;
const minCol = Math.max(3, Math.round(H * 0.01));
const runs = [];
let start = -1;
for (let x = 0; x <= W; x++) {
  const on = x < W && cols[x] >= minCol;
  if (on && start < 0) start = x;
  if (!on && start >= 0) {
    runs.push([start, x - 1]);
    start = -1;
  }
}
// Merge runs split by a sliver inside one figure (under half a percent of the width): the
// views can stand only twenty pixels apart, so a real gap must never be merged.
const merged = [];
for (const r of runs) {
  const last = merged[merged.length - 1];
  if (last && r[0] - last[1] < W * 0.005) last[1] = r[1];
  else merged.push([...r]);
}
const figures = merged
  .filter((r) => r[1] - r[0] > W * 0.06)
  .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
  .slice(0, 3)
  .sort((a, b) => a[0] - b[0]);
if (figures.length !== 3)
  throw new Error(`found ${figures.length} figures, wanted 3: ${JSON.stringify(merged)}`);
// One shared top and bottom over all three figures.
let top = H;
let bottom = 0;
for (const [x0, x1] of figures)
  for (let y = 0; y < H; y++)
    for (let x = x0; x <= x1; x++)
      if (fg(x, y)) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
const PAD = 12;
top = Math.max(0, top - PAD);
bottom = Math.min(H - 1, bottom + PAD);
fs.mkdirSync(outDir, { recursive: true });
const names = ['front', 'right', 'back'];
for (let i = 0; i < 3; i++) {
  const [x0, x1] = figures[i];
  // Pad, but never past the middle of the gap to a neighbour: no sliver of the next view.
  const lo = i > 0 ? Math.ceil((figures[i - 1][1] + x0) / 2) : 0;
  const hi = i < 2 ? Math.floor((x1 + figures[i + 1][0]) / 2) : W - 1;
  const left = Math.max(lo, x0 - PAD);
  const width = Math.min(hi, x1 + PAD) - left + 1;
  const res = await sharp(sheet)
    .removeAlpha()
    .extract({ left, top, width, height: bottom - top + 1 })
    .png()
    .toFile(`${outDir}/${names[i]}.png`);
  console.log(names[i], `x ${left}..${left + width - 1}`, `${res.width}x${res.height}`);
}
console.log('sheet', `${W}x${H}`, 'background', bg.join(','), 'rows', top, bottom);
