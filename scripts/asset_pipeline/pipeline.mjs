// World of ClaudeCraft asset-creation pipeline (Tripo API + optional gpt-image-2).
//
// Generates game-ready assets that match the shipped conventions exactly:
// weapons (grip-at-origin variant GLB + HUD icon + registry wiring), props
// (base-at-y0 world-unit GLB + placement snippet), rigged creatures (Tripo
// auto-rig + preset animations renamed to the game clip vocabulary, in-place),
// and player-class skins (atlas recolors/repaints on the SKINS lane).
//
// Usage:
//   node scripts/asset_pipeline/pipeline.mjs balance
//   node scripts/asset_pipeline/pipeline.mjs weapon --name emberfang_sword \
//     [--prompt "curved ember-glowing blade"] [--image path|url] [--family sword] \
//     [--items item_id1,item_id2] [--model-file existing.glb] [--flip] [--roll deg] [--apply] [--job id]
//   node scripts/asset_pipeline/pipeline.mjs prop --name market_fountain --height 2.4 \
//     [--prompt "..."] [--image ...] [--rotate-y 90] [--apply] [--job id]
//   node scripts/asset_pipeline/pipeline.mjs creature --name bog_lurker \
//     [--prompt "..."] [--image ...] [--rig-type biped] [--height 2.0] [--job id]
//   node scripts/asset_pipeline/pipeline.mjs skin --class warrior --suffix lava \
//     --tripo --prompt "molten obsidian armor, glowing lava cracks" [--apply]  (real gen)
//     (or --recolor hue=..[,sat=..][,light=..] fallback, or --prompt with OPENAI_API_KEY)
//   node scripts/asset_pipeline/pipeline.mjs skinset --set prismatic|chrome [--tripo] [--apply]
//   node scripts/asset_pipeline/pipeline.mjs skinmodel --class hunter --theme "pool party" \
//     --name pool_party_hunter [--face-limit 8000] [--grip-rot deg] [--apply]  (League-style skin)
//   node scripts/asset_pipeline/pipeline.mjs rig-manual --raw <raw.glb> --name <key>  (free local rig,
//     KayKit skeleton + all 22 native clips; see CLAUDE.md)
//   node scripts/asset_pipeline/pipeline.mjs validate --file x.glb --kind weapon|prop|creature [--family sword]
//   node scripts/asset_pipeline/pipeline.mjs preview --file x.glb [--out dir]
//   node scripts/asset_pipeline/pipeline.mjs library [--serve [--port 5180]] [--category weapons,skins] [--open]
//   node scripts/asset_pipeline/pipeline.mjs status [--job id]
//
// Keys: TRIPO_API_KEY (required), OPENAI_API_KEY (optional gpt-image-2 concepts).
// Jobs are resumable: tmp/asset_pipeline/<job>/job.json records every Tripo task
// id, so a rerun with --job <id> skips finished stages and reconnects to
// in-flight generate/rig tasks instead of re-paying.
// See scripts/asset_pipeline/CLAUDE.md for the full agent workflow.
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasOpenAi, REPO_ROOT } from './lib/env.mjs';
import { BIPED_CLIP_PLAN, CATEGORY_SPECS, quadClipPlan, weaponFamilyFor } from './lib/families.mjs';
import {
  assembleRiggedModel,
  checkInPlace,
  inspectGlb,
  normalizeProp,
  normalizeWeapon,
} from './lib/glb.mjs';
import {
  appendCreditsRow,
  itemDefSnippet,
  propSnippet,
  registerClassSkin,
  registerWeapon,
  visualDefSnippet,
} from './lib/integrate.mjs';
import { JOBS_ROOT, Job } from './lib/job.mjs';
import { editImages, generateConceptImage } from './lib/openai_image.mjs';
import {
  closePreview,
  renderHeldAcross,
  renderHeldPreviews,
  renderPreviews,
  renderPreviewsIfPossible,
  renderWeaponIcon,
} from './lib/preview.mjs';
import { atlasEditPrompt, conceptPrompt } from './lib/prompts.mjs';
import * as tripo from './lib/tripo.mjs';
import { validateCreature, validateProp, validateWeapon } from './lib/validate.mjs';

// ---------------------------------------------------------------------------
// Arg parsing (scripts/ convention: --opt value, --flag)
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const command = argv[0];
function opt(name, dflt = null) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}
function flag(name) {
  return argv.includes(`--${name}`);
}

// Human-in-the-loop stop point: `--until generate` runs the concept + model
// stages, renders a review preview of the raw model, and returns before rigging
// / normalizing, so the web wizard (library --serve) can show the model and let
// the operator approve it or regenerate (--redo generate) before spending more
// credits. `--until preview` is implicit: a run without --apply already stops
// after the previews, so the operator reviews the animated/finished asset there.
const UNTIL = opt('until');
async function reviewStop(job, step, glbForReview) {
  if (UNTIL !== step) return false;
  // Render the RAW model into its own preview_model/ dir (not the canonical
  // preview/ that the library + final stage own), so the wizard can show the
  // model-review shots distinctly from the finished/animated previews. The step
  // name is scoped per stop point (generate keeps the legacy name) so a later
  // texture stop is not short-circuited by the generate stop's ledger entry.
  if (glbForReview) {
    const stepName = step === 'generate' ? 'preview_model' : `preview_model_${step}`;
    await job.step(stepName, async () => {
      const { files, rendered } = await renderPreviewsIfPossible(
        glbForReview,
        job.path('preview_model'),
        { views: ['hero', 'front', 'right', 'back'] },
      );
      if (!rendered)
        job.log('model preview skipped: no local browser; the web wizard renders the raw GLB live');
      return { files, rendered };
    });
  }
  printReport(job, { stoppedAt: step, glb: glbForReview ?? null });
  return true;
}

function help() {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  console.log(
    src
      .split('\n')
      .filter((l) => l.startsWith('//'))
      .map((l) => l.replace(/^\/\/ ?/, ''))
      .join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Shared stages
// ---------------------------------------------------------------------------

function faceLimitOpt(dflt) {
  const v = Number(opt('face-limit', dflt));
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--face-limit must be a positive number`);
  return v;
}

/** Per-lane step order: --redo of a step CASCADES to every later step, because
 *  each stage's output feeds the next (re-generating without re-normalizing
 *  would silently ship the previous asset while the report says ok). Names are
 *  prefix-matched, so parameterized variants (normalize_flip, preview_r90) are
 *  covered by their base name. */
const STEP_ORDER = {
  weapon: [
    'concept',
    'generate',
    'texture',
    'normalize',
    'icon',
    'preview',
    'preview_held',
    'preview_held_all',
  ],
  prop: ['concept', 'generate', 'texture', 'normalize', 'preview'],
  creature: ['concept', 'generate', 'texture', 'rig', 'retarget', 'assemble', 'preview'],
  skin: ['texture', 'composite', 'render', 'recolor', 'repaint'],
  skinmodel: [
    'base_views',
    'concept',
    'generate',
    'rig',
    'retarget',
    'assemble',
    'handslots',
    'handslot_align',
    'preview',
    'preview_held',
  ],
  rigmanual: ['manual_rig', 'preview', 'preview_held'],
};

/** Apply --redo: drop the named ledger steps (comma-separated) AND everything
 *  downstream of the earliest one, so they all re-run. Paid steps re-pay; use
 *  after a parameter or code change. */
function applyRedo(job, lane) {
  const redo = opt('redo');
  if (!redo) return;
  const names = redo
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const order = STEP_ORDER[lane] ?? [];
  const cascade = new Set(names);
  for (const name of names) {
    const at = order.findIndex((step) => step === name || name.startsWith(`${step}_`));
    if (at !== -1) for (const later of order.slice(at)) cascade.add(later);
  }
  const cleared = [...cascade];
  job.clearSteps(cleared);
  job.log(`redo: cleared steps ${cleared.join(', ')} (downstream steps cascade)`);
}

/** Stage 1: resolve the model-generation input. Returns {input, conceptPath}.
 *  Priority: explicit --image; gpt-image-2 (OPENAI_API_KEY set); Tripo
 *  text-to-image (concept stays reviewable); the t2i task id feeds
 *  image-to-model directly so nothing re-uploads. */
async function conceptStage(job, { kind, description, family, image, rigType }) {
  // Resume path: once the concept is a completed ledger step, reuse its recorded
  // output. The finish/apply runs re-enter the whole lane WITHOUT the original
  // --prompt/--image (the wizard cannot resupply a prompt it never persisted), so
  // requiring an input here would wrongly abort a job whose concept is already done.
  // A --redo concept clears this step first, correctly forcing a fresh prompt.
  const doneConcept = job.state.steps.concept;
  if (doneConcept?.status === 'done') return doneConcept.result;
  // An imported model (--model-file) has a completed generate step but never ran
  // concept; a later `--redo texture` repaint (or finish) re-enters the lane with
  // no prompt. Since generate is already done, concept's output is unused
  // downstream; skip it rather than abort demanding a --prompt/--image the import
  // never had. A --redo generate cascade clears generate first, so this won't mask
  // a genuine from-scratch re-roll.
  if (job.state.steps.generate?.status === 'done') {
    return { input: null, conceptPath: null, source: 'skipped-generate-done' };
  }
  if (image) {
    return job.step('concept', async () => {
      if (/^https?:\/\//.test(image) || /^(task_|file_)/.test(image)) {
        return { input: image, conceptPath: null, source: 'provided' };
      }
      const dest = job.path('concept_input.png');
      copyFileSync(resolve(image), dest);
      return { input: dest, conceptPath: dest, source: 'provided-file' };
    });
  }
  if (!description) throw new Error('need --image or --prompt');
  const prompt = conceptPrompt({ kind, description, family, rigType });
  if (hasOpenAi()) {
    try {
      return await job.step('concept', async () => {
        const dest = job.path('concept.png');
        // Ground the concept in the game's ACTUAL art: a style board of shipped
        // assets rides along as a reference image, so results are KayKit-coherent
        // by default rather than by adjective.
        const { styleBoard, STYLE_REF_INSTRUCTION } = await import('./lib/style_ref.mjs');
        let board = null;
        try {
          board = await styleBoard(kind);
        } catch (err) {
          job.log(`style board unavailable (${String(err.message).slice(0, 80)}); plain concept`);
        }
        let usage = null;
        if (board) {
          job.log(`gpt-image-2 concept (style-referenced): ${prompt.slice(0, 100)}...`);
          try {
            const r = await editImages({
              prompt: `${STYLE_REF_INSTRUCTION} Now create: ${prompt}`,
              images: [board],
              dest,
              size: '1024x1024',
            });
            usage = r.usage;
          } catch (err) {
            // The multipart edits endpoint 520s in sustained bursts; the plain
            // generations endpoint usually still works. Style words remain in
            // the prompt, so degrade rather than die.
            job.log(`style-referenced edit failed (${String(err.message).slice(0, 60)}); plain`);
            board = null;
          }
        }
        if (!board) {
          job.log(`gpt-image-2 concept: ${prompt.slice(0, 120)}...`);
          const r = await generateConceptImage({ prompt, dest });
          usage = r.usage;
        }
        return { input: dest, conceptPath: dest, source: 'gpt-image-2', usage };
      });
    } catch (err) {
      job.log(`gpt-image-2 unavailable (${String(err.message).slice(0, 80)}); tripo t2i fallback`);
    }
  }
  return job.step('concept', async () => {
    job.log(`tripo text-to-image concept (no OPENAI_API_KEY): ${prompt.slice(0, 120)}...`);
    const template = kind === 'creature' ? 't_pose' : undefined;
    const { url } = await tripo.textToImage({
      prompt,
      template,
      onTaskCreated: (id) => job.noteTask('concept_t2i', id),
    });
    const dest = job.path('concept.png');
    await tripo.download(url, dest);
    // Return the downloaded file, not the task id: task output URLs expire in
    // ~5 minutes, so a resumed job referencing the task id would 400. The
    // generate stage re-uploads the local file, which never goes stale.
    return { input: dest, conceptPath: dest, source: 'tripo-t2i' };
  });
}

/** Reconnect to a task recorded by a crashed run: if the ledger holds a task id
 *  for this label and the step never completed, poll it instead of creating a
 *  new PAID task (closes the crash-during-poll double-pay window). Returns the
 *  successful task detail or null (missing/failed prior task: create fresh). */
async function reconnectTask(job, label) {
  const prior = job.state.tasks?.[label];
  if (!prior) return null;
  job.log(`step ${label}: reconnecting to task ${prior} from an interrupted run`);
  try {
    return await tripo.pollTask(prior, { timeoutMs: 5 * 60 * 1000 });
  } catch (err) {
    job.log(`  prior task unusable (${String(err.message).slice(0, 120)}); creating a new one`);
    return null;
  }
}

/** Stage 2: image/text to model, download the raw GLB immediately. */
async function generateStage(job, { input, prompt, model, faceLimit }) {
  return job.step('generate', async () => {
    const onProgress = (p, s) => job.log(`  tripo generation ${s} ${p}%`);
    const prior = await reconnectTask(job, 'generate');
    if (prior?.output?.model_url) {
      try {
        const raw = job.path('raw.glb');
        await tripo.download(prior.output.model_url, raw);
        return { taskId: job.state.tasks.generate, raw, credits: prior.credits_consumed ?? null };
      } catch (err) {
        // The prior task's output URL expired (~5 min TTL): the model bytes are
        // gone server-side, so a fresh generation is the only way forward.
        job.log(`  prior output expired (${String(err.message).slice(0, 80)}); regenerating`);
      }
    }
    let taskId;
    if (input) {
      const resolved = existsSync(input)
        ? await tripo.uploadFile(input)
        : await tripo.resolveImageInput(input);
      taskId = await tripo.createTask('/generation/image-to-model', {
        input: resolved,
        model,
        face_limit: faceLimit,
        texture: true,
        pbr: true,
      });
    } else {
      taskId = await tripo.createTask('/generation/text-to-model', {
        prompt: prompt.slice(0, 1024),
        model,
        face_limit: faceLimit,
        texture: true,
        pbr: true,
      });
    }
    job.noteTask('generate', taskId);
    const task = await tripo.pollTask(taskId, { onProgress });
    const raw = job.path('raw.glb');
    await tripo.download(task.output.model_url, raw);
    if (task.output.rendered_image_url) {
      await tripo
        .download(task.output.rendered_image_url, job.path('tripo_render.png'))
        .catch(() => {});
    }
    return { taskId, raw, credits: task.credits_consumed ?? null };
  });
}

/** Render turntable previews. The step LABEL may carry a parameter suffix (so
 *  a --flip/--rotate-y rerun re-renders), but files always land in the stable
 *  <job>/preview/ dir the docs point agents at (overwriting stale frames). */
/** Optional stage 2.5: Tripo /models/texture, a UV-preserving repaint of the raw
 *  model from a text prompt (--retexture "<prompt>", --texture-quality
 *  standard|detailed). Once done it lives in the ledger, so later resumed runs
 *  (finish/apply, which carry no --retexture) keep building from the textured
 *  model; --redo texture (or a fresh --redo generate cascade) re-rolls it.
 *  Returns { glb, taskId } or null when the stage never ran. */
async function textureStage(job, gen) {
  const done = job.state.steps.texture;
  if (done?.status === 'done') return done.result;
  const texPrompt = opt('retexture');
  if (!texPrompt) return null;
  return job.step('texture', async () => {
    const dest = job.path('textured.glb');
    const r = await tripo.textureModel({
      // Upload the local raw GLB (a resumed job's generate task output URL can be
      // expired server-side; local bytes never go stale).
      input: gen.raw,
      prompt: texPrompt,
      textureQuality: opt('texture-quality') === 'standard' ? 'standard' : 'detailed',
      onProgress: (p, s) => job.log(`  texture ${s} ${p}%`),
      onTaskCreated: (id) => job.noteTask('texture', id),
    });
    const url = r.task.output?.model_url ?? r.task.output?.pbr_model_url;
    if (!url) throw new Error('texture task returned no model_url');
    await tripo.download(url, dest);
    return { glb: dest, taskId: r.taskId };
  });
}

async function previewStage(job, glbPath, label = 'preview') {
  return job.step(label, async () => {
    const outDir = job.path('preview');
    const { files, rendered } = await renderPreviewsIfPossible(glbPath, outDir);
    if (!rendered)
      job.log(
        'preview skipped: no local browser for headless render; the web wizard renders the GLB live',
      );
    return { files, rendered };
  });
}

function printReport(job, extra = {}) {
  const report = {
    job: job.id,
    dir: job.dir,
    steps: Object.fromEntries(Object.entries(job.state.steps).map(([k, v]) => [k, v.status])),
    tasks: job.state.tasks ?? {},
    ...extra,
  };
  console.log('\n=== asset pipeline report ===');
  console.log(JSON.stringify(report, null, 2));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdWeapon() {
  const name = opt('name');
  if (!name) throw new Error('weapon needs --name <snake_case_key>');
  if (!/^[a-z0-9_]+$/.test(name)) {
    // Validate BEFORE any paid generation; registerWeapon would reject it at
    // --apply time, after the credits were already spent.
    throw new Error(`weapon --name must be snake_case ([a-z0-9_]): ${name}`);
  }
  const job = Job.open({ job: opt('job'), kind: 'weapon', name, create: flag('new-job') });
  // Resolve family from --family, else the family the job recorded at generation,
  // else infer from the name. finish/apply resume the lane WITHOUT re-passing
  // --family, so without the recorded fallback a weapon whose name carries no
  // family keyword (e.g. "skyrender_heaven_s_fracture") would fail every step
  // after generate, even though it generated fine with the family picked in the UI.
  const family = weaponFamilyFor(opt('family') ?? job.state.family ?? name);
  if (!family) {
    throw new Error(
      `cannot infer weapon family from "${opt('family') ?? name}"; the key must contain one of: ` +
        'sword, dagger, knife, axe, hammer, mace, staff, wand, halberd, spear, scythe, book, tome, crossbow, bow (test contract), or pass --family',
    );
  }
  applyRedo(job, 'weapon');
  job.set('kind', 'weapon');
  job.set('name', name);
  job.set('family', family.name);

  // --model-file imports an EXISTING 3D model (no concept, no Tripo spend):
  // the file is copied in as the raw model and flows through the same
  // normalize/icon/preview/integration chain as a generated one.
  const modelFile = opt('model-file');
  let gen;
  if (modelFile) {
    gen = await job.step('generate', async () => {
      const src = resolve(modelFile);
      if (!existsSync(src)) throw new Error(`--model-file not found: ${src}`);
      const raw = job.path('raw.glb');
      copyFileSync(src, raw);
      return { raw, source: 'imported-file', from: src };
    });
  } else {
    const concept = await conceptStage(job, {
      kind: 'weapon',
      description: opt('prompt'),
      family,
      image: opt('image'),
    });
    // Prefer the local concept file (a resumed job's cached task-id reference
    // can have an expired output URL; a local file re-uploads fresh).
    const input = concept.conceptPath ?? concept.input;
    gen = await generateStage(job, {
      input,
      prompt: opt('prompt')
        ? conceptPrompt({ kind: 'weapon', description: opt('prompt'), family })
        : null,
      model: opt('model') === 'hifi' ? tripo.MODEL_HIFI : tripo.MODEL_LOWPOLY,
      faceLimit: faceLimitOpt(CATEGORY_SPECS.weapon.faceLimit),
    });
  }
  if (await reviewStop(job, 'generate', gen.raw)) return;
  const tex = await textureStage(job, gen);
  if (await reviewStop(job, 'texture', tex?.glb ?? gen.raw)) return;

  const flip = flag('flip');
  const roll = Number(opt('roll', 0)) || 0;
  // The variant suffix parameterizes every step DERIVED from the normalize
  // output, so a --flip or --roll rerun re-renders the icon and previews too
  // (a stale icon from the un-fixed model must never reach --apply).
  const variant = `${flip ? '_flip' : ''}${roll ? `_roll${roll}` : ''}`;
  const built = job.path(`${name}.glb`);
  const norm = await job.step(`normalize${variant}`, () =>
    normalizeWeapon(tex?.glb ?? gen.raw, built, family, { flip, roll }),
  );
  job.log(
    `normalized: scale ${norm.scale}, flipped ${norm.flipped}, auto-roll ${norm.autoRollDeg ?? 0}deg${roll ? `, manual roll ${roll}deg` : ''}`,
  );

  const check = await validateWeapon(built, family);
  job.set('validation', check);
  for (const w of check.warnings) job.log(`WARN: ${w}`);
  if (!check.ok) {
    for (const e of check.errors) job.log(`ERROR: ${e}`);
    printReport(job, { ok: false, errors: check.errors });
    throw new Error(
      'weapon failed validation. If the blade points down in the preview, rerun with --flip ' +
        `--job ${job.id}`,
    );
  }

  const icon = job.path(`${name}.jpg`);
  await job.step(`icon${variant}`, () => renderWeaponIcon(built, icon).then(() => ({ icon })));
  await previewStage(job, built, `preview${variant}`);
  await job.step(`preview_held${variant}`, async () => {
    const files = await renderHeldPreviews(built, job.path('preview'), {
      lift: family.lift,
      maxHeight: family.maxHeight,
    });
    return { files };
  });
  // Held + animated by EVERY class model (idle, side, mid-attack each): the
  // weapon must integrate with all characters, not just the knight.
  await job.step(`preview_held_all${variant}`, async () => {
    const files = await renderHeldAcross(built, job.path('preview'), {
      lift: family.lift,
      maxHeight: family.maxHeight,
    });
    return { files };
  });

  let actions = [];
  if (flag('apply')) {
    const itemIds = (opt('items') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    actions = registerWeapon({
      key: name,
      gripFamily: family.grip,
      glbPath: built,
      iconPath: icon,
      itemIds,
    });
    actions.push(
      ...appendCreditsRow({
        assets: `Generated weapon model + icon (${name})`,
        source: 'Project-generated via scripts/asset_pipeline (Tripo AI 3D)',
      }),
    );
    if (!itemIds.length) {
      job.log('no --items given: emit an ItemDef and map it when you add the item');
      console.log(`\n${itemDefSnippet({ itemId: `${name}_item`, name, family: family.name })}`);
    }
    job.log('run: npx vitest run tests/held_weapon_models.test.ts');
  }
  printReport(job, { ok: true, glb: built, icon, family: family.name, actions });
}

async function cmdProp() {
  const name = opt('name');
  const height = Number(opt('height'));
  if (!name || !height) throw new Error('prop needs --name and --height <world units>');
  const job = Job.open({ job: opt('job'), kind: 'prop', name, create: flag('new-job') });
  applyRedo(job, 'prop');
  job.set('kind', 'prop');
  job.set('name', name);

  const concept = await conceptStage(job, {
    kind: 'prop',
    description: opt('prompt'),
    image: opt('image'),
  });
  const input = concept.conceptPath ?? concept.input;
  const gen = await generateStage(job, {
    input,
    prompt: opt('prompt') ? conceptPrompt({ kind: 'prop', description: opt('prompt') }) : null,
    model: opt('model') === 'hifi' ? tripo.MODEL_HIFI : tripo.MODEL_LOWPOLY,
    faceLimit: faceLimitOpt(CATEGORY_SPECS.prop.faceLimit),
  });
  if (await reviewStop(job, 'generate', gen.raw)) return;
  const tex = await textureStage(job, gen);
  if (await reviewStop(job, 'texture', tex?.glb ?? gen.raw)) return;

  const built = job.path(`${name}.glb`);
  const rotateY = (Number(opt('rotate-y', 0)) * Math.PI) / 180;
  const rotVariant = String(opt('rotate-y', 0));
  await job.step(`normalize_r${rotVariant}`, () =>
    normalizeProp(tex?.glb ?? gen.raw, built, { height, rotateY }),
  );

  const check = await validateProp(built, { height });
  job.set('validation', check);
  for (const w of check.warnings) job.log(`WARN: ${w}`);
  if (!check.ok) {
    for (const e of check.errors) job.log(`ERROR: ${e}`);
    printReport(job, { ok: false, errors: check.errors });
    throw new Error('prop failed validation');
  }
  await previewStage(job, built, `preview_r${rotVariant}`);

  const actions = [];
  if (flag('apply')) {
    const dest = resolve(REPO_ROOT, `public/models/props/${name}.glb`);
    copyFileSync(built, dest);
    actions.push(`copied ${name}.glb -> public/models/props/`);
    actions.push(
      ...appendCreditsRow({
        assets: `Generated prop model (${name})`,
        source: 'Project-generated via scripts/asset_pipeline (Tripo AI 3D)',
      }),
    );
  }
  // Collision footprint MEASURED from the built model, so the emitted zone
  // record + collider keep the sim's WYSIWYG-collision invariant exactly.
  const b = check.report.bounds;
  const footprint = {
    w: +(b.max[0] - b.min[0]).toFixed(2),
    d: +(b.max[2] - b.min[2]).toFixed(2),
    r: +(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2).toFixed(2),
  };
  console.log(`\n${propSnippet({ name, height, footprint, building: flag('building') })}`);
  printReport(job, { ok: true, glb: built, footprint, actions });
}

async function cmdCreature() {
  const name = opt('name');
  if (!name) throw new Error('creature needs --name <snake_case>');
  const job = Job.open({ job: opt('job'), kind: 'creature', name, create: flag('new-job') });
  applyRedo(job, 'creature');
  job.set('kind', 'creature');
  job.set('name', name);

  const concept = await conceptStage(job, {
    kind: 'creature',
    description: opt('prompt'),
    image: opt('image'),
    rigType: opt('rig-type'),
  });
  const input = concept.conceptPath ?? concept.input;
  const gen = await generateStage(job, {
    input,
    prompt: opt('prompt') ? conceptPrompt({ kind: 'creature', description: opt('prompt') }) : null,
    model: opt('model') === 'hifi' ? tripo.MODEL_HIFI : tripo.MODEL_LOWPOLY,
    faceLimit: faceLimitOpt(CATEGORY_SPECS.creature.faceLimit),
  });
  if (await reviewStop(job, 'generate', gen.raw)) return;
  const tex = await textureStage(job, gen);
  if (await reviewStop(job, 'texture', tex?.glb ?? gen.raw)) return;
  // Rig whichever model the operator approved: the textured task when the
  // texture stage ran, else the raw generate task.
  const modelTaskForRig = tex?.taskId ?? gen.taskId;

  const rig = await job.step('rig', async () => {
    const prior = await reconnectTask(job, 'rig');
    if (prior) {
      // Rig task recovered from a crashed run. Re-derive the rig type via the
      // FREE rig-check so the animation plan matches what was rigged.
      const checkId = await tripo.createTask('/animations/rig-check', { input: modelTaskForRig });
      const check = await tripo.pollTask(checkId);
      const type = opt('rig-type') ?? check.output?.rig_type ?? 'biped';
      return { rigTaskId: job.state.tasks.rig, rigType: type, rigModelVersion: 'reconnected' };
    }
    const r = await tripo.rigModel({
      modelTaskId: modelTaskForRig,
      rigType: opt('rig-type'),
      onProgress: (p, s) => job.log(`  rig ${s} ${p}%`),
      onTaskCreated: (id) => job.noteTask('rig', id),
    });
    return { rigTaskId: r.rigTaskId, rigType: r.rigType, rigModelVersion: r.rigModelVersion };
  });
  job.log(`rigged as ${rig.rigType} (rig model ${rig.rigModelVersion})`);

  const plan = rig.rigType === 'biped' ? BIPED_CLIP_PLAN : quadClipPlan(rig.rigType);
  if (!plan) throw new Error(`no animation plan for rig type ${rig.rigType}`);

  const anims = await job.step('retarget', async () => {
    const presets = plan.map((c) => c.presets[0]);
    const results = await tripo.retargetAnimations({
      rigTaskId: rig.rigTaskId,
      presets,
      inPlace: true,
      onProgress: (p, s) => job.log(`  retarget ${s} ${p}%`),
      onTaskCreated: (preset, id) => job.noteTask(`retarget_${preset}`, id),
      // Downloads happen inside the retarget workers, immediately after each
      // task succeeds (output URLs expire in ~5 min while siblings poll).
      destFor: (preset) => job.path(`anim_${preset.replace(/[^a-z0-9]+/gi, '_')}.glb`),
    });
    const downloaded = [];
    for (const r of results) {
      if (r.error) {
        job.log(`WARN: preset ${r.preset} failed: ${r.error}`);
        continue;
      }
      downloaded.push({ preset: r.preset, path: r.path });
    }
    if (!downloaded.length) throw new Error('every retarget failed');
    return { downloaded };
  });

  const built = job.path(`${name}.glb`);
  const assembled = await job.step('assemble', async () => {
    const byPreset = new Map(anims.downloaded.map((d) => [d.preset, d.path]));
    const clips = [];
    for (const c of plan) {
      const path = byPreset.get(c.presets[0]);
      if (path) clips.push({ path, preset: c.presets[0], game: c.game });
    }
    // For non-biped rigs the walk clip stands in for the required slots.
    if (rig.rigType !== 'biped' && clips.length) {
      const walk = clips[0];
      for (const game of ['Idle', 'Run', 'Attack', 'Death']) {
        if (!clips.some((c) => c.game === game)) clips.push({ ...walk, game });
      }
      job.log('WARN: non-biped rig, walk preset reused for Idle/Run/Attack/Death; review previews');
    }
    return assembleRiggedModel(clips[0].path, clips, built);
  });
  for (const a of assembled.added) {
    job.log(
      `clip ${a.game} from ${a.preset}: ${a.ok ? `ok (${a.channels} channels)` : `FAILED ${a.reason ?? ''}`}`,
    );
  }

  const required = rig.rigType === 'biped' ? ['Idle', 'Walk', 'Run', 'Attack', 'Death'] : ['Walk'];
  const check = await validateCreature(built, { requiredClips: required });
  job.set('validation', check);
  for (const w of check.warnings) job.log(`WARN: ${w}`);
  if (!check.ok) {
    for (const e of check.errors) job.log(`ERROR: ${e}`);
    printReport(job, { ok: false, errors: check.errors });
    throw new Error('creature failed validation');
  }
  await previewStage(job, built);

  const actions = [];
  if (flag('apply')) {
    const dest = resolve(REPO_ROOT, `public/models/creatures/${name}.glb`);
    copyFileSync(built, dest);
    actions.push(`copied ${name}.glb -> public/models/creatures/`);
    actions.push(
      ...appendCreditsRow({
        assets: `Generated creature model + animations (${name})`,
        source:
          'Project-generated via scripts/asset_pipeline (Tripo AI 3D, auto-rig + preset retargets)',
      }),
    );
  }
  const clips = Object.fromEntries(
    assembled.added.filter((a) => a.ok).map((a) => [a.game.toLowerCase(), a.game]),
  );
  console.log(
    `\n${visualDefSnippet({
      name,
      kind: 'creature',
      height: Number(opt('height', 2.0)),
      clips: {
        idle: clips.idle,
        walk: clips.walk,
        run: clips.run,
        attack: clips.attack,
        hit: clips.hit,
        death: clips.death,
        cast: clips.cast,
        jump: clips.jump,
      },
      hasCast: !!clips.cast,
      hasJump: !!clips.jump,
    })}`,
  );
  printReport(job, { ok: true, glb: built, rigType: rig.rigType, actions });
}

// Player class -> the body model GLB that class wears (mage.glb serves the
// caster trio). Shared by the skin, skinset, and skinmodel lanes.
const CLASS_MODELS = {
  warrior: 'knight',
  paladin: 'paladin',
  hunter: 'ranger',
  rogue: 'rogue',
  priest: 'mage',
  mage: 'mage',
  warlock: 'mage',
  shaman: 'barbarian',
  druid: 'druid',
};

async function cmdSkin() {
  const cls = opt('class');
  const suffix = opt('suffix');
  if (!cls || !suffix) throw new Error('skin needs --class <playerclass> and --suffix <letter>');
  const model = CLASS_MODELS[cls];
  if (!model) throw new Error(`unknown class ${cls}`);
  const base = resolve(REPO_ROOT, `public/textures/skins/${model}/base.png`);
  if (!existsSync(base)) throw new Error(`missing base atlas ${base}`);

  const job = Job.open({ job: opt('job'), kind: 'skin', name: `${cls}_${suffix}` });
  applyRedo(job, 'skin');
  job.set('kind', 'skin');
  const out = job.path(`alt_${suffix}.png`);

  const recolor = opt('recolor');
  if (flag('tripo')) {
    // REAL generation: Tripo re-textures the class model from a prompt (keeping
    // its UVs), then we composite the per-part textures back into one drop-in
    // atlas. Genuinely new spatially-painted art, not a recolor.
    if (!opt('prompt')) throw new Error('skin --tripo needs --prompt "theme description"');
    const classGlb = resolve(REPO_ROOT, `public/models/chars/players/${model}.glb`);
    const textured = await job.step('texture', async () => {
      const dest = job.path('textured.glb');
      const prior = await reconnectTask(job, 'texture');
      if (prior?.output?.model_url) {
        try {
          await tripo.download(prior.output.model_url, dest);
          return { dest };
        } catch {
          /* expired: re-texture below */
        }
      }
      job.log(`tripo texture (${opt('prompt').slice(0, 80)})...`);
      const { taskId, task } = await tripo.textureModel({
        input: classGlb,
        prompt: opt('prompt'),
        textureQuality: opt('quality') ?? 'detailed',
        onProgress: (p, s) => job.log(`  tripo texture ${s} ${p}%`),
        onTaskCreated: (id) => job.noteTask('texture', id),
      });
      await tripo.download(task.output.model_url, dest);
      return { dest, taskId };
    });
    await job.step('composite', async () => {
      const { compositeAtlasFromTextured } = await import('./lib/tripo_skin.mjs');
      const r = await compositeAtlasFromTextured(textured.dest, base, out);
      job.log(`composited ${r.parts} part textures -> ${r.width}x${r.height} atlas`);
      return r;
    });
    await job.step('render', async () => {
      const { renderSkinThumb } = await import('./lib/preview.mjs');
      const render = job.path(`alt_${suffix}.render.png`);
      await renderSkinThumb(classGlb, out, render, { size: 420 });
      return { render };
    });
  } else if (recolor) {
    await job.step('recolor', async () => {
      const sharp = (await import('sharp')).default;
      const params = Object.fromEntries(
        recolor.split(',').map((kv) => kv.split('=').map((s) => s.trim())),
      );
      const meta = await sharp(base).metadata();
      const modulate = {
        hue: Number(params.hue ?? 0),
        saturation: Number(params.sat ?? 1),
      };
      // light is a MULTIPLIER (1.0 = unchanged), which in sharp is `brightness`
      // (sharp's own `lightness` is an additive L* offset, not what the docs
      // here promise).
      if (params.light !== undefined && Number(params.light) !== 1) {
        modulate.brightness = Number(params.light);
      }
      await sharp(base).modulate(modulate).png().toFile(out);
      return { out, width: meta.width, height: meta.height, params };
    });
  } else if (opt('prompt')) {
    if (!hasOpenAi()) {
      throw new Error('skin --prompt needs OPENAI_API_KEY (or use deterministic --recolor hue=..)');
    }
    await job.step('repaint', async () => {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(base).metadata();
      await editImages({
        prompt: atlasEditPrompt(opt('prompt')),
        images: [base],
        dest: job.path('repaint_raw.png'),
        size: 'auto',
      });
      // The atlas must keep its exact dimensions (same UVs).
      await sharp(job.path('repaint_raw.png')).resize(meta.width, meta.height).png().toFile(out);
      return { out, width: meta.width, height: meta.height };
    });
  } else {
    throw new Error(
      'skin needs --tripo --prompt "..." (real generation), --recolor hue=..[,sat=..][,light=..], or --prompt "..." (gpt-image-2)',
    );
  }

  const source = flag('tripo')
    ? 'Project-generated via scripts/asset_pipeline (Tripo AI re-texture + UV composite)'
    : 'Project-generated via scripts/asset_pipeline (atlas recolor/repaint)';
  let actions = [];
  if (flag('apply')) {
    actions = registerClassSkin({ cls, model, texturePath: out, suffix });
    actions.push(
      ...appendCreditsRow({
        assets: `Generated class skin atlas (${model}/alt_${suffix}.png)`,
        source,
      }),
    );
    job.log('run: npx vitest run tests/skin_event.test.ts');
  }
  printReport(job, { ok: true, texture: out, actions });
}

/** League-style SKIN MODEL: a brand-new character body derived from a base
 *  class model (gpt-image-2 redesigns the character around a theme using
 *  renders of the real model, Tripo builds/rigs it, the FULL KayKit clip
 *  vocabulary is retargeted on, and handslot bones are injected so it holds
 *  weapons through the game's own attach path). Output integrates via
 *  `clips: kaykit([...])` exactly like a shipped class model. */
async function cmdSkinmodel() {
  const cls = opt('class');
  const theme = opt('theme');
  const name = opt('name');
  if (!cls || !theme || !name) {
    throw new Error(
      'skinmodel needs --class <playerclass> --theme "pool party" --name <snake_case>',
    );
  }
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`--name must be snake_case: ${name}`);
  const model = CLASS_MODELS[cls];
  if (!model) throw new Error(`unknown class ${cls}`);
  if (!hasOpenAi()) throw new Error('skinmodel needs OPENAI_API_KEY (gpt-image-2 redesign stage)');
  const baseGlb = resolve(REPO_ROOT, `public/models/chars/players/${model}.glb`);

  const job = Job.open({ job: opt('job'), kind: 'skinmodel', name });
  applyRedo(job, 'skinmodel');
  job.set('kind', 'skinmodel');
  job.set('name', name);
  job.set('theme', theme);
  job.set('class', cls);

  // 1. Render the REAL base model from several angles: these are the identity
  //    + style references the redesign is grounded in.
  const views = await job.step('base_views', async () => {
    const dir = job.path('base_views');
    const files = await renderPreviews(baseGlb, dir, {
      size: 512,
      views: ['front', 'hero', 'back'],
      clips: false,
    });
    return { files };
  });

  // 2. gpt-image-2 redesign: the League-style themed variant of THIS character,
  //    as a T-pose sheet ready for 3D reconstruction.
  const concept = await job.step('concept', async () => {
    const { skinModelPrompt } = await import('./lib/prompts.mjs');
    const dest = job.path('concept.png');
    job.log(`gpt-image-2 skin redesign: "${theme}" ${cls}...`);
    const r = await editImages({
      prompt: skinModelPrompt({ theme, className: cls }),
      images: views.files,
      dest,
      size: '1024x1536',
    });
    return { dest, usage: r.usage };
  });

  // 3. Best-quality Tripo build: v3.1 + smart_low_poly (clean topology at a
  //    game-appropriate budget).
  const gen = await job.step('generate', async () => {
    const prior = await reconnectTask(job, 'generate');
    const raw = job.path('raw.glb');
    if (prior?.output?.model_url) {
      try {
        await tripo.download(prior.output.model_url, raw);
        return { taskId: job.state.tasks.generate, raw };
      } catch {
        job.log('  prior output expired; regenerating');
      }
    }
    const { taskId, task } = await tripo.generateModel({
      image: concept.dest,
      model: tripo.MODEL_HIFI,
      smartLowPoly: true,
      faceLimit: faceLimitOpt(8000),
      onProgress: (p, s) => job.log(`  tripo generation ${s} ${p}%`),
      onTaskCreated: (id) => job.noteTask('generate', id),
    });
    await tripo.download(task.output.model_url, raw);
    return { taskId, raw };
  });

  // 4. Rig (biped, the 90+ preset library).
  const rig = await job.step('rig', async () => {
    const prior = await reconnectTask(job, 'rig');
    if (prior) {
      return { rigTaskId: job.state.tasks.rig, rigType: 'biped', rigModelVersion: 'reconnected' };
    }
    const r = await tripo.rigModel({
      modelTaskId: gen.taskId,
      rigType: 'biped',
      onProgress: (p, s) => job.log(`  rig ${s} ${p}%`),
      onTaskCreated: (id) => job.noteTask('rig', id),
    });
    return { rigTaskId: r.rigTaskId, rigType: r.rigType, rigModelVersion: r.rigModelVersion };
  });

  // 5. Retarget the FULL KayKit clip vocabulary (in-place) so the game's
  //    kaykit() ClipMap drives this body exactly like a shipped class.
  const { KAYKIT_CLIP_PLAN, KAYKIT_REQUIRED_CLIPS } = await import('./lib/families.mjs');
  const anims = await job.step('retarget', async () => {
    const presets = KAYKIT_CLIP_PLAN.map((c) => c.presets[0]);
    const results = await tripo.retargetAnimations({
      rigTaskId: rig.rigTaskId,
      presets,
      inPlace: true,
      onProgress: (p, s) => job.log(`  retarget ${s} ${p}%`),
      onTaskCreated: (preset, id) => job.noteTask(`retarget_${preset}`, id),
      destFor: (preset) => job.path(`anim_${preset.replace(/[^a-z0-9]+/gi, '_')}.glb`),
    });
    const downloaded = [];
    for (const r of results) {
      if (r.error) {
        job.log(`WARN: preset ${r.preset} failed: ${r.error}`);
        continue;
      }
      downloaded.push({ preset: r.preset, path: r.path });
    }
    if (!downloaded.length) throw new Error('every retarget failed');
    return { downloaded };
  });

  // 6. Assemble with KayKit clip names (array entries copy one clip under
  //    several names, e.g. sit -> Sit_Floor_Down + Sit_Floor_Idle).
  const built = job.path(`${name}.glb`);
  const assembled = await job.step('assemble', async () => {
    const byPreset = new Map(anims.downloaded.map((d) => [d.preset, d.path]));
    const clips = [];
    for (const c of KAYKIT_CLIP_PLAN) {
      const path = byPreset.get(c.presets[0]);
      if (!path) continue;
      for (const game of Array.isArray(c.game) ? c.game : [c.game]) {
        clips.push({ path, preset: c.presets[0], game });
      }
    }
    return assembleRiggedModel(clips[0].path, clips, built);
  });
  for (const a of assembled.added) {
    job.log(`clip ${a.game}: ${a.ok ? `ok (${a.channels} ch)` : `FAILED ${a.reason ?? ''}`}`);
  }

  // 7. Inject handslot.r / handslot.l so the game's weapon attach works.
  const slots = await job.step('handslots', async () => {
    const { addHandslotBones } = await import('./lib/glb.mjs');
    const report = await addHandslotBones(built, built, {
      rotateY: Number(opt('grip-rot', 0)),
      referenceGlb: resolve(REPO_ROOT, 'public/models/chars/players/knight.glb'),
    });
    return report;
  });
  job.log(`handslots: r=${slots.r?.hand ?? 'NOT FOUND'} l=${slots.l?.hand ?? 'NOT FOUND'}`);

  // Pose-matched grip alignment: the injected slots start from a bind-pose
  // transplant, but the two rigs' idles rotate the hand differently from their
  // binds, so the runtime grip can sit ~90 degrees off. Pose BOTH rigs at the
  // same Idle frame and rewrite the slot rotations so the world grip matches
  // the knight exactly (the game plays clips, never the bind pose).
  const align = await job.step('handslot_align', async () => {
    const { computeSlotCalibration } = await import('./lib/preview.mjs');
    const { setHandslotRotations } = await import('./lib/glb.mjs');
    const cal = await computeSlotCalibration(
      resolve(REPO_ROOT, 'public/models/chars/players/knight.glb'),
      built,
    );
    if (!cal.r && !cal.l) return { skipped: 'no slots to align' };
    const applied = await setHandslotRotations(built, built, cal);
    return {
      applied,
      errorBeforeDeg: { r: cal.r?.errorBeforeDeg ?? null, l: cal.l?.errorBeforeDeg ?? null },
    };
  });
  if (align.errorBeforeDeg) {
    job.log(
      `handslot_align: corrected grip error r=${align.errorBeforeDeg.r}deg l=${align.errorBeforeDeg.l}deg (idle-pose matched to knight)`,
    );
  }

  // 8. Validate: KayKit-required clips present, rigged, in-place.
  const { CATEGORY_SPECS: SPECS } = await import('./lib/families.mjs');
  const check = await validateCreature(built, {
    requiredClips: KAYKIT_REQUIRED_CLIPS,
    spec: SPECS.skinmodel,
  });
  job.set('validation', check);
  for (const w of check.warnings) job.log(`WARN: ${w}`);
  if (!check.ok) {
    for (const e of check.errors) job.log(`ERROR: ${e}`);
    printReport(job, { ok: false, errors: check.errors });
    throw new Error('skinmodel failed validation');
  }

  // 9. Previews: turntable + every clip, plus a held-weapon proof (a shipped
  //    variant sword gripped by THIS body through the injected handslot).
  await previewStage(job, built);
  await job.step('preview_held', async () => {
    if (!slots.r?.slot) return { skipped: 'no right handslot' };
    const files = await renderHeldPreviews(
      resolve(REPO_ROOT, 'public/models/weapons/sword_a.glb'),
      job.path('preview'),
      { character: built, lift: 0.04, maxHeight: 2.0 },
    );
    return { files };
  });

  const actions = [];
  if (flag('apply')) {
    const destRel = `models/chars/skins/${name}.glb`;
    const dest = resolve(REPO_ROOT, `public/${destRel}`);
    const { mkdirSync: mk } = await import('node:fs');
    mk(resolve(REPO_ROOT, 'public/models/chars/skins'), { recursive: true });
    copyFileSync(built, dest);
    actions.push(`copied ${name}.glb -> public/${destRel}`);
    actions.push(
      ...appendCreditsRow({
        assets: `Generated skin-model character (${name}, "${theme}" ${cls})`,
        source:
          'Project-generated via scripts/asset_pipeline (gpt-image-2 redesign + Tripo build/rig/retarget)',
      }),
    );
  }

  const { skinModelSnippet } = await import('./lib/integrate.mjs');
  console.log(
    `\n${skinModelSnippet({ name, cls, theme, hasRightSlot: !!slots.r?.slot, hasLeftSlot: !!slots.l?.slot })}`,
  );
  printReport(job, {
    ok: true,
    glb: built,
    theme,
    class: cls,
    clips: assembled.added.filter((a) => a.ok).map((a) => a.game),
    handslots: slots,
    actions,
  });
}

/** Manual (code-computed) rigging: bind a raw generated mesh onto the KayKit
 *  reference skeleton with weights computed locally (lib/manual_rig.mjs). The
 *  output carries the reference rig's ENTIRE clip library natively (all 22
 *  KayKit clips for the knight) plus the real handslot bones, at zero Tripo
 *  cost. Assumes a Tripo-style raw mesh (T-pose, facing +X); --pre-rotated
 *  skips the yaw for meshes already facing +Z. */
async function cmdRigManual() {
  const raw = opt('raw');
  const name = opt('name');
  if (!raw || !name) throw new Error('rig-manual needs --raw <glb> and --name <snake_case>');
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`--name must be snake_case: ${name}`);
  const reference = resolve(REPO_ROOT, opt('reference', 'public/models/chars/players/knight.glb'));
  const job = Job.open({ job: opt('job'), kind: 'skinmodel', name });
  applyRedo(job, 'rigmanual');
  job.set('kind', 'skinmodel');
  job.set('name', name);
  job.set('rigMethod', 'manual');

  const built = job.path(`${name}.glb`);
  const fit = await job.step('manual_rig', async () => {
    const { manualRigOntoReference } = await import('./lib/manual_rig.mjs');
    return manualRigOntoReference(resolve(raw), reference, built, {
      preRotated: flag('pre-rotated'),
    });
  });
  job.log(`manual rig: scale ${fit.scale}, ${fit.verts} verts skinned, ${fit.clips} native clips`);

  const { CATEGORY_SPECS: SPECS, KAYKIT_REQUIRED_CLIPS } = await import('./lib/families.mjs');
  const check = await validateCreature(built, {
    requiredClips: KAYKIT_REQUIRED_CLIPS,
    spec: SPECS.skinmodel,
  });
  job.set('validation', check);
  for (const w of check.warnings) job.log(`WARN: ${w}`);
  if (!check.ok) {
    for (const e of check.errors) job.log(`ERROR: ${e}`);
    printReport(job, { ok: false, errors: check.errors });
    throw new Error('manual rig failed validation');
  }

  await previewStage(job, built);
  await job.step('preview_held', async () => {
    const files = await renderHeldPreviews(
      resolve(REPO_ROOT, 'public/models/weapons/sword_a.glb'),
      job.path('preview'),
      { character: built, lift: 0.04, maxHeight: 2.0 },
    );
    return { files };
  });

  printReport(job, {
    ok: true,
    glb: built,
    fit,
    rig: 'manual (reference skeleton + local weights)',
  });
}

async function cmdSkinset() {
  const setName = opt('set') ?? 'prismatic';
  const { SUIT_SETS, SUIT_PROMPTS, MODEL_CLASSES, gradientMapAtlas } = await import(
    './lib/skinsuit.mjs'
  );
  const { renderSkinThumb } = await import('./lib/preview.mjs');
  const { compositeAtlasFromTextured } = await import('./lib/tripo_skin.mjs');
  const set = SUIT_SETS[setName];
  if (!set)
    throw new Error(`unknown set "${setName}"; known: ${Object.keys(SUIT_SETS).join(', ')}`);
  const useTripo = flag('tripo');
  const prompts = SUIT_PROMPTS[setName];
  if (useTripo && !prompts) throw new Error(`set "${setName}" has no Tripo prompts (SUIT_PROMPTS)`);
  const job = Job.open({
    job: opt('job'),
    kind: 'skinset',
    name: `${setName}${useTripo ? '_tripo' : ''}`,
  });
  job.set('kind', 'skinset');
  job.log(
    `generating "${set.label}" (${set.suffix}) for ${Object.keys(set.themes).length} models` +
      (useTripo ? ' via Tripo AI re-texture (real generation)' : ' via gradient map'),
  );

  const built = [];
  for (const model of Object.keys(set.themes)) {
    const atlas = job.path(`${model}.png`);
    const base = `public/textures/skins/${model}/base.png`;
    const classGlb = `public/models/chars/players/${model}.glb`;
    if (useTripo) {
      // Real generation: Tripo re-textures the model from the prompt, then we
      // composite the per-mesh parts back into the shared-UV drop-in atlas.
      const textured = await job.step(`texture_${model}`, async () => {
        const dest = job.path(`${model}.textured.glb`);
        const { task } = await tripo.textureModel({
          input: classGlb,
          prompt: prompts[model],
          onProgress: (p, s) => job.log(`  ${model} texture ${s} ${p}%`),
          onTaskCreated: (id) => job.noteTask(`texture_${model}`, id),
        });
        await tripo.download(task.output.model_url, dest);
        return { dest };
      });
      await job.step(`composite_${model}`, () =>
        compositeAtlasFromTextured(textured.dest, base, atlas),
      );
    } else {
      await gradientMapAtlas(base, atlas, set.themes[model]);
    }
    const render = job.path(`${model}.render.png`);
    await renderSkinThumb(classGlb, atlas, render, { size: 420 });
    built.push({ model, atlas, render, classes: MODEL_CLASSES[model] });
    job.log(`  ${model}: atlas + render ok (classes: ${MODEL_CLASSES[model].join(', ')})`);
  }

  const actions = [];
  if (flag('apply')) {
    for (const { model, atlas, classes } of built) {
      for (const cls of classes) {
        actions.push(...registerClassSkin({ cls, model, texturePath: atlas, suffix: set.suffix }));
      }
    }
    actions.push(
      ...appendCreditsRow({
        assets: `Generated class skin-suit set "${set.label}" (${set.suffix}, all classes)`,
        source: useTripo
          ? 'Project-generated via scripts/asset_pipeline (Tripo AI re-texture + UV composite)'
          : 'Project-generated via scripts/asset_pipeline (procedural gradient-map atlas)',
      }),
    );
    job.log(
      'run: npx vitest run tests/skin_event.test.ts && node scripts/build_media_manifest.mjs generate',
    );
  }
  printReport(job, {
    ok: true,
    set: set.label,
    suffix: set.suffix,
    models: built.map((b) => b.model),
    renders: built.map((b) => b.render),
    actions,
  });
}

async function cmdValidate() {
  const file = opt('file');
  const kind = opt('kind');
  if (!file || !kind) throw new Error('validate needs --file and --kind weapon|prop|creature');
  let result;
  if (kind === 'weapon') {
    const family = weaponFamilyFor(opt('family') ?? file);
    if (!family) throw new Error('pass --family for weapon validation');
    result = await validateWeapon(file, family);
  } else if (kind === 'prop') {
    result = await validateProp(file, { height: Number(opt('height')) || undefined });
  } else if (kind === 'creature') {
    result = await validateCreature(file, {
      requiredClips: (opt('clips') ?? 'Idle,Walk,Run,Attack,Death').split(',').filter(Boolean),
    });
  } else {
    throw new Error(`unknown kind ${kind}`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function cmdPreview() {
  const file = opt('file');
  if (!file) throw new Error('preview needs --file <glb>');
  const outDir = opt('out') ?? resolve(REPO_ROOT, 'tmp/asset_pipeline/preview');
  const files = await renderPreviews(file, outDir);
  console.log(files.join('\n'));
}

async function cmdPreviewHeld() {
  const file = opt('file');
  if (!file) throw new Error('preview-held needs --file <weapon glb>');
  const family = weaponFamilyFor(opt('family') ?? file) ?? weaponFamilyFor('sword');
  const outDir = opt('out') ?? resolve(REPO_ROOT, 'tmp/asset_pipeline/preview');
  const files = await renderHeldPreviews(file, outDir, {
    character: opt('character'),
    lift: family.lift,
    maxHeight: family.maxHeight,
  });
  console.log(files.join('\n'));
}

async function cmdLibrary() {
  const { collectInventory, enrichAssets, emitViewer, serveLibrary, LIBRARY_DIR } = await import(
    './lib/library.mjs'
  );
  console.log('collecting inventory...');
  const only = opt('category');
  const filterByCategory = (list) => {
    if (!only) return list;
    const cats = only.split(',').map((s) => s.trim().toLowerCase());
    return list.filter((a) => cats.some((c) => a.category.toLowerCase().includes(c)));
  };
  const assets = filterByCategory(collectInventory());
  const byCat = {};
  for (const a of assets) byCat[a.category] = (byCat[a.category] ?? 0) + 1;
  console.log(
    `${assets.length} assets: ${Object.entries(byCat)
      .map(([c, n]) => `${c} ${n}`)
      .join(', ')}`,
  );
  console.log('inspecting + rendering thumbnails (content-hash cached; first run takes a while)');
  await enrichAssets(assets, { full: flag('full') });
  const errors = assets.filter((a) => a.error);
  for (const a of errors) console.log(`WARN: ${a.name}: ${a.error}`);
  const out = emitViewer(assets);
  console.log(`\nasset library: ${out}`);
  console.log(
    `${assets.length - errors.length} assets rendered, ${errors.length} errors; thumbs cached under ${LIBRARY_DIR}/thumbs/`,
  );

  if (flag('serve')) {
    const port = Number(opt('port', 5180));
    // Re-inventory + re-emit on each page load so newly generated/applied assets
    // appear on reload without restarting the command (mirrors the initial
    // collect/enrich/emit; both are hash-cached).
    const refresh = async () => {
      const fresh = filterByCategory(collectInventory());
      await enrichAssets(fresh, { log: () => {} });
      emitViewer(fresh);
    };
    const { url } = await serveLibrary({ port, refresh });
    console.log(`\nLIVE viewer serving at ${url}`);
    console.log(
      '  drag to rotate, scroll to zoom, pick animations, toggle "vs player". Ctrl-C to stop.',
    );
    await openInBrowser(url);
    return; // the http server keeps the process alive
  }
  console.log(`open it with your browser: ${out}`);
  if (flag('open')) {
    await openInBrowser(out);
  }
}

// Open a URL/file in the OS browser without ever crashing the caller: the opener
// binary is platform-specific and may be absent (headless Linux), so a missing
// command must be swallowed (async 'error' event), not thrown.
async function openInBrowser(target) {
  const { spawn } = await import('node:child_process');
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [target], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no opener available; the URL/path is printed above for manual use
  }
}

async function cmdQa() {
  const jobId = opt('job');
  if (!jobId) throw new Error('qa needs --job <id>');
  const { runJobQa, printQa } = await import('./lib/qa.mjs');
  const job = Job.open({ job: jobId });
  const r = await runJobQa(job);
  printQa(r);
  if (r.verdict === 'FAIL') process.exitCode = 1;
}

async function cmdStatus() {
  const jobId = opt('job');
  if (jobId) {
    // Job.open validates existence; a bare `new Job` would fabricate an empty
    // ledger directory for a typo'd id.
    const job = Job.open({ job: jobId });
    console.log(JSON.stringify(job.state, null, 2));
    return;
  }
  if (!existsSync(JOBS_ROOT)) {
    console.log('no jobs yet');
    return;
  }
  for (const id of readdirSync(JOBS_ROOT)) {
    try {
      const state = JSON.parse(readFileSync(resolve(JOBS_ROOT, id, 'job.json'), 'utf8'));
      const steps = Object.entries(state.steps ?? {})
        .map(([k, v]) => `${k}:${v.status}`)
        .join(' ');
      console.log(`${id}  ${state.kind ?? '?'}  ${steps}`);
    } catch {
      // not a job dir
    }
  }
}

async function cmdBalance() {
  const b = await tripo.balance();
  console.log(`Tripo balance: ${b.balance} credits (${b.frozen} frozen)`);
}

async function cmdInspect() {
  const file = opt('file');
  if (!file) throw new Error('inspect needs --file <glb>');
  console.log(JSON.stringify(await inspectGlb(file), null, 2));
}

async function cmdInPlaceCheck() {
  const file = opt('file');
  if (!file) throw new Error('inplace-check needs --file <glb>');
  const offenders = await checkInPlace(file);
  console.log(offenders.length ? JSON.stringify(offenders, null, 2) : 'all clips in-place');
  if (offenders.length) process.exitCode = 1;
}

// ---------------------------------------------------------------------------

const COMMANDS = {
  weapon: cmdWeapon,
  prop: cmdProp,
  creature: cmdCreature,
  skin: cmdSkin,
  skinset: cmdSkinset,
  skinmodel: cmdSkinmodel,
  'rig-manual': cmdRigManual,
  validate: cmdValidate,
  preview: cmdPreview,
  'preview-held': cmdPreviewHeld,
  library: cmdLibrary,
  qa: cmdQa,
  status: cmdStatus,
  balance: cmdBalance,
  inspect: cmdInspect,
  'inplace-check': cmdInPlaceCheck,
};

async function main() {
  if (!command || command === '--help' || command === 'help') {
    help();
    return;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    help();
    throw new Error(`unknown command: ${command}`);
  }
  try {
    await fn();
  } finally {
    await closePreview();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
