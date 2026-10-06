import {
  type AccountMountItemsRow,
  accountMountSkinIds,
  characterMountSkinIds,
} from './account_mount_items_core';
import {
  accountMountItemsHydrationFresh,
  invalidateAccountMountItemsHydration,
} from './account_mount_items_hydration';
import {
  ACCOUNT_MOUNT_ITEMS_MAX_READS,
  loadAccountMountItemsBounded,
} from './account_mount_items_loader';

export const ACCOUNT_MOUNT_ITEMS_REFRESH_MS = 30_000;
export { ACCOUNT_MOUNT_ITEMS_MAX_READS } from './account_mount_items_loader';

export interface MountItemsSession {
  accountId: number;
  characterId: number;
  pid: number;
}
export interface MountItemsMeta {
  wireRev: number;
  bankWireRev: number;
  inventory: readonly { itemId: string; count: number }[];
  bank: { inventory: readonly { itemId: string; count: number }[] };
}
export interface AccountMountItemsHost {
  meta(pid: number): MountItemsMeta | null | undefined;
  setCollectible(accountId: number, ids: string[], sessions: Iterable<MountItemsSession>): void;
  onError?(err: unknown): void;
  onWorkMs?(durationMs: number): void;
}
interface AccountState {
  sessions: Set<MountItemsSession>;
  departing: Set<number>;
  saved: Map<number, readonly string[]>;
  live: Map<number, readonly string[]>;
  revisions: Map<number, [number, number]>;
  published: string;
  nextRefresh: number;
  loading: boolean;
  snapshotRevision: number;
}

/** O(1) dirty probes, changed character container scans, indexed account fanout.
 * Remote updates are visible after their normal durable autosave and the next
 * 30 second refresh. Query concurrency is process-bounded; no command does SQL. */
export class AccountMountItemsService {
  private readonly accounts = new Map<number, AccountState>();
  private readonly pending = new Map<number, AccountState>();
  private activeReads = 0;

  constructor(
    private readonly host: AccountMountItemsHost,
    private readonly load = loadAccountMountItemsBounded,
  ) {}

  join(session: MountItemsSession, rows?: readonly AccountMountItemsRow[]): void {
    let state = this.accounts.get(session.accountId);
    if (!state) {
      state = {
        sessions: new Set(),
        departing: new Set(),
        saved: new Map(),
        live: new Map(),
        revisions: new Map(),
        published: '',
        nextRefresh: 0,
        loading: false,
        snapshotRevision: 0,
      };
      this.accounts.set(session.accountId, state);
    }
    state.sessions.add(session);
    if (rows && accountMountItemsHydrationFresh(session.accountId, rows)) {
      state.snapshotRevision++;
      state.saved = new Map(rows.map((row) => [row.characterId, row.mountSkinIds]));
      state.nextRefresh = Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS;
    } else if (rows) {
      state.nextRefresh = 0;
    }
    this.probe(session, Date.now());
    // Even a second character with no new item must receive the cached union.
    this.publish(session.accountId, state, true);
  }

  probe(session: MountItemsSession, nowMs: number): void {
    const state = this.accounts.get(session.accountId);
    if (!state) return;
    this.syncOne(session, state);
    if (nowMs >= state.nextRefresh && !state.loading && !this.pending.has(session.accountId)) {
      state.nextRefresh = nowMs + ACCOUNT_MOUNT_ITEMS_REFRESH_MS;
      this.pending.set(session.accountId, state);
      this.drain();
    }
  }

  /** Command authorization refreshes live overrides without scheduling SQL. */
  syncAccount(session: MountItemsSession): void {
    const state = this.accounts.get(session.accountId);
    if (!state) return;
    for (const live of state.sessions) this.syncOne(live, state);
  }

  private syncOne(session: MountItemsSession, state: AccountState): void {
    const meta = this.host.meta(session.pid);
    const rev = state.revisions.get(session.characterId);
    if (meta && (!rev || rev[0] !== meta.wireRev || rev[1] !== meta.bankWireRev)) {
      state.revisions.set(session.characterId, [meta.wireRev, meta.bankWireRev]);
      const ids = characterMountSkinIds(meta);
      if (ids.join(',') !== state.live.get(session.characterId)?.join(',')) {
        state.live.set(session.characterId, ids);
        this.publish(session.accountId, state);
      }
    }
  }

  leave(session: MountItemsSession): void {
    const state = this.accounts.get(session.accountId);
    if (!state) return;
    this.syncOne(session, state);
    state.sessions.delete(session);
    state.departing.add(session.characterId);
    invalidateAccountMountItemsHydration(session.accountId);
    state.revisions.delete(session.characterId);
    // Keep the final live override even after the last session leaves. Character
    // switching hydrates from a pre-save snapshot and must still see this mask.
    // Retention is bounded by the server's outstanding final character saves.
    if (state.sessions.size === 0) {
      this.pending.delete(session.accountId);
    }
  }

  /** Call after the final character save settles; later remote changes may then
   * replace the departed character's projection on the normal refresh cadence. */
  settledLeave(accountId: number, characterId: number): void {
    const state = this.accounts.get(accountId);
    if (!state) return;
    state.departing.delete(characterId);
    invalidateAccountMountItemsHydration(accountId);
    if ([...state.sessions].some((session) => session.characterId === characterId)) return;
    const ids = state.live.get(characterId);
    if (ids) state.saved.set(characterId, ids);
    state.live.delete(characterId);
    // A read launched before the final save settled may carry its preimage.
    state.snapshotRevision++;
    state.nextRefresh = 0;
    if (state.sessions.size === 0 && state.departing.size === 0) {
      this.accounts.delete(accountId);
      this.pending.delete(accountId);
    }
  }

  private publish(accountId: number, state: AccountState, force = false): void {
    const ids = accountMountSkinIds(state.saved, state.live);
    const key = ids.join(',');
    if (!force && state.published === key) return;
    state.published = key;
    this.host.setCollectible(accountId, ids, state.sessions);
  }

  private drain(): void {
    while (this.activeReads < ACCOUNT_MOUNT_ITEMS_MAX_READS && this.pending.size > 0) {
      const next = this.pending.entries().next().value;
      if (!next) return;
      const [accountId, state] = next;
      this.pending.delete(accountId);
      if (this.accounts.get(accountId) !== state) continue;
      state.loading = true;
      this.activeReads++;
      const snapshotRevision = state.snapshotRevision;
      void this.load(accountId)
        .then((rows) => {
          const started = performance.now();
          try {
            if (this.accounts.get(accountId) !== state || state.sessions.size === 0) return;
            if (
              state.snapshotRevision !== snapshotRevision ||
              !accountMountItemsHydrationFresh(accountId, rows)
            ) {
              state.nextRefresh = 0;
              return;
            }
            state.saved = new Map(rows.map((row) => [row.characterId, row.mountSkinIds]));
            this.publish(accountId, state);
          } finally {
            this.host.onWorkMs?.(performance.now() - started);
          }
        })
        .catch((err: unknown) => {
          // Keep last known ownership and retry on the bounded cadence.
          this.host.onError?.(err);
        })
        .finally(() => {
          state.loading = false;
          this.activeReads--;
          this.drain();
        });
    }
  }
}
