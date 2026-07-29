// Thin Discord REST client (bot-token authed). Just the calls the bot needs:
// gateway URL, slash-command registration, interaction responses, guild roles +
// member role edits, and posting messages.
//
// This file is an IO SHELL and nothing else. Every request is handed to the
// rate governor (./rate_governor), which owns all pacing: bucket queues,
// proactive gating, the global pause, the invalid-request breaker, and the
// permanent-failure cache. What used to live here was a single retry that
// clamped Discord's retry_after to 10 seconds and answered a Cloudflare ban page
// with a 1 second retry, which is the escalation path the 2026-07-29 incident
// rode all the way down. The governor replaces it; ./rate_governor.ts's own
// header carries the full pacing contract (the incident diagnosis is
// docs/discord-bot-stability/incident-2026-07-29.md).

import {
  DEFAULT_BAN_PAUSE_MS,
  DEFAULT_BREAKER_LIMIT,
  DEFAULT_FORBIDDEN_TTL_MS,
  DEFAULT_MAX_RPS,
  type GovernorClock,
  type GovernorLog,
  type GovernorResponse,
  RateGovernor,
  redactPath,
} from './rate_governor';
import type { TimerSeam } from './server_client';

const API = 'https://discord.com/api/v10';

/**
 * How long ONE dispatched Discord call may run before its AbortController fires.
 *
 * Ledger L10/L17: a `fetch` on a stalled socket never settles, and every REST
 * call here sits under a scheduler task that arms its next delay only after the
 * run settles, so one hung request stops that loop for the life of the process.
 * A deadline is the only thing that can recover it, because the scheduler holds a
 * promise it has no way to abort.
 *
 * Deliberately generous, and deliberately a code constant rather than an env knob
 * (the same shape as SERVER_CALL_TIMEOUT_MS, which it copies): its job is to
 * bound a socket that has stopped talking, not to police a slow but live Discord.
 * Named rather than inline so the suite can pin it against a literal.
 */
export const DISCORD_CALL_TIMEOUT_MS = 15_000;

/**
 * Why the bot edited a member, written into Discord's audit log (D14). Plain
 * ASCII and well inside Discord's 1 to 512 character bound. Two constants, one
 * per member-edit kind, so an operator reading the guild audit log sees which
 * sync wrote the entry: the nickname PATCH carries the level-on-name reason,
 * the role add/remove pair the status-tier one.
 */
export const AUDIT_LOG_REASON = 'World of ClaudeCraft level sync';

/** The role add/remove pair's audit-log reason (same D14 bounds). */
export const ROLE_AUDIT_LOG_REASON = 'World of ClaudeCraft status tier sync';

/**
 * Discord rejects a reason header that is empty or over 512 characters, and any
 * non-ASCII byte has to survive an HTTP header round trip. Clamp rather than
 * throw: a rejected header would fail the whole member write.
 */
export function sanitizeAuditReason(reason: string): string {
  const ascii = reason.replace(/[^\x20-\x7E]/g, ' ').trim();
  const collapsed = ascii === '' ? AUDIT_LOG_REASON : ascii;
  return collapsed.slice(0, 512);
}

/** The production clock. Lives here because the governor itself must stay pure. */
export function systemGovernorClock(): GovernorClock {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** The production log sink for the governor. */
export const consoleGovernorLog: GovernorLog = (level, message, fields) => {
  const detail = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  if (level === 'error') console.error(`${message} ${detail}`);
  else console.warn(`${message} ${detail}`);
};

/** The four governor knobs, as `bot/config.ts` resolves them from env. */
export interface GovernorConfig {
  maxRps: number;
  banPauseMs: number;
  breakerLimit: number;
  forbiddenTtlMs: number;
}

/**
 * Build the production governor from config. This lives here, in the IO shell,
 * rather than inline in `bot/main.ts`, for one reason: `main.ts` calls `main()`
 * at module scope, so nothing there is reachable from a test, and a transposed
 * pair of knobs at the construction site would ship in silence. As a named
 * export the mapping is pinnable. The clock and the log sink are the shell's
 * production ones, which is what keeps the governor module itself pure.
 */
export function governorFromConfig(
  config: GovernorConfig,
  // Trailing seams with production defaults, the one convention the three shells
  // share (bot/CLAUDE.md, "One injection convention in the three shells").
  // Without them the mapping below is unobservable:
  // the production clock is the real one, so pinning that `banPauseMs` reached
  // the governor would mean a test that actually waits out a ban pause.
  clock: GovernorClock = systemGovernorClock(),
  log: GovernorLog = consoleGovernorLog,
): RateGovernor {
  return new RateGovernor({
    clock,
    maxRps: config.maxRps,
    banPauseMs: config.banPauseMs,
    breakerLimit: config.breakerLimit,
    forbiddenTtlMs: config.forbiddenTtlMs,
    log,
  });
}

/** What the shell hands back to the governor, plus what only the shell needs. */
interface RestResponse extends GovernorResponse {
  ok: boolean;
  /** Parsed success body, or null when there is none. */
  data: unknown;
  /**
   * Body text for any non-ok status, a 429 included: a 429 that exhausts
   * MAX_ATTEMPTS is returned rather than retried, and the throw below reports
   * its text like any other failure. Empty for a success and for a 204.
   */
  errorText: string;
}

// Permanent-failure cache keys, scoped PER PERMISSION rather than per member.
// A member can be un-writable for one of these and perfectly writable for the
// other, and the two failures come from different Discord permissions:
// MANAGE_NICKNAMES versus MANAGE_ROLES. Sharing one key per member would let a
// nickname 403, which Discord returns PERMANENTLY for the guild owner and for
// anyone above the bot in the role hierarchy, suppress that member's tier-role
// sync for the whole TTL. With MANAGE_NICKNAMES missing outright, every member
// would 403 on the PATCH and all role sync in the guild would stop.
function nickSubject(guildId: string, userId: string): string {
  return `nick:${guildId}:${userId}`;
}

function rolesSubject(guildId: string, userId: string): string {
  return `roles:${guildId}:${userId}`;
}

function collectHeaders(source: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source || typeof source.forEach !== 'function') return out;
  source.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export class DiscordApi {
  // `fetch` and the governor are trailing constructor parameters with their
  // production defaults so tests can drive the request path with no real network
  // IO and no real wait. Constructed with the token alone, as bot/main.ts does,
  // this is exactly the production client.
  //
  // The fetch default FORWARDS to the global rather than capturing it, which
  // keeps one convention across the three shells: the global is read at CALL
  // time, so it is never invoked with the instance as its `this`, and a test
  // that swaps a global after construction is still seen. See bot/CLAUDE.md
  // (R15) and state.md R16.
  constructor(
    private token: string,
    private fetchImpl: typeof fetch = (...args) => fetch(...args),
    // Through the factory, not a second hand-rolled option map: two construction
    // sites for the same thing means only one of them is pinned and they drift.
    private governor: RateGovernor = governorFromConfig({
      maxRps: DEFAULT_MAX_RPS,
      banPauseMs: DEFAULT_BAN_PAUSE_MS,
      breakerLimit: DEFAULT_BREAKER_LIMIT,
      forbiddenTtlMs: DEFAULT_FORBIDDEN_TTL_MS,
    }),
    // The per-call deadline's timer pair, same forwarding-default convention.
    private timers: TimerSeam = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle),
    },
  ) {}

  /** Counters for Phase 8. */
  counters(): ReturnType<RateGovernor['snapshot']> {
    return this.governor.snapshot();
  }

  /** Clear the permanent-failure cache (the bot's own role position moved). */
  invalidateForbidden(subjectKey?: string): void {
    this.governor.invalidateForbidden(subjectKey);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    options: { subjectKey?: string; essential?: boolean; reason?: string } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'WorldOfClaudeCraftBot (https://worldofclaudecraft.com, 1.0)',
    };
    if (options.reason !== undefined) {
      headers['X-Audit-Log-Reason'] = sanitizeAuditReason(options.reason);
    }

    const send = async (): Promise<RestResponse> => {
      // The deadline is armed HERE, inside the send callback, and never around
      // `governor.run` below. The governor queues a request and dispatches it
      // later, and a global pause after a 429 is measured in minutes, so a
      // deadline wrapped around the queue wait would abort calls that were
      // waiting exactly as designed. Armed at dispatch, it times the one thing it
      // is meant to time: how long Discord takes to answer.
      const controller = new AbortController();
      const timer = this.timers.setTimeout(() => controller.abort(), DISCORD_CALL_TIMEOUT_MS);
      try {
        const resp = await this.fetchImpl(`${API}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const collected = collectHeaders(resp.headers);
        // A 204 has no body at all, so it short circuits before any read: falling
        // through would lean entirely on a parse failure being caught.
        if (resp.status === 204) {
          return {
            status: 204,
            headers: collected,
            jsonParsed: false,
            ok: true,
            data: null,
            errorText: '',
          };
        }
        if (resp.status === 429) {
          // Read the body ONCE as text and parse from that. Whether it is JSON at
          // all is the signal that separates a normal Discord 429 from a
          // Cloudflare ban page, and a real Response body cannot be read twice.
          const text = await resp.text().catch(() => '');
          try {
            return {
              status: 429,
              headers: collected,
              json: JSON.parse(text),
              jsonParsed: true,
              ok: false,
              data: null,
              errorText: text,
            };
          } catch {
            // nonJsonBody only when text is non-empty: an empty string here
            // means the read failed (the .catch above) or the body was blank,
            // and the governor must retry that as a normal 429 rather than
            // score it as a Cloudflare ban.
            return {
              status: 429,
              headers: collected,
              jsonParsed: false,
              nonJsonBody: text !== '',
              ok: false,
              data: null,
              errorText: text,
            };
          }
        }
        if (resp.ok) {
          return {
            status: resp.status,
            headers: collected,
            jsonParsed: true,
            ok: true,
            data: await resp.json().catch(() => null),
            errorText: '',
          };
        }
        return {
          status: resp.status,
          headers: collected,
          jsonParsed: false,
          ok: false,
          data: null,
          errorText: await resp.text().catch(() => ''),
        };
      } finally {
        // Inside the try, so the body reads above are covered by the same signal:
        // a socket that delivered headers and then stalled mid-body is the same
        // hang. Cleared on every path, including the abort itself, so a settled
        // call never leaves a timer holding the event loop open.
        this.timers.clearTimeout(timer);
      }
    };

    const resp = await this.governor.run(
      {
        method,
        path,
        subjectKey: options.subjectKey,
        essential: options.essential,
      },
      send,
    );

    if (!resp.ok) {
      // `redactPath`, not `path`: three interaction routes carry a live bearer
      // token in the path, and this message reaches a bare console.error in
      // bot/main.ts. Ledger item L1; the redaction belongs in the THROW, because
      // fixing only the one named catch would leave every other handler leaking.
      throw new Error(
        `[bot] discord ${method} ${redactPath(path)} -> ${resp.status} ${resp.errorText.slice(0, 200)}`,
      );
    }
    return resp.data;
  }

  async gatewayUrl(): Promise<string> {
    const data = (await this.request('GET', '/gateway/bot')) as { url?: string };
    return data?.url || 'wss://gateway.discord.gg';
  }

  async registerGuildCommands(
    clientId: string,
    guildId: string,
    commands: unknown[],
  ): Promise<void> {
    await this.request('PUT', `/applications/${clientId}/guilds/${guildId}/commands`, commands);
  }

  // Acknowledge + reply to a slash command (type 4 = channel message with source).
  // Essential: a slash-command reply has a hard 3 second deadline, so it keeps
  // flowing even while the breaker has stopped the sweeps.
  async respondInteraction(
    interactionId: string,
    interactionToken: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.request(
      'POST',
      `/interactions/${interactionId}/${interactionToken}/callback`,
      { type: 4, data },
      { essential: true },
    );
  }

  // Defer a slash command (type 5 = "Bot is thinking..."), buying up to 15 minutes
  // to produce the real reply. Used for commands that hit the game server first, so
  // a slow round-trip never blows Discord's 3-second initial-response deadline.
  async deferInteraction(
    interactionId: string,
    interactionToken: string,
    ephemeral: boolean,
  ): Promise<void> {
    await this.request(
      'POST',
      `/interactions/${interactionId}/${interactionToken}/callback`,
      { type: 5, data: ephemeral ? { flags: 64 } : {} },
      { essential: true },
    );
  }

  // Edit the deferred response with the real content (webhook on the app id).
  async editOriginalResponse(
    appId: string,
    interactionToken: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.request('PATCH', `/webhooks/${appId}/${interactionToken}/messages/@original`, data, {
      essential: true,
    });
  }

  async guildRoles(guildId: string): Promise<{ id: string; name: string }[]> {
    const roles = (await this.request('GET', `/guilds/${guildId}/roles`)) as
      | { id: string; name: string }[]
      | null;
    return Array.isArray(roles) ? roles : [];
  }

  // Create a guild role (needs MANAGE_ROLES). `color` is a 24-bit RGB int (0 =
  // no color). Used to auto-provision the WoC status-tier roles on boot.
  async createGuildRole(
    guildId: string,
    name: string,
    color = 0,
  ): Promise<{ id: string; name: string }> {
    return (await this.request('POST', `/guilds/${guildId}/roles`, {
      name,
      color,
      mentionable: false,
      hoist: false,
    })) as { id: string; name: string };
  }

  async addMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
    await this.request('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, {
      subjectKey: rolesSubject(guildId, userId),
      reason: ROLE_AUDIT_LOG_REASON,
    });
  }

  async removeMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      undefined,
      {
        subjectKey: rolesSubject(guildId, userId),
        reason: ROLE_AUDIT_LOG_REASON,
      },
    );
  }

  // Set a member's server nickname (needs MANAGE_NICKNAMES; cannot rename the
  // guild owner). Used to attach the in-game level to their Discord name.
  async setNickname(guildId: string, userId: string, nick: string): Promise<void> {
    await this.request(
      'PATCH',
      `/guilds/${guildId}/members/${userId}`,
      { nick },
      { subjectKey: nickSubject(guildId, userId), reason: AUDIT_LOG_REASON },
    );
  }

  async createMessage(channelId: string, payload: Record<string, unknown>): Promise<void> {
    await this.request('POST', `/channels/${channelId}/messages`, payload);
  }
}
