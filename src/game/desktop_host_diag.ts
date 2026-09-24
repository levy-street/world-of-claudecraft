// The System Report's desktop-shell glue: the feature check, the one call that
// never throws, and the pure builder for the game-side context the shell copies
// into the saved file (src/runtime.ts DesktopHostDiagGameInfo).
//
// Its own module rather than lines in the options painter or in main.ts: both
// are at their line ceilings (tests/monolith_budget.test.ts), and the whole of
// this is host glue plus one pure builder, which unit-tests directly
// (tests/desktop_host_diag.test.ts).

import {
  type DesktopHostDiagGameInfo,
  type DesktopHostDiagResult,
  desktopBridge,
} from '../runtime';

/** The verdict a failed or impossible run reports. Built per call rather than
 *  shared, so no caller can mutate the answer another caller reads. */
function hostDiagFailure(): DesktopHostDiagResult {
  return { status: 'error', nativeStatus: null };
}

/**
 * Whether this shell can produce a host diagnostic at all. `runHostDiag` shipped
 * after the login trio, so an installed shell predating it exposes the bridge
 * without the method: the row that leads here is gated on this, never on
 * DESKTOP_APP alone (a player on an older shell would otherwise reach a panel
 * whose only button can never work).
 */
export function hostDiagAvailable(): boolean {
  return typeof desktopBridge()?.runHostDiag === 'function';
}

/**
 * Ask the shell for one host diagnostic. Resolves once the native save dialog
 * has been answered, which can be ten seconds or more (about five for the
 * collection, then however long the player takes over the folder picker).
 *
 * NEVER rejects: a missing bridge, a missing method, and a rejected bridge
 * promise all resolve to the same error verdict, because from the player's side
 * they are one event ("no file was written") and the panel has one line for it.
 */
export async function runDesktopHostDiag(
  game: DesktopHostDiagGameInfo,
): Promise<DesktopHostDiagResult> {
  const bridge = desktopBridge();
  if (typeof bridge?.runHostDiag !== 'function') return hostDiagFailure();
  try {
    const result = await bridge.runHostDiag(game);
    return result ?? hostDiagFailure();
  } catch {
    // Dev channel only: the panel renders its own localized line.
    return hostDiagFailure();
  }
}

/** Everything the panel knows, each field independently optional and allowed to
 *  be null so a caller can pass an unresolved reading straight through. */
export interface HostDiagGameSources {
  sessionId?: string | null;
  releaseVersion?: string | null;
  buildId?: string | null;
  graphicsPreset?: string | null;
  gfxTier?: string | number | null;
  glRenderer?: string | null;
  glVendor?: string | null;
  renderScale?: number | null;
  targetFps?: number | null;
  zone?: string | null;
  locale?: string | null;
}

const TEXT_KEYS = [
  'sessionId',
  'releaseVersion',
  'buildId',
  'graphicsPreset',
  'glRenderer',
  'glVendor',
  'zone',
  'locale',
] as const;

const NUMBER_KEYS = ['renderScale', 'targetFps'] as const;

/**
 * Build the shell payload from whatever the caller could resolve. PURE: no
 * bridge, no globals, no clock, so every drop rule is assertable.
 *
 * Absent, null, blank and non-finite readings are DROPPED rather than sent as
 * empty strings or NaN. The shell clamps and re-filters everything anyway
 * (electron/host_diag.cjs sanitizeGameInfo), so this is about the file reading
 * honestly: a key that is present means it was known.
 *
 * `sessionId` is the load-bearing one: it is the perf-report session id, which
 * is what joins this saved file to the automatic performance reports the same
 * session already sent.
 */
export function assembleHostDiagGameInfo(sources: HostDiagGameSources): DesktopHostDiagGameInfo {
  const info: DesktopHostDiagGameInfo = {};
  for (const key of TEXT_KEYS) {
    const value = sources[key];
    if (typeof value === 'string' && value !== '') info[key] = value;
  }
  for (const key of NUMBER_KEYS) {
    const value = sources[key];
    if (typeof value === 'number' && Number.isFinite(value)) info[key] = value;
  }
  // gfxTier is the one reading the shell accepts in either shape (the tier is a
  // number today and a named rung in the graphics catalog), so it carries its
  // own arm rather than being forced into one of the two loops.
  const tier = sources.gfxTier;
  if (typeof tier === 'string' && tier !== '') info.gfxTier = tier;
  else if (typeof tier === 'number' && Number.isFinite(tier)) info.gfxTier = tier;
  return info;
}
