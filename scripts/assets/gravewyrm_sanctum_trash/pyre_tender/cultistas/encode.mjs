// Encode original rendered frames with the repo's pinned FFmpeg, then decode every video.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { FFMPEG_PATH, FFPROBE_PATH } from '../../sfx/ffmpeg_paths.mjs';

const key = process.argv[2];
const out = `E:/woc/entregas/santuario/trash/${key}`;
const root = `tmp/cultistas/${key}/frames`;
const modelSha256 = createHash('sha256')
  .update(fs.readFileSync(`${out}/${key}.blend`))
  .digest('hex');
fs.mkdirSync(`${out}/previews`, { recursive: true });
fs.mkdirSync(`${out}/contact_sheets`, { recursive: true });
const report = [];
const requested = new Set(process.argv.slice(3));
for (const name of fs.readdirSync(root).filter((n) => !requested.size || requested.has(n))) {
  const dir = path.join(root, name),
    metadata = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metadata)) throw Error(`Incomplete render ${name}`);
  const meta = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  if (meta.model_sha256 !== modelSha256) throw Error(`Stale model in rendered sequence ${name}`);
  if (
    meta.renderer_sha256 !==
    createHash('sha256').update(fs.readFileSync('scripts/anim/cultistas/render.py')).digest('hex')
  )
    throw Error(`Stale renderer in sequence ${name}`);
  const frames = fs
    .readdirSync(dir)
    .filter((f) => /^\d{5}\.png$/.test(f))
    .sort();
  if (frames.length !== meta.frames) throw Error(`Wrong frame count ${name}`);
  const dest = `${out}/previews/${name}.mp4`;
  const result = spawnSync(
    FFMPEG_PATH,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-framerate',
      '30',
      '-threads',
      '1',
      '-i',
      path.join(dir, '%05d.png'),
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-filter_threads',
      '1',
      dest,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw Error(`Encode failed ${name}`);
  const decode = spawnSync(
    FFMPEG_PATH,
    ['-v', 'error', '-threads', '1', '-i', dest, '-f', 'null', 'NUL'],
    {
      encoding: 'utf8',
    },
  );
  if (decode.status !== 0 || decode.stderr.trim())
    throw Error(`Corrupt video ${name}: ${decode.stderr}`);
  const probe = spawnSync(
    FFPROBE_PATH,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,nb_frames,r_frame_rate:format=duration',
      '-of',
      'json',
      dest,
    ],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) throw Error(`Probe failed ${name}`);
  const info = JSON.parse(probe.stdout);
  if (Number(info.streams[0].nb_frames) !== meta.frames)
    throw Error(`Encoded frame mismatch ${name}`);
  const stream = info.streams[0];
  if (
    stream.width !== 1920 ||
    stream.height !== 1080 ||
    stream.r_frame_rate !== '30/1' ||
    Math.abs(Number(info.format.duration) - meta.seconds) > 0.002
  )
    throw Error(`Encoded resolution/fps/duration mismatch ${name}`);
  const tiles = [];
  for (let i = 0; i < 6; i++) {
    const frame = Math.round(((frames.length - 1) * i) / 5);
    const image = await sharp(path.join(dir, frames[frame])).resize(640, 360).png().toBuffer();
    tiles.push({ input: image, left: (i % 3) * 640, top: Math.floor(i / 3) * 390 + 30 });
    const label = Buffer.from(
      `<svg width="640" height="30"><text x="12" y="23" fill="#d6e6ef" font-family="Arial" font-size="18">${name} | ${(frame / 30).toFixed(2)} s</text></svg>`,
    );
    tiles.push({ input: label, left: (i % 3) * 640, top: Math.floor(i / 3) * 390 });
  }
  await sharp({ create: { width: 1920, height: 780, channels: 4, background: '#081220' } })
    .composite(tiles)
    .png()
    .toFile(`${out}/contact_sheets/${name}.png`);
  report.push({
    name,
    ...meta,
    ...info,
    video_sha256: createHash('sha256').update(fs.readFileSync(dest)).digest('hex'),
    bytes: fs.statSync(dest).size,
    decode: 'PASS',
  });
  console.log(`VIDEO PASS ${name} ${meta.frames} frames`);
}
fs.writeFileSync(`${out}/video_validation.json`, JSON.stringify(report, null, 2));
