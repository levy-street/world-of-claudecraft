import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';

const key = process.argv[2];
const out = `E:/woc/entregas/santuario/trash/${key}`;
const folder = `${out}/reviews/r3/motion`;
const sha = createHash('sha256')
  .update(fs.readFileSync(`${out}/${key}.blend`))
  .digest('hex');
for (const file of fs.readdirSync(folder).filter((n) => n.endsWith('.json'))) {
  const meta = JSON.parse(fs.readFileSync(`${folder}/${file}`));
  assert.equal(meta.model_sha256, sha);
  const tiles = [];
  for (let i = 0; i < 6; i++) {
    tiles.push({
      input: await sharp(`${folder}/${meta.clip}_${i}.png`).resize(640, 360).toBuffer(),
      left: (i % 3) * 640,
      top: Math.floor(i / 3) * 390 + 30,
    });
    tiles.push({
      input: Buffer.from(
        `<svg width="640" height="30"><text x="12" y="23" fill="#d6e6ef" font-family="Arial" font-size="18">${meta.clip} | ${meta.times[i].toFixed(2)} s | review sample</text></svg>`,
      ),
      left: (i % 3) * 640,
      top: Math.floor(i / 3) * 390,
    });
  }
  await sharp({ create: { width: 1920, height: 780, channels: 4, background: '#081220' } })
    .composite(tiles)
    .png()
    .toFile(`${folder}/${meta.clip}.png`);
  console.log('REVIEW SHEET', key, meta.clip);
}
