import { z } from 'zod';

export const purposeSchema = z.enum([
  'npc_dialogue',
  'quest_gen',
  'dungeon_master',
  'agent_player',
  'image_gen',
]);
export type Purpose = z.infer<typeof purposeSchema>;

export const vendorSchema = z.enum(['venice', 'openai', 'anthropic', 'kimi']);

export const modelClassSchema = z.enum(['fast', 'standard', 'smart']);
export type ModelClassName = z.infer<typeof modelClassSchema>;

// OpenAI-style chat payload. Validated fields are the ones we depend on;
// passthrough() lets callers use any other standard parameter (top_p, stop,
// response_format, …) without us maintaining the full surface. `stream` is
// stripped at the Venice client - v1 is non-streaming.
export const chatPayloadSchema = z
  .object({
    // Optional when the request carries a modelClass; when present it pins
    // routing - "vendor:model" targets that vendor, a bare model is Venice
    // (the pre-multi-vendor contract).
    model: z.string().min(1).max(120).optional(),
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

export const inferenceRequestSchema = z
  .object({
    payload: chatPayloadSchema,
    purpose: purposeSchema,
    /** Game-facing model tier, resolved per vendor via ModelClassMap. */
    modelClass: modelClassSchema.optional(),
    /** Game account that triggered the call - feeds self-dealing detection. */
    gameAccountId: z.string().min(1).max(128).optional(),
  })
  .refine((r) => r.modelClass !== undefined || r.payload.model !== undefined, {
    message: 'either modelClass or payload.model is required',
  });

export const nonceRequestSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  purpose: z.enum(['register', 'revoke']),
  /** Register only: the signed message binds the vendor being registered. */
  vendor: vendorSchema.optional().default('venice'),
});

export const registerSchema = z
  .object({
    walletAddress: z.string().min(32).max(44),
    /** Signature over the server-built message (base58 or base64). */
    signedMessage: z.string().min(64).max(120),
    nonce: z.string().min(16).max(64),
    vendor: vendorSchema.optional().default('venice'),
    /** The vendor API key being delegated (name kept for back-compat). */
    veniceApiKey: z.string().min(20).max(256),
    displayName: z
      .string()
      .min(3)
      .max(32)
      .regex(/^[\w\- ']+$/u, 'letters, digits, spaces, - _ \' only'),
    /** Venice only: staked DIEM; capacity = declaredDiem × DIEM_DAILY_USD. */
    declaredDiem: z.number().int().positive().optional(),
    /** BYOK vendors: self-imposed daily donation budget in USD. */
    dailyBudgetUsd: z.number().positive().optional(),
  })
  .refine((r) => (r.vendor === 'venice' ? r.declaredDiem !== undefined : r.dailyBudgetUsd !== undefined), {
    message: 'venice registration requires declaredDiem; other vendors require dailyBudgetUsd',
  });

export const revokeSchema = z.object({
  signedMessage: z.string().min(64).max(120),
  nonce: z.string().min(16).max(64),
});

export const pricingUpsertSchema = z.object({
  vendor: vendorSchema.optional().default('venice'),
  model: z.string().min(1).max(120),
  inputUsdPerMTokens: z.number().min(0).max(100_000),
  outputUsdPerMTokens: z.number().min(0).max(100_000),
  active: z.boolean().optional().default(true),
});

export const killSwitchSchema = z.object({ paused: z.boolean() });

export const vendorConfigUpdateSchema = z.object({
  vendor: vendorSchema,
  enabled: z.boolean().optional(),
  rewardMultiplier: z.number().min(0).max(10).optional(),
  standbyEligible: z.boolean().optional(),
  vestingDays: z.number().int().min(0).max(90).optional(),
  trustRampEnabled: z.boolean().optional(),
});
