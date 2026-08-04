// Persistent social systems: friends, ignore/block lists, and guilds.
//
// Unlike parties/duels/trades (which live in the ephemeral Sim, keyed by
// transient entity ids), these outlive a play session and are keyed by
// character id. The business logic here is deliberately decoupled from both
// Postgres and the WebSocket layer: it talks to a `SocialDb` (so tests can use
// an in-memory fake) and a `SocialTransport` (so it can deliver messages to
// whoever happens to be online without knowing about sockets). game.ts wires
// the real Postgres + socket implementations in.

import type { ChatSenderFlair } from '../src/sim/account_flair';
import type { PlayerClass } from '../src/sim/types';

export type GuildRank = 'leader' | 'officer' | 'member';

// Where a character is and what they're doing, for friend/guild rosters.
// `realm` is the world/shard the character lives on (stored per character so
// it survives logout and is ready for future cross-realm play); `zone` and
// `status` are only meaningful while the character is online.
export type PresenceStatus = 'online' | 'combat' | 'dungeon' | 'dead' | 'afk';

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
  // The selected Book of Deeds title: a deed id (never display text; the
  // client localizes through deed_i18n), null when untitled.
  activeTitle: string | null;
  online: boolean;
  zone?: string;
  status?: PresenceStatus;
  x?: number;
  z?: number;
}

export interface GuildMemberEntry extends CharInfo {
  rank: GuildRank;
  // ISO-8601 timestamp of the member's most recent world-entry, or null if never
  // recorded. Serialized server-side (server/social_db.ts) and shown in the roster.
  lastLogin: string | null;
  // Epoch-ms timestamp of when the member joined the guild (guild_members.joined_at,
  // NOT NULL in the DDL, so null is the defensive arm only). Drives the client's
  // roster tenure badges.
  joinedAt: number | null;
  // The selected Book of Deeds title (a deed id, null untitled), as on FriendEntry.
  activeTitle: string | null;
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
  // The guild billboard: a short officer-set message pinned atop the Guild tab
  // ('' when unset), with the setter's display name for attribution.
  motd: string;
  motdSetBy: string;
  members: GuildMemberEntry[];
  events: GuildEventRow[];
}

export interface SocialSnapshot {
  friends: FriendEntry[];
  blocks: CharRef[];
  ignores: CharRef[];
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
  // activeTitle is the friend's selected Book of Deeds title (a deed id the
  // client localizes, never English; the charactersForDeedsBoard read shape).
  listFriends(charId: number): Promise<(CharInfo & { activeTitle: string | null })[]>;
  whoFriended(charId: number): Promise<number[]>; // reverse lookup
  // blocks (one-directional ignore)
  addBlock(charId: number, blockedId: number): Promise<void>;
  removeBlock(charId: number, blockedId: number): Promise<void>;
  listBlocks(charId: number): Promise<CharRef[]>;
  blockedIds(charId: number): Promise<number[]>;
  // ignores (one-directional, chat-only; may coexist with a friendship)
  addIgnore(charId: number, ignoredId: number): Promise<void>;
  removeIgnore(charId: number, ignoredId: number): Promise<void>;
  listIgnores(charId: number): Promise<CharRef[]>;
  ignoredIds(charId: number): Promise<number[]>;
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
  // Rank write predicated on BOTH the character and the guild the caller
  // authorized against, returning whether a row actually moved. False means
  // the target left that guild (or switched guilds) between the caller's
  // membership read and this write: the caller must treat it as a refusal
  // and stamp nothing (the live membership stamp gates the guild bank, so a
  // stamp the DB refused is privilege escalation, see guildSetRank).
  setGuildRank(charId: number, guildId: number, rank: GuildRank): Promise<boolean>;
  // hand off the Guild Master title atomically: locks the guild row, re-checks
  // that fromCharId is still the leader and toCharId is still a member of the
  // SAME guild, then promotes/demotes both rows in one transaction, so two
  // racing transfers can never both succeed and leave two Guild Masters.
  transferGuildLeader(
    guildId: number,
    fromCharId: number,
    toCharId: number,
  ): Promise<'ok' | 'not_leader' | 'not_member' | 'no_guild'>;
  guildMembers(guildId: number): Promise<
    (CharInfo & {
      rank: GuildRank;
      lastLogin: string | null;
      activeTitle: string | null;
      joinedAt: number | null;
    })[]
  >;
  // guild billboard (motd): the officer-set message + setter name on the guilds row
  setGuildMotd(guildId: number, motd: string, setBy: string): Promise<void>;
  guildMotd(guildId: number): Promise<{ motd: string; motdSetBy: string }>;
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
  // The actor's selected Book of Deeds title (a deed id, never display text),
  // read from the LIVE sim meta by the caller (game.ts actorFor). Absent when
  // the actor has no live meta or no title: an untitled relay line beats a
  // stale db read. SocialService itself stays sim-ignorant.
  activeTitle?: string | null;
  // The actor's class, read from the LIVE sim meta the same way activeTitle
  // is: guild/officer chat has no live entity for most recipients (guildmates
  // are frequently far outside interest scope), so the class rides the relay
  // event exactly like the title rather than being looked up client-side.
  cls?: PlayerClass;
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
  // An admin rename already committed in the DB. Update the online member's
  // live Sim state and notify their client without re-reading or rebuilding
  // the full social snapshot.
  onGuildRenamed(characterId: number, guildId: number, oldName: string, newName: string): void;
  // a character's block set changed; refresh the in-memory chat filter
  onBlocksChanged(characterId: number, blockedIds: number[]): void;
  // a character's ignore set changed; refresh the in-memory chat filter
  onIgnoresChanged(characterId: number, ignoredIds: number[]): void;
  // the character just FOUNDED a guild (create committed, never a join or a
  // refused create): the transport owner credits the founder's deed stat
  // (guildsFounded is the one server-produced DeedStatKey; see its doc in
  // src/sim/types.ts)
  onGuildFounded(characterId: number): void;
  // A guild membership or rank mutation just COMMITTED in the DB for this
  // character. The transport owner re-stamps the live sim SYNCHRONOUSLY (the
  // session-only PlayerMeta.guildMembership stamp plus the nameplate guild
  // name, one combined entry point), because the Guild Bank's officer-plus
  // gate reads the stamped rank: routing this through the async pushSnapshot
  // path alone would leave a stale-rank window between the DB commit and the
  // snapshot's arrival. Called with null on leave, kick, and disband. Offline
  // characters have no live sim state to stamp (the owner no-ops); the join
  // path re-stamps them from the snapshot chokepoint.
  onGuildMembershipChanged(
    characterId: number,
    membership: { guildId: number; guildName: string; rank: GuildRank } | null,
  ): void;
  // The guild CREATE just committed (the same success arm that stamps the
  // founder, after onGuildMembershipChanged). The transport owner seeds the
  // new guild's EMPTY book into the LIVE sim (ops never lazily create a book:
  // loadGuildBank is load-once, and a lazy book would shadow the persisted
  // row after a restart) and consumes the gate-reserved creation fee
  // (reserve-at-gate, state.md): the create_fee ledger row and the escrow
  // save of the already-charged purse.
  onGuildCreated(characterId: number, guildId: number): void;
  // The guild DELETE just committed (the empty-bank guard below passed). The
  // transport owner EVICTS the guild's book from the live sim so the map
  // stays bounded and a re-created guild id can never inherit a stale book;
  // the guild_banks row cascades away with the guilds DELETE.
  onGuildDisbanded(guildId: number): void;
  // OPEN the guild-delete window and report what the guild's LIVE bank book
  // holds, for the empty-bank guard both guild-deleting paths run. Returns
  // null when the guard must fail CLOSED: no book is loaded (an unloaded book
  // cannot prove the DB row is empty, and disbanding would cascade-delete it),
  // a session holds unflushed book work, or another delete already holds the
  // window.
  //
  // The window, not just the read, is the point. The guard is synchronous but
  // the DELETE is two awaits away, and dispatched guild bank ops are NOT
  // tick-gated: an op landing in that gap used to be destroyed outright by the
  // FK cascade with its dirty mark wiped by the post-commit hook. While the
  // window is held every guild bank op for that guild is refused, so the guard
  // still means what it says at the moment the row actually goes away.
  //
  // ONLY call endGuildBankDelete when this returned non-null: a null means the
  // window was not taken (possibly because someone else holds it), and
  // releasing it would open the gap under them.
  beginGuildBankDelete(guildId: number): { copper: number; items: number } | null;
  // CLOSE the window opened above. Must run on every arm (refusal, throw, or
  // commit), or that guild's bank stays refused until the realm restarts.
  endGuildBankDelete(guildId: number): void;
  // true if `recipientId` has `senderCharacterId` on their BLOCK list, so
  // guild/officer chat can honour the same filter say/whisper already apply
  isBlocking(recipientId: number, senderCharacterId: number): boolean;
  // true once `characterId`'s persisted block list has finished loading into
  // the live session (or the character is offline, where there is nothing to
  // load and no live presence to leak). While a just-joined character's block
  // list is still loading, isBlocking() above answers false for them the same
  // way an unset Set would, so a caller that skips this check can briefly
  // disclose presence across a block the target already placed. Mirrors the
  // canShowInWho fail-closed guard (server/game.ts) for the presence() /
  // announcePresence() paths in this file.
  blockListLoaded(characterId: number): boolean;
  // true if `recipientId` has `senderCharacterId` on their IGNORE list. Guild and
  // officer chat fan out through deliver() and never pass the routeEvents chat
  // filter, so they must consult the ignore list here, exactly as for blocks.
  isIgnoringChat(recipientId: number, senderCharacterId: number): boolean;
  // The sender's operator-set account flair (AI mark + streamer links), or undefined
  // for an ordinary player. For the SAME reason as isIgnoringChat above: guild and
  // officer chat never pass through routeEvents (which attaches flair to every other
  // chat channel), so without this a guild line from a streamer would arrive bare.
  chatFlairFor(senderCharacterId: number): ChatSenderFlair | undefined;
}

export type SocialEvent =
  | { type: 'log'; text: string; color?: string }
  | { type: 'error'; text: string }
  // `flair` mirrors the SimEvent chat variant (src/sim/types.ts): the SENDER's
  // account flair, attached at fan-out and absent for an ordinary player.
  // fromTitle mirrors the sim chat event's optional field (a deed id the
  // client localizes through deed_i18n, never display text); omitted for an
  // untitled sender.
  // classId mirrors the sim chat event's optional field the same way: the
  // sender's class, absent only when the actor has no live meta.
  | {
      type: 'chat';
      from: string;
      fromTitle?: string;
      text: string;
      channel: 'guild' | 'officer';
      flair?: ChatSenderFlair;
      classId?: PlayerClass;
    }
  | { type: 'guildInvite'; fromName: string; guildName: string }
  | { type: 'guildInviteCancelled' }
  | { type: 'guildRenamed'; guildId: number; newName: string }
  // Structured guild-calendar outcome; the client renders the visible line
  // from the code (the sim's mailResult convention, so no server English here).
  | { type: 'calendarResult'; code: CalendarResultCode }
  // Structured guild-billboard outcome, same convention as calendarResult.
  | { type: 'motdResult'; code: MotdResultCode }
  // A guildmate's or followed friend's marquee deed unlock. Carries the deed
  // ID only, never English (the client composes the line from deed_i18n plus
  // its own chrome key, the calendarResult convention).
  | { type: 'deedBroadcast'; characterName: string; deedId: string };

export type CalendarResultCode =
  | 'created'
  | 'removed'
  | 'notInGuild'
  | 'notOfficer'
  | 'badInput'
  | 'calendarFull'
  | 'eventGone';

// Guild billboard command outcomes ('set' is the success; the rest refusals).
export type MotdResultCode = 'set' | 'notInGuild' | 'notOfficer';

const FRIEND_LIMIT = 50;
const BLOCK_LIMIT = 50;
const IGNORE_LIMIT = 50;
// Exported because the admin guild backoffice enforces the same roster cap: the
// detail read pages the roster at it and the rename guard refuses above it. Two
// copies would drift the day the cap moves, leaving guilds between the values
// un-renameable and silently truncated in the dashboard.
export const GUILD_MEMBER_LIMIT = 100;
const GUILD_INVITE_TTL_MS = 60_000;
const GUILD_MESSAGE_MAX = 200;
// Guild billboard: the officer-set message pinned atop the Guild tab.
// Server-clamped; '' clears the billboard.
export const GUILD_MOTD_MAX = 240;
// Guild calendar: caps + input bounds. Events are UTC-day keyed ('YYYY-MM-DD',
// matching the sim's utcDay convention) and may be booked up to a year out.
const GUILD_EVENT_LIMIT = 25; // upcoming events per guild
const GUILD_EVENT_TITLE_MAX = 48;
const GUILD_EVENT_NOTE_MAX = 160;
const GUILD_EVENT_HORIZON_DAYS = 366;
const GUILD_EVENT_KEEP_PAST_DAYS = 2; // yesterday stays visible across timezones

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
  if (day > shiftDay(todayIso, GUILD_EVENT_HORIZON_DAYS)) return null;
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
    {
      guildId: number;
      guildName: string;
      fromCharacterId: number;
      fromName: string;
      expiresAt: number;
    }
  >();
  private pendingGuildInviteesByGuild = new Map<number, Set<number>>();

  constructor(
    private readonly db: SocialDb,
    private readonly tx: SocialTransport,
    private readonly now: () => number = () => Date.now(),
    // Guild-name content screen, injected so the service stays hermetic in tests:
    // production wires offensiveName from server/auth.ts (server/game.ts). Required
    // on purpose (no fail-open default): every construction site must decide what
    // it screens. Applies at creation only; existing guild names are never
    // retro-scanned here.
    private readonly isNameOffensive: (name: string) => boolean,
  ) {}

  // -------------------------------------------------------------------------
  // Snapshot (drives the client Social panel)
  // -------------------------------------------------------------------------

  async snapshot(charId: number): Promise<SocialSnapshot> {
    const [friends, blocks, ignores, membership] = await Promise.all([
      this.db.listFriends(charId),
      this.db.listBlocks(charId),
      this.db.listIgnores(charId),
      this.db.guildMembership(charId),
    ]);
    const blockedByViewer = new Set(blocks.map((b) => b.id));
    let guild: GuildView | null = null;
    if (membership) {
      const fromDay = shiftDay(this.todayIso(), -GUILD_EVENT_KEEP_PAST_DAYS);
      const [members, events, motd] = await Promise.all([
        this.db.guildMembers(membership.guildId),
        this.db.guildEvents(membership.guildId, fromDay),
        this.db.guildMotd(membership.guildId),
      ]);
      guild = {
        id: membership.guildId,
        name: membership.guildName,
        rank: membership.rank,
        motd: motd.motd,
        motdSetBy: motd.motdSetBy,
        members: members
          .map((m) => ({ ...m, ...this.presence(charId, m.id, blockedByViewer) }))
          .sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank) || a.name.localeCompare(b.name)),
        events,
      };
    }
    return {
      friends: friends
        .map((f) => ({ ...f, ...this.presence(charId, f.id, blockedByViewer) }))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
      blocks,
      ignores,
      guild,
    };
  }

  // Collapse a character's online presence into the fields a roster row needs.
  // A friend or guild edge can survive a block on either side (blockAdd only
  // ever cleans the blocker's OWN outgoing friend edge, and never touches guild
  // membership at all), so this hides live position and online status the same
  // way canShowInWho already hides /who visibility: bidirectionally, and
  // regardless of which side added the other or blocked the other.
  private presence(
    viewerCharId: number,
    otherCharId: number,
    viewerBlockedIds: Set<number>,
  ): {
    online: boolean;
    zone?: string;
    status?: PresenceStatus;
    x?: number;
    z?: number;
  } {
    if (
      otherCharId !== viewerCharId &&
      (viewerBlockedIds.has(otherCharId) ||
        !this.tx.blockListLoaded(otherCharId) ||
        this.tx.isBlocking(otherCharId, viewerCharId))
    ) {
      return { online: false };
    }
    const loc = this.tx.locationOf(otherCharId);
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

  private rememberGuildInvite(
    inviteeId: number,
    invite: {
      guildId: number;
      guildName: string;
      fromCharacterId: number;
      fromName: string;
      expiresAt: number;
    },
  ): void {
    this.takeGuildInvite(inviteeId);
    this.pendingGuildInvites.set(inviteeId, invite);
    let invitees = this.pendingGuildInviteesByGuild.get(invite.guildId);
    if (!invitees) {
      invitees = new Set<number>();
      this.pendingGuildInviteesByGuild.set(invite.guildId, invitees);
    }
    invitees.add(inviteeId);
  }

  private takeGuildInvite(inviteeId: number) {
    const invite = this.pendingGuildInvites.get(inviteeId);
    if (!invite) return undefined;
    this.pendingGuildInvites.delete(inviteeId);
    const invitees = this.pendingGuildInviteesByGuild.get(invite.guildId);
    invitees?.delete(inviteeId);
    if (invitees?.size === 0) this.pendingGuildInviteesByGuild.delete(invite.guildId);
    return invite;
  }

  // Called only after the admin DB transaction has committed. The bounded
  // member ids are already known to that transaction, so this path performs
  // no DB reads and never fans out full social snapshots. The cap below is
  // re-applied here on purpose rather than trusted from the caller: the two
  // bounds are independent, so dropping either one alone cannot turn this
  // into an unbounded fan-out.
  guildRenamed(
    guildId: number,
    oldName: string,
    newName: string,
    memberCharacterIds: readonly number[],
  ): void {
    const members = new Set<number>();
    for (const id of memberCharacterIds) {
      if (!Number.isInteger(id) || id <= 0) continue;
      members.add(id);
      if (members.size >= GUILD_MEMBER_LIMIT) break;
    }
    const invitees = [...(this.pendingGuildInviteesByGuild.get(guildId) ?? [])];
    for (const inviteeId of invitees) {
      const invite = this.takeGuildInvite(inviteeId);
      if (!invite) continue;
      const cancelled: SocialEvent[] = [{ type: 'guildInviteCancelled' }];
      this.tx.deliver(inviteeId, cancelled);
      if (invite.fromCharacterId !== inviteeId) {
        this.tx.deliver(invite.fromCharacterId, cancelled);
      }
    }

    for (const characterId of members) {
      if (this.tx.isOnline(characterId)) {
        this.tx.onGuildRenamed(characterId, guildId, oldName, newName);
      }
    }
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
        `You are blocking ${target.name}. Remove them from your block list first.`,
      );
      return;
    }
    const friends = await this.db.listFriends(actor.characterId);
    if (friends.some((f) => f.id === target.id)) {
      this.err(actor.characterId, `${target.name} is already your friend.`);
      return;
    }
    // A block is meant to be mutual (canShowInWho, broadcastDeedUnlock, and
    // guildInvite all enforce it both ways): if the TARGET has blocked the
    // actor, refuse the add too, or a blocked stalker could re-add the person
    // who blocked them and keep live-tracking their position and online
    // status through the one-directional friend list. The target may be
    // offline, so this reads the DB rather than the live session set. This
    // check runs AFTER the "already your friend" check above so re-running
    // `/friend add` on an existing friend edge always answers the same way,
    // even once the target blocks the actor: keeping the reply stable there
    // avoids handing a blocker-detection oracle to an already-added friend.
    const targetBlockedIds = await this.db.blockedIds(target.id);
    if (targetBlockedIds.includes(actor.characterId)) {
      this.err(actor.characterId, `You cannot add ${target.name} as a friend.`);
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
  // see a come-online / go-offline notice (and refresh their panel). Filtered
  // bidirectionally by block, the same as broadcastDeedUnlock: a friend-of-me
  // or guild edge on the OTHER side survives a block (blockAdd only cleans the
  // blocker's own outgoing friend edge, never guild membership), so without
  // this a blocked stalker (or someone the actor blocked) would keep hearing
  // the actor's login/logout and getting their panel refreshed with the
  // actor's live position.
  async announcePresence(actor: SocialActor, online: boolean): Promise<void> {
    const [watchers, actorBlockedIds] = await Promise.all([
      this.db.whoFriended(actor.characterId),
      this.db.blockedIds(actor.characterId),
    ]);
    const actorBlocked = new Set(actorBlockedIds);
    // Fail closed the same way presence() does: while otherId's own block
    // list is still loading (a just-joined watcher or guildmate), we cannot
    // yet tell whether they blocked the actor, so treat that as a block
    // rather than deliver the notice or refresh their panel.
    const blockedPair = (otherId: number): boolean =>
      actorBlocked.has(otherId) ||
      !this.tx.blockListLoaded(otherId) ||
      this.tx.isBlocking(otherId, actor.characterId);
    const notified = new Set<number>();
    for (const watcherId of watchers) {
      if (!this.tx.isOnline(watcherId)) continue;
      if (blockedPair(watcherId)) continue;
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
        if (blockedPair(m.id)) continue;
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
      this.err(actor.characterId, 'You cannot block yourself.');
      return;
    }
    const blocks = await this.db.listBlocks(actor.characterId);
    if (blocks.some((b) => b.id === target.id)) {
      this.err(actor.characterId, `${target.name} is already blocked.`);
      return;
    }
    if (blocks.length >= BLOCK_LIMIT) {
      this.err(actor.characterId, 'Your block list is full.');
      return;
    }
    await this.db.addBlock(actor.characterId, target.id);
    // blocking someone also drops them from your friends list
    await this.db.removeFriend(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} is now blocked.`);
    this.tx.onBlocksChanged(actor.characterId, await this.db.blockedIds(actor.characterId));
    this.push(actor.characterId);
    // The target's own panel must lose the actor's presence too, or it stays
    // frozen "online" on their side for the rest of the session (#2437).
    this.push(target.id);
  }

  async blockRemove(actor: SocialActor, name: string): Promise<void> {
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target) {
      this.err(actor.characterId, `No character named '${name}' on your block list.`);
      return;
    }
    const blocks = await this.db.listBlocks(actor.characterId);
    if (!blocks.some((b) => b.id === target.id)) {
      this.err(actor.characterId, `${target.name} is not on your block list.`);
      return;
    }
    await this.db.removeBlock(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} is no longer blocked.`);
    this.tx.onBlocksChanged(actor.characterId, await this.db.blockedIds(actor.characterId));
    this.push(actor.characterId);
    this.push(target.id);
  }

  // "/blocklist": echo the blocked names back to the actor.
  async blockList(actor: SocialActor): Promise<void> {
    const blocks = await this.db.listBlocks(actor.characterId);
    if (blocks.length === 0) {
      this.info(actor.characterId, 'Your block list is empty.');
      return;
    }
    this.info(
      actor.characterId,
      `Blocked (${blocks.length}): ${blocks.map((b) => b.name).join(', ')}`,
    );
  }

  // -------------------------------------------------------------------------
  // Ignores (chat-only). A block is the heavy tool: it also drops invites, mail,
  // whispers, and /who visibility. An ignore only hides their public chat from
  // you, so unlike a block it deliberately does NOT evict them from your friends
  // list: ignoring a chatty friend is a normal thing to want.
  //
  // NOT called a "mute": a mute in this game is the ADMIN account silence
  // (/mute "<name>" <minutes>, accounts.chat_muted_until), which is a staff
  // moderation action against a player, not a player's own preference.
  // -------------------------------------------------------------------------

  async ignoreAdd(actor: SocialActor, name: string): Promise<void> {
    const target = await this.resolveTarget(actor, name);
    if (!target) return;
    if (target.id === actor.characterId) {
      this.err(actor.characterId, 'You cannot ignore yourself.');
      return;
    }
    const ignores = await this.db.listIgnores(actor.characterId);
    if (ignores.some((i) => i.id === target.id)) {
      this.err(actor.characterId, `${target.name} is already ignored.`);
      return;
    }
    if (ignores.length >= IGNORE_LIMIT) {
      this.err(actor.characterId, 'Your ignore list is full.');
      return;
    }
    await this.db.addIgnore(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} is now ignored.`);
    this.tx.onIgnoresChanged(actor.characterId, await this.db.ignoredIds(actor.characterId));
    this.push(actor.characterId);
  }

  async ignoreRemove(actor: SocialActor, name: string): Promise<void> {
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target) {
      this.err(actor.characterId, `No character named '${name}' on your ignore list.`);
      return;
    }
    const ignores = await this.db.listIgnores(actor.characterId);
    if (!ignores.some((i) => i.id === target.id)) {
      this.err(actor.characterId, `${target.name} is not on your ignore list.`);
      return;
    }
    await this.db.removeIgnore(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} is no longer ignored.`);
    this.tx.onIgnoresChanged(actor.characterId, await this.db.ignoredIds(actor.characterId));
    this.push(actor.characterId);
  }

  // "/ignorelist": echo the ignored names back to the actor as a chat readout.
  async ignoreList(actor: SocialActor): Promise<void> {
    const ignores = await this.db.listIgnores(actor.characterId);
    if (ignores.length === 0) {
      this.info(actor.characterId, 'Your ignore list is empty.');
      return;
    }
    this.info(
      actor.characterId,
      `Ignored (${ignores.length}): ${ignores.map((i) => i.name).join(', ')}`,
    );
  }

  // -------------------------------------------------------------------------
  // Guilds
  // -------------------------------------------------------------------------

  // Returns true ONLY on the committed success arm; false on every refusal.
  // The caller reserved the creation fee at its dispatch gate (reserve-at-gate,
  // Guild Bank Phase 3 QA) and refunds it when this reports false (or throws).
  async guildCreate(actor: SocialActor, rawName: string): Promise<boolean> {
    const name = validateGuildName(rawName);
    if (!name) {
      this.err(actor.characterId, 'Guild names are 3-24 letters (spaces allowed).');
      return false;
    }
    // Content screen (server-authoritative; the client has no say): refuse an
    // offensive name before any row is created, so a refused create never exists.
    if (this.isNameOffensive(name)) {
      this.err(actor.characterId, 'That guild name is not allowed.');
      // false, never a bare return: the caller reserves the creation fee at the
      // dispatch gate and refunds on every falsy arm, so returning undefined
      // here would charge a founder for a guild that was never created.
      return false;
    }
    const result = await this.db.createGuildWithLeader(name, actor.characterId);
    if ('error' in result) {
      this.err(
        actor.characterId,
        result.error === 'name_taken'
          ? `A guild named '${name}' already exists.`
          : 'You are already in a guild.',
      );
      return false;
    }
    // Founder is seated as leader in the same transaction as the create: stamp
    // the live sim before any push resolves (the guild bank rank gate).
    this.tx.onGuildMembershipChanged(actor.characterId, {
      guildId: result.guildId,
      guildName: name,
      rank: 'leader',
    });
    // Same success arm, right after the stamp: seed the empty book into the
    // live sim and consume the gate-reserved creation fee (the create_fee
    // ledger row; the transport owner does both). A refused create above must
    // never reach this.
    this.tx.onGuildCreated(actor.characterId, result.guildId);
    // Founder credit rides the transport seam: soc_guild_founded reads the
    // guildsFounded deed stat, which only this success arm may ever produce
    // (a refused create above must never reach it).
    this.tx.onGuildFounded(actor.characterId);
    this.info(
      actor.characterId,
      `You found the guild <${name}>! You are its Guild Master.`,
      '#40ff7f',
    );
    this.push(actor.characterId);
    return true;
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
    // A target who has the inviter on their ignore list never sees the invite.
    // From the inviter's side this is indistinguishable from an ordinary
    // decline (guildDecline is silent): the usual confirmation, then nothing.
    // No pending state is created, so other guilds can still invite the target.
    if (this.tx.isBlocking(target.id, actor.characterId)) {
      this.info(actor.characterId, `You have invited ${target.name} to the guild.`);
      return;
    }
    this.rememberGuildInvite(target.id, {
      guildId: membership.guildId,
      guildName: membership.guildName,
      fromCharacterId: actor.characterId,
      fromName: actor.name,
      expiresAt: this.now() + GUILD_INVITE_TTL_MS,
    });
    this.tx.deliver(target.id, [
      { type: 'guildInvite', fromName: actor.name, guildName: membership.guildName },
    ]);
    this.info(actor.characterId, `You have invited ${target.name} to the guild.`);
  }

  async guildAccept(actor: SocialActor): Promise<void> {
    const invite = this.takeGuildInvite(actor.characterId);
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
    // Seated in the DB: stamp the live sim before any push resolves.
    this.tx.onGuildMembershipChanged(actor.characterId, {
      guildId: invite.guildId,
      guildName: invite.guildName,
      rank: 'member',
    });
    await this.broadcastGuild(invite.guildId, [
      { type: 'log', text: `${actor.name} has joined the guild.`, color: '#40ff7f' },
    ]);
    await this.pushGuild(invite.guildId);
  }

  guildDecline(actor: SocialActor): void {
    this.takeGuildInvite(actor.characterId);
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
    // Last member out DELETES the guild below, which cascades the guild_banks
    // row away exactly like /gdisband, so the SAME empty-bank guard must hold
    // here: a solo Guild Master's /gquit with a stocked bank would otherwise
    // destroy the book's copper and items. Checked BEFORE the member row is
    // removed, so a refusal leaves the membership untouched; fails CLOSED on
    // an unloaded book (null holdings), because an unloaded book cannot prove
    // the persisted row is empty.
    let deleteWindow = false;
    if (others.length === 0) {
      const holdings = this.tx.beginGuildBankDelete(membership.guildId);
      deleteWindow = holdings !== null;
      if (!holdings || holdings.copper > 0 || holdings.items > 0) {
        if (deleteWindow) this.tx.endGuildBankDelete(membership.guildId);
        this.err(
          actor.characterId,
          'The guild bank must be emptied before the guild can be disbanded.',
        );
        return;
      }
    }
    try {
      await this.finishGuildLeave(actor, membership, others);
    } finally {
      // The window spans the guard to the DELETE and its post-commit hooks;
      // releasing it early (or not at all) is what reopens the gap.
      if (deleteWindow) this.tx.endGuildBankDelete(membership.guildId);
    }
  }

  /** The committed tail of guildLeave, after the empty-bank guard: the member
   *  row, the stamp clear, and (for the last member out) the guilds DELETE that
   *  cascades the book row away. Split out so the caller can hold the
   *  guild-delete window across all of it with one try/finally. */
  private async finishGuildLeave(
    actor: SocialActor,
    membership: { guildId: number; guildName: string },
    others: { id: number }[],
  ): Promise<void> {
    await this.db.removeGuildMember(actor.characterId);
    // Removed in the DB: clear the live sim stamp before any push resolves
    // (both arms below; the guild bank rank gate must not see a stale rank).
    this.tx.onGuildMembershipChanged(actor.characterId, null);
    if (others.length === 0) {
      // last member out: the guild ceases to exist
      await this.db.deleteGuild(membership.guildId);
      // Committed: evict the (empty) book, the same post-DELETE hook as
      // guildDisband, so no stale book survives keyed to a dead guild id.
      this.tx.onGuildDisbanded(membership.guildId);
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
    const result = await this.db.transferGuildLeader(
      membership.guildId,
      actor.characterId,
      target.id,
    );
    if (result === 'no_guild') {
      this.err(actor.characterId, 'That guild no longer exists.');
      return;
    }
    if (result === 'not_leader') {
      // lost a race with another transfer between the checks above and here
      this.err(actor.characterId, 'Only the Guild Master may promote a new leader.');
      return;
    }
    if (result === 'not_member') {
      this.err(actor.characterId, `${target.name} is not in your guild.`);
      return;
    }
    // Both rows moved in one DB transaction (target -> leader, former leader
    // -> officer): stamp both live sims before any push resolves.
    this.tx.onGuildMembershipChanged(target.id, {
      guildId: membership.guildId,
      guildName: membership.guildName,
      rank: 'leader',
    });
    this.tx.onGuildMembershipChanged(actor.characterId, {
      guildId: membership.guildId,
      guildName: membership.guildName,
      rank: 'officer',
    });
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
    // The guild bank guard: the guilds DELETE below cascades the guild_banks
    // row away, so a disband while the bank holds ANY copper or item would
    // destroy them. The LIVE sim book is authoritative here (every flushed op
    // came from it); null means no book is loaded, which fails CLOSED, because
    // an unloaded book cannot prove the persisted row is empty (the oversized-
    // row boot skip is exactly this state, and its row must survive).
    //
    // The guard OPENS the guild-delete window and holds it all the way to the
    // DELETE: the guildMembers read below is an await, and a dispatched guild
    // bank op is not tick-gated, so an op landing in that gap was previously
    // destroyed by the cascade with its dirty mark wiped by onGuildDisbanded.
    const holdings = this.tx.beginGuildBankDelete(membership.guildId);
    if (!holdings || holdings.copper > 0 || holdings.items > 0) {
      if (holdings) this.tx.endGuildBankDelete(membership.guildId);
      this.err(
        actor.characterId,
        'The guild bank must be emptied before the guild can be disbanded.',
      );
      return;
    }
    try {
      const members = await this.db.guildMembers(membership.guildId);
      await this.db.deleteGuild(membership.guildId);
      // Committed: evict the (empty) book from the live sim AFTER the guard
      // passed, so the map stays bounded and a re-created guild id starts fresh.
      this.tx.onGuildDisbanded(membership.guildId);
      for (const m of members) {
        // Every member's stamp clears, online or not (the transport no-ops for
        // characters with no live session; they re-stamp null at next join).
        this.tx.onGuildMembershipChanged(m.id, null);
        if (this.tx.isOnline(m.id)) {
          this.info(m.id, `<${membership.guildName}> has been disbanded.`, '#ffd100');
          this.push(m.id);
        }
      }
    } finally {
      this.tx.endGuildBankDelete(membership.guildId);
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
    // Removed in the DB: clear the live sim stamp before any push resolves.
    this.tx.onGuildMembershipChanged(target.id, null);
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
    const moved = await this.db.setGuildRank(target.id, membership.guildId, rank);
    if (!moved) {
      // The target's row left this guild (a leave, kick, disband, or guild
      // switch committed between the membership read above and the UPDATE):
      // the predicated write matched no row, so NOTHING changed in the DB and
      // NOTHING may be stamped. Stamping here would assert a rank the DB
      // refused, which the guild bank's officer gate would honor: privilege
      // escalation with no corrective push (a removed character is no longer
      // in pushGuild's member list).
      this.err(actor.characterId, `${target.name} is not in your guild.`);
      return;
    }
    // Rank moved in the DB (row confirmed): stamp the live sim before any
    // push resolves. A demote lands on the guild bank's officer gate
    // IMMEDIATELY (the stale-rank window is privilege-escalation-shaped).
    this.tx.onGuildMembershipChanged(target.id, {
      guildId: membership.guildId,
      guildName: membership.guildName,
      rank,
    });
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
    // Built once for the whole fan-out, title and flair included: both belong to the
    // sender, not the recipient, so they are identical for every member who receives
    // the line.
    const event: SocialEvent = {
      type: 'chat',
      from: actor.name,
      ...(actor.activeTitle ? { fromTitle: actor.activeTitle } : {}),
      ...(actor.cls ? { classId: actor.cls } : {}),
      text,
      channel: 'guild',
      flair: this.tx.chatFlairFor(actor.characterId),
    };
    const members = await this.db.guildMembers(membership.guildId);
    for (const m of members) {
      if (!this.tx.isOnline(m.id)) continue;
      // a player who blocks or ignores the speaker does not see their guild chat
      // (the speaker always sees their own line); mirrors say/whisper filtering.
      // Guild chat never passes through routeEvents, so the ignore check has to
      // happen here or ignoring a guildmate would do nothing in this channel.
      if (m.id !== actor.characterId && this.tx.isBlocking(m.id, actor.characterId)) continue;
      if (m.id !== actor.characterId && this.tx.isIgnoringChat(m.id, actor.characterId)) continue;
      this.tx.deliver(m.id, [event]);
    }
    return true;
  }

  // Fan one marquee deed unlock out to the earner's online guildmates and the
  // players who friended the earner (friends are one-directional: whoever put
  // the earner on THEIR list chose to follow them, the position-push rule).
  // Pure delivery: the caller (game.ts) has already applied the marquee bar,
  // the retro gate, and the earner's opt-out; this resolves the audience and
  // filters it BIDIRECTIONALLY: each recipient's block list is honoured like
  // guild chat (a deed unlock is not chat, so the lighter chat-only ignore does
  // not hide it), and the earner's own block list also excludes a recipient
  // (blockAdd only unfriends the earner's edge, so a blocked follower would
  // otherwise stay in whoFriended and keep hearing these). The earner never
  // receives it (their own toast is client-side from the sim event).
  async broadcastDeedUnlock(actor: SocialActor, deedId: string): Promise<void> {
    const event: SocialEvent = { type: 'deedBroadcast', characterName: actor.name, deedId };
    const [membership, followerIds, earnerBlockedIds] = await Promise.all([
      this.db.guildMembership(actor.characterId),
      this.db.whoFriended(actor.characterId),
      this.db.blockedIds(actor.characterId),
    ]);
    const earnerBlocked = new Set(earnerBlockedIds);
    const audience = new Set<number>(followerIds);
    if (membership) {
      for (const m of await this.db.guildMembers(membership.guildId)) audience.add(m.id);
    }
    for (const id of audience) {
      if (id === actor.characterId) continue;
      if (!this.tx.isOnline(id)) continue;
      if (this.tx.isBlocking(id, actor.characterId)) continue;
      if (earnerBlocked.has(id)) continue;
      this.tx.deliver(id, [event]);
    }
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
    const event: SocialEvent = {
      type: 'chat',
      from: actor.name,
      ...(actor.activeTitle ? { fromTitle: actor.activeTitle } : {}),
      ...(actor.cls ? { classId: actor.cls } : {}),
      text,
      channel: 'officer',
      flair: this.tx.chatFlairFor(actor.characterId),
    };
    const members = await this.db.guildMembers(membership.guildId);
    for (const m of members) {
      if ((m.rank === 'officer' || m.rank === 'leader') && this.tx.isOnline(m.id)) {
        // honour the recipient's block and ignore lists, just like guild/say/whisper
        if (m.id !== actor.characterId && this.tx.isBlocking(m.id, actor.characterId)) continue;
        if (m.id !== actor.characterId && this.tx.isIgnoringChat(m.id, actor.characterId)) continue;
        this.tx.deliver(m.id, [event]);
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
      .slice(0, GUILD_EVENT_TITLE_MAX);
    const note = String(input.note ?? '')
      .trim()
      .slice(0, GUILD_EVENT_NOTE_MAX);
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
      shiftDay(today, -GUILD_EVENT_KEEP_PAST_DAYS),
    );
    const upcoming = await this.db.guildEventCount(membership.guildId, today);
    if (upcoming >= GUILD_EVENT_LIMIT) {
      this.calendarResult(actor.characterId, 'calendarFull');
      return;
    }
    await this.db.createGuildEvent(membership.guildId, actor.characterId, day, hour, title, note);
    this.calendarResult(actor.characterId, 'created');
    await this.pushGuild(membership.guildId);
  }

  // -------------------------------------------------------------------------
  // Guild billboard (motd)
  // -------------------------------------------------------------------------

  private motdResult(charId: number, code: MotdResultCode): void {
    this.tx.deliver(charId, [{ type: 'motdResult', code }]);
  }

  // Set (or clear, with '') the guild billboard. Officers + the Guild Master
  // only; the text is server-clamped and the wire layer has already run the
  // mute/rate/content gates (game.ts, the guild_event_create stack).
  async guildSetMotd(actor: SocialActor, rawText: string): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) {
      this.motdResult(actor.characterId, 'notInGuild');
      return;
    }
    if (membership.rank === 'member') {
      this.motdResult(actor.characterId, 'notOfficer');
      return;
    }
    let text = String(rawText ?? '')
      .trim()
      .slice(0, GUILD_MOTD_MAX);
    // The clamp slices UTF-16 code units, so a boundary landing inside a
    // surrogate pair (emoji-class codepoint) would store a lone surrogate that
    // pg encodes as U+FFFD; drop the orphaned half instead.
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
    await this.db.setGuildMotd(membership.guildId, text, text === '' ? '' : actor.name);
    this.motdResult(actor.characterId, 'set');
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
    this.takeGuildInvite(charId);
  }
}

function rankOrder(rank: GuildRank): number {
  return rank === 'leader' ? 0 : rank === 'officer' ? 1 : 2;
}
