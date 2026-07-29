#!/usr/bin/env node
// Audit (and repair) GLB meshes whose NORMAL attribute sits in a different axis
// space than their POSITION attribute.
//
//   node scripts/glb_normal_axis.mjs --check public/models/chars/players/*.glb
//   node scripts/glb_normal_axis.mjs --fix   public/models/chars/players/warrior_lvl20.glb
//
// --check reports and exits non-zero when any primitive is mis-axed; --fix rewrites
// only those primitives' normals, in place in the BIN chunk, so a repaired file is
// byte-identical to the original apart from the numbers that were wrong.
//
// The detection math lives in scripts/lib/normal_axis.mjs, so the Vitest guard
// (tests/character_normal_axis.test.ts) measures exactly what this repairs.
//
// Provenance: the level-20 armor sets are FBX-derived and Z-up at source. Their
// export applied the Z-up to Y-up rotation to POSITION but ran it one extra time
// over NORMAL, leaving every normal rotated -90 degrees about X. Shape, UVs and
// texture were all correct, so the only symptom was shading: N dot V collapsed to
// about zero over the whole surface, which pinned the character rim-glow term
// (addRimGlow in src/render/gfx.ts) at full strength and washed the armor out to a
// flat pale blue-grey. Run --check on anything the armor forge emits.
import process from 'node:process';
import {
  accessorSpan,
  readAccessor,
  readGlb,
  writeFloatAccessor,
  writeGlb,
} from './lib/glb_binary.mjs';
import { bestAxisCorrection, correctionByName, rotateNormalsInPlace } from './lib/normal_axis.mjs';

const args = process.argv.slice(2);
const mode = args.includes('--fix') ? 'fix' : 'check';
const verbose = args.includes('--verbose');
const files = args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error(
    'usage: node scripts/glb_normal_axis.mjs [--check|--fix] [--verbose] <file.glb...>',
  );
  process.exit(2);
}

/** Every (mesh, primitive) that carries both POSITION and NORMAL, with a label. */
function primitives(json) {
  const out = [];
  for (const [mi, mesh] of (json.meshes ?? []).entries()) {
    for (const [pi, prim] of (mesh.primitives ?? []).entries()) {
      const position = prim.attributes?.POSITION;
      const normal = prim.attributes?.NORMAL;
      if (position === undefined || normal === undefined) continue;
      const many = (mesh.primitives ?? []).length > 1;
      out.push({
        label: `${mesh.name ?? `mesh${mi}`}${many ? `#${pi}` : ''}`,
        position,
        normal,
        indices: prim.indices,
      });
    }
  }
  return out;
}

let offenders = 0;
let repaired = 0;
let skipped = 0;

for (const file of files) {
  let glb;
  try {
    glb = readGlb(file);
  } catch (err) {
    console.log(`  skip ${file}: ${err.message}`);
    skipped++;
    continue;
  }
  const { json, bin } = glb;
  const fixes = [];

  for (const prim of primitives(json)) {
    let geometry;
    try {
      geometry = {
        position: readAccessor(json, bin, prim.position),
        normal: readAccessor(json, bin, prim.normal),
        index: prim.indices === undefined ? null : readAccessor(json, bin, prim.indices),
      };
    } catch (err) {
      // A compressed or quantised mesh cannot be measured (or patched) here; say so
      // rather than passing it silently, which would read as a clean bill of health.
      console.log(`  skip ${file} :: ${prim.label}: ${err.message}`);
      skipped++;
      continue;
    }
    const verdict = bestAxisCorrection(geometry);
    if (verdict.healthy) {
      if (verbose)
        console.log(`  ok   ${file} :: ${prim.label} identity=${verdict.identity.toFixed(3)}`);
      continue;
    }
    offenders++;
    console.log(
      `  BAD  ${file} :: ${prim.label} identity=${verdict.identity.toFixed(3)} ` +
        `best=${verdict.best}@${verdict.bestScore.toFixed(3)}`,
    );
    fixes.push({ ...prim, verdict, normals: geometry.normal });
  }

  if (mode !== 'fix' || fixes.length === 0) continue;

  // A NORMAL accessor shared with a primitive we are NOT fixing would be corrupted
  // by an in-place write, so prove exclusivity before touching a byte.
  const fixIds = new Set(fixes.map((f) => f.normal));
  const keepSpans = primitives(json)
    .filter((p) => !fixIds.has(p.normal))
    .map((p) => accessorSpan(json, p.normal))
    .filter(Boolean);
  let conflict = null;
  for (const f of fixes) {
    const span = accessorSpan(json, f.normal);
    for (const keep of keepSpans) {
      if (keep.view === span.view && keep.start < span.end && span.start < keep.end) {
        conflict = `${f.label}: NORMAL accessor ${f.normal} overlaps a primitive that is already correct`;
      }
    }
  }
  if (conflict) {
    console.log(`  skip ${file}: ${conflict}`);
    skipped++;
    continue;
  }

  let wrote = false;
  for (const f of fixes) {
    const correction = correctionByName(f.verdict.best);
    if (!correction || correction.isIdentity) {
      console.log(`  skip ${file} :: ${f.label}: no axis rotation explains it, inspect by hand`);
      skipped++;
      continue;
    }
    try {
      writeFloatAccessor(json, bin, f.normal, rotateNormalsInPlace(f.normals, correction));
    } catch (err) {
      console.log(`  skip ${file} :: ${f.label}: ${err.message}`);
      skipped++;
      continue;
    }
    repaired++;
    wrote = true;
    console.log(`  fix  ${file} :: ${f.label} normals rotated by ${correction.name}`);
  }
  if (wrote) {
    writeGlb(file, glb);
    console.log(`  wrote ${file}`);
  }
}

// A meshopt-compressed primitive cannot be measured or patched by the raw reader,
// so say how many were passed over rather than letting a clean summary imply full
// coverage. tests/character_normal_axis.test.ts decodes those via MeshoptDecoder
// and is the authority on the whole chars/players tree.
const coverage =
  skipped === 0
    ? ''
    : `\n${skipped} primitive(s) could not be read here (compressed or quantised); ` +
      'tests/character_normal_axis.test.ts covers those.';

if (mode === 'fix') {
  console.log(`\n${repaired} primitive(s) repaired across ${files.length} file(s).${coverage}`);
  process.exit(0);
}
console.log(`\n${offenders} mis-axed primitive(s) across ${files.length} file(s).${coverage}`);
process.exit(offenders === 0 ? 0 : 1);
