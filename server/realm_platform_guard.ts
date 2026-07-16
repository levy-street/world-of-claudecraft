// Platform gating for realm visibility and entry, keyed off RealmFlag (realm.ts).
//
// The `web` flag marks a browser-only realm (desktop and mobile web). The one
// gate that reaches app-store binaries already in the field is the server-side
// directory filter here: shipped native (Capacitor) and desktop (Electron)
// builds render GET /api/realms unfiltered and have no OTA update path, so a
// web-only realm must never appear in the directory served to those client
// classes. Origin identifies the class (a CLASS marker, never proof of
// identity, see web_login_guard.ts); a spoofed Origin only ever REVEALS a realm
// to a client that lied about being a browser, so the filter fails harmless.
//
// A process whose OWN realm carries `web` additionally refuses app-shell
// clients at the bot gate and the WS handshake (webOnlyRealmRefuses), so a
// stored token from a shared account cannot be used to enter the realm from an
// app build that somehow learned the origin. Belt and braces: store compliance
// rests on the directory filter plus the client build gate, not on this.
import type { IncomingMessage } from 'node:http';
import type { RealmEntry, RealmFlag } from './realm';
import {
  isDesktopAppRequest,
  isNativeAppRequest,
  isPackagedDesktopRequest,
} from './web_login_guard';

type RequestLike = Pick<IncomingMessage, 'headers'>;

/** True for the native (Capacitor) and desktop (Electron) app-shell classes. */
export function isAppShellRequest(req: RequestLike): boolean {
  return isNativeAppRequest(req) || isDesktopAppRequest(req);
}

/**
 * The realm directory as served to one request: app-shell classes never see
 * web-only realms; browsers see the full directory. Both /api/realms arms
 * (the RouteDef handler and the retained legacy arm) shape their response
 * through this one function so the twins cannot drift.
 */
export function realmsVisibleToRequest(
  req: RequestLike,
  directory: readonly RealmEntry[],
): RealmEntry[] {
  if (!isAppShellRequest(req)) return [...directory];
  return directory.filter((entry) => !entry.flags.includes('web'));
}

/**
 * True when this web-only realm process must refuse an app-shell client
 * outright. The desktop arm keys off the PACKAGED Electron origin only: the
 * broad desktop class also contains the localhost Vite dev origins, which a
 * genuine web browser presents on `npm run dev` login/WS calls, and a web-only
 * realm must never refuse a real browser.
 */
export function webOnlyRealmRefuses(ownFlags: readonly RealmFlag[], req: RequestLike): boolean {
  return ownFlags.includes('web') && (isNativeAppRequest(req) || isPackagedDesktopRequest(req));
}

/**
 * Realm names excluded from the cross-realm (global) leaderboard scopes: a
 * pay-to-win realm's characters rank on its own boards, never on the shared
 * ones. Keyed off the shared REALMS directory, which every realm process is
 * expected to serve identically.
 */
export function p2wRealmNames(directory: readonly RealmEntry[]): string[] {
  return directory.filter((entry) => entry.flags.includes('p2w')).map((entry) => entry.name);
}

/**
 * The full exclusion set for the global boards THIS process serves: the
 * directory's p2w realms, plus this process's own realm when its effective
 * flags (which union REALM_FLAGS with the directory entry) say p2w but the
 * shared directory entry forgot the flag. Other processes only know what the
 * directory tells them, so the REALMS entry stays the source of truth for
 * cross-process exclusion; this union just keeps the flagged process itself
 * honest under that misconfiguration.
 */
export function globallyExcludedRealms(
  directory: readonly RealmEntry[],
  ownRealm: string,
  ownFlags: readonly RealmFlag[],
): string[] {
  const names = new Set(p2wRealmNames(directory));
  if (ownFlags.includes('p2w')) names.add(ownRealm);
  return [...names];
}
