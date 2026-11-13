// Per statue and per view: a foreground mask (the painting, not the sheet's dark background),
// eroded two pixels so no background bleeds onto the model's silhouette, and the painting's
// bounding box for registering the model against it. A mirrored left view (from the right) for a
// statue that is symmetric enough to take one.
//   node scripts/assets/smith_heart_hammer_colossi/prep_projection.mjs tmp/hammer_colossi
import fs from 'node:fs';
import sharp from 'sharp';

const J = process.argv[2];
if (!J) throw new Error('usage: prep_projection.mjs <jobsDir>');
const STATUES = {
  keeper: { mirrorLeft: true },
  waking: { mirrorLeft: false },
  bearer: { mirrorLeft: true },
};
const ERODE = 2;

async function maskOf(file) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const px = (x, y) => {
    const p = (y * W + x) * 3;
    return [data[p], data[p + 1], data[p + 2]];
  };
  const samples = [];
  for (const [cx, cy] of [
    [2, 2],
    [W - 8, 2],
    [2, H - 8],
    [W - 8, H - 8],
  ])
    for (let y = cy; y < cy + 6; y++) for (let x = cx; x < cx + 6; x++) samples.push(px(x, y));
  const bg = [0, 1, 2].map(
    (k) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1],
  );
  const fg = new Uint8Array(W * H);
  let ix0 = W;
  let ix1 = 0;
  let iy0 = H;
  let iy1 = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = px(x, y);
      if (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) > 38) {
        fg[y * W + x] = 1;
        if (x < ix0) ix0 = x;
        if (x > ix1) ix1 = x;
        if (y < iy0) iy0 = y;
        if (y > iy1) iy1 = y;
      }
    }
  // Erode: a pixel stays only if every pixel within ERODE of it is painting too.
  const out = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let keep = fg[y * W + x] === 1;
      for (let dy = -ERODE; keep && dy <= ERODE; dy++)
        for (let dx = -ERODE; keep && dx <= ERODE; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || !fg[yy * W + xx]) keep = false;
        }
      out[y * W + x] = keep ? 255 : 0;
    }
  return { W, H, ix0, ix1, iy0, iy1, bg, mask: out };
}

for (const [name, { mirrorLeft }] of Object.entries(STATUES)) {
  const dir = `${J}/${name}/views`;
  const reg = {};
  for (const view of ['front', 'right', 'back']) {
    const m = await maskOf(`${dir}/${view}.png`);
    await sharp(m.mask, { raw: { width: m.W, height: m.H, channels: 1 } })
      .png()
      .toFile(`${dir}/${view}_fg.png`);
    reg[view] = { W: m.W, H: m.H, ix0: m.ix0, ix1: m.ix1, iy0: m.iy0, iy1: m.iy1 };
  }
  if (mirrorLeft) {
    await sharp(`${dir}/right.png`).flop().png().toFile(`${dir}/left.png`);
    await sharp(`${dir}/right_fg.png`).flop().png().toFile(`${dir}/left_fg.png`);
    const r = reg.right;
    reg.left = {
      W: r.W,
      H: r.H,
      ix0: r.W - 1 - r.ix1,
      ix1: r.W - 1 - r.ix0,
      iy0: r.iy0,
      iy1: r.iy1,
    };
  }
  fs.writeFileSync(`${dir}/registration.json`, JSON.stringify(reg, null, 2));
  console.log(
    name,
    Object.entries(reg)
      .map(([v, b]) => `${v} ${b.ix0}-${b.ix1}x${b.iy0}-${b.iy1}`)
      .join(' | '),
  );
}
