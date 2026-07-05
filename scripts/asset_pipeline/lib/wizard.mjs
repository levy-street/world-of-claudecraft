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

// Operator-facing generation options exposed by the wizard form, mapped to the
// exact CLI flags each lane accepts. Rig type is consumed at the rig step (which
// runs during FINISH, not the model stage), and height/family/rotate at normalize,
// so genArgs is applied to BOTH startModel and finishAsset for the values to land.
const MODEL_QUALITIES = new Set(['lowpoly', 'hifi']);
export const RIG_TYPES = ['biped', 'quadruped', 'hexapod', 'octopod', 'serpentine', 'aquatic'];
export const WEAPON_FAMILIES = ['sword', 'dagger', 'axe', 'staff', 'wand', 'polearm'];
const RIG_TYPE_SET = new Set(RIG_TYPES);
const WEAPON_FAMILY_SET = new Set(WEAPON_FAMILIES);

/** Validate operator options into CLI args. EVERY value is allowlisted or
 *  numeric-clamped: these become spawn args, so an unchecked string could inject
 *  a flag (a rig type of "--apply" would enable a cheat), and an --image of a
 *  local path would read an arbitrary server file as the concept. */
export function genArgs(lane, options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const args = [];
  if (MODEL_QUALITIES.has(o.model) && o.model === 'hifi') args.push('--model', 'hifi');
  if (typeof o.image === 'string') {
    const img = o.image.trim();
    // A remote URL or a Tripo task/file id only: never a server-local path.
    if (/^https?:\/\/\S+$/.test(img) || /^(task_|file_)[\w-]+$/.test(img))
      args.push('--image', img);
  }
  const num = (v, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  const fl = num(o.faceLimit, 100, 20000);
  if (fl != null) args.push('--face-limit', String(Math.round(fl)));
  if (lane === 'creature') {
    if (RIG_TYPE_SET.has(o.rigType)) args.push('--rig-type', o.rigType);
    const h = num(o.height, 0.1, 20);
    if (h != null) args.push('--height', String(h));
  } else if (lane === 'weapon') {
    if (WEAPON_FAMILY_SET.has(o.family)) args.push('--family', o.family);
  } else if (lane === 'prop') {
    const h = num(o.height, 0.1, 20);
    if (h != null) args.push('--height', String(h));
    // Any finite angle is valid; normalize into [0, 360).
    const ryRaw = Number(o.rotateY);
    if (o.rotateY !== '' && o.rotateY != null && Number.isFinite(ryRaw))
      args.push('--rotate-y', String(((ryRaw % 360) + 360) % 360));
  }
  return args;
}

/** Free-text prompt values ride argv as the value after a flag; the pipeline's
 *  opt() skips values starting with "--" BUT flag() scans the whole argv, so a
 *  "prompt" of literally "--apply" would flip the apply flag. Reject those. */
function promptValue(p, label) {
  const v = String(p ?? '').trim();
  if (!v) return '';
  if (v.startsWith('--')) throw new Error(`${label} must not start with --`);
  return v;
}

/** Start (or restart) generating the model for a new/edited asset. Runs the
 *  concept + generate stages and stops for review (--until generate). When
 *  regenerate is true, redoes from the CONCEPT (not just generate) so the new
 *  candidate is a genuinely different creature and honors a changed prompt. */
export function startModel({ lane, name, prompt: rawPrompt, options, regenerate }) {
  if (!LANES.has(lane)) throw new Error(`unsupported lane: ${lane}`);
  const key = safeName(name);
  if (!key) throw new Error('name required');
  const prompt = promptValue(rawPrompt, 'prompt');
  const gen = genArgs(lane, options);
  if (!prompt && !gen.includes('--image')) throw new Error('prompt or image required');
  const jobId = jobIdFor(lane, key);
  // Always drive a DETERMINISTIC job id (--job) so status/steps line up; --new-job
  // lets the pipeline create it on the first model run (it exists on resume/regen).
  const args = [lane, '--name', key, '--job', jobId, '--new-job', '--until', 'generate'];
  if (prompt) args.push('--prompt', prompt);
  args.push(...gen);
  // Redo from CONCEPT, not generate: image-to-model from the SAME frozen concept
  // image barely varies (and ignores a changed prompt), so redoing only generate
  // shows "the same model". Redoing concept re-rolls the concept image (text-to-
  // image / gpt-image-2, a few credits) and cascades to a fresh model.
  if (regenerate) args.push('--redo', 'concept');
  spawnStep(jobId, args, regenerate ? 'regenerate-model' : 'model');
  return { jobId };
}

/** Repaint the approved model's texture from a text prompt (Tripo
 *  /models/texture, UV-preserving) and stop for review again. Repeatable: each
 *  call is --redo texture, which also clears any downstream finish work so the
 *  final asset always builds from the texture the operator approved. */
export function textureAsset({ lane, jobId, texturePrompt, textureQuality, options }) {
  if (!LANES.has(lane)) throw new Error(`unsupported lane: ${lane}`);
  if (!existsSync(join(JOBS_ROOT, jobId, 'job.json'))) throw new Error('job not found');
  const p = promptValue(texturePrompt, 'texture prompt');
  if (!p) throw new Error('texture prompt required');
  const args = [lane, '--job', jobId];
  const nm = readJob(jobId)?.name;
  if (nm) args.push('--name', nm);
  args.push(...genArgs(lane, options));
  args.push('--retexture', p, '--until', 'texture', '--redo', 'texture');
  if (textureQuality === 'standard') args.push('--texture-quality', 'standard');
  spawnStep(jobId, args, 'texture');
  return { jobId };
}

/** Run the finishing stages (rig + animations for creatures, normalize + icon
 *  for weapons/props) and render final previews, stopping before apply so the
 *  operator reviews the animated/finished asset. regenerateAnimations redoes the
 *  animation stage only (creatures). The same validated options are re-passed so
 *  rig type (rig step) and height/family/rotate (normalize) take effect here. */
export function finishAsset({ lane, jobId, options, regenerateAnimations }) {
  if (!existsSync(join(JOBS_ROOT, jobId, 'job.json'))) throw new Error('job not found');
  const args = [lane, '--job', jobId];
  const nm = readJob(jobId)?.name;
  if (nm) args.push('--name', nm);
  args.push(...genArgs(lane, options));
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

// Repo-relative path (for the live viewer's /repo/* route) to a GLB inside the
// job dir, or null when it has not been produced yet. The raw model appears after
// the generate stage; the finished/animated build after assemble/normalize.
function jobGlb(jobId, file) {
  const abs = join(JOBS_ROOT, jobId, file);
  if (!existsSync(abs)) return null;
  // Cache-bust by mtime: the URL is a fixed path (raw.glb / <name>.glb), so after
  // a regenerate the browser would serve the STALE bytes without a changing query.
  // The /repo route strips the query, so this only busts the client cache.
  return `tmp/asset_pipeline/${jobId}/${file}?v=${Math.floor(statSync(abs).mtimeMs)}`;
}

// Size + generated-at fingerprint for a job GLB, shown under the review viewer so
// the operator can VERIFY a regenerate produced a new candidate (same-prompt
// re-rolls look deliberately similar; the fingerprint is the ground truth).
function glbMeta(jobId, file) {
  const abs = join(JOBS_ROOT, jobId, file);
  if (!existsSync(abs)) return null;
  const st = statSync(abs);
  return { bytes: st.size, mtime: Math.floor(st.mtimeMs) };
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
  const hasTexture = job.steps?.texture?.status === 'done';
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
    // Live-viewer GLBs: the wizard renders these in the operator's real browser,
    // so review works with no headless Chrome (previews above may be empty then).
    // The model view prefers the textured build ONLY when the ledger says the
    // texture step is done: a leftover textured.glb from a previous round (its
    // ledger entry cleared by --redo generate) must not mask a fresh model.
    modelGlb: (hasTexture ? jobGlb(id, 'textured.glb') : null) ?? jobGlb(id, 'raw.glb'),
    finalGlb: job.name ? jobGlb(id, `${job.name}.glb`) : null,
    modelMeta: (hasTexture ? glbMeta(id, 'textured.glb') : null) ?? glbMeta(id, 'raw.glb'),
    finalMeta: job.name ? glbMeta(id, `${job.name}.glb`) : null,
    textured: hasTexture,
    generateTask: (hasTexture ? job.tasks?.texture : null) ?? job.tasks?.generate ?? null,
    log: tail,
  };
}

export function isLaneSupported(lane) {
  return LANES.has(lane);
}
