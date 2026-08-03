// Bot configuration from env. All secrets are server-side env only (never
// committed). Missing-required values throw at boot with a clear message.

import {
  HEARTBEAT_INTERVAL_MS,
  OUTBOX_IDLE_MS,
  OUTBOX_POLL_MS,
  PRESENCE_DEBOUNCE_MS,
  ROLE_SYNC_INTERVAL_MS,
  SWEEP_SLICE_MS,
} from './cadence';
import { DEFAULT_SWEEP_SLICE_SIZE } from './linked_sweep';
import { DEFAULT_HEARTBEAT_FILE } from './liveness';
import {
  DEFAULT_BAN_PAUSE_MS,
  DEFAULT_BREAKER_LIMIT,
  DEFAULT_FORBIDDEN_TTL_MS,
  DEFAULT_MAX_RPS,
} from './rate_governor';
import { DEFAULT_OUTBOX_TIMEOUT_MS } from './server_client';

export interface BotConfig {
  /** Discord bot token (Bot <token>). */
  token: string;
  /** Discord application (client) id, for slash-command registration. */
  clientId: string;
  /** The official guild id the bot operates in. */
  guildId: string;
  /** Base URL of the game server (for /internal/discord/* calls). */
  gameServerUrl: string;
  /** Shared secret matching the server's DISCORD_BOT_SECRET. */
  botSecret: string;
  /** Featured voice channel id surfaced in the game HUD (optional). */
  voiceChannelId: string;
  /** Channel id for welcome messages on member join (optional). */
  welcomeChannelId: string;
  /** Channel id for a startup "bot online" announcement / test posts (optional). */
  testChannelId: string;
  /** Channel id the in-game "!" community posts (LFG etc.) are delivered to. */
  relayChannelId: string;
  /** Channel id the significant-activity feed (level-ups, drops, ...) posts to. */
  activityChannelId: string;
  /** Channel id for daily rewards top-10 winner announcements. */
  dailyRewardsChannelId: string;
  /** Public game URL shown in bot replies. */
  gameUrl: string;
  /** Sync each linked member's Discord nickname to include their in-game level. */
  syncNicknames: boolean;
  /** Governor send-rate ceiling, requests per second (Discord's own limit is 50). */
  maxRps: number;
  /** Process-wide pause after a 429 whose body is not JSON (a Cloudflare ban). */
  banPauseMs: number;
  /** Invalid responses in one 10 minute window that open the request breaker. */
  breakerLimit: number;
  /** How long a member's 400, 401 or 403 is remembered before it is retried. */
  forbiddenTtlMs: number;
  /** How often the role sync, tier-role and special-role refresh sweeps run. */
  roleSyncIntervalMs: number;
  /** How long a burst of voice/presence events is collapsed before one push. */
  presenceDebounceMs: number;
  /** How often the consolidated outbox poll runs while it keeps finding work. */
  outboxPollMs: number;
  /** Where that cadence decays to once the drains come back empty. */
  outboxIdleMs: number;
  /** How long ONE outbox poll may run before its abort deadline fires. */
  outboxTimeoutMs: number;
  /** How long the linked-member sweep waits between slices while a pass is live. */
  sweepSliceMs: number;
  /** How many linked members one sweep slice asks about (and may write to). */
  sweepSliceSize: number;
  /** Where the liveness heartbeat file is written (the healthcheck reads its mtime). */
  heartbeatFile: string;
  /** How often that file is re-stamped. */
  heartbeatIntervalMs: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[bot] missing required env ${name}`);
  return v;
}

/**
 * Positive number from an env VALUE, falling back to the default for anything
 * else. Takes the value rather than the key on purpose: a second dynamic
 * `process.env[...]` lookup would slip past the env-key inventory guard in
 * tests/discord_bot_config.test.ts, which is what keeps this file's real key set
 * enumerable.
 *
 * Empty and non-numeric both fall back. `Number('')` is 0, so an unguarded
 * parse would turn a blank line in a .env into a hard 0, which for the send rate
 * means the bot silently stops sending and for a threshold means it trips
 * immediately.
 */
function positiveNumberFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * The outbox deadline parse: positiveNumberFromEnv plus a FLOOR at the default.
 * DEFAULT_OUTBOX_TIMEOUT_MS is chosen to sit ABOVE the server's own 65 s read
 * deadline, and a 200 is the outbox's only acknowledgement: a client deadline
 * below the server's aborts polls the server later answers 200 to, and every
 * item in that drain is consumed with nobody receiving it, silently. So this
 * knob can only RAISE the deadline; a positive value below the floor logs once
 * and falls back rather than shipping silent queue loss.
 */
function outboxTimeoutFromEnv(raw: string | undefined, floor: number): number {
  const value = positiveNumberFromEnv(raw, floor);
  if (value < floor) {
    console.warn(
      `[bot] DISCORD_OUTBOX_TIMEOUT_MS ${value} is below the server's drain deadline and would lose outbox items; using the ${floor} ms floor`,
    );
    return floor;
  }
  return value;
}

export function loadConfig(): BotConfig {
  return {
    token: required('DISCORD_BOT_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    gameServerUrl: process.env.GAME_SERVER_URL || 'http://127.0.0.1:8787',
    botSecret: required('DISCORD_BOT_SECRET'),
    voiceChannelId: process.env.DISCORD_VOICE_CHANNEL_ID || '',
    welcomeChannelId: process.env.DISCORD_WELCOME_CHANNEL_ID || '',
    testChannelId: process.env.DISCORD_TEST_CHANNEL_ID || '',
    // Relay posts default to the test/announce channel when not set separately.
    relayChannelId:
      process.env.DISCORD_RELAY_CHANNEL_ID || process.env.DISCORD_TEST_CHANNEL_ID || '',
    // Activity feed defaults to the relay channel (then test) when not set.
    activityChannelId:
      process.env.DISCORD_ACTIVITY_CHANNEL_ID ||
      process.env.DISCORD_RELAY_CHANNEL_ID ||
      process.env.DISCORD_TEST_CHANNEL_ID ||
      '',
    dailyRewardsChannelId: process.env.DISCORD_DAILY_REWARDS_CHANNEL_ID || '',
    gameUrl: process.env.PUBLIC_GAME_URL || 'https://worldofclaudecraft.com',
    syncNicknames: process.env.DISCORD_SYNC_NICKNAMES !== '0',
    maxRps: positiveNumberFromEnv(process.env.DISCORD_MAX_RPS, DEFAULT_MAX_RPS),
    banPauseMs: positiveNumberFromEnv(process.env.DISCORD_BAN_PAUSE_MS, DEFAULT_BAN_PAUSE_MS),
    breakerLimit: positiveNumberFromEnv(process.env.DISCORD_BREAKER_LIMIT, DEFAULT_BREAKER_LIMIT),
    forbiddenTtlMs: positiveNumberFromEnv(
      process.env.DISCORD_FORBIDDEN_TTL_MS,
      DEFAULT_FORBIDDEN_TTL_MS,
    ),
    // D13: the loop cadences are the operator's incident lever, so they are
    // env-overridable with today's hard-coded values as the defaults. The
    // defaults stay in bot/cadence.ts, beside nothing else, so the value the
    // suite pins and the value the bot falls back to cannot drift apart (the
    // same reason the governor's DEFAULT_* constants live in rate_governor.ts).
    roleSyncIntervalMs: positiveNumberFromEnv(
      process.env.DISCORD_ROLE_SYNC_INTERVAL_MS,
      ROLE_SYNC_INTERVAL_MS,
    ),
    presenceDebounceMs: positiveNumberFromEnv(
      process.env.DISCORD_PRESENCE_DEBOUNCE_MS,
      PRESENCE_DEBOUNCE_MS,
    ),
    outboxPollMs: positiveNumberFromEnv(process.env.DISCORD_OUTBOX_POLL_MS, OUTBOX_POLL_MS),
    outboxIdleMs: positiveNumberFromEnv(process.env.DISCORD_OUTBOX_IDLE_MS, OUTBOX_IDLE_MS),
    // The one cadence knob whose default does NOT live in bot/cadence.ts: it is
    // a request deadline, not a loop interval, and it is chosen against the
    // server's own read deadline. Importing the client's constant is what keeps
    // the fallback here and the drainOutbox default from drifting apart. The
    // default is also the FLOOR (see outboxTimeoutFromEnv): the knob can only
    // raise the deadline.
    outboxTimeoutMs: outboxTimeoutFromEnv(
      process.env.DISCORD_OUTBOX_TIMEOUT_MS,
      DEFAULT_OUTBOX_TIMEOUT_MS,
    ),
    sweepSliceMs: positiveNumberFromEnv(process.env.DISCORD_SWEEP_SLICE_MS, SWEEP_SLICE_MS),
    // The slice SIZE is a threshold rather than a cadence, so its default lives
    // beside the sweep that spends it (the same reason the governor's
    // DEFAULT_* constants live in rate_governor.ts). It is the operator's lever
    // for the one thing a slice bounds: how many Discord writes a single tick
    // can queue.
    sweepSliceSize: positiveNumberFromEnv(
      process.env.DISCORD_SWEEP_SLICE_SIZE,
      DEFAULT_SWEEP_SLICE_SIZE,
    ),
    // Trimmed before the fallback, unlike the channel ids above: this is a
    // filesystem PATH, and a stray space around it in a compose file or a .env
    // would send the write somewhere the healthcheck never looks, which reads as
    // a permanently unhealthy bot rather than as a typo.
    heartbeatFile: process.env.DISCORD_HEARTBEAT_FILE?.trim() || DEFAULT_HEARTBEAT_FILE,
    heartbeatIntervalMs: positiveNumberFromEnv(
      process.env.DISCORD_HEARTBEAT_INTERVAL_MS,
      HEARTBEAT_INTERVAL_MS,
    ),
  };
}
