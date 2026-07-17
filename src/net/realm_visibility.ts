// Pure realm-directory visibility core for the realm picker (main.ts).
//
// The server already drops web-only realms from GET /api/realms for the native
// and desktop app-shell classes (server/realm_platform_guard.ts, the gate that
// reaches shipped binaries). This client-side filter is belt and braces for the
// NEW build only: a misconfigured or stale server can never surface a web-only
// realm inside an app shell that carries this code.
import type { RealmEntry } from './online';

export function visibleRealms(realms: readonly RealmEntry[], appShell: boolean): RealmEntry[] {
  if (!appShell) return [...realms];
  return realms.filter((realm) => !(realm.flags ?? []).includes('web'));
}

/** True when the entry carries the pay-to-win label (the picker badges it). */
export function realmIsP2w(entry: Pick<RealmEntry, 'flags'>): boolean {
  return (entry.flags ?? []).includes('p2w');
}
