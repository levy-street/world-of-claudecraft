// Roach King art source pipeline. P2 meshes, Tripo bind rigs, Blender-authored clips.
// Run with --env-file=<local .env> before this script. Never prints credentials.
// node scripts/roach_king_assets.mjs <name> <concept.png>
// Resume the same command after an observation timeout; paid task ids are durable.
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Job } from './asset_pipeline/lib/job.mjs';
import * as tripo from './asset_pipeline/lib/tripo.mjs';

const ASSETS = {
  asmon_hermit: { rigType: 'biped', faces: 7500 },
  roach_king: { rigType: 'hexapod', faces: 6500 },
  roachling: { rigType: 'hexapod', faces: 2500 },
  garbage_beetle: { rigType: 'hexapod', faces: 3500 },
};
const [name, image] = process.argv.slice(2);
const spec = ASSETS[name];
if (!spec || !image) throw new Error('Usage: roach_king_assets.mjs <asset name> <concept.png>');
const job = Job.open({ job: `roach_${name}_p2`, kind: 'creature', name, create: true });
job.set('kind', 'creature');
job.set('name', name);
job.set('generationModel', 'P2-20260801');
job.set('animationAuthoring', 'Blender, scripts/assets/animate_roach_king.py');
const progress = (p, status) => job.log(`${name}: ${status} ${p}%`);
await job.step('concept', async () => {
  copyFileSync(resolve(image), job.path('concept.png'));
  return { conceptPath: job.path('concept.png') };
});
const gen = await job.step('generate', async () => {
  let taskId = job.state.tasks?.generate;
  let task;
  if (taskId) {
    task = await tripo.pollTask(taskId, { onProgress: progress });
  } else {
    const result = await tripo.generateModel({
      image: job.path('concept.png'),
      model: 'P2-20260801',
      faceLimit: spec.faces,
      onTaskCreated: (id) => job.noteTask('generate', id),
      onProgress: progress,
    });
    taskId = result.taskId;
    task = result.task;
  }
  const url = task.output?.model_url;
  if (!url) throw new Error(`Generation has no model_url: ${Object.keys(task.output ?? {})}`);
  await tripo.download(url, job.path('raw.glb'));
  return { taskId, raw: job.path('raw.glb') };
});
await job.step('rig', async () => {
  let rigTaskId = job.state.tasks?.rig;
  let task;
  if (rigTaskId) {
    task = await tripo.pollTask(rigTaskId, { onProgress: progress });
  } else {
    const result = await tripo.rigModel({
      modelTaskId: gen.taskId,
      rigType: spec.rigType,
      onTaskCreated: (id) => job.noteTask('rig', id),
      onProgress: progress,
    });
    rigTaskId = result.rigTaskId;
    task = result.task;
  }
  // Rig output varies between the two rig versions. Record keys, never expiring URLs.
  job.log(`rig output keys: ${Object.keys(task.output ?? {}).join(', ')}`);
  const output = task.output ?? {};
  const url = output.model_url ?? output.rigged_model_url ?? output.model;
  if (typeof url !== 'string') throw new Error('Rig output has no downloadable GLB');
  await tripo.download(url, job.path('rigged.glb'));
  return { rigTaskId, rigType: spec.rigType, path: job.path('rigged.glb') };
});
if (!existsSync(job.path('rigged.glb'))) throw new Error('Rig artifact missing');
job.log(`Ready for Blender: ${job.path('rigged.glb')}`);
