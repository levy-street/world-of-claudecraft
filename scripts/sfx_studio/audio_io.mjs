// Filesystem, ffprobe, ffmpeg, draft, preview, version, and transactional publish I/O.
// Callers pass only catalog keys and normalized project data. No caller-supplied
// path or filter expression is ever forwarded to the toolchain.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformSfxAudio, inspectSfxConformance } from '../sfx/conform_audio.mjs';
import { FFMPEG_PATH, FFPROBE_PATH } from '../sfx/ffmpeg_paths.mjs';
import {
  readSfxMix,
  SFX_RUNTIME_PACK_PATH,
  spatialForSfx,
  writeSfxManifest,
} from '../sfx/manifest.mjs';
import {
  categoryForSfx,
  normalizeSfxGainMap,
  normalizeSfxSpeedMap,
  readSfxPlaybackProfile,
  resolveSfxPlaybackProfile,
  SFX_GAIN_MAP_PATH,
  SFX_SPEED_MAP_PATH,
  writeSfxPlaybackProfile,
} from '../sfx/playback_profile.mjs';
import { LOSSLESS_EXTENSIONS, MIN_SOURCE_BITRATE } from '../sfx/sfx_conform_rules.mjs';
import { discoverSfxTracks } from '../sfx/sfx_manifest_builder.mjs';
import { SFX } from '../sfx/sfx_prompts.mjs';
import {
  buildAuthoringPcmArgs,
  buildFfmpegGraph,
  buildLoudnessMeasureArgs,
  defaultProject,
  effectiveTruePeakDb,
  normalizeProject,
} from './project.mjs';

const CHECKED_IN_REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const REPO_ROOT = resolve(
  process.env.WOC_SFX_STUDIO_TEST_ROOT && process.env.WOC_SFX_STUDIO_TEST_REPO_ROOT
    ? process.env.WOC_SFX_STUDIO_TEST_REPO_ROOT
    : CHECKED_IN_REPO_ROOT,
);
const REPO_STUDIO_ROOT = join(REPO_ROOT, 'tmp/sfx_studio');
const DEFAULT_STUDIO_ROOT = process.env.WOC_SFX_STUDIO_TEST_ROOT
  ? join(
      process.env.WOC_SFX_STUDIO_TEST_ROOT,
      `worker-${process.env.VITEST_POOL_ID ?? process.pid}`,
    )
  : REPO_STUDIO_ROOT;
export const STUDIO_ROOT = resolve(
  process.env.WOC_SFX_STUDIO_TEST_ROOT
    ? DEFAULT_STUDIO_ROOT
    : process.env.WOC_SFX_STUDIO_ROOT || DEFAULT_STUDIO_ROOT,
);
export const MASTERING_REVISION = 7;
const PLAYBACK_PROFILE_DRAFT = 'playback_profile.json';
const DRAFT_PUBLICATION_STATE = 'draft_publication_state.json';

const KEYS = new Set(SFX.map((entry) => entry.key));
const CATALOG = new Map(SFX.map((entry) => [entry.key, entry]));
const UPLOAD_EXTENSIONS = new Set([
  '.wav',
  '.mp3',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.webm',
  '.aif',
  '.aiff',
]);
const renderLocks = new Map();
let ffmpegFingerprintPromise = null;
let mutationTail = Promise.resolve();

function ensurePlainDirectory(path, parent) {
  const parentReal = realpathSync(parent);
  const lexical = resolve(parentReal, basename(path));
  if (!lexical.startsWith(`${parentReal}/`)) throw new Error('studio directory escapes its root');
  if (existsSync(lexical)) {
    const stat = lstatSync(lexical);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`studio path is not a plain directory: ${lexical}`);
    }
  } else {
    mkdirSync(lexical);
  }
  const target = realpathSync(lexical);
  if (!target.startsWith(`${parentReal}/`) || target !== lexical) {
    throw new Error(`studio directory escapes its root: ${lexical}`);
  }
  return target;
}

function existingPlainDirectory(path, parent) {
  const parentReal = realpathSync(parent);
  const lexical = resolve(parentReal, basename(path));
  const entry = lstatSync(lexical, { throwIfNoEntry: false });
  if (!entry || entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`path is not a plain directory: ${lexical}`);
  }
  const target = realpathSync(lexical);
  if (!target.startsWith(`${parentReal}/`) || target !== lexical) {
    throw new Error(`directory escapes its root: ${lexical}`);
  }
  return target;
}

function ensureDirs() {
  let studio;
  if (STUDIO_ROOT === REPO_STUDIO_ROOT) {
    const repo = realpathSync(REPO_ROOT);
    const tmp = ensurePlainDirectory(join(repo, 'tmp'), repo);
    studio = ensurePlainDirectory(join(tmp, 'sfx_studio'), tmp);
  } else {
    const parent = realpathSync(dirname(STUDIO_ROOT));
    studio = ensurePlainDirectory(STUDIO_ROOT, parent);
  }
  for (const dir of ['projects', 'sources', 'previews', 'versions', 'work', 'exports']) {
    ensurePlainDirectory(join(studio, dir), studio);
  }
  return studio;
}

function safeKeyDirectory(section, key) {
  ensureDirs();
  const sectionRoot = realpathSync(join(STUDIO_ROOT, section));
  return ensurePlainDirectory(join(sectionRoot, assertSfxKey(key)), sectionRoot);
}

function safeRegularFile(root, name) {
  const rootReal = realpathSync(root);
  const lexical = resolve(rootReal, name);
  if (!lexical.startsWith(`${rootReal}/`) || !existsSync(lexical)) {
    throw new Error('studio file is missing or outside its root');
  }
  const entry = lstatSync(lexical);
  if (entry.isSymbolicLink() || !entry.isFile())
    throw new Error('studio file is not a regular file');
  const target = realpathSync(lexical);
  if (!target.startsWith(`${rootReal}/`) || target !== lexical) {
    throw new Error('studio file escapes its root');
  }
  return target;
}

function copyToExclusiveTemporary(root, label, suffix, source) {
  const rootReal = realpathSync(root);
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = `.${basename(label)}.${process.pid}.${randomBytes(8).toString('hex')}${suffix}`;
    const temporary = join(rootReal, name);
    try {
      copyFileSync(source, temporary, fsConstants.COPYFILE_EXCL);
      return safeRegularFile(rootReal, name);
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      rmSync(temporary, { force: true });
      throw error;
    }
  }
  throw new Error('could not reserve an exclusive temporary file');
}

function installRegularCopy(root, name, source, expectedContentHash = null) {
  const target = resolve(root, name);
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing) {
    const safe = safeRegularFile(root, name);
    if (expectedContentHash && hashFile(safe) !== expectedContentHash) {
      throw new Error('content-addressed studio file has an invalid hash');
    }
    return safe;
  }
  let temporary = null;
  try {
    temporary = copyToExclusiveTemporary(root, name, '.copy', source);
    renameSync(temporary, target);
    temporary = null;
  } finally {
    if (temporary) rmSync(temporary, { force: true });
  }
  const safe = safeRegularFile(root, name);
  if (expectedContentHash && hashFile(safe) !== expectedContentHash) {
    throw new Error('content-addressed studio file has an invalid hash');
  }
  return safe;
}

export function assertSfxKey(key) {
  if (typeof key !== 'string' || !KEYS.has(key)) throw new Error('unknown SFX key');
  return key;
}

export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command, args, { maxOutput = 2_000_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const collect = (target, chunk) => {
      const next = target + chunk.toString('utf8');
      return next.length > maxOutput ? next.slice(next.length - maxOutput) : next;
    };
    child.stdout.on('data', (chunk) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = collect(stderr, chunk);
    });
    child.on('error', (error) => reject(new Error(`${command} is unavailable: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`));
    });
  });
}

function runBuffer(command, args, { maxBytes = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let bytes = 0;
    let stderr = '';
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill('SIGKILL');
        fail(new Error(`${command} output exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-20_000);
    });
    child.on('error', (error) => fail(new Error(`${command} is unavailable: ${error.message}`)));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolvePromise({ stdout: Buffer.concat(chunks), stderr });
      else reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`));
    });
  });
}

export async function toolchainStatus() {
  const status = { ffmpeg: null, ffprobe: null, ready: false };
  try {
    status.ffmpeg = (await run(FFMPEG_PATH, ['-version'], { maxOutput: 10_000 })).stdout.split(
      '\n',
    )[0];
    status.ffprobe = (await run(FFPROBE_PATH, ['-version'], { maxOutput: 10_000 })).stdout.split(
      '\n',
    )[0];
    status.ready = true;
  } catch (error) {
    status.error = String(error.message ?? error);
  }
  return status;
}

async function ffmpegFingerprint() {
  ffmpegFingerprintPromise ??= run(FFMPEG_PATH, ['-version'], { maxOutput: 10_000 }).then(
    ({ stdout }) => createHash('sha256').update(stdout.split('\n')[0]).digest('hex').slice(0, 16),
  );
  return ffmpegFingerprintPromise;
}

export async function inspectAudio(path) {
  const { stdout } = await run(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,sample_rate,channels,channel_layout,bit_rate,duration:format=duration,size,bit_rate',
    '-of',
    'json',
    path,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream) throw new Error('uploaded file has no audio stream');
  return {
    codec: String(stream.codec_name ?? ''),
    sampleRate: Number(stream.sample_rate) || 0,
    channels: Number(stream.channels) || 0,
    channelLayout: String(stream.channel_layout ?? ''),
    duration: Number(stream.duration ?? data.format?.duration) || 0,
    bitrate: Number(stream.bit_rate ?? data.format?.bit_rate) || 0,
    bytes: Number(data.format?.size) || statSync(path).size,
  };
}

export function parseLoudnormReport(stderr) {
  const match = String(stderr)
    .match(/\{\s*"input_i"[\s\S]*?\}/g)
    ?.at(-1);
  if (!match) throw new Error('ffmpeg did not return loudness analysis');
  const data = JSON.parse(match);
  const metric = (value, min = -Infinity, max = Infinity) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    if (number < min || number > max)
      throw new Error('ffmpeg returned an out-of-range loudness metric');
    return number;
  };
  const input = {
    integratedLufs: metric(data.input_i, -99, 0),
    truePeakDb: metric(data.input_tp, -99, 99),
    loudnessRange: metric(data.input_lra, 0, 99),
    thresholdLufs: metric(data.input_thresh, -99, 0),
  };
  const offset = metric(data.target_offset, -99, 99);
  const measurement =
    Object.values(input).every(Number.isFinite) && Number.isFinite(offset)
      ? {
          measuredI: input.integratedLufs,
          measuredTp: input.truePeakDb,
          measuredLra: input.loudnessRange,
          measuredThresh: input.thresholdLufs,
          offset,
        }
      : null;
  const normalizationType = ['linear', 'dynamic'].includes(data.normalization_type)
    ? data.normalization_type
    : null;
  return {
    input,
    output: {
      integratedLufs: metric(data.output_i, -99, 0),
      truePeakDb: metric(data.output_tp, -99, 99),
      loudnessRange: metric(data.output_lra, 0, 99),
      thresholdLufs: metric(data.output_thresh, -99, 0),
    },
    measurement,
    normalizationType,
  };
}

export async function analyzeLoudness(path) {
  const { stderr } = await run(FFMPEG_PATH, [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-i',
    path,
    '-af',
    'aresample=48000,apad=whole_len=19200,loudnorm=I=-16:TP=-1:LRA=7:print_format=json',
    '-f',
    'null',
    '-',
  ]);
  return parseLoudnormReport(stderr).input;
}

export async function analyzeLoopContinuity(path, channels) {
  if (![1, 2].includes(channels)) throw new Error('loop continuity requires mono or stereo audio');
  const { stdout } = await runBuffer(FFMPEG_PATH, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    path,
    '-vn',
    '-ar',
    '48000',
    '-ac',
    String(channels),
    '-codec:a',
    'pcm_f32le',
    '-f',
    'f32le',
    '-',
  ]);
  const sampleBytes = stdout.byteLength - (stdout.byteLength % 4);
  const raw = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + sampleBytes);
  const samples = new Float32Array(raw);
  const frames = Math.floor(samples.length / channels);
  if (frames < 16) throw new Error('loop master is too short for continuity analysis');
  const window = Math.min(512, Math.floor(frames / 4));
  const perChannel = [];
  for (let channel = 0; channel < channels; channel++) {
    const first = samples[channel];
    const last = samples[(frames - 1) * channels + channel];
    const delta = Math.abs(first - last);
    let derivativeEnergy = 0;
    let derivativeCount = 0;
    for (let frame = 1; frame <= window; frame++) {
      const current = samples[frame * channels + channel];
      const previous = samples[(frame - 1) * channels + channel];
      derivativeEnergy += (current - previous) ** 2;
      derivativeCount++;
    }
    for (let frame = frames - window; frame < frames; frame++) {
      if (frame <= 0) continue;
      const current = samples[frame * channels + channel];
      const previous = samples[(frame - 1) * channels + channel];
      derivativeEnergy += (current - previous) ** 2;
      derivativeCount++;
    }
    const adjacentDerivativeRms = Math.sqrt(derivativeEnergy / Math.max(1, derivativeCount));
    perChannel.push({
      delta,
      adjacentDerivativeRms,
      ratio: delta / Math.max(0.0025, adjacentDerivativeRms),
    });
  }
  return {
    frames,
    perChannel,
    maxDelta: Math.max(...perChannel.map((result) => result.delta)),
    maxRatio: Math.max(...perChannel.map((result) => result.ratio)),
  };
}

function publicPath(key, repoRoot = REPO_ROOT) {
  assertSfxKey(key);
  const repo = realpathSync(repoRoot);
  const publicRoot = existingPlainDirectory(join(repo, 'public'), repo);
  const audioRoot = existingPlainDirectory(join(publicRoot, 'audio'), publicRoot);
  const sfxRoot = existingPlainDirectory(join(audioRoot, 'sfx'), audioRoot);
  const discovered = discoverSfxTracks([...CATALOG.values()], sfxRoot);
  if (discovered.errors.length) {
    throw new Error(`invalid published SFX inventory for ${key}: ${discovered.errors.join('; ')}`);
  }
  const filename = discovered.entries[key]?.tracks[0]?.filename;
  if (!filename) throw new Error(`published SFX is missing for ${key}`);
  return safeRegularFile(sfxRoot, filename);
}

function draftPath(key) {
  ensureDirs();
  const root = realpathSync(join(STUDIO_ROOT, 'projects'));
  const name = `${assertSfxKey(key)}.json`;
  const path = join(root, name);
  if (existsSync(path)) return safeRegularFile(root, name);
  return path;
}

function draftPublicationStatePath() {
  ensureDirs();
  const root = realpathSync(STUDIO_ROOT);
  const path = join(root, DRAFT_PUBLICATION_STATE);
  if (existsSync(path)) return safeRegularFile(root, DRAFT_PUBLICATION_STATE);
  return path;
}

function readDraftPublicationState() {
  const path = draftPublicationStatePath();
  if (!existsSync(path)) return { version: 1, cues: {} };
  if (statSync(path).size > 2 * 1024 * 1024) {
    throw new Error('draft publication state is too large');
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('draft publication state is invalid JSON');
  }
  assertOnlyFields(parsed, new Set(['version', 'cues']), 'draft publication state');
  if (parsed.version !== 1 || !isPlainObject(parsed.cues)) {
    throw new Error('draft publication state has an invalid shape');
  }
  const cues = {};
  for (const key of Object.keys(parsed.cues).sort()) {
    assertSfxKey(key);
    const cue = parsed.cues[key];
    assertOnlyFields(
      cue,
      new Set(['draftHash', 'publishedHash', 'project']),
      `draft state for ${key}`,
    );
    if (
      typeof cue.draftHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(cue.draftHash) ||
      typeof cue.publishedHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(cue.publishedHash)
    ) {
      throw new Error(`draft state for ${key} has an invalid hash`);
    }
    if (Object.hasOwn(cue, 'project') && !isPlainObject(cue.project)) {
      throw new Error(`draft state for ${key} has an invalid project`);
    }
    cues[key] = {
      draftHash: cue.draftHash,
      publishedHash: cue.publishedHash,
      ...(cue.project ? { project: cue.project } : {}),
    };
  }
  return { version: 1, cues };
}

function draftProjectHash(project) {
  return createHash('sha256').update(JSON.stringify(project)).digest('hex');
}

export function audioWorkspaceHash(project) {
  if (!isPlainObject(project)) throw new Error('audio draft project must be an object');
  return draftProjectHash(project);
}

function assertExpectedAudioWorkspaceHash(key, expectedHash) {
  if (expectedHash === undefined) return;
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('expected audio workspace hash must be a full SHA-256 digest');
  }
  let project;
  try {
    project = JSON.parse(readFileSync(draftPath(key), 'utf8'));
  } catch {
    throw new Error('current audio draft is invalid');
  }
  if (draftProjectHash(project) !== expectedHash) {
    throw new Error('audio draft changed in another Studio tab');
  }
}

function markDraftPublished(key, project, publishedHash) {
  assertSfxKey(key);
  if (typeof publishedHash !== 'string' || !/^[a-f0-9]{64}$/.test(publishedHash)) {
    throw new Error('published draft baseline hash is invalid');
  }
  const state = readDraftPublicationState();
  state.cues[key] = { draftHash: draftProjectHash(project), publishedHash, project };
  atomicJson(draftPublicationStatePath(), state);
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let created = false;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    created = true;
    renameSync(temporary, path);
    created = false;
  } finally {
    if (created) rmSync(temporary, { force: true });
  }
}

function atomicBytes(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let created = false;
  try {
    writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 });
    created = true;
    renameSync(temporary, path);
    created = false;
  } finally {
    if (created) rmSync(temporary, { force: true });
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyFields(value, fields, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) throw new Error(`${label} contains unknown field: ${field}`);
  }
}

function normalizePlaybackProfile(raw) {
  assertOnlyFields(raw, new Set(['gainMap', 'speedMap']), 'playback profile');
  return {
    gainMap: normalizeSfxGainMap(raw.gainMap),
    speedMap: normalizeSfxSpeedMap(raw.speedMap),
  };
}

export function playbackProfileHash(rawProfile) {
  const profile = normalizePlaybackProfile(rawProfile);
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

function playbackDraftPath() {
  ensureDirs();
  const root = realpathSync(STUDIO_ROOT);
  const path = join(root, PLAYBACK_PROFILE_DRAFT);
  if (existsSync(path)) return safeRegularFile(root, PLAYBACK_PROFILE_DRAFT);
  return path;
}

function normalizePlaybackDraft(raw) {
  assertOnlyFields(
    raw,
    new Set(['version', 'baseHash', 'gainMap', 'speedMap']),
    'workspace playback profile',
  );
  if (raw.version !== 1) throw new Error('workspace playback profile version must be 1');
  if (typeof raw.baseHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.baseHash)) {
    throw new Error('workspace playback profile base hash is invalid');
  }
  const profile = normalizePlaybackProfile({ gainMap: raw.gainMap, speedMap: raw.speedMap });
  return { version: 1, baseHash: raw.baseHash, ...profile };
}

export function rebaseCleanPlaybackDraft(rawDraft, rawCheckedInProfile) {
  const draft = normalizePlaybackDraft(rawDraft);
  const checkedIn = normalizePlaybackProfile(rawCheckedInProfile);
  const checkedInHash = playbackProfileHash(checkedIn);
  const workspaceHash = playbackProfileHash({
    gainMap: draft.gainMap,
    speedMap: draft.speedMap,
  });
  if (draft.baseHash !== checkedInHash && workspaceHash === draft.baseHash) {
    return { version: 1, baseHash: checkedInHash, ...checkedIn };
  }
  return draft;
}

export function loadPlaybackProfileDraft() {
  const path = playbackDraftPath();
  if (!existsSync(path)) {
    const profile = normalizePlaybackProfile(readSfxPlaybackProfile(REPO_ROOT));
    const draft = { version: 1, baseHash: playbackProfileHash(profile), ...profile };
    atomicJson(path, draft);
    return draft;
  }
  if (statSync(path).size > 256 * 1024) throw new Error('workspace playback profile is too large');
  try {
    const parsed = normalizePlaybackDraft(JSON.parse(readFileSync(path, 'utf8')));
    const draft = rebaseCleanPlaybackDraft(parsed, readSfxPlaybackProfile(REPO_ROOT));
    if (JSON.stringify(draft) !== JSON.stringify(parsed)) atomicJson(path, draft);
    return draft;
  } catch (error) {
    throw new Error(`invalid workspace playback profile: ${error.message ?? error}`);
  }
}

export function playbackResponseForCue(key, rawProfile) {
  assertSfxKey(key);
  const profile = normalizePlaybackProfile({
    gainMap: rawProfile?.gainMap,
    speedMap: rawProfile?.speedMap,
  });
  const category = categoryForSfx(key);
  const resolved = resolveSfxPlaybackProfile(key, profile);
  const categoryEntries = SFX.filter((entry) => categoryForSfx(entry.key) === category);
  const categoryTrims = categoryEntries.map((entry) => profile.gainMap.keyTrimDb[entry.key] ?? 0);
  const otherCategoryTrims = categoryEntries
    .filter((entry) => entry.key !== key)
    .map((entry) => profile.gainMap.keyTrimDb[entry.key] ?? 0);
  return {
    category,
    categoryBaselineDb: profile.gainMap.categoryBaselineDb[category],
    categoryBaselineMinDb: Math.max(-60, ...categoryTrims.map((trim) => -60 - trim)),
    categoryBaselineMaxDb: Math.min(0, ...categoryTrims.map((trim) => -trim)),
    categoryOtherBaselineMinDb: Math.max(-60, ...otherCategoryTrims.map((trim) => -60 - trim)),
    categoryOtherBaselineMaxDb: Math.min(0, ...otherCategoryTrims.map((trim) => -trim)),
    keyTrimDb: profile.gainMap.keyTrimDb[key] ?? 0,
    resolvedGainDb: resolved.gainDb,
    gain: resolved.gain,
    playbackRate: resolved.playbackRate,
  };
}

export function getPlaybackProfileState(key) {
  const draft = loadPlaybackProfileDraft();
  const checkedIn = normalizePlaybackProfile(readSfxPlaybackProfile(REPO_ROOT));
  const workspaceProfile = { gainMap: draft.gainMap, speedMap: draft.speedMap };
  return {
    playback: playbackResponseForCue(key, draft),
    playbackProfileHash: draft.baseHash,
    playbackWorkspaceHash: playbackProfileHash(workspaceProfile),
    playbackProfileDirty: JSON.stringify(workspaceProfile) !== JSON.stringify(checkedIn),
  };
}

export function savePlaybackProfileDraft(key, rawPlayback, expectedWorkspaceHash) {
  assertSfxKey(key);
  assertOnlyFields(
    rawPlayback,
    new Set(['categoryBaselineDb', 'keyTrimDb', 'playbackRate']),
    'cue playback profile',
  );
  for (const field of ['categoryBaselineDb', 'keyTrimDb', 'playbackRate']) {
    if (typeof rawPlayback[field] !== 'number' || !Number.isFinite(rawPlayback[field])) {
      throw new Error(`cue playback profile ${field} must be a finite number`);
    }
  }
  const draft = loadPlaybackProfileDraft();
  const currentWorkspaceHash = playbackProfileHash({
    gainMap: draft.gainMap,
    speedMap: draft.speedMap,
  });
  if (expectedWorkspaceHash !== undefined) {
    if (
      typeof expectedWorkspaceHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedWorkspaceHash)
    ) {
      throw new Error('expected workspace playback hash must be a full SHA-256 digest');
    }
    if (expectedWorkspaceHash !== currentWorkspaceHash) {
      throw new Error('workspace playback profile changed in another Studio tab');
    }
  }
  const category = categoryForSfx(key);
  const gainMap = {
    version: 1,
    categoryBaselineDb: { ...draft.gainMap.categoryBaselineDb },
    keyTrimDb: { ...draft.gainMap.keyTrimDb },
  };
  const speedMap = { version: 1, rateByKey: { ...draft.speedMap.rateByKey } };
  gainMap.categoryBaselineDb[category] = rawPlayback.categoryBaselineDb;
  if (rawPlayback.keyTrimDb === 0) delete gainMap.keyTrimDb[key];
  else gainMap.keyTrimDb[key] = rawPlayback.keyTrimDb;
  if (rawPlayback.playbackRate === 1) delete speedMap.rateByKey[key];
  else speedMap.rateByKey[key] = rawPlayback.playbackRate;
  const profile = normalizePlaybackProfile({ gainMap, speedMap });
  atomicJson(playbackDraftPath(), { version: 1, baseHash: draft.baseHash, ...profile });
  return getPlaybackProfileState(key);
}

export function migrateLegacyWorkspacePlayback(key, rawProject) {
  if (!isPlainObject(rawProject) || Number(rawProject.version) >= 3) return null;
  const legacyFields = ['gainDb', 'runtimeGainDb', 'speed'];
  if (!legacyFields.some((field) => Object.hasOwn(rawProject, field))) return null;
  const current = getPlaybackProfileState(key).playback;
  const finite = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const targetGainDb = clamp(
    finite(rawProject.gainDb, 0) + finite(rawProject.runtimeGainDb, 0),
    -60,
    0,
  );
  const keyTrimDb = clamp(targetGainDb - current.categoryBaselineDb, -60, 24);
  const playbackRate = clamp(finite(rawProject.speed, current.playbackRate), 0.25, 4);
  return savePlaybackProfileDraft(key, {
    categoryBaselineDb: current.categoryBaselineDb,
    keyTrimDb,
    playbackRate,
  });
}

async function withMutationLock(action) {
  const previous = mutationTail;
  let release;
  mutationTail = new Promise((resolvePromise) => {
    release = resolvePromise;
  });
  await previous.catch(() => {});
  try {
    return await action();
  } finally {
    release();
  }
}

function copyPublishedSource(key) {
  ensureDirs();
  const source = publicPath(key);
  const extension = extname(source).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(extension)) throw new Error('published source type is not supported');
  const id = `${hashFile(source)}${extension}`;
  const dir = safeKeyDirectory('sources', key);
  installRegularCopy(dir, id, source, id.slice(0, 64));
  return id;
}

export function neutralPublishedProject(key, sourceId, duration) {
  const loop = !!CATALOG.get(key)?.loop;
  const project = defaultProject({ loop });
  project.sourceId = sourceId;
  project.limiter.enabled = false;
  project.loop.crossfadeMs = 0;
  return normalizeProject(project, { loop, duration });
}

export async function loadDraft(key) {
  assertSfxKey(key);
  ensureDirs();
  const path = draftPath(key);
  const hadDraft = existsSync(path);
  let raw = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      raw = {};
    }
  }
  migrateLegacyWorkspacePlayback(key, raw);
  try {
    if (!raw.sourceId) throw new Error('draft source snapshot is missing');
    resolveSourcePath(key, raw.sourceId);
  } catch {
    raw = { ...raw, sourceId: copyPublishedSource(key) };
  }
  const sourceInfo = await inspectAudio(resolveSourcePath(key, raw.sourceId));
  const project = normalizeProject(raw, {
    loop: !!CATALOG.get(key)?.loop,
    duration: sourceInfo.duration,
  });
  atomicJson(path, project);
  if (!hadDraft) markDraftPublished(key, project, publishedStateHashForKey(key));
  return project;
}

export async function unpublishedAudioDraftKeys() {
  ensureDirs();
  const root = realpathSync(join(STUDIO_ROOT, 'projects'));
  const state = readDraftPublicationState();
  const keys = readdirSync(root)
    .filter((name) => /^[a-z0-9_]+\.json$/.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
  const unpublished = [];
  for (const key of keys) {
    assertSfxKey(key);
    const project = await loadDraft(key);
    const baseline = state.cues[key];
    if (
      !baseline ||
      baseline.draftHash !== draftProjectHash(project) ||
      baseline.publishedHash !== publishedStateHashForKey(key)
    ) {
      unpublished.push(key);
    }
  }
  return unpublished;
}

async function prepareDraft(key, raw) {
  assertSfxKey(key);
  const current = await loadDraft(key);
  const source = resolveSourcePath(key, raw?.sourceId ?? current.sourceId);
  const info = await inspectAudio(source);
  validateUploadSourceQuality(extname(source), info);
  const project = normalizeProject(
    { ...raw, sourceId: raw?.sourceId ?? current.sourceId },
    {
      loop: !!CATALOG.get(key)?.loop,
      duration: info.duration,
    },
  );
  return { project, source: info };
}

export async function saveDraft(key, raw, expectedAudioWorkspaceHash = undefined) {
  const prepared = await prepareDraft(key, raw);
  return withMutationLock(async () => {
    assertExpectedAudioWorkspaceHash(key, expectedAudioWorkspaceHash);
    atomicJson(draftPath(key), prepared.project);
    return { ...prepared, audioWorkspaceHash: draftProjectHash(prepared.project) };
  });
}

export async function resetAudioDraft(key, expectedAudioWorkspaceHash = undefined) {
  assertSfxKey(key);
  return withMutationLock(async () => {
    assertExpectedAudioWorkspaceHash(key, expectedAudioWorkspaceHash);
    const publishedHash = publishedStateHashForKey(key);
    const baseline = readDraftPublicationState().cues[key];
    let raw = baseline?.publishedHash === publishedHash ? baseline.project : null;
    let sourceId = isPlainObject(raw) ? raw.sourceId : null;
    let source;
    try {
      if (typeof sourceId !== 'string') throw new Error('published source snapshot is missing');
      const resolved = resolveSourcePath(key, sourceId);
      source = await inspectAudio(resolved);
      validateUploadSourceQuality(extname(resolved), source);
    } catch {
      sourceId = copyPublishedSource(key);
      const resolved = resolveSourcePath(key, sourceId);
      source = await inspectAudio(resolved);
      validateUploadSourceQuality(extname(resolved), source);
      raw = neutralPublishedProject(key, sourceId, source.duration);
    }
    const project = normalizeProject(
      { ...raw, sourceId },
      {
        loop: !!CATALOG.get(key)?.loop,
        duration: source.duration,
      },
    );
    atomicJson(draftPath(key), project);
    markDraftPublished(key, project, publishedHash);
    return { project, source, audioWorkspaceHash: draftProjectHash(project) };
  });
}

export async function saveStudioDraft(
  key,
  rawProject,
  rawPlayback,
  expectedWorkspaceHash,
  expectedAudioWorkspaceHash = undefined,
) {
  const prepared = await prepareDraft(key, rawProject);
  return withMutationLock(async () => {
    assertExpectedAudioWorkspaceHash(key, expectedAudioWorkspaceHash);
    const workspacePath = playbackDraftPath();
    const previousWorkspace = readFileSync(workspacePath);
    try {
      const playbackState = savePlaybackProfileDraft(key, rawPlayback, expectedWorkspaceHash);
      atomicJson(draftPath(key), prepared.project);
      return {
        ...prepared,
        audioWorkspaceHash: draftProjectHash(prepared.project),
        ...playbackState,
      };
    } catch (error) {
      atomicBytes(workspacePath, previousWorkspace);
      throw error;
    }
  });
}

export function resolveSourcePath(key, sourceId) {
  assertSfxKey(key);
  if (!sourceId) return publicPath(key);
  if (!/^[a-f0-9]{64}\.[a-z0-9]{2,5}$/.test(sourceId)) throw new Error('invalid source id');
  if (!UPLOAD_EXTENSIONS.has(extname(sourceId).toLowerCase())) {
    throw new Error('source file type is not allowed');
  }
  const root = safeKeyDirectory('sources', key);
  const target = safeRegularFile(root, sourceId);
  if (hashFile(target) !== sourceId.slice(0, 64)) {
    throw new Error('content-addressed source has an invalid hash');
  }
  return target;
}

export function validateUploadSourceQuality(extension, info) {
  const normalizedExtension = String(extension).toLowerCase();
  const codec = typeof info?.codec === 'string' ? info.codec.toLowerCase() : '';
  const losslessCodec = codec === 'flac' || codec === 'alac' || codec.startsWith('pcm_');
  if (LOSSLESS_EXTENSIONS.has(normalizedExtension) && losslessCodec) return { lossless: true };
  const bitrateKbps = Number(info?.bitrate) / 1000;
  if (!Number.isFinite(bitrateKbps) || bitrateKbps < MIN_SOURCE_BITRATE) {
    throw new Error(`lossy audio source must be at least ${MIN_SOURCE_BITRATE} kbps`);
  }
  return { lossless: false, bitrateKbps };
}

export async function saveUpload(key, filename, buffer, expectedAudioWorkspaceHash = undefined) {
  assertSfxKey(key);
  ensureDirs();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('empty upload');
  if (buffer.length > 64 * 1024 * 1024) throw new Error('upload exceeds 64 MiB');
  const ext = extname(basename(String(filename ?? ''))).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(ext)) throw new Error('unsupported audio extension');
  const hash = createHash('sha256').update(buffer).digest('hex');
  const sourceId = `${hash}${ext}`;
  const dir = safeKeyDirectory('sources', key);
  const path = join(dir, sourceId);
  const temporary = join(
    dir,
    `.${hash}.${process.pid}.${randomBytes(4).toString('hex')}.upload${ext}`,
  );
  const candidate = existsSync(path) ? safeRegularFile(dir, sourceId) : temporary;
  if (candidate !== temporary && hashFile(candidate) !== hash) {
    throw new Error('content-addressed upload source has an invalid hash');
  }
  if (candidate === temporary) writeFileSync(temporary, buffer, { flag: 'wx', mode: 0o600 });
  let info;
  try {
    info = await inspectAudio(candidate);
    validateUploadSourceQuality(ext, info);
    if (!(info.duration > 0 && info.duration <= 120))
      throw new Error('audio duration must be 0 to 120 seconds');
    if (!(info.channels >= 1 && info.channels <= 2))
      throw new Error('audio must have 1 or 2 channels');
    if (!(info.sampleRate >= 8000 && info.sampleRate <= 96000))
      throw new Error('audio sample rate must be 8 to 96 kHz');
    if (info.duration * info.sampleRate * info.channels > 12_000_000) {
      throw new Error('decoded audio exceeds the 12 million sample editor budget');
    }
    if (candidate === temporary) renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  const project = normalizeProject(
    { ...defaultProject({ loop: !!CATALOG.get(key)?.loop }), sourceId },
    {
      loop: !!CATALOG.get(key)?.loop,
      duration: info.duration,
    },
  );
  return withMutationLock(async () => {
    assertExpectedAudioWorkspaceHash(key, expectedAudioWorkspaceHash);
    atomicJson(draftPath(key), project);
    return { sourceId, info, project, audioWorkspaceHash: draftProjectHash(project) };
  });
}

function previewPath(key, signature) {
  ensureDirs();
  const root = realpathSync(join(STUDIO_ROOT, 'previews'));
  const name = `${assertSfxKey(key)}.${signature}.mp3`;
  const path = join(root, name);
  if (existsSync(path)) return safeRegularFile(root, name);
  return path;
}

function previewMetadataPath(key, signature) {
  ensureDirs();
  const root = realpathSync(join(STUDIO_ROOT, 'previews'));
  const name = `${assertSfxKey(key)}.${signature}.json`;
  const path = join(root, name);
  if (existsSync(path)) return safeRegularFile(root, name);
  return path;
}

async function withRenderLock(signature, action) {
  const previous = renderLocks.get(signature) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(action);
  renderLocks.set(signature, pending);
  try {
    return await pending;
  } finally {
    if (renderLocks.get(signature) === pending) renderLocks.delete(signature);
  }
}

export function verifyEncodedMaster(loudness, project, loopContinuity = null) {
  const targetTruePeakDb = effectiveTruePeakDb(project);
  const errors = [];
  if (!Number.isFinite(loudness.truePeakDb)) errors.push('true peak could not be measured');
  else if (loudness.truePeakDb > targetTruePeakDb + 0.05) {
    errors.push(`true peak ${loudness.truePeakDb} dBTP exceeds ${targetTruePeakDb} dBTP`);
  }
  if (project.normalize.enabled) {
    if (!Number.isFinite(loudness.integratedLufs))
      errors.push('integrated loudness is below the EBU R128 gate');
    else if (Math.abs(loudness.integratedLufs - project.normalize.targetLufs) > 0.5) {
      errors.push(
        `integrated loudness ${loudness.integratedLufs} LUFS misses ${project.normalize.targetLufs} LUFS`,
      );
    }
  }
  if (project.loop.enabled) {
    if (!loopContinuity) errors.push('decoded loop continuity was not measured');
    else if (loopContinuity.maxDelta > 0.05 || loopContinuity.maxRatio > 12) {
      errors.push(
        `decoded loop seam is discontinuous (${loopContinuity.maxDelta.toFixed(4)} delta, ${loopContinuity.maxRatio.toFixed(1)}x local derivative)`,
      );
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    targetTruePeakDb,
    targetLufs: project.normalize.enabled ? project.normalize.targetLufs : null,
  };
}

export function verifyProductionMaster(conformance, loopContinuity = null, requireLoop = false) {
  const errors = [...(conformance?.problems ?? [])];
  if (conformance?.reject) errors.push('lossy source bitrate is below the production floor');
  if (conformance?.codec !== 'mp3') errors.push('output codec must be MP3');
  if (![1, 2].includes(conformance?.channels)) errors.push('output must be mono or stereo');
  if (requireLoop && !loopContinuity) errors.push('decoded loop continuity was not measured');
  else if (loopContinuity && (loopContinuity.maxDelta > 0.05 || loopContinuity.maxRatio > 12)) {
    errors.push(
      `decoded loop seam is discontinuous (${loopContinuity.maxDelta.toFixed(4)} delta, ${loopContinuity.maxRatio.toFixed(1)}x local derivative)`,
    );
  }
  return {
    ok: errors.length === 0,
    errors,
    normBranch: conformance?.normBranch ?? null,
  };
}

function masteringNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -200 || value > 200) {
    throw new Error(`${label} must be a finite bounded number`);
  }
  return value;
}

function normalizeMasteringMeasurement(raw) {
  if (raw === null) return null;
  assertOnlyFields(
    raw,
    new Set(['measuredI', 'measuredTp', 'measuredLra', 'measuredThresh', 'offset']),
    'mastering measurement',
  );
  return {
    measuredI: masteringNumber(raw.measuredI, 'measuredI'),
    measuredTp: masteringNumber(raw.measuredTp, 'measuredTp'),
    measuredLra: masteringNumber(raw.measuredLra, 'measuredLra'),
    measuredThresh: masteringNumber(raw.measuredThresh, 'measuredThresh'),
    offset: masteringNumber(raw.offset, 'offset'),
  };
}

export function normalizeProductionMastering(raw, { allowHistoricalRevision = false } = {}) {
  assertOnlyFields(
    raw,
    new Set(['revision', 'mode', 'authoringMode', 'measurement', 'conform']),
    'production mastering metadata',
  );
  const revisionIsCompatible = allowHistoricalRevision
    ? Number.isInteger(raw.revision) && raw.revision >= 0 && raw.revision <= MASTERING_REVISION
    : raw.revision === MASTERING_REVISION;
  if (!revisionIsCompatible || raw.mode !== 'production-conform') {
    throw new Error('production mastering metadata has an incompatible revision or mode');
  }
  if (!['direct', 'linear'].includes(raw.authoringMode)) {
    throw new Error('production mastering metadata has an invalid authoring mode');
  }
  const measurement = normalizeMasteringMeasurement(raw.measurement);
  assertOnlyFields(
    raw.conform,
    new Set(['normBranch', 'inputLevel', 'outputLevel', 'gainDb', 'attempts']),
    'production conform metadata',
  );
  if (!['peak', 'lufs'].includes(raw.conform.normBranch)) {
    throw new Error('production conform metadata has an invalid branch');
  }
  if (
    !Array.isArray(raw.conform.attempts) ||
    raw.conform.attempts.length < 1 ||
    raw.conform.attempts.length > 16
  ) {
    throw new Error('production conform metadata has invalid attempts');
  }
  const attempts = raw.conform.attempts.map((attempt) => {
    assertOnlyFields(
      attempt,
      new Set(['gainDb', 'measuredOutput', 'measuredPeakDb', 'error']),
      'production conform attempt',
    );
    return {
      gainDb: masteringNumber(attempt.gainDb, 'conform attempt gain'),
      measuredOutput: masteringNumber(attempt.measuredOutput, 'conform attempt output'),
      // Optional: added alongside conform_audio.mjs's independent post-encode
      // true-peak verification. A project published before that change has
      // persisted attempts without this field; keep loading it, don't force
      // every historical record to carry a value that was never measured.
      ...(attempt.measuredPeakDb === undefined
        ? {}
        : { measuredPeakDb: masteringNumber(attempt.measuredPeakDb, 'conform attempt peak') }),
      error: masteringNumber(attempt.error, 'conform attempt error'),
    };
  });
  return {
    revision: raw.revision,
    mode: 'production-conform',
    authoringMode: raw.authoringMode,
    measurement,
    conform: {
      normBranch: raw.conform.normBranch,
      inputLevel: masteringNumber(raw.conform.inputLevel, 'conform input level'),
      outputLevel: masteringNumber(raw.conform.outputLevel, 'conform output level'),
      gainDb: masteringNumber(raw.conform.gainDb, 'conform gain'),
      attempts,
    },
  };
}

export function codecCorrectionDb(loudness, project) {
  if (!Number.isFinite(loudness.truePeakDb)) return null;
  const peakCorrection = effectiveTruePeakDb(project) - loudness.truePeakDb - 0.05;
  if (!project.normalize.enabled) return Number(Math.min(0, peakCorrection).toFixed(4));
  if (!Number.isFinite(loudness.integratedLufs)) return null;
  return Number(
    Math.min(project.normalize.targetLufs - loudness.integratedLufs, peakCorrection).toFixed(4),
  );
}

async function renderMasterFile({ key, input, output, saved }) {
  const loop = !!CATALOG.get(key)?.loop;
  const spatial = spatialForSfx(key);
  let measurement = null;
  if (saved.project.normalize.enabled) {
    const plan = buildLoudnessMeasureArgs({
      input,
      project: saved.project,
      duration: saved.source.duration,
      sampleRate: saved.source.sampleRate,
      sourceChannels: saved.source.channels,
      loop,
      spatial,
    });
    const report = parseLoudnormReport((await run(FFMPEG_PATH, plan.args)).stderr);
    measurement = report.measurement;
    if (!measurement) {
      throw new Error('EBU R128 normalization is below the absolute gate after 400 ms padding');
    }
  }

  const authoring = `${output}.${process.pid}.${randomBytes(4).toString('hex')}.authoring.wav`;
  try {
    const plan = buildAuthoringPcmArgs({
      input,
      output: authoring,
      project: saved.project,
      duration: saved.source.duration,
      sampleRate: saved.source.sampleRate,
      sourceChannels: saved.source.channels,
      loop,
      spatial,
      loudnessMeasurement: saved.project.normalize.enabled ? measurement : undefined,
    });
    const render = await run(FFMPEG_PATH, plan.args);
    let authoringMode = 'direct';
    if (saved.project.normalize.enabled) {
      authoringMode = parseLoudnormReport(render.stderr).normalizationType;
      if (authoringMode !== 'linear') {
        throw new Error(
          `FFmpeg pre-conform loudness shaping fell back to ${authoringMode ?? 'unknown'} mode`,
        );
      }
    }

    const authoringInfo = await inspectAudio(authoring);
    const { outputFile: _conformedPath, ...conform } = conformSfxAudio({
      inputFile: authoring,
      outputFile: output,
      duration: authoringInfo.duration,
      ffmpegPath: FFMPEG_PATH,
    });
    const info = await inspectAudio(output);
    const [loudness, loopContinuity] = await Promise.all([
      analyzeLoudness(output),
      loop ? analyzeLoopContinuity(output, info.channels) : Promise.resolve(null),
    ]);
    const conformance = inspectSfxConformance(output, {
      ffmpegPath: FFMPEG_PATH,
      ffprobePath: FFPROBE_PATH,
    });
    const verification = verifyProductionMaster(conformance, loopContinuity, loop);
    if (!verification.ok) {
      throw new Error(`production-conformed master failed QA: ${verification.errors.join('; ')}`);
    }
    return {
      info,
      loudness,
      loopContinuity,
      mastering: {
        revision: MASTERING_REVISION,
        mode: 'production-conform',
        authoringMode,
        measurement,
        conform,
      },
    };
  } finally {
    rmSync(authoring, { force: true });
  }
}

export function canonicalRenderRecipe(project) {
  if (!isPlainObject(project)) throw new Error('render project must be an object');
  const { sourceId: _sourceId, syncOffsetMs: _syncOffsetMs, ...recipe } = project;
  return recipe;
}

export async function renderExactMaster(key, rawProject, expectedAudioWorkspaceHash = undefined) {
  assertSfxKey(key);
  ensureDirs();
  const saved = await saveDraft(key, rawProject, expectedAudioWorkspaceHash);
  const input = resolveSourcePath(key, saved.project.sourceId);
  const projected = buildFfmpegGraph(saved.project, {
    duration: saved.source.duration,
    sampleRate: saved.source.sampleRate,
    sourceChannels: saved.source.channels,
    loop: !!CATALOG.get(key)?.loop,
    spatial: spatialForSfx(key),
  });
  const maxDuration = CATALOG.get(key)?.loop ? 60 : 15;
  if (!(projected.outputDuration > 0 && projected.outputDuration <= maxDuration)) {
    throw new Error(`exact render duration must be 0 to ${maxDuration} seconds for this cue`);
  }
  const fingerprint = await ffmpegFingerprint();
  const renderRecipe = canonicalRenderRecipe(saved.project);
  const signature = createHash('sha256')
    .update(`mastering:${MASTERING_REVISION}:${fingerprint}:`)
    .update(hashFile(input))
    .update(JSON.stringify(renderRecipe))
    .digest('hex')
    .slice(0, 16);
  const output = previewPath(key, signature);
  const metadataPath = previewMetadataPath(key, signature);
  return withRenderLock(signature, async () => {
    if (existsSync(output) && existsSync(metadataPath)) {
      try {
        if (statSync(metadataPath).size > 256 * 1024)
          throw new Error('cache metadata is too large');
        if (statSync(output).size > 4 * 1024 * 1024) throw new Error('cache audio is too large');
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
        assertOnlyFields(
          metadata,
          new Set([
            'signature',
            'fingerprint',
            'info',
            'loudness',
            'loopContinuity',
            'mastering',
            'renderRecipe',
            'outputHash',
          ]),
          'preview cache metadata',
        );
        const mastering = normalizeProductionMastering(metadata.mastering);
        if (
          metadata.signature !== signature ||
          metadata.fingerprint !== fingerprint ||
          JSON.stringify(metadata.renderRecipe) !== JSON.stringify(renderRecipe) ||
          metadata.outputHash !== hashFile(output)
        ) {
          throw new Error('cache metadata does not match the requested master');
        }
        const info = await inspectAudio(output);
        const [loudness, loopContinuity] = await Promise.all([
          analyzeLoudness(output),
          saved.project.loop.enabled
            ? analyzeLoopContinuity(output, info.channels)
            : Promise.resolve(null),
        ]);
        const conformance = inspectSfxConformance(output, {
          ffmpegPath: FFMPEG_PATH,
          ffprobePath: FFPROBE_PATH,
        });
        const verification = verifyProductionMaster(
          conformance,
          loopContinuity,
          saved.project.loop.enabled,
        );
        validatePublishedBudget(key, info);
        if (verification.ok) {
          return {
            signature,
            fingerprint,
            renderRecipe,
            outputHash: metadata.outputHash,
            mastering,
            project: saved.project,
            audioWorkspaceHash: saved.audioWorkspaceHash,
            info,
            loudness,
            loopContinuity,
            path: output,
          };
        }
      } catch {
        // Corrupt or stale cache entries are rebuilt below.
      }
    }
    rmSync(output, { force: true });
    rmSync(metadataPath, { force: true });
    const rendered = await renderMasterFile({ key, input, output, saved });
    const metadata = {
      signature,
      fingerprint,
      info: rendered.info,
      loudness: rendered.loudness,
      loopContinuity: rendered.loopContinuity,
      mastering: normalizeProductionMastering(rendered.mastering),
      renderRecipe,
      outputHash: hashFile(output),
    };
    atomicJson(metadataPath, metadata);
    return {
      ...metadata,
      project: saved.project,
      audioWorkspaceHash: saved.audioWorkspaceHash,
      path: output,
    };
  });
}

export async function renderPreview(key, rawProject, expectedAudioWorkspaceHash = undefined) {
  const rendered = await renderExactMaster(key, rawProject, expectedAudioWorkspaceHash);
  if (hashFile(rendered.path) !== rendered.outputHash)
    throw new Error('verified master cache changed');
  return {
    url: `/preview/${basename(rendered.path)}?v=${rendered.signature}`,
    signature: rendered.signature,
    info: rendered.info,
    loudness: rendered.loudness,
    loopContinuity: rendered.loopContinuity,
    mastering: rendered.mastering,
    project: rendered.project,
    audioWorkspaceHash: rendered.audioWorkspaceHash,
  };
}

function readMixStrict() {
  const mix = readSfxMix(REPO_ROOT);
  const clips = {};
  for (const [key, value] of Object.entries(mix.clips)) {
    if (!KEYS.has(key) || !value || typeof value !== 'object') continue;
    const { runtimeGainDb: _legacyRuntimeGainDb, ...entry } = value;
    clips[key] = entry;
  }
  return { version: 1, clips };
}

export function publishedStateIdentity(audioHash, mixState) {
  if (typeof audioHash !== 'string' || !/^[a-f0-9]{64}$/.test(audioHash)) {
    throw new Error('published audio identity must be a full SHA-256 digest');
  }
  return createHash('sha256')
    .update(audioHash)
    .update(JSON.stringify(mixState ?? null))
    .digest('hex');
}

function publishedStateHashFromMix(key, mix) {
  return publishedStateIdentity(hashFile(publicPath(key)), mix.clips[key] ?? null);
}

export function publishedStateHashForKey(key) {
  assertSfxKey(key);
  return publishedStateHashFromMix(key, readMixStrict());
}

function writeMix(mix) {
  const sorted = Object.fromEntries(
    Object.entries(mix.clips).sort(([a], [b]) => a.localeCompare(b)),
  );
  atomicJson(join(REPO_ROOT, 'scripts/sfx/sfx_mix.json'), { version: 1, clips: sorted });
}

export async function publishPlaybackProfile(
  key,
  expectedProfileHash,
  expectedWorkspaceHash,
  repoRoot = REPO_ROOT,
) {
  assertSfxKey(key);
  if (typeof expectedProfileHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedProfileHash)) {
    throw new Error('expected playback profile hash must be a full SHA-256 digest');
  }
  ensureDirs();
  return withMutationLock(async () => {
    const draft = loadPlaybackProfileDraft();
    const currentWorkspaceHash = playbackProfileHash({
      gainMap: draft.gainMap,
      speedMap: draft.speedMap,
    });
    if (
      typeof expectedWorkspaceHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedWorkspaceHash)
    ) {
      throw new Error('expected workspace playback hash must be a full SHA-256 digest');
    }
    if (expectedWorkspaceHash !== currentWorkspaceHash) {
      throw new Error('workspace playback profile changed in another Studio tab');
    }
    if (draft.baseHash !== expectedProfileHash) {
      throw new Error('workspace playback profile was based on a different published profile');
    }
    const currentProfile = normalizePlaybackProfile(readSfxPlaybackProfile(repoRoot));
    const currentHash = playbackProfileHash(currentProfile);
    if (currentHash !== expectedProfileHash) {
      throw new Error('published playback profile changed since this project was opened');
    }

    const gainPath = join(repoRoot, SFX_GAIN_MAP_PATH);
    const speedPath = join(repoRoot, SFX_SPEED_MAP_PATH);
    const manifestPath = join(repoRoot, 'src/game/sfx_manifest.generated.ts');
    const runtimePackPath = join(repoRoot, SFX_RUNTIME_PACK_PATH);
    const workspacePath = playbackDraftPath();
    const audioPath = publicPath(key, repoRoot);
    const audioHashBefore = hashFile(audioPath);
    const previous = {
      gain: readFileSync(gainPath),
      speed: readFileSync(speedPath),
      manifest: readFileSync(manifestPath),
      runtimePack: existsSync(runtimePackPath) ? readFileSync(runtimePackPath) : null,
      workspace: readFileSync(workspacePath),
    };
    try {
      writeSfxPlaybackProfile(repoRoot, {
        gainMap: draft.gainMap,
        speedMap: draft.speedMap,
      });
      const manifest = writeSfxManifest(repoRoot);
      const audioHashAfter = hashFile(audioPath);
      if (audioHashAfter !== audioHashBefore) {
        throw new Error('playback profile publish changed the SFX audio file');
      }
      const published = normalizePlaybackProfile(readSfxPlaybackProfile(repoRoot));
      const nextProfileHash = playbackProfileHash(published);
      atomicJson(workspacePath, {
        version: 1,
        baseHash: nextProfileHash,
        ...published,
      });
      return {
        key,
        playback: playbackResponseForCue(key, published),
        playbackProfileHash: nextProfileHash,
        playbackWorkspaceHash: nextProfileHash,
        playbackProfileDirty: false,
        audioHashBefore,
        audioHashAfter,
        audioUnchanged: true,
        manifestEntries: Object.keys(manifest.entries).length,
      };
    } catch (error) {
      atomicBytes(gainPath, previous.gain);
      atomicBytes(speedPath, previous.speed);
      atomicBytes(manifestPath, previous.manifest);
      if (previous.runtimePack) atomicBytes(runtimePackPath, previous.runtimePack);
      else rmSync(runtimePackPath, { force: true });
      atomicBytes(workspacePath, previous.workspace);
      throw error;
    }
  });
}

export async function exportProductionBundle(expectedProfileHash, expectedWorkspaceHash) {
  if (typeof expectedProfileHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedProfileHash)) {
    throw new Error('expected playback profile hash must be a full SHA-256 digest');
  }
  if (typeof expectedWorkspaceHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedWorkspaceHash)) {
    throw new Error('expected workspace playback hash must be a full SHA-256 digest');
  }
  ensureDirs();
  return withMutationLock(async () => {
    const draft = loadPlaybackProfileDraft();
    const workspaceProfile = normalizePlaybackProfile({
      gainMap: draft.gainMap,
      speedMap: draft.speedMap,
    });
    const workspaceHash = playbackProfileHash(workspaceProfile);
    if (workspaceHash !== expectedWorkspaceHash) {
      throw new Error('workspace playback profile changed in another Studio tab');
    }
    if (draft.baseHash !== expectedProfileHash) {
      throw new Error('workspace playback profile was based on a different published profile');
    }
    const publishedProfile = normalizePlaybackProfile(readSfxPlaybackProfile(REPO_ROOT));
    const publishedHash = playbackProfileHash(publishedProfile);
    if (publishedHash !== expectedProfileHash) {
      throw new Error('published playback profile changed since this project was opened');
    }
    if (JSON.stringify(workspaceProfile) !== JSON.stringify(publishedProfile)) {
      throw new Error(
        'export blocked: apply the saved playback mix before exporting the production bundle',
      );
    }
    const unpublishedAudio = await unpublishedAudioDraftKeys();
    if (unpublishedAudio.length) {
      throw new Error(
        `export blocked: publish or reset saved audio drafts for ${unpublishedAudio.join(', ')}`,
      );
    }
    const studio = ensureDirs();
    const exportRoot = existingPlainDirectory(join(studio, 'exports'), studio);
    // Loaded lazily: export_bundle.mjs throws at import time when ffmpeg-static
    // exports null (unsupported platform), and a top-level import here would take
    // down the whole Studio module graph, including the playback/encode paths that
    // deliberately keep working through the resolver's PATH fallback.
    const { writeSfxProductionBundle } = await import('./export_bundle.mjs');
    const {
      zip: _zip,
      runtimePack: _runtimePack,
      metadata,
      ...bundle
    } = writeSfxProductionBundle(REPO_ROOT, exportRoot);
    return { ...bundle, ...metadata };
  });
}

function snapshotPublished(key, mix) {
  const source = publicPath(key);
  const audioHash = hashFile(source);
  const mixState = mix.clips[key] ?? null;
  const hash = publishedStateHashFromMix(key, mix);
  const dir = safeKeyDirectory('versions', key);
  const metaPath = join(dir, `${hash}.json`);
  installRegularCopy(dir, `${hash}.mp3`, source, audioHash);
  if (!existsSync(metaPath)) atomicJson(metaPath, { audioHash, mix: mixState });
  readVersionArchive(key, hash);
  return hash;
}

function readVersionArchive(key, hash) {
  const dir = safeKeyDirectory('versions', key);
  const audio = safeRegularFile(dir, `${hash}.mp3`);
  const meta = safeRegularFile(dir, `${hash}.json`);
  if (statSync(audio).size > 4 * 1024 * 1024) throw new Error('version audio exceeds 4 MiB');
  if (statSync(meta).size > 256 * 1024) throw new Error('version metadata exceeds 256 KiB');
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(meta, 'utf8'));
  } catch {
    throw new Error('version metadata is invalid JSON');
  }
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !/^[a-f0-9]{64}$/.test(metadata.audioHash) ||
    (metadata.mix !== null && (typeof metadata.mix !== 'object' || Array.isArray(metadata.mix)))
  ) {
    throw new Error('version metadata has an invalid shape');
  }
  const actualAudioHash = hashFile(audio);
  if (actualAudioHash !== metadata.audioHash) throw new Error('version audio hash is invalid');
  const identity = publishedStateIdentity(actualAudioHash, metadata.mix);
  if (identity !== hash) throw new Error('version archive identity is invalid');
  return { audio, metadata };
}

function restoredOutput(raw, info, loudness) {
  if (raw === undefined || raw === null) {
    return {
      channels: info.channels,
      sampleRate: info.sampleRate,
      bitrate: info.bitrate,
      integratedLufs: loudness.integratedLufs,
      truePeakDb: loudness.truePeakDb,
    };
  }
  assertOnlyFields(
    raw,
    new Set(['channels', 'sampleRate', 'bitrate', 'integratedLufs', 'truePeakDb']),
    'version output metadata',
  );
  if (![1, 2].includes(raw.channels) || raw.channels !== info.channels) {
    throw new Error('version output metadata has invalid channels');
  }
  if (
    !Number.isInteger(raw.sampleRate) ||
    raw.sampleRate < 8_000 ||
    raw.sampleRate > 96_000 ||
    raw.sampleRate !== info.sampleRate
  ) {
    throw new Error('version output metadata has an invalid sample rate');
  }
  if (!Number.isInteger(raw.bitrate) || raw.bitrate < 1 || raw.bitrate > 1_000_000) {
    throw new Error('version output metadata has an invalid bitrate');
  }
  return {
    channels: raw.channels,
    sampleRate: raw.sampleRate,
    bitrate: raw.bitrate,
    integratedLufs: masteringNumber(raw.integratedLufs, 'version integrated loudness'),
    truePeakDb: masteringNumber(raw.truePeakDb, 'version true peak'),
  };
}

export function restoredMixEntry(raw, info, loudness, key) {
  if (raw === null) return null;
  const project = normalizeProject(raw.project ?? {}, {
    loop: !!CATALOG.get(key)?.loop,
    // Version metadata stores a project normalized against its original source.
    // The archive only retains the rendered master, whose shorter duration must
    // never clamp or discard that tracked recipe during restore.
    duration: 300,
  });
  project.sourceId = null;
  const legacyProductionMetadata =
    raw.mastering?.mode === 'production-conform' &&
    Object.keys(raw.mastering).every((field) => ['revision', 'mode'].includes(field));
  let mastering;
  if (raw.mastering?.mode === 'production-conform' && !legacyProductionMetadata) {
    mastering = normalizeProductionMastering(raw.mastering, { allowHistoricalRevision: true });
  } else {
    const revision = Math.round(
      Math.min(1_000_000, Math.max(0, Number(raw.mastering?.revision) || 0)),
    );
    const mode = ['linear', 'direct', 'production-conform'].includes(raw.mastering?.mode)
      ? raw.mastering.mode
      : 'restored';
    mastering = { revision, mode };
  }
  return {
    project,
    mastering,
    output: restoredOutput(raw.output, info, loudness),
  };
}

export function validatePublishedBudget(key, info, { allowLegacySampleRate = false } = {}) {
  const loop = !!CATALOG.get(assertSfxKey(key))?.loop;
  const maxDuration = loop ? 60 : 15;
  const errors = [];
  if (!(info.duration > 0 && info.duration <= maxDuration + 0.1)) {
    errors.push(`duration must be at most ${maxDuration} seconds`);
  }
  if (!(info.bytes > 0 && info.bytes <= 4 * 1024 * 1024)) errors.push('file must be at most 4 MiB');
  if (info.codec !== 'mp3') errors.push('output codec must be MP3');
  const validSampleRate = allowLegacySampleRate
    ? info.sampleRate >= 8000 && info.sampleRate <= 96000
    : info.sampleRate === 44100;
  if (!validSampleRate) {
    errors.push(
      allowLegacySampleRate
        ? 'legacy sample rate must be 8000 to 96000 Hz'
        : 'sample rate must be 44100 Hz',
    );
  }
  if (![1, 2].includes(info.channels)) errors.push('output must be mono or stereo');
  if (errors.length) throw new Error(`published SFX budget failed: ${errors.join('; ')}`);
  return { maxDuration, maxBytes: 4 * 1024 * 1024 };
}

export async function publishProject(
  key,
  rawProject,
  expectedHash = null,
  expectedAudioWorkspaceHash = undefined,
) {
  assertSfxKey(key);
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('expected published hash must be a full SHA-256 digest');
  }
  ensureDirs();
  assertPublishedMasterIsMp3(publicPath(key));
  const rendered = await renderExactMaster(key, rawProject, expectedAudioWorkspaceHash);
  if (hashFile(rendered.path) !== rendered.outputHash)
    throw new Error('verified master cache changed');
  validatePublishedBudget(key, rendered.info);
  return withMutationLock(async () => {
    assertExpectedAudioWorkspaceHash(key, rendered.audioWorkspaceHash);
    const current = publicPath(key);
    const mix = readMixStrict();
    if (expectedHash !== publishedStateHashFromMix(key, mix)) {
      throw new Error('published audio or recipe changed since this project was opened');
    }
    snapshotPublished(key, mix);
    const trackedProject = { ...rendered.project, sourceId: null };
    mix.clips[key] = {
      project: trackedProject,
      mastering: rendered.mastering,
      output: {
        channels: rendered.info.channels,
        sampleRate: rendered.info.sampleRate,
        bitrate: rendered.info.bitrate,
        integratedLufs: rendered.loudness.integratedLufs,
        truePeakDb: rendered.loudness.truePeakDb,
      },
    };
    const mixPath = join(REPO_ROOT, 'scripts/sfx/sfx_mix.json');
    const manifestPath = join(REPO_ROOT, 'src/game/sfx_manifest.generated.ts');
    const runtimePackPath = join(REPO_ROOT, SFX_RUNTIME_PACK_PATH);
    const previous = {
      audio: readFileSync(current),
      mix: readFileSync(mixPath),
      manifest: readFileSync(manifestPath),
      runtimePack: existsSync(runtimePackPath) ? readFileSync(runtimePackPath) : null,
    };
    try {
      let publicTemp = copyToExclusiveTemporary(
        dirname(current),
        `${key}.publish`,
        '.mp3',
        rendered.path,
      );
      try {
        renameSync(publicTemp, current);
        publicTemp = null;
      } finally {
        if (publicTemp) rmSync(publicTemp, { force: true });
      }
      writeMix(mix);
      const manifest = writeSfxManifest(REPO_ROOT);
      const publishedHash = publishedStateHashFromMix(key, mix);
      markDraftPublished(key, rendered.project, publishedHash);
      return {
        key,
        hash: publishedHash,
        audioHash: hashFile(current),
        info: rendered.info,
        loudness: rendered.loudness,
        loopContinuity: rendered.loopContinuity,
        mastering: rendered.mastering,
        project: rendered.project,
        audioWorkspaceHash: rendered.audioWorkspaceHash,
        manifestEntries: Object.keys(manifest.entries).length,
      };
    } catch (error) {
      atomicBytes(current, previous.audio);
      atomicBytes(mixPath, previous.mix);
      atomicBytes(manifestPath, previous.manifest);
      if (previous.runtimePack) atomicBytes(runtimePackPath, previous.runtimePack);
      else rmSync(runtimePackPath, { force: true });
      throw error;
    }
  });
}

export function assertPublishedMasterIsMp3(path) {
  if (extname(path).toLowerCase() !== '.mp3') {
    throw new Error('published source must be conformed to MP3 before Studio publish');
  }
  return path;
}

export function listVersions(key) {
  assertSfxKey(key);
  const dir = safeKeyDirectory('versions', key);
  return readdirSync(dir)
    .filter((name) => /^[a-f0-9]{64}\.mp3$/.test(name))
    .map((name) => {
      const hash = name.slice(0, 64);
      try {
        const archive = readVersionArchive(key, hash);
        return { hash, bytes: statSync(archive.audio).size };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.hash.localeCompare(b.hash));
}

export async function restoreVersion(
  key,
  hash,
  expectedHash = null,
  expectedAudioWorkspaceHash = undefined,
) {
  assertSfxKey(key);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid version hash');
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('expected published hash must be a full SHA-256 digest');
  }
  await loadDraft(key);
  const archive = readVersionArchive(key, hash);
  const info = await inspectAudio(archive.audio);
  validatePublishedBudget(key, info, { allowLegacySampleRate: true });
  const [loudness, loopContinuity] = await Promise.all([
    analyzeLoudness(archive.audio),
    CATALOG.get(key)?.loop
      ? analyzeLoopContinuity(archive.audio, info.channels)
      : Promise.resolve(null),
  ]);
  const restoredMix = restoredMixEntry(archive.metadata.mix, info, loudness, key);
  // A null recipe marks a byte-for-byte legacy master that predates Studio QA.
  // Grandfather that archived game asset; Studio-authored versions must still
  // pass the exact mastering contract recorded with them.
  if (restoredMix) {
    const verification =
      restoredMix.mastering.mode === 'production-conform'
        ? verifyProductionMaster(
            inspectSfxConformance(archive.audio, {
              ffmpegPath: FFMPEG_PATH,
              ffprobePath: FFPROBE_PATH,
            }),
            loopContinuity,
            !!CATALOG.get(key)?.loop,
          )
        : verifyEncodedMaster(loudness, restoredMix.project, loopContinuity);
    if (!verification.ok) {
      throw new Error(`version master failed QA: ${verification.errors.join('; ')}`);
    }
  }
  return withMutationLock(async () => {
    assertExpectedAudioWorkspaceHash(key, expectedAudioWorkspaceHash);
    const mix = readMixStrict();
    const current = publicPath(key);
    if (publishedStateHashFromMix(key, mix) !== expectedHash) {
      throw new Error('published audio or recipe changed since this version list was opened');
    }
    snapshotPublished(key, mix);
    const mixPath = join(REPO_ROOT, 'scripts/sfx/sfx_mix.json');
    const manifestPath = join(REPO_ROOT, 'src/game/sfx_manifest.generated.ts');
    const runtimePackPath = join(REPO_ROOT, SFX_RUNTIME_PACK_PATH);
    const projectPath = draftPath(key);
    const previousFiles = {
      audio: readFileSync(current),
      mix: readFileSync(mixPath),
      manifest: readFileSync(manifestPath),
      runtimePack: existsSync(runtimePackPath) ? readFileSync(runtimePackPath) : null,
      project: readFileSync(projectPath),
    };
    try {
      let temporary = copyToExclusiveTemporary(
        dirname(current),
        `${key}.restore`,
        '.mp3',
        archive.audio,
      );
      try {
        renameSync(temporary, current);
        temporary = null;
      } finally {
        if (temporary) rmSync(temporary, { force: true });
      }
      if (restoredMix) mix.clips[key] = restoredMix;
      else delete mix.clips[key];
      writeMix(mix);
      writeSfxManifest(REPO_ROOT);
      const publishedHash = publishedStateHashFromMix(key, mix);
      const sourceId = copyPublishedSource(key);
      const project = neutralPublishedProject(key, sourceId, info.duration);
      atomicJson(projectPath, project);
      markDraftPublished(key, project, publishedHash);
      return {
        key,
        hash: publishedHash,
        project,
        audioWorkspaceHash: draftProjectHash(project),
      };
    } catch (error) {
      atomicBytes(current, previousFiles.audio);
      atomicBytes(mixPath, previousFiles.mix);
      atomicBytes(manifestPath, previousFiles.manifest);
      atomicBytes(projectPath, previousFiles.project);
      if (previousFiles.runtimePack) atomicBytes(runtimePackPath, previousFiles.runtimePack);
      else rmSync(runtimePackPath, { force: true });
      throw error;
    }
  });
}

export function sourceUrl(key, sourceId) {
  assertSfxKey(key);
  if (!sourceId) return publishedUrl(key);
  resolveSourcePath(key, sourceId);
  return `/source/${key}/${sourceId}`;
}

export function publishedUrl(key) {
  const hash = hashFile(publicPath(key)).slice(0, 12);
  return `/audio/${key}.mp3?v=${hash}`;
}

export function publishedPath(key, repoRoot = REPO_ROOT) {
  return publicPath(key, repoRoot);
}
