// World-entry crash guard.
//
// On phone-class WebKit (iOS Safari AND the native WKWebView app shell, which run the
// same engine under the same per-process memory ceiling), the world entry's synchronous
// Renderer/Hud scene build can push the tab over the WebContent memory limit. The OS then
// KILLS the process and the shell reloads index.html: no error event, no unload handler,
// no in-game Options menu ever reachable. If the crash-prone graphics preset is persisted
// (a saved choice, or the auto default), every retry crashes the same way; combined with
// the active-play resume marker (src/net/resume_play.ts) the player is trapped cycling
// through the welcome/news screen instead of ever reaching a screen with a graphics
// control on it.
//
// This module turns that invisible kill into a signal:
// - stampEntryProbe() persists { preset, at } RIGHT BEFORE the synchronous scene build.
// - stampEntryCheckpoint() advances a small, bounded diagnostic record at important entry
//   boundaries. Unlike console output, this survives a WebContent process kill and tells the
//   next boot which operation and render footprint were last known to have completed.
// - Once entry is stable the probe stays armed for explicit high-risk runtime UI
//   checkpoints. Normal lifecycle transitions clear it, so a silent foreground
//   WebContent termination remains distinguishable from backgrounding or navigation.
// - On the NEXT boot, a probe that is still present and fresh means the previous entry
//   died mid-build: planEntryCrashRecovery() names the preset that crashed and the next
//   tier down to retry with. The caller persists the lowered preset, drops the resume
//   marker (so boot lands on chrome with a reachable graphics control instead of
//   auto-reentering the world), and tells the player what happened.
//
// Stepping DOWN one tier at a time (never straight to the floor) is what makes the auto
// default self-correcting per device: whatever tier this hardware can actually survive is
// where the ladder stops, without hardcoding per-model assumptions the masked iOS GPU
// string cannot support.
//
// Client-only (src/game), so wall-clock time is allowed: pure helpers take `now` as a
// parameter (unit-testable) and the thin storage wrappers read the clock and localStorage
// at the impure boundary, matching the resume_play.ts idiom.

export const ENTRY_PROBE_KEY = 'woc_entry_probe';
export const ENTRY_RECOVERY_LOG_KEY = 'woc_entry_last_recovery';

// A probe older than this is ignored (and cleared): it is not evidence about the
// world entry the player is attempting NOW - e.g. a phone that died mid-entry and was
// booted again days later should not silently lose a graphics tier.
export const ENTRY_CRASH_WINDOW_MS = 10 * 60 * 1000;

// How long after the synchronous scene build the entry is considered stable. The
// controller then stops periodic render writes but keeps the probe armed for named
// runtime actions such as opening the mobile More dialog.
export const ENTRY_PROBE_STABLE_MS = 20 * 1000;

// Settings graphicsPreset range (mirrors SETTING_RANGES.graphicsPreset in settings.ts:
// 1=low .. 5=advanced). The guard only ever writes values inside this range.
export const ENTRY_PRESET_MIN = 1;
export const ENTRY_PRESET_MAX = 5;

export const ENTRY_CHECKPOINTS = [
  'scene-build-start',
  'renderer-built',
  'hud-built',
  'prewarm-start',
  'prewarm-complete',
  'first-frame',
  'first-paint',
  'rendering',
  'runtime-stable',
  'mobile-more-open',
  'mobile-more-closed',
  'settings-open',
  'settings-closed',
  'character-open',
  'character-closed',
  'quest-dialog-open',
  'quest-dialog-closed',
  'webgl-context-lost',
  'webgl-context-restored',
  'connection-lost',
  'connection-restored',
  'window-error',
  'unhandled-rejection',
] as const;

export type EntryCheckpoint = (typeof ENTRY_CHECKPOINTS)[number];
export type EntryDiagnosticValue = string | number | boolean | null;
export type EntryDiagnostics = Record<string, EntryDiagnosticValue>;

const ENTRY_DIAGNOSTIC_MAX_KEYS = 48;
const ENTRY_DIAGNOSTIC_STRING_MAX = 160;

export interface EntryProbe {
  /** graphicsPreset value the crashed entry was attempted at */
  preset: number;
  /** wall-clock ms when the entry began */
  at: number;
  /** last operation known to have completed before an unhandled reload */
  checkpoint?: EntryCheckpoint;
  /** wall-clock ms when the last checkpoint was persisted */
  checkpointAt?: number;
  /** bounded, non-sensitive render and device evidence for the checkpoint */
  diagnostics?: EntryDiagnostics;
}

export interface EntryCrashRecovery {
  /** the preset the previous, crashed entry ran at */
  from: number;
  /** the preset to retry with (equals `from` when already at the floor) */
  to: number;
  /** ms between the crashed entry's start and this boot */
  ageMs: number;
  /** last operation observed before the WebContent process disappeared */
  checkpoint?: EntryCheckpoint;
  /** ms between the last checkpoint and this boot */
  checkpointAgeMs?: number;
  /** render/device evidence captured at the last checkpoint */
  diagnostics?: EntryDiagnostics;
}

export interface EntryRecoveryLog extends EntryCrashRecovery {
  /** wall-clock ms when this recovery was applied */
  recoveredAt: number;
}

export function serializeProbe(probe: EntryProbe): string {
  return JSON.stringify(probe);
}

export function serializeEntryRecoveryLog(log: EntryRecoveryLog): string {
  return JSON.stringify(log);
}

function isEntryCheckpoint(value: unknown): value is EntryCheckpoint {
  return typeof value === 'string' && ENTRY_CHECKPOINTS.some((checkpoint) => checkpoint === value);
}

function sanitizeDiagnostics(value: unknown): EntryDiagnostics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const diagnostics: EntryDiagnostics = {};
  for (const [key, field] of Object.entries(value).slice(0, ENTRY_DIAGNOSTIC_MAX_KEYS)) {
    if (!key || key.length > 64) continue;
    if (typeof field === 'string') {
      diagnostics[key] = field.slice(0, ENTRY_DIAGNOSTIC_STRING_MAX);
    } else if (typeof field === 'number' && Number.isFinite(field)) {
      diagnostics[key] = field;
    } else if (typeof field === 'boolean' || field === null) {
      diagnostics[key] = field;
    }
  }
  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

export function parseEntryRecoveryLog(raw: string | null): EntryRecoveryLog | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<EntryRecoveryLog> | null;
    if (
      !value ||
      typeof value.recoveredAt !== 'number' ||
      !Number.isFinite(value.recoveredAt) ||
      typeof value.from !== 'number' ||
      !Number.isFinite(value.from) ||
      typeof value.to !== 'number' ||
      !Number.isFinite(value.to) ||
      typeof value.ageMs !== 'number' ||
      !Number.isFinite(value.ageMs)
    ) {
      return null;
    }
    const log: EntryRecoveryLog = {
      recoveredAt: value.recoveredAt,
      from: value.from,
      to: value.to,
      ageMs: value.ageMs,
    };
    if (
      isEntryCheckpoint(value.checkpoint) &&
      typeof value.checkpointAgeMs === 'number' &&
      Number.isFinite(value.checkpointAgeMs)
    ) {
      log.checkpoint = value.checkpoint;
      log.checkpointAgeMs = value.checkpointAgeMs;
      const diagnostics = sanitizeDiagnostics(value.diagnostics);
      if (diagnostics) log.diagnostics = diagnostics;
    }
    return log;
  } catch {
    return null;
  }
}

/** Fail-soft parse: any malformed/foreign value reads as "no probe". */
export function parseProbe(raw: string | null): EntryProbe | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<EntryProbe> | null;
    if (
      !value ||
      typeof value.preset !== 'number' ||
      !Number.isFinite(value.preset) ||
      typeof value.at !== 'number' ||
      !Number.isFinite(value.at)
    ) {
      return null;
    }
    const probe: EntryProbe = { preset: value.preset, at: value.at };
    if (
      isEntryCheckpoint(value.checkpoint) &&
      typeof value.checkpointAt === 'number' &&
      Number.isFinite(value.checkpointAt)
    ) {
      probe.checkpoint = value.checkpoint;
      probe.checkpointAt = value.checkpointAt;
      const diagnostics = sanitizeDiagnostics(value.diagnostics);
      if (diagnostics) probe.diagnostics = diagnostics;
    }
    return probe;
  } catch {
    return null;
  }
}

/** Pure checkpoint transition used by the fail-soft storage wrapper and unit tests. */
export function checkpointEntryProbe(
  raw: string | null,
  checkpoint: EntryCheckpoint,
  now: number,
  diagnostics: EntryDiagnostics = {},
): string | null {
  const probe = parseProbe(raw);
  if (!probe || !Number.isFinite(now)) return null;
  const sanitized = sanitizeDiagnostics(diagnostics);
  return serializeProbe({
    preset: probe.preset,
    at: probe.at,
    checkpoint,
    checkpointAt: now,
    ...(sanitized ? { diagnostics: sanitized } : {}),
  });
}

/** One tier down, clamped to the settings range; the floor retries at the floor. */
export function stepDownPreset(preset: number): number {
  const clamped = Math.min(ENTRY_PRESET_MAX, Math.max(ENTRY_PRESET_MIN, Math.round(preset)));
  return Math.max(ENTRY_PRESET_MIN, clamped - 1);
}

/**
 * Decide what a boot-time probe means. Returns the recovery to apply when the previous
 * entry crashed (probe present and fresh), or null when there is nothing to recover from
 * (no probe, malformed probe, stale probe, or a clock that went backwards). The caller
 * clears the probe either way: it is a one-shot signal.
 */
export function planEntryCrashRecovery(raw: string | null, now: number): EntryCrashRecovery | null {
  const probe = parseProbe(raw);
  if (!probe) return null;
  const ageMs = now - probe.at;
  const evidenceAgeMs = now - (probe.checkpointAt ?? probe.at);
  if (ageMs < 0 || evidenceAgeMs < 0 || evidenceAgeMs > ENTRY_CRASH_WINDOW_MS) return null;
  const recovery: EntryCrashRecovery = {
    from: probe.preset,
    to: stepDownPreset(probe.preset),
    ageMs,
  };
  if (probe.checkpoint && probe.checkpointAt !== undefined) {
    const checkpointAgeMs = now - probe.checkpointAt;
    if (checkpointAgeMs >= 0) {
      recovery.checkpoint = probe.checkpoint;
      recovery.checkpointAgeMs = checkpointAgeMs;
      if (probe.diagnostics) recovery.diagnostics = probe.diagnostics;
    }
  }
  return recovery;
}

// --- thin storage wrappers (the impure boundary; every access fail-soft) ---

export function stampEntryProbe(preset: number, now: number): void {
  try {
    localStorage.setItem(ENTRY_PROBE_KEY, serializeProbe({ preset, at: now }));
  } catch {
    // Blocked storage only loses crash detection; entry proceeds as before.
  }
}

export function stampEntryCheckpoint(
  checkpoint: EntryCheckpoint,
  now: number,
  diagnostics: EntryDiagnostics = {},
): void {
  try {
    const next = checkpointEntryProbe(
      localStorage.getItem(ENTRY_PROBE_KEY),
      checkpoint,
      now,
      diagnostics,
    );
    if (next !== null) localStorage.setItem(ENTRY_PROBE_KEY, next);
  } catch {
    // Blocked storage only loses diagnostic detail; crash recovery still fails soft.
  }
}

export function readEntryProbeRaw(): string | null {
  try {
    return localStorage.getItem(ENTRY_PROBE_KEY);
  } catch {
    return null;
  }
}

export function clearEntryProbe(): void {
  try {
    localStorage.removeItem(ENTRY_PROBE_KEY);
  } catch {
    // Nothing to do: a blocked remove also means the read path is blocked.
  }
}

export function persistEntryRecoveryLog(recovery: EntryCrashRecovery, recoveredAt: number): void {
  try {
    localStorage.setItem(
      ENTRY_RECOVERY_LOG_KEY,
      serializeEntryRecoveryLog({ recoveredAt, ...recovery }),
    );
  } catch {
    // The console diagnostic still runs when storage is blocked.
  }
}
