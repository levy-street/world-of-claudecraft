// The three per-character GATHERING SETTINGS as one load/save pair: the Town
// Focus allocation (#1143), its queued re-spec (#1144, persisted since the
// pending-focus fix), and the corpse-harvest preference (Intentional Gathering
// PR3). Each has its own encoding leaf (focus.ts, town_focus_pending.ts,
// harvest_preference.ts); this module is only the sim.ts addPlayer /
// serializeCharacter seam for the three together, extracted off the
// coordinator so the pending queue could join them without growing it.
//
// Pure over PlayerMeta and CharacterState: no rng, no events, no I/O.

import type { CharacterState } from '../character_state';
import type { PlayerMeta } from '../sim';
import { normalizeTownFocusOnLoad } from './focus';
import { applyHarvestPreferenceOnLoad, serializeHarvestPreference } from './harvest_preference';
import { loadPendingTownFocus, serializePendingTownFocus } from './town_focus_pending';

/** Restore the three settings from a save onto `meta` (the sim.ts addPlayer
 *  shape). `now` is the loading Sim's clock, which the queued re-spec is
 *  re-anchored on. */
export function loadGatheringSettings(meta: PlayerMeta, s: CharacterState, now: number): void {
  // Known component families at positive integer points only: a save that
  // predates the #2511 key check (or a corrupt one) self-heals here rather
  // than riding back out through the panel into a request the command
  // boundary now rejects.
  meta.townFocus = normalizeTownFocusOnLoad(s.townFocus);
  meta.pendingTownFocus = loadPendingTownFocus(s.pendingTownFocus, now);
  // See PlayerMeta.harvestPreference / harvest_preference.ts applyHarvestPreferenceOnLoad.
  meta.harvestPreference = applyHarvestPreferenceOnLoad(s.harvestPreference);
}

/** The CharacterState fragment for one save (the sim.ts serializeCharacter
 *  shape): `townFocus` always, the queued re-spec and the preference sparsely
 *  (each leaf owns its own absent-when-default rule). */
export function serializeGatheringSettings(
  meta: PlayerMeta,
  now: number,
): Pick<CharacterState, 'townFocus' | 'pendingTownFocus' | 'harvestPreference'> {
  return {
    townFocus: { ...meta.townFocus },
    ...serializePendingTownFocus(meta.pendingTownFocus, now),
    ...serializeHarvestPreference(meta.harvestPreference),
  };
}
