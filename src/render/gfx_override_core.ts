export const GFX_OVERRIDE_VALUE_KINDS = {
  composer: 'boolean',
  gradePass: 'boolean',
  ao: 'boolean',
  aoFullRes: 'boolean',
  msaaSamples: 'number',
  bloom: 'boolean',
  smaa: 'boolean',
  dynamicShadows: 'boolean',
  terrainCastShadows: 'boolean',
  shadowMap: 'number',
  surfaceDetail: 'boolean',
  surfaceDetailTaps: 'number',
  surfaceDetailClampK: 'number',
  terrainRelief: 'number',
  bladeCarpetRadius: 'number',
  cliffScree: 'boolean',
  canopyDetail: 'boolean',
  pixelRatioCap: 'number',
  grassRadius: 'number',
  grassStep: 'number',
  leanFoliage: 'boolean',
  standardMaterials: 'boolean',
  terrainSplat: 'boolean',
  maxPointLights: 'number',
  farCharacterAnimScale: 'number',
} as const;

export type GfxOverrideKey = keyof typeof GFX_OVERRIDE_VALUE_KINDS;

export type GfxOverrideSettings = {
  readonly [K in GfxOverrideKey]: (typeof GFX_OVERRIDE_VALUE_KINDS)[K] extends 'boolean'
    ? boolean
    : number;
};

export type GfxOverridePatch = Partial<{
  [K in GfxOverrideKey]: GfxOverrideSettings[K];
}>;

export function parseGfxOverride(raw: string | null | undefined): GfxOverridePatch {
  const patch: GfxOverridePatch = {};
  if (!raw) return patch;

  for (const token of raw.split(',')) {
    const separator = token.indexOf(':');
    if (separator < 1) continue;
    const key = token.slice(0, separator).trim();
    const rawValue = token.slice(separator + 1).trim();
    if (!Object.hasOwn(GFX_OVERRIDE_VALUE_KINDS, key)) continue;

    const overrideKey = key as GfxOverrideKey;
    const kind = GFX_OVERRIDE_VALUE_KINDS[overrideKey];
    if (kind === 'boolean') {
      if (rawValue === '0') {
        (patch as Record<GfxOverrideKey, boolean | number>)[overrideKey] = false;
      } else if (rawValue === '1') {
        (patch as Record<GfxOverrideKey, boolean | number>)[overrideKey] = true;
      }
      continue;
    }

    if (rawValue === '') continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) {
      (patch as Record<GfxOverrideKey, boolean | number>)[overrideKey] = value;
    }
  }

  return patch;
}

export function gfxOverrideFromSearch(search: string): string | null {
  if (!search) return null;
  return new URLSearchParams(search).get('gfxo');
}

export function applyGfxOverridesFromSearch<T extends GfxOverrideSettings>(
  settings: T,
  search: string,
): T {
  const raw = gfxOverrideFromSearch(search);
  if (raw === null || raw === '') return settings;
  const patch = parseGfxOverride(raw);
  if (Object.keys(patch).length === 0) return settings;
  return { ...settings, ...patch };
}
