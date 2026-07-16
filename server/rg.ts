// The responsible-gambling service for the RiverBoat casino realm: the pure
// decision logic over the RgDb boundary (SocialService pattern). It owns the
// entry verdict (age + ToS + self-exclusion), the deposit/loss-limit verdict at
// quote time, and the mutations a player makes (attest age, accept ToS, set an
// exclusion, adjust a limit, record inflow). All time comes through an injected
// clock so the whole surface unit-tests deterministically without a DB.
//
// Authorization posture: every verdict is fail-safe. An unknown account is not
// age-verified, has not accepted the ToS, and is treated as within limits only
// until it actually exceeds one. A permanent self-exclusion is irreversible here
// (the service refuses to downgrade it).
import type { RgConfig } from './rg_config';
import type { AccountLimits, Exclusion, ExclusionKind, LimitWindow, RgDb } from './rg_db';

export type Clock = () => number;

// A UTC day string 'YYYY-MM-DD' for a ms timestamp (the flow-counter key unit).
export function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// The day string N days before `ms` (the rolling-window lower bound).
export function dayStringBefore(ms: number, days: number): string {
  return dayString(ms - days * 24 * 60 * 60 * 1000);
}

// Whole years of age on `nowMs` for an ISO 'YYYY-MM-DD' date of birth. Returns
// -1 for an unparseable date so a malformed dob never reads as of-age.
export function ageOnDate(dob: string, nowMs: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return -1;
  const by = Number(m[1]);
  const bm = Number(m[2]);
  const bd = Number(m[3]);
  const now = new Date(nowMs);
  const ny = now.getUTCFullYear();
  const nm = now.getUTCMonth() + 1;
  const nd = now.getUTCDate();
  let age = ny - by;
  if (nm < bm || (nm === bm && nd < bd)) age -= 1;
  return age;
}

export type EntryReason = 'age_unverified' | 'age_underage' | 'tos_required' | 'self_excluded';
export type EntryVerdict = { ok: true } | { ok: false; reason: EntryReason };

// Whether a self-exclusion is currently in force. A permanent exclusion always
// is; a cool-off is until its expiry.
export function exclusionActive(ex: Exclusion | null, nowMs: number): boolean {
  if (!ex) return false;
  if (ex.kind === 'permanent') return true;
  if (ex.expiresAt === null) return true;
  return nowMs < new Date(ex.expiresAt).getTime();
}

export interface RgStatus {
  ageVerified: boolean;
  tosAccepted: boolean;
  excluded: boolean;
  exclusion: Exclusion | null;
  limits: AccountLimits | null;
  flow: { daily: number; weekly: number; monthly: number };
}

export interface RgService {
  entryVerdict(accountId: number, realm: string, tosVersion: string): Promise<EntryVerdict>;
  attestAge(
    accountId: number,
    dob: string,
    method?: string,
  ): Promise<{ ok: boolean; reason?: EntryReason }>;
  acceptTos(accountId: number, realm: string, tosVersion: string): Promise<void>;
  setExclusion(
    accountId: number,
    kind: ExclusionKind,
  ): Promise<{ ok: boolean; reason?: 'permanent_locked' }>;
  // Set a per-window cap. Lowering (or clearing to null) is instant; raising is
  // held for the config cooldown and applied lazily on the next read.
  setLimit(
    accountId: number,
    window: 'daily' | 'weekly' | 'monthly',
    cap: number | null,
  ): Promise<void>;
  // The verdict for adding `notional` inflow now: within the effective caps?
  limitVerdict(
    accountId: number,
    notional: number,
  ): Promise<{ ok: true } | { ok: false; window: 'daily' | 'weekly' | 'monthly'; cap: number }>;
  recordFlow(accountId: number, notional: number): Promise<void>;
  status(accountId: number, realm: string, tosVersion: string): Promise<RgStatus>;
}

// A cap's magnitude for the raise/lower decision: a cap of 0 (or any
// non-positive value) is the "no cap" sentinel, i.e. UNLIMITED, which is the
// highest possible magnitude. Mapping it to +Infinity is what stops a
// lower-to-0 (really a raise to unlimited) from taking the instant path and
// bypassing the raise cooldown.
function capMagnitude(cap: number): number {
  return cap <= 0 ? Number.POSITIVE_INFINITY : cap;
}

// The effective cap for a window: the account override when set, else the config
// default. A pending raise for THIS window is materialized once its effectiveAt
// has passed.
function effectiveCap(
  limits: AccountLimits | null,
  window: LimitWindow,
  cfgCap: number,
  nowMs: number,
): number {
  const override =
    window === 'daily'
      ? limits?.dailyCap
      : window === 'weekly'
        ? limits?.weeklyCap
        : limits?.monthlyCap;
  let cap = override ?? cfgCap;
  const pending = limits?.pendingRaises?.[window];
  if (pending && nowMs >= pending.effectiveAt) cap = pending.cap;
  return cap;
}

export function createRgService(db: RgDb, cfg: RgConfig, now: Clock): RgService {
  async function isAgeVerified(
    accountId: number,
  ): Promise<{ verified: boolean; reason?: EntryReason }> {
    const att = await db.getAgeAttestation(accountId);
    if (!att) return { verified: false, reason: 'age_unverified' };
    if (ageOnDate(att.dob, now()) < cfg.minAgeYears)
      return { verified: false, reason: 'age_underage' };
    return { verified: true };
  }

  return {
    async entryVerdict(accountId, realm, tosVersion) {
      const ex = await db.getExclusion(accountId);
      if (exclusionActive(ex, now())) return { ok: false, reason: 'self_excluded' };
      const age = await isAgeVerified(accountId);
      if (!age.verified) return { ok: false, reason: age.reason ?? 'age_unverified' };
      const accepted = await db.getTosVersion(accountId, realm);
      if (accepted !== tosVersion) return { ok: false, reason: 'tos_required' };
      return { ok: true };
    },

    async attestAge(accountId, dob, method = 'self') {
      if (ageOnDate(dob, now()) < 0) return { ok: false, reason: 'age_unverified' };
      // Record the attestation regardless (an audit trail), but report whether it
      // meets the threshold so the caller does not admit an underage player.
      await db.setAgeAttestation(accountId, dob, method);
      if (ageOnDate(dob, now()) < cfg.minAgeYears) return { ok: false, reason: 'age_underage' };
      return { ok: true };
    },

    async acceptTos(accountId, realm, tosVersion) {
      await db.setTosAcceptance(accountId, realm, tosVersion);
    },

    async setExclusion(accountId, kind) {
      const existing = await db.getExclusion(accountId);
      // Permanent is irreversible: never downgrade it, and re-affirming permanent
      // is a no-op success.
      if (existing?.kind === 'permanent') {
        return kind === 'permanent' ? { ok: true } : { ok: false, reason: 'permanent_locked' };
      }
      const expiresAt =
        kind === 'permanent'
          ? null
          : now() +
            (kind === 'cooloff_24h' ? cfg.cooloffMs.cooloff_24h : cfg.cooloffMs.cooloff_30d);
      await db.setExclusion(accountId, kind, expiresAt);
      return { ok: true };
    },

    async setLimit(accountId, window, cap) {
      const current = (await db.getLimits(accountId)) ?? {
        dailyCap: null,
        weeklyCap: null,
        monthlyCap: null,
        pendingRaises: {},
      };
      const cfgCap =
        window === 'daily'
          ? cfg.limits.dailyNotionalCap
          : window === 'weekly'
            ? cfg.limits.weeklyNotionalCap
            : cfg.limits.monthlyNotionalCap;
      const currentCap = effectiveCap(current, window, cfgCap, now());
      // The target: an explicit number, or null resetting to the config default.
      // A 0 (or non-positive) target means "no cap" = unlimited (see capMagnitude);
      // removing a cap is a RAISE and must wait the cooldown like any other.
      const targetCap = cap ?? cfgCap;
      const raising = capMagnitude(targetCap) > capMagnitude(currentCap);
      // Copy the fields explicitly and clone the per-window pending map so a raise
      // on one window never clobbers a held raise on another.
      const next: AccountLimits = {
        dailyCap: current.dailyCap,
        weeklyCap: current.weeklyCap,
        monthlyCap: current.monthlyCap,
        pendingRaises: { ...current.pendingRaises },
      };
      if (raising) {
        // Hold the raise: leave the window field at its tighter current value and
        // stage the new cap for this window behind the cooldown.
        next.pendingRaises[window] = {
          cap: targetCap,
          effectiveAt: now() + cfg.limitRaiseCooldownMs,
        };
      } else {
        // Instant lower: write the field and drop any pending raise for THIS
        // window (a lower supersedes a not-yet-effective raise).
        if (window === 'daily') next.dailyCap = cap;
        else if (window === 'weekly') next.weeklyCap = cap;
        else next.monthlyCap = cap;
        delete next.pendingRaises[window];
      }
      await db.setLimits(accountId, next);
    },

    async limitVerdict(accountId, notional) {
      const nowMs = now();
      const limits = await db.getLimits(accountId);
      const windows: Array<['daily' | 'weekly' | 'monthly', number, number]> = [
        ['daily', 0, cfg.limits.dailyNotionalCap],
        ['weekly', 6, cfg.limits.weeklyNotionalCap],
        ['monthly', 29, cfg.limits.monthlyNotionalCap],
      ];
      for (const [window, backDays, cfgCap] of windows) {
        const cap = effectiveCap(limits, window, cfgCap, nowMs);
        if (cap <= 0) continue; // 0 = no cap for this window
        const since = dayStringBefore(nowMs, backDays);
        const used = await db.flowSince(accountId, since);
        if (used + notional > cap) return { ok: false, window, cap };
      }
      return { ok: true };
    },

    async recordFlow(accountId, notional) {
      await db.addFlow(accountId, dayString(now()), notional);
    },

    async status(accountId, realm, tosVersion) {
      const nowMs = now();
      const [att, ex, limits, accepted, daily, weekly, monthly] = await Promise.all([
        db.getAgeAttestation(accountId),
        db.getExclusion(accountId),
        db.getLimits(accountId),
        db.getTosVersion(accountId, realm),
        db.flowSince(accountId, dayString(nowMs)),
        db.flowSince(accountId, dayStringBefore(nowMs, 6)),
        db.flowSince(accountId, dayStringBefore(nowMs, 29)),
      ]);
      const ageVerified = att !== null && ageOnDate(att.dob, nowMs) >= cfg.minAgeYears;
      return {
        ageVerified,
        tosAccepted: accepted === tosVersion,
        excluded: exclusionActive(ex, nowMs),
        exclusion: ex,
        limits,
        flow: { daily, weekly, monthly },
      };
    },
  };
}
