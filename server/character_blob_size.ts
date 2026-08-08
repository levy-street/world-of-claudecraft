// The character-blob size SIGNAL for the save path.
//
// At 1,000 online the realm rewrites every character blob whole on the autosave
// interval (there is no per-field dirty tracking), so the serialized size of one
// character multiplies straight into write volume, WAL, and TOAST churn. Nothing
// measured it: a field that quietly grew per-player rather than per-content
// would have shown up first as a database incident, not as a log line.
//
// WARN-ONLY, and that is the whole design. The guild-bank pair
// (GUILD_BANK_ROW_MAX_BYTES in server/db.ts, GUILD_BANK_MERGED_MAX_BYTES in
// server/guild_bank_state.ts) is a HARD bound: an oversized book is skipped on
// load and refused on write, because a guild bank is a shared ledger where a
// corrupt row is worse than an inert one. A character blob is the opposite
// trade. It is one player's entire progress, and it has no second copy: the row
// in `characters` IS the character. Refusing or truncating an oversized save
// would destroy a session's gameplay to protect a disk metric, so this path
// never rejects, never truncates, and never short-circuits. It measures, and if
// the number is surprising it says so, and the write proceeds regardless.
//
// THE THRESHOLD, and where it comes from. Measured on the v0.36.0 tree with the
// real Sim.serializeCharacter path:
//   - a freshly created level-1 character serializes to about 1.8 KB;
//   - a deliberately maximal character (max level, every one of the 202 quests
//     completed, every recipe known, every authored gather node on cooldown,
//     every farm bed planted, all gathering and craft skills capped, and 140
//     inventory / bank / buyback slots each carrying an instance payload with a
//     24-character signer) serializes to about 38.9 KB.
// The professions-owned portion alone is independently pinned at 14 KiB by
// tests/professions_blob_growth.test.ts (measured 13,948 bytes at its worst
// case), which is the largest content-scaled block inside that 38.9 KB.
//
// 131,072 bytes is therefore about 3.4x the measured legitimate worst case: far
// enough above it that ordinary authored content growth (a new zone's nodes, a
// new crop, another dungeon's lockouts) cannot drift into it and train an
// operator to ignore the line, and still one power-of-two step BELOW the
// 262,144-byte guild-bank scale, which is the largest single row this codebase
// considers plausible at all. A character past this number is not a busy player;
// it is a field that grew per-player without a bound, which is the defect this
// signal exists to catch early. Re-mint it here WITH a fresh measurement (the
// professions_blob_growth re-mint doctrine) if authored content ever legitimately
// approaches it; do not nudge it up to silence a line.
export const CHARACTER_BLOB_WARN_BYTES = 131_072;

// The decision, kept pure so it is unit-testable without a database: returns the
// dev-channel log line for an oversized blob, or null when the size is
// unremarkable. Dev-channel English by the i18n rule (a server log an operator
// reads, never player-facing text), so no t() key.
//
// BYTES, not string length, is what the caller must pass: JSON.stringify returns
// UTF-16 code units, and a blob carrying non-ASCII text (a crafter signature, a
// pet name, a mail subject) encodes to more bytes than it has units. Measuring
// units would under-report exactly the rows most likely to be large. Callers use
// Buffer.byteLength(json, 'utf8'), matching the octet_length doctrine the
// guild-bank bounds already follow.
export function characterBlobSizeWarning(characterId: number, bytes: number): string | null {
  if (bytes <= CHARACTER_BLOB_WARN_BYTES) return null;
  // ATTEMPTED, not "written", and deliberately so. The size never blocks the
  // write, but the statement this line describes can still fail to persist for
  // reasons that have nothing to do with size: a lease-fence miss rolls the
  // escrow transactions back (server/db.ts, both the market/mail and guild bank
  // flushes), a refused guild bank escrow aborts the whole transaction, and the
  // leave-save retry loop (server/game.ts saveCharacterOnLeave) makes up to
  // LEAVE_SAVE_MAX_ATTEMPTS attempts, of which all but the last are failures
  // that already rolled back. Claiming "the write PROCEEDS" would have been
  // false on all three, and an operator reading this line during an incident is
  // exactly the person who must not be told a row landed when it did not.
  return `character save: a save was attempted for character ${characterId} with a ${bytes}-byte serialized state, past the ${CHARACTER_BLOB_WARN_BYTES}-byte expectation for a full character. Size never blocks the write (losing a session's progress is worse than a large row), though this attempt may still roll back for unrelated reasons. Treat it as a signal that some persisted field may be growing per-player rather than per-content.`;
}

// How long one reported line silences its repeats. The character blob is
// rewritten whole on the autosave interval, so a threshold crossing is never a
// single event: one oversized character alone reprints every autosave, and a
// fleet-wide crossing (the case this signal exists to catch) would print from
// every session at once, forever. That is not a louder signal, it is a log an
// operator stops reading. The window matches the market-writer queue-depth warn
// in server/game.ts, which dampens for the same reason.
export const CHARACTER_BLOB_WARN_WINDOW_MS = 60_000;

export type CharacterBlobSizeReporter = (
  characterId: number,
  bytes: number,
  nowMs: number,
) => string | null;

// The dampened reporter: the pure decision above plus one window's worth of
// memory. Returns the line to log, or null when the size is fine OR when an
// identical-in-kind line already fired inside the window. Suppressed lines are
// COUNTED, not dropped silently, and the count rides the next line that fires,
// so the log still says how much it swallowed.
//
// A FACTORY rather than bare module-level `let`s, because the state is what
// makes this untestable otherwise: a shared counter bleeds between test cases
// (one case's suppressed total surfacing in another's assertion) and needs a
// test-only reset export to escape. Each caller, including each test, owns an
// isolated instance instead. `nowMs` is a PARAMETER for the same reason: a test
// drives the window by passing timestamps rather than by faking global time.
export function createCharacterBlobSizeReporter(): CharacterBlobSizeReporter {
  let lastWarnMs = Number.NEGATIVE_INFINITY;
  let suppressed = 0;
  return (characterId, bytes, nowMs) => {
    const line = characterBlobSizeWarning(characterId, bytes);
    if (line === null) return null;
    if (nowMs - lastWarnMs < CHARACTER_BLOB_WARN_WINDOW_MS) {
      suppressed++;
      return null;
    }
    lastWarnMs = nowMs;
    if (suppressed === 0) return line;
    const swallowed = suppressed;
    suppressed = 0;
    return `${line} (${swallowed} further oversized save${swallowed === 1 ? '' : 's'} suppressed in the preceding ${CHARACTER_BLOB_WARN_WINDOW_MS}ms)`;
  };
}

// The one instance the save path uses. Module-level so the window spans the
// whole process rather than resetting per call site: all three savers share it,
// which is the point (a fleet-wide crossing hitting every path at once still
// prints one line a minute, not three).
export const reportCharacterBlobSize = createCharacterBlobSizeReporter();
