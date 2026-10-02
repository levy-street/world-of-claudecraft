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
// every fault of a bags-to-plot transfer, the ambiguous-COMMIT verify waiting on
// the character row, the two-realm Hearth race, the operation lifecycle and cap,
// the D88 parent-delete guard and receipt erasure, the legacy-effect
// interleaves, no client across the prepare, and the export allowlist). The
// nearest suites do not pin it: tests/server/freehold_mutation.test.ts drives
// the same decisions with fakes (no transaction to roll back, no row to wait
// on), tests/server/freehold_hearth_db.pg.test.ts and
// tests/server/freehold_db.pg.test.ts prove the Hearth and plot statements alone
// with no character save around them, and tests/guild_bank_pg_integration.test.ts
// and tests/server/storage_purchase_db.pg.test.ts prove the legacy halves with
// no housing participant.
// Cost: 2.4 s
import { randomUUID } from 'node:crypto';
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
  readonly reached: Promise<void>;
  readonly open: () => void;
  readonly hold: {
    readonly at: 'before' | 'after';
    reach(): void;
    readonly release: Promise<void>;
  };
}

function gate(at: 'before' | 'after'): Gate {
  let open!: () => void;
  let reach!: () => void;
  const release = new Promise<void>((resolve) => {
    open = resolve;
  });
  const reached = new Promise<void>((resolve) => {
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
        Array.from({ length: chairs }, (_, i) => ({ itemId: CHAIR, copyRef: `${COPY_REF}:${i}` })),
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
                  if (hold?.at === 'before') {
                    hold.reach();
                    await hold.release;
                  }
                  await observe?.(tx, 'before');
                  try {
                    await hook.run(tx);
                  } finally {
                    if (hold?.at === 'after') hold.reach();
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
  async function waitForLockWaiters(pattern: string, count = 1): Promise<void> {
    for (let i = 0; i < 400; i++) {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = $1 AND wait_event_type = 'Lock' AND query LIKE $2`,
        [VERIFY_DB, pattern],
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
    });

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
        const outcome = await commit(transferDeps(t), transferRequest(t));
        expect(outcome.kind).toBe('failed');
        expect((outcome as { error: { code?: string } }).error.code).toBe('23514');
      } finally {
        await pool.query('DROP TRIGGER IF EXISTS fm_commit_fault ON account_freeholds');
        await pool.query('DROP FUNCTION IF EXISTS fm_commit_fault()');
      }
      expect(await custody(t)).toEqual({ bags: 1, layout: 0 });
      expect(await intentCount(t.intent.operationId)).toBe(1);
      expect(await receiptsOf(t.intent.operationId)).toEqual([]);
      // Control: the same transfer with the fault removed commits once.
      expect(await commit(transferDeps(t), transferRequest(t))).toMatchObject({
        kind: 'committed',
        verified: false,
      });
      expect(await custody(t)).toEqual({ bags: 0, layout: 1 });
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
        await waitForLockWaiters(VERIFY_WAIT_TEXT);
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
        await waitForLockWaiters(VERIFY_WAIT_TEXT);
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
        await waitForLockWaiters(VERIFY_WAIT_TEXT);
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
      await g.reached;
      const second = commit(
        depsFor({
          characterId: c2,
          state: bagsState('realm-two', 0),
          nonce: 'fm-realm-two',
          via: db2,
        }),
        hearthRequest(acct),
      );
      // The second realm really waits on the first one's Hearth row.
      await waitForLockWaiters('%account_freehold_hearth%');
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
      // A closed id never reports its outcome for a different request.
      expect(await ops.prepareFreeholdOperation(pool, other)).toEqual({ kind: 'conflict' });
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

    it('a storage purchase start waits on the hooked save and both commit', async () => {
      const p = await player();
      const key = `fm-start-${seq()}`;
      const g = gate('after');
      const hooked = commit(
        depsFor({
          characterId: p.ch,
          state: bagsState('housing', 0),
          nonce: p.nonce,
          hold: g.hold,
        }),
        hearthRequest(p.acct),
      );
      await g.reached;
      const start = storage.beginStoragePurchase(pool, {
        realm,
        accountId: p.acct,
        characterId: p.ch,
        itemId: 'strongbox_rung_01',
        expectedCostClaudium: 100,
        idempotencyKey: key,
        claimToken: randomUUID(),
      });
      await waitForLockWaiters('SELECT id FROM characters WHERE id = $1 FOR UPDATE');
      g.open();
      const [h, s] = await Promise.all([hooked, start]);
      expect(h).toMatchObject({ kind: 'committed', hearth: { revision: '1' } });
      expect(s).toMatchObject({ inserted: true, existing: { status: 'pending' } });
      expect(await blobOf(p.ch)).toEqual({ level: 6, marker: 'housing' });
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
      // housing suffix began; nothing is visible outside until COMMIT.
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
});
