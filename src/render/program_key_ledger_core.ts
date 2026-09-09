// Reads three's program cache key and names what two programs of the SAME
// material differ by.
//
// three keys a program on `WebGLPrograms.getProgramCacheKey`: the shader id
// (or the two custom shader ids), the material's defines, a fixed block of
// parameters, two 24-bit boolean masks, the renderer's output color space and
// the material's custom cache key, joined with commas. Some of those inputs are
// MATERIAL state (map channels, morph counts, skinning, the custom key); the
// rest are RENDERER or SCENE state (the light census, fog, shadow type, tone
// mapping, the bound target's color space, the environment map). A material
// drawn under two renderer states is two programs, two links, and the second
// one is usually a waste: the 2026-08-27 shader-program audit (tmp/) ranked the
// suspects and asked for a ledger that NAMES the field that differs, per pair,
// before any of them is fixed.
//
// Host-agnostic: strings in, records out. The layout below is three r185's
// (the repo's patched build); tests/program_key_ledger_core.test.ts pins it
// against the shipped three source so a three bump fails loudly here rather
// than silently mis-attributing.

/** `getProgramCacheKeyParameters`, in push order. */
export const THREE_PROGRAM_KEY_PARAMETERS: readonly string[] = [
  'precision',
  'outputColorSpace',
  'envMapMode',
  'envMapCubeUVHeight',
  'mapUv',
  'alphaMapUv',
  'lightMapUv',
  'aoMapUv',
  'bumpMapUv',
  'normalMapUv',
  'displacementMapUv',
  'emissiveMapUv',
  'metalnessMapUv',
  'roughnessMapUv',
  'anisotropyMapUv',
  'clearcoatMapUv',
  'clearcoatNormalMapUv',
  'clearcoatRoughnessMapUv',
  'iridescenceMapUv',
  'iridescenceThicknessMapUv',
  'sheenColorMapUv',
  'sheenRoughnessMapUv',
  'specularMapUv',
  'specularColorMapUv',
  'specularIntensityMapUv',
  'transmissionMapUv',
  'thicknessMapUv',
  'combine',
  'fogExp2',
  'sizeAttenuation',
  'morphTargetsCount',
  'morphAttributeCount',
  'numDirLights',
  'numPointLights',
  'numSpotLights',
  'numSpotLightMaps',
  'numHemiLights',
  'numRectAreaLights',
  'numDirLightShadows',
  'numPointLightShadows',
  'numSpotLightShadows',
  'numSpotLightShadowsWithMaps',
  'numLightProbes',
  'shadowMapType',
  'toneMapping',
  'numClippingPlanes',
  'numClipIntersection',
  'depthPacking',
];

/** `getProgramCacheKeyBooleans`, first mask, bit order. */
export const THREE_PROGRAM_KEY_MASK_A: readonly string[] = [
  'instancing',
  'instancingColor',
  'instancingMorph',
  'matcap',
  'envMap',
  'normalMapObjectSpace',
  'normalMapTangentSpace',
  'clearcoat',
  'iridescence',
  'alphaTest',
  'vertexColors',
  'vertexAlphas',
  'vertexUv1s',
  'vertexUv2s',
  'vertexUv3s',
  'vertexTangents',
  'anisotropy',
  'alphaHash',
  'batching',
  'dispersion',
  'batchingColor',
  'gradientMap',
  'packedNormalMap',
  'vertexNormals',
];

/** `getProgramCacheKeyBooleans`, second mask, bit order. */
export const THREE_PROGRAM_KEY_MASK_B: readonly string[] = [
  'fog',
  'useFog',
  'flatShading',
  'logarithmicDepthBuffer',
  'reversedDepthBuffer',
  'skinning',
  'morphTargets',
  'morphNormals',
  'morphColors',
  'premultipliedAlpha',
  'shadowMapEnabled',
  'doubleSided',
  'flipSided',
  'useDepthPacking',
  'dithering',
  'transmission',
  'sheen',
  'opaque',
  'pointsUvs',
  'decodeVideoTexture',
  'decodeVideoTextureEmissive',
  'alphaToCoverage',
  'numLightProbeGrids',
  'hasPositionAttribute',
];

/** The trailing `renderer.outputColorSpace` push, named apart from the
 *  parameter of the same name (which follows the bound render target). */
export const RENDERER_OUTPUT_COLOR_SPACE_FIELD = 'rendererOutputColorSpace';

/** Key inputs that are renderer or scene state rather than material state
 *  (the audit's list). `envMap` is here because it follows `scene.environment`
 *  for every Standard, Lambert and Phong material without its own map. */
export const RENDERER_STATE_FIELDS: ReadonlySet<string> = new Set([
  'precision',
  'outputColorSpace',
  'envMapMode',
  'envMapCubeUVHeight',
  'fogExp2',
  'numDirLights',
  'numPointLights',
  'numSpotLights',
  'numSpotLightMaps',
  'numHemiLights',
  'numRectAreaLights',
  'numDirLightShadows',
  'numPointLightShadows',
  'numSpotLightShadows',
  'numSpotLightShadowsWithMaps',
  'numLightProbes',
  'shadowMapType',
  'toneMapping',
  'numClippingPlanes',
  'numClipIntersection',
  'envMap',
  'fog',
  'logarithmicDepthBuffer',
  'reversedDepthBuffer',
  'shadowMapEnabled',
  'numLightProbeGrids',
  RENDERER_OUTPUT_COLOR_SPACE_FIELD,
]);

const PRECISIONS: ReadonlySet<string> = new Set(['highp', 'mediump', 'lowp']);
const COLOR_SPACES: ReadonlySet<string> = new Set(['srgb', 'srgb-linear', '']);
const FIXED_TAIL = THREE_PROGRAM_KEY_PARAMETERS.length + 3; // params, two masks, color space

export interface ParsedProgramKey {
  /** The shader id (a ShaderLib name) or the two custom shader ids, joined. */
  shader: string;
  /** Everything that identifies the MATERIAL: the head (shader id and
   *  defines), the material-side fields, the custom cache key. Two programs
   *  with one identity are the same material under two renderer states. */
  identity: string;
  /** Every named field, material-side and renderer-side. */
  fields: Readonly<Record<string, string>>;
  /** True for a raw ShaderMaterial key, which carries no parameter block. */
  raw: boolean;
}

const isInteger = (token: string): boolean => /^-?\d+$/.test(token);

/**
 * Splits a three cache key into named fields. The head (shader id plus
 * defines) has a variable length, so the parameter block is found by its
 * anchor: a precision token followed by a color-space token, with the two
 * integer masks at the block's fixed offset. A key with no such block (a raw
 * ShaderMaterial, or a foreign key) is returned whole as its own identity.
 */
export function parseThreeProgramCacheKey(key: string): ParsedProgramKey {
  const tokens = key.split(',');
  let anchor = -1;
  for (let i = 1; i + FIXED_TAIL <= tokens.length; i++) {
    if (!PRECISIONS.has(tokens[i]) || !COLOR_SPACES.has(tokens[i + 1])) continue;
    const maskAt = i + THREE_PROGRAM_KEY_PARAMETERS.length;
    if (!isInteger(tokens[maskAt]) || !isInteger(tokens[maskAt + 1])) continue;
    anchor = i;
    break;
  }
  if (anchor < 0) {
    return { shader: tokens[0] ?? '', identity: key, fields: {}, raw: true };
  }
  const head = tokens.slice(0, anchor);
  const fields: Record<string, string> = {};
  for (let i = 0; i < THREE_PROGRAM_KEY_PARAMETERS.length; i++) {
    fields[THREE_PROGRAM_KEY_PARAMETERS[i]] = tokens[anchor + i];
  }
  const maskAt = anchor + THREE_PROGRAM_KEY_PARAMETERS.length;
  const maskA = Number(tokens[maskAt]);
  const maskB = Number(tokens[maskAt + 1]);
  for (let bit = 0; bit < THREE_PROGRAM_KEY_MASK_A.length; bit++) {
    fields[THREE_PROGRAM_KEY_MASK_A[bit]] = maskA & (1 << bit) ? '1' : '0';
  }
  for (let bit = 0; bit < THREE_PROGRAM_KEY_MASK_B.length; bit++) {
    fields[THREE_PROGRAM_KEY_MASK_B[bit]] = maskB & (1 << bit) ? '1' : '0';
  }
  fields[RENDERER_OUTPUT_COLOR_SPACE_FIELD] = tokens[maskAt + 2];
  const custom = tokens.slice(maskAt + 3).join(',');
  const materialSide: string[] = [];
  for (const name of Object.keys(fields)) {
    if (!RENDERER_STATE_FIELDS.has(name)) materialSide.push(`${name}=${fields[name]}`);
  }
  return {
    shader: head[0] ?? '',
    identity: `${head.join(',')}|${materialSide.join(',')}|${custom}`,
    fields,
    raw: false,
  };
}

/** One minted program, as the ledger records it. */
export interface ProgramKeyLedgerRecord {
  key: string;
  /** Host clock at the sweep that found it (ms). */
  atMs: number;
  /** three's program id, when the host has one. */
  id?: number | null;
  /** three's shader name (the material type or name). */
  name?: string;
  /** Where the host says the program was minted (a lane, a manifest entry,
   *  'live'), when it knows. */
  label?: string;
}

export interface ProgramKeyVariantMember {
  atMs: number;
  id: number | null;
  name: string;
  label: string;
  /** The values of the differing fields, in `differing` order. */
  values: string[];
}

/** Programs that share one material identity under different renderer states. */
export interface ProgramKeyVariantGroup {
  shader: string;
  /** Renderer-state fields whose values differ inside the group; empty for a
   *  relink of a byte-identical key (a released program linked again). */
  differing: string[];
  members: ProgramKeyVariantMember[];
}

/**
 * Groups records by material identity and keeps the groups of two or more.
 * The differing fields are computed over ALL fields, so a group whose members
 * differ by a material-side field cannot arise (that field is in the
 * identity); what differs is renderer state by construction, or nothing.
 */
export function groupProgramKeyVariants(
  records: readonly ProgramKeyLedgerRecord[],
): ProgramKeyVariantGroup[] {
  const byIdentity = new Map<
    string,
    { shader: string; parsed: ParsedProgramKey[]; records: ProgramKeyLedgerRecord[] }
  >();
  for (const record of records) {
    const parsed = parseThreeProgramCacheKey(record.key);
    let group = byIdentity.get(parsed.identity);
    if (!group) {
      group = { shader: parsed.shader, parsed: [], records: [] };
      byIdentity.set(parsed.identity, group);
    }
    group.parsed.push(parsed);
    group.records.push(record);
  }
  const groups: ProgramKeyVariantGroup[] = [];
  for (const group of byIdentity.values()) {
    if (group.records.length < 2) continue;
    const differing: string[] = [];
    const first = group.parsed[0].fields;
    for (const name of Object.keys(first)) {
      if (group.parsed.some((p) => p.fields[name] !== first[name])) differing.push(name);
    }
    groups.push({
      shader: group.shader,
      differing,
      members: group.records.map((record, i) => ({
        atMs: record.atMs,
        id: record.id ?? null,
        name: record.name ?? '',
        label: record.label ?? '',
        values: differing.map((name) => group.parsed[i].fields[name]),
      })),
    });
  }
  groups.sort((a, b) => b.members.length - a.members.length || a.shader.localeCompare(b.shader));
  return groups;
}

/** The label a signature reads as: the differing fields joined, or `relink`. */
export function variantSignature(group: ProgramKeyVariantGroup): string {
  return group.differing.length === 0 ? 'relink' : group.differing.join('+');
}

export interface ProgramKeyVariantSummary {
  programs: number;
  groups: number;
  /** Programs beyond the first of each group: the links a single renderer
   *  state would not have paid. */
  extraPrograms: number;
  /** Per signature: how many groups, how many extra programs. */
  bySignature: Record<string, { groups: number; extraPrograms: number }>;
}

export function summarizeProgramKeyVariants(
  records: readonly ProgramKeyLedgerRecord[],
  groups: readonly ProgramKeyVariantGroup[] = groupProgramKeyVariants(records),
): ProgramKeyVariantSummary {
  const bySignature: Record<string, { groups: number; extraPrograms: number }> = {};
  let extraPrograms = 0;
  for (const group of groups) {
    const signature = variantSignature(group);
    const extra = group.members.length - 1;
    extraPrograms += extra;
    let row = bySignature[signature];
    if (!row) {
      row = { groups: 0, extraPrograms: 0 };
      bySignature[signature] = row;
    }
    row.groups++;
    row.extraPrograms += extra;
  }
  return { programs: records.length, groups: groups.length, extraPrograms, bySignature };
}
