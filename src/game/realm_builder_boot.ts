// Pull the realm's Realm Builder of the Month roll into the world at boot.
//
// This sits between main.ts and src/net/realm_builder_roll.ts so main.ts keeps
// only a call: it is a firewall, not a home for feature wiring.
//
// DELIBERATELY NOT AWAITED by the caller. The plaque catching up a moment late
// is nothing; a slow or missing endpoint holding a player at the loading screen
// is not. Everything downstream fails quiet, so there is no error path to
// handle here either.
//
// ONLINE ONLY. The gate lives here, on the `online` argument, rather than at
// the call site in main.ts, so tests/realm_builder_roll_fetch.test.ts can pin
// it: an offline browser world is the shipped placeholder's home
// (src/net/realm_builder_roll.ts) and must not pull a realm's roll into sim
// content it does not belong to.

import { apiUrl } from '../client_origin';
import { loadRealmBuilderRoll } from '../net/realm_builder_roll';

/** The one thing the roll needs from the renderer once a name lands. */
export interface RealmBuilderHonoureeSink {
  setRealmBuilderHonouree(name: string): void;
}

/**
 * Fetch the roll and re-bake the monument's projected name, if this is an
 * online world (`online` is main.ts's ClientWorld, null for the offline entry).
 *
 * Safe whether it lands before or after the town is built: an early return
 * simply leaves the shipped placeholder showing, and a late one re-bakes a
 * statue that is already standing.
 */
export function startRealmBuilderRollLoad(
  sink: RealmBuilderHonoureeSink,
  online: object | null,
): void {
  if (online === null) return;
  void loadRealmBuilderRoll(apiUrl('/api/realm-builder')).then((name) => {
    if (name) sink.setRealmBuilderHonouree(name);
  });
}
