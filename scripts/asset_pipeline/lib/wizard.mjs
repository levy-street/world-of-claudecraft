// Web-wizard backend for the live asset library (library --serve). Drives the
// existing pipeline CLI step by step as a child process, so an operator can
// generate an asset from scratch in the browser: text -> model (review, keep or
// regenerate) -> animations/finish (review) -> save. Long Tripo stages run in a
// detached-ish child while the browser polls status; only ONE child per job runs
// at a time. Nothing here talks to Tripo directly: it spawns pipeline.mjs with
// --until / --redo / --apply and reads the job dir the pipeline already writes.
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './env.mjs';
import { JOBS_ROOT } from './job.mjs';

const PIPELINE = join(REPO_ROOT, 'scripts/asset_pipeline/pipeline.mjs');
const LANES = new Set(['creature', 'weapon', 'prop']);

// In-memory registry of the currently-running child per jobId. A job with no
// live child is idle (finished, failed, or awaiting the next operator action).
const running = new Map(); // jobId -> { proc, phase, startedAt }

function safeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function jobIdFor(lane, name) {
  // Mirror Job.open's id shape so status/artifact lookups line up.
  return `${lane}_${safeName(name)}`;
}

/** Spawn one pipeline invocation for a job and stream its output to
 *  <jobdir>/wizard.out. Resolves when the child exits (the caller does not wait
 *  on it: the HTTP handler returns immediately and the browser polls status). */
function spawnStep(jobId, args, phase) {
  if (running.has(jobId)) throw new Error('a step is already running for this asset');
  const dir = join(JOBS_ROOT, jobId);
  // The pipeline child creates the job dir, but we open the capture stream first,
  // so ensure it exists and never let a stream error crash the server.
  mkdirSync(dir, { recursive: true });
  const out = createWriteStream(join(dir, 'wizard.out'), { flags: 'a' });
  out.on('error', () => {});
  out.write(`\n=== ${phase} :: ${new Date().toISOString()} :: ${args.join(' ')} ===\n`);
  const proc = spawn(process.execPath, [PIPELINE, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(out, { end: false });
  proc.stderr.pipe(out, { end: false });
  const entry = { proc, phase, startedAt: Date.now() };
  running.set(jobId, entry);
  proc.on('exit', (code) => {
    out.write(`=== exit ${code} ===\n`);
    out.end();
    entry.exitCode = code;
    running.delete(jobId);
  });
  proc.on('error', () => {
    out.end();
    running.delete(jobId);
  });
  return entry;
}

/** Start (or restart) generating the model for a new/edited asset. Runs the
 *  concept + generate stages and stops for review (--until generate). When
 *  regenerate is true, redoes the generate stage for a fresh candidate. */
export function startModel({ lane, name, prompt, image, regenerate, jobExists }) {
  if (!LANES.has(lane)) throw new Error(`unsupported lane: ${lane}`);
  const key = safeName(name);
  if (!key) throw new Error('name required');
  if (!prompt && !image) throw new Error('prompt or image required');
  const jobId = jobIdFor(lane, key);
  // Always drive a DETERMINISTIC job id (--job) so status/steps line up; --new-job
  // lets the pipeline create it on the first model run (it exists on resume/regen).
  const args = [lane, '--name', key, '--job', jobId, '--new-job', '--until', 'generate'];
  if (prompt) args.push('--prompt', prompt);
  if (image) args.push('--image', image);
  if (regenerate) args.push('--redo', 'generate');
  spawnStep(jobId, args, regenerate ? 'regenerate-model' : 'model');
  return { jobId };
}

/** Run the finishing stages (rig + animations for creatures, normalize + icon
 *  for weapons/props) and render final previews, stopping before apply so the
 *  operator reviews the animated/finished asset. regenerateAnimations redoes the
 *  animation stage only (creatures). */
export function finishAsset({ lane, jobId, regenerateAnimations }) {
  if (!existsSync(join(JOBS_ROOT, jobId, 'job.json'))) throw new Error('job not found');
  const args = [lane, '--job', jobId];
  const nm = readJob(jobId)?.name;
  if (nm) args.push('--name', nm);
  if (regenerateAnimations) {
    args.push('--redo', lane === 'creature' ? 'retarget' : 'normalize');
  }
  spawnStep(jobId, args, regenerateAnimations ? 'regenerate-animations' : 'finish');
  return { jobId };
}

/** Integrate the approved asset into the game (copy GLB into public/, credits,
 *  registry snippet). Runs the lane once more with --apply (idempotent stages
 *  resume; only the copy/credits run). */
export function applyAsset({ lane, jobId }) {
  if (!existsSync(join(JOBS_ROOT, jobId, 'job.json'))) throw new Error('job not found');
  const args = [lane, '--job', jobId, '--apply'];
  const nm = readJob(jobId)?.name;
  if (nm) args.push('--name', nm);
  spawnStep(jobId, args, 'apply');
  return { jobId };
}

function readJob(jobId) {
  const f = join(JOBS_ROOT, jobId, 'job.json');
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

// Preview image dirs the wizard surfaces, newest-relevant first. preview_model
// is the raw-model review shot; preview is the final (animated/finished) set.
const PREVIEW_DIRS = ['preview', 'preview_model'];

function listPreviews(jobId) {
  const out = [];
  for (const sub of PREVIEW_DIRS) {
    const dir = join(JOBS_ROOT, jobId, sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (/\.(png|webp|jpg)$/i.test(f)) {
        out.push({
          group: sub === 'preview' ? 'final' : 'model',
          name: f.replace(/\.[^.]+$/, ''),
          url: `/repo/tmp/asset_pipeline/${jobId}/${sub}/${f}`,
          mtime: statSync(join(dir, f)).mtimeMs,
        });
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Full wizard status for the browser: whether a child is live, the step
 *  ledger, the tail of the captured output (for progress + the printed report /
 *  VisualDef snippet), and the current preview images. */
export function wizardStatus(jobId) {
  const id = safeName(jobId);
  const job = readJob(id);
  const live = running.get(id);
  if (!job) {
    // A child can be mid-first-step before it has written job.json: still report
    // running + the captured log so the browser shows progress immediately.
    const outFile = join(JOBS_ROOT, id, 'wizard.out');
    const boot = existsSync(outFile) ? readFileSync(outFile, 'utf8').slice(-4000) : '';
    return {
      jobId: id,
      exists: !!live,
      running: !!live,
      phase: live?.phase ?? null,
      steps: {},
      previews: [],
      log: boot,
    };
  }
  let tail = '';
  const outFile = join(JOBS_ROOT, id, 'wizard.out');
  if (existsSync(outFile)) {
    const buf = readFileSync(outFile, 'utf8');
    tail = buf.slice(-4000);
  }
  return {
    jobId: id,
    exists: true,
    name: job.name ?? null,
    kind: job.kind ?? null,
    running: !!live,
    phase: live?.phase ?? null,
    steps: Object.fromEntries(Object.entries(job.steps ?? {}).map(([k, v]) => [k, v.status])),
    validation: job.validation ?? null,
    previews: listPreviews(id),
    log: tail,
  };
}

export function isLaneSupported(lane) {
  return LANES.has(lane);
}
