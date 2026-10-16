import sharp from 'sharp';

const files = process.argv.slice(3);
const out = process.argv[2];
const W = 640,
  H = 430,
  cols = 4;
const rows = Math.ceil(files.length / cols);
const layers = [];
for (const [i, f] of files.entries()) {
  layers.push({
    input: await sharp(f).resize(W, H).toBuffer(),
    left: (i % cols) * W,
    top: Math.floor(i / cols) * H,
  });
  const t = Buffer.from(
    `<svg width="${W}" height="30"><rect width="100%" height="100%" fill="#000" fill-opacity="0.5"/><text x="8" y="21" font-family="Arial" font-size="18" fill="#fff">${f.replace(/.*[/]/, '').replace('.png', '')}</text></svg>`,
  );
  layers.push({ input: t, left: (i % cols) * W, top: Math.floor(i / cols) * H });
}
await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#111' } })
  .composite(layers)
  .jpeg({ quality: 85 })
  .toFile(out);
console.log('MONT', out);
