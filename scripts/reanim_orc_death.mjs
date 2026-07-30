#!/usr/bin/env node
import { cpSync, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import aws4 from 'aws4';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { tripoKey } from './asset_pipeline/lib/env.mjs';
import { BIPED_CLIP_PLAN } from './asset_pipeline/lib/families.mjs';
import { assembleRiggedModel, inspectGlb } from './asset_pipeline/lib/glb.mjs';
import { Job } from './asset_pipeline/lib/job.mjs';
import * as tripo from './asset_pipeline/lib/tripo.mjs';
import { validateCreature } from './asset_pipeline/lib/validate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CREATURE_DIR = resolve(REPO_ROOT, 'public', 'models', 'creatures');
const TRIPO_V2_BASE = 'https://api.tripo3d.ai/v2/openapi';
const S3_REGION = 'us-west-2';
const DEATH_MAX_SECONDS = 2.6;
const DEATH_MIN_SECONDS = 0.5;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const ORCS = [
  { key: 'black_orc', targetHeight: 2.3 },
  { key: 'blue_orc', targetHeight: 2.4 },
  { key: 'red_orc', targetHeight: 2.6 },
];

const BIPED_PRESETS = Object.fromEntries(BIPED_CLIP_PLAN.map((c) => [c.game, c.presets[0]]));
const DEATH_PRESET = BIPED_PRESETS.Death;
const RETARGET_PLAN = [
  { game: 'Idle', preset: BIPED_PRESETS.Idle },
  { game: 'Walk', preset: BIPED_PRESETS.Walk },
  { game: 'Run', preset: BIPED_PRESETS.Run },
  { game: 'Attack', preset: BIPED_PRESETS.Attack },
  { game: 'Hit', preset: BIPED_PRESETS.Hit },
  { game: 'Death', preset: DEATH_PRESET },
];
const REQUIRED_CLIPS = [
  'Idle_Loop',
  'Walk_Loop',
  'Sprint_Loop',
  'Punch_Jab',
  'Sword_Attack',
  'Hit',
  'Death',
];

const DEATH_TRIM_MAP = [
  { from: 'Idle', to: 'Idle_Loop' },
  { from: 'Walk', to: 'Walk_Loop' },
  { from: 'Run', to: 'Sprint_Loop' },
  { from: 'Attack', to: 'Sword_Attack' },
];

const IO = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

function safePreset(preset) {
  return preset.replace(/[^a-z0-9]+/gi, '_');
}

function isMeshoptUploadError(err) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes('meshopt') || msg.includes('unsupported') || msg.includes('invalid glb');
}

function clipDurationLines(clips) {
  const durations = new Map(clips.map((clip) => [clip.name, clip.duration]));
  return REQUIRED_CLIPS.map((name) => `${name}:${durations.get(name) ?? 'missing'}`).join(', ');
}

function componentStride(type, interpolation) {
  const componentByType = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  };
  const stride = componentByType[type] ?? 1;
  return interpolation === 'CUBICSPLINE' ? stride * 3 : stride;
}

function trimDeathAnimation(doc, maxSeconds) {
  const root = doc.getRoot();
  const death = root.listAnimations().find((anim) => anim.getName() === 'Death');
  if (!death) return { trimmed: false, missing: true };

  const changed = [];
  const eps = 1e-6;

  for (const channel of death.listChannels()) {
    const sampler = channel.getSampler();
    if (!sampler) continue;
    const input = sampler.getInput();
    const output = sampler.getOutput();
    if (!input || !output) continue;

    const times = Array.from(input.getArray());
    const values = Array.from(output.getArray());
    if (!times.length) continue;
    const interp = sampler.getInterpolation() || 'LINEAR';
    const inferredStride = Math.round(values.length / times.length);
    const stride =
      (componentStride(output.getType(), interp) && componentStride(output.getType(), interp) > 0
        ? componentStride(output.getType(), interp)
        : inferredStride) || 1;
    if (!Number.isInteger(stride) || !Number.isInteger(values.length / stride)) {
      changed.push(false);
      continue;
    }

    let end = 0;
    while (end + 1 < times.length && times[end + 1] <= maxSeconds + eps) {
      end++;
    }
    const outTimes = times.slice(0, end + 1);
    const outValues = values.slice(0, (end + 1) * stride);

    if (outTimes[outTimes.length - 1] < maxSeconds - eps && end + 1 < times.length) {
      outTimes.push(maxSeconds);
      const start = end * stride;
      for (let i = 0; i < stride; i++) outValues.push(values[start + i] ?? 0);
    }

    changed.push(true);
    input.setArray(new Float32Array(outTimes));
    output.setArray(new Float32Array(outValues));
  }

  return {
    trimmed: changed.some((flag) => flag),
    missing: false,
  };
}

function animationByName(root, name) {
  return root.listAnimations().find((anim) => anim.getName() === name);
}

function copyAnimation(doc, source, targetName) {
  const target = doc.createAnimation(targetName);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();

  const cloneAccessor = (src) =>
    doc
      .createAccessor(`${src.getName() || targetName}_${Math.random().toString(36).slice(2, 8)}`)
      .setType(src.getType())
      .setArray(src.getArray().slice())
      .setNormalized(src.getNormalized())
      .setBuffer(buffer);

  const samplerMap = new Map();
  for (const sampler of source.listSamplers()) {
    const cloned = doc
      .createAnimationSampler()
      .setInterpolation(sampler.getInterpolation())
      .setInput(cloneAccessor(sampler.getInput()))
      .setOutput(cloneAccessor(sampler.getOutput()));
    samplerMap.set(sampler, cloned);
    target.addSampler(cloned);
  }

  for (const channel of source.listChannels()) {
    const sourceNode = channel.getTargetNode();
    const sampler = samplerMap.get(channel.getSampler());
    if (!sourceNode || !sampler) continue;
    const mapped = root.listNodes().find((node) => node.getName() === sourceNode.getName());
    if (!mapped) continue;
    target.addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(mapped)
        .setTargetPath(channel.getTargetPath())
        .setSampler(sampler),
    );
  }

  return target;
}

function renameAndDuplicateClips(doc) {
  const root = doc.getRoot();

  for (const { from, to } of DEATH_TRIM_MAP) {
    const source = animationByName(root, from);
    const target = animationByName(root, to);

    if (!source) continue;
    if (!target) {
      const copied = copyAnimation(doc, source, to);
      if (!copied) continue;
    }
    if (from !== to) {
      source.dispose();
    }
  }

  const sword = animationByName(root, 'Sword_Attack');
  if (!animationByName(root, 'Punch_Jab') && sword) {
    const duplicate = copyAnimation(doc, sword, 'Punch_Jab');
    if (!duplicate) {
      return;
    }
  }
}

function readBalance(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  return {
    credits: Number(data.balance ?? data.total ?? NaN),
    frozen: Number(data.frozen ?? NaN),
  };
}

function toMap(value) {
  return value instanceof Map ? value : new Map(Object.entries(value ?? {}));
}

async function reconnectTask(job, label, timeoutMs = 5 * 60 * 1000) {
  const prior = job.state.tasks?.[label];
  if (!prior) return null;
  job.log(`step ${label}: reconnecting to task ${prior}`);
  try {
    return await tripo.pollTask(prior, { timeoutMs });
  } catch (err) {
    job.log(`  prior task unusable for ${label}: ${String(err.message).slice(0, 160)}`);
    return null;
  }
}

async function writeUncompressedCopy(src, dst) {
  const doc = await IO.read(src);
  await IO.write(dst, doc);
  return dst;
}

async function uploadSource(job, source) {
  return job.step('upload', async () => {
    try {
      return { token: await tripo.uploadFile(source), source, decompressed: false };
    } catch (err) {
      if (!isMeshoptUploadError(err)) throw err;
      job.log(
        `upload likely failed due meshopt compression (${String(err.message).slice(0, 140)}); ` +
          'writing uncompressed fallback copy first',
      );
      const fallback = job.path('source_uncompressed.glb');
      await writeUncompressedCopy(source, fallback);
      return { token: await tripo.uploadFile(fallback), source: fallback, decompressed: true };
    }
  });
}

async function tripoV2Post(path, body) {
  const res = await fetch(`${TRIPO_V2_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tripoKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`POST ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || json?.code !== 0) {
    const msg = json?.message ?? json?.status ?? 'unknown';
    throw new Error(`POST ${path} -> ${res.status} code ${json?.code}: ${msg}`);
  }
  return json.data;
}

async function requestStsUpload() {
  return tripoV2Post('/upload/sts/token', { format: 'glb' });
}

async function uploadToTripoS3(sts, filePath) {
  const data = await readFile(filePath);
  const host = sts.s3_host;
  const path = `/${sts.resource_bucket}/${sts.resource_uri}`;
  const request = {
    method: 'PUT',
    host,
    path,
    service: 's3',
    region: S3_REGION,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(data.length),
      'x-amz-security-token': sts.session_token,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    },
    body: data,
  };

  aws4.sign(request, {
    accessKeyId: sts.sts_ak,
    secretAccessKey: sts.sts_sk,
  });

  const res = await fetch(`https://${host}${path}`, {
    method: 'PUT',
    headers: {
      ...request.headers,
      Authorization: request.headers.Authorization,
      'X-Amz-Date': request.headers['X-Amz-Date'],
      'x-amz-content-sha256':
        request.headers['x-amz-content-sha256'] ?? request.headers['X-Amz-Content-Sha256'],
    },
    body: data,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upload to Tripo S3 failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function importModelWithSTS(job, source) {
  const prior = await reconnectTask(job, 'import', 5 * 60 * 1000);
  if (prior?.type === 'import_model' && prior.output) {
    return prior.task_id;
  }

  const doImport = async () => {
    const sts = await requestStsUpload();
    await uploadToTripoS3(sts, source);
    const taskId = await tripoV2Post('/task', {
      type: 'import_model',
      file: {
        type: 'model',
        object: { bucket: sts.resource_bucket, key: sts.resource_uri },
      },
    });
    job.noteTask('import', taskId.task_id);
    const imported = await tripo.pollTask(taskId.task_id);
    if (!imported.output) {
      throw new Error(`import task ${taskId.task_id} has no output payload`);
    }
    return imported.task_id;
  };

  return doImport();
}

async function rigModel(job, modelTaskId) {
  return job.step('rig', async () => {
    const prior = await reconnectTask(job, 'rig');
    if (prior?.output?.rig_type) {
      return {
        rigTaskId: job.state.tasks.rig,
        rigType: prior.output?.rig_type ?? 'biped',
        rigModelVersion: prior.output?.rig_model ?? 'reconnected',
      };
    }

    const attempt = async () => {
      const r = await tripo.rigModel({
        modelTaskId,
        rigType: 'biped',
        onProgress: (p, s) => job.log(`  rig ${s} ${p}%`),
        onTaskCreated: (id) => job.noteTask('rig', id),
      });
      return { rigTaskId: r.rigTaskId, rigType: r.rigType, rigModelVersion: r.rigModelVersion };
    };

    return attempt(modelTaskId);
  });
}

async function runRetargetBatch(job, rigTaskId, presets, labelPrefix) {
  const results = await tripo.retargetAnimations({
    rigTaskId,
    presets,
    inPlace: true,
    onProgress: (p, s) => job.log(`  ${labelPrefix} ${s} ${p}%`),
    onTaskCreated: (preset, id) => job.noteTask(`${labelPrefix}_${preset}`, id),
    destFor: (preset) => job.path(`${labelPrefix}_${safePreset(preset)}.glb`),
  });
  const map = new Map();
  for (const item of results) map.set(item.preset, item);
  return map;
}

async function retargetAnimations(job, rigTaskId) {
  return job.step('retarget', async () => {
    const presets = RETARGET_PLAN.map((entry) => entry.preset);
    const first = await runRetargetBatch(job, rigTaskId, presets, 'retarget');
    const deathFirst = first.get(DEATH_PRESET);

    let deathRetried = false;
    if (deathFirst?.error) {
      deathRetried = true;
      job.log(`WARN: Death preset failed first pass (${deathFirst.error}); retrying once`);
      const retry = await runRetargetBatch(job, rigTaskId, [DEATH_PRESET], 'retarget_retry');
      const deathRetry = retry.get(DEATH_PRESET);
      if (deathRetry) first.set(DEATH_PRESET, deathRetry);
    }

    const paths = new Map();
    const failures = [];
    for (const entry of RETARGET_PLAN) {
      const result = first.get(entry.preset);
      if (!result || result.error) {
        failures.push(`${entry.preset}: ${result?.error || 'missing task'}`);
        continue;
      }
      paths.set(entry.preset, result.path);
    }

    const missing = RETARGET_PLAN.filter((entry) => !paths.has(entry.preset));
    if (!paths.size || missing.length) {
      throw new Error(
        `retarget incomplete: ${missing.map((entry) => entry.preset).join(', ') || 'all failed'}`,
      );
    }

    return {
      paths: Object.fromEntries(paths),
      failures,
      deathRetried,
    };
  });
}

async function assembleAnimations(job, retargeted) {
  return job.step('assemble_v2', async () => {
    const clips = [];
    const paths = toMap(retargeted.paths);
    const fallbackPath = (entry) => {
      const base = `${safePreset(entry.preset)}.glb`;
      const direct = paths.get(entry.preset);
      if (direct) return direct;
      const preferred = job.path(`retarget_${base}`);
      if (existsSync(preferred)) return preferred;
      const retry = job.path(`retarget_retry_${base}`);
      if (existsSync(retry)) return retry;
      return undefined;
    };

    for (const entry of RETARGET_PLAN) {
      const path = fallbackPath(entry);
      if (!path) continue;
      for (const game of Array.isArray(entry.game) ? entry.game : [entry.game]) {
        clips.push({ path, preset: entry.preset, game });
      }
    }

    if (!clips.length) throw new Error('No retargeted clips available to assemble');
    const assembledPath = job.path('assembled.glb');
    const added = await assembleRiggedModel(clips[0].path, clips, assembledPath);

    const addedByName = new Map(added.added.map((clip) => [clip.game, clip]));
    const missing = RETARGET_PLAN.filter((entry) => !addedByName.get(entry.game)?.ok);
    if (missing.length) {
      throw new Error(`Assembled GLB missing required clip names: ${missing.join(', ')}`);
    }

    const doc = await IO.read(assembledPath);
    renameAndDuplicateClips(doc);
    await IO.write(assembledPath, doc);

    return { path: assembledPath, added };
  });
}

async function postProcess(job, assembledPath) {
  return job.step('postprocess_v2', async () => {
    const path = job.path('final.glb');
    const doc = await IO.read(assembledPath);
    const trim = trimDeathAnimation(doc, DEATH_MAX_SECONDS);
    if (trim.trimmed) {
      job.log(`trimmed Death clip to ${DEATH_MAX_SECONDS}s`);
    }
    const transforms = [resample(), prune(), dedup()];

    try {
      const sharp = (await import('sharp')).default;
      transforms.push(
        textureCompress({
          encoder: sharp,
          targetFormat: 'webp',
          resize: [512, 512],
        }),
      );
    } catch {
      // no sharp; keep texture compression untouched.
    }

    transforms.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await doc.transform(...transforms);
    await IO.write(path, doc);
    return { path, bytes: statSync(path).size };
  });
}

async function validate(job, orc, finalPath) {
  return job.step('validate_v2', async () => {
    const check = await validateCreature(finalPath, { requiredClips: REQUIRED_CLIPS });
    const reportClipDuration = Object.fromEntries(
      check.report.clips.map((clip) => [clip.name, clip.duration]),
    );

    if (!check.ok) {
      return { ...check, reportClipDuration };
    }

    const deathDuration = reportClipDuration.Death;
    if (deathDuration === undefined) {
      return {
        ...check,
        reportClipDuration,
        ok: false,
        errors: [...check.errors, 'Death clip missing after assembly'],
      };
    }

    if (deathDuration <= DEATH_MIN_SECONDS || deathDuration > DEATH_MAX_SECONDS) {
      return {
        ...check,
        reportClipDuration,
        ok: false,
        errors: [
          ...check.errors,
          `Death clip duration ${deathDuration}s is outside ${DEATH_MIN_SECONDS}-${DEATH_MAX_SECONDS}s range`,
        ],
      };
    }

    const { min, max } = check.report.bounds;
    const height = Number((max[1] - min[1]).toFixed(3));
    const baseY = Number(min[1].toFixed(3));
    if (Math.abs(baseY) > 0.05) {
      return {
        ...check,
        reportClipDuration,
        warnings: [...check.warnings, `base y=${baseY} is not near 0`],
      };
    }
    if (Math.abs(height - orc.targetHeight) > orc.targetHeight * 0.05) {
      return {
        ...check,
        reportClipDuration,
        warnings: [
          ...check.warnings,
          `height ${height} differs from target ${orc.targetHeight} by >5% (no scaling applied)`,
        ],
      };
    }

    return { ...check, reportClipDuration };
  });
}

async function runOrc(orc) {
  const source = join(CREATURE_DIR, `${orc.key}.glb`);
  const job = Job.open({ job: `reanim_orc_death_${orc.key}`, kind: 'orc-reanim', create: true });

  const out = {
    key: orc.key,
    jobId: job.id,
    targetHeight: orc.targetHeight,
    ok: false,
  };

  try {
    if (!existsSync(source)) throw new Error(`Source GLB missing: ${source}`);
    out.originalBytes = statSync(source).size;

    const upload = await uploadSource(job, source);
    const importTaskId = await importModelWithSTS(job, upload.source);
    const rig = await rigModel(job, importTaskId);
    const retarget = await retargetAnimations(job, rig.rigTaskId);
    const assemble = await assembleAnimations(job, retarget);
    const post = await postProcess(job, assemble.path);
    const validation = await validate(job, orc, post.path);
    const finalReport = await inspectGlb(post.path);

    if (!validation.ok) {
      out.validation = validation;
      throw new Error(`validation failed: ${validation.errors.join('; ')}`);
    }

    out.finalBytes = post.bytes;
    out.finalPath = post.path;
    out.upload = upload;
    out.importTaskId = importTaskId;
    out.rigTaskId = rig.rigTaskId;
    out.rigModelVersion = rig.rigModelVersion;
    out.retarget = {
      deathRetried: retarget.deathRetried,
      failures: retarget.failures,
      taskIds: Object.fromEntries(
        Object.entries(job.state.tasks ?? {}).filter(([label]) => label.startsWith('retarget_')),
      ),
    };
    out.validation = validation;
    out.clipLine = clipDurationLines(finalReport.clips);
    out.finalReport = finalReport;
    out.ok = true;
    out.jobTasks = job.state.tasks ?? {};
    return out;
  } catch (err) {
    out.error = String(err.message ?? err);
    out.jobTasks = job.state.tasks ?? {};
    if (!out.validation) {
      out.validation = { ok: false, errors: [out.error], warnings: [] };
    }
    return out;
  }
}

function formatBytes(bytes) {
  return `${Math.round((bytes ?? 0) / 1024)}KB`;
}

const startBalance = readBalance(await tripo.balance());
const results = [];
for (const orc of ORCS) {
  results.push(await runOrc(orc));
}
const endBalance = readBalance(await tripo.balance());

let failed = 0;
console.log('\nPer-orc results:');
for (const r of results) {
  if (!r.ok) {
    failed++;
    console.log(`- ${r.key}: kept old GLB (${formatBytes(r.originalBytes)}) -> ${r.error}`);
    if (r.validation?.errors?.length) {
      console.log(`  errors: ${r.validation.errors.join('; ')}`);
    }
    continue;
  }

  console.log(
    `- ${r.key}: replaced ${formatBytes(r.finalBytes)} (rig ${r.rigTaskId}, ` +
      `death retry ${r.retarget.deathRetried ? 'yes' : 'no'})`,
  );
  console.log(`  rig task: ${r.rigTaskId}`);
  console.log(`  clips: ${r.clipLine}`);
  for (const [label, taskId] of Object.entries(r.retarget.taskIds)) {
    console.log(`  ${label}: ${taskId}`);
  }
  if (r.validation?.warnings?.length) {
    console.log(`  warnings: ${r.validation.warnings.join('; ')}`);
  }
}

console.log('\nValidation summary:');
for (const r of results) {
  if (!r.ok) continue;
  console.log(
    `- ${r.key}: ${r.validation.ok ? 'ok' : 'failed'} (${r.validation.warnings.length} warnings)`,
  );
}

if (results.every((r) => r.ok)) {
  for (const r of results) {
    if (!r.finalPath) continue;
    cpSync(r.finalPath, join(CREATURE_DIR, `${r.key}.glb`));
    r.finalBytes = statSync(join(CREATURE_DIR, `${r.key}.glb`)).size;
  }
}

const delta = startBalance.credits - endBalance.credits;
console.log(
  `\nTripo balance: ${startBalance.credits} -> ${endBalance.credits} credits` +
    ` (${Number.isFinite(delta) ? Math.abs(Math.round(delta)) : '?'} delta) frozen ${startBalance.frozen} -> ${endBalance.frozen}`,
);

process.exit(failed ? 1 : 0);
