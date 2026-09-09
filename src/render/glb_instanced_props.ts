// The shared GLB-instanced-prop kernel: height-normalized template parts from
// an authored GLB (with a primitive-box fallback while the asset is loading)
// plus the per-(kind x site) InstancedMesh builder.
//
// Extracted at Phase 7 QA on the rule of three: stations.ts, farm_patches.ts
// and gather_nodes.ts each carried this kernel. stations and farm adopt it
// whole; gather_nodes deliberately keeps its own variant (it composes
// per-(part, instance) matrices with per-instance tier scale and base
// anchoring, plus picker userData tables, so the shared shape does not fit;
// see the pointer comment at its instancing loop).
//
// The module deliberately imports NOTHING from ./gfx: the fallback material is
// a caller-supplied factory, so each adopter keeps its own material policy
// (stations routes through its worn-detail cache, farm mints a plain
// surfaceMat) and the graphics-fairness scans stay clean by construction.
import * as THREE from 'three';

export interface GlbTemplatePart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
  /** True when this part carries the caller's accent mesh or material name. */
  accent: boolean;
}

export interface GlbTemplateOptions {
  /** Fallback box proportions: width and depth as a factor of targetHeight. */
  fallbackWidthFactor: number;
  /** Mints the fallback box's material; called only on the fallback arm. */
  makeFallbackMat: () => THREE.Material;
  /** Flag parts whose mesh carries this name as accent parts. */
  accentMeshName?: string;
  /** Flag parts whose material carries this name as accent parts. */
  accentMaterialName?: string;
  /** Per-material mapping applied on the GLB arm (the stations worn-detail
   *  cache). Identity when absent. */
  mapMaterial?: (m: THREE.Material) => THREE.Material;
}

/**
 * The mesh primitives of one authored GLB, height-normalized to targetHeight.
 * Falls back to a single primitive box while the GLB is still loading or
 * absent: the props must draw from the first frame, never wait on an asset.
 */
export function glbTemplateParts(
  loaded: THREE.Group | undefined,
  targetHeight: number,
  opts: GlbTemplateOptions,
): GlbTemplatePart[] {
  if (!loaded) {
    const h = targetHeight;
    const w = h * opts.fallbackWidthFactor;
    return [
      {
        geo: new THREE.BoxGeometry(w, h, w),
        mat: opts.makeFallbackMat(),
        local: new THREE.Matrix4().makeTranslation(0, h / 2, 0),
        accent: false,
      },
    ];
  }
  loaded.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(loaded);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight > 1e-4 ? targetHeight / rawHeight : 1;
  const normalize = new THREE.Matrix4()
    .makeTranslation(0, -box.min.y * scale, 0)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  const isAccentMat = (m: THREE.Material): boolean =>
    opts.accentMaterialName !== undefined && m.name === opts.accentMaterialName;
  const map = opts.mapMaterial;
  const parts: GlbTemplatePart[] = [];
  loaded.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const raw = child.material;
    const named = Array.isArray(raw) ? raw.some(isAccentMat) : isAccentMat(raw);
    parts.push({
      geo: child.geometry,
      mat: map ? (Array.isArray(raw) ? raw.map(map) : map(raw)) : raw,
      local: new THREE.Matrix4().multiplyMatrices(normalize, child.matrixWorld),
      accent: named || (opts.accentMeshName !== undefined && child.name === opts.accentMeshName),
    });
  });
  return parts;
}

/**
 * One InstancedMesh per template part, matrices composed as site x local.
 * `color`, when given, is written per instance via setColorAt (the farm biome
 * tint); omit it for untinted props (stations).
 */
export function addInstancedParts(
  group: THREE.Group,
  name: string,
  parts: readonly GlbTemplatePart[],
  matrices: readonly THREE.Matrix4[],
  scratch: THREE.Matrix4,
  color?: THREE.Color,
): void {
  if (matrices.length === 0) return;
  for (const part of parts) {
    const im = new THREE.InstancedMesh(part.geo, part.mat, matrices.length);
    im.name = name;
    matrices.forEach((m, i) => {
      scratch.multiplyMatrices(m, part.local);
      im.setMatrixAt(i, scratch);
      if (color) im.setColorAt(i, color);
    });
    im.instanceMatrix.needsUpdate = true;
    if (color && im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingBox();
    im.computeBoundingSphere();
    group.add(im);
  }
}
