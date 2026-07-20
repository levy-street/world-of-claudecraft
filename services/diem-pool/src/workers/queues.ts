import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { getEnv } from '@/lib/env';
import type { VendorName } from '@/lib/vendors/config';

export const MAINTENANCE_QUEUE = 'pool-maintenance';
/** The game backend consumes this queue to credit players' Claudium balances. */
export const SETTLEMENT_EVENTS_QUEUE = 'settlement-events';

export function newBullConnection(): Redis {
  return new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
}

let settlementEventsQueue: Queue | null = null;

export function getSettlementEventsQueue(): Queue {
  if (!settlementEventsQueue) {
    settlementEventsQueue = new Queue(SETTLEMENT_EVENTS_QUEUE, { connection: newBullConnection() });
  }
  return settlementEventsQueue;
}

export interface SettlementEvent {
  /** Consumers must dedupe on (providerId, date) — delivery is at-least-once. */
  providerId: string;
  wallet: string;
  vendor: VendorName;
  date: string; // YYYY-MM-DD (UTC)
  consumedUsd: number;
  baseClaudium: number;
  multiplier: number;
  standbyClaudium: number;
  capped: boolean;
  totalClaudium: number;
}
