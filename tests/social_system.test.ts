import { beforeEach, describe, expect, it } from 'vitest';
import { resolveRealm } from '../server/realm';
import {
  type CharInfo,
  type CharRef,
  type GuildEventRow,
  type GuildRank,
  type Presence,
  type SocialDb,
  type SocialEvent,
  SocialService,
  type SocialTransport,
  validateGuildName,
} from '../server/social';
import type { ChatSenderFlair } from '../src/sim/account_flair';
import type { SimEvent } from '../src/sim/types';

// ---------------------------------------------------------------------------
// In-memory fakes — let us exercise the full SocialService logic (friends,
// ignore, guilds, presence, chat routing) without Postgres or sockets.
// ---------------------------------------------------------------------------

class FakeDb implements SocialDb {
  private chars = new Map<number, CharInfo & { activeTitle: string | null }>();
  private friends = new Map<number, Set<number>>();
  blocks = new Map<number, Set<number>>();
  ignores = new Map<number, Set<number>>();
  private guilds = new Map<number, string>();
  private members = new Map<number, { guildId: number; rank: GuildRank }>();
  private nextGuildId = 1;

  addChar(id: number, name: string, cls = 'warrior', level = 10, realm = 'Claudemoon'): void {
    this.chars.set(id, { id, name, cls, level, realm, activeTitle: null });
  }

  // Test helper mirroring the state->>'activeTitle' column read (a deed id or null).
  setActiveTitle(id: number, deedId: string | null): void {
    const c = this.chars.get(id);
    if (c) c.activeTitle = deedId;
  }

  async findCharacterByName(name: string): Promise<CharInfo | null> {
    const trimmed = name.trim();
    const exact = [...this.chars.values()].find((c) => c.name === trimmed);
    if (exact) return exact;
    const ci = [...this.chars.values()].filter(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
    );
    return ci.length === 1 ? ci[0] : null;
  }
  async getCharacter(id: number): Promise<CharInfo | null> {
    return this.chars.get(id) ?? null;
  }

  async addFriend(c: number, f: number): Promise<void> {
    (this.friends.get(c) ?? this.friends.set(c, new Set()).get(c)!).add(f);
  }
  async removeFriend(c: number, f: number): Promise<void> {
    this.friends.get(c)?.delete(f);
  }
  async listFriends(c: number): Promise<(CharInfo & { activeTitle: string | null })[]> {
    return [...(this.friends.get(c) ?? [])].map((id) => this.chars.get(id)!).filter(Boolean);
  }
  async whoFriended(c: number): Promise<number[]> {
    return [...this.friends.entries()].filter(([, set]) => set.has(c)).map(([id]) => id);
  }

  async addBlock(c: number, b: number): Promise<void> {
    (this.blocks.get(c) ?? this.blocks.set(c, new Set()).get(c)!).add(b);
  }
  async removeBlock(c: number, b: number): Promise<void> {
    this.blocks.get(c)?.delete(b);
  }
  async listBlocks(c: number): Promise<CharRef[]> {
    return [...(this.blocks.get(c) ?? [])].map((id) => {
      const ch = this.chars.get(id)!;
      return { id: ch.id, name: ch.name };
    });
  }
  async blockedIds(c: number): Promise<number[]> {
    return [...(this.blocks.get(c) ?? [])];
  }

  async addIgnore(c: number, m: number): Promise<void> {
    (this.ignores.get(c) ?? this.ignores.set(c, new Set()).get(c)!).add(m);
  }
  async removeIgnore(c: number, m: number): Promise<void> {
    this.ignores.get(c)?.delete(m);
  }
  async listIgnores(c: number): Promise<CharRef[]> {
    return [...(this.ignores.get(c) ?? [])].map((id) => {
      const ch = this.chars.get(id)!;
      return { id: ch.id, name: ch.name };
    });
  }
  async ignoredIds(c: number): Promise<number[]> {
    return [...(this.ignores.get(c) ?? [])];
  }

  async createGuildWithLeader(
    name: string,
    leaderId: number,
  ): Promise<{ guildId: number } | { error: 'name_taken' | 'already_in_guild' }> {
    if ([...this.guilds.values()].some((n) => n.toLowerCase() === name.toLowerCase()))
      return { error: 'name_taken' };
    if (this.members.has(leaderId)) return { error: 'already_in_guild' };
    const id = this.nextGuildId++;
    this.guilds.set(id, name);
    this.members.set(leaderId, { guildId: id, rank: 'leader' });
    return { guildId: id };
  }
  async deleteGuild(id: number): Promise<void> {
    this.guilds.delete(id);
    for (const [cid, m] of [...this.members]) if (m.guildId === id) this.members.delete(cid);
  }
  async guildMembership(
    c: number,
  ): Promise<{ guildId: number; guildName: string; rank: GuildRank } | null> {
    const m = this.members.get(c);
    return m ? { guildId: m.guildId, guildName: this.guilds.get(m.guildId)!, rank: m.rank } : null;
  }
  async addGuildMemberAtomic(
    guildId: number,
    c: number,
    rank: GuildRank,
    limit: number,
  ): Promise<'ok' | 'full' | 'already_member' | 'no_guild'> {
    if (!this.guilds.has(guildId)) return 'no_guild';
    if (this.members.has(c)) return 'already_member';
    const count = [...this.members.values()].filter((m) => m.guildId === guildId).length;
    if (count >= limit) return 'full';
    this.members.set(c, { guildId, rank });
    return 'ok';
  }
  async removeGuildMember(c: number): Promise<void> {
    this.members.delete(c);
  }
  async setGuildRank(c: number, guildId: number, rank: GuildRank): Promise<boolean> {
    // Mirrors the real predicate: character AND guild must both match, and the
    // caller learns whether a row actually moved (false = refused, stamp nothing).
    const m = this.members.get(c);
    if (!m || m.guildId !== guildId) return false;
    m.rank = rank;
    return true;
  }
  async transferGuildLeader(
    guildId: number,
    fromCharId: number,
    toCharId: number,
  ): Promise<'ok' | 'not_leader' | 'not_member' | 'no_guild'> {
    if (!this.guilds.has(guildId)) return 'no_guild';
    const fromM = this.members.get(fromCharId);
    if (!fromM || fromM.guildId !== guildId || fromM.rank !== 'leader') return 'not_leader';
    const toM = this.members.get(toCharId);
    if (!toM || toM.guildId !== guildId) return 'not_member';
    toM.rank = 'leader';
    fromM.rank = 'officer';
    return 'ok';
  }
  private lastLogins = new Map<number, string>();
  setLastLogin(id: number, iso: string): void {
    this.lastLogins.set(id, iso);
  }
  // Epoch-ms guild-join stamps (guild_members.joined_at). Unstamped members
  // report null (the wire's defensive arm), never a fake epoch-0 "Veteran".
  private joinedAts = new Map<number, number>();
  setJoinedAt(id: number, epochMs: number): void {
    this.joinedAts.set(id, epochMs);
  }
  async guildMembers(guildId: number): Promise<
    (CharInfo & {
      rank: GuildRank;
      lastLogin: string | null;
      activeTitle: string | null;
      joinedAt: number | null;
    })[]
  > {
    return [...this.members.entries()]
      .filter(([, m]) => m.guildId === guildId)
      .map(([cid, m]) => ({
        ...this.chars.get(cid)!,
        rank: m.rank,
        lastLogin: this.lastLogins.get(cid) ?? null,
        joinedAt: this.joinedAts.get(cid) ?? null,
      }));
  }
  guildCount(): number {
    return this.guilds.size;
  } // test helper: detect orphaned guilds

  // guild billboard (motd)
  private motds = new Map<number, { motd: string; motdSetBy: string }>();
  async setGuildMotd(guildId: number, motd: string, setBy: string): Promise<void> {
    this.motds.set(guildId, { motd, motdSetBy: setBy });
  }
  async guildMotd(guildId: number): Promise<{ motd: string; motdSetBy: string }> {
    return this.motds.get(guildId) ?? { motd: '', motdSetBy: '' };
  }

  // guild calendar events
  private events = new Map<number, GuildEventRow & { guildId: number }>();
  private nextEventId = 1;
  async guildEvents(guildId: number, fromDay: string): Promise<GuildEventRow[]> {
    return [...this.events.values()]
      .filter((e) => e.guildId === guildId && e.day >= fromDay)
      .sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id)
      .map(({ guildId: _g, ...row }) => row);
  }
  async guildEventCount(guildId: number, fromDay: string): Promise<number> {
    return (await this.guildEvents(guildId, fromDay)).length;
  }
  async createGuildEvent(
    guildId: number,
    creatorId: number,
    day: string,
    hour: number | null,
    title: string,
    note: string,
  ): Promise<number> {
    const id = this.nextEventId++;
    const createdBy = this.chars.get(creatorId)?.name ?? '';
    this.events.set(id, { id, guildId, day, hour, title, note, createdBy });
    return id;
  }
  async deleteGuildEvent(eventId: number, guildId: number): Promise<boolean> {
    const e = this.events.get(eventId);
    if (!e || e.guildId !== guildId) return false;
    this.events.delete(eventId);
    return true;
  }
  async pruneGuildEvents(guildId: number, beforeDay: string): Promise<void> {
    for (const [id, e] of [...this.events]) {
      if (e.guildId === guildId && e.day < beforeDay) this.events.delete(id);
    }
  }
}

class FakeTransport implements SocialTransport {
  online = new Set<number>();
  presence = new Map<number, Presence>();
  delivered = new Map<number, SocialEvent[]>();
  snapshotCount = new Map<number, number>();
  renamed: { id: number; guildId: number; oldName: string; newName: string }[] = [];
  blockSets = new Map<number, number[]>();
  ignoreSets = new Map<number, number[]>();

  constructor(private db: FakeDb) {}

  setOnline(id: number, p: Presence = { zone: 'Mirewood', status: 'online' }): void {
    this.online.add(id);
    this.presence.set(id, p);
  }
  setOffline(id: number): void {
    this.online.delete(id);
    this.presence.delete(id);
  }

  charCache = new Map<number, CharInfo>();
  byCharacterId(id: number) {
    const c = this.online.has(id) ? (this.charCache.get(id) ?? null) : null;
    return c ? { characterId: c.id, name: c.name } : null;
  }
  byName(_name: string) {
    return null;
  }
  isOnline(id: number): boolean {
    return this.online.has(id);
  }
  locationOf(id: number): Presence | null {
    return this.online.has(id) ? (this.presence.get(id) ?? null) : null;
  }
  deliver(id: number, events: SocialEvent[]): void {
    const arr = this.delivered.get(id) ?? [];
    arr.push(...events);
    this.delivered.set(id, arr);
  }
  pushSnapshot(id: number): void {
    this.snapshotCount.set(id, (this.snapshotCount.get(id) ?? 0) + 1);
  }
  onGuildRenamed(id: number, guildId: number, oldName: string, newName: string): void {
    this.renamed.push({ id, guildId, oldName, newName });
    this.deliver(id, [{ type: 'guildRenamed', guildId, newName }]);
  }
  onBlocksChanged(id: number, ids: number[]): void {
    this.blockSets.set(id, ids);
  }
  founded: number[] = [];
  onGuildFounded(id: number): void {
    this.founded.push(id);
  }
  // Guild Bank Phase 3 seams. created records the commit-arm seed/fee hook;
  // disbanded records the book evict; holdings is what guildDisband's guard
  // reads (default an EMPTY book, so pre-guild-bank tests disband freely;
  // set a guild's entry to non-empty holdings or null to drive the guard).
  created: { id: number; guildId: number }[] = [];
  onGuildCreated(id: number, guildId: number): void {
    this.created.push({ id, guildId });
  }
  disbanded: number[] = [];
  onGuildDisbanded(guildId: number): void {
    this.disbanded.push(guildId);
  }
  holdings = new Map<number, { copper: number; items: number } | null>();
  guildBankDeleteWindows = new Set<number>();
  beginGuildBankDelete(guildId: number): { copper: number; items: number } | null {
    if (this.guildBankDeleteWindows.has(guildId)) return null;
    const holdings = this.guildBankHoldingsFor(guildId);
    if (holdings) this.guildBankDeleteWindows.add(guildId);
    return holdings;
  }
  endGuildBankDelete(guildId: number): void {
    this.guildBankDeleteWindows.delete(guildId);
  }
  guildBankHoldingsFor(guildId: number): { copper: number; items: number } | null {
    const h = this.holdings.get(guildId);
    return h === undefined ? { copper: 0, items: 0 } : h;
  }
  // Every synchronous guild membership/rank stamp, in call order (the Guild
  // Bank Phase 2 seam: game.ts pairs setPlayerGuild with
  // setPlayerGuildMembership behind this). Recorded for ALL characters,
  // online or not: the real transport no-ops offline ids itself.
  membershipStamps: {
    id: number;
    membership: { guildId: number; guildName: string; rank: GuildRank } | null;
  }[] = [];
  onGuildMembershipChanged(
    id: number,
    membership: { guildId: number; guildName: string; rank: GuildRank } | null,
  ): void {
    this.membershipStamps.push({ id, membership });
  }
  isBlocking(recipientId: number, senderCharacterId: number): boolean {
    return !!this.db.blocks.get(recipientId)?.has(senderCharacterId);
  }
  notLoaded = new Set<number>();
  blockListLoaded(characterId: number): boolean {
    return !this.notLoaded.has(characterId);
  }
  onIgnoresChanged(id: number, ids: number[]): void {
    this.ignoreSets.set(id, ids);
  }
  isIgnoringChat(recipientId: number, senderCharacterId: number): boolean {
    return !!this.db.ignores.get(recipientId)?.has(senderCharacterId);
  }
  // Operator-set account flair of the sender, attached to guild/officer chat at
  // fan-out. Per-character, so a test can give one speaker flair and assert it
  // rides their guild line; an unset character has none, like an ordinary player.
  flair = new Map<number, ChatSenderFlair>();
  chatFlairFor(senderCharacterId: number): ChatSenderFlair | undefined {
    return this.flair.get(senderCharacterId);
  }

  eventsFor(id: number): SocialEvent[] {
    return this.delivered.get(id) ?? [];
  }
  errorsFor(id: number): string[] {
    return this.eventsFor(id)
      .filter((e) => e.type === 'error')
      .map((e: any) => e.text);
  }
  textFor(id: number): string[] {
    return this.eventsFor(id)
      .filter((e) => e.type === 'log' || e.type === 'chat')
      .map((e: any) => e.text ?? '');
  }
  clear(): void {
    this.delivered.clear();
    this.snapshotCount.clear();
    this.renamed = [];
  }
}

// Test harness: characters 1..N, with helpers to flip presence. Tests that
// exercise guild-name screening inject their own predicate; everything else
// runs with the harness default (screen nothing). The constructor itself has
// no default: every host must decide what it screens.
function setup(cfg: { isNameOffensive?: (name: string) => boolean } = {}) {
  const db = new FakeDb();
  const tx = new FakeTransport(db);
  let clock = 1000;
  const svc = new SocialService(db, tx, () => clock, cfg.isNameOffensive ?? (() => false));
  const actors = new Map<number, { characterId: number; name: string }>();
  const add = (id: number, name: string, opts: { cls?: string; level?: number } = {}) => {
    db.addChar(id, name, opts.cls, opts.level);
    tx.charCache.set(id, {
      id,
      name,
      cls: opts.cls ?? 'warrior',
      level: opts.level ?? 10,
      realm: 'Claudemoon',
    });
    actors.set(id, { characterId: id, name });
  };
  return {
    db,
    tx,
    svc,
    actors,
    add,
    actor: (id: number) => actors.get(id)!,
    advance: (ms: number) => {
      clock += ms;
    },
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
  beforeEach(() => {
    h = setup();
    h.add(1, 'Aleph');
    h.add(2, 'Bet');
  });

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

  it('carries live coordinates for online friends (for the world map)', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet');
    h.tx.setOnline(2, { zone: 'Mirewood', status: 'online', x: 12.5, z: -34 });
    const snap = await h.svc.snapshot(1);
    expect(snap.friends[0].x).toBe(12.5);
    expect(snap.friends[0].z).toBe(-34);
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

  it('does not claim success when removing someone who is not a friend', async () => {
    await h.svc.friendRemove(h.actor(1), 'Bet');
    expect(h.tx.errorsFor(1).join()).toMatch(/not on your friends list/i);
    expect(h.tx.textFor(1).join()).not.toMatch(/removed from friends/i);
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

  it('does not notify a watcher the actor has blocked (stale friend-of-me edge)', async () => {
    // 1 has 2 on their friends list (a "watches 2" edge); 2 then blocks 1, which
    // only cleans 2's OWN friend edge, never 1's, so 1 keeps watching 2 unless
    // announcePresence itself checks the block.
    await h.svc.friendAdd(h.actor(1), 'Bet');
    h.tx.setOnline(1);
    await h.db.addBlock(2, 1); // Bet blocks Aleph directly (bypassing blockAdd's own-edge cleanup)
    h.tx.clear();
    await h.svc.announcePresence(h.actor(2), true);
    expect(h.tx.textFor(1)).toHaveLength(0);
    expect(h.tx.snapshotCount.get(1) ?? 0).toBe(0);
  });

  it('does not notify a watcher who has blocked the actor', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet');
    h.tx.setOnline(1);
    await h.db.addBlock(1, 2); // Aleph (the watcher) blocks Bet (the actor)
    h.tx.clear();
    await h.svc.announcePresence(h.actor(2), true);
    expect(h.tx.textFor(1)).toHaveLength(0);
    expect(h.tx.snapshotCount.get(1) ?? 0).toBe(0);
  });

  it('hides live presence for a friend who has blocked the viewer (stale one-directional edge)', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet'); // Aleph friends Bet
    h.tx.setOnline(2, { zone: 'Mirewood', status: 'online', x: 5, z: 9 });
    await h.svc.blockAdd(h.actor(2), 'Aleph'); // Bet blocks Aleph; Aleph's own edge to Bet survives
    const snap = await h.svc.snapshot(1);
    expect(snap.friends.map((f) => f.name)).toEqual(['Bet']);
    expect(snap.friends[0].online).toBe(false);
    expect(snap.friends[0].x).toBeUndefined();
    expect(snap.friends[0].zone).toBeUndefined();
  });

  it('fails closed on a snapshot when the friend has a persisted block but their live block list has not loaded yet (#2437)', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet'); // Aleph friends Bet
    await h.db.addBlock(2, 1); // Bet has persisted a block on Aleph
    h.tx.setOnline(2, { zone: 'Mirewood', status: 'online', x: 5, z: 9 });
    h.tx.notLoaded.add(2); // but Bet's session block list has not loaded yet
    const snap = await h.svc.snapshot(1);
    expect(snap.friends[0].online).toBe(false);
    expect(snap.friends[0].x).toBeUndefined();
    expect(snap.friends[0].zone).toBeUndefined();
  });

  it('does not notify or refresh a watcher whose own block list has not loaded yet (#2437)', async () => {
    await h.svc.friendAdd(h.actor(1), 'Bet'); // Aleph watches Bet
    h.tx.setOnline(1);
    h.tx.notLoaded.add(1); // Aleph's session block list has not loaded yet
    h.tx.clear();
    await h.svc.announcePresence(h.actor(2), true);
    expect(h.tx.textFor(1)).toHaveLength(0);
    expect(h.tx.snapshotCount.get(1) ?? 0).toBe(0);
  });
});

describe('ignore / block', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
    h.add(1, 'Aleph');
    h.add(2, 'Bet');
    // a third party, so the mute tests can assert the two tiers stay independent
    h.add(3, 'Gimel');
  });

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

  it('pushes a snapshot refresh to the blocked target too, not just the actor (#2437)', async () => {
    h.tx.setOnline(2);
    h.tx.clear();
    await h.svc.blockAdd(h.actor(1), 'Bet');
    expect(h.tx.snapshotCount.get(2)).toBe(1);
    h.tx.clear();
    await h.svc.blockRemove(h.actor(1), 'Bet');
    expect(h.tx.snapshotCount.get(2)).toBe(1);
  });

  it('does not claim success when unignoring someone who is not ignored', async () => {
    await h.svc.blockRemove(h.actor(1), 'Bet');
    expect(h.tx.errorsFor(1).join()).toMatch(/not on your block list/i);
    expect(h.tx.textFor(1).join()).not.toMatch(/no longer blocked/i);
  });

  it('refuses to block yourself', async () => {
    await h.svc.blockAdd(h.actor(1), 'Aleph');
    expect(h.tx.errorsFor(1).join()).toMatch(/yourself/i);
  });

  // --- ignores: the chat-only tier ------------------------------------------
  // An ignore must behave like a block in the plumbing (persisted, surfaced to the
  // transport so routeEvents can enforce it) and UNLIKE a block everywhere the
  // two tiers are supposed to differ.

  it('ignores a player and surfaces the updated mute set to the transport', async () => {
    await h.svc.ignoreAdd(h.actor(1), 'Bet');
    expect((await h.svc.snapshot(1)).ignores.map((m) => m.name)).toEqual(['Bet']);
    // this is the set GameServer copies into session.ignoredIds; without it the
    // chat filter has nothing to enforce
    expect(h.tx.ignoreSets.get(1)).toEqual([2]);
  });

  it('ignoring someone does NOT remove them from friends (a block does)', async () => {
    // The load-bearing difference between the two tiers: ignoring a chatty friend
    // is a normal thing to want, so it must not quietly unfriend them.
    await h.svc.friendAdd(h.actor(1), 'Bet');
    await h.svc.ignoreAdd(h.actor(1), 'Bet');
    const snap = await h.svc.snapshot(1);
    expect(snap.friends.map((f) => f.name)).toEqual(['Bet']);
    expect(snap.ignores.map((m) => m.name)).toEqual(['Bet']);
    // and the contrast: blocking DOES evict them
    await h.svc.blockAdd(h.actor(1), 'Bet');
    expect((await h.svc.snapshot(1)).friends).toHaveLength(0);
  });

  it('ignoring someone leaves the block list alone, and vice versa', async () => {
    await h.svc.ignoreAdd(h.actor(1), 'Bet');
    expect((await h.svc.snapshot(1)).blocks).toHaveLength(0);
    await h.svc.blockAdd(h.actor(1), 'Gimel');
    const snap = await h.svc.snapshot(1);
    expect(snap.ignores.map((m) => m.name)).toEqual(['Bet']);
    expect(snap.blocks.map((b) => b.name)).toEqual(['Gimel']);
  });

  it('unignores and clears the transport ignore set', async () => {
    await h.svc.ignoreAdd(h.actor(1), 'Bet');
    await h.svc.ignoreRemove(h.actor(1), 'Bet');
    expect((await h.svc.snapshot(1)).ignores).toHaveLength(0);
    expect(h.tx.ignoreSets.get(1)).toEqual([]);
  });

  it('does not claim success when unignoring someone who is not ignored', async () => {
    await h.svc.ignoreRemove(h.actor(1), 'Bet');
    expect(h.tx.errorsFor(1).join()).toMatch(/not on your ignore list/i);
    expect(h.tx.textFor(1).join()).not.toMatch(/no longer ignored/i);
  });

  it('refuses to ignore yourself', async () => {
    await h.svc.ignoreAdd(h.actor(1), 'Aleph');
    expect(h.tx.errorsFor(1).join()).toMatch(/yourself/i);
    expect((await h.svc.snapshot(1)).ignores).toHaveLength(0);
  });

  it('refuses to ignore the same player twice', async () => {
    await h.svc.ignoreAdd(h.actor(1), 'Bet');
    h.tx.clear();
    await h.svc.ignoreAdd(h.actor(1), 'Bet');
    expect(h.tx.errorsFor(1).join()).toMatch(/already ignored/i);
    expect((await h.svc.snapshot(1)).ignores).toHaveLength(1);
  });

  // These two readouts are the exact strings src/ui/server_i18n.ts matches with
  // /^Your mute list is empty\.$/ and /^Muted \((\d+)\): (.+)$/, so pin them.
  it('/ignorelist reads out the empty list', async () => {
    await h.svc.ignoreList(h.actor(1));
    expect(h.tx.textFor(1).join()).toBe('Your ignore list is empty.');
  });

  it('/ignorelist reads out the ignored names in the localizable format', async () => {
    await h.svc.ignoreAdd(h.actor(1), 'Bet');
    await h.svc.ignoreAdd(h.actor(1), 'Gimel');
    h.tx.clear();
    await h.svc.ignoreList(h.actor(1));
    expect(h.tx.textFor(1).join()).toBe('Ignored (2): Bet, Gimel');
  });

  it('/blocklist reads out the blocked names in the localizable format', async () => {
    await h.svc.blockList(h.actor(1));
    expect(h.tx.textFor(1).join()).toBe('Your block list is empty.');
    await h.svc.blockAdd(h.actor(1), 'Bet');
    h.tx.clear();
    await h.svc.blockList(h.actor(1));
    expect(h.tx.textFor(1).join()).toBe('Blocked (1): Bet');
  });

  it('refuses to friend a player you are BLOCKING (an ignore is fine)', async () => {
    await h.svc.blockAdd(h.actor(1), 'Bet');
    h.tx.clear();
    await h.svc.friendAdd(h.actor(1), 'Bet');
    expect(h.tx.errorsFor(1).join()).toMatch(/blocking/i);
    const snap = await h.svc.snapshot(1);
    expect(snap.friends).toHaveLength(0);
    expect(snap.blocks.map((b) => b.name)).toEqual(['Bet']);
  });

  it('refuses a friend add when the TARGET has blocked the actor, even while offline', async () => {
    // Bet blocked Aleph; Aleph never sees Bet's own block list, so this must be
    // checked server-side regardless of who is currently online. A blocked
    // stalker must not be able to re-add the blocker and keep tracking them.
    await h.db.addBlock(2, 1); // Bet (target) has blocked Aleph (actor)
    await h.svc.friendAdd(h.actor(1), 'Bet');
    expect(h.tx.errorsFor(1)).toHaveLength(1);
    const snap = await h.svc.snapshot(1);
    expect(snap.friends).toHaveLength(0);
  });
});

describe('guilds', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
    h.add(1, 'Aleph');
    h.add(2, 'Bet');
    h.add(3, 'Gimel');
    h.tx.setOnline(1);
    h.tx.setOnline(2);
    h.tx.setOnline(3);
  });

  it('creates a guild with the founder as leader', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    const snap = await h.svc.snapshot(1);
    expect(snap.guild?.name).toBe('Iron Vanguard');
    expect(snap.guild?.rank).toBe('leader');
    expect(snap.guild?.members.map((m) => m.name)).toEqual(['Aleph']);
  });

  it('carries each guild member last_login through the snapshot', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    const iso = '2026-07-03T12:00:00.000Z';
    h.db.setLastLogin(2, iso);
    const snap = await h.svc.snapshot(1);
    const bet = snap.guild?.members.find((m) => m.name === 'Bet');
    const aleph = snap.guild?.members.find((m) => m.name === 'Aleph');
    expect(bet?.lastLogin).toBe(iso);
    expect(aleph?.lastLogin).toBeNull(); // never stamped
  });

  it('carries each guild member joined_at through the snapshot as epoch ms', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    const joined = Date.UTC(2026, 6, 3, 12, 0, 0);
    h.db.setJoinedAt(2, joined);
    const snap = await h.svc.snapshot(1);
    const bet = snap.guild?.members.find((m) => m.name === 'Bet');
    const aleph = snap.guild?.members.find((m) => m.name === 'Aleph');
    expect(bet?.joinedAt).toBe(joined);
    expect(aleph?.joinedAt).toBeNull(); // never stamped in the fake
  });

  it("refreshes guildmates' panels when a member comes online, even non-friends (#100)", async () => {
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

  it('does not refresh a guildmate the actor has blocked (guild membership survives a block)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.blockAdd(h.actor(2), 'Aleph'); // Bet blocks the actor; guild membership is untouched
    h.tx.clear();
    await h.svc.announcePresence(h.actor(1), true);
    expect(h.tx.snapshotCount.get(2) ?? 0).toBe(0);
  });

  it("hides a blocked guildmate's live presence in the guild roster, in either block direction", async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.setOnline(2, { zone: 'Mirewood', status: 'online', x: 1, z: 2 });
    // Aleph (the viewer) blocks guildmate Bet; guild membership is untouched.
    await h.svc.blockAdd(h.actor(1), 'Bet');
    let snap = await h.svc.snapshot(1);
    let bet = snap.guild?.members.find((m) => m.name === 'Bet');
    expect(bet).toBeDefined();
    expect(bet?.online).toBe(false);

    await h.svc.blockRemove(h.actor(1), 'Bet');
    // Now the reverse: Bet blocks Aleph (the viewer) instead.
    await h.svc.blockAdd(h.actor(2), 'Aleph');
    snap = await h.svc.snapshot(1);
    bet = snap.guild?.members.find((m) => m.name === 'Bet');
    expect(bet).toBeDefined();
    expect(bet?.online).toBe(false);
  });

  it('rejects an invalid or duplicate guild name', async () => {
    await h.svc.guildCreate(h.actor(1), 'no');
    expect(h.tx.errorsFor(1).join()).toMatch(/3-24 letters/);
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    h.tx.clear();
    await h.svc.guildCreate(h.actor(2), 'iron vanguard');
    expect(h.tx.errorsFor(2).join()).toMatch(/already exists/i);
  });

  it('refuses an offensive guild name at creation via the injected screen', async () => {
    const screened: string[] = [];
    const s = setup({
      isNameOffensive: (name) => {
        screened.push(name);
        return /forbidden/i.test(name);
      },
    });
    s.add(1, 'Aleph');
    s.tx.setOnline(1);
    await s.svc.guildCreate(s.actor(1), '  Forbidden Legion  ');
    // The exact English literal is load-bearing: server_i18n's EXACT matcher
    // localizes it byte-for-byte (guild.nameNotAllowed).
    expect(s.tx.errorsFor(1)).toEqual(['That guild name is not allowed.']);
    // The screen sees the VALIDATED (trimmed) name, after the format gate.
    expect(screened).toEqual(['Forbidden Legion']);
    // A refused create leaves nothing behind: no guild row, no founder credit,
    // no membership.
    expect(s.db.guildCount()).toBe(0);
    expect(s.tx.founded).toEqual([]);
    expect((await s.svc.snapshot(1)).guild).toBeNull();
  });

  it('accepts a clean guild name through the same screen', async () => {
    const s = setup({ isNameOffensive: (name) => /forbidden/i.test(name) });
    s.add(1, 'Aleph');
    s.tx.setOnline(1);
    await s.svc.guildCreate(s.actor(1), 'Iron Vanguard');
    expect(s.tx.errorsFor(1)).toEqual([]);
    expect(s.tx.founded).toEqual([1]);
    expect((await s.svc.snapshot(1)).guild?.name).toBe('Iron Vanguard');
  });

  it('does not screen when the harness injects no predicate (screen-nothing default)', async () => {
    // The harness default screens nothing: FakeDb suites that never inject a
    // predicate must keep creating guilds freely.
    await h.svc.guildCreate(h.actor(1), 'Forbidden Legion');
    expect(h.tx.errorsFor(1)).toEqual([]);
    expect((await h.svc.snapshot(1)).guild?.name).toBe('Forbidden Legion');
  });

  it('refuses a format-invalid name with the rules message before the screen ever runs', async () => {
    // Ordering pin, negative arm: validateGuildName gates FIRST, so a name that
    // fails the format rules is refused with nameRules and the predicate is
    // never consulted (swapping the two blocks flips which error this gets).
    const screened: string[] = [];
    const s = setup({
      isNameOffensive: (name) => {
        screened.push(name);
        return true;
      },
    });
    s.add(1, 'Aleph');
    s.tx.setOnline(1);
    await s.svc.guildCreate(s.actor(1), 'xx');
    expect(s.tx.errorsFor(1).join()).toMatch(/3-24/);
    expect(screened).toEqual([]);
  });

  it('requires every SocialService construction site to choose a screening predicate', () => {
    const db = new FakeDb();
    const tx = new FakeTransport(db);
    // Fail-closed pin: the 4th constructor param deliberately has no default,
    // so a host that forgets it fails to compile. Restoring a fail-open
    // default makes this construction legal and tsc then rejects the
    // unused expect-error, failing the gate.
    // @ts-expect-error three args must not construct a SocialService
    const svc = new SocialService(db, tx, () => 1000);
    expect(svc).toBeInstanceOf(SocialService);
  });

  it('wires the real offensiveName screen at the production construction site (source pin)', async () => {
    // The whole suite injects its own predicates, so the one edge connecting
    // the tested service to the real screen is server/game.ts; pin it at the
    // source level (title_reads precedent) so replacing it with () => false
    // cannot ship silently.
    const { readFileSync } = await import('node:fs');
    const game = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');
    const site = game.slice(game.indexOf('new SocialService('));
    expect(site.length).toBeGreaterThan(0);
    expect(site.slice(0, 400)).toContain('offensiveName(');
  });

  it('fires onGuildFounded exactly once, on the committed create only (the soc_guild_founded feed)', async () => {
    // Every refusal arm must stay silent: an invalid name, then a real
    // founding, then a duplicate name, then a create while already guilded.
    await h.svc.guildCreate(h.actor(1), 'no');
    expect(h.tx.founded).toEqual([]);
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    expect(h.tx.founded).toEqual([1]);
    await h.svc.guildCreate(h.actor(2), 'iron vanguard');
    await h.svc.guildCreate(h.actor(1), 'Second Banner');
    expect(h.tx.founded).toEqual([1]);
    // A JOIN never counts as founding.
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    expect(h.tx.founded).toEqual([1]);
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

  it('propagates an admin rename without DB reads or social snapshot fanout', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    h.tx.clear();
    h.db.guildMembership = () => {
      throw new Error('rename propagation must not read membership');
    };
    h.db.guildMembers = () => {
      throw new Error('rename propagation must not read members');
    };

    h.svc.guildRenamed(1, 'Knights', 'Dawn Guard', [1, 1]);

    expect(h.tx.renamed).toEqual([
      { id: 1, guildId: 1, oldName: 'Knights', newName: 'Dawn Guard' },
    ]);
    expect(h.tx.eventsFor(1)).toContainEqual({
      type: 'guildRenamed',
      guildId: 1,
      newName: 'Dawn Guard',
    });
    expect(h.tx.snapshotCount.size).toBe(0);
  });

  it('cancels pending invitations and notifies both online sides without the old name', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildInvite(h.actor(1), 'Gimel');
    h.tx.clear();

    h.svc.guildRenamed(1, 'Knights', 'Dawn Guard', [1]);

    expect(h.tx.eventsFor(1)).toContainEqual({ type: 'guildInviteCancelled' });
    expect(h.tx.eventsFor(2)).toEqual([{ type: 'guildInviteCancelled' }]);
    expect(h.tx.eventsFor(3)).toEqual([{ type: 'guildInviteCancelled' }]);
    expect(JSON.stringify([...h.tx.delivered.values()])).not.toContain('Knights');
    await h.svc.guildAccept(h.actor(2));
    expect(h.tx.errorsFor(2).join()).toMatch(/expired/i);
    await h.svc.guildAccept(h.actor(3));
    expect(h.tx.errorsFor(3).join()).toMatch(/expired/i);
  });

  it('keeps another guild pending invitation intact during a rename', async () => {
    h.add(4, 'Dalet');
    h.tx.setOnline(4);
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildCreate(h.actor(3), 'Raiders');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildInvite(h.actor(3), 'Dalet');
    h.tx.clear();

    h.svc.guildRenamed(1, 'Knights', 'Dawn Guard', [1]);

    expect(h.tx.eventsFor(2)).toEqual([{ type: 'guildInviteCancelled' }]);
    expect(h.tx.eventsFor(4)).toHaveLength(0);
    await h.svc.guildAccept(h.actor(4));
    expect((await h.svc.snapshot(4)).guild?.name).toBe('Raiders');
  });

  it('hard-bounds malformed admin member lists to the guild member cap', () => {
    for (let id = 1; id <= 120; id++) h.tx.setOnline(id);
    h.tx.clear();

    h.svc.guildRenamed(
      1,
      'Knights',
      'Dawn Guard',
      Array.from({ length: 120 }, (_, index) => index + 1),
    );

    expect(h.tx.renamed).toHaveLength(100);
    expect(h.tx.renamed.at(-1)?.id).toBe(100);
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
      new Promise((resolve) => {
        setTimeout(() => {
          void realMembers(guildId).then(resolve);
        }, 0);
      });
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

  it('rejects inviting someone who already has a pending guild invite', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildCreate(h.actor(3), 'Raiders');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    h.tx.clear();
    // a second guild tries to invite Bet while the first invite is still live
    await h.svc.guildInvite(h.actor(3), 'Bet');
    expect(h.tx.errorsFor(3).join()).toMatch(/already has a pending guild invitation/i);
    // the original invite is untouched, so Bet still joins the first guild
    await h.svc.guildAccept(h.actor(2));
    expect((await h.svc.snapshot(2)).guild?.name).toBe('Knights');
  });

  it('allows a fresh invite once the previous one has expired', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildCreate(h.actor(3), 'Raiders');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    h.advance(61_000); // first invite lapses
    h.tx.clear();
    await h.svc.guildInvite(h.actor(3), 'Bet');
    expect(h.tx.errorsFor(3)).toHaveLength(0);
    expect(h.tx.eventsFor(2).some((e) => e.type === 'guildInvite')).toBe(true);
  });

  it('never delivers a guild invite to a target who ignores the inviter, looking like a decline', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.blockAdd(h.actor(2), 'Aleph'); // Bet ignores Aleph
    h.tx.clear();
    await h.svc.guildInvite(h.actor(1), 'Bet');
    // the inviter sees only the ordinary confirmation, no error
    expect(h.tx.textFor(1)).toContain('You have invited Bet to the guild.');
    expect(h.tx.errorsFor(1)).toHaveLength(0);
    // the target never sees the invite
    expect(h.tx.eventsFor(2).some((e) => e.type === 'guildInvite')).toBe(false);
    // and no pending state was created: accepting reports the usual lapse
    await h.svc.guildAccept(h.actor(2));
    expect(h.tx.errorsFor(2).join()).toMatch(/expired/i);
    expect((await h.svc.snapshot(2)).guild).toBeNull();
    // other guilds can still invite the target right away
    await h.svc.guildCreate(h.actor(3), 'Raiders');
    h.tx.clear();
    await h.svc.guildInvite(h.actor(3), 'Bet');
    expect(h.tx.eventsFor(2).some((e) => e.type === 'guildInvite')).toBe(true);
  });

  it('unignoring the inviter restores their guild invites', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.blockAdd(h.actor(2), 'Aleph');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    expect(h.tx.eventsFor(2).some((e) => e.type === 'guildInvite')).toBe(false);
    await h.svc.blockRemove(h.actor(2), 'Aleph');
    h.tx.clear();
    await h.svc.guildInvite(h.actor(1), 'Bet');
    expect(h.tx.eventsFor(2).some((e) => e.type === 'guildInvite')).toBe(true);
    await h.svc.guildAccept(h.actor(2));
    expect((await h.svc.snapshot(2)).guild?.name).toBe('Knights');
  });

  it('routes guild chat only to guild members', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    const ok = await h.svc.guildChat(h.actor(1), 'hello guild');
    expect(ok).toBe(true);
    expect(
      h.tx
        .eventsFor(1)
        .some((e) => e.type === 'chat' && e.channel === 'guild' && e.text === 'hello guild'),
    ).toBe(true);
    expect(h.tx.eventsFor(2).some((e) => e.type === 'chat' && e.text === 'hello guild')).toBe(true);
    expect(h.tx.eventsFor(3)).toHaveLength(0); // Gimel is not in the guild
  });

  it('the snapshot carries each friend and roster member activeTitle (deed id or null)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.friendAdd(h.actor(1), 'Gimel');
    h.db.setActiveTitle(2, 'prog_veteran');
    h.db.setActiveTitle(3, null);
    const snap = await h.svc.snapshot(1);
    const bet = snap.guild?.members.find((m) => m.name === 'Bet');
    const aleph = snap.guild?.members.find((m) => m.name === 'Aleph');
    expect(bet?.activeTitle).toBe('prog_veteran');
    expect(aleph?.activeTitle).toBeNull();
    const gimel = snap.friends.find((f) => f.name === 'Gimel');
    expect(gimel?.activeTitle).toBeNull();
    h.db.setActiveTitle(3, 'hid_saul_footnote');
    const snap2 = await h.svc.snapshot(1);
    expect(snap2.friends.find((f) => f.name === 'Gimel')?.activeTitle).toBe('hid_saul_footnote');
  });

  it('stamps the sender title (a deed id) on guild and officer chat, omitted when untitled', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    // titled sender: the deed ID rides fromTitle on every delivered copy
    const titled = { ...h.actor(1), activeTitle: 'prog_veteran' };
    expect(await h.svc.guildChat(titled, 'hail')).toBe(true);
    for (const id of [1, 2]) {
      const line = h.tx.eventsFor(id).find((e) => e.type === 'chat')!;
      expect(line.type === 'chat' && line.fromTitle).toBe('prog_veteran');
    }
    // untitled sender (null and absent alike): the key is omitted entirely
    h.tx.clear();
    expect(await h.svc.guildChat({ ...h.actor(1), activeTitle: null }, 'plain')).toBe(true);
    const plain = h.tx.eventsFor(2).find((e) => e.type === 'chat')!;
    expect('fromTitle' in plain).toBe(false);
    // officer chat stamps the same way, and omits the key untitled
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    h.tx.clear();
    expect(await h.svc.officerChat(titled, 'ranks')).toBe(true);
    const officer = h.tx.eventsFor(2).find((e) => e.type === 'chat')!;
    expect(officer.type === 'chat' && officer.fromTitle).toBe('prog_veteran');
    h.tx.clear();
    expect(await h.svc.officerChat({ ...h.actor(1), activeTitle: null }, 'bare')).toBe(true);
    const bareOfficer = h.tx.eventsFor(2).find((e) => e.type === 'chat')!;
    expect('fromTitle' in bareOfficer).toBe(false);
  });

  it('keeps the chat fromTitle field type identical across SocialEvent and SimEvent', () => {
    // The guild/officer relay frame is its own union member (no fromPid), but
    // the client casts it into the one SimEvent switch, so the title field
    // must stay assignment-compatible in both directions.
    type SocialTitle = Extract<SocialEvent, { type: 'chat' }>['fromTitle'];
    type SimTitle = Extract<SimEvent, { type: 'chat' }>['fromTitle'];
    const a: SocialTitle = 'prog_veteran' as SimTitle;
    const b: SimTitle = 'prog_veteran' as SocialTitle;
    expect(a).toBe(b);
  });

  it('stamps the sender class on guild and officer chat, omitted with no live meta', async () => {
    // classId rides the guild/officer relay the same way fromTitle does (the
    // same fix, for the same interest-scope reason): actorFor(session) reads
    // it off the LIVE sim meta in game.ts, so a test actor built without a
    // `cls` (no live meta) omits the key, and one built with it carries it.
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();
    const withClass = { ...h.actor(1), cls: 'warrior' as const };
    expect(await h.svc.guildChat(withClass, 'hail')).toBe(true);
    for (const id of [1, 2]) {
      const line = h.tx.eventsFor(id).find((e) => e.type === 'chat')!;
      expect(line.type === 'chat' && line.classId).toBe('warrior');
    }
    h.tx.clear();
    expect(await h.svc.guildChat(h.actor(1), 'no live meta')).toBe(true);
    const noMeta = h.tx.eventsFor(2).find((e) => e.type === 'chat')!;
    expect('classId' in noMeta).toBe(false);
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    h.tx.clear();
    expect(await h.svc.officerChat(withClass, 'ranks')).toBe(true);
    const officer = h.tx.eventsFor(2).find((e) => e.type === 'chat')!;
    expect(officer.type === 'chat' && officer.classId).toBe('warrior');
  });

  it('suppresses guild chat from a player the recipient ignores', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildInvite(h.actor(1), 'Gimel');
    await h.svc.guildAccept(h.actor(3));
    // Bet ignores Aleph
    await h.svc.blockAdd(h.actor(2), 'Aleph');
    h.tx.clear();
    const ok = await h.svc.guildChat(h.actor(1), 'hello guild');
    expect(ok).toBe(true);
    // Aleph still sees their own line; an uninvolved member (Gimel) sees it
    expect(h.tx.eventsFor(1).some((e) => e.type === 'chat' && e.text === 'hello guild')).toBe(true);
    expect(h.tx.eventsFor(3).some((e) => e.type === 'chat' && e.text === 'hello guild')).toBe(true);
    // Bet, who ignores Aleph, receives nothing
    expect(h.tx.eventsFor(2)).toHaveLength(0);
  });

  it('suppresses officer chat from an officer the recipient ignores', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    // Bet ignores the Guild Master Aleph
    await h.svc.blockAdd(h.actor(2), 'Aleph');
    h.tx.clear();
    expect(await h.svc.officerChat(h.actor(1), 'officers only')).toBe(true);
    expect(h.tx.eventsFor(1).some((e) => e.type === 'chat' && e.channel === 'officer')).toBe(true);
    expect(h.tx.eventsFor(2)).toHaveLength(0);
  });

  // Guild and officer chat fan out through tx.deliver and NEVER pass the
  // routeEvents chat filter, so they must consult the ignore list here. Without
  // these two call sites, ignoring a guildmate does nothing in the one channel you
  // actually read them in, and the routeEvents tests would still be green.
  it('suppresses guild chat from a player the recipient has IGNORED', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildInvite(h.actor(1), 'Gimel');
    await h.svc.guildAccept(h.actor(3));
    // Bet ignores Aleph (an ignore, NOT a block: they are still guildmates and Bet
    // has not ignored them)
    await h.svc.ignoreAdd(h.actor(2), 'Aleph');
    h.tx.clear();

    expect(await h.svc.guildChat(h.actor(1), 'hello guild')).toBe(true);

    // the speaker still sees their own line, and an uninvolved member hears it
    expect(h.tx.eventsFor(1).some((e) => e.type === 'chat' && e.text === 'hello guild')).toBe(true);
    expect(h.tx.eventsFor(3).some((e) => e.type === 'chat' && e.text === 'hello guild')).toBe(true);
    // Bet, who ignored Aleph, receives nothing
    expect(h.tx.eventsFor(2)).toHaveLength(0);
  });

  it('suppresses officer chat from an officer the recipient has IGNORED', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    await h.svc.ignoreAdd(h.actor(2), 'Aleph');
    h.tx.clear();

    expect(await h.svc.officerChat(h.actor(1), 'officers only')).toBe(true);

    expect(h.tx.eventsFor(1).some((e) => e.type === 'chat' && e.channel === 'officer')).toBe(true);
    expect(h.tx.eventsFor(2)).toHaveLength(0);
  });

  it('an unignored guildmate still hears guild chat (the negative)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.clear();

    expect(await h.svc.guildChat(h.actor(1), 'hello guild')).toBe(true);
    expect(h.tx.eventsFor(2).some((e) => e.type === 'chat' && e.text === 'hello guild')).toBe(true);
  });

  // Guild and officer chat fan out through tx.deliver and NEVER pass through
  // routeEvents, which is where every OTHER channel gets its sender flair attached.
  // So these two call sites are the only thing that puts an [AI] tag or a streamer's
  // links on a guild/officer line: drop them and a flagged account speaking in the
  // one channel their guild actually reads arrives bare, with no entity record to
  // fall back on if they are outside the recipient's interest scope.
  const SPEAKER_FLAIR = {
    ai: true,
    links: { twitch: 'https://twitch.tv/someone' },
  } as const;

  it('attaches the SPEAKER flair to guild chat, for every recipient', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    // Aleph (character 1) is a flagged account; Bet is not.
    h.tx.flair.set(1, { ...SPEAKER_FLAIR });
    h.tx.clear();

    expect(await h.svc.guildChat(h.actor(1), 'hello guild')).toBe(true);

    const heard = h.tx.eventsFor(2).find((e) => e.type === 'chat');
    expect(heard).toBeDefined();
    expect(heard?.type === 'chat' && heard.flair).toEqual(SPEAKER_FLAIR);
    // The speaker's own echo carries it too (the event is built once for the fan-out).
    const echo = h.tx.eventsFor(1).find((e) => e.type === 'chat');
    expect(echo?.type === 'chat' && echo.flair).toEqual(SPEAKER_FLAIR);
  });

  it('attaches the SPEAKER flair to officer chat', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    h.tx.flair.set(1, { ...SPEAKER_FLAIR });
    h.tx.clear();

    expect(await h.svc.officerChat(h.actor(1), 'officers only')).toBe(true);

    const heard = h.tx.eventsFor(2).find((e) => e.type === 'chat');
    expect(heard?.type === 'chat' && heard.channel).toBe('officer');
    expect(heard?.type === 'chat' && heard.flair).toEqual(SPEAKER_FLAIR);
  });

  it('leaves an UNFLAGGED speaker guild/officer line bare (no flair key at all)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    // No h.tx.flair entry for Aleph: an ordinary player.
    h.tx.clear();

    expect(await h.svc.guildChat(h.actor(1), 'hello guild')).toBe(true);
    expect(await h.svc.officerChat(h.actor(1), 'officers only')).toBe(true);

    // undefined, NOT {}. The absence is what keeps an ordinary chat line
    // byte-unchanged on the wire, and what the client reads as "no evidence"
    // rather than "this sender has no flair".
    for (const e of h.tx.eventsFor(2)) {
      if (e.type !== 'chat') continue;
      expect(e.flair, e.channel).toBeUndefined();
    }
    expect(h.tx.eventsFor(2).filter((e) => e.type === 'chat')).toHaveLength(2);
  });

  it('blocks guild chat from a non-member', async () => {
    const ok = await h.svc.guildChat(h.actor(1), 'anyone there?');
    expect(ok).toBe(false);
    expect(h.tx.errorsFor(1).join()).toMatch(/not in a guild/i);
  });

  it('forbids the Guild Master from leaving while members remain (classic-MMO rule)', async () => {
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
    expect(
      h.tx
        .eventsFor(1)
        .some((e) => e.type === 'chat' && e.channel === 'officer' && e.text === 'officers only'),
    ).toBe(true);
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

// The Guild Bank Phase 2 stamp seam: every COMMITTED membership/rank mutation
// must reach onGuildMembershipChanged synchronously from its call site (the
// transport owner pairs the sim's name + membership stamps behind it), because
// the guild bank's officer-plus gate reads the stamped rank: a demote that only
// arrived via the async pushSnapshot path would leave a stale-officer window.
// Refused mutations must stamp NOTHING.
describe('guild membership stamps (onGuildMembershipChanged)', () => {
  let h: ReturnType<typeof setup>;
  const G = { guildId: 1, guildName: 'Iron Vanguard' }; // FakeDb ids start at 1
  beforeEach(async () => {
    h = setup();
    h.add(1, 'Aleph');
    h.add(2, 'Bet');
    h.add(3, 'Gimel');
    h.tx.setOnline(1);
    h.tx.setOnline(2);
    h.tx.setOnline(3);
  });
  const joinBet = async () => {
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
  };

  it('create stamps the founder as leader, exactly once', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    expect(h.tx.membershipStamps).toEqual([{ id: 1, membership: { ...G, rank: 'leader' } }]);
  });

  it('a refused create (name taken / already in a guild) stamps nothing', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    h.tx.membershipStamps = [];
    await h.svc.guildCreate(h.actor(2), 'Iron Vanguard'); // name taken
    await h.svc.guildCreate(h.actor(1), 'Second Banner'); // already in a guild
    await h.svc.guildCreate(h.actor(3), 'x'); // invalid name
    expect(h.tx.membershipStamps).toEqual([]);
  });

  it('accept stamps the joiner as member; an expired invite stamps nothing', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    h.tx.membershipStamps = [];
    await joinBet();
    expect(h.tx.membershipStamps).toEqual([{ id: 2, membership: { ...G, rank: 'member' } }]);
    h.tx.membershipStamps = [];
    await h.svc.guildAccept(h.actor(3)); // no invite at all
    expect(h.tx.membershipStamps).toEqual([]);
  });

  it('promote and demote stamp the target with the new rank; a refused rank change stamps nothing', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await joinBet();
    h.tx.membershipStamps = [];
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    expect(h.tx.membershipStamps).toEqual([{ id: 2, membership: { ...G, rank: 'officer' } }]);
    h.tx.membershipStamps = [];
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'member');
    expect(h.tx.membershipStamps).toEqual([{ id: 2, membership: { ...G, rank: 'member' } }]);
    h.tx.membershipStamps = [];
    await h.svc.guildSetRank(h.actor(2), 'Aleph', 'member'); // not the leader: refused
    await h.svc.guildSetRank(h.actor(1), 'Gimel', 'officer'); // not in the guild: refused
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'member'); // already member: refused
    expect(h.tx.membershipStamps).toEqual([]);
  });

  it('a promote whose UPDATE matched no row (target left mid-flight) stamps NOTHING', async () => {
    // The privilege-escalation race the predicated setGuildRank closes: the
    // leader promotes Bet, but Bet's guildLeave commits between guildSetRank's
    // membership read and its UPDATE. The write matches zero rows, so the
    // service must refuse and never stamp the officer rank the DB refused
    // (the guild bank's officer gate honors the stamp, and a removed
    // character gets no corrective push).
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await joinBet();
    const realSetGuildRank = h.db.setGuildRank.bind(h.db);
    h.db.setGuildRank = async (c, guildId, rank) => {
      await h.svc.guildLeave(h.actor(2)); // the leave commits just before the UPDATE
      return realSetGuildRank(c, guildId, rank);
    };
    h.tx.membershipStamps = [];
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    // Only the leave's own null stamp: no officer stamp may follow it.
    expect(h.tx.membershipStamps).toEqual([{ id: 2, membership: null }]);
    expect(await h.db.guildMembership(2)).toBeNull();
  });

  it('a promote racing a guild SWITCH cannot rewrite the new guild or stamp the old one', async () => {
    // Same window, worse shape: Bet leaves guild A and founds guild B before
    // A's promote UPDATE lands. The guild_id predicate must miss (B's row is
    // untouched) and no stamp may assert an officer rank in A.
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await joinBet();
    const realSetGuildRank = h.db.setGuildRank.bind(h.db);
    h.db.setGuildRank = async (c, guildId, rank) => {
      await h.svc.guildLeave(h.actor(2));
      await h.svc.guildCreate(h.actor(2), 'Second Banner');
      return realSetGuildRank(c, guildId, rank);
    };
    h.tx.membershipStamps = [];
    await h.svc.guildSetRank(h.actor(1), 'Bet', 'officer');
    // The leave's null stamp and the create's leader stamp for guild B, and
    // nothing else: no officer-in-A stamp, and B's row keeps its leader rank.
    expect(h.tx.membershipStamps).toEqual([
      { id: 2, membership: null },
      { id: 2, membership: { guildId: 2, guildName: 'Second Banner', rank: 'leader' } },
    ]);
    expect(await h.db.guildMembership(2)).toEqual({
      guildId: 2,
      guildName: 'Second Banner',
      rank: 'leader',
    });
  });

  it('kick stamps the target null (even offline); a refused kick stamps nothing', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await joinBet();
    h.tx.setOffline(2); // the stamp seam records regardless; the owner no-ops offline
    h.tx.membershipStamps = [];
    await h.svc.guildKick(h.actor(1), 'Bet');
    expect(h.tx.membershipStamps).toEqual([{ id: 2, membership: null }]);
    h.tx.membershipStamps = [];
    await h.svc.guildKick(h.actor(1), 'Gimel'); // not in the guild: refused
    expect(h.tx.membershipStamps).toEqual([]);
  });

  it('leave stamps the leaver null in both arms (others remain / last member out)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await joinBet();
    h.tx.membershipStamps = [];
    await h.svc.guildLeave(h.actor(2)); // others remain
    expect(h.tx.membershipStamps).toEqual([{ id: 2, membership: null }]);
    h.tx.membershipStamps = [];
    await h.svc.guildLeave(h.actor(1)); // last member out: the disband arm
    expect(h.tx.membershipStamps).toEqual([{ id: 1, membership: null }]);
    // A blocked leave (leader with members remaining) stamps nothing.
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard II');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.membershipStamps = [];
    await h.svc.guildLeave(h.actor(1)); // refused: must transfer or disband first
    expect(h.tx.membershipStamps).toEqual([]);
  });

  it('leader transfer stamps BOTH rows: target to leader, former leader to officer', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await joinBet();
    h.tx.membershipStamps = [];
    await h.svc.guildTransferLeader(h.actor(1), 'Bet');
    expect(h.tx.membershipStamps).toEqual([
      { id: 2, membership: { ...G, rank: 'leader' } },
      { id: 1, membership: { ...G, rank: 'officer' } },
    ]);
    h.tx.membershipStamps = [];
    await h.svc.guildTransferLeader(h.actor(1), 'Bet'); // no longer leader: refused
    expect(h.tx.membershipStamps).toEqual([]);
  });

  it('disband stamps EVERY member null, online or offline', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await joinBet();
    await h.svc.guildInvite(h.actor(1), 'Gimel');
    await h.svc.guildAccept(h.actor(3));
    h.tx.setOffline(3); // offline members clear too (they re-stamp null at next join)
    h.tx.membershipStamps = [];
    await h.svc.guildDisband(h.actor(1));
    const stamps = [...h.tx.membershipStamps].sort((a, b) => a.id - b.id);
    expect(stamps).toEqual([
      { id: 1, membership: null },
      { id: 2, membership: null },
      { id: 3, membership: null },
    ]);
    h.tx.membershipStamps = [];
    await h.svc.guildDisband(h.actor(1)); // no guild anymore: refused
    expect(h.tx.membershipStamps).toEqual([]);
  });
});

describe('guild atomicity (#149)', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
    h.add(1, 'Aleph');
    h.add(2, 'Bet');
    h.tx.setOnline(1);
    h.tx.setOnline(2);
  });

  it('two racing guild_create packets from one character leave no orphan guild', async () => {
    // Both calls pass the "are you already in a guild?" check before either
    // writes its member row. The non-atomic flow created two guilds and orphaned
    // the leaderless second one; the atomic create must produce exactly one.
    await Promise.all([
      h.svc.guildCreate(h.actor(1), 'Iron Vanguard'),
      h.svc.guildCreate(h.actor(1), 'Storm Wardens'),
    ]);
    expect(h.db.guildCount()).toBe(1);
    const snap = await h.svc.snapshot(1);
    expect(snap.guild?.rank).toBe('leader');
    expect(snap.guild?.members.map((m) => m.name)).toEqual(['Aleph']);
  });

  it('refuses to create a second guild when already in one (no orphan)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    h.tx.clear();
    await h.svc.guildCreate(h.actor(1), 'Raiders');
    expect(h.tx.errorsFor(1).join()).toMatch(/already in a guild/i);
    expect(h.db.guildCount()).toBe(1);
  });

  it('guildAccept surfaces a full guild reported by the atomic add', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    h.db.addGuildMemberAtomic = async () => 'full';
    await h.svc.guildAccept(h.actor(2));
    expect(h.tx.errorsFor(2).join()).toMatch(/full/i);
    expect((await h.svc.snapshot(2)).guild).toBeNull();
  });

  it('guildAccept surfaces a vanished guild reported by the atomic add', async () => {
    await h.svc.guildCreate(h.actor(1), 'Knights');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    h.db.addGuildMemberAtomic = async () => 'no_guild';
    await h.svc.guildAccept(h.actor(2));
    expect(h.tx.errorsFor(2).join()).toMatch(/no longer exists/i);
    expect((await h.svc.snapshot(2)).guild).toBeNull();
  });

  it('two racing /gleader transfers to different targets never both succeed', async () => {
    // Both calls read "actor is still Guild Master" before either write
    // lands. The non-atomic flow (two independent setGuildRank writes with
    // no lock or re-check between them) let both promotions through, so the
    // guild ended up with two members simultaneously ranked leader.
    h.add(3, 'Cee');
    h.tx.setOnline(3);
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildInvite(h.actor(1), 'Cee');
    await h.svc.guildAccept(h.actor(3));
    h.tx.clear();

    await Promise.all([
      h.svc.guildTransferLeader(h.actor(1), 'Bet'),
      h.svc.guildTransferLeader(h.actor(1), 'Cee'),
    ]);

    const guildId = (await h.db.guildMembership(1))!.guildId;
    const leaders = (await h.db.guildMembers(guildId)).filter((m) => m.rank === 'leader');
    expect(leaders).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Guild calendar events: officer-gated create/remove, validation, the snapshot
// lane, and the structured calendarResult outcomes the client localizes.
// ---------------------------------------------------------------------------

describe('guild calendar events', () => {
  // The fake clock starts at epoch 1000ms, so "today" is 1970-01-01.
  const TODAY = '1970-01-01';
  const NEXT_WEEK = '1970-01-08';

  async function guildOf3() {
    const h = setup();
    h.add(1, 'Lead');
    h.add(2, 'Officer');
    h.add(3, 'Member');
    await h.svc.guildCreate(h.actor(1), 'Night Watch');
    await h.svc.guildInvite(h.actor(1), 'Officer');
    // invites need the target online
    return h;
  }

  async function seatedGuild() {
    const h = setup();
    h.add(1, 'Lead');
    h.add(2, 'Officer');
    h.add(3, 'Member');
    h.tx.setOnline(2);
    h.tx.setOnline(3);
    await h.svc.guildCreate(h.actor(1), 'Night Watch');
    await h.svc.guildInvite(h.actor(1), 'Officer');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildInvite(h.actor(1), 'Member');
    await h.svc.guildAccept(h.actor(3));
    await h.svc.guildSetRank(h.actor(1), 'Officer', 'officer');
    h.tx.clear();
    return h;
  }

  function resultsFor(h: Awaited<ReturnType<typeof seatedGuild>>, id: number): string[] {
    return h.tx
      .eventsFor(id)
      .filter((e) => e.type === 'calendarResult')
      .map((e: any) => e.code);
  }

  it('lets the leader and officers book events; members see them in the snapshot', async () => {
    const h = await seatedGuild();
    await h.svc.guildEventCreate(h.actor(1), {
      day: NEXT_WEEK,
      hour: 20,
      title: 'Crypt night',
      note: 'Bring water.',
    });
    await h.svc.guildEventCreate(h.actor(2), {
      day: TODAY,
      hour: null,
      title: 'Fishing derby',
      note: '',
    });
    expect(resultsFor(h, 1)).toEqual(['created']);
    expect(resultsFor(h, 2)).toEqual(['created']);
    const snap = await h.svc.snapshot(3);
    expect(snap.guild?.events.map((e) => e.title)).toEqual(['Fishing derby', 'Crypt night']);
    expect(snap.guild?.events[1]).toMatchObject({ day: NEXT_WEEK, hour: 20, createdBy: 'Lead' });
  });

  it('refuses a plain member, a non-member, and bad input', async () => {
    const h = await seatedGuild();
    await h.svc.guildEventCreate(h.actor(3), { day: NEXT_WEEK, hour: 20, title: 'X', note: '' });
    expect(resultsFor(h, 3)).toEqual(['notOfficer']);
    h.add(9, 'Loner');
    await h.svc.guildEventCreate(h.actor(9), { day: NEXT_WEEK, hour: 20, title: 'X', note: '' });
    expect(resultsFor(h, 9)).toEqual(['notInGuild']);
    await h.svc.guildEventCreate(h.actor(1), { day: 'not-a-day', hour: 20, title: 'X', note: '' });
    await h.svc.guildEventCreate(h.actor(1), { day: '1970-02-30', hour: 20, title: 'X', note: '' });
    await h.svc.guildEventCreate(h.actor(1), { day: '1969-12-01', hour: 20, title: 'X', note: '' });
    await h.svc.guildEventCreate(h.actor(1), { day: NEXT_WEEK, hour: 20, title: '   ', note: '' });
    expect(resultsFor(h, 1)).toEqual(['badInput', 'badInput', 'badInput', 'badInput']);
    expect((await h.svc.snapshot(1)).guild?.events).toHaveLength(0);
  });

  it('caps the upcoming calendar and reports calendarFull', async () => {
    const h = await seatedGuild();
    for (let i = 0; i < 25; i++) {
      await h.svc.guildEventCreate(h.actor(1), {
        day: NEXT_WEEK,
        hour: null,
        title: `Event ${i}`,
        note: '',
      });
    }
    await h.svc.guildEventCreate(h.actor(1), {
      day: NEXT_WEEK,
      hour: null,
      title: 'One too many',
      note: '',
    });
    expect(resultsFor(h, 1).filter((c) => c === 'calendarFull')).toHaveLength(1);
    expect((await h.svc.snapshot(1)).guild?.events).toHaveLength(25);
  });

  it('removes events (officer+ only) and reports eventGone for a stale id', async () => {
    const h = await seatedGuild();
    await h.svc.guildEventCreate(h.actor(1), {
      day: NEXT_WEEK,
      hour: 19,
      title: 'Raid',
      note: '',
    });
    const evId = (await h.svc.snapshot(1)).guild?.events[0]?.id;
    if (evId === undefined) throw new Error('event not created');
    h.tx.clear();
    await h.svc.guildEventRemove(h.actor(3), evId);
    expect(resultsFor(h, 3)).toEqual(['notOfficer']);
    await h.svc.guildEventRemove(h.actor(2), evId);
    expect(resultsFor(h, 2)).toEqual(['removed']);
    await h.svc.guildEventRemove(h.actor(2), evId);
    expect(resultsFor(h, 2)).toEqual(['removed', 'eventGone']);
    expect((await h.svc.snapshot(1)).guild?.events).toHaveLength(0);
  });

  it('pushes a fresh snapshot to online members after create and remove', async () => {
    const h = await seatedGuild();
    await h.svc.guildEventCreate(h.actor(2), {
      day: NEXT_WEEK,
      hour: null,
      title: 'Meet',
      note: '',
    });
    expect(h.tx.snapshotCount.get(2) ?? 0).toBeGreaterThan(0);
    expect(h.tx.snapshotCount.get(3) ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Guild billboard (motd): officer-gated set/clear, the server clamp, the
// snapshot lane, and the structured motdResult outcomes the client localizes.
// ---------------------------------------------------------------------------

describe('guild billboard (motd)', () => {
  // Leader (1) + officer (2) + member (3), officers/member online, motdResult
  // lane cleared; the seatedGuild recipe from the calendar suite.
  async function seatedGuild() {
    const h = setup();
    h.add(1, 'Lead');
    h.add(2, 'Officer');
    h.add(3, 'Member');
    h.tx.setOnline(2);
    h.tx.setOnline(3);
    await h.svc.guildCreate(h.actor(1), 'Night Watch');
    await h.svc.guildInvite(h.actor(1), 'Officer');
    await h.svc.guildAccept(h.actor(2));
    await h.svc.guildInvite(h.actor(1), 'Member');
    await h.svc.guildAccept(h.actor(3));
    await h.svc.guildSetRank(h.actor(1), 'Officer', 'officer');
    h.tx.clear();
    return h;
  }

  function resultsFor(h: Awaited<ReturnType<typeof seatedGuild>>, id: number): string[] {
    return h.tx
      .eventsFor(id)
      .filter((e) => e.type === 'motdResult')
      .map((e: any) => e.code);
  }

  it('lets an officer set the billboard; the snapshot carries text + setter', async () => {
    const h = await seatedGuild();
    await h.svc.guildSetMotd(h.actor(2), 'Raid night Friday. Discord: discord.gg/example');
    expect(resultsFor(h, 2)).toEqual(['set']);
    const snap = await h.svc.snapshot(3);
    expect(snap.guild?.motd).toBe('Raid night Friday. Discord: discord.gg/example');
    expect(snap.guild?.motdSetBy).toBe('Officer');
  });

  it('lets the leader set the billboard', async () => {
    const h = await seatedGuild();
    await h.svc.guildSetMotd(h.actor(1), 'Welcome to Night Watch');
    expect(resultsFor(h, 1)).toEqual(['set']);
    const snap = await h.svc.snapshot(1);
    expect(snap.guild?.motd).toBe('Welcome to Night Watch');
    expect(snap.guild?.motdSetBy).toBe('Lead');
  });

  it('denies a plain member with notOfficer and writes nothing', async () => {
    const h = await seatedGuild();
    await h.svc.guildSetMotd(h.actor(1), 'Original');
    h.tx.clear();
    await h.svc.guildSetMotd(h.actor(3), 'Member takeover');
    expect(resultsFor(h, 3)).toEqual(['notOfficer']);
    const snap = await h.svc.snapshot(3);
    expect(snap.guild?.motd).toBe('Original');
    expect(snap.guild?.motdSetBy).toBe('Lead');
  });

  it('denies a character with no guild with notInGuild', async () => {
    const h = await seatedGuild();
    h.add(9, 'Loner');
    await h.svc.guildSetMotd(h.actor(9), 'Hello?');
    expect(resultsFor(h, 9)).toEqual(['notInGuild']);
  });

  it('trims and clamps the text to 240 characters (241 in, 240 stored)', async () => {
    const h = await seatedGuild();
    await h.svc.guildSetMotd(h.actor(2), `  ${'x'.repeat(241)}  `);
    const snap = await h.svc.snapshot(2);
    expect(snap.guild?.motd).toBe('x'.repeat(240));
    expect(snap.guild?.motd).toHaveLength(240);
  });

  it('never stores a lone surrogate when the clamp lands inside an astral pair', async () => {
    const h = await seatedGuild();
    // 239 ascii chars + an astral codepoint (2 UTF-16 units): the 240 slice
    // would cut the pair in half; the stored text drops the orphaned half.
    await h.svc.guildSetMotd(h.actor(2), `${'x'.repeat(239)}\u{1F600}`);
    const snap = await h.svc.snapshot(2);
    expect(snap.guild?.motd).toBe('x'.repeat(239));
    // and a well-formed message is untouched
    expect([...(snap.guild?.motd ?? '')].every((c) => !/[\uD800-\uDFFF]/.test(c))).toBe(true);
  });

  it('an empty (or whitespace-only) message clears the billboard and its attribution', async () => {
    const h = await seatedGuild();
    await h.svc.guildSetMotd(h.actor(2), 'Something');
    await h.svc.guildSetMotd(h.actor(1), '   ');
    expect(resultsFor(h, 1)).toEqual(['set']);
    const snap = await h.svc.snapshot(2);
    expect(snap.guild?.motd).toBe('');
    expect(snap.guild?.motdSetBy).toBe('');
  });

  it('pushes a fresh snapshot to every ONLINE guild member, and not to outsiders', async () => {
    const h = await seatedGuild();
    h.add(9, 'Loner');
    h.tx.setOnline(9);
    await h.svc.guildSetMotd(h.actor(2), 'Meeting at dusk');
    expect(h.tx.snapshotCount.get(2) ?? 0).toBeGreaterThan(0);
    expect(h.tx.snapshotCount.get(3) ?? 0).toBeGreaterThan(0);
    expect(h.tx.snapshotCount.get(9) ?? 0).toBe(0);
  });

  it('a fresh guild starts with an empty billboard', async () => {
    const h = await seatedGuild();
    const snap = await h.svc.snapshot(1);
    expect(snap.guild?.motd).toBe('');
    expect(snap.guild?.motdSetBy).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Deed unlock broadcast: marquee unlocks fan out to online guildmates and to
// the players who friended the earner. The caller (game.ts) owns the marquee
// bar, the retro gate, and the opt-out; this layer owns audience resolution,
// the ignore filter, and the id-based event shape.
// ---------------------------------------------------------------------------

describe('broadcastDeedUnlock', () => {
  // Earner 1 leads a guild seating 2 and 3; 4 follows the earner from outside
  // the guild; 5 is unrelated.
  async function deedSetup() {
    const h = setup();
    h.add(1, 'Earner');
    h.add(2, 'Guildie');
    h.add(3, 'Officerin');
    h.add(4, 'Follower');
    h.add(5, 'Stranger');
    for (const id of [1, 2, 3, 4, 5]) h.tx.setOnline(id);
    const created = await h.db.createGuildWithLeader('Bookbinders', 1);
    if ('error' in created) throw new Error('guild seed failed');
    await h.db.addGuildMemberAtomic(created.guildId, 2, 'member', 50);
    await h.db.addGuildMemberAtomic(created.guildId, 3, 'officer', 50);
    await h.db.addFriend(4, 1); // 4 put the earner on THEIR list
    return h;
  }

  it('delivers one id-based frame to online guildmates and followers, never the earner', async () => {
    const h = await deedSetup();
    await h.svc.broadcastDeedUnlock(h.actor(1), 'prog_veteran');
    // The exact wire shape: ids and the earner's name only. Pinning the FULL
    // object also proves no `text` field rides along (the server never sends
    // English for this event; the client composes the visible line).
    const expected = { type: 'deedBroadcast', characterName: 'Earner', deedId: 'prog_veteran' };
    expect(h.tx.eventsFor(2)).toEqual([expected]);
    expect(h.tx.eventsFor(3)).toEqual([expected]);
    expect(h.tx.eventsFor(4)).toEqual([expected]);
    expect(h.tx.eventsFor(1)).toEqual([]); // the earner's toast is client-side
    expect(h.tx.eventsFor(5)).toEqual([]); // strangers never hear it
  });

  it('skips offline members and recipients who ignore the earner', async () => {
    const h = await deedSetup();
    h.tx.setOffline(2);
    await h.db.addBlock(3, 1); // 3 ignores the earner
    await h.svc.broadcastDeedUnlock(h.actor(1), 'cmb_thunzharr');
    expect(h.tx.eventsFor(2)).toEqual([]);
    expect(h.tx.eventsFor(3)).toEqual([]);
    expect(h.tx.eventsFor(4)).toHaveLength(1);
  });

  it('skips a recipient the earner has ignored', async () => {
    const h = await deedSetup();
    await h.db.addBlock(1, 2); // the earner blocks guildmate 2
    await h.db.addBlock(1, 4); // and follower 4 (blockAdd cannot unfriend THEIR edge)
    await h.svc.broadcastDeedUnlock(h.actor(1), 'prog_veteran');
    expect(h.tx.eventsFor(2)).toEqual([]);
    expect(h.tx.eventsFor(4)).toEqual([]);
    expect(h.tx.eventsFor(3)).toHaveLength(1); // unblocked guildmate still hears it
  });

  it('delivers exactly once to a follower who is also a guildmate', async () => {
    const h = await deedSetup();
    await h.db.addFriend(2, 1); // guildmate 2 also follows the earner
    await h.svc.broadcastDeedUnlock(h.actor(1), 'prog_veteran');
    expect(h.tx.eventsFor(2)).toHaveLength(1);
  });

  it('is a quiet no-op for a guildless earner nobody follows', async () => {
    const h = setup();
    h.add(9, 'Hermit');
    h.tx.setOnline(9);
    await h.svc.broadcastDeedUnlock(h.actor(9), 'prog_veteran');
    expect(h.tx.delivered.size).toBe(0);
  });

  it('keeps the SocialEvent and SimEvent declarations structurally identical', () => {
    // The event is declared in BOTH unions (SocialEvent for server delivery,
    // SimEvent so the one client event switch stays well-typed) and the client
    // casts one to the other on the events-frame passthrough. A field added or
    // retyped on either side alone reds tsc here: the literal must satisfy the
    // SocialEvent arm AND annotate as the SimEvent arm, and flow back.
    const fromSocial: Extract<SimEvent, { type: 'deedBroadcast' }> = {
      type: 'deedBroadcast',
      characterName: 'Earner',
      deedId: 'prog_veteran',
    } satisfies Extract<SocialEvent, { type: 'deedBroadcast' }>;
    const fromSim: Extract<SocialEvent, { type: 'deedBroadcast' }> = fromSocial;
    expect(fromSim).toEqual(fromSocial);
  });
});

// ---------------------------------------------------------------------------
// Guild Bank Phase 3: the create-commit hook (book seed + fee, via the
// transport) and the disband guard over the live book's holdings.
// ---------------------------------------------------------------------------

describe('guild bank persistence hooks (Guild Bank Phase 3)', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
    h.add(1, 'Aleph');
    h.add(2, 'Bet');
    h.tx.setOnline(1);
    h.tx.setOnline(2);
  });

  it('onGuildCreated fires once, in the committed success arm only, AFTER the founder stamp', async () => {
    // The boolean is the reserve-at-gate refund signal (Guild Bank Phase 3
    // QA): FALSE on every refusal arm (the dispatch gate refunds the reserved
    // fee), TRUE only on the committed success arm (the hook consumed it).
    await expect(h.svc.guildCreate(h.actor(1), 'no')).resolves.toBe(false); // invalid name
    expect(h.tx.created).toEqual([]);
    await expect(h.svc.guildCreate(h.actor(1), 'Iron Vanguard')).resolves.toBe(true);
    expect(h.tx.created).toEqual([{ id: 1, guildId: 1 }]);
    // Ordering: the membership stamp (the authorization input) landed BEFORE
    // the seed/fee hook, in the same synchronous success arm.
    expect(h.tx.membershipStamps).toEqual([
      { id: 1, membership: { guildId: 1, guildName: 'Iron Vanguard', rank: 'leader' } },
    ]);
    // Refusals after: duplicate name, already guilded. No further hook calls,
    // and both report false so the gate refunds.
    await expect(h.svc.guildCreate(h.actor(2), 'iron vanguard')).resolves.toBe(false);
    await expect(h.svc.guildCreate(h.actor(1), 'Second Banner')).resolves.toBe(false);
    expect(h.tx.created).toEqual([{ id: 1, guildId: 1 }]);
  });

  it('disband refuses while the bank holds copper, and again while it holds items', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    for (const holdings of [
      { copper: 5, items: 0 },
      { copper: 0, items: 1 },
    ]) {
      h.tx.holdings.set(1, holdings);
      await h.svc.guildDisband(h.actor(1));
      expect(h.tx.errorsFor(1)).toContain(
        'The guild bank must be emptied before the guild can be disbanded.',
      );
      // Refused: the guild survives, nothing stamped, nothing evicted.
      expect(h.db.guildCount()).toBe(1);
      expect(h.tx.membershipStamps).toEqual(
        expect.arrayContaining([expect.objectContaining({ membership: expect.anything() })]),
      );
      expect(h.tx.disbanded).toEqual([]);
      h.tx.clear();
    }
    // The refusal stamped NOTHING beyond the create's founder stamp.
    expect(h.tx.membershipStamps).toHaveLength(1);
  });

  it('disband fails CLOSED when no book is loaded (holdings null)', async () => {
    // An unloaded book cannot prove the persisted row is empty (the oversized
    // boot-skip state): the guard must refuse rather than cascade-delete it.
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    h.tx.holdings.set(1, null);
    await h.svc.guildDisband(h.actor(1));
    expect(h.tx.errorsFor(1)).toContain(
      'The guild bank must be emptied before the guild can be disbanded.',
    );
    expect(h.db.guildCount()).toBe(1);
    expect(h.tx.disbanded).toEqual([]);
  });

  it('an empty bank disbands: the guild deletes, members clear, the book evicts once', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    // The default FakeTransport holdings are an EMPTY book ({0, 0}).
    h.tx.membershipStamps = [];
    await h.svc.guildDisband(h.actor(1));
    expect(h.db.guildCount()).toBe(0);
    expect(h.tx.membershipStamps).toEqual([{ id: 1, membership: null }]);
    expect(h.tx.disbanded).toEqual([1]); // the evict hook, exactly once
    // A second disband finds no guild and evicts nothing further.
    await h.svc.guildDisband(h.actor(1));
    expect(h.tx.disbanded).toEqual([1]);
  });

  it('the guard reads holdings for the LEADER path only after the rank checks', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.holdings.set(1, { copper: 99, items: 0 });
    // A member cannot reach the guard: the rank refusal comes first and the
    // bank refusal line never fires for them.
    await h.svc.guildDisband(h.actor(2));
    expect(h.tx.errorsFor(2)).toContain('Only the Guild Master may disband the guild.');
    expect(h.tx.errorsFor(2)).not.toContain(
      'The guild bank must be emptied before the guild can be disbanded.',
    );
    expect(h.db.guildCount()).toBe(1);
  });
});

describe('guild bank guard on last-member guildLeave (Guild Bank Phase 3)', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => {
    h = setup();
    h.add(1, 'Aleph');
    h.add(2, 'Bet');
    h.tx.setOnline(1);
    h.tx.setOnline(2);
  });

  it('a solo Guild Master /gquit with a stocked bank is refused BEFORE any row moves', async () => {
    // Last-member-out deletes the guild, which cascades the guild_banks row
    // away exactly like /gdisband: without this guard a solo GM /gquit
    // destroys the whole book.
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    for (const holdings of [{ copper: 7, items: 0 }, { copper: 0, items: 2 }, null]) {
      h.tx.holdings.set(1, holdings);
      h.tx.membershipStamps = [];
      await h.svc.guildLeave(h.actor(1));
      expect(h.tx.errorsFor(1)).toContain(
        'The guild bank must be emptied before the guild can be disbanded.',
      );
      // Refused before ANY mutation: still a member, guild alive, no stamp,
      // no evict.
      expect(h.db.guildCount()).toBe(1);
      expect(await h.db.guildMembership(1)).not.toBeNull();
      expect(h.tx.membershipStamps).toEqual([]);
      expect(h.tx.disbanded).toEqual([]);
      h.tx.clear();
    }
  });

  it('a solo Guild Master /gquit with an empty bank deletes the guild and evicts once', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    h.tx.membershipStamps = [];
    await h.svc.guildLeave(h.actor(1)); // default holdings: the empty book
    expect(h.db.guildCount()).toBe(0);
    expect(await h.db.guildMembership(1)).toBeNull();
    expect(h.tx.membershipStamps).toEqual([{ id: 1, membership: null }]);
    expect(h.tx.disbanded).toEqual([1]);
  });

  it('a NON-last member leaving never consults the guard (the bank cannot trap them)', async () => {
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    await h.svc.guildInvite(h.actor(1), 'Bet');
    await h.svc.guildAccept(h.actor(2));
    h.tx.holdings.set(1, { copper: 999, items: 9 }); // stocked bank
    await h.svc.guildLeave(h.actor(2)); // Bet leaves; Aleph remains
    expect(h.tx.errorsFor(2)).not.toContain(
      'The guild bank must be emptied before the guild can be disbanded.',
    );
    expect(await h.db.guildMembership(2)).toBeNull(); // the leave went through
    expect(h.db.guildCount()).toBe(1); // guild survives with its bank
    expect(h.tx.disbanded).toEqual([]);
  });
});
