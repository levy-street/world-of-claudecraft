import { describe, expect, it } from 'vitest';
import {
  CHAT_COOLDOWN_SECONDS,
  CHAT_RATE_BURST,
  consumeChatToken,
  createChatRateLimitState,
  refundChatToken,
} from '../server/chat_rate_limit';

describe('chat rate limit token bucket', () => {
  it('starts full and refills at the sustained rate', () => {
    const s = createChatRateLimitState(100);
    for (let i = 0; i < CHAT_RATE_BURST; i++) {
      expect(consumeChatToken(s, 100)).toEqual({ ok: true, notice: null });
    }
    expect(s.chatTokens).toBe(0);
    // 3 seconds refills exactly one token (1/3 per second).
    expect(consumeChatToken(s, 103).ok).toBe(true);
    expect(s.chatTokens).toBeCloseTo(0);
  });

  it('warns once per error cooldown, then locks out after repeated violations', () => {
    const s = createChatRateLimitState(100);
    s.chatTokens = 0;
    expect(consumeChatToken(s, 100)).toEqual({
      ok: false,
      notice: 'You are sending messages too quickly. Slow down.',
    });
    // A second refusal inside the error cooldown stays silent.
    expect(consumeChatToken(s, 101)).toEqual({ ok: false, notice: null });
    expect(s.chatRateViolations).toBe(2);
    // The third violation trips the lockout with its own notice.
    expect(consumeChatToken(s, 102)).toEqual({
      ok: false,
      notice: `Chat locked for ${CHAT_COOLDOWN_SECONDS}s because you are sending messages too quickly.`,
    });
    expect(s.chatCooldownUntil).toBe(102 + CHAT_COOLDOWN_SECONDS);
    expect(s.chatTokens).toBe(0);
  });

  it('reports the remaining cooldown at most once per error cooldown, then resets to a full bucket', () => {
    const s = createChatRateLimitState(100);
    s.chatCooldownUntil = 120;
    s.chatLastRateError = 100;
    expect(consumeChatToken(s, 101)).toEqual({ ok: false, notice: null });
    expect(consumeChatToken(s, 105)).toEqual({ ok: false, notice: 'Chat is on cooldown for 15s.' });
    expect(consumeChatToken(s, 106)).toEqual({ ok: false, notice: null });
    // Lockout over: the bucket refills fully and the violation count clears.
    expect(consumeChatToken(s, 120)).toEqual({ ok: true, notice: null });
    expect(s.chatCooldownUntil).toBe(0);
    expect(s.chatRateViolations).toBe(0);
    expect(s.chatTokens).toBe(CHAT_RATE_BURST - 1);
  });

  it('refunds one token without exceeding the burst', () => {
    const s = createChatRateLimitState(100);
    s.chatTokens = 1.5;
    refundChatToken(s);
    expect(s.chatTokens).toBe(2.5);
    s.chatTokens = CHAT_RATE_BURST;
    refundChatToken(s);
    expect(s.chatTokens).toBe(CHAT_RATE_BURST);
  });
});
