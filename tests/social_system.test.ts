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
  async setGuildRank(c: number, rank: GuildRank): Promise<void> {
    const m = this.members.get(c);
    if (m) m.rank = rank;
  }
  private lastLogins = new Map<number, string>();
  setLastLogin(id: number, iso: string): void {
    this.lastLogins.set(id, iso);
  }
  async guildMembers(
    guildId: number,
  ): Promise<
    (CharInfo & { rank: GuildRank; lastLogin: string | null; activeTitle: string | null })[]
  > {
    return [...this.members.entries()]
      .filter(([, m]) => m.guildId === guildId)
      .map(([cid, m]) => ({
        ...this.chars.get(cid)!,
        rank: m.rank,
        lastLogin: this.lastLogins.get(cid) ?? null,
      }));
  }
  guildCount(): number {
    return this.guilds.size;
  } // test helper: detect orphaned guilds

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
  onBlocksChanged(id: number, ids: number[]): void {
    this.blockSets.set(id, ids);
  }
  founded: number[] = [];
  onGuildFounded(id: number): void {
    this.founded.push(id);
  }
  isBlocking(recipientId: number, senderCharacterId: number): boolean {
    return !!this.db.blocks.get(recipientId)?.has(senderCharacterId);
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
  }
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

  it('rejects an invalid or duplicate guild name', async () => {
    await h.svc.guildCreate(h.actor(1), 'no');
    expect(h.tx.errorsFor(1).join()).toMatch(/3-24 letters/);
    await h.svc.guildCreate(h.actor(1), 'Iron Vanguard');
    h.tx.clear();
    await h.svc.guildCreate(h.actor(2), 'iron vanguard');
    expect(h.tx.errorsFor(2).join()).toMatch(/already exists/i);
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
