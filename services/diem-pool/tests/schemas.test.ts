import { describe, expect, it } from 'vitest';
import {
  chatPayloadSchema,
  inferenceRequestSchema,
  killSwitchSchema,
  nonceRequestSchema,
  pricingUpsertSchema,
  registerSchema,
} from '@/lib/schemas';

const VALID_PAYLOAD = {
  model: 'llama-3.3-70b',
  messages: [{ role: 'user', content: 'hello' }],
};

describe('inferenceRequestSchema', () => {
  it('accepts a well-formed request', () => {
    const parsed = inferenceRequestSchema.parse({
      payload: VALID_PAYLOAD,
      purpose: 'npc_dialogue',
      gameAccountId: 'acct_1',
    });
    expect(parsed.purpose).toBe('npc_dialogue');
  });

  it('rejects unknown purposes', () => {
    expect(
      inferenceRequestSchema.safeParse({ payload: VALID_PAYLOAD, purpose: 'crypto_mining' }).success,
    ).toBe(false);
  });

  it('accepts modelClass without a concrete model, requires one of the two', () => {
    const noModel = { messages: [{ role: 'user', content: 'hi' }] };
    expect(
      inferenceRequestSchema.safeParse({ payload: noModel, purpose: 'npc_dialogue', modelClass: 'fast' })
        .success,
    ).toBe(true);
    expect(
      inferenceRequestSchema.safeParse({ payload: noModel, purpose: 'npc_dialogue' }).success,
    ).toBe(false);
    expect(
      inferenceRequestSchema.safeParse({ payload: VALID_PAYLOAD, purpose: 'npc_dialogue', modelClass: 'galaxy' })
        .success,
    ).toBe(false);
  });

  it('rejects empty messages, unknown roles, and oversized max_tokens', () => {
    expect(chatPayloadSchema.safeParse({ model: 'm', messages: [] }).success).toBe(false);
    expect(
      chatPayloadSchema.safeParse({ model: 'm', messages: [{ role: 'root', content: 'x' }] }).success,
    ).toBe(false);
    expect(
      chatPayloadSchema.safeParse({ ...VALID_PAYLOAD, max_tokens: 1_000_000 }).success,
    ).toBe(false);
    expect(chatPayloadSchema.safeParse({ ...VALID_PAYLOAD, max_tokens: 0 }).success).toBe(false);
  });

  it('caps message count at 200', () => {
    const messages = Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' }));
    expect(chatPayloadSchema.safeParse({ model: 'm', messages }).success).toBe(false);
  });

  it('passes through extra OpenAI params without dropping them', () => {
    const parsed = chatPayloadSchema.parse({ ...VALID_PAYLOAD, top_p: 0.9, stop: ['\n'] });
    expect((parsed as Record<string, unknown>).top_p).toBe(0.9);
    expect((parsed as Record<string, unknown>).stop).toEqual(['\n']);
  });

  it('bounds temperature to [0, 2]', () => {
    expect(chatPayloadSchema.safeParse({ ...VALID_PAYLOAD, temperature: 2.1 }).success).toBe(false);
    expect(chatPayloadSchema.safeParse({ ...VALID_PAYLOAD, temperature: 0 }).success).toBe(true);
  });
});

describe('registerSchema', () => {
  const VALID = {
    walletAddress: '7'.repeat(40),
    signedMessage: 'A'.repeat(88),
    nonce: 'f'.repeat(48),
    veniceApiKey: 'vn_key_0123456789abcdefgh',
    displayName: "Ser Pounce's Rig",
    declaredDiem: 25,
  };

  it('accepts a valid registration (vendor defaults to venice)', () => {
    const parsed = registerSchema.parse(VALID);
    expect(parsed.vendor).toBe('venice');
  });

  it('requires the capacity field matching the vendor', () => {
    // venice needs declaredDiem…
    expect(registerSchema.safeParse({ ...VALID, declaredDiem: undefined }).success).toBe(false);
    // …BYOK vendors need dailyBudgetUsd instead.
    const byok = { ...VALID, vendor: 'openai', declaredDiem: undefined };
    expect(registerSchema.safeParse(byok).success).toBe(false);
    expect(registerSchema.safeParse({ ...byok, dailyBudgetUsd: 25 }).success).toBe(true);
    expect(registerSchema.safeParse({ ...byok, dailyBudgetUsd: -5 }).success).toBe(false);
  });

  it('rejects unknown vendors', () => {
    expect(registerSchema.safeParse({ ...VALID, vendor: 'skynet' }).success).toBe(false);
  });

  it.each([
    ['declaredDiem zero', { declaredDiem: 0 }],
    ['declaredDiem negative', { declaredDiem: -5 }],
    ['declaredDiem fractional', { declaredDiem: 1.5 }],
    ['api key too short', { veniceApiKey: 'short' }],
    ['display name too short', { displayName: 'ab' }],
    ['display name illegal chars', { displayName: '<script>alert(1)</script>' }],
    ['display name too long', { displayName: 'x'.repeat(33) }],
    ['wallet too short', { walletAddress: 'abc' }],
    ['signature too short', { signedMessage: 'abc' }],
  ])('rejects %s', (_name, override) => {
    expect(registerSchema.safeParse({ ...VALID, ...override }).success).toBe(false);
  });
});

describe('auxiliary schemas', () => {
  it('nonce purpose is a closed enum', () => {
    expect(
      nonceRequestSchema.safeParse({ walletAddress: '7'.repeat(40), purpose: 'register' }).success,
    ).toBe(true);
    expect(
      nonceRequestSchema.safeParse({ walletAddress: '7'.repeat(40), purpose: 'admin' }).success,
    ).toBe(false);
  });

  it('pricing rates must be non-negative and sane', () => {
    const valid = { model: 'm', inputUsdPerMTokens: 1, outputUsdPerMTokens: 4 };
    expect(pricingUpsertSchema.parse(valid).active).toBe(true); // default
    expect(pricingUpsertSchema.safeParse({ ...valid, inputUsdPerMTokens: -1 }).success).toBe(false);
    expect(
      pricingUpsertSchema.safeParse({ ...valid, outputUsdPerMTokens: 1_000_001 }).success,
    ).toBe(false);
  });

  it('kill switch demands an explicit boolean', () => {
    expect(killSwitchSchema.safeParse({ paused: true }).success).toBe(true);
    expect(killSwitchSchema.safeParse({ paused: 'yes' }).success).toBe(false);
    expect(killSwitchSchema.safeParse({}).success).toBe(false);
  });
});
