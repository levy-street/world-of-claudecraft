// Persistent social systems: friends, ignore/block lists, and guilds.
//
// Unlike parties/duels/trades (which live in the ephemeral Sim, keyed by
// transient entity ids), these outlive a play session and are keyed by
// character id. The business logic here is deliberately decoupled from both
// Postgres and the WebSocket layer: it talks to a `SocialDb` (so tests can use
// an in-memory fake) and a `SocialTransport` (so it can deliver messages to
// whoever happens to be online without knowing about sockets). game.ts wires
// the real Postgres + socket implementations in.

import { CALENDAR_TUNING } from '../src/sim/game_config';

export type GuildRank = 'leader' | 'officer' | 'member';

// Where a character is and what they're doing, for friend/guild rosters.
// `realm` is the world/shard the character lives on (stored per character so
// it survives logout and is ready for future cross-realm play); `zone` and
// `status` are only meaningful while the character is online.
export type PresenceStatus = 'online' | 'combat' | 'dungeon' | 'dead';

export interface Presence {
  zone: string;
  status: PresenceStatus;
  x?: number;
  z?: number;
}

export interface CharRef {
  id: number;
  name: string;
}

export interface CharInfo extends CharRef {
  cls: string;
  level: number;
  realm: string;
}

export interface FriendEntry extends CharInfo {
  online: boolean;
  zone?: string;
  status?: PresenceStatus;
  x?: number;
  z?: number;
}

export interface GuildMemberEntry extends CharInfo {
  rank: GuildRank;
  online: boolean;
  zone?: string;
  status?: PresenceStatus;
  x?: number;
  z?: number;
}

// One guild calendar event. `day` is a UTC 'YYYY-MM-DD'; `hour` is 0-23 UTC
// or null for an all-day event; `createdBy` is the author's display name.
export interface GuildEventRow {
  id: number;
  day: string;
  hour: number | null;
  title: string;
  note: string;
  createdBy: string;
}

export interface GuildView {
  id: number;
  name: string;
  rank: GuildRank;
  members: GuildMemberEntry[];
  events: GuildEventRow[];
}

export interface SocialSnapshot {
  friends: FriendEntry[];
  blocks: CharRef[];
  guild: GuildView | null;
}

// Storage abstraction. The Postgres implementation lives in social_db.ts; the
// tests provide an in-memory one. Every method is keyed by character id.
export interface SocialDb {
  findCharacterByName(name: string): Promise<CharInfo | null>;
  getCharacter(id: number): Promise<CharInfo | null>;
  // friends (one-directional, classic style: no acceptance needed)
  addFriend(charId: number, friendId: number): Promise<void>;
  removeFriend(charId: number, friendId: number): Promise<void>;
  listFriends(charId: number): Promise<CharInfo[]>;
  whoFriended(charId: number): Promise<number[]>; // reverse lookup
  // blocks (one-directional ignore)
  addBlock(charId: number, blockedId: number): Promise<void>;
  removeBlock(charId: number, blockedId: number): Promise<void>;
  listBlocks(charId: number): Promise<CharRef[]>;
  blockedIds(charId: number): Promise<number[]>;
  // guilds (a character belongs to at most one)
  // create the guild and seat its leader in one transaction, so a racing or
  // duplicate create packet can never orphan a leaderless guild
  createGuildWithLeader(
    name: string,
    leaderId: number,
  ): Promise<{ guildId: number } | { error: 'name_taken' | 'already_in_guild' }>;
  deleteGuild(id: number): Promise<void>;
  guildMembership(
    charId: number,
  ): Promise<{ guildId: number; guildName: string; rank: GuildRank } | null>;
  // seat a member atomically, enforcing the cap under concurrent accepts
  addGuildMemberAtomic(
    guildId: number,
    charId: number,
    rank: GuildRank,
    limit: number,
  ): Promise<'ok' | 'full' | 'already_member' | 'no_guild'>;
  removeGuildMember(charId: number): Promise<void>;
  setGuildRank(charId: number, rank: GuildRank): Promise<void>;
  guildMembers(guildId: number): Promise<(CharInfo & { rank: GuildRank })[]>;
  // guild calendar events (the event calendar's guild lane)
  guildEvents(guildId: number, fromDay: string): Promise<GuildEventRow[]>;
  guildEventCount(guildId: number, fromDay: string): Promise<number>;
  createGuildEvent(
    guildId: number,
    creatorId: number,
    day: string,
    hour: number | null,
    title: string,
    note: string,
  ): Promise<number>;
  deleteGuildEvent(eventId: number, guildId: number): Promise<boolean>;
  pruneGuildEvents(guildId: number, beforeDay: string): Promise<void>;
}

export interface SocialActor {
  characterId: number;
  name: string;
}

// Presence + delivery, provided by game.ts. Keeps this module ignorant of
// sockets and the live client map.
export interface SocialTransport {
  byCharacterId(id: number): SocialActor | null;
  byName(name: string): SocialActor | null;
  isOnline(id: number): boolean;
  // where an online character is and what they're doing (null if offline);
  // game.ts derives this from the live sim entity
  locationOf(id: number): Presence | null;
  // deliver gameplay events to a character if they are online
  deliver(characterId: number, events: SocialEvent[]): void;
  // re-send the full social panel state to a character if online
  pushSnapshot(characterId: number): void;
  // a character's block set changed; refresh the in-memory chat filter
  onBlocksChanged(characterId: number, blockedIds: number[]): void;
  // true if `recipientId` has `senderCharacterId` on their ignore list, so
  // guild/officer chat can honour the same filter say/whisper already apply
  isIgnoring(recipientId: number, senderCharacterId: number): boolean;
}

export type SocialEvent =
  | { type: 'log'; text: string; color?: string }
  | { type: 'error'; text: string }
  | { type: 'chat'; from: string; text: string; channel: 'guild' | 'officer' }
  | { type: 'guildInvite'; fromName: string; guildName: string }
  // Structured guild-calendar outcome; the client renders the visible line
  // from the code (the sim's mailResult convention, so no server English here).
  | { type: 'calendarResult'; code: CalendarResultCode };

export type CalendarResultCode =
  | 'created'
  | 'removed'
  | 'notInGuild'
  | 'notOfficer'
  | 'badInput'
  | 'calendarFull'
  | 'eventGone';

const FRIEND_LIMIT = 50;
const BLOCK_LIMIT = 50;
const GUILD_MEMBER_LIMIT = 100;
const GUILD_INVITE_TTL_MS = 60_000;
const GUILD_MESSAGE_MAX = 200;
// Guild calendar: caps + input bounds. Events are UTC-day keyed ('YYYY-MM-DD',
// matching the sim's utcDay convention) and may be booked up to a year out by
// default. The values live on CALENDAR_TUNING (src/sim/game_config.ts) so the
// admin Housekeeping section can override them; read at each use site, never
// captured at module load.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A well-formed, real calendar day inside the booking window (both UTC).
export function validateGuildEventDay(day: string, todayIso: string): string | null {
  if (!DAY_RE.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== day) return null; // e.g. 2026-02-30 rolls over
  if (day < shiftDay(todayIso, -1)) return null;
  if (day > shiftDay(todayIso, CALENDAR_TUNING.horizonDays)) return null;
  return day;
}

export function validateGuildName(name: string): string | null {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 3 || trimmed.length > 24) return null;
  // letters and single interior spaces only — keeps the channel header tidy
  if (!/^[A-Za-z][A-Za-z ]*[A-Za-z]$/.test(trimmed)) return null;
  if (/\s{2,}/.test(trimmed)) return null;
  return trimmed;
}

const RANK_LABEL: Record<GuildRank, string> = {
  leader: 'Guild Master',
  officer: 'Officer',
  member: 'Member',
};

export class SocialService {
  private pendingGuildInvites = new Map<
    number,
    { guildId: number; guildName: string; fromName: string; expiresAt: number }
  >();

  constructor(
    private readonly db: SocialDb,
    private readonly tx: SocialTransport,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // -------------------------------------------------------------------------
  // Snapshot (drives the client Social panel)
  // -------------------------------------------------------------------------

  async snapshot(charId: number): Promise<SocialSnapshot> {
    const [friends, blocks, membership] = await Promise.all([
      this.db.listFriends(charId),
      this.db.listBlocks(charId),
      this.db.guildMembership(charId),
    ]);
    let guild: GuildView | null = null;
    if (membership) {
      const fromDay = shiftDay(this.todayIso(), -CALENDAR_TUNING.keepPastDays);
      const [members, events] = await Promise.all([
        this.db.guildMembers(membership.guildId),
        this.db.guildEvents(membership.guildId, fromDay),
      ]);
      guild = {
        id: membership.guildId,
        name: membership.guildName,
        rank: membership.rank,
        members: members
          .map((m) => ({ ...m, ...this.presence(m.id) }))
          .sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank) || a.name.localeCompare(b.name)),
        events,
      };
    }
    return {
      friends: friends
        .map((f) => ({ ...f, ...this.presence(f.id) }))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
      blocks,
      guild,
    };
  }

  // Collapse a character's online presence into the fields a roster row needs.
  private presence(charId: number): {
    online: boolean;
    zone?: string;
    status?: PresenceStatus;
    x?: number;
    z?: number;
  } {
    const loc = this.tx.locationOf(charId);
    return loc
      ? { online: true, zone: loc.zone, status: loc.status, x: loc.x, z: loc.z }
      : { online: false };
  }

  private push(charId: number): void {
    this.tx.pushSnapshot(charId);
  }

  private err(charId: number, text: string): void {
    this.tx.deliver(charId, [{ type: 'error', text }]);
  }

  private info(charId: number, text: string, color = '#aaf'): void {
    this.tx.deliver(charId, [{ type: 'log', text, color }]);
  }

  // Resolve a target character by name for a friend/block/invite action,
  // reporting the right error to the actor. Returns null on failure.
  private async resolveTarget(actor: SocialActor, name: string): Promise<CharInfo | null> {
    const wanted = String(name ?? '').trim();
    if (!wanted) {
      this.err(actor.characterId, 'Specify a character name.');
      return null;
    }
    const target = await this.db.findCharacterByName(wanted);
    if (!target) {
      this.err(actor.characterId, `No character named '${wanted}' exists.`);
      return null;
    }
    return target;
  }

  // -------------------------------------------------------------------------
  // Friends
  // -------------------------------------------------------------------------

  async friendAdd(actor: SocialActor, name: string): Promise<void> {
    const target = await this.resolveTarget(actor, name);
    if (!target) return;
    if (target.id === actor.characterId) {
      this.err(actor.characterId, 'You cannot befriend yourself.');
      return;
    }
    // friends and ignore are mutually exclusive — blockAdd drops an ignored
    // player from your friends, so friendAdd must refuse the reverse, or a
    // player could end up both ignored and friended at once.
    const blocks = await this.db.listBlocks(actor.characterId);
    if (blocks.some((b) => b.id === target.id)) {
      this.err(
        actor.characterId,
        `You are ignoring ${target.name}. Remove them from your ignore list first.`,
      );
      return;
    }
    const friends = await this.db.listFriends(actor.characterId);
    if (friends.some((f) => f.id === target.id)) {
      this.err(actor.characterId, `${target.name} is already your friend.`);
      return;
    }
    if (friends.length >= FRIEND_LIMIT) {
      this.err(actor.characterId, 'Your friends list is full.');
      return;
    }
    await this.db.addFriend(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} added to friends.`);
    this.push(actor.characterId);
  }

  async friendRemove(actor: SocialActor, name: string): Promise<void> {
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target) {
      this.err(actor.characterId, `No character named '${name}' on your friends list.`);
      return;
    }
    const friends = await this.db.listFriends(actor.characterId);
    if (!friends.some((f) => f.id === target.id)) {
      this.err(actor.characterId, `${target.name} is not on your friends list.`);
      return;
    }
    await this.db.removeFriend(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} removed from friends.`);
    this.push(actor.characterId);
  }

  // Called by game.ts when a character logs in/out, so friends watching them
  // see a come-online / go-offline notice (and refresh their panel).
  async announcePresence(actor: SocialActor, online: boolean): Promise<void> {
    const watchers = await this.db.whoFriended(actor.characterId);
    const notified = new Set<number>();
    for (const watcherId of watchers) {
      if (!this.tx.isOnline(watcherId)) continue;
      this.tx.deliver(watcherId, [
        {
          type: 'log',
          text: online ? `${actor.name} has come online.` : `${actor.name} has gone offline.`,
          color: '#7fd4ff',
        },
      ]);
      this.push(watcherId);
      notified.add(watcherId);
    }
    // Guild members must see each other's presence too, so the guild roster
    // stays as fresh as the friends list (#100). Refresh their panel (the dot
    // and location) without a chat notice, to avoid spamming large guilds.
    const membership = await this.db.guildMembership(actor.characterId);
    if (membership) {
      const members = await this.db.guildMembers(membership.guildId);
      for (const m of members) {
        if (m.id === actor.characterId || notified.has(m.id) || !this.tx.isOnline(m.id)) continue;
        this.push(m.id);
        notified.add(m.id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Blocks / ignore
  // -------------------------------------------------------------------------

  async blockAdd(actor: SocialActor, name: string): Promise<void> {
    const target = await this.resolveTarget(actor, name);
    if (!target) return;
    if (target.id === actor.characterId) {
      this.err(actor.characterId, 'You cannot ignore yourself.');
      return;
    }
    const blocks = await this.db.listBlocks(actor.characterId);
    if (blocks.some((b) => b.id === target.id)) {
      this.err(actor.characterId, `${target.name} is already ignored.`);
      return;
    }
    if (blocks.length >= BLOCK_LIMIT) {
      this.err(actor.characterId, 'Your ignore list is full.');
      return;
    }
    await this.db.addBlock(actor.characterId, target.id);
    // ignoring someone also drops them from your friends list
    await this.db.removeFriend(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} is now ignored.`);
    this.tx.onBlocksChanged(actor.characterId, await this.db.blockedIds(actor.characterId));
    this.push(actor.characterId);
  }

  async blockRemove(actor: SocialActor, name: string): Promise<void> {
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target) {
      this.err(actor.characterId, `No character named '${name}' on your ignore list.`);
      return;
    }
    const blocks = await this.db.listBlocks(actor.characterId);
    if (!blocks.some((b) => b.id === target.id)) {
      this.err(actor.characterId, `${target.name} is not on your ignore list.`);
      return;
    }
    await this.db.removeBlock(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} is no longer ignored.`);
    this.tx.onBlocksChanged(actor.characterId, await this.db.blockedIds(actor.characterId));
    this.push(actor.characterId);
  }

  // -------------------------------------------------------------------------
  // Guilds
  // -------------------------------------------------------------------------

  async guildCreate(actor: SocialActor, rawName: string): Promise<void> {
    const name = validateGuildName(rawName);
    if (!name) {
      this.err(actor.characterId, 'Guild names are 3-24 letters (spaces allowed).');
      return;
    }
    const result = await this.db.createGuildWithLeader(name, actor.characterId);
    if ('error' in result) {
      this.err(
        actor.characterId,
        result.error === 'name_taken'
          ? `A guild named '${name}' already exists.`
          : 'You are already in a guild.',
      );
      return;
    }
    this.info(
      actor.characterId,
      `You found the guild <${name}>! You are its Guild Master.`,
      '#40ff7f',
    );
    this.push(actor.characterId);
  }

  async guildInvite(actor: SocialActor, name: string): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.err(actor.characterId, 'You are not in a guild.');
      return;
    }
    if (membership.rank === 'member') {
      this.err(actor.characterId, 'Only officers and the Guild Master may invite.');
      return;
    }
    const target = await this.resolveTarget(actor, name);
    if (!target) return;
    if (target.id === actor.characterId) {
      this.err(actor.characterId, 'You are already in the guild.');
      return;
    }
    if (!this.tx.isOnline(target.id)) {
      this.err(actor.characterId, `${target.name} must be online to be invited.`);
      return;
    }
    if (await this.db.guildMembership(target.id)) {
      this.err(actor.characterId, `${target.name} is already in a guild.`);
      return;
    }
    const existing = this.pendingGuildInvites.get(target.id);
    if (existing && existing.expiresAt >= this.now()) {
      this.err(actor.characterId, `${target.name} already has a pending guild invitation.`);
      return;
    }
    const members = await this.db.guildMembers(membership.guildId);
    if (members.length >= GUILD_MEMBER_LIMIT) {
      this.err(actor.characterId, 'Your guild is full.');
      return;
    }
    this.pendingGuildInvites.set(target.id, {
      guildId: membership.guildId,
      guildName: membership.guildName,
      fromName: actor.name,
      expiresAt: this.now() + GUILD_INVITE_TTL_MS,
    });
    this.tx.deliver(target.id, [
      { type: 'guildInvite', fromName: actor.name, guildName: membership.guildName },
    ]);
    this.info(actor.characterId, `You have invited ${target.name} to the guild.`);
  }

  async guildAccept(actor: SocialActor): Promise<void> {
    const invite = this.pendingGuildInvites.get(actor.characterId);
    this.pendingGuildInvites.delete(actor.characterId);
    if (!invite || invite.expiresAt < this.now()) {
      this.err(actor.characterId, 'The guild invitation has expired.');
      return;
    }
    const result = await this.db.addGuildMemberAtomic(
      invite.guildId,
      actor.characterId,
      'member',
      GUILD_MEMBER_LIMIT,
    );
    if (result === 'no_guild') {
      this.err(actor.characterId, 'That guild no longer exists.');
      return;
    }
    if (result === 'already_member') {
      this.err(actor.characterId, 'You are already in a guild.');
      return;
    }
    if (result === 'full') {
      this.err(actor.characterId, 'That guild is full.');
      return;
    }
    await this.broadcastGuild(invite.guildId, [
      { type: 'log', text: `${actor.name} has joined the guild.`, color: '#40ff7f' },
    ]);
    await this.pushGuild(invite.guildId);
  }

  guildDecline(actor: SocialActor): void {
    this.pendingGuildInvites.delete(actor.characterId);
  }

  async guildLeave(actor: SocialActor): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.err(actor.characterId, 'You are not in a guild.');
      return;
    }
    const members = await this.db.guildMembers(membership.guildId);
    const others = members.filter((m) => m.id !== actor.characterId);
    // classic-MMO rule: the Guild Master cannot quit while others remain — they must
    // hand leadership over (Promote to Guild Master) or disband the guild.
    if (membership.rank === 'leader' && others.length > 0) {
      this.err(
        actor.characterId,
        'As Guild Master you must promote a new leader or disband the guild before leaving.',
      );
      return;
    }
    await this.db.removeGuildMember(actor.characterId);
    if (others.length === 0) {
      // last member out: the guild ceases to exist
      await this.db.deleteGuild(membership.guildId);
      this.info(
        actor.characterId,
        `You have left <${membership.guildName}>. The guild has disbanded.`,
        '#ffd100',
      );
    } else {
      await this.broadcastGuild(membership.guildId, [
        { type: 'log', text: `${actor.name} has left the guild.`, color: '#ffd100' },
      ]);
      this.info(actor.characterId, `You have left <${membership.guildName}>.`);
      await this.pushGuild(membership.guildId);
    }
    this.push(actor.characterId);
  }

  // /gleader: hand the Guild Master title to another member. The former
  // leader steps down to Officer.
  async guildTransferLeader(actor: SocialActor, name: string): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.err(actor.characterId, 'You are not in a guild.');
      return;
    }
    if (membership.rank !== 'leader') {
      this.err(actor.characterId, 'Only the Guild Master may promote a new leader.');
      return;
    }
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target || target.id === actor.characterId) {
      this.err(actor.characterId, `No such guild member '${name}'.`);
      return;
    }
    const targetMembership = await this.db.guildMembership(target.id);
    if (!targetMembership || targetMembership.guildId !== membership.guildId) {
      this.err(actor.characterId, `${target.name} is not in your guild.`);
      return;
    }
    await this.db.setGuildRank(target.id, 'leader');
    await this.db.setGuildRank(actor.characterId, 'officer');
    await this.broadcastGuild(membership.guildId, [
      {
        type: 'log',
        text: `${target.name} is now the Guild Master of <${membership.guildName}>.`,
        color: '#ffd100',
      },
    ]);
    await this.pushGuild(membership.guildId);
  }

  // /gdisband: the Guild Master dissolves the entire guild.
  async guildDisband(actor: SocialActor): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.err(actor.characterId, 'You are not in a guild.');
      return;
    }
    if (membership.rank !== 'leader') {
      this.err(actor.characterId, 'Only the Guild Master may disband the guild.');
      return;
    }
    const members = await this.db.guildMembers(membership.guildId);
    await this.db.deleteGuild(membership.guildId);
    for (const m of members) {
      if (this.tx.isOnline(m.id)) {
        this.info(m.id, `<${membership.guildName}> has been disbanded.`, '#ffd100');
        this.push(m.id);
      }
    }
  }

  async guildKick(actor: SocialActor, name: string): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.err(actor.characterId, 'You are not in a guild.');
      return;
    }
    if (membership.rank === 'member') {
      this.err(actor.characterId, 'Only officers and the Guild Master may remove members.');
      return;
    }
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target) {
      this.err(actor.characterId, `No character named '${name}'.`);
      return;
    }
    if (target.id === actor.characterId) {
      this.err(actor.characterId, 'Use Leave Guild to remove yourself.');
      return;
    }
    const targetMembership = await this.db.guildMembership(target.id);
    if (!targetMembership || targetMembership.guildId !== membership.guildId) {
      this.err(actor.characterId, `${target.name} is not in your guild.`);
      return;
    }
    if (targetMembership.rank === 'leader') {
      this.err(actor.characterId, 'You cannot remove the Guild Master.');
      return;
    }
    if (targetMembership.rank === 'officer' && membership.rank !== 'leader') {
      this.err(actor.characterId, 'Only the Guild Master may remove an officer.');
      return;
    }
    await this.db.removeGuildMember(target.id);
    if (this.tx.isOnline(target.id)) {
      this.info(target.id, `You have been removed from <${membership.guildName}>.`, '#ffd100');
      this.push(target.id);
    }
    await this.broadcastGuild(membership.guildId, [
      {
        type: 'log',
        text: `${target.name} has been removed from the guild by ${actor.name}.`,
        color: '#ffd100',
      },
    ]);
    await this.pushGuild(membership.guildId);
  }

  async guildSetRank(actor: SocialActor, name: string, rank: GuildRank): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.err(actor.characterId, 'You are not in a guild.');
      return;
    }
    if (membership.rank !== 'leader') {
      this.err(actor.characterId, 'Only the Guild Master may change ranks.');
      return;
    }
    if (rank === 'leader') {
      this.err(actor.characterId, 'Use a guild transfer to hand over leadership.');
      return;
    }
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target || target.id === actor.characterId) {
      this.err(actor.characterId, `No such guild member '${name}'.`);
      return;
    }
    const targetMembership = await this.db.guildMembership(target.id);
    if (!targetMembership || targetMembership.guildId !== membership.guildId) {
      this.err(actor.characterId, `${target.name} is not in your guild.`);
      return;
    }
    if (targetMembership.rank === rank) {
      this.err(actor.characterId, `${target.name} is already ${RANK_LABEL[rank]}.`);
      return;
    }
    await this.db.setGuildRank(target.id, rank);
    await this.broadcastGuild(membership.guildId, [
      { type: 'log', text: `${target.name} is now ${RANK_LABEL[rank]}.`, color: '#40ff7f' },
    ]);
    await this.pushGuild(membership.guildId);
  }

  async guildChat(actor: SocialActor, rawText: string): Promise<boolean> {
    const text = String(rawText ?? '')
      .trim()
      .slice(0, GUILD_MESSAGE_MAX);
    if (!text) return false;
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.err(actor.characterId, 'You are not in a guild.');
      return false;
    }
    const event: SocialEvent = { type: 'chat', from: actor.name, text, channel: 'guild' };
    const members = await this.db.guildMembers(membership.guildId);
    for (const m of members) {
      if (!this.tx.isOnline(m.id)) continue;
      // a player who ignores the speaker does not see their guild chat (the
      // speaker always sees their own line); mirrors say/whisper filtering
      if (m.id !== actor.characterId && this.tx.isIgnoring(m.id, actor.characterId)) continue;
      this.tx.deliver(m.id, [event]);
    }
    return true;
  }

  // Officer chat (/o): officers + Guild Master only, delivered to the same.
  async officerChat(actor: SocialActor, rawText: string): Promise<boolean> {
    const text = String(rawText ?? '')
      .trim()
      .slice(0, GUILD_MESSAGE_MAX);
    if (!text) return false;
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.err(actor.characterId, 'You are not in a guild.');
      return false;
    }
    if (membership.rank === 'member') {
      this.err(actor.characterId, 'Only officers and the Guild Master can use officer chat.');
      return false;
    }
    const members = await this.db.guildMembers(membership.guildId);
    for (const m of members) {
      if ((m.rank === 'officer' || m.rank === 'leader') && this.tx.isOnline(m.id)) {
        // honour the recipient's ignore list, just like guild/say/whisper
        if (m.id !== actor.characterId && this.tx.isIgnoring(m.id, actor.characterId)) continue;
        this.tx.deliver(m.id, [{ type: 'chat', from: actor.name, text, channel: 'officer' }]);
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Guild calendar events
  // -------------------------------------------------------------------------

  private todayIso(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private calendarResult(charId: number, code: CalendarResultCode): void {
    this.tx.deliver(charId, [{ type: 'calendarResult', code }]);
  }

  async guildEventCreate(
    actor: SocialActor,
    input: { day: string; hour: number | null; title: string; note: string },
  ): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.calendarResult(actor.characterId, 'notInGuild');
      return;
    }
    if (membership.rank === 'member') {
      this.calendarResult(actor.characterId, 'notOfficer');
      return;
    }
    const today = this.todayIso();
    const day = validateGuildEventDay(String(input.day ?? ''), today);
    const title = String(input.title ?? '')
      .trim()
      .slice(0, CALENDAR_TUNING.titleMax);
    const note = String(input.note ?? '')
      .trim()
      .slice(0, CALENDAR_TUNING.noteMax);
    const hour =
      input.hour === null || !Number.isFinite(input.hour)
        ? null
        : Math.max(0, Math.min(23, Math.floor(input.hour)));
    if (!day || title.length === 0) {
      this.calendarResult(actor.characterId, 'badInput');
      return;
    }
    // Housekeeping: long-past events fall off whenever a new one is booked.
    await this.db.pruneGuildEvents(
      membership.guildId,
      shiftDay(today, -CALENDAR_TUNING.keepPastDays),
    );
    const upcoming = await this.db.guildEventCount(membership.guildId, today);
    if (upcoming >= CALENDAR_TUNING.eventLimit) {
      this.calendarResult(actor.characterId, 'calendarFull');
      return;
    }
    await this.db.createGuildEvent(membership.guildId, actor.characterId, day, hour, title, note);
    this.calendarResult(actor.characterId, 'created');
    await this.pushGuild(membership.guildId);
  }

  async guildEventRemove(actor: SocialActor, eventId: number): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.calendarResult(actor.characterId, 'notInGuild');
      return;
    }
    if (membership.rank === 'member') {
      this.calendarResult(actor.characterId, 'notOfficer');
      return;
    }
    const removed = await this.db.deleteGuildEvent(eventId, membership.guildId);
    if (!removed) {
      this.calendarResult(actor.characterId, 'eventGone');
      return;
    }
    this.calendarResult(actor.characterId, 'removed');
    await this.pushGuild(membership.guildId);
  }

  // Deliver events to every online member of a guild.
  private async broadcastGuild(guildId: number, events: SocialEvent[]): Promise<void> {
    const members = await this.db.guildMembers(guildId);
    for (const m of members) {
      if (this.tx.isOnline(m.id)) this.tx.deliver(m.id, events);
    }
  }

  private async pushGuild(guildId: number): Promise<void> {
    const members = await this.db.guildMembers(guildId);
    for (const m of members) if (this.tx.isOnline(m.id)) this.push(m.id);
  }

  // Drop a character's pending invite when they disconnect.
  forget(charId: number): void {
    this.pendingGuildInvites.delete(charId);
  }
}

function rankOrder(rank: GuildRank): number {
  return rank === 'leader' ? 0 : rank === 'officer' ? 1 : 2;
}
