import { Redis } from 'ioredis';
import { getEnv } from './env';

const globalForRedis = globalThis as unknown as { redis?: Redis };

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(getEnv().REDIS_URL, {
      // BullMQ requires this; harmless for rate limiting.
      maxRetriesPerRequest: null,
    });
  }
  return globalForRedis.redis;
}
