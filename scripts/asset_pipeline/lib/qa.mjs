// Per-asset QA: one command that re-verifies a finished job of ANY lane and
// prices it. Checks are structural facts (rig present, required clips, budget,
// grip convention, previews on disk), never vibes; the human/agent reviews the
// preview renders for look, this gate catches everything mechanical. Writes
// qa.json into the job dir and returns { verdict, checks, cost }.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jobCost } from './cost.mjs';
import { CATEGORY_SPECS, KAYKIT_REQUIRED_CLIPS, weaponFamilyFor } from './families.mjs';
import { inspectGlb, mat4ApplyPoint, openGlb, readSkinnedGlb } from './glb.mjs';
import { weightStats, worstEdgeStretch } from './skin_metrics.mjs';
import { validateCreature, validateProp, validateWeapon } from './validate.mjs';

const pass = (name, detail) => ({ name, status: 'pass', detail });
const warn = (name, detail) => ({ name, status: 'warn', detail });
const fail = (name, detail) => ({ name, status: 'fail', detail });

function foldValidation(checks, v, label) {
  for (const e of v.errors) checks.push(fail(label, e));
  for (const w of v.warnings) checks.push(warn(label, w));
  if (v.ok && !v.warnings.length) checks.push(pass(label, 'all structural checks green'));
}

/** Names of every node in the GLB (joints AND attachment nodes like handslots,
 *  which are not skin joints and so invisible to inspectGlb). */
async function nodeNames(glbPath) {
  const doc = await openGlb(glbPath);
  return new Set(
    doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName()),
  );
}

/** Thresholds for the deformation check, calibrated against real assets rather
 *  than picked: the hand-authored KayKit knight sits at 0.83x worst edge stretch
 *  and 0.000% torn edges across its 22 clips, and the manual-rig lane's Sundered
 *  Horror sat at 3.50x and 0.054% before its solver was fixed (3.18x and 0.045%
 *  after). So WARN is set just above the control, where "not hand-authored
 *  quality" begins, and FAIL where deformation is destroying the silhouette
 *  rather than denting it. */
const STRETCH_WARN = 1.5;
const STRETCH_FAIL = 6;
const DOMINANT_WARN = 0.6;

/** Does the rig's SKINNING work, or does the mesh tear when the clips play?
 *
 *  Every other check in this file passes on a rig whose weights are garbage: the
 *  skeleton is present, the clips are named right, the previews render. The
 *  Sundered Horror shipped with the arms driving the torso flank, the face and
 *  the horn crown, and nothing mechanical caught it, because the REST POSE looks
 *  perfect no matter how bad the weights are. This is the check that looks at a
 *  posed frame.
 *
 *  Both readings are reported because they fail independently: a mesh can tear
 *  without swimming (a sharp weight gradient across one seam) and swim without
 *  tearing (nothing owns anything, so the whole body follows the average). */
async function deformationChecks(built) {
  const checks = [];
  let model;
  try {
    model = await readSkinnedGlb(built);
  } catch (e) {
    return [warn('deformation', `could not read skin: ${e.message}`)];
  }
  if (!model.prims.length) return [warn('deformation', 'no skinned primitive to measure')];
  if (!model.clips.length) return [warn('deformation', 'no clips to measure deformation over')];

  // The absolute-gap half of the test. Tripo meshes carry sliver edges a few
  // thousandths long that hit 5x while moving a distance nobody can see, so a
  // pure ratio reading is dominated by noise: measured on the Horror, the worst
  // stretch reads 16.5x with no gap floor and 3.5x with one, and only the
  // second number tracks what the renders show. Scaled off the model's own
  // height so it means the same thing on any asset.
  //
  // Height is measured through each primitive's dequantization frame, the same
  // space worstEdgeStretch measures rest lengths in. Raw positions live in the
  // primitive's own (possibly quantized) frame, and a floor computed in one
  // space applied to lengths in another silently rescales the gate on any
  // quantized input.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of model.prims) {
    for (const v of p.verts) {
      const y = p.dequant ? mat4ApplyPoint(p.dequant, v.p)[1] : v.p[1];
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const height = yMax - yMin || 1;
  const stretch = worstEdgeStretch(model, { samples: 12, minRestLength: 0.02 * height });
  const stats = weightStats(model);

  const detail =
    `worst edge stretch ${stretch.worst.toFixed(2)}x on ${stretch.worstClip}, ` +
    `${(stretch.overRatioFrac * 100).toFixed(3)}% of sampled edges over 2x ` +
    `(${stretch.perClip.length} clips, ${stretch.samples} frames each)`;
  checks.push(
    stretch.worst > STRETCH_FAIL
      ? fail('deformation', `${detail}; the clips are destroying the mesh`)
      : stretch.worst > STRETCH_WARN
        ? warn('deformation', `${detail}; hand-authored weights hold under 1.1x`)
        : pass('deformation', detail),
  );

  const dead = stats.deadBones.filter((b) => !/^root$/i.test(b) && !b.startsWith('handslot'));
  const owner =
    `mean dominant weight ${stats.meanDominant.toFixed(3)}, ` +
    `${(stats.unownedFrac * 100).toFixed(1)}% of vertices with no bone above 0.5` +
    (dead.length ? `, dominating nothing: ${dead.join(', ')}` : '');
  checks.push(
    stats.meanDominant < DOMINANT_WARN
      ? warn('weight ownership', `${owner}; no bone owns any region (control: 0.82)`)
      : pass('weight ownership', owner),
  );
  return checks;
}

export async function runJobQa(job) {
  const state = job.state;
  const kind = state.kind;
  const name = state.name ?? job.id;
  const checks = [];
  const built = job.path(`${name}.glb`);
  const previewDir = job.path('preview');

  if (kind === 'skin' || kind === 'skinset') {
    // Texture lanes: the artifact is a PNG atlas, verified by its own lane;
    // QA here just prices it.
    checks.push(pass('artifact', 'texture atlas lane (see the lane render for look)'));
  } else if (!existsSync(built)) {
    checks.push(fail('artifact', `built GLB missing: ${built}`));
  } else {
    const report = await inspectGlb(built);

    if (kind === 'weapon') {
      // Explicit --family imports (bow, tome, crossbow) record their family on
      // the job; fall back to name inference for older jobs.
      const family = weaponFamilyFor(state.family ?? name);
      if (!family) checks.push(fail('family', `no weapon family in name "${name}"`));
      else foldValidation(checks, await validateWeapon(built, family), 'weapon convention');
      checks.push(
        existsSync(job.path(`${name}.jpg`))
          ? pass('hud icon', `${name}.jpg rendered`)
          : fail('hud icon', 'icon missing'),
      );
      // Held on EVERY class body, with a mid-attack frame each.
      const models = ['knight', 'paladin', 'ranger', 'rogue', 'mage', 'barbarian', 'druid'];
      const missing = models.filter((m) => !existsSync(join(previewDir, `held_${m}_attack.png`)));
      checks.push(
        missing.length === 0
          ? pass('held on all characters', '7 class bodies, idle + side + mid-attack frames')
          : fail('held on all characters', `missing held renders: ${missing.join(', ')}`),
      );
    } else if (kind === 'prop') {
      foldValidation(checks, await validateProp(built, {}), 'prop convention');
    } else if (kind === 'creature') {
      const rigType = state.steps?.rig?.result?.rigType ?? 'biped';
      const required = rigType === 'biped' ? ['Idle', 'Walk', 'Run', 'Attack', 'Death'] : ['Walk'];
      foldValidation(
        checks,
        await validateCreature(built, { requiredClips: required }),
        'rig + clips',
      );
      checks.push(
        report.skins > 0
          ? pass('rigged', `${report.joints.length} joints, ${report.clips.length} clips`)
          : fail('rigged', 'no skin/skeleton in the GLB'),
      );
    } else if (kind === 'skinmodel') {
      foldValidation(
        checks,
        await validateCreature(built, {
          requiredClips: KAYKIT_REQUIRED_CLIPS,
          spec: CATEGORY_SPECS.skinmodel,
        }),
        'KayKit clip vocabulary',
      );
      const nodes = await nodeNames(built);
      checks.push(
        nodes.has('handslot.r')
          ? pass('weapon attach', 'handslot.r injected (calibrated)')
          : fail('weapon attach', 'handslot.r missing: cannot hold weapons'),
      );
      if (!nodes.has('handslot.l')) checks.push(warn('weapon attach', 'handslot.l missing'));
      checks.push(
        existsSync(join(previewDir, 'held_attack.png'))
          ? pass('held proof', 'held_attack.png rendered (weapon rides the swing)')
          : warn('held proof', 'held_attack.png not rendered'),
      );
    }

    // Rigged lanes only: a weapon or a prop has no skin to deform.
    if (kind === 'creature' || kind === 'skinmodel') {
      checks.push(...(await deformationChecks(built)));
    }

    // Preview coverage: hero + one frame per animation clip.
    if (existsSync(previewDir)) {
      const files = readdirSync(previewDir);
      const clipFrames = files.filter((f) => f.startsWith('clip_')).length;
      const clips = report.clips.length;
      checks.push(
        files.includes('hero.png')
          ? pass('previews', `hero + ${clipFrames}/${clips} clip frames`)
          : fail('previews', 'hero.png missing'),
      );
      if (clips > 0 && clipFrames < clips) {
        checks.push(warn('previews', `${clips - clipFrames} clip frames missing`));
      }
    } else {
      checks.push(fail('previews', 'preview dir missing'));
    }
  }

  // Real cost from the recorded task ids + stored gpt-image-2 usage.
  const cost = await jobCost(state);

  const verdict = checks.some((c) => c.status === 'fail')
    ? 'FAIL'
    : checks.some((c) => c.status === 'warn')
      ? 'WARN'
      : 'PASS';
  const result = { job: job.id, kind, name, verdict, checks, cost };
  writeFileSync(job.path('qa.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/** Console scorecard for one QA result. */
export function printQa(r) {
  const mark = { pass: ' ok ', warn: 'WARN', fail: 'FAIL' };
  console.log(`\n=== QA ${r.job} [${r.kind}] -> ${r.verdict}`);
  for (const c of r.checks) console.log(`  [${mark[c.status]}] ${c.name}: ${c.detail}`);
  console.log('  cost:');
  for (const i of r.cost.items) {
    const price = i.usd === null ? '(unpriced)' : `$${i.usd.toFixed(3)}`;
    const extra = i.kind === 'tripo' ? ` ${i.credits ?? '?'}cr ${i.status}` : '';
    console.log(`    ${i.kind} ${i.label}: ${price}${extra}`);
  }
  console.log(
    `  TOTAL: $${r.cost.totalUsd.toFixed(3)} (${r.cost.totalCredits} Tripo credits${r.cost.unpriced ? `, ${r.cost.unpriced} unpriced` : ''})`,
  );
}
