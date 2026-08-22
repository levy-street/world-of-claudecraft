// The program SHAPE of a draw: the per-object facts three (0.185.1) re-derives
// a material's program parameters from in WebGLRenderer.setProgram. three
// stores them PER MATERIAL and compares against the CURRENT object at every
// draw, so a material shared between objects of different shape is re-derived
// on every draw (pure JS garbage plus CPU; the program itself stays cached).
// Keying the shared-material cache on the shape stops that. Three-free so a
// plain Vitest can decide a mesh's shape. Keep the reads in step with three's
// getParameters / setProgram if three is bumped.
//
// DELIBERATELY OMITTED: three's `batching` and `batchingColor`, which
// prewarmDepthShapeKey (prewarm_depth_material.ts) and prewarmProgramContentKeys
// (prewarm_policy.ts) both model. This key partitions the CHARACTER tinted
// material cache, and a character mesh is a SkinnedMesh or a plain Mesh; no
// BatchedMesh is constructed anywhere under src/ today. Adding the fields would
// widen every key in the cache for a case that cannot occur, so the first
// BatchedMesh in this tree is what should add them here, not speculation now.
// The three implementations disagreeing is intentional and scoped, not drift.

/** The per-object facts three derives a material's program parameters from.
 *  Object/geometry side only: the material-side halves of three's arms
 *  (normalMap for tangents, vertexColors for alphas) are constant across the
 *  meshes that share one mounted material, so the structural fact decides. */
export interface ProgramShape {
  skinned: boolean;
  instanced: boolean;
  /** three's `instancingColor`, read only on an instanced object. */
  instanceColor: boolean;
  /** three's `instancingMorph`, read only on an instanced object. */
  morphTexture: boolean;
  morphPosition: boolean;
  morphNormal: boolean;
  morphColor: boolean;
  /** three's morphTargetsCount: the length of the FIRST present morph
   *  attribute list, in its position/normal/color precedence order. */
  morphCount: number;
  /** three's `vertexTangents`: a tangent attribute on the geometry. */
  vertexTangents: boolean;
  /** three's `vertexAlphas`: a 4-component color attribute. */
  vertexAlphas: boolean;
}

/** The structural slice of a THREE.Mesh this module reads (three-free). */
export interface ProgramShapeObject {
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  instanceColor?: unknown;
  morphTexture?: unknown;
  geometry?: {
    morphAttributes?: {
      position?: readonly unknown[];
      normal?: readonly unknown[];
      color?: readonly unknown[];
    };
    attributes?: {
      tangent?: unknown;
      color?: { itemSize?: number };
    };
  };
}

const NONE: ProgramShape = {
  skinned: false,
  instanced: false,
  instanceColor: false,
  morphTexture: false,
  morphPosition: false,
  morphNormal: false,
  morphColor: false,
  morphCount: 0,
  vertexTangents: false,
  vertexAlphas: false,
};

/** A short stable string for a shape. Equal shapes give equal keys; any
 *  difference three would re-derive on gives a different one. One fixed
 *  single-letter slot per flag, in declaration order, then the morph count:
 *  `s i C M p n c t a <count>`, each flag's letter when set and `-` when not. */
export function programShapeKey(shape: ProgramShape): string {
  return (
    (shape.skinned ? 's' : '-') +
    (shape.instanced ? 'i' : '-') +
    (shape.instanceColor ? 'C' : '-') +
    (shape.morphTexture ? 'M' : '-') +
    (shape.morphPosition ? 'p' : '-') +
    (shape.morphNormal ? 'n' : '-') +
    (shape.morphColor ? 'c' : '-') +
    (shape.vertexTangents ? 't' : '-') +
    (shape.vertexAlphas ? 'a' : '-') +
    shape.morphCount
  );
}

/** The shape of a mesh, read the way three reads it. */
export function meshProgramShape(object: ProgramShapeObject): ProgramShape {
  const instanced = object.isInstancedMesh === true;
  const attributes = object.geometry?.attributes;
  const base = {
    skinned: object.isSkinnedMesh === true,
    instanced,
    // Strict `!== null`, exactly as WebGLPrograms.getParameters reads these
    // fields (three initialises both to null).
    instanceColor: instanced && object.instanceColor !== null,
    morphTexture: instanced && object.morphTexture !== null,
    vertexTangents: Boolean(attributes?.tangent),
    vertexAlphas: attributes?.color?.itemSize === 4,
  };
  const morphAttributes = object.geometry?.morphAttributes;
  if (!morphAttributes) return { ...NONE, ...base };
  const { position, normal, color } = morphAttributes;
  // three's precedence: position, then normal, then color. `||`, not `??`,
  // mirroring three's own expression: equivalent while a slot is undefined,
  // divergent the day one is null, and this key only stays honest by matching
  // three byte for byte on a version bump.
  const counted = position || normal || color;
  return {
    ...base,
    morphPosition: position !== undefined,
    morphNormal: normal !== undefined,
    morphColor: color !== undefined,
    morphCount: counted !== undefined ? counted.length : 0,
  };
}

/** The shape key of a mesh, the form the material cache keys on. */
export function meshProgramShapeKey(object: ProgramShapeObject): string {
  return programShapeKey(meshProgramShape(object));
}
