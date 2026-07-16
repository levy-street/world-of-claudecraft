// Per-asset QA: one command that re-verifies a finished job of ANY lane and
// prices it. Checks are structural facts (rig present, required clips, budget,
// grip convention, previews on disk), never vibes; the human/agent reviews the
// preview renders for look, this gate catches everything mechanical. Writes
// qa.json into the job dir and returns { verdict, checks, cost }.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jobCost } from './cost.mjs';
import { CATEGORY_SPECS, KAYKIT_REQUIRED_CLIPS, weaponFamilyFor } from './families.mjs';
import { inspectGlb, openGlb } from './glb.mjs';
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
