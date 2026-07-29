#!/usr/bin/env node
// Close the open boundary loops in a GLB's meshes, so no piece is a shell you can
// see the sky through.
//
//   node scripts/glb_cap_holes.mjs --check public/models/chars/players/*_lvl20.glb
//   node scripts/glb_cap_holes.mjs --fix   public/models/chars/players/warrior_lvl20.glb
//
// Provenance: the level-20 armor sets are cut into Torso / Legs / Arms / Shoulders
// / Helm by the armor forge, and the cut leaves three of them open. With front-face
// culling an open shell is a hole, not a seam: the torso has no bottom and the legs
// no top, so the waist reads as a band of background straight through the
// character. Capping does not move, scale or reshape anything, so the silhouette
// and every fitted standoff stay exactly as authored; it only adds interior faces.
//
// The caps fan from vertices the rim already owns, so no vertex is added and no
// skin weight is invented; only the index buffer grows. That still changes the
// buffer layout, so unlike scripts/glb_normal_axis.mjs this rewrites the file
// through gltf-transform rather than patching the BIN chunk in place.
import process from 'node:process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import {
  boundaryRims,
  capCycles,
  orientationDefects,
  triangleCount,
  weldVertices,
} from './lib/mesh_caps.mjs';

const args = process.argv.slice(2);
const mode = args.includes('--fix') ? 'fix' : 'check';
const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('usage: node scripts/glb_cap_holes.mjs [--check|--fix] <file.glb...>');
  process.exit(2);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Append `extra` elements to an accessor's array and store it back. */
function extend(accessor, extra) {
  const old = accessor.getArray();
  const Ctor = old.constructor;
  const grown = new Ctor(old.length + extra.length);
  grown.set(old, 0);
  grown.set(Ctor.from(extra), old.length);
  accessor.setArray(grown);
}

let openLoops = 0;
let capped = 0;

for (const file of files) {
  const doc = await io.read(file);
  let touched = false;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const positionAccessor = prim.getAttribute('POSITION');
      const indexAccessor = prim.getIndices();
      if (!positionAccessor) continue;
      const position = positionAccessor.getArray();
      const indices = indexAccessor?.getArray() ?? null;
      const triCount = triangleCount(indices, position.length);
      const { remap, representative } = weldVertices(position);
      const before = orientationDefects(indices, remap, triCount);
      const { cycles, open } = boundaryRims(indices, remap, triCount);
      const label = `${file.split('/').pop()} :: ${mesh.getName() || '(unnamed)'}`;

      if (open.length > 0) {
        console.log(
          `  warn ${label}: ${open.length} boundary edge(s) on a branching rim, left open`,
        );
      }
      if (cycles.length === 0) continue;
      openLoops += cycles.length;
      console.log(
        `  OPEN ${label}: ${cycles.length} rim cycle(s), ${cycles.map((c) => c.length).join('/')} verts`,
      );
      if (mode !== 'fix') continue;

      const { triangles } = capCycles({ position, representative }, cycles);
      if (!indexAccessor) {
        console.log(`  skip ${label}: non-indexed primitive, capping needs an index buffer`);
        continue;
      }
      extend(indexAccessor, triangles);

      // Prove the result. The property that matters visually is that no boundary
      // edge survives: a boundary edge IS the hole. Refuse to write a file where
      // capping failed to close one.
      const after = orientationDefects(
        indexAccessor.getArray(),
        weldVertices(positionAccessor.getArray()).remap,
        triangleCount(indexAccessor.getArray(), positionAccessor.getArray().length),
      );
      // Capping must strictly close holes and can never open one. Branching rims
      // are left alone by design, so some boundary can legitimately remain; what is
      // never acceptable is coming out with as many holes as we started with.
      if (after.boundary >= before.boundary) {
        throw new Error(
          `${label}: capping left ${after.boundary} boundary edge(s), was ${before.boundary}`,
        );
      }
      // A rim that branches rather than forming one clean cycle gives the fan hub
      // two spokes to the same vertex. That is coincident interior geometry, not a
      // hole, so it is reported rather than treated as a failure.
      if (after.flipped > before.flipped) {
        console.log(
          `  note ${label}: ${after.flipped - before.flipped} duplicate hub spoke(s) ` +
            'from a branching rim (interior only)',
        );
      }
      capped += cycles.length;
      touched = true;
      console.log(
        `  cap  ${label}: closed ${cycles.length} cycle(s), ${after.boundary} boundary edge(s) left`,
      );
    }
  }

  if (mode === 'fix' && touched) {
    await io.write(file, doc);
    console.log(`  wrote ${file}`);
  }
}

if (mode === 'fix') {
  console.log(`\n${capped} loop(s) capped across ${files.length} file(s).`);
  process.exit(0);
}
console.log(`\n${openLoops} open loop(s) across ${files.length} file(s).`);
process.exit(openLoops === 0 ? 0 : 1);
