// Device-memory hint for the graphics tier resolver.
//
// iOS WKWebView never exposes navigator.deviceMemory, the GPU string is masked
// to "Apple GPU", and screen metrics cannot tell a 4 GB iPhone 13 from a 6 GB
// iPhone 12 Pro (identical 390x844@3). The only reliable memory signal is the
// native shell's ProcessInfo.physicalMemory, which arrives over an async
// Capacitor bridge - but src/render/gfx.ts resolves the module-load GFX profile
// SYNCHRONOUSLY, before any plugin call can answer, and the render preload
// sweeps key off that profile at import time. So the hint is cached here in
// localStorage: the native shell primes it shortly after boot
// (src/net/native_device_info.ts), and every LATER boot resolves its graphics
// profile against the cached value.
//
// A second, hint-independent trigger covers the first-ever boot and any device
// the shell cannot measure: when the world-entry crash guard applies a recovery
// (src/game/entry_crash_guard.ts consumed in main.ts), the recovery block also
// stamps a tight-mode marker here. One real WebContent kill during entry is
// direct evidence the device is at its memory ceiling, so the next boots run
// the tight profile without needing to know the RAM size. The marker expires:
// a one-off kill on a big phone must not degrade it forever.
//
// ?memgb=<n> overrides the cached value for QA (the ?gfx= idiom in gfx.ts).
//
// Client-only wall-clock and storage access live in the thin wrappers at the
// bottom (fail-soft, matching the entry_crash_guard idiom); everything above
// them is pure and unit-tested.

export const DEVICE_MEMORY_GB_KEY = 'woc_device_mem_gb';
export const ENTRY_TIGHT_MODE_KEY = 'woc_entry_tight_mode';

/** Devices at or below this many GB of physical RAM get the tight profile. */
export const TIGHT_MEMORY_MAX_GB = 4;

/** How long one entry-crash recovery keeps the tight profile active. */
export const ENTRY_TIGHT_MODE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Parse a stored/override GB value; anything non-finite or absurd reads as unknown. */
export function parseDeviceMemoryGb(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  if (value <= 0 || value > 1024) return undefined;
  return value;
}

/** Physical-memory bytes (from the native shell) to a storable GB value. */
export function deviceMemoryGbFromBytes(bytes: number): number | undefined {
  if (!Number.isFinite(bytes) || bytes <= 0) return undefined;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb > 1024) return undefined;
  // Two decimals is plenty: jetsam budgets step in whole-GB device classes.
  return Math.round(gb * 100) / 100;
}

/** Parse the tight-mode marker payload ({ at }); malformed reads as absent. */
export function parseTightModeAt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { at?: unknown } | null;
    if (!value || typeof value.at !== 'number' || !Number.isFinite(value.at)) return undefined;
    return value.at;
  } catch {
    return undefined;
  }
}

/**
 * The pure tight-memory decision: a measured (or overridden) RAM size at or
 * below the 4 GB class, OR a fresh entry-crash tight-mode marker. A marker
 * stamped in the future (clock rollback) reads as inactive rather than pinning
 * tight mode until the clock catches up.
 */
export function tightMemoryFromSignals(
  memGb: number | undefined,
  tightMarkerAt: number | undefined,
  now: number,
  windowMs: number = ENTRY_TIGHT_MODE_WINDOW_MS,
): boolean {
  if (memGb !== undefined && memGb <= TIGHT_MEMORY_MAX_GB) return true;
  if (tightMarkerAt === undefined) return false;
  const age = now - tightMarkerAt;
  return age >= 0 && age <= windowMs;
}

// --- thin storage/clock wrappers (the impure boundary; every access fail-soft) ---

function urlOverrideGb(): number | undefined {
  try {
    if (typeof location === 'undefined') return undefined;
    return parseDeviceMemoryGb(new URLSearchParams(location.search).get('memgb'));
  } catch {
    return undefined;
  }
}

/** The ?memgb= override when present, else the cached native measurement. */
export function cachedDeviceMemoryGb(): number | undefined {
  const override = urlOverrideGb();
  if (override !== undefined) return override;
  try {
    return parseDeviceMemoryGb(localStorage.getItem(DEVICE_MEMORY_GB_KEY));
  } catch {
    return undefined;
  }
}

/** Cache the native shell's measurement for the next boot's synchronous read. */
export function storeDeviceMemoryGb(gb: number): void {
  if (parseDeviceMemoryGb(String(gb)) === undefined) return;
  try {
    localStorage.setItem(DEVICE_MEMORY_GB_KEY, String(gb));
  } catch {
    // Blocked storage only loses the hint; the tier resolver falls back as before.
  }
}

/** Stamp tight mode after an entry-crash recovery (the guard's floor has no
 *  rung below Low; this is the rung: shed residency, not sharpness). */
export function markEntryTightMode(now: number = Date.now()): void {
  try {
    localStorage.setItem(ENTRY_TIGHT_MODE_KEY, JSON.stringify({ at: now }));
  } catch {
    // Blocked storage: the preset step-down still applied; tight mode is bonus.
  }
}

/** The composite signal src/render/gfx.ts reads at module load. */
export function tightMemoryDeviceHint(now: number = Date.now()): boolean {
  let markerAt: number | undefined;
  try {
    markerAt = parseTightModeAt(localStorage.getItem(ENTRY_TIGHT_MODE_KEY));
  } catch {
    markerAt = undefined;
  }
  return tightMemoryFromSignals(cachedDeviceMemoryGb(), markerAt, now);
}
