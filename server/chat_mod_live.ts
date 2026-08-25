// mutedUntil is ISO-or-null, the same shape server/db.ts's AccountChatMuteStatus/
// AccountModerationStatus already read: resolve() never compares mutedUntil
// values (it orders on generation alone), so there is no reason to convert it
// to an epoch and risk reformatting the string a resume that needed no live
// override would otherwise pass straight through untouched.
export interface ChatModerationState {
  mutedUntil: string | null;
  reason: string;
  strikes: number;
}

export interface ChatModerationHydration {
  resolve(hydrated: ChatModerationState): ChatModerationState;
  release(): void;
}

// A session-shaped source for the push helpers below: whatever currently
// holds the live fields (ClientSession satisfies this structurally).
export interface ChatModerationSource {
  accountId: number;
  chatMutedUntil: number | null;
  chatMuteReason: string;
  chatStrikes: number;
}

function isoMutedUntil(chatMutedUntil: number | null): string | null {
  // Number.isFinite, not a bare null check: every current producer of
  // session.chatMutedUntil is either null-guarded (muteAccountChat) or
  // DB-derived, but toISOString() throws RangeError on NaN, and a throw
  // escaping mid-loop here (liftChatMuteLive/resetChatStrikesLive iterate
  // several sessions) would leave some of an account's sessions pushed and
  // others not.
  return chatMutedUntil !== null && Number.isFinite(chatMutedUntil)
    ? new Date(chatMutedUntil).toISOString()
    : null;
}

/**
 * Records a session's current mute+reason as its account's latest live push.
 * Deliberately separate from pushStrikesChange: a session's chat_strikes can
 * be stale for an unrelated reason (e.g. a cross-realm change this process
 * never saw), and folding it into the same push would let a strikes-only
 * write resurrect that stale mute state during a hydration window it has no
 * fresher information about. See ChatModerationLiveState below.
 */
export function pushMuteChange(
  liveState: ChatModerationLiveState,
  session: ChatModerationSource,
): void {
  liveState.muteChanged(session.accountId, {
    mutedUntil: isoMutedUntil(session.chatMutedUntil),
    reason: session.chatMuteReason,
  });
}

/** The strikes-only counterpart to pushMuteChange; see its header. */
export function pushStrikesChange(
  liveState: ChatModerationLiveState,
  session: ChatModerationSource,
): void {
  liveState.strikesChanged(session.accountId, session.chatStrikes);
}

interface LiveModerationEntry {
  muteGeneration: number;
  mutedUntil: string | null;
  reason: string;
  strikesGeneration: number;
  strikes: number;
}

// Bounded like the sibling cache below; an in-progress hydration stays pinned
// past this bound so a resolve() mid-scan never loses the push it exists to
// catch.
const CHAT_MODERATION_CACHE_MAX_ACCOUNTS = 4_096;

/**
 * Orders the reconnect handshake's account chat-moderation DB read (mute,
 * reason, strikes) with a live push landing during that SAME handshake,
 * without a second database read. Mirrors GeneralChatRateLimitLiveState
 * (server/general_chat_quota.ts), the pattern that already solves this exact
 * TOCTOU shape for the sibling per-account chat control: without it, a
 * snapshot read at handshake start can lose a mute, unmute, or strike change
 * (an admin action, or the chat filter's own optimistic set) that lands on
 * the SAME still-linkdead session before that snapshot resolves, silently
 * un-enforcing (or under-escalating) a live sanction on resume.
 *
 * The mute/reason pair and strikes are fenced with INDEPENDENT generations
 * (not one combined generation), and resolve() merges them field by field.
 * A single combined generation would let a push that only confirms one of
 * the two (say, a strikes reset) also resurrect the OTHER one from the
 * session's own possibly-stale mirror -- exactly the cross-realm-divergence
 * failure this fence exists to prevent, just moved to a different field.
 *
 * A field with no concurrent push trusts the fresh DB read for THAT field
 * completely: that is what keeps a mute/unmute/reset issued through a
 * DIFFERENT realm process self-healing on the next resume (accounts.chat_
 * muted_until and chat_strikes are account-wide, but a live push here only
 * ever reaches THIS process's sessions, so there is nothing live to prefer
 * over a fresh read from a handshake this process never pushed to).
 */
export class ChatModerationLiveState {
  readonly #latest = new Map<number, LiveModerationEntry>();
  readonly #pins = new Map<number, number>();
  #generation = 0;

  beginHydration(accountId: number): ChatModerationHydration {
    const entry = this.#latest.get(accountId);
    const capturedMuteGeneration = entry?.muteGeneration ?? 0;
    const capturedStrikesGeneration = entry?.strikesGeneration ?? 0;
    this.#pins.set(accountId, (this.#pins.get(accountId) ?? 0) + 1);
    let released = false;
    return {
      resolve: (hydrated) => {
        const latest = this.#latest.get(accountId);
        const pushedMute = latest !== undefined && latest.muteGeneration !== capturedMuteGeneration;
        const useStrikes =
          latest !== undefined && latest.strikesGeneration !== capturedStrikesGeneration;
        return {
          mutedUntil: pushedMute ? latest.mutedUntil : hydrated.mutedUntil,
          reason: pushedMute ? latest.reason : hydrated.reason,
          strikes: useStrikes ? latest.strikes : hydrated.strikes,
        };
      },
      release: () => {
        if (released) return;
        released = true;
        const left = (this.#pins.get(accountId) ?? 1) - 1;
        if (left > 0) this.#pins.set(accountId, left);
        else this.#pins.delete(accountId);
        this.#trim();
      },
    };
  }

  muteChanged(accountId: number, mute: { mutedUntil: string | null; reason: string }): void {
    this.#generation++;
    const prev = this.#latest.get(accountId);
    this.#latest.delete(accountId);
    this.#latest.set(accountId, {
      muteGeneration: this.#generation,
      mutedUntil: mute.mutedUntil,
      reason: mute.reason,
      strikesGeneration: prev?.strikesGeneration ?? 0,
      strikes: prev?.strikes ?? 0,
    });
    this.#trim();
  }

  strikesChanged(accountId: number, strikes: number): void {
    this.#generation++;
    const prev = this.#latest.get(accountId);
    this.#latest.delete(accountId);
    this.#latest.set(accountId, {
      muteGeneration: prev?.muteGeneration ?? 0,
      mutedUntil: prev?.mutedUntil ?? null,
      reason: prev?.reason ?? '',
      strikesGeneration: this.#generation,
      strikes,
    });
    this.#trim();
  }

  get cachedAccounts(): number {
    return this.#latest.size;
  }

  #trim(): void {
    if (this.#latest.size <= CHAT_MODERATION_CACHE_MAX_ACCOUNTS) return;
    for (const accountId of this.#latest.keys()) {
      if (this.#latest.size <= CHAT_MODERATION_CACHE_MAX_ACCOUNTS) return;
      if (!this.#pins.has(accountId)) this.#latest.delete(accountId);
    }
  }
}
