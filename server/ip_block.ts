// In-memory IP blocklist cache.
// Consulted on every register/login/WS-connect, so the blocklist lives in memory
// (filled from ip_block_db.ts) rather than hitting the DB per connection. `nowMs`
// is passed in rather than read so the class stays pure and unit-testable.

import * as net from 'node:net';
import { normalizeIp } from './ratelimit';

export interface IpBlockEntry {
  ip: string;
  expiresAtMs: number | null;
}

// normalizeIp canonicalizes (shared with the connect side); cleanIp adds the
// validation, returning '' for anything net.isIP rejects — 'unknown', partial
// IPs, garbage — so an invalid block can't be stored.
export function cleanIp(value: unknown): string {
  const s = normalizeIp(typeof value === 'string' ? value.trim() : '');
  return net.isIP(s) ? s : '';
}

// '' / null / undefined → null (permanent). A present value must parse to a
// future date or it throws.
export function parseBlockExpiry(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime()) || d.getTime() <= Date.now()) {
    throw new Error('block expiry must be in the future');
  }
  return d;
}

export class IpBlockList {
  private entries = new Map<string, number | null>();

  setEntries(entries: IpBlockEntry[]): void {
    const next = new Map<string, number | null>();
    for (const e of entries) {
      if (e.ip) next.set(e.ip, e.expiresAtMs);
    }
    this.entries = next;
  }

  isBlocked(ip: string, nowMs: number): boolean {
    if (!this.entries.has(ip)) return false;
    const expiresAtMs = this.entries.get(ip) ?? null;
    return expiresAtMs === null || expiresAtMs > nowMs;
  }

  get size(): number {
    return this.entries.size;
  }
}

export function isConnectionRefused(input: {
  blocked: boolean;
  isAdmin: boolean;
  ipSessions: number;
  hardLimit: number;
}): boolean {
  if (input.isAdmin) return false;
  return input.blocked || input.ipSessions >= input.hardLimit;
}
