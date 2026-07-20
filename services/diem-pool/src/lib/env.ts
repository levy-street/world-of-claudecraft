import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  KEY_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  INTERNAL_SHARED_SECRET: z.string().min(16, 'INTERNAL_SHARED_SECRET must be at least 16 chars'),
  ADMIN_TOKEN: z.string().min(8, 'ADMIN_TOKEN must be at least 8 chars'),

  VENICE_BASE_URL: z.string().url().default('https://api.venice.ai/api/v1'),
  VENICE_VALIDATION_MODEL: z.string().default('llama-3.2-3b'),
  HOUSE_VENICE_API_KEY: z.string().default(''),

  DIEM_DAILY_USD: z.coerce.number().positive().default(1),
  MAX_DECLARED_DIEM: z.coerce.number().int().positive().default(10000),
  SPEND_HEADROOM: z.coerce.number().min(0.1).max(1).default(0.9),

  CLAUDIUM_PER_USD: z.coerce.number().positive().default(100),
  STANDBY_CLAUDIUM_PER_USD_CAPACITY: z.coerce.number().min(0).default(5),
  UPTIME_MULTIPLIER: z.coerce.number().min(1).default(1.25),
  UPTIME_STREAK_DAYS: z.coerce.number().int().positive().default(30),
  MAX_DAILY_SHARE: z.coerce.number().gt(0).max(1).default(0.2),
  MIN_PROVIDERS_FOR_CAP: z.coerce.number().int().min(1).default(5),
  SUSPICION_MIN_USD: z.coerce.number().min(0).default(0.5),

  GAME_WEBHOOK_URL: z.union([z.string().url(), z.literal('')]).default(''),
  GAME_WEBHOOK_SECRET: z.string().default(''),

  RATE_LIMIT_REGISTER_PER_IP: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_REGISTER_PER_WALLET: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validated process env. Parsed once, throws with a readable message on misconfiguration. */
export function getEnv(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}

/** Test hook. */
export function resetEnvCache(): void {
  cached = null;
}
