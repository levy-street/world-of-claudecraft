// Compose the per-frame preview renders of a Hollow Crypt creature
// (organic_kit.py render_sheet: <prefix>_<Clip>_<i>.png) into one animation
// sheet: a row per clip, its frames left to right, the clip name on the row.
//
//   node scripts/assets/hollow_crypt_creatures/sheet.mjs <frameDir> <prefix> <out.png> [cellWidth]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [dir, prefix, out, cellArg] = process.argv.slice(2);
if (!dir || !prefix || !out) {
  console.error('usage: sheet.mjs <frameDir> <prefix> <out.png> [cellWidth]');
  process.exit(1);
}
const cellW = Number(cellArg ?? 360);
const re = new RegExp(`^${prefix}_(.+)_(\\d+)\\.png$`);
const rows = new Map();
for (const f of fs.readdirSync(dir)) {
  const m = re.exec(f);
  if (!m) continue;
  if (!rows.has(m[1])) rows.set(m[1], []);
  rows.get(m[1])[Number(m[2])] = path.join(dir, f);
}
// Keep the order the clips were rendered in (file mtime of frame 0).
const order = [...rows.keys()].sort(
  (a, b) => fs.statSync(rows.get(a)[0]).mtimeMs - fs.statSync(rows.get(b)[0]).mtimeMs,
);
const first = await sharp(rows.get(order[0])[0]).metadata();
const cellH = Math.round((cellW * first.height) / first.width);
const cols = Math.max(...order.map((k) => rows.get(k).length));
const label = 150;
const W = label + cols * cellW;
const H = order.length * cellH;
const layers = [];
for (const [r, name] of order.entries()) {
  const text = Buffer.from(
    `<svg width="${label}" height="${cellH}"><rect width="100%" height="100%" fill="#15161c"/>` +
      `<text x="12" y="${cellH / 2 + 7}" font-family="Arial" font-size="22" fill="#e8e2d0">${name}</text></svg>`,
  );
  layers.push({ input: text, left: 0, top: r * cellH });
  for (const [c, file] of rows.get(name).entries()) {
    if (!file) continue;
    const buf = await sharp(file).resize(cellW, cellH).toBuffer();
    layers.push({ input: buf, left: label + c * cellW, top: r * cellH });
  }
}
await sharp({ create: { width: W, height: H, channels: 3, background: '#15161c' } })
  .composite(layers)
  .png()
  .toFile(out);
console.log('SHEET', out, `${order.length} clips`);
