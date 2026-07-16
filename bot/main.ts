// World of ClaudeCraft Discord bot.
//
// Two-way bridge between the game and the official Discord server:
//  - IN DISCORD: /whoami shows your link status, /link the connect instructions;
//    status-tier roles are synced from in-game reward points (missing roles are
//    auto-provisioned); member joins are recorded without a welcome message.
//  - INTO THE GAME: who is online + in the featured voice room is pushed to the
//    server, which surfaces it in the HUD Discord widget.
//
// Discord state (gateway/REST) lives entirely here; the game server stays the
// authority for rewards. Pure protocol/diff/embed logic is in ./logic (tested);
// this file is the wiring. esbuild-bundled for Node via `npm run bot`.

import { DISCORD_SPECIAL_ROLES, specialRoleByName } from '../src/sim/discord_roles';
import { DISCORD_REWARD_GRANTS } from '../src/sim/discord_tier';
import { loadConfig } from './config';
import { DiscordApi } from './discord_api';
import { Gateway } from './gateway';
import {
  allTierRoleNames,
  buildActivityMessage,
  buildDailyRewardWinnersMessage,
  buildLevelNick,
  buildLinkContent,
  buildRelayMessage,
  buildWhoamiContent,
  computeRoleSync,
  isSlashCommand,
  type RawVoiceState,
  SLASH_COMMANDS,
  tierRoleColor,
  voiceMembersForChannel,
} from './logic';
import { ServerClient, type VoiceMemberPush } from './server_client';

const ROLE_SYNC_INTERVAL_MS = 5 * 60_000;
const PRESENCE_DEBOUNCE_MS = 4_000;
const RELAY_POLL_MS = 3_000; // how often the bot pulls queued in-game "!" posts

async function main(): Promise<void> {
  // Load .env (and optional .env.local) into process.env, matching server/db.ts.
  // Existing ambient env wins; missing file is fine (rely on the ambient env).
  try {
    process.loadEnvFile?.();
  } catch {
    /* no .env */
  }
  try {
    process.loadEnvFile?.('.env.local');
  } catch {
    /* no .env.local */
  }
  const cfg = loadConfig();
  const discord = new DiscordApi(cfg.token);
  const server = new ServerClient(cfg.gameServerUrl, cfg.botSecret);

  await discord.registerGuildCommands(cfg.clientId, cfg.guildId, [...SLASH_COMMANDS]);

  // Resolve the status-tier role ids by name (WoC Initiate ... WoC Mythic).
  // tierRoleIds maps a 1-based rung index to its role id.
  const tierRoleIds = new Map<number, string>();
  const refreshTierRoles = async (): Promise<void> => {
    const roles = await discord.guildRoles(cfg.guildId);
    const names = allTierRoleNames();
    names.forEach((name, i) => {
      const role = roles.find((r) => r.name === name);
      if (role) tierRoleIds.set(i + 1, role.id);
    });
  };

  // Auto-provision any missing WoC tier roles (needs MANAGE_ROLES). Idempotent:
  // only creates the rungs not already present, then re-resolves the id map. If
  // the bot lacks permission this logs and the missing rungs are simply skipped.
  const ensureTierRoles = async (): Promise<void> => {
    const existing = new Set((await discord.guildRoles(cfg.guildId)).map((r) => r.name));
    const missing = allTierRoleNames()
      .map((name, i) => ({ name, index: i + 1 }))
      .filter((r) => !existing.has(r.name));
    for (const { name, index } of missing) {
      try {
        await discord.createGuildRole(cfg.guildId, name, tierRoleColor(index));
        console.log(`[bot] created status-tier role ${name}`);
      } catch (e) {
        console.error(`[bot] could not create role ${name} (need MANAGE_ROLES):`, e);
      }
    }
    if (missing.length) await refreshTierRoles();
  };

  await ensureTierRoles();
  await refreshTierRoles();

  // Resolve the staff/special role ids by name (every DISCORD_SPECIAL_ROLES
  // entry, staff and community alike, including catalog aliases so guild-side
  // renames keep matching), so each member's top special role can be pushed to
  // the game (name color + tag).
  const specialRoleIds = new Map<string, string>(); // role key -> guild role id
  const refreshSpecialRoles = async (): Promise<void> => {
    const roles = await discord.guildRoles(cfg.guildId);
    specialRoleIds.clear();
    for (const role of roles) {
      const def = specialRoleByName(role.name);
      // first match wins per key, mirroring Discord's top-down role order
      if (def && !specialRoleIds.has(def.key)) specialRoleIds.set(def.key, role.id);
    }
  };
  await refreshSpecialRoles();

  // The highest-priority special role a member holds, or null.
  const topSpecialRoleKey = (roleIds: readonly string[]): string | null => {
    const have = new Set(roleIds);
    let best: { key: string; priority: number } | null = null;
    for (const def of DISCORD_SPECIAL_ROLES) {
      const id = specialRoleIds.get(def.key);
      if (id && have.has(id) && (!best || def.priority > best.priority)) {
        best = { key: def.key, priority: def.priority };
      }
    }
    return best?.key ?? null;
  };

  // ── in-memory guild state (seeded by GUILD_CREATE, kept fresh by events) ─────
  const voiceStates = new Map<string, RawVoiceState>();
  const memberNames = new Map<string, string>();
  const memberRoles = new Map<string, string[]>();
  const memberJoined = new Map<string, number>(); // userId -> guild join epoch ms
  const onlineUsers = new Set<string>();
  let voiceChannelName: string | null = null; // resolved from GUILD_CREATE channels
  let memberTotal = 0; // total guild members (from GUILD_CREATE member_count)
  let announced = false; // guards the one-time startup announcement post
  const nameOf = (userId: string): string => memberNames.get(userId) ?? 'Member';

  let presenceTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePresencePush = (): void => {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      void pushPresence();
    }, PRESENCE_DEBOUNCE_MS);
  };
  const pushPresence = async (): Promise<void> => {
    const voice: VoiceMemberPush[] = cfg.voiceChannelId
      ? voiceMembersForChannel([...voiceStates.values()], cfg.voiceChannelId, nameOf)
      : [];
    await server.pushPresence({
      onlineCount: onlineUsers.size,
      memberTotal,
      voiceChannelName: cfg.voiceChannelId ? (voiceChannelName ?? 'Voice') : null,
      voice,
    });
  };

  // ── slash command handling ───────────────────────────────────────────────────
  const handleInteraction = async (d: Record<string, unknown>): Promise<void> => {
    // The relay "Respond" button is a link button (opens the game deep link), so it
    // never round-trips here; only APPLICATION_COMMANDs do.
    if (d.type !== 2) return;
    const data = (d.data ?? {}) as Record<string, unknown>;
    const name = String(data.name ?? '');
    if (!isSlashCommand(name)) return;
    const interactionId = String(d.id ?? '');
    const token = String(d.token ?? '');
    const member = (d.member ?? {}) as Record<string, unknown>;
    const user = (member.user ?? {}) as Record<string, unknown>;
    const userId = String(user.id ?? '');

    // /link needs no server round-trip, so reply immediately (ephemeral).
    if (name === 'link') {
      await discord.respondInteraction(interactionId, token, {
        content: buildLinkContent(cfg.gameUrl),
        flags: 64, // ephemeral
      });
      return;
    }
    // /whoami hits the game server, which can be slow, so DEFER first (acks within
    // Discord's 3s deadline) then edit the deferred reply.
    await discord.deferInteraction(interactionId, token, true /* ephemeral */);
    if (name === 'whoami') {
      const roles = (await server.roles(userId)) ?? {
        linked: false,
        statusTier: 0,
        points: 0,
        lifetimePoints: 0,
      };
      await discord.editOriginalResponse(cfg.clientId, token, {
        content: buildWhoamiContent(roles),
      });
    }
  };

  // ── role sync (poll the server for online linked members) ────────────────────
  const syncRolesFor = async (userId: string): Promise<void> => {
    // One flex read drives both the status-tier roles AND the level-on-name nick.
    const flex = await server.flex(userId);
    if (!flex?.linked) return;
    const { toAdd, toRemove } =
      tierRoleIds.size > 0
        ? computeRoleSync({
            tier: flex.statusTier,
            memberRoleIds: memberRoles.get(userId) ?? [],
            tierRoleIds,
          })
        : { toAdd: [] as string[], toRemove: [] as string[] };
    // Only update the cached role set when the Discord API call actually
    // succeeds, so a failed add/remove is retried on the next sync (not masked
    // by a cache that wrongly claims success).
    for (const roleId of toAdd) {
      try {
        await discord.addMemberRole(cfg.guildId, userId, roleId);
        memberRoles.set(userId, [...(memberRoles.get(userId) ?? []), roleId]);
      } catch (e) {
        console.error(e);
      }
    }
    for (const roleId of toRemove) {
      try {
        await discord.removeMemberRole(cfg.guildId, userId, roleId);
        memberRoles.set(
          userId,
          (memberRoles.get(userId) ?? []).filter((r) => r !== roleId),
        );
      } catch (e) {
        console.error(e);
      }
    }
    // Attach the in-game level + class icon to the member's Discord nickname
    // (built from the stable Discord handle so re-syncs don't compound).
    if (cfg.syncNicknames && flex.character) {
      const base = flex.username ?? memberNames.get(userId) ?? 'Member';
      const nick = buildLevelNick(base, flex.character.level, flex.character.class);
      await discord
        .setNickname(cfg.guildId, userId, nick)
        .catch((e) => console.error('[bot] setNickname failed', e));
    }
  };
  const syncAllOnlineRoles = async (): Promise<void> => {
    for (const userId of onlineUsers) await syncRolesFor(userId);
  };

  // ── gateway dispatch ─────────────────────────────────────────────────────────
  const gateway = new Gateway(cfg.token, await discord.gatewayUrl(), {
    onDispatch(type, d) {
      switch (type) {
        case 'GUILD_CREATE': {
          if (String(d.id ?? '') !== cfg.guildId) return;
          seedGuild(d);
          schedulePresencePush();
          // Sync tier roles for everyone online right away, so a freshly linked
          // member's role matches their points without waiting for the poll.
          void syncAllOnlineRoles().catch((e) => console.error(e));
          // Push member join dates + staff roles so the game shows member-since +
          // role color/tag for linked players.
          void pushAllMemberMeta().catch((e) => console.error(e));
          // One-time "bot online" announcement so the integration is visibly live.
          if (cfg.testChannelId && !announced) {
            announced = true;
            void discord
              .createMessage(cfg.testChannelId, {
                content: `:satellite: World of ClaudeCraft bot online and connected. Two-way sync active. Try \`/whoami\` or \`/link\`. Play at ${cfg.gameUrl}`,
              })
              .catch((e) => console.error('[bot] startup announce failed', e));
          }
          break;
        }
        case 'VOICE_STATE_UPDATE': {
          const userId = String(d.user_id ?? '');
          if (!userId) return;
          const channelId = typeof d.channel_id === 'string' ? d.channel_id : null;
          if (channelId === null) voiceStates.delete(userId);
          else {
            voiceStates.set(userId, { userId, channelId, selfMute: d.self_mute === true });
            grantDailyActive(userId); // joining voice counts as daily engagement
          }
          schedulePresencePush();
          break;
        }
        case 'PRESENCE_UPDATE': {
          const u = (d.user ?? {}) as Record<string, unknown>;
          const userId = String(u.id ?? '');
          if (!userId) return;
          if (d.status === 'offline' || d.status === undefined) onlineUsers.delete(userId);
          else onlineUsers.add(userId);
          schedulePresencePush();
          break;
        }
        case 'GUILD_MEMBER_ADD': {
          if (String(d.guild_id ?? '') !== cfg.guildId) return;
          const u = (d.user ?? {}) as Record<string, unknown>;
          const userId = String(u.id ?? '');
          if (!userId) return;
          memberNames.set(userId, displayNameOf(d, u));
          // Mark membership + grant the member reward (server dedupes). No channel
          // welcome message is posted (intentionally quiet).
          void server.setMember(userId, true);
          break;
        }
        case 'MESSAGE_CREATE': {
          // Chatting in the server is daily engagement (ignore bots/webhooks).
          if (String(d.guild_id ?? '') !== cfg.guildId) return;
          const author = (d.author ?? {}) as Record<string, unknown>;
          if (author.bot === true) return;
          grantDailyActive(String(author.id ?? ''));
          break;
        }
        case 'INTERACTION_CREATE':
          void handleInteraction(d).catch((e) => console.error('[bot] interaction error', e));
          break;
        default:
          break;
      }
    },
  });

  function seedGuild(d: Record<string, unknown>): void {
    if (typeof d.member_count === 'number') memberTotal = d.member_count;
    for (const ch of asArray(d.channels)) {
      if (String(ch.id ?? '') === cfg.voiceChannelId && typeof ch.name === 'string') {
        voiceChannelName = ch.name;
      }
    }
    for (const m of asArray(d.members)) {
      const u = (m.user ?? {}) as Record<string, unknown>;
      const id = String(u.id ?? '');
      if (!id) continue;
      memberNames.set(id, displayNameOf(m, u));
      memberRoles.set(id, asStringArray(m.roles));
      const joined = typeof m.joined_at === 'string' ? Date.parse(m.joined_at) : NaN;
      if (Number.isFinite(joined)) memberJoined.set(id, joined);
    }
    for (const v of asArray(d.voice_states)) {
      const id = String(v.user_id ?? '');
      const channelId = typeof v.channel_id === 'string' ? v.channel_id : null;
      if (id && channelId)
        voiceStates.set(id, { userId: id, channelId, selfMute: v.self_mute === true });
    }
    for (const p of asArray(d.presences)) {
      const u = (p.user ?? {}) as Record<string, unknown>;
      const id = String(u.id ?? '');
      if (id && p.status && p.status !== 'offline') onlineUsers.add(id);
    }
  }

  // Push every known member's guild join date + top special role to the game, so
  // linked players show "member since" + a colored role tag/name in world.
  const pushAllMemberMeta = async (): Promise<void> => {
    const members = [...memberRoles.entries()].slice(0, 1000).map(([id, roleIds]) => ({
      discord_user_id: id,
      name: memberNames.get(id) ?? null, // server nickname (nick > global > username)
      joinedAtMs: memberJoined.get(id) ?? null,
      role: topSpecialRoleKey(roleIds),
    }));
    if (members.length) await server.pushMembersMeta(members);
  };

  // Daily Discord-engagement reward: the first time a linked member posts a message
  // or joins voice each day, grant the daily-active points. Deduped here (per user
  // per day) AND server-side (the grant dedupe key), so it is exactly-once.
  const dailyActiveSeen = new Set<string>(); // `${userId}:${YYYY-MM-DD}`
  const grantDailyActive = (userId: string): void => {
    if (!userId) return;
    const day = new Date().toISOString().slice(0, 10);
    const key = `${userId}:${day}`;
    if (dailyActiveSeen.has(key)) return;
    dailyActiveSeen.add(key);
    const g = DISCORD_REWARD_GRANTS.dailyActive;
    void server
      .grant(userId, g.reason, g.points, `${g.reason}:${userId}:${day}`)
      .catch((e) => console.error('[bot] daily-active grant failed', e));
  };

  // Drain + deliver queued in-game "!" community posts (LFG etc.) to the relay
  // channel as rich embeds with a "respond in game" button.
  const pollRelay = async (): Promise<void> => {
    if (!cfg.relayChannelId) return;
    const items = await server.drainRelay();
    for (const item of items) {
      await discord
        .createMessage(cfg.relayChannelId, buildRelayMessage(item, cfg.gameUrl))
        .catch((e) => console.error('[bot] relay post failed', e));
    }
  };

  // Drain + post the significant-activity feed (level-ups, rare drops, duels, arena).
  const pollActivity = async (): Promise<void> => {
    if (!cfg.activityChannelId) return;
    const items = await server.drainActivity();
    for (const item of items) {
      await discord
        .createMessage(cfg.activityChannelId, buildActivityMessage(item))
        .catch((e) => console.error('[bot] activity post failed', e));
    }
  };

  let dailyRewardsChannelMissingLogged = false;
  const pollDailyRewardWinners = async (): Promise<void> => {
    if (!cfg.dailyRewardsChannelId) {
      if (!dailyRewardsChannelMissingLogged) {
        console.error(
          '[bot] missing DISCORD_DAILY_REWARDS_CHANNEL_ID; skipping daily rewards winner announcements',
        );
        dailyRewardsChannelMissingLogged = true;
      }
      return;
    }
    const days = await server.dailyRewardWinners();
    for (const day of days) {
      try {
        await discord.createMessage(cfg.dailyRewardsChannelId, buildDailyRewardWinnersMessage(day));
        await server.markDailyRewardWinners(day.day);
      } catch (e) {
        console.error('[bot] daily rewards winners post failed', e);
      }
    }
  };

  gateway.connect(false);
  setInterval(
    () => void syncAllOnlineRoles().catch((e) => console.error(e)),
    ROLE_SYNC_INTERVAL_MS,
  ).unref();
  setInterval(
    () => void refreshTierRoles().catch((e) => console.error(e)),
    ROLE_SYNC_INTERVAL_MS,
  ).unref();
  setInterval(() => void pollRelay().catch((e) => console.error(e)), RELAY_POLL_MS).unref();
  setInterval(() => void pollActivity().catch((e) => console.error(e)), RELAY_POLL_MS).unref();
  setInterval(
    () => void pollDailyRewardWinners().catch((e) => console.error(e)),
    RELAY_POLL_MS,
  ).unref();
  setInterval(() => {
    void refreshSpecialRoles()
      .then(() => pushAllMemberMeta())
      .catch((e) => console.error(e));
  }, ROLE_SYNC_INTERVAL_MS).unref();
  console.log('[bot] World of ClaudeCraft Discord bot started');
}

// ── small helpers ──────────────────────────────────────────────────────────────
function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function displayNameOf(member: Record<string, unknown>, user: Record<string, unknown>): string {
  const nick = typeof member.nick === 'string' ? member.nick : '';
  const global = typeof user.global_name === 'string' ? user.global_name : '';
  const username = typeof user.username === 'string' ? user.username : '';
  return nick || global || username || 'Member';
}

main().catch((err) => {
  console.error('[bot] fatal', err);
  process.exit(1);
});
