// Live-session character resolution for the storage purchase flow. Pure
// functions over the session table's iterable; server/main.ts wires them into
// the StoragePurchaseHost closures against game.clients.values().
//
// A QUARANTINED session counts as ABSENT, the same predicate every other
// custody wrapper uses (game.ts wocCustodySession and
// serializeCharacterForPersist both read `session.left ||
// session.escrowQuarantined`). Its live state was abandoned when its escrow
// was rolled back and game.ts saveCharacter refuses its saves outright, so
// admitting one here would let real Claudium be debited against a session
// that can never persist the grant: the apply would mutate an abandoned
// blob, the save would return false, and the bounded audit gap the flow
// documents would become a certainty for every purchase taken in that
// window. Refusing before any money moves is the same answer the market
// side gives (`character_invalid`); the ladder still converges at the next
// login, which is when a durable blob exists to apply against.
//
// IT ALSO LOOSENS THE AMBIGUITY REFUSAL, in the one direction that lets a
// purchase through where it used to refuse, and that is deliberate rather
// than a side effect nobody noticed. An account holding one live session
// AND one quarantined session used to answer null (two matches, ambiguous)
// and now answers the live one, because a quarantined session is abandoned
// and should no more count toward the census than it should be returned
// from it. Refusing a purchase because an abandoned session exists is a
// false refusal, not a safety property.

/** The slice of game.ts ClientSession these resolvers read. */
export interface LiveCharacterSessionLike {
  readonly accountId: number;
  readonly characterId: number;
  readonly pid: number;
  readonly left: boolean;
  readonly escrowQuarantined: boolean;
}

/**
 * The account's ONE live character session. More than one live session
 * (only GM supervision can create that) is ambiguous and refuses: a
 * purchase must map to exactly one character at initiation time. Left and
 * quarantined sessions are absent (module header); one live plus any number
 * of absent sessions resolves to the live one.
 */
export function resolveLiveCharacterFrom(
  sessions: Iterable<LiveCharacterSessionLike>,
  accountId: number,
): { characterId: number; pid: number } | null {
  let found: { characterId: number; pid: number } | null = null;
  for (const s of sessions) {
    if (s.accountId !== accountId || s.left || s.escrowQuarantined) continue;
    if (found) return null;
    found = { characterId: s.characterId, pid: s.pid };
  }
  return found;
}

/**
 * The saveCharacter selection: the character's live session, or null. Same
 * absence rule as the resolver above. game.saveCharacter already answers
 * false for a quarantined session, so this changes no outcome for a single
 * session; it matters when a quarantined session and a live one share a
 * character id, where taking the first match would answer false for a
 * character that can in fact save.
 */
export function findLiveSessionForCharacter<S extends LiveCharacterSessionLike>(
  sessions: Iterable<S>,
  characterId: number,
): S | null {
  for (const s of sessions) {
    if (s.characterId === characterId && !s.left && !s.escrowQuarantined) return s;
  }
  return null;
}
