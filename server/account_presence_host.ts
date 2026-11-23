// Only live account relationships belong in this cache. UI pagination never
// changes presence permissions; snapshots and position pushes perform no I/O.
export interface PresenceEdge {
  accountId: number;
  outgoing: boolean;
  incoming: boolean;
}
export interface PresenceEdgeReader {
  presenceEdgesForAccount(
    accountId: number,
    candidates: readonly number[],
  ): Promise<PresenceEdge[]>;
}
export interface LivePresenceEdge {
  ownerId: number;
  friendId: number;
}
export interface LivePresenceEdgeReader {
  presenceEdgesForLiveAccounts(ids: readonly number[]): Promise<LivePresenceEdge[]>;
}
interface Session {
  accountId: number;
  friendAccountIds?: ReadonlySet<number>;
}
export class AccountPresenceHost<S extends Session> {
  private readonly edges = new Map<number, Set<number>>();
  private readonly epochs = new Map<number, number>();
  private readonly pending = new Map<number, { dirty: boolean; done: Promise<void> }>();
  private epoch = 0;

  constructor(private readonly sessions: ReadonlyMap<number, ReadonlySet<S>>) {}

  friends(accountId: number): ReadonlySet<number> {
    let set = this.edges.get(accountId);
    if (!set) {
      set = new Set();
      this.edges.set(accountId, set);
    }
    for (const session of this.sessions.get(accountId) ?? []) session.friendAccountIds = set;
    return set;
  }

  invalidate(accountId?: number): void {
    if (accountId === undefined) {
      for (const id of this.sessions.keys()) this.epochs.set(id, ++this.epoch);
      for (const set of this.edges.values()) set.clear();
      return;
    }
    const ids = accountId === undefined ? [...this.sessions.keys()] : [accountId];
    for (const id of ids) {
      if (!this.sessions.has(id) && !this.pending.has(id) && !this.edges.has(id)) continue;
      this.epochs.set(id, ++this.epoch);
      this.edges.get(id)?.clear();
      for (const set of this.edges.values()) set.delete(id);
    }
  }

  remove(accountId: number): void {
    if (this.sessions.has(accountId)) return;
    this.invalidate(accountId);
    this.edges.delete(accountId);
    if (!this.pending.has(accountId)) this.epochs.delete(accountId);
  }

  /** Reconnect reads actual live edges once, rather than every possible pair. */
  async resync(db: LivePresenceEdgeReader): Promise<void> {
    this.invalidate();
    const ids = [...this.sessions.keys()];
    const epochs = new Map(ids.map((id) => [id, this.epochs.get(id)]));
    for (const id of ids) this.friends(id);
    const rows = await db.presenceEdgesForLiveAccounts(ids);
    for (const { ownerId, friendId } of rows) {
      if (!epochs.has(ownerId) || !epochs.has(friendId)) continue;
      if (!this.sessions.has(ownerId) || !this.sessions.has(friendId)) continue;
      if (
        this.epochs.get(ownerId) !== epochs.get(ownerId) ||
        this.epochs.get(friendId) !== epochs.get(friendId)
      )
        continue;
      this.edges.get(ownerId)!.add(friendId);
    }
  }

  refresh(accountId: number, db: PresenceEdgeReader): Promise<void> {
    this.invalidate(accountId);
    if (!this.sessions.has(accountId)) return Promise.resolve();
    const prior = this.pending.get(accountId);
    if (prior) {
      prior.dirty = true;
      return prior.done;
    }
    const entry = { dirty: false, done: Promise.resolve() };
    this.pending.set(accountId, entry);
    entry.done = (async () => {
      try {
        do {
          entry.dirty = false;
          if (!this.sessions.has(accountId)) break;
          this.friends(accountId);
          const epoch = this.epochs.get(accountId);
          const candidates = [...this.sessions.keys()].filter((id) => id !== accountId);
          const peerEpochs = new Map(candidates.map((id) => [id, this.epochs.get(id)]));
          const rows = await db.presenceEdgesForAccount(accountId, candidates);
          if (!this.sessions.has(accountId) || this.epochs.get(accountId) !== epoch) continue;
          const own = this.edges.get(accountId)!;
          for (const row of rows) {
            if (!peerEpochs.has(row.accountId) || !this.sessions.has(row.accountId)) continue;
            // A newer mutation or reconnect owns this pair, never this old read.
            if (this.epochs.get(row.accountId) !== peerEpochs.get(row.accountId)) continue;
            this.friends(row.accountId);
            if (row.outgoing) own.add(row.accountId);
            if (row.incoming) this.edges.get(row.accountId)!.add(accountId);
          }
        } while (entry.dirty);
      } finally {
        this.pending.delete(accountId);
        if (!this.sessions.has(accountId)) {
          this.edges.delete(accountId);
          this.epochs.delete(accountId);
        }
      }
    })();
    return entry.done;
  }
}
