// The gathering-adjacent self-delta fields, extracted from
// GameServer.selfWireJson's bcastSelf block (server/game.ts) to keep that
// coordinator under its monolith ceiling. A MOVE, not a rewrite: every
// comment on tfocus/gprof/tslot below is restated verbatim from its prior
// home in game.ts, and the emitted bytes are unchanged (see
// tests/snapshots.test.ts dirtyEveryDeltaField for the byte-identity proof).
// `hpref` (Intentional Gathering PR3) is the one new field, added here rather
// than back in game.ts because it is the same per-player gathering read
// family.
//
// Takes a NARROW reader interface (only the four per-pid reads this module
// needs) rather than the concrete Sim, so this sibling adds no import surface
// of its own; `Sim` already satisfies it structurally. `maybe`/`maybeSerialized`
// are the exact closures selfWireJson already built (the same emitters every
// other self field uses), passed in so the delta-gating stays centralized.

import {
  HARVEST_PREFERENCE_ALL_TOKEN,
  type HarvestPreference,
  savedHarvestPreference,
} from '../src/sim/professions/harvest_preference';
import type { ToolEffectSlotView } from '../src/world_api/professions';

export interface GatheringSelfReaders {
  townFocusFor(pid: number): Record<string, number>;
  gatheringProficiencyFor(pid: number): Record<string, number>;
  toolEffectSlotsFor(pid: number): readonly ToolEffectSlotView[];
  harvestPreferenceFor(pid: number): HarvestPreference | null;
}

/**
 * Encode a live harvest preference for the wire. All encodes as the explicit
 * HARVEST_PREFERENCE_ALL_TOKEN (never omitted, unlike the sparse SAVE
 * encoding savedHarvestPreference itself performs for the default). An
 * explicit `null` (a malformed persisted preference the load refused) MUST
 * survive as `null` on the wire, so this checks `savedHarvestPreference`'s
 * result against `undefined` explicitly rather than falling back with `??`,
 * which would also collapse a real `null` into the All token.
 */
export function encodeHarvestPreferenceWire(preference: HarvestPreference | null): string | null {
  const saved = savedHarvestPreference(preference);
  return saved === undefined ? HARVEST_PREFERENCE_ALL_TOKEN : saved;
}

export function appendGatheringSelfWire(
  sim: GatheringSelfReaders,
  pid: number,
  maybe: (key: string, value: unknown) => void,
  maybeSerialized: (key: string, serialized: string) => void,
): void {
  maybe('tfocus', sim.townFocusFor(pid));
  // Raw gathering-profession proficiency map (IWorld `gatheringProficiency`,
  // #1119), a second small read alongside `prof` for the ORIGINAL flat-map
  // shape used by the `/dev gather` chat cheat and existing consumers. Wire
  // key `gprof`; see TERSE_TO_IWORLD/ALL_DELTA_KEYS in tests/snapshots.test.ts.
  maybe('gprof', sim.gatheringProficiencyFor(pid));
  // Slotted tool effects (IWorld `toolEffectSlots`). Wire key `tslot`; see
  // TERSE_TO_IWORLD/ALL_DELTA_KEYS in tests/snapshots.test.ts. Empty for
  // every player who has never slotted one, so after the first snapshot of a
  // session (which carries `"tslot":[]`, as every registered key does while
  // lastSent is empty) the key delta-elides away for almost everyone. The
  // charge counter moves only on a harvest that actually spends one, so this
  // is a cheap diff rather than a per-tick churn. The empty arm compares the
  // constant '[]' directly (byte-identical to maybe(...)): stringifying the
  // shared frozen empty projection per player per tick bought nothing.
  const tslotRows = sim.toolEffectSlotsFor(pid);
  if (tslotRows.length === 0) maybeSerialized('tslot', '[]');
  else maybe('tslot', tslotRows);
  // The remembered corpse-harvest preference (Intentional Gathering PR3).
  // Wire key `hpref`; see TERSE_TO_IWORLD/ALL_DELTA_KEYS in
  // tests/snapshots.test.ts. Unlike the sparse SAVE encoding, All ships as an
  // explicit token rather than an omitted key, so a fresh session's first
  // snapshot always carries a real value; a malformed persisted preference
  // (the load-refused case) ships as explicit JSON null, never omitted,
  // exactly like the sim's own save encoding never revives it into All.
  maybe('hpref', encodeHarvestPreferenceWire(sim.harvestPreferenceFor(pid)));
}
