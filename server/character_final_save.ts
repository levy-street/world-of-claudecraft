/** Retry the final character/market transaction without moving the retry sleep
 * into either FIFO. The departure tracker owns the complete retry lifetime. */
export async function saveDepartingCharacter(
  name: string,
  save: () => Promise<boolean>,
  isQuarantined: () => boolean,
  exhausted: (error: unknown) => void,
): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const saved = await save();
      // Quarantined state must never be written back over durable authority.
      if (!saved && !isQuarantined()) throw new Error('final character save was refused');
      return;
    } catch (error) {
      if (attempt === 5) {
        console.error(`save on leave failed after ${attempt} attempts for ${name}:`, error);
        exhausted(error);
        return;
      }
      const retryMs = Math.min(250 * 2 ** (attempt - 1), 4000);
      console.error(`save on leave failed for ${name}; retrying in ${retryMs}ms:`, error);
      await new Promise<void>((resolve) => setTimeout(resolve, retryMs));
    }
  }
}

interface SaveSession {
  name: string;
  dirtyGuildBanks: ReadonlyMap<number, number>;
  escrowQuarantined: boolean;
}

/** Preserve the bounded save sweep and its dirty-guild second pass. Shutdown
 * awaits every worker and reports unresolved failures instead of swallowing them. */
export async function saveCharacterSnapshot<S extends SaveSession>(
  sessions: readonly S[],
  reason: string,
  concurrency: number,
  save: (session: S, final?: boolean) => Promise<boolean>,
): Promise<void> {
  const failures = new Map<S, unknown>();
  const attempt = async (session: S, final = false) => {
    try {
      const saved = await save(session, final);
      if (reason === 'shutdown' && !saved && !session.escrowQuarantined)
        throw new Error('character save was refused');
      failures.delete(session);
    } catch (error) {
      failures.set(session, error);
      console.error(`${reason}${final ? ' retry' : ''} failed for ${session.name}:`, error);
    }
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, sessions.length) }, async () => {
      for (;;) {
        const session = sessions[next++];
        if (!session) return;
        await attempt(session);
      }
    }),
  );
  if (reason !== 'shutdown') return;
  // Other holders' first passes can make a deferred guild-book save possible.
  for (const session of sessions.filter((s) => s.dirtyGuildBanks.size > 0)) {
    await attempt(session, true);
  }
  if (failures.size > 0) {
    throw new AggregateError(
      [...failures.values()],
      `${failures.size} shutdown character saves failed`,
    );
  }
}
