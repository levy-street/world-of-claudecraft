// Pure (IO-free) logic for the World of ClaudeCraft Discord bot: Gateway intents,
// slash-command definitions + routing, role-sync diffing, embed/message building,
// and voice-presence shaping. Kept separate from the ws/fetch IO (gateway.ts,
// discord_api.ts, server_client.ts) so it is unit-tested without a network. This
// is the same pure/IO split the server uses (wallet_link.ts vs wallet.ts).
import { DISCORD_STATUS_DEFS, discordStatusByIndex } from '../src/sim/discord_tier';

// ── Gateway ──────────────────────────────────────────────────────────────────
// Intents we need: guild metadata, members (privileged), voice states (who is in
// a voice room), presences (privileged; for the online count).
export const GATEWAY_INTENTS =
  (1 << 0) | // GUILDS
  (1 << 1) | // GUILD_MEMBERS (privileged)
  (1 << 7) | // GUILD_VOICE_STATES
  (1 << 8) | // GUILD_PRESENCES (privileged)
  (1 << 9); // GUILD_MESSAGES (message events for daily-active engagement; not content)

export const GATEWAY_OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

/** Heartbeat interval from a HELLO payload (ms), defaulting to 41.25s. */
export function heartbeatIntervalMs(hello: unknown): number {
  const d = (
    hello && typeof hello === 'object' ? (hello as Record<string, unknown>).d : null
  ) as Record<string, unknown> | null;
  const interval = d && typeof d.heartbeat_interval === 'number' ? d.heartbeat_interval : 41250;
  return Math.max(1000, interval);
}

export function identifyPayload(token: string): Record<string, unknown> {
  return {
    op: GATEWAY_OP.IDENTIFY,
    d: {
      token,
      intents: GATEWAY_INTENTS,
      properties: { os: 'linux', browser: 'woc-bot', device: 'woc-bot' },
    },
  };
}

export function resumePayload(
  token: string,
  sessionId: string,
  seq: number | null,
): Record<string, unknown> {
  return { op: GATEWAY_OP.RESUME, d: { token, session_id: sessionId, seq } };
}

// ── Slash commands ───────────────────────────────────────────────────────────
export const SLASH_COMMANDS = [
  { name: 'whoami', description: 'Show your World of ClaudeCraft link status and reward points' },
  { name: 'link', description: 'Get the link to connect your Discord to World of ClaudeCraft' },
] as const;

export type SlashCommandName = (typeof SLASH_COMMANDS)[number]['name'];

export function isSlashCommand(name: string): name is SlashCommandName {
  return SLASH_COMMANDS.some((c) => c.name === name);
}

// ── Status-tier roles ────────────────────────────────────────────────────────
/** Discord role name for a status rung (1-8), e.g. "WoC Champion". */
export function tierRoleName(tierIndex: number): string | null {
  const def = discordStatusByIndex(tierIndex);
  return def ? `WoC ${capitalize(def.key)}` : null;
}

/** All status-rung role names (for resolving/creating guild roles). */
export function allTierRoleNames(): string[] {
  return DISCORD_STATUS_DEFS.map((d) => `WoC ${capitalize(d.key)}`);
}

// Role colors per rung (24-bit RGB ints), climbing grey -> blurple -> gold so the
// ladder reads at a glance. Indexed 1..8; used when auto-creating the roles.
const TIER_ROLE_COLORS: Record<number, number> = {
  1: 0x99aab5, // initiate  - grey
  2: 0x57f287, // squire    - green
  3: 0x3ba55d, // footman   - deep green
  4: 0x5865f2, // knight    - blurple
  5: 0x9b59b6, // champion  - purple
  6: 0xe67e22, // warlord   - orange
  7: 0xe91e63, // legend    - magenta
  8: 0xf1c40f, // mythic    - gold
};

/** Suggested role color for a status rung (1-8); 0 when out of range. */
export function tierRoleColor(tierIndex: number): number {
  return TIER_ROLE_COLORS[tierIndex] ?? 0;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Diff a member's current roles against the single role they should hold for
 * their status tier. They keep exactly the role for their current rung (tier >= 1)
 * and shed every other WoC-tier role. `tierRoleIds` maps a rung index to its
 * resolved guild role id. Pure so role sync is testable without the Discord API.
 */
export function computeRoleSync(opts: {
  tier: number;
  memberRoleIds: readonly string[];
  tierRoleIds: ReadonlyMap<number, string>;
}): { toAdd: string[]; toRemove: string[] } {
  const { tier, memberRoleIds, tierRoleIds } = opts;
  const desired = tier >= 1 ? (tierRoleIds.get(tier) ?? null) : null;
  const allTierRoleIds = new Set(tierRoleIds.values());
  const have = new Set(memberRoleIds);
  const toAdd = desired && !have.has(desired) ? [desired] : [];
  const toRemove = [...have].filter((id) => allTierRoleIds.has(id) && id !== desired);
  return { toAdd, toRemove };
}

// ── Level-on-name (Discord nickname) ─────────────────────────────────────────
// A class "icon" + the in-game level attached to the member's Discord name, so a
// linked player's level shows next to their name in the server (e.g. "Aldric ⚔20").
const CLASS_EMOJI: Record<string, string> = {
  warrior: '⚔',
  paladin: '🛡',
  hunter: '🏹',
  rogue: '🗡',
  priest: '✨',
  mage: '🔮',
  warlock: '😈',
  shaman: '⚡',
  druid: '🌿',
  gunner: '🔫',
};

export const NICK_MAX = 32; // Discord server-nickname length limit

export function levelNickSuffix(level: number, className: string): string {
  const emoji = CLASS_EMOJI[className.toLowerCase()] ?? '';
  return ` ${emoji}${level}`;
}

/**
 * Build a Discord server nickname that appends a class icon + level to the base
 * name, capped at Discord's 32-char limit. Built from the STABLE base (the Discord
 * handle), never the current nick, so re-syncs are idempotent (no compounding).
 * Code-point aware so an emoji is never split.
 */
export function buildLevelNick(baseName: string, level: number, className: string): string {
  const suffix = levelNickSuffix(level, className);
  const suffixLen = [...suffix].length;
  const base = [...baseName]
    .slice(0, Math.max(1, NICK_MAX - suffixLen))
    .join('')
    .trimEnd();
  const nick = `${base}${suffix}`;
  const cps = [...nick];
  return cps.length > NICK_MAX ? cps.slice(0, NICK_MAX).join('') : nick;
}

// ── Embeds + messages ────────────────────────────────────────────────────────
// FlexData stays: the role-sync poll reads it (status tier + character for the
// level-on-nickname). The /flex slash command and its embed were removed.
export interface FlexData {
  found: boolean;
  username: string | null;
  statusTier: number;
  points: number;
  character: { name: string; class: string; level: number; profileUrl: string } | null;
}

/** Plain-text /whoami reply. */
export function buildWhoamiContent(roles: {
  linked: boolean;
  statusTier: number;
  points: number;
  lifetimePoints: number;
}): string {
  if (!roles.linked) {
    return 'Your Discord is not linked to a World of ClaudeCraft account yet. Use /link to connect it and start earning rewards.';
  }
  const rank = tierRoleName(roles.statusTier)?.replace('WoC ', '') ?? 'Unranked';
  return `Linked. Rank: **${rank}** · ${roles.points} reward points (lifetime ${roles.lifetimePoints}). Use /flex to show off your top character.`;
}

/** /link reply pointing at the in-game link flow. */
export function buildLinkContent(gameUrl: string): string {
  return `Connect your Discord to World of ClaudeCraft to earn rewards and flex your characters: open ${gameUrl}, log in, and press the Discord button in the game HUD (or "Continue with Discord" on the login screen).`;
}

/** Welcome message for a new guild member. */
export function buildWelcomeMessage(opts: { userMention: string; gameUrl: string }): string {
  return `Welcome to World of ClaudeCraft, ${opts.userMention}! Play at ${opts.gameUrl} and link your Discord in the game HUD to earn rewards, claim swag, and rank up here in the server.`;
}

// ── Voice presence ───────────────────────────────────────────────────────────
export interface RawVoiceState {
  userId: string;
  channelId: string | null;
  selfMute: boolean;
}

export interface VoiceMemberOut {
  id: string;
  name: string;
  speaking: boolean;
  selfMute: boolean;
}

/**
 * Shape the voice members of the featured channel from raw voice states + a
 * name resolver. `speaking` is always false (live speaking needs a voice-gateway
 * connection the bot does not open); membership + mute come from voice states.
 */
export function voiceMembersForChannel(
  states: readonly RawVoiceState[],
  featuredChannelId: string,
  nameOf: (userId: string) => string,
): VoiceMemberOut[] {
  return states
    .filter((s) => s.channelId === featuredChannelId)
    .map((s) => ({ id: s.userId, name: nameOf(s.userId), speaking: false, selfMute: s.selfMute }));
}

// ── In-game "!" community relay (LFG / trade / recruit / event / help) ─────────
// The server enqueues these; the bot drains and posts them here with the issuer's
// Discord identity (mention + avatar), their in-game location, and a button a
// reader clicks to ping the issuer back in game.
export interface RelayItem {
  commandId: string;
  tag: string;
  label: string;
  color: number;
  characterName: string;
  level: number;
  className: string;
  realm: string;
  zone: string;
  message: string;
  profileUrl: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
}

/** The game deep-link a reader opens to respond: lands them in game + whispers. */
export function relayRespondUrl(gameUrl: string, characterName: string, commandId: string): string {
  const base = gameUrl.replace(/\/+$/, '');
  return `${base}/?lfg=${encodeURIComponent(characterName)}&c=${encodeURIComponent(commandId)}`;
}

/** Discord CDN avatar URL for a user, or null when they have no custom avatar. */
export function relayAvatarUrl(userId: string | null, avatar: string | null): string | null {
  if (!userId || !avatar) return null;
  const ext = avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=128`;
}

/**
 * Full createMessage payload for a relay post: a mention that pings the issuer, a
 * rich embed (their Discord name + avatar, the message, their in-game location),
 * and a button others click to be pinged back in game. Pure data; the REST layer
 * sends it. Unit-tested in tests/discord_bot.test.ts.
 */
export function buildRelayMessage(item: RelayItem, gameUrl: string): Record<string, unknown> {
  const avatarUrl = relayAvatarUrl(item.discordUserId, item.discordAvatar);
  const who = item.discordUsername || item.characterName;
  const embed: Record<string, unknown> = {
    color: item.color,
    author: { name: `${who} - ${item.tag}`, ...(avatarUrl ? { icon_url: avatarUrl } : {}) },
    title: item.label,
    description: item.message || '(no details given)',
    fields: [
      {
        name: 'Character',
        value: `${item.characterName} - Level ${item.level} ${item.className}`,
        inline: true,
      },
      { name: 'Location', value: `${item.zone} (${item.realm})`, inline: true },
    ],
    footer: { text: 'World of ClaudeCraft' },
  };
  if (item.profileUrl) embed.url = item.profileUrl;
  if (avatarUrl) embed.thumbnail = { url: avatarUrl };

  const payload: Record<string, unknown> = {
    embeds: [embed],
    components: [
      {
        type: 1, // action row
        components: [
          {
            type: 2, // button
            style: 5, // link: opens the game deep link (no interaction round-trip)
            label: `Respond to ${item.characterName}`.slice(0, 80),
            url: relayRespondUrl(gameUrl, item.characterName, item.commandId),
          },
        ],
      },
    ],
  };
  // Mention pings the issuer (they asked to be tagged); restrict mentions to just
  // them so any pasted @everyone/@role in the free text can never ping.
  if (item.discordUserId) {
    payload.content = `<@${item.discordUserId}>`;
    payload.allowed_mentions = { users: [item.discordUserId] };
  } else {
    payload.allowed_mentions = { parse: [] };
  }
  return payload;
}

// ── Significant-activity feed (level 20 / rare drop / duel / arena) ───────────
export interface ActivityParticipant {
  name: string;
  discordUserId: string | null;
  discordAvatar: string | null;
}

export interface ActivityItem {
  kind: 'levelup' | 'rareloot' | 'duel' | 'arena';
  realm: string;
  profileUrl: string | null;
  level?: number;
  itemName?: string;
  quality?: string;
  winnerName?: string;
  loserName?: string;
  ratingDelta?: number;
  participants: ActivityParticipant[];
}

// Per-quality embed accent for a rare drop (epic purple, legendary orange).
function qualityColor(quality: string | undefined): number {
  return quality === 'legendary' ? 0xff8000 : 0xa335ee;
}

// Resolve a character name to its Discord mention (when linked) or plain name.
function mentionFor(name: string, parts: readonly ActivityParticipant[]): string {
  const p = parts.find((x) => x.name === name);
  return p?.discordUserId ? `<@${p.discordUserId}>` : name;
}

/**
 * Full createMessage payload for one activity card: a content line that pings the
 * linked participant(s) and a rich, per-kind embed. Pure data; the REST layer
 * sends it. Unit-tested in tests/discord_bot.test.ts.
 */
export function buildActivityMessage(item: ActivityItem): Record<string, unknown> {
  const subject = item.participants[0];
  const subjectName = subject?.name ?? item.winnerName ?? '';
  const subjectAvatar = subject
    ? relayAvatarUrl(subject.discordUserId, subject.discordAvatar)
    : null;
  const linkedIds = item.participants
    .map((p) => p.discordUserId)
    .filter((id): id is string => !!id);

  let author: string;
  let title: string;
  let description: string;
  let color: number;

  switch (item.kind) {
    case 'levelup':
      author = ':tada: Max Level';
      title = `${subjectName} hit level ${item.level ?? 20}!`;
      description = `${mentionFor(subjectName, item.participants)} reached the level cap on ${item.realm}. Glory!`;
      color = 0xffcc33;
      break;
    case 'rareloot':
      author = ':gem: Rare Drop';
      title = item.itemName ?? 'A rare item';
      description =
        `A **${item.quality ?? 'rare'}** drop` +
        (subject ? ` for ${mentionFor(subjectName, item.participants)}` : '') +
        ` on ${item.realm}!`;
      color = qualityColor(item.quality);
      break;
    case 'duel':
      author = ':crossed_swords: Duel';
      title = `${item.winnerName ?? subjectName} wins!`;
      description =
        `${mentionFor(item.winnerName ?? '', item.participants)} defeated ` +
        `${mentionFor(item.loserName ?? '', item.participants)} in a duel on ${item.realm}.`;
      color = 0xc0563f;
      break;
    case 'arena':
      author = ':trophy: Arena Victory';
      title = `${subjectName} won an arena match!`;
      description =
        `${mentionFor(subjectName, item.participants)} took the win` +
        (item.ratingDelta !== undefined
          ? ` (**${item.ratingDelta >= 0 ? '+' : ''}${item.ratingDelta}** rating)`
          : '') +
        ` on ${item.realm}.`;
      color = 0x9b59b6;
      break;
  }

  const embed: Record<string, unknown> = {
    color,
    author: subjectAvatar ? { name: author, icon_url: subjectAvatar } : { name: author },
    title,
    description,
    footer: { text: 'World of ClaudeCraft' },
  };
  if (item.profileUrl) embed.url = item.profileUrl;
  if (subjectAvatar) embed.thumbnail = { url: subjectAvatar };

  const payload: Record<string, unknown> = { embeds: [embed] };
  if (linkedIds.length) {
    payload.content = linkedIds.map((id) => `<@${id}>`).join(' ');
    payload.allowed_mentions = { users: linkedIds };
  } else {
    payload.allowed_mentions = { parse: [] };
  }
  return payload;
}

// ── Daily rewards winners feed ────────────────────────────────────────────────
export interface DailyRewardWinner {
  day: string;
  rank: number;
  username: string;
  points: number;
  prizePercent: number;
  prizeUsd: number;
  status: string;
  txSignature: string | null;
}

export interface DailyRewardWinnersDay {
  day: string;
  taskName: string;
  nextTaskName: string;
  realm: string;
  prizePoolUsd: number;
  finalizedAt: string | null;
  payouts: DailyRewardWinner[];
}

function usd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function percent(value: number): string {
  return `${(value * 100).toLocaleString('en-US', {
    maximumFractionDigits: 1,
  })}%`;
}

export function buildDailyRewardWinnersMessage(
  day: DailyRewardWinnersDay,
): Record<string, unknown> {
  const rows = day.payouts
    .slice(0, 10)
    .map(
      (row) =>
        `**#${row.rank}** ${row.username} - ${row.points.toLocaleString('en-US')} pts - ${usd(row.prizeUsd)} (${percent(row.prizePercent)})`,
    );
  const description =
    rows.length > 0 ? rows.join('\n') : 'No daily reward winners were recorded for this day.';
  return {
    embeds: [
      {
        color: 0xf0b743,
        author: { name: `Task: ${day.taskName}` },
        title: `Top ${Math.min(day.payouts.length, 10)} Winners - ${day.day}`,
        description,
        fields: [
          { name: 'Realm', value: day.realm, inline: true },
          { name: 'Prize Pool', value: usd(day.prizePoolUsd), inline: true },
          { name: 'Next task', value: day.nextTaskName, inline: false },
        ],
        footer: { text: 'World of ClaudeCraft' },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
