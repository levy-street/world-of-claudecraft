// Pure, IO-free naming helpers for reclaiming a character name abandoned by a
// deactivated ("invalid") account. Classic MMOs free the names of deleted or
// deactivated accounts; when a new character reuses such a name, the orphaned
// character is given an archival placeholder name (and force_rename) so its row
// stays valid without holding the original name hostage. The suffix scheme
// mirrors the per-realm case-insensitive dedupe in SOCIAL_SCHEMA (server/social_db.ts).
//
// Kept here as a standalone module (like wallet_link.ts vs wallet.ts) so the
// suffixing logic is unit-testable without a Postgres connection; server/db.ts
// is the DB-touching shell that applies it inside a transaction.

// Character names are capped at 16 characters (see normalizeCharName in auth.ts).
export const MAX_NAME_LEN = 16;

// Bijective base-26 suffix: 1 -> "a", 26 -> "z", 27 -> "aa", 703 -> "aaa".
// Matches the algorithm the SOCIAL_SCHEMA migration uses when it dedupes
// pre-existing colliding names, so reclaimed names follow the same convention.
export function base26Suffix(index: number): string {
  let value = Math.max(1, Math.floor(index));
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

// The nth archival candidate for `original`: the original truncated just enough
// to leave room for the suffix, then the suffix appended, never exceeding
// MAX_NAME_LEN and always keeping at least one character of the original.
export function freedArchiveCandidate(original: string, index: number): string {
  const suffix = base26Suffix(index);
  const keep = Math.max(1, MAX_NAME_LEN - suffix.length);
  return original.slice(0, keep) + suffix;
}

// Guaranteed-unique archival fallback when the suffix scan is exhausted: the
// orphaned character's own (per-realm unique) id makes the name collision-free
// without another existence check. Not user-facing (the row carries force_rename),
// so it need not satisfy normalizeCharName.
export function archiveFallbackName(original: string, characterId: number): string {
  const tag = `~${characterId}`;
  const keep = Math.max(1, MAX_NAME_LEN - tag.length);
  return original.slice(0, keep) + tag;
}

// How many suffixed candidates to try before falling back to the id-based name.
// Normally resolves on the first candidate; the bound just protects against a
// pathological realm where many archival placeholders already collide.
export const ARCHIVE_SCAN_LIMIT = 64;

// Pick a collision-free archival name for the orphaned character. Scans the
// suffixed candidates in order, skipping any the injected `isTaken` predicate
// reports as already used (case-insensitive, in this realm) by another
// character, and on the practically impossible exhaustion returns the id-based
// fallback that cannot collide. Kept IO-free (the DB lookup is injected) so the
// scan/increment/fallback decision is unit-testable without a Postgres client;
// server/db.ts supplies the real SQL-backed predicate.
export async function chooseArchiveName(
  original: string,
  characterId: number,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (let index = 1; index <= ARCHIVE_SCAN_LIMIT; index++) {
    const candidate = freedArchiveCandidate(original, index);
    if (!(await isTaken(candidate))) return candidate;
  }
  return archiveFallbackName(original, characterId);
}
