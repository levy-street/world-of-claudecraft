// Structural validation gate: a built asset must pass before integration.
// Hard errors block; warnings ship but surface in the job report.
import { CATEGORY_SPECS } from './families.mjs';
import { checkInPlace, inspectGlb } from './glb.mjs';

function pushBudget(report, spec, errors, warnings) {
  if (report.bytes > spec.maxBytes) {
    warnings.push(
      `file is ${(report.bytes / 1024).toFixed(0)}KB, above the ${(spec.maxBytes / 1024).toFixed(0)}KB category norm`,
    );
  }
  if (report.tris > spec.maxTris) {
    errors.push(`${report.tris} tris exceeds the ${spec.maxTris} category cap`);
  }
  for (const t of report.textures) {
    const side = Math.max(t.width, t.height);
    if (side > 1024) {
      errors.push(`texture ${t.name ?? '?'} is ${t.width}x${t.height}, hard cap is 1024`);
    } else if (side > spec.maxTex) {
      warnings.push(
        `texture ${t.name ?? '?'} is ${t.width}x${t.height}, category norm is ${spec.maxTex}`,
      );
    }
  }
}

export async function validateWeapon(path, family) {
  const report = await inspectGlb(path);
  const errors = [];
  const warnings = [];
  pushBudget(report, CATEGORY_SPECS.weapon, errors, warnings);
  const { min, max } = report.bounds;
  const h = max[1] - min[1];
  if (h <= 0) errors.push('zero height');
  if (h > family.maxHeight + 0.05) {
    warnings.push(
      `height ${h.toFixed(2)} exceeds family maxHeight ${family.maxHeight}; the engine clamps ` +
        'oversized weapons down, so it will render smaller than authored',
    );
  }
  const gripFrac = h > 0 ? -min[1] / h : 0;
  if (Math.abs(gripFrac - family.gripFrac) > 0.08) {
    errors.push(
      `grip sits at ${gripFrac.toFixed(2)} of height, family convention is ${family.gripFrac} (origin must be at the grip)`,
    );
  }
  const xz = Math.max(max[0] - min[0], max[2] - min[2]);
  if (xz > h * 1.2)
    warnings.push(
      `unusually wide for a held weapon (xz ${xz.toFixed(2)} vs height ${h.toFixed(2)})`,
    );
  if (report.skins > 0) errors.push('weapon GLBs must be static (found a skin/rig)');
  if (report.clips.length) errors.push('weapon GLBs must not carry animation clips');
  return { ok: errors.length === 0, errors, warnings, report };
}

export async function validateProp(path, { height }) {
  const report = await inspectGlb(path);
  const errors = [];
  const warnings = [];
  pushBudget(report, CATEGORY_SPECS.prop, errors, warnings);
  const { min, max } = report.bounds;
  if (Math.abs(min[1]) > 0.02) errors.push(`base is at y=${min[1].toFixed(3)}, must sit at y=0`);
  if (height && Math.abs(max[1] - min[1] - height) > height * 0.05) {
    warnings.push(`height ${(max[1] - min[1]).toFixed(2)} differs from requested ${height}`);
  }
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  if (Math.hypot(cx, cz) > 0.05 * Math.max(1, max[1] - min[1])) {
    warnings.push(`not centered on origin (offset ${cx.toFixed(2)}, ${cz.toFixed(2)})`);
  }
  return { ok: errors.length === 0, errors, warnings, report };
}

export async function validateCreature(path, { requiredClips = [], spec } = {}) {
  const report = await inspectGlb(path);
  const errors = [];
  const warnings = [];
  pushBudget(report, spec ?? CATEGORY_SPECS.creature, errors, warnings);
  if (report.skins === 0) errors.push('creature GLB has no skin (rigging missing)');
  const clipNames = new Set(report.clips.map((c) => c.name));
  for (const need of requiredClips) {
    if (!clipNames.has(need))
      errors.push(
        `missing required clip "${need}" (a ClipMap name that does not exist renders as T-pose)`,
      );
  }
  for (const c of report.clips) {
    if (c.duration <= 0.01)
      warnings.push(`clip "${c.name}" is ${c.duration}s (suspiciously short)`);
  }
  const offenders = await checkInPlace(path);
  for (const o of offenders) {
    errors.push(
      `clip "${o.clip}" carries ${o.range} units of root XZ motion; clips must be in-place (the sim owns movement)`,
    );
  }
  return { ok: errors.length === 0, errors, warnings, report };
}
