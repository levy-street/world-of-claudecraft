// The EXECUTED proof of the global plot claim against real PostgreSQL: the
// lease and fencing generation of server/freehold_claim_db.ts, the renewer and
// the shutdown release of server/freehold_claim_registry.ts, the login reader
// of server/freehold_claim_login.ts and the fenced CTE of server/freehold_db.ts
// (docs/freeholds/mutation-touch-set-manifest.md sections 2, 5 P2 to P6, 6 and
// 10). A fake client cannot tell whether a lock wait re-checks the fence on the
// latest row version, whether SKIP LOCKED really passes a held row over,
// whether the claim row is locked before the plot row, or whether
// clock_timestamp() really differs from now() inside an open transaction:
// those are the claims this suite settles.
//
// Guards: the global plot claim protocol in real PG (acquire, renew, takeover, the fenced write,
// release, the G4 before G7 lock order, the login reader, clock_timestamp and the plans); the
// nearest suites that do not are tests/server/freehold_db.pg.test.ts (the plot table and its
// unfenced CAS) and tests/server/freehold_hearth_db.pg.test.ts (the Hearth table).
// Cost: 8.2 s
//
// Two pools stand in for two realm processes, each with its own holder string,
// and the lease runs on a SHORT TTL passed through the ttlSeconds parameter.
// That is the production policy's own parameter, not a second policy: the
// first case pins (from the wiring source) that the realm binds every claim
// ttlSeconds to LEASE_TTL_SECONDS. The FK parents are MINIMAL STAND-INS (an
// id-only accounts table and an account-owned characters table), as in the
// two neighbouring suites.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FreeholdHeldClaim } from '../../server/freehold_claim_registry';
import type {
  FreeholdQueryable,
  FreeholdUpsert,
  FreeholdWriteFence,
} from '../../server/freehold_db';
import {
  checkRelationUsesPartialIndex,
  type ExplainPlanNode,
  rootPlanFromExplainRow,
} from '../helpers/pg_plan';
import { stripComments } from '../helpers/strip_comments';

const url = process.env.TEST_DATABASE_URL ?? '';
const d = url === '' ? describe.skip : describe;

/** Every `ttlSeconds:` binding in a source, in order. */
const ttlBindings = (source: string): string[] =>
  [...source.matchAll(/\bttlSeconds\s*:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);

describe('the claim lease TTL the realm binds', () => {
  it('binds every claim ttlSeconds in the wiring to LEASE_TTL_SECONDS', () => {
    // A cheap source pin, comments stripped: the short TTL the real-PG cases
    // pass is the ttlSeconds parameter of the one lease policy, so the realm
    // must hand that parameter LEASE_TTL_SECONDS at all three claim sites (the
    // fenced writer, the login read and the renewer), never a literal.
    const source = stripComments(
      readFileSync(
        fileURLToPath(new URL('../../server/freehold_persist_wiring.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(source).toMatch(
      /import\s*\{[^}]*\bLEASE_TTL_SECONDS\b[^}]*\}\s*from\s*'\.\/character_lease_db';/,
    );
    expect(source).toContain('ttlSeconds: LEASE_TTL_SECONDS');
    expect(ttlBindings(source)).toEqual([
      'LEASE_TTL_SECONDS',
      'LEASE_TTL_SECONDS',
      'LEASE_TTL_SECONDS',
    ]);
    // Negative control: the reader sees a site bound to anything else.
    expect(ttlBindings(source.replace('ttlSeconds: LEASE_TTL_SECONDS', 'ttlSeconds: 1'))).toEqual([
      '1',
      'LEASE_TTL_SECONDS',
      'LEASE_TTL_SECONDS',
    ]);
  });
});

// A PRIVATE schema, the repo idiom for every database-gated suite: this suite
// DROPS its schema in beforeAll and afterAll and deletes rows between cases,
// and the module functions it drives issue UNQUALIFIED SQL, so without an
// isolated search_path a TEST_DATABASE_URL pointed at a database carrying the
// game schema would destroy real claim, plot and Hearth rows. Suffixed with
// this process's pid and six random hex characters, so two runs of this file
// on one database (two worktrees, a gate beside a hand run, or two containers
// whose processes carry the same pid) never drop each other's schema mid-run;
// the pool application names derive from it too, so a lock-wait probe never
// sees the other run's backends. Lowercase letters, digits and underscores
// only, well under the 63-byte identifier limit, so it is a valid unquoted
// identifier.
const SCHEMA = `freehold_claim_pg_test_${process.pid}_${randomBytes(3).toString('hex')}`;
const APP_A = `${SCHEMA}_a`;
const APP_B = `${SCHEMA}_b`;

const REALM_A = 'realmA';
const REALM_B = 'realmB';
const HOLDER_A = `${REALM_A}#${randomUUID()}`;
const HOLDER_B = `${REALM_B}#${randomUUID()}`;

const SHORT_TTL_SECONDS = 1;
const LONG_TTL_SECONDS = 30;
const MAX_OWNED_BYTES = 64 * 1024;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const plot = (name: string) => `plot:claim-${name}`;

interface Captured {
  text: string;
  values: unknown[] | undefined;
}

/** Wraps a real queryable so a case can EXPLAIN exactly what the module sent. */
function recorder(target: FreeholdQueryable) {
  const calls: Captured[] = [];
  return {
    calls,
    db: {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return await target.query(text, values);
      },
    },
  };
}

/** The plan nodes that READ `relation` (a ModifyTable names its target too,
 *  but it is the write, not an access path). */
function relationScans(root: ExplainPlanNode, relation: string): ExplainPlanNode[] {
  const out: ExplainPlanNode[] = [];
  const visit = (node: ExplainPlanNode) => {
    if (node['Relation Name'] === relation && node['Node Type'] !== 'ModifyTable') out.push(node);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(root);
  return out;
}

/** Each read of `relation` reaches `index`, and there are exactly `count`. */
function scansReach(root: ExplainPlanNode, relation: string, index: string): string[] {
  return relationScans(root, relation).map((node) => {
    const check = checkRelationUsesPartialIndex(node, relation, index);
    return check.ok ? index : (check.reason ?? 'refused');
  });
}

/** Each read of `relation` reaches ONE of `indexes` (a predicate two indexes
 *  both serve, where the planner's pick is not the property): the index each
 *  read used, or why it used none. */
function scansReachOneOf(root: ExplainPlanNode, relation: string, indexes: string[]): string[] {
  return relationScans(root, relation).map((node) => {
    const hit = indexes.find((index) => checkRelationUsesPartialIndex(node, relation, index).ok);
    return hit ?? `"${relation}" (${node['Node Type']}) reached none of ${indexes.join(', ')}`;
  });
}

const planShape = (node: ExplainPlanNode): string => {
  const rel = node['Relation Name']
    ? `(${node['Relation Name']}${node['Index Name'] ? ` via ${node['Index Name']}` : ''})`
    : '';
  const kids = node.Plans?.length ? ` [${node.Plans.map(planShape).join(', ')}]` : '';
  return `${node['Node Type']}${rel}${kids}`;
};

d('the global plot claim against real PostgreSQL', () => {
  // Imported lazily so the suite skips clean with no pg import at all.
  let Pool: typeof import('pg').Pool;
  let poolA: import('pg').Pool;
  let poolB: import('pg').Pool;
  let side: import('pg').Pool;
  let probe: import('pg').Pool;
  let claimDb: typeof import('../../server/freehold_claim_db');
  let plotDb: typeof import('../../server/freehold_db');
  let hearthDb: typeof import('../../server/freehold_hearth_db');
  let reg: typeof import('../../server/freehold_claim_registry');
  let loginMod: typeof import('../../server/freehold_claim_login');
  let txMod: typeof import('../../server/freehold_tx');

  const newPool = (app: string, max: number) =>
    new Pool({
      connectionString: url,
      max,
      options: `-c search_path=${SCHEMA}`,
      application_name: app,
      statement_timeout: 15_000,
    });

  interface ClaimRow {
    holder: string;
    realm: string;
    generation: string;
    write_token: string | null;
    acquired_us: string;
    heartbeat_us: string;
    expires_us: string;
    live: boolean;
    version: string;
  }

  /** The claim row, read lock-free on the probe pool. `version` is xmin, so an
   *  unchanged version proves no new row version was written. */
  const claimRow = async (plotId: string): Promise<ClaimRow | null> =>
    (
      await probe.query(
        `SELECT holder, realm, generation::text AS generation, write_token,
                (extract(epoch FROM acquired_at) * 1000000)::bigint::text AS acquired_us,
                (extract(epoch FROM heartbeat_at) * 1000000)::bigint::text AS heartbeat_us,
                (extract(epoch FROM expires_at) * 1000000)::bigint::text AS expires_us,
                expires_at > clock_timestamp() AS live,
                xmin::text AS version
           FROM ${SCHEMA}.freehold_plot_claims WHERE plot_id = $1`,
        [plotId],
      )
    ).rows[0] ?? null;

  const plotRow = async (accountId: number) =>
    (
      await probe.query(
        `SELECT durable_rev::text AS durable_rev, tier, condition, wire_rev::text AS wire_rev,
                layout::text AS layout, xmin::text AS version
           FROM ${SCHEMA}.account_freeholds WHERE account_id = $1 AND plot_index = 0`,
        [accountId],
      )
    ).rows[0] ?? null;

  const content = (
    accountId: number,
    plotId: string,
    expectedDurableRev: string | null,
    over: Partial<FreeholdUpsert> = {},
  ): FreeholdUpsert => ({
    accountId,
    plotIndex: 0,
    plotId,
    tier: 'cottage',
    layoutJson: '[]',
    trophiesJson: '[]',
    condition: 100,
    visitPolicy: 'closed',
    wireRev: 0,
    schemaVersion: 1,
    expectedDurableRev,
    ...over,
  });
  const MANOR = { tier: 'manor', condition: 90, wireRev: 1 } as const;

  const seedPlot = async (accountId: number, plotId: string) => {
    expect(await plotDb.upsertFreehold(poolA, content(accountId, plotId, null))).toEqual({
      kind: 'inserted',
      durableRev: '1',
    });
  };

  const acquire = (
    db: FreeholdQueryable,
    holder: string,
    plotId: string,
    accountId: number,
    ttlSeconds: number,
  ) =>
    claimDb.acquireFreeholdClaim(db, {
      plotId,
      accountId,
      realm: holder.split('#')[0],
      holder,
      ttlSeconds,
    });

  const fenceOf = (plotId: string, holder: string, generation: string): FreeholdWriteFence => ({
    plotId,
    holder,
    generation,
    writeToken: claimDb.mintFreeholdWriteToken(),
  });

  const held = (plotId: string, accountId: number, generation = '1'): FreeholdHeldClaim => ({
    plotId,
    accountId,
    generation,
    acquiredAtMs: 0,
  });

  /** Polls the database clock (not this process's) until the claim lapses. */
  const waitUntilExpired = async (plotId: string): Promise<void> => {
    const started = Date.now();
    for (;;) {
      const row = await claimRow(plotId);
      if (row && !row.live) return;
      if (Date.now() - started > 5_000) throw new Error('the claim never expired');
      await sleep(25);
    }
  };

  const backendPid = async (client: import('pg').PoolClient): Promise<number> =>
    Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);

  /** The statement of pool `app` that is parked on a lock `holderPid` holds.
   *  Polled on the WAITER: a holder's own row shows its last statement. */
  async function waitForBlock(holderPid: number, app: string, budgetMs = 5_000) {
    const started = Date.now();
    for (;;) {
      const res = await probe.query(
        `SELECT query, wait_event_type FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = $1
            AND wait_event_type = 'Lock' AND $2::int = ANY(pg_blocking_pids(pid))
          LIMIT 1`,
        [app, holderPid],
      );
      if (res.rows[0]) {
        return { query: String(res.rows[0].query), waitEventType: res.rows[0].wait_event_type };
      }
      if (Date.now() - started > budgetMs) return null;
      await sleep(10);
    }
  }

  const renewDeps = (
    registry: import('../../server/freehold_claim_registry').FreeholdClaimRegistry,
    ttlSeconds: number,
  ) => {
    const onLost = vi.fn();
    const warn = vi.fn();
    const wanted = vi.fn(() => true);
    return {
      onLost,
      warn,
      wanted,
      deps: {
        registry,
        pool: poolA,
        holder: HOLDER_A,
        ttlSeconds,
        wanted,
        onLost,
        nowMs: () => 0,
        warn,
      },
    };
  };

  /** poolA's checkouts, every statement recorded, and the SQLSTATE of every
   *  sent statement the database refused; `fail` answers a statement with an
   *  error instead of sending it (a release that THROWS). */
  const wrappedPool = (fail: (text: string) => Error | null = () => null) => {
    const texts: string[] = [];
    const refusals: { text: string; code: unknown }[] = [];
    const pool: import('../../server/freehold_tx').FreeholdTxPool = {
      async connect() {
        const client = await poolA.connect();
        const wrapped = {
          processID: (client as unknown as { processID?: number }).processID,
          query(text: string, values?: unknown[]) {
            texts.push(text);
            const error = fail(text);
            if (error) return Promise.reject(error);
            return client.query(text, values).catch((refused: unknown) => {
              refusals.push({ text, code: (refused as { code?: unknown } | null)?.code });
              throw refused;
            });
          },
          release: (error?: Error | boolean) => client.release(error),
          on: (event: 'error', listener: (error: Error) => void) => client.on(event, listener),
          removeListener: (event: 'error', listener: (error: Error) => void) =>
            client.removeListener(event, listener),
        };
        return wrapped as import('../../server/db_transaction_deadline').DbTransactionDeadlineClient;
      },
    };
    return { pool, texts, refusals };
  };

  beforeAll(async () => {
    ({ Pool } = await import('pg'));
    claimDb = await import('../../server/freehold_claim_db');
    plotDb = await import('../../server/freehold_db');
    hearthDb = await import('../../server/freehold_hearth_db');
    reg = await import('../../server/freehold_claim_registry');
    loginMod = await import('../../server/freehold_claim_login');
    txMod = await import('../../server/freehold_tx');
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    poolA = newPool(APP_A, 4);
    poolB = newPool(APP_B, 4);
    side = newPool(`${SCHEMA}_side`, 4);
    probe = newPool(`${SCHEMA}_probe`, 1);
    await poolA.query('CREATE TABLE accounts (id SERIAL PRIMARY KEY)');
    await poolA.query(
      `CREATE TABLE characters (
         id SERIAL PRIMARY KEY,
         account_id INT REFERENCES accounts(id) ON DELETE CASCADE
       )`,
    );
    await poolA.query('INSERT INTO accounts (id) SELECT generate_series(1, 40)');
    // The three fragments in ensureSchema's order, each TWICE: idempotence is
    // part of the contract (every boot re-applies every fragment).
    for (const ddl of [
      plotDb.freeholdSchema(SCHEMA),
      hearthDb.freeholdHearthSchema(SCHEMA),
      claimDb.freeholdClaimSchema(SCHEMA),
    ]) {
      await poolA.query(ddl);
      await poolA.query(ddl);
    }
  }, 30_000);

  afterAll(async () => {
    if (!poolA) return;
    await Promise.all([poolA.end(), poolB.end(), side.end(), probe.end()]);
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  });

  beforeEach(async () => {
    // Qualified on purpose: cleanup must never depend on a search_path.
    await probe.query(`DELETE FROM ${SCHEMA}.freehold_plot_claims`);
    await probe.query(`DELETE FROM ${SCHEMA}.account_freeholds`);
    await probe.query(`DELETE FROM ${SCHEMA}.account_freehold_hearth`);
  });

  it('runs inside its private schema', async () => {
    const res = await poolA.query(
      `SELECT current_schema() AS schema,
              to_regclass('freehold_plot_claims')::text AS claims`,
    );
    expect(res.rows[0]).toEqual({ schema: SCHEMA, claims: 'freehold_plot_claims' });
  });

  it('inserts generation 1, keeps it for the same holder, refuses a live claim, then takes over an expired one', async () => {
    const plotId = plot('acquire');
    expect(await acquire(poolA, HOLDER_A, plotId, 1, SHORT_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '1',
      takeover: false,
    });
    const first = await claimRow(plotId);
    expect(first).toMatchObject({ holder: HOLDER_A, realm: REALM_A, generation: '1', live: true });
    // A fresh row stamps acquired_at and heartbeat_at from ONE clock reading.
    expect(first?.acquired_us).toBe(first?.heartbeat_us);

    // The same holder re-acquiring keeps its generation AND its acquired_at.
    expect(await acquire(poolA, HOLDER_A, plotId, 1, SHORT_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '1',
      takeover: false,
    });
    const again = await claimRow(plotId);
    expect(again?.acquired_us).toBe(first?.acquired_us);
    expect(BigInt(again?.heartbeat_us ?? '0')).toBeGreaterThan(BigInt(first?.heartbeat_us ?? '0'));

    // A different holder against the LIVE claim: busy, and no row version.
    expect(await acquire(poolB, HOLDER_B, plotId, 1, SHORT_TTL_SECONDS)).toEqual({ kind: 'busy' });
    expect(await claimRow(plotId)).toEqual(again);

    // The refusal is LOCK-FREE: inside an open transaction the busy answer
    // leaves the holder's row unlocked. Negative control: the upsert alone
    // (no pre-check) refuses too, but its ON CONFLICT locks the row anyway.
    const claimNowait = () =>
      side.query(
        'SELECT plot_id FROM freehold_plot_claims WHERE plot_id = $1 FOR NO KEY UPDATE NOWAIT',
        [plotId],
      );
    const alt = await poolB.connect();
    try {
      await alt.query('BEGIN');
      expect(await acquire(alt, HOLDER_B, plotId, 1, SHORT_TTL_SECONDS)).toEqual({ kind: 'busy' });
      expect((await claimNowait()).rows).toEqual([{ plot_id: plotId }]);
      const bare = await alt.query(claimDb.FREEHOLD_CLAIM_ACQUIRE_SQL, [
        plotId,
        1,
        REALM_B,
        HOLDER_B,
        SHORT_TTL_SECONDS,
      ]);
      expect(bare.rowCount).toBe(0);
      await expect(claimNowait()).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await alt.query('ROLLBACK').catch(() => undefined);
      alt.release();
    }
    expect(await claimRow(plotId)).toEqual(again);

    // Past the TTL the other holder takes it and the fence advances.
    await waitUntilExpired(plotId);
    expect(await acquire(poolB, HOLDER_B, plotId, 1, SHORT_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '2',
      takeover: true,
    });
    expect(await claimRow(plotId)).toMatchObject({
      holder: HOLDER_B,
      realm: REALM_B,
      generation: '2',
      live: true,
    });
  });

  it('keeps an idle claim alive past two TTLs through the renewer, then fences the late writer once renewal stops', async () => {
    const plotId = plot('renewed');
    await seedPlot(2, plotId);
    expect(await acquire(poolA, HOLDER_A, plotId, 2, SHORT_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '1',
      takeover: false,
    });
    const registry = reg.createFreeholdClaimRegistry();
    registry.record(held(plotId, 2));
    const { deps, onLost, warn, wanted } = renewDeps(registry, SHORT_TTL_SECONDS);

    // Six passes 400 ms apart, B probing at the OLDEST point of each cycle:
    // 2.4 s of a 1 s lease, which without the renewer lapses before pass three.
    const started = Date.now();
    for (let pass = 0; pass < 6; pass++) {
      await sleep(400);
      expect(await acquire(poolB, HOLDER_B, plotId, 2, SHORT_TTL_SECONDS)).toEqual({
        kind: 'busy',
      });
      expect(await claimRow(plotId)).toMatchObject({
        holder: HOLDER_A,
        generation: '1',
        live: true,
      });
      await reg.renewFreeholdClaims(deps);
    }
    expect(Date.now() - started).toBeGreaterThan(2_000);
    expect(wanted).toHaveBeenCalledTimes(6);
    expect(registry.counters).toMatchObject({ renewed: 6, missedHeartbeats: 0, lost: 0 });

    // Renewal stops: the lease lapses and B reclaims at the next generation.
    await waitUntilExpired(plotId);
    expect(await acquire(poolB, HOLDER_B, plotId, 2, SHORT_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '2',
      takeover: true,
    });
    // A's next renewer pass finds it gone: dropped and counted lost.
    await reg.renewFreeholdClaims(deps);
    expect(registry.counters).toMatchObject({ renewed: 6, lost: 1 });
    expect(registry.all()).toEqual([]);
    expect(onLost).toHaveBeenCalledWith(held(plotId, 2));
    expect(warn).toHaveBeenCalledWith(
      'freehold claims lost to another holder: 1; their plots stop writing',
    );

    // A's LATE write on its old fence is fenced and changes nothing.
    const before = await plotRow(2);
    expect(before).toMatchObject({ durable_rev: '1', tier: 'cottage' });
    expect(
      await plotDb.upsertFencedFreehold(
        poolA,
        content(2, plotId, '1', MANOR),
        fenceOf(plotId, HOLDER_A, '1'),
      ),
    ).toEqual({ kind: 'fenced' });
    expect(await plotRow(2)).toEqual(before);
    expect((await claimRow(plotId))?.write_token).toBeNull();

    // Negative control: the same document on B's new fence writes.
    const fenceB = fenceOf(plotId, HOLDER_B, '2');
    expect(
      await plotDb.upsertFencedFreehold(poolB, content(2, plotId, '1', MANOR), fenceB),
    ).toEqual({ kind: 'updated', durableRev: '2' });
    expect(await plotRow(2)).toMatchObject({ durable_rev: '2', tier: 'manor', condition: 90 });
    expect((await claimRow(plotId))?.write_token).toBe(fenceB.writeToken);
  });

  it('at the realm TTL: a claim two autosave passes stale is still held, and one renewal restores the whole TTL', async () => {
    // The realm's own LEASE_TTL_SECONDS, read from its source (importing it
    // would load server/db), with time moved by shifting the row: the database
    // clock cannot be advanced. AUTOSAVE_SECONDS (server/game.ts) is 30, so a
    // claim whose renewer missed one pass is 60 s stale at the next one.
    const ttl = Number(
      /export const LEASE_TTL_SECONDS = (\d+);/.exec(
        readFileSync(
          fileURLToPath(new URL('../../server/character_lease_db.ts', import.meta.url)),
          'utf8',
        ),
      )?.[1],
    );
    expect(ttl).toBe(90);
    const plotId = plot('realm-ttl');
    expect(await acquire(poolA, HOLDER_A, plotId, 40, ttl)).toEqual({
      kind: 'acquired',
      generation: '1',
      takeover: false,
    });
    /** expires_at minus heartbeat_at, in microseconds (two clock reads apart). */
    const span = (row: { expires_us: string; heartbeat_us: string } | null) =>
      Number(BigInt(row?.expires_us ?? '0') - BigInt(row?.heartbeat_us ?? '0'));
    const age = (seconds: number) =>
      probe.query(
        `UPDATE ${SCHEMA}.freehold_plot_claims
            SET heartbeat_at = heartbeat_at - make_interval(secs => $2),
                expires_at = expires_at - make_interval(secs => $2)
          WHERE plot_id = $1`,
        [plotId, seconds],
      );
    expect(span(await claimRow(plotId))).toBeGreaterThanOrEqual(ttl * 1_000_000);
    expect(span(await claimRow(plotId))).toBeLessThan((ttl + 1) * 1_000_000);

    // Two passes and a second stale: still A's, so B is busy.
    await age(61);
    const stale = await claimRow(plotId);
    expect(stale).toMatchObject({ holder: HOLDER_A, generation: '1', live: true });
    expect(await acquire(poolB, HOLDER_B, plotId, 40, ttl)).toEqual({ kind: 'busy' });

    const registry = reg.createFreeholdClaimRegistry();
    registry.record(held(plotId, 40));
    const { deps } = renewDeps(registry, ttl);
    await reg.renewFreeholdClaims(deps);
    expect(registry.counters).toMatchObject({ renewed: 1, missedHeartbeats: 0, lost: 0 });
    const renewed = await claimRow(plotId);
    expect(renewed).toMatchObject({ holder: HOLDER_A, generation: '1', live: true });
    expect(span(renewed)).toBeGreaterThanOrEqual(ttl * 1_000_000);
    expect(span(renewed)).toBeLessThan((ttl + 1) * 1_000_000);
    // Restored from the stale expiry by at least the 61 s it had lost.
    expect(
      Number(BigInt(renewed?.expires_us ?? '0') - BigInt(stale?.expires_us ?? '0')),
    ).toBeGreaterThanOrEqual(61 * 1_000_000);

    // The control: with no renewal for the whole TTL, B takes it over.
    await age(ttl + 1);
    expect(await acquire(poolB, HOLDER_B, plotId, 40, ttl)).toEqual({
      kind: 'acquired',
      generation: '2',
      takeover: true,
    });
  });

  it('writes through a matching fence once, stamps no token on a stale write, and writes nothing through a wrong fence', async () => {
    const plotId = plot('fenced');
    await seedPlot(3, plotId);
    expect(await acquire(poolA, HOLDER_A, plotId, 3, LONG_TTL_SECONDS)).toMatchObject({
      generation: '1',
    });

    const good = fenceOf(plotId, HOLDER_A, '1');
    expect(await plotDb.upsertFencedFreehold(poolA, content(3, plotId, '1', MANOR), good)).toEqual({
      kind: 'updated',
      durableRev: '2',
    });
    const written = await plotRow(3);
    expect(written).toMatchObject({
      durable_rev: '2',
      tier: 'manor',
      condition: 90,
      wire_rev: '1',
      layout: '[]',
    });
    expect(await claimRow(plotId)).toMatchObject({
      holder: HOLDER_A,
      generation: '1',
      write_token: good.writeToken,
    });

    // Matching fence, STALE expected revision: stale, and the token is NOT
    // re-stamped (a stale write must never look like the last landed one).
    const stale = fenceOf(plotId, HOLDER_A, '1');
    expect(
      await plotDb.upsertFencedFreehold(poolA, content(3, plotId, '1', { tier: 'keep' }), stale),
    ).toEqual({ kind: 'stale', durableRev: '2' });
    expect((await claimRow(plotId))?.write_token).toBe(good.writeToken);
    expect(await plotRow(3)).toEqual(written);

    // Wrong generation, then wrong holder: fenced, nothing written either way.
    for (const wrong of [fenceOf(plotId, HOLDER_A, '2'), fenceOf(plotId, HOLDER_B, '1')]) {
      expect(
        await plotDb.upsertFencedFreehold(poolA, content(3, plotId, '2', { tier: 'keep' }), wrong),
      ).toEqual({ kind: 'fenced' });
      expect((await claimRow(plotId))?.write_token).toBe(good.writeToken);
      expect(await plotRow(3)).toEqual(written);
    }

    // Matching fence, no plot row under that account: missing, no token.
    expect(
      await plotDb.upsertFencedFreehold(
        poolA,
        content(4, plotId, '1'),
        fenceOf(plotId, HOLDER_A, '1'),
      ),
    ).toEqual({ kind: 'missing' });
    expect((await claimRow(plotId))?.write_token).toBe(good.writeToken);

    // The refusals left the fence intact: the next correct write lands, +1.
    const next = fenceOf(plotId, HOLDER_A, '1');
    expect(
      await plotDb.upsertFencedFreehold(poolA, content(3, plotId, '2', { tier: 'keep' }), next),
    ).toEqual({ kind: 'updated', durableRev: '3' });
    expect((await claimRow(plotId))?.write_token).toBe(next.writeToken);
  });

  it('locks the claim row before the plot row: a held claim parks the write while the plot row stays free', async () => {
    const plotId = plot('order-a');
    await seedPlot(5, plotId);
    expect(await acquire(poolA, HOLDER_A, plotId, 5, LONG_TTL_SECONDS)).toMatchObject({
      generation: '1',
    });
    const nowaitProbe = () =>
      side.query(
        `SELECT durable_rev::text AS durable_rev FROM account_freeholds
          WHERE account_id = $1 AND plot_index = 0 FOR UPDATE NOWAIT`,
        [5],
      );
    const fence = fenceOf(plotId, HOLDER_A, '1');
    const x = await side.connect();
    let write: Promise<unknown> | undefined;
    try {
      // Session X holds the claim row, as a Hearth trip's G4 read fence does.
      await x.query('BEGIN');
      await x.query(
        'SELECT plot_id FROM freehold_plot_claims WHERE plot_id = $1 FOR NO KEY UPDATE',
        [plotId],
      );
      const xPid = await backendPid(x);
      write = plotDb.upsertFencedFreehold(poolA, content(5, plotId, '1', MANOR), fence);
      const blocked = await waitForBlock(xPid, APP_A);
      expect(blocked?.waitEventType).toBe('Lock');
      expect(blocked?.query).toContain('WITH fence AS MATERIALIZED');
      // While the write waits on G4 it holds NO plot row lock (G7 not taken).
      expect((await nowaitProbe()).rows).toEqual([{ durable_rev: '1' }]);
      await x.query('COMMIT');
      expect(await write).toEqual({ kind: 'updated', durableRev: '2' });
    } finally {
      await x.query('ROLLBACK').catch(() => undefined);
      x.release();
      await write?.catch(() => undefined);
    }
    expect((await claimRow(plotId))?.write_token).toBe(fence.writeToken);

    // Negative control: the NOWAIT probe DOES see a held plot row.
    const y = await side.connect();
    try {
      await y.query('BEGIN');
      await y.query(
        'SELECT 1 FROM account_freeholds WHERE account_id = $1 AND plot_index = 0 FOR UPDATE',
        [5],
      );
      await expect(nowaitProbe()).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await y.query('ROLLBACK').catch(() => undefined);
      y.release();
    }
  });

  it('fences a write that was parked on the claim row when a takeover commits', async () => {
    const plotId = plot('order-b');
    await seedPlot(6, plotId);
    expect(await acquire(poolA, HOLDER_A, plotId, 6, LONG_TTL_SECONDS)).toMatchObject({
      generation: '1',
    });
    // Lapse A's lease without waiting it out (the acquire case proves the real
    // expiry); the fence itself ignores expiry, so A may still write until a
    // takeover lands.
    await side.query(
      `UPDATE freehold_plot_claims SET expires_at = clock_timestamp() - interval '1 second'
        WHERE plot_id = $1`,
      [plotId],
    );
    const before = await plotRow(6);
    const x = await poolB.connect();
    let write: Promise<unknown> | undefined;
    try {
      await x.query('BEGIN');
      expect(await acquire(x, HOLDER_B, plotId, 6, LONG_TTL_SECONDS)).toEqual({
        kind: 'acquired',
        generation: '2',
        takeover: true,
      });
      const xPid = await backendPid(x);
      write = plotDb.upsertFencedFreehold(
        poolA,
        content(6, plotId, '1', MANOR),
        fenceOf(plotId, HOLDER_A, '1'),
      );
      expect(await waitForBlock(xPid, APP_A)).not.toBeNull();
      await x.query('COMMIT');
      // The lock wait re-checked the fence on the committed takeover.
      expect(await write).toEqual({ kind: 'fenced' });
    } finally {
      await x.query('ROLLBACK').catch(() => undefined);
      x.release();
      await write?.catch(() => undefined);
    }
    expect(await plotRow(6)).toEqual(before);
    expect(await claimRow(plotId)).toMatchObject({
      holder: HOLDER_B,
      generation: '2',
      write_token: null,
    });
  });

  it('renews around a locked claim row without waiting, keeps it as a missed heartbeat, and drops a taken claim', async () => {
    const ids = [plot('skip-1'), plot('skip-2'), plot('skip-3'), plot('skip-4')];
    const registry = reg.createFreeholdClaimRegistry();
    for (const [i, plotId] of ids.entries()) {
      expect(await acquire(poolA, HOLDER_A, plotId, 7 + i, LONG_TTL_SECONDS)).toMatchObject({
        generation: '1',
      });
      registry.record(held(plotId, 7 + i));
    }
    // Another holder took the fourth.
    await side.query(
      'UPDATE freehold_plot_claims SET holder = $2, generation = generation + 1 WHERE plot_id = $1',
      [ids[3], HOLDER_B],
    );
    const before = await Promise.all(ids.map(claimRow));
    const { deps, onLost, warn } = renewDeps(registry, LONG_TTL_SECONDS);
    expect(reg.FREEHOLD_CLAIM_RENEW_BOUNDS.lockMs).toBe(1_000);

    const x = await side.connect();
    try {
      await x.query('BEGIN');
      await x.query(
        'SELECT plot_id FROM freehold_plot_claims WHERE plot_id = $1 FOR NO KEY UPDATE',
        [ids[1]],
      );
      const started = Date.now();
      await reg.renewFreeholdClaims(deps);
      // Completed while the lock is still held, inside the 1,000 ms lock bound:
      // a pass that waited would have timed out and missed all three.
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(registry.counters).toMatchObject({ renewed: 2, missedHeartbeats: 1, lost: 1 });
      expect(registry.all().map((claim) => claim.plotId)).toEqual(ids.slice(0, 3));
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith(held(ids[3], 10));
      expect(warn).toHaveBeenCalledWith(
        'freehold claims lost to another holder: 1; their plots stop writing',
      );
      const after = await Promise.all(ids.map(claimRow));
      for (const i of [0, 2]) {
        expect(BigInt(after[i]?.expires_us ?? '0')).toBeGreaterThan(
          BigInt(before[i]?.expires_us ?? '0'),
        );
      }
      expect(after[1]).toEqual(before[1]);
      expect(after[3]).toEqual(before[3]);
      expect(after[3]?.holder).toBe(HOLDER_B);
    } finally {
      await x.query('ROLLBACK').catch(() => undefined);
      x.release();
    }
  });

  it('releases only live rows, retires the releasing holder from renew and write, and frees the plot at once', async () => {
    const live = plot('release-live');
    const lapsed = plot('release-lapsed');
    await seedPlot(11, live);
    for (const [plotId, accountId] of [
      [live, 11],
      [lapsed, 12],
    ] as const) {
      expect(await acquire(poolA, HOLDER_A, plotId, accountId, LONG_TTL_SECONDS)).toMatchObject({
        generation: '1',
      });
    }
    await side.query(
      `UPDATE freehold_plot_claims SET expires_at = clock_timestamp() - interval '5 seconds'
        WHERE plot_id = $1`,
      [lapsed],
    );
    const lapsedBefore = await claimRow(lapsed);
    expect(lapsedBefore).toMatchObject({ holder: HOLDER_A, live: false });
    // Control: before the release the holder's renew DOES return the plot.
    expect(await claimDb.renewFreeholdClaimRows(poolA, HOLDER_A, [live], LONG_TTL_SECONDS)).toEqual(
      new Set([live]),
    );

    expect(await claimDb.releaseFreeholdClaimRows(poolA, HOLDER_A, [lapsed, live])).toEqual(
      new Set([live]),
    );
    // The lapsed row is not rewritten (same version, same expiry, same holder).
    expect(await claimRow(lapsed)).toEqual(lapsedBefore);
    const released = await claimRow(live);
    expect(released).toMatchObject({
      holder: `${HOLDER_A}#released`,
      generation: '1',
      live: false,
    });
    expect(claimDb.FREEHOLD_CLAIM_RELEASED_SUFFIX).toBe('#released');

    // The releasing holder can no longer extend it, nor write through it.
    expect(await claimDb.renewFreeholdClaimRows(poolA, HOLDER_A, [live], LONG_TTL_SECONDS)).toEqual(
      new Set(),
    );
    expect(await claimRow(live)).toEqual(released);
    const plotBefore = await plotRow(11);
    expect(
      await plotDb.upsertFencedFreehold(
        poolA,
        content(11, live, '1', MANOR),
        fenceOf(live, HOLDER_A, '1'),
      ),
    ).toEqual({ kind: 'fenced' });
    expect(await plotRow(11)).toEqual(plotBefore);

    // Another holder acquires immediately, though the lease ran for 30 s.
    const started = Date.now();
    expect(await acquire(poolB, HOLDER_B, live, 11, LONG_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '2',
      takeover: true,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('treats the same holder re-acquiring after its own release as a takeover', async () => {
    const plotId = plot('release-self');
    expect(await acquire(poolA, HOLDER_A, plotId, 13, LONG_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '1',
      takeover: false,
    });
    expect(await claimDb.releaseFreeholdClaimRows(poolA, HOLDER_A, [plotId])).toEqual(
      new Set([plotId]),
    );
    expect(await acquire(poolA, HOLDER_A, plotId, 13, LONG_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '2',
      takeover: true,
    });
    expect(await claimRow(plotId)).toMatchObject({ holder: HOLDER_A, generation: '2', live: true });
  });

  it('caps a live holder at 119 characters, so its release suffix always fits the 128-character CHECK', async () => {
    const plotId = plot('holder-cap');
    const longest = `${REALM_A}#${'h'.repeat(119 - REALM_A.length - 1)}`;
    expect(longest).toHaveLength(119);
    expect(await acquire(poolA, longest, plotId, 32, LONG_TTL_SECONDS)).toMatchObject({
      kind: 'acquired',
      generation: '1',
    });
    // Accepted at every other site that takes a holder, too: the renew, both
    // release reads and the shutdown release.
    expect(
      await claimDb.renewFreeholdClaimRows(poolA, longest, [plotId], LONG_TTL_SECONDS),
    ).toEqual(new Set([plotId]));
    expect(
      await claimDb.readFreeholdClaimReleasesOnClient(poolA, longest, [plotId], { wait: false }),
    ).toEqual(new Map([[plotId, 'held']]));
    expect(await claimDb.releaseFreeholdClaimRows(poolA, longest, [plotId])).toEqual(
      new Set([plotId]),
    );
    expect(
      await claimDb.readFreeholdClaimReleasesOnClient(poolA, longest, [plotId], { wait: true }),
    ).toEqual(new Map([[plotId, 'released']]));
    // The shutdown release renames a LIVE row of that holder to the same
    // 128-character shape, and leaves the already released one alone.
    const second = plot('holder-cap-all');
    expect(await acquire(poolA, longest, second, 39, LONG_TTL_SECONDS)).toMatchObject({
      kind: 'acquired',
      generation: '1',
    });
    expect(await claimDb.releaseAllFreeholdClaimRows(poolA, longest)).toBe(1);
    for (const released of [plotId, second]) {
      const row = await claimRow(released);
      expect(row?.holder, released).toBe(`${longest}#released`);
      expect(row?.holder, released).toHaveLength(128);
    }
    // One character more is refused before any statement, at every claim site
    // that takes a holder: its release could never fit the column.
    const over = `${longest}x`;
    const capture = recorder(poolA);
    await expect(
      acquire(capture.db, over, plot('holder-over'), 33, LONG_TTL_SECONDS),
    ).rejects.toThrow(RangeError);
    await expect(
      claimDb.renewFreeholdClaimRows(capture.db, over, [plotId], LONG_TTL_SECONDS),
    ).rejects.toThrow(RangeError);
    await expect(claimDb.releaseFreeholdClaimRows(capture.db, over, [plotId])).rejects.toThrow(
      RangeError,
    );
    await expect(claimDb.releaseAllFreeholdClaimRows(capture.db, over)).rejects.toThrow(RangeError);
    for (const wait of [false, true]) {
      await expect(
        claimDb.readFreeholdClaimReleasesOnClient(capture.db, over, [plotId], { wait }),
      ).rejects.toThrow(RangeError);
    }
    expect(capture.calls).toEqual([]);
    // Control: the column's own bound is 128, so one character past the
    // released shape fails the CHECK in the database.
    await expect(
      probe.query(`UPDATE ${SCHEMA}.freehold_plot_claims SET holder = $2 WHERE plot_id = $1`, [
        plotId,
        `${longest}#released!`,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it("releases exactly this holder's live claims at shutdown, skips a row an open transaction holds, and keeps every row", async () => {
    const mine = [plot('all-1'), plot('all-2'), plot('all-3')];
    const lapsed = plot('all-lapsed');
    const theirs = plot('all-theirs');
    const registry = reg.createFreeholdClaimRegistry();
    for (const [i, plotId] of mine.entries()) {
      await acquire(poolA, HOLDER_A, plotId, 14 + i, LONG_TTL_SECONDS);
      registry.record(held(plotId, 14 + i));
    }
    await acquire(poolA, HOLDER_A, lapsed, 17, LONG_TTL_SECONDS);
    await side.query(
      `UPDATE freehold_plot_claims SET expires_at = clock_timestamp() - interval '5 seconds'
        WHERE plot_id = $1`,
      [lapsed],
    );
    expect(await acquire(poolB, HOLDER_B, theirs, 18, LONG_TTL_SECONDS)).toMatchObject({
      generation: '1',
    });
    const before = new Map(
      await Promise.all(
        [...mine, lapsed, theirs].map(async (id) => [id, await claimRow(id)] as const),
      ),
    );
    const warn = vi.fn();
    const x = await side.connect();
    try {
      await x.query('BEGIN');
      await x.query(
        'SELECT plot_id FROM freehold_plot_claims WHERE plot_id = $1 FOR NO KEY UPDATE',
        [mine[1]],
      );
      const started = Date.now();
      expect(
        await reg.releaseAllFreeholdClaims({ pool: poolA, holder: HOLDER_A, registry, warn }),
      ).toBe(2);
      expect(Date.now() - started).toBeLessThan(1_000);
      for (const id of [mine[0], mine[2]]) {
        expect(await claimRow(id)).toMatchObject({
          holder: `${HOLDER_A}#released`,
          generation: '1',
          live: false,
        });
      }
      // The held row was passed over, not waited for: still A's and live.
      expect(await claimRow(mine[1])).toEqual(before.get(mine[1]));
      expect(await claimRow(lapsed)).toEqual(before.get(lapsed));
      expect(await claimRow(theirs)).toEqual(before.get(theirs));
    } finally {
      await x.query('ROLLBACK').catch(() => undefined);
      x.release();
    }
    expect(warn).not.toHaveBeenCalled();
    expect(registry.all()).toEqual([]);
    expect(registry.counters.released).toBe(2);
    // Release keeps the rows, so the generation survives into the next era.
    expect(
      Number(
        (await probe.query(`SELECT count(*) AS n FROM ${SCHEMA}.freehold_plot_claims`)).rows[0].n,
      ),
    ).toBe(5);
    expect(await acquire(poolB, HOLDER_B, mine[0], 14, LONG_TTL_SECONDS)).toEqual({
      kind: 'acquired',
      generation: '2',
      takeover: true,
    });
  });

  it("never touches another holder's row at shutdown: a takeover of A's lapsed claim, in flight or committed, is B's", async () => {
    const plotId = plot('all-taken');
    await acquire(poolA, HOLDER_A, plotId, 20, LONG_TTL_SECONDS);
    const registry = reg.createFreeholdClaimRegistry();
    registry.record(held(plotId, 20));
    await side.query(
      `UPDATE freehold_plot_claims SET expires_at = clock_timestamp() - interval '5 seconds'
        WHERE plot_id = $1`,
      [plotId],
    );
    const warn = vi.fn();
    // IN FLIGHT: B's takeover holds the row, uncommitted, while A releases.
    const b = await poolB.connect();
    try {
      await b.query('BEGIN');
      expect(await acquire(b, HOLDER_B, plotId, 20, LONG_TTL_SECONDS)).toEqual({
        kind: 'acquired',
        generation: '2',
        takeover: true,
      });
      // A release that waited on B's lock would hit its lock bound and warn,
      // since B commits only after it returns.
      expect(
        await reg.releaseAllFreeholdClaims({ pool: poolA, holder: HOLDER_A, registry, warn }),
      ).toBe(0);
      await b.query('COMMIT');
    } finally {
      await b.query('ROLLBACK').catch(() => undefined);
      b.release();
    }
    const taken = await claimRow(plotId);
    expect(taken).toMatchObject({ holder: HOLDER_B, generation: '2', live: true });
    // COMMITTED: a second release by the stale holder writes no row version.
    registry.record(held(plotId, 20));
    expect(
      await reg.releaseAllFreeholdClaims({ pool: poolA, holder: HOLDER_A, registry, warn }),
    ).toBe(0);
    expect(await claimRow(plotId)).toEqual(taken);
    expect(warn).not.toHaveBeenCalled();
    expect(registry.all()).toEqual([]);
    expect(registry.counters.released).toBe(0);
  });

  it('abandons the shutdown release inside its 2,000 ms deadline when the pool cannot hand out a client', async () => {
    const plotId = plot('all-starved');
    expect(await acquire(poolA, HOLDER_A, plotId, 19, LONG_TTL_SECONDS)).toMatchObject({
      generation: '1',
    });
    const registry = reg.createFreeholdClaimRegistry();
    registry.record(held(plotId, 19));
    expect(reg.FREEHOLD_CLAIM_RELEASE_ALL_DEADLINE_MS).toBe(2_000);
    const tight = newPool(`${SCHEMA}_tight`, 1);
    const hog = await tight.connect();
    const warn = vi.fn();
    try {
      const started = Date.now();
      expect(
        await reg.releaseAllFreeholdClaims({ pool: tight, holder: HOLDER_A, registry, warn }),
      ).toBe(0);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(1_950);
      expect(elapsed).toBeLessThan(3_500);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'freehold claims were not released at shutdown; they expire after the lease TTL',
      );
      expect(registry.all()).toEqual([held(plotId, 19)]);
      expect(await claimRow(plotId)).toMatchObject({ holder: HOLDER_A, live: true });
    } finally {
      hog.release();
    }
    // The abandoned checkout is handed back, not leaked: the pool's ONE client
    // is idle again (a leak would leave it checked out, and the read below
    // would only fail by its own timeout), and the pool still serves.
    // Polled, never slept: the hand-back is one settled promise away, and a
    // loaded runner must not turn that into a flake.
    await vi.waitFor(() => expect(tight.idleCount).toBe(1));
    expect(tight.waitingCount).toBe(0);
    expect(tight.totalCount).toBe(1);
    expect((await tight.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
    await tight.end();
  });

  it("waits out an UNCOMMITTED release in a thrown release's re-read and answers released once it commits, where a lock-free read answers held", async () => {
    const plotId = plot('reread-wait');
    expect(await acquire(poolA, HOLDER_A, plotId, 34, LONG_TTL_SECONDS)).toMatchObject({
      generation: '1',
    });
    const x = await side.connect();
    try {
      // The release has run and holds the row, but its COMMIT has not landed:
      // from outside, a stalled WAL flush on COMMIT looks exactly like this.
      await x.query('BEGIN');
      expect(await claimDb.releaseFreeholdClaimRows(x, HOLDER_A, [plotId])).toEqual(
        new Set([plotId]),
      );
      const xPid = await backendPid(x);
      // Control: a lock-free read cannot see the uncommitted release, so it
      // would keep a claim whose release is about to land.
      expect(
        await claimDb.readFreeholdClaimReleasesOnClient(poolB, HOLDER_A, [plotId], { wait: false }),
      ).toEqual(new Map([[plotId, 'held']]));
      const reading = txMod.runFreeholdTransaction(poolA, reg.FREEHOLD_CLAIM_RENEW_BOUNDS, (tx) =>
        claimDb.readFreeholdClaimReleasesOnClient(tx, HOLDER_A, [plotId], { wait: true }),
      );
      // It WAITS on the release's row lock (FOR SHARE against its NO KEY UPDATE).
      const blocked = await waitForBlock(xPid, APP_A);
      expect(blocked).toEqual({
        query: claimDb.FREEHOLD_CLAIM_RELEASE_WAIT_SQL,
        waitEventType: 'Lock',
      });
      await x.query('COMMIT');
      expect(await reading).toEqual(new Map([[plotId, 'released']]));
    } finally {
      await x.query('ROLLBACK').catch(() => undefined);
      x.release();
    }
    expect(await claimRow(plotId)).toMatchObject({ holder: `${HOLDER_A}#released`, live: false });
  });

  it('keeps a thrown release chunk for the next pass when its re-read runs out the lock bound on a row still held', async () => {
    const plotId = plot('reread-timeout');
    expect(await acquire(poolA, HOLDER_A, plotId, 35, LONG_TTL_SECONDS)).toMatchObject({
      generation: '1',
    });
    const registry = reg.createFreeholdClaimRegistry();
    registry.record(held(plotId, 35));
    const before = await claimRow(plotId);
    // The release statement THROWS without reaching the database.
    const thrown = wrappedPool((text) =>
      text === claimDb.FREEHOLD_CLAIM_RELEASE_SQL
        ? Object.assign(new Error('could not serialize access'), { code: '40001' })
        : null,
    );
    const { deps, wanted } = renewDeps(registry, LONG_TTL_SECONDS);
    wanted.mockReturnValue(false);
    const x = await side.connect();
    try {
      // An open transaction holds the row past the read's 1,000 ms lock bound.
      await x.query('BEGIN');
      await x.query(
        'SELECT plot_id FROM freehold_plot_claims WHERE plot_id = $1 FOR NO KEY UPDATE',
        [plotId],
      );
      const started = Date.now();
      await reg.renewFreeholdClaims({ ...deps, pool: thrown.pool });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(950);
      expect(elapsed).toBeLessThan(3_000);
    } finally {
      await x.query('ROLLBACK').catch(() => undefined);
      x.release();
    }
    expect(thrown.texts.filter((t) => t === claimDb.FREEHOLD_CLAIM_RELEASE_WAIT_SQL)).toHaveLength(
      1,
    );
    // The re-read's own rejection, not a window, says it was the lock bound:
    // 55P03 (lock_not_available), never the statement bound's 57014.
    expect(thrown.refusals).toEqual([
      { text: claimDb.FREEHOLD_CLAIM_RELEASE_WAIT_SQL, code: '55P03' },
    ]);
    expect(registry.all()).toEqual([held(plotId, 35)]);
    expect(registry.counters.released).toBe(0);
    expect(await claimRow(plotId)).toEqual(before);
  });

  it('releases through the renewer: a lapsed claim of ours leaves uncounted, a row an open transaction holds stays, then goes next pass', async () => {
    const live = plot('pass-live');
    const lapsed = plot('pass-lapsed');
    const locked = plot('pass-locked');
    const registry = reg.createFreeholdClaimRegistry();
    for (const [plotId, accountId] of [
      [live, 36],
      [lapsed, 37],
      [locked, 38],
    ] as const) {
      expect(await acquire(poolA, HOLDER_A, plotId, accountId, LONG_TTL_SECONDS)).toMatchObject({
        generation: '1',
      });
      registry.record(held(plotId, accountId));
    }
    // Releases that failed past the TTL leave a row of ours that has lapsed.
    await side.query(
      `UPDATE freehold_plot_claims SET expires_at = clock_timestamp() - interval '5 seconds'
        WHERE plot_id = $1`,
      [lapsed],
    );
    const lapsedBefore = await claimRow(lapsed);
    const recorded = wrappedPool();
    const { deps, wanted } = renewDeps(registry, LONG_TTL_SECONDS);
    wanted.mockReturnValue(false);
    const pass = { ...deps, pool: recorded.pool };
    const x = await side.connect();
    try {
      await x.query('BEGIN');
      await x.query(
        'SELECT plot_id FROM freehold_plot_claims WHERE plot_id = $1 FOR NO KEY UPDATE',
        [locked],
      );
      await reg.renewFreeholdClaims(pass);
    } finally {
      await x.query('ROLLBACK').catch(() => undefined);
      x.release();
    }
    // The lapsed one left (never asked about again), uncounted; the locked one
    // was passed over by SKIP LOCKED and is still ours and live: kept.
    expect(registry.all()).toEqual([held(locked, 38)]);
    expect(registry.counters.released).toBe(1);
    expect(await claimRow(live)).toMatchObject({ holder: `${HOLDER_A}#released`, live: false });
    expect(await claimRow(lapsed)).toEqual(lapsedBefore);
    expect(
      recorded.texts.filter((t) => t === claimDb.FREEHOLD_CLAIM_RELEASE_READ_SQL),
    ).toHaveLength(1);
    // The next pass, the lock gone, releases it.
    await reg.renewFreeholdClaims(pass);
    expect(registry.all()).toEqual([]);
    expect(registry.counters.released).toBe(2);
    expect(await claimRow(locked)).toMatchObject({ holder: `${HOLDER_A}#released`, live: false });
  });

  it('lets exactly one of two processes win a first acquire of one plot', async () => {
    // Forced interleave: B's upsert parks on A's uncommitted insert.
    const raceOnce = async (plotId: string, accountId: number, aCommits: boolean) => {
      const a = await poolA.connect();
      const b = await poolB.connect();
      let bAcquire: Promise<unknown> | undefined;
      try {
        await a.query('BEGIN');
        await b.query('BEGIN');
        expect(await acquire(a, HOLDER_A, plotId, accountId, LONG_TTL_SECONDS)).toEqual({
          kind: 'acquired',
          generation: '1',
          takeover: false,
        });
        bAcquire = acquire(b, HOLDER_B, plotId, accountId, LONG_TTL_SECONDS);
        expect(await waitForBlock(await backendPid(a), APP_B)).not.toBeNull();
        await a.query(aCommits ? 'COMMIT' : 'ROLLBACK');
        const answer = await bAcquire;
        await b.query('COMMIT');
        return answer;
      } finally {
        await a.query('ROLLBACK').catch(() => undefined);
        await b.query('ROLLBACK').catch(() => undefined);
        a.release();
        b.release();
        await bAcquire?.catch(() => undefined);
      }
    };
    expect(await raceOnce(plot('race'), 20, true)).toEqual({ kind: 'busy' });
    expect(await claimRow(plot('race'))).toMatchObject({ holder: HOLDER_A, generation: '1' });
    // Negative control: when A's insert rolls back, B inserts generation 1.
    expect(await raceOnce(plot('race-rolled'), 21, false)).toEqual({
      kind: 'acquired',
      generation: '1',
      takeover: false,
    });
    expect(await claimRow(plot('race-rolled'))).toMatchObject({
      holder: HOLDER_B,
      generation: '1',
    });

    // And unordered: concurrent autocommit acquires, one winner each time.
    for (const [i, plotId] of ['race-u1', 'race-u2', 'race-u3'].map(plot).entries()) {
      const answers = await Promise.all([
        acquire(poolA, HOLDER_A, plotId, 22 + i, LONG_TTL_SECONDS),
        acquire(poolB, HOLDER_B, plotId, 22 + i, LONG_TTL_SECONDS),
      ]);
      expect(answers.map((answer) => answer.kind).sort()).toEqual(['acquired', 'busy']);
      const winner = answers[0].kind === 'acquired' ? HOLDER_A : HOLDER_B;
      expect(answers.find((answer) => answer.kind === 'acquired')).toEqual({
        kind: 'acquired',
        generation: '1',
        takeover: false,
      });
      expect(await claimRow(plotId)).toMatchObject({ holder: winner, generation: '1' });
    }
  });

  describe('the login reader', () => {
    const loginDeps = (
      accountId: number,
      registry: import('../../server/freehold_claim_registry').FreeholdClaimRegistry,
    ) => {
      const readRow = vi.fn((db: FreeholdQueryable) =>
        plotDb.freeholdForAccount(db, accountId, MAX_OWNED_BYTES),
      );
      const readHearth = vi.fn((db: FreeholdQueryable) =>
        hearthDb.loadFreeholdHearth(db, accountId),
      );
      const onClaimed = vi.fn();
      return {
        readRow,
        readHearth,
        onClaimed,
        deps: {
          pool: poolA,
          registry,
          holder: HOLDER_A,
          realm: REALM_A,
          ttlSeconds: LONG_TTL_SECONDS,
          readRow,
          readHearth,
          nowMs: () => 4_242,
          onClaimed,
        },
      };
    };

    it('claims the plot and records it before it reads the row, and claims nothing with no row', async () => {
      const plotId = plot('login');
      await seedPlot(25, plotId);
      const registry = reg.createFreeholdClaimRegistry();
      const { deps, readRow, onClaimed } = loginDeps(25, registry);
      const answer = await loginMod.readClaimedLoginDurables(deps, 25);
      expect(answer.hearth).toEqual({ kind: 'absent' });
      expect(answer.row).toMatchObject({
        kind: 'row',
        row: { accountId: 25, plotIndex: 0, plotId, durableRev: '1', tier: 'cottage' },
      });
      expect(readRow).toHaveBeenCalledTimes(1);
      expect(registry.forPlot(plotId)).toEqual({
        plotId,
        accountId: 25,
        generation: '1',
        acquiredAtMs: 4_242,
      });
      expect(registry.counters).toMatchObject({ acquired: 1, takeovers: 0, busy: 0 });
      expect(onClaimed).toHaveBeenCalledWith(25);
      // Read on another pool: the claim COMMITTED.
      expect(await claimRow(plotId)).toMatchObject({
        holder: HOLDER_A,
        realm: REALM_A,
        generation: '1',
        live: true,
      });

      // Negative control: no plot row, nothing to claim.
      const empty = reg.createFreeholdClaimRegistry();
      const none = loginDeps(26, empty);
      expect(await loginMod.readClaimedLoginDurables(none.deps, 26)).toEqual({
        row: { kind: 'absent' },
        hearth: { kind: 'absent' },
      });
      expect(none.readRow).toHaveBeenCalledTimes(1);
      expect(empty.all()).toEqual([]);
      expect(none.onClaimed).not.toHaveBeenCalled();
      expect(
        (
          await probe.query(
            `SELECT count(*)::int AS n FROM ${SCHEMA}.freehold_plot_claims WHERE account_id = $1`,
            [26],
          )
        ).rows[0].n,
      ).toBe(0);
    });

    it('answers claim_busy against a foreign live claim and reads no row', async () => {
      const plotId = plot('login-busy');
      await seedPlot(27, plotId);
      expect(await acquire(poolB, HOLDER_B, plotId, 27, LONG_TTL_SECONDS)).toMatchObject({
        generation: '1',
      });
      const before = await claimRow(plotId);
      const registry = reg.createFreeholdClaimRegistry();
      const { deps, readRow, onClaimed } = loginDeps(27, registry);
      expect(await loginMod.readClaimedLoginDurables(deps, 27)).toEqual({
        row: { kind: 'claim_busy', plotIndex: 0, plotId },
        hearth: { kind: 'absent' },
      });
      expect(readRow).not.toHaveBeenCalled();
      expect(registry.all()).toEqual([]);
      expect(registry.counters).toMatchObject({ busy: 1, acquired: 0 });
      expect(onClaimed).not.toHaveBeenCalled();
      expect(await claimRow(plotId)).toEqual(before);
    });

    it('still claims the plot when the Hearth read faults, and answers the clock as thrown', async () => {
      const plotId = plot('login-fault');
      await seedPlot(28, plotId);
      const registry = reg.createFreeholdClaimRegistry();
      const { deps, readRow, onClaimed } = loginDeps(28, registry);
      // An SQL-level fault: the relation does not exist (42P01), which aborts
      // the first transaction before the claim half ever runs.
      const readHearth = vi.fn(async (db: FreeholdQueryable) => {
        await db.query('SELECT ready_at_ms FROM freehold_claim_pg_missing_relation');
        return { kind: 'absent' } as const;
      });
      const answer = await loginMod.readClaimedLoginDurables({ ...deps, readHearth }, 28);
      expect(answer.row).toMatchObject({ kind: 'row', row: { plotId, durableRev: '1' } });
      expect(answer.hearth.kind).toBe('threw');
      expect((answer.hearth as { error: { code?: string } }).error.code).toBe('42P01');
      expect(readHearth).toHaveBeenCalledTimes(1);
      expect(readRow).toHaveBeenCalledTimes(1);
      expect(registry.forPlot(plotId)).toEqual({
        plotId,
        accountId: 28,
        generation: '1',
        acquiredAtMs: 4_242,
      });
      expect(registry.counters).toMatchObject({ acquired: 1 });
      expect(onClaimed).toHaveBeenCalledTimes(1);
      expect(await claimRow(plotId)).toMatchObject({ holder: HOLDER_A, generation: '1' });
      // Not exercised here: a COMMIT whose answer cannot be proved (the claim
      // left unrecorded and the read thrown) needs the client destroyed after
      // COMMIT is sent, which this suite cannot do cheaply; the fake-client
      // suite pins it (freehold_mutation.test.ts, the budget cut at COMMIT).
    });

    it('refuses inside its budget on a pool with no free client, writes no claim, then serves once one frees', async () => {
      const plotId = plot('login-starved');
      await seedPlot(31, plotId);
      const tight = newPool(`${SCHEMA}_tight_login`, 1);
      const hog = await tight.connect();
      const registry = reg.createFreeholdClaimRegistry();
      const { deps, readRow, onClaimed } = loginDeps(31, registry);
      const starved = { ...deps, pool: tight, budgetMs: 400 };
      try {
        const started = Date.now();
        const err = await loginMod
          .readClaimedLoginDurables(starved, 31)
          .catch((error: unknown) => error);
        const elapsed = Date.now() - started;
        // THROWN, which the store answers with read_threw: a repairable hold
        // (the next login asks again), never a loss and never claim_busy.
        expect((err as Error).name).toBe('TimeoutError');
        const { FREEHOLD_RETRYABLE_HOLD_KINDS } = await import(
          '../../server/freehold_load_outcome'
        );
        expect(FREEHOLD_RETRYABLE_HOLD_KINDS.has('read_threw')).toBe(true);
        expect(elapsed).toBeGreaterThanOrEqual(350);
        expect(elapsed).toBeLessThan(1_500);
        expect(readRow).not.toHaveBeenCalled();
        expect(registry.all()).toEqual([]);
        expect(onClaimed).not.toHaveBeenCalled();
        expect(registry.counters).toMatchObject({ acquired: 0, busy: 0, loginReads: 1 });
        expect(await claimRow(plotId)).toBeNull();
      } finally {
        hog.release();
      }
      // The abandoned checkout is handed back, not leaked: the pool has ONE
      // client, which the refused read's checkout received when the hog let
      // go, so this read can only succeed (inside its own 400 ms budget) once
      // that checkout released it.
      await vi.waitFor(() => expect(tight.idleCount).toBe(1));
      expect(tight.totalCount).toBe(1);
      const answer = await loginMod.readClaimedLoginDurables(starved, 31);
      expect(answer.row).toMatchObject({ kind: 'row', row: { plotId, durableRev: '1' } });
      expect(tight.totalCount).toBe(1);
      expect(tight.idleCount).toBe(1);
      expect(tight.waitingCount).toBe(0);
      expect(registry.forPlot(plotId)).toMatchObject({ accountId: 31, generation: '1' });
      expect(onClaimed).toHaveBeenCalledWith(31);
      expect(await claimRow(plotId)).toMatchObject({ holder: HOLDER_A, live: true });
      await tight.end();
    });
  });

  it('reaches the primary keys for the acquire and the fenced CTE, the holder index for the shutdown release, never a sequential scan', async () => {
    const plotId = plot('plans');
    await seedPlot(29, plotId);
    const acquireCapture = recorder(poolA);
    expect(await acquire(acquireCapture.db, HOLDER_A, plotId, 29, LONG_TTL_SECONDS)).toMatchObject({
      kind: 'acquired',
    });
    expect(acquireCapture.calls.map((call) => call.text)).toEqual([
      claimDb.FREEHOLD_CLAIM_BUSY_SQL,
      claimDb.FREEHOLD_CLAIM_ACQUIRE_SQL,
    ]);
    const writeCapture = recorder(poolA);
    expect(
      await plotDb.upsertFencedFreehold(
        writeCapture.db,
        content(29, plotId, '1', MANOR),
        fenceOf(plotId, HOLDER_A, '1'),
      ),
    ).toEqual({ kind: 'updated', durableRev: '2' });
    expect(writeCapture.calls[0].text).toBe(plotDb.FREEHOLD_FENCED_CAS_SQL);

    // The claims heap's size in pages, read off disk (not pg_class).
    const heapPages = async (db: Pick<import('pg').Pool, 'query'>): Promise<number> =>
      (
        await db.query(
          `SELECT (pg_relation_size('${SCHEMA}.freehold_plot_claims')
                   / current_setting('block_size')::int)::int AS pages`,
        )
      ).rows[0].pages;
    let pagesBefore = 0;
    let pagesWithBulk = 0;
    const client = await poolA.connect();
    try {
      await client.query('BEGIN');
      pagesBefore = await heapPages(client);
      // A PRODUCTION-SHAPED claims table, inside this transaction only: one
      // realm's holder holds many claims, so `holder = $n` is far less
      // selective than the unique plot key, and fresh statistics say so. A
      // suite table of a handful of rows left the planner's pick between the
      // two usable indexes (the plot key and the holder index both serve the
      // fence) to whether autovacuum had analyzed it yet, so this pin flipped
      // under load. ANALYZE counts this transaction's own rows. The ROLLBACK
      // below takes the rows (their heap pages stay, dead) and the column
      // statistics away again, but NOT the page and row counts: ANALYZE
      // writes pg_class relpages and reltuples in place, outside any
      // transaction. So the finally resets them for every later case.
      await client.query(
        `INSERT INTO freehold_plot_claims
           (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
         SELECT 'plot:plansbulk' || g, 29, 'test', $1, 1, now(), now(), now() + interval '1 hour'
           FROM generate_series(1, 500) AS g`,
        [HOLDER_A],
      );
      pagesWithBulk = await heapPages(client);
      await client.query('ANALYZE freehold_plot_claims');
      await client.query('ANALYZE account_freeholds');
      // A table of a handful of rows is cheaper to read whole, so the planner
      // would rightly pick a Seq Scan and prove nothing; enable_seqscan = off
      // (transaction-scoped, rolled back below) asks whether each predicate CAN
      // reach an index, and which one.
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = async (text: string, values?: unknown[]) =>
        rootPlanFromExplainRow(
          (await client.query(`EXPLAIN (FORMAT JSON) ${text}`, values)).rows[0],
        );

      const busyPlan = await explain(acquireCapture.calls[0].text, acquireCapture.calls[0].values);
      expect(scansReach(busyPlan, 'freehold_plot_claims', 'freehold_plot_claims_pkey')).toEqual([
        'freehold_plot_claims_pkey',
      ]);
      // The upsert reads no claims row at all: its conflict arbiter is the PK.
      const upsertPlan = await explain(
        acquireCapture.calls[1].text,
        acquireCapture.calls[1].values,
      );
      expect(upsertPlan['Node Type']).toBe('ModifyTable');
      expect(
        (upsertPlan as unknown as Record<string, unknown>)['Conflict Arbiter Indexes'],
      ).toEqual(['freehold_plot_claims_pkey']);
      expect(relationScans(upsertPlan, 'freehold_plot_claims')).toEqual([]);

      // The fenced CTE: the fence and the stamp on the claims PK, the CAS on
      // the plot PK.
      const fencedPlan = await explain(writeCapture.calls[0].text, writeCapture.calls[0].values);
      expect(scansReach(fencedPlan, 'freehold_plot_claims', 'freehold_plot_claims_pkey')).toEqual([
        'freehold_plot_claims_pkey',
        'freehold_plot_claims_pkey',
      ]);
      expect(scansReach(fencedPlan, 'account_freeholds', 'account_freeholds_pkey')).toEqual([
        'account_freeholds_pkey',
      ]);

      // The login's plot-id pre-read, on the plot PK.
      const preReadPlan = await explain(plotDb.FREEHOLD_PRIMARY_PLOT_ID_SQL, [29]);
      expect(scansReach(preReadPlan, 'account_freeholds', 'account_freeholds_pkey')).toEqual([
        'account_freeholds_pkey',
      ]);

      // Negative control: a predicate no index serves still scans, and the
      // reader refuses it.
      const realmPlan = await explain('SELECT plot_id FROM freehold_plot_claims WHERE realm = $1', [
        REALM_A,
      ]);
      expect(scansReach(realmPlan, 'freehold_plot_claims', 'freehold_plot_claims_pkey')).toEqual([
        '"freehold_plot_claims" used Seq Scan instead of "freehold_plot_claims_pkey"',
      ]);

      // The shutdown release has no chunk bound, so BOTH of its reads of the
      // claims table must reach the holder index: the outer one too, which a
      // bare `plot_id IN (...)` left to a sequential scan of the whole table
      // once it grew (measured: workload-evidence.md).
      const releaseAllPlan = await explain(claimDb.FREEHOLD_CLAIM_RELEASE_ALL_SQL, [HOLDER_A]);
      expect(
        scansReach(releaseAllPlan, 'freehold_plot_claims', 'freehold_plot_claims_holder'),
      ).toEqual(['freehold_plot_claims_holder', 'freehold_plot_claims_holder']);

      // Every other claim statement, each read on an index, never a scan of
      // the keep-forever table. The chunked renew, release and re-reads may
      // take the plot key or the holder index (both serve them, and which one
      // is the planner's call at a given size: workload-evidence.md records a
      // BitmapAnd of the two on the grown table); the per-plot fences and
      // reads take the plot key; the export and the account cascade take the
      // account index.
      const pkey = 'freehold_plot_claims_pkey';
      const holderIdx = 'freehold_plot_claims_holder';
      const accountIdx = 'freehold_plot_claims_account';
      // A FULL chunk, as production sends it: 256 of the bulk ids above (the
      // chunk bound, FREEHOLD_CLAIM_RENEW_CHUNK), never a one-element array the
      // planner treats as a point lookup.
      expect(reg.FREEHOLD_CLAIM_RENEW_CHUNK).toBe(256);
      const chunk = Array.from({ length: 256 }, (_, i) => `plot:plansbulk${i + 1}`);
      const chunked: [string, string, unknown[]][] = [
        ['renew', claimDb.FREEHOLD_CLAIM_RENEW_SQL, [HOLDER_A, LONG_TTL_SECONDS, chunk]],
        ['release', claimDb.FREEHOLD_CLAIM_RELEASE_SQL, [HOLDER_A, chunk]],
        ['still held', claimDb.FREEHOLD_CLAIM_STILL_HELD_SQL, [HOLDER_A, chunk]],
        ['release read', claimDb.FREEHOLD_CLAIM_RELEASE_READ_SQL, [HOLDER_A, chunk]],
        ['release wait', claimDb.FREEHOLD_CLAIM_RELEASE_WAIT_SQL, [HOLDER_A, chunk]],
      ];
      for (const [name, text, values] of chunked) {
        const reads = scansReachOneOf(await explain(text, values), 'freehold_plot_claims', [
          pkey,
          holderIdx,
        ]);
        expect(reads.length, name).toBeGreaterThan(0);
        for (const read of reads) expect([pkey, holderIdx], `${name}: ${read}`).toContain(read);
      }
      const perPlot: [string, string, unknown[]][] = [
        ['read fence', claimDb.FREEHOLD_CLAIM_READ_FENCE_SQL, [plotId, HOLDER_A, '1']],
        ['write fence', claimDb.FREEHOLD_CLAIM_FENCE_SQL, [plotId, HOLDER_A, '1', 'a'.repeat(32)]],
        ['token lock', claimDb.FREEHOLD_CLAIM_TOKEN_LOCK_SQL, [plotId, HOLDER_A, '1']],
        ['verify read', claimDb.FREEHOLD_CLAIM_VERIFY_SQL, [plotId]],
      ];
      for (const [name, text, values] of perPlot) {
        expect(scansReach(await explain(text, values), 'freehold_plot_claims', pkey), name).toEqual(
          [pkey],
        );
      }
      const insertPlan = await explain(claimDb.FREEHOLD_CLAIM_INSERT_SQL, [
        plot('plansinsert'),
        29,
        REALM_A,
        HOLDER_A,
        'a'.repeat(32),
        LONG_TTL_SECONDS,
      ]);
      expect(
        (insertPlan as unknown as Record<string, unknown>)['Conflict Arbiter Indexes'],
      ).toEqual([pkey]);
      expect(relationScans(insertPlan, 'freehold_plot_claims')).toEqual([]);
      for (const [name, text] of [
        ['export', claimDb.FREEHOLD_CLAIM_EXPORT_SQL],
        // The accounts row's ON DELETE CASCADE, as the statement it runs.
        ['account cascade', 'DELETE FROM freehold_plot_claims WHERE account_id = $1'],
      ] as const) {
        expect(
          scansReach(await explain(text, [29]), 'freehold_plot_claims', accountIdx),
          name,
        ).toEqual([accountIdx]);
      }
      // RECORDED too: the renew chunk's whole plan shape at this size.
      const renewPlan = await explain(claimDb.FREEHOLD_CLAIM_RENEW_SQL, [
        HOLDER_A,
        LONG_TTL_SECONDS,
        [plotId],
      ]);
      expect(renewPlan['Node Type']).toBe('ModifyTable');
      console.info(`freehold claim renew chunk plan (seqscan off): ${planShape(renewPlan)}`);
    } finally {
      // On EVERY exit, a failing expect included: a client handed back with
      // this transaction open would carry its 500 uncommitted rows, its SET
      // LOCAL and its locks into later cases. One whose ROLLBACK fails goes
      // back as broken, so the pool destroys it.
      const rolledBack = await client.query('ROLLBACK').then(
        () => true,
        () => false,
      );
      client.release(!rolledBack);
      // VACUUM takes the rolled-back rows' dead pages away (it truncates the
      // heap, which no ANALYZE does), and both ANALYZEs rewrite the in-place
      // counts from what the tables now hold. The truncation needs an ACCESS
      // EXCLUSIVE lock on the table that PostgreSQL only polls for (it never
      // queues behind a holder, and gives up after a few seconds, leaving the
      // pages), so the page pin below holds only while NO transaction of this
      // run is open on freehold_plot_claims at this point. None is: the cases
      // run in sequence, every earlier one awaits each pass it starts and ends
      // each transaction it opens (a hand-begun one by ROLLBACK in its finally
      // before the client goes back; runFreeholdTransaction commits, rolls
      // back or destroys its own), this case's acquire and fenced write ran
      // in autocommit, and its one transaction was rolled back just above. (A
      // client whose ROLLBACK failed is destroyed instead, but that case has
      // already failed.)
      await poolA.query('VACUUM (ANALYZE) freehold_plot_claims');
      await poolA.query('ANALYZE account_freeholds');
    }
    // The reset left true counts behind: the planner's row count for the
    // claims table is the rows it holds, not this case's 500 rolled back.
    const counts = await probe.query(
      `SELECT c.reltuples::int AS reltuples, c.relpages::int AS relpages,
              (SELECT count(*)::int FROM ${SCHEMA}.freehold_plot_claims) AS live
         FROM pg_class c WHERE c.oid = '${SCHEMA}.freehold_plot_claims'::regclass`,
    );
    expect(counts.rows[0].live).toBe(1);
    expect(counts.rows[0].reltuples).toBe(counts.rows[0].live);
    // And its page count is the heap's, with the rolled-back rows' pages gone.
    // A bare ANALYZE also sets reltuples to 1, but it truncates nothing: it
    // would leave relpages at the size the bulk insert grew the heap to. Only
    // the VACUUM brings the heap back to at most its size before that insert:
    // every page the insert ADDED held its aborted rows alone (nothing else
    // writes this schema meanwhile), and an aborted row is removable whatever
    // any other backend's snapshot holds. The insert did grow it, so this is
    // not vacuous.
    expect(pagesWithBulk).toBeGreaterThan(pagesBefore);
    const pagesAfter = await heapPages(probe);
    expect(pagesAfter).toBeLessThanOrEqual(pagesBefore);
    expect(counts.rows[0].relpages).toBe(pagesAfter);
  });

  it('lets a login that began before a release committed take the released claim, where now() would refuse', async () => {
    const plotId = plot('clock');
    expect(await acquire(poolB, HOLDER_B, plotId, 30, LONG_TTL_SECONDS)).toMatchObject({
      generation: '1',
    });
    const login = await poolA.connect();
    try {
      await login.query('BEGIN');
      await login.query('SELECT now()');
      // The release commits AFTER the login transaction began.
      expect(await claimDb.releaseFreeholdClaimRows(poolB, HOLDER_B, [plotId])).toEqual(
        new Set([plotId]),
      );
      // Mutant controls: on now() (the transaction START) the released row
      // still reads as live, and the upsert's steal arm refuses it.
      const nowBusy = claimDb.FREEHOLD_CLAIM_BUSY_SQL.replaceAll('clock_timestamp()', 'now()');
      expect((await login.query(nowBusy, [plotId, HOLDER_A])).rowCount).toBe(1);
      await login.query('SAVEPOINT mutant');
      const nowAcquire = claimDb.FREEHOLD_CLAIM_ACQUIRE_SQL.replaceAll(
        'clock_timestamp()',
        'now()',
      );
      expect(
        (await login.query(nowAcquire, [plotId, 30, REALM_A, HOLDER_A, LONG_TTL_SECONDS])).rowCount,
      ).toBe(0);
      await login.query('ROLLBACK TO SAVEPOINT mutant');
      // The shipped statements read the clock now, so the login takes it.
      expect(await acquire(login, HOLDER_A, plotId, 30, LONG_TTL_SECONDS)).toEqual({
        kind: 'acquired',
        generation: '2',
        takeover: true,
      });
      await login.query('COMMIT');
    } finally {
      await login.query('ROLLBACK').catch(() => undefined);
      login.release();
    }
    expect(await claimRow(plotId)).toMatchObject({ holder: HOLDER_A, generation: '2', live: true });
  });
});
