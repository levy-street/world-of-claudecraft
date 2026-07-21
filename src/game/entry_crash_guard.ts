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
// - clearEntryProbe() removes it once entry has demonstrably survived (the world is
//   connected and frames are rendering), and on the handled failure paths (a caught
//   renderer error already surfaces its own overlay).
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

// A probe older than this is ignored (and cleared): it is not evidence about the
// world entry the player is attempting NOW - e.g. a phone that died mid-entry and was
// booted again days later should not silently lose a graphics tier.
export const ENTRY_CRASH_WINDOW_MS = 10 * 60 * 1000;

// How long after the synchronous scene build the entry is considered survived and the
// probe is cleared. Covers the post-build tail (first frames force the texture uploads
// and shader compiles that keep the memory spike alive past the constructor); a kill
// later than this is a mid-play eviction, not an entry crash, and must not cost a tier.
export const ENTRY_PROBE_STABLE_MS = 20 * 1000;

// Settings graphicsPreset range (mirrors SETTING_RANGES.graphicsPreset in settings.ts:
// 1=low .. 5=advanced). The guard only ever writes values inside this range.
export const ENTRY_PRESET_MIN = 1;
export const ENTRY_PRESET_MAX = 5;

export interface EntryProbe {
  /** graphicsPreset value the crashed entry was attempted at */
  preset: number;
  /** wall-clock ms when the entry began */
  at: number;
}

export interface EntryCrashRecovery {
  /** the preset the previous, crashed entry ran at */
  from: number;
  /** the preset to retry with (equals `from` when already at the floor) */
  to: number;
  /** ms between the crashed entry's start and this boot */
  ageMs: number;
}

export function serializeProbe(probe: EntryProbe): string {
  return JSON.stringify(probe);
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
    return { preset: value.preset, at: value.at };
  } catch {
    return null;
  }
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
  if (ageMs < 0 || ageMs > ENTRY_CRASH_WINDOW_MS) return null;
  return { from: probe.preset, to: stepDownPreset(probe.preset), ageMs };
}

// --- thin storage wrappers (the impure boundary; every access fail-soft) ---

export function stampEntryProbe(preset: number, now: number): void {
  try {
    localStorage.setItem(ENTRY_PROBE_KEY, serializeProbe({ preset, at: now }));
  } catch {
    // Blocked storage only loses crash detection; entry proceeds as before.
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
