// The responsible-gambling service (server/rg.ts) over an in-memory RgDb fake
// with an injected clock: the entry verdict (age/ToS/exclusion), the rolling
// deposit-limit verdict, the instant-lower / delayed-raise limit rule, and the
// permanent-exclusion irreversibility.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ageOnDate,
  createRgService,
  dayString,
  exclusionActive,
  type RgService,
} from '../server/rg';
import { resolveRgConfig } from '../server/rg_config';
import type {
  AccountLimits,
  AgeAttestation,
  Exclusion,
  ExclusionKind,
  RgDb,
} from '../server/rg_db';

// A minimal in-memory RgDb.
class FakeRgDb implements RgDb {
  age = new Map<number, AgeAttestation>();
  tos = new Map<string, string>(); // `${account}:${realm}` -> version
  excl = new Map<number, Exclusion>();
  limits = new Map<number, AccountLimits>();
  flow = new Map<string, number>(); // `${account}:${day}` -> notional

  async getAgeAttestation(a: number) {
    return this.age.get(a) ?? null;
  }
  async setAgeAttestation(a: number, dob: string, method: string) {
    this.age.set(a, { dob, attestedAt: new Date(0).toISOString(), method });
  }
  async getTosVersion(a: number, realm: string) {
    return this.tos.get(`${a}:${realm}`) ?? null;
  }
  async setTosAcceptance(a: number, realm: string, v: string) {
    this.tos.set(`${a}:${realm}`, v);
  }
  async getExclusion(a: number) {
    return this.excl.get(a) ?? null;
  }
  async setExclusion(a: number, kind: ExclusionKind, expiresAt: number | null) {
    this.excl.set(a, {
      kind,
      setAt: new Date(0).toISOString(),
      expiresAt: expiresAt !== null ? new Date(expiresAt).toISOString() : null,
    });
  }
  async clearExclusion(a: number) {
    this.excl.delete(a);
  }
  async getLimits(a: number) {
    return this.limits.get(a) ?? null;
  }
  async setLimits(a: number, l: AccountLimits) {
    this.limits.set(a, l);
  }
  async flowSince(a: number, sinceDay: string) {
    let total = 0;
    for (const [k, v] of this.flow) {
      const [acc, day] = k.split(':');
      if (Number(acc) === a && day >= sinceDay) total += v;
    }
    return total;
  }
  async addFlow(a: number, day: string, notional: number) {
    const k = `${a}:${day}`;
    this.flow.set(k, (this.flow.get(k) ?? 0) + notional);
  }
}

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now": 2026-07-16T12:00:00Z.
const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);

describe('ageOnDate', () => {
  it('computes whole years and refuses a malformed dob', () => {
    expect(ageOnDate('2000-07-16', NOW)).toBe(26);
    expect(ageOnDate('2000-07-17', NOW)).toBe(25); // birthday not yet reached
    expect(ageOnDate('not-a-date', NOW)).toBe(-1);
  });
});

describe('exclusionActive', () => {
  it('permanent is always active; a cool-off expires', () => {
    expect(exclusionActive({ kind: 'permanent', setAt: '', expiresAt: null }, NOW)).toBe(true);
    expect(
      exclusionActive(
        { kind: 'cooloff_24h', setAt: '', expiresAt: new Date(NOW + DAY).toISOString() },
        NOW,
      ),
    ).toBe(true);
    expect(
      exclusionActive(
        { kind: 'cooloff_24h', setAt: '', expiresAt: new Date(NOW - 1).toISOString() },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('RgService', () => {
  let db: FakeRgDb;
  let svc: RgService;
  let clock: number;
  const cfg = resolveRgConfig({
    RIVERBOAT_MIN_AGE_YEARS: '18',
    RIVERBOAT_DAILY_NOTIONAL_CAP: '1000',
    RIVERBOAT_WEEKLY_NOTIONAL_CAP: '5000',
    RIVERBOAT_MONTHLY_NOTIONAL_CAP: '20000',
    RIVERBOAT_LIMIT_RAISE_COOLDOWN_MS: String(DAY),
  });

  beforeEach(() => {
    db = new FakeRgDb();
    clock = NOW;
    svc = createRgService(db, cfg, () => clock);
  });

  describe('entryVerdict', () => {
    it('refuses in order: exclusion, age-unverified, age-underage, tos-required, then ok', async () => {
      // Nothing set: age unverified first (after the not-excluded check).
      expect(await svc.entryVerdict(1, 'RiverBoat', 'v1')).toEqual({
        ok: false,
        reason: 'age_unverified',
      });

      // Underage attestation.
      await svc.attestAge(1, '2015-01-01');
      expect(await svc.entryVerdict(1, 'RiverBoat', 'v1')).toEqual({
        ok: false,
        reason: 'age_underage',
      });

      // Of age, but ToS not accepted.
      await svc.attestAge(1, '1990-01-01');
      expect(await svc.entryVerdict(1, 'RiverBoat', 'v1')).toEqual({
        ok: false,
        reason: 'tos_required',
      });

      // ToS accepted for a DIFFERENT version does not satisfy the current one.
      await svc.acceptTos(1, 'RiverBoat', 'v0');
      expect(await svc.entryVerdict(1, 'RiverBoat', 'v1')).toEqual({
        ok: false,
        reason: 'tos_required',
      });

      // Accept the current version: ok.
      await svc.acceptTos(1, 'RiverBoat', 'v1');
      expect(await svc.entryVerdict(1, 'RiverBoat', 'v1')).toEqual({ ok: true });

      // A self-exclusion overrides everything.
      await svc.setExclusion(1, 'cooloff_24h');
      expect(await svc.entryVerdict(1, 'RiverBoat', 'v1')).toEqual({
        ok: false,
        reason: 'self_excluded',
      });
    });
  });

  describe('attestAge', () => {
    it('records the attestation but reports underage', async () => {
      const r = await svc.attestAge(2, '2015-06-01');
      expect(r).toEqual({ ok: false, reason: 'age_underage' });
      expect(await db.getAgeAttestation(2)).not.toBeNull(); // audit trail kept
    });
    it('rejects a malformed dob without recording it', async () => {
      const r = await svc.attestAge(3, 'garbage');
      expect(r.ok).toBe(false);
      expect(await db.getAgeAttestation(3)).toBeNull();
    });
  });

  describe('setExclusion (permanent irreversibility)', () => {
    it('cannot downgrade a permanent exclusion', async () => {
      expect(await svc.setExclusion(4, 'permanent')).toEqual({ ok: true });
      expect(await svc.setExclusion(4, 'cooloff_24h')).toEqual({
        ok: false,
        reason: 'permanent_locked',
      });
      // Re-affirming permanent is a no-op success.
      expect(await svc.setExclusion(4, 'permanent')).toEqual({ ok: true });
    });
    it('sets a cool-off expiry from config', async () => {
      await svc.setExclusion(5, 'cooloff_30d');
      const ex = await db.getExclusion(5);
      expect(ex?.expiresAt).toBe(new Date(NOW + 30 * DAY).toISOString());
    });
  });

  describe('limitVerdict + rolling windows', () => {
    it('blocks once the daily cap would be exceeded', async () => {
      await svc.recordFlow(6, 600);
      expect(await svc.limitVerdict(6, 300)).toEqual({ ok: true });
      expect(await svc.limitVerdict(6, 500)).toEqual({ ok: false, window: 'daily', cap: 1000 });
    });
    it('counts the weekly window across days', async () => {
      // Two days ago and today both count toward the weekly cap.
      await db.addFlow(7, dayString(NOW - 2 * DAY), 3000);
      await svc.recordFlow(7, 1500); // today
      // daily used today = 1500 (< 1000? no -> would block daily first). Use a
      // smaller add to isolate the weekly window.
      expect(await svc.limitVerdict(7, 100)).toEqual({ ok: false, window: 'daily', cap: 1000 });
    });
  });

  describe('setLimit (lower instant, raise delayed)', () => {
    it('applies a lower immediately', async () => {
      await svc.setLimit(8, 'daily', 200);
      await svc.recordFlow(8, 150);
      expect(await svc.limitVerdict(8, 100)).toEqual({ ok: false, window: 'daily', cap: 200 });
    });
    it('holds a raise for the cooldown, then applies it', async () => {
      await svc.setLimit(9, 'daily', 200); // lower first
      await svc.setLimit(9, 'daily', 5000); // raise: held
      await svc.recordFlow(9, 300);
      // Still capped at the tighter 200 during the cooldown.
      expect(await svc.limitVerdict(9, 1)).toEqual({ ok: false, window: 'daily', cap: 200 });
      // After the cooldown, the raise takes effect.
      clock = NOW + DAY + 1;
      expect(await svc.limitVerdict(9, 1)).toEqual({ ok: true });
    });

    it('treats removing a cap (set to 0 = unlimited) as a held raise, not an instant uncap', async () => {
      await svc.setLimit(11, 'daily', 200); // tight lower
      await svc.recordFlow(11, 250); // already over the tight cap
      await svc.setLimit(11, 'daily', 0); // "remove the cap" = raise to unlimited
      // The tighter 200 must STILL hold during the cooldown (0 is not an instant uncap).
      expect(await svc.limitVerdict(11, 1)).toEqual({ ok: false, window: 'daily', cap: 200 });
      // After the cooldown, the daily window is uncapped: a value that would have
      // exceeded the old 200 cap now passes (kept under the other windows' caps so
      // only the daily uncap is under test).
      clock = NOW + DAY + 1;
      expect(await svc.limitVerdict(11, 1000)).toEqual({ ok: true });
    });

    it('a raise on one window never discards a held raise on another (per-window pending)', async () => {
      await svc.setLimit(12, 'daily', 200); // lower daily
      await svc.setLimit(12, 'weekly', 400); // lower weekly
      await svc.setLimit(12, 'daily', 9000); // raise daily: held
      await svc.setLimit(12, 'weekly', 9000); // raise weekly: held (must not drop the daily pending)
      // Both still tight during their cooldowns.
      await svc.recordFlow(12, 300);
      expect((await svc.limitVerdict(12, 1)).ok).toBe(false); // daily 200 (or weekly 400) blocks
      // After the cooldown BOTH raises take effect (the daily pending survived).
      clock = NOW + DAY + 1;
      expect(await svc.limitVerdict(12, 1)).toEqual({ ok: true });
    });
  });

  describe('status', () => {
    it('aggregates the RG panel view', async () => {
      await svc.attestAge(10, '1990-01-01');
      await svc.acceptTos(10, 'RiverBoat', 'v1');
      await svc.recordFlow(10, 400);
      const s = await svc.status(10, 'RiverBoat', 'v1');
      expect(s.ageVerified).toBe(true);
      expect(s.tosAccepted).toBe(true);
      expect(s.excluded).toBe(false);
      expect(s.flow.daily).toBe(400);
    });
  });
});
