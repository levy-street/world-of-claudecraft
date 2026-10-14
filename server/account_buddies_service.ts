import { type BuddyKey, buddyDef } from '../src/sim/content/buddies';
import { ITEMS } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import { canBuyBuddyOffer } from '../src/sim/vendor_buddy_purchase';
import {
  grantAccountBuddies,
  normalizeAccountBuddies,
  purchaseAccountBuddy,
  readAccountBuddyBatch,
} from './account_buddies_db';
import type { ClientSession } from './game';
import type { KeyedSerialWriter } from './serial_writer';

export interface AccountBuddiesHost {
  sim(): Sim;
  save(session: ClientSession): Promise<boolean>;
  serialize(characterId: number): ReturnType<Sim['serializeCharacter']>;
  queue: KeyedSerialWriter<number>;
  quarantine(session: ClientSession): void;
  observe(ms: number): void;
}

interface LiveAccount {
  owned: BuddyKey[];
  sessions: Map<number, ClientSession>;
  purchase?: Promise<void>;
  nextPurchaseAt: number;
}

/** Ownership is published only after durability; wearing stays character-local.
 * Maps hold ACTIVE accounts/sessions only, and refresh reads at most 256 rows.
 * None of this runs in selfWireJson or the 20 Hz simulation path. */
export class AccountBuddiesService {
  private readonly accounts = new Map<number, LiveAccount>();
  private readonly byPid = new Map<number, ClientSession>();
  private readonly granting = new Set<number>();
  private readonly purchasing = new Set<number>();
  private refreshFlight?: Promise<void>;

  constructor(
    private readonly host: AccountBuddiesHost,
    private readonly db = { grantAccountBuddies, purchaseAccountBuddy, readAccountBuddyBatch },
  ) {}

  attach(session: ClientSession, loaded: readonly string[]): void {
    let account = this.accounts.get(session.accountId);
    if (!account) {
      account = { owned: [], sessions: new Map(), nextPurchaseAt: 0 };
      this.accounts.set(session.accountId, account);
    }
    account.sessions.set(session.pid, session);
    this.byPid.set(session.pid, session);
    this.publish(session.accountId, loaded);
    // A pending raid reward can reveal inside addPlayer before a session exists.
    this.granted(session.pid);
  }

  detach(session: ClientSession): void {
    this.byPid.delete(session.pid);
    const account = this.accounts.get(session.accountId);
    account?.sessions.delete(session.pid);
    if (account?.sessions.size === 0) this.accounts.delete(session.accountId);
  }

  private publish(accountId: number, keys: readonly string[]): void {
    const account = this.accounts.get(accountId);
    if (!account) return;
    account.owned = normalizeAccountBuddies([...account.owned, ...keys]);
    for (const session of account.sessions.values()) {
      this.host.sim().syncBuddyOwnershipFor(session.pid, account.owned);
    }
  }

  granted(pid: number): void {
    const session = this.byPid.get(pid);
    const account = session && this.accounts.get(session.accountId);
    if (!session || !account || this.granting.has(pid) || this.purchasing.has(pid)) return;
    const fresh = this.host
      .sim()
      .ownedBuddiesFor(pid)
      .filter((key) => !account.owned.includes(key));
    if (!fresh.length) return;
    this.granting.add(pid);
    void this.host
      .save(session)
      .then(async (saved) => {
        if (!saved) return;
        // Source save first: a crash between these writes is healed by the
        // indexed legacy union at next join, never by an unpaid account grant.
        const owned = await this.db.grantAccountBuddies(session.accountId, fresh);
        this.publish(session.accountId, owned);
      })
      .catch((error) => console.error('account buddy grant failed:', error))
      .finally(() => {
        this.granting.delete(pid);
        // A second distinct raid/admin grant may arrive while the first saves.
        // Retry only newly arrived keys; a failed key retries on later save/join.
        if (
          this.host
            .sim()
            .ownedBuddiesFor(pid)
            .some((key) => !fresh.includes(key) && !account.owned.includes(key))
        )
          this.granted(pid);
      });
  }

  commandBlocked(pid: number): boolean {
    return this.purchasing.has(pid);
  }

  /** Returns true only for a buddy offer, so ordinary vendors retain their
   * synchronous path. One flight per account, at most one attempt every 2 s. */
  buy(
    session: ClientSession,
    npc: number,
    item: string,
    options: { count?: number; bulk: boolean },
  ): boolean {
    const def = ITEMS[item];
    const key = def?.kind === 'buddy' ? def.buddy : undefined;
    if (!key || !buddyDef(key)) return false;
    if (!canBuyBuddyOffer(this.host.sim().ctx, session.pid, npc, item, options)) return true;
    const account = this.accounts.get(session.accountId);
    if (
      !account ||
      account.purchase ||
      account.owned.includes(key as BuddyKey) ||
      Date.now() < account.nextPurchaseAt
    )
      return true;
    account.nextPurchaseAt = Date.now() + 2000;
    this.purchasing.add(session.pid);
    let mutated = false;
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 10_000).unref();
    const current = () =>
      this.byPid.get(session.pid) === session && !session.left && !session.escrowQuarantined;
    const run = async () => {
      // Drain shared escrow/ledger work through its canonical transaction BEFORE
      // entering this FIFO job. New gameplay commands are gated during the flight.
      if (!(await this.host.save(session)) || !current() || abort.signal.aborted) return;
      await this.host.queue.enqueueCancellable(session.characterId, abort.signal, async () => {
        if (!current()) return;
        try {
          const owned = await this.db.purchaseAccountBuddy(
            session.accountId,
            key as BuddyKey,
            (durable) => {
              if (!current()) return null;
              this.host.sim().syncBuddyOwnershipFor(session.pid, durable);
              if (durable.includes(key as BuddyKey)) return null;
              // Never bypass pending side effects added by an out-of-band admin job.
              if (
                session.dirtyGuildBanks.size ||
                session.pendingStorageAppliedEffects.length ||
                session.bankLedgerJournal.outbox.snapshot().rowCount
              )
                return null;
              const before = this.host
                .sim()
                .ownedBuddiesFor(session.pid)
                .includes(key as BuddyKey);
              this.host.sim().buyItem(npc, item, options, session.pid);
              mutated =
                !before &&
                this.host
                  .sim()
                  .ownedBuddiesFor(session.pid)
                  .includes(key as BuddyKey);
              if (!mutated) return null;
              const state = this.host.serialize(session.characterId);
              if (!state) throw new Error('buddy purchase character disappeared');
              return { characterId: session.characterId, leaseNonce: session.leaseNonce, state };
            },
          );
          this.publish(session.accountId, owned);
        } catch (error) {
          // Quarantine BEFORE releasing the FIFO, so a queued autosave/logout
          // can never persist the uncommitted charge after this job rejects.
          if (mutated) this.host.quarantine(session);
          throw error;
        }
      });
    };
    account.purchase = run()
      .catch((error) => {
        console.error('account buddy purchase failed:', error);
      })
      .finally(() => {
        clearTimeout(deadline);
        this.purchasing.delete(session.pid);
        account.purchase = undefined;
        if (!session.escrowQuarantined) this.granted(session.pid);
      });
    return true;
  }

  /** Existing 30 s autosave cadence; sequential pages, no overlapping sweep.
   * Time only synchronous account/snapshot work, not database wait time. */
  refresh(): Promise<void> {
    if (this.refreshFlight) return this.refreshFlight;
    const start = performance.now();
    const accounts = [...this.accounts.entries()];
    this.host.observe(performance.now() - start);
    this.refreshFlight = (async () => {
      for (let offset = 0; offset < accounts.length; offset += 256) {
        const page = accounts.slice(offset, offset + 256);
        const rows = await this.db.readAccountBuddyBatch(
          page.map(([id]) => id),
          this.host.observe,
        );
        const started = performance.now();
        for (const [id, identity] of page) {
          if (this.accounts.get(id) === identity) {
            this.publish(id, rows.get(id) ?? []);
            for (const session of identity.sessions.values()) this.granted(session.pid);
          }
        }
        this.host.observe(performance.now() - started);
      }
    })()
      .catch((error) => console.error('account buddy refresh failed:', error))
      .finally(() => {
        this.refreshFlight = undefined;
      });
    return this.refreshFlight;
  }
}
