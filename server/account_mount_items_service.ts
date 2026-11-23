import {
  type AccountMountItemsRefreshRow,
  type AccountMountItemsRow,
  accountMountSkinIds,
  characterMountSkinIds,
  mergeAccountMountItemsRows,
} from './account_mount_items_core';
import { refreshAccountMountItems } from './account_mount_items_db';
import {
  accountMountItemsHydrationFresh,
  captureAccountMountItemsHydration,
  invalidateAccountMountItemsHydration,
} from './account_mount_items_hydration';
import { loadAccountMountItemsBounded } from './account_mount_items_loader';
import type { BackgroundDbPermit } from './background_db_gate';

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
  setCollectible(
    accountId: number,
    ids: string[],
    sessions: Iterable<MountItemsSession>,
    authoritative: boolean,
  ): void;
  tryAcquireRefreshPermit?(): BackgroundDbPermit | null | undefined;
  onError?(err: unknown): void;
  onWorkMs?(durationMs: number): void;
}
interface AccountState {
  sessions: Set<MountItemsSession>;
  departing: Set<number>;
  saved: Map<number, readonly string[]>;
  versions: Map<number, string>;
  hydrationKnown: boolean;
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
    private readonly refresh: (
      accountId: number,
      knownVersions: Readonly<Record<string, string>>,
    ) => Promise<AccountMountItemsRefreshRow[]> = load === loadAccountMountItemsBounded
      ? refreshAccountMountItems
      : load,
  ) {}

  join(session: MountItemsSession, rows?: readonly AccountMountItemsRow[]): void {
    let state = this.accounts.get(session.accountId);
    if (!state) {
      state = {
        sessions: new Set(),
        departing: new Set(),
        saved: new Map(),
        versions: new Map(),
        hydrationKnown: false,
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
      state.versions = new Map(
        rows.flatMap((row) =>
          row.version === undefined ? [] : [[row.characterId, row.version] as const],
        ),
      );
      state.hydrationKnown = true;
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
    state.versions.delete(characterId);
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
    this.host.setCollectible(accountId, ids, state.sessions, state.hydrationKnown);
  }

  private drain(deferred = false): void {
    while (this.activeReads < 1 && this.pending.size > 0) {
      const next = this.pending.entries().next().value;
      if (!next) return;
      const [accountId, state] = next;
      this.pending.delete(accountId);
      if (this.accounts.get(accountId) !== state || state.sessions.size === 0) continue;
      const permit = this.host.tryAcquireRefreshPermit?.();
      if (permit === null) continue; // Refused work retries on the next cadence, never queues on the gate.
      state.loading = true;
      this.activeReads++;
      const snapshotRevision = state.snapshotRevision;
      const stamp = captureAccountMountItemsHydration(accountId);
      // Probes are billed by the broadcast driver. Queued launches from a
      // promise completion need their own synchronous preparation measurement.
      const launchStarted = deferred ? performance.now() : 0;
      const versions = Object.fromEntries(state.versions);
      const run = async () => stamp(await this.refresh(accountId, versions));
      void run()
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
            const firstHydration = !state.hydrationKnown;
            const changed = mergeAccountMountItemsRows(state.saved, state.versions, rows);
            state.hydrationKnown = true;
            if (changed || firstHydration) this.publish(accountId, state, firstHydration);
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
          permit?.release();
          this.drain(true);
        });
      if (deferred) this.host.onWorkMs?.(performance.now() - launchStarted);
    }
  }
}
