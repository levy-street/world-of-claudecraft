// $WOC Exchange custody bridge: the ONE place marketplace code touches the
// live Sim (docs/prd/woc/marketplace.md "Item custody"). Escrow extraction
// runs against the online seller's live bags; deliveries and returns book
// Ravenpost system parcels (instance payloads intact, book-once by
// custodyRef) and persist a durable per-parcel overlay row
// (mail_custody_overlay.ts) before the caller advances its settlement row,
// so a crash anywhere in between reconciles to exactly one parcel and a
// parcel never costs a whole-book write. The sim stays currency-blind: nothing here mentions prices, tokens,
// or wallets, only item copies and letters.

import { randomUUID } from 'node:crypto';
import { WOC_MARKET_RETURN_LETTER } from '../src/sim/content/letters';
import type { ExtractRef } from '../src/sim/inventory_extract';
import type { CharacterState, Sim } from '../src/sim/sim';
import { cloneItemInstancePayload, type InvSlot } from '../src/sim/types';
import type { BankLedgerOutboxSnapshot } from './bank_ledger_outbox';
import { gameMetricsCounters } from './http/game_signals';
import {
  CUSTODY_PARCEL_LETTERS,
  type CustodyParcelRow,
  persistCustodyParcelRow,
} from './mail_custody_overlay';
import type { StorageAppliedEffect } from './storage_purchase_db';
import type {
  CharacterSaveArgs,
  WocCustodyExtract,
  WocCustodyGrant,
  WocMarketCustody,
} from './woc_market';
import { createWocEscrowGate, type WocEscrowGate } from './woc_market_escrow_gate';

/** The narrow slice of GameServer the custody module consumes (game.ts
 *  wocCustodySession plus the public sim, and the per-character save FIFO
 *  seam the escrow persist rides). Parcel durability rides the per-parcel
 *  overlay row (mail_custody_overlay.ts), never a whole-book write. */
export interface WocCustodyGameHost {
  sim: Sim;
  wocCustodySession(characterId: number): {
    pid: number;
    accountId: number;
    name: string;
    leaseNonce: string | undefined;
  } | null;
  /** The per-character save FIFO (game.ts characterSaveQueues): a job runs
   *  only after every earlier save or job for that character settled, so
   *  commit order is enqueue order. A job must never await another enqueue
   *  for the same character (self-deadlock). */
  enqueueCharacterWrite<T>(characterId: number, job: () => Promise<T>): Promise<T>;
  /** The save-shaped snapshot (live serialization PLUS the session save
   *  fixups: jail/spectate position, stowed pet, the jail flag). Every blob
   *  this module hands to a durable write comes from here; a raw
   *  sim.serializeCharacter is a jail escape. Null when the session is
   *  gone, torn down, or escrow-quarantined. */
  serializeCharacterForPersist(characterId: number): {
    level: number;
    state: CharacterState;
    storageEffects?: StorageAppliedEffect[];
    bankLedgerSnapshot?: BankLedgerOutboxSnapshot;
  } | null;
  /** Acknowledge every exact save effect as one host decision after COMMIT.
   *  The host must exact-match character and lease identity, consume neither
   *  queue on any mismatch, and return false rather than throw. This bridge
   *  still catches a broken host so a known database commit can never enter
   *  marketplace compensation. */
  acknowledgeCharacterSaveEffects?(save: CharacterSaveArgs): boolean;
  /** True when a character-only market transaction would split any dirty
   *  guild book from its character state OR any queued guild-scoped ledger
   *  row from that book. A mixed personal+guild prefix is still a conflict:
   *  callers refuse the whole exact prefix and never filter it. */
  hasCharacterOnlySaveConflict(characterId: number): boolean;
  /** Retained during the host migration only; all custody decisions use the
   *  wider hasCharacterOnlySaveConflict guard above. */
  hasDirtyGuildBooks?(characterId: number): boolean;
  flushDirtyGuildBooks(characterId: number): Promise<void>;
  /** Terminal escrow-job signals (game.ts owns the semantics: 'fenced' kicks
   *  the displaced zombie, 'ambiguous' quarantines so the durable row
   *  decides; the pid asserts the session is the one the job mutated).
   *  Fire and forget; never awaited from inside a job. */
  escrowSessionLost(pid: number, characterId: number, kind: 'fenced' | 'ambiguous'): void;
}

/** How long a listing request may WAIT for its turn on the character's save
 *  FIFO before refusing typed 'contended' (the job is cancelled before it
 *  starts, so nothing was extracted). Sized beside the pool's own 5s
 *  connect deadline: past that, something is wedged and holding the HTTP
 *  request open only invites a retry pile-up. NOTE this bounds only the
 *  wait: a job that STARTED holds the request for the transaction's own
 *  ceiling (pool checkout + BEGIN and the installing SET LOCAL under the
 *  15s session default + the twelve-statement ledger-plus-storage maximum +
 *  its twelve inter-statement idle windows under the 10s save bound + the
 *  lock wait + COMMIT under the 65s driver backstop: 255s worst case, derived and
 *  pinned in the tunables ladder, under the HTTP layer's 300s), so client
 *  fetch timeouts must be sized off THAT, not off this deadline. The FIFO
 *  occupancy story is wider still: the pre-job guild flush rides the 60s
 *  heavy save allowance on the same FIFO, the tail's dominant term (the
 *  honest-tail relation beside the ceiling pin). */
export const ESCROW_QUEUE_WAIT_MS = 5_000;
/** Queue waits past this warn. The throttle (30s, realm-global across every
 *  character on purpose: the signal is "escrow waits are slow", one line per
 *  burst carries it) is this coupling's observability floor; the metrics
 *  counter rides the hot-path work. */
export const ESCROW_QUEUE_WARN_MS = 2_000;
/** The queue-wait warn's realm-global throttle (one line per burst; the
 *  wocEscrowQueue counter carries per-event counts). Exported for the
 *  tunables-ladder pin beside its siblings. */
export const ESCROW_QUEUE_WARN_THROTTLE_MS = 30_000;

const LETTERS = CUSTODY_PARCEL_LETTERS;

/** Process-lifetime per-listing serialize cost (the escrow write-path rider):
 *  the extract-side serializeCharacterForPersist is synchronous CPU on the
 *  event loop, the same class of work the SAVE_IDLE bound exists for inside
 *  the transaction, and until now its cost was invisible. Attributed here so
 *  the ops readout carries a number, not a guess; the delivery pg suite's
 *  escrow-cost test bounds the in-transaction half. Module-level like the
 *  contention counters in woc_market_db.ts: one custody bridge per realm
 *  process. */
let escrowSerializeCount = 0;
let escrowSerializeTotalMs = 0;
let escrowSerializeMaxMs = 0;
export function wocEscrowSerializeStats(): { count: number; totalMs: number; maxMs: number } {
  return {
    count: escrowSerializeCount,
    totalMs: escrowSerializeTotalMs,
    maxMs: escrowSerializeMaxMs,
  };
}

function characterSaveArgs(
  characterId: number,
  leaseNonce: string | undefined,
  snapshot: {
    level: number;
    state: CharacterState;
    storageEffects?: StorageAppliedEffect[];
    bankLedgerSnapshot?: BankLedgerOutboxSnapshot;
  },
): CharacterSaveArgs {
  return {
    characterId,
    level: snapshot.level,
    state: snapshot.state,
    leaseNonce,
    storageEffects: snapshot.storageEffects ?? [],
    // Object identity is load-bearing: BankLedgerOutbox.acknowledge uses the
    // exact captured object to remove only this prefix, leaving later appends.
    bankLedgerSnapshot: snapshot.bankLedgerSnapshot,
  };
}

export function createWocMarketCustody(
  host: WocCustodyGameHost,
  opts: {
    escrowWaitMs?: number;
    escrowWarnMs?: number;
    escrowWarnThrottleMs?: number;
    /** The realm-global in-flight bound (the escrow write-path rider). One
     *  gate per realm process; injectable so main.ts can put its stats on
     *  the ops readout and tests can saturate it. */
    escrowGate?: WocEscrowGate;
    /** The per-parcel durable write (mail_custody_overlay.ts by default);
     *  injectable so the custody tests run without a pool. */
    persistParcelRow?: (row: CustodyParcelRow) => Promise<void>;
  } = {},
): WocMarketCustody {
  const escrowWaitMs = opts.escrowWaitMs ?? ESCROW_QUEUE_WAIT_MS;
  const escrowWarnMs = opts.escrowWarnMs ?? ESCROW_QUEUE_WARN_MS;
  const escrowWarnThrottleMs = opts.escrowWarnThrottleMs ?? ESCROW_QUEUE_WARN_THROTTLE_MS;
  const escrowGate = opts.escrowGate ?? createWocEscrowGate();
  const persistParcelRow = opts.persistParcelRow ?? persistCustodyParcelRow;
  /** Depth cap 1 per character: the ids with an escrow job queued or
   *  running. Released when the WORK settles; a FIFO that never settles
   *  (a non-query hang past every db bound) would pin its character's slot
   *  for the process lifetime, visible as depth_refused on the counter. */
  const escrowJobsInFlight = new Set<number>();
  /** The queue-wait warn throttles like the market writer's depth warn: the
   *  signal is "waits are slow", one line per burst carries it. */
  let lastQueueWarnMs = 0;
  return {
    extractCopy(accountId: number, characterId: number, ref: ExtractRef): WocCustodyExtract {
      const session = host.wocCustodySession(characterId);
      // Listing requires the seller online in this realm process: the live
      // bags are the source of truth, and the lease nonce fences the save.
      if (!session) return { ok: false, reason: 'offline' };
      if (session.accountId !== accountId) return { ok: false, reason: 'not_yours' };
      const out = host.sim.extractTradableCopy(session.pid, ref);
      if (!out.ok) return out;
      // The save-shaped snapshot, never the raw serialization: the session
      // save fixups (jail/spectate) must ride every durable blob. Bracketed
      // for the per-listing serialize cost stat (module doc above) on the
      // hi-res clock: the work is sub-millisecond CPU, so a Date.now bracket
      // would systematically read 0 and under-report the very number the
      // SAVE_IDLE sizing argument rests on (the tick_rate_meter idiom; the
      // hi-res-clock ban is a sim rule, not a server one).
      const serializeStartNs = process.hrtime.bigint();
      const snap = host.serializeCharacterForPersist(characterId);
      const serializeMs = Number(process.hrtime.bigint() - serializeStartNs) / 1e6;
      escrowSerializeCount++;
      escrowSerializeTotalMs += serializeMs;
      if (serializeMs > escrowSerializeMaxMs) escrowSerializeMaxMs = serializeMs;
      if (!snap) {
        // The session raced a teardown mid-call: undo and report offline.
        restoreInto(host, session.pid, out.extracted);
        return { ok: false, reason: 'offline' };
      }
      return {
        ok: true,
        pid: session.pid,
        extracted: out.extracted,
        characterName: session.name,
        save: characterSaveArgs(characterId, session.leaseNonce, snap),
      };
    },

    async runSerialized<T>(characterId: number, job: () => Promise<T>): Promise<T | 'contended'> {
      // The escrow critical section (extract, re-check, durable write,
      // compensation) runs as ONE job on the character's save FIFO, so no
      // autosave can interleave anywhere inside it and a snapshot serialized
      // in-job is fresher than every previously committed one. Policy lives
      // here, not in the queue: at most ONE queued escrow job per character
      // (a second concurrent listing request refuses 'contended' instead of
      // stacking HTTP waiters), a wait deadline that cancels a job BEFORE it
      // starts (a cancelled job has extracted nothing, so refusing is free),
      // and the dirty-guild-book guard: the escrow write persists the
      // character row ALONE, so book-paired deltas are flushed atomically
      // FIRST (never from inside the job: self-deadlock), and residue that
      // re-dirtied during the wait refuses rather than tears.
      if (escrowJobsInFlight.has(characterId)) {
        gameMetricsCounters().wocEscrowQueue('depth_refused');
        return 'contended';
      }
      // The realm-global bound, checked AFTER the per-character cap so the
      // more specific refusal wins, and BEFORE anything is held: a refused
      // request holds no slot, no gate capacity, and has extracted nothing.
      const gateHold = escrowGate.tryAcquire();
      if (!gateHold) {
        gameMetricsCounters().wocEscrowQueue('realm_refused');
        return 'contended';
      }
      escrowJobsInFlight.add(characterId);
      let cancelled = false;
      let started = false;
      let timer: NodeJS.Timeout | undefined;
      try {
        const enqueuedAt = Date.now();
        const work = (async (): Promise<T | 'contended'> => {
          // (The depth-cap slot is released when THIS settles, not when the
          // waiter returns: a deadline refusal may abandon a flush still
          // queued on the FIFO, and releasing the slot then would let 5s
          // retries stack flushes onto an already-wedged queue.)
          // The guild-book flush rides INSIDE the deadline: it waits its own
          // turn on the same FIFO, so a wedged queue would otherwise hold
          // the HTTP request (and this character's depth-cap slot) unbounded
          // through the very wait the deadline exists to bound. A flush
          // failure is the bounded, typed refusal too, never a 500: the
          // books are simply not provably clean, and the request retries.
          try {
            await host.flushDirtyGuildBooks(characterId);
          } catch (err) {
            gameMetricsCounters().wocEscrowQueue('flush_failed');
            console.error(`[woc_market] guild-book flush failed for character ${characterId}`, err);
            return 'contended';
          }
          if (cancelled) return 'contended';
          return host.enqueueCharacterWrite(characterId, async (): Promise<T | 'contended'> => {
            if (cancelled) return 'contended';
            started = true;
            const waited = Date.now() - enqueuedAt;
            if (waited > escrowWarnMs && Date.now() - lastQueueWarnMs > escrowWarnThrottleMs) {
              lastQueueWarnMs = Date.now();
              console.warn(
                `[woc_market] escrow queue wait ${waited}ms for character ${characterId}`,
              );
            }
            if (host.hasCharacterOnlySaveConflict(characterId)) {
              gameMetricsCounters().wocEscrowQueue('books_dirty_refused');
              return 'contended';
            }
            gameMetricsCounters().wocEscrowQueue('started');
            return job();
          });
        })();
        const releaseSlot = (): void => {
          escrowJobsInFlight.delete(characterId);
          gateHold.release();
          // The terminal kind: a held sequence settled, whatever its
          // outcome. 'started' is a strict subset of these (a refused
          // sequence settles without starting); the four entered kinds
          // minus settled APPROXIMATES in-flight (the vocabulary doc names
          // the double-entered edge), and the gate stats on the ops readout
          // are the instantaneous truth.
          gameMetricsCounters().wocEscrowQueue('settled');
        };
        void work.then(releaseSlot, releaseSlot);
        const timeout = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), escrowWaitMs);
        });
        const winner = await Promise.race([work, timeout]);
        if (winner !== 'timeout') return winner;
        // The deadline fired. If the job already started, its runtime is
        // bounded by the transaction's own timeouts and its outcome is the
        // truth (returning 'contended' for a write that may commit would lie
        // to the seller); only work that has not reached the job is
        // cancelled, and a cancelled job extracts nothing.
        if (started) return await work;
        cancelled = true;
        // The refused wait is the case an operator most needs to see, and it
        // never reaches the in-job warn: count it here.
        gameMetricsCounters().wocEscrowQueue('deadline_refused');
        return 'contended';
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },

    async persistGrantSerialized<T>(
      accountId: number,
      characterId: number,
      expectedNonce: string | undefined,
      persist: (save: CharacterSaveArgs) => Promise<T>,
    ): Promise<T | 'busy' | 'session_lost'> {
      // The delivered-save FIFO entry (the escrow write-path rider closes
      // the commitGrant carve-out). The blob is serialized INSIDE the
      // character's save-FIFO slot, so it is fresher than every previously
      // committed autosave and every later autosave re-serializes fresher
      // still: the same ordering guarantee the escrow write has, now on the
      // buyer's side of a delivery. The HEAD-OF-LINE BOUND the carve-out
      // demanded before this was safe: a FIFO busy past the wait deadline
      // answers 'busy' with NOTHING serialized or written (the cancelled
      // job is a strict no-op), so a wedged character save costs the locked
      // delivery segment one bounded wait and a park, never the batch. No
      // realm-gate slot and no depth cap here: the durable claim plus the
      // caller's park rotation are the retry discipline, and concurrent
      // attempts for one ref are FIFO-serialized and idempotent through the
      // booked CAS.
      let cancelled = false;
      let started = false;
      let timer: NodeJS.Timeout | undefined;
      try {
        const work = host.enqueueCharacterWrite<T | 'busy' | 'session_lost'>(
          characterId,
          async () => {
            if (cancelled) return 'busy';
            started = true;
            // This transaction persists the character row without a guild
            // book. Check in the FIFO slot immediately before the fresh
            // snapshot so neither a dirty book nor a guild-bearing outbox
            // prefix can be split by the WOC save. The whole prefix parks;
            // filtering its guild rows would destroy command-batch identity.
            if (host.hasCharacterOnlySaveConflict(characterId)) {
              gameMetricsCounters().wocEscrowQueue('books_dirty_refused');
              return 'busy';
            }
            // Validated UNDER the slot: a session that left or rotated its
            // lease during the wait must park (only the operator can
            // attribute the earlier grant), and the fresh serialize below is
            // what makes the persisted blob the authoritative post-grant
            // state rather than a snapshot the wait made stale.
            const session = host.wocCustodySession(characterId);
            if (!session || session.accountId !== accountId) return 'session_lost';
            if (session.leaseNonce !== expectedNonce) return 'session_lost';
            const snap = host.serializeCharacterForPersist(characterId);
            if (!snap) return 'session_lost';
            return persist(characterSaveArgs(characterId, session.leaseNonce, snap));
          },
        );
        const timeout = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), escrowWaitMs);
        });
        const winner = await Promise.race([work, timeout]);
        if (winner !== 'timeout') return winner;
        // Started work answers its truth (a 'busy' for a write that may
        // commit would park a delivered item as retryable); un-started work
        // cancels clean, COUNTED: this is the one failure mode the FIFO
        // close introduced, and a silent park would hide exactly the wedge
        // an operator needs to see (the busy budget in the delivery arms
        // alerts off the same signal).
        if (started) return await work;
        cancelled = true;
        gameMetricsCounters().wocEscrowQueue('grant_busy');
        return 'busy';
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },

    grantCopy(accountId: number, characterId: number, slot: InvSlot): WocCustodyGrant {
      // Delivery straight into the buyer's bags, for a deal struck face to face.
      // Every refusal here is ORDINARY and none of them is an error: a buyer who
      // logged out, or whose bags are full, simply gets the parcel by mail
      // instead. The caller must therefore be able to fall back, and this must
      // leave nothing behind when it declines.
      const session = host.wocCustodySession(characterId);
      if (!session) return { ok: false, reason: 'offline' };
      if (session.accountId !== accountId) return { ok: false, reason: 'not_yours' };
      if (!host.sim.grantTradableCopy(session.pid, slot)) return { ok: false, reason: 'no_space' };
      const snap = host.serializeCharacterForPersist(characterId);
      if (!snap) {
        // Defensive: today resolve() and the persist snapshot share their
        // preconditions with grantTradableCopy and no await separates them,
        // so this branch is unreachable, but nothing PINS that coincidence.
        // If it ever fires, the grant has already mutated the LIVE bags and a
        // teardown's ordinary flush may still persist them, so this is NOT a
        // clean refusal the caller may mail over (that would be the second
        // copy): it is ambiguous, and ambiguity parks.
        return { ok: false, reason: 'ambiguous' };
      }
      return {
        ok: true,
        save: characterSaveArgs(characterId, session.leaseNonce, snap),
      };
    },

    snapshotCopy(accountId: number, characterId: number): WocCustodyGrant {
      // Re-serialize a live session WITHOUT granting anything: the resume arm
      // of a direct hand-off whose atomic save threw mid-flight. The caller
      // has proven (via its pendingGrants session identity) that these live
      // bags already hold the earlier grant, so persisting this snapshot
      // retries the delivery without minting a second copy.
      const session = host.wocCustodySession(characterId);
      if (!session) return { ok: false, reason: 'offline' };
      if (session.accountId !== accountId) return { ok: false, reason: 'not_yours' };
      const snap = host.serializeCharacterForPersist(characterId);
      if (!snap) return { ok: false, reason: 'offline' };
      return {
        ok: true,
        save: characterSaveArgs(characterId, session.leaseNonce, snap),
      };
    },

    acknowledgeCharacterSave(save: CharacterSaveArgs): void {
      const acknowledge = host.acknowledgeCharacterSaveEffects;
      if (!acknowledge) return;
      try {
        if (!acknowledge(save)) {
          console.error(
            `[woc_market] committed character save effects were retained for character ${save.characterId}: acknowledgement identity mismatch`,
          );
        }
      } catch (err) {
        // COMMIT is already known. A bookkeeping failure must retain effects
        // for their idempotent retry, never throw into copy compensation.
        console.error(
          `[woc_market] committed character save effects were retained for character ${save.characterId}: acknowledgement failed`,
          err,
        );
      }
    },

    restoreCopy(pid: number, characterId: number, slot: InvSlot): void {
      // The extraction pid decides the rail. While the player still exists
      // in the sim, restore the LIVE bags even if the session is mid-leave:
      // every teardown flush for this character is queued BEHIND the escrow
      // job on the same FIFO, so the restored copy rides that flush to
      // durability (mailing here instead risked two copies, because the
      // durable row still holds the item until the flush lands). Only when
      // the player is already gone (removePlayer ran, so the leave flush
      // committed bags without the copy) is the return parcel the right
      // rail. A QUARANTINED session never reaches here because BOTH arms
      // that quarantine are terminal: the ambiguous escrow arm rethrows
      // without ever calling restoreCopy (restoring on an unproven COMMIT is
      // the double mint), and the guild-bank refusal arm runs inside a
      // saveCharacter thunk on this same FIFO, so it cannot interleave with
      // this job. Extraction additionally refuses quarantined sessions up
      // front.
      // Both maps, the same presence rule Sim.resolve applies: a divergence
      // would otherwise drop the copy silently inside the add helpers.
      if (host.sim.players.has(pid) && host.sim.entities.has(pid)) {
        restoreInto(host, pid, slot);
        return;
      }
      // A generated ref makes even this compensation parcel replay-safe: the
      // overlay row re-books it after a crash and the book-once dedupe keeps
      // it single. Fire-and-forget like the old whole-book write (the durable
      // listing row still holds the item until the next flush lands), but a
      // failed row write is at least visible now.
      const custodyRef = `woc-return:${randomUUID()}`;
      const recipient = { key: String(characterId), name: String(characterId) };
      host.sim.mailSystemParcel(recipient, WOC_MARKET_RETURN_LETTER, [slot], custodyRef);
      void persistParcelRow({ custodyRef, recipient, letter: 'return', items: [slot] }).catch(
        (err) =>
          console.error(`[woc_market] return parcel row write failed for ${custodyRef}`, err),
      );
    },

    ownsLiveCharacter(accountId: number, characterId: number): boolean {
      // The pure ownership probe the service consults BEFORE any serialized
      // side effect: a foreign character id must be a refusal with zero side
      // effects (naming a victim's character could otherwise occupy their
      // escrow slot and force their guild-book flush). Scope is precise: it
      // proves the named ACCOUNT owns the live character, not that the HTTP
      // caller is that account. The one path where they differ is the
      // directed-offer accept, where the BUYER's request drives the SELLER's
      // listing; that occupancy is consented (the seller accepted this exact
      // deal) and bounded by the buyer's own route rate limit.
      const session = host.wocCustodySession(characterId);
      return session !== null && session.accountId === accountId;
    },

    escrowSessionLost(pid: number, characterId: number, kind: 'fenced' | 'ambiguous'): void {
      host.escrowSessionLost(pid, characterId, kind);
    },

    async persistMailParcel(
      recipient: { key: string; name: string },
      letter: 'delivery' | 'return' | 'sold_notice',
      items: InvSlot[],
      custodyRef: string,
    ): Promise<void> {
      // The BOOLEAN matters and must not be dropped. Discarding it let
      // bookCustodyOnce mark the ref booked and the settlement advance to
      // 'delivered' against a letter carrying nothing, which is the silent item
      // loss the refusal exists to prevent.
      //
      // But false has TWO causes and only one is a failure: goods were offered
      // and none survived validation (a real refusal), OR this custodyRef is
      // already booked in the blob (a retry, which is success). Treating both as
      // fatal would wedge the recovery path forever: a pass that booked the
      // parcel but died before markCustodyRefBooked would throw on every
      // retry, so the settlement could never advance. hasCustodyParcel is what
      // tells them apart.
      if (
        !host.sim.mailSystemParcel(recipient, LETTERS[letter], items, custodyRef) &&
        !host.sim.hasCustodyParcel(custodyRef)
      ) {
        // Genuine refusal: no parcel exists under this ref. Throwing lands in
        // the caller's failure path, which KEEPS the claim unbooked and
        // visible for the operator (bookCustodyOnce parks it: the attempt is
        // already marked written, so only a parcel's own presence in the book
        // could authorize a retry, and a refused parcel is never in the
        // book). The item stays visibly held instead of vanishing.
        throw new Error(`woc_market: mail parcel refused for custodyRef ${custodyRef}`);
      }
      // Failure here PROPAGATES too: the caller must not advance its settlement
      // or dispose flag until the parcel is durable. Durability is the
      // PER-PARCEL overlay row (mail_custody_overlay.ts), never a whole-book
      // write: the in-memory letter stays booked and reaches the blob on the
      // next full book write, and a crash before that replays the row through
      // the book-once dedupe at boot, so the retry (this process) or the
      // re-book (after a restart) stays exactly-once. Booking a parcel now
      // costs the loop the parcel, not the book.
      await persistParcelRow({ custodyRef, recipient, letter, items });
    },

    hasParcel(custodyRef: string): boolean {
      // Advisory by nature: a collected letter can be deleted, so absence
      // never proves the parcel was not sent. The resume paths treat
      // presence as permission and absence as ambiguity (woc_market.ts
      // bookCustodyOnce).
      return host.sim.hasCustodyParcel(custodyRef);
    },
  };
}

/** Silent add-back of an extracted copy (escrow compensation): the player
 *  never observably lost the item, so no loot toast fires. DELIBERATELY not
 *  grantTradableCopy: compensation must never be refusable, so this skips
 *  the canGrantCopies capacity pre-check and appends past the modelled cap
 *  when the seller filled the freed slot mid-job (overfilling one slot beats
 *  losing the only copy; the extractCopy undo arm has room by construction).
 *  movement: true, like every relocation grant that shares the add hubs
 *  (grantCopies, the mail return rail): the copy was already held, so the
 *  Reliquary obtain tally must not count it again. The payload is CLONED,
 *  also like grantCopies: the caller may still hold the extracted slot (the
 *  listing row stringifies it later), and a bag slot aliasing that object
 *  would let one side's mutation reach the other. */
function restoreInto(host: WocCustodyGameHost, pid: number, slot: InvSlot): void {
  if (slot.instance) {
    host.sim.addItemInstance(
      slot.itemId,
      cloneItemInstancePayload(slot.instance),
      pid,
      slot.count,
      {
        silent: true,
        movement: true,
        ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
      },
    );
  } else {
    host.sim.addItem(slot.itemId, slot.count, pid, {
      silent: true,
      movement: true,
      ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
    });
  }
}
