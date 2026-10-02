# 07a workload evidence (2026-09-30)

The bounded-workload evidence the 07a packet's deliverable 5 asks for, beside the touch-set
manifest ([../../mutation-touch-set-manifest.md](../../mutation-touch-set-manifest.md),
section 10) and the real-PG suites that prove its interleaves
(`tests/server/freehold_claim.pg.test.ts`, `tests/server/freehold_mutation.pg.test.ts`).
Measured on the Linux host (about 2.1 times slower than the Mac, so compare these only with
each other) against a userspace PostgreSQL 16.14 on localhost, in a throwaway schema, driving
the REAL server modules. The script is below, so the run is repeatable.

## Results (5,000 owners, the shutdown drain's concurrency of 8)

| Path | Measured | Reading |
|---|---|---|
| 07's plain CAS (`upsertFreehold` UPDATE arm), 5,000 writes | 180 ms | the baseline the drain bound was set against |
| 07a fenced CAS (`upsertFencedFreehold`, ONE statement), 5,000 writes | 267 ms | about 1.5 times the plain CAS on the database side, still one round trip, so the store's 10,000 ms drain (`FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS`) is untouched by the fence; the drain's own measured 6,944 ms at 5,000 owners is store mechanics at a modeled 10 ms statement, which the real statement undercuts |
| the renewer, 5,000 wanted claims (20 chunks of 256) | 131 ms | renewed 5,000, missed 0, lost 0; one pass is ceil(H/256) short transactions for H wanted claims (20 here), each one renew statement plus a lock-free follow-up read only when SKIP LOCKED passed a row over, run one at a time on one pool client |
| the claimed login read, 500 logins at the store's load cap of 4 | p50 1.0 ms, p99 2.1 ms, max 2.9 ms | the three added statements (plot-id pre-read, busy pre-check, acquire) cost about a millisecond against the 2,000 ms login statement bound |
| the receipts export at 10,000 receipts for one account | Limit over an Index Scan of `freehold_operation_receipts_account`, 8 shared buffers, 0.071 ms | the ordered index serves the newest-first limit without reading the account's history |

## Verdict against the manifest's PASS rules

- Drain at 5,000 owners on the fenced write: PASS (the database half of the drain is 267 ms;
  the rest is the store's own bounded mechanics, unchanged by 07a).
- Renewer at 5,000 wanted plots: PASS (131 ms here, and a median 138 ms per pass against the
  grown 201,000-row table below, far inside the pass deadline, the 30 s cadence and the 90 s TTL).
- Receipts export at 10,000 receipts: PASS (index-ordered limit, no sort).
- Login floor: the added statements are about 1 ms at p99 here; the contract's re-derived floor
  counts them by their statement bound, not by this measurement.

The renewer against a GROWN claims table is measured in the next section; the P9 hold
against a concurrent `characters` UPDATE, two admitted processes racing, the renewer beside the
autosave burst, the claimed login read on the grown table, and a first-rollout boot with an old
realm serving are measured in "Contention and the first-rollout boot" below.

## Grown claims table (201,000 rows, 61 holders)

The claims table is keep-forever (one row per plot id ever claimed, a release keeps the row),
so the renewer's and the release's statements were re-measured against a table grown the way
production grows it: 201,000 ANALYZEd rows (63 MB with indexes) across 61 holders, of which
190,000 are RELEASED (holder ending `#released`, expired), 6,000 are live under 60 other holders
(100 each), and 5,000 are live under the bench holder. Plot ids are md5-spread like minted ids,
so a chunk's rows sit on random pages. Each statement ran under `EXPLAIN (ANALYZE, BUFFERS)` in a
transaction that was rolled back, with the parameters the renewer sends (the holder, the TTL and
the first 256 of the holder's ids in sort order); the renewer itself is the REAL
`renewFreeholdClaims` at 5,000 wanted claims, with a wanted predicate of the wiring's shape (the
owner key, the store map, the sim map, the in-flight map, the young-claim age).

| Statement or path | Plan on the grown table | Buffers | Time |
|---|---|---|---|
| `FREEHOLD_CLAIM_RENEW_SQL`, one 256-id chunk | Nested Loop: the locked subselect is a BitmapAnd of `freehold_plot_claims_holder` and `freehold_plot_claims_pkey`, the outer an Index Scan of `freehold_plot_claims_pkey` per id | 2,952 hit | 5.8 ms |
| `FREEHOLD_CLAIM_STILL_HELD_SQL`, 256 ids | Bitmap Heap Scan over the same BitmapAnd | 904 hit | 1.3 ms |
| `FREEHOLD_CLAIM_RELEASE_SQL`, 256 ids | Nested Loop, same shape as the renew | 5,516 hit | 7.6 ms |
| `FREEHOLD_CLAIM_RELEASE_ALL_SQL`, the holder's 5,000 live claims, AS SHIPPED | Hash Semi Join whose outer is a **Seq Scan of all 201,000 rows** (the locked subselect on `freehold_plot_claims_holder`) | 80,383 hit, 5,370 of them the scan | 264 ms |
| `FREEHOLD_CLAIM_RELEASE_ALL_SQL`, FIXED (outer `holder = $1`) | Hash Semi Join whose outer is a Bitmap Heap Scan of `freehold_plot_claims_holder` (5,000 rows, 1,148 heap blocks) | 75,765 hit, 1,154 of them the outer read | 118 ms |
| the renewer, one pass at 5,000 wanted claims (20 chunks) | 20 transactions in sequence on one client | | median 138 ms over 7 passes (134 to 146); renewed 35,000, missed 0, lost 0, skipped 0, abandoned 0 |
| the renewer's synchronous part before its first await | one copy, one sort, 5,000 wanted tests, the pending sweep, the first chunk's checkout call | | median 1.4 ms (2.1 ms on the cold first pass); 1.0 ms with the checkout taken out |

Readings:

- **One finding, fixed.** The shutdown release had no chunk bound, so its subselect returns
  every live claim of the holder and the planner served the bare `plot_id IN (...)` with a hash
  semi join over a sequential scan of the whole keep-forever table: a cost that grows with the
  table's age, not with this process's claims. The outer `holder = $1` qual (now in
  `FREEHOLD_CLAIM_RELEASE_ALL_SQL`, with the reason at the constant) gives that read the holder
  index; the plan suite pins that both reads reach `freehold_plot_claims_holder`
  (`tests/server/freehold_claim.pg.test.ts`, the plan case), and that pin fails on the old text.
  The remaining 118 ms is the 5,000 row writes themselves (a release rewrites `holder`, which is
  indexed, so those versions are not HOT), inside the release's 2,000 ms deadline.
- **The chunked statements are bounded by their array.** With at most 256 ids the planner
  estimates a handful of rows and probes the primary key per id; a larger table only makes the
  sequential alternative dearer, so their cost follows the chunk, not the table.
- **The holder index stays selective as the table grows.** A released row is renamed
  `holder#released`, so the live holder's key in `freehold_plot_claims_holder` covers only the
  rows this boot still holds; the 190,000 released rows sit under other keys.
- **The pass cost follows H, not the table.** 138 ms for 5,000 claims is about 7 ms per chunk,
  a few hundred times inside the pass deadline (`FREEHOLD_CLAIM_RENEW_PASS_DEADLINE_MS`) and the
  30 s cadence. The pass is single-flight and holds one pool client at a time, so a brownout
  that stretches it skips triggers (counted) rather than stacking clients.

## Contention and the first-rollout boot (2026-10-01)

Measured in the 07a QA on the same host and server, each run in its own throwaway schema or
database. Two pools of 10 (the realm's `DB_POOL_MAX_CLIENTS`) stand in for two admitted realm
processes, each with its own holder, over a claims table grown to 198,500 rows (62 MB). Every
path reports three things: lock-wait samples (`pg_stat_activity` polled every 10 ms, attributed
by statement text and process, so a sample is about 10 ms of one backend waiting), every
SQLSTATE it threw, and the registry's own contention counters. A character save is modeled as
its row UPDATE plus, where stated, a hold standing in for its other statements. Two limits on
reading it: the 10 ms sampler sees a wait shorter than 10 ms only with a probability equal to
its share of the interval, so "none" bounds a path's total lock wait to about one sample, not
to zero; and the two "processes" are two pools in one Node event loop, so a client-side
latency includes the other pool's JavaScript work.

| Path | Load | Measured | Lock waits, errors |
|---|---|---|---|
| the claimed login read over a RELEASED row (a re-claim) | 2,500 reads at the store's load cap of 4, grown table | p50 1.2 ms, p99 2.4 ms, max 10.5 ms | none, none |
| the claimed login read, a first claim (insert) | 2,500 reads, same | p50 1.0 ms, p99 1.4 ms, max 2.6 ms | none, none |
| the renewer at 5,000 wanted claims BESIDE the autosave burst (5,000 saves and 5,000 fenced writes, 4 workers each) | 3 cycles | pass 165, 203, 173 ms; renewed 5,000 each, missed 0, lost 0, lock timeouts 0, abandoned 0; saves p99 at most 0.8 ms | none, none |
| two processes racing for 1,000 plots for 15 s (A's sessions end over the first 10 s, B logs each in at a random moment and retries a busy answer after 1 s; both renew every 1 s and flush every 3 s) | 3,071 B login reads | B acquired all 1,000 after 2,071 busy answers (at most 11 for one plot); A released 1,000, lost 0, missed 3; B login p50 0.7 ms, p99 1.8 ms | fenced write about 40 ms per process in total; none thrown, no 55P03, no 57014 |
| the P9 verify (`FREEHOLD_VERIFY_WAIT_SQL` under `FREEHOLD_VERIFY_BOUNDS`) behind an in-flight save holding the row 20 ms, with the next save queued 5 ms later | 500 characters, 3 at a time | verify wait p50 15.3 ms, p99 16.4 ms; the queued save p50 10.7 ms, p99 11.6 ms, the SAME as the no-verify control (10.7, 11.6) | the waits the hold explains; none thrown |
| the renewer's SYNCHRONOUS launch (what the flush bills to the profiler's `saves` bucket), the REAL `renewFreeholdClaims` against a checkout that never answers, its wanted predicate a stand-in of the wiring's shape (map reads, the store's `wantsClaim` among them) | 5,000 held claims, 2,500 of them unwanted (the release partition too); the cold FIRST launch, then 200 warm ones after 20 more | the cold first 4.5 to 4.7 ms over three runs; warm p50 2.3 ms, p99 2.9 to 4.2 ms; inside one 50 ms tick either way | not a database path |

The boot runs used the REAL `ensureSchema()` in a throwaway database while an old realm served
8 save workers and one account create-then-delete cycle every 20 ms. Three save shapes, because
the deadlock below depends on which locks a save takes first; half the workers take the shape,
the other half save plain:
- PLAIN: every save is its row UPDATE plus 5 ms.
- G1: the order every effect-carrying and every hooked save takes (the manifest's G1 then G2):
  `accounts` FOR KEY SHARE, then the `characters` row FOR NO KEY UPDATE, then the UPDATE plus
  5 ms.
- G2: the `characters` row FOR NO KEY UPDATE, then the UPDATE plus 5 ms, with no `accounts`
  lock at all, which isolates the single-table path below.

The workers save as fast as they can, hundreds of saves a second, far above a realm's rate, so
the runs bound the hazard from above rather than model a realm. Two modes:
- ROLLOUT: an earlier `ensureSchema()` built the database, the 07a objects were then removed (a
  07 realm's database), and each round is a first-rollout boot followed by a second boot.
- STEADY: the schema is committed and checked (`freehold_operations` exists) before every boot,
  so each boot is a true steady-state boot.

| Mode, save shape | Boots | Boots that committed | 40P01 aborts | Old-realm saves through the boot windows |
|---|---|---|---|---|
| rollout, plain (two runs) | 16 | 16, about 55 to 66 ms each when no deadlock formed | 3 old account creates (each boot waited out `deadlock_timeout` and lived) | p99 at most 63.6 ms outside the deadlocked boots (the queue behind the boot) |
| rollout, G1 | 10 | NONE. No boot committed, so each "second" boot of a round was another first-rollout attempt: 10 consecutive first-rollout attempts, each aborted (5 at once, in 11 to 15 ms; 5 after one or two `deadlock_timeout` waits, 1 to 2 s) | 10 boots, 29 G1 saves, 3 account creates | p99 up to 1,010 ms; the slowest save of the run 2,011 ms |
| steady, plain | 6 | 6 (55 to 59 ms; one waited out `deadlock_timeout`, 1,056 ms) | 1 old account create | |
| steady, G2 (no `accounts` lock) | 6 | 4, each after waiting out `deadlock_timeout` (about 1,070 ms) | 2 boots (one at once, in 13 ms; one after 2 s), 19 G2 saves, 4 account creates | |
| steady, G1 | 6 | NONE (4 at once, in 12 to 13 ms; 2 after about 2 s) | 6 boots, 14 G1 saves, 1 account create | |

Readings:

- **No path threw a lock or statement timeout.** No 55P03 and no 57014 on any path in any phase;
  the only SQLSTATE in any run is the boot deadlock below.
- **The renewer's main-thread launch is a few milliseconds at 5,000 claims.** About 4.5 ms cold
  (the first flush after a boot) and a p99 near 4 ms warm, with half the claims unwanted, is what
  the flush bills to `saves` for this job. The per-chunk continuations after its first await
  bill no profiler phase (they land in `lateness`), each O(one renew or release chunk) of work.
- **The renewer and the autosave do not collide.** SKIP LOCKED passed over no row in three
  cycles beside a full burst, and the pass took 165 to 203 ms against the 30 s cadence.
- **The race resolves through release, not takeover.** B's busy answers end when A's renewer
  releases an unwanted claim, B never takes a live one, and A loses nothing. The three heartbeats
  A missed were rows another statement held at that instant (SKIP LOCKED passed them over), each
  renewed on the next pass.
- **The P9 hold costs the next save nothing.** The verify waits only as long as the save it is
  verifying holds the row, and the save queued behind both finishes exactly when it does without
  the verify.
- **The first rollout adds no boot lock.** Every boot, steady state included, already takes
  ACCESS EXCLUSIVE on `characters` and then `accounts` and holds both to its COMMIT: the core
  `SCHEMA` runs `ALTER TABLE characters ADD COLUMN IF NOT EXISTS` before
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS`, and a no-op `ADD COLUMN IF NOT EXISTS` still
  takes ACCESS EXCLUSIVE (probed on this server). So the housing fragments' trigger creation runs
  under locks the boot already holds, and a first-rollout boot measures the same as a steady one.
- **Any boot can deadlock on two paths.** The boot takes `characters` and then `accounts`, and
  its first lock on `characters` is SHARE (the core `CREATE INDEX IF NOT EXISTS
  characters_account`), upgraded to ACCESS EXCLUSIVE by the very next statement:
  - THE UPGRADE PATH, one table: a save that takes its `characters` row lock (FOR NO KEY UPDATE,
    the G2 step) beside the boot's SHARE, then UPDATEs, waits on the SHARE while the boot's
    upgrade waits on that row lock. No `accounts` lock takes part: the G2 shape alone aborted 2
    of 6 steady boots, one of them at once, which only this path explains (PostgreSQL's
    immediate check, as a backend joins a lock's queue, sees only that one lock's waiters).
  - THE ORDER PATH, two tables: ACCESS EXCLUSIVE conflicts with every lock mode, so ANY lock
    held on `accounts` (a plain read's, the G1 FOR KEY SHARE) by a transaction that then asks
    for ANY lock on `characters` closes the cycle once the boot holds `characters` and waits on
    `accounts`. That is the order every effect-carrying and hooked save (G1 then G2), the
    operation prepare and the character delete take.
- **Both sides lose, and under G1 the boot loses every time.** With plain saves the boot lived and
  an old account create lost, 4 times in 22 boots. With G1-shaped saves in flight EVERY boot was
  eventually aborted, 16 of 16 across both modes (9 of them at once, in 11 to 15 ms; the other 7
  after one or two `deadlock_timeout` waits), and saves were aborted beside them: 43 G1 saves and 4
  account creates. A boot that fails exits the process (`server/main.ts`) and the compose policy
  restarts it: the rollout run's 10 consecutive failed attempts are what such a restart loop
  looks like while the load lasts. At a real realm's save rate the window is far narrower than
  this bench's, but a realm booting while another realm on the same database serves those saves
  can fail to start, and players on the serving realm lose those saves and Hearth trips.
- **It predates housing; 07a adds members; the owed fix has two halves.** The hazard is the core
  schema's lock order against the G1 and G2 orders that storage and bank-ledger saves already
  took. 07a adds the Hearth trip's hooked save (and, once a kind exists, operation prepares and
  closes) to the class and changes nothing about the boot. A fix must remove BOTH paths: the
  boot's SHARE-then-upgrade on `characters` (probe the core `characters_account` index the way the
  housing indexes are probed, or take ACCESS EXCLUSIVE on `characters` first), and the
  `characters`-then-`accounts` order (taking `accounts` first would expose a character INSERT's
  `characters`-then-`accounts` foreign-key order instead). It is a maintainer decision, recorded
  as owed.

## The script

Bundle with `npx esbuild <script> --bundle --platform=node --format=cjs --external:pg` from
this directory and run with `NODE_PATH=<repo>/node_modules`.

```ts
// 07a workload evidence against the scratch PostgreSQL 16 (never a shared DB):
// the shutdown-drain shape on the fenced CAS against 07's plain CAS, the
// renewer at 5,000 wanted claims, the claimed login read, and the receipts
// export plan at 10,000 receipts. Drives the REAL server modules.
import { Pool } from 'pg';
import { acquireFreeholdClaim, freeholdClaimSchema } from '../../../../server/freehold_claim_db';
import { createFreeholdClaimRegistry, renewFreeholdClaims } from '../../../../server/freehold_claim_registry';
import { readClaimedLoginDurables } from '../../../../server/freehold_claim_login';
import {
  freeholdForAccount,
  freeholdSchema,
  upsertFencedFreehold,
  upsertFreehold,
} from '../../../../server/freehold_db';
import { freeholdHearthSchema, loadFreeholdHearth } from '../../../../server/freehold_hearth_db';
import { freeholdOperationSchema, FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL } from '../../../../server/freehold_operation_db';

const URL = 'postgres://postgres:postgres@127.0.0.1:55432/wocc_ci';
const SCHEMA = 'bench07a';
const N = Number(process.env.N ?? 5000);
const HOLDER = 'bench#holder';

async function main() {
  const admin = new Pool({ connectionString: URL, max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  const pool = new Pool({ connectionString: URL, max: 10, options: `-c search_path=${SCHEMA}` });
  await pool.query('CREATE TABLE accounts (id SERIAL PRIMARY KEY, deactivated_at TIMESTAMPTZ)');
  await pool.query('CREATE TABLE characters (id SERIAL PRIMARY KEY, account_id INT REFERENCES accounts(id) ON DELETE CASCADE)');
  for (const ddl of [freeholdSchema(SCHEMA), freeholdHearthSchema(SCHEMA), freeholdClaimSchema(SCHEMA), freeholdOperationSchema(SCHEMA)]) await pool.query(ddl);
  await pool.query(`INSERT INTO accounts (id) SELECT g FROM generate_series(1, ${N}) g`);
  const plot = (i: number) => `plot:bench${String(i).padStart(6, '0')}`;
  const doc = (i: number, rev: number, expected: string | null) => ({
    accountId: i, plotIndex: 0, plotId: plot(i), tier: 'inn_room', layoutJson: '[]', trophiesJson: '[]',
    condition: 100, visitPolicy: 'closed', wireRev: rev, schemaVersion: 1, expectedDurableRev: expected,
  });
  // Seed rows and claims.
  for (let i = 1; i <= N; i++) await upsertFreehold(pool, doc(i, 0, null));
  const registry = createFreeholdClaimRegistry();
  for (let i = 1; i <= N; i++) {
    const c = await acquireFreeholdClaim(pool, { plotId: plot(i), accountId: i, realm: 'bench', holder: HOLDER, ttlSeconds: 90 });
    if (c.kind !== 'acquired') throw new Error('seed acquire');
    registry.record({ plotId: plot(i), accountId: i, generation: c.generation, acquiredAtMs: 0 });
  }
  await pool.query('ANALYZE');
  const drain = async (label: string, write: (i: number) => Promise<unknown>) => {
    const t0 = performance.now();
    let next = 1;
    const workers = Array.from({ length: 8 }, async () => {
      while (next <= N) { const i = next++; await write(i); }
    });
    await Promise.all(workers);
    console.log(`${label}: ${N} writes at concurrency 8 in ${(performance.now() - t0).toFixed(0)} ms`);
  };
  // 07's plain CAS (the baseline), then the fenced CAS, each one revision on.
  await drain('07 plain CAS (upsertFreehold UPDATE arm)', (i) => upsertFreehold(pool, doc(i, 1, '1')));
  await drain('07a fenced CAS (upsertFencedFreehold, one statement)', (i) =>
    upsertFencedFreehold(pool, doc(i, 2, '2'), { plotId: plot(i), holder: HOLDER, generation: '1', writeToken: 'a'.repeat(32) }));
  // The renewer at N wanted claims.
  {
    const t0 = performance.now();
    await renewFreeholdClaims({ registry, pool, holder: HOLDER, ttlSeconds: 90, wanted: () => true, nowMs: () => 0, warn: console.warn });
    console.log(`renewer: ${N} wanted claims in ${(performance.now() - t0).toFixed(0)} ms (renewed ${registry.counters.renewed}, missed ${registry.counters.missedHeartbeats}, lost ${registry.counters.lost})`);
  }
  // The claimed login read: 500 logins, concurrency 4 (the store's load cap).
  {
    const lat: number[] = [];
    let next = 1;
    const workers = Array.from({ length: 4 }, async () => {
      while (next <= 500) {
        const i = next++;
        const t0 = performance.now();
        await readClaimedLoginDurables({
          pool, registry, holder: HOLDER, realm: 'bench', ttlSeconds: 90,
          readRow: (db) => freeholdForAccount(db, i, 106496),
          readHearth: (db) => loadFreeholdHearth(db, i),
          nowMs: () => 0,
        }, i);
        lat.push(performance.now() - t0);
      }
    });
    await Promise.all(workers);
    lat.sort((a, b) => a - b);
    console.log(`claimed login read: 500 at concurrency 4, p50 ${lat[249].toFixed(1)} ms, p99 ${lat[494].toFixed(1)} ms, max ${lat[499].toFixed(1)} ms`);
  }
  // The receipts export plan at 10,000 receipts for one account.
  {
    await pool.query(`INSERT INTO freehold_operation_receipts (operation_id, account_id, plot_id, kind, outcome, fingerprint, applied_durable_rev, closed_at)
      SELECT 'fop:' || lpad(g::text, 32, '0'), 1, '${plot(1)}', 'bench_kind', 'applied', repeat('f', 64), g, now() - make_interval(secs => g)
        FROM generate_series(1, 10000) g`);
    await pool.query('ANALYZE freehold_operation_receipts');
    const plan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL.replace('$1', '1').replace('$2', '201')}`);
    console.log('receipts export plan at 10,000 receipts:');
    for (const row of plan.rows) console.log('  ' + row['QUERY PLAN']);
  }
  await pool.end();
  const cleanup = new Pool({ connectionString: URL, max: 1 });
  await cleanup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await cleanup.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

## The grown-table script

Built and run the same way as the script above.

```ts
// 07a grown-claims-table evidence against the scratch PostgreSQL 16 (never a
// shared DB, its own schema, dropped after): a freehold_plot_claims table of
// about 200,000 ANALYZEd rows across 61 holders, most of them RELEASED
// (holder ending '#released'), plus 5,000 live rows for the bench holder and
// 100 live rows for each of 60 other holders. Then the EXPLAIN (ANALYZE,
// BUFFERS) of the renewer's and the release's statements with realistic
// parameters, and the REAL renewFreeholdClaims at 5,000 wanted claims: the
// per-pass wall time and the synchronous part before its first await.
import { Pool } from 'pg';
import {
  FREEHOLD_CLAIM_RELEASE_ALL_SQL,
  FREEHOLD_CLAIM_RELEASE_SQL,
  FREEHOLD_CLAIM_RENEW_SQL,
  FREEHOLD_CLAIM_STILL_HELD_SQL,
  freeholdClaimSchema,
} from '../../../../server/freehold_claim_db';
import {
  createFreeholdClaimRegistry,
  FREEHOLD_CLAIM_RENEW_CHUNK,
  renewFreeholdClaims,
} from '../../../../server/freehold_claim_registry';

const URL = 'postgres://postgres:postgres@127.0.0.1:55432/wocc_ci';
const SCHEMA = 'c_bench07a_grown';
const RELEASED = Number(process.env.RELEASED ?? 190_000);
const OTHER_HOLDERS = 60;
const OTHER_LIVE_EACH = 100;
const MINE = 5_000;
const HOLDER = 'bench#holder';

/** The wiring's predicate shape (server/freehold_persist_wiring.ts): the owner
 *  key (the same check freeholdOwnerKeyForAccount makes), the store's map, the
 *  sim's map, the in-flight map, the young-claim age. Inlined so the bench
 *  pulls no sim modules. */
function ownerKey(accountId: number): string {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('bad account');
  return `account:${accountId}`;
}

async function main() {
  const admin = new Pool({ connectionString: URL, max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  const pool = new Pool({ connectionString: URL, max: 10, options: `-c search_path=${SCHEMA}` });
  try {
    const total = RELEASED + OTHER_HOLDERS * OTHER_LIVE_EACH + MINE;
    await pool.query('CREATE TABLE accounts (id SERIAL PRIMARY KEY)');
    await pool.query(freeholdClaimSchema(SCHEMA));
    await pool.query(`INSERT INTO accounts (id) SELECT g FROM generate_series(1, ${total}) g`);
    // 60 other holders, REALM#uuid-shaped; released rows rotate across them.
    const holderExpr = (g: string) =>
      `'realm' || ((${g}) % 6) || '#' || md5('holder' || ((${g}) % ${OTHER_HOLDERS}))::uuid`;
    const t0 = performance.now();
    await pool.query(
      `INSERT INTO freehold_plot_claims
         (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
       SELECT 'plot:' || md5('released' || g), g, 'realm' || (g % 6),
              ${holderExpr('g')} || '#released', 1 + (g % 5),
              now() - interval '30 days', now() - interval '1 day', now() - interval '1 day'
         FROM generate_series(1, ${RELEASED}) g`,
    );
    await pool.query(
      `INSERT INTO freehold_plot_claims
         (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
       SELECT 'plot:' || md5('other' || g), ${RELEASED} + g, 'realm' || (g % 6),
              ${holderExpr('g')}, 1, now(), now(), now() + interval '90 seconds'
         FROM generate_series(1, ${OTHER_HOLDERS * OTHER_LIVE_EACH}) g`,
    );
    const base = RELEASED + OTHER_HOLDERS * OTHER_LIVE_EACH;
    await pool.query(
      `INSERT INTO freehold_plot_claims
         (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
       SELECT 'plot:' || md5('mine' || g), ${base} + g, 'bench', '${HOLDER}', 1,
              now(), now(), now() + interval '90 seconds'
         FROM generate_series(1, ${MINE}) g`,
    );
    await pool.query('ANALYZE freehold_plot_claims');
    const shape = (
      await pool.query(
        `SELECT count(*)::int AS rows,
                count(DISTINCT regexp_replace(holder, '#released$', ''))::int AS holders,
                count(*) FILTER (WHERE holder LIKE '%#released')::int AS released,
                count(*) FILTER (WHERE holder = $1)::int AS mine,
                pg_size_pretty(pg_total_relation_size('freehold_plot_claims')) AS size
           FROM freehold_plot_claims`,
        [HOLDER],
      )
    ).rows[0];
    console.log(
      `seeded in ${(performance.now() - t0).toFixed(0)} ms: ${JSON.stringify(shape)} (ANALYZEd)`,
    );

    const mine = (
      await pool.query(
        'SELECT plot_id, account_id FROM freehold_plot_claims WHERE holder = $1 ORDER BY plot_id',
        [HOLDER],
      )
    ).rows as { plot_id: string; account_id: number }[];
    const chunk = mine.slice(0, FREEHOLD_CLAIM_RENEW_CHUNK).map((r) => r.plot_id);
    const explain = async (label: string, sql: string, values: unknown[]) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, values);
        await client.query('ROLLBACK');
        console.log(`\n${label}:`);
        for (const row of plan.rows) console.log(`  ${row['QUERY PLAN']}`);
        const text = plan.rows.map((r) => String(r['QUERY PLAN'])).join('\n');
        if (/Seq Scan on freehold_plot_claims/.test(text)) {
          console.log(`  FINDING: ${label} reads the grown table by sequential scan`);
        }
      } finally {
        client.release();
      }
    };
    await explain('FREEHOLD_CLAIM_RENEW_SQL, one 256-id chunk', FREEHOLD_CLAIM_RENEW_SQL, [
      HOLDER,
      90,
      chunk,
    ]);
    await explain('FREEHOLD_CLAIM_STILL_HELD_SQL, 256 ids', FREEHOLD_CLAIM_STILL_HELD_SQL, [
      HOLDER,
      chunk,
    ]);
    await explain('FREEHOLD_CLAIM_RELEASE_SQL, 256 ids', FREEHOLD_CLAIM_RELEASE_SQL, [
      HOLDER,
      chunk,
    ]);
    await explain(
      'FREEHOLD_CLAIM_RELEASE_ALL_SQL, the 5,000 live claims of the holder',
      FREEHOLD_CLAIM_RELEASE_ALL_SQL,
      [HOLDER],
    );

    // The REAL renewer at 5,000 wanted claims on that table.
    const registry = createFreeholdClaimRegistry();
    for (const row of mine) {
      registry.record({
        plotId: row.plot_id,
        accountId: row.account_id,
        generation: '1',
        acquiredAtMs: 0,
      });
    }
    const storeRefs = new Map<string, number>(mine.map((r) => [ownerKey(r.account_id), 1]));
    const simLive = new Map<string, unknown>();
    const deps = {
      registry,
      pool,
      holder: HOLDER,
      ttlSeconds: 90,
      wanted: (claim: { plotId: string; accountId: number; acquiredAtMs: number }, now: number) => {
        const key = ownerKey(claim.accountId);
        return (
          (storeRefs.get(key) ?? 0) > 0 ||
          simLive.has(key) ||
          registry.inFlight(claim.plotId) ||
          now - claim.acquiredAtMs < 10_000
        );
      },
      nowMs: () => Date.now(),
      warn: (m: string) => console.warn(m),
    };
    const walls: number[] = [];
    const syncs: number[] = [];
    for (let pass = 0; pass < 7; pass++) {
      const start = performance.now();
      const running = renewFreeholdClaims(deps);
      syncs.push(performance.now() - start);
      await running;
      walls.push(performance.now() - start);
    }
    const c = registry.counters;
    const fmt = (xs: number[]) => xs.map((x) => x.toFixed(2)).join(', ');
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    console.log(
      `\nrenewer, ${mine.length} wanted claims (${Math.ceil(mine.length / FREEHOLD_CLAIM_RENEW_CHUNK)} chunks), 7 passes:`,
    );
    console.log(`  per-pass wall ms: ${fmt(walls)} (median ${median(walls).toFixed(1)})`);
    console.log(`  synchronous part before the first await, ms: ${fmt(syncs)} (median ${median(syncs).toFixed(2)})`);
    console.log(
      `  counters: renewed ${c.renewed}, missed ${c.missedHeartbeats}, lost ${c.lost}, passes ${c.renewPasses}, skipped ${c.renewPassesSkipped}, abandoned ${c.renewChunksAbandoned}, pass ms total ${c.renewPassMsTotal}`,
    );
    // The synchronous part alone, isolated from the pool: a pool whose
    // checkout never answers, so the call returns at the first await.
    const isolated = createFreeholdClaimRegistry();
    for (const claim of registry.all()) isolated.record(claim);
    const stuck = { connect: () => new Promise<never>(() => {}) };
    const isolatedSyncs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const fresh = createFreeholdClaimRegistry();
      for (const claim of isolated.all()) fresh.record(claim);
      const start = performance.now();
      void renewFreeholdClaims({ ...deps, registry: fresh, pool: stuck });
      isolatedSyncs.push(performance.now() - start);
    }
    console.log(
      `  synchronous part alone (checkout never answers), ms: ${fmt(isolatedSyncs)} (median ${median(isolatedSyncs).toFixed(2)})`,
    );
  } finally {
    await pool.end();
    const cleanup = new Pool({ connectionString: URL, max: 1 });
    await cleanup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await cleanup.end();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
```

## The contention script

Built and run the same way as the scripts above (the first-rollout boot script below loads
`server/db` dynamically, so bundle it with a `node_modules` reachable from the bundle's own
directory: Node's ESM loader ignores `NODE_PATH`).

```ts
// 07a contention evidence against the scratch PostgreSQL 16 (never a shared
// DB; its own schema, dropped after). Two pools of 10 stand in for two admitted
// realm processes, each with its own holder. Drives the REAL claim, login,
// renewer, fenced-write, verify and transaction modules over a claims table
// grown to about 200,000 rows, and reports per path: the lock-wait samples
// (pg_stat_activity polled every 10 ms, attributed by statement text), every
// SQLSTATE a path threw, and the registry's own contention counters.
import { Pool, type PoolClient } from 'pg';
import {
  FREEHOLD_CLAIM_ACQUIRE_SQL,
  FREEHOLD_CLAIM_BUSY_SQL,
  FREEHOLD_CLAIM_INSERT_SQL,
  FREEHOLD_CLAIM_RELEASE_SQL,
  FREEHOLD_CLAIM_RENEW_SQL,
  FREEHOLD_CLAIM_STILL_HELD_SQL,
  freeholdClaimSchema,
  mintFreeholdWriteToken,
} from '../../../../server/freehold_claim_db';
import { readClaimedLoginDurables } from '../../../../server/freehold_claim_login';
import {
  createFreeholdClaimRegistry,
  type FreeholdClaimRegistry,
  renewFreeholdClaims,
} from '../../../../server/freehold_claim_registry';
import {
  FREEHOLD_FENCED_CAS_SQL,
  FREEHOLD_PRIMARY_PLOT_ID_SQL,
  freeholdForAccount,
  freeholdSchema,
  upsertFencedFreehold,
  upsertFreehold,
} from '../../../../server/freehold_db';
import { freeholdHearthSchema, loadFreeholdHearth } from '../../../../server/freehold_hearth_db';
import { FREEHOLD_VERIFY_BOUNDS } from '../../../../server/freehold_mutation';
import { FREEHOLD_VERIFY_WAIT_SQL } from '../../../../server/freehold_mutation_db';
import { freeholdOperationSchema } from '../../../../server/freehold_operation_db';
import { runFreeholdTransaction } from '../../../../server/freehold_tx';

const URL = process.env.BENCH_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/wocc_ci';
const SCHEMA = 'bench07a_race';
const N = 5_000;
const RELEASED_OTHER = 190_000;
const OTHER_HOLDERS = 60;
const OTHER_LIVE_EACH = 100;
const TTL = 90;
const HOLDER_A = 'realma#0b8d5c1e-8f3c-4c55-9a51-6a0f5d1c2b01';
const HOLDER_B = 'realmb#5e1f2a4b-1d7c-4e0a-8a1e-2c9b7d3f4a02';
const SAVE_SQL = `UPDATE characters SET state = jsonb_build_object('tick', $2::int), level = level, updated_at = now() WHERE id = $1`;
const SAVE_HOLD_SQL = 'SELECT pg_sleep($1::float8)';

const plot = (i: number) => `plot:bench${String(i).padStart(6, '0')}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (xs: number[]) =>
  `n ${xs.length}, p50 ${pct(xs, 50).toFixed(1)} ms, p99 ${pct(xs, 99).toFixed(1)} ms, max ${(xs.length ? Math.max(...xs) : 0).toFixed(1)} ms`;

// ---- per-path accounting ---------------------------------------------------
const LABELS: [string, string][] = [
  ['claim acquire', FREEHOLD_CLAIM_ACQUIRE_SQL],
  ['claim insert', FREEHOLD_CLAIM_INSERT_SQL],
  ['claim busy pre-check', FREEHOLD_CLAIM_BUSY_SQL],
  ['plot-id pre-read', FREEHOLD_PRIMARY_PLOT_ID_SQL],
  ['renew', FREEHOLD_CLAIM_RENEW_SQL],
  ['renew follow-up', FREEHOLD_CLAIM_STILL_HELD_SQL],
  ['release', FREEHOLD_CLAIM_RELEASE_SQL],
  ['fenced write', FREEHOLD_FENCED_CAS_SQL],
  ['P9 verify wait', FREEHOLD_VERIFY_WAIT_SQL],
  ['character save', SAVE_SQL],
];
const labelOf = (query: string): string => {
  for (const [label, sql] of LABELS) if (query.trim() === sql.trim()) return label;
  return `other: ${query.replace(/\s+/g, ' ').slice(0, 60)}`;
};
const waits = new Map<string, number>();
const errors = new Map<string, number>();
const tally = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const failed = (path: string, err: unknown) => {
  const code = (err as { code?: unknown })?.code;
  tally(errors, `${path}: ${typeof code === 'string' ? code : (err as Error)?.name ?? 'unknown'}`);
};

async function monitor(probe: Pool, stop: { done: boolean }) {
  while (!stop.done) {
    const res = await probe.query(
      `SELECT application_name AS app, query FROM pg_stat_activity
        WHERE application_name LIKE 'bench07a_%' AND wait_event_type = 'Lock'`,
    );
    for (const row of res.rows) tally(waits, `${row.app}: ${labelOf(String(row.query))}`);
    await sleep(10);
  }
}

function report(title: string) {
  console.log(`\n== ${title}`);
  const w = [...waits.entries()].sort();
  console.log(
    w.length
      ? w.map(([k, v]) => `  lock-wait samples ${k}: ${v} (about ${v * 10} ms)`).join('\n')
      : '  lock-wait samples: none',
  );
  const e = [...errors.entries()].sort();
  console.log(e.length ? e.map(([k, v]) => `  thrown ${k}: ${v}`).join('\n') : '  thrown: none');
  waits.clear();
  errors.clear();
}

// ---- one realm process -----------------------------------------------------
interface Realm {
  name: string;
  pool: Pool;
  holder: string;
  registry: FreeholdClaimRegistry;
  wanted: Set<number>;
  revs: Map<number, string>;
}

function realm(name: string, holder: string): Realm {
  return {
    name,
    holder,
    pool: new Pool({
      connectionString: URL,
      max: 10,
      application_name: `bench07a_${name}`,
      options: `-c search_path=${SCHEMA}`,
    }),
    registry: createFreeholdClaimRegistry(),
    wanted: new Set(),
    revs: new Map(),
  };
}

async function login(r: Realm, accountId: number) {
  const started = performance.now();
  const answer = await readClaimedLoginDurables(
    {
      pool: r.pool,
      registry: r.registry,
      holder: r.holder,
      realm: r.name,
      ttlSeconds: TTL,
      readRow: (db) => freeholdForAccount(db, accountId, 106_496),
      readHearth: (db) => loadFreeholdHearth(db, accountId),
      nowMs: () => Date.now(),
    },
    accountId,
  );
  return { ms: performance.now() - started, kind: answer.row.kind };
}

const renewDeps = (r: Realm) => ({
  registry: r.registry,
  pool: r.pool,
  holder: r.holder,
  ttlSeconds: TTL,
  wanted: (claim: { accountId: number }) => r.wanted.has(claim.accountId),
  nowMs: () => Date.now(),
  warn: () => {},
});

async function renewPass(r: Realm) {
  const started = performance.now();
  try {
    await renewFreeholdClaims(renewDeps(r));
  } catch (err) {
    failed(`${r.name} renewer`, err);
  }
  return performance.now() - started;
}

/** The store's flush shape: one fenced CAS per held, wanted plot. */
async function fencedWrite(r: Realm, accountId: number, tick: number) {
  const claim = r.registry.forPlot(plot(accountId));
  if (!claim) return 'unheld';
  const expected = r.revs.get(accountId) ?? '1';
  try {
    const out = await upsertFencedFreehold(
      r.pool,
      {
        accountId,
        plotIndex: 0,
        plotId: plot(accountId),
        tier: 'inn_room',
        layoutJson: JSON.stringify([{ tick }]),
        trophiesJson: '[]',
        condition: 100,
        visitPolicy: 'closed',
        wireRev: tick,
        schemaVersion: 1,
        expectedDurableRev: expected,
      },
      {
        plotId: plot(accountId),
        holder: r.holder,
        generation: claim.generation,
        writeToken: mintFreeholdWriteToken(),
      },
    );
    if (out.kind === 'updated') r.revs.set(accountId, out.durableRev);
    return out.kind;
  } catch (err) {
    failed(`${r.name} fenced write`, err);
    return 'threw';
  }
}

/** A character save: the row UPDATE, then `holdMs` of the save's other
 *  statements, then COMMIT. */
async function save(r: Realm, characterId: number, tick: number, holdMs = 0) {
  const started = performance.now();
  let client: PoolClient | undefined;
  try {
    client = await r.pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query(SAVE_SQL, [characterId, tick]);
    if (holdMs > 0) await client.query(SAVE_HOLD_SQL, [holdMs / 1000]);
    await client.query('COMMIT');
  } catch (err) {
    failed(`${r.name} character save`, err);
    await client?.query('ROLLBACK').catch(() => {});
  } finally {
    client?.release();
  }
  return performance.now() - started;
}

async function inParallel<T>(items: T[], width: number, run: (item: T) => Promise<unknown>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}

async function main() {
  const admin = new Pool({ connectionString: URL, max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  const setup = new Pool({ connectionString: URL, max: 2, options: `-c search_path=${SCHEMA}` });
  const probe = new Pool({ connectionString: URL, max: 1 });
  const A = realm('A', HOLDER_A);
  const B = realm('B', HOLDER_B);
  try {
    // ---- setup: N players, a plot each, and a grown claims table ----------
    const extra = RELEASED_OTHER + OTHER_HOLDERS * OTHER_LIVE_EACH;
    await setup.query('CREATE TABLE accounts (id SERIAL PRIMARY KEY, deactivated_at TIMESTAMPTZ)');
    await setup.query(`CREATE TABLE characters (
      id SERIAL PRIMARY KEY,
      account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      level INT NOT NULL DEFAULT 1,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const ddl of [
      freeholdSchema(SCHEMA),
      freeholdHearthSchema(SCHEMA),
      freeholdClaimSchema(SCHEMA),
      freeholdOperationSchema(SCHEMA),
    ]) {
      await setup.query(ddl);
    }
    await setup.query(`INSERT INTO accounts (id) SELECT g FROM generate_series(1, ${N + extra}) g`);
    await setup.query(`INSERT INTO characters (id, account_id) SELECT g, g FROM generate_series(1, ${N}) g`);
    for (let i = 1; i <= N; i++) {
      await upsertFreehold(setup, {
        accountId: i,
        plotIndex: 0,
        plotId: plot(i),
        tier: 'inn_room',
        layoutJson: '[]',
        trophiesJson: '[]',
        condition: 100,
        visitPolicy: 'closed',
        wireRev: 0,
        schemaVersion: 1,
        expectedDurableRev: null,
      });
    }
    // Half the players' own plots carry a RELEASED claim row from an earlier
    // session (the keep-forever table); the other half were never claimed.
    await setup.query(
      `INSERT INTO freehold_plot_claims
         (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
       SELECT 'plot:bench' || lpad(g::text, 6, '0'), g, 'old', 'old#' || md5('h' || (g % 7))::uuid || '#released',
              1 + (g % 4), now() - interval '9 days', now() - interval '2 days', now() - interval '2 days'
         FROM generate_series(1, ${N / 2}) g`,
    );
    const holderExpr = (g: string) =>
      `'realm' || ((${g}) % 6) || '#' || md5('holder' || ((${g}) % ${OTHER_HOLDERS}))::uuid`;
    await setup.query(
      `INSERT INTO freehold_plot_claims
         (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
       SELECT 'plot:' || md5('released' || g), ${N} + g, 'realm' || (g % 6),
              ${holderExpr('g')} || '#released', 1 + (g % 5),
              now() - interval '30 days', now() - interval '1 day', now() - interval '1 day'
         FROM generate_series(1, ${RELEASED_OTHER}) g`,
    );
    await setup.query(
      `INSERT INTO freehold_plot_claims
         (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
       SELECT 'plot:' || md5('other' || g), ${N + RELEASED_OTHER} + g, 'realm' || (g % 6),
              ${holderExpr('g')}, 1, now(), now(), now() + interval '90 seconds'
         FROM generate_series(1, ${OTHER_HOLDERS * OTHER_LIVE_EACH}) g`,
    );
    await setup.query('ANALYZE');
    const size = (
      await setup.query(
        `SELECT count(*)::int AS rows, pg_size_pretty(pg_total_relation_size('freehold_plot_claims')) AS size
           FROM freehold_plot_claims`,
      )
    ).rows[0];
    console.log(`seeded: ${N} players, claims table ${JSON.stringify(size)}`);

    const stop = { done: false };
    const watching = monitor(probe, stop);

    // ---- HP3: the claimed login read on the grown table --------------------
    const reacquire: number[] = [];
    const first: number[] = [];
    const kinds = new Map<string, number>();
    const all = Array.from({ length: N }, (_, i) => i + 1);
    await inParallel(all, 4, async (accountId) => {
      try {
        const out = await login(A, accountId);
        (accountId <= N / 2 ? reacquire : first).push(out.ms);
        tally(kinds, out.kind);
        if (A.registry.forPlot(plot(accountId))) A.wanted.add(accountId);
      } catch (err) {
        failed('A login', err);
      }
    });
    console.log(`\nHP3, ${N} claimed login reads at the store's load cap of 4, on the grown table:`);
    console.log(`  over a RELEASED row (re-claim): ${fmt(reacquire)}`);
    console.log(`  first claim (insert): ${fmt(first)}`);
    console.log(`  answers: ${JSON.stringify(Object.fromEntries(kinds))}; A holds ${A.registry.all().length}`);
    console.log(`  A counters: ${JSON.stringify(A.registry.counters)}`);
    report('HP3 login phase');

    // ---- DB2 (a): the renewer at 5,000 beside the autosave burst -----------
    const ids = [...A.wanted].sort((a, b) => a - b);
    for (let cycle = 1; cycle <= 3; cycle++) {
      const before = { ...A.registry.counters };
      const started = performance.now();
      const saves: number[] = [];
      const [renewMs] = await Promise.all([
        renewPass(A),
        inParallel(ids, 4, async (id) => {
          saves.push(await save(A, id, cycle));
        }),
        inParallel(ids, 4, (id) => fencedWrite(A, id, cycle)),
      ]);
      const c = A.registry.counters;
      console.log(
        `\nDB2 (a) cycle ${cycle}: burst of ${ids.length} saves + ${ids.length} fenced writes beside one renewer pass, wall ${(performance.now() - started).toFixed(0)} ms`,
      );
      console.log(
        `  renewer pass ${renewMs.toFixed(0)} ms: renewed ${c.renewed - before.renewed}, missed ${c.missedHeartbeats - before.missedHeartbeats}, lost ${c.lost - before.lost}, lock timeouts ${c.lockTimeouts - before.lockTimeouts}, abandoned ${c.renewChunksAbandoned - before.renewChunksAbandoned}`,
      );
      console.log(`  character saves: ${fmt(saves)}`);
      report(`DB2 (a) cycle ${cycle}`);
    }

    // ---- DB2 (b): two admitted processes racing for the same plots ---------
    // A's sessions end for accounts 1..1000 over the first 10 s (A's renewer,
    // every 1 s here against production's 30 s, releases each at its next
    // pass); B logs each of them in at a random moment of the 15 s window and
    // retries a busy answer 1 s later. Both flush every 3 s and renew every 1 s.
    const contested = Array.from({ length: 1_000 }, (_, i) => i + 1);
    const windowMs = 15_000;
    const t0 = Date.now();
    const busy = new Map<number, number>();
    const acquiredAfter: number[] = [];
    const bLogins: number[] = [];
    const loopUntil = async (everyMs: number, body: () => Promise<unknown>) => {
      while (Date.now() - t0 < windowMs) {
        const tick = Date.now();
        await body();
        await sleep(Math.max(0, everyMs - (Date.now() - tick)));
      }
    };
    let flushTick = 10;
    const aBefore = { ...A.registry.counters };
    await Promise.all([
      ...contested.map(async (id) => {
        await sleep(Math.random() * 10_000);
        A.wanted.delete(id);
      }),
      ...contested.map(async (id) => {
        await sleep(Math.random() * 12_000);
        while (Date.now() - t0 < windowMs) {
          try {
            const out = await login(B, id);
            bLogins.push(out.ms);
            if (out.kind === 'claim_busy') {
              busy.set(id, (busy.get(id) ?? 0) + 1);
              await sleep(1_000);
              continue;
            }
            B.wanted.add(id);
            acquiredAfter.push(Date.now() - t0);
          } catch (err) {
            failed('B login', err);
          }
          break;
        }
      }),
      loopUntil(1_000, () => renewPass(A)),
      loopUntil(1_000, () => renewPass(B)),
      loopUntil(3_000, async () => {
        const tick = ++flushTick;
        await inParallel([...A.wanted], 4, (id) => fencedWrite(A, id, tick));
      }),
      loopUntil(3_000, async () => {
        const tick = ++flushTick;
        await inParallel([...B.wanted], 4, (id) => fencedWrite(B, id, tick));
      }),
    ]);
    const held = await setup.query(
      `SELECT holder, count(*)::int AS n FROM freehold_plot_claims
        WHERE plot_id = ANY($1::text[]) GROUP BY holder ORDER BY holder`,
      [contested.map(plot)],
    );
    const busyCounts = [...busy.values()];
    console.log(`\nDB2 (b) two processes racing for ${contested.length} plots over ${windowMs} ms:`);
    console.log(
      `  B acquired ${B.registry.all().length}, busy answers ${busyCounts.reduce((a, b) => a + b, 0)} over ${busy.size} plots (max ${busyCounts.length ? Math.max(...busyCounts) : 0} per plot)`,
    );
    console.log(`  B login reads: ${fmt(bLogins)}`);
    console.log(`  rows at the end by holder: ${JSON.stringify(held.rows)}`);
    const ac = A.registry.counters;
    console.log(
      `  A: released ${ac.released - aBefore.released}, lost ${ac.lost - aBefore.lost}, missed ${ac.missedHeartbeats - aBefore.missedHeartbeats}, lock timeouts ${ac.lockTimeouts - aBefore.lockTimeouts}, busy contention ${ac.busyContention - aBefore.busyContention}`,
    );
    console.log(`  B counters: ${JSON.stringify(B.registry.counters)}`);
    report('DB2 (b) race');

    // ---- DB2 (c): the P9 verify wait beside concurrent character saves -----
    // Per character: an in-flight save holds the row 20 ms; 5 ms in, the
    // ambiguous-COMMIT verify waits on it FOR SHARE (the real bounds); 5 ms
    // later the next save's UPDATE queues. The control runs the same two
    // saves with no verify between them.
    const p9 = Array.from({ length: 500 }, (_, i) => N - i);
    for (const withVerify of [false, true]) {
      const verifies: number[] = [];
      const seconds: number[] = [];
      await inParallel(p9, 3, async (id) => {
        const first = save(A, id, 100, 20);
        await sleep(5);
        const verify = withVerify
          ? (async () => {
              const started = performance.now();
              try {
                await runFreeholdTransaction(A.pool, FREEHOLD_VERIFY_BOUNDS, (tx) =>
                  tx.query(FREEHOLD_VERIFY_WAIT_SQL, [id]),
                );
              } catch (err) {
                failed('A P9 verify', err);
              }
              verifies.push(performance.now() - started);
            })()
          : Promise.resolve();
        await sleep(5);
        const second = save(A, id, 101);
        const [, , s] = await Promise.all([first, verify, second]);
        seconds.push(s);
      });
      console.log(`\nDB2 (c) P9 ${withVerify ? 'WITH' : 'without (control)'} the verify, 500 characters:`);
      if (withVerify) console.log(`  verify wait: ${fmt(verifies)}`);
      console.log(`  the queued second save: ${fmt(seconds)}`);
      report(`DB2 (c) ${withVerify ? 'with verify' : 'control'}`);
    }

    stop.done = true;
    await watching;
  } finally {
    await A.pool.end();
    await B.pool.end();
    await probe.end();
    await setup.end();
    const cleanup = new Pool({ connectionString: URL, max: 1 });
    await cleanup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await cleanup.end();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
```

## The first-rollout boot script

`SAVE_SHAPE` (`plain`, `g1` or `g2`), `MODE` (`rollout` or `steady`) and `ROUNDS` select the run.

```ts
// 07a first-rollout boot evidence against the scratch PostgreSQL 16, in a
// THROWAWAY DATABASE (created and dropped here, never a shared one): the REAL
// ensureSchema() boots once, the 07a objects are then removed so the database
// looks like a 07 realm's, and an "old realm" pool serves character saves and
// account create-then-delete cycles while the REAL ensureSchema() boots again
// (the first rollout), then once more (a steady-state boot), three times over.
// Reports each boot's wall time, its lock-wait samples, the old realm's
// latency through the boot window, and every SQLSTATE either side threw.
import { Pool, type PoolClient } from 'pg';

const ADMIN_URL = process.env.BENCH_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/wocc_ci';
const DB = 'wocc_bench07a_boot';
const dbUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB}`;
  return u.toString();
})();
const PLAYERS = 5_000;
// SAVE_SHAPE=plain: a save is its row UPDATE. SAVE_SHAPE=g1: half the save
// workers take the effect-carrying and hooked saves' order instead, the
// account FOR KEY SHARE (G1) first, then the character row (G2), then the
// UPDATE.
// SAVE_SHAPE=g2: the same workers take only the character row lock (G2) before
// the UPDATE, no account lock, which isolates the single-table upgrade path.
const SAVE_SHAPE = (['g1', 'g2'] as const).find((s) => s === process.env.SAVE_SHAPE) ?? 'plain';
// MODE=steady: no 07a removal; every boot is a steady-state boot against the
// committed schema (checked before each one), under the same load.
const MODE = process.env.MODE === 'steady' ? 'steady' : 'rollout';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (xs: number[]) =>
  `n ${xs.length}, p50 ${pct(xs, 50).toFixed(1)} ms, p99 ${pct(xs, 99).toFixed(1)} ms, max ${(xs.length ? Math.max(...xs) : 0).toFixed(1)} ms`;

/** What 07a added that a 07 database does not have. */
const UNDO_07A = `
DROP TRIGGER IF EXISTS freehold_operation_guard_character_delete ON characters;
DROP TRIGGER IF EXISTS freehold_operation_guard_account_delete ON accounts;
DROP TABLE IF EXISTS freehold_operations;
DROP TABLE IF EXISTS freehold_operation_receipts;
DROP FUNCTION IF EXISTS guard_open_freehold_operation_parent_delete();
DROP FUNCTION IF EXISTS erase_freehold_operation_receipt();
DROP TABLE IF EXISTS freehold_plot_claims;
ALTER TABLE account_freehold_hearth DROP COLUMN IF EXISTS advance_token;
`;

async function main() {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [DB],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  // server/db.ts reads both at module load; the boot's client is then named.
  process.env.DATABASE_URL = dbUrl;
  process.env.PGAPPNAME = 'bench07a_boot';
  const db = await import('../../../../server/db');
  // The old realm writes characters as a realm does: with the material source
  // writer capability its connection carries.
  const { materialSourceConnection } = await import('../../../../server/material_source_connection');
  const old = new Pool({
    ...materialSourceConnection(dbUrl),
    max: 10,
    application_name: 'bench07a_old',
  });
  const probe = new Pool({ connectionString: dbUrl, max: 1, application_name: 'bench07a_probe' });
  try {
    await db.ensureSchema();
    await old.query(
      `INSERT INTO accounts (username, password_hash)
       SELECT 'bench' || g, 'x' FROM generate_series(1, ${PLAYERS}) g`,
    );
    await old.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       SELECT id, 'Bench' || id, 'warrior', 'bench', 5, '{}'::jsonb FROM accounts`,
    );
    const rows = (await old.query('SELECT id, account_id FROM characters ORDER BY id')).rows;
    const ids = rows.map((r) => Number(r.id));
    const accountOf = new Map(rows.map((r) => [Number(r.id), Number(r.account_id)]));
    await old.query('ANALYZE');

    const errors = new Map<string, number>();
    const tally = (key: string) => errors.set(key, (errors.get(key) ?? 0) + 1);
    const failed = (path: string, err: unknown) => {
      const code = (err as { code?: unknown })?.code;
      tally(`${path}: ${typeof code === 'string' ? code : (err as Error)?.name ?? 'unknown'}`);
    };

    // The old realm: 8 save workers (row UPDATE, 5 ms of other statements,
    // COMMIT) and 1 account lifecycle worker (create an account and its
    // character, then delete the account, which cascades to the character).
    const load = { on: true };
    const saveMs: { at: number; ms: number }[] = [];
    let seq = 0;
    const tx = async (path: string, body: (c: PoolClient) => Promise<unknown>) => {
      let client: PoolClient | undefined;
      try {
        client = await old.connect();
        await client.query('BEGIN');
        await body(client);
        await client.query('COMMIT');
      } catch (err) {
        failed(path, err);
        await client?.query('ROLLBACK').catch(() => {});
      } finally {
        client?.release();
      }
    };
    const workers = [
      ...Array.from({ length: 8 }, async (_, worker) => {
        const shaped = SAVE_SHAPE !== 'plain' && worker % 2 === 0;
        while (load.on) {
          const id = ids[Math.floor(Math.random() * ids.length)];
          const started = performance.now();
          await tx(shaped ? `old ${SAVE_SHAPE.toUpperCase()} save` : 'old save', async (c) => {
            if (shaped && SAVE_SHAPE === 'g1') {
              await c.query('SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE', [accountOf.get(id)]);
            }
            if (shaped) {
              await c.query('SELECT id FROM characters WHERE id = $1 FOR NO KEY UPDATE', [id]);
            }
            await c.query(
              `UPDATE characters SET state = jsonb_build_object('t', $2::int), level = level WHERE id = $1`,
              [id, ++seq],
            );
            await c.query('SELECT pg_sleep(0.005)');
          });
          saveMs.push({ at: Date.now(), ms: performance.now() - started });
        }
      }),
      (async () => {
        while (load.on) {
          let acct = 0;
          await tx('old account create', async (c) => {
            acct = Number(
              (
                await c.query(
                  `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
                  [`life${++seq}`],
                )
              ).rows[0].id,
            );
            await c.query(
              `INSERT INTO characters (account_id, name, class, realm, level, state)
               VALUES ($1, $2, 'warrior', 'bench', 1, '{}'::jsonb)`,
              [acct, `Life${seq}`],
            );
          });
          if (acct > 0) await tx('old account delete', (c) => c.query('DELETE FROM accounts WHERE id = $1', [acct]));
          await sleep(20);
        }
      })(),
    ];

    const boot = async (label: string) => {
      const samples = new Map<string, number>();
      const watch = { on: true };
      const watching = (async () => {
        while (watch.on) {
          const res = await probe.query(
            `SELECT application_name AS app, left(regexp_replace(query, '\\s+', ' ', 'g'), 50) AS q
               FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND application_name LIKE 'bench07a_%'`,
          );
          for (const row of res.rows) {
            const key = `${row.app}: ${row.q}`;
            samples.set(key, (samples.get(key) ?? 0) + 1);
          }
          await sleep(10);
        }
      })();
      const from = Date.now();
      const started = performance.now();
      let outcome = 'committed';
      try {
        await db.ensureSchema();
      } catch (err) {
        failed(`${label} boot`, err);
        outcome = `aborted ${(err as { code?: string }).code ?? 'unknown'}`;
      }
      const wall = performance.now() - started;
      console.log(`${label}: ${outcome} after ${wall.toFixed(0)} ms`);
      const to = Date.now();
      watch.on = false;
      await watching;
      const during = saveMs.filter((s) => s.at >= from && s.at <= to + 50).map((s) => s.ms);
      console.log(`\n${label}: ensureSchema ${wall.toFixed(0)} ms`);
      console.log(`  old-realm saves finishing in the boot window: ${fmt(during)}`);
      const w = [...samples.entries()].sort((a, b) => b[1] - a[1]);
      console.log(
        w.length
          ? w.map(([k, v]) => `  lock-wait samples ${k}: ${v} (about ${v * 10} ms)`).join('\n')
          : '  lock-wait samples: none',
      );
    };

    await sleep(1_000);
    console.log(`save shape ${SAVE_SHAPE}, mode ${MODE}, ${ROUNDS} rounds`);
    if (MODE === 'steady') {
      for (let round = 1; round <= ROUNDS; round++) {
        const committed = await old.query(
          `SELECT to_regclass('freehold_operations') IS NOT NULL AS ok`,
        );
        if (!committed.rows[0].ok) throw new Error('the schema is not committed before a steady boot');
        await sleep(500);
        await boot(`round ${round}, steady-state boot (schema committed)`);
      }
      load.on = false;
    }
    for (let round = 1; MODE === 'rollout' && round <= ROUNDS; round++) {
      await old.query(UNDO_07A);
      const shape = await old.query(
        `SELECT to_regclass('freehold_plot_claims') IS NULL AND to_regclass('freehold_operations') IS NULL AS is07`,
      );
      if (!shape.rows[0].is07) throw new Error('the 07a objects are still present');
      await sleep(500);
      await boot(`round ${round}, FIRST-ROLLOUT boot (07 database, old realm serving)`);
      await sleep(500);
      await boot(`round ${round}, steady-state boot`);
    }
    load.on = false;
    await Promise.all(workers);
    const all = saveMs.map((s) => s.ms);
    console.log(`\nold-realm saves over the whole run: ${fmt(all)}`);
    const e = [...errors.entries()].sort();
    console.log(e.length ? e.map(([k, v]) => `thrown ${k}: ${v}`).join('\n') : 'thrown: none');
  } finally {
    await old.end();
    await probe.end();
    await db.pool.end().catch(() => {});
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
```

## The renewer launch script

```ts
// The renewer's synchronous launch (what the flush bills to the profiler's
// saves bucket) at 5,000 held claims, 2,500 of them unwanted so the release
// partition is exercised too: the REAL renewFreeholdClaims against a pool whose
// checkout never answers, so the call returns at its first await. 200 launches,
// each on a fresh registry; the first 20 discarded as warm-up.
import {
  createFreeholdClaimRegistry,
  renewFreeholdClaims,
} from '../../../../server/freehold_claim_registry';

const HELD = 5_000;
const ownerKey = (accountId: number) => `account:${accountId}`;
const claims = Array.from({ length: HELD }, (_, i) => ({
  plotId: `plot:${(i * 2654435761 % 2 ** 32).toString(16).padStart(8, '0')}${i}`,
  accountId: i + 1,
  generation: '1',
  acquiredAtMs: 0,
}));
// The wiring's predicate shape: the store's map, the sim's map, the in-flight
// map, the young-claim age; half the owners are wanted.
const storeRefs = new Map<string, number>(
  claims.filter((c) => c.accountId % 2 === 0).map((c) => [ownerKey(c.accountId), 1]),
);
const simLive = new Map<string, unknown>();
const stuck = { connect: () => new Promise<never>(() => {}) };
const samples: number[] = [];
let firstMs = 0;
for (let run = 0; run < 220; run++) {
  const registry = createFreeholdClaimRegistry();
  for (const claim of claims) registry.record(claim);
  const start = performance.now();
  void renewFreeholdClaims({
    registry,
    pool: stuck as never,
    holder: 'bench#holder',
    ttlSeconds: 90,
    wanted: (claim, now) => {
      const key = ownerKey(claim.accountId);
      return (
        (storeRefs.get(key) ?? 0) > 0 ||
        simLive.has(key) ||
        registry.inFlight(claim.plotId) ||
        now - claim.acquiredAtMs < 10_000
      );
    },
    nowMs: () => 1_000_000,
    warn: () => {},
  });
  const took = performance.now() - start;
  if (run === 0) firstMs = took;
  if (run >= 20) samples.push(took);
}
samples.sort((a, b) => a - b);
const at = (p: number) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))];
console.log(
  `renewer launch at ${HELD} held (half unwanted): the cold first ${firstMs.toFixed(2)} ms; ${samples.length} warm launches: p50 ${at(0.5).toFixed(2)} ms, p99 ${at(0.99).toFixed(2)} ms, max ${samples[samples.length - 1].toFixed(2)} ms`,
);
process.exit(0);
```
