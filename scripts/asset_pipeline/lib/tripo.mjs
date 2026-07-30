// Tripo v3 API client (https://developers.tripo3d.ai). Plain fetch, no deps.
//
// Facts this client encodes (verified against the live API + docs, July 2026):
// - Base https://openapi.tripo3d.ai/v3, header `Authorization: Bearer <key>`.
// - Task creation returns {code:0, data:{task_id}}; poll GET /tasks/{id} until
//   status success|failed|banned|expired|cancelled. Poll <= 1 req/s.
// - Output URLs (model_url/model_urls/rendered_image_url) EXPIRE in ~5 minutes:
//   download immediately, never persist a URL.
// - Retry HTTP 429 and 5xx with backoff (honor Retry-After / X-RateLimit-Reset);
//   never retry 400/401/403. Credits freeze on create, refund on failure.
// - Retarget input must be the RIG task id, animations arrays cap at 5 per task.
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tripoKey } from './env.mjs';

export const TRIPO_BASE = 'https://openapi.tripo3d.ai/v3';

// Generation model ids (pin dated forms, aliases drift).
export const MODEL_LOWPOLY = 'P1-20260311'; // low-poly game specialist
export const MODEL_HIFI = 'v3.1-20260211'; // flagship H-series
export const RIG_MODEL_BIPED = 'v1.0-20240301'; // biped only, 90+ preset:biped:* clips
export const RIG_MODEL_ALL = 'v2.5-20260210'; // all rig types, small preset set

const MAX_RETRIES = 5;
const POLL_INTERVAL_MS = 2000;
const DEFAULT_TASK_TIMEOUT_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Low-level request with retry/backoff. Returns the parsed `data` payload.
 *  `idempotent: false` (task-creating POSTs) retries only rate/concurrency
 *  429s, never 5xx: a 5xx after server-side creation would double-create a
 *  PAID task. Failed creations are safe to re-run manually (job resume). */
async function request(path, { method = 'GET', body, form, idempotent = method === 'GET' } = {}) {
  const url = `${TRIPO_BASE}${path}`;
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${tripoKey()}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: form ?? (body ? JSON.stringify(body) : undefined),
      });
    } catch (err) {
      // Network error. For a non-idempotent (task-creating) POST the request
      // may have reached the server, so retrying could double-create a paid
      // task: fail instead and let the job-ledger resume path recover.
      if (!idempotent) {
        throw new Error(`${method} ${path} network error (not retried, task may exist): ${err}`);
      }
      lastErr = err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (res.ok && json && json.code === 0) return json.data;

    const code = json?.code;
    const msg = `${method} ${path} -> HTTP ${res.status} code ${code ?? '?'}: ${
      json?.message ?? text.slice(0, 200)
    }${json?.suggestion ? ` (${json.suggestion})` : ''}`;
    // Never retry client errors other than rate/concurrency limits; retry 5xx
    // only when the call is idempotent (see docstring).
    if (res.status === 429 || (res.status >= 500 && idempotent)) {
      // Header absence must fall through to exponential backoff: Number(null)
      // is 0, which would retry with zero delay and hammer the rate limit.
      const retryAfterRaw = res.headers.get('retry-after');
      const retryAfter = retryAfterRaw === null ? NaN : Number(retryAfterRaw);
      const resetAtRaw = res.headers.get('x-ratelimit-reset');
      const resetAt = resetAtRaw === null ? NaN : Number(resetAtRaw);
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Number.isFinite(resetAt) && resetAt > 0
            ? Math.max(1000, resetAt * 1000 - Date.now())
            : 1000 * 2 ** attempt;
      lastErr = new Error(msg);
      await sleep(Math.min(waitMs, 30_000));
      continue;
    }
    throw new Error(msg);
  }
  throw new Error(`Tripo request failed after ${MAX_RETRIES} attempts: ${lastErr?.message}`);
}

export async function balance() {
  return request('/account/balance');
}

/** Fetch one task's detail (status, credits_consumed, output). Used by the QA
 *  cost report to price each recorded task id. */
export async function getTask(taskId) {
  return request(`/tasks/${taskId}`);
}

/** Upload a local image or model file; returns a file_token string. */
export async function uploadFile(path) {
  const buf = await readFile(path);
  const name = path.split('/').pop();
  const type = name.endsWith('.png')
    ? 'image/png'
    : /\.jpe?g$/.test(name)
      ? 'image/jpeg'
      : name.endsWith('.webp')
        ? 'image/webp'
        : 'application/octet-stream';
  const form = new FormData();
  form.append('file', new Blob([buf], { type }), name);
  // Uploads are free and duplicate-tolerant, so full retry is safe.
  const data = await request('/files', { method: 'POST', form, idempotent: true });
  if (!data?.file_token) throw new Error(`upload of ${name} returned no file_token`);
  return data.file_token;
}

/** Create a task at `path` and return its task_id. */
export async function createTask(path, body) {
  const data = await request(path, { method: 'POST', body });
  if (!data?.task_id) throw new Error(`${path} returned no task_id`);
  return data.task_id;
}

/** Poll a task to a terminal state. Returns the full task detail on success;
 *  throws (with the server's error detail) on failed/banned/expired/cancelled. */
export async function pollTask(taskId, { timeoutMs = DEFAULT_TASK_TIMEOUT_MS, onProgress } = {}) {
  const started = Date.now();
  let lastProgress = -1;
  for (;;) {
    const task = await request(`/tasks/${taskId}`);
    const { status, progress } = task;
    if (progress !== lastProgress && onProgress) {
      onProgress(progress ?? 0, status);
      lastProgress = progress;
    }
    if (status === 'success') return task;
    if (['failed', 'banned', 'expired', 'cancelled'].includes(status)) {
      const detail = task.error ? ` ${JSON.stringify(task.error)}` : '';
      throw new Error(`Tripo task ${taskId} (${task.type}) ${status}${detail}`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Tripo task ${taskId} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Download a (short-lived) output URL to disk. Verifies non-empty output and,
 *  for .glb destinations, the GLB magic bytes. */
export async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  // Abort a hung connection rather than stalling the pipeline indefinitely.
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) {
    throw new Error(`download failed (HTTP ${res.status}); output URLs expire in ~5 minutes`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const size = (await stat(dest)).size;
  if (size === 0) throw new Error(`downloaded ${dest} is empty`);
  if (dest.endsWith('.glb')) {
    const head = Buffer.alloc(4);
    const fh = await import('node:fs/promises').then((m) => m.open(dest, 'r'));
    try {
      await fh.read(head, 0, 4, 0);
    } finally {
      await fh.close();
    }
    if (head.toString('latin1') !== 'glTF') {
      throw new Error(`downloaded ${dest} is not a GLB (bad magic)`);
    }
  }
  return { dest, size };
}

// ---------------------------------------------------------------------------
// High-level flows
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the string is a Tripo task or file reference (live ids are bare
 *  UUIDs; docs also show task_/file_ prefixed forms). */
export function isTripoRef(s) {
  return /^(task_|file_)/.test(s) || UUID_RE.test(s);
}

/** Resolve an image argument into the `input` string the API accepts:
 *  a local file path is uploaded (file_token); URLs and task ids pass through. */
export async function resolveImageInput(image) {
  if (/^https?:\/\//.test(image) || isTripoRef(image)) return image;
  return uploadFile(image);
}

/** Generate a 3D model from an image (preferred) or a text prompt.
 *  Returns {taskId, task} with task.output.{model_url,rendered_image_url}. */
export async function generateModel({
  image,
  prompt,
  model = MODEL_LOWPOLY,
  faceLimit,
  texture = true,
  pbr = true,
  smartLowPoly = false,
  onProgress,
  onTaskCreated,
}) {
  // smart_low_poly (clean hand-crafted topology, +10 credits) is an H-series
  // (>= v3.0) option; P1 is already a low-poly specialist and rejects it.
  const extras = {
    ...(faceLimit ? { face_limit: faceLimit } : {}),
    ...(smartLowPoly && !model.startsWith('P1') ? { smart_low_poly: true } : {}),
    texture,
    pbr,
  };
  let taskId;
  if (image) {
    const input = await resolveImageInput(image);
    taskId = await createTask('/generation/image-to-model', { input, model, ...extras });
  } else if (prompt) {
    taskId = await createTask('/generation/text-to-model', {
      prompt: prompt.slice(0, 1024),
      model,
      ...extras,
    });
  } else {
    throw new Error('generateModel needs an image or a prompt');
  }
  onTaskCreated?.(taskId);
  const task = await pollTask(taskId, { onProgress });
  return { taskId, task };
}

/** Re-texture an existing model from a text (or image) prompt. Returns
 *  {taskId, task} with task.output.model_url (a re-textured GLB). Used to test
 *  whether Tripo can paint a new skin onto a class model while keeping its UVs. */
export async function textureModel({
  input,
  prompt,
  styleImage,
  model = 'v3.0-20250812',
  pbr = true,
  textureQuality = 'detailed',
  onProgress,
  onTaskCreated,
}) {
  const resolved = existsSync(input) ? await uploadFile(input) : await resolveImageInput(input);
  const body = { input: resolved, model, pbr, texture_quality: textureQuality, bake: true };
  if (prompt) body.texture_prompt = { text: prompt.slice(0, 1024) };
  if (styleImage) body.texture_prompt = { image: { file_token: await uploadFile(styleImage) } };
  const taskId = await createTask('/models/texture', body);
  onTaskCreated?.(taskId);
  const task = await pollTask(taskId, { onProgress });
  return { taskId, task };
}

/** Tripo's own text-to-image (concept fallback when OPENAI_API_KEY is absent).
 *  template: 't_pose' (character sheet) | 'asset_extraction' | undefined. */
export async function textToImage({
  prompt,
  template,
  size = '2048x2048',
  onProgress,
  onTaskCreated,
}) {
  const taskId = await createTask('/generation/text-to-image', {
    prompt,
    size,
    ...(template ? { template } : {}),
    output_format: 'png',
  });
  onTaskCreated?.(taskId);
  const task = await pollTask(taskId, { onProgress });
  // The live API returns generated_image_url; some docs say generated_image.
  const url = task.output?.generated_image_url ?? task.output?.generated_image;
  if (!url) {
    throw new Error(
      `text-to-image task ${taskId} returned no image url (output keys: ` +
        `${Object.keys(task.output ?? {}).join(', ')})`,
    );
  }
  return { taskId, url };
}

/** Rig-check (free) then rig. Returns {rigTaskId, rigType, task}.
 *  `onTaskCreated(rigTaskId)` fires right after the PAID rig task is created,
 *  before polling, so a crash-resume can reconnect instead of re-paying. */
export async function rigModel({
  modelTaskId,
  spec = 'tripo',
  rigModel,
  rigType,
  onProgress,
  onTaskCreated,
}) {
  const checkId = await createTask('/animations/rig-check', { input: modelTaskId });
  const check = await pollTask(checkId, { onProgress });
  const riggable = check.output?.riggable;
  const detected = check.output?.rig_type ?? 'biped';
  if (riggable === false) {
    throw new Error(
      `model task ${modelTaskId} is not riggable (rig-check); regenerate with a clearer ` +
        'T-pose / neutral-stance concept image',
    );
  }
  const type = rigType ?? detected;
  const model = rigModel ?? (type === 'biped' ? RIG_MODEL_BIPED : RIG_MODEL_ALL);
  const rigId = await createTask('/animations/rig', {
    input: modelTaskId,
    model,
    rig_type: type,
    spec,
    out_format: 'glb',
  });
  onTaskCreated?.(rigId);
  const task = await pollTask(rigId, { onProgress });
  return { rigTaskId: rigId, rigType: type, rigModelVersion: model, task };
}

/** Retarget preset animations onto a rigged model, ONE TASK PER ANIMATION.
 *
 *  Batched retargets (animations: [...]) return a single GLB whose clips are
 *  named NlaTrack/NlaTrack.001/... with no reliable preset mapping (verified
 *  live), so a mis-ordered batch would silently play Death on Attack. Single
 *  requests cost the same (10 credits per animation) and give one unambiguous
 *  single-clip GLB each. Tasks run concurrently (animation pool is 10; we stay
 *  under it and honor 429s via the request wrapper).
 *  Returns [{preset, url, taskId}] in request order; a rejected preset becomes
 *  {preset, error} instead of aborting the rest. */
export async function retargetAnimations({
  rigTaskId,
  presets,
  inPlace = true,
  onProgress,
  onTaskCreated,
  destFor,
  concurrency = 4,
}) {
  if (!presets.length) return [];
  const results = new Array(presets.length);
  let next = 0;
  const worker = async () => {
    while (next < presets.length) {
      const i = next++;
      const preset = presets[i];
      try {
        const taskId = await createTask('/animations/retarget', {
          input: rigTaskId,
          animation: preset,
          out_format: 'glb',
          bake_animation: true,
          export_with_geometry: true,
          animate_in_place: inPlace,
        });
        onTaskCreated?.(preset, taskId);
        const task = await pollTask(taskId, { onProgress });
        const url = task.output?.model_url ?? task.output?.model_urls?.[0];
        if (!url) throw new Error(`no model_url on retarget task ${taskId}`);
        // Download INSIDE the worker: with several tasks in flight, an early
        // task's output URL (~5 min TTL) would expire while a slow sibling is
        // still polling if downloads waited for the whole batch.
        if (destFor) {
          const dest = destFor(preset);
          await download(url, dest);
          results[i] = { preset, path: dest, taskId };
        } else {
          results[i] = { preset, url, taskId };
        }
      } catch (err) {
        results[i] = { preset, error: String(err.message ?? err) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, presets.length) }, worker));
  if (results.every((r) => r?.error)) {
    throw new Error(`every retarget failed; first error: ${results[0].error}`);
  }
  return results;
}
