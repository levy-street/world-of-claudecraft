// Resolves a typed character name to one live session: an exact-case match
// wins outright, otherwise a case-insensitive match counts only when it is
// unique (two sessions that differ by case alone resolve to nobody rather than
// to whichever the iteration reached first).
export function findSessionByName<TSession extends { name: string }>(
  sessions: Iterable<TSession>,
  name: string,
): TSession | null {
  const wanted = name.trim();
  const lower = wanted.toLowerCase();
  let caseInsensitive: TSession | null = null;
  let caseInsensitiveCount = 0;
  for (const session of sessions) {
    if (session.name === wanted) return session;
    if (session.name.toLowerCase() === lower) {
      caseInsensitive = session;
      caseInsensitiveCount++;
    }
  }
  return caseInsensitiveCount === 1 ? caseInsensitive : null;
}
