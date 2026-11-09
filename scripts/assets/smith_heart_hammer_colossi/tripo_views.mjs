// Tripo P2 multiview for one statue's job folder: reads views/front.png, views/right.png and
// views/back.png (split_views.mjs) and writes raw.glb and job.json. The paid task id lands in
// job.json the moment it exists, so a rerun after a crash resumes that task and never pays twice.
// The key comes from the repo-root .env like every pipeline command (asset_pipeline/lib/env.mjs).
//   node scripts/assets/smith_heart_hammer_colossi/tripo_views.mjs tmp/hammer_colossi/<name> [faceLimit=12000]
import fs from 'node:fs';
import path from 'node:path';
import * as tripo from '../../asset_pipeline/lib/tripo.mjs';

if (!process.argv[2]) throw new Error('usage: tripo_views.mjs <jobDir> [faceLimit]');
const dir = path.resolve(process.argv[2]);
const faceLimit = Number(process.argv[3] ?? 12000);
const ledger = path.join(dir, 'job.json');
const job = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : {};
let task;
if (job.taskId) {
  console.log('resuming', job.taskId);
  task = await tripo.pollTask(job.taskId, {});
} else {
  const views = {};
  for (const view of ['front', 'right', 'back'])
    views[view] = path.join(dir, 'views', `${view}.png`);
  ({ task } = await tripo.generateModelFromViews({
    views,
    model: tripo.MODEL_P2,
    faceLimit,
    textureSize: 1024,
    textureQuality: 'standard',
    pbr: true,
    onTaskCreated: (id) => {
      Object.assign(job, { taskId: id, model: tripo.MODEL_P2, faceLimit });
      fs.writeFileSync(ledger, JSON.stringify(job, null, 2));
      console.log('task', id);
    },
  }));
}
const out = task.output ?? {};
const url = out.pbr_model_url ?? out.pbr_model ?? out.model_url ?? out.model;
if (!url) throw new Error(`task ${job.taskId} ended ${task.status} with no model`);
await tripo.download(url, path.join(dir, 'raw.glb'));
Object.assign(job, { status: task.status, credits: task.credits_consumed ?? null });
fs.writeFileSync(ledger, JSON.stringify(job, null, 2));
console.log(task.status, 'credits', job.credits);
