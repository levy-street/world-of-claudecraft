// The purchase coordinator for guild roster expansion
// (docs/prd/guild-roster-expansion.md, "Who pays, and from where"), as the
// SocialTransport member GameServer spreads into its transport object. The
// service (server/social.ts guildBuyRosterPage) prices the page from the
// guild row and turns the outcome into player messages; this module owns
// everything between: the live purse charge, the exact post-charge snapshot,
// the one atomic write (server/guild_roster_page_db.ts), and the arm taken
// on each outcome. A sibling of game.ts on purpose: it needs only the ports
// below, so it stays unit-testable without a socket or a database
// (tests/guild_roster_transport.test.ts).
//
// THE FLOW rides the character's save FIFO (enqueueCharacterWrite), the
// paid guild create's shape: inside the slot nothing else can serialize or
// save this character, so the snapshot taken right after the charge is
// exactly the state the transaction commits, and a logout save queued
// behind it can neither overtake the charge nor persist a purse the
// transaction then refunds. The wait for the slot is BOUNDED (the market
// escrow's head-of-line rule): un-started work past the deadline is a
// strict no-op answered with a retry, and one purchase per character is in
// flight at a time, so a client that repeats the command cannot stack
// transactions behind its own autosaves.
//
// THE ARMS. A known refusal (short purse, stale count, guild gone, a write
// that provably rolled back) refunds the live purse and answers. A lease
// lost at COMMIT means another session owns the character: the live copy is
// abandoned ('fenced'). A lost COMMIT answer the receipt could not settle is
// NEVER refunded: refunding a page that did land would pay the buyer twice,
// so the live session is quarantined and kicked ('ambiguous') and durable
// truth stands when they log back in, exactly as the paid guild create and
// the market escrow treat their own unknown COMMITs. The same abandonment
// covers ANY throw once the write may have run: the paid guild create's
// catch-after-charge rule, so a charged live purse can never drift to the
// next autosave unpaid. (Both abandon arms kick with the one localized
// "character taken over" line the client already matches; a truer "state
// could not be proved" line needs its own catalog key, a follow-up.)

import { randomUUID } from 'node:crypto';
import type { CharacterState } from '../src/sim/character_state';
import { chargeGuildRosterPage, refundGuildRosterPage } from '../src/sim/guild_roster';
import type { SimContext } from '../src/sim/sim_context';
import type { BankLedgerOutboxSnapshot } from './bank_ledger_outbox';
import { bankLedgerSaveEffects } from './bank_ledger_session';
import type { GuildRosterPageArgs, GuildRosterPageResult } from './guild_roster_page_db';
import type { GuildRosterPurchase, SocialTransport } from './social';
import type { StorageAppliedEffect } from './storage_purchase_db';
import type { CharacterSaveArgs } from './woc_market_character_save';

/** The narrow slice of GameServer the coordinator consumes: its public
 *  session, save-FIFO, snapshot, acknowledgement, and quarantine ports, all
 *  of which the market custody module already rides. */
export interface GuildRosterPurchaseHost {
  readonly sim: { readonly ctx: SimContext };
  /** The live session, or null when it is gone, torn down, or quarantined. */
  wocCustodySession(characterId: number): {
    pid: number;
    accountId: number;
    leaseNonce: string | undefined;
  } | null;
  /** The per-character save FIFO: the job runs after every earlier save or
   *  job for that character settled. It must never await another enqueue for
   *  the same character (self-deadlock). */
  enqueueCharacterWrite<T>(characterId: number, job: () => Promise<T>): Promise<T>;
  /** True while a dirty guild book or a guild-scoped ledger prefix would be
   *  split from the character by a character-only save. */
  hasCharacterOnlySaveConflict(characterId: number): boolean;
  /** The save-shaped snapshot (live serialization plus the session fixups). */
  serializeCharacterForPersist(characterId: number): {
    level: number;
    state: CharacterState;
    storageEffects?: StorageAppliedEffect[];
    bankLedgerSnapshot?: BankLedgerOutboxSnapshot;
  } | null;
  /** Consume the exact effect prefix the committed save carried; false when
   *  the session or lease no longer matches. May throw when the outbox finds
   *  its preflight changed; the coordinator treats that as unknown. */
  acknowledgeCharacterSaveEffects(save: CharacterSaveArgs): boolean;
  /** Abandon the live session: 'fenced' lost its lease at COMMIT, 'ambiguous'
   *  must let durable truth decide an unknown COMMIT. Both quarantine the
   *  session's state and disconnect it; `surface` labels the audit line. */
  escrowSessionLost(
    pid: number,
    characterId: number,
    kind: 'fenced' | 'ambiguous',
    surface: string,
  ): void;
}

export type GuildRosterPageWriter = (args: GuildRosterPageArgs) => Promise<GuildRosterPageResult>;

export type GuildRosterTransport = Pick<SocialTransport, 'buyRosterPage'>;

/** The audit trail every outcome that moved copper leaves; a sink the tests
 *  can capture, console by default. */
export interface GuildRosterPurchaseLog {
  info(line: string): void;
  error(line: string, error?: unknown): void;
}

export interface GuildRosterTransportOptions {
  readonly log?: GuildRosterPurchaseLog;
  readonly newBatchKey?: () => string;
  /** How long a purchase may wait for its save-FIFO slot before un-started
   *  work is cancelled and the buyer is asked to retry. */
  readonly queueWaitMs?: number;
}

const consoleLog: GuildRosterPurchaseLog = {
  info: (line) => console.info(line),
  error: (line, error) => (error === undefined ? console.error(line) : console.error(line, error)),
};

export const GUILD_ROSTER_PURCHASE_SURFACE = 'guild roster page';

/** The head-of-line bound on the save FIFO: the market escrow's wait, well
 *  under the transaction's own 65s deadline so a wedged queue costs the
 *  buyer one bounded wait and a retry line, never a silent minute. */
export const GUILD_ROSTER_PURCHASE_QUEUE_WAIT_MS = 10_000;

type Stage = 'before_write' | 'write' | 'after_write';

export function guildRosterTransport(
  host: GuildRosterPurchaseHost,
  write: GuildRosterPageWriter,
  options: GuildRosterTransportOptions = {},
): GuildRosterTransport {
  const ctx = host.sim.ctx;
  const log = options.log ?? consoleLog;
  const newBatchKey = options.newBatchKey ?? (() => `roster:${randomUUID()}`);
  const queueWaitMs = options.queueWaitMs ?? GUILD_ROSTER_PURCHASE_QUEUE_WAIT_MS;
  /** One purchase per character in flight: the in-flight cap the paid guild
   *  create carries, at the granularity that matters here. */
  const inFlight = new Set<number>();

  /** Give a reservation back to the live purse. A shortfall (the entity left
   *  between charge and refund) is loud when a durable charge may be owed,
   *  and merely noted when nothing durable happened (the lease was lost, so
   *  the live copy is being abandoned anyway). */
  const refund = (
    characterId: number,
    pid: number,
    copper: number,
    why: string,
    owed = true,
  ): void => {
    const refunded = refundGuildRosterPage(ctx, pid, copper);
    if (refunded === copper) return;
    const line = `guild roster page refund (${why}) could not be applied for character ${characterId}: reserved ${copper}, refunded ${refunded}`;
    if (owed) log.error(`${line}; operator compensation needed`);
    else log.info(`${line}; nothing durable was charged, the live copy is abandoned`);
  };

  const abandon = (pid: number, characterId: number, kind: 'fenced' | 'ambiguous'): void => {
    host.escrowSessionLost(pid, characterId, kind, GUILD_ROSTER_PURCHASE_SURFACE);
  };

  const purchase = async (
    characterId: number,
    guildId: number,
    expectedPages: number,
    price: number,
  ): Promise<GuildRosterPurchase> => {
    const session = host.wocCustodySession(characterId);
    if (!session) return { outcome: 'session_lost' };
    // A fenced save needs the lease; a session without one (still loading,
    // or mid-takeover) is asked to try again, nothing charged.
    if (!session.leaseNonce) return { outcome: 'retry' };
    // A character-only save would split a dirty guild book or a queued
    // guild ledger prefix from the character; the ordinary save drains them
    // within seconds, so the buyer is asked to click again.
    if (host.hasCharacterOnlySaveConflict(characterId)) return { outcome: 'retry' };

    const { pid } = session;
    const charged = chargeGuildRosterPage(ctx, pid, price);
    if (charged < price) {
      // A short purse: give back whatever was taken and refuse with the
      // price. Never a discounted page.
      if (charged > 0) refund(characterId, pid, charged, 'short purse');
      return { outcome: 'cannotAfford' };
    }

    let stage: Stage = 'before_write';
    try {
      const snapshot = host.serializeCharacterForPersist(characterId);
      if (!snapshot) {
        refund(characterId, pid, charged, 'no snapshot');
        return { outcome: 'session_lost' };
      }
      const save: CharacterSaveArgs = {
        characterId,
        level: snapshot.level,
        state: snapshot.state,
        leaseNonce: session.leaseNonce,
        storageEffects: snapshot.storageEffects ?? [],
        // Object identity is load-bearing: the outbox acknowledges exactly
        // this captured prefix, leaving later appends queued.
        bankLedgerSnapshot: snapshot.bankLedgerSnapshot,
      };
      const ledgerEffects = snapshot.bankLedgerSnapshot
        ? bankLedgerSaveEffects(snapshot.bankLedgerSnapshot)
        : undefined;
      const batchKey = newBatchKey();

      stage = 'write';
      const result = await write({
        guildId,
        expectedPages,
        characterId,
        accountId: session.accountId,
        level: snapshot.level,
        state: snapshot.state,
        leaseNonce: session.leaseNonce,
        storageEffects: save.storageEffects ?? [],
        ledgerEffects,
        receipt: { batchKey, copper: charged },
      });
      stage = 'after_write';

      if (result.durability === 'commit_ambiguous') {
        // Unknown durability: the purse stays charged in the live copy,
        // and the live copy is abandoned. Never refund here.
        log.error(
          `guild ${guildId} roster page purchase ${batchKey} by character ${characterId} has an unknown COMMIT (${charged} copper); abandoning the live session for durable truth:`,
          result.error,
        );
        abandon(pid, characterId, 'ambiguous');
        return { outcome: 'session_lost' };
      }
      if (result.durability === 'not_committed') {
        refund(characterId, pid, charged, result.reason, result.reason !== 'lease_lost');
        switch (result.reason) {
          case 'stale':
            return { outcome: 'stale' };
          case 'no_guild':
            return { outcome: 'no_guild' };
          case 'lease_lost':
            abandon(pid, characterId, 'fenced');
            return { outcome: 'session_lost' };
          default:
            return { outcome: 'retry', error: result.error };
        }
      }

      // COMMIT is authoritative: the audit line pairs the page with who
      // paid and how much, and the effect prefix the save carried is
      // consumed. A session whose prefix no longer matches has drifted
      // from what was committed and is abandoned for durable truth.
      log.info(
        `guild ${guildId} roster page ${result.pages} bought by character ${characterId} for ${charged} copper (${batchKey})`,
      );
      if (!host.acknowledgeCharacterSaveEffects(save)) {
        log.error(
          `guild ${guildId} roster page ${result.pages} committed but character ${characterId} could not acknowledge its save effects; abandoning the live session`,
        );
        abandon(pid, characterId, 'ambiguous');
        return { outcome: 'session_lost' };
      }
      return { outcome: 'ok', pages: result.pages };
    } catch (error) {
      if (stage === 'before_write') {
        // Nothing reached the database: the reservation goes back and the
        // cause goes to the dispatcher's log.
        refund(characterId, pid, charged, 'failed before the write');
        throw error;
      }
      // The write may have run (or did, and the acknowledgement threw):
      // the charge's durability is unknown, so the live copy is abandoned
      // rather than left to carry an unproven purse into its next autosave.
      log.error(
        `guild ${guildId} roster page purchase by character ${characterId} threw with the write's durability unknown (${charged} copper); abandoning the live session for durable truth:`,
        error,
      );
      abandon(pid, characterId, 'ambiguous');
      return { outcome: 'session_lost' };
    }
  };

  /** The bounded wait for the character's save-FIFO slot: work that has not
   *  started by the deadline is cancelled (a strict no-op, nothing charged)
   *  and answered with a retry; work that has started answers its truth. */
  const inBoundedSlot = async (
    characterId: number,
    job: () => Promise<GuildRosterPurchase>,
  ): Promise<GuildRosterPurchase> => {
    let cancelled = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = host.enqueueCharacterWrite<GuildRosterPurchase>(characterId, async () => {
      if (cancelled) return { outcome: 'retry' };
      started = true;
      return job();
    });
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), queueWaitMs);
    });
    try {
      const winner = await Promise.race([work, timeout]);
      if (winner !== 'timeout') return winner;
      if (started) return await work;
      cancelled = true;
      log.error(
        `guild roster page purchase for character ${characterId} waited ${queueWaitMs}ms for its save slot; cancelled un-started, nothing charged`,
      );
      return { outcome: 'retry' };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return {
    buyRosterPage: async (characterId, guildId, expectedPages, price) => {
      if (inFlight.has(characterId)) return { outcome: 'busy' };
      inFlight.add(characterId);
      try {
        return await inBoundedSlot(characterId, () =>
          purchase(characterId, guildId, expectedPages, price),
        );
      } finally {
        inFlight.delete(characterId);
      }
    },
  };
}
