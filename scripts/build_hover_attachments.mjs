// Package the Tripo-generated hover attachments (scripts/asset_pipeline prop
// lane) into game-ready back-attachment GLBs under public/models/cosmetics/.
//
// Wing models are first baked into ONE canonical frame, because Tripo props
// come out with the wing plane on an arbitrary horizontal axis (the first
// batch spread along Z, which mounted PERPENDICULAR to the back, and the
// left/right split along the thin axis produced a full pair plus a ghost
// shell, the "doubled wings" bug):
//   - wings spread along +-X (the larger horizontal extent is rotated onto X)
//   - thickness along Z, visible face toward +Z (per-model FACE_FLIP below)
//   - centered on the origin on all three axes (the hinge is the model
//     center, so the mount y-offset places the wing MIDLINE at the chest)
// Then every triangle goes to the side its centroid lies on (`wing.l` /
// `wing.r`, index-buffer split over the baked vertex data) so the renderer
// can flap the halves about the central hinge. The jetpack is a single rigid
// `core` node (its motion is VFX, not geometry).
//
//   node scripts/build_hover_attachments.mjs \
//     tmp/asset_pipeline/prop_hover_butterfly_wings_<id>/hover_butterfly_wings.glb \
//     tmp/asset_pipeline/prop_hover_angel_wings_<id>/hover_angel_wings.glb \
//     tmp/asset_pipeline/prop_hover_dragon_wings_<id>/hover_dragon_wings.glb \
//     tmp/asset_pipeline/prop_hover_jetpack_<id>/hover_jetpack.glb
//
// Output: public/models/cosmetics/<basename>.glb

import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'public/models/cosmetics');

const WING_MODELS = new Set(['hover_butterfly_wings', 'hover_angel_wings', 'hover_dragon_wings']);
// After the spread axis is rotated onto X the visible (textured/convex) face
// must point +Z; models whose face lands on -Z get an extra 180 degree yaw.
// Set per model by eyeballing the rebuilt GLB in the probe frames.
const FACE_FLIP = new Set([]);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const sources = process.argv.slice(2);
if (sources.length === 0) {
  console.error('usage: node scripts/build_hover_attachments.mjs <prop.glb> [...]');
  process.exit(1);
}

/** Rotate (x, z) by `quarterTurns` x 90deg about +Y, in place, then subtract
 *  `center` from POSITION (directions like NORMAL/TANGENT rotate only). */
function bakeVertices(doc, quarterTurns, center) {
  const seen = new Set();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const [name, translate] of [
        ['POSITION', true],
        ['NORMAL', false],
        ['TANGENT', false],
      ]) {
        const attr = prim.getAttribute(name);
        if (!attr || seen.has(attr)) continue;
        seen.add(attr);
        const a = attr.getArray();
        const stride = attr.getElementSize();
        for (let i = 0; i + 2 < a.length; i += stride) {
          let x = a[i];
          let z = a[i + 2];
          for (let t = 0; t < quarterTurns; t++) {
            const nx = z;
            const nz = -x;
            x = nx;
            z = nz;
          }
          a[i] = x - (translate ? center[0] : 0);
          a[i + 1] = a[i + 1] - (translate ? center[1] : 0);
          a[i + 2] = z - (translate ? center[2] : 0);
        }
        attr.setArray(a);
      }
    }
  }
}

function sceneBounds(doc) {
  const min = [1e9, 1e9, 1e9];
  const max = [-1e9, -1e9, -1e9];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const a = pos.getArray();
      for (let i = 0; i + 2 < a.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          if (a[i + k] < min[k]) min[k] = a[i + k];
          if (a[i + k] > max[k]) max[k] = a[i + k];
        }
      }
    }
  }
  return { min, max };
}

for (const source of sources) {
  const key = basename(source).replace(/\.glb$/, '');
  const doc = await io.read(source);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  // The prop lane bakes its normalize into the vertices and leaves node
  // transforms as identity, so the vertex-space edits below see world
  // geometry. Guard that assumption rather than silently mis-baking.
  for (const node of root.listNodes()) {
    const t = node.getTranslation();
    const r = node.getRotation();
    const s = node.getScale();
    const identity =
      t.every((v) => Math.abs(v) < 1e-6) &&
      Math.abs(r[3] - 1) < 1e-6 &&
      s.every((v) => Math.abs(v - 1) < 1e-6);
    if (!identity) throw new Error(`${key}: node ${node.getName()} has a non-identity transform`);
  }

  if (WING_MODELS.has(key)) {
    // 1. Canonical frame: spread on X. If the wing plane spreads along Z
    //    (larger horizontal extent), one quarter turn maps Z onto X; the
    //    optional FACE_FLIP adds two more quarter turns (180deg yaw).
    let { min, max } = sceneBounds(doc);
    const extX = max[0] - min[0];
    const extZ = max[2] - min[2];
    let quarterTurns = extZ > extX ? 1 : 0;
    if (FACE_FLIP.has(key)) quarterTurns += 2;
    if (quarterTurns % 4 > 0) bakeVertices(doc, quarterTurns % 4, [0, 0, 0]);

    // 2. Center on the origin (hinge = model center on every axis).
    ({ min, max } = sceneBounds(doc));
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    bakeVertices(doc, 0, center);

    // 3. Split every primitive's triangles by centroid x into wing.l/wing.r.
    const buffer = root.listBuffers()[0];
    const leftMesh = doc.createMesh('wing.l');
    const rightMesh = doc.createMesh('wing.r');
    for (const mesh of root.listMeshes()) {
      if (mesh === leftMesh || mesh === rightMesh) continue;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const indices = prim.getIndices();
        if (!pos || !indices) continue;
        const p = pos.getArray();
        const idx = indices.getArray();
        const left = [];
        const right = [];
        for (let i = 0; i + 2 < idx.length; i += 3) {
          const cx = (p[idx[i] * 3] + p[idx[i + 1] * 3] + p[idx[i + 2] * 3]) / 3;
          (cx < 0 ? left : right).push(idx[i], idx[i + 1], idx[i + 2]);
        }
        // gltf wing.l = the -x half; the renderer only needs two mirrored
        // halves hinged at x=0, so which real-world side is "left" is moot.
        for (const [half, target] of [
          [left, leftMesh],
          [right, rightMesh],
        ]) {
          if (half.length === 0) continue;
          const acc = doc
            .createAccessor()
            .setArray(new Uint32Array(half))
            .setType('SCALAR')
            .setBuffer(buffer);
          const clone = prim.clone().setIndices(acc);
          target.addPrimitive(clone);
        }
      }
    }
    // A sane split puts a comparable share of triangles on each side; a badly
    // oriented model (or a one-winged generation) fails loudly here instead
    // of shipping the doubled-wing bug again.
    const triCount = (mesh) =>
      mesh.listPrimitives().reduce((n, pr) => n + (pr.getIndices()?.getCount() ?? 0) / 3, 0);
    const lTris = triCount(leftMesh);
    const rTris = triCount(rightMesh);
    const share = Math.min(lTris, rTris) / Math.max(lTris, rTris);
    if (!(share > 0.25)) {
      throw new Error(
        `${key}: lopsided wing split (${lTris} vs ${rTris} tris); spread axis not on X?`,
      );
    }

    // 4. Replace the scene graph: one parent with the two wing nodes at the
    //    origin hinge, preserving nothing else.
    for (const node of scene.listChildren()) node.dispose();
    for (const mesh of root.listMeshes()) {
      if (mesh !== leftMesh && mesh !== rightMesh) mesh.dispose();
    }
    const l = doc.createNode('wing.l').setMesh(leftMesh);
    const r = doc.createNode('wing.r').setMesh(rightMesh);
    scene.addChild(l).addChild(r);
    console.log(
      `${key}: baked spread->X (${quarterTurns % 4} quarter turns), split ${lTris}/${rTris} tris`,
    );
  } else {
    // Rigid attachment: collapse to one named node so the renderer can find it.
    const holder = doc.createNode('core');
    for (const node of scene.listChildren()) {
      scene.removeChild(node);
      holder.addChild(node);
    }
    scene.addChild(holder);
  }

  await doc.transform(prune(), dedup());
  const out = resolve(OUT_DIR, `${key}.glb`);
  await io.write(out, doc);
  const nodes = root
    .listNodes()
    .map((n) => n.getName())
    .filter(Boolean);
  console.log(`wrote ${out} (nodes: ${nodes.join(', ')})`);
}
