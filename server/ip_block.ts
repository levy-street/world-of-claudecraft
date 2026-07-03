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

// Per-IP cap on IN-FLIGHT pre-auth WebSocket sockets (upgraded but not yet joined
// a game session). The existing session cap (isConnectionRefused / countIpSessions)
// only counts ESTABLISHED sessions and is checked AFTER several DB lookups in the
// auth handshake, so without this an IP could open many sockets and force those
// lookups unbounded. A socket is acquired at the upgrade event and released when it
// authenticates (becoming a counted session) or its socket closes/errors/times out.
// Pure + unit-testable: no timers, no socket refs, just the per-IP tally.
export class PreAuthConnections {
  private counts = new Map<string, number>();
  constructor(private readonly cap: number) {}

  // Reserve a slot for `ip`. Returns false (and reserves nothing) when the IP is
  // already at the cap, so the caller destroys the socket before the handshake.
  tryAcquire(ip: string): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (n >= this.cap) return false;
    this.counts.set(ip, n + 1);
    return true;
  }

  // Free a slot. Safe to call more than once for the same socket and when the IP
  // has no reservation (never drives the tally negative); the caller guards
  // once-per-socket, this guards the map.
  release(ip: string): void {
    const n = this.counts.get(ip);
    if (n === undefined) return;
    if (n <= 1) this.counts.delete(ip);
    else this.counts.set(ip, n - 1);
  }

  countFor(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }

  get size(): number {
    return this.counts.size;
  }
}
