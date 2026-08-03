// Client for the game server's secret-gated /internal/discord/* endpoints. The
// bot reads flex/role data and pushes presence + reward grants; it authenticates
// with the shared DISCORD_BOT_SECRET (x-woc-discord-secret), NOT a user bearer.
import type { ActivityItem, DailyRewardWinnersDay, FlexData, RelayItem } from './logic';
import type { PresenceCounters } from './presence_counters';

interface Envelope<T> {
  success: boolean;
  data: T;
  error: string | null;
}

export interface RolesData {
  linked: boolean;
  statusTier: number;
  points: number;
  lifetimePoints: number;
}

export interface VoiceMemberPush {
  id: string;
  name: string;
  speaking: boolean;
  selfMute: boolean;
}

/**
 * One member of a flex-batch answer: the per-id flex payload, plus the id it
 * answers for. Callers key on `discord_user_id`, never on position: an id with
 * no link row is ABSENT from the list rather than carrying a stubbed record, so
 * the batch equivalent of the per-id route's `{ linked: false }` is "not here".
 */
export type FlexBatchMember = FlexData & { discord_user_id: string; linked: true };

export interface FlexBatchResult {
  /**
   * How many ids survived server-side validation: the array cap, the non-string
   * drop, and de-duplication, in that order. Absence-means-unlinked is this
   * endpoint's whole contract, so a caller that acts on absence (clearing flair,
   * say) MUST compare this against the count of DISTINCT in-cap ids it sent
   * before trusting it. A truncated request and a genuine "none of these are
   * linked" answer are otherwise the same empty list.
   */
  requested: number;
  members: FlexBatchMember[];
}

/** Which class of transition an outbox link-change item reports. */
export type OutboxLinkChangeKind = 'flex' | 'points' | 'link' | 'unlink';

/**
 * One account whose Discord-visible state moved. `discordUserId` is the id to
 * act on (for an 'unlink' the row is already gone, so the item carries the id it
 * held at enqueue); the username and avatar are decoration and are null whenever
 * the server could not confirm they describe THAT id.
 */
export interface OutboxLinkChangeItem {
  accountId: number;
  kinds: OutboxLinkChangeKind[];
  discordUserId: string;
  discordUsername: string | null;
  discordAvatar: string | null;
}

/**
 * Everything one outbox poll carries. The three older streams keep the item
 * shapes their per-endpoint GETs used byte for byte, so the existing handlers
 * consume them unchanged; only `linkChanges` is new.
 */
export interface OutboxEnvelope {
  relay: { items: RelayItem[] };
  activity: { items: ActivityItem[] };
  winners: { days: DailyRewardWinnersDay[] };
  linkChanges: { items: OutboxLinkChangeItem[] };
}

/** What a members-meta push reports back. */
export interface MembersMetaPushResult {
  /**
   * Records the server ACCEPTED for application: validated, in-cap, and
   * de-duplicated. It counts records READ, not rows written, so a re-push where
   * nothing changed still reports them.
   */
  updated: number;
  /** Of those, the rows whose stored values really changed. */
  changed?: number;
  /** Of those, the rows that existed and already matched (nothing written). */
  skipped?: number;
  /**
   * The accepted ids with NO link row, so nothing could be applied. A caller
   * keeps these dirty so their meta is re-sent once they link.
   *
   * This field and the two before it are optional because a server that predates
   * them answers `{ updated }` alone, and this client deliberately does not fill
   * the gap: fabricating an empty `unapplied` would claim every id was applied,
   * the one wrong direction here, since the caller would then mark them clean
   * and never re-push them.
   */
  unapplied?: string[];
}

/**
 * How long one server call may run before its AbortController fires. Named
 * rather than inline so the suite can pin the deadline against a literal.
 */
export const SERVER_CALL_TIMEOUT_MS = 8000;

/**
 * The outbox poll's own deadline, and it is deliberately far longer than every
 * other call's.
 *
 * A 200 is the ONLY acknowledgement the outbox has: the server drains its three
 * in-memory streams inside the request and preserves them only when the response
 * fails, so a client that abandons a poll the server later answers 200 to
 * consumes items nobody received. The server's read deadline is 65 s
 * (DB_QUERY_TIMEOUT_MS in server/db.ts), so this must sit above it: the client
 * gives up only once the server itself can no longer be about to succeed.
 */
export const DEFAULT_OUTBOX_TIMEOUT_MS = 70_000;

/**
 * How many Discord ids one flex-batch request may ask about, matching the
 * server's array cap (FLEX_BATCH_CAP in server/internal.ts). Over-cap ids are
 * dropped SERVER-side, so a caller batches against this rather than sending more
 * and hoping; `flexBatch` deliberately does not slice for you.
 */
export const FLEX_BATCH_LIMIT = 1000;

/** What a TimerSeam hands back. Opaque: only ever passed back to clearTimeout. */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

/** The timer pair backing the per-call deadline. */
export interface TimerSeam {
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}

export class ServerClient {
  // `fetch` and the deadline timer pair are trailing constructor parameters with
  // their production defaults, so a test can drive the whole request/response
  // envelope with no network IO and fire the abort deadline without a real 8
  // second wait. Constructed with a base URL and a secret alone, as main.ts
  // does, this is exactly the production client.
  constructor(
    private baseUrl: string,
    private secret: string,
    private fetchImpl: typeof fetch = (...args) => fetch(...args),
    private timers: TimerSeam = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle),
    },
  ) {}

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs: number = SERVER_CALL_TIMEOUT_MS,
  ): Promise<T | null> {
    const controller = new AbortController();
    const timer = this.timers.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'x-woc-discord-secret': this.secret,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        console.error(`[bot] server ${method} ${path} -> ${resp.status}`);
        return null;
      }
      const env = (await resp.json()) as Envelope<T>;
      return env.success ? env.data : null;
    } catch (err) {
      console.error(`[bot] server ${method} ${path} failed`, err);
      return null;
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  /**
   * The flex payload for many Discord ids in one request, replacing one `flex`
   * call per online member.
   *
   * The list is sent exactly as given: no slice at FLEX_BATCH_LIMIT and no
   * de-duplication. Batching is the caller's, because a silent slice here would
   * drop ids without saying so, and the answer's `requested` echo, the caller's
   * only way to tell a truncated request from a genuinely unlinked set, is
   * counted against the ids the CALLER believes it sent.
   */
  flexBatch(discordUserIds: readonly string[]): Promise<FlexBatchResult | null> {
    return this.call('POST', '/internal/discord/flex-batch', {
      discord_user_ids: discordUserIds,
    });
  }

  /**
   * Everything queued for the bot, in one poll: relay posts, the activity feed,
   * the reward-winner days, and the link-change stream.
   *
   * Runs on its own much longer deadline (see DEFAULT_OUTBOX_TIMEOUT_MS): a 200
   * is the server's only acknowledgement, so abandoning a poll early is how
   * queued items get consumed by nobody.
   */
  drainOutbox(timeoutMs: number = DEFAULT_OUTBOX_TIMEOUT_MS): Promise<OutboxEnvelope | null> {
    return this.call('GET', '/internal/discord/outbox', undefined, timeoutMs);
  }

  roles(discordUserId: string): Promise<RolesData | null> {
    return this.call(
      'GET',
      `/internal/discord/roles?discord_user_id=${encodeURIComponent(discordUserId)}`,
    );
  }

  /**
   * Presence, plus the rate-governor counters when the caller could collect
   * them. The counters field is OPTIONAL on the wire, not nullable: a push that
   * could not read a snapshot omits the key entirely (see
   * `withPresenceCounters`), so the server keeps parsing the exact pre-Phase-8
   * body and telemetry can never be the reason presence fails.
   */
  pushPresence(snapshot: {
    onlineCount: number;
    memberTotal: number;
    voiceChannelName: string | null;
    voice: VoiceMemberPush[];
    counters?: PresenceCounters;
  }): Promise<unknown> {
    return this.call('POST', '/internal/discord/presence', snapshot);
  }

  grant(
    discordUserId: string,
    reason: string,
    points: number,
    dedupeKey?: string,
  ): Promise<unknown> {
    return this.call('POST', '/internal/discord/grant', {
      discord_user_id: discordUserId,
      reason,
      points,
      dedupeKey,
    });
  }

  setMember(discordUserId: string, guildMember: boolean): Promise<unknown> {
    return this.call('POST', '/internal/discord/member', {
      discord_user_id: discordUserId,
      guildMember,
    });
  }

  /**
   * Mark a reward day announced, so the outbox stops serving it.
   *
   * The three per-stream drains that used to sit here (relay, activity, and the
   * winners GET) are gone: `drainOutbox` carries all three, and keeping a second
   * way to consume them would mean two clients racing for the same queues. This
   * is the one half of the winners flow that is NOT a read, and it is what makes
   * that stream at-least-once rather than at-most-once.
   */
  markDailyRewardWinners(day: string): Promise<unknown> {
    return this.call('POST', '/internal/discord/daily-rewards-winners/mark', { day });
  }

  /** Push guild metadata (nickname + server join date + top special role). */
  async pushMembersMeta(
    members: {
      discord_user_id: string;
      name: string | null;
      joinedAtMs: number | null;
      role: string | null;
    }[],
  ): Promise<MembersMetaPushResult | null> {
    const data = await this.call<MembersMetaPushResult>('POST', '/internal/discord/members-meta', {
      members,
    });
    // The server coerces an over-cap request body to an EMPTY member list and
    // answers 200 { updated: 0 }, so a zero on a non-empty push is the one
    // silent-drop signature worth surfacing (the batch sizing in logic.ts is
    // built to make this unreachable).
    //
    // It is reported as a FAILURE (null), not just logged. Callers now diff
    // against the last successfully pushed record, so "the request did not
    // throw" is no longer a good enough success signal: returning the truthy
    // `{ updated: 0 }` here would let a caller mark a batch clean that the
    // server demonstrably dropped, and the diff would then suppress the retry
    // for the life of the process rather than for one sweep.
    if (data && members.length > 0 && data.updated === 0) {
      console.error(`[bot] members-meta push of ${members.length} processed 0 rows`);
      return null;
    }
    return data;
  }

  /**
   * The discord ids whose stored link still carries guild membership or a
   * special-role key, for the departed-member reconcile. Null when the server
   * is unreachable or the payload is malformed; the caller MUST treat null as
   * "change nothing" (an empty ARRAY is a real "nothing flagged" answer).
   */
  async flairedIds(): Promise<string[] | null> {
    const data = await this.call<{ ids: unknown }>('GET', '/internal/discord/flaired-ids');
    if (!data || !Array.isArray(data.ids)) return null;
    return data.ids.filter((x): x is string => typeof x === 'string');
  }
}
