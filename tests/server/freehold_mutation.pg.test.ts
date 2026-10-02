// Real-PostgreSQL proof of the housing mutation boundary: commitFreeholdMutation
// and createFreeholdSaveHook (server/freehold_mutation.ts) riding the REAL
// db.ts character saves through the housing hook (server/character_save_housing.ts),
// with the operation intents and receipts (server/freehold_operation_db.ts), the
// plot claims (server/freehold_claim_db.ts) and the account Hearth
// (server/freehold_hearth_db.ts) as the hook's participants. Only a real server
// can prove that a refusal rolls the character half back, that an item ends in
// exactly one custody location after every fault, that a lost COMMIT answer is
// verified by WAITING on the character row (and then sees a row the hung
// transaction inserted), that two realms racing one account's Hearth advance it
// once, and that an open intent blocks a parent delete with the guard's 55006.
//
// DISPOSABLE DATABASE (the tests/guild_bank_pg_integration.test.ts recipe): the
// suite DROPs and CREATEs VERIFY_DB on the server TEST_DATABASE_URL names,
// points DATABASE_URL at it BEFORE any server module loads, and boots the REAL
// ensureSchema() plus runConcurrentIndexMigrations() into it. Every fixture row
// is a real accounts / characters / character_leases row with monotonic ids.
// Without TEST_DATABASE_URL the file skips; a skipped run is not a pass.
//
// Guards: the one-transaction housing mutation boundary in real PostgreSQL
// (hook refusals rolling back the character save, exactly-one custody across
// every fault of a bags-to-plot transfer, the ambiguous-COMMIT verify waiting
// on the character row, the two-realm Hearth race, the operation lifecycle and
// cap, the D88 parent-delete guard, its races and receipt erasure, the
// legacy-effect interleaves, no client across the prepare, the export
// allowlist, the index every statement reaches, a catalog-only fragment
// re-apply, and the boot's locks, observed behind a held lock and behind a
// dump-shaped hold, with no lock timeout sent, DEPLOY's route for every boot
// that queues behind the dump, its sign-out after a stall, DEPLOY's stall-over
// reading (its lock modes read off the server, a boot still queued for SHARE
// counted), and the deadlock between a boot or a runner waiting on the schema
// advisory lock and an index build under it, timing alone deciding the side
// that loses, with DEPLOY's gate read on both sides, its diagnosis read on a
// stalled boot, on a build at its wait and on a runner's drop, a stopped
// realm's build shown holding the lock until DEPLOY's terminate ends each
// session it waits for, named one at a time (a READ COMMITTED one whose
// statement was running among them) with its `idle_for` growing while it sits
// idle, DEPLOY's cancel ending a stopped or a serving realm's build at once, an
// early end leaving its index INVALID and not ready or none, and its listing
// and a hand drop the gate does not see, found by DEPLOY's lookup, removing the
// carcass a runner then builds again). The nearest suites do not pin it:
// tests/server/freehold_mutation.test.ts drives the same decisions with fakes
// (no transaction to roll back, no row to wait on),
// tests/server/freehold_hearth_db.pg.test.ts and
// tests/server/freehold_db.pg.test.ts prove the Hearth and plot statements
// alone with no character save around them, and
// tests/guild_bank_pg_integration.test.ts and
// tests/server/storage_purchase_db.pg.test.ts prove the legacy halves with no
// housing participant.
// Cost: 11.0 s
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Pool as PgPool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BankLedgerSaveEffects } from '../../server/bank_ledger_save_effects_db';
import type {
  CharacterSaveHousingHook,
  CharacterSaveHousingQueryable,
} from '../../server/character_save_housing';
import type { GuildBankSave } from '../../server/db';
import type { FreeholdClaimFence } from '../../server/freehold_claim_db';
import type { FreeholdUpsert } from '../../server/freehold_db';
import type { FreeholdMutationDeps, FreeholdMutationRequest } from '../../server/freehold_mutation';
import type { FreeholdOperationIntent } from '../../server/freehold_operation_db';
import type { StorageAppliedEffect } from '../../server/storage_purchase_db';
import type { GuildBankOpDelta } from '../../src/sim/guild_bank';
import {
  checkRelationUsesPartialIndex,
  type ExplainPlanNode,
  rootPlanFromExplainRow,
} from '../helpers/pg_plan';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? '';
const VERIFY_DB = 'wocc_freehold_mutation_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load. Every server import below is
// dynamic (type imports are erased), so this runs first.
if (ADMIN_URL !== '') process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const d = ADMIN_URL === '' ? describe.skip : describe;

/** HEARTH_KEY_COOLDOWN_MS (src/sim/freehold/gate_rules.ts), as a literal. */
const COOLDOWN_MS = 3_600_000;
const CHAIR = 'fm_oak_chair';
const COPY_REF = 'copy:fm:chair:1';
const KIND = 'fm_transfer';
const HEX32 = /^[0-9a-f]{32}$/;
const VERIFY_WAIT_TEXT = 'SELECT 1 FROM characters WHERE id = $1 FOR SHARE';

type Db = typeof import('../../server/db');

interface Gate {
  /** Resolves with the HOLDING save's backend pid once it parks. */
  readonly reached: Promise<number>;
  readonly open: () => void;
  readonly hold: {
    readonly at: 'before' | 'after';
    reach(pid: number): void;
    readonly release: Promise<void>;
  };
}

function gate(at: 'before' | 'after'): Gate {
  let open!: () => void;
  let reach!: (pid: number) => void;
  const release = new Promise<void>((resolve) => {
    open = resolve;
  });
  const reached = new Promise<number>((resolve) => {
    reach = resolve;
  });
  return { reached, open, hold: { at, reach, release } };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function bagsState(marker: string, chairs: number): never {
  return {
    level: 5,
    marker,
    questLog: [],
    questsDone: [],
    inventory: chairs > 0 ? [{ itemId: CHAIR, count: chairs }] : [],
  } as never;
}

function goldDelta(copper: number): GuildBankOpDelta {
  return {
    op: 'deposit_gold',
    itemId: null,
    count: null,
    instance: null,
    copperDelta: copper,
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 0,
  };
}

d('the housing mutation boundary (REAL Postgres)', () => {
  let admin: PgPool;
  let pool: PgPool;
  let db: Db;
  /** A second server process ("realm"): its own module graph, pool and lease holder. */
  let db2: Db;
  let mutation: typeof import('../../server/freehold_mutation');
  let ops: typeof import('../../server/freehold_operation_db');
  let claims: typeof import('../../server/freehold_claim_db');
  let plots: typeof import('../../server/freehold_db');
  let housing: typeof import('../../server/character_save_housing');
  let charDelete: typeof import('../../server/character_delete_db');
  let federated: typeof import('../../server/federated_auth_db');
  let outbox: typeof import('../../server/bank_ledger_outbox');
  let storage: typeof import('../../server/storage_purchase_db');
  let realm: string;

  let nextSeq = 0;
  const seq = () => ++nextSeq;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL).pathname.replace(/^\//, '');
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../../server/db');
    mutation = await import('../../server/freehold_mutation');
    ops = await import('../../server/freehold_operation_db');
    claims = await import('../../server/freehold_claim_db');
    plots = await import('../../server/freehold_db');
    housing = await import('../../server/character_save_housing');
    charDelete = await import('../../server/character_delete_db');
    federated = await import('../../server/federated_auth_db');
    outbox = await import('../../server/bank_ledger_outbox');
    storage = await import('../../server/storage_purchase_db');
    realm = (await import('../../server/realm')).REALM;
    const { materialSourceConnection } = await import('../../server/material_source_connection');

    await db.ensureSchema();
    await db.runConcurrentIndexMigrations();

    pool = new Pool({ ...materialSourceConnection(verifyUrl(ADMIN_URL)), max: 12 });

    // The second realm process: a fresh module graph, so a second pg Pool and
    // a second PROCESS_LEASE_HOLDER, exactly what another realm binary holds.
    vi.resetModules();
    db2 = await import('../../server/db');
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await db2?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Fixtures.
  // ---------------------------------------------------------------------------

  async function makeAccount(): Promise<number> {
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`fmverify_${seq()}`],
    );
    return Number(res.rows[0].id);
  }

  async function makeCharacter(accountId: number, state: unknown = bagsState('before', 0)) {
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 5, $4::jsonb) RETURNING id`,
      [accountId, `FmVerify${seq()}`, realm, JSON.stringify(state)],
    );
    return Number(res.rows[0].id);
  }

  async function grantLease(characterId: number, nonce: string, holder = db.PROCESS_LEASE_HOLDER) {
    await pool.query(
      `INSERT INTO character_leases (character_id, realm, holder, nonce, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 hour')
       ON CONFLICT (character_id) DO UPDATE SET holder = EXCLUDED.holder, nonce = EXCLUDED.nonce`,
      [characterId, realm, holder, nonce],
    );
  }

  /** An account, one leased character, and its nonce. */
  async function player(chairs = 0, holder?: string) {
    const acct = await makeAccount();
    const ch = await makeCharacter(acct, bagsState('before', chairs));
    const nonce = `fm-nonce-${seq()}`;
    await grantLease(ch, nonce, holder);
    return { acct, ch, nonce };
  }

  async function blobOf(characterId: number): Promise<{ level: number; marker: unknown }> {
    const res = await pool.query('SELECT level, state FROM characters WHERE id = $1', [
      characterId,
    ]);
    return { level: Number(res.rows[0].level), marker: res.rows[0].state?.marker ?? null };
  }

  async function hearthOf(accountId: number) {
    const res = await pool.query(
      `SELECT ready_at_ms::text AS ready_at_ms, revision::text AS revision, advance_token
         FROM account_freehold_hearth WHERE account_id = $1`,
      [accountId],
    );
    return (
      (res.rows[0] as { ready_at_ms: string; revision: string; advance_token: string | null }) ??
      null
    );
  }

  function plotUpsert(
    accountId: number,
    plotId: string,
    chairs: number,
    expectedDurableRev: string | null,
  ): FreeholdUpsert & { expectedDurableRev: string } {
    return {
      accountId,
      plotIndex: 0,
      plotId,
      tier: 'cottage',
      layoutJson: JSON.stringify(
        // The first chair IS the copy the transfer intent names, so custody can
        // be read by exact copy identity, not only by item count.
        Array.from({ length: chairs }, (_, i) => ({
          itemId: CHAIR,
          copyRef: i === 0 ? COPY_REF : `${COPY_REF}:${i}`,
        })),
      ),
      trophiesJson: '[]',
      condition: 100,
      visitPolicy: 'closed',
      wireRev: 0,
      schemaVersion: 1,
      expectedDurableRev: expectedDurableRev as string,
    };
  }

  /** A plot row at durable_rev 1 and this process's claim on it at generation 1. */
  async function makePlot(accountId: number, plotId = `plot:fm${seq()}`) {
    expect(await plots.upsertFreehold(pool, plotUpsert(accountId, plotId, 0, null))).toEqual({
      kind: 'inserted',
      durableRev: '1',
    });
    expect(
      await claims.acquireFreeholdClaim(pool, {
        plotId,
        accountId,
        realm,
        holder: db.PROCESS_LEASE_HOLDER,
        ttlSeconds: 90,
      }),
    ).toEqual({ kind: 'acquired', generation: '1', takeover: false });
    const fence: FreeholdClaimFence = { plotId, holder: db.PROCESS_LEASE_HOLDER, generation: '1' };
    return { plotId, fence };
  }

  async function claimRow(plotId: string) {
    const res = await pool.query(
      `SELECT holder, generation::text AS generation, write_token FROM freehold_plot_claims
        WHERE plot_id = $1`,
      [plotId],
    );
    return (
      (res.rows[0] as { holder: string; generation: string; write_token: string | null }) ?? null
    );
  }

  async function intentCount(operationId: string): Promise<number> {
    const res = await pool.query(
      'SELECT count(*)::int AS n FROM freehold_operations WHERE operation_id = $1',
      [operationId],
    );
    return res.rows[0].n;
  }

  async function receiptsOf(operationId: string) {
    const res = await pool.query(
      `SELECT account_id, plot_id, kind, outcome, fingerprint,
              applied_durable_rev::text AS applied_durable_rev
         FROM freehold_operation_receipts WHERE operation_id = $1`,
      [operationId],
    );
    return res.rows;
  }

  function intentOf(
    acct: number,
    ch: number | null,
    plot: { plotId: string } | null,
    tag = `${seq()}`,
  ): FreeholdOperationIntent {
    const plotId = plot?.plotId ?? null;
    const fenceGeneration = plot ? '1' : null;
    const expectedDurableRev = plot ? '1' : null;
    const copyRefs = [COPY_REF];
    return {
      operationId: `fop:fm${tag}`,
      accountId: acct,
      characterId: ch,
      plotId,
      kind: KIND,
      fingerprint: ops.freeholdOperationFingerprint({
        kind: KIND,
        plotId,
        copyRefs,
        expectedDurableRev,
        fenceGeneration,
        payloadDigest: `chair-to-plot:${tag}`,
      }),
      copyRefs,
      expectedDurableRev,
      fenceGeneration,
    };
  }

  const hearthRequest = (accountId: number): FreeholdMutationRequest => ({
    accountIds: [accountId],
    claimProofs: [],
    plots: [],
    operations: [],
    hearth: { accountId, cooldownMs: COOLDOWN_MS },
  });

  type Observe = (tx: CharacterSaveHousingQueryable, when: 'before' | 'after') => Promise<void>;

  interface SaveShape {
    readonly characterId: number;
    readonly state: never;
    readonly nonce: string;
    readonly level?: number;
    readonly storageEffects?: readonly StorageAppliedEffect[];
    readonly ledgerEffects?: BankLedgerSaveEffects;
    readonly guildBanks?: readonly GuildBankSave[];
    readonly via?: Db;
    readonly hold?: Gate['hold'];
    readonly observe?: Observe;
  }

  /** deps.save exactly as GameServer.saveCharacter composes it: the hook's wrap
   *  around the job, housingPersist around the save function, the hook passed
   *  as the save's last argument. `hold` parks the transaction before or after
   *  the hook's real participants, with every lock it took still held;
   *  `observe` reads the save's OWN transaction right before and right after
   *  them. */
  function depsFor(shape: SaveShape): FreeholdMutationDeps {
    return {
      pool,
      characterId: shape.characterId,
      save: (hook: CharacterSaveHousingHook) => {
        const { hold, observe } = shape;
        const ridden: CharacterSaveHousingHook =
          hold || observe
            ? {
                ...hook,
                run: async (tx) => {
                  // The holding backend, so a case can require that a waiter is
                  // blocked by THIS save and not by anything else in the database.
                  const holder = hold
                    ? Number((await tx.query('SELECT pg_backend_pid() AS pid')).rows?.[0]?.pid)
                    : 0;
                  if (hold?.at === 'before') {
                    hold.reach(holder);
                    await hold.release;
                  }
                  await observe?.(tx, 'before');
                  try {
                    await hook.run(tx);
                  } finally {
                    if (hold?.at === 'after') hold.reach(holder);
                  }
                  await observe?.(tx, 'after');
                  if (hold?.at === 'after') await hold.release;
                },
              }
            : hook;
        const target = shape.via ?? db;
        const level = shape.level ?? 6;
        const persist = () =>
          shape.guildBanks
            ? target.saveCharacterAndGuildBankState(
                shape.characterId,
                level,
                shape.state,
                shape.guildBanks,
                shape.nonce,
                [],
                shape.storageEffects ?? [],
                shape.ledgerEffects,
                undefined,
                ridden,
              )
            : target.saveCharacterState(
                shape.characterId,
                level,
                shape.state,
                shape.nonce,
                shape.storageEffects ?? [],
                shape.ledgerEffects,
                undefined,
                ridden,
              );
        const run = housing.housingPersist(ridden, persist);
        return ridden.wrap ? ridden.wrap(run) : run();
      },
    };
  }

  /** Autocommit poll (a pg_stat_activity read inside a transaction is a frozen
   *  snapshot) until `count` backends of this database wait on a heavyweight
   *  lock running a statement LIKE `pattern`. The poll returns within one step
   *  of the wait starting, so the waiter's own 2 s lock_timeout never runs out
   *  while the case releases it; the bound only sizes how long a slow runner may
   *  take to REACH the wait before the case fails with its own message. */
  async function waitForLockWaiters(pattern: string, count = 1, blockedBy?: number): Promise<void> {
    for (let i = 0; i < 400; i++) {
      // With `blockedBy`, only a waiter THAT backend blocks counts, so a stray
      // waiter elsewhere in the database cannot satisfy the case.
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = $1 AND wait_event_type = 'Lock' AND query LIKE $2
            AND ($3::int IS NULL OR $3::int = ANY(pg_blocking_pids(pid)))`,
        [VERIFY_DB, pattern, blockedBy ?? null],
      );
      if (res.rows[0].n >= count) return;
      await sleep(8);
    }
    throw new Error(`no backend ever queued on a lock running ${pattern}`);
  }

  type Read = readonly [sql: string, values: readonly unknown[]];

  /** The legacy-order proof: each named single-value read (column `v`) runs
   *  INSIDE the save's own transaction right before and right after the hook's
   *  participants, and each `outside` read runs on another connection at the
   *  same moment (what is not committed yet). */
  function orderProbe(inside: Record<string, Read>, outside: Record<string, Read> = {}) {
    const seen: Record<string, unknown>[] = [];
    const observe: Observe = async (tx, when) => {
      const row: Record<string, unknown> = { when };
      for (const [name, [sql, values]] of Object.entries(inside)) {
        row[name] = (await tx.query(sql, [...values])).rows?.[0]?.v ?? null;
      }
      for (const [name, [sql, values]] of Object.entries(outside)) {
        row[name] = (await pool.query(sql, [...values])).rows[0]?.v ?? null;
      }
      seen.push(row);
    };
    return { seen, observe };
  }

  const hearthRead = (accountId: number): Read => [
    'SELECT revision::text AS v FROM account_freehold_hearth WHERE account_id = $1',
    [accountId],
  ];
  const ledgerRead = (batchKey: string): Read => [
    'SELECT count(*)::int AS v FROM bank_ledger_batch_receipts WHERE batch_key = $1',
    [batchKey],
  ];

  /** The ambiguous COMMIT: the NEXT checkout of `target.pool` withholds its
   *  COMMIT from the server and answers the caller the way node-postgres
   *  answers the active query of a destroyed connection, while the REAL backend
   *  keeps its transaction open with every lock held. Resolves with that real
   *  client once COMMIT was sent, so the case decides when (and whether) the
   *  hung transaction commits. */
  function armLostCommit(target: Db): Promise<PoolClient> {
    const owner = target.pool as unknown as { connect?: () => Promise<PoolClient> };
    const original = Object.getPrototypeOf(owner).connect as () => Promise<PoolClient>;
    return new Promise((resolveReached) => {
      owner.connect = async () => {
        delete owner.connect;
        const real = await original.call(owner);
        let lost = false;
        const lostAnswer = () => Promise.reject(new Error('Connection terminated unexpectedly'));
        return {
          get processID() {
            return (real as unknown as { processID: number }).processID;
          },
          on: (event: 'error', listener: (error: Error) => void) => real.on(event, listener),
          removeListener: (event: 'error', listener: (error: Error) => void) =>
            real.removeListener(event, listener),
          query: (text: string, values?: unknown[]) => {
            if (lost) return lostAnswer();
            if (text === 'COMMIT') {
              lost = true;
              resolveReached(real);
              return lostAnswer();
            }
            return real.query(text, values);
          },
          // The real client is the case's to finish.
          release: () => {},
        } as unknown as PoolClient;
      };
    });
  }

  /** The ambiguous COMMIT as the wire really loses it (the QA contract's
   *  shape): the NEXT checkout of `target.pool` sends its COMMIT to the server
   *  for real while its socket has stopped reading, waits until the server has
   *  FINISHED that COMMIT (the backend is idle again, whichever way it ended),
   *  then destroys the socket, so node-postgres itself rejects the pending
   *  COMMIT as a connection lost after the command went out. Resolves once the
   *  socket is gone. */
  function armDestroyAfterCommit(target: Db): Promise<void> {
    const owner = target.pool as unknown as { connect?: () => Promise<PoolClient> };
    const original = Object.getPrototypeOf(owner).connect as () => Promise<PoolClient>;
    return new Promise((resolveDestroyed, rejectArm) => {
      owner.connect = async () => {
        delete owner.connect;
        const real = await original.call(owner);
        const wire = real as unknown as {
          processID: number;
          connection: { stream: { pause(): void; destroy(): void } };
          query: (text: unknown, ...rest: unknown[]) => Promise<unknown>;
        };
        const query = wire.query.bind(real);
        wire.query = (text: unknown, ...rest: unknown[]) => {
          if (text !== 'COMMIT') return query(text, ...rest);
          wire.connection.stream.pause();
          const sent = query('COMMIT');
          void (async () => {
            for (let i = 0; i < 400; i++) {
              const state = await pool.query('SELECT state FROM pg_stat_activity WHERE pid = $1', [
                wire.processID,
              ]);
              if (state.rows[0]?.state === 'idle') break;
              await sleep(5);
            }
            wire.connection.stream.destroy();
            resolveDestroyed();
          })().catch(rejectArm);
          return sent;
        };
        return real;
      };
    });
  }

  // ---------------------------------------------------------------------------
  // The bags-to-plot transfer every custody case drives: one chair in the
  // character's bags, a plot row at durable_rev 1 with its claim, and an open
  // intent naming the copy. Success moves the chair into the layout.
  // ---------------------------------------------------------------------------

  async function transferFixture(plotId?: string) {
    const p = await player(1);
    const plot = await makePlot(p.acct, plotId);
    const intent = intentOf(p.acct, p.ch, plot);
    expect(await ops.prepareFreeholdOperation(pool, intent)).toEqual({ kind: 'prepared' });
    return { ...p, ...plot, intent };
  }
  type Transfer = Awaited<ReturnType<typeof transferFixture>>;

  function transferRequest(
    t: Transfer,
    over: {
      fingerprint?: string;
      plotRev?: string;
      chairs?: number;
      generation?: string;
      hearth?: boolean;
    } = {},
  ): FreeholdMutationRequest {
    return {
      accountIds: [t.acct],
      claimProofs: [],
      plots: [
        {
          upsert: plotUpsert(t.acct, t.plotId, over.chairs ?? 1, over.plotRev ?? '1'),
          fence: { ...t.fence, generation: over.generation ?? t.fence.generation },
        },
      ],
      operations: [
        {
          operationId: t.intent.operationId,
          accountId: t.acct,
          fingerprint: over.fingerprint ?? t.intent.fingerprint,
          plotId: t.plotId,
          // An apply writes its own plot under the same fence and revision
          // (commitFreeholdMutation refuses a request where they differ).
          fenceGeneration: over.generation ?? t.fence.generation,
          expectedDurableRev: over.plotRev ?? '1',
        },
      ],
      hearth: over.hearth ? { accountId: t.acct, cooldownMs: COOLDOWN_MS } : null,
    };
  }

  const transferDeps = (t: Transfer) =>
    depsFor({ characterId: t.ch, state: bagsState('after', 0), nonce: t.nonce });

  /** commitFreeholdMutation with the plot store's owner FIFO: it refuses a
   *  plot-writing mutation without one, and this suite has no store, so the
   *  FIFO is the identity (a caller's own opts still win). */
  const commit = (
    deps: FreeholdMutationDeps,
    request: FreeholdMutationRequest,
    opts: Parameters<typeof mutation.commitFreeholdMutation>[2] = {},
  ) =>
    mutation.commitFreeholdMutation(deps, request, {
      serialize: <T>(job: () => Promise<T>) => job(),
      ...opts,
    });

  /** Where the chair is, read back from PG: bags count and layout count. */
  async function custody(t: Transfer): Promise<{ bags: number; layout: number }> {
    const c = await pool.query('SELECT state FROM characters WHERE id = $1', [t.ch]);
    const inventory = (c.rows[0].state?.inventory ?? []) as { itemId: string; count: number }[];
    const bags = inventory
      .filter((slot) => slot.itemId === CHAIR)
      .reduce((n, slot) => n + slot.count, 0);
    const p = await pool.query(
      'SELECT layout FROM account_freeholds WHERE account_id = $1 AND plot_index = 0',
      [t.acct],
    );
    const layout = (p.rows[0].layout as { itemId: string }[]).filter(
      (entry) => entry.itemId === CHAIR,
    ).length;
    return { bags, layout };
  }

  // ---------------------------------------------------------------------------
  // A. Atomicity.
  // ---------------------------------------------------------------------------
  describe('A. one transaction: the character half and the housing half', () => {
    it('commits the character blob and the Hearth advance together, stamping the attempt token', async () => {
      const p = await player();
      const built = mutation.createFreeholdSaveHook(hearthRequest(p.acct));
      const saved = await db.saveCharacterState(
        p.ch,
        7,
        bagsState('a-after', 0),
        p.nonce,
        [],
        undefined,
        undefined,
        built.hook,
      );
      expect(saved).toBe(true);
      expect(built.state).toMatchObject({ ran: true, commitSent: true, committed: true });
      expect(built.advanceToken).toMatch(HEX32);
      expect(await blobOf(p.ch)).toEqual({ level: 7, marker: 'a-after' });
      const hearth = await hearthOf(p.acct);
      expect(hearth?.revision).toBe('1');
      expect(hearth?.advance_token).toBe(built.advanceToken);
      expect(Number(hearth?.ready_at_ms)).toBeGreaterThan(COOLDOWN_MS);
    });

    it('a wrong operation fingerprint refuses and rolls the character half back', async () => {
      const t = await transferFixture();
      const wrong = 'f'.repeat(64);
      const outcome = await commit(transferDeps(t), transferRequest(t, { fingerprint: wrong }));
      expect(outcome).toEqual({
        kind: 'refused',
        refusal: { kind: 'operation', operationId: t.intent.operationId, reason: 'fingerprint' },
      });
      // The character UPDATE ran before the hook and is gone with it.
      expect(await blobOf(t.ch)).toEqual({ level: 5, marker: 'before' });
      expect(await intentCount(t.intent.operationId)).toBe(1);
      expect(await receiptsOf(t.intent.operationId)).toEqual([]);
      // The claim fence ran (G4 before G6) and stamped a token: rolled back too.
      expect((await claimRow(t.plotId))?.write_token).toBeNull();
    });

    it('a stale plot CAS refuses after the receipt was written and rolls every half back', async () => {
      const t = await transferFixture();
      // A store write moved the plot from durable_rev 1 to 2 under the transfer.
      expect(await plots.upsertFreehold(pool, plotUpsert(t.acct, t.plotId, 0, '1'))).toEqual({
        kind: 'updated',
        durableRev: '2',
      });
      const outcome = await commit(transferDeps(t), transferRequest(t));
      expect(outcome).toEqual({
        kind: 'refused',
        refusal: { kind: 'plot', plotId: t.plotId, result: 'stale' },
      });
      expect(await blobOf(t.ch)).toEqual({ level: 5, marker: 'before' });
      // The apply (G6) inserted the receipt and deleted the intent before the
      // CAS (G7) refused: both undone.
      expect(await intentCount(t.intent.operationId)).toBe(1);
      expect(await receiptsOf(t.intent.operationId)).toEqual([]);
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
    });

    it('the trip shape: a claim proof read-fences without a new row version, a stale proof refuses', async () => {
      const p = await player();
      const plot = await makePlot(p.acct);
      const versionOf = async () =>
        (
          await pool.query('SELECT xmin::text AS v FROM freehold_plot_claims WHERE plot_id = $1', [
            plot.plotId,
          ])
        ).rows[0].v as string;
      const before = await versionOf();
      const trip = (generation: string): FreeholdMutationRequest => ({
        ...hearthRequest(p.acct),
        claimProofs: [{ ...plot.fence, generation }],
      });
      const stale = await commit(
        depsFor({ characterId: p.ch, state: bagsState('stale-proof', 0), nonce: p.nonce }),
        trip('2'),
      );
      expect(stale).toEqual({ kind: 'refused', refusal: { kind: 'claim', plotId: plot.plotId } });
      expect(await hearthOf(p.acct)).toBeNull();
      expect(await blobOf(p.ch)).toEqual({ level: 5, marker: 'before' });
      const held = await commit(
        depsFor({ characterId: p.ch, state: bagsState('proved', 0), nonce: p.nonce }),
        trip('1'),
      );
      expect(held).toMatchObject({ kind: 'committed', hearth: { revision: '1' }, plots: [] });
      // The read fence locked the claim row but wrote no version and no token.
      expect(await versionOf()).toBe(before);
      expect((await claimRow(plot.plotId))?.write_token).toBeNull();
    });

    it('a rotated lease nonce fences the save out: the hook never runs and the Hearth is untouched', async () => {
      const p = await player();
      const outcome = await commit(
        depsFor({ characterId: p.ch, state: bagsState('displaced', 0), nonce: 'fm-rotated' }),
        hearthRequest(p.acct),
      );
      expect(outcome).toEqual({ kind: 'not_run' });
      expect(await hearthOf(p.acct)).toBeNull();
      expect(await blobOf(p.ch)).toEqual({ level: 5, marker: 'before' });
      // Control: the live nonce is the only difference, and it commits.
      const live = await commit(
        depsFor({ characterId: p.ch, state: bagsState('live', 0), nonce: p.nonce }),
        hearthRequest(p.acct),
      );
      expect(live).toMatchObject({
        kind: 'committed',
        hearth: { kind: 'advanced', revision: '1' },
        verified: false,
      });
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'live' });
    });

    it('two hooked saves handed their participants in OPPOSITE order both finish, no deadlock', async () => {
      const a = await player();
      const b = await player();
      const n = seq();
      const pa = await makePlot(a.acct, `plot:fmorder${n}a`);
      const pb = await makePlot(b.acct, `plot:fmorder${n}b`);
      const write = (acct: number, plot: { plotId: string; fence: FreeholdClaimFence }) => ({
        upsert: plotUpsert(acct, plot.plotId, 1, '1'),
        fence: plot.fence,
      });
      const request = (accountIds: number[], plotWrites: ReturnType<typeof write>[]) => ({
        accountIds,
        claimProofs: [],
        plots: plotWrites,
        operations: [],
        hearth: null,
      });
      // A blocker holds the LOWER plot's claim row, so each save parks on its
      // first fence with whatever it locked before it still held.
      const blocker = await pool.connect();
      let one: Promise<unknown> | null = null;
      let two: Promise<unknown> | null = null;
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'SELECT 1 FROM freehold_plot_claims WHERE plot_id = $1 FOR NO KEY UPDATE',
          [pa.plotId],
        );
        one = commit(
          depsFor({ characterId: a.ch, state: bagsState('order-a', 0), nonce: a.nonce }),
          request([a.acct, b.acct], [write(a.acct, pa), write(b.acct, pb)]),
        );
        two = commit(
          depsFor({ characterId: b.ch, state: bagsState('order-b', 0), nonce: b.nonce }),
          request([b.acct, a.acct], [write(b.acct, pb), write(a.acct, pa)]),
        );
        await waitForLockWaiters('UPDATE freehold_plot_claims%SET write_token%', 2);
        // Both wait on the lower plot and NEITHER holds the higher one: the save
        // handed [pb, pa] sorted them, or this NOWAIT would raise 55P03.
        const probe = await pool.connect();
        try {
          await probe.query('BEGIN');
          const free = await probe.query(
            'SELECT plot_id FROM freehold_plot_claims WHERE plot_id = $1 FOR NO KEY UPDATE NOWAIT',
            [pb.plotId],
          );
          expect(free.rowCount).toBe(1);
          await probe.query('ROLLBACK');
        } finally {
          probe.release();
        }
        await blocker.query('COMMIT');
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
      const outcomes = (await Promise.all([one, two])) as { kind: string }[];
      // One commits; the other, serialized behind it, finds the lower plot moved
      // and refuses with the bounded typed answer. Never a 40P01.
      const byKind = [...outcomes].sort((x, y) => (x.kind < y.kind ? -1 : 1));
      expect(byKind[0]).toMatchObject({ kind: 'committed', verified: false });
      expect(byKind[1]).toEqual({
        kind: 'refused',
        refusal: { kind: 'plot', plotId: pa.plotId, result: 'stale' },
      });
      const revs = await pool.query(
        `SELECT plot_id, durable_rev::text AS rev FROM account_freeholds
          WHERE plot_id = ANY($1::text[]) ORDER BY plot_id`,
        [[pa.plotId, pb.plotId]],
      );
      expect(revs.rows).toEqual([
        { plot_id: pa.plotId, rev: '2' },
        { plot_id: pb.plotId, rev: '2' },
      ]);
    });

    it('a hook account the save did not lock at G1 is refused before the hook runs', async () => {
      // Through the real save: an account gone before G1 comes back short from
      // the ONE sorted KEY SHARE, and the save refuses before any housing write.
      const p = await player();
      const ghost = await makeAccount();
      await pool.query('DELETE FROM accounts WHERE id = $1', [ghost]);
      const outcome = await commit(
        depsFor({ characterId: p.ch, state: bagsState('ghost', 0), nonce: p.nonce }),
        { ...hearthRequest(p.acct), accountIds: [p.acct, ghost] },
      );
      expect(outcome.kind).toBe('failed');
      expect(String((outcome as { error: unknown }).error)).toMatch(
        /disappeared before parent lock/,
      );
      expect(await hearthOf(p.acct)).toBeNull();
      expect(await blobOf(p.ch)).toEqual({ level: 5, marker: 'before' });
      // And commitWithHousing's own check, on a real transaction: a hook naming
      // an account outside the locked set never runs.
      const { createDbTransactionDeadline } = await import('../../server/db_transaction_deadline');
      const other = await makeAccount();
      const client = await pool.connect();
      const tx = createDbTransactionDeadline(client, {
        operation: 'fm unlocked hook',
        timeoutMs: 10_000,
      });
      let ran = false;
      try {
        await tx.query('BEGIN');
        const locked = await housing.lockSaveAccountsWithHousing(tx, [], undefined, {
          accountIds: [p.acct],
          run: async () => {},
          commitSent() {},
          committed() {},
        });
        expect(locked).toEqual([p.acct]);
        const hook: CharacterSaveHousingHook = {
          accountIds: [p.acct, other],
          run: async () => {
            ran = true;
          },
          commitSent() {},
          committed() {},
        };
        await expect(housing.commitWithHousing(tx, hook, locked)).rejects.toThrow(
          'a housing account participant was not locked with the save accounts',
        );
        expect(ran).toBe(false);
      } finally {
        await tx.rollback();
        tx.release();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // B. Exactly-one custody across a transfer, fault by fault.
  // ---------------------------------------------------------------------------
  describe('B. exactly one custody location after every fault', () => {
    it('the unfaulted transfer moves the chair from the bags into the layout, once', async () => {
      const t = await transferFixture();
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
      const versionOf = async () =>
        (
          await pool.query('SELECT xmin::text AS v FROM freehold_plot_claims WHERE plot_id = $1', [
            t.plotId,
          ])
        ).rows[0].v as string;
      const before = await versionOf();
      const outcome = await commit(transferDeps(t), transferRequest(t));
      expect(outcome).toEqual({
        kind: 'committed',
        plots: [{ plotId: t.plotId, durableRev: '2' }],
        hearth: null,
        verified: false,
      });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      // By exact copy identity: the layout holds THE copy the intent named,
      // exactly once.
      const layout = await pool.query(
        'SELECT layout FROM account_freeholds WHERE account_id = $1 AND plot_index = 0',
        [t.acct],
      );
      expect(
        (layout.rows[0].layout as { copyRef?: string }[]).map((entry) => entry.copyRef),
      ).toEqual([COPY_REF]);
      expect(t.intent.copyRefs).toEqual([COPY_REF]);
      expect(await intentCount(t.intent.operationId)).toBe(0);
      expect(await receiptsOf(t.intent.operationId)).toEqual([
        {
          account_id: t.acct,
          plot_id: t.plotId,
          kind: KIND,
          outcome: 'applied',
          fingerprint: t.intent.fingerprint,
          applied_durable_rev: '2',
        },
      ]);
      // The write fence, unlike the trip's read fence, stamps a token in a new
      // row version.
      expect((await claimRow(t.plotId))?.write_token).toMatch(HEX32);
      expect(await versionOf()).not.toBe(before);
      // A STALE reload's store write (revision 1, the empty layout it read
      // before the transfer) cannot erase the acknowledged custody: it answers
      // stale and the chair stays in the layout, nowhere else.
      expect(
        await plots.upsertFencedFreehold(pool, plotUpsert(t.acct, t.plotId, 0, '1'), {
          ...t.fence,
          writeToken: claims.mintFreeholdWriteToken(),
        }),
      ).toMatchObject({ kind: 'stale', durableRev: '2' });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
    });

    it('a refusal after the character UPDATE (the operation half) leaves the chair in the bags', async () => {
      const t = await transferFixture();
      const outcome = await commit(
        transferDeps(t),
        transferRequest(t, { fingerprint: '0'.repeat(64) }),
      );
      expect(outcome).toMatchObject({ kind: 'refused', refusal: { reason: 'fingerprint' } });
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
    });

    it('a refusal at the plot CAS leaves the chair in the bags', async () => {
      const t = await transferFixture();
      // Another write moved the ROW past the revision the intent and the
      // request both expect (the realistic stale shape: the request agrees with
      // its intent, the database moved on).
      await pool.query(
        'UPDATE account_freeholds SET durable_rev = durable_rev + 1 WHERE plot_id = $1',
        [t.plotId],
      );
      const outcome = await commit(transferDeps(t), transferRequest(t));
      expect(outcome).toEqual({
        kind: 'refused',
        refusal: { kind: 'plot', plotId: t.plotId, result: 'stale' },
      });
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
    });

    it('a claim fenced by a takeover refuses before any housing write', async () => {
      const t = await transferFixture();
      await pool.query(
        `UPDATE freehold_plot_claims SET expires_at = clock_timestamp() - interval '1 second'
          WHERE plot_id = $1`,
        [t.plotId],
      );
      expect(
        await claims.acquireFreeholdClaim(pool, {
          plotId: t.plotId,
          accountId: t.acct,
          realm,
          holder: db2.PROCESS_LEASE_HOLDER,
          ttlSeconds: 90,
        }),
      ).toEqual({ kind: 'acquired', generation: '2', takeover: true });
      const outcome = await commit(transferDeps(t), transferRequest(t));
      expect(outcome).toEqual({ kind: 'refused', refusal: { kind: 'claim', plotId: t.plotId } });
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
      expect(await claimRow(t.plotId)).toEqual({
        holder: db2.PROCESS_LEASE_HOLDER,
        generation: '2',
        write_token: null,
      });
      // The operation is still open and recoverable: no receipt was written.
      expect(await intentCount(t.intent.operationId)).toBe(1);
      expect(await receiptsOf(t.intent.operationId)).toEqual([]);
    });

    it.each(['holder', 'generation'] as const)(
      'a write fence that differs from the live claim in its %s ALONE refuses, and a matching control commits',
      async (dimension) => {
        const t = await transferFixture();
        const holderA = db.PROCESS_LEASE_HOLDER;
        // A plot write with no operation: only the write fence decides.
        const plotOnly = (generation: string): FreeholdMutationRequest => ({
          accountIds: [t.acct],
          claimProofs: [],
          operations: [],
          hearth: null,
          plots: [
            { upsert: plotUpsert(t.acct, t.plotId, 1, '1'), fence: { ...t.fence, generation } },
          ],
        });
        const expire = () =>
          pool.query(
            `UPDATE freehold_plot_claims SET expires_at = clock_timestamp() - interval '1 second'
              WHERE plot_id = $1`,
            [t.plotId],
          );
        const acquireAs = (holder: string) =>
          claims.acquireFreeholdClaim(pool, {
            plotId: t.plotId,
            accountId: t.acct,
            realm,
            holder,
            ttlSeconds: 90,
          });
        let live: string;
        if (dimension === 'holder') {
          // The holder's own release renames it and KEEPS the generation, so a
          // late write of the releasing process differs in the holder alone.
          expect(await claims.releaseFreeholdClaimRows(pool, holderA, [t.plotId])).toEqual(
            new Set([t.plotId]),
          );
          expect(await claimRow(t.plotId)).toMatchObject({
            holder: `${holderA}#released`,
            generation: '1',
          });
          live = '2';
        } else {
          // A, then B, then A again: holder A is back, at generation 3, so a
          // late write of A's FIRST tenure differs in the generation alone.
          await expire();
          expect(await acquireAs(db2.PROCESS_LEASE_HOLDER)).toMatchObject({ generation: '2' });
          await expire();
          expect(await acquireAs(holderA)).toMatchObject({ generation: '3' });
          live = '3';
        }
        const stale = await commit(transferDeps(t), plotOnly('1'));
        expect(stale).toEqual({ kind: 'refused', refusal: { kind: 'claim', plotId: t.plotId } });
        expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
        expect((await claimRow(t.plotId))?.write_token).toBeNull();
        // Control through the SAME write fence: holder and generation both
        // matching the live claim commits.
        if (dimension === 'holder')
          expect(await acquireAs(holderA)).toMatchObject({ generation: '2' });
        expect(await commit(transferDeps(t), plotOnly(live))).toMatchObject({ kind: 'committed' });
        expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
        expect((await claimRow(t.plotId))?.write_token).toMatch(HEX32);
      },
    );

    it('a duplicate receipt for a still-open intent refuses through the unique guard', async () => {
      const t = await transferFixture();
      // A receipt row already holds the id while the intent is open: the apply's
      // ON CONFLICT DO NOTHING answers zero rows, never a SELECT-then-INSERT.
      await pool.query(
        `INSERT INTO freehold_operation_receipts (operation_id, account_id, kind, outcome)
         VALUES ($1, $2, $3, 'refused')`,
        [t.intent.operationId, t.acct, KIND],
      );
      const outcome = await commit(transferDeps(t), transferRequest(t));
      expect(outcome).toEqual({
        kind: 'refused',
        refusal: { kind: 'operation', operationId: t.intent.operationId, reason: 'already_closed' },
      });
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
      expect(await intentCount(t.intent.operationId)).toBe(1);
    });

    it('a replay of an applied transfer refuses: the chair is never in two places', async () => {
      const t = await transferFixture();
      expect(await commit(transferDeps(t), transferRequest(t))).toMatchObject({
        kind: 'committed',
      });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      // The replay reads the new revision and would append a second copy.
      const replay = await commit(transferDeps(t), transferRequest(t, { plotRev: '2', chairs: 2 }));
      expect(replay).toEqual({
        kind: 'refused',
        refusal: { kind: 'operation', operationId: t.intent.operationId, reason: 'already_closed' },
      });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      expect(await receiptsOf(t.intent.operationId)).toHaveLength(1);
    });

    it('a COMMIT failure (a deferred constraint raised at COMMIT) is a proved rollback', async () => {
      const plotId = `plot:fmcommitfault${seq()}`;
      const t = await transferFixture(plotId);
      // Fault injection on the disposable database only: a deferred constraint
      // trigger that raises at COMMIT for this one plot.
      await pool.query(`CREATE OR REPLACE FUNCTION fm_commit_fault() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'fm commit fault';
        END $$`);
      await pool.query(`CREATE CONSTRAINT TRIGGER fm_commit_fault AFTER UPDATE ON account_freeholds
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        WHEN (NEW.plot_id = '${plotId}') EXECUTE FUNCTION fm_commit_fault()`);
      try {
        // The Hearth advance rides too, AFTER the faulting plot write (G8 after
        // G7): the fault at COMMIT must take it back with every other half.
        const outcome = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
        expect(outcome.kind).toBe('failed');
        expect((outcome as { error: { code?: string } }).error.code).toBe('23514');
      } finally {
        await pool.query('DROP TRIGGER IF EXISTS fm_commit_fault ON account_freeholds');
        await pool.query('DROP FUNCTION IF EXISTS fm_commit_fault()');
      }
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
      expect(await intentCount(t.intent.operationId)).toBe(1);
      expect(await receiptsOf(t.intent.operationId)).toEqual([]);
      // Not even the first-use Hearth row survived.
      expect(await hearthOf(t.acct)).toBeNull();
      // Control: the same transfer with the fault removed commits once.
      expect(await commit(transferDeps(t), transferRequest(t, { hearth: true }))).toMatchObject({
        kind: 'committed',
        verified: false,
      });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      expect((await hearthOf(t.acct))?.revision).toBe('1');
    });

    it('a kind plan that refuses the missing-copy shape writes nothing, and its commit control moves the chair once', async () => {
      // What this proves, and what it does not: the refusal below comes from
      // this TEST kind's own plan, so no production change can fail that half.
      // The hook writes whatever the save hands it and never reads the bags, so
      // refusing a copy the bags do not hold belongs to a KIND's plan, and no
      // production kind exists in 07a. This pins the SHAPE the first kind must
      // follow (read the source custody, refuse before any transaction) and that
      // such a refusal leaves every durable fact where it was: the character
      // blob, the open intent, the receipts, the claim token, the plot's
      // durable_rev and the custody. The obligation itself is pinned where the
      // first kind lands: the no-kind tripwire in
      // tests/server/freehold_mutation.test.ts ('operation recovery'). The
      // fixture's bags carry the chair as a stack, so the named copy is present
      // iff a chair is in the bags.
      const plan = async (t: Transfer) => {
        const held = await custody(t);
        return held.bags >= t.intent.copyRefs.length
          ? ({ kind: 'planned', request: transferRequest(t) } as const)
          : ({ kind: 'refused', reason: 'missing_copy' } as const);
      };
      const durableRev = async (plotId: string) =>
        (
          await pool.query(
            'SELECT durable_rev::text AS v FROM account_freeholds WHERE plot_id = $1',
            [plotId],
          )
        ).rows[0].v as string;
      const p = await player(0);
      const plot = await makePlot(p.acct);
      const intent = intentOf(p.acct, p.ch, plot);
      expect(await ops.prepareFreeholdOperation(pool, intent)).toEqual({ kind: 'prepared' });
      const empty: Transfer = { ...p, ...plot, intent };
      expect(await custody(empty)).toEqual({ bags: 0, layout: 0 });
      expect(await plan(empty)).toEqual({ kind: 'refused', reason: 'missing_copy' });
      // Nothing written anywhere, and the chair was not conjured into the layout.
      expect(await custody(empty)).toEqual({ bags: 0, layout: 0 });
      expect(await blobOf(p.ch)).toEqual({ level: 5, marker: 'before' });
      expect(await intentCount(intent.operationId)).toBe(1);
      expect(await receiptsOf(intent.operationId)).toEqual([]);
      expect((await claimRow(plot.plotId))?.write_token).toBeNull();
      expect(await durableRev(plot.plotId)).toBe('1');
      // Control: the same plan over bags that hold the copy commits the move.
      const t = await transferFixture();
      const planned = await plan(t);
      expect(planned.kind).toBe('planned');
      if (planned.kind !== 'planned') throw new Error('unreachable');
      expect(await commit(transferDeps(t), planned.request)).toMatchObject({ kind: 'committed' });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // C. The ambiguous COMMIT: the server may commit while the client loses the
  // answer, and only the verify (wait on the character row, then the
  // participants' own evidence) decides.
  // ---------------------------------------------------------------------------
  describe('C. the ambiguous COMMIT and its verify', () => {
    it('landed: answers committed with verified true, and a retry never applies twice', async () => {
      const t = await transferFixture();
      await pool.query('INSERT INTO account_freehold_hearth (account_id) VALUES ($1)', [t.acct]);
      const lost = armLostCommit(db);
      const pending = commit(transferDeps(t), transferRequest(t, { hearth: true }));
      const real = await lost;
      try {
        await waitForLockWaiters(
          VERIFY_WAIT_TEXT,
          1,
          (real as unknown as { processID: number }).processID,
        );
        // Before the hung transaction resolves a plain read sees nothing landed:
        // the answer a racing unlocked verify would have given.
        expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
        expect((await hearthOf(t.acct))?.revision).toBe('0');
        await real.query('COMMIT');
      } finally {
        await real.query('ROLLBACK').catch(() => {});
        real.release();
      }
      const outcome = await pending;
      expect(outcome).toMatchObject({
        kind: 'committed',
        plots: [{ plotId: t.plotId, durableRev: '2' }],
        hearth: { kind: 'advanced', revision: '1' },
        verified: true,
      });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      const landedToken = (await claimRow(t.plotId))?.write_token;
      expect(landedToken).toMatch(HEX32);

      const retry = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
      expect(retry).toEqual({
        kind: 'refused',
        refusal: { kind: 'operation', operationId: t.intent.operationId, reason: 'already_closed' },
      });
      expect((await hearthOf(t.acct))?.revision).toBe('1');
      expect(await receiptsOf(t.intent.operationId)).toHaveLength(1);
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      expect((await claimRow(t.plotId))?.write_token).toBe(landedToken);
    });

    it('not landed: answers not_landed, and exactly one later apply succeeds', async () => {
      const t = await transferFixture();
      await pool.query('INSERT INTO account_freehold_hearth (account_id) VALUES ($1)', [t.acct]);
      const lost = armLostCommit(db);
      // The verify's checkouts, counted: the wait and the reads share ONE.
      let verifyCheckouts = 0;
      const pending = commit(
        {
          ...transferDeps(t),
          pool: {
            connect: () => {
              verifyCheckouts++;
              return pool.connect();
            },
          },
        },
        transferRequest(t, { hearth: true }),
      );
      const real = await lost;
      try {
        await waitForLockWaiters(
          VERIFY_WAIT_TEXT,
          1,
          (real as unknown as { processID: number }).processID,
        );
        await real.query('ROLLBACK');
      } finally {
        real.release();
      }
      const outcome = await pending;
      expect(outcome.kind).toBe('not_landed');
      expect(verifyCheckouts).toBe(1);
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
      expect((await hearthOf(t.acct))?.revision).toBe('0');
      expect(await intentCount(t.intent.operationId)).toBe(1);

      const later = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
      expect(later).toMatchObject({ kind: 'committed', verified: false });
      const again = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
      expect(again).toMatchObject({ kind: 'refused', refusal: { reason: 'already_closed' } });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      expect((await hearthOf(t.acct))?.revision).toBe('1');
      expect(await receiptsOf(t.intent.operationId)).toHaveLength(1);
    });

    it('a REAL socket loss after COMMIT was sent, landed: the classifier sees the driver error, the verify proves it, no second apply', async () => {
      const t = await transferFixture();
      await pool.query('INSERT INTO account_freehold_hearth (account_id) VALUES ($1)', [t.acct]);
      const destroyed = armDestroyAfterCommit(db);
      const outcome = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
      await destroyed;
      expect(outcome).toMatchObject({
        kind: 'committed',
        plots: [{ plotId: t.plotId, durableRev: '2' }],
        hearth: { kind: 'advanced', revision: '1' },
        verified: true,
      });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      expect(await receiptsOf(t.intent.operationId)).toHaveLength(1);
      const retry = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
      expect(retry).toMatchObject({ kind: 'refused', refusal: { reason: 'already_closed' } });
      expect((await hearthOf(t.acct))?.revision).toBe('1');
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
    });

    it('a REAL socket loss after a COMMIT the server then FAILED: not_landed, and exactly one later apply', async () => {
      const plotId = `plot:fmrealloss${seq()}`;
      const t = await transferFixture(plotId);
      await pool.query('INSERT INTO account_freehold_hearth (account_id) VALUES ($1)', [t.acct]);
      // Fault injection on the disposable database only: this plot's COMMIT
      // fails at the server, and the socket is destroyed before its error is read.
      await pool.query(`CREATE OR REPLACE FUNCTION fm_real_loss_fault() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'fm real loss fault';
        END $$`);
      await pool.query(`CREATE CONSTRAINT TRIGGER fm_real_loss_fault AFTER UPDATE ON account_freeholds
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        WHEN (NEW.plot_id = '${plotId}') EXECUTE FUNCTION fm_real_loss_fault()`);
      let outcome: Awaited<ReturnType<typeof commit>>;
      try {
        const destroyed = armDestroyAfterCommit(db);
        outcome = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
        await destroyed;
      } finally {
        await pool.query('DROP TRIGGER IF EXISTS fm_real_loss_fault ON account_freeholds');
        await pool.query('DROP FUNCTION IF EXISTS fm_real_loss_fault()');
      }
      // Not the 23514: the driver never read it. The verify decided.
      expect(outcome.kind).toBe('not_landed');
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
      expect((await hearthOf(t.acct))?.revision).toBe('0');
      expect(await intentCount(t.intent.operationId)).toBe(1);
      const later = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
      expect(later).toMatchObject({ kind: 'committed', verified: false });
      const again = await commit(transferDeps(t), transferRequest(t, { hearth: true }));
      expect(again).toMatchObject({ kind: 'refused', refusal: { reason: 'already_closed' } });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      expect((await hearthOf(t.acct))?.revision).toBe('1');
      expect(await receiptsOf(t.intent.operationId)).toHaveLength(1);
    });

    it('first use: the verify waits on the character row, then sees the Hearth row the hung transaction inserted', async () => {
      const p = await player();
      expect(await hearthOf(p.acct)).toBeNull();
      const lost = armLostCommit(db);
      const pending = commit(
        depsFor({ characterId: p.ch, state: bagsState('first-use', 0), nonce: p.nonce }),
        hearthRequest(p.acct),
      );
      const real = await lost;
      try {
        await waitForLockWaiters(
          VERIFY_WAIT_TEXT,
          1,
          (real as unknown as { processID: number }).processID,
        );
        // The inserted row is invisible until COMMIT: a locked read of the
        // Hearth row could not wait for it, which is why the wait is on the
        // character row.
        expect(await hearthOf(p.acct)).toBeNull();
        // FOR KEY SHARE does NOT conflict with the save's FOR NO KEY UPDATE, so
        // that form would answer at once instead of waiting: the wait must be
        // FOR SHARE (a 300 ms lock bound would raise 55P03 if it waited).
        const probe = await pool.connect();
        try {
          await probe.query('BEGIN');
          await probe.query('SET LOCAL lock_timeout = 300');
          const keyShare = await probe.query(
            'SELECT 1 FROM characters WHERE id = $1 FOR KEY SHARE',
            [p.ch],
          );
          expect(keyShare.rowCount).toBe(1);
          await probe.query('ROLLBACK');
        } finally {
          probe.release();
        }
        await real.query('COMMIT');
      } finally {
        await real.query('ROLLBACK').catch(() => {});
        real.release();
      }
      expect(await pending).toMatchObject({
        kind: 'committed',
        hearth: { kind: 'advanced', revision: '1' },
        verified: true,
      });
      const hearth = await hearthOf(p.acct);
      expect(hearth?.revision).toBe('1');
      expect(hearth?.advance_token).toMatch(HEX32);
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'first-use' });
    });
  });

  // ---------------------------------------------------------------------------
  // D. The Hearth across two realms.
  // ---------------------------------------------------------------------------
  describe('D. one account Hearth, two realm processes', () => {
    async function race(seedRow: boolean) {
      const acct = await makeAccount();
      const c1 = await makeCharacter(acct);
      const c2 = await makeCharacter(acct);
      await grantLease(c1, 'fm-realm-one', db.PROCESS_LEASE_HOLDER);
      await grantLease(c2, 'fm-realm-two', db2.PROCESS_LEASE_HOLDER);
      if (seedRow) {
        await pool.query('INSERT INTO account_freehold_hearth (account_id) VALUES ($1)', [acct]);
      }
      const g = gate('after');
      const first = commit(
        depsFor({
          characterId: c1,
          state: bagsState('realm-one', 0),
          nonce: 'fm-realm-one',
          hold: g.hold,
        }),
        hearthRequest(acct),
      );
      const holder = await g.reached;
      const second = commit(
        depsFor({
          characterId: c2,
          state: bagsState('realm-two', 0),
          nonce: 'fm-realm-two',
          via: db2,
        }),
        hearthRequest(acct),
      );
      // The second realm really waits on the first one's Hearth row, blocked
      // by that very save.
      await waitForLockWaiters('%account_freehold_hearth%', 1, holder);
      g.open();
      const [one, two] = await Promise.all([first, second]);
      return { acct, c1, c2, one, two };
    }

    it('two concurrent saves of two characters: exactly one advances, the other answers cooldown and writes nothing', async () => {
      expect(db2.PROCESS_LEASE_HOLDER).not.toBe(db.PROCESS_LEASE_HOLDER);
      expect(db2.pool).not.toBe(db.pool);
      const r = await race(true);
      const hearth = await hearthOf(r.acct);
      expect(r.one).toMatchObject({
        kind: 'committed',
        hearth: { kind: 'advanced', revision: '1' },
      });
      expect(r.two).toMatchObject({
        kind: 'refused',
        refusal: {
          kind: 'hearth',
          result: { kind: 'cooldown', revision: '1', readyAtMs: hearth?.ready_at_ms },
        },
      });
      expect(hearth?.revision).toBe('1');
      expect(await blobOf(r.c1)).toEqual({ level: 6, marker: 'realm-one' });
      expect(await blobOf(r.c2)).toEqual({ level: 5, marker: 'before' });
    });

    it('against an ABSENT Hearth row (first use): exactly one advances', async () => {
      const r = await race(false);
      expect(r.one).toMatchObject({
        kind: 'committed',
        hearth: { kind: 'advanced', revision: '1' },
      });
      expect(r.two).toMatchObject({
        kind: 'refused',
        refusal: { kind: 'hearth', result: { kind: 'cooldown', revision: '1' } },
      });
      expect((await hearthOf(r.acct))?.revision).toBe('1');
      expect(await blobOf(r.c2)).toEqual({ level: 5, marker: 'before' });
    });

    it('a stored ready time past now plus the cooldown answers corrupt and writes nothing', async () => {
      const p = await player();
      await pool.query(
        `INSERT INTO account_freehold_hearth (account_id, ready_at_ms, revision)
         VALUES ($1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint + $2::bigint, 4)`,
        [p.acct, COOLDOWN_MS + 3_600_000],
      );
      const before = await hearthOf(p.acct);
      const outcome = await commit(
        depsFor({ characterId: p.ch, state: bagsState('corrupt', 0), nonce: p.nonce }),
        hearthRequest(p.acct),
      );
      expect(outcome).toMatchObject({
        kind: 'refused',
        refusal: { kind: 'hearth', result: { kind: 'corrupt', revision: '4' } },
      });
      expect(await hearthOf(p.acct)).toEqual(before);
      expect(before?.advance_token).toBeNull();
      expect(await blobOf(p.ch)).toEqual({ level: 5, marker: 'before' });
      // Control: a ready time INSIDE the cooldown is an ordinary cooldown.
      await pool.query(
        `UPDATE account_freehold_hearth
            SET ready_at_ms = (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint + $2::bigint
          WHERE account_id = $1`,
        [p.acct, COOLDOWN_MS / 2],
      );
      const cooled = await commit(
        depsFor({ characterId: p.ch, state: bagsState('cooled', 0), nonce: p.nonce }),
        hearthRequest(p.acct),
      );
      expect(cooled).toMatchObject({
        kind: 'refused',
        refusal: { kind: 'hearth', result: { kind: 'cooldown', revision: '4' } },
      });
      expect((await hearthOf(p.acct))?.revision).toBe('4');
      // That a cooldown refusal is never turned into an admit is the trip's
      // ticket rule (server/freehold_hearth_trip.ts), out of PG's reach: here
      // the refusal itself is the whole durable claim, and it wrote nothing.
    });
  });

  // ---------------------------------------------------------------------------
  // E. The operation lifecycle.
  // ---------------------------------------------------------------------------
  describe('E. operations: prepare, apply, close, cap', () => {
    it('prepared, duplicate, conflict, applied through the hook, then closed', async () => {
      const t = await transferFixture();
      expect(await ops.prepareFreeholdOperation(pool, t.intent)).toEqual({ kind: 'duplicate' });
      const other = { ...t.intent, fingerprint: 'a'.repeat(64) };
      expect(await ops.prepareFreeholdOperation(pool, other)).toEqual({ kind: 'conflict' });
      // The fingerprint binds no account: ANOTHER account sending the identical
      // request under the same id is a conflict, never a duplicate of this one.
      const foreign = { ...t.intent, accountId: await makeAccount(), characterId: null };
      expect(foreign.fingerprint).toBe(t.intent.fingerprint);
      expect(await ops.prepareFreeholdOperation(pool, foreign)).toEqual({ kind: 'conflict' });
      expect(await commit(transferDeps(t), transferRequest(t))).toMatchObject({
        kind: 'committed',
      });
      expect(await intentCount(t.intent.operationId)).toBe(0);
      expect(await receiptsOf(t.intent.operationId)).toEqual([
        {
          account_id: t.acct,
          plot_id: t.plotId,
          kind: KIND,
          outcome: 'applied',
          fingerprint: t.intent.fingerprint,
          applied_durable_rev: '2',
        },
      ]);
      expect(await ops.prepareFreeholdOperation(pool, t.intent)).toEqual({
        kind: 'closed',
        outcome: 'applied',
      });
      // A closed id never reports its outcome for a different request, nor to
      // another account sending the identical one.
      expect(await ops.prepareFreeholdOperation(pool, other)).toEqual({ kind: 'conflict' });
      expect(await ops.prepareFreeholdOperation(pool, foreign)).toEqual({ kind: 'conflict' });
      expect(await intentCount(t.intent.operationId)).toBe(0);
    });

    it('a racing pair at the per-account cap: exactly the cap prepared, the rest capacity', async () => {
      expect(ops.FREEHOLD_OPERATION_OPEN_PER_ACCOUNT).toBe(8);
      expect(ops.FREEHOLD_ADVISORY_ACCOUNT_CLASS).toBe(0x46_48_41_01);
      async function racePair(acct: number, already: number) {
        for (let i = 0; i < already; i++) {
          expect(await ops.prepareFreeholdOperation(pool, intentOf(acct, null, null))).toEqual({
            kind: 'prepared',
          });
        }
        // Hold the account lock so both prepares are queued on it at once.
        const holder = await pool.connect();
        try {
          await holder.query('BEGIN');
          await holder.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [
            0x46_48_41_01,
            acct,
          ]);
          const pair = [
            ops.prepareFreeholdOperation(pool, intentOf(acct, null, null)),
            ops.prepareFreeholdOperation(pool, intentOf(acct, null, null)),
          ];
          await waitForLockWaiters('SELECT pg_advisory_xact_lock($1::int, $2::int)', 2);
          await holder.query('COMMIT');
          return (await Promise.all(pair)).map((r) => r.kind).sort();
        } finally {
          await holder.query('ROLLBACK').catch(() => {});
          holder.release();
        }
      }
      const openOf = async (acct: number) =>
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM freehold_operations WHERE account_id = $1',
            [acct],
          )
        ).rows[0].n;
      const atCap = await makeAccount();
      expect(await racePair(atCap, 7)).toEqual(['capacity', 'prepared']);
      expect(await openOf(atCap)).toBe(8);
      // Control: below the cap the same race prepares both.
      const below = await makeAccount();
      expect(await racePair(below, 6)).toEqual(['prepared', 'prepared']);
      expect(await openOf(below)).toBe(8);
      expect(await ops.prepareFreeholdOperation(pool, intentOf(below, null, null))).toEqual({
        kind: 'capacity',
      });
    });

    it('cancel closes into a cancelled receipt; a deactivated account is parent_missing and its receipt pre-erased', async () => {
      const t = await transferFixture();
      // A STRANGER account's cancel, with the right fingerprint, is refused and
      // leaves the intent open: the intent is not its to close.
      const stranger = await makeAccount();
      expect(
        await ops.cancelFreeholdOperation(pool, {
          operationId: t.intent.operationId,
          accountId: stranger,
          fingerprint: t.intent.fingerprint,
          outcome: 'cancelled',
        }),
      ).toBe('account');
      expect(await intentCount(t.intent.operationId)).toBe(1);
      expect(await receiptsOf(t.intent.operationId)).toEqual([]);
      expect(
        await ops.cancelFreeholdOperation(pool, {
          operationId: t.intent.operationId,
          accountId: t.acct,
          fingerprint: t.intent.fingerprint,
          outcome: 'cancelled',
        }),
      ).toBeNull();
      expect(await intentCount(t.intent.operationId)).toBe(0);
      expect(await receiptsOf(t.intent.operationId)).toEqual([
        {
          account_id: t.acct,
          plot_id: t.plotId,
          kind: KIND,
          outcome: 'cancelled',
          fingerprint: t.intent.fingerprint,
          applied_durable_rev: null,
        },
      ]);
      expect(
        await ops.cancelFreeholdOperation(pool, {
          operationId: t.intent.operationId,
          accountId: t.acct,
          fingerprint: t.intent.fingerprint,
          outcome: 'cancelled',
        }),
      ).toBe('already_closed');
      // The stranger again, now that only the receipt remains: `missing`, never
      // `already_closed`, so a close cannot tell it the id exists.
      expect(
        await ops.cancelFreeholdOperation(pool, {
          operationId: t.intent.operationId,
          accountId: stranger,
          fingerprint: t.intent.fingerprint,
          outcome: 'cancelled',
        }),
      ).toBe('missing');

      const u = await transferFixture();
      await pool.query('UPDATE accounts SET deactivated_at = now() WHERE id = $1', [u.acct]);
      const fresh = intentOf(u.acct, u.ch, null);
      expect(await ops.prepareFreeholdOperation(pool, fresh)).toEqual({ kind: 'parent_missing' });
      expect(await intentCount(fresh.operationId)).toBe(0);
      expect(
        await ops.cancelFreeholdOperation(pool, {
          operationId: u.intent.operationId,
          accountId: u.acct,
          fingerprint: u.intent.fingerprint,
          outcome: 'cancelled',
        }),
      ).toBeNull();
      expect(await receiptsOf(u.intent.operationId)).toEqual([
        {
          account_id: null,
          plot_id: null,
          kind: KIND,
          outcome: 'cancelled',
          fingerprint: null,
          applied_durable_rev: null,
        },
      ]);
    });

    it('after a restart, recovery reconciles the ORIGINAL id once and closes it with one receipt', async () => {
      const t = await transferFixture();
      // The restart: nothing in memory survives. A NEW pool and a NEW recovery
      // registry; only the durable intent remains. The realm's reconciler map is
      // empty in 07a, so a TEST kind's reconciler is injected through the deps.
      const recovery = await import('../../server/freehold_operation_recovery');
      expect(recovery.FREEHOLD_OPERATION_RECONCILERS.size).toBe(0);
      const { Pool } = await import('pg');
      const { materialSourceConnection } = await import('../../server/material_source_connection');
      const fresh = new Pool({ ...materialSourceConnection(verifyUrl(ADMIN_URL)), max: 4 });
      try {
        const seen: string[] = [];
        const registry = recovery.createFreeholdOperationRecovery({
          reconcilers: new Map([
            [
              KIND,
              {
                reconcile: async (open) => {
                  seen.push(open.operationId);
                  const refused = await ops.cancelFreeholdOperation(fresh, {
                    operationId: open.operationId,
                    accountId: open.accountId,
                    fingerprint: open.fingerprint,
                    outcome: 'refused',
                  });
                  return refused === null ? 'closed' : 'held';
                },
              },
            ],
          ]),
          discover: (accountId) => ops.openFreeholdOperationsForAccount(fresh, accountId),
          tryAcquirePermit: () => ({ release() {} }),
          holdInFlight: () => () => {},
          warn: () => {},
        });
        // Two schedules while the first pass runs coalesce (single flight); a
        // later pass finds nothing left to reconcile.
        registry.schedule(t.acct);
        registry.schedule(t.acct);
        await registry.idle();
        registry.schedule(t.acct);
        await registry.idle();
        expect(seen).toEqual([t.intent.operationId]);
        expect(registry.counters).toMatchObject({
          passes: 2,
          discovered: 1,
          closed: 1,
          applied: 0,
          threw: 0,
          unknownKind: 0,
        });
      } finally {
        await fresh.end();
      }
      expect(await intentCount(t.intent.operationId)).toBe(0);
      expect(await receiptsOf(t.intent.operationId)).toEqual([
        {
          account_id: t.acct,
          plot_id: t.plotId,
          kind: KIND,
          outcome: 'refused',
          fingerprint: t.intent.fingerprint,
          applied_durable_rev: null,
        },
      ]);
      // Closed is terminal: the original id can never be prepared again.
      expect(await ops.prepareFreeholdOperation(pool, t.intent)).toEqual({
        kind: 'closed',
        outcome: 'refused',
      });
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // F. D88: an open intent blocks deletion; receipts are kept, erased.
  // ---------------------------------------------------------------------------
  describe('F. the D88 parent-delete guard and the per-row-class outcomes', () => {
    it('refuses an account delete through the ACCOUNT guard alone when the open intent names no character', async () => {
      // No character in the intent and none on the account, so the characters
      // cascade cannot raise for it: only the accounts BEFORE DELETE guard can
      // answer 55006, and without it the RESTRICT key would answer 23503.
      const acct = await makeAccount();
      const open = intentOf(acct, null, null);
      expect(await ops.prepareFreeholdOperation(pool, open)).toEqual({ kind: 'prepared' });
      await expect(pool.query('DELETE FROM accounts WHERE id = $1', [acct])).rejects.toMatchObject({
        code: '55006',
        constraint: 'freehold_operations_open_delete_guard',
        message: 'freehold_operation_open',
      });
      expect(await intentCount(open.operationId)).toBe(1);
      // Control: once the intent closes, the same delete lands.
      expect(
        await ops.cancelFreeholdOperation(pool, {
          operationId: open.operationId,
          accountId: acct,
          fingerprint: open.fingerprint,
          outcome: 'cancelled',
        }),
      ).toBeNull();
      expect((await pool.query('DELETE FROM accounts WHERE id = $1', [acct])).rowCount).toBe(1);
    });

    it('the federated provision cleanup refuses with its typed error under either guard, and lands once closed', async () => {
      // An unused federated account: no password, no token, no link. Its open
      // intent is account-level (the accounts guard) or names its character
      // (the characters cascade's guard); both arrive as the one typed refusal.
      for (const scope of ['account', 'character'] as const) {
        const acct = await makeAccount();
        await pool.query('UPDATE accounts SET password_set = FALSE WHERE id = $1', [acct]);
        const ch = scope === 'character' ? await makeCharacter(acct) : null;
        const open = intentOf(acct, ch, null);
        expect(await ops.prepareFreeholdOperation(pool, open)).toEqual({ kind: 'prepared' });
        const refused = await federated.deleteUnusedFederatedProvision(pool as never, acct).then(
          () => null,
          (error: unknown) => error,
        );
        expect(refused, scope).toBeInstanceOf(federated.FederatedProvisionFreeholdOperationOpen);
        expect(refused, scope).toMatchObject({
          code: 'FEDERATED_PROVISION_FREEHOLD_OPERATION_OPEN',
          accountId: acct,
          cause: { code: '55006', constraint: 'freehold_operations_open_delete_guard' },
        });
        expect(await intentCount(open.operationId), scope).toBe(1);
        expect(
          await ops.cancelFreeholdOperation(pool, {
            operationId: open.operationId,
            accountId: acct,
            fingerprint: open.fingerprint,
            outcome: 'cancelled',
          }),
        ).toBeNull();
        // Control: the same cleanup lands once the intent closes.
        expect(await federated.deleteUnusedFederatedProvision(pool as never, acct), scope).toBe(
          true,
        );
        expect(
          (await pool.query('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [acct]))
            .rows[0].n,
        ).toBe(0);
      }
    });

    it('a character or an account delete racing a parked hooked save waits it out and lands: never a deadlock', async () => {
      for (const target of ['character', 'account'] as const) {
        const p = await player();
        const g = gate('after');
        const hooked = commit(
          depsFor({
            characterId: p.ch,
            state: bagsState('parked', 0),
            nonce: p.nonce,
            hold: g.hold,
          }),
          hearthRequest(p.acct),
        );
        const holder = await g.reached;
        // The save holds G1 (accounts KEY SHARE), the character row, and the
        // Hearth row; the delete needs the conflicting parent lock first.
        const deleted = pool.query(
          target === 'character'
            ? 'DELETE FROM characters WHERE id = $1'
            : 'DELETE FROM accounts WHERE id = $1',
          [target === 'character' ? p.ch : p.acct],
        );
        await waitForLockWaiters(
          target === 'character' ? 'DELETE FROM characters%' : 'DELETE FROM accounts%',
          1,
          holder,
        );
        g.open();
        const [h, d] = await Promise.allSettled([hooked, deleted]);
        // Neither side was chosen as a deadlock victim (40P01).
        expect(h, target).toMatchObject({ status: 'fulfilled', value: { kind: 'committed' } });
        expect(d, target).toMatchObject({ status: 'fulfilled', value: { rowCount: 1 } });
        const left = await pool.query(
          'SELECT (SELECT count(*)::int FROM characters WHERE id = $1) AS characters, (SELECT count(*)::int FROM account_freehold_hearth WHERE account_id = $2) AS hearth',
          [p.ch, p.acct],
        );
        expect(left.rows[0], target).toEqual({
          characters: 0,
          // An account delete cascades the Hearth row away; a character delete
          // never touches the account's clock.
          hearth: target === 'account' ? 0 : 1,
        });
      }
    });

    it('a prepare and a character delete racing each other: exactly one of them wins, in either order', async () => {
      // The prepare first: parked on its per-account advisory lock AFTER its
      // parent KEY SHARE locks, so the delete queues behind it, then finds
      // the committed intent and is refused.
      {
        const p = await player();
        const blocker = await pool.connect();
        try {
          await blocker.query('BEGIN');
          const blockerPid = Number(
            (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
          );
          await blocker.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [
            ops.FREEHOLD_ADVISORY_ACCOUNT_CLASS,
            p.acct,
          ]);
          const open = intentOf(p.acct, p.ch, null);
          const prepared = ops.prepareFreeholdOperation(pool, open);
          // Each wait is the one THIS case made: blocked by the named backend.
          await waitForLockWaiters('SELECT pg_advisory_xact_lock($1::int, $2::int)', 1, blockerPid);
          const preparePid = Number(
            (
              await pool.query(
                `SELECT pid FROM pg_stat_activity
                  WHERE datname = $1 AND wait_event_type = 'Lock'
                    AND $2::int = ANY(pg_blocking_pids(pid))`,
                [VERIFY_DB, blockerPid],
              )
            ).rows[0].pid,
          );
          const deleted = pool.query('DELETE FROM characters WHERE id = $1', [p.ch]).then(
            () => null,
            (error: unknown) => error,
          );
          await waitForLockWaiters('DELETE FROM characters%', 1, preparePid);
          await blocker.query('COMMIT');
          expect(await prepared).toEqual({ kind: 'prepared' });
          expect(await deleted).toMatchObject({
            code: '55006',
            constraint: 'freehold_operations_open_delete_guard',
          });
          expect(await intentCount(open.operationId)).toBe(1);
          expect(
            (await pool.query('SELECT count(*)::int AS n FROM characters WHERE id = $1', [p.ch]))
              .rows[0].n,
          ).toBe(1);
        } finally {
          await blocker.query('ROLLBACK').catch(() => {});
          blocker.release();
        }
      }
      // The delete first: it holds the character row, the prepare's KEY SHARE
      // queues behind it, and once the delete commits the prepare finds no
      // parent and records nothing.
      {
        const p = await player();
        const deleter = await pool.connect();
        try {
          await deleter.query('BEGIN');
          const deleterPid = Number(
            (await deleter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
          );
          await deleter.query('DELETE FROM characters WHERE id = $1', [p.ch]);
          const open = intentOf(p.acct, p.ch, null);
          const prepared = ops.prepareFreeholdOperation(pool, open);
          await waitForLockWaiters(
            'SELECT id FROM characters WHERE id = $1 AND account_id = $2 FOR KEY SHARE',
            1,
            deleterPid,
          );
          await deleter.query('COMMIT');
          expect(await prepared).toEqual({ kind: 'parent_missing' });
          expect(await intentCount(open.operationId)).toBe(0);
        } finally {
          await deleter.query('ROLLBACK').catch(() => {});
          deleter.release();
        }
      }
    });

    it('refuses both deletes while an intent is open, then each row class lands as declared', async () => {
      const t = await transferFixture();
      // An applied tombstone first (the transfer, with a Hearth advance so the
      // account owns every housing row class), then a second, OPEN intent.
      expect(await commit(transferDeps(t), transferRequest(t, { hearth: true }))).toMatchObject({
        kind: 'committed',
      });
      expect((await hearthOf(t.acct))?.revision).toBe('1');
      const open = intentOf(t.acct, t.ch, { plotId: t.plotId });
      expect(await ops.prepareFreeholdOperation(pool, open)).toEqual({ kind: 'prepared' });

      await expect(
        pool.query('DELETE FROM characters WHERE id = $1', [t.ch]),
      ).rejects.toMatchObject({
        code: '55006',
        constraint: 'freehold_operations_open_delete_guard',
        message: 'freehold_operation_open',
      });
      const refused = await charDelete
        .deleteOwnedCharacterRow({ connect: () => pool.connect() }, t.acct, t.ch, realm)
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refused).toBeInstanceOf(charDelete.CharacterFreeholdOperationOpen);
      expect(refused).toMatchObject({
        code: 'CHARACTER_FREEHOLD_OPERATION_OPEN',
        characterId: t.ch,
      });
      await expect(
        pool.query('DELETE FROM accounts WHERE id = $1', [t.acct]),
      ).rejects.toMatchObject({
        code: '55006',
        constraint: 'freehold_operations_open_delete_guard',
      });
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM characters WHERE id = $1', [t.ch]))
          .rows[0].n,
      ).toBe(1);
      expect(await intentCount(open.operationId)).toBe(1);
      // Every refused delete left the chair exactly where the transfer put it.
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });

      expect(
        await ops.cancelFreeholdOperation(pool, {
          operationId: open.operationId,
          accountId: t.acct,
          fingerprint: open.fingerprint,
          outcome: 'cancelled',
        }),
      ).toBeNull();
      // The cancel closed the intent and moved nothing.
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
      expect(
        await charDelete.deleteOwnedCharacterRow(
          { connect: () => pool.connect() },
          t.acct,
          t.ch,
          realm,
        ),
      ).toBe(true);
      // Control before the account delete: the tombstones still identify.
      expect((await receiptsOf(t.intent.operationId))[0]).toMatchObject({
        account_id: t.acct,
        plot_id: t.plotId,
        fingerprint: t.intent.fingerprint,
      });
      const gone = await pool.query('DELETE FROM accounts WHERE id = $1', [t.acct]);
      expect(gone.rowCount).toBe(1);

      // Claim, plot and Hearth cascade with the account; receipts are kept.
      expect(await claimRow(t.plotId)).toBeNull();
      expect(
        (
          await pool.query('SELECT count(*)::int AS n FROM account_freeholds WHERE plot_id = $1', [
            t.plotId,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(await hearthOf(t.acct)).toBeNull();
      expect(await receiptsOf(t.intent.operationId)).toEqual([
        {
          account_id: null,
          plot_id: null,
          kind: KIND,
          outcome: 'applied',
          fingerprint: null,
          applied_durable_rev: '2',
        },
      ]);
      expect(await receiptsOf(open.operationId)).toEqual([
        {
          account_id: null,
          plot_id: null,
          kind: KIND,
          outcome: 'cancelled',
          fingerprint: null,
          applied_durable_rev: null,
        },
      ]);
      // An erased tombstone stays erased: a later UPDATE that writes the plot id
      // or the fingerprint back is nulled by the same trigger, never raised.
      const rewrite = await pool.query(
        `UPDATE freehold_operation_receipts SET plot_id = $2, fingerprint = $3
          WHERE operation_id = $1`,
        [t.intent.operationId, t.plotId, t.intent.fingerprint],
      );
      expect(rewrite.rowCount).toBe(1);
      expect(await receiptsOf(t.intent.operationId)).toEqual([
        {
          account_id: null,
          plot_id: null,
          kind: KIND,
          outcome: 'applied',
          fingerprint: null,
          applied_durable_rev: '2',
        },
      ]);
    });

    it('eraseFreeholdOperationReceiptsForAccount nulls the same columns for a living account, and only its own', async () => {
      const t = await transferFixture();
      expect(await commit(transferDeps(t), transferRequest(t))).toMatchObject({
        kind: 'committed',
      });
      const bystander = await transferFixture();
      expect(
        await ops.cancelFreeholdOperation(pool, {
          operationId: bystander.intent.operationId,
          accountId: bystander.acct,
          fingerprint: bystander.intent.fingerprint,
          outcome: 'refused',
        }),
      ).toBeNull();

      expect(await ops.eraseFreeholdOperationReceiptsForAccount(pool, t.acct)).toBe(1);
      expect(await receiptsOf(t.intent.operationId)).toEqual([
        {
          account_id: null,
          plot_id: null,
          kind: KIND,
          outcome: 'applied',
          fingerprint: null,
          applied_durable_rev: '2',
        },
      ]);
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM accounts WHERE id = $1', [t.acct]))
          .rows[0].n,
      ).toBe(1);
      expect(await receiptsOf(bystander.intent.operationId)).toEqual([
        {
          account_id: bystander.acct,
          plot_id: bystander.plotId,
          kind: KIND,
          outcome: 'refused',
          fingerprint: bystander.intent.fingerprint,
          applied_durable_rev: null,
        },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // G. Interleaves with legacy participants carrying pending side effects.
  // ---------------------------------------------------------------------------
  describe('G. interleaves with legacy save participants', () => {
    function personalLedger(characterId: number, accountId: number, batchKey: string) {
      const batch = outbox.serializeBankLedgerCommandBatch(batchKey, [
        {
          realm,
          characterId,
          accountId,
          op: 'deposit' as const,
          itemId: 'peacebloom',
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: 6,
          container: 'personal' as const,
          containerId: null,
        },
      ]);
      return {
        owner: { realm, characterId, accountId },
        batches: [batch],
      } as BankLedgerSaveEffects;
    }

    async function ledgerReceipts(batchKey: string): Promise<number> {
      const res = await pool.query(
        'SELECT count(*)::int AS n FROM bank_ledger_batch_receipts WHERE batch_key = $1',
        [batchKey],
      );
      return res.rows[0].n;
    }

    it('a hooked save and a concurrent dirty autosave of the same character land in serial order', async () => {
      const p = await player();
      const key = `fm.autosave.${seq()}`;
      const own = `fm.hooked.${seq()}`;
      const g = gate('after');
      const probe = orderProbe({ ledger: ledgerRead(own), hearth: hearthRead(p.acct) });
      const hooked = commit(
        depsFor({
          characterId: p.ch,
          state: bagsState('housing', 0),
          nonce: p.nonce,
          ledgerEffects: personalLedger(p.ch, p.acct, own),
          hold: g.hold,
          observe: probe.observe,
        }),
        hearthRequest(p.acct),
      );
      await g.reached;
      const autosave = db.saveCharacterState(
        p.ch,
        8,
        bagsState('autosave', 0),
        p.nonce,
        [],
        personalLedger(p.ch, p.acct, key),
      );
      // The autosave queues on the character row the hooked save holds.
      await waitForLockWaiters('%FROM characters WHERE id = $1 AND realm = $2 FOR NO KEY UPDATE');
      g.open();
      const [h, a] = await Promise.all([hooked, autosave]);
      expect(h).toMatchObject({ kind: 'committed', hearth: { kind: 'advanced', revision: '1' } });
      expect(a).toBe(true);
      expect(await blobOf(p.ch)).toEqual({ level: 8, marker: 'autosave' });
      expect((await hearthOf(p.acct))?.revision).toBe('1');
      expect(await ledgerReceipts(key)).toBe(1);
      expect(await ledgerReceipts(own)).toBe(1);
      // The hooked save's legacy ledger write was already in place when the
      // housing suffix began, and the Hearth advanced only inside it.
      expect(probe.seen).toEqual([
        { when: 'before', ledger: 1, hearth: null },
        { when: 'after', ledger: 1, hearth: '1' },
      ]);
    });

    it('a hook refusal while the autosave waits rolls back only the housing save', async () => {
      const t = await transferFixture();
      const key = `fm.autosave.${seq()}`;
      const g = gate('before');
      const hooked = commit(
        depsFor({
          characterId: t.ch,
          state: bagsState('housing', 0),
          nonce: t.nonce,
          hold: g.hold,
        }),
        transferRequest(t, { fingerprint: 'e'.repeat(64) }),
      );
      await g.reached;
      const autosave = db.saveCharacterState(
        t.ch,
        8,
        bagsState('autosave', 1),
        t.nonce,
        [],
        personalLedger(t.ch, t.acct, key),
      );
      await waitForLockWaiters('%FROM characters WHERE id = $1 AND realm = $2 FOR NO KEY UPDATE');
      g.open();
      const [h, a] = await Promise.all([hooked, autosave]);
      expect(h).toMatchObject({ kind: 'refused', refusal: { reason: 'fingerprint' } });
      expect(a).toBe(true);
      expect(await blobOf(t.ch)).toEqual({ level: 8, marker: 'autosave' });
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
      expect(await intentCount(t.intent.operationId)).toBe(1);
      expect(await ledgerReceipts(key)).toBe(1);
    });

    it('a storage purchase apply and a ledger batch commit with the housing effect, and a refusal rolls both back', async () => {
      const p = await player();
      const effectFor = async (key: string): Promise<StorageAppliedEffect> => {
        const token = randomUUID();
        const begun = await storage.beginStoragePurchase(pool, {
          realm,
          accountId: p.acct,
          characterId: p.ch,
          itemId: 'strongbox_rung_01',
          expectedCostClaudium: 100,
          idempotencyKey: key,
          claimToken: token,
        });
        expect(begun).toMatchObject({ inserted: true, existing: { status: 'pending' } });
        return {
          realm,
          accountId: p.acct,
          characterId: p.ch,
          itemId: 'strongbox_rung_01',
          expectedCostClaudium: 100,
          idempotencyKey: key,
          spendClaimToken: token,
          purchasedSlotsBefore: 0,
          purchasedSlotsAfter: 6,
        };
      };
      const purchaseState = async (key: string) => ({
        receipts: (
          await pool.query(
            'SELECT count(*)::int AS n FROM storage_purchase_applied_receipts WHERE idempotency_key = $1',
            [key],
          )
        ).rows[0].n,
        pending: (
          await pool.query(
            `SELECT count(*)::int AS n FROM storage_purchases
              WHERE idempotency_key = $1 AND status = 'pending'`,
            [key],
          )
        ).rows[0].n,
      });

      const probeFor = (key: string, batchKey: string) => {
        const receipt: Read = [
          'SELECT count(*)::int AS v FROM storage_purchase_applied_receipts WHERE idempotency_key = $1',
          [key],
        ];
        return orderProbe(
          {
            receipt,
            pending: [
              `SELECT count(*)::int AS v FROM storage_purchases
                WHERE idempotency_key = $1 AND status = 'pending'`,
              [key],
            ],
            ledger: ledgerRead(batchKey),
            hearth: hearthRead(p.acct),
          },
          { committedReceipt: receipt },
        );
      };

      const k1 = `fm-storage-${seq()}`;
      const l1 = `fm.ledger.${seq()}`;
      const firstProbe = probeFor(k1, l1);
      const committed = await commit(
        depsFor({
          characterId: p.ch,
          state: bagsState('bought', 0),
          nonce: p.nonce,
          storageEffects: [await effectFor(k1)],
          ledgerEffects: personalLedger(p.ch, p.acct, l1),
          observe: firstProbe.observe,
        }),
        hearthRequest(p.acct),
      );
      expect(committed).toMatchObject({ kind: 'committed', hearth: { revision: '1' } });
      expect(await purchaseState(k1)).toEqual({ receipts: 1, pending: 0 });
      expect(await ledgerReceipts(l1)).toBe(1);
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'bought' });
      // Order: the storage receipt, the pending close and the ledger batch were
      // all written (uncommitted, invisible outside) before the housing suffix.
      expect(firstProbe.seen).toEqual([
        { when: 'before', receipt: 1, pending: 0, ledger: 1, hearth: null, committedReceipt: 0 },
        { when: 'after', receipt: 1, pending: 0, ledger: 1, hearth: '1', committedReceipt: 0 },
      ]);

      // The Hearth now refuses (cooldown): every legacy half rolls back with it.
      const k2 = `fm-storage-${seq()}`;
      const l2 = `fm.ledger.${seq()}`;
      const secondProbe = probeFor(k2, l2);
      const refused = await commit(
        depsFor({
          characterId: p.ch,
          state: bagsState('refused', 0),
          nonce: p.nonce,
          level: 9,
          storageEffects: [await effectFor(k2)],
          ledgerEffects: personalLedger(p.ch, p.acct, l2),
          observe: secondProbe.observe,
        }),
        hearthRequest(p.acct),
      );
      expect(refused).toMatchObject({
        kind: 'refused',
        refusal: { kind: 'hearth', result: { kind: 'cooldown' } },
      });
      // Written inside the transaction, then rolled back by the refusal.
      expect(secondProbe.seen).toEqual([
        { when: 'before', receipt: 1, pending: 0, ledger: 1, hearth: '1', committedReceipt: 0 },
      ]);
      expect(await purchaseState(k2)).toEqual({ receipts: 0, pending: 1 });
      expect(await ledgerReceipts(l2)).toBe(0);
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'bought' });
      expect((await hearthOf(p.acct))?.revision).toBe('1');
    });

    it('a storage purchase start waits on the hooked save and both commit, and a refused hooked save rolls back alone', async () => {
      const p = await player();
      const startOf = (key: string) =>
        storage.beginStoragePurchase(pool, {
          realm,
          accountId: p.acct,
          characterId: p.ch,
          itemId: 'strongbox_rung_01',
          expectedCostClaudium: 100,
          idempotencyKey: key,
          claimToken: randomUUID(),
        });
      // Round one: the hooked save carries a pending ledger batch and commits,
      // with the start parked on its character row.
      const key = `fm-start-${seq()}`;
      const l1 = `fm.ledger.${seq()}`;
      const g = gate('after');
      const hooked = commit(
        depsFor({
          characterId: p.ch,
          state: bagsState('housing', 0),
          nonce: p.nonce,
          hold: g.hold,
          ledgerEffects: personalLedger(p.ch, p.acct, l1),
        }),
        hearthRequest(p.acct),
      );
      const holder = await g.reached;
      const start = startOf(key);
      await waitForLockWaiters('SELECT id FROM characters WHERE id = $1 FOR UPDATE', 1, holder);
      g.open();
      const [h, s] = await Promise.all([hooked, start]);
      expect(h).toMatchObject({ kind: 'committed', hearth: { revision: '1' } });
      expect(s).toMatchObject({ inserted: true, existing: { status: 'pending' } });
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'housing' });
      expect(await ledgerReceipts(l1)).toBe(1);
      // Round two: the Hearth is now in cooldown, so the hooked save is REFUSED
      // while the next start waits on it. The start commits; every hooked half
      // (the character blob and its ledger batch) rolls back. (A character has
      // one pending purchase at a time, so round one's is cleared first.)
      await pool.query('DELETE FROM storage_purchases WHERE idempotency_key = $1', [key]);
      const key2 = `fm-start-${seq()}`;
      const l2 = `fm.ledger.${seq()}`;
      const g2 = gate('before');
      const refused = commit(
        depsFor({
          characterId: p.ch,
          state: bagsState('refused', 0),
          nonce: p.nonce,
          level: 9,
          hold: g2.hold,
          ledgerEffects: personalLedger(p.ch, p.acct, l2),
        }),
        hearthRequest(p.acct),
      );
      const holder2 = await g2.reached;
      const start2 = startOf(key2);
      await waitForLockWaiters('SELECT id FROM characters WHERE id = $1 FOR UPDATE', 1, holder2);
      g2.open();
      const [r, s2] = await Promise.all([refused, start2]);
      expect(r).toMatchObject({
        kind: 'refused',
        refusal: { kind: 'hearth', result: { kind: 'cooldown' } },
      });
      expect(s2).toMatchObject({ inserted: true, existing: { status: 'pending' } });
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'housing' });
      expect(await ledgerReceipts(l2)).toBe(0);
      expect((await hearthOf(p.acct))?.revision).toBe('1');
    });

    it('a hooked market-and-mail save writes its mail partition before the suffix, and a refusal rolls the partition back with every half', async () => {
      const p = await player();
      const recipientKey = `fmmail${seq()}`;
      const mailKey = `mail:${realm}:r:${recipientKey}`;
      const letter = (subject: string) =>
        ({
          id: seq(),
          recipientKey,
          from: 'FmVerify',
          subject,
          body: '',
          money: 0,
          items: [],
        }) as never;
      const mailRow = async (db_: Pick<import('pg').Pool, 'query'>) =>
        ((await db_.query('SELECT data FROM world_state WHERE key = $1', [mailKey])).rows[0]?.data
          ?.mail ?? null) as { subject: string }[] | null;
      const seen: { inside: unknown; outside: unknown }[] = [];
      const save = (marker: string, letters: never[]) =>
        commit(
          {
            pool,
            characterId: p.ch,
            save: (hook) =>
              db.saveCharacterAndMarketState(
                p.ch,
                6,
                bagsState(marker, 0),
                null,
                [{ recipientKey, letters }],
                p.nonce,
                [],
                [],
                [],
                undefined,
                undefined,
                [],
                {
                  ...hook,
                  // The order probe: the mail partition is written INSIDE the
                  // transaction before the housing suffix runs, and nothing
                  // outside sees it until COMMIT.
                  run: async (tx) => {
                    const insideRow = (
                      await tx.query('SELECT data FROM world_state WHERE key = $1', [mailKey])
                    ).rows?.[0] as { data?: { mail?: unknown } } | undefined;
                    const inside = insideRow?.data?.mail;
                    seen.push({
                      inside: (inside as { subject: string }[] | undefined)?.map((l) => l.subject),
                      outside: (await mailRow(pool))?.map((l) => l.subject) ?? null,
                    });
                    await hook.run(tx);
                  },
                },
              ),
          },
          hearthRequest(p.acct),
        );
      const first = await save('mailed', [letter('one')]);
      expect(first).toMatchObject({ kind: 'committed', hearth: { revision: '1' } });
      expect((await mailRow(pool))?.map((l) => l.subject)).toEqual(['one']);
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'mailed' });
      // The Hearth refuses now: the second letter and the character half roll
      // back with the refusal.
      const refused = await save('refused', [letter('one'), letter('two')]);
      expect(refused).toMatchObject({
        kind: 'refused',
        refusal: { kind: 'hearth', result: { kind: 'cooldown' } },
      });
      expect((await mailRow(pool))?.map((l) => l.subject)).toEqual(['one']);
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'mailed' });
      expect(seen).toEqual([
        { inside: ['one'], outside: null },
        { inside: ['one', 'two'], outside: ['one'] },
      ]);
    });

    it('a hooked guild-bank save lands the book delta and the Hearth together, and a refusal rolls both back', async () => {
      const p = await player();
      const guild = await pool.query(
        'INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id',
        [`FmVerifyGuild${seq()}`, realm],
      );
      const guildId = Number(guild.rows[0].id);
      const guildLedger = (key: string, copper: number) => {
        const delta = goldDelta(copper);
        const batch = outbox.serializeBankLedgerCommandBatch(
          key,
          [
            {
              realm,
              characterId: p.ch,
              accountId: p.acct,
              op: delta.op,
              itemId: delta.itemId,
              count: delta.count,
              instance: delta.instance,
              copperDelta: delta.copperDelta,
              purchasedSlotsAfter: delta.purchasedSlotsAfter,
              container: 'guild',
              containerId: guildId,
            },
          ],
          { guildId, deltas: [delta] },
        );
        return {
          books: [{ guildId, deltas: [delta] }] as GuildBankSave[],
          ledger: {
            owner: { realm, characterId: p.ch, accountId: p.acct },
            batches: [batch],
          } as BankLedgerSaveEffects,
        };
      };
      const treasury = async () =>
        (
          (await pool.query('SELECT data FROM guild_banks WHERE guild_id = $1', [guildId])).rows[0]
            ?.data as { treasury?: number } | undefined
        )?.treasury ?? null;

      const treasuryRead: Read = [
        "SELECT (data->>'treasury')::int AS v FROM guild_banks WHERE guild_id = $1",
        [guildId],
      ];
      const k1 = `fm.guild.${seq()}`;
      const first = guildLedger(k1, 500);
      const probe = orderProbe(
        { treasury: treasuryRead, ledger: ledgerRead(k1), hearth: hearthRead(p.acct) },
        { committedTreasury: treasuryRead },
      );
      const committed = await commit(
        depsFor({
          characterId: p.ch,
          state: bagsState('guild', 0),
          nonce: p.nonce,
          guildBanks: first.books,
          ledgerEffects: first.ledger,
          observe: probe.observe,
        }),
        hearthRequest(p.acct),
      );
      expect(committed).toMatchObject({ kind: 'committed', hearth: { revision: '1' } });
      expect(await treasury()).toBe(500);
      expect(await ledgerReceipts(k1)).toBe(1);
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'guild' });
      // Order: the ledger batch and the guild book were both written before the
      // housing suffix began; nothing is visible outside until COMMIT. This
      // probe sees both at 'before', so it cannot tell ledger-before-guild from
      // the reverse; that relative order is a DATA dependency of the legacy
      // save (writeClaimedGuildBankEffectsOnClient consumes the ledger write's
      // result) and is pinned by tests/server/bank_ledger_save_effects_db.test.ts
      // ('orders a hooked guild save: ledger receipts, then the guild replay,
      // then the housing hook, then COMMIT').
      expect(probe.seen).toEqual([
        { when: 'before', treasury: 500, ledger: 1, hearth: null, committedTreasury: null },
        { when: 'after', treasury: 500, ledger: 1, hearth: '1', committedTreasury: null },
      ]);

      const k2 = `fm.guild.${seq()}`;
      const second = guildLedger(k2, 300);
      const refused = await commit(
        depsFor({
          characterId: p.ch,
          state: bagsState('guild-refused', 0),
          nonce: p.nonce,
          level: 9,
          guildBanks: second.books,
          ledgerEffects: second.ledger,
        }),
        hearthRequest(p.acct),
      );
      expect(refused).toMatchObject({
        kind: 'refused',
        refusal: { kind: 'hearth', result: { kind: 'cooldown' } },
      });
      expect(await treasury()).toBe(500);
      expect(await ledgerReceipts(k2)).toBe(0);
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'guild' });
    });
  });

  // ---------------------------------------------------------------------------
  // H. No client across service IO.
  // ---------------------------------------------------------------------------
  describe('H. the prepare holds no client after it returns', () => {
    it('returns every checkout before it answers, and the intent is already durable', async () => {
      const { Pool } = await import('pg');
      const { materialSourceConnection } = await import('../../server/material_source_connection');
      const probe = new Pool({ ...materialSourceConnection(verifyUrl(ADMIN_URL)), max: 2 });
      try {
        const p = await player();
        const intent = intentOf(p.acct, p.ch, null);
        expect(await ops.prepareFreeholdOperation(probe, intent)).toEqual({ kind: 'prepared' });
        // It did check one out (a fresh pool now holds one, idle), and gave it back.
        expect(probe.totalCount).toBe(1);
        expect(probe.totalCount - probe.idleCount).toBe(0);
        // Durable before the caller's external call: another connection sees it.
        expect(await intentCount(intent.operationId)).toBe(1);
        expect(await ops.prepareFreeholdOperation(probe, intent)).toEqual({ kind: 'duplicate' });
        expect(probe.totalCount - probe.idleCount).toBe(0);
        const orphan = intentOf(999_999_999, null, null);
        expect(await ops.prepareFreeholdOperation(probe, orphan)).toEqual({
          kind: 'parent_missing',
        });
        expect(probe.totalCount - probe.idleCount).toBe(0);
        // Control: the reading discriminates a held client.
        const held = await probe.connect();
        expect(probe.totalCount - probe.idleCount).toBe(1);
        held.release();
        expect(probe.totalCount - probe.idleCount).toBe(0);
      } finally {
        await probe.end();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // I. The account export.
  // ---------------------------------------------------------------------------
  describe('I. exportAccountData carries only the allowlisted housing columns', () => {
    async function bulkReceipts(accountId: number, count: number, tag: string) {
      await pool.query(
        `INSERT INTO freehold_operation_receipts
                (operation_id, account_id, plot_id, kind, outcome, fingerprint, closed_at)
         SELECT 'fop:fmbulk' || $3 || ':' || g, $1, NULL, 'fm_bulk', 'cancelled',
                md5(g::text) || md5((g + 1)::text), now() - make_interval(secs => g)
           FROM generate_series(1, $2::int) AS g`,
        [accountId, count, tag],
      );
    }

    it('exports claims, intents and receipts by allowlist, and marks receipts past the limit', async () => {
      expect(ops.FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT).toBe(200);
      const t = await transferFixture();
      expect(await commit(transferDeps(t), transferRequest(t, { hearth: true }))).toMatchObject({
        kind: 'committed',
      });
      const open = intentOf(t.acct, t.ch, { plotId: t.plotId });
      expect(await ops.prepareFreeholdOperation(pool, open)).toEqual({ kind: 'prepared' });
      await bulkReceipts(t.acct, 200, `${seq()}`);

      // Control: the raw rows DO carry every secret the export must drop.
      const claim = await claimRow(t.plotId);
      const hearth = await hearthOf(t.acct);
      expect(claim?.write_token).toMatch(HEX32);
      expect(hearth?.advance_token).toMatch(HEX32);

      const exported = (await db.exportAccountData(t.acct)) as Record<string, unknown[]>;
      const keysOf = (row: unknown) => Object.keys(row as object).sort();
      expect(exported.freeholdClaims).toHaveLength(1);
      expect(keysOf(exported.freeholdClaims[0])).toEqual([
        'acquired_at',
        'expires_at',
        'heartbeat_at',
        'plot_id',
        'realm',
      ]);
      expect(exported.freeholdOperations).toHaveLength(1);
      expect(keysOf(exported.freeholdOperations[0])).toEqual([
        'character_id',
        'copy_refs',
        'created_at',
        'expected_durable_rev',
        'kind',
        'operation_id',
        'plot_id',
      ]);
      expect(exported.freeholdOperations[0]).toMatchObject({
        operation_id: open.operationId,
        kind: KIND,
        character_id: t.ch,
        plot_id: t.plotId,
        copy_refs: [COPY_REF],
        expected_durable_rev: '1',
      });
      const receipts = exported.freeholdOperationReceipts;
      expect(receipts).toHaveLength(201);
      expect(receipts[200]).toEqual({ truncated: true, limit: 200 });
      for (const row of receipts.slice(0, 200)) {
        expect(keysOf(row)).toEqual([
          'applied_durable_rev',
          'closed_at',
          'kind',
          'operation_id',
          'outcome',
          'plot_id',
        ]);
      }
      expect(keysOf(exported.freeholdHearth)).toEqual(['ready_at_ms', 'revision', 'updated_at']);

      const json = JSON.stringify(exported);
      for (const key of [
        'holder',
        'generation',
        'write_token',
        'writeToken',
        'fingerprint',
        'fence_generation',
        'fenceGeneration',
        'advance_token',
        'advanceToken',
      ]) {
        expect(json).not.toContain(`"${key}"`);
      }
      for (const secret of [
        db.PROCESS_LEASE_HOLDER,
        claim?.write_token as string,
        hearth?.advance_token as string,
        t.intent.fingerprint,
        open.fingerprint,
      ]) {
        expect(json).not.toContain(secret);
      }
    });

    it('exactly the limit exports no truncation marker', async () => {
      const acct = await makeAccount();
      await bulkReceipts(acct, 200, `${seq()}`);
      const exported = (await db.exportAccountData(acct)) as Record<string, unknown[]>;
      expect(exported.freeholdOperationReceipts).toHaveLength(200);
      expect(
        exported.freeholdOperationReceipts.some(
          (row) => (row as { truncated?: unknown }).truncated,
        ),
      ).toBe(false);
      expect(exported.freeholdClaims).toEqual([]);
      expect(exported.freeholdOperations).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // J. Every operation, guard and Hearth statement on its index (the manifest's
  // section 10: one EXPLAIN pin per new statement; the claim statements are
  // pinned in tests/server/freehold_claim.pg.test.ts).
  // ---------------------------------------------------------------------------
  describe('J. plans: every operation, guard and Hearth statement reaches its index', () => {
    const readsOf = (root: ExplainPlanNode, relation: string): ExplainPlanNode[] => {
      const out: ExplainPlanNode[] = [];
      const visit = (node: ExplainPlanNode) => {
        if (node['Relation Name'] === relation && node['Node Type'] !== 'ModifyTable')
          out.push(node);
        for (const child of node.Plans ?? []) visit(child);
      };
      visit(root);
      return out;
    };
    const nodeTypes = (root: ExplainPlanNode): string[] => [
      root['Node Type'],
      ...(root.Plans ?? []).flatMap(nodeTypes),
    ];
    /** Every read of `relation` reaches `index`: the index, or why not. */
    const reach = (root: ExplainPlanNode, relation: string, index: string): string[] =>
      readsOf(root, relation).map((node) => {
        const check = checkRelationUsesPartialIndex(node, relation, index);
        return check.ok ? index : (check.reason ?? 'refused');
      });

    it('pins that each statement can reach its index on production-shaped tables (seqscan off)', async () => {
      const p = await player();
      const other = await player();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Production-shaped, inside this transaction only: one account's long
        // receipt history beside many erased and foreign tombstones, and open
        // intents on several accounts, so each predicate's own index is the
        // selective one and fresh statistics say so.
        await client.query(
          `INSERT INTO freehold_operation_receipts
                  (operation_id, account_id, kind, outcome, closed_at)
           SELECT 'fop:jplan:' || $2 || ':' || g,
                  CASE WHEN g % 3 = 0 THEN $1::int WHEN g % 3 = 1 THEN $3::int END,
                  'fm_bulk', 'cancelled', now() - make_interval(secs => g)
             FROM generate_series(1, 900) AS g`,
          [p.acct, seq(), other.acct],
        );
        for (const who of [p, other]) {
          for (let i = 0; i < 4; i++) {
            await client.query(
              `INSERT INTO freehold_operations
                      (operation_id, account_id, character_id, kind, fingerprint)
               VALUES ($1, $2, $3, 'fm_bulk', $4)`,
              [`fop:jopen:${seq()}`, who.acct, who.ch, 'e'.repeat(64)],
            );
          }
        }
        await client.query('ANALYZE freehold_operation_receipts');
        await client.query('ANALYZE freehold_operations');
        await client.query('ANALYZE account_freehold_hearth');
        // A small table is cheaper read whole, so the planner would rightly
        // scan it and prove nothing: seqscan off asks whether each predicate
        // CAN reach an index, and which one.
        await client.query('SET LOCAL enable_seqscan = off');
        const explain = async (text: string, values?: unknown[]) =>
          rootPlanFromExplainRow(
            (await client.query(`EXPLAIN (FORMAT JSON) ${text}`, values)).rows[0],
          );
        const byAccount = 'freehold_operations_account';
        const byCharacter = 'freehold_operations_character';
        const receiptsByAccount = 'freehold_operation_receipts_account';
        // The account reads: the recovery discovery, the prepare cap, the export.
        for (const [name, text, values] of [
          ['open count', ops.FREEHOLD_OPERATION_OPEN_COUNT_SQL, [p.acct]],
          ['discover', ops.FREEHOLD_OPERATION_DISCOVER_SQL, [p.acct, 8]],
          ['export intents', ops.FREEHOLD_OPERATION_EXPORT_INTENTS_SQL, [p.acct]],
          // The account guard trigger's own query, as the predicate its plpgsql
          // body runs (pinned to the DDL below); PostgreSQL's own RI and trigger
          // statements are not reachable from EXPLAIN, so these are equivalents.
          [
            'account guard',
            'SELECT operation_id FROM freehold_operations WHERE account_id = $1 LIMIT 1',
            [p.acct],
          ],
        ] as const) {
          expect(
            reach(await explain(text, [...values]), 'freehold_operations', byAccount),
            name,
          ).toEqual([byAccount]);
        }
        // The character delete's pre-read and the character guard trigger's
        // query, on the PARTIAL character index.
        for (const [name, text] of [
          ['delete pre-read', charDelete.CHARACTER_DELETE_FREEHOLD_OPERATION_SQL],
          [
            'character guard',
            'SELECT operation_id FROM freehold_operations WHERE character_id = $1 LIMIT 1',
          ],
        ] as const) {
          expect(
            reach(await explain(text, [p.ch]), 'freehold_operations', byCharacter),
            name,
          ).toEqual([byCharacter]);
        }
        // The guard function queries exactly those predicates.
        expect(ops.FREEHOLD_OPERATION_SCHEMA).toContain(
          'WHERE character_id = OLD.id\n     LIMIT 1;',
        );
        expect(ops.FREEHOLD_OPERATION_SCHEMA).toContain('WHERE account_id = OLD.id\n     LIMIT 1;');
        // The receipts export: the ordered partial index serves the newest-first
        // limit with NO sort over the account's whole history.
        const exportPlan = await explain(ops.FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL, [p.acct, 201]);
        expect(reach(exportPlan, 'freehold_operation_receipts', receiptsByAccount)).toEqual([
          receiptsByAccount,
        ]);
        expect(nodeTypes(exportPlan)).not.toContain('Sort');
        expect(nodeTypes(exportPlan)).not.toContain('Incremental Sort');
        // The soft-delete erase, which is also the exact statement the true
        // delete's ON DELETE SET NULL issues.
        expect(
          reach(
            await explain(ops.FREEHOLD_OPERATION_RECEIPTS_ERASE_SQL, [p.acct]),
            'freehold_operation_receipts',
            receiptsByAccount,
          ),
        ).toEqual([receiptsByAccount]);
        // The per-id statements on the primary keys.
        for (const [name, text, relation, index] of [
          [
            'receipt read',
            ops.FREEHOLD_OPERATION_RECEIPT_READ_SQL,
            'freehold_operation_receipts',
            'freehold_operation_receipts_pkey',
          ],
          [
            'intent lock',
            ops.FREEHOLD_OPERATION_INTENT_LOCK_SQL,
            'freehold_operations',
            'freehold_operations_pkey',
          ],
          [
            'intent read',
            ops.FREEHOLD_OPERATION_INTENT_READ_SQL,
            'freehold_operations',
            'freehold_operations_pkey',
          ],
          [
            'intent delete',
            ops.FREEHOLD_OPERATION_DELETE_SQL,
            'freehold_operations',
            'freehold_operations_pkey',
          ],
        ] as const) {
          expect(reach(await explain(text, ['fop:jplan:none']), relation, index), name).toEqual([
            index,
          ]);
        }
        // The inserts read nothing of their own table: their arbiters are the PKs.
        const insertPlan = await explain(ops.FREEHOLD_OPERATION_INSERT_SQL, [
          'fop:jplan:new',
          p.acct,
          p.ch,
          null,
          'fm_bulk',
          'e'.repeat(64),
          '[]',
          null,
          null,
        ]);
        expect(
          (insertPlan as unknown as Record<string, unknown>)['Conflict Arbiter Indexes'],
        ).toEqual(['freehold_operations_pkey']);
        const receiptInsert = await explain(ops.FREEHOLD_OPERATION_RECEIPT_INSERT_SQL, [
          'fop:jplan:new',
          p.acct,
          null,
          'fm_bulk',
          'applied',
          'e'.repeat(64),
          null,
        ]);
        expect(
          (receiptInsert as unknown as Record<string, unknown>)['Conflict Arbiter Indexes'],
        ).toEqual(['freehold_operation_receipts_pkey']);
        expect(reach(receiptInsert, 'accounts', 'accounts_pkey')).toEqual(['accounts_pkey']);
        // The Hearth's locked read and its verify read, on the account key: the
        // shipped statements themselves.
        const hearthDb = await import('../../server/freehold_hearth_db');
        for (const text of [
          hearthDb.FREEHOLD_HEARTH_VERIFY_SQL,
          hearthDb.FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL,
          hearthDb.FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL,
        ]) {
          const relation = text.includes('FROM accounts') ? 'accounts' : 'account_freehold_hearth';
          const index = relation === 'accounts' ? 'accounts_pkey' : 'account_freehold_hearth_pkey';
          expect(reach(await explain(text, [p.acct]), relation, index)).toEqual([index]);
        }
        // The advance's UPDATE on the account key, the lazy init's conflict
        // arbiter, and the ambiguous-COMMIT verify's FOR SHARE wait on the
        // character key.
        expect(
          reach(
            await explain(hearthDb.FREEHOLD_HEARTH_ADVANCE_SQL, [
              p.acct,
              '1',
              String(COOLDOWN_MS),
              'f'.repeat(32),
            ]),
            'account_freehold_hearth',
            'account_freehold_hearth_pkey',
          ),
        ).toEqual(['account_freehold_hearth_pkey']);
        const initPlan = await explain(hearthDb.FREEHOLD_HEARTH_INIT_SQL, [p.acct]);
        expect(
          (initPlan as unknown as Record<string, unknown>)['Conflict Arbiter Indexes'],
        ).toEqual(['account_freehold_hearth_pkey']);
        // The suite's own literal IS the shipped statement, so the plan is the
        // production wait's.
        const mutationDb = await import('../../server/freehold_mutation_db');
        expect(VERIFY_WAIT_TEXT).toBe(mutationDb.FREEHOLD_VERIFY_WAIT_SQL);
        expect(
          reach(await explain(VERIFY_WAIT_TEXT, [p.ch]), 'characters', 'characters_pkey'),
        ).toEqual(['characters_pkey']);
        // Negative control: a predicate no index serves still scans, and the
        // reader refuses it.
        expect(
          reach(
            await explain('SELECT 1 FROM freehold_operation_receipts WHERE kind = $1', ['fm_bulk']),
            'freehold_operation_receipts',
            receiptsByAccount,
          ),
        ).toEqual([
          '"freehold_operation_receipts" used Seq Scan instead of "freehold_operation_receipts_account"',
        ]);
      } finally {
        const rolledBack = await client.query('ROLLBACK').then(
          () => true,
          () => false,
        );
        client.release(!rolledBack);
        // ANALYZE writes pg_class counts in place, outside the transaction:
        // bring them back to what the tables hold for every later case.
        await pool.query('VACUUM (ANALYZE) freehold_operation_receipts');
        await pool.query('VACUUM (ANALYZE) freehold_operations');
        await pool.query('ANALYZE account_freehold_hearth');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // K. A steady-state boot re-applies the claim and operation fragments as
  //    catalog reads: no lock any live housing or parent writer conflicts with.
  // ---------------------------------------------------------------------------
  describe('K. a steady-state re-apply of the housing fragments is catalog-only', () => {
    /** Every table the four housing fragments create, index, alter or attach a
     *  trigger to. */
    const TABLES = [
      'account_freeholds',
      'account_freehold_hearth',
      'freehold_plot_claims',
      'freehold_operations',
      'freehold_operation_receipts',
      'characters',
      'accounts',
    ];

    /** Every object the fragments own, by oid: a re-create changes the oid. */
    async function owned() {
      const res = await pool.query(
        `SELECT 'index ' || c.relname || ' ' || c.oid || ' ' || c.relfilenode AS o
           FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = ANY($1::regclass[])
         UNION ALL
         SELECT 'trigger ' || t.tgname || ' ' || t.oid || ' ' || t.tgenabled::text
           FROM pg_trigger t
          WHERE t.tgrelid = ANY($1::regclass[]) AND t.tgname LIKE 'freehold_operation_%'
         UNION ALL
         SELECT 'constraint ' || n.conname || ' ' || n.oid || ' ' || n.convalidated
           FROM pg_constraint n
          WHERE n.conrelid = ANY($1::regclass[]) AND n.conname ~ '^(account_)?freehold'
         UNION ALL
         SELECT 'function ' || p.proname || ' ' || p.oid
           FROM pg_proc p
          WHERE p.proname IN ('guard_open_freehold_operation_parent_delete',
                              'erase_freehold_operation_receipt')
         ORDER BY 1`,
        [TABLES],
      );
      return res.rows.map((r: { o: string }) => r.o);
    }

    /** Runs `sql` while another transaction holds ROW EXCLUSIVE (what every
     *  live claim write, operation write, character save and account update
     *  holds) on every one of those tables, under `lockTimeout`. Returns the
     *  strongest relation lock the applier itself took on them, or the code
     *  it failed with. */
    async function applyBesideWriters(sql: string, commit: boolean, lockTimeout = '1s') {
      const writer = await pool.connect();
      const applier = await pool.connect();
      try {
        await writer.query('BEGIN');
        for (const table of TABLES) await writer.query(`LOCK TABLE ${table} IN ROW EXCLUSIVE MODE`);
        await applier.query('BEGIN');
        await applier.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        try {
          await applier.query(sql);
        } catch (error) {
          await applier.query('ROLLBACK');
          return { code: (error as { code?: string }).code };
        }
        const held = await applier.query(
          `SELECT relation::regclass::text AS rel, mode FROM pg_locks
            WHERE pid = pg_backend_pid() AND locktype = 'relation'
              AND relation = ANY($1::regclass[]) AND mode <> 'AccessShareLock'
            ORDER BY 1, 2`,
          [TABLES],
        );
        await applier.query(commit ? 'COMMIT' : 'ROLLBACK');
        return { stronger: held.rows };
      } finally {
        await applier.query('ROLLBACK').catch(() => {});
        await writer.query('ROLLBACK').catch(() => {});
        writer.release();
        applier.release();
      }
    }

    it('re-applies all four fragments beside live writers on every table, and keeps every object they own', async () => {
      const before = await owned();
      // The catalog the fragments own is all present (a vacuous snapshot
      // would compare two empty lists).
      expect(
        before.filter((o) => o.startsWith('index freehold_')).map((o) => o.split(' ')[1]),
      ).toEqual([
        'freehold_operation_receipts_account',
        'freehold_operation_receipts_pkey',
        'freehold_operations_account',
        'freehold_operations_character',
        'freehold_operations_pkey',
        'freehold_plot_claims_account',
        'freehold_plot_claims_holder',
        'freehold_plot_claims_pkey',
      ]);
      expect(before.filter((o) => o.startsWith('trigger '))).toEqual([
        expect.stringMatching(/^trigger freehold_operation_guard_account_delete \d+ O$/),
        expect.stringMatching(/^trigger freehold_operation_guard_character_delete \d+ O$/),
        expect.stringMatching(/^trigger freehold_operation_receipt_erase \d+ O$/),
      ]);
      expect(before.filter((o) => o.startsWith('function '))).toHaveLength(2);
      // The plot and Hearth fragments' constraints are in the snapshot too.
      expect(before).toContainEqual(
        expect.stringMatching(/^constraint account_freehold_hearth_advance_token_shape \d+ true$/),
      );
      expect(before).toContainEqual(expect.stringMatching(/^constraint account_freeholds_/));
      const hearth = await import('../../server/freehold_hearth_db');
      expect(
        await applyBesideWriters(
          [
            plots.FREEHOLD_SCHEMA,
            hearth.FREEHOLD_HEARTH_SCHEMA,
            claims.FREEHOLD_CLAIM_SCHEMA,
            ops.FREEHOLD_OPERATION_SCHEMA,
          ].join('\n'),
          true,
        ),
      ).toEqual({ stronger: [] });
      expect(await owned()).toEqual(before);
    });

    it('the control: each statement the probes skip WOULD queue behind those writers', async () => {
      // The shapes the probes skip, one per table class: an unprobed no-op
      // index create takes SHARE, and the trigger reconcile (run only when a
      // probe finds a trigger wrong) takes the parent's ACCESS EXCLUSIVE. Either
      // one in every boot would hold every other realm's writes behind this
      // realm's boot COMMIT. Each runs in a transaction that rolls back.
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS freehold_plot_claims_holder ON freehold_plot_claims (holder)',
        'CREATE INDEX IF NOT EXISTS freehold_operations_account ON freehold_operations (account_id, created_at)',
        `CREATE INDEX IF NOT EXISTS freehold_operation_receipts_account
           ON freehold_operation_receipts (account_id, closed_at DESC, operation_id DESC)
           WHERE account_id IS NOT NULL`,
        'DROP TRIGGER IF EXISTS freehold_operation_guard_character_delete ON characters',
        'DROP TRIGGER IF EXISTS freehold_operation_guard_account_delete ON accounts',
        'CREATE UNIQUE INDEX IF NOT EXISTS account_freeholds_plot_id ON account_freeholds (plot_id)',
        'ALTER TABLE account_freehold_hearth ADD COLUMN IF NOT EXISTS advance_token TEXT',
      ]) {
        // A short bound: the control only has to show the statement queues.
        expect(await applyBesideWriters(sql, false, '150ms'), sql).toEqual({ code: '55P03' });
      }
    });

    it("puts the caller's own search_path back after the operation fragment", async () => {
      // ensureSchema applies the fragments one after another in ONE
      // transaction, so a fragment that left its own fixed path in force would
      // hand it to the next fragment's capture (the storage fragment's).
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL search_path = 'fhqa_probe', public");
        const before = (await client.query('SHOW search_path')).rows[0].search_path;
        expect(before).toBe('fhqa_probe, public');
        await client.query(ops.FREEHOLD_OPERATION_SCHEMA);
        expect((await client.query('SHOW search_path')).rows[0].search_path).toBe(before);
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    });
  });

  describe("L. the boot's locks on the parents, observed", () => {
    /** The parents DEPLOY's "EVERY BOOT LOCKS THE PARENTS" bullet names, in
     *  the order it states them. */
    const PARENTS = ['auth_tokens', 'characters', 'accounts'];

    /** That bullet, its whitespace collapsed, and a statement it gives an
     *  operator, read by its opening words so the case runs the doc's own SQL. */
    function bootBullet(): string {
      const deploy = readFileSync('DEPLOY.md', 'utf8');
      const at = deploy.indexOf('- EVERY BOOT LOCKS THE PARENTS');
      const next = deploy.indexOf('\n- ', at + 1);
      expect(at).toBeGreaterThan(-1);
      expect(next).toBeGreaterThan(at);
      return deploy.slice(at, next).replace(/\s+/g, ' ');
    }
    function operatorSql(opening: string): string {
      const found = bootBullet()
        .split('`')
        .filter((_, i) => i % 2 === 1)
        .filter((span) => span.startsWith(opening));
      expect(found, opening).toHaveLength(1);
      return found[0];
    }

    /** Every table in the schema, as the nightly pg_dump locks them. */
    async function everyTable(): Promise<string[]> {
      const res = await pool.query(
        `SELECT c.oid::regclass::text AS t FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`,
      );
      return res.rows.map((r: { t: string }) => r.t);
    }

    /** Polls, to a deadline, for the one relation lock some session of this
     *  database other than `holderPid` is waiting for. */
    async function waiter(holderPid: number) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const res = await pool.query(
          `SELECT pid, relation::regclass::text AS rel, mode FROM pg_locks
            WHERE locktype = 'relation' AND NOT granted AND pid <> $1
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
          [holderPid],
        );
        if (res.rows.length > 0) {
          expect(res.rows, 'one waiting lock').toHaveLength(1);
          return res.rows[0] as { pid: number; rel: string; mode: string };
        }
        await sleep(20);
      }
      throw new Error('the boot never queued behind the held lock');
    }

    /** The sessions of this database holding or waiting for the schema
     *  advisory lock, as `granted` or `waiting`. */
    async function advisory(): Promise<string[]> {
      const res = await pool.query(
        `SELECT CASE WHEN granted THEN 'granted' ELSE 'waiting' END AS s FROM pg_locks
          WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          ORDER BY 1`,
        [0x57_4f_43_01],
      );
      return res.rows.map((r: { s: string }) => r.s);
    }

    /** Polls, to a deadline, until `read` returns `want`. */
    async function until<T>(read: () => Promise<T>, want: T): Promise<T> {
      const deadline = Date.now() + 5_000;
      let got = await read();
      while (Date.now() < deadline && JSON.stringify(got) !== JSON.stringify(want)) {
        await sleep(20);
        got = await read();
      }
      return got;
    }

    /** Every lock `pid` holds on a table of the schema, whatever the table
     *  (the catalog reads a DO block makes are not the schema's). */
    async function heldBy(pid: number): Promise<string[]> {
      const res = await pool.query(
        `SELECT l.relation::regclass::text || ' ' || l.mode AS lock FROM pg_locks l
           JOIN pg_class c ON c.oid = l.relation
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE l.pid = $1 AND l.locktype = 'relation' AND l.granted
            AND n.nspname = 'public' AND c.relkind IN ('r', 'p')
          ORDER BY 1`,
        [pid],
      );
      return res.rows.map((r: { lock: string }) => r.lock);
    }

    /** Holds `mode` on `tables` (by default ACCESS SHARE, what the nightly
     *  pg_dump holds on every table for its whole run, then under the dump's
     *  own session name), runs the REAL boot (`ensureSchema`) beside it, and
     *  reads the lock it waits for and every table lock it holds. `during` runs
     *  while the boot still waits and gets the boot's outcome (`'finished'` or
     *  its error); the boot must finish unless `mayFail`. */
    async function bootBehind(
      tables: readonly string[],
      opts: {
        mode?: string;
        during?: (
          seen: { pid: number; holderPid: number },
          boot: Promise<unknown>,
        ) => Promise<void>;
        mayFail?: boolean;
      } = {},
    ) {
      const { mode = 'ACCESS SHARE', during, mayFail = false } = opts;
      const holder = await pool.connect();
      let boot: Promise<unknown> | undefined;
      let result: { on: string; waits: string; held: string[] } | undefined;
      try {
        if (mode === 'ACCESS SHARE') await holder.query("SET application_name = 'pg_dump'");
        await holder.query('BEGIN');
        await holder.query(`LOCK TABLE ${tables.join(', ')} IN ${mode} MODE`);
        const holderPid = (await holder.query('SELECT pg_backend_pid() AS p')).rows[0].p;
        boot = db.ensureSchema().then(
          () => 'finished',
          (error: unknown) => error,
        );
        const seen = await waiter(holderPid);
        result = { on: seen.rel, waits: seen.mode, held: await heldBy(seen.pid) };
        if (during) await during({ pid: seen.pid, holderPid }, boot);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        await holder.query('RESET application_name').catch(() => {});
        holder.release();
        await boot;
      }
      const outcome = await boot;
      if (!mayFail && outcome !== 'finished') throw outcome;
      return result;
    }

    /** The statements each pg Client sent, by client, in order. */
    function sentByClient(spy: { mock: { calls: unknown[][]; contexts: unknown[] } }) {
      const sent = new Map<unknown, string[]>();
      spy.mock.calls.forEach((args, i) => {
        const first = args[0] as unknown;
        const text =
          typeof first === 'string' ? first : String((first as { text?: unknown })?.text ?? '');
        const context = spy.mock.contexts[i];
        sent.set(context, [...(sent.get(context) ?? []), text]);
      });
      return sent;
    }

    /** The boot clients, in the order they began: each takes the schema
     *  advisory lock. */
    const bootClients = (spy: { mock: { calls: unknown[][]; contexts: unknown[] } }) =>
      [...sentByClient(spy)]
        .filter(([, texts]) => texts.includes('SELECT pg_advisory_xact_lock($1)'))
        .map(([client, texts]) => ({ client, texts }));

    /** Stopping a realm ends its process, which closes its socket. */
    function stop(client: unknown) {
      const stopped = client as {
        on(event: 'error', listener: () => void): void;
        connection: { stream: { destroy(): void } };
      };
      stopped.on('error', () => {});
      stopped.connection.stream.destroy();
    }

    it('locks auth_tokens, then characters, then accounts, and sends no lock timeout', async () => {
      const { Client } = await import('pg');
      const spy = vi.spyOn(Client.prototype, 'query');
      try {
        // Behind each parent the boot holds every earlier parent and nothing
        // on a later one; on the first two it holds SHARE (the index create)
        // already, on `accounts` nothing, and no lock on any other table of
        // the schema. The order is PARENTS' own, read off the real
        // statements, whatever kind of statement takes each lock, and DEPLOY
        // states it.
        const modes = [
          ['auth_tokens ShareLock'],
          ['auth_tokens AccessExclusiveLock', 'auth_tokens ShareLock', 'characters ShareLock'],
          [
            'auth_tokens AccessExclusiveLock',
            'auth_tokens ShareLock',
            'characters AccessExclusiveLock',
            'characters ShareLock',
          ],
        ];
        // DEPLOY's stall-over reading counts every mode that blocks a token
        // write, whole: each mode PostgreSQL makes the ROW EXCLUSIVE a write
        // takes wait for, read off the server by holding each mode in turn.
        const stallSql = operatorSql("SELECT count(*) FROM pg_locks WHERE locktype = 'relation'");
        const counted = /mode IN \(([^)]*)\);$/
          .exec(stallSql)?.[1]
          .split(', ')
          .map((mode) => mode.slice(1, -1));
        const MODES: Record<string, string> = {
          AccessShareLock: 'ACCESS SHARE',
          RowShareLock: 'ROW SHARE',
          RowExclusiveLock: 'ROW EXCLUSIVE',
          ShareUpdateExclusiveLock: 'SHARE UPDATE EXCLUSIVE',
          ShareLock: 'SHARE',
          ShareRowExclusiveLock: 'SHARE ROW EXCLUSIVE',
          ExclusiveLock: 'EXCLUSIVE',
          AccessExclusiveLock: 'ACCESS EXCLUSIVE',
        };
        const blocksWrite: string[] = [];
        for (const [mode, sql] of Object.entries(MODES)) {
          const holder = await pool.connect();
          const writer = await pool.connect();
          try {
            await holder.query('BEGIN');
            await holder.query(`LOCK TABLE auth_tokens IN ${sql} MODE`);
            const held = await holder.query(
              "SELECT mode FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'relation' AND relation = 'auth_tokens'::regclass",
            );
            expect(held.rows.map((r: { mode: string }) => r.mode)).toEqual([mode]);
            await writer.query('BEGIN');
            const waits = await writer
              .query('LOCK TABLE auth_tokens IN ROW EXCLUSIVE MODE NOWAIT')
              .then(
                () => false,
                (error: { code?: string }) => error.code === '55P03' || Promise.reject(error),
              );
            if (waits) blocksWrite.push(mode);
          } finally {
            await writer.query('ROLLBACK').catch(() => {});
            await holder.query('ROLLBACK').catch(() => {});
            writer.release();
            holder.release();
          }
        }
        expect(blocksWrite).toHaveLength(4);
        expect(counted).toEqual(blocksWrite);
        const stall = async (sql = stallSql) => Number((await pool.query(sql)).rows[0].count);
        expect(await stall()).toBe(0);
        // DEPLOY's diagnosis, read on a stalled boot: it holds the schema
        // advisory lock, waits on `relation`, and names the dump-shaped holder.
        const diagnosis = async () =>
          (await pool.query(operatorSql('SELECT l.pid, l.granted'))).rows.map(
            (r: Record<string, unknown>) => ({
              pid: r.pid,
              granted: r.granted,
              wait_event_type: r.wait_event_type,
              wait_event: r.wait_event,
              phase: r.phase,
              blocked_by: r.blocked_by,
            }),
          );
        for (const [i, parent] of PARENTS.entries()) {
          const seen = await bootBehind([parent], {
            during: async ({ pid, holderPid }) => {
              // Behind each parent the boot holds `auth_tokens` SHARE and
              // either holds or waits for its ACCESS EXCLUSIVE: the reading
              // counts both.
              expect(await stall(), parent).toBe(2);
              if (i === 0)
                expect(await diagnosis()).toEqual([
                  {
                    pid,
                    granted: true,
                    wait_event_type: 'Lock',
                    wait_event: 'relation',
                    phase: null,
                    blocked_by: [holderPid],
                  },
                ]);
            },
          });
          expect(seen).toEqual({ on: parent, waits: 'AccessExclusiveLock', held: modes[i] });
          const tables = new Set(seen.held.map((lock) => lock.split(' ')[0]));
          for (const earlier of PARENTS.slice(0, i))
            expect(tables.has(earlier), earlier).toBe(true);
          for (const later of PARENTS.slice(i + 1)) expect(tables.has(later), later).toBe(false);
        }
        expect(bootBullet()).toContain(
          `first on ${PARENTS.map((table) => `\`${table}\``).join(', then ')}`,
        );
        // Behind an open write on `auth_tokens` the boot is still queued for
        // SHARE, and a token write queues behind it: the reading counts it,
        // where counting ACCESS EXCLUSIVE alone would read 0.
        const exclusiveOnly = stallSql.replace(/mode IN \([^)]*\)/, "mode = 'AccessExclusiveLock'");
        expect(exclusiveOnly).not.toBe(stallSql);
        const tokenWrite = async () => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query("SET LOCAL statement_timeout = '200ms'");
            await client.query("DELETE FROM auth_tokens WHERE token = 'none'");
            return 'ran';
          } catch (error) {
            return (error as { code?: string }).code;
          } finally {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
          }
        };
        const queued = await bootBehind(['auth_tokens'], {
          mode: 'ROW EXCLUSIVE',
          during: async () => {
            expect(await stall()).toBe(1);
            expect(await stall(exclusiveOnly)).toBe(0);
            expect(await tokenWrite()).toBe('57014');
          },
        });
        expect(queued).toEqual({ on: 'auth_tokens', waits: 'ShareLock', held: [] });
        expect(await stall()).toBe(0);
        // The later tables DEPLOY names lock too: behind each the boot waits
        // for ACCESS EXCLUSIVE.
        for (const later of ['play_sessions', 'character_leases']) {
          expect(bootBullet()).toContain(`\`${later}\``);
          expect(await bootBehind([later])).toMatchObject({
            on: later,
            waits: 'AccessExclusiveLock',
          });
        }
        // The control for the stream read below: a lock timeout a client
        // sends is seen.
        const control = await pool.connect();
        try {
          await control.query('BEGIN');
          await control.query("SET LOCAL lock_timeout = '1s'");
        } finally {
          await control.query('ROLLBACK').catch(() => {});
          control.release();
        }
        // A boot is the client that takes the schema advisory lock: it lifts
        // the statement timeout first and sends no lock timeout, neither as a
        // statement nor as a startup parameter (the config key or `-c` in its
        // options), so each wait above lasts as long as the lock is held.
        expect(
          [...sentByClient(spy).values()].filter((texts) =>
            texts.some((text) => /lock_timeout/.test(text)),
          ),
        ).toHaveLength(1);
        const boots = bootClients(spy);
        expect(boots).toHaveLength(PARENTS.length + 3);
        type Startup = { connectionParameters: { lock_timeout?: unknown; options?: unknown } };
        const startupOf = (config: object) =>
          (new Client(config) as unknown as Startup).connectionParameters;
        expect(startupOf({ lock_timeout: 1000 }).lock_timeout).toBe(1000);
        expect(String(startupOf({ options: '-c lock_timeout=1s' }).options)).toMatch(
          /lock_timeout/,
        );
        for (const { client, texts } of boots) {
          expect(texts.slice(0, 3)).toEqual([
            'BEGIN',
            'SET LOCAL statement_timeout = 0',
            'SELECT pg_advisory_xact_lock($1)',
          ]);
          expect(texts.filter((text) => /lock_timeout/i.test(text))).toEqual([]);
          const startup = (client as Startup).connectionParameters;
          // pg sends the startup lock_timeout only when it is truthy.
          expect(Boolean(startup.lock_timeout)).toBe(false);
          expect(String(startup.options ?? '')).not.toMatch(/lock_timeout/i);
        }
      } finally {
        spy.mockRestore();
      }
    });

    it('behind the dump: SHARE on auth_tokens alone, and DEPLOY ends every boot that queues there', async () => {
      const { Client } = await import('pg');
      const spy = vi.spyOn(Client.prototype, 'query');
      const tokenRead = async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL statement_timeout = '200ms'");
          await client.query('SELECT count(*) FROM auth_tokens');
          return 'ran';
        } catch (error) {
          return (error as { code?: string }).code;
        } finally {
          await client.query('ROLLBACK').catch(() => {});
          client.release();
        }
      };
      // DEPLOY's quiet reading, pinned whole: its open-transaction filter, its
      // session kinds (an `autovacuum worker` row among them) and its own
      // session left out.
      const quietSql = operatorSql('SELECT backend_type, application_name');
      expect(quietSql).toBe(
        'SELECT backend_type, application_name, client_addr, state, now() - xact_start AS open_for FROM pg_stat_activity WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid();',
      );
      const quiet = async () =>
        (await pool.query(quietSql)).rows
          .filter((r: { backend_type: string }) => r.backend_type === 'client backend')
          .map((r: { application_name: string; state: string }) => [r.application_name, r.state])
          .sort();
      // DEPLOY's terminate, pinned whole: only a waiting request for ACCESS
      // EXCLUSIVE on this database's `auth_tokens`, so neither the dump nor a
      // granted lock is ever named.
      expect(operatorSql('SELECT a.pid, a.client_addr')).toBe(
        "SELECT a.pid, a.client_addr, pg_terminate_backend(a.pid) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE l.locktype = 'relation' AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND l.relation = 'public.auth_tokens'::regclass AND l.mode = 'AccessExclusiveLock' AND NOT l.granted;",
      );
      // Each row names the backend it ended.
      const terminate = async () =>
        (await pool.query(operatorSql('SELECT a.pid, a.client_addr'))).rows.map(
          (r: { pid: number; client_addr: string | null; pg_terminate_backend: boolean }) => [
            r.pid,
            r.client_addr !== null,
            r.pg_terminate_backend,
          ],
        );
      // A terminated backend leaves pg_locks only once it has exited.
      const gone = (pid: number) =>
        until(
          async () =>
            (await pool.query('SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1', [pid]))
              .rows[0].n,
          0,
        );
      let second: Promise<unknown> | undefined;
      let third: Promise<unknown> | undefined;
      try {
        const tables = await everyTable();
        expect(tables.length).toBeGreaterThan(100);
        const outcomes: unknown[] = [];
        const seen = await bootBehind(tables, {
          mayFail: true,
          during: async ({ pid, holderPid }, boot) => {
            // DEPLOY's quiet check sees the dump-shaped holder idle in its
            // transaction and the waiting boot, and no idle session.
            const idle = await pool.connect();
            try {
              expect(await quiet()).toEqual([
                ['', 'active'],
                ['pg_dump', 'idle in transaction'],
              ]);
            } finally {
              idle.release();
            }
            // A second realm, still running, queues on the advisory lock behind
            // the waiting boot, and a third one, stopped, queues there too.
            second = db.ensureSchema().catch((error: unknown) => error);
            expect(await until(advisory, ['granted', 'waiting'])).toEqual(['granted', 'waiting']);
            third = db.ensureSchema().catch((error: unknown) => error);
            expect(await until(advisory, ['granted', 'waiting', 'waiting'])).toEqual([
              'granted',
              'waiting',
              'waiting',
            ]);
            const clients = bootClients(spy);
            expect(clients).toHaveLength(3);
            const [first, running, stopped] = clients;
            stop(stopped.client);
            // Stopping the waiting boot's realm leaves its backend in the queue.
            stop(first.client);
            outcomes.push(await boot);
            await sleep(300);
            expect((await waiter(holderPid)).pid).toBe(pid);
            expect(await tokenRead()).toBe('57014');
            // DEPLOY's statement ends it, naming it; the running realm's boot
            // takes its place, and the stopped one still waits behind that.
            expect(await terminate()).toEqual([[pid, true, true]]);
            expect(await gone(pid)).toBe(0);
            const next = await waiter(holderPid);
            expect(next).toMatchObject({
              pid: (running.client as { processID: number }).processID,
              rel: 'auth_tokens',
              mode: 'AccessExclusiveLock',
            });
            expect(await advisory()).toEqual(['granted', 'waiting']);
            // So it is stopped and ended too; the stopped third boot exits once
            // it gets the advisory lock, and the next run names nothing.
            stop(running.client);
            outcomes.push(await second);
            expect(await terminate()).toEqual([[next.pid, true, true]]);
            outcomes.push(await third);
            expect(await gone(next.pid)).toBe(0);
            expect(await until(advisory, [])).toEqual([]);
            expect(await terminate()).toEqual([]);
            // The queue is released, and the dump-shaped holder was spared.
            expect(await tokenRead()).toBe('ran');
            const holderState = await pool.query(
              'SELECT state FROM pg_stat_activity WHERE pid = $1',
              [holderPid],
            );
            expect(holderState.rows).toEqual([{ state: 'idle in transaction' }]);
          },
        });
        expect(seen).toEqual({
          on: 'auth_tokens',
          waits: 'AccessExclusiveLock',
          held: ['auth_tokens ShareLock'],
        });
        expect(outcomes).toHaveLength(3);
        for (const outcome of outcomes) expect(outcome).toBeInstanceOf(Error);
        // With the hold gone and nothing open, the quiet check is quiet.
        expect(await quiet()).toEqual([]);
      } finally {
        spy.mockRestore();
        await Promise.allSettled([second, third]);
      }
      // Booted again after the dump, the realm comes up.
      await db.ensureSchema();
    });

    it("DEPLOY's sign-out ends every live token and pending OAuth code", async () => {
      const accountId = await makeAccount();
      const hex = () => randomUUID().replaceAll('-', '');
      const full = hex().repeat(2);
      const read = hex().repeat(2);
      await db.saveToken(full, accountId);
      await db.saveToken(read, accountId, 24, 'read');
      expect(await db.accountAndScopeForToken(full)).toEqual({ accountId, scope: 'full' });
      expect(await db.accountAndScopeForToken(read)).toEqual({ accountId, scope: 'read' });
      // A pending authorization code and a pending device code, each able to
      // mint a token after the sign-out if it survived it.
      const oauth = await import('../../server/oauth_db');
      const clientId = `fmverify_${hex()}`;
      await oauth.upsertOAuthClient(pool, clientId, 'verify', ['https://example.test/cb']);
      const code = hex();
      await oauth.createAuthCode(pool, {
        code,
        clientId,
        accountId,
        redirectUri: 'https://example.test/cb',
        codeChallenge: hex(),
        codeChallengeMethod: 'S256',
        scope: 'character:read',
        ttlSeconds: 300,
      });
      await oauth.createDeviceCode(pool, {
        deviceCode: hex(),
        userCode: hex().slice(0, 8),
        clientId,
        scope: 'character:read',
        ttlSeconds: 300,
      });
      // A Discord link and a GitHub link a leftover token started: each
      // callback needs no bearer.
      await pool.query(
        `INSERT INTO discord_oauth_states (state, code_verifier, mode, account_id, expires_at)
         VALUES ($1, $2, 'link', $3, now() + interval '10 minutes')`,
        [hex(), hex(), accountId],
      );
      await pool.query(
        `INSERT INTO github_oauth_states (state, account_id, expires_at)
         VALUES ($1, $2, now() + interval '10 minutes')`,
        [hex(), accountId],
      );
      const count = async (table: string) =>
        (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
      expect(await count('oauth_codes')).toBe(1);
      expect(await count('oauth_device_codes')).toBe(1);
      expect(await count('discord_oauth_states')).toBe(1);
      expect(await count('github_oauth_states')).toBe(1);
      // DEPLOY's check that the sign-out committed, pinned whole with its
      // wording: a sign-out still open in its own session reads 0 there and
      // the full count from a new session, which reads 0 once it commits. A
      // realm still running can sign in after it, which only running the
      // sign-out again ends, and a rerun that waits on an earlier sign-out
      // left open elsewhere is named by DEPLOY's naming statement.
      const signedOut = operatorSql('SELECT (SELECT count(*) FROM auth_tokens');
      expect(signedOut).toBe(
        'SELECT (SELECT count(*) FROM auth_tokens WHERE expires_at > now()) + (SELECT count(*) FROM oauth_codes) + (SELECT count(*) FROM oauth_device_codes) + (SELECT count(*) FROM discord_oauth_states) + (SELECT count(*) FROM github_oauth_states) AS left;',
      );
      expect(bootBullet()).toContain(
        'then from a new psql session `SELECT (SELECT count(*) FROM auth_tokens',
      );
      expect(bootBullet()).toContain(
        "returns 0 while `sudo docker compose ps --all` shows every realm container on the database `Exited` (else it has not committed, or a realm on the database still runs: COMMIT in the sign-out's own session a transaction still open there (its psql prompt then shows `*` or `!`), stop every realm still running, run the sign-out again in psql's default autocommit either way, then read both again, the count from a new psql session; a rerun that does not return waits on an earlier sign-out still open in another session, which the naming statement under Index builds below, given the rerun's pid (`SELECT pg_backend_pid();` in its session before it), names, and the rule there ends)",
      );
      const { Client } = await import('pg');
      const { materialSourceConnection } = await import('../../server/material_source_connection');
      const session = () => {
        const client = new Client({ ...materialSourceConnection(verifyUrl(ADMIN_URL)) });
        client.on('error', () => {});
        return client;
      };
      const signOut = operatorSql('DELETE FROM auth_tokens');
      const signer = session();
      const fresh = session();
      const holder = session();
      let open = false;
      try {
        await signer.connect();
        await fresh.connect();
        await holder.connect();
        const leftOn = async (client: typeof signer) =>
          Number((await client.query(signedOut)).rows[0].left);
        const before = await leftOn(fresh);
        expect(before).toBeGreaterThan(0);
        await signer.query('BEGIN');
        open = true;
        await signer.query(signOut);
        expect(await leftOn(signer)).toBe(0);
        expect(await leftOn(fresh)).toBe(before);
        await signer.query('COMMIT');
        open = false;
        expect(await leftOn(fresh)).toBe(0);
        // A realm missed by the stop signs a player in after the sign-out
        // committed: a COMMIT with no transaction open changes nothing, and
        // the sign-out run again in autocommit ends the new token.
        const late = hex().repeat(2);
        await db.saveToken(late, accountId);
        expect(await leftOn(fresh)).toBe(1);
        await signer.query('COMMIT');
        expect(await leftOn(fresh)).toBe(1);
        await signer.query(signOut);
        expect(await leftOn(fresh)).toBe(0);
        expect(await db.accountAndScopeForToken(late)).toBeNull();
        // An earlier sign-out left open in an operator's psql session holds
        // the rows a rerun deletes: the rerun waits on it, the naming
        // statement given the rerun's pid names that session, and ending it
        // lets the rerun delete them.
        const stale = hex().repeat(2);
        await db.saveToken(stale, accountId);
        await holder.query("SET application_name = 'psql'");
        await holder.query('BEGIN');
        await holder.query(signOut);
        const holderPid = (holder as unknown as { processID: number }).processID;
        const rerunPid: number = (await signer.query('SELECT pg_backend_pid() AS p')).rows[0].p;
        const rerun = signer.query(signOut).then(
          () => 'ran',
          (error: { code?: string }) => error.code,
        );
        const waitOf = async () =>
          (await pool.query('SELECT wait_event FROM pg_stat_activity WHERE pid = $1', [rerunPid]))
            .rows[0]?.wait_event;
        expect(await until(waitOf, 'transactionid')).toBe('transactionid');
        const named = await pool.query(
          operatorSql('SELECT pid, application_name, state').replace('<pid>', String(rerunPid)),
        );
        expect(
          named.rows.map((r: { pid: number; application_name: string; state: string }) => ({
            pid: r.pid,
            application_name: r.application_name,
            state: r.state,
          })),
        ).toEqual([{ pid: holderPid, application_name: 'psql', state: 'idle in transaction' }]);
        await pool.query(
          operatorSql('SELECT pg_terminate_backend(').replace('<pid>', String(holderPid)),
        );
        expect(await rerun).toBe('ran');
        expect(await leftOn(fresh)).toBe(0);
        expect(await db.accountAndScopeForToken(stale)).toBeNull();
      } finally {
        if (open) await signer.query('ROLLBACK').catch(() => {});
        await signer.end().catch(() => {});
        await fresh.end().catch(() => {});
        await holder.end().catch(() => {});
      }
      expect(await db.accountAndScopeForToken(full)).toBeNull();
      expect(await db.accountAndScopeForToken(read)).toBeNull();
      expect(await count('auth_tokens WHERE expires_at > now()')).toBe(0);
      expect(await count('oauth_codes')).toBe(0);
      expect(await count('oauth_device_codes')).toBe(0);
      expect(await count('discord_oauth_states')).toBe(0);
      expect(await count('github_oauth_states')).toBe(0);
      expect(await oauth.consumeAuthCode(pool, code)).toBeNull();
      // Every table with a secret-shaped column (a token, secret, verifier,
      // nonce, challenge, code, hash or state), whole: the sign-out clears it,
      // or it is no credential a bearer alone can trade for a token. A new
      // such column fails here until its table is classified; a credential
      // kept under another column name is beyond this pin.
      const secretShaped = await pool.query(
        `SELECT table_name AS t FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name ~ '(token|secret|verifier|nonce|challenge|(^|_)code(_hash)?$|_hash$|(^|_)state$)'
          GROUP BY table_name ORDER BY 1`,
      );
      expect(secretShaped.rows.map((r: { t: string }) => r.t)).toEqual([
        'account_freehold_hearth', // an advance token: a save's idempotency key
        'account_totp_recovery', // spent only at a login that already proved the password
        'accounts', // its own password, second factor and an unsubscribe token that mints nothing (below)
        'apple_pending_logins', // a provider identity: linking one needs the account password
        'auth_tokens', // signed out
        'character_leases', // a realm's lease fence
        'characters', // game state
        'discord_oauth_states', // signed out: a link row's callback needs no bearer
        'discord_pending_logins', // as Apple's
        'email_change_requests', // creating one needs the account password; verifying mints no token
        'freehold_plot_claims', // a claim's write fence
        'github_oauth_states', // signed out: a link row's callback needs no bearer
        'oauth_codes', // signed out
        'oauth_device_codes', // signed out
        'password_reset_requests', // created and redeemed by email
        'site_presence_sessions', // analytics hashes
        'storage_purchases', // a purchase's spend claim
        'wallet_link_challenges', // spent only with a live bearer, and a wallet link signs nobody in
        'woc_market_bids', // market state
        'woc_market_settlements', // market state
        'woc_market_stepup_challenges', // needs a wallet signature
      ]);
      // The desktop login codes live in the realm process alone, so stopping
      // the realms drops them and the sign-out need not.
      const desktop = readFileSync('server/desktop_login.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const touchesDatabase = /\bquery\(|\bpool\b/;
      expect('await pool.query(sql)').toMatch(touchesDatabase);
      expect(desktop.match(/new Map</g)).toHaveLength(1);
      expect(desktop).not.toMatch(touchesDatabase);
      // Its static imports, whole, and no dynamic import or require: a store
      // reached through a new module would show here (one behind ./auth would
      // not, a boundary of this pin).
      const loadsAtRuntime = /\bimport\s*\(|\brequire\s*\(|\bcreateRequire\b/;
      expect("await import('./db')").toMatch(loadsAtRuntime);
      expect('const load = createRequire(import.meta.url);').toMatch(loadsAtRuntime);
      expect(desktop).not.toMatch(loadsAtRuntime);
      expect(desktop.match(/from '[^']+'/g)).toEqual([
        "from 'node:crypto'",
        "from 'node:http'",
        "from './auth'",
        "from './ratelimit'",
      ]);
      // The unsubscribe token mints nothing: its handler and the two
      // statements it runs, whole, read the account by the token, turn
      // marketing mail off, and answer ok.
      const wholeFunction = (file: string, name: string) => {
        const source = readFileSync(file, 'utf8');
        const at = source.indexOf(`export async function ${name}(`);
        expect(at, name).toBeGreaterThan(-1);
        return source.slice(at, source.indexOf('\n}\n', at) + 2).replace(/\s+/g, ' ');
      };
      expect(wholeFunction('server/db.ts', 'accountByUnsubscribeToken')).toBe(
        "export async function accountByUnsubscribeToken(token: string): Promise<number | null> { const res = await pool.query('SELECT id FROM accounts WHERE unsubscribe_token = $1', [token]); return res.rows[0]?.id ?? null; }",
      );
      expect(wholeFunction('server/db.ts', 'setAccountMarketingOptIn')).toBe(
        "export async function setAccountMarketingOptIn(accountId: number, optIn: boolean): Promise<void> { await pool.query('UPDATE accounts SET marketing_opt_in = $2 WHERE id = $1', [accountId, optIn]); }",
      );
      expect(wholeFunction('server/account.ts', 'handleEmailUnsubscribe')).toBe(
        "export async function handleEmailUnsubscribe( res: http.ServerResponse, token: string, ): Promise<void> { const raw = typeof token === 'string' ? token.trim() : ''; if (raw) { const accountId = await accountByUnsubscribeToken(raw); if (accountId !== null) await setAccountMarketingOptIn(accountId, false); } return json(res, 200, { ok: true }); }",
      );
      // The stall's remedy points at DEPLOY's receipt-erase repair by its
      // opening words, and that bullet exists once, below it.
      const opening = /begins "([^"]+)"/.exec(bootBullet())?.[1];
      expect(opening).toBe('A failed deactivation receipt erase');
      const deploy = readFileSync('DEPLOY.md', 'utf8').replace(/\s+/g, ' ');
      expect(deploy.split(`- ${opening}`)).toHaveLength(2);
      expect(deploy.indexOf(`- ${opening}`)).toBeGreaterThan(
        deploy.indexOf('- EVERY BOOT LOCKS THE PARENTS'),
      );
    });

    it('a boot or a runner waiting on the schema advisory lock deadlocks with an index build under it', async () => {
      const { CONCURRENT_INDEX_MIGRATIONS } = await import('../../server/concurrent_indexes');
      const migration = CONCURRENT_INDEX_MIGRATIONS.find(
        (m) => m.name === 'guilds_realm_created_id',
      );
      if (migration === undefined) throw new Error('the guilds_realm_created_id migration is gone');
      // The runner takes the boot's key with the blocking session lock before
      // its first build and lets it go after the receipts VALIDATE; the case
      // below plays it by hand with the same statement.
      const runnerSource = readFileSync('server/concurrent_index_runner.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const acquire = runnerSource.indexOf(
        "await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);",
      );
      const loop = runnerSource.indexOf('for (const migration of CONCURRENT_INDEX_MIGRATIONS)');
      const validate = runnerSource.indexOf(
        'await validateBankLedgerBatchReceiptsKeyShape(client);',
      );
      const release = runnerSource.indexOf("'SELECT pg_advisory_unlock($1)'");
      expect(acquire).toBeGreaterThan(-1);
      expect(loop).toBeGreaterThan(acquire);
      expect(validate).toBeGreaterThan(loop);
      expect(release).toBeGreaterThan(validate);
      const { SCHEMA_ADVISORY_LOCK_KEY } = await import('../../server/db_boot_connection');
      expect(SCHEMA_ADVISORY_LOCK_KEY).toBe(0x57_4f_43_01);
      const valid = async () =>
        (
          await pool.query(
            'SELECT i.indisvalid AS v FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1',
            [migration.name],
          )
        ).rows.map((r: { v: boolean }) => r.v);
      // DEPLOY's gate before a realm starts: any holder or waiter of the
      // schema advisory lock in this database; its diagnosis lists them.
      const gate = async () =>
        Number(
          (
            await pool.query(
              operatorSql("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'"),
            )
          ).rows[0].count,
        );
      const diagnosis = async () =>
        (await pool.query(operatorSql('SELECT l.pid, l.granted'))).rows
          .map((r: { granted: boolean }) => r.granted)
          .sort();
      const progress = async () =>
        Number(
          (
            await pool.query(
              'SELECT count(*) AS n FROM pg_stat_progress_create_index WHERE datname = current_database()',
            )
          ).rows[0].n,
        );
      // The deadlock check's delay, in milliseconds (pg_settings keeps it in ms).
      const timeoutMs = Number(
        (await pool.query("SELECT setting FROM pg_settings WHERE name = 'deadlock_timeout'"))
          .rows[0].setting,
      );
      expect(timeoutMs).toBeGreaterThan(0);
      expect(await gate()).toBe(0);
      // One order: the runner holds the lock, the waiter (a boot in its
      // transaction, or another runner outside one) queues on it, and after
      // `delayMs` the build starts. Returns the side that was aborted.
      const round = async (waiterSql: string, inTransaction: boolean, delayMs: number) => {
        await pool.query(`DROP INDEX IF EXISTS ${migration.name}`);
        const runner = await pool.connect();
        let waiting: PoolClient | undefined;
        try {
          waiting = await pool.connect();
          const waiter = waiting;
          await runner.query('SELECT pg_advisory_lock($1)', [0x57_4f_43_01]);
          if (inTransaction) await waiter.query('BEGIN');
          const waited = waiter.query(waiterSql, [0x57_4f_43_01]).then(
            () => 'granted',
            (error: { code?: string }) => error.code,
          );
          expect(await until(advisory, ['granted', 'waiting'])).toEqual(['granted', 'waiting']);
          // The gate and its diagnosis read the holder and the waiter; the
          // progress view reads 0, no build having started.
          expect(await gate()).toBe(2);
          expect(await diagnosis()).toEqual([false, true]);
          expect(await progress()).toBe(0);
          if (delayMs > 0) await sleep(delayMs);
          const build = runner.query(migration.createSql).then(
            () => 'built',
            (error: { code?: string }) => error.code,
          );
          const first = await Promise.race([
            build.then((r) => ({ by: 'build', r })),
            waited.then((r) => ({ by: 'waiter', r })),
          ]);
          expect(first.r).toBe('40P01');
          if (first.by === 'waiter') {
            if (inTransaction) await waiter.query('ROLLBACK');
            expect(await build).toBe('built');
            expect(await valid()).toEqual([true]);
          } else {
            // The aborted build leaves its index INVALID.
            expect(await valid()).toEqual([false]);
            await runner.query('SELECT pg_advisory_unlock($1)', [0x57_4f_43_01]);
            expect(await waited).toBe('granted');
          }
          return first.by;
        } finally {
          // The runner's lock first: a waiter's ROLLBACK queues behind its lock wait.
          await runner.query('SELECT pg_advisory_unlock_all()').catch(() => {});
          if (waiting !== undefined) {
            if (inTransaction) await waiting.query('ROLLBACK').catch(() => {});
            await waiting.query('SELECT pg_advisory_unlock_all()').catch(() => {});
            waiting.release();
          }
          runner.release();
        }
      };
      // A quick order is a race on a loaded host (the build must reach its
      // last wait inside the waiter's one check), so it gets one retry, and
      // both quick orders needing theirs fails.
      let retried = 0;
      const quick = async (waiterSql: string, inTransaction: boolean) => {
        if ((await round(waiterSql, inTransaction, 0)) === 'waiter') return 'waiter';
        retried += 1;
        return round(waiterSql, inTransaction, 0);
      };
      const late = timeoutMs + 500;
      const oldSnapshotWaits = async () =>
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM pg_stat_progress_create_index WHERE datname = current_database() AND phase LIKE 'waiting for old snapshots%'",
          )
        ).rows[0].n;
      // A realm's runner building the index on its own client, held at its
      // wait for old snapshots by an operator's psql session left open: by
      // default a REPEATABLE READ one (the kind of snapshot the nightly dump
      // also holds), else a READ COMMITTED one whose statement is still
      // running when the wait begins, until `finish` lets it end. `then` runs
      // at that wait, and `stop` closes the realm's socket as its stop or
      // crash would. The sessions are dedicated clients, since any may be ended.
      const { Client } = await import('pg');
      const { materialSourceConnection } = await import('../../server/material_source_connection');
      const dedicated = () => {
        const client = new Client({ ...materialSourceConnection(verifyUrl(ADMIN_URL)) });
        client.on('error', () => {});
        return client;
      };
      const psqlSession = async (isolation = 'REPEATABLE READ') => {
        const client = dedicated();
        try {
          await client.connect();
          await client.query("SET application_name = 'psql'");
          await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          const pid: number = (await client.query('SELECT pg_backend_pid() AS p')).rows[0].p;
          return { client, pid };
        } catch (error) {
          await client.end().catch(() => {});
          throw error;
        }
      };
      const waitEventOf = async (pid: number) =>
        (await pool.query('SELECT wait_event FROM pg_stat_activity WHERE pid = $1', [pid])).rows[0]
          ?.wait_event;
      const heldBuild = async (
        then: (build: {
          pid: number;
          snapshotPid: number;
          session: InstanceType<typeof Client>;
          stop: () => Promise<unknown>;
          finish: () => Promise<unknown>;
        }) => Promise<void>,
        running = false,
      ) => {
        await pool.query(`DROP INDEX IF EXISTS ${migration.name}`);
        const realm = dedicated();
        const gatekeeper = await pool.connect();
        let held: { client: InstanceType<typeof Client>; pid: number } | undefined;
        // The running statement waits on an advisory key of its own, so it
        // holds its snapshot until `finish` frees the key.
        const key = 0x52_32_38;
        let statement: Promise<unknown> = Promise.resolve();
        try {
          if (running) {
            await gatekeeper.query('SELECT pg_advisory_lock($1)', [key]);
            held = await psqlSession('READ COMMITTED');
            statement = held.client.query('SELECT pg_advisory_lock($1)', [key]).then(
              () => 'locked',
              (error: { code?: string }) => error.code,
            );
            const heldPid = held.pid;
            expect(await until(() => waitEventOf(heldPid), 'advisory')).toBe('advisory');
          } else {
            held = await psqlSession();
          }
          await realm.connect();
          await realm.query('SELECT pg_advisory_lock($1)', [0x57_4f_43_01]);
          const building = realm.query(migration.createSql).catch(() => 'stopped');
          expect(await until(oldSnapshotWaits, 1)).toBe(1);
          await then({
            pid: (realm as unknown as { processID: number }).processID,
            snapshotPid: held.pid,
            session: held.client,
            stop: () => {
              (
                realm as unknown as { connection: { stream: { destroy(): void } } }
              ).connection.stream.destroy();
              return building;
            },
            finish: async () => {
              await gatekeeper.query('SELECT pg_advisory_unlock($1)', [key]);
              expect(await statement).toBe('locked');
            },
          });
        } finally {
          await gatekeeper.query('SELECT pg_advisory_unlock_all()').catch(() => {});
          gatekeeper.release();
          await statement.catch(() => {});
          await held?.client.end().catch(() => {});
          await realm.end().catch(() => {});
        }
      };
      // DEPLOY's diagnosis, each row's columns that decide what to do, pinned whole.
      expect(operatorSql('SELECT l.pid, l.granted')).toBe(
        "SELECT l.pid, l.granted, a.wait_event_type, a.wait_event, p.phase, pg_blocking_pids(l.pid) AS blocked_by, now() - a.query_start AS waited FROM pg_locks l JOIN pg_stat_activity a USING (pid) LEFT JOIN pg_stat_progress_create_index p USING (pid) WHERE l.locktype = 'advisory' AND l.classid = 0 AND l.objid = 1464812289 AND l.objsubid = 1 AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database());",
      );
      const decides = async () =>
        (await pool.query(operatorSql('SELECT l.pid, l.granted'))).rows.map(
          (r: Record<string, unknown>) => ({
            pid: r.pid,
            granted: r.granted,
            wait_event_type: r.wait_event_type,
            wait_event: r.wait_event,
            phase: r.phase,
            blocked_by: r.blocked_by,
          }),
        );
      // DEPLOY's statements that name and end sessions, each pinned whole.
      const named = operatorSql('SELECT pid, application_name, state');
      expect(named).toBe(
        'SELECT pid, application_name, state, now() - xact_start AS open_for, now() - state_change AS idle_for FROM pg_stat_activity WHERE pid = ANY(pg_blocking_pids(<pid>));',
      );
      const terminate = operatorSql('SELECT pg_terminate_backend(');
      expect(terminate).toBe('SELECT pg_terminate_backend(<pid>);');
      const cancel = operatorSql('SELECT pg_cancel_backend(');
      expect(cancel).toBe('SELECT pg_cancel_backend(<pid>);');
      const listing = operatorSql('SELECT indexrelid::regclass AS name');
      expect(listing).toBe(
        'SELECT indexrelid::regclass AS name FROM pg_index WHERE NOT indisvalid;',
      );
      const drop = operatorSql('DROP INDEX CONCURRENTLY IF EXISTS');
      expect(drop).toBe('DROP INDEX CONCURRENTLY IF EXISTS <name>;');
      const sessionsOf = async (pid: number) =>
        (await pool.query(named.replace('<pid>', String(pid)))).rows.map(
          (r: { pid: number; application_name: string; state: string }) => ({
            pid: r.pid,
            application_name: r.application_name,
            state: r.state,
          }),
        );
      const ready = async () =>
        (
          await pool.query(
            'SELECT i.indisready AS r FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1',
            [migration.name],
          )
        ).rows.map((r: { r: boolean }) => r.r);
      const { CONCURRENT_INDEX_MIGRATIONS: registry } = await import(
        '../../server/concurrent_indexes'
      );
      const registryOids = async () =>
        (
          await pool.query(
            'SELECT relname, oid::text AS oid FROM pg_class WHERE relname = ANY($1) ORDER BY 1',
            [registry.map((m) => m.name)],
          )
        ).rows;
      let done = false;
      try {
        // Which side loses turns on timing alone, whichever kind of waiter:
        // already waiting when a quick build reaches its last wait, the waiter
        // loses; past its one check before the build waits, the build loses.
        expect(await quick('SELECT pg_advisory_xact_lock($1)', true)).toBe('waiter');
        expect(await quick('SELECT pg_advisory_lock($1)', false)).toBe('waiter');
        expect(await round('SELECT pg_advisory_xact_lock($1)', true, late)).toBe('build');
        expect(await round('SELECT pg_advisory_lock($1)', false, late)).toBe('build');
        expect(retried).toBeLessThan(2);
        // The build that lost left its index INVALID; the next runner drops
        // it and builds it again. A run with nothing to build then builds
        // nothing (every registry index keeps its oid) and is quick.
        expect(await valid()).toEqual([false]);
        expect(await until(gate, 0)).toBe(0);
        await db.runConcurrentIndexMigrations();
        expect(await valid()).toEqual([true]);
        const built = await registryOids();
        expect(built).toHaveLength(registry.length);
        const nothingToBuild = Date.now();
        await db.runConcurrentIndexMigrations();
        expect(Date.now() - nothingToBuild).toBeLessThan(1_000);
        expect(await registryOids()).toEqual(built);
        // A realm's stop does not end its build: the diagnosis names the build,
        // its wait and one session it waits for, of two open psql sessions (an
        // idle READ COMMITTED transaction beside them holds no snapshot and is
        // never named); with the check on the socket off, the build still
        // holds the lock after its socket closes. The named session's
        // `idle_for` grows by the time between two readings and starts over
        // once it runs a statement; a cancel leaves it as it was; DEPLOY's
        // terminate ends it, the naming statement then names the other, and
        // once that is ended the build ends, valid.
        const idle = await pool.connect();
        let second: Awaited<ReturnType<typeof psqlSession>> | undefined;
        try {
          second = await psqlSession();
          const other = second;
          await idle.query('BEGIN');
          await idle.query('SELECT 1');
          await heldBuild(async ({ pid, snapshotPid, session, stop }) => {
            const rows = await decides();
            expect(rows).toHaveLength(1);
            const { blocked_by: first, ...holder } = rows[0];
            expect(holder).toEqual({
              pid,
              granted: true,
              wait_event_type: 'Lock',
              wait_event: 'virtualxid',
              phase: 'waiting for old snapshots',
            });
            expect([[snapshotPid], [other.pid]]).toContainEqual(first);
            const firstPid = (first as number[])[0];
            const nextPid = firstPid === snapshotPid ? other.pid : snapshotPid;
            expect(
              (await pool.query('SHOW client_connection_check_interval')).rows[0]
                .client_connection_check_interval,
            ).toBe('0');
            expect(await stop()).toBe('stopped');
            await sleep(300);
            expect(await gate()).toBe(1);
            // DEPLOY's naming statement for that session: its `idle_for` and
            // `open_for` in seconds, and the exact gap between them (when its
            // last statement ended, after its transaction began).
            const reading = async () => {
              const row = (
                await pool.query(
                  `SELECT EXTRACT(EPOCH FROM n.idle_for) AS idle, EXTRACT(EPOCH FROM n.open_for) AS open, EXTRACT(EPOCH FROM n.open_for - n.idle_for)::text AS gap FROM (${named
                    .replace('<pid>', String(pid))
                    .replace(/;$/, '')}) n WHERE n.pid = $1`,
                  [firstPid],
                )
              ).rows[0];
              return { idle: Number(row.idle), open: Number(row.open), gap: String(row.gap) };
            };
            // Left open, it grows by exactly as much as its transaction did,
            // as DEPLOY's rule reads.
            expect(bootBullet()).toContain(
              "taken in psql's default autocommit, its `open_for` grown by those seconds and its `open_for` less its `idle_for` the same on both (the same transaction, and it ran no statement in between): an operator's session left open.",
            );
            const before = await reading();
            await sleep(300);
            const after = await reading();
            expect(after.open - before.open).toBeGreaterThanOrEqual(0.25);
            expect(after.gap).toBe(before.gap);
            // Once it runs a statement, it starts over and the gap moves. A
            // statement leaves the build waiting on it: a virtualxid wait lasts
            // until the transaction ends.
            await (firstPid === other.pid ? other.client : session).query('SELECT 1');
            const reset = await reading();
            expect(reset.idle).toBeGreaterThan(0);
            expect(reset.idle).toBeLessThan(before.idle);
            expect(Number(reset.gap)).toBeGreaterThan(Number(after.gap));
            await pool.query(cancel.replace('<pid>', String(firstPid)));
            await sleep(200);
            expect(await sessionsOf(pid)).toEqual([
              { pid: firstPid, application_name: 'psql', state: 'idle in transaction' },
            ]);
            expect(await gate()).toBe(1);
            await pool.query(terminate.replace('<pid>', String(firstPid)));
            const namedPids = async () => (await sessionsOf(pid)).map((row) => row.pid);
            expect(await until(namedPids, [nextPid])).toEqual([nextPid]);
            await pool.query(terminate.replace('<pid>', String(nextPid)));
            expect(await until(gate, 0)).toBe(0);
            expect(await valid()).toEqual([true]);
          });
        } finally {
          await idle.query('ROLLBACK').catch(() => {});
          idle.release();
          await second?.client.end().catch(() => {});
        }
        // A READ COMMITTED session whose statement was running when the wait
        // began can be waited for until its transaction ends, idle or not
        // (here its snapshot is the only old one, so the wait reaches it while
        // it runs): once its statement ends the naming statement still names
        // it, and the build ends only after DEPLOY's terminate.
        await heldBuild(async ({ pid, snapshotPid, stop, finish }) => {
          await finish();
          expect(await sessionsOf(pid)).toEqual([
            { pid: snapshotPid, application_name: 'psql', state: 'idle in transaction' },
          ]);
          expect(await stop()).toBe('stopped');
          await pool.query(terminate.replace('<pid>', String(snapshotPid)));
          expect(await until(gate, 0)).toBe(0);
          expect(await valid()).toEqual([true]);
        }, true);
        // DEPLOY's cancel ends a stopped realm's build at once: the lock is
        // free and the index INVALID, past `building index` so writes keep it
        // up. After a rollback no runner names it: DEPLOY's listing finds it.
        await heldBuild(async ({ pid, stop }) => {
          expect(await stop()).toBe('stopped');
          const holders = (await decides()).filter((row) => row.granted).map((row) => row.pid);
          expect(holders).toEqual([pid]);
          await pool.query(cancel.replace('<pid>', String(holders[0])));
          expect(await until(gate, 0)).toBe(0);
          expect(await valid()).toEqual([false]);
          expect(await ready()).toEqual([true]);
        });
        expect((await pool.query(listing)).rows.map((r: { name: string }) => r.name)).toEqual([
          migration.name,
        ]);
        // DEPLOY's drop by hand: the gate does not see it, and while it does
        // not return DEPLOY's lookup from another session gives its pid, with
        // which the naming statement names the session it waits for, an
        // operator's open psql one, which DEPLOY's terminate ends; the drop
        // then returns, and a runner that names the index builds it again.
        const lookup = operatorSql('SELECT pid FROM pg_stat_activity');
        expect(lookup).toBe(
          "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'psql' AND state = 'active' AND query LIKE 'DROP INDEX CONCURRENTLY%';",
        );
        expect(bootBullet()).toContain(
          "'DROP INDEX CONCURRENTLY%';` from another psql session on the realm database gives the drop's pid",
        );
        let reader: Awaited<ReturnType<typeof psqlSession>> | undefined;
        const hand = dedicated();
        try {
          reader = await psqlSession('READ COMMITTED');
          const open = reader;
          await open.client.query('SELECT 1 FROM guilds LIMIT 1');
          await hand.connect();
          await hand.query("SET application_name = 'psql'");
          const dropped = hand.query(drop.replace('<name>', migration.name)).then(
            () => 'dropped',
            (error: { code?: string }) => error.code,
          );
          const handPid = (hand as unknown as { processID: number }).processID;
          const looked = async () =>
            (await pool.query(lookup)).rows.map((r: { pid: number }) => r.pid);
          const found = await until(looked, [handPid]);
          expect(found).toEqual([handPid]);
          // Run on another database of the server, the lookup finds no drop.
          const elsewhere = new Client({ ...materialSourceConnection(ADMIN_URL) });
          elsewhere.on('error', () => {});
          try {
            await elsewhere.connect();
            expect((await elsewhere.query('SELECT current_database() AS d')).rows[0].d).not.toBe(
              (await pool.query('SELECT current_database() AS d')).rows[0].d,
            );
            expect((await elsewhere.query(lookup)).rows).toEqual([]);
          } finally {
            await elsewhere.end().catch(() => {});
          }
          const [dropPid] = found;
          expect(await until(() => waitEventOf(dropPid), 'virtualxid')).toBe('virtualxid');
          expect(await gate()).toBe(0);
          expect(await sessionsOf(dropPid)).toEqual([
            { pid: open.pid, application_name: 'psql', state: 'idle in transaction' },
          ]);
          await pool.query(terminate.replace('<pid>', String(open.pid)));
          expect(await dropped).toBe('dropped');
        } finally {
          await reader?.client.end().catch(() => {});
          await hand.end().catch(() => {});
        }
        expect(await valid()).toEqual([]);
        await db.runConcurrentIndexMigrations();
        expect(await valid()).toEqual([true]);
        // A serving realm's runner frees the lock too: DEPLOY's cancel ends its
        // build, and the runner unlocks in its finally and rejects (its realm
        // logs it and keeps serving), the old snapshot still open. A realm's
        // own sessions never read `psql`: neither the runner's nor its pool's.
        await pool.query(`DROP INDEX IF EXISTS ${migration.name}`);
        const open = await pool.connect();
        try {
          await open.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
          await open.query('SELECT 1');
          const running = db.runConcurrentIndexMigrations().then(
            () => 'finished',
            (error: { code?: string }) => error.code,
          );
          expect(await until(oldSnapshotWaits, 1)).toBe(1);
          const holders = (await decides()).filter((row) => row.granted).map((row) => row.pid);
          expect(holders).toHaveLength(1);
          expect(
            (
              await pool.query('SELECT application_name FROM pg_stat_activity WHERE pid = $1', [
                holders[0],
              ])
            ).rows[0].application_name,
          ).toBe('');
          expect(
            (await db.pool.query("SELECT current_setting('application_name') AS a")).rows[0].a,
          ).toBe('');
          await pool.query(cancel.replace('<pid>', String(holders[0])));
          expect(await running).toBe('57014');
          expect(await gate()).toBe(0);
          expect(await valid()).toEqual([false]);
        } finally {
          await open.query('ROLLBACK').catch(() => {});
          open.release();
        }
        // A runner's drop of that INVALID index waits on `virtualxid` with a
        // null `phase`, for each session holding any lock on its table.
        const locker = await pool.connect();
        const dropper = dedicated();
        let dropping: Promise<unknown> | undefined;
        try {
          await locker.query('BEGIN');
          await locker.query('SELECT 1 FROM guilds LIMIT 1');
          const lockerPid = (await locker.query('SELECT pg_backend_pid() AS p')).rows[0].p;
          await dropper.connect();
          await dropper.query('SELECT pg_advisory_lock($1)', [0x57_4f_43_01]);
          dropping = dropper.query(migration.dropSql);
          const dropperPid = (dropper as unknown as { processID: number }).processID;
          const waiting = async () => (await decides()).map((row) => `${row.wait_event}`).join(',');
          expect(await until(waiting, 'virtualxid')).toBe('virtualxid');
          expect(await decides()).toEqual([
            {
              pid: dropperPid,
              granted: true,
              wait_event_type: 'Lock',
              wait_event: 'virtualxid',
              phase: null,
              blocked_by: [lockerPid],
            },
          ]);
          // DEPLOY's hand-drop lookup leaves this runner's drop out, though the
          // same lookup without its `psql` scope finds it.
          expect((await pool.query(lookup)).rows).toEqual([]);
          expect(
            (
              await pool.query(
                "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND query LIKE 'DROP INDEX CONCURRENTLY%'",
              )
            ).rows.map((r: { pid: number }) => r.pid),
          ).toEqual([dropperPid]);
          await locker.query('COMMIT');
          await dropping;
          await dropper.query('SELECT pg_advisory_unlock($1)', [0x57_4f_43_01]);
          expect(await valid()).toEqual([]);
        } finally {
          await locker.query('ROLLBACK').catch(() => {});
          locker.release();
          await dropping?.catch(() => {});
          await dropper.end().catch(() => {});
        }
        // A build ended before `building index` is done leaves its index
        // INVALID and not ready (no write keeps it up), and one still queued
        // for its table lock leaves none.
        const cancelledWhile = async (
          holdMode: string,
          reached: (pid: number) => Promise<boolean>,
        ) => {
          await pool.query(`DROP INDEX IF EXISTS ${migration.name}`);
          const holder = await pool.connect();
          const builder = dedicated();
          try {
            await holder.query('BEGIN');
            await holder.query(`LOCK TABLE guilds IN ${holdMode} MODE`);
            await builder.connect();
            const builderPid = (builder as unknown as { processID: number }).processID;
            const building = builder.query(migration.createSql).then(
              () => 'built',
              (error: { code?: string }) => error.code,
            );
            expect(await until(() => reached(builderPid), true)).toBe(true);
            await pool.query(cancel.replace('<pid>', String(builderPid)));
            expect(await building).toBe('57014');
          } finally {
            await holder.query('ROLLBACK').catch(() => {});
            holder.release();
            await builder.end().catch(() => {});
          }
        };
        await cancelledWhile(
          'ROW EXCLUSIVE',
          async (pid) =>
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM pg_stat_progress_create_index WHERE pid = $1 AND phase = $2',
                [pid, 'waiting for writers before build'],
              )
            ).rows[0].n === 1,
        );
        expect(await valid()).toEqual([false]);
        expect(await ready()).toEqual([false]);
        await cancelledWhile(
          'SHARE UPDATE EXCLUSIVE',
          async (pid) => (await waitEventOf(pid)) === 'relation',
        );
        expect(await valid()).toEqual([]);
        await db.runConcurrentIndexMigrations();
        done = true;
      } finally {
        // Cleanup after a failed order only: with the lock free, a runner
        // rebuilds whatever the order left (a lock still held would block it
        // for good, so the reads below fail instead).
        if (!done && (await until(gate, 0)) === 0) await db.runConcurrentIndexMigrations();
      }
      expect(await valid()).toEqual([true]);
      expect(await gate()).toBe(0);
    });
  });
});
