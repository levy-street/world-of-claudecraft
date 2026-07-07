import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SFX_STANDARD } from './sfx_asset_standard.mjs';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 16 * 1024 * 1024;

async function run(command, args) {
  try {
    return await execFileAsync(command, args, { maxBuffer: MAX_BUFFER });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(`${command} was not found on PATH. Install ffmpeg/ffprobe before running the SFX asset tools.`);
    }
    const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
    const detail = stderr ? `\n${stderr}` : '';
    throw new Error(`${command} ${args.join(' ')} failed.${detail}`);
  }
}

export async function probeAudio(filePath) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,channels,sample_rate,bit_rate',
    '-show_entries',
    'format=format_name,bit_rate',
    '-of',
    'json',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  const format = data.format ?? {};
  return {
    codec: stream.codec_name ?? '',
    channels: Number(stream.channels ?? 0),
    sampleRateHz: Number(stream.sample_rate ?? 0),
    bitRateBps: Math.max(Number(stream.bit_rate ?? 0), Number(format.bit_rate ?? 0)),
    formatName: String(format.format_name ?? ''),
  };
}

export async function measurePeakDbfs(filePath) {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-i',
    filePath,
    '-map',
    '0:a:0',
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);
  const match = /max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf)) dB/i.exec(stderr);
  if (!match) throw new Error(`Could not read max_volume from ffmpeg volumedetect for ${filePath}.`);
  return match[1].toLowerCase() === '-inf' ? Number.NEGATIVE_INFINITY : Number(match[1]);
}

export async function postProcessSfxFile(inputPath, outputPath, options = {}) {
  const channels = options.channels ?? SFX_STANDARD.monoChannels;
  const sampleRateHz = options.sampleRateHz ?? SFX_STANDARD.sampleRateHz;
  const bitrateKbps = options.bitrateKbps ?? SFX_STANDARD.generatedBitrateKbps;
  const peakDbfs = options.peakDbfs ?? SFX_STANDARD.peakDbfs;
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  const stem = path.join(outputDir, `.${path.basename(outputPath)}.${process.pid}.${Date.now()}`);
  const staged = `${stem}.wav`;
  const encoded = `${stem}.mp3`;
  try {
    // Convert channel count and sample rate before measuring. Downmixing can change
    // the peak, so measure the same signal shape that will be encoded.
    await run('ffmpeg', [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-ar',
      String(sampleRateHz),
      '-ac',
      String(channels),
      '-c:a',
      'pcm_s16le',
      staged,
    ]);

    const peak = await measurePeakDbfs(staged);
    const gainDb = Number.isFinite(peak) ? peakDbfs - peak : 0;
    const filterArgs = Math.abs(gainDb) > 0.01 ? ['-af', `volume=${gainDb.toFixed(2)}dB`] : [];

    await run('ffmpeg', [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      staged,
      ...filterArgs,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-ar',
      String(sampleRateHz),
      '-ac',
      String(channels),
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${bitrateKbps}k`,
      encoded,
    ]);
    await rename(encoded, outputPath);
    return { inputPeakDbfs: peak, appliedGainDb: gainDb, channels, sampleRateHz, bitrateKbps };
  } finally {
    await rm(staged, { force: true });
    await rm(encoded, { force: true });
  }
}
