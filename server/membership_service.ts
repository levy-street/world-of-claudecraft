import { MEMBERSHIP_OFF, type MembershipSnapshot } from '../src/membership_contract';
import { SUBSCRIPTION_OFF, type SubscriptionSnapshot } from '../src/subscription_contract';
import {
  loadMembershipBatch,
  type MembershipBatchSource,
  membershipBatchAccountIds,
} from './membership_batch';
import { prepaidMembershipExpiresAt } from './membership_db';
import { gameSubscriptionSnapshot } from './subscription_proxy';

export const MEMBERSHIP_CACHE_TTL_MS = 15_000;
// Batched refreshes run every 30 seconds. Authority still expires after one minute,
// independently of queue length, an outage, or the purchased subscription period.
export const MEMBERSHIP_AUTHORIZATION_MS = 60_000;
export const MEMBERSHIP_CACHE_MAX_ENTRIES = 5000;

export interface MembershipAuthorization extends MembershipSnapshot {
  authorizedUntil: number;
  recurringExpiresAt: number | null;
  recurringAuthorizedUntil?: number;
}

interface MembershipSources {
  prepaid(accountId: number): Promise<number | null>;
  recurring(accountId: number): Promise<SubscriptionSnapshot>;
  batch?(accountIds: readonly number[]): Promise<Map<number, MembershipBatchSource>>;
  now(): number;
}
interface MembershipEntry {
  value: MembershipAuthorization | null;
  checkedAt: number;
  pending?: Promise<MembershipAuthorization>;
}
const inactive = (): MembershipAuthorization => ({
  ...MEMBERSHIP_OFF,
  authorizedUntil: 0,
  recurringExpiresAt: null,
});

function authorizeSources(
  source: MembershipBatchSource,
  checkedAt: number,
  previous: MembershipAuthorization | null,
): MembershipAuthorization {
  const recurring = source.recurring;
  const end = Number(recurring?.currentPeriodEnd) * 1000;
  const priorRecurringUntil = previous?.recurringAuthorizedUntil ?? previous?.authorizedUntil ?? 0;
  const retained = recurring === null && priorRecurringUntil > checkedAt;
  const recurringExpiresAt = retained
    ? (previous?.recurringExpiresAt ?? null)
    : recurring?.available &&
        (recurring.status === 'active' || recurring.status === 'trialing') &&
        Number.isSafeInteger(end) &&
        end > checkedAt
      ? end
      : null;
  const recurringAuthorizedUntil = retained
    ? priorRecurringUntil
    : checkedAt + MEMBERSHIP_AUTHORIZATION_MS;
  const prepaid = Number.isFinite(source.prepaid) ? (source.prepaid ?? 0) : 0;
  const coveredUntil = Math.max(
    Math.min(prepaid, checkedAt + MEMBERSHIP_AUTHORIZATION_MS),
    Math.min(recurringExpiresAt ?? 0, recurringAuthorizedUntil),
  );
  const expiresAt = Math.max(prepaid, recurringExpiresAt ?? 0);
  return {
    active: coveredUntil > checkedAt,
    expiresAt: expiresAt > 0 ? expiresAt : null,
    authorizedUntil:
      coveredUntil > checkedAt ? coveredUntil : checkedAt + MEMBERSHIP_AUTHORIZATION_MS,
    recurringExpiresAt,
    recurringAuthorizedUntil,
  };
}

/** Both single-account and bulk refreshes share one bounded authority cache.
 * The entry identity is its epoch: bust/eviction invalidates pending joiners.
 * Unlike a general stale-serving cache, failure never renews an authority stamp. */
export function createMembershipService(sources: MembershipSources) {
  const entries = new Map<number, MembershipEntry>();
  const counters = { reads: 0, refreshes: 0, evictions: 0, busts: 0 };
  function entryFor(accountId: number): MembershipEntry {
    let entry = entries.get(accountId);
    if (!entry) {
      if (entries.size >= MEMBERSHIP_CACHE_MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
          counters.evictions++;
        }
      }
      entry = { value: null, checkedAt: 0 };
    }
    entries.delete(accountId);
    entries.set(accountId, entry);
    return entry;
  }
  function current(
    accountId: number,
    entry: MembershipEntry,
    value: MembershipAuthorization,
  ): MembershipAuthorization {
    const now = sources.now();
    return {
      ...value,
      active:
        entries.get(accountId) === entry &&
        value.active &&
        value.authorizedUntil > now &&
        Number(value.expiresAt) > now,
    };
  }
  function fresh(entry: MembershipEntry): boolean {
    return entry.value !== null && sources.now() - entry.checkedAt < MEMBERSHIP_CACHE_TTL_MS;
  }
  function install(
    accountId: number,
    entry: MembershipEntry,
    source: MembershipBatchSource,
    checkedAt: number,
  ): MembershipAuthorization {
    const value = authorizeSources(source, checkedAt, entry.value);
    if (entries.get(accountId) === entry) {
      entry.value = value;
      entry.checkedAt = checkedAt;
    }
    return value;
  }
  function track(
    accountId: number,
    entry: MembershipEntry,
    work: Promise<MembershipAuthorization>,
  ): Promise<MembershipAuthorization> {
    const pending = work
      .catch(() => entry.value ?? inactive())
      .finally(() => {
        if (entry.pending === pending) entry.pending = undefined;
      });
    entry.pending = pending;
    return pending.then((value) => current(accountId, entry, value));
  }
  async function get(accountId: number): Promise<MembershipAuthorization> {
    counters.reads++;
    const entry = entryFor(accountId);
    if (entry.value && fresh(entry)) return current(accountId, entry, entry.value);
    if (entry.pending) return current(accountId, entry, await entry.pending);
    const checkedAt = sources.now();
    counters.refreshes++;
    return track(
      accountId,
      entry,
      Promise.all([
        sources.prepaid(accountId),
        sources.recurring(accountId).catch(() => SUBSCRIPTION_OFF),
      ]).then(([prepaid, recurring]) =>
        install(accountId, entry, { prepaid, recurring }, checkedAt),
      ),
    );
  }
  async function getBatch(
    accountIds: readonly number[],
  ): Promise<Map<number, MembershipAuthorization>> {
    const ids = membershipBatchAccountIds(accountIds);
    const loaded = new Map<number, Promise<MembershipAuthorization>>();
    const pending: [number, MembershipEntry][] = [];
    for (const id of ids) {
      counters.reads++;
      const entry = entryFor(id);
      if (entry.value && fresh(entry))
        loaded.set(id, Promise.resolve(current(id, entry, entry.value)));
      else if (entry.pending)
        loaded.set(
          id,
          entry.pending.then((value) => current(id, entry, value)),
        );
      else pending.push([id, entry]);
    }
    if (pending.length) {
      const checkedAt = sources.now();
      counters.refreshes++;
      // No per-account fallback: it would silently destroy the realm-scale budget.
      const work = sources.batch
        ? sources.batch(pending.map(([id]) => id))
        : Promise.reject(new Error('membership batch source unavailable'));
      for (const [id, entry] of pending) {
        loaded.set(
          id,
          track(
            id,
            entry,
            work.then((rows) => {
              const source = rows.get(id);
              if (!source) throw new Error('membership batch omitted requested account');
              return install(id, entry, source, checkedAt);
            }),
          ),
        );
      }
    }
    return new Map(
      await Promise.all(
        ids.map(async (id) => [id, await (loaded.get(id) ?? Promise.resolve(inactive()))] as const),
      ),
    );
  }
  return {
    get,
    getBatch,
    bust(accountId: number): void {
      if (entries.delete(accountId)) counters.busts++;
    },
    stats: () => ({ ...counters, entries: entries.size }),
  };
}

const service = createMembershipService({
  prepaid: prepaidMembershipExpiresAt,
  recurring: gameSubscriptionSnapshot,
  batch: loadMembershipBatch,
  now: Date.now,
});
export const getMembership = service.get;
export const getMembershipBatch = service.getBatch;
export const bustMembership = service.bust;

export function trustedRecurringMembershipExpiry(
  snapshot: MembershipAuthorization,
  nowMs: number,
): number | null {
  return snapshot.active &&
    Math.min(
      snapshot.authorizedUntil,
      snapshot.recurringAuthorizedUntil ?? snapshot.authorizedUntil,
    ) > nowMs
    ? snapshot.recurringExpiresAt
    : null;
}
