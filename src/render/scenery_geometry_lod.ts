// Index-only LOD for static zone features. Reuses geometry_lod's source-owned
// variants: no new material, shader, draw or vertex buffer at a distance flip.
import * as THREE from 'three';
import { geometryLodVariant } from './assets/geometry_lod';
import { isSceneryDetailMesh } from './scenery_detail';
import { sceneryUsesCoarseGeometry } from './scenery_geometry_lod_core';
import { type FeatureFootprint, featureEdgeDistance } from './zone_feature_visibility_core';

interface SceneryGeometryEntry {
  mesh: THREE.Mesh;
  source: THREE.BufferGeometry;
  coarse: THREE.BufferGeometry;
  footprint: FeatureFootprint;
  isCoarse: boolean;
}

const entriesByRoot = new WeakMap<THREE.Object3D, SceneryGeometryEntry[]>();

/** Build CPU variants once before the feature's gated attach and matrix freeze.
 * This does not upload indices or prepare VAOs: Three does that on first draw.
 * Missing levels keep the original mesh; shared loader geometry is never edited. */
export function prepareSceneryGeometryLod(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const entries: SceneryGeometryEntry[] = [];
  const box = new THREE.Box3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.geometry;
    const coarse = geometryLodVariant(source, 'far');
    if (coarse === source) return;
    const instanced = mesh as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      instanced.computeBoundingBox();
      if (!instanced.boundingBox) return;
      box.copy(instanced.boundingBox);
    } else {
      if (!source.boundingBox) source.computeBoundingBox();
      if (!source.boundingBox) return;
      box.copy(source.boundingBox);
    }
    box.applyMatrix4(mesh.matrixWorld);
    if (box.isEmpty()) return;
    entries.push({
      mesh,
      source,
      coarse,
      footprint: {
        centerX: (box.min.x + box.max.x) / 2,
        centerZ: (box.min.z + box.max.z) / 2,
        halfX: (box.max.x - box.min.x) / 2,
        halfZ: (box.max.z - box.min.z) / 2,
      },
      isCoarse: false,
    });
  });
  entriesByRoot.set(root, entries);
}

/** Called from the existing visibility sweep, before the world draw. */
export function updateSceneryGeometryLod(
  root: THREE.Object3D,
  camX: number,
  camZ: number,
  farDistance: number,
): void {
  const entries = entriesByRoot.get(root);
  if (!entries) return;
  for (const entry of entries) {
    if (isSceneryDetailMesh(entry.mesh)) continue;
    const coarse = sceneryUsesCoarseGeometry(
      featureEdgeDistance(entry.footprint, camX, camZ),
      farDistance,
      entry.isCoarse,
    );
    if (coarse === entry.isCoarse) continue;
    entry.isCoarse = coarse;
    entry.mesh.geometry = coarse ? entry.coarse : entry.source;
  }
}
