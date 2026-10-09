/** Hardware and engine choices belong to this installation, even within one device family. */
export const LOCAL_MACHINE_SETTINGS = new Set([
  'graphicsPreset',
  'graphicsDefaultApplied',
  'renderScale',
  'frameRateCap',
  'gpuBackend',
  'shaderWarm',
  'browserEffects',
  'forceHighPerfGpu',
  'terrainDetail',
  'foliageDensity',
  'effectsQuality',
  'shadowQuality',
  'surfaceDetail',
  'antiAliasing',
  'bloomQuality',
  'ambientOcclusion',
  'viewDistance',
  'waterQuality',
  'characterDetail',
  'dynamicLights',
  'particleEffects',
  'ghostFade',
  'weather',
  'fullscreen',
  'displayMode',
]);

function settingsObject(value: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Normalize legacy server rows and local snapshots through the same split. */
export function accountSettingsValue(key: string, value: string): string {
  if (key !== 'woc_settings') return value;
  const settings = settingsObject(value);
  for (const key of LOCAL_MACHINE_SETTINGS) delete settings[key];
  return JSON.stringify(settings);
}

/** Applying a profile resets its shared fields while retaining local hardware choices. */
export function mergeAccountGameSettings(
  local: string | null,
  shared: string | null,
): string | null {
  const result: Record<string, unknown> = settingsObject(shared);
  for (const key of LOCAL_MACHINE_SETTINGS) delete result[key];
  for (const [key, value] of Object.entries(settingsObject(local))) {
    if (LOCAL_MACHINE_SETTINGS.has(key)) result[key] = value;
  }
  return shared !== null || Object.keys(result).length ? JSON.stringify(result) : null;
}
