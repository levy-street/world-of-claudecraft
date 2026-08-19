// The shadow-depth material factory the compile gate's shadow arm swaps onto a
// caster before compileAsync, so the exact depth program three's WebGLShadowMap
// will draw is linked ahead of the caster's first shadow draw (a plain
// compileAsync never enumerates the renderer-owned shadow material). Extracted
// from renderer.ts so the derivation is a pure, testable contract against three
// rather than a method on the renderer's private state.
//
// Two contracts, both pinned by tests/prewarm_depth_material.test.ts:
//
// 1. SAME PROGRAM AS THE SHADOW PASS. three 0.185's WebGLShadowMap builds its
//    shared `_depthMaterial = new MeshDepthMaterial()` and copies side, map,
//    alphaMap, alphaTest (0.5 under alphaToCoverage), displacement*, wireframe
//    onto it; it never sets depthPacking, so the pass draws the DEFAULT
//    BasicDepthPacking variant (shadows sample a native depth texture through
//    sampler2DShadow, nothing unpacks RGBA any more). depthPacking sits in the
//    program cache key, so a prewarm material that overrides it links a program
//    the shadow pass never asks for, and every caster relinks cold at its first
//    shadow draw. That was the case between the three 0.165 -> 0.185 bump and
//    this module: production traces booked 1196 / 662 / 211 / 129 ms single
//    frames on character shadow programs. Never set depthPacking here; if a
//    three bump changes WebGLShadowMap's material, the source pin reds and the
//    derivation gets re-read from three, not guessed.
//
// 2. ONE MATERIAL INSTANCE PER DEPTH PROGRAM. three keeps a single
//    `currentProgram` slot per material, and compileAsync polls only that slot,
//    so a depth material shared across casters whose programs differ (skinning,
//    morph target count, instancing) starts N links and awaits only the last:
//    the others are linked in flight but never awaited, so their first draw
//    waits synchronously on the link exactly as if nothing had compiled them.
//    The cache key therefore folds in the mesh-derived program parameters, not
//    just the material-derived ones.
//
// Scope: the directional sun is the only shadow-casting light (no point-light
// shadows), so three's MeshDistanceMaterial arm of getDepthMaterial is never
// drawn and is deliberately not modelled here; enabling point-light shadows
// would need a distance-material twin of this factory.
import * as THREE from 'three';
import type { TextureBackedMaterial } from './renderer_diagnostics';

/** The mesh-side program parameters three folds into a depth program's cache
 *  key (WebGLPrograms.getParameters): skinning, instancing (+ colour and
 *  morph textures), batching (+ colour), the morph attribute set + count, and
 *  whether the geometry carries a normal attribute (`vertexNormals`).
 *  `hasPositionAttribute` is left out: a caster without positions draws
 *  nothing. Two casters that differ on any of these need distinct prewarm
 *  materials so compileAsync awaits both programs. */
export function prewarmDepthShapeKey(mesh: THREE.Object3D): string {
  const object = mesh as THREE.Object3D & {
    isSkinnedMesh?: boolean;
    isInstancedMesh?: boolean;
    isBatchedMesh?: boolean;
    instanceColor?: unknown;
    morphTexture?: unknown;
    _colorsTexture?: unknown;
    geometry?: THREE.BufferGeometry;
  };
  const morph = object.geometry?.morphAttributes ?? {};
  const morphAttribute = morph.position ?? morph.normal ?? morph.color;
  // Strict `!== null`, exactly as WebGLPrograms.getParameters reads these
  // fields (three initialises all three to null; an undefined would flip the
  // parameter on three's side too, so mirror it rather than paper over it).
  return [
    object.isSkinnedMesh === true ? 'skin' : 'rigid',
    object.isInstancedMesh === true ? 'inst' : '',
    object.isInstancedMesh === true && object.instanceColor !== null ? 'instColor' : '',
    object.isInstancedMesh === true && object.morphTexture !== null ? 'instMorph' : '',
    object.isBatchedMesh === true ? 'batch' : '',
    object.isBatchedMesh === true && object._colorsTexture !== null ? 'batchColor' : '',
    morph.position !== undefined ? 'mp' : '',
    morph.normal !== undefined ? 'mn' : '',
    morph.color !== undefined ? 'mc' : '',
    String(morphAttribute?.length ?? 0),
    object.geometry?.attributes.normal ? 'vn' : '',
  ].join(':');
}

/** A texture's program-relevant identity for the key: presence, plus the uv
 *  channel three folds into the cache key as `mapUv` / `alphaMapUv` /
 *  `displacementMapUv` (two casters whose maps sit on different channels need
 *  two depth programs). */
function textureKey(texture: THREE.Texture | null | undefined): string {
  return texture ? `1@${texture.channel ?? 0}` : '0';
}

/** The material-side inputs of the shadow pass's depth material, exactly the
 *  ones WebGLShadowMap.getDepthMaterial copies from the caster's material. */
export function prewarmDepthMaterialKey(source: THREE.Material, mesh: THREE.Object3D): string {
  const textured = source as TextureBackedMaterial & { wireframe?: boolean };
  return [
    prewarmDepthShadowSide(source),
    textureKey(textured.map),
    textureKey(textured.alphaMap),
    source.alphaToCoverage || source.alphaTest > 0 ? 1 : 0,
    textureKey(textured.displacementMap),
    textured.wireframe ? 1 : 0,
    prewarmDepthShapeKey(mesh),
  ].join('|');
}

/** WebGLShadowMap's side flip for the non-VSM shadow types (the renderer uses
 *  PCFShadowMap): an explicit shadowSide wins, else Front <-> Back, Double stays. */
export function prewarmDepthShadowSide(source: THREE.Material): THREE.Side {
  return (
    source.shadowSide ??
    (source.side === THREE.FrontSide
      ? THREE.BackSide
      : source.side === THREE.BackSide
        ? THREE.FrontSide
        : THREE.DoubleSide)
  );
}

/**
 * A cached MeshDepthMaterial equivalent to what the shadow pass derives from
 * `source` on `mesh`. One instance per (material inputs x mesh shape) so every
 * depth program a caster set needs has its own compileAsync-awaited material.
 * depthPacking is deliberately left at three's default: see the header.
 */
export function prewarmDepthMaterial(
  cache: Map<string, THREE.MeshDepthMaterial>,
  source: THREE.Material,
  mesh: THREE.Object3D,
): THREE.MeshDepthMaterial {
  const key = prewarmDepthMaterialKey(source, mesh);
  const cached = cache.get(key);
  if (cached) return cached;
  const textured = source as TextureBackedMaterial & {
    displacementScale?: number;
    displacementBias?: number;
    wireframe?: boolean;
  };
  const depth = new THREE.MeshDepthMaterial({
    side: prewarmDepthShadowSide(source),
    map: textured.map ?? null,
    alphaMap: textured.alphaMap ?? null,
    alphaTest: source.alphaToCoverage ? 0.5 : source.alphaTest,
    displacementMap: textured.displacementMap ?? null,
    displacementScale: textured.displacementScale ?? 1,
    displacementBias: textured.displacementBias ?? 0,
    wireframe: textured.wireframe ?? false,
  });
  depth.name = `prewarm-depth:${key}`;
  cache.set(key, depth);
  return depth;
}
