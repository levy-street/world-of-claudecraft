// Crash breadcrumb for an in-place graphics renderer rebuild.
//
// The generic entry probe is suspended while a live renderer is deliberately
// torn down. This marker owns that gap so a process kill is not misclassified
// as a failed world entry on the next boot. Graphics settings are deliberately
// exact bounded graphics snapshots: no world, account, player, or unrelated
// settings data belongs here.

export const GRAPHICS_REBUILD_PROBE_KEY = 'woc_graphics_rebuild_probe';
export const GRAPHICS_REBUILD_CRASH_WINDOW_MS = 10 * 60 * 1000;

export type GraphicsRebuildProbePhase =
  | 'starting'
  | 'assets-prepared'
  | 'renderer-stopped'
  | 'candidate-built'
  | 'rollback-started';

export interface GraphicsRebuildSettingsRecord {
  readonly graphicsPreset: string | number;
  readonly terrainDetail: number;
  readonly foliageDensity: number;
  readonly surfaceDetail: number;
  readonly effectsQuality: number;
  readonly shadowQuality: number;
}

export interface GraphicsRebuildProbe {
  generation: number;
  at: number;
  phase: GraphicsRebuildProbePhase;
  from: GraphicsRebuildSettingsRecord;
  target: GraphicsRebuildSettingsRecord;
}

const PHASES: readonly GraphicsRebuildProbePhase[] = [
  'starting',
  'assets-prepared',
  'renderer-stopped',
  'candidate-built',
  'rollback-started',
];
const GRAPHICS_SETTINGS_KEYS = [
  'graphicsPreset',
  'terrainDetail',
  'foliageDensity',
  'surfaceDetail',
  'effectsQuality',
  'shadowQuality',
] as const;
const GRAPHICS_SETTINGS_KEY_SET = new Set<string>(GRAPHICS_SETTINGS_KEYS);

function sanitizeSettings(value: unknown): GraphicsRebuildSettingsRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const actualKeys = Object.keys(input);
  if (
    actualKeys.length !== GRAPHICS_SETTINGS_KEYS.length ||
    actualKeys.some((key) => !GRAPHICS_SETTINGS_KEY_SET.has(key))
  ) {
    return null;
  }
  const graphicsPreset = input.graphicsPreset;
  if (
    !(
      (typeof graphicsPreset === 'string' &&
        graphicsPreset.length > 0 &&
        graphicsPreset.length <= 64) ||
      (typeof graphicsPreset === 'number' && Number.isFinite(graphicsPreset))
    )
  ) {
    return null;
  }
  for (const key of GRAPHICS_SETTINGS_KEYS.slice(1)) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) return null;
  }
  return {
    graphicsPreset,
    terrainDetail: input.terrainDetail as number,
    foliageDensity: input.foliageDensity as number,
    surfaceDetail: input.surfaceDetail as number,
    effectsQuality: input.effectsQuality as number,
    shadowQuality: input.shadowQuality as number,
  };
}

export function serializeGraphicsRebuildProbe(probe: GraphicsRebuildProbe): string {
  return JSON.stringify(probe);
}

export function parseGraphicsRebuildProbe(raw: string | null): GraphicsRebuildProbe | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GraphicsRebuildProbe> | null;
    if (
      !value ||
      typeof value.generation !== 'number' ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 1 ||
      typeof value.at !== 'number' ||
      !Number.isFinite(value.at) ||
      typeof value.phase !== 'string' ||
      !PHASES.some((phase) => phase === value.phase)
    ) {
      return null;
    }
    const from = sanitizeSettings(value.from);
    const target = sanitizeSettings(value.target);
    if (!from || !target) return null;
    return {
      generation: value.generation,
      at: value.at,
      phase: value.phase as GraphicsRebuildProbePhase,
      from,
      target,
    };
  } catch {
    return null;
  }
}

export function graphicsRebuildProbeIsFresh(probe: GraphicsRebuildProbe, now: number): boolean {
  const ageMs = now - probe.at;
  return ageMs >= 0 && ageMs <= GRAPHICS_REBUILD_CRASH_WINDOW_MS;
}

export function stampGraphicsRebuildProbe(probe: GraphicsRebuildProbe): void {
  try {
    localStorage.setItem(GRAPHICS_REBUILD_PROBE_KEY, serializeGraphicsRebuildProbe(probe));
  } catch {
    // Storage failure only loses the crash breadcrumb; the rebuild still has
    // its in-process rollback path.
  }
}

export function updateGraphicsRebuildProbePhase(phase: GraphicsRebuildProbePhase): void {
  try {
    const probe = parseGraphicsRebuildProbe(localStorage.getItem(GRAPHICS_REBUILD_PROBE_KEY));
    if (!probe) return;
    localStorage.setItem(
      GRAPHICS_REBUILD_PROBE_KEY,
      serializeGraphicsRebuildProbe({ ...probe, phase }),
    );
  } catch {
    // Fail soft, matching the entry crash guard.
  }
}

export function readGraphicsRebuildProbeRaw(): string | null {
  try {
    return localStorage.getItem(GRAPHICS_REBUILD_PROBE_KEY);
  } catch {
    return null;
  }
}

export function clearGraphicsRebuildProbe(): void {
  try {
    localStorage.removeItem(GRAPHICS_REBUILD_PROBE_KEY);
  } catch {
    // A blocked remove also means the read path is unavailable.
  }
}

/** Read and clear the prior process's one-shot marker. */
export function consumeGraphicsRebuildCrashProbe(now: number): GraphicsRebuildProbe | null {
  const probe = parseGraphicsRebuildProbe(readGraphicsRebuildProbeRaw());
  clearGraphicsRebuildProbe();
  return probe && graphicsRebuildProbeIsFresh(probe, now) ? probe : null;
}
