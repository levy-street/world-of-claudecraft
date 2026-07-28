// The battleground field's authored art: every catalogue GLB the Thornhollow
// map placed, drawn as instanced meshes.
//
// One InstancedMesh per (asset, sub-mesh) pair, so a keep wall made of 235
// module copies costs one draw call rather than 235 scene nodes. Placement
// transforms come from the generated field record, which the SAME compiler
// derived the colliders from, so a model and its collision cannot drift.
//
// Seating rule, and it is load-bearing: a model is normalized to
// `targetHeightFor(path) / maxSourceDimension` and then seated so its lowest
// point rests on the placement's precomputed `seatY`. That is exactly what the
// editor's collision bake assumed when it baked the boxes now vendored into
// data/battleground/thornhollow_assets.json.

import * as THREE from 'three';
import { targetHeightFor } from './asset_scale';
import { loadGltf } from './assets/loader';
import type { BgAssetGroup, ThFieldPlacement } from './battleground_core';
import { markSharedMaterial } from './shared_resource';

export interface BgPlacementsView {
  group: THREE.Group;
  dispose(): void;
}

/** Assets whose instances cast the sun shadow on tiers that draw one: the
 *  structures that define the field's silhouette. Clutter and foliage skip it,
 *  the same cosmetic-only split every other subsystem makes. */
const CASTER_PREFIX =
  /^(dungeon\/(wall|pillar|arch|barrier)|city\/|medieval_village_v2\/|biome\/dungeon_arch_stone|props\/(timber_pillar|column_broken))/;

interface SubMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The mesh's transform inside the GLB, relative to the model root. */
  local: THREE.Matrix4;
}

interface Template {
  subs: SubMesh[];
  /** source units -> world yards */
  norm: number;
  /** source-unit lowest point, so the model seats on the ground */
  minY: number;
}

/**
 * Some source packs ship LOD0, LOD1, and LOD2 as simultaneously active
 * meshes. The battleground instancer chooses the authored highest-detail mesh;
 * otherwise every placement would draw all three levels on top of each other.
 */
export function isPrimaryBattlegroundMeshName(name: string): boolean {
  return !/_LOD[1-9]\d*(?:$|[._-])/i.test(name);
}

async function loadTemplate(path: string): Promise<Template | null> {
  const gltf = await loadGltf(path);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const subs: SubMesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isPrimaryBattlegroundMeshName(mesh.name)) return;
    box.expandByObject(mesh, true);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) markSharedMaterial(m);
    subs.push({
      geometry: mesh.geometry,
      material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
      local: mesh.matrixWorld.clone(),
    });
  });
  if (subs.length === 0) return null;
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  return { subs, norm: targetHeightFor(path) / maxDim, minY: box.min.y };
}

/** The world matrix for one placement's model root. */
function rootMatrix(p: ThFieldPlacement, t: Template, out: THREE.Matrix4): THREE.Matrix4 {
  const s = t.norm * (p.scale > 0 ? p.scale : 1);
  const sy = s * (p.scaleY ?? 1);
  const pos = new THREE.Vector3(p.x, p.seatY - t.minY * sy, p.z);
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(p.rotX ?? 0, p.rotY, p.rotZ ?? 0),
  );
  const scl = new THREE.Vector3(s * (p.scaleX ?? 1), sy, s * (p.scaleZ ?? 1));
  return out.compose(pos, quat, scl);
}

/**
 * Build every authored placement. Groups whose GLB fails to load are skipped
 * with a warning rather than failing the field: a missing prop must never cost
 * a player their match.
 */
export async function buildBattlegroundPlacements(
  groups: readonly BgAssetGroup[],
  opts: { lowGfx: boolean },
): Promise<BgPlacementsView> {
  const group = new THREE.Group();
  group.name = 'battleground-placements';
  const meshes: THREE.InstancedMesh[] = [];

  const templates = await Promise.all(
    groups.map((g) =>
      loadTemplate(g.path).catch((err) => {
        console.warn(`battleground: placement asset failed '${g.assetId}'`, err);
        return null;
      }),
    ),
  );

  const root = new THREE.Matrix4();
  const full = new THREE.Matrix4();
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const t = templates[gi];
    if (!t) continue;
    const caster = !opts.lowGfx && CASTER_PREFIX.test(g.assetId);
    for (const sub of t.subs) {
      const mesh = new THREE.InstancedMesh(sub.geometry, sub.material, g.placements.length);
      for (let i = 0; i < g.placements.length; i++) {
        rootMatrix(g.placements[i], t, root);
        full.multiplyMatrices(root, sub.local);
        mesh.setMatrixAt(i, full);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = caster;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      meshes.push(mesh);
      group.add(mesh);
    }
  }

  return {
    group,
    dispose() {
      // Geometry and materials belong to the shared GLB cache: dispose only
      // the instance buffers this view created.
      for (const m of meshes) m.dispose();
      group.clear();
    },
  };
}
