import type { Sim } from '../src/sim/sim';
import { ACCOUNT_BLOCK_CACHE_MAX, ACCOUNT_BLOCK_RESYNC_BATCH } from './account_friends_db';
import { guildStampRankOf, type SocialSnapshot } from './social';

export interface AccountSocialSession {
  accountId: number;
  characterId: number;
  pid: number;
  left: boolean;
  blockedIds: Set<number>;
  blockedAccountIds: Set<number>;
  blockListLoaded: boolean;
  blockListOverflow?: boolean;
  guildStampSeq: number;
  socialTrackedIds?: number[];
}

interface SocialPageState {
  cursor: number;
  token: number;
  next: { token: number; cursor: number } | null;
}

interface AccountBlockReader {
  blockedIds(id: number, candidates?: readonly number[]): Promise<number[]>;
  blockedAccountIds(id: number): Promise<number[]>;
  blockedAccountIdsForAccounts?(accountIds: readonly number[]): Promise<Map<number, number[]>>;
}

/** One running read and one dirty bit per live identity; bursts never queue N reads. */
class RefreshQueue<K> {
  private readonly pending = new Map<
    K,
    {
      dirty: boolean;
      firstJoin: boolean;
      done: Promise<void>;
      read: (firstJoin: boolean) => Promise<void>;
    }
  >();

  run(key: K, firstJoin: boolean, read: (firstJoin: boolean) => Promise<void>): Promise<void> {
    const existing = this.pending.get(key);
    if (existing) {
      existing.dirty = true;
      existing.firstJoin ||= firstJoin;
      existing.read = read;
      return existing.done;
    }
    const entry = { dirty: false, firstJoin, done: Promise.resolve(), read };
    this.pending.set(key, entry);
    entry.done = (async () => {
      try {
        do {
          entry.dirty = false;
          const initial = entry.firstJoin;
          entry.firstJoin = false;
          await entry.read(initial);
        } while (entry.dirty);
      } finally {
        this.pending.delete(key);
      }
    })();
    return entry.done;
  }
}

/** Indexed by authenticated account, retained only while that account has sessions. */
export class AccountSocialHost<S extends AccountSocialSession> {
  readonly sessionsByAccountId = new Map<number, Set<S>>();
  private readonly snapshots = new RefreshQueue<S>();
  private readonly blocks = new RefreshQueue<number>();
  private readonly friendPages = new WeakMap<S, SocialPageState>();
  private readonly blockPages = new WeakMap<S, SocialPageState>();
  private readonly blockGenerations = new Map<number, number>();
  private blockGenerationSequence = 0;
  private blockListenerReady = true;

  constructor(private readonly observeCost: (ms: number) => void = () => {}) {}

  setBlockListenerReady(ready: boolean): void {
    this.blockListenerReady = ready;
    if (!ready) this.invalidateBlocks();
  }

  invalidateBlocks(accountId?: number): void {
    const accounts = accountId === undefined ? this.sessionsByAccountId.keys() : [accountId];
    for (const id of accounts) {
      if (!this.sessionsByAccountId.has(id)) continue;
      this.blockGenerations.set(id, ++this.blockGenerationSequence);
      for (const live of this.sessionsByAccountId.get(id) ?? []) live.blockListLoaded = false;
    }
  }

  async refreshAccountBlocks(accountId: number, db: AccountBlockReader): Promise<void> {
    const live = this.online(accountId);
    if (live) await this.hydrateBlocks(live, db);
  }

  async resyncBlocks(db: AccountBlockReader): Promise<void> {
    if (!db.blockedAccountIdsForAccounts) {
      for (const id of this.sessionsByAccountId.keys()) await this.refreshAccountBlocks(id, db);
      return;
    }
    const ids = [...this.sessionsByAccountId.keys()];
    for (let offset = 0; offset < ids.length; offset += ACCOUNT_BLOCK_RESYNC_BATCH) {
      const batch = ids.slice(offset, offset + ACCOUNT_BLOCK_RESYNC_BATCH);
      const generations = new Map<number, number>();
      for (const id of batch) {
        this.invalidateBlocks(id);
        generations.set(id, this.blockGenerations.get(id) ?? -1);
      }
      const blocks = await db.blockedAccountIdsForAccounts(batch);
      if (!this.blockListenerReady) return;
      for (const id of batch) {
        if (this.blockGenerations.get(id) !== generations.get(id)) continue;
        this.applyBlockSet(id, [], blocks.get(id) ?? []);
        this.blockGenerations.delete(id);
      }
    }
  }

  add(session: S): void {
    let sessions = this.sessionsByAccountId.get(session.accountId);
    if (!sessions) {
      sessions = new Set();
      this.sessionsByAccountId.set(session.accountId, sessions);
    }
    sessions.add(session);
  }

  remove(session: S): void {
    const sessions = this.sessionsByAccountId.get(session.accountId);
    sessions?.delete(session);
    if (!sessions?.size) {
      this.sessionsByAccountId.delete(session.accountId);
      // Fence an old read before a replacement session with the same account can join.
      this.blockGenerations.delete(session.accountId);
    }
  }

  online(accountId: number): S | null {
    for (const session of this.sessionsByAccountId.get(accountId) ?? []) {
      if (!session.left) return session;
    }
    return null;
  }

  friend(accountId: number, sim: Pick<Sim, 'meta' | 'entities'>, realm: string) {
    const live = this.online(accountId);
    const meta = live ? sim.meta(live.pid) : null;
    const entity = live ? sim.entities.get(live.pid) : null;
    return live && meta && entity
      ? {
          id: live.characterId,
          name: entity.name,
          cls: meta.cls,
          level: entity.level,
          realm,
          activeTitle: meta.activeTitle ?? null,
        }
      : null;
  }

  selectFriendPage(session: S, token: unknown): boolean {
    return this.selectPage(session, token, this.friendPages);
  }

  selectBlockPage(session: S, token: unknown): boolean {
    return this.selectPage(session, token, this.blockPages);
  }

  private selectPage(session: S, token: unknown, pages: WeakMap<S, SocialPageState>): boolean {
    if (token === undefined || token === 0) {
      const prior = pages.get(session);
      pages.set(session, { cursor: 0, token: prior?.token ?? 0, next: null });
      return true;
    }
    if (!Number.isSafeInteger(token)) return false;
    const page = pages.get(session);
    if (!page?.next || token !== page.next.token) return false;
    page.cursor = page.next.cursor;
    page.next = null;
    return true;
  }

  async friendSnapshot(
    session: S,
    read: (cursor: number, blockCursor: number) => Promise<SocialSnapshot>,
    retry = 0,
  ): Promise<SocialSnapshot> {
    let page = this.friendPages.get(session);
    if (!page) {
      page = { cursor: 0, token: 0, next: null };
      this.friendPages.set(session, page);
    }
    let blocks = this.blockPages.get(session);
    if (!blocks) {
      blocks = { cursor: 0, token: 0, next: null };
      this.blockPages.set(session, blocks);
    }
    const cursor = page.cursor;
    const blockCursor = blocks.cursor;
    const snap = await read(cursor, blockCursor);
    if (
      this.friendPages.get(session) !== page ||
      page.cursor !== cursor ||
      this.blockPages.get(session) !== blocks ||
      blocks.cursor !== blockCursor
    ) {
      if (retry === 0) return this.friendSnapshot(session, read, 1);
      throw new Error('Account social page changed while reading');
    }
    const token = ++page.token;
    page.next = snap.friendsNextCursor == null ? null : { token, cursor: snap.friendsNextCursor };
    const blockToken = ++blocks.token;
    blocks.next =
      snap.blocksNextCursor == null ? null : { token: blockToken, cursor: snap.blocksNextCursor };
    // Internal account ordering never crosses the wire. Only a session-local continuation token does.
    return {
      ...snap,
      friendsCursor: cursor === 0 ? 0 : 1,
      friendsNextCursor: page.next ? token : null,
      blocksCursor: blockCursor === 0 ? 0 : 1,
      blocksNextCursor: blocks.next ? blockToken : null,
      blocksUnavailable: session.blockListOverflow === true,
    };
  }

  isBlocking(recipient: S, sender: S): boolean {
    if (recipient.characterId === sender.characterId) return false;
    if (!recipient.blockListLoaded) return true;
    return (
      recipient.blockedIds.has(sender.characterId) ||
      recipient.blockedAccountIds.has(sender.accountId)
    );
  }

  hydrateBlocks(session: S, db: AccountBlockReader): Promise<void> {
    return this.refreshBlocks(session, async () => {
      const [characters, accounts] = await Promise.all([
        // Live senders carry authenticated account IDs, so never expand a
        // historical account-block union into every offline alt on hydration.
        db.blockedIds(session.characterId, []),
        db.blockedAccountIds(session.characterId),
      ]);
      return { characters, accounts };
    });
  }

  refreshBlocks(
    session: S,
    load: () => Promise<{ characters: number[]; accounts: number[] }>,
  ): Promise<void> {
    const generation = ++this.blockGenerationSequence;
    this.blockGenerations.set(session.accountId, generation);
    // Invalidate synchronously: neither the in-flight DB window nor a failed read may leak presence.
    for (const live of this.sessionsByAccountId.get(session.accountId) ?? [])
      live.blockListLoaded = false;
    const work = this.blocks.run(session.accountId, false, async () => {
      const before = this.blockGenerations.get(session.accountId);
      const { characters, accounts } = await load();
      if (!this.blockListenerReady || before !== this.blockGenerations.get(session.accountId))
        return;
      this.applyBlockSet(session.accountId, characters, accounts);
    });
    return work.finally(() => {
      if (this.blockGenerations.get(session.accountId) === generation)
        this.blockGenerations.delete(session.accountId);
    });
  }

  private applyBlockSet(accountId: number, characters: number[], accounts: number[]): void {
    const started = performance.now();
    try {
      const overflow = accounts.length > ACCOUNT_BLOCK_CACHE_MAX;
      // Never publish a truncated privacy list. Keep durable edges and the paged
      // management UI available; overflow denies presence until reduced or migrated.
      const characterSet = new Set(overflow ? [] : characters);
      const accountSet = new Set(overflow ? [] : accounts);
      for (const live of this.sessionsByAccountId.get(accountId) ?? []) {
        live.blockListOverflow = overflow;
        live.blockedIds = characterSet;
        live.blockedAccountIds = accountSet;
        live.blockListLoaded = !overflow;
      }
    } finally {
      this.observeCost(performance.now() - started);
    }
  }

  snapshot(
    session: S,
    firstJoin: boolean,
    read: (initial: boolean) => Promise<void>,
  ): Promise<void> {
    return this.snapshots.run(session, firstJoin, async (initial) => {
      if (!session.left) await read(initial);
    });
  }

  pushAccountSnapshots(session: S, push: (characterId: number) => void): void {
    for (const live of this.sessionsByAccountId.get(session.accountId) ?? []) {
      if (!live.left) push(live.characterId);
    }
  }
}

/** Snapshot IO remains outside the sim; the synchronous guild fence keeps authority current. */
export async function sendAccountSocialSnapshot<S extends AccountSocialSession>(
  session: S,
  firstJoin: boolean,
  deps: {
    snapshot(characterId: number): Promise<SocialSnapshot>;
    sim: Pick<
      Sim,
      'guildBanks' | 'setPlayerGuild' | 'setPlayerGuildMembership' | 'setPlayerPledge'
    >;
    ensureGuildLoaded(guildId: number): Promise<unknown>;
    current(): boolean;
    send(snapshot: SocialSnapshot): void;
  },
): Promise<void> {
  const seqBefore = session.guildStampSeq;
  const snap = await deps.snapshot(session.characterId);
  if (!deps.current()) return;
  if (snap.guild && !deps.sim.guildBanks.has(snap.guild.id))
    await deps.ensureGuildLoaded(snap.guild.id);
  if (!deps.current()) return;
  deps.send(snap);
  // First join silently reconciles the existing membership deed. Later stamps are live joins.
  if (session.guildStampSeq === seqBefore) {
    deps.sim.setPlayerGuild(session.pid, snap.guild?.name ?? '', { retroDeeds: firstJoin });
    deps.sim.setPlayerGuildMembership(
      session.pid,
      snap.guild ? { guildId: snap.guild.id, rank: guildStampRankOf(snap.guild) } : null,
    );
    deps.sim.setPlayerPledge(
      session.pid,
      snap.guild ? '' : (snap.myPledge?.guildName ?? ''),
      snap.guild?.tier ?? snap.myPledge?.tier ?? 0,
    );
  }
  session.socialTrackedIds = [
    ...snap.friends.map((f) => f.id),
    ...(snap.guild?.members.map((m) => m.id) ?? []),
  ];
}

/** Hydrate privacy before presence; an unavailable block read keeps presence fail-closed. */
export async function initializeAccountSocial(
  session: { ignoredIds: Set<number>; left: boolean },
  _firstJoin: boolean,
  deps: {
    blocks(): Promise<void>;
    ignores(): Promise<number[]>;
    snapshot(): Promise<void>;
    announce(): Promise<void>;
  },
): Promise<void> {
  try {
    await deps.blocks();
  } catch (err) {
    console.error('failed to load block list:', err);
  }
  try {
    session.ignoredIds = new Set(await deps.ignores());
  } catch (err) {
    console.error('failed to load ignore list:', err);
  }
  if (session.left) return;
  await deps.snapshot();
  if (!session.left)
    await deps.announce().catch((err) => console.error('presence announce failed:', err));
}
