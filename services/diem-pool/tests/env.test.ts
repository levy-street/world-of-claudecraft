import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEnv, resetEnvCache } from '@/lib/env';

const REQUIRED = {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
  KEY_ENCRYPTION_KEY: 'b'.repeat(64),
  INTERNAL_SHARED_SECRET: 'internal-secret-0123456789',
  ADMIN_TOKEN: 'admin-token-123',
};

const TUNABLES = [
  'REDIS_URL', 'VENICE_BASE_URL', 'VENICE_VALIDATION_MODEL', 'HOUSE_VENICE_API_KEY',
  'DIEM_DAILY_USD', 'MAX_DECLARED_DIEM', 'SPEND_HEADROOM', 'CLAUDIUM_PER_USD',
  'STANDBY_CLAUDIUM_PER_USD_CAPACITY', 'UPTIME_MULTIPLIER', 'UPTIME_STREAK_DAYS',
  'MAX_DAILY_SHARE', 'MIN_PROVIDERS_FOR_CAP', 'SUSPICION_MIN_USD',
  'GAME_WEBHOOK_URL', 'GAME_WEBHOOK_SECRET', 'RATE_LIMIT_REGISTER_PER_IP',
  'RATE_LIMIT_REGISTER_PER_WALLET', 'RATE_LIMIT_WINDOW_SECONDS',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of [...Object.keys(REQUIRED), ...TUNABLES]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, REQUIRED);
  resetEnvCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
});

describe('getEnv', () => {
  it('applies the documented economics defaults', () => {
    const env = getEnv();
    expect(env.SPEND_HEADROOM).toBe(0.9);
    expect(env.CLAUDIUM_PER_USD).toBe(100);
    expect(env.STANDBY_CLAUDIUM_PER_USD_CAPACITY).toBe(5);
    expect(env.UPTIME_MULTIPLIER).toBe(1.25);
    expect(env.UPTIME_STREAK_DAYS).toBe(30);
    expect(env.MAX_DAILY_SHARE).toBe(0.2);
    expect(env.MIN_PROVIDERS_FOR_CAP).toBe(5);
    expect(env.DIEM_DAILY_USD).toBe(1);
    expect(env.VENICE_BASE_URL).toBe('https://api.venice.ai/api/v1');
  });

  it('coerces numeric strings from the environment', () => {
    process.env.CLAUDIUM_PER_USD = '250';
    process.env.MAX_DAILY_SHARE = '0.10';
    const env = getEnv();
    expect(env.CLAUDIUM_PER_USD).toBe(250);
    expect(env.MAX_DAILY_SHARE).toBe(0.1);
  });

  it('rejects a malformed encryption key with a pointed message', () => {
    process.env.KEY_ENCRYPTION_KEY = 'not-hex';
    expect(() => getEnv()).toThrow(/KEY_ENCRYPTION_KEY must be 64 hex chars/);
  });

  it('rejects a short internal secret and out-of-range tunables', () => {
    process.env.INTERNAL_SHARED_SECRET = 'short';
    expect(() => getEnv()).toThrow(/INTERNAL_SHARED_SECRET/);

    Object.assign(process.env, REQUIRED);
    resetEnvCache();
    process.env.MAX_DAILY_SHARE = '1.5';
    expect(() => getEnv()).toThrow();
  });

  it('requires DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    expect(() => getEnv()).toThrow();
  });

  it('memoizes until reset', () => {
    const first = getEnv();
    process.env.CLAUDIUM_PER_USD = '999';
    expect(getEnv()).toBe(first);
    resetEnvCache();
    expect(getEnv().CLAUDIUM_PER_USD).toBe(999);
  });
});
