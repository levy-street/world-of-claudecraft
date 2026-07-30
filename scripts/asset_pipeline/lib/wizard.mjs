// Web-wizard backend for the live asset library (library --serve). Drives the
// existing pipeline CLI step by step as a child process, so an operator can
// generate an asset from scratch in the browser: text -> model (review, keep or
// regenerate) -> animations/finish (review) -> save. Long Tripo stages run in a
// detached-ish child while the browser polls status; only ONE child per job runs
// at a time. Nothing here talks to Tripo directly: it spawns pipeline.mjs with
// --until / --redo / --apply and reads the job dir the pipeline already writes.
import { execFile, spawn } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { REPO_ROOT } from './env.mjs';
import { removeWeapon } from './integrate.mjs';
import { JOBS_ROOT } from './job.mjs';

const execFileAsync = promisify(execFile);

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
  // Mirror Job.open's id shape so status/artifact lookups line up. safeName the
  // WHOLE id, not just the name: the pipeline child slugs its --job value to 40
  // chars (Job -> slug), so a long name plus the lane prefix pushing past 40 chars
  // made the child write raw.glb to the 40-char dir while the wizard tracked the
  // full (41+ char) dir. The browser then polled a dir that never got a model and
  // showed "No model rendered" even though generation succeeded. Slugging the full
  // id here keeps the id the wizard hands out identical to the one the pipeline uses.
  return safeName(`${lane}_${safeName(name)}`);
}

// ---------------------------------------------------------------------------
// Model workflow: update-in-place (uncompressed) + compress-and-export.
// A model is kept UNCOMPRESSED through review/animation; compression happens
// only at export, into a clean handoff folder outside the repo.
// ---------------------------------------------------------------------------

// Native macOS "choose file" dialog -> absolute path, or null if the operator
// cancels. Async (execFile) so it never blocks the server's event loop while
// the dialog is open.
async function pickGlbNative(prompt) {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      `set theFile to choose file with prompt ${JSON.stringify(prompt)}`,
      '-e',
      'POSIX path of theFile',
    ]);
    return stdout.trim() || null;
  } catch {
    return null; // Cancel exits osascript non-zero -> treat as "no pick".
  }
}

/** Step 5, "Update Model": replace a model's working .glb with a newer file the
 *  operator picks from disk (e.g. the Blender-animated export). Copied in place
 *  and left UNCOMPRESSED; compression is deferred to export. */
export async function updateModel(body) {
  const repoGlb = String(body?.repoGlb ?? '');
  if (!repoGlb.endsWith('.glb')) return { ok: false, error: 'no target model' };
  const target = resolve(REPO_ROOT, repoGlb);
  if (!existsSync(target)) return { ok: false, error: 'target model missing' };
  const picked = await pickGlbNative('Choose the new .glb to replace this model');
  if (!picked) return { ok: false, error: 'canceled' };
  if (!picked.toLowerCase().endsWith('.glb')) return { ok: false, error: 'pick a .glb file' };
  if (!existsSync(picked)) return { ok: false, error: 'picked file not found' };
  copyFileSync(picked, target);
  return { ok: true, picked, updated: repoGlb, bytes: statSync(target).size };
}

const WOC_ASSETS_DIR = join(homedir(), 'Documents', 'WOC Assets');

/** Step 6, "Compress & Export": encode the working model to game format and
 *  write a clean, neatly-named copy to ~/Documents/WOC Assets for handoff.
 *  ANIMATED models keep their animation (WebP textures only; meshopt's
 *  quantization bakes node transforms that fight translation animation); STATIC
 *  models get the full meshopt + WebP game encode. Reveals the file in Finder. */
export async function compressExport(body) {
  const repoGlb = String(body?.repoGlb ?? '');
  if (!repoGlb.endsWith('.glb')) return { ok: false, error: 'no model' };
  const src = resolve(REPO_ROOT, repoGlb);
  if (!existsSync(src)) return { ok: false, error: 'model missing' };
  const name = safeName(body?.name) || safeName(basename(repoGlb, '.glb')) || 'weapon';

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(src);
  const animated = doc.getRoot().listAnimations().length > 0;

  let sharp = null;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // sharp unavailable: keep original textures rather than failing the export.
  }
  const hasAlpha = doc
    .getRoot()
    .listMaterials()
    .some((m) => m.getAlphaMode() !== 'OPAQUE');
  const steps = [prune(), dedup()];
  if (sharp) {
    // CORE glTF texture formats only (JPEG + PNG) so the model shows textured in
    // ANY viewer, Blender included. (WebP was the bug: it lives under an
    // extension with no fallback, so viewers without it render untextured.)
    // Color/data maps -> JPEG (small, no alpha needed); the normal map stays
    // lossless PNG (JPEG's chroma subsampling corrupts normals) but is
    // downscaled to keep the handoff file small. Base color stays PNG when the
    // material uses alpha, since JPEG has no alpha channel.
    const jpegSlots = hasAlpha
      ? /metallicRoughness|occlusion|emissive/i
      : /baseColor|metallicRoughness|occlusion|emissive/i;
    const pngSlots = hasAlpha ? /baseColor|normal/i : /normal/i;
    steps.push(
      textureCompress({
        encoder: sharp,
        targetFormat: 'jpeg',
        quality: 85,
        resize: [512, 512],
        slots: jpegSlots,
      }),
    );
    steps.push(
      textureCompress({ encoder: sharp, targetFormat: 'png', resize: [256, 256], slots: pngSlots }),
    );
  }
  if (!animated) {
    if (MeshoptEncoder.ready) await MeshoptEncoder.ready;
    steps.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  }
  await doc.transform(...steps);

  mkdirSync(WOC_ASSETS_DIR, { recursive: true });
  const exportPath = join(WOC_ASSETS_DIR, `${name}.glb`);
  await io.write(exportPath, doc);

  // Companion USDZ so the asset previews WITH TEXTURES in macOS Quick Look /
  // Preview, which render .glb untextured (bare chrome) but .usdz natively.
  // Non-fatal: the .glb is the real game-pipeline handoff file.
  let usdzPath = null;
  try {
    const { glbToUsdz } = await import('./usdz.mjs');
    usdzPath = exportPath.replace(/\.glb$/i, '.usdz');
    await glbToUsdz(exportPath, usdzPath);
  } catch (err) {
    console.error('[export] USDZ companion failed:', err.message ?? err);
    usdzPath = null;
  }

  try {
    await execFileAsync('open', ['-R', exportPath]); // reveal in Finder for handoff
  } catch {
    // non-fatal: the file is written regardless of Finder reveal.
  }

  return {
    ok: true,
    exportPath,
    usdzPath,
    animated,
    format: animated ? 'JPEG/PNG textures, animation-safe' : 'meshopt geometry + JPEG/PNG textures',
    sizeBefore: statSync(src).size,
    sizeAfter: statSync(exportPath).size,
    usdzBytes: usdzPath ? statSync(usdzPath).size : null,
  };
}

/** Reveal an asset's file in the macOS Finder so the operator can drag it
 *  straight into Blender. Takes the repo-relative path the viewer already holds
 *  (a weapon/model .glb, or a skin's texture atlas); contains it to the repo,
 *  then `open -R`s it (selects the file in its folder). Read-only: it only
 *  opens a Finder window, the same reveal `compressExport` does after export. */
export async function revealAsset(body) {
  const rel = String(body?.path ?? '').split('?')[0];
  if (!rel) return { ok: false, error: 'no file to reveal' };
  const abs = resolve(REPO_ROOT, rel);
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + sep)) {
    return { ok: false, error: 'path is outside the repo' };
  }
  if (!existsSync(abs)) return { ok: false, error: 'file not found on disk' };
  try {
    await execFileAsync('open', ['-R', abs]);
    return { ok: true, revealed: rel };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  }
}

/** Spawn one pipeline invocation for a job and stream its output to
 *  <jobdir>/wizard.out. Resolves when the child exits (the caller does not wait
 *  on it: the HTTP handler returns immediately and the browser polls status). */
function spawnStep(jobId, args, phase) {
  // Canonicalize to the exact id the pipeline child will use (its Job slugs the
  // --job value to 40 chars). The running-map key, the wizard.out dir and the
  // status lookups in wizardStatus (which also safeName the id) must all key off
  // THIS id, or a long-named job's progress/output is tracked under a dir the
  // child never writes to and status reports running:false on the first poll.
  jobId = safeName(jobId);
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
export const WEAPON_FAMILIES = [
  'sword',
  'dagger',
  'axe',
  'hammer',
  'mace',
  'staff',
  'wand',
  'polearm',
  'book',
  'crossbow',
  'bow',
];
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
    if (
      /^https?:\/\/\S+$/.test(img) ||
      /^(task_|file_)[\w-]+$/.test(img) ||
      (img.startsWith('/') && /\.(png|jpe?g|webp)$/i.test(img))
    )
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

/** Import an EXISTING .glb (no concept/generate, no Tripo spend): runs the lane
 *  with --model-file so it normalizes, icons and previews the supplied mesh into
 *  a reviewable job; then the operator reviews and saves it like any generated
 *  asset. */
export function importModel({ lane, name, family, modelFile }) {
  if (!LANES.has(lane)) throw new Error(`unsupported lane: ${lane}`);
  const key = safeName(name);
  if (!key) throw new Error('name required');
  const file = String(modelFile ?? '').trim();
  if (!file) throw new Error('a .glb file path is required');
  if (!/\.glb$/i.test(file)) throw new Error('the model file must be a .glb');
  if (!existsSync(file)) throw new Error(`file not found: ${file}`);
  const jobId = jobIdFor(lane, key);
  const args = [lane, '--name', key, '--job', jobId, '--new-job', '--model-file', file];
  if (lane === 'weapon' && WEAPON_FAMILY_SET.has(family)) args.push('--family', family);
  spawnStep(jobId, args, 'import');
  return { jobId };
}

/** The generation-job id whose recorded asset name matches `name`, or null.
 *  Skips `_`-prefixed dirs (reserved) and unreadable jobs. */
function findJobByName(name) {
  if (!existsSync(JOBS_ROOT)) return null;
  for (const id of readdirSync(JOBS_ROOT)) {
    if (id.startsWith('_')) continue;
    const f = join(JOBS_ROOT, id, 'job.json');
    if (!existsSync(f)) continue;
    try {
      if ((JSON.parse(readFileSync(f, 'utf8')).name ?? id) === name) return id;
    } catch {
      // ignore an unreadable job
    }
  }
  return null;
}

/** Permanently delete a GENERATED/IMPORTED asset and free its name: removes the
 *  public GLB + icon, the generation job dir, and the asset's registry entries.
 *  Fails CLOSED: an asset with no generation job (every shipped/base weapon) is
 *  not deletable here, so this can never remove hand-authored content. Also
 *  refuses while a step is running for the job. Returns the action lines. */
export function deleteAsset({ key, jobId }) {
  const name = safeName(key);
  if (!name) throw new Error('key required');
  // Resolve the backing job: the caller's id if valid, else by matching name.
  let job = jobId ? safeName(jobId) : null;
  if (job && !existsSync(join(JOBS_ROOT, job, 'job.json'))) job = null;
  if (!job) job = findJobByName(name);
  if (!job) {
    throw new Error(
      `"${name}" has no generation job; only generated or imported assets can be deleted`,
    );
  }
  if (running.has(job)) {
    throw new Error('a step is running for this asset; stop it before deleting');
  }

  const actions = [];
  const glb = resolve(REPO_ROOT, `public/models/weapons/${name}.glb`);
  if (existsSync(glb)) {
    rmSync(glb);
    actions.push(`deleted public/models/weapons/${name}.glb`);
  }
  const icon = resolve(REPO_ROOT, `public/ui/weapons/${name}.jpg`);
  if (existsSync(icon)) {
    rmSync(icon);
    actions.push(`deleted public/ui/weapons/${name}.jpg`);
  }
  const jobDir = join(JOBS_ROOT, job);
  if (existsSync(jobDir)) {
    rmSync(jobDir, { recursive: true, force: true });
    actions.push(`deleted generation job ${job}`);
  }
  actions.push(...removeWeapon({ key: name }));
  return { actions };
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
