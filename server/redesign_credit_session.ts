// Mirroring a SPENT redesign credit onto a live session.
//
// A sibling module rather than another GameServer method (server/CLAUDE.md:
// new loop-side behavior is a sibling module, never another method cluster), and
// it needs no GameServer internals: a narrow host interface is enough, which is
// also what lets a Vitest drive it with a plain fake instead of a live realm.
//
// WHY IT EXISTS: the paid redesign route (server/character_redesign.ts)
// decrements the credit inside the stored state blob, and a character who is IN
// WORLD while that lands still holds the old count in memory. Its 30 s autosave
// would write the spent credit straight back and hand the player a free second
// redesign. This is the credit-side twin of setHelmHiddenForCharacter, and the
// one push whose absence is an economy bug rather than cosmetic lag.

/** The slice of a live session this needs: which character it is playing, and
 *  the sim pid to reach its PlayerMeta by. */
export interface RedesignCreditSession {
  readonly characterId: number | null;
  readonly pid: number;
}

/** The slice of the Sim this needs: PlayerMeta lookup by pid. Structural, so the
 *  real `Sim` satisfies it without this module importing the sim. */
export interface RedesignCreditSimView {
  players: { get(pid: number): { redesignCredits?: number } | undefined };
}

/**
 * Decrement the in-memory credit count for every live session playing
 * `characterId`. Returns whether anything was in world to push to.
 *
 * Clamped at zero: the row is the authority on how many remain, and a live
 * session that somehow reads low must never go negative. At the last credit the
 * key is DROPPED rather than written as 0, matching serializeCharacter's
 * zero-default omission, so a pushed session and a fresh load agree byte for
 * byte.
 */
export function spendRedesignCreditOnSessions(
  sim: RedesignCreditSimView,
  sessions: Iterable<RedesignCreditSession>,
  characterId: number,
): boolean {
  let pushed = false;
  for (const s of sessions) {
    if (s.characterId !== characterId) continue;
    const meta = sim.players.get(s.pid);
    if (!meta) continue;
    const held = typeof meta.redesignCredits === 'number' ? meta.redesignCredits : 0;
    const left = Math.max(0, Math.floor(held) - 1);
    if (left > 0) meta.redesignCredits = left;
    else meta.redesignCredits = undefined;
    pushed = true;
  }
  return pushed;
}
