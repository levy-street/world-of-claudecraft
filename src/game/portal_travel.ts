// Storage and URL side of Baldemar's portal travel (the pure half lives in
// portal_travel_core.ts). One-shot localStorage transfer, the same shape the
// editor playtest handoff uses: written immediately before the page swap,
// consumed exactly once by the destination boot, so a plain reload never
// replays a stale trip.

import { decodePortalHandoff, encodePortalHandoff, type PortalHandoff } from './portal_travel_core';

export const PORTAL_TRAVEL_KEY = 'woc_portal_travel';

export function writePortalHandoff(handoff: PortalHandoff): void {
  try {
    localStorage.setItem(PORTAL_TRAVEL_KEY, encodePortalHandoff(handoff));
  } catch {
    // Storage denied (private mode quirks): travel still works, the far side
    // just boots a default character instead of carrying this one over.
  }
}

/** Read AND clear the pending handoff. */
export function takePortalHandoff(): PortalHandoff | null {
  try {
    const raw = localStorage.getItem(PORTAL_TRAVEL_KEY);
    if (raw !== null) localStorage.removeItem(PORTAL_TRAVEL_KEY);
    return decodePortalHandoff(raw);
  } catch {
    return null;
  }
}

/** The outbound URL: the same document with ?map=deepglass. No ?bout: the
 *  player arrives at the plaza with the crowd and the marshal, not mid-match. */
export function deepglassTravelUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set('map', 'deepglass');
  url.searchParams.delete('bout');
  return url.toString();
}

/** The way home: the same document with the map (and bout) params dropped.
 *  The handoff is what tells the boot to skip the start screen. */
export function overworldTravelUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('map');
  url.searchParams.delete('bout');
  return url.toString();
}
