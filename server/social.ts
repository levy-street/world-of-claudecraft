// Persistent social systems: friends, ignore/block lists, and guilds.
//
// Unlike parties/duels/trades (which live in the ephemeral Sim, keyed by
// transient entity ids), these outlive a play session and are keyed by
// character id. The business logic here is deliberately decoupled from both
// Postgres and the WebSocket layer: it talks to a `SocialDb` (so tests can use
// an in-memory fake) and a `SocialTransport` (so it can deliver messages to
// whoever happens to be online without knowing about sockets). game.ts wires
// the real Postgres + socket implementations in.

export type GuildRank = 'leader' | 'officer' | 'member';

// How outsiders may join a public guild (#110). Only meaningful while the
// guild is listed in the directory; 'closed' is the implicit mode of an
// unlisted guild (invite-only).
export type RecruitmentMode = 'closed' | 'request' | 'open';

// Where a character is and what they're doing, for friend/guild rosters.
// `realm` is the world/shard the character lives on (stored per character so
// it survives logout and is ready for future cross-realm play); `zone` and
// `status` are only meaningful while the character is online.
export type PresenceStatus = 'online' | 'combat' | 'dungeon' | 'dead';

export interface Presence {
  zone: string;
  status: PresenceStatus;
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
}

export interface GuildMemberEntry extends CharInfo {
  rank: GuildRank;
  online: boolean;
  zone?: string;
  status?: PresenceStatus;
}

// A pending request to join a guild, shown to officers/leader in their panel.
export interface JoinRequestEntry extends CharInfo {}

// One row in the public guild directory.
export interface GuildDirectoryEntry {
  id: number;
  name: string;
  memberCount: number;
  recruitment: RecruitmentMode;
  leaderName: string | null;
}

export interface GuildView {
  id: number;
  name: string;
  rank: GuildRank;
  // directory listing state, so the leader's panel can show/toggle it
  isPublic: boolean;
  recruitment: RecruitmentMode;
  members: GuildMemberEntry[];
  // outstanding join requests (only populated for officers + leader)
  requests: JoinRequestEntry[];
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
  // friends (one-directional, WoW-classic style: no acceptance needed)
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
  createGuild(name: string): Promise<number>; // returns guild id; throws on duplicate name
  deleteGuild(id: number): Promise<void>;
  guildMembership(charId: number): Promise<{ guildId: number; guildName: string; rank: GuildRank } | null>;
  // Returns true if the row was inserted, false if it was a no-op (the
  // character was already in a guild — ON CONFLICT, e.g. a lost join race).
  addGuildMember(guildId: number, charId: number, rank: GuildRank): Promise<boolean>;
  removeGuildMember(charId: number): Promise<void>;
  setGuildRank(charId: number, rank: GuildRank): Promise<void>;
  guildMembers(guildId: number): Promise<(CharInfo & { rank: GuildRank })[]>;
  // public directory + request-to-join (#110)
  setGuildListing(guildId: number, isPublic: boolean, recruitment: RecruitmentMode): Promise<void>;
  guildListing(guildId: number): Promise<{ isPublic: boolean; recruitment: RecruitmentMode } | null>;
  guildDirectory(): Promise<GuildDirectoryEntry[]>;
  addJoinRequest(guildId: number, charId: number): Promise<void>;
  removeJoinRequest(charId: number): Promise<void>;
  joinRequest(charId: number): Promise<{ guildId: number } | null>;
  joinRequests(guildId: number): Promise<JoinRequestEntry[]>;
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
}

export type SocialEvent =
  | { type: 'log'; text: string; color?: string }
  | { type: 'error'; text: string }
  | { type: 'chat'; from: string; text: string; channel: 'guild' | 'officer' }
  | { type: 'guildInvite'; fromName: string; guildName: string }
  // response to a directory browse request (#110)
  | { type: 'guildDirectory'; guilds: GuildDirectoryEntry[] };

const FRIEND_LIMIT = 50;
const BLOCK_LIMIT = 50;
const GUILD_MEMBER_LIMIT = 100;
const GUILD_INVITE_TTL_MS = 60_000;
const GUILD_MESSAGE_MAX = 200;

export function validateGuildName(name: string): string | null {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 3 || trimmed.length > 24) return null;
  // letters and single interior spaces only — keeps the channel header tidy
  if (!/^[A-Za-z][A-Za-z ]*[A-Za-z]$/.test(trimmed)) return null;
  if (/\s{2,}/.test(trimmed)) return null;
  return trimmed;
}

const RANK_LABEL: Record<GuildRank, string> = { leader: 'Guild Master', officer: 'Officer', member: 'Member' };
const RECRUIT_LABEL: Record<RecruitmentMode, string> = { closed: 'invite only', request: 'request to join', open: 'open recruitment' };

export class SocialService {
  private pendingGuildInvites = new Map<number, { guildId: number; guildName: string; fromName: string; expiresAt: number }>();

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
      const isOfficer = membership.rank !== 'member';
      const [members, listing, requests] = await Promise.all([
        this.db.guildMembers(membership.guildId),
        this.db.guildListing(membership.guildId),
        // only officers + leader see (and act on) pending join requests
        isOfficer ? this.db.joinRequests(membership.guildId) : Promise.resolve([]),
      ]);
      guild = {
        id: membership.guildId,
        name: membership.guildName,
        rank: membership.rank,
        isPublic: listing?.isPublic ?? false,
        recruitment: listing?.recruitment ?? 'request',
        members: members
          .map((m) => ({ ...m, ...this.presence(m.id) }))
          .sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank) || a.name.localeCompare(b.name)),
        requests: requests.sort((a, b) => a.name.localeCompare(b.name)),
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
  private presence(charId: number): { online: boolean; zone?: string; status?: PresenceStatus } {
    const loc = this.tx.locationOf(charId);
    return loc ? { online: true, zone: loc.zone, status: loc.status } : { online: false };
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
    if (!wanted) { this.err(actor.characterId, 'Specify a character name.'); return null; }
    const target = await this.db.findCharacterByName(wanted);
    if (!target) { this.err(actor.characterId, `No character named '${wanted}' exists.`); return null; }
    return target;
  }

  // -------------------------------------------------------------------------
  // Friends
  // -------------------------------------------------------------------------

  async friendAdd(actor: SocialActor, name: string): Promise<void> {
    const target = await this.resolveTarget(actor, name);
    if (!target) return;
    if (target.id === actor.characterId) { this.err(actor.characterId, 'You cannot befriend yourself.'); return; }
    const friends = await this.db.listFriends(actor.characterId);
    if (friends.some((f) => f.id === target.id)) { this.err(actor.characterId, `${target.name} is already your friend.`); return; }
    if (friends.length >= FRIEND_LIMIT) { this.err(actor.characterId, 'Your friends list is full.'); return; }
    await this.db.addFriend(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} added to friends.`);
    this.push(actor.characterId);
  }

  async friendRemove(actor: SocialActor, name: string): Promise<void> {
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target) { this.err(actor.characterId, `No character named '${name}' on your friends list.`); return; }
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
      this.tx.deliver(watcherId, [{
        type: 'log',
        text: online ? `${actor.name} has come online.` : `${actor.name} has gone offline.`,
        color: '#7fd4ff',
      }]);
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
    if (target.id === actor.characterId) { this.err(actor.characterId, 'You cannot ignore yourself.'); return; }
    const blocks = await this.db.listBlocks(actor.characterId);
    if (blocks.some((b) => b.id === target.id)) { this.err(actor.characterId, `${target.name} is already ignored.`); return; }
    if (blocks.length >= BLOCK_LIMIT) { this.err(actor.characterId, 'Your ignore list is full.'); return; }
    await this.db.addBlock(actor.characterId, target.id);
    // ignoring someone also drops them from your friends list
    await this.db.removeFriend(actor.characterId, target.id);
    this.info(actor.characterId, `${target.name} is now ignored.`);
    this.tx.onBlocksChanged(actor.characterId, await this.db.blockedIds(actor.characterId));
    this.push(actor.characterId);
  }

  async blockRemove(actor: SocialActor, name: string): Promise<void> {
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target) { this.err(actor.characterId, `No character named '${name}' on your ignore list.`); return; }
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
    if (!name) { this.err(actor.characterId, 'Guild names are 3-24 letters (spaces allowed).'); return; }
    if (await this.db.guildMembership(actor.characterId)) { this.err(actor.characterId, 'You are already in a guild.'); return; }
    let guildId: number;
    try {
      guildId = await this.db.createGuild(name);
    } catch {
      this.err(actor.characterId, `A guild named '${name}' already exists.`);
      return;
    }
    await this.db.addGuildMember(guildId, actor.characterId, 'leader');
    this.info(actor.characterId, `You found the guild <${name}>! You are its Guild Master.`, '#40ff7f');
    this.push(actor.characterId);
  }

  async guildInvite(actor: SocialActor, name: string): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    if (membership.rank === 'member') { this.err(actor.characterId, 'Only officers and the Guild Master may invite.'); return; }
    const target = await this.resolveTarget(actor, name);
    if (!target) return;
    if (target.id === actor.characterId) { this.err(actor.characterId, 'You are already in the guild.'); return; }
    if (!this.tx.isOnline(target.id)) { this.err(actor.characterId, `${target.name} must be online to be invited.`); return; }
    if (await this.db.guildMembership(target.id)) { this.err(actor.characterId, `${target.name} is already in a guild.`); return; }
    const members = await this.db.guildMembers(membership.guildId);
    if (members.length >= GUILD_MEMBER_LIMIT) { this.err(actor.characterId, 'Your guild is full.'); return; }
    this.pendingGuildInvites.set(target.id, {
      guildId: membership.guildId,
      guildName: membership.guildName,
      fromName: actor.name,
      expiresAt: this.now() + GUILD_INVITE_TTL_MS,
    });
    this.tx.deliver(target.id, [{ type: 'guildInvite', fromName: actor.name, guildName: membership.guildName }]);
    this.info(actor.characterId, `You have invited ${target.name} to the guild.`);
  }

  async guildAccept(actor: SocialActor): Promise<void> {
    const invite = this.pendingGuildInvites.get(actor.characterId);
    this.pendingGuildInvites.delete(actor.characterId);
    if (!invite || invite.expiresAt < this.now()) { this.err(actor.characterId, 'The guild invitation has expired.'); return; }
    if (await this.db.guildMembership(actor.characterId)) { this.err(actor.characterId, 'You are already in a guild.'); return; }
    const members = await this.db.guildMembers(invite.guildId);
    if (members.length === 0) { this.err(actor.characterId, 'That guild no longer exists.'); return; }
    if (members.length >= GUILD_MEMBER_LIMIT) { this.err(actor.characterId, 'That guild is full.'); return; }
    await this.db.addGuildMember(invite.guildId, actor.characterId, 'member');
    await this.broadcastGuild(invite.guildId, [{ type: 'log', text: `${actor.name} has joined the guild.`, color: '#40ff7f' }]);
    await this.pushGuild(invite.guildId);
  }

  guildDecline(actor: SocialActor): void {
    this.pendingGuildInvites.delete(actor.characterId);
  }

  async guildLeave(actor: SocialActor): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    const members = await this.db.guildMembers(membership.guildId);
    const others = members.filter((m) => m.id !== actor.characterId);
    // WoW rule: the Guild Master cannot quit while others remain — they must
    // hand leadership over (Promote to Guild Master) or disband the guild.
    if (membership.rank === 'leader' && others.length > 0) {
      this.err(actor.characterId, 'As Guild Master you must promote a new leader or disband the guild before leaving.');
      return;
    }
    await this.db.removeGuildMember(actor.characterId);
    if (others.length === 0) {
      // last member out: the guild ceases to exist
      await this.db.deleteGuild(membership.guildId);
      this.info(actor.characterId, `You have left <${membership.guildName}>. The guild has disbanded.`, '#ffd100');
    } else {
      await this.broadcastGuild(membership.guildId, [{ type: 'log', text: `${actor.name} has left the guild.`, color: '#ffd100' }]);
      this.info(actor.characterId, `You have left <${membership.guildName}>.`);
      await this.pushGuild(membership.guildId);
    }
    this.push(actor.characterId);
  }

  // WoW /gleader: hand the Guild Master title to another member. The former
  // leader steps down to Officer.
  async guildTransferLeader(actor: SocialActor, name: string): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    if (membership.rank !== 'leader') { this.err(actor.characterId, 'Only the Guild Master may promote a new leader.'); return; }
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target || target.id === actor.characterId) { this.err(actor.characterId, `No such guild member '${name}'.`); return; }
    const targetMembership = await this.db.guildMembership(target.id);
    if (!targetMembership || targetMembership.guildId !== membership.guildId) {
      this.err(actor.characterId, `${target.name} is not in your guild.`); return;
    }
    await this.db.setGuildRank(target.id, 'leader');
    await this.db.setGuildRank(actor.characterId, 'officer');
    await this.broadcastGuild(membership.guildId, [
      { type: 'log', text: `${target.name} is now the Guild Master of <${membership.guildName}>.`, color: '#ffd100' },
    ]);
    await this.pushGuild(membership.guildId);
  }

  // WoW /gdisband: the Guild Master dissolves the entire guild.
  async guildDisband(actor: SocialActor): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    if (membership.rank !== 'leader') { this.err(actor.characterId, 'Only the Guild Master may disband the guild.'); return; }
    const members = await this.db.guildMembers(membership.guildId);
    await this.db.deleteGuild(membership.guildId);
    for (const m of members) {
      if (this.tx.isOnline(m.id)) {
        this.info(m.id, `<${membership.guildName}> has been disbanded.`, '#ffd100');
        this.push(m.id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public directory + request-to-join (#110)
  // -------------------------------------------------------------------------

  // Leader-only: list the guild in the public directory and choose how
  // outsiders may join ('request' = approval queue, 'open' = instant join).
  // Passing isPublic=false unlists the guild (recruitment is then irrelevant).
  async guildSetListing(actor: SocialActor, isPublic: boolean, recruitment: RecruitmentMode): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    if (membership.rank !== 'leader') { this.err(actor.characterId, 'Only the Guild Master may change the guild listing.'); return; }
    if (recruitment !== 'closed' && recruitment !== 'request' && recruitment !== 'open') {
      this.err(actor.characterId, 'Invalid recruitment mode.'); return;
    }
    // an unlisted guild is closed to outside joins regardless of the mode sent
    const mode: RecruitmentMode = isPublic ? recruitment : 'closed';
    await this.db.setGuildListing(membership.guildId, isPublic, mode);
    this.info(
      actor.characterId,
      isPublic
        ? `<${membership.guildName}> is now listed in the guild directory (${RECRUIT_LABEL[mode]}).`
        : `<${membership.guildName}> is no longer listed in the guild directory.`,
      '#40ff7f',
    );
    await this.pushGuild(membership.guildId);
  }

  // Anyone: browse the public directory. Delivered as a one-shot event.
  async guildDirectory(actor: SocialActor): Promise<void> {
    const guilds = await this.db.guildDirectory();
    this.tx.deliver(actor.characterId, [{ type: 'guildDirectory', guilds }]);
  }

  // Ask to join a public guild. 'open' guilds admit instantly (still subject to
  // the member cap, and ON CONFLICT keeps the single-guild PK); 'request' guilds
  // queue the request for an officer to approve. Reuses the existing app-level
  // member-cap + membership rules (unchanged), same as invite-accept.
  async guildRequestJoin(actor: SocialActor, guildId: number): Promise<void> {
    if (await this.db.guildMembership(actor.characterId)) { this.err(actor.characterId, 'You are already in a guild.'); return; }
    const listing = await this.db.guildListing(guildId);
    if (!listing || !listing.isPublic || listing.recruitment === 'closed') {
      this.err(actor.characterId, 'That guild is not accepting join requests.'); return;
    }
    const members = await this.db.guildMembers(guildId);
    if (members.length === 0) { this.err(actor.characterId, 'That guild no longer exists.'); return; }
    if (members.length >= GUILD_MEMBER_LIMIT) { this.err(actor.characterId, 'That guild is full.'); return; }
    const guildName = await this.guildNameOf(guildId, members);
    if (listing.recruitment === 'open') {
      await this.db.removeJoinRequest(actor.characterId);
      // Only announce + broadcast when the insert actually landed. ON CONFLICT
      // makes a lost race (already guilded) a no-op; don't claim a join that
      // didn't happen.
      const joined = await this.db.addGuildMember(guildId, actor.characterId, 'member');
      if (!joined) { this.err(actor.characterId, 'Could not join that guild.'); return; }
      this.info(actor.characterId, `You have joined <${guildName}>.`, '#40ff7f');
      await this.broadcastGuild(guildId, [{ type: 'log', text: `${actor.name} has joined the guild.`, color: '#40ff7f' }]);
      await this.pushGuild(guildId);
      this.push(actor.characterId);
      return;
    }
    // request mode: queue it and let officers know
    const existing = await this.db.joinRequest(actor.characterId);
    if (existing && existing.guildId === guildId) { this.err(actor.characterId, `You already have a pending request to <${guildName}>.`); return; }
    await this.db.addJoinRequest(guildId, actor.characterId);
    this.info(actor.characterId, `Your request to join <${guildName}> has been sent.`, '#40ff7f');
    await this.notifyOfficers(guildId, members, `${actor.name} has requested to join the guild.`);
    await this.pushGuild(guildId);
  }

  // Withdraw your own pending request.
  async guildCancelRequest(actor: SocialActor): Promise<void> {
    const existing = await this.db.joinRequest(actor.characterId);
    if (!existing) { this.err(actor.characterId, 'You have no pending guild request.'); return; }
    await this.db.removeJoinRequest(actor.characterId);
    this.info(actor.characterId, 'Your guild request has been withdrawn.');
    await this.pushGuild(existing.guildId);
  }

  // Officer/leader: admit a pending requester. Re-checks the cap and that the
  // requester is still guildless, so a stale request can't overflow the guild.
  async guildApproveRequest(actor: SocialActor, charId: number): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    if (membership.rank === 'member') { this.err(actor.characterId, 'Only officers and the Guild Master may approve requests.'); return; }
    const request = await this.db.joinRequest(charId);
    if (!request || request.guildId !== membership.guildId) { this.err(actor.characterId, 'That request is no longer pending.'); return; }
    // clear the request regardless — it is being resolved one way or another
    await this.db.removeJoinRequest(charId);
    const target = await this.db.getCharacter(charId);
    const targetName = target?.name ?? 'The applicant';
    if (await this.db.guildMembership(charId)) { this.err(actor.characterId, `${targetName} is already in a guild.`); await this.pushGuild(membership.guildId); return; }
    const members = await this.db.guildMembers(membership.guildId);
    if (members.length >= GUILD_MEMBER_LIMIT) { this.err(actor.characterId, 'Your guild is full.'); await this.pushGuild(membership.guildId); return; }
    const added = await this.db.addGuildMember(membership.guildId, charId, 'member');
    if (!added) { this.err(actor.characterId, `${targetName} could not be added to the guild.`); await this.pushGuild(membership.guildId); return; }
    if (this.tx.isOnline(charId)) {
      this.info(charId, `Your request to join <${membership.guildName}> was accepted.`, '#40ff7f');
      this.push(charId);
    }
    await this.broadcastGuild(membership.guildId, [{ type: 'log', text: `${targetName} has joined the guild.`, color: '#40ff7f' }]);
    await this.pushGuild(membership.guildId);
  }

  // Officer/leader: reject a pending requester.
  async guildDenyRequest(actor: SocialActor, charId: number): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    if (membership.rank === 'member') { this.err(actor.characterId, 'Only officers and the Guild Master may deny requests.'); return; }
    const request = await this.db.joinRequest(charId);
    if (!request || request.guildId !== membership.guildId) { this.err(actor.characterId, 'That request is no longer pending.'); return; }
    await this.db.removeJoinRequest(charId);
    const target = await this.db.getCharacter(charId);
    if (target && this.tx.isOnline(charId)) {
      this.info(charId, `Your request to join <${membership.guildName}> was declined.`, '#ffd100');
    }
    this.info(actor.characterId, `Request from ${target?.name ?? 'the applicant'} declined.`);
    await this.pushGuild(membership.guildId);
  }

  private async guildNameOf(guildId: number, members: (CharInfo & { rank: GuildRank })[]): Promise<string> {
    const leader = members.find((m) => m.rank === 'leader');
    if (leader) {
      const m = await this.db.guildMembership(leader.id);
      if (m && m.guildId === guildId) return m.guildName;
    }
    // fall back to any member's membership row for the canonical name
    for (const member of members) {
      const m = await this.db.guildMembership(member.id);
      if (m && m.guildId === guildId) return m.guildName;
    }
    return 'the guild';
  }

  private async notifyOfficers(guildId: number, members: (CharInfo & { rank: GuildRank })[], text: string): Promise<void> {
    for (const m of members) {
      if ((m.rank === 'officer' || m.rank === 'leader') && this.tx.isOnline(m.id)) {
        this.tx.deliver(m.id, [{ type: 'log', text, color: '#7fd4ff' }]);
      }
    }
  }

  async guildKick(actor: SocialActor, name: string): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    if (membership.rank === 'member') { this.err(actor.characterId, 'Only officers and the Guild Master may remove members.'); return; }
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target) { this.err(actor.characterId, `No character named '${name}'.`); return; }
    if (target.id === actor.characterId) { this.err(actor.characterId, 'Use Leave Guild to remove yourself.'); return; }
    const targetMembership = await this.db.guildMembership(target.id);
    if (!targetMembership || targetMembership.guildId !== membership.guildId) {
      this.err(actor.characterId, `${target.name} is not in your guild.`); return;
    }
    if (targetMembership.rank === 'leader') { this.err(actor.characterId, 'You cannot remove the Guild Master.'); return; }
    if (targetMembership.rank === 'officer' && membership.rank !== 'leader') {
      this.err(actor.characterId, 'Only the Guild Master may remove an officer.'); return;
    }
    await this.db.removeGuildMember(target.id);
    if (this.tx.isOnline(target.id)) {
      this.info(target.id, `You have been removed from <${membership.guildName}>.`, '#ffd100');
      this.push(target.id);
    }
    await this.broadcastGuild(membership.guildId, [{ type: 'log', text: `${target.name} has been removed from the guild by ${actor.name}.`, color: '#ffd100' }]);
    await this.pushGuild(membership.guildId);
  }

  async guildSetRank(actor: SocialActor, name: string, rank: GuildRank): Promise<void> {
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return; }
    if (membership.rank !== 'leader') { this.err(actor.characterId, 'Only the Guild Master may change ranks.'); return; }
    if (rank === 'leader') { this.err(actor.characterId, 'Use a guild transfer to hand over leadership.'); return; }
    const target = await this.db.findCharacterByName(String(name ?? '').trim());
    if (!target || target.id === actor.characterId) { this.err(actor.characterId, `No such guild member '${name}'.`); return; }
    const targetMembership = await this.db.guildMembership(target.id);
    if (!targetMembership || targetMembership.guildId !== membership.guildId) {
      this.err(actor.characterId, `${target.name} is not in your guild.`); return;
    }
    if (targetMembership.rank === rank) { this.err(actor.characterId, `${target.name} is already ${RANK_LABEL[rank]}.`); return; }
    await this.db.setGuildRank(target.id, rank);
    await this.broadcastGuild(membership.guildId, [{ type: 'log', text: `${target.name} is now ${RANK_LABEL[rank]}.`, color: '#40ff7f' }]);
    await this.pushGuild(membership.guildId);
  }

  async guildChat(actor: SocialActor, rawText: string): Promise<boolean> {
    const text = String(rawText ?? '').trim().slice(0, GUILD_MESSAGE_MAX);
    if (!text) return false;
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return false; }
    await this.broadcastGuild(membership.guildId, [{ type: 'chat', from: actor.name, text, channel: 'guild' }]);
    return true;
  }

  // WoW officer chat (/o): officers + Guild Master only, delivered to the same.
  async officerChat(actor: SocialActor, rawText: string): Promise<boolean> {
    const text = String(rawText ?? '').trim().slice(0, GUILD_MESSAGE_MAX);
    if (!text) return false;
    const membership = await this.db.guildMembership(actor.characterId);
    if (!membership) { this.err(actor.characterId, 'You are not in a guild.'); return false; }
    if (membership.rank === 'member') { this.err(actor.characterId, 'Only officers and the Guild Master can use officer chat.'); return false; }
    const members = await this.db.guildMembers(membership.guildId);
    for (const m of members) {
      if ((m.rank === 'officer' || m.rank === 'leader') && this.tx.isOnline(m.id)) {
        this.tx.deliver(m.id, [{ type: 'chat', from: actor.name, text, channel: 'officer' }]);
      }
    }
    return true;
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
