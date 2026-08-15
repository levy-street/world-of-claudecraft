// Boot-time constants of the Discord bot: the env contract `loadConfig` reads
// and the background-loop cadences. Both are pure value reads with no IO, so
// they are testable in plain Node; the env arms mutate `process.env` and restore
// it key by key so nothing leaks into another test file.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEARTBEAT_INTERVAL_MS,
  OUTBOX_IDLE_MS,
  OUTBOX_POLL_MS,
  PRESENCE_DEBOUNCE_MS,
  ROLE_SYNC_INTERVAL_MS,
  SWEEP_SLICE_MS,
} from '../bot/cadence';
import { loadConfig } from '../bot/config';
import { DEFAULT_SWEEP_SLICE_SIZE } from '../bot/linked_sweep';
import { DEFAULT_HEARTBEAT_FILE } from '../bot/liveness';
import { DEFAULT_OUTBOX_TIMEOUT_MS } from '../bot/server_client';

// Every env key loadConfig reads. Each test starts from a clean slate of these,
// so a value left by another test (or by the developer's own shell) can never
// decide an arm.
const BOT_ENV_KEYS = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'DISCORD_BOT_SECRET',
  'GAME_SERVER_URL',
  'PUBLIC_GAME_URL',
  'DISCORD_VOICE_CHANNEL_ID',
  'DISCORD_WELCOME_CHANNEL_ID',
  'DISCORD_TEST_CHANNEL_ID',
  'DISCORD_RELAY_CHANNEL_ID',
  'DISCORD_ACTIVITY_CHANNEL_ID',
  'DISCORD_DAILY_REWARDS_CHANNEL_ID',
  'DISCORD_SYNC_NICKNAMES',
  'DISCORD_MAX_RPS',
  'DISCORD_BAN_PAUSE_MS',
  'DISCORD_BREAKER_LIMIT',
  'DISCORD_FORBIDDEN_TTL_MS',
  'DISCORD_ROLE_SYNC_INTERVAL_MS',
  'DISCORD_PRESENCE_DEBOUNCE_MS',
  'DISCORD_OUTBOX_POLL_MS',
  'DISCORD_OUTBOX_IDLE_MS',
  'DISCORD_OUTBOX_TIMEOUT_MS',
  'DISCORD_SWEEP_SLICE_MS',
  'DISCORD_SWEEP_SLICE_SIZE',
  'DISCORD_HEARTBEAT_FILE',
  'DISCORD_HEARTBEAT_INTERVAL_MS',
] as const;

/** Fill the four required keys with obvious non-secret placeholders. */
function setRequired(): void {
  process.env.DISCORD_BOT_TOKEN = 'token-placeholder';
  process.env.DISCORD_CLIENT_ID = 'client-placeholder';
  process.env.DISCORD_GUILD_ID = 'guild-placeholder';
  process.env.DISCORD_BOT_SECRET = 'secret-placeholder';
}

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of BOT_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of BOT_ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('loadConfig required env', () => {
  it('names the ONE missing key in the thrown message, for each of the four', () => {
    // The four are evaluated in object-literal order, so each arm fills the
    // other three and clears only its own key: an implementation that reported
    // a fixed name (or the first key every time) fails here.
    const cases = [
      ['DISCORD_BOT_TOKEN', '[bot] missing required env DISCORD_BOT_TOKEN'],
      ['DISCORD_CLIENT_ID', '[bot] missing required env DISCORD_CLIENT_ID'],
      ['DISCORD_GUILD_ID', '[bot] missing required env DISCORD_GUILD_ID'],
      ['DISCORD_BOT_SECRET', '[bot] missing required env DISCORD_BOT_SECRET'],
    ] as const;
    for (const [key, message] of cases) {
      setRequired();
      delete process.env[key];
      expect(() => loadConfig()).toThrowError(new Error(message));
    }
  });

  it('treats an EMPTY required value as missing (the !v guard, not a key check)', () => {
    // The key IS present: only the falsy-value guard rejects this, which is what
    // stops a blank line in a .env from booting a bot that cannot authenticate.
    // Every one of the four, not just the secret: `required` is shared today,
    // but an inlined key check on any single one would be invisible otherwise.
    for (const key of [
      'DISCORD_BOT_TOKEN',
      'DISCORD_CLIENT_ID',
      'DISCORD_GUILD_ID',
      'DISCORD_BOT_SECRET',
    ] as const) {
      setRequired();
      process.env[key] = '';
      expect(key in process.env).toBe(true);
      expect(() => loadConfig()).toThrowError(new Error(`[bot] missing required env ${key}`));
    }
  });

  it('passes the four required values through verbatim once all are set', () => {
    setRequired();
    const cfg = loadConfig();
    expect(cfg.token).toBe('token-placeholder');
    expect(cfg.clientId).toBe('client-placeholder');
    expect(cfg.guildId).toBe('guild-placeholder');
    expect(cfg.botSecret).toBe('secret-placeholder');
  });
});

describe('loadConfig defaults', () => {
  it('defaults the game server URL and the public game URL', () => {
    setRequired();
    const cfg = loadConfig();
    expect(cfg.gameServerUrl).toBe('http://127.0.0.1:8787');
    expect(cfg.gameUrl).toBe('https://worldofclaudecraft.com');
  });

  it('lets an env value override each default', () => {
    setRequired();
    process.env.GAME_SERVER_URL = 'http://10.0.0.5:9000';
    process.env.PUBLIC_GAME_URL = 'https://staging.example.test';
    const cfg = loadConfig();
    expect(cfg.gameServerUrl).toBe('http://10.0.0.5:9000');
    expect(cfg.gameUrl).toBe('https://staging.example.test');
  });

  it('falls back to the default when the override is an EMPTY string', () => {
    // `||`, not `??`: an empty GAME_SERVER_URL would otherwise make every
    // /internal/discord call target a relative path against no host.
    setRequired();
    process.env.GAME_SERVER_URL = '';
    process.env.PUBLIC_GAME_URL = '';
    const cfg = loadConfig();
    expect(cfg.gameServerUrl).toBe('http://127.0.0.1:8787');
    expect(cfg.gameUrl).toBe('https://worldofclaudecraft.com');
  });

  it('defaults every optional channel id to the empty string', () => {
    setRequired();
    const cfg = loadConfig();
    expect(cfg.voiceChannelId).toBe('');
    expect(cfg.welcomeChannelId).toBe('');
    expect(cfg.testChannelId).toBe('');
    expect(cfg.relayChannelId).toBe('');
    expect(cfg.activityChannelId).toBe('');
    expect(cfg.dailyRewardsChannelId).toBe('');
  });

  it('reads each channel field from its OWN env key', () => {
    // Every value is distinct, so a swapped key name (voice reading the welcome
    // key, say) cannot pass. The all-defaults test above cannot catch that: both
    // arms are the empty string there.
    setRequired();
    process.env.DISCORD_VOICE_CHANNEL_ID = 'voice-id';
    process.env.DISCORD_WELCOME_CHANNEL_ID = 'welcome-id';
    process.env.DISCORD_TEST_CHANNEL_ID = 'test-id';
    process.env.DISCORD_RELAY_CHANNEL_ID = 'relay-id';
    process.env.DISCORD_ACTIVITY_CHANNEL_ID = 'activity-id';
    process.env.DISCORD_DAILY_REWARDS_CHANNEL_ID = 'daily-id';

    const cfg = loadConfig();
    expect(cfg.voiceChannelId).toBe('voice-id');
    expect(cfg.welcomeChannelId).toBe('welcome-id');
    expect(cfg.testChannelId).toBe('test-id');
    expect(cfg.relayChannelId).toBe('relay-id');
    expect(cfg.activityChannelId).toBe('activity-id');
    expect(cfg.dailyRewardsChannelId).toBe('daily-id');
  });
});

describe('loadConfig channel fallback ladders', () => {
  it('prefers the relay channel over the test channel', () => {
    setRequired();
    process.env.DISCORD_RELAY_CHANNEL_ID = 'relay-1';
    process.env.DISCORD_TEST_CHANNEL_ID = 'test-1';
    expect(loadConfig().relayChannelId).toBe('relay-1');
  });

  it('falls the relay channel back to the test channel, then to empty', () => {
    setRequired();
    process.env.DISCORD_TEST_CHANNEL_ID = 'test-1';
    expect(loadConfig().relayChannelId).toBe('test-1');
    delete process.env.DISCORD_TEST_CHANNEL_ID;
    expect(loadConfig().relayChannelId).toBe('');
  });

  it('walks the activity ladder: activity, then relay, then test, then empty', () => {
    setRequired();
    process.env.DISCORD_ACTIVITY_CHANNEL_ID = 'activity-1';
    process.env.DISCORD_RELAY_CHANNEL_ID = 'relay-1';
    process.env.DISCORD_TEST_CHANNEL_ID = 'test-1';
    expect(loadConfig().activityChannelId).toBe('activity-1');

    delete process.env.DISCORD_ACTIVITY_CHANNEL_ID;
    expect(loadConfig().activityChannelId).toBe('relay-1');

    delete process.env.DISCORD_RELAY_CHANNEL_ID;
    expect(loadConfig().activityChannelId).toBe('test-1');

    delete process.env.DISCORD_TEST_CHANNEL_ID;
    expect(loadConfig().activityChannelId).toBe('');
  });

  it('walks past an EMPTY rung, not just an absent one', () => {
    // Every other ladder arm deletes the key, and `??` walks past a deleted key
    // exactly like `||` does, so the two are indistinguishable there. An empty
    // value is where they part, and empty is the realistic shape: a bare
    // `DISCORD_RELAY_CHANNEL_ID=` line in a .env sets it to ''. Under `??` the
    // ladder would stop on that empty string and post nowhere.
    setRequired();
    process.env.DISCORD_RELAY_CHANNEL_ID = '';
    process.env.DISCORD_ACTIVITY_CHANNEL_ID = '';
    process.env.DISCORD_TEST_CHANNEL_ID = 'test-1';

    const cfg = loadConfig();
    expect(cfg.relayChannelId).toBe('test-1');
    expect(cfg.activityChannelId).toBe('test-1');
  });

  it('points BOTH relay and activity at the test channel when only it is set', () => {
    // The single-channel deployment: one announce channel carries the in-game
    // "!" posts and the activity feed.
    setRequired();
    process.env.DISCORD_TEST_CHANNEL_ID = 'test-1';
    const cfg = loadConfig();
    expect(cfg.relayChannelId).toBe('test-1');
    expect(cfg.activityChannelId).toBe('test-1');
  });
});

describe('loadConfig nickname sync opt-out', () => {
  it('is ON when unset', () => {
    setRequired();
    expect(loadConfig().syncNicknames).toBe(true);
  });

  it("is OFF for exactly '0'", () => {
    setRequired();
    process.env.DISCORD_SYNC_NICKNAMES = '0';
    expect(loadConfig().syncNicknames).toBe(false);
  });

  it("stays ON for 'false', 'off', and '' (only '0' opts out)", () => {
    // The arm a careless rewrite to a truthiness check (or to `=== '1'`)
    // breaks: nothing but the literal '0' turns nickname sync off.
    setRequired();
    for (const value of ['false', 'off', 'no', '', '1', 'true']) {
      process.env.DISCORD_SYNC_NICKNAMES = value;
      expect(loadConfig().syncNicknames).toBe(true);
    }
  });
});

describe('loadConfig heartbeat file (D15)', () => {
  it('defaults to the shared DEFAULT_HEARTBEAT_FILE, and to its literal value', () => {
    // Both, because they say different things: the constant pins the SEAM (the
    // config and the writer cannot disagree about where the file lives), and the
    // literal pins the value, which is the one the container healthcheck and the
    // runtime image's writable directory were both chosen against.
    setRequired();
    expect(loadConfig().heartbeatFile).toBe(DEFAULT_HEARTBEAT_FILE);
    expect(loadConfig().heartbeatFile).toBe('/tmp/discord-bot-heartbeat');
  });

  it('takes an override verbatim', () => {
    setRequired();
    process.env.DISCORD_HEARTBEAT_FILE = '/var/run/woc/heartbeat';
    expect(loadConfig().heartbeatFile).toBe('/var/run/woc/heartbeat');
  });

  it('falls back for an EMPTY or whitespace-only value, and trims the rest', () => {
    // Whitespace is the arm a bare `||` misses: `' '` is truthy, so an override
    // written as a padded line in a compose file or a .env would send the write
    // to a path the healthcheck never stats, which reads as a permanently
    // unhealthy container rather than as the typo it is.
    setRequired();
    for (const bad of ['', ' ', '   ', '\t', '\n']) {
      process.env.DISCORD_HEARTBEAT_FILE = bad;
      expect(loadConfig().heartbeatFile).toBe(DEFAULT_HEARTBEAT_FILE);
    }
    process.env.DISCORD_HEARTBEAT_FILE = '  /var/run/woc/heartbeat  ';
    expect(loadConfig().heartbeatFile).toBe('/var/run/woc/heartbeat');
  });
});

describe('loadConfig env-key inventory', () => {
  it('reads no env key that BOT_ENV_KEYS does not save and restore', () => {
    // The save/restore list above is what stops the developer's own shell (or
    // another suite) from deciding an arm. It is only as good as its coverage:
    // a key added to bot/config.ts and not here would silently read through to
    // the ambient environment and could make a fallback test pass for the wrong
    // reason. Line comments are stripped first so a commented-out read cannot
    // pad the set.
    // bot/config.ts is mostly JSDoc, so block comments have to go first: a
    // `/** process.env.FOO */` would otherwise be counted as a real read.
    const source = readFileSync(new URL('../bot/config.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const direct = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    const dynamic = source.match(/process\.env\[/g) ?? [];
    const viaRequired = [...source.matchAll(/required\('([A-Z0-9_]+)'\)/g)].map((m) => m[1]);

    // Account for EVERY process.env touch first, so a read written in some
    // other shape cannot simply go unseen by the two patterns above and leave
    // the set comparison passing for the wrong reason.
    const total = source.match(/process\.env/g) ?? [];
    expect(direct.length + dynamic.length).toBe(total.length);
    // The one dynamic lookup is required()'s own, whose keys are the literals
    // collected above.
    expect(dynamic.length).toBe(1);
    expect(viaRequired.length).toBe(4);

    expect([...new Set([...direct, ...viaRequired])].sort()).toEqual([...BOT_ENV_KEYS].sort());
  });
});

describe('bot loop cadences', () => {
  it('pins each cadence against its literal', () => {
    expect(ROLE_SYNC_INTERVAL_MS).toBe(300000);
    expect(PRESENCE_DEBOUNCE_MS).toBe(4000);
    expect(OUTBOX_POLL_MS).toBe(3000);
    expect(OUTBOX_IDLE_MS).toBe(15000);
    expect(SWEEP_SLICE_MS).toBe(3000);
    expect(HEARTBEAT_INTERVAL_MS).toBe(30000);
  });

  it('re-stamps the liveness file several times per role-sync pass', () => {
    // The heartbeat is evidence the scheduler is still turning, so it has to be
    // the cheap fast loop rather than another slow reconcile: the container's
    // stale window is chosen as a multiple of this, and a heartbeat as slow as a
    // pass would make "unhealthy" mean nothing until minutes after a wedge.
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(ROLE_SYNC_INTERVAL_MS);
    expect(ROLE_SYNC_INTERVAL_MS / HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(5);
  });

  it('keeps the presence debounce and outbox poll well under the role sync', () => {
    // The ordering is the point: presence and the outbox pickup are
    // player-visible loops, role sync is the slow reconcile.
    expect(PRESENCE_DEBOUNCE_MS).toBeLessThan(ROLE_SYNC_INTERVAL_MS);
    expect(OUTBOX_POLL_MS).toBeLessThan(ROLE_SYNC_INTERVAL_MS);
  });

  it('gives the outbox poll a real active-to-idle band, and a deadline above both', () => {
    // The band has to be a genuine spread or the D1 backoff is inert: an idle
    // interval at or below the active one makes nextIntervalMs decay by nothing
    // at all, and the loop would keep polling every 3 seconds forever.
    expect(OUTBOX_IDLE_MS).toBeGreaterThan(OUTBOX_POLL_MS);
    // Five times, which the scheduler's doubling decay reaches in three empty
    // runs: slow enough that a bursty feed is not pushed straight to its slowest
    // cadence, fast enough that a quiet bot stops paying for polls nobody reads.
    expect(OUTBOX_IDLE_MS / OUTBOX_POLL_MS).toBe(5);
    // And ONE poll may outlive several idle windows: a 200 is the outbox's only
    // acknowledgement, so the deadline is set by the server's read deadline, not
    // by the cadence. The chain arms after the run SETTLES, so a slow poll costs
    // latency and never an overlapping second poll.
    expect(DEFAULT_OUTBOX_TIMEOUT_MS).toBeGreaterThan(OUTBOX_IDLE_MS);
  });

  it('paces sweep slices far under the pass interval they subdivide', () => {
    // The two are a pair, not two independent knobs: the slice cadence is what
    // spreads ONE pass across the interval, so a slice interval at or above the
    // pass interval would collapse the spread back into a burst per pass, which
    // is the shape this phase removed. Many slices per pass is the whole point,
    // so the ratio is asserted rather than a bare ordering.
    expect(SWEEP_SLICE_MS).toBeLessThan(ROLE_SYNC_INTERVAL_MS);
    expect(ROLE_SYNC_INTERVAL_MS / SWEEP_SLICE_MS).toBeGreaterThanOrEqual(10);
  });

  it('bounds one slice under the governor queue depth it has to fit in', () => {
    // The default slice size is chosen against the rate governor, not the
    // server: a slice's worst case is one nickname PATCH plus a role add and a
    // role remove per member, so the burst it can queue is three writes per
    // member. MAX_QUEUE_DEPTH is 256 per bucket queue, and those writes spread
    // across three queues, so the binding comparison is per queue.
    expect(DEFAULT_SWEEP_SLICE_SIZE).toBe(100);
    expect(DEFAULT_SWEEP_SLICE_SIZE).toBeLessThan(256);
  });
});

describe('loadConfig governor knobs', () => {
  // The four keys Phase 2 introduced. The BOT_ENV_KEYS inventory guard above
  // proves only that config.ts READS them; nothing there proves a value reaches
  // the right field, nor that the empty-string fallback exists at all.
  const KNOBS = [
    { env: 'DISCORD_MAX_RPS', field: 'maxRps', fallback: 8, override: '17' },
    { env: 'DISCORD_BAN_PAUSE_MS', field: 'banPauseMs', fallback: 600000, override: '123456' },
    { env: 'DISCORD_BREAKER_LIMIT', field: 'breakerLimit', fallback: 300, override: '42' },
    {
      env: 'DISCORD_FORBIDDEN_TTL_MS',
      field: 'forbiddenTtlMs',
      fallback: 86400000,
      override: '999',
    },
  ] as const;

  it('defaults all four to their documented values when unset', () => {
    setRequired();
    const cfg = loadConfig();
    expect(cfg.maxRps).toBe(8);
    expect(cfg.banPauseMs).toBe(600000);
    expect(cfg.breakerLimit).toBe(300);
    expect(cfg.forbiddenTtlMs).toBe(86400000);
  });

  it('reads each knob from its OWN key, with a distinct value per field', () => {
    // Every override is different, so a transposed pair (ban pause reading the
    // breaker key, say) cannot pass. The all-defaults test above cannot catch
    // that: a swap there is invisible because both sides are the default.
    setRequired();
    for (const knob of KNOBS) process.env[knob.env] = knob.override;
    const cfg = loadConfig() as unknown as Record<string, number>;
    for (const knob of KNOBS) {
      expect(cfg[knob.field]).toBe(Number(knob.override));
    }
  });

  it('falls back to the default for an EMPTY value, never to 0', () => {
    // The trap this exists for: Number('') is 0. A bare parse would turn a blank
    // `DISCORD_MAX_RPS=` line in a .env into a hard 0, which stops the bot
    // sending entirely, and a 0 breaker limit would trip on the first response.
    setRequired();
    for (const knob of KNOBS) process.env[knob.env] = '';
    const cfg = loadConfig() as unknown as Record<string, number>;
    for (const knob of KNOBS) {
      expect(cfg[knob.field]).toBe(knob.fallback);
      expect(cfg[knob.field]).not.toBe(0);
    }
  });

  it('falls back for whitespace, non-numeric, zero and negative values alike', () => {
    // Each of these would otherwise produce a dangerous state rather than a
    // merely wrong one: 0 rps sends nothing, a 0 or negative threshold trips
    // immediately, and NaN makes every comparison false.
    for (const bad of ['   ', 'eight', '0', '-5', 'NaN', '1e', 'null']) {
      setRequired();
      for (const knob of KNOBS) process.env[knob.env] = bad;
      const cfg = loadConfig() as unknown as Record<string, number>;
      for (const knob of KNOBS) {
        expect(cfg[knob.field]).toBe(knob.fallback);
      }
    }
  });

  it('accepts a legitimate override that happens to be small but positive', () => {
    // The complement of the rejection arm: the guard rejects non-positive, not
    // "anything unusual", so an operator throttling the bot hard in an incident
    // still gets the value they asked for.
    setRequired();
    process.env.DISCORD_MAX_RPS = '1';
    expect(loadConfig().maxRps).toBe(1);
  });
});

describe('loadConfig cadence knobs (D13)', () => {
  // The three keys Phase 3 introduced, so an operator can slow every sweep down
  // during an incident without a redeploy. Same shape as the governor knobs
  // above, and tested to the same depth: reading a key is not the same as
  // landing its value in the right field.
  const CADENCE_KNOBS = [
    {
      env: 'DISCORD_ROLE_SYNC_INTERVAL_MS',
      field: 'roleSyncIntervalMs',
      constant: 'ROLE_SYNC_INTERVAL_MS',
      fallback: 300000,
      override: '450000',
    },
    {
      env: 'DISCORD_PRESENCE_DEBOUNCE_MS',
      field: 'presenceDebounceMs',
      constant: 'PRESENCE_DEBOUNCE_MS',
      fallback: 4000,
      override: '7500',
    },
    // The three Phase 6 outbox knobs. The first two are the poll's active and
    // idle cadence; the third is a request DEADLINE rather than an interval, so
    // its default lives with the client that spends it (the same reasoning the
    // slice size gets below) and it is the one knob whose constant comes from
    // bot/server_client.ts.
    {
      env: 'DISCORD_OUTBOX_POLL_MS',
      field: 'outboxPollMs',
      constant: 'OUTBOX_POLL_MS',
      fallback: 3000,
      override: '11000',
    },
    {
      env: 'DISCORD_OUTBOX_IDLE_MS',
      field: 'outboxIdleMs',
      constant: 'OUTBOX_IDLE_MS',
      fallback: 15000,
      override: '21000',
    },
    {
      env: 'DISCORD_OUTBOX_TIMEOUT_MS',
      field: 'outboxTimeoutMs',
      constant: 'DEFAULT_OUTBOX_TIMEOUT_MS',
      fallback: 70000,
      // Above the default on purpose: the default is also the FLOOR for this
      // knob (a deadline below the server's own drain deadline silently loses
      // outbox items), so a below-70000 override would fall back and fail the
      // distinct-value case. The floor itself has its own arms below.
      override: '84000',
    },
    // The two Phase 6 sweep knobs. The slice interval is a cadence like the
    // three above; the slice SIZE is a threshold, so its default lives beside
    // the sweep that spends it rather than in bot/cadence.ts, and the seam
    // assertion below reads it from bot/linked_sweep.ts instead.
    {
      env: 'DISCORD_SWEEP_SLICE_MS',
      field: 'sweepSliceMs',
      constant: 'SWEEP_SLICE_MS',
      fallback: 3000,
      override: '9500',
    },
    {
      env: 'DISCORD_SWEEP_SLICE_SIZE',
      field: 'sweepSliceSize',
      constant: 'DEFAULT_SWEEP_SLICE_SIZE',
      fallback: 100,
      override: '37',
    },
    // The Phase 7 liveness stamp (D15). A cadence like the first four: its
    // default lives in bot/cadence.ts beside them, and it is the interval the
    // container healthcheck's stale window is chosen against, so an operator
    // slowing it down in an incident has to be able to reach it.
    {
      env: 'DISCORD_HEARTBEAT_INTERVAL_MS',
      field: 'heartbeatIntervalMs',
      constant: 'HEARTBEAT_INTERVAL_MS',
      fallback: 30000,
      override: '17500',
    },
  ] as const;

  it('defaults each cadence to the value it had hard-coded, pinned against a LITERAL', () => {
    // Against literals, never against the imported constant: driving the
    // assertion from the same constant the implementation reads is a
    // self-comparison that stays green when the value changes.
    setRequired();
    const cfg = loadConfig();
    expect(cfg.roleSyncIntervalMs).toBe(300000);
    expect(cfg.presenceDebounceMs).toBe(4000);
    expect(cfg.outboxPollMs).toBe(3000);
    expect(cfg.outboxIdleMs).toBe(15000);
    expect(cfg.outboxTimeoutMs).toBe(70000);
    expect(cfg.sweepSliceMs).toBe(3000);
    expect(cfg.sweepSliceSize).toBe(100);
    expect(cfg.heartbeatIntervalMs).toBe(30000);
  });

  it('falls back to the SHARED cadence module, not to a second copy of the numbers', () => {
    // Asserting `cfg.roleSyncIntervalMs === ROLE_SYNC_INTERVAL_MS` is what used to
    // stand here, under a comment claiming it proved exactly this. It cannot: the
    // cases above already pin the constant to 300000 and the config to 300000, so
    // the comparison holds in every state where they pass, and inlining the
    // literal into bot/config.ts with the ./cadence import deleted survives it.
    //
    // Only the source can say where the value came from, so that is what this
    // reads. The literals stay pinned above; this pins the SEAM.
    const source = readFileSync(new URL('../bot/config.ts', import.meta.url), 'utf8');
    expect(source).toMatch(
      /import \{[^}]*HEARTBEAT_INTERVAL_MS[^}]*OUTBOX_IDLE_MS[^}]*OUTBOX_POLL_MS[^}]*PRESENCE_DEBOUNCE_MS[^}]*ROLE_SYNC_INTERVAL_MS[^}]*SWEEP_SLICE_MS[^}]*\} from '\.\/cadence'/,
    );
    // The slice SIZE is not a cadence, so it comes from the module that spends
    // it. Same seam, different owner, and it has to be pinned separately or an
    // inlined 100 would pass every other case here.
    expect(source).toMatch(/import \{[^}]*DEFAULT_SWEEP_SLICE_SIZE[^}]*\} from '\.\/linked_sweep'/);
    // The outbox DEADLINE likewise: it is chosen against the server's own read
    // deadline, and the client that spends it owns that reasoning. A second copy
    // of 70000 here is the drift this pin exists to prevent, since the two would
    // then be free to move apart and nothing would fail.
    expect(source).toMatch(
      /import \{[^}]*DEFAULT_OUTBOX_TIMEOUT_MS[^}]*\} from '\.\/server_client'/,
    );
    // And the heartbeat PATH default comes from the module that owns the
    // reasoning behind it (which directory the non-root runtime user can write),
    // for the same reason: a second copy of the path here would be free to drift
    // from the one the writer and the healthcheck agree on.
    expect(source).toMatch(/import \{[^}]*DEFAULT_HEARTBEAT_FILE[^}]*\} from '\.\/liveness'/);
    for (const knob of CADENCE_KNOBS) {
      // Each env key resolved against its own imported constant, never a literal.
      expect(source).toMatch(
        new RegExp(`process\\.env\\.${knob.env}[\\s\\S]{0,40}?${knob.constant}`),
      );
    }
    // And no bare copy of any default survives beside the import. Word-bounded on
    // BOTH sides, never a substring scan: `not.toContain('3000')` also fires on
    // 30000, 13000 and 130000, so the day a governor knob gains a plausible
    // default this file would go red for a number that is not a copy of anything.
    for (const value of ['300_?000', '4_?000', '3_?000', '15_?000', '70_?000', '30_?000', '100']) {
      expect(source).not.toMatch(new RegExp(`(?<![0-9_])${value}(?![0-9_])`));
    }
    // Nor a second copy of the heartbeat PATH, which is a string rather than a
    // number and so escapes every scan above.
    expect(source).not.toContain('/tmp/');
  });

  it('reads each cadence from its OWN key, with a distinct value per field', () => {
    // Every override differs from every other AND from every default, so both a
    // transposed pair and a field that silently kept its fallback fail here.
    setRequired();
    for (const knob of CADENCE_KNOBS) process.env[knob.env] = knob.override;
    const cfg = loadConfig() as unknown as Record<string, number>;
    for (const knob of CADENCE_KNOBS) {
      expect(cfg[knob.field]).toBe(Number(knob.override));
      expect(cfg[knob.field]).not.toBe(knob.fallback);
    }
  });

  it('floors the outbox deadline at its default instead of honoring a shorter one', () => {
    // The one knob with a floor as well as a fallback. The default sits above
    // the server's 65 s drain deadline BECAUSE a 200 is the outbox's only
    // acknowledgement: a poll aborted client-side that the server later answers
    // 200 to consumes items nobody received. An operator shortening the
    // deadline mid-incident is exactly who this guards, so a positive
    // below-floor value falls back loudly rather than silently losing items.
    setRequired();
    const warnings: unknown[][] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });

    process.env.DISCORD_OUTBOX_TIMEOUT_MS = '30000';
    expect(loadConfig().outboxTimeoutMs).toBe(70000);
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain('DISCORD_OUTBOX_TIMEOUT_MS');

    // AT the floor is honored without a warning: the guard is strictly-below.
    warnings.length = 0;
    process.env.DISCORD_OUTBOX_TIMEOUT_MS = '70000';
    expect(loadConfig().outboxTimeoutMs).toBe(70000);
    expect(warnings.length).toBe(0);
    spy.mockRestore();
  });

  it('falls back to the default for empty, non-numeric, zero and negative alike', () => {
    // A cadence of 0 is the dangerous one: it would turn a chained-timeout loop
    // into an unbounded spin, which is the exact storm this phase exists to
    // stop, so a blank line in a .env must never produce it.
    for (const bad of ['', '   ', 'five', '0', '-1', 'NaN']) {
      setRequired();
      for (const knob of CADENCE_KNOBS) process.env[knob.env] = bad;
      const cfg = loadConfig() as unknown as Record<string, number>;
      for (const knob of CADENCE_KNOBS) {
        expect(cfg[knob.field]).toBe(knob.fallback);
        expect(cfg[knob.field]).not.toBe(0);
      }
    }
  });
});
