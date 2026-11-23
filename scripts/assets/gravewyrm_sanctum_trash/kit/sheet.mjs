// Contact sheets of Balgath's clips from review.py's sheet frames
// (<prefix>_<Clip>_<i>.png): one sheet per clip (a grid of its frames, the clip
// name and frame times on each cell), or with --all one tall sheet of every clip.
//
//   node scripts/assets/gravewyrm_sanctum_trash/kit/sheet.mjs <frameDir> <prefix> <outDir> [--cols 4] [--cell 420] [--all out.jpg]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const [dir, prefix, outDir] = args;
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const cols = Number(opt('--cols', 4));
const cellW = Number(opt('--cell', 420));
const all = opt('--all', null);
if (!dir || !prefix || !outDir) {
  console.error(
    'usage: sheet.mjs <frameDir> <prefix> <outDir> [--cols 4] [--cell 420] [--all out.jpg]',
  );
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const re = new RegExp(`^${prefix}_(.+)_(\\d+)\\.png$`);
const clips = new Map();
for (const f of fs.readdirSync(dir)) {
  const m = re.exec(f);
  if (!m) continue;
  if (!clips.has(m[1])) clips.set(m[1], []);
  clips.get(m[1])[Number(m[2])] = path.join(dir, f);
}
const label = (text, w, h, size) =>
  Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#000" fill-opacity="0.55"/>` +
      `<text x="10" y="${h * 0.72}" font-family="Arial" font-size="${size}" fill="#f2ead6">${text}</text></svg>`,
  );
const rowsOut = [];
for (const [clip, files] of clips) {
  const frames = files.filter(Boolean);
  const meta = await sharp(frames[0]).metadata();
  const cellH = Math.round((cellW * meta.height) / meta.width);
  const rows = Math.ceil(frames.length / cols);
  const head = 44;
  const layers = [{ input: label(clip, cols * cellW, head, 26), left: 0, top: 0 }];
  for (const [i, f] of frames.entries()) {
    const x = (i % cols) * cellW;
    const y = head + Math.floor(i / cols) * cellH;
    layers.push({ input: await sharp(f).resize(cellW, cellH).toBuffer(), left: x, top: y });
    layers.push({ input: label(`${i + 1}/${frames.length}`, 70, 26, 16), left: x, top: y });
  }
  const out = path.join(outDir, `hoja_${clip}.jpg`);
  await sharp({
    create: {
      width: cols * cellW,
      height: head + rows * cellH,
      channels: 3,
      background: '#14151a',
    },
  })
    .composite(layers)
    .jpeg({ quality: 88 })
    .toFile(out);
  rowsOut.push(out);
  console.log('SHEET', out);
}
if (all) {
  const metas = await Promise.all(rowsOut.map((f) => sharp(f).metadata()));
  const W = Math.max(...metas.map((m) => m.width));
  const H = metas.reduce((a, m) => a + m.height, 0);
  let y = 0;
  const layers = [];
  for (const [i, f] of rowsOut.entries()) {
    layers.push({ input: f, left: 0, top: y });
    y += metas[i].height;
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#14151a' } })
    .composite(layers)
    .jpeg({ quality: 82 })
    .toFile(all);
  console.log('ALL', all);
}
