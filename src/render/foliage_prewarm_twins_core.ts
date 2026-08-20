// Program identity of one live foliage draw, and the prewarm twin set derived
// from a description of every such draw (foliage.ts
// buildFoliageMaterialPrewarmGroup, and the bucket reveal-gate keys, which are
// the same identity).
//
// The group used to dedup by MATERIAL alone, so it linked exactly one variant
// per species material while the live buckets draw that material through
// several: the far-trunk proxy geometry, the vertex-coloured rock colorways,
// the merged boulder cluster, and any model variant whose GLB ships a
// different attribute set. Each of those is its own entry in three's program
// cache (WebGLPrograms.getParameters keys on `instancing`, `instancingColor`,
// `vertexAlphas` (a VEC4 `color`), `vertexTangents` and the active uv channels
// on top of the material), so an uncovered one links synchronously on the frame
// that first draws it: the measured never-compiled Bark/Leaves rows on a
// mid-travel zone entry.
//
// `castShadow` is deliberately NOT one of the key's dimensions: three reads it
// nowhere in getParameters. It decides whether the object ALSO renders through
// the depth material, a second program. So it never splits a twin, it only
// turns that twin's shadow arm on, and only when some live path on the same
// program really casts (a twin that casts where no live mesh does would link a
// depth variant nothing ever draws). `receiveShadow` rides along the same way.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/foliage_material_prewarm_group.test.ts.

/** One live foliage draw, reduced to the inputs three's program cache reads. */
export interface FoliageDrawPath {
  /** Stable identity of the material instance (three keys per material). */
  materialKey: string;
  /** `<name>:<itemSize>` per geometry attribute, order-insensitive. */
  attributes: readonly string[];
  /** False for a plain THREE.Mesh draw, true for an InstancedMesh. */
  instanced: boolean;
  /** InstancedMesh.instanceColor present (USE_INSTANCING_COLOR). */
  instanceColor: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
}

/** `<name>:<itemSize>` per geometry attribute, the form FoliageDrawPath wants.
 *  Structurally typed over three's `geometry.attributes` so this core stays
 *  three-free. */
export function foliageAttributeList(
  attributes: Readonly<Record<string, { itemSize: number }>>,
): string[] {
  return Object.entries(attributes).map(([name, attr]) => `${name}:${attr.itemSize}`);
}

/** Order-insensitive signature of a geometry's attribute set. */
export function foliageAttributeSignature(attributes: readonly string[]): string {
  return [...attributes].sort().join(',');
}

/** The program a draw path binds. Two paths sharing this key provably share a
 *  program, so one twin covers both; two paths differing in it do not. */
export function foliageProgramKey(path: FoliageDrawPath): string {
  const kind = path.instanced ? (path.instanceColor ? 'instanced+color' : 'instanced') : 'mesh';
  return `${path.materialKey}|${kind}|${foliageAttributeSignature(path.attributes)}`;
}

/**
 * The twin set for a described live foliage build: one twin per distinct
 * program, carrying the union of the shadow arms every live path on that
 * program uses. Input order decides output order, so the twins come out in the
 * order the world builds them.
 */
export function foliagePrewarmTwins(paths: readonly FoliageDrawPath[]): FoliageDrawPath[] {
  const byKey = new Map<string, FoliageDrawPath>();
  for (const path of paths) {
    const key = foliageProgramKey(path);
    const twin = byKey.get(key);
    if (!twin) {
      byKey.set(key, { ...path, attributes: [...path.attributes] });
      continue;
    }
    if (path.castShadow) twin.castShadow = true;
    if (path.receiveShadow) twin.receiveShadow = true;
  }
  return [...byKey.values()];
}
