// The Realm Builder of the Month roll: who the Eastbrook Vale monument is
// currently honouring, and everyone it has honoured before.
//
// TWO SOURCES, one shape. The shipped placeholder below is what an offline
// browser world sees, and what an online realm sees until an operator names
// somebody. A realm with the admin dashboard wired up overrides it at boot and
// again on every save, through `setRealmBuilderRoll`; the server reads
// `realm_builder_honours` (server/realm_builder_db.ts) and the client picks the
// same roll up from `/api/realm-builder` while the world loads.
//
// WHY THE SIM HOLDS IT AT ALL. The monument's inspect event carries the whole
// roll so the card renders identically on every host, and the event is emitted
// by the sim. This override is the ONLY sim state that comes from outside the
// world, and it is safe precisely because nothing reads it but that event: it
// decides no outcome, moves no entity, and draws no rng. It is cosmetic text in
// the same class as a player's name. Keep it that way.
//
// i18n: an honouree's NAME is world data and splices verbatim, exactly like a
// player name or a guild name on the signpost (src/ui/noticeboard_popup.ts).
// The month is a number pair rather than a written string so the card can
// format it through Intl in the reader's own language.

/** One month's honouree. `month` is 1-12, matching the human calendar. */
export interface RealmBuilderHonour {
  readonly year: number;
  readonly month: number;
  readonly name: string;
}

/**
 * The name shown until a real honouree is announced. Deliberately readable as
 * a placeholder in game: an empty plate would look broken, and a made-up name
 * would look like a real award nobody won.
 */
export const REALM_BUILDER_PLACEHOLDER_NAME = 'Your Name Here';

// The month pair here is inert: every surface checks isPlaceholderRealmBuilder
// before formatting a month, so the unclaimed plate never dates an award nobody
// has won. It is a valid month only so the shape stays one shape.
const PLACEHOLDER_HONOUR: RealmBuilderHonour = {
  year: 2026,
  month: 8,
  name: REALM_BUILDER_PLACEHOLDER_NAME,
};

/** The live roll, NEWEST FIRST. Empty means "nobody has been named yet". */
let roll: readonly RealmBuilderHonour[] = Object.freeze([]);

/**
 * Replace the roll with what the realm's own records say.
 *
 * Newest first, and the caller owns that order: this does not re-sort, so a
 * server that hands over its rows in insertion order gets exactly that on the
 * plaque. Passing an empty list is meaningful and falls back to the
 * placeholder, which is what a realm that has never named anyone should show.
 */
export function setRealmBuilderRoll(entries: readonly RealmBuilderHonour[]): void {
  roll = Object.freeze(
    entries.map((entry) =>
      Object.freeze({ year: entry.year, month: entry.month, name: entry.name }),
    ),
  );
}

/** Drop back to the shipped placeholder (used by tests and by world teardown). */
export function resetRealmBuilderRoll(): void {
  roll = Object.freeze([]);
}

/** The honouree the monument is projecting right now. */
export function currentRealmBuilder(): RealmBuilderHonour {
  return roll[0] ?? PLACEHOLDER_HONOUR;
}

/** Every past honouree, most recent first. */
export function pastRealmBuilders(): readonly RealmBuilderHonour[] {
  return roll.length > 1 ? roll.slice(1) : EMPTY_PAST;
}

const EMPTY_PAST: readonly RealmBuilderHonour[] = Object.freeze([]);

/** True while the monument is still showing the unclaimed placeholder. */
export function isPlaceholderRealmBuilder(honour: RealmBuilderHonour): boolean {
  return honour.name === REALM_BUILDER_PLACEHOLDER_NAME;
}
