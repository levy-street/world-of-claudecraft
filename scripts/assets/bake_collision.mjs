// Bake per-asset collision boxes for the whole placeable catalogue.
//
//   node scripts/assets/bake_collision.mjs
//
// For every GLB under public/models it extracts the world-space triangles,
// normalizes them exactly the way the renderer seats placed models (the
// shared src/render/asset_scale.ts rule: TARGET_HEIGHT per family, base at
// y=0), then voxel-bakes a handful of tight boxes per asset with the shared
// core (src/editor/collision_bake_core.ts - the same code the editor runs at
// model-import time). Type-aware: trees bake trunk-only, ground-cover foliage
// and procedural ids skip (they keep the legacy collide circle).
//
// Emits src/sim/asset_collision.generated.ts: plain sorted data, no
// timestamps, byte-identical across runs on the same inputs (the same
// reproducibility contract as the media manifest / i18n table).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS_DIR = path.join(ROOT, 'public', 'models');
const OUT_FILE = path.join(ROOT, 'src', 'sim', 'asset_collision.generated.ts');

// Bundle the shared TS (bake core + the renderer's normalization rule) the
// same way i18n_build.mjs consumes src TS.
async function loadShared() {
  const entry = `
    export { bakeCategoryFor, bakeCollisionBoxes, bakeOptionsFor, bakeRampSurface } from './src/editor/collision_bake_core';
    export { targetHeightFor } from './src/render/asset_scale';
  `;
  const build = await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
  });
  const b64 = Buffer.from(build.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    // A building's parts twin is addressed node by node (data/prefab_pieces);
    // its collision comes from the installer, never from a whole-file bake.
    else if (name.endsWith('.glb') && !name.endsWith('.parts.glb')) out.push(p);
  }
  return out;
}

function mulMat4Point(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** World-space triangle soup (9 floats/tri) for every TRIANGLES primitive. */
function extractTriangles(doc) {
  const tris = [];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return tris;
  const visit = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4 /* TRIANGLES */) continue;
        const posAcc = prim.getAttribute('POSITION');
        if (!posAcc) continue;
        const pos = posAcc.getArray();
        const stride = posAcc.getElementSize();
        const idxAcc = prim.getIndices();
        const pushVertex = (vi) => {
          const o = vi * stride;
          const [x, y, z] = mulMat4Point(world, pos[o], pos[o + 1], pos[o + 2]);
          tris.push(x, y, z);
        };
        if (idxAcc) {
          const idx = idxAcc.getArray();
          for (let i = 0; i < idx.length; i++) pushVertex(idx[i]);
        } else {
          for (let vi = 0; vi < posAcc.getCount(); vi++) pushVertex(vi);
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const node of scene.listChildren()) visit(node);
  return tris;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

async function main() {
  const shared = await loadShared();
  const { bakeCategoryFor, bakeCollisionBoxes, bakeOptionsFor, bakeRampSurface, targetHeightFor } =
    shared;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const files = walk(MODELS_DIR);
  const entries = new Map();
  const ramps = new Map();
  const skipped = [];
  const flagged = [];
  const t0 = process.hrtime.bigint();
  for (const file of files) {
    const rel = path.relative(MODELS_DIR, file).replaceAll(path.sep, '/');
    const id = rel.replace(/\.glb$/, '');
    const category = bakeCategoryFor(id);
    if (category === 'none') {
      skipped.push(id);
      continue;
    }
    let doc;
    try {
      doc = await io.read(file);
    } catch (e) {
      console.warn(`  ! unreadable ${id}: ${e.message}`);
      continue;
    }
    const tris = extractTriangles(doc);
    if (tris.length < 9) {
      skipped.push(id);
      continue;
    }
    // Normalize exactly like the renderer seats models: uniform scale so the
    // largest dimension lands at the family's target height, base at y=0.
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      minX = Math.min(minX, tris[i]);
      maxX = Math.max(maxX, tris[i]);
      minY = Math.min(minY, tris[i + 1]);
      maxY = Math.max(maxY, tris[i + 1]);
      minZ = Math.min(minZ, tris[i + 2]);
      maxZ = Math.max(maxZ, tris[i + 2]);
    }
    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const norm = targetHeightFor(`/models/${rel}`) / maxDim;
    for (let i = 0; i < tris.length; i += 3) {
      tris[i] *= norm;
      tris[i + 1] = (tris[i + 1] - minY) * norm;
      tris[i + 2] *= norm;
    }
    const size = {
      x: (maxX - minX) * norm,
      y: (maxY - minY) * norm,
      z: (maxZ - minZ) * norm,
    };
    const opts = bakeOptionsFor(category, size, id);
    // Stairs/ramps: a walkable deck instead of blocking boxes. The EMPTY box
    // entry is intentional - it means walk-through (never the legacy circle).
    if (category === 'stairs') {
      const ramp = bakeRampSurface(tris, opts);
      if (!ramp) {
        skipped.push(id);
        continue;
      }
      entries.set(id, []);
      ramps.set(id, {
        cx: round3(ramp.cx),
        cz: round3(ramp.cz),
        hx: round3(ramp.hx),
        hz: round3(ramp.hz),
        axis: ramp.axis,
        yNeg: round3(ramp.yNeg),
        yPos: round3(ramp.yPos),
      });
      continue;
    }
    const boxes = bakeCollisionBoxes(tris, opts);
    // Everything deflated/sliver-dropped away: the asset is too small or thin
    // to ever block fairly. Emit the EMPTY entry (walk-through) instead of
    // falling back to the fat legacy circle - clipping beats blocking.
    if (boxes.length === 0) {
      entries.set(id, []);
      continue;
    }
    if (boxes.length >= opts.maxBoxes) flagged.push(`${id} (${boxes.length} boxes at budget)`);
    entries.set(
      id,
      boxes.map((b) => ({
        x: round3(b.cx),
        y: round3(b.cy),
        z: round3(b.cz),
        hx: round3(b.hx),
        hy: round3(b.hy),
        hz: round3(b.hz),
      })),
    );
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // Deterministic emit: sorted ids, fixed formatting, no timestamps.
  const ids = [...entries.keys()].sort();
  const lines = [];
  lines.push('// GENERATED by scripts/assets/bake_collision.mjs - do not edit by hand.');
  lines.push('// Per-asset baked collision boxes in NORMALIZED world yards (scale 1,');
  lines.push('// base at y=0, model-space axes; placement rotY/scale transform them).');
  lines.push('// Baked from the catalogue GLBs with src/editor/collision_bake_core.ts.');
  lines.push('');
  lines.push('export interface BakedCollisionBox {');
  lines.push('  x: number;');
  lines.push('  y: number;');
  lines.push('  z: number;');
  lines.push('  hx: number;');
  lines.push('  hy: number;');
  lines.push('  hz: number;');
  lines.push('}');
  lines.push('');
  lines.push(
    'export const ASSET_COLLISION: Readonly<Record<string, readonly BakedCollisionBox[]>> = {',
  );
  for (const id of ids) {
    const boxes = entries
      .get(id)
      .map((b) => `{ x: ${b.x}, y: ${b.y}, z: ${b.z}, hx: ${b.hx}, hy: ${b.hy}, hz: ${b.hz} }`)
      .join(', ');
    lines.push(`  '${id}': [${boxes}],`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Walkable stairs/ramp deck in normalized model space (see');
  lines.push(' *  sim/placement_ramps.ts): rises from yNeg at the axis-negative edge');
  lines.push(' *  to yPos at the positive edge. Stairs bake NO blocking boxes. */');
  lines.push('export interface BakedCollisionRamp {');
  lines.push('  cx: number;');
  lines.push('  cz: number;');
  lines.push('  hx: number;');
  lines.push('  hz: number;');
  lines.push("  axis: 'x' | 'z';");
  lines.push('  yNeg: number;');
  lines.push('  yPos: number;');
  lines.push('}');
  lines.push('');
  lines.push('export const ASSET_RAMPS: Readonly<Record<string, BakedCollisionRamp>> = {');
  for (const id of [...ramps.keys()].sort()) {
    const r = ramps.get(id);
    lines.push(
      `  '${id}': { cx: ${r.cx}, cz: ${r.cz}, hx: ${r.hx}, hz: ${r.hz}, axis: '${r.axis}', yNeg: ${r.yNeg}, yPos: ${r.yPos} },`,
    );
  }
  lines.push('};');
  lines.push('');
  fs.writeFileSync(OUT_FILE, lines.join('\n'));
  const totalBoxes = [...entries.values()].reduce((n, b) => n + b.length, 0);
  console.log(
    `baked ${entries.size}/${files.length} assets (${totalBoxes} boxes, ${ramps.size} stair ramps, ${skipped.length} skipped) in ${(ms / 1000).toFixed(1)}s -> ${path.relative(ROOT, OUT_FILE)}`,
  );
  if (flagged.length > 0) {
    console.log(`at box budget (eyeball these in the editor):`);
    for (const f of flagged.slice(0, 20)) console.log(`  - ${f}`);
    if (flagged.length > 20) console.log(`  ... and ${flagged.length - 20} more`);
  }
}

await main();
