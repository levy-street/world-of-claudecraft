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

import { DISCORD_REWARD_GRANTS } from '../src/sim/discord_tier';
import { loadConfig } from './config';
import { DiscordApi, governorFromConfig } from './discord_api';
import { Gateway } from './gateway';
import { departedFromSeed, LinkedSweep, unappliedIdsFrom } from './linked_sweep';
import { writeHeartbeatFile } from './liveness';
import {
  allTierRoleNames,
  buildLinkContent,
  buildWhoamiContent,
  claimDailyActive,
  clearDepartedFlair,
  clearedMemberMeta,
  type DailyActiveState,
  GUILD_LARGE_THRESHOLD,
  indexSpecialRoleIds,
  interactionFailureFallback,
  isSlashCommand,
  type MemberMetaRecord,
  memberRolesFromPayload,
  type RawVoiceState,
  reconcileMemberRolesFromUpdate,
  rosterComplete,
  SLASH_COMMANDS,
  staleFlairedIds,
  tierRoleColor,
  topSpecialRoleKeyFor,
  voiceMembersForChannel,
} from './logic';
import {
  decideMemberUpdate,
  displayNameOf,
  forgetMember,
  fullResyncIfDue,
  nickOf,
  pushChangedMemberMeta,
  pushOneMemberMeta,
  pushRejected,
  refreshThenPushMeta,
} from './member_writes';
import { freshOutboxPollState, outboxIoFor, runOutboxPoll } from './outbox_consumer';
import { withPresenceCounters } from './presence_counters';
import { LoopScheduler } from './scheduler';
import { ServerClient, type VoiceMemberPush } from './server_client';
import { createSweepCycle } from './sweep_cycle';

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
  // The knob-to-governor mapping lives in the shell (`governorFromConfig`) so a
  // test can pin it: nothing in this file is reachable from a test, because
  // `main()` is called at module scope. `undefined` keeps the production fetch.
  const governor = governorFromConfig(cfg);
  const discord = new DiscordApi(cfg.token, undefined, governor);
  const server = new ServerClient(cfg.gameServerUrl, cfg.botSecret);
  // Every background loop and the presence debounce run on this one scheduler; the
  // tasks themselves are registered further down, next to the work they drive.
  const scheduler = new LoopScheduler();

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

  // Resolve the staff/special roles (every catalog entry, staff and community
  // alike, matched by name or alias so guild-side renames keep matching), so each
  // member's top special role can be pushed to the game (name color + tag). The
  // index maps guild role id -> special-role key: ALL matching ids are kept (both
  // an `Admin` and an `Admins` role map to key `admin`), so a holder of EITHER
  // resolves. Rebuilt on each refresh from the live guild roles.
  let specialRoleIndex = new Map<string, string>();
  const refreshSpecialRoles = async (): Promise<void> => {
    specialRoleIndex = indexSpecialRoleIds(await discord.guildRoles(cfg.guildId));
  };
  await refreshSpecialRoles();

  // The highest-priority special role a member holds, or null.
  const topSpecialRoleKey = (roleIds: readonly string[]): string | null =>
    topSpecialRoleKeyFor(roleIds, specialRoleIndex);

  // ── in-memory guild state (seeded by GUILD_CREATE, kept fresh by events) ─────
  const voiceStates = new Map<string, RawVoiceState>();
  const memberNames = new Map<string, string>();
  const memberRoles = new Map<string, string[]>();
  const memberJoined = new Map<string, number>(); // userId -> guild join epoch ms
  const onlineUsers = new Set<string>();
  // The member's RAW `nick` field, null when they have none. Deliberately not
  // memberNames: displayNameOf collapses nick, global_name and username into one
  // string, so it cannot tell "the nick is exactly X" from "there is no nick and
  // the global name happens to be X". The nickname PATCH's precondition is about
  // the nick field specifically, so the diff needs the field itself (D5).
  const memberNicks = new Map<string, string | null>();
  // The nick this bot last successfully PATCHed, per member. Only used to
  // recognize our own GUILD_MEMBER_UPDATE echo coming back.
  const lastWrittenNick = new Map<string, string>();
  // The members-meta record we last successfully PUSHED, per member. Written only
  // after the server accepted it, so a failed push retries on the next sweep.
  const lastPushedMeta = new Map<string, MemberMetaRecord>();
  // Who is believed to have a linked game account, and how far the current sweep
  // pass has got. The sweep reads THIS rather than onlineUsers: an online member
  // with no linked account can never produce a role or nickname write, and a
  // linked member who is offline in Discord still needs one when their level
  // moves. Every belief in it is fed from outside (the link-change feed, the
  // flex-batch echo, the members-meta linkage signal), so the module itself
  // stays pure and the wiring below is the only thing that talks to the network.
  const linkedSweep = new LinkedSweep();
  // The member ids observed during the CURRENT seed session: a small guild's
  // GUILD_CREATE, or a large guild's GUILD_CREATE plus every op 8 chunk, plus
  // anyone who joined while that was streaming. Diffed against the caches once
  // the seed is complete, which is the only way a member who left while the
  // gateway was down is ever evicted (L16).
  const seedSessionIds = new Set<string>();
  // When that cache was last thrown away wholesale. It has to be, periodically:
  // the cache records what the bot believes the server holds, and the server can
  // lose those values with nothing to tell the bot (see dueForFullResync).
  let lastFullMetaResyncMs = Date.now();
  // The three caches a nickname write reads and, on success only, updates.
  const nickCaches = { memberNicks, memberNames, lastWrittenNick };
  const metaIo = {
    pushMembersMeta: (records: MemberMetaRecord[]) => server.pushMembersMeta(records),
    // A members-meta push the bot was making anyway reports which of the ids it
    // accepted had NO link row, which decides linkage for every id in the batch
    // at no extra request. On the hourly full resync the batch is the whole
    // roster, so that is a complete reconciliation of the sweep's member set.
    // A response that does not carry the field at all decides nothing
    // (unappliedIdsFrom answers undefined), never "all of them are linked".
    onBatchOutcome: (batchIds: string[], result: unknown) => {
      linkedSweep.applyMetaPushOutcome(batchIds, unappliedIdsFrom(result));
    },
  };
  let voiceChannelName: string | null = null; // resolved from GUILD_CREATE channels
  let memberTotal = 0; // total guild members (from GUILD_CREATE member_count)
  let announced = false; // guards the one-time startup announcement post
  const nameOf = (userId: string): string => memberNames.get(userId) ?? 'Member';

  // Upsert one member (from a GUILD_CREATE member, a GUILD_MEMBER_ADD, or a
  // GUILD_MEMBERS_CHUNK entry) into the name/role/join caches. Returns the user
  // id, or '' when the payload has no user id.
  const upsertMemberFromPayload = (m: Record<string, unknown>): string => {
    const u = (m.user ?? {}) as Record<string, unknown>;
    const id = String(u.id ?? '');
    if (!id) return '';
    memberNames.set(id, displayNameOf(m, u));
    memberNicks.set(id, nickOf(m));
    memberRoles.set(id, memberRolesFromPayload(m));
    const joined = typeof m.joined_at === 'string' ? Date.parse(m.joined_at) : NaN;
    if (Number.isFinite(joined)) memberJoined.set(id, joined);
    return id;
  };

  // The presence push is debounced on the scheduler (a `debounce` task runs one
  // full window after the first kick and folds every kick in that window into it),
  // so this is now just the kick. The task itself is registered below, beside the
  // poll loops, because that is where every cadence in this file lives.
  const schedulePresencePush = (): void => {
    presenceTask.kick();
  };
  const pushPresence = async (): Promise<void> => {
    const voice: VoiceMemberPush[] = cfg.voiceChannelId
      ? voiceMembersForChannel([...voiceStates.values()], cfg.voiceChannelId, nameOf)
      : [];
    // The governor's counters ride this push rather than a loop of their own,
    // and `withPresenceCounters` is what makes that free: a snapshot it cannot
    // read is simply absent from the body, never a failed presence push.
    await server.pushPresence(
      withPresenceCounters(
        {
          onlineCount: onlineUsers.size,
          memberTotal,
          voiceChannelName: cfg.voiceChannelId ? (voiceChannelName ?? 'Voice') : null,
          voice,
        },
        () => discord.counters(),
      ),
    );
  };
  // A `debounce` task, which is the presenceTimer guard this replaces expressed on
  // the scheduler: the first kick opens one window, every kick inside it folds in,
  // and the push runs once at the end. The scheduler adds what the raw timer had
  // no notion of, an overlap guard, so a burst arriving during a slow push can no
  // longer start a second one beside it.
  const presenceTask = scheduler.add({
    name: 'presence-push',
    mode: 'debounce',
    cadence: { activeMs: cfg.presenceDebounceMs },
    run: () => pushPresence(),
  });

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

    // `acknowledged` tracks whether the interaction's ONE allowed initial
    // response has actually landed, so a failure below knows which of the two
    // fallback shapes still reaches the player (interactionFailureFallback).
    let acknowledged = false;
    try {
      // /link needs no server round-trip, so reply immediately (ephemeral).
      if (name === 'link') {
        await discord.respondInteraction(interactionId, token, {
          content: buildLinkContent(cfg.gameUrl),
          flags: 64, // ephemeral
        });
        return;
      }
      // /whoami hits the game server, which can be slow, so DEFER first (acks
      // within Discord's 3s deadline) then edit the deferred reply.
      await discord.deferInteraction(interactionId, token, true /* ephemeral */);
      acknowledged = true;
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
    } catch (e) {
      console.error('[bot] interaction error', e);
      // Best-effort: tell the player something broke rather than leaving
      // Discord's "Bot is thinking..." placeholder (or a bare failure) up
      // until Discord's own webhook-token timeout. A second failure here is
      // only logged; there is no further fallback to reach for.
      const fallback = interactionFailureFallback(acknowledged);
      try {
        if (fallback.via === 'respond') {
          await discord.respondInteraction(interactionId, token, {
            content: fallback.content,
            flags: 64, // ephemeral
          });
        } else {
          await discord.editOriginalResponse(cfg.clientId, token, { content: fallback.content });
        }
      } catch (e2) {
        console.error('[bot] interaction fallback failed', e2);
      }
    }
  };

  // ── role sync (one paced slice of the linked-member set at a time) ───────────
  // The cycle itself lives in bot/sweep_cycle.ts so the composed-behavior suite
  // drives the production unit; this is only the binding. Everything passed is
  // either a boot-time config value or a LIVE reference the gateway handlers
  // keep writing (tierRoleIds, memberRoles, nickCaches, lastPushedMeta), and
  // the three Discord writes carry the guild id here so the cycle never needs
  // the config. pushMemberMeta is a thunk because its const is declared below;
  // the cycle only calls it at run time, long after boot finishes wiring.
  const { runSweepSlice } = createSweepCycle({
    linkedSweep,
    now: () => Date.now(),
    sliceSize: cfg.sweepSliceSize,
    passIntervalMs: cfg.roleSyncIntervalMs,
    syncNicknames: cfg.syncNicknames,
    tierRoleIds,
    memberRoles,
    nickCaches,
    lastPushedMeta,
    discord: {
      addMemberRole: (userId, roleId) => discord.addMemberRole(cfg.guildId, userId, roleId),
      removeMemberRole: (userId, roleId) => discord.removeMemberRole(cfg.guildId, userId, roleId),
      setNickname: (userId, nick) => discord.setNickname(cfg.guildId, userId, nick),
    },
    flexBatch: (ids) => server.flexBatch(ids),
    pushMemberMeta: (userId) => pushMemberMeta(userId),
    onError: (message, error) => console.error(message, error),
  });

  // ── gateway dispatch ─────────────────────────────────────────────────────────
  const gateway = new Gateway(cfg.token, await discord.gatewayUrl(), {
    onDispatch(type, d) {
      switch (type) {
        case 'GUILD_CREATE': {
          if (String(d.id ?? '') !== cfg.guildId) return;
          seedGuild(d);
          // Guilds larger than large_threshold omit offline members from
          // GUILD_CREATE; backfill the full member list (op 8) so offline holders
          // of a special role (e.g. Admins) are known. Chunks arrive as
          // GUILD_MEMBERS_CHUNK dispatches, which re-push member meta and run the
          // departed-member reconcile when done. A small guild's GUILD_CREATE is
          // already the complete roster, so it reconciles right away.
          if (memberTotal > GUILD_LARGE_THRESHOLD) gateway.requestGuildMembers(cfg.guildId);
          else void completeSeed().catch((e) => console.error(e));
          schedulePresencePush();
          // Sync tier roles for everyone online right away, so a freshly linked
          // member's role matches their points without waiting for the poll, and
          // push member join dates + staff roles so the game shows member-since +
          // role color/tag for linked players.
          //
          // Both are KICKS rather than bare calls now, which is the GUILD_CREATE
          // trap: Discord re-sends GUILD_CREATE on every re-IDENTIFY, so a
          // reconnect storm delivers a burst of them, and a burst of fire-and-
          // forget sweeps is how a blip became a sustained storm. Kicks against an
          // in-flight sweep collapse into exactly one follow-up.
          //
          // The sweep's kick is preceded by a requestPass, because a kick alone
          // only wakes the task EARLY: it would find the pass window still open
          // and hand back no work at all, which is exactly backwards on the one
          // event that means the bot's view of the guild may be stale.
          linkedSweep.requestPass();
          roleSyncTask.kick();
          memberMetaTask.kick();
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
          // Cache the joiner's name, roles, and join date so their flair resolves
          // and their meta can be pushed without waiting for a restart/re-seed.
          const userId = upsertMemberFromPayload(d);
          if (!userId) return;
          // A joiner counts as observed by the seed session in flight. Without
          // this, someone who joins DURING a large guild's op 8 backfill is in
          // the caches but not in the seed, and the completeness diff below
          // would read them as departed and evict them the moment the last
          // chunk lands.
          seedSessionIds.add(userId);
          // Mark membership + grant the member reward (server dedupes). No channel
          // welcome message is posted (intentionally quiet).
          void server.setMember(userId, true);
          void pushMemberMeta(userId).catch((e) => console.error(e));
          break;
        }
        case 'GUILD_MEMBER_UPDATE': {
          // A member's roles changed live (e.g. the Admins role was granted).
          // Replace the cached role set and re-push their meta so the new flair
          // shows in game without a bot restart or the periodic re-seed.
          if (String(d.guild_id ?? '') !== cfg.guildId) return;
          const u = (d.user ?? {}) as Record<string, unknown>;
          const userId = String(u.id ?? '');
          if (!userId) return;
          // Judged BEFORE the caches move, which is why the decision is computed
          // in one place rather than inline: the question is whether this update
          // tells us anything we did not already write ourselves (D5), and that
          // is only answerable against the OLD cached roles.
          const decision = decideMemberUpdate(
            d,
            u,
            { roles: memberRoles.get(userId) ?? [], lastWrittenNick: lastWrittenNick.get(userId) },
            { roles: reconcileMemberRolesFromUpdate, displayName: displayNameOf },
          );
          if (decision.roles) memberRoles.set(userId, decision.roles);
          // The update may also carry a changed nick/global_name.
          memberNames.set(userId, decision.displayName);
          memberNicks.set(userId, decision.nick);
          // One PATCH produces one echo, so the record of what we wrote is spent
          // once it has suppressed that echo. Holding it would let a later
          // third-party rename BACK to the same value be dropped as ours.
          if (decision.forgetWrittenNick) lastWrittenNick.delete(userId);
          if (!decision.push) break;
          void pushMemberMeta(userId).catch((e) => console.error(e));
          break;
        }
        case 'GUILD_MEMBER_REMOVE': {
          // A member left (or was removed). Clear their server-side membership flag
          // and stored flair (guildMember: false + a null-role meta record) so
          // their in-game verified/staff tag is dropped promptly, THEN drop them
          // from every in-memory cache.
          if (String(d.guild_id ?? '') !== cfg.guildId) return;
          const u = (d.user ?? {}) as Record<string, unknown>;
          const userId = String(u.id ?? '');
          if (!userId) return;
          void server.setMember(userId, false);
          // A cleared record IS a change, so this push is unconditional: the diff
          // above must never suppress it.
          //
          // The RESULT is the only failure signal there is. server_client answers
          // null for a non-ok response or a transport error rather than throwing,
          // so a bare .catch here could only ever fire for something that does not
          // happen, and a failed clear would leave a departed member's staff tag
          // showing in world with nothing said about it. The flaired-ids reconcile
          // repairs it on the next complete roster seed; the log is what makes the
          // gap between the two visible.
          void server
            .pushMembersMeta([clearedMemberMeta(userId)])
            .then((result) => {
              if (pushRejected(result)) {
                console.error('[bot] clear member meta refused for', userId);
              }
            })
            .catch((e) => console.error('[bot] clear member meta failed', e));
          memberRoles.delete(userId);
          memberNames.delete(userId);
          memberJoined.delete(userId);
          voiceStates.delete(userId);
          onlineUsers.delete(userId);
          // Drop the diff caches too, or a member who leaves and rejoins would be
          // compared against their pre-departure record and never re-pushed.
          forgetMember(nickCaches, lastPushedMeta, userId);
          // And the sweep stops asking about them NOW, not at the next complete
          // seed: departure does not delete the link row, so flex-batch keeps
          // answering for them, and every pass until a reconnect would spend a
          // slice slot plus a doomed 404 role write and nickname PATCH on a
          // member the guild no longer has.
          linkedSweep.forget(userId);
          break;
        }
        case 'GUILD_MEMBERS_CHUNK': {
          // Backfill response to REQUEST_GUILD_MEMBERS (op 8): each chunk carries a
          // batch of members (incl. offline). Upsert them, apply any presences,
          // then push everyone's meta after the final chunk.
          if (String(d.guild_id ?? '') !== cfg.guildId) return;
          for (const m of asArray(d.members)) {
            const id = upsertMemberFromPayload(m);
            if (id) seedSessionIds.add(id);
          }
          for (const p of asArray(d.presences)) {
            const pu = (p.user ?? {}) as Record<string, unknown>;
            const pid = String(pu.id ?? '');
            if (!pid) continue;
            if (p.status && p.status !== 'offline') onlineUsers.add(pid);
            else onlineUsers.delete(pid);
          }
          const idx = typeof d.chunk_index === 'number' ? d.chunk_index : 0;
          const count = typeof d.chunk_count === 'number' ? d.chunk_count : 1;
          if (idx >= count - 1) {
            // Same coalescing reason as GUILD_CREATE: a reconnect re-runs the whole
            // op 8 backfill, so the final chunk arrives once per reconnect.
            memberMetaTask.kick();
            void completeSeed().catch((e) => console.error(e));
          }
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
    // A GUILD_CREATE opens a new seed session, so the accumulator starts empty:
    // it has to describe THIS seed alone, or a member who left between two
    // reconnects would still be counted as observed and never evicted.
    seedSessionIds.clear();
    if (typeof d.member_count === 'number') memberTotal = d.member_count;
    for (const ch of asArray(d.channels)) {
      if (String(ch.id ?? '') === cfg.voiceChannelId && typeof ch.name === 'string') {
        voiceChannelName = ch.name;
      }
    }
    for (const m of asArray(d.members)) {
      const id = upsertMemberFromPayload(m);
      if (id) seedSessionIds.add(id);
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

  // One members-meta record: nickname + guild join date + top special role.
  const memberMetaRecord = (id: string) => ({
    discord_user_id: id,
    name: memberNames.get(id) ?? null, // server nickname (nick > global > username)
    joinedAtMs: memberJoined.get(id) ?? null,
    role: topSpecialRoleKey(memberRoles.get(id) ?? []),
  });

  // Push every known member's guild join date + top special role to the game, so
  // linked players show "member since" + a colored role tag/name in world. The
  // server caps each request, so batch the full roster into successive requests
  // (a large-guild backfill streams well past a single cap; capping the total
  // would leave every member past the cutoff without meta).
  const pushAllMemberMeta = async (): Promise<void> => {
    // D5: only members whose record actually moved since the last SUCCESSFUL push.
    // In steady state that is nobody, so a sweep sends no request at all; the
    // byte-batching still applies to whatever is left.
    await pushChangedMemberMeta(
      [...memberRoles.keys()].map(memberMetaRecord),
      lastPushedMeta,
      metaIo,
    );
  };

  // Push a single member's meta (used when a live role change re-resolves their
  // flair), so a role grant/removal reflects in game without waiting for the poll.
  const pushMemberMeta = async (id: string): Promise<void> => {
    if (!id || !memberRoles.has(id)) return;
    await pushOneMemberMeta(memberMetaRecord(id), lastPushedMeta, metaIo);
  };

  // Members who left while the bot was OFFLINE never fire GUILD_MEMBER_REMOVE,
  // so their stored membership flag + role key would stay stale forever. After a
  // COMPLETE roster seed (small-guild GUILD_CREATE, or the final op 8 chunk),
  // diff the server's flagged ids against the live roster and clear exactly the
  // departed ones (clearDepartedFlair owns the ordering, batching, and the
  // re-observed-member skip; it is unit-tested with fake IO). A server fetch
  // failure (null) changes nothing.
  const reconcileDepartedMembers = async (): Promise<void> => {
    if (!rosterComplete(memberRoles.size, memberTotal)) return;
    const flagged = await server.flairedIds();
    if (!flagged) return;
    const stale = staleFlairedIds(flagged, new Set(memberRoles.keys()));
    await clearDepartedFlair(stale, (id) => memberRoles.has(id), {
      // Same rejoin reasoning as GUILD_MEMBER_REMOVE: once a member's stored flair
      // is cleared, their last-pushed record no longer describes server state, so
      // it must not be left behind to suppress a later push.
      pushMembersMeta: async (records) => {
        const pushed = await server.pushMembersMeta(records);
        for (const record of records) {
          forgetMember(nickCaches, lastPushedMeta, record.discord_user_id);
        }
        return pushed;
      },
      setMember: (id, guildMember) => server.setMember(id, guildMember),
    });
  };

  /**
   * Everything a finished roster seed has to settle, in the order it has to
   * settle in. Called from BOTH completion sites: a small guild's GUILD_CREATE
   * is already the whole roster, and a large guild's is complete only once the
   * final op 8 chunk has landed.
   *
   * The eviction is ledger item L16. Nothing ever removed a member from the
   * per-member maps except GUILD_MEMBER_REMOVE, which does not fire for someone
   * who left while the gateway was down, so their name, roles, join date and
   * presence stayed cached for the life of the process: a slow leak, a member
   * the sweep kept trying to write to, and, because the departed-flair reconcile
   * diffs the server's flagged ids against those same maps, a departed member
   * who could never be recognized as departed. Evicting first is what makes the
   * reconcile below see an honest roster.
   *
   * It is gated on COMPLETENESS for the reason `rosterComplete` exists: diffing
   * a partial seed would read merely-unseeded members as departed and evict the
   * live roster. Discovery is armed either way, because the linked set is empty
   * at boot and a bot that never discovers anyone never syncs anyone, which
   * would be a worse failure than a late prune.
   */
  const completeSeed = async (): Promise<void> => {
    if (rosterComplete(seedSessionIds.size, memberTotal)) {
      // The diff runs over the UNION of every per-member cache, not just
      // memberRoles: a presence or voice event can seed onlineUsers or
      // voiceStates with an id that never got a member upsert, and an id only
      // ever diffed against memberRoles would ghost there forever. Any live
      // member is in seedSessionIds, so over-inclusion evicts nothing real.
      // (dailyActive.seen is the one deliberate exclusion: it empties itself on
      // the day rollover, and the server-side grant dedupe key makes a rejoin
      // grant a no-op, so evicting it here would add risk for no leak.)
      const cachedIds = new Set<string>([
        ...memberRoles.keys(),
        ...memberNames.keys(),
        ...memberJoined.keys(),
        ...onlineUsers,
        ...voiceStates.keys(),
        ...nickCaches.memberNicks.keys(),
        ...nickCaches.lastWrittenNick.keys(),
        ...lastPushedMeta.keys(),
      ]);
      for (const id of departedFromSeed(cachedIds, seedSessionIds)) {
        memberNames.delete(id);
        memberRoles.delete(id);
        memberJoined.delete(id);
        voiceStates.delete(id);
        onlineUsers.delete(id);
        forgetMember(nickCaches, lastPushedMeta, id);
      }
      linkedSweep.pruneToRoster(new Set(memberRoles.keys()));
    }
    // One discovery per complete seed, never on a timer: a periodic full-roster
    // rescan is the cost this phase removed. armDiscovery is idempotent while
    // one is outstanding, which matters because Discord re-sends GUILD_CREATE on
    // every re-IDENTIFY, so a reconnect storm reaches here repeatedly.
    linkedSweep.armDiscovery(memberRoles.keys());
    roleSyncTask.kick();
    await reconcileDepartedMembers();
  };

  // Daily Discord-engagement reward: the first time a linked member posts a message
  // or joins voice each day, grant the daily-active points. Deduped here (per user
  // per day) AND server-side (the grant dedupe key), so it is exactly-once.
  // Bot-side dedupe, emptied on the day rollover by claimDailyActive so it does
  // not accumulate an entry per member per day for the life of the process.
  const dailyActive: DailyActiveState = { seen: new Set<string>(), day: '' };
  const grantDailyActive = (userId: string): void => {
    if (!userId) return;
    const day = new Date().toISOString().slice(0, 10);
    if (!claimDailyActive(dailyActive, day, userId)) return;
    const g = DISCORD_REWARD_GRANTS.dailyActive;
    void server
      .grant(userId, g.reason, g.points, `${g.reason}:${userId}:${day}`)
      .catch((e) => console.error('[bot] daily-active grant failed', e));
  };

  // Everything the consolidated outbox poll needs, bound once: which channel each
  // stream posts to, which builder shapes it, and what a link-change item does to
  // the sweep. Every DECISION lives in bot/outbox_consumer.ts, where a test can
  // reach it; this is only the binding.
  //
  // The three poll loops this replaces (relay, activity, daily-rewards winners)
  // each ran their own timer and their own request against a server that usually
  // had nothing for any of them. One request now answers all three, plus the
  // link-change feed that tells the sweep which members actually moved, which is
  // what let the periodic full-roster rescan go.
  const outboxIo = outboxIoFor({
    createMessage: (channelId, payload) => discord.createMessage(channelId, payload),
    markDailyRewardWinners: (day) => server.markDailyRewardWinners(day),
    channels: {
      relay: cfg.relayChannelId,
      activity: cfg.activityChannelId,
      dailyRewards: cfg.dailyRewardsChannelId,
    },
    gameUrl: cfg.gameUrl,
    // Read fresh per run, never captured: the gate exists to notice the breaker
    // opening between polls.
    breakerState: () => governor.snapshot().breakerState,
    drain: () => server.drainOutbox(cfg.outboxTimeoutMs),
    applyLinkChanges: (items) => {
      // The roster check gates every ADDITION: an id that is not in the guild
      // cannot be flaired, and adding it would put a permanent member in the
      // pass that no removal path can reach.
      const summary = linkedSweep.applyLinkChangeItems(items, (id) => memberRoles.has(id));
      // A fresh or re-pointed link row carries null meta columns, so the record
      // the bot believes it pushed for these ids describes a row that no longer
      // exists; leaving it cached would suppress their join date and staff flair
      // until the hourly resync.
      for (const id of summary.metaStale) lastPushedMeta.delete(id);
      // Dirty-queue work is served ahead of the pass (bounded: dirty and
      // pass-shaped work, pending or in flight, alternate slices, so a busy
      // feed cannot starve the pass), so this kick syncs a changed member
      // within a tick or two instead of at the next pass window. It is deliberately NOT a
      // requestPass: the feed named exactly who moved, and a whole pass over
      // everyone is not what one member's points change asks for.
      if (summary.added.length || summary.removed.length || summary.dirtied.length) {
        roleSyncTask.kick();
      }
    },
    onError: (e, where) => console.error(`[bot] outbox ${where} post failed`, e),
    onMissingChannel: (channel) =>
      console.error(`[bot] no channel id configured for the outbox ${channel} stream; skipping it`),
  });

  // ── background loops ─────────────────────────────────────────────────────────
  // Every cadence in this file lives here, on one scheduler. These were six bare
  // repeating timers, which fire on a fixed rhythm whether or not the previous run
  // has finished: once a sweep ran long the next started anyway, the two contended
  // for the same Discord buckets, and a slow minute became a storm that outlived
  // restarts. The scheduler chains each delay after the previous run SETTLES, so
  // overlap is impossible by construction, and jitters them so loops armed in one
  // boot do not stay phase-locked on the same tick.
  //
  // The intervals are D13 env-overridable, and the special-roles refresh still
  // runs immediately before the roster push rather than beside it.
  // The sweep is one of the two tasks with a real ACTIVE-to-IDLE spread (the
  // outbox poll below is the other), and its two numbers mean different things.
  // `activeMs` paces the slices INSIDE a pass:
  // every slice reports work, so the cadence stays there for as long as the pass
  // has ids left. `idleMs` is the pass interval itself: once the pass drains,
  // each empty run decays the delay toward it, so between passes the task costs
  // a wake every few minutes that does no IO at all. The window is a floor
  // rather than a deadline, since a pass can only start on a wake: the decayed
  // delay means the next one opens at the first wake at or after the window,
  // and GUILD_CREATE's requestPass is what makes a reconnect skip the wait.
  const roleSyncTask = scheduler.add({
    name: 'role-sync',
    cadence: { activeMs: cfg.sweepSliceMs, idleMs: cfg.roleSyncIntervalMs },
    run: () => runSweepSlice(),
  });
  scheduler.add({
    name: 'tier-roles',
    cadence: { activeMs: cfg.roleSyncIntervalMs },
    run: () => refreshTierRoles(),
  });
  // The liveness stamp (D15). It is a scheduler task rather than a timer of its
  // own so that it proves something, and precisely this much: the file's mtime
  // advances only while the process, its event loop, and the scheduler's
  // timer-arming machinery are alive. It does NOT prove the sibling tasks are
  // healthy: each task chains independently, so one loop wedged on a run that
  // never settles (ledger L10) leaves this stamp advancing and the healthcheck
  // green; the structural defense there is the IO deadlines both shells carry,
  // not this file. A failed write is logged and the run still settles, so an
  // unwritable path degrades the healthcheck rather than taking the bot down
  // with it.
  scheduler.add({
    name: 'heartbeat-file',
    cadence: { activeMs: cfg.heartbeatIntervalMs },
    run: () => writeHeartbeatFile(cfg.heartbeatFile),
  });
  // The one pickup loop. `activeMs` is what the three 3 s pollers it replaces
  // each ran at, so a busy bot delivers exactly as promptly as before; every
  // empty drain then decays the delay toward `idleMs`, and the first item to
  // arrive snaps it straight back, so the quiet-hours saving costs no latency.
  // ONE state for the task's lifetime: the announced-days memo only suppresses
  // duplicate winner announcements if it survives from poll to poll.
  const outboxState = freshOutboxPollState();
  scheduler.add({
    name: 'outbox',
    cadence: { activeMs: cfg.outboxPollMs, idleMs: cfg.outboxIdleMs },
    run: () => runOutboxPoll(outboxIo, outboxState),
  });
  const memberMetaTask = scheduler.add({
    name: 'special-roles-and-meta',
    cadence: { activeMs: cfg.roleSyncIntervalMs },
    // The pairing is the point, and it is ordered: the roster push reads the
    // special-role index the refresh rebuilds, so a push that ran first would
    // publish the PREVIOUS sweep's role flair.
    //
    // A FAILED refresh must not take the push with it, though. The old 5 minute
    // timer chained the two and did drop the push on a failed refresh, but the
    // GUILD_CREATE and member-backfill paths called pushAllMemberMeta DIRECTLY,
    // with no refresh in front of it at all. Routing those kicks through this one
    // task gave them a Discord REST call as a precondition they never had, and
    // the reconnect storm this packet exists for is exactly when that call fails:
    // the breaker opens, the guild-roles GET throws, and the members-meta push
    // that would still have landed before never happens. Catching keeps the
    // ordering when the refresh works and publishes the previous index when it
    // does not, which is strictly more than the event paths ever had.
    run: async () => {
      // Bound how long the diff cache may keep believing the server still holds
      // what the bot last pushed. dueForFullResync's header lists the ways that
      // belief goes stale with nothing to correct it.
      lastFullMetaResyncMs = fullResyncIfDue(lastFullMetaResyncMs, Date.now(), lastPushedMeta);
      await refreshThenPushMeta({
        refresh: refreshSpecialRoles,
        push: pushAllMemberMeta,
        onRefreshError: (e) =>
          console.error(
            '[bot] special roles refresh failed; pushing meta with the previous index',
            e,
          ),
      });
    },
  });

  // Tasks go live BEFORE the socket does. A kick on a task that has not started
  // is dropped by design (it would be a one-off run with no chain behind it), and
  // the gateway's first GUILD_CREATE arrives through a dispatch handler that kicks
  // two of them. Nothing can dispatch synchronously inside connect(), so the other
  // order happens to work today, but only by accident, and the accident is exactly
  // the reconnect-storm path this phase cares about.
  scheduler.startAll();
  gateway.connect(false);
  console.log('[bot] World of ClaudeCraft Discord bot started');
}

// ── small helpers ──────────────────────────────────────────────────────────────
function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

main().catch((err) => {
  console.error('[bot] fatal', err);
  process.exit(1);
});
