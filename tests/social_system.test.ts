import { beforeEach, describe, expect, it } from 'vitest';
import {
  SocialService, validateGuildName,
  type CharInfo, type CharRef, type GuildDirectoryEntry, type GuildRank, type JoinRequestEntry,
  type Presence, type RecruitmentMode, type SocialDb, type SocialEvent, type SocialTransport,
} from '../server/social';
import { resolveRealm } from '../server/realm';

// ---------------------------------------------------------------------------
// In-memory fakes — let us exercise the full SocialService logic (friends,
// ignore, guilds, presence, chat routing) without Postgres or sockets.
// ---------------------------------------------------------------------------

class FakeDb implements SocialDb {
  private chars = new Map<number, CharInfo>();
  private friends = new Map<number, Set<number>>();
  private blocks = new Map<number, Set<number>>();
  private guilds = new Map<number, string>();
  private members = new Map<number, { guildId: number; rank: GuildRank }>();
  private listings = new Map<number, { isPublic: boolean; recruitment: RecruitmentMode }>();
  private requests = new Map<number, number>(); // characterId -> guildId
  private nextGuildId = 1;

  addChar(id: number, name: string, cls = 'warrior', level = 10, realm = 'Claudemoon'): void {
    this.chars.set(id, { id, name, cls, level, realm });
  }

  async findCharacterByName(name: string): Promise<CharInfo | null> {
    const trimmed = name.trim();
    const exact = [...this.chars.values()].find((c) => c.name === trimmed);
    if (exact) return exact;
    const ci = [...this.chars.values()].filter((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    return ci.length === 1 ? ci[0] : null;
  }
  async getCharacter(id: number): Promise<CharInfo | null> { return this.chars.get(id) ?? null; }

  async addFriend(c: number, f: number): Promise<void> { (this.friends.get(c) ?? this.friends.set(c, new Set()).get(c)!).add(f); }
  async removeFriend(c: number, f: number): Promise<void> { this.friends.get(c)?.delete(f); }
  async listFriends(c: number): Promise<CharInfo[]> {
    return [...(this.friends.get(c) ?? [])].map((id) => this.chars.get(id)!).filter(Boolean);
  }
  async whoFriended(c: number): Promise<number[]> {
    return [...this.friends.entries()].filter(([, set]) => set.has(c)).map(([id]) => id);
  }

  async addBlock(c: number, b: number): Promise<void> { (this.blocks.get(c) ?? this.blocks.set(c, new Set()).get(c)!).add(b); }
  async removeBlock(c: number, b: number): Promise<void> { this.blocks.get(c)?.delete(b); }
  async listBlocks(c: number): Promise<CharRef[]> {
    return [...(this.blocks.get(c) ?? [])].map((id) => { const ch = this.chars.get(id)!; return { id: ch.id, name: ch.name }; });
  }
  async blockedIds(c: number): Promise<number[]> { return [...(this.blocks.get(c) ?? [])]; }

  async createGuild(name: string): Promise<number> {
    if ([...this.guilds.values()].some((n) => n.toLowerCase() === name.toLowerCase())) throw new Error('duplicate guild');
    const id = this.nextGuildId++;
    this.guilds.set(id, name);
    return id;
  }
  async deleteGuild(id: number): Promise<void> {
    this.guilds.delete(id);
    this.listings.delete(id);
    for (const [cid, m] of [...this.members]) if (m.guildId === id) this.members.delete(cid);
    // FK CASCADE: dropping the guild drops its pending requests too
    for (const [cid, gid] of [...this.requests]) if (gid === id) this.requests.delete(cid);
  }
  async guildMembership(c: number): Promise<{ guildId: number; guildName: string; rank: GuildRank } | null> {
    const m = this.members.get(c);
    return m ? { guildId: m.guildId, guildName: this.guilds.get(m.guildId)!, rank: m.rank } : null;
  }
  async addGuildMember(guildId: number, c: number, rank: GuildRank): Promise<boolean> {
    // mirror the real INSERT ... SELECT ... ON CONFLICT: no row if the guild is
    // gone or the character is already in a guild (lost-race no-op).
    if (!this.guilds.has(guildId) || this.members.has(c)) return false;
    this.members.set(c, { guildId, rank });
    return true;
  }
  async removeGuildMember(c: number): Promise<void> { this.members.delete(c); }
  async setGuildRank(c: number, rank: GuildRank): Promise<void> { const m = this.members.get(c); if (m) m.rank = rank; }
  async guildMembers(guildId: number): Promise<(CharInfo & { rank: GuildRank })[]> {
    return [...this.members.entries()]
      .filter(([, m]) => m.guildId === guildId)
      .map(([cid, m]) => ({ ...this.chars.get(cid)!, rank: m.rank }));
  }

  async setGuildListing(guildId: number, isPublic: boolean, recruitment: RecruitmentMode): Promise<void> {
    this.listings.set(guildId, { isPublic, recruitment });
  }
  async guildListing(guildId: number): Promise<{ isPublic: boolean; recruitment: RecruitmentMode } | null> {
    if (!this.guilds.has(guildId)) return null;
    return this.listings.get(guildId) ?? { isPublic: false, recruitment: 'request' };
  }
  async guildDirectory(): Promise<GuildDirectoryEntry[]> {
    return [...this.guilds.entries()]
      .map(([id, name]) => ({ id, name, listing: this.listings.get(id) }))
      .filter((g) => g.listing?.isPublic)
      .map((g) => {
        const members = [...this.members.entries()].filter(([, m]) => m.guildId === g.id);
        const leader = members.find(([, m]) => m.rank === 'leader');
        return {
          id: g.id,
          name: g.name,
          memberCount: members.length,
          recruitment: g.listing!.recruitment,
          leaderName: leader ? this.chars.get(leader[0])!.name : null,
        };
      })
      .sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name));
  }
  async addJoinRequest(guildId: number, charId: number): Promise<void> { this.requests.set(charId, guildId); }
  async removeJoinRequest(charId: number): Promise<void> { this.requests.delete(charId); }
  async joinRequest(charId: number): Promise<{ guildId: number } | null> {
    const gid = this.requests.get(charId);
    return gid === undefined ? null : { guildId: gid };
  }
  async myJoinRequest(charId: number): Promise<{ guildId: number; guildName: string } | null> {
    // mirror the real realm-scoped INNER JOIN: no row when the target guild is
    // gone (FK cascade would clear it, but be belt-and-braces like the query)
    const gid = this.requests.get(charId);
    if (gid === undefined) return null;
    const name = this.guilds.get(gid);
    return name === undefined ? null : { guildId: gid, guildName: name };
  }
  async joinRequests(guildId: number): Promise<JoinRequestEntry[]> {
    return [...this.requests.entries()]
      .filter(([, gid]) => gid === guildId)
      .map(([cid]) => this.chars.get(cid)!);
  }
}

class FakeTransport implements SocialTransport {
  online = new Set<number>();
  presence = new Map<number, Presence>();
  delivered = new Map<number, SocialEvent[]>();
  snapshotCount = new Map<number, number>();
  blockSets = new Map<number, number[]>();

  constructor(private db: FakeDb) {}

  setOnline(id: number, p: Presence = { zone: 'Mirewood', status: 'online' }): void {
    this.online.add(id);
    this.presence.set(id, p);
  }
  setOffline(id: number): void { this.online.delete(id); this.presence.delete(id); }

  charCache = new Map<number, CharInfo>();
  byCharacterId(id: number) {
    const c = this.online.has(id) ? this.charCache.get(id) ?? null : null;
    return c ? { characterId: c.id, name: c.name } : null;
  }
  byName(_name: string) { return null; }
  isOnline(id: number): boolean { return this.online.has(id); }
  locationOf(id: number): Presence | null { return this.online.has(id) ? this.presence.get(id) ?? null : null; }
  deliver(id: number, events: SocialEvent[]): void {
    const arr = this.delivered.get(id) ?? [];
    arr.push(...events);
    this.delivered.set(id, arr);
  }
  pushSnapshot(id: number): void { this.snapshotCount.set(id, (this.snapshotCount.get(id) ?? 0) + 1); }
  onBlocksChanged(id: number, ids: number[]): void { this.blockSets.set(id, ids); }

  eventsFor(id: number): SocialEvent[] { return this.delivered.get(id) ?? []; }
  errorsFor(id: number): string[] { return this.eventsFor(id).filter((e) => e.type === 'error').map((e: any) => e.text); }
  textFor(id: number): string[] { return this.eventsFor(id).filter((e) => e.type === 'log' || e.type === 'chat').map((e: any) => e.text ?? ''); }
  clear(): void { this.delivered.clear(); this.snapshotCount.clear(); }
}

// Test harness: characters 1..N, with helpers to flip presence.
function setup() {
  const db = new FakeDb();
  const tx = new FakeTransport(db);
  let clock = 1000;
  const svc = new SocialService(db, tx, () => clock);
  const actors = new Map<number, { characterId: number; name: string }>();
  const add = (id: number, name: string, opts: { cls?: string; level?: number } = {}) => {
    db.addChar(id, name, opts.cls, opts.level);
    tx.charCache.set(id, { id, name, cls: opts.cls ?? 'warrior', level: opts.level ?? 10, realm: 'Claudemoon' });
    actors.set(id, { characterId: id, name });
  };
  return {
    db, tx, svc, actors, add,
    actor: (id: number) => actors.get(id)!,
    advance: (ms: number) => { clock += ms; },
  };
}

describe('resolveRealm', () => {
  it('accepts realm-style display names', () => {
    expect(resolveRealm('Claudemoon')).toBe('Claudemoon');
    expect(resolveRealm('Area 52')).toBe('Area 52');
    expect(resolveRealm("Mal'Ganis")).toBe("Mal'Ganis");
    expect(resolveRealm('  Ironforge  ')).toBe('Ironforge');
  });
  it('falls back to the default for empty or invalid names', () => {
    expect(resolveRealm(undefined)).toBe('Claudemoon');
    expect(resolveRealm('')).toBe('Claudemoon');
    expect(resolveRealm('x'.repeat(25))).toBe('Claudemoon');
    expect(resolveRealm('drop;table')).toBe('Claudemoon');
  });
});

describe('validateGuildName', () => {
  it('accepts 3-24 letters with single interior spaces', () => {
    expect(validateGuildName('Knights')).toBe('Knights');
    expect(validateGuildName('  Iron Vanguard ')).toBe('Iron Vanguard');
  });
  it('rejects too short, too long, digits, and doubled spaces', () => {
    expect(validateGuildName('ab')).toBeNull();
    expect(validateGuildName('x'.repeat(25))).toBeNull();
    expect(validateGuildName('Team99')).toBeNull();
    expect(validateGuildName('Iron  Vanguard')).toBeNull();
  });
});

describe('friends', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => { h = setup(); h.add(1, 'Aleph'); h.add(2, 'Bet'); });

  it('adds a friend and reflects it in the snapshot', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet');
    const snap = await h.svc.snapshot(1);
    expect(snap.friends.map((f) => f.name)).toEqual(['Bet']);
    expect(h.tx.errorsFor(1)).toHaveLength(0);
  });

  it('shows online friends first, with zone and status', async () => {
    h.add(3, 'Gimel');
    await h.svc.friendAdd(h.actor(1), 'Bet');
    await h.svc.friendAdd(h.actor(1), 'Gimel');
    h.tx.setOnline(3, { zone: 'Hollow Crypt', status: 'dungeon' });
    const snap = await h.svc.snapshot(1);
    expect(snap.friends[0].name).toBe('Gimel');
    expect(snap.friends[0].online).toBe(true);
    expect(snap.friends[0].zone).toBe('Hollow Crypt');
    expect(snap.friends[0].status).toBe('dungeon');
    expect(snap.friends[1].online).toBe(false);
    expect(snap.friends[1].zone).toBeUndefined();
  });

  it('refuses self-friending and duplicates', async () => {
    await h.svc.friendAdd(h.actor(1), 'Aleph');
    expect(h.tx.errorsFor(1).join()).toMatch(/yourself/i);
    await h.svc.friendAdd(h.actor(1), 'Bet');
    h.tx.clear();
    await h.svc.friendAdd(h.actor(1), 'Bet');
    expect(h.tx.errorsFor(1).join()).toMatch(/already your friend/i);
  });

  it('errors on an unknown name', async () => {
    await h.svc.friendAdd(h.actor(1), 'Nobody');
    expect(h.tx.errorsFor(1).join()).toMatch(/No character named/i);
  });

  it('removes a friend', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet');
    await h.svc.friendRemove(h.actor(1), 'Bet');
    expect((await h.svc.snapshot(1)).friends).toHaveLength(0);
  });

  it('notifies watching friends when a character comes online', async () => {
    // 1 has 2 on their friends list; 2 logs in
    await h.svc.friendAdd(h.actor(1), 'Bet');
    h.tx.setOnline(1);
    h.tx.clear();
    await h.svc.announcePresence(h.actor(2), true);
    expect(h.tx.textFor(1).join()).toMatch(/Bet has come online/);
    expect(h.tx.snapshotCount.get(1)).toBe(1);
  });
});

describe('ignore / block', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => { h = setup(); h.add(1, 'Aleph'); h.add(2, 'Bet'); });

  it('blocks a player and surfaces the updated block set to the transport', async () => {
    await h.svc.blockAdd(h.actor(1), 'Bet');
    expect((await h.svc.snapshot(1)).blocks.map((b) => b.name)).toEqual(['Bet']);
    expect(h.tx.blockSets.get(1)).toEqual([2]);
  });

  it('blocking someone also removes them from friends', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet');
    await h.svc.blockAdd(h.actor(1), 'Bet');
    const snap = await h.svc.snapshot(1);
    expect(snap.friends).toHaveLength(0);
    expect(snap.blocks.map((b) => b.name)).toEqual(['Bet']);
  });

  it('unblocks and clears the transport block set', async () => {
    await h.svc.blockAdd(h.actor(1), 'Bet');
    await h.svc.blockRemove(h.actor(1), 'Bet');
    expect((await h.svc.snapshot(1)).blocks).toHaveLength(0);
    expect(h.tx.blockSets.get(1)).toEqual([]);
  });

  it('refuses to block yourself', async () => {
    await h.svc.blockAdd(h.actor(1), 'Aleph');
    expect(h.tx.errorsFor(1).join()).toMatch(/yourself/i);
  });
});

describe('guilds', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
    h.add(1, 'Aleph'); h.add(2, 'Bet'); h.add(3, 'Gimel');
    h.tx.setOnline(1); h.tx.setOnline(2); h.tx.setOnline(3);
  });

  it('creates a guild with the founder as leader', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    const snap = await h.svc.snapshot(1);
    expect(snap.guild?.name).toBe('Iron Vanguard');
    expect(snap.guild?.rank).toBe('leader');
    expect(snap.guild?.members.map((m) => m.name)).toEqual(['Aleph']);
  });

  it('refreshes guildmates\' panels when a member comes online, even non-friends (#100)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    // Aleph and Bet are guildmates but NOT friends; Gimel is unrelated
    h.tx.clear();
    await h.svc.announcePresence(h.actor(2), true);
    expect(h.tx.snapshotCount.get(1) ?? 0).toBeGreaterThan(0); // guildmate refreshed
    expect(h.tx.snapshotCount.get(3) ?? 0).toBe(0); // unrelated player untouched
    expect(h.tx.snapshotCount.get(2) ?? 0).toBe(0); // the actor doesn't refresh itself here
  });

  it('does not double-notify someone who is both a friend and a guildmate (#100)', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet'); // Aleph friends Bet
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    await h.svc.announcePresence(h.actor(2), true);
    expect(h.tx.snapshotCount.get(1) ?? 0).toBe(1); // exactly one refresh, not two
  });

  it('rejects an invalid or duplicate guild name', async () => {
    await h.svc.guildCreate(h.actor(1), 'no');
    expect(h.tx.errorsFor(1).join()).toMatch(/3-24 letters/);
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    h.tx.clear();
    await h.svc.guildCreate(h.actor(2), 'iron vanguard');
    expect(h.tx.errorsFor(2).join()).toMatch(/already exists/i);
  });

  it('invites, accepts, and broadcasts the join to all members', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    expect(h.tx.eventsFor(2).some((e) => e.type === 'guildInvite')).toBe(true);
    await h.svc.guildAccept(h.actor(2));
    const snap = await h.svc.snapshot(2);
    expect(snap.guild?.name).toBe('Knights');
    expect(snap.guild?.rank).toBe('member');
    // leader saw the join broadcast
    expect(h.tx.textFor(1).join()).toMatch(/Bet has joined the guild/);
  });

  it('only officers and leaders may invite', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    await h.svc.guildInvite(h.actor(2), 'Gimel'); // Bet is a plain member
    expect(h.tx.errorsFor(2).join()).toMatch(/officers and the Guild Master/i);
  });

  it('promotes a member to officer who can then invite', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    expect((await h.svc.snapshot(2)).guild?.rank).toBe('officer');
    await h.svc.guildInvite(h.actor(2), 'Gimel');
    expect(h.tx.eventsFor(3).some((e) => e.type === 'guildInvite')).toBe(true);
  });

  it('awaits the rank-change broadcast so members reliably receive it', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    // Force the member lookup that broadcastGuild/pushGuild depend on to resolve
    // on a later macrotask. If guildSetRank fails to await the broadcast, the
    // promote notice will not have been delivered by the time the call resolves.
    const realMembers = h.db.guildMembers.bind(h.db);
    h.db.guildMembers = (guildId: number) =>
      new Promise((resolve) => { setTimeout(() => { void realMembers(guildId).then(resolve); }, 0); });
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    expect(h.tx.textFor(2).join()).toMatch(/Bet is now Officer/);
  });

  it('expires a stale invite', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    h.advance(61_000);
    await h.svc.guildAccept(h.actor(2));
    expect(h.tx.errorsFor(2).join()).toMatch(/expired/i);
    expect((await h.svc.snapshot(2)).guild).toBeNull();
  });

  it('routes guild chat only to guild members', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    const ok = await h.svc.guildChat(h.actor(1), 'hello guild');
    expect(ok).toBe(true);
    expect(h.tx.eventsFor(1).some((e) => e.type === 'chat' && e.channel === 'guild' && e.text === 'hello guild')).toBe(true);
    expect(h.tx.eventsFor(2).some((e) => e.type === 'chat' && e.text === 'hello guild')).toBe(true);
    expect(h.tx.eventsFor(3)).toHaveLength(0); // Gimel is not in the guild
  });

  it('blocks guild chat from a non-member', async () => {
    const ok = await h.svc.guildChat(h.actor(1), 'anyone there?');
    expect(ok).toBe(false);
    expect(h.tx.errorsFor(1).join()).toMatch(/not in a guild/i);
  });

  it('forbids the Guild Master from leaving while members remain (WoW rule)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    await h.svc.guildLeave(h.actor(1));
    expect(h.tx.errorsFor(1).join()).toMatch(/promote a new leader or disband/i);
    expect((await h.svc.snapshot(1)).guild?.rank).toBe('leader'); // still GM
  });

  it('transfers leadership explicitly, stepping the old leader down to officer', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildTransferLeader(h.actor(1), 'Bet');
    expect((await h.svc.snapshot(2)).guild?.rank).toBe('leader');
    expect((await h.db.guildMembership(1))?.rank).toBe('officer');
    // now the former leader (an officer) may leave normally
    await h.svc.guildLeave(h.actor(1));
    expect(await h.db.guildMembership(1)).toBeNull();
  });

  it('lets the Guild Master disband the whole guild', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    await h.svc.guildDisband(h.actor(1));
    expect((await h.svc.snapshot(1)).guild).toBeNull();
    expect((await h.svc.snapshot(2)).guild).toBeNull();
    expect(h.tx.textFor(2).join()).toMatch(/disbanded/i);
  });

  it('only officers+leader send and receive officer chat', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2)); // Bet is a plain member
    h.tx.clear();
    // a member can't use officer chat
    expect(await h.svc.officerChat(h.actor(2), 'secret')).toBe(false);
    expect(h.tx.errorsFor(2).join()).toMatch(/officers and the Guild Master/i);
    // promote Bet, then officer chat reaches both officers/leader
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    h.tx.clear();
    expect(await h.svc.officerChat(h.actor(1), 'officers only')).toBe(true);
    expect(h.tx.eventsFor(1).some((e) => e.type === 'chat' && e.channel === 'officer' && e.text === 'officers only')).toBe(true);
    expect(h.tx.eventsFor(2).some((e) => e.type === 'chat' && e.channel === 'officer')).toBe(true);
  });

  it('disbands the guild when the last member leaves', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildLeave(h.actor(1));
    expect((await h.svc.snapshot(1)).guild).toBeNull();
    // a fresh create of the same name must now succeed
    await h.svc.guildCreate(h.actor(2), 'Knights');
    expect((await h.svc.snapshot(2)).guild?.name).toBe('Knights');
  });

  it('lets a leader kick a member but not the reverse', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    await h.svc.guildKick(h.actor(2), 'Aleph'); // member can't kick
    expect(h.tx.errorsFor(2).join()).toMatch(/officers and the Guild Master/i);
    await h.svc.guildKick(h.actor(1), 'Bet'); // leader can
    expect((await h.svc.snapshot(2)).guild).toBeNull();
    expect(h.tx.textFor(2).join()).toMatch(/removed from/i);
  });

  it('prevents joining two guilds at once', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildCreate(h.actor(2), 'Raiders');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    h.tx.clear();
    await h.svc.guildInvite(h.actor(1), 'Bet');
    expect(h.tx.errorsFor(1).join()).toMatch(/already in a guild/i);
  });
});

describe('guild directory + request-to-join (#110)', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
    h.add(1, 'Aleph'); h.add(2, 'Bet'); h.add(3, 'Gimel'); h.add(4, 'Dalet');
    h.tx.setOnline(1); h.tx.setOnline(2); h.tx.setOnline(3); h.tx.setOnline(4);
  });

  it('hides unlisted guilds and lists ones the leader opts in', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    // not listed by default
    await h.svc.guildDirectory(h.actor(2));
    let dir = h.tx.eventsFor(2).find((e) => e.type === 'guildDirectory') as any;
    expect(dir.guilds).toHaveLength(0);
    // leader lists it
    h.tx.clear();
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    await h.svc.guildDirectory(h.actor(2));
    dir = h.tx.eventsFor(2).find((e) => e.type === 'guildDirectory') as any;
    expect(dir.guilds.map((g: any) => g.name)).toEqual(['Knights']);
    expect(dir.guilds[0].recruitment).toBe('request');
    expect(dir.guilds[0].leaderName).toBe('Aleph');
    expect(dir.guilds[0].memberCount).toBe(1);
  });

  it('only the leader may change the listing', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    await h.svc.guildSetListing(h.actor(2), true, 'open');
    expect(h.tx.errorsFor(2).join()).toMatch(/Only the Guild Master/i);
  });

  it('an open guild admits a requester instantly, broadcasting the join', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'open');
    const gid = (await h.db.guildMembership(1))!.guildId;
    h.tx.clear();
    await h.svc.guildRequestJoin(h.actor(2), gid);
    expect((await h.svc.snapshot(2)).guild?.name).toBe('Knights');
    expect((await h.svc.snapshot(2)).guild?.rank).toBe('member');
    expect(h.tx.textFor(1).join()).toMatch(/Bet has joined the guild/);
  });

  it('a request-mode guild queues the request for officers to approve', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid);
    // not yet a member
    expect((await h.svc.snapshot(2)).guild).toBeNull();
    // leader sees the request in their panel
    const leaderSnap = await h.svc.snapshot(1);
    expect(leaderSnap.guild?.requests.map((r) => r.name)).toEqual(['Bet']);
    // leader approves -> Bet joins
    await h.svc.guildApproveRequest(h.actor(1), 2);
    expect((await h.svc.snapshot(2)).guild?.name).toBe('Knights');
    expect((await h.svc.snapshot(1)).guild?.requests).toHaveLength(0);
  });

  it('plain members do not see or act on requests', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2)); // Bet is a plain member
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(3), gid); // Gimel requests
    // the plain member's snapshot hides requests
    expect((await h.svc.snapshot(2)).guild?.requests).toHaveLength(0);
    h.tx.clear();
    await h.svc.guildApproveRequest(h.actor(2), 3);
    expect(h.tx.errorsFor(2).join()).toMatch(/officers and the Guild Master/i);
  });

  it('denying a request removes it without admitting the applicant', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid);
    await h.svc.guildDenyRequest(h.actor(1), 2);
    expect((await h.svc.snapshot(1)).guild?.requests).toHaveLength(0);
    expect((await h.svc.snapshot(2)).guild).toBeNull();
  });

  it('refuses requests to an unlisted or closed guild', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    const gid = (await h.db.guildMembership(1))!.guildId;
    // unlisted
    await h.svc.guildRequestJoin(h.actor(2), gid);
    expect(h.tx.errorsFor(2).join()).toMatch(/not accepting join requests/i);
    // explicitly closed even though public flag is false
    h.tx.clear();
    await h.svc.guildSetListing(h.actor(1), false, 'open');
    await h.svc.guildRequestJoin(h.actor(2), gid);
    expect(h.tx.errorsFor(2).join()).toMatch(/not accepting join requests/i);
  });

  it('refuses to request while already in a guild', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'open');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildCreate(h.actor(2), 'Raiders');
    h.tx.clear();
    await h.svc.guildRequestJoin(h.actor(2), gid);
    expect(h.tx.errorsFor(2).join()).toMatch(/already in a guild/i);
  });

  it('respects the member cap on an open join and on approval', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'open');
    const gid = (await h.db.guildMembership(1))!.guildId;
    // fill the guild to the cap by stuffing the fake db directly
    for (let i = 100; i < 100 + 99; i++) { h.db.addChar(i, `Filler${i}`); await h.db.addGuildMember(gid, i, 'member'); }
    expect((await h.db.guildMembers(gid)).length).toBe(100);
    h.tx.clear();
    await h.svc.guildRequestJoin(h.actor(2), gid);
    expect(h.tx.errorsFor(2).join()).toMatch(/full/i);
    expect((await h.svc.snapshot(2)).guild).toBeNull();
  });

  it('a stale request cannot overflow a guild that filled after the request', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid); // Bet requests while there's room
    // guild fills up before the officer gets to it
    for (let i = 100; i < 100 + 99; i++) { h.db.addChar(i, `Filler${i}`); await h.db.addGuildMember(gid, i, 'member'); }
    h.tx.clear();
    await h.svc.guildApproveRequest(h.actor(1), 2);
    expect(h.tx.errorsFor(1).join()).toMatch(/full/i);
    expect((await h.svc.snapshot(2)).guild).toBeNull();
    // the now-unfulfillable request is cleared, not left dangling
    expect((await h.svc.snapshot(1)).guild?.requests).toHaveLength(0);
  });

  it('lets an applicant withdraw a pending request', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid);
    await h.svc.guildCancelRequest(h.actor(2));
    expect((await h.svc.snapshot(1)).guild?.requests).toHaveLength(0);
  });

  it('drops pending requests when the guild disbands', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid);
    await h.svc.guildDisband(h.actor(1));
    expect(await h.db.joinRequest(2)).toBeNull();
  });

  // --- authz on the request-resolution path (security-critical) ---

  it('an outsider (non-member) cannot approve a request', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid); // Bet requests
    // Dalet is in no guild at all
    h.tx.clear();
    await h.svc.guildApproveRequest(h.actor(4), 2);
    expect(h.tx.errorsFor(4).join()).toMatch(/not in a guild/i);
    // request untouched, Bet not admitted
    expect((await h.svc.snapshot(1)).guild?.requests.map((r) => r.name)).toEqual(['Bet']);
    expect((await h.svc.snapshot(2)).guild).toBeNull();
  });

  it('a plain member cannot deny a request', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2)); // Bet is a plain member
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(3), gid); // Gimel requests
    h.tx.clear();
    await h.svc.guildDenyRequest(h.actor(2), 3);
    expect(h.tx.errorsFor(2).join()).toMatch(/officers and the Guild Master/i);
    // request still pending (the leader still sees it)
    expect((await h.svc.snapshot(1)).guild?.requests.map((r) => r.name)).toEqual(['Gimel']);
  });

  it('an outsider from another guild cannot deny a request', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid); // Bet requests to Knights
    await h.svc.guildCreate(h.actor(3), 'Raiders'); // Gimel leads a different guild
    h.tx.clear();
    await h.svc.guildDenyRequest(h.actor(3), 2); // wrong-guild leader
    expect(h.tx.errorsFor(3).join()).toMatch(/no longer pending/i);
    expect((await h.svc.snapshot(1)).guild?.requests.map((r) => r.name)).toEqual(['Bet']);
  });

  it('does not falsely announce a join when the insert is a no-op (lost race)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'open');
    const gid = (await h.db.guildMembership(1))!.guildId;
    // Bet is already in another guild — simulates a racing membership that
    // lands between the guard check and the ON CONFLICT insert.
    await h.svc.guildCreate(h.actor(2), 'Raiders');
    // bypass the early "already in a guild" guard to exercise the no-op path
    // directly: force the membership check to miss once, then have the insert
    // hit ON CONFLICT.
    const realMembership = h.db.guildMembership.bind(h.db);
    let calls = 0;
    h.db.guildMembership = async (c: number) => {
      // first call (the early guard, for Bet) returns null to slip past it
      if (c === 2 && calls++ === 0) return null;
      return realMembership(c);
    };
    h.tx.clear();
    await h.svc.guildRequestJoin(h.actor(2), gid);
    h.db.guildMembership = realMembership;
    // no "you have joined" success, and no broadcast to the guild
    expect(h.tx.textFor(2).join()).not.toMatch(/have joined/i);
    expect(h.tx.errorsFor(2).join()).toMatch(/could not join/i);
    expect(h.tx.textFor(1).join()).not.toMatch(/has joined the guild/i);
    // Bet's real guild is unchanged (still Raiders, not Knights)
    expect((await h.svc.snapshot(2)).guild?.name).toBe('Raiders');
  });

  // --- requester-side pending state: snapshot.myRequest (#110) ---

  it('exposes myRequest to the requester after a pending request', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    // no request yet -> null
    expect((await h.svc.snapshot(2)).myRequest).toBeNull();
    await h.svc.guildRequestJoin(h.actor(2), gid);
    const snap = await h.svc.snapshot(2);
    expect(snap.guild).toBeNull(); // still not a member
    expect(snap.myRequest).toEqual({ guildId: gid, guildName: 'Knights' });
  });

  it('scopes myRequest to the requester — others do not see it', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid); // only Bet requests
    expect((await h.svc.snapshot(2)).myRequest).toEqual({ guildId: gid, guildName: 'Knights' });
    // a different guildless player has no request of their own
    expect((await h.svc.snapshot(3)).myRequest).toBeNull();
    // the leader (in a guild) sees the officer-facing request, not a myRequest
    const leaderSnap = await h.svc.snapshot(1);
    expect(leaderSnap.myRequest).toBeNull();
    expect(leaderSnap.guild?.requests.map((r) => r.name)).toEqual(['Bet']);
  });

  it('clears myRequest when the requester withdraws', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid);
    expect((await h.svc.snapshot(2)).myRequest).not.toBeNull();
    await h.svc.guildCancelRequest(h.actor(2));
    expect((await h.svc.snapshot(2)).myRequest).toBeNull();
    // and the request is gone from the officer-facing list too
    expect((await h.svc.snapshot(1)).guild?.requests).toHaveLength(0);
  });

  it('clears myRequest once the request is approved (now a member)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid);
    await h.svc.guildApproveRequest(h.actor(1), 2);
    const snap = await h.svc.snapshot(2);
    expect(snap.guild?.name).toBe('Knights'); // joined
    expect(snap.myRequest).toBeNull(); // no lingering pending state
  });

  it('does not expose myRequest after an instant open-guild join', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'open');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid); // open = instant join, no queued request
    const snap = await h.svc.snapshot(2);
    expect(snap.guild?.name).toBe('Knights');
    expect(snap.myRequest).toBeNull();
  });

  it('does not expose myRequest after the request is denied', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildSetListing(h.actor(1), true, 'request');
    const gid = (await h.db.guildMembership(1))!.guildId;
    await h.svc.guildRequestJoin(h.actor(2), gid);
    await h.svc.guildDenyRequest(h.actor(1), 2);
    const snap = await h.svc.snapshot(2);
    expect(snap.guild).toBeNull();
    expect(snap.myRequest).toBeNull();
  });
});
