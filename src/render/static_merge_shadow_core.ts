// Static-merge shadow core: the decisions the props static merge makes once
// castShadow stops being part of its bucket key.
//
// props.ts merges every static prop mesh of a (material, x-half, z-band)
// bucket into one draw. castShadow used to be part of that key, which doubled
// the bucket count on exactly the tiers that run a shadow pass: a bucket's
// casters and its non-casters are the same material and the same program, so
// the split bought a second draw and a second full uniform upload per bucket
// for nothing but a per-mesh boolean.
//
// One bucket instead, ordered casters first, with the shadow pass clipped to
// the caster prefix through geometry.drawRange. three clamps every draw to
// drawRange (WebGLRenderer.renderBufferDirect) and calls the per-object
// onBeforeShadow / onAfterShadow hooks around each shadow draw, so the prefix
// costs the shadow pass nothing while the colour pass, which runs after it
// inside the same render(), still draws the whole merged range. This is the
// merged-mesh twin of shadow_pass_gate_core.ts's count-zero trick: drawRange
// is to a merged Mesh what count is to an InstancedMesh.
//
// The signature helper is the safety half of the same change. Merging is only
// defined over geometries that carry the same attribute set, and a bucket that
// used to be split by castShadow could keep two such sets apart by luck; a
// mismatch makes three's mergeGeometries return null, which would drop the
// whole bucket from the scene. The signature keeps them in separate buckets on
// purpose instead.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/static_merge_shadow_core.test.ts.

/** One mesh about to be merged into a bucket. */
export interface StaticMergeShadowPart {
  readonly castShadow: boolean;
  /** Index elements this part contributes to the merged geometry. */
  readonly indexCount: number;
}

export interface StaticMergeShadowPlan {
  /** Part indices in merge order: casters first, source order kept in each half. */
  readonly order: readonly number[];
  /** Index elements the shadow pass draws (the caster prefix). */
  readonly casterIndexCount: number;
  /** The merged mesh's castShadow flag. */
  readonly castShadow: boolean;
  /** True only for a mixed bucket, the one case that needs the range gate. */
  readonly needsShadowRangeGate: boolean;
}

/**
 * Order a bucket's parts so every shadow caster comes first, and report the
 * index prefix the shadow pass must be clipped to. A bucket that is all
 * casters or all non-casters keeps its source order and needs no gate.
 */
export function planStaticMergeShadow(
  parts: readonly StaticMergeShadowPart[],
): StaticMergeShadowPlan {
  const casters: number[] = [];
  const rest: number[] = [];
  let casterIndexCount = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].castShadow) {
      casters.push(i);
      casterIndexCount += parts[i].indexCount;
    } else {
      rest.push(i);
    }
  }
  const castShadow = casters.length > 0;
  return {
    order: [...casters, ...rest],
    casterIndexCount,
    castShadow,
    needsShadowRangeGate: castShadow && rest.length > 0,
  };
}

/** The geometry half a merged static mesh exposes to the range gate. */
export interface ShadowRangeGeometry {
  setDrawRange(start: number, count: number): void;
}

/** The merged static mesh the range gate is attached to. */
export interface ShadowRangeGatedMesh {
  geometry: ShadowRangeGeometry;
  onBeforeShadow: unknown;
  onAfterShadow: unknown;
  /** The caster prefix, for cost telemetry and for the tests. */
  shadowRangeIndexCount?: number;
}

/**
 * Clip a merged static mesh to its caster prefix for the duration of each
 * shadow draw. Attach only to a bucket that mixes casters and non-casters:
 * the range is restored to the full geometry after every shadow draw, and a
 * frame whose shadow pass never runs simply keeps the full range.
 *
 * CALLER CONTRACT: the merged geometry must be indexed and ordered by
 * planStaticMergeShadow, and its bounding volumes computed over the WHOLE
 * geometry (the shadow frustum test reads the object's bounds, not its
 * draw range, so a caster-only bound would be wrong for the colour pass).
 */
export function attachShadowRangeGate(mesh: ShadowRangeGatedMesh, casterIndexCount: number): void {
  mesh.shadowRangeIndexCount = casterIndexCount;
  mesh.onBeforeShadow = () => {
    mesh.geometry.setDrawRange(0, casterIndexCount);
  };
  mesh.onAfterShadow = () => {
    mesh.geometry.setDrawRange(0, Number.POSITIVE_INFINITY);
  };
}

/** The geometry shape the merge signature is read off. */
export interface StaticMergeSignatureGeometry {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly morphAttributes?: Readonly<Record<string, unknown>>;
}

/**
 * The attribute identity two geometries must share to be mergeable, as a
 * bucket-key fragment. Order-independent, so two geometries that declare the
 * same attributes in a different order still land in one bucket.
 */
export function staticMergeAttributeSignature(geometry: StaticMergeSignatureGeometry): string {
  const attributes = Object.keys(geometry.attributes).sort().join(',');
  const morphs = Object.keys(geometry.morphAttributes ?? {})
    .sort()
    .join(',');
  return morphs ? `${attributes}|${morphs}` : attributes;
}
