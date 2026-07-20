import { z } from 'zod';

export const purposeSchema = z.enum([
  'npc_dialogue',
  'quest_gen',
  'dungeon_master',
  'agent_player',
  'image_gen',
]);
export type Purpose = z.infer<typeof purposeSchema>;

// OpenAI-style chat payload. Validated fields are the ones we depend on;
// passthrough() lets callers use any other standard parameter (top_p, stop,
// response_format, …) without us maintaining the full surface. `stream` is
// stripped at the Venice client — v1 is non-streaming.
export const chatPayloadSchema = z
  .object({
    model: z.string().min(1).max(120),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'user', 'assistant', 'tool']),
            content: z.union([z.string(), z.array(z.unknown()), z.null()]),
          })
          .passthrough(),
      )
      .min(1)
      .max(200),
    max_tokens: z.number().int().positive().max(32_768).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .passthrough();

export const inferenceRequestSchema = z.object({
  payload: chatPayloadSchema,
  purpose: purposeSchema,
  /** Game account that triggered the call — feeds self-dealing detection. */
  gameAccountId: z.string().min(1).max(128).optional(),
});

export const nonceRequestSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  purpose: z.enum(['register', 'revoke']),
});

export const registerSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  /** Signature over the server-built message (base58 or base64). */
  signedMessage: z.string().min(64).max(120),
  nonce: z.string().min(16).max(64),
  veniceApiKey: z.string().min(20).max(256),
  displayName: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[\w\- ']+$/u, 'letters, digits, spaces, - _ \' only'),
  /** Staked DIEM the provider declares; capacity = declaredDiem * DIEM_DAILY_USD. */
  declaredDiem: z.number().int().positive(),
});

export const revokeSchema = z.object({
  signedMessage: z.string().min(64).max(120),
  nonce: z.string().min(16).max(64),
});

export const pricingUpsertSchema = z.object({
  model: z.string().min(1).max(120),
  inputUsdPerMTokens: z.number().min(0).max(100_000),
  outputUsdPerMTokens: z.number().min(0).max(100_000),
  active: z.boolean().optional().default(true),
});

export const killSwitchSchema = z.object({ paused: z.boolean() });
