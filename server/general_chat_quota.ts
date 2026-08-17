import { GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT } from './general_chat_quota_config';
import type { GeneralChatQuotaConsumeResult, GeneralChatRateLimit } from './general_chat_quota_db';
import type { GeneralChatQuotaOutcome } from './http/game_signals';

export { GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT } from './general_chat_quota_config';

// The active call is the one account slot. Later sends are refused locally,
// never queued as promises or Postgres waiters.
export const GENERAL_CHAT_QUOTA_MAX_PENDING_PER_ACCOUNT = 1;
export const GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS = 4_096;
const GENERAL_CHAT_QUOTA_NOTICE_THROTTLE_MS = 5_000;
const GENERAL_CHAT_QUOTA_BUSY_CACHE_MS = 1_000;

export interface OnlineGeneralChat {
  canonicalText: string;
}

/**
 * Classify only the online server's General spellings. In particular, `/g` is
 * guild online even though the offline sim retains it as a General alias.
 */
export function classifyOnlineGeneralChat(
  rawText: string,
  rememberedChannel: string,
): OnlineGeneralChat | null {
  const text = rawText.trim();
  if (!text) return null;
  const explicit = /^\/(?:general|1)\s+([\s\S]+)$/i.exec(text);
  if (explicit) {
    const body = explicit[1].trim();
    return body ? { canonicalText: `/general ${body}` } : null;
  }
  if (text.startsWith('/') || text.startsWith('!') || rememberedChannel !== 'general') return null;
  return { canonicalText: `/general ${text}` };
}

export type GeneralChatQuotaAdmission =
  | { status: 'allowed'; notify: false }
  | { status: 'denied'; retryAfterSeconds: number; notify: boolean }
  // 'pending': this same account already has a healthy consume in flight; the
  // send is refused without arming the unavailable cache, so the next attempt
  // reaches PostgreSQL as soon as the active call resolves.
  | { status: 'pending'; notify: boolean }
  | { status: 'busy' | 'error'; notify: boolean };

export interface GeneralChatRateLimitHydration {
  resolve(hydrated: GeneralChatRateLimit | null): GeneralChatRateLimit | null;
  release(): void;
}

interface LivePolicyVersion {
  generation: number;
  policy: GeneralChatRateLimit | null;
}

/**
 * Orders auth-query hydration with cross-process policy notifications without
 * another database read. Entries are LRU-bounded, except that an account with
 * an in-progress auth read is pinned until that read releases its token.
 */
export class GeneralChatRateLimitLiveState {
  readonly #latest = new Map<number, LivePolicyVersion>();
  readonly #pins = new Map<number, number>();
  #generation = 0;

  beginHydration(accountId: number): GeneralChatRateLimitHydration {
    const capturedGeneration = this.#latest.get(accountId)?.generation ?? 0;
    this.#pins.set(accountId, (this.#pins.get(accountId) ?? 0) + 1);
    let released = false;
    return {
      resolve: (hydrated) => {
        const latest = this.#latest.get(accountId);
        return latest && latest.generation !== capturedGeneration ? latest.policy : hydrated;
      },
      release: () => {
        if (released) return;
        released = true;
        const left = (this.#pins.get(accountId) ?? 1) - 1;
        if (left > 0) this.#pins.set(accountId, left);
        else this.#pins.delete(accountId);
        this.#trim();
      },
    };
  }

  policyChanged(accountId: number, policy: GeneralChatRateLimit | null): void {
    this.#generation++;
    this.#latest.delete(accountId);
    this.#latest.set(accountId, { generation: this.#generation, policy });
    this.#trim();
  }

  get cachedAccounts(): number {
    return this.#latest.size;
  }

  #trim(): void {
    if (this.#latest.size <= GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS) return;
    for (const accountId of this.#latest.keys()) {
      if (this.#latest.size <= GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS) return;
      if (!this.#pins.has(accountId)) this.#latest.delete(accountId);
    }
  }
}

interface LocalRefusal {
  kind: 'denied' | 'unavailable';
  untilMs: number;
}

export interface GeneralChatQuotaCoordinatorDeps {
  consume(accountId: number): Promise<GeneralChatQuotaConsumeResult>;
  now?: () => number;
  maxInFlight?: number;
  observeDbCall?: (
    outcome:
      | GeneralChatQuotaConsumeResult['status']
      | 'acquire_timeout'
      | 'query_timeout'
      | 'error',
    durationSeconds: number,
  ) => void;
}

/**
 * Bounded, account-serialized coordination around the atomic PostgreSQL
 * consume. A second same-account send is refused while the first is pending
 * (status 'pending', never cached), so it cannot overtake or create a
 * PostgreSQL waiter; known-unlimited accounts never call `consume`.
 *
 * Failure policy: a `consume` throw fails CLOSED. The send is refused (status
 * 'error') and the short unavailable cache arms, so a database outage silences
 * configured accounts rather than lifting their quota; that is the intended
 * tradeoff for an anti-spam control. Operators should alert on
 * woc_general_chat_quota_total{outcome="error"}.
 */
export class GeneralChatQuotaCoordinator {
  readonly #consume: GeneralChatQuotaCoordinatorDeps['consume'];
  readonly #now: () => number;
  readonly #observeDbCall: NonNullable<GeneralChatQuotaCoordinatorDeps['observeDbCall']>;
  readonly #maxInFlight: number;
  readonly #pendingByAccount = new Map<number, number>();
  // Only accounts with an active consume can enter this set, so it is bounded by
  // the process-wide in-flight cap rather than by policy edit cardinality.
  readonly #invalidatedPendingAccounts = new Set<number>();
  readonly #localRefusals = new Map<number, LocalRefusal>();
  readonly #lastNoticeAt = new Map<number, number>();
  #inFlight = 0;

  constructor(deps: GeneralChatQuotaCoordinatorDeps) {
    this.#consume = deps.consume;
    this.#now = deps.now ?? Date.now;
    this.#observeDbCall = deps.observeDbCall ?? (() => {});
    this.#maxInFlight = Math.max(
      0,
      Math.min(
        GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT,
        Math.floor(deps.maxInFlight ?? GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT),
      ),
    );
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  policyChanged(accountId: number): void {
    this.forgetAccount(accountId);
  }

  /** Evict only after the account's last realm session leaves. */
  forgetAccount(accountId: number): void {
    this.#localRefusals.delete(accountId);
    this.#lastNoticeAt.delete(accountId);
    if (this.#pendingByAccount.has(accountId)) this.#invalidatedPendingAccounts.add(accountId);
    else this.#invalidatedPendingAccounts.delete(accountId);
  }

  get cachedAccounts(): number {
    // The union, not the max: the refusal and notice maps can hold disjoint
    // accounts (an allowed-then-denied account notices without a live refusal).
    const union = new Set(this.#localRefusals.keys());
    for (const accountId of this.#lastNoticeAt.keys()) union.add(accountId);
    return union.size;
  }

  admit(
    accountId: number,
    policy: GeneralChatRateLimit | null,
  ): Promise<GeneralChatQuotaAdmission> {
    if (policy === null) return Promise.resolve({ status: 'allowed', notify: false });

    const cached = this.#cachedRefusal(accountId);
    if (cached) return Promise.resolve(cached);

    const accountPending = this.#pendingByAccount.get(accountId) ?? 0;
    if (accountPending >= GENERAL_CHAT_QUOTA_MAX_PENDING_PER_ACCOUNT) {
      // A healthy same-account consume is already in flight (agent accounts
      // send back-to-back by construction). Refuse only this send and never
      // arm the unavailable cache: the database is fine, so the next attempt
      // should go straight to PostgreSQL once the active call resolves.
      return Promise.resolve({
        status: 'pending',
        notify: this.#invalidatedPendingAccounts.has(accountId)
          ? true
          : this.#shouldNotify(accountId),
      });
    }
    if (this.#inFlight >= this.#maxInFlight) {
      // The realm-global consume slots are saturated (see the ceiling note in
      // general_chat_quota_config.ts): every configured account shares this
      // fate, and the short unavailable cache sheds the burst.
      if (this.#invalidatedPendingAccounts.has(accountId)) {
        return Promise.resolve({ status: 'busy', notify: true });
      }
      return Promise.resolve(this.#unavailable(accountId, 'busy'));
    }

    this.#pendingByAccount.set(accountId, accountPending + 1);
    return (async () => {
      this.#inFlight++;
      const startedAt = this.#now();
      try {
        const consumed = await this.#consume(accountId);
        this.#observeDbCall(consumed.status, Math.max(0, this.#now() - startedAt) / 1_000);
        if (consumed.status === 'denied') {
          const retryAfterSeconds = Math.max(1, Math.ceil(consumed.retryAfterSeconds));
          const invalidated = this.#invalidatedPendingAccounts.has(accountId);
          if (!invalidated) {
            this.#rememberRefusal(accountId, {
              kind: 'denied',
              untilMs: this.#now() + retryAfterSeconds * 1_000,
            });
          }
          return {
            status: 'denied',
            retryAfterSeconds,
            notify: invalidated ? true : this.#shouldNotify(accountId),
          } as const;
        }
        return { status: 'allowed', notify: false } as const;
      } catch (error) {
        const phase =
          typeof error === 'object' && error !== null && 'phase' in error
            ? String(error.phase)
            : 'error';
        const outcome = phase === 'acquire_timeout' || phase === 'query_timeout' ? phase : 'error';
        this.#observeDbCall(outcome, Math.max(0, this.#now() - startedAt) / 1_000);
        if (this.#invalidatedPendingAccounts.has(accountId)) {
          return { status: 'error', notify: true } as const;
        }
        return this.#unavailable(accountId, 'error');
      } finally {
        this.#inFlight--;
        const left = (this.#pendingByAccount.get(accountId) ?? 1) - 1;
        if (left > 0) this.#pendingByAccount.set(accountId, left);
        else {
          this.#pendingByAccount.delete(accountId);
          this.#invalidatedPendingAccounts.delete(accountId);
        }
      }
    })();
  }

  #cachedRefusal(accountId: number): GeneralChatQuotaAdmission | null {
    const cached = this.#localRefusals.get(accountId);
    if (!cached) return null;
    const remainingMs = cached.untilMs - this.#now();
    if (remainingMs <= 0) {
      this.#localRefusals.delete(accountId);
      return null;
    }
    if (cached.kind === 'denied') {
      return {
        status: 'denied',
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1_000)),
        notify: this.#shouldNotify(accountId),
      };
    }
    return { status: 'busy', notify: this.#shouldNotify(accountId) };
  }

  #unavailable(accountId: number, status: 'busy' | 'error'): GeneralChatQuotaAdmission {
    this.#rememberRefusal(accountId, {
      kind: 'unavailable',
      untilMs: this.#now() + GENERAL_CHAT_QUOTA_BUSY_CACHE_MS,
    });
    return { status, notify: this.#shouldNotify(accountId) };
  }

  #shouldNotify(accountId: number): boolean {
    const now = this.#now();
    const last = this.#lastNoticeAt.get(accountId);
    if (last !== undefined && now - last < GENERAL_CHAT_QUOTA_NOTICE_THROTTLE_MS) return false;
    this.#lastNoticeAt.delete(accountId);
    this.#lastNoticeAt.set(accountId, now);
    this.#trim(this.#lastNoticeAt);
    return true;
  }

  #rememberRefusal(accountId: number, refusal: LocalRefusal): void {
    this.#localRefusals.delete(accountId);
    this.#localRefusals.set(accountId, refusal);
    this.#trim(this.#localRefusals);
  }

  #trim<T>(map: Map<number, T>): void {
    while (map.size > GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  }
}

export interface GeneralChatQuotaRefusalEvent {
  type: 'error';
  text: string;
  code: 'general_chat_quota' | 'general_chat_quota_pending' | 'general_chat_quota_unavailable';
  channel: 'general';
  retryAfterSeconds: number;
}

/**
 * Map a refused admission to its sender-only structured error event. The
 * English `text` is the mixed-release fallback; current clients resolve the
 * stable `code` through src/ui/general_chat_quota_view.ts, and the Hud English
 * matcher re-localizes each exact `text` for older event payloads, so any
 * wording change here must update both in the same change.
 */
export function generalChatQuotaRefusalEvent(
  admission: Exclude<GeneralChatQuotaAdmission, { status: 'allowed' }>,
): GeneralChatQuotaRefusalEvent {
  if (admission.status === 'denied') {
    const retryAfterSeconds = Math.max(1, Math.ceil(admission.retryAfterSeconds));
    return {
      type: 'error',
      text: `General chat limit reached. Try again in ${retryAfterSeconds} seconds.`,
      code: 'general_chat_quota',
      channel: 'general',
      retryAfterSeconds,
    };
  }
  if (admission.status === 'pending') {
    return {
      type: 'error',
      text: 'Your previous General chat message is still sending. Try again in a moment.',
      code: 'general_chat_quota_pending',
      channel: 'general',
      retryAfterSeconds: 1,
    };
  }
  return {
    type: 'error',
    text: 'General chat is temporarily unavailable. Try again shortly.',
    code: 'general_chat_quota_unavailable',
    channel: 'general',
    retryAfterSeconds: 1,
  };
}

/**
 * The host seam admitGeneralChat resolution needs from the game server: every
 * callback closes over the live session, so this module never holds one.
 */
export interface GeneralChatAdmissionHost {
  /** Whether the sending session is still the authoritative one for its pid. */
  sessionCurrent(): boolean;
  /** Return the ordinary chat-lane token reserved before admission. */
  refundChatToken(): void;
  /** Broadcast the admitted canonical text through the sim and log it. */
  deliver(): void;
  /** Send the sender-only refusal event. */
  notify(event: GeneralChatQuotaRefusalEvent): void;
  recordOutcome(outcome: GeneralChatQuotaOutcome): void;
}

/**
 * Resolve one admission against the live session. A session that went stale
 * during the await refunds and records instead of broadcasting; an allowed
 * admission that lands on a stale session records 'dropped' (the consume
 * already spent a quota unit), so the outcome labels still sum to attempts.
 */
export async function resolveGeneralChatAdmission(
  admission: Promise<GeneralChatQuotaAdmission>,
  host: GeneralChatAdmissionHost,
): Promise<void> {
  const result = await admission;
  if (!host.sessionCurrent()) {
    host.refundChatToken();
    host.recordOutcome(result.status === 'allowed' ? 'dropped' : result.status);
    return;
  }
  if (result.status === 'allowed') {
    host.deliver();
    host.recordOutcome('allowed');
    return;
  }
  host.refundChatToken();
  host.recordOutcome(result.status);
  if (result.notify) host.notify(generalChatQuotaRefusalEvent(result));
}
