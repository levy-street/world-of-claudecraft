import { describe, expect, it } from 'vitest';
import {
  cleanIp,
  IpBlockList,
  isConnectionRefused,
  PreAuthConnections,
  parseBlockExpiry,
} from '../server/ip_block';
import { normalizeIp } from '../server/ratelimit';

const NOW = 1_000_000;

describe('IpBlockList', () => {
  it('blocks a permanent entry regardless of time', () => {
    const list = new IpBlockList();
    list.setEntries([{ ip: '1.2.3.4', expiresAtMs: null }]);
    expect(list.isBlocked('1.2.3.4', NOW)).toBe(true);
    expect(list.isBlocked('1.2.3.4', NOW + 10_000_000)).toBe(true);
  });

  it('does not block an unknown IP', () => {
    const list = new IpBlockList();
    list.setEntries([{ ip: '1.2.3.4', expiresAtMs: null }]);
    expect(list.isBlocked('5.6.7.8', NOW)).toBe(false);
  });

  it('honours expiry: blocked before, free after', () => {
    const list = new IpBlockList();
    list.setEntries([{ ip: '1.2.3.4', expiresAtMs: NOW + 1000 }]);
    expect(list.isBlocked('1.2.3.4', NOW)).toBe(true);
    expect(list.isBlocked('1.2.3.4', NOW + 999)).toBe(true);
    expect(list.isBlocked('1.2.3.4', NOW + 1000)).toBe(false);
    expect(list.isBlocked('1.2.3.4', NOW + 5000)).toBe(false);
  });

  it('setEntries replaces the whole set', () => {
    const list = new IpBlockList();
    list.setEntries([{ ip: '1.1.1.1', expiresAtMs: null }]);
    list.setEntries([{ ip: '2.2.2.2', expiresAtMs: null }]);
    expect(list.isBlocked('1.1.1.1', NOW)).toBe(false);
    expect(list.isBlocked('2.2.2.2', NOW)).toBe(true);
    expect(list.size).toBe(1);
  });

  it('ignores empty IPs', () => {
    const list = new IpBlockList();
    list.setEntries([
      { ip: '', expiresAtMs: null },
      { ip: '9.9.9.9', expiresAtMs: null },
    ]);
    expect(list.isBlocked('', NOW)).toBe(false);
    expect(list.size).toBe(1);
  });

  it('is IPv6-compliant: blocks loopback and full IPv6 addresses, honouring expiry', () => {
    const list = new IpBlockList();
    list.setEntries([
      { ip: '::1', expiresAtMs: null },
      { ip: '2001:db8::ff00:42:8329', expiresAtMs: NOW + 1000 },
    ]);
    expect(list.isBlocked('::1', NOW)).toBe(true);
    expect(list.isBlocked('2001:db8::ff00:42:8329', NOW)).toBe(true);
    expect(list.isBlocked('2001:db8::ff00:42:8329', NOW + 1000)).toBe(false);
    expect(list.isBlocked('2001:db8::1', NOW)).toBe(false);
  });
});

describe('cleanIp', () => {
  it('canonicalizes IPv6 so an uppercase/uncompressed paste matches the connecting client', () => {
    expect(cleanIp('2001:DB8::1')).toBe('2001:db8::1');
    expect(cleanIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(cleanIp('::1')).toBe('::1');
  });

  it('canonicalizes round-trip: stored uppercase v6 is found via the canonical form', () => {
    const list = new IpBlockList();
    list.setEntries([{ ip: cleanIp('2001:DB8::1'), expiresAtMs: null }]);
    expect(list.isBlocked('2001:db8::1', NOW)).toBe(true);
  });

  it('strips IPv4-mapped IPv6 to dotted v4', () => {
    expect(cleanIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(cleanIp('::FFFF:203.0.113.5')).toBe('203.0.113.5');
  });

  it('rejects invalid input, partial IPs and the "unknown" fallback', () => {
    expect(cleanIp('203.0.113')).toBe('');
    expect(cleanIp('hello')).toBe('');
    expect(cleanIp('unknown')).toBe('');
    expect(cleanIp('')).toBe('');
    expect(cleanIp(null)).toBe('');
    expect(cleanIp(']evil')).toBe('');
  });
});

describe('parseBlockExpiry', () => {
  it('treats empty/null/undefined as permanent (null)', () => {
    expect(parseBlockExpiry('')).toBeNull();
    expect(parseBlockExpiry(null)).toBeNull();
    expect(parseBlockExpiry(undefined)).toBeNull();
  });

  it('accepts a future date', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(parseBlockExpiry(future)?.toISOString()).toBe(future);
  });

  it('throws on a past or unparseable date', () => {
    expect(() => parseBlockExpiry(new Date(Date.now() - 1000).toISOString())).toThrow();
    expect(() => parseBlockExpiry('not-a-date')).toThrow();
  });
});

describe('isConnectionRefused', () => {
  it('refuses a blocked non-admin', () => {
    expect(
      isConnectionRefused({ blocked: true, isAdmin: false, ipSessions: 0, hardLimit: 20 }),
    ).toBe(true);
  });

  it('lets a blocked admin through (full bypass)', () => {
    expect(
      isConnectionRefused({ blocked: true, isAdmin: true, ipSessions: 0, hardLimit: 20 }),
    ).toBe(false);
    expect(
      isConnectionRefused({ blocked: true, isAdmin: true, ipSessions: 999, hardLimit: 20 }),
    ).toBe(false);
  });

  it('enforces the hard per-IP cap on non-admins', () => {
    expect(
      isConnectionRefused({ blocked: false, isAdmin: false, ipSessions: 20, hardLimit: 20 }),
    ).toBe(true);
    expect(
      isConnectionRefused({ blocked: false, isAdmin: false, ipSessions: 19, hardLimit: 20 }),
    ).toBe(false);
  });
});

describe('PreAuthConnections', () => {
  it('acquires up to the cap per IP, then refuses without reserving', () => {
    const p = new PreAuthConnections(2);
    expect(p.tryAcquire('1.1.1.1')).toBe(true);
    expect(p.tryAcquire('1.1.1.1')).toBe(true);
    expect(p.countFor('1.1.1.1')).toBe(2);
    // Over the cap: refused, and the tally does not grow.
    expect(p.tryAcquire('1.1.1.1')).toBe(false);
    expect(p.countFor('1.1.1.1')).toBe(2);
  });

  it('caps each IP independently', () => {
    const p = new PreAuthConnections(1);
    expect(p.tryAcquire('1.1.1.1')).toBe(true);
    expect(p.tryAcquire('2.2.2.2')).toBe(true); // different IP unaffected
    expect(p.tryAcquire('1.1.1.1')).toBe(false);
    expect(p.size).toBe(2);
  });

  it('release frees a slot and lets a new acquire through', () => {
    const p = new PreAuthConnections(1);
    expect(p.tryAcquire('1.1.1.1')).toBe(true);
    expect(p.tryAcquire('1.1.1.1')).toBe(false);
    p.release('1.1.1.1');
    expect(p.countFor('1.1.1.1')).toBe(0);
    expect(p.tryAcquire('1.1.1.1')).toBe(true);
  });

  it('never drives the tally negative and drops the IP key at zero', () => {
    const p = new PreAuthConnections(3);
    p.tryAcquire('1.1.1.1');
    p.release('1.1.1.1');
    p.release('1.1.1.1'); // extra release (idempotent caller double-fire) is a no-op
    p.release('9.9.9.9'); // releasing an unknown IP is a no-op
    expect(p.countFor('1.1.1.1')).toBe(0);
    expect(p.size).toBe(0); // key removed at zero, no leak
  });
});

describe('normalizeIp (IPv6 handling)', () => {
  it('strips the IPv4-mapped IPv6 prefix so v4/v6 forms share one key', () => {
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
  });

  it('leaves canonical IPv6 untouched', () => {
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp('2001:db8::ff00:42:8329')).toBe('2001:db8::ff00:42:8329');
  });

  it('canonicalizes IPv6 so connect side and stored side agree by construction', () => {
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
    expect(normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
  });

  it('leaves plain IPv4 untouched', () => {
    expect(normalizeIp('203.0.113.5')).toBe('203.0.113.5');
  });
});
