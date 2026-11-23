// "Keep this plant": exports a generated plant as a GLB and posts it to the
// dev server, which files it under public/models/generated/ where
// gen_asset_catalog.mjs picks it up on its next run. From that moment it is an
// ordinary catalogue asset, so it batches, bakes collision and publishes like
// any other model.
//
// The decisions (slug, ids, the round-trip payload, every validation) live in
// foliage_bake_core.ts. This is the thin three.js + fetch consumer: the same
// split the editor uses everywhere else, and the reason the interesting half
// is testable without a browser.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildFoliageModel } from '../render/foliage_gen';
import type { FoliageParams } from '../sim/foliage_params';
import {
  type BakeRejection,
  bakedAssetId,
  type FoliageBakeRequest,
  foliageBakeExtras,
  validateBakeRequest,
} from './foliage_bake_core';

export type BakeResult =
  | { ok: true; assetId: string; path: string; bytes: number }
  | { ok: false; reason: BakeRejection | 'export_failed' | 'server'; detail?: string };

/** The dev-only write route. Absent in a production build by construction:
 *  the plugin is registered through configureServer. */
const SAVE_ENDPOINT = '/__studio_asset/save';

// A generated plant draws its leaf cards and grass blades as ONE InstancedMesh
// (that is most of why it is cheap). glTF has no portable equivalent, so the
// bake flattens every instance into real geometry: that is what makes the
// result an ordinary catalogue asset, which the placement batcher then
// re-instances alongside every other copy of it.
//
// What is deliberately NOT carried across: the leaf material's shader-side
// sway and normal bend. Those are onBeforeCompile chunks, which no glTF can
// hold. A placed catalogue asset gets the game's own tree sway instead, which
// is the right wind for an asset rather than for a procedural crown.
const MAX_BAKE_VERTICES = 400_000;

function flattenForExport(source: THREE.Object3D): { object: THREE.Object3D; dispose(): void } {
  const out = new THREE.Group();
  out.name = source.name;
  const owned: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let vertices = 0;
  source.updateMatrixWorld(true);
  source.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const instanced = node as THREE.InstancedMesh;
    if (!instanced.isInstancedMesh) {
      const clone = mesh.geometry.clone();
      clone.applyMatrix4(mesh.matrixWorld);
      owned.push(clone);
      const flatMesh = new THREE.Mesh(clone, mesh.material);
      flatMesh.name = mesh.name;
      flatMesh.visible = true;
      out.add(flatMesh);
      vertices += clone.attributes.position?.count ?? 0;
      return;
    }
    const pieces: THREE.BufferGeometry[] = [];
    for (let i = 0; i < instanced.count; i++) {
      const piece = instanced.geometry.clone();
      instanced.getMatrixAt(i, matrix);
      matrix.premultiply(instanced.matrixWorld);
      piece.applyMatrix4(matrix);
      // Per-instance tint becomes per-vertex colour: it is the whole reason a
      // canopy does not read as one flat green.
      if (instanced.instanceColor) {
        instanced.getColorAt(i, color);
        const count = piece.attributes.position.count;
        const existing = piece.attributes.color;
        const colors = new Float32Array(count * 3);
        for (let v = 0; v < count; v++) {
          const r = existing ? existing.getX(v) : 1;
          const g = existing ? existing.getY(v) : 1;
          const b = existing ? existing.getZ(v) : 1;
          colors[v * 3] = r * color.r;
          colors[v * 3 + 1] = g * color.g;
          colors[v * 3 + 2] = b * color.b;
        }
        piece.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      pieces.push(piece);
      vertices += piece.attributes.position.count;
      if (vertices > MAX_BAKE_VERTICES) break;
    }
    if (pieces.length === 0) return;
    const merged = mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    if (!merged) return;
    owned.push(merged);
    const flatMesh = new THREE.Mesh(merged, instanced.material);
    flatMesh.name = instanced.name;
    flatMesh.visible = true;
    out.add(flatMesh);
  });
  return {
    object: out,
    dispose: () => {
      for (const g of owned) g.dispose();
    },
  };
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: String.fromCharCode over a multi-megabyte spread blows the stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Grow the plant, serialize it, and hand it to the dev server.
 *
 * The model is built fresh here rather than reusing whatever is in the
 * viewport: a placed plant carries its placement transform and the editor's
 * volume overlay, and neither belongs in the asset. The trunk GLB is NOT
 * loaded for the bake, so a baked tree carries its branches and canopy and
 * references the trunk the way the generator does. Trunkless kinds (bush,
 * fern, grass, vine) are complete on their own, which is why they are the
 * kinds this is really for.
 */
export async function bakeFoliageToGlb(
  slug: string,
  label: string,
  params: FoliageParams,
): Promise<BakeResult> {
  const build = buildFoliageModel(params);
  const root = new THREE.Group();
  root.name = slug;
  // GLTFExporter copies userData into the node's `extras`, which is how the
  // source parameters ride along and make the bake re-openable.
  const extras = foliageBakeExtras(slug, label, params);
  root.userData = { ...extras };
  const flat = flattenForExport(build.group);
  root.add(flat.object);
  let glb: ArrayBuffer;
  try {
    glb = await new Promise<ArrayBuffer>((resolve, reject) => {
      new GLTFExporter().parse(
        root,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('expected a binary GLB'));
        },
        reject,
        // onlyVisible: false is load-bearing. The leaf canopy starts hidden
        // and only shows itself once its atlas resolves (tree_gen.ts), so the
        // default would export an empty file for exactly the kinds this is for.
        { binary: true, onlyVisible: false, includeCustomExtensions: true },
      );
    });
  } catch (err) {
    flat.dispose();
    build.dispose();
    return { ok: false, reason: 'export_failed', detail: String(err) };
  }
  flat.dispose();
  build.dispose();

  const req: FoliageBakeRequest = {
    slug,
    label,
    glbBase64: toBase64(glb),
    extras,
  };
  const rejection = validateBakeRequest(req);
  if (rejection) return { ok: false, reason: rejection };

  try {
    const res = await fetch(SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) return { ok: false, reason: 'server', detail: await res.text() };
    const body = (await res.json()) as { path?: string; bytes?: number };
    return {
      ok: true,
      assetId: bakedAssetId(slug),
      path: body.path ?? '',
      bytes: body.bytes ?? glb.byteLength,
    };
  } catch (err) {
    return { ok: false, reason: 'server', detail: String(err) };
  }
}
