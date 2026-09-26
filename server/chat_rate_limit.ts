// Per-session chat token bucket (extracted from server/game.ts to pay for the
// guild-bank autosave's own lines under the monolith ratchet; behavior is
// byte-identical to the coordinator methods it replaces: a move, not a
// rewrite). The bucket is host-agnostic: it mutates the session's rate fields
// and returns the verdict plus the player-facing error text the coordinator
// sends, so a Vitest can drive it with a plain object and a fake clock.
//
// The error texts stay English on purpose: they cross the wire as event text
// and src/ui/server_i18n.ts re-localizes them on the client (the S3 guard in
// tests/localization_fixes.test.ts pins the pairing).

export const CHAT_RATE_BURST = 5;
export const CHAT_RATE_REFILL_PER_SECOND = 1 / 3; // sustained 20 messages/minute
export const CHAT_RATE_ERROR_COOLDOWN_SECONDS = 4;
export const CHAT_COOLDOWN_SECONDS = 20;
export const CHAT_RATE_VIOLATIONS_FOR_COOLDOWN = 3;

export interface ChatRateLimitState {
  chatTokens: number;
  chatLastRefill: number;
  chatLastRateError: number;
  chatRateViolations: number;
  chatCooldownUntil: number;
}

export interface ChatTokenVerdict {
  ok: boolean;
  // Error text to send the player, or null when the refusal stays silent
  // (a rate error was already shown within CHAT_RATE_ERROR_COOLDOWN_SECONDS).
  notice: string | null;
}

export function createChatRateLimitState(nowSec: number): ChatRateLimitState {
  return {
    chatTokens: CHAT_RATE_BURST,
    chatLastRefill: nowSec,
    chatLastRateError: 0,
    chatRateViolations: 0,
    chatCooldownUntil: 0,
  };
}

// Spend one chat token at `now` (seconds). Repeated empty-bucket sends escalate
// to a CHAT_COOLDOWN_SECONDS lockout; the first send after the lockout expires
// starts from a full bucket.
export function consumeChatToken(state: ChatRateLimitState, now: number): ChatTokenVerdict {
  if (state.chatCooldownUntil > now) {
    if (now - state.chatLastRateError >= CHAT_RATE_ERROR_COOLDOWN_SECONDS) {
      state.chatLastRateError = now;
      const remaining = Math.ceil(state.chatCooldownUntil - now);
      return { ok: false, notice: `Chat is on cooldown for ${remaining}s.` };
    }
    return { ok: false, notice: null };
  }
  if (state.chatCooldownUntil > 0) {
    state.chatCooldownUntil = 0;
    state.chatRateViolations = 0;
    state.chatTokens = CHAT_RATE_BURST;
  }
  const elapsed = Math.max(0, now - state.chatLastRefill);
  state.chatTokens = Math.min(
    CHAT_RATE_BURST,
    state.chatTokens + elapsed * CHAT_RATE_REFILL_PER_SECOND,
  );
  state.chatLastRefill = now;
  if (state.chatTokens >= 1) {
    state.chatTokens -= 1;
    state.chatRateViolations = 0;
    return { ok: true, notice: null };
  }
  state.chatRateViolations++;
  if (state.chatRateViolations >= CHAT_RATE_VIOLATIONS_FOR_COOLDOWN) {
    state.chatCooldownUntil = now + CHAT_COOLDOWN_SECONDS;
    state.chatTokens = 0;
    state.chatLastRateError = now;
    return {
      ok: false,
      notice: `Chat locked for ${CHAT_COOLDOWN_SECONDS}s because you are sending messages too quickly.`,
    };
  }
  if (now - state.chatLastRateError >= CHAT_RATE_ERROR_COOLDOWN_SECONDS) {
    state.chatLastRateError = now;
    return { ok: false, notice: 'You are sending messages too quickly. Slow down.' };
  }
  return { ok: false, notice: null };
}

// Give back a token a caller charged but did not use (a command that was
// refused after the toll was paid).
export function refundChatToken(state: ChatRateLimitState): void {
  state.chatTokens = Math.min(CHAT_RATE_BURST, state.chatTokens + 1);
}
