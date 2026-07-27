// Generate a 3D armor set from a concept image, then segment it into parts.
// image-to-model runs on v3 (P1 low-poly, textured); segmentation runs on the
// v2 endpoint (mesh_segmentation accepts v3 task ids, verified live).
// Usage: node gen_set.mjs <concept.png> <name>
// Writes work/<name>_set_raw.glb (whole) + work/<name>_set_parts.glb (segmented).
import {
  generateModel,
  download,
  getTask,
} from '../lib/tripo.mjs';

process.loadEnvFile('.env');
const KEY = process.env.TRIPO_API_KEY;
const [concept, name] = process.argv.slice(2);
const DIR = 'tmp/asset_pipeline/armor_picker';

console.log(`[${name}] image-to-model...`);
const { taskId, task } = await generateModel({
  image: concept,
  faceLimit: 12000,
  onTaskCreated: (id) => console.log(`[${name}] model task ${id}`),
  onProgress: (p) => process.stdout.write(`\r[${name}] model ${p}%   `),
});
console.log();
const rawUrl = task.output?.model_url ?? task.output?.model_urls?.[0];
await download(rawUrl, `${DIR}/work/${name}_set_raw.glb`);
console.log(`[${name}] raw downloaded`);

// v2 segmentation on the v3 model task id.
async function v2(path, init) {
  const res = await fetch(`https://api.tripo3d.ai/v2/openapi${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`v2 ${path}: HTTP ${res.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j.data;
}
const seg = await v2('/task', {
  method: 'POST',
  body: JSON.stringify({ type: 'mesh_segmentation', original_model_task_id: taskId }),
});
console.log(`[${name}] segmentation task ${seg.task_id}`);
let segTask;
for (;;) {
  segTask = await v2(`/task/${seg.task_id}`);
  if (['success', 'failed', 'banned', 'expired', 'cancelled'].includes(segTask.status)) break;
  await new Promise((r) => setTimeout(r, 4000));
}
if (segTask.status !== 'success') {
  console.log(JSON.stringify(segTask, null, 2).slice(0, 1500));
  throw new Error(`segmentation ${segTask.status}`);
}
const out = segTask.output ?? {};
console.log(`[${name}] segmentation output keys: ${Object.keys(out).join(',')}`);
const segUrl = out.pbr_model ?? out.model ?? out.model_url ?? out.model_urls?.[0];
if (!segUrl) throw new Error(`no model url in segmentation output: ${JSON.stringify(out).slice(0, 500)}`);
await download(segUrl, `${DIR}/work/${name}_set_parts.glb`);
const detail = await getTask(taskId);
console.log(
  `[${name}] DONE parts downloaded; model credits: ${detail?.credits_consumed ?? '?'}, seg credits: ${segTask.credits_consumed ?? '?'}`,
);
