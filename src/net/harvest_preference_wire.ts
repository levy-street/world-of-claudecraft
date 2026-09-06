// Wire decode for the corpse-harvest preference self-delta (the `hpref` field
// on the `self` record; Intentional Gathering PR3). Kept as its own DOM-free,
// ClientWorld-free module, the snapshot_timer_wire.ts / account_cosmetics_wire.ts
// idiom: the decode is unit-testable without standing up a socket, and
// online.ts stays a consumer rather than growing another decode block.
//
// Defensive by construction: every value re-validates through the sim's own
// loadHarvestPreference leaf, and a malformed value decodes to null (refused,
// never All) rather than throwing or reviving a stale choice.

import {
  type HarvestPreference,
  loadHarvestPreference,
} from '../sim/professions/harvest_preference';

/**
 * Decode a PRESENT `self.hpref` wire value into a `HarvestPreference` mirror,
 * or null when the value is refused. `undefined` is rejected to null here
 * rather than resolved to the legacy All default: on the wire, All rides as
 * the explicit HARVEST_PREFERENCE_ALL_TOKEN ('all'), encoded unconditionally
 * (see server/gathering_self_wire.ts encodeHarvestPreferenceWire), so a
 * genuinely present key is never undefined. loadHarvestPreference's
 * undefined-means-legacy-All collapse is for a REAL absent save key; a caller
 * here must only ever invoke this on a key it already confirmed is present in
 * the delta (an omitted key means "unchanged", decided by the caller before
 * this function is reached), so a decode-input undefined is misuse this
 * function refuses rather than silently widens into an active choice.
 */
export function decodeHarvestPreferenceWire(raw: unknown): HarvestPreference | null {
  if (raw === undefined) return null;
  const loaded = loadHarvestPreference(raw);
  return loaded.ok ? loaded.preference : null;
}
