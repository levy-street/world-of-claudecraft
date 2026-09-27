// The program a (material, object) draw links, as a dedupe key: two draws with
// one signature link one program set, so a pool of per-slot material clones
// compiles as ONE unit and one proof covers every clone (three hands a clone
// the already-linked program on its first draw: WebGLRenderer.getProgram looks
// the cache key up in WebGLPrograms.acquireProgram, which returns the existing
// WebGLProgram, and only a new WebGLProgram calls gl.linkProgram).
//
// Built from the two halves prewarm_policy.ts already keys on,
// materialProgramSignature and prewarmProgramContentKeys, plus the r185
// program cache key inputs neither reads, which the ability-VFX pools do
// carry (Points, lines and sprites; tone-mapping opt-outs; size attenuation;
// two-pass DoubleSide transparency):
//   - material: toneMapped, sizeAttenuation, wireframe (flatShading and the
//     bump map bit), forceSinglePass (whether a transparent DoubleSide draw
//     links the back and front programs or one), precision, the uv channel
//     of every texture slot, normalMapType and a packed (RG) normal map,
//     video map and emissive map, combine, matcap, the env map's mapping,
//     depthPacking, the physical feature scalars, glslVersion, the
//     clip-cull / multi-draw extensions and the local clipping plane count;
//   - object: the draw kind (mesh, points, line, sprite; conservative, since
//     three splits on it only through pointsUvs), pointsUvs itself, instanced
//     morphs, batched colours, morph normal and colour presence (three keys
//     presence, an empty array included), and position presence.
// Not covered, because no pool produces it: envMapCubeUVHeight (the env
// texture's own height). Scene inputs (lights, fog, global clipping, shadows,
// render target, tone mapping) are not here: they are one state for every
// draw of the renderer, because the light census is fixed after boot, point
// lights ride the pad budget and the shadow switch is read once from the tier
// (src/render/CLAUDE.md, "GPU work"). That is load-bearing for the dedupe: a
// clone that was never compiled takes its program at its first draw, under
// the live scene state, while its representative kept the one it compiled
// with (an unlit material is never re-keyed on a light change), so a scene
// input changed after boot would link that clone live however the gate
// answered. Draw-time `onBeforeCompile` hooks are keyed by their identity
// (customProgramCacheKey) inside materialProgramSignature. Anything missed
// here merges two programs and the second links at its first draw: the
// dimension-by-dimension test checks each axis against three's own key
// (tests/draw_program_signature_core.test.ts).

import { materialProgramSignature, prewarmProgramContentKeys } from './prewarm_policy';

type MaterialSignatureInput = Parameters<typeof materialProgramSignature>[0];

export interface DrawProgramTextureLike {
  channel?: number;
  mapping?: number;
  format?: number;
  isVideoTexture?: boolean;
}

export interface DrawProgramMaterialLike extends MaterialSignatureInput {
  toneMapped?: boolean;
  sizeAttenuation?: boolean;
  wireframe?: boolean;
  forceSinglePass?: boolean;
  precision?: string | null;
  normalMapType?: number;
  combine?: number;
  depthPacking?: number;
  glslVersion?: string | null;
  anisotropy?: number;
  clearcoat?: number;
  dispersion?: number;
  iridescence?: number;
  sheen?: number;
  transmission?: number;
  extensions?: { clipCullDistance?: boolean; multiDraw?: boolean } | null;
  clippingPlanes?: readonly unknown[] | null;
}

export interface DrawProgramAttributeLike {
  itemSize?: number;
}

export interface DrawProgramObjectLike {
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  instanceColor?: unknown;
  morphTexture?: unknown;
  _colorsTexture?: unknown;
  castShadow?: boolean;
  geometry?: {
    attributes?: Record<string, DrawProgramAttributeLike | undefined>;
    morphAttributes?: Record<string, readonly unknown[] | undefined>;
  };
}

/** Every texture slot three reads a uv channel from (getParameters' *MapUv). */
const TEXTURE_SLOTS = [
  'map',
  'alphaMap',
  'lightMap',
  'aoMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'metalnessMap',
  'roughnessMap',
  'anisotropyMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmissionMap',
  'thicknessMap',
] as const;

/** three's isPackedRGFormat: RGFormat, RG11_EAC_Format, RED_GREEN_RGTC2_Format. */
const PACKED_RG_FORMATS = new Set([1030, 37490, 36285]);

function drawKind(object: DrawProgramObjectLike): string {
  if (object.isSprite) return 'sprite';
  if (object.isPoints) return 'points';
  if (object.isLine) return 'line';
  if (object.isMesh) return 'mesh';
  return 'other';
}

function materialExtras(material: DrawProgramMaterialLike): string {
  const slots = material as unknown as Record<string, DrawProgramTextureLike | null | undefined>;
  const channels = TEXTURE_SLOTS.map((slot) => {
    const texture = slots[slot];
    return texture ? String(texture.channel ?? 0) : '-';
  }).join(',');
  const bit = (value: unknown): string => (value ? '1' : '0');
  const envMap = slots.envMap;
  return [
    bit(material.toneMapped !== false),
    bit(material.sizeAttenuation === true),
    bit(material.wireframe === true),
    bit(material.forceSinglePass === true),
    material.precision ?? '',
    channels,
    String(material.normalMapType ?? ''),
    bit(slots.normalMap && PACKED_RG_FORMATS.has(slots.normalMap.format ?? -1)),
    bit(slots.map?.isVideoTexture),
    bit(slots.emissiveMap?.isVideoTexture),
    String(material.combine ?? ''),
    bit(slots.matcap),
    envMap ? String(envMap.mapping ?? '') : '-',
    String(material.depthPacking ?? ''),
    bit((material.anisotropy ?? 0) > 0),
    bit((material.clearcoat ?? 0) > 0),
    bit((material.dispersion ?? 0) > 0),
    bit((material.iridescence ?? 0) > 0),
    bit((material.sheen ?? 0) > 0),
    bit((material.transmission ?? 0) > 0),
    material.glslVersion ?? '',
    bit(material.extensions?.clipCullDistance),
    bit(material.extensions?.multiDraw),
    String(material.clippingPlanes?.length ?? 0),
  ].join('|');
}

function objectShape(object: DrawProgramObjectLike): string {
  const attributes = object.geometry?.attributes ?? {};
  const morphs = object.geometry?.morphAttributes;
  const [shapeKey] = prewarmProgramContentKeys(
    {
      isSkinnedMesh: object.isSkinnedMesh === true,
      isInstancedMesh: object.isInstancedMesh === true,
      hasInstanceColor: object.instanceColor != null,
      isBatchedMesh: object.isBatchedMesh === true,
      hasMorphPositions: morphs?.position !== undefined,
      morphTargetCount: morphs?.position?.length ?? 0,
      morphNormalCount: morphs?.normal?.length ?? 0,
      morphColorCount: morphs?.color?.length ?? 0,
      hasTangents: attributes.tangent !== undefined,
      hasNormals: attributes.normal !== undefined,
      vertexColorItemSize: attributes.color?.itemSize ?? 0,
      castShadow: object.castShadow === true,
    },
    [''],
  );
  const bit = (value: unknown): string => (value ? '1' : '0');
  return [
    shapeKey,
    drawKind(object),
    bit(object.isPoints === true && attributes.uv !== undefined),
    bit(object.isInstancedMesh === true && object.morphTexture != null),
    bit(object.isBatchedMesh === true && object._colorsTexture != null),
    bit(morphs?.normal !== undefined),
    bit(morphs?.color !== undefined),
    bit(attributes.position !== undefined),
  ].join('|');
}

/** The program set this material links when `object` draws it. Equal strings
 *  mean one program set; different strings are different programs, or, for
 *  the conservative axes (the draw kind, shadow casting), possibly one. */
export function drawProgramSignature(
  object: DrawProgramObjectLike,
  material: DrawProgramMaterialLike,
): string {
  return `${materialProgramSignature(material)}#${materialExtras(material)}#${objectShape(object)}`;
}
