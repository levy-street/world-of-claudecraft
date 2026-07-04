// Resumable job state for the asset pipeline. Every generation run gets a job
// directory under tmp/asset_pipeline/<job-id>/ holding job.json (the step
// ledger), downloaded artifacts, previews, and a log. Re-running a command with
// --job <id> resumes: steps whose ledger entry is complete are skipped, and the
// expensive generate/rig stages reconnect to their recorded task id when a run
// died mid-poll (ids are recorded before polling starts), so a crash almost
// never re-pays. Residual exposure: an individual retarget task interrupted
// mid-poll re-runs on resume (10 credits; its id is still recorded for manual
// recovery via the tasks map).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './env.mjs';

export const JOBS_ROOT = resolve(REPO_ROOT, 'tmp/asset_pipeline');

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export class Job {
  constructor(id) {
    // Slug unconditionally so every entry path (including status --job with a
    // raw operator string) stays inside JOBS_ROOT.
    this.id = slug(id);
    this.dir = join(JOBS_ROOT, this.id);
    mkdirSync(this.dir, { recursive: true });
    this.file = join(this.dir, 'job.json');
    this.state = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, 'utf8'))
      : { id: this.id, createdAt: new Date().toISOString(), steps: {} };
  }

  /** Open an existing job or create a new one named after the asset. */
  static open({ job, kind, name, create = false }) {
    if (job) {
      const id = slug(job);
      // `create` (the web wizard's --new-job) lets a caller pass an EXPLICIT,
      // deterministic job id and create it if missing; the bare --job path still
      // requires an existing job so a mistyped CLI id errors instead of forking.
      if (!create && !existsSync(join(JOBS_ROOT, id, 'job.json'))) {
        throw new Error(`job "${id}" not found under tmp/asset_pipeline/`);
      }
      return new Job(id);
    }
    const id = `${slug(kind)}_${slug(name)}_${Date.now().toString(36)}`;
    return new Job(id);
  }

  path(rel) {
    return join(this.dir, rel);
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    writeFileSync(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  set(key, value) {
    this.state[key] = value;
    this.save();
  }

  log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try {
      writeFileSync(this.path('job.log'), `${line}\n`, { flag: 'a' });
    } catch {
      // Logging must never break the pipeline.
    }
  }

  /** Run a step once. A completed ledger entry short-circuits (resume); the
   *  produced value is persisted in the ledger and returned on both paths.
   *  Steps must return JSON-serializable values that fully describe their
   *  output (paths, task ids), never live handles. */
  async step(name, fn) {
    const entry = this.state.steps[name];
    if (entry?.status === 'done') {
      this.log(`step ${name}: already complete (resume), skipping`);
      return entry.result;
    }
    this.log(`step ${name}: starting`);
    this.state.steps[name] = { status: 'running', startedAt: new Date().toISOString() };
    this.save();
    try {
      const result = await fn();
      this.state.steps[name] = {
        status: 'done',
        finishedAt: new Date().toISOString(),
        result: result ?? null,
      };
      this.save();
      this.log(`step ${name}: done`);
      return result;
    } catch (err) {
      this.state.steps[name] = {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: String(err?.message ?? err),
      };
      this.save();
      throw err;
    }
  }

  /** Record a Tripo task id under a step BEFORE polling, so an interrupted run
   *  can be inspected (and the task's spend accounted) even if the process dies. */
  noteTask(label, taskId) {
    this.state.tasks ??= {};
    this.state.tasks[label] = taskId;
    this.save();
  }

  /** Drop steps from the ledger so a resumed run re-executes them (the --redo
   *  flag). Paid steps re-pay: use for parameter or code changes, not retries
   *  of transient failures (failed steps already re-run automatically).
   *  The steps' recorded Tripo task ids are dropped too: reconnectTask exists
   *  for crash recovery, and keeping a cleared step's task id would silently
   *  resurrect the OLD output instead of re-running with the new parameters
   *  (verified: a --redo generate re-downloaded the same model). */
  clearSteps(names) {
    for (const name of names) {
      for (const key of Object.keys(this.state.steps)) {
        if (key === name || key.startsWith(`${name}_`)) delete this.state.steps[key];
      }
      for (const key of Object.keys(this.state.tasks ?? {})) {
        if (key === name || key.startsWith(`${name}_`)) {
          // Archive rather than forget: the superseded task consumed real
          // credits, and the QA cost report must still account for it.
          this.state.tasksSuperseded ??= [];
          this.state.tasksSuperseded.push({ label: key, taskId: this.state.tasks[key] });
          delete this.state.tasks[key];
        }
      }
    }
    this.save();
  }
}
