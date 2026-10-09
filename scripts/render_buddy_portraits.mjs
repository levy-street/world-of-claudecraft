// Bake matching buddy portraits from the exact shipped models and idle poses.
// 1. node scripts/render_buddy_portraits.mjs prepare
// 2. With Vite running, open /tmp/buddy-portraits/index.html and save each PNG
//    into tmp/buddy-portraits under the displayed buddy id.
// 3. node scripts/render_buddy_portraits.mjs encode
// Rendering uses the existing model-still pipeline; no new runtime GPU work.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import sharp from 'sharp';
import { mobPortraitBackgroundSvg } from './lib/mob_portrait_background.mjs';
import { buildMobPortraitJobs, PORTRAIT_RENDER_DEFINES } from './lib/mob_portrait_jobs.mjs';

const root = process.cwd();
const temp = path.join(root, 'tmp/buddy-portraits');
const out = path.join(root, 'public/ui/portraits');
const ids = ['buddy_horse', 'buddy_crystal_lich', 'buddy_forgemaw'];
const jobs = (await buildMobPortraitJobs(root)).filter((job) => ids.includes(job.mobId));
if (jobs.length !== ids.length) throw new Error('Missing active buddy model');
mkdirSync(temp, { recursive: true });

if (process.argv[2] === 'prepare') {
  await esbuild.build({
    entryPoints: ['scripts/wiki/stills_render_entry.js'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    absWorkingDir: root,
    define: PORTRAIT_RENDER_DEFINES,
    outfile: path.join(temp, 'renderer.js'),
    logLevel: 'silent',
  });
  const data = jobs.map(({ mobId, spec, tint }) => ({ mobId, spec, tint }));
  writeFileSync(
    path.join(temp, 'index.html'),
    `<!doctype html>
<meta charset="utf-8"><title>Buddy model portrait bake</title>
<style>body{background:#222;color:#eee;font:16px sans-serif}figure{display:inline-block}img{width:256px;height:256px}</style>
<h1>Buddy model portrait bake</h1><p id="status">Rendering shipped models...</p>
<script src="./renderer.js"></script><script type="module">
try {
  for (const job of ${JSON.stringify(data)}) {
    const src = await window.renderStill(job.spec, job.tint);
    const figure = document.createElement('figure');
    const img = document.createElement('img'); img.src = src; img.id = job.mobId;
    const caption = document.createElement('figcaption');
    const link = document.createElement('a'); link.href = src; link.download = job.mobId + '.png'; link.textContent = link.download;
    caption.append(link); figure.append(img, caption); document.body.append(figure);
  }
  document.querySelector('#status').textContent = 'Ready: save the three PNGs, then run encode.';
} catch (error) { document.querySelector('#status').textContent = String(error); }
</script>`,
  );
  console.log('Open http://localhost:5173/tmp/buddy-portraits/index.html');
} else if (process.argv[2] === 'encode') {
  mkdirSync(out, { recursive: true });
  for (const job of jobs) {
    const png = await sharp(path.join(temp, `${job.mobId}.png`))
      .trim()
      .png()
      .toBuffer();
    const { width, height } = await sharp(png).metadata();
    // Match the established Tug portrait treatment: upper-body crop, centered
    // subject, seven-percent breathing room, family-tinted vignette and ring.
    const bustHeight = height > width * 0.8 ? Math.round(height * 0.65) : height;
    const layer = await sharp(png)
      .extract({ left: 0, top: 0, width, height: bustHeight })
      .resize(220, 220, { fit: 'contain', background: '#00000000' })
      .extend({ top: 18, bottom: 18, left: 18, right: 18, background: '#00000000' })
      .png()
      .toBuffer();
    const portrait = await sharp(Buffer.from(mobPortraitBackgroundSvg(job.family, 256)))
      .composite([{ input: layer }])
      .png()
      .toBuffer();
    await sharp(portrait)
      .resize(128, 128)
      .webp({ quality: 90, effort: 6 })
      .toFile(path.join(out, `${job.mobId}.webp`));
    console.log(`Baked ${job.mobId} from ${job.spec.url}`);
  }
} else {
  throw new Error('Usage: node scripts/render_buddy_portraits.mjs prepare|encode');
}
