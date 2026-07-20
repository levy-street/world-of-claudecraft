// BullMQ worker process: health probes (every 30 min) + daily settlement
// (midnight UTC). Run alongside the Next.js app:  npm run worker

try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — rely on real environment variables */
}

import { Queue, Worker } from 'bullmq';
import { MAINTENANCE_QUEUE, newBullConnection } from './queues';
import { runHealthProbes } from './health';
import { runDailySettlement } from './settle';

async function main(): Promise<void> {
  const queue = new Queue(MAINTENANCE_QUEUE, { connection: newBullConnection() });

  await queue.upsertJobScheduler(
    'health-probe',
    { every: 30 * 60 * 1000 },
    { name: 'health-probe', opts: { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } } },
  );
  // Settlement MUST eventually run for every day — a transient DB failure at
  // midnight retries with backoff instead of silently waiting a full day.
  await queue.upsertJobScheduler(
    'daily-settlement',
    { pattern: '0 0 * * *', tz: 'UTC' },
    {
      name: 'daily-settlement',
      opts: { attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
    },
  );

  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === 'health-probe') await runHealthProbes();
      else if (job.name === 'daily-settlement') await runDailySettlement();
    },
    {
      connection: newBullConnection(),
      concurrency: 1,
      // Settlement must not run twice concurrently; retries come from the
      // scheduler's next tick rather than BullMQ backoff.
    },
  );

  worker.on('completed', (job) => console.log(`[worker] ${job.name} completed`));
  worker.on('failed', (job, err) => console.error(`[worker] ${job?.name} failed:`, err.message));

  const shutdown = async () => {
    console.log('[worker] shutting down');
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[worker] pool maintenance worker up (health: 30m, settlement: 00:00 UTC)');
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
