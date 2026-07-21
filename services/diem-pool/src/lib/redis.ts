import { Redis } from 'ioredis';
import { getEnv } from './env';

const globalForRedis = globalThis as unknown as { redis?: Redis };

/**
 * App-side Redis client (rate limiting, health checks). Configured to FAIL
 * FAST: with Redis down, commands reject immediately instead of queueing -
 * callers fail open rather than hanging requests. BullMQ uses its own
 * connections (workers/queues.ts) with the blocking-friendly settings it
 * requires.
 */
export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    const redis = new Redis(getEnv().REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
    });
    // ioredis emits 'error' on connection loss; without a listener Node
    // treats it as an unhandled error event and crashes the process.
    redis.on('error', (err) => console.error('[redis] connection error:', err.message));
    globalForRedis.redis = redis;
  }
  return globalForRedis.redis;
}
