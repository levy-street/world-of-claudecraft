# Housing mutation touch-set manifest (07a)

The producing artifact the 07a packet requires BEFORE code: the exact queue, admission,
client and table-lock order of every path that touches a housing row, the new schema, its
per-row-class deletion policy, and what each added statement costs. It is a LIVING
manifest: 08 (placement), 13/13a (the calendar head), 15 (paid effects), 28/29 (Hall Fund)
and the wards extend THIS document and never fork a second order.

Status: revision 6 (2026-10-01), the 07a QA of the built code: every finding is applied in
the code or recorded in section 16. Revision 5 (2026-09-30), the domain review of the BUILT
code (database performance, migration safety, server hot path, architecture, test coverage,
cross-platform and privacy and security): every finding is applied in the code or recorded
in section 15.
Revision 4 (2026-09-30): Revisions 1, 2 and 3 each drew ACCEPT-WITH-CHANGES from
all three acceptance readers (database performance, migration safety, privacy and
security); every finding of all three rounds is applied below and in the code, and section
11 maps each one to its home. Revision 4 also records what the implementation refined
(section 14). The real-PG suites prove the manifest (section 10).

Scope ruled at the 07a Step 0 (Fernando, 2026-09-30): the remote Hearth Key is LIT on a lit
realm through this boundary (production stays dark behind `FREEHOLDS_ENABLED`). Separately,
and by the packet's own scope rather than a Step 0 ruling, the operation machinery ships
with NO production kind (tests reach it; 08 registers the first, the 07
`advanceFreeholdHearthOnClient` precedent).

## 1. Participants

Legacy participants, unchanged and never reordered: the account parents (sorted KEY
SHARE), the character row (FOR NO KEY UPDATE pre-lock, then the nonce-fenced UPDATE through
`runFencedCharacterSave`), the character material-source journal, the bank-ledger receipt
classifier and ledger rows (ONE statement), the market row, the mail partitions, the guild
books (ascending guild id, FOR UPDATE, seed then relock), the storage purchase keys (sorted
advisory locks, receipt, audit row, pending close), the mail custody tail, and the deferred
bank-ledger growth budget singleton at COMMIT.

New participants: `freehold_plot_claims` (the global claim and fence, one row per plot
id), `freehold_operations` (open intents) and `freehold_operation_receipts` (terminal
tombstones), 07's `account_freeholds` through its existing compare-and-swap, and 07's
`account_freehold_hearth` through `advanceFreeholdHearthOnClient`.

## 2. The global lock order

Every transaction takes its locks as a SUBSEQUENCE of this order. A path may skip a class;
no path takes an earlier class after a later one.

| # | Class | Mode | Sort |
|---|---|---|---|
| G1 | `accounts` parents | FOR KEY SHARE | ascending id, ONE statement |
| G2 | `characters` row | FOR NO KEY UPDATE (save) / FOR KEY SHARE (FK-only paths) | one row |
| G3 | legacy save participants | as today | as today |
| G4 | `freehold_plot_claims` rows | FOR NO KEY UPDATE | ascending `plot_id` (an `ORDER BY plot_id FOR NO KEY UPDATE` subselect whenever a statement can touch more than one) |
| G5a | the per-account housing advisory lock | `pg_advisory_xact_lock(FREEHOLD_ADVISORY_ACCOUNT_CLASS, account_id)` | ascending account id |
| G5b | the per-operation advisory lock | `pg_advisory_xact_lock(FREEHOLD_ADVISORY_OPERATION_CLASS, hashtext(operation_id))` | ascending operation id (every path sorts by the same key, so two of them acquire any shared pair in one order) |
| G6 | `freehold_operations` rows, then the `freehold_operation_receipts` insert | FOR UPDATE / unique insert | ascending operation id |
| G7 | `account_freeholds` rows | the CAS UPDATE (row lock) | ascending `plot_id` |
| G8 | `account_freehold_hearth` rows | FOR UPDATE (inside `advanceFreeholdHearthOnClient`) | ascending account id |
| G9 | the bank-ledger growth budget singleton | the deferred trigger's UPDATE at COMMIT | one row, last, in every audit-writing transaction (unchanged; listed so no housing class is ever placed after it) |

The housing advisory locks use the TWO-int4 form with fixed housing class ids ("FHA\x01"
and "FHO\x01"). The single-int8 space (storage's `hashtextextended(idempotency_key, 0)`,
the schema and sweep keys) is disjoint from it, and the two-int4 space's one other user,
the general chat quota (`GENERAL_CHAT_QUOTA_ADVISORY_NAMESPACE`, `(1_195_594_577,
account_id)`) and the WoC market sweep (`0x574f4303`), use different class ids; a test
scans every advisory call site and pins the class ids distinct.

THE HOUSING ACCOUNT PARTICIPANTS JOIN G1. The Hearth's account and an operation's account
are added to the save's sorted KEY SHARE through `characterSaveEffectAccountIds` (a new
optional argument of `lockCharacterSaveEffectAccountsOnClient`), so no `accounts` lock is
first acquired after G2. This rule is load-bearing (an `accounts` lock after G2 deadlocks
against an account delete's FOR UPDATE then cascade), so the hook asserts it in code: it
refuses to run unless every account it touches was in the G1 set, and a test pins the
refusal. `advanceFreeholdHearthOnClient` re-issues KEY SHARE on a row this transaction
already holds, which acquires nothing.

## 3. Queue, admission and client order (JavaScript)

| # | Resource | Taken by |
|---|---|---|
| Q1 | the character FIFO (`characterSaveQueues`, per character id) | every live-session character write, including the Hearth trip and its verify |
| Q3 | the plot store's owner FIFO (per owner key) | the store's own writes; a mutation that WRITES a plot row (08 onward), through the store's `runExclusive(ownerKey, ...)` |
| Q2 | the market serial writer | only a save that writes market or mail rows (including any save while the vault guard holds the character) |
| Q4 | the shared background DB permit | the save, the store write, the Hearth trip |
| Q5 | one pool client (`pool.connect()` inside the save function) | the transaction |

Q3 is taken BEFORE Q2 (revision 1 had them the other way round): entering a per-owner FIFO
from inside the realm-global market thunk would head-of-line block every market and mail
write behind one owner's queued write, against the server rule "never enqueue from inside
a market thunk". A job never waits on an earlier row of this table while holding a later
one, and no queue wait holds a client (Q5 is last, inside the save function).

THE Q1 CALLER CENSUS (G14, carried from the `aaff789813` sync and folded in at revision 5):
every live-session `GameServer.saveCharacter` caller rides Q1, and exactly ONE passes a
housing hook, the Hearth trip (`server/freehold_hearth_trip_host.ts`). The others are
unhooked Q1 writers whose order against a hooked save is plain FIFO order: the autosave,
the leave flush, the vault services' saves, the guild-bank purge carrier, the admin
item and tool-effect restores, the deed-unlock saves (all inside `server/game.ts`), the
storage purchase durability barrier (`server/main.ts` through
`server/storage_purchases.ts`), and the Weekly Vault opening's durability barrier
(`server/weekly_reward_open.ts`, NEW at that sync: it passes `backgroundDbPermit`,
`shouldStart` and its own abort `signal`, never `housing`). A new caller that needs a
housing participant passes `housing` with `backgroundDbPermit: true`, which
`saveCharacter` now enforces.

A plot-writing mutation applies its plan to the live Sim INSIDE Q3, synchronously after
COMMIT, so the store's next write for that owner serializes a live document that already
carries the committed effect; a stale store write can never land over an acknowledged
mutation. The Hearth trip writes no plot row and never enters Q3.

Admission and deadlines of the Hearth trip, as TWO separate bounds (revision 2 used one
signal for both, which would also have aborted a transaction already running and so
manufactured an ambiguous commit exactly under load):
- THE ADMISSION BOUND, `AbortSignal.timeout(FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS)` (the
  existing 5,000 ms player-waiting bound, reused, not a new guess), carried on the housing
  hook and used ONLY for the waits: the Q1 wait (`enqueueCancellable`, cancellable until
  the job starts), the Q2 wait when the save carries mail, and the Q4 wait
  (`backgroundDbGate.acquire(signal)`, a FIFO wait, never `tryAcquire`, which would refuse
  whenever any autosave waits). A cancelled wait answers `busy` with nothing written.
- THE TRANSACTION receives no admission signal. Its own bounds hold (lock 2 s, idle 10 s,
  the 65 s wall), and the hook's first statement is `SET LOCAL statement_timeout =
  CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS` (15 s), an explicit choice for the HOOK'S
  STATEMENTS rather than one inferred from a signal's presence. It does NOT bound COMMIT:
  PostgreSQL 16 stops the statement timer before the deferred triggers run at commit
  (measured on the scratch server), so COMMIT is bounded by `lock_timeout` (2 s, for the
  growth budget's lock wait) and the 65 s wall with its backend cancel; a WAL-flush stall
  has no server-side bound, and the verify's answer for a stall inside COMMIT is expected
  to be `unresolved` (counted `trip_unresolved` for a trip).
- The remaining waits, stated: the pool checkout inside the save function (up to the
  pool's 5,000 ms connect timeout after admission), and a trip in flight at SIGTERM, which
  runs to its 65 s wall ahead of that character's shutdown save.

## 4. The Hearth trip contract (server authority)

The sim's admission seam becomes three-valued: `freeholdKeyAdmission(ownerKey, pid)` answers
`'admit' | 'deny' | 'pending'` (offline and headless default `'admit'`, so both admit
every use the local clock passes, as before; their one change is that the owner's last
leave now evicts the clock map entry, harmless there because offline and headless keys are
per entity). `useHearthKey` checks its LOCAL clock BEFORE admission:
`now < readyAt` denies `cooldown` with no host call, so a key spammed through its cooldown
costs nothing, and every durable `ready_at_ms` the server learns (at login, after a trip,
on a `cooldown` answer) merges forward through `mergeFreeholdKeyReadyAt` (a durable value
may deny, never admit). `'pending'` returns silently (no denial); `'deny'` emits `busy`.

On a lit realm the server's admission (`server/freehold_hearth_trip.ts`):
1. A one-shot TICKET answers first. A ticket is minted only by the server, bound to
   `(ownerKey, pid, characterId, leaseNonce)` captured from the session when the trip
   STARTED; before setting it the re-dispatch checks that the live session for that pid
   still has that character and nonce and is neither leaving nor quarantined. It is set
   IMMEDIATELY before the server's own re-dispatch and cleared in that call's `finally`.
   No await sits between set and consume, so no client frame can ever reach it, and it
   cannot survive a tick, a leave, a takeover, a quarantine or a relog (a new pid never
   matches). The ticket setter is private to `server/freehold_hearth_trip.ts` with exactly
   one call site (pinned).
2. Otherwise, a trip already PENDING for the account answers `'pending'` to the pid that
   started it (single flight: one pending trip per account per process) and `'deny'`
   (`busy`) to any OTHER pid of that account, so a second character's press is answered
   instead of swallowed (only the starting session is ever re-dispatched; revision 5).
3. Otherwise, a per-ACCOUNT refusal memo answers `'deny'` without any database work for
   5,000 ms after EVERY outcome except `advanced` and `cooldown` (busy, fenced, refused,
   failed, corrupt, unsupported, ambiguous unresolved). It is keyed by account id and
   SURVIVES a relog (revision 5: clearing it at the last leave let a disconnect skip the
   meter, and an entry set after that leave was never removed); EXPIRED entries are pruned
   on every session leave and before every new entry, so an entry outlives its expiry by
   at most the next prune, the memo holds only accounts that failed a trip in the last
   5 s, and it has NO global overflow arm: no account is ever denied for another account's
   failures.
4. Otherwise, BEFORE any queue: the session must carry a lease nonce (every production
   session does; one without would ride an unfenced save, so it answers `'deny'`, counted
   `refusedPreQueue`), the owner's store entry must be LOADED and UNBLOCKED
   (never held or quiesced: a realm that answered `claim_busy` or failed its read joins on
   the sim's default record and must not spend the account's shared cooldown on it), and,
   when that entry has a durable row, the registry must hold its claim. A miss answers
   `'deny'` at no database cost. Otherwise the trip STARTS and admission answers
   `'pending'`; inside the transaction the claim is re-proved under G4 (holder and
   generation compared under the held lock).

The trip commits ONE character save (`saveCharacter` with the housing hook, on Q1) whose
hook carries G4 (when a claim applies) and G8. The hook's own result decides, never
`saveCharacter`'s boolean (its `true` means "did not fence out", and its no-state arm
answers `true` without writing); a hook that never ran (the quarantine, the vault guard,
the no-state arm, a fence miss, a guild-book refusal) answers `'deny'`:
- `advanced` (COMMIT resolved, or the verify answered landed): a ticket `'admit'` is minted
  and the server re-dispatches the use (below); the durable `ready_at_ms` is merged in a
  `finally`, so it lands even if the re-dispatch throws.
- `cooldown`: the durable `ready_at_ms` is merged forward and a ticket `'deny'` is minted
  (NEVER `'admit'`: the database judged the cooldown at its transaction start, the sim
  re-checks on the realm clock, and the gap between the two, plus any realm clock running
  ahead of the database, would otherwise admit a trip the durable clock refused and leave
  every other realm seeing a ready key). The re-dispatch's local clock check, which now
  runs first, denies `cooldown` in the normal case and the ticket denies `busy` in the
  race. Nothing was written.
- `corrupt` (a stored `ready_at_ms` past `now_ms + HEARTH_KEY_COOLDOWN_MS`, which only a
  backward clock step or a bad row can produce) and `unsupported` (absent account, vanished
  row, unreadable counters): refused, nothing written, an operator line and a counter
  (contract 8a's two owed fail-closed rules).
- fenced (the nonce fence missed, so the hook never ran), refused (claim lost, entry
  blocked), cancelled, failed, or ambiguous unresolved: a ticket `'deny'` and the
  re-dispatch emits `busy`.

THE RE-DISPATCH runs the server prechecks the original frame passed, in the frame path's
order (`hearthKeyUseRefusal`, `server/freehold_wire.ts`): the draining drop and the vault
lock drop (silent, as the frame path drops them), the spectate drop (silent), the
jailed-travel gate (`freeholdDenied busy`) and the dark-realm gate (`no_freehold`); the
rate gate, the lanes and the detector observation are not replayed, because the original
frame already paid them. Then `sim.useItem(HEARTH_KEY_ITEM_ID, pid)` while the ticket is
set; the use is instant (no cast), so the ticket is still set when the sim asks, and an
admitted entry changes no heavy self field, so the re-dispatch needs no heavy-self mark of
its own (the `use` frame took its receipt mark; pinned in `tests/server/freehold_wire.test.ts`). If the sim then refuses
(the player died or entered combat in the commit window), the advance stays spent: named
residual R-2, counted `trip_refused_after_commit` and logged with no token or holder. A
precheck DROP after a committed advance (the realm began draining, the vault guard locked
the character, the player began spectating, was jailed, or the realm went dark, in the
trip's seconds) is the same residual class, decided by the realm before the sim sees the
use: each answers as the frame path's precheck would (the vault lock and the jail
`freeholdDenied busy`, dark `no_freehold`, draining and spectating silent), and all five
count `trip_dropped_after_commit` with no warn line; under a deny ticket every drop stays as
the frame path's and nothing is counted.

`pending` is cleared when its trip ends, on EVERY exit (commit, rollback, throw, fence miss,
cancel, verify resolution), by a `finally` that compares the trip identity before it
deletes (a stale trip can never clear a newer one's flag), and is bounded by the admission
bound, the transaction's wall and the verify's own bounds, so a hung save can never strand
an account's key. It is deliberately NOT cleared at session leave: a relog while the first
trip's transaction still runs answers `'pending'` instead of starting a second trip on
another character's FIFO; the first trip's outcome finds its session gone and is
abandoned (no re-dispatch), and its durable clock (an `advanced` or `cooldown` answer)
merges forward ONLY while the owner is still on the roster (a sibling or rotated session
then holds the clock the database holds; with nobody online, installing it would undo the
last-leave eviction). The refusal memo survives the relog (item 3).

EVICTION (the sim-side gap `src/sim/freehold/CLAUDE.md` named for this release): the
Sim's `freeholdKeyReadyAtMs` entry for an owner is removed when the owner's LAST session
leaves, in `releaseFreeholdOnLeave` (`src/sim/freehold/state.ts`), checked against the
roster BEFORE that function's record-gated early return, because the durable clock is
merged at install even for an account whose plot is held or absent. Online that is safe
because the login merge reinstalls the durable clock; offline and headless keys are
per-entity. The server's refusal memo is pruned by expiry, never by presence (item 3).

THE SERVER DEFAULT: a lit realm always wires the three-valued admission, and any failure
inside it answers `'deny'`, never the sim's offline default `'admit'` (pinned). A housing
save must hold the background permit: `GameServer.saveCharacter` throws before any work on
`housing` without `backgroundDbPermit` (revision 5), so the verify can never run outside
the gate. Each trip's duration is summed (`tripMsTotal`, measure `trip` on its own
milliseconds family `woc_freehold_authority_ms_total`, beside `claim_renew_pass` and
`claim_login_read`, so the counts family `woc_freehold_authority_total` stays counts only).

## 5. Paths, statement by statement

`B` is BEGIN plus the SET LOCAL line sent as ONE round trip (simple protocol, two
statements) wherever this manifest owns the transaction; `C` is COMMIT, and on every
transaction this manifest owns the COMMIT command tag must read `COMMIT` (a `ROLLBACK` tag
from an aborted transaction is a failure, never a success).

**P1. Character save carrying a housing hook** (`saveCharacterState`,
`saveCharacterAndMarketState`, `saveCharacterAndGuildBankState`; NEVER
`saveCharacterStateOnClient`, whose callers acquire legacy participants after it returns):
the save's own B (statement 60 s without a signal, lock 2 s, idle 10 s, 65 s wall) · G1
(now including the hook's account ids) · G2 pre-lock and fenced UPDATE · the fence-miss
exit (rolls back; the hook never runs) · G3 exactly as today · THE HOOK, the last thing
before COMMIT (`commitWithHousing` in `server/character_save_housing.ts`, after the custody
tail on the market variant), opening with `SET LOCAL statement_timeout = 15000` · C with
G9, its tag checked. The Hearth hook: G4 when a claim applies, as a READ fence that writes
no row version: `SELECT plot_id FROM freehold_plot_claims WHERE plot_id = $1 AND holder =
$2 AND generation = $3 FOR NO KEY UPDATE` · G8 (`advanceFreeholdHearthOnClient`: the KEY
SHARE re-lock, the lazy INSERT, the locked epoch read, and on an advance the UPDATE, which
now also sets `advance_token = $4`) = 5 to 6 round trips added on an advance, 4 to 5 on a
cooldown or refusal. Every writer of `account_freeholds` (P2, P3, an 08 mutation) stamps a
FRESH claim `write_token` in the same transaction; a read fence never does. A hook refusal
throws, so every half rolls back.

**P2. The store's fenced plot write** (the autosave; replaces 07's autocommit
`upsertFreehold` UPDATE arm) is ONE autocommit statement on the pool, exactly 07's cost
(revision 2's four-round-trip transaction projected the 10 s shutdown drain to 14 to 20 s
at 5,000 owners):
```sql
WITH fence AS MATERIALIZED (
  SELECT plot_id FROM freehold_plot_claims
   WHERE plot_id = $12 AND holder = $13 AND generation = $14::bigint
     FOR NO KEY UPDATE
), cas AS (
  UPDATE account_freeholds
     SET tier = $4, layout = $5::jsonb, ... , durable_rev = durable_rev + 1, updated_at = now()
   WHERE account_id = $1 AND plot_index = $2 AND durable_rev = $3::bigint
     AND EXISTS (SELECT 1 FROM fence)
  RETURNING durable_rev::text AS durable_rev
), stamp AS (
  UPDATE freehold_plot_claims SET write_token = $11
   WHERE plot_id = $12 AND EXISTS (SELECT 1 FROM cas)
  RETURNING plot_id
)
SELECT (SELECT count(*) FROM fence)::int AS fenced,
       (SELECT durable_rev FROM cas) AS durable_rev,
       (SELECT count(*) FROM stamp)::int AS stamped
```
The `EXISTS (SELECT 1 FROM fence)` is uncorrelated, so the planner evaluates it once as an
InitPlan BEFORE `cas` scans: the claim row is locked (G4) before the plot row (G7), and the
fence decision cannot go stale because this statement holds the claim row's lock until it
commits. `fenced = 0` answers `fenced`; `fenced = 1` with no `durable_rev` falls to 07's
diagnosis read (`stale` or `missing`). Its bounds are 07's: the pool's 15 s statement
default, no lock bound (a claim row is held only by short transactions; a wait is bounded by
the statement default). The real-PG suite proves the G4-before-G7 order against an opposing
transaction. When the previous attempt for this plot ended AMBIGUOUS (a thrown answer
`throwProvedRollback` does not prove rolled back), the retry is instead a short transaction
(B with lock 2 s): `SELECT write_token FROM freehold_plot_claims WHERE plot_id = $1 AND
holder = $2 AND generation = $3 FOR NO KEY UPDATE`, which waits for that attempt to resolve,
then the same CTE. A token equal to the pending one proves the earlier write LANDED, so the
expected revision adopts the row's current `durable_rev` and the new document goes out on
top of it: this is what tells this realm's own ambiguous commit from another realm's (R2's
self-fence), and it is safe only because every `account_freeholds` writer stamps a fresh
token.

**P3. The first insert of an absent plot** (rare: once per account): B (lock 2 s) · G4 `INSERT INTO freehold_plot_claims ...
VALUES (... generation 1, write_token $t ...) ON CONFLICT (plot_id) DO NOTHING RETURNING
plot_id` (the id is freshly minted, so a conflict is a refusal) · G7 07's `INSERT ... ON
CONFLICT (account_id, plot_index) DO NOTHING` (plus its diagnosis) · C. A lost insert race
rolls back BOTH rows, so a claim never names a plot row that does not exist. Its ambiguity
needs no separate verify: the retry's claim INSERT conflicts on the unique index, which
WAITS for an in-flight inserter, and then the token decides (P2's adopt arm). The
account-level race of two realms each minting a first plot is arbitrated by the primary
key, as in 07 (named residual R-1).

**P4. Claim acquisition at login.** The login transaction moves to its own runner in
`server/freehold_claim_login.ts` (07's `readLoginDurables` policy kept: the plot fails
closed, the clock fails open): B (statement 2 s, lock 1 s, idle 2 s) · the Hearth read
FIRST (if it throws, the transaction is rolled back and a second B starts for the plot
half, with a cold clock, so a clock fault can never silently roll back the claim) · the
plot-id pre-read `SELECT plot_id FROM account_freeholds WHERE account_id = $1 AND
plot_index = 0` (no lock; no row means absent, and the claim waits for P3) · a LOCK-FREE
busy pre-check, `SELECT 1 FROM freehold_plot_claims WHERE plot_id = $1 AND holder <> $2
AND expires_at > clock_timestamp()` (a live foreign claim answers `claim_busy` and the
transaction ends at once, rolled back since only reads ran, so a refused alt never holds
the holder's row) · G4 the
acquire upsert · 07's plot read, unchanged · C (tag checked: anything but `COMMIT` means
the claim is NOT held). The acquire:
```sql
INSERT INTO freehold_plot_claims AS c
       (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
VALUES ($1, $2, $3, $4, 1, clock_timestamp(), clock_timestamp(),
        clock_timestamp() + make_interval(secs => $5))
ON CONFLICT (plot_id) DO UPDATE
   SET realm = EXCLUDED.realm,
       holder = EXCLUDED.holder,
       generation = CASE WHEN c.holder = EXCLUDED.holder THEN c.generation
                         ELSE c.generation + 1 END,
       acquired_at = CASE WHEN c.holder = EXCLUDED.holder THEN c.acquired_at
                          ELSE EXCLUDED.acquired_at END,
       heartbeat_at = EXCLUDED.heartbeat_at,
       expires_at = EXCLUDED.expires_at
 WHERE c.expires_at <= clock_timestamp() OR c.holder = EXCLUDED.holder
RETURNING generation::text AS generation
```
`clock_timestamp()`, never `now()` (the transaction START time: a login that began before a
concurrent release committed would otherwise read the released row as live and refuse).
`$5` is `LEASE_TTL_SECONDS`, the character lease policy reused. The same holder keeps its
generation (re-synced from `RETURNING`, never trusted from memory), so a relog never fences
its own in-flight write; a different holder advances it, fencing every write of the previous
holder from that statement on. No same-account steal arm. A 55P03 on the acquire (its 1 s
lock bound) answers `claim_busy` (repairable, counted `claim_busy_contention`), never the
generic read hold; a 57014 is a slow database, not a held row, and takes the throw arm
(`read_threw`), as a full pool does (the login's one budget runs out in the checkout).
ONE BUDGET (revision 5):
the whole read, both pool checkouts and the clock-fault retry included, runs under ONE
`AbortSignal.timeout` of the login wall, so a slow pool can no longer stretch one login
past the store's budget; a cut before COMMIT is a plain throw, a cut at COMMIT is ambiguous,
and either way nothing is recorded, the read throws and the store holds the entry
(`read_threw`) for the next login to retry. A proved read also clears the plot's pending
write token (its acquire waited out any write still holding the claim row). +3 statements
on a lit login with a plot row; the contract's 104,000 ms floor and the store's dirty-owner ceiling
are re-derived on these counts (section 10).

THE CLAIM IS TAKEN BEFORE THE CHARACTER LEASE (the first ask runs before
`acquireCharacterLease` in `server/ws_auth.ts`). Moving it after the lease would read the
row before holding the fence, which is the stale-read this whole design closes. A handshake
refused after the first ask (already in world, a failed reload) therefore holds a claim on
its own account's plot that nothing wants: the renewer releases it at its first pass after
`FREEHOLD_PERSIST_LOGIN_BUDGET_MS`, so it is bounded by that budget plus one autosave
interval, and it can only block the same account's own plot on another realm. Taking over
an EXPIRED claim on such a handshake is harmless (its holder was dead).

**P5. The renewer** (`renewFreeholdClaims`, a `PeriodicSaveWrites` member registered in
`PERIODIC_SAVE_WRITE_NAMES` beside `heartbeatLeases`, the same 30 s autosave cadence): the
wanted plot ids, sorted, in CHUNKS of at most `FREEHOLD_CLAIM_RENEW_CHUNK` (256), each chunk
ONE statement in its own short transaction (B with statement 2 s, lock 1 s · the statement ·
C), so no transaction ever holds rows from two statements (revision 2's renew-then-release
pair locked two ascending runs that together were not ascending, a cycle against an 08
multi-plot mutation) and one blocked row fails only its own chunk: `UPDATE
freehold_plot_claims SET heartbeat_at = clock_timestamp(), expires_at = clock_timestamp() +
make_interval(secs => $2) WHERE plot_id IN (SELECT plot_id FROM freehold_plot_claims WHERE
holder = $1 AND plot_id = ANY($3::text[]) ORDER BY plot_id FOR NO KEY UPDATE SKIP LOCKED)
RETURNING plot_id`. SKIP LOCKED: a row a trip or a write holds right now (a trip may
legitimately hold it past the 1 s lock bound) is passed over, never waited for, so one
contended plot cannot fail its whole chunk or hold its neighbours' locks; a lock-free
`SELECT plot_id ... WHERE holder = $1 AND plot_id = ANY($2)` then tells a skipped row still
ours (one missed heartbeat, counted per plot, kept) from one another holder took (dropped).
The unwanted ids go out the same way, chunked, as RELEASES (P6's shape). SINGLE-FLIGHT,
BOUNDED, ROTATED (revision 5, the database reviewer's blocker on the built code): the flush
starts a pass unawaited, so a pass is single-flight per registry (a trigger while one runs
is skipped and counted), the whole pass carries `FREEHOLD_CLAIM_RENEW_PASS_DEADLINE_MS`
(20,000 ms, under the 30 s cadence and far under the 90 s TTL; each RENEW chunk's
transaction carries the same deadline as its signal, while a RELEASE chunk and its re-reads
are never cut by it; it bounds every CHECKOUT of the pass (one past it is refused before any
SQL, so a cut can never strand a landed release), so a pass ends by the deadline plus at
most one 5 s transaction wall, 25 s, under the 30 s cadence; a release chunk that THROWS
re-reads its ids `FOR SHARE` (the release's UPDATE takes FOR NO KEY UPDATE, which FOR SHARE
waits out and FOR KEY SHARE would not, P9's ruling), waiting out a still-committing release
(the lock timeout applies to EACH lock wait, up to 1 s per contended row, capped by the 2 s
statement bound and then the 5 s wall; a timeout keeps the claims for the next pass, and on
a stalled WAL the read's own COMMIT most likely ends ambiguous, which keeps them too), and a
completed release reads the ids it did not return lock-free; both classify each row held
(ours and live: kept), released (ours with the released suffix: dropped, counted) or gone
(another holder, an expired row of ours, or no row: dropped, uncounted), and every drop is
identity-checked, so a claim a login recorded while the pass ran is never dropped. The bound
is a CHECKOUT-ONLY signal (`checkoutSignal` on `runFreeholdTransaction`), never a cut of a
running transaction, and a chunk whose checkout it cut counts as abandoned. THE SAME-HOLDER
RE-LOGIN RACE (revision 5, the fourth review of the built code): a login re-acquiring its
own plot keeps the generation, so a release landing on its fresh claim would leave a dead
claim in the registry. The login marks the plot IN FLIGHT from just before its acquire until
it records (or fails), and the release re-checks each claim synchronously inside its
transaction, immediately before the statement, leaving out any claim no longer the
snapshotted one or in flight (a login that marks its plot after that races the statement
already sent: if the release locks the row first, the acquire waits it out and takes over at
the next generation, which is correct; if the acquire holds the row first, SKIP LOCKED
passes it over and the lock-free read keeps the claim); for the residual window (a login
that COMMITS its acquire before a release sent first locks the row) a landed release on a
plot whose registry claim is a NEWER object at the SAME generation drops that claim from the
registry at once, counts `releaseRaced`, warns once per pass (the count only) and hands it
to `onLost` when the host binds one; production binds none, so the store quiesces that owner
at its next write, which answers `fenced` (R-9); a newer claim at a higher generation
stays), the chunks it leaves unstarted are abandoned and counted and their wanted claims are
missed heartbeats, and the next pass starts where an abandoned one stopped (otherwise one
chunk later), so a brownout never starves the same tail plots. Renewal outranks release: an
abandoned pass skips its release chunks. THE PASS'S VOICE AND ITS CLOCK (revision 5): every
line a pass says is said while its single-flight flag is held (so a log sink that calls the
renewer back is skipped), next to the counter it reports, through a guarded sink (a sink
that throws never rejects the pass), and carries counts, the configured deadline and the
closing line's fixed reason only, nothing identifying: the reasons are a fixed vocabulary,
and the one number beside the counts is the pass deadline, a configured number of ms, which
the abandon line names (the closing-clock line carries no number at all, only its fixed
reason). The wanted-check line is said once, after the wanted tests and the pending sweep;
the lost line once per renew chunk that lost claims to another holder; the abandon line
("hit its N ms deadline; M chunks wait for the next pass or were left undecided") once,
where the deadline stops the pass. Three lines come from the pass's `finally`, so every exit
reaches them, a rejecting one included: the race line, the line for `onLost` hooks that
threw (each throw swallowed and counted on the lasting `claim_on_lost_threw`), and the
closing-clock line ("clock gave no usable duration at its close (REASON); that pass is
counted without one", REASON one fixed reason, judged in this order and defined here (the
`closingPassMs` JSDoc and the metrics help text are consistent with it): `threw`, the
closing read threw; `non-number`, it returned something that is not a number (a BigInt,
null, a Date, any object; NaN is a number and reports `not finite`); `not finite`, the
duration is NaN or an infinity (a NaN or infinite reading, or two finite readings whose
difference is not finite); `backward`, the duration is negative, a wall clock stepped back
mid-pass; `overflow`, the duration would carry the running `claim_renew_pass` total past a
finite number, which prom-client's `Counter.inc` refuses at scrape time; so an operator
tells a broken clock from one stepped back); the flag clears in a `finally` of its own
inside it, so a statement there that throws cannot leave the flag set. A clock port that
throws at the call's start rejects the call before that call takes the flag, even one that
started a pass itself first (that pass runs on and clears the flag at its own end);
otherwise the flag is re-checked straight after that read, BEFORE the reading is judged (a
clock port that started a pass itself leaves the call a counted skip, whatever it read); and
a start reading that is not a finite number (a BigInt, null or any object included:
`Number.isFinite` coerces nothing) is refused like a throw, with a fixed dev-channel Error,
since that one reading feeds both the deadline's clock half and every wanted test (the
production predicate compares it with a claim's `acquiredAtMs`): minus infinity would trip
that half at once and abandon every chunk of every pass, NaN or plus infinity would switch
it off. Either way the periodic flush reports it and a later call on a sane clock runs once
the flag is free. A clock port that throws at a deadline check MID-PASS (each check reads it
unguarded while the deadline signal has not fired) rejects the pass there, through the
`finally` above; a mid-pass READING that is not a finite number (NaN, an infinity, a BigInt,
null, any object) never rejects: it leaves that check's clock half off (it is never
subtracted, so a BigInt or a throwing `valueOf` cannot throw there though the clock did not)
and the signal still bounds the pass, so a clock that THROWS is the only mid-pass clock
rejection. A finite BACKWARD mid-pass reading (a wall clock stepped back) is compared with
the start like any other and gives a negative difference, so it never trips the clock half
until the clock catches up; the signal still bounds the pass. The cases in which the pass
rejects are listed ONCE, in `renewFreeholdClaims`'s JSDoc
(`server/freehold_claim_registry.ts`); production binds `Date.now` and no injected deadline,
so it meets none of them. (Node clamps 0, and anything from 2^31 to 2^32 -
1, to 1 ms, which would abandon every chunk of every pass, so those clamped values are
refused, like every other value outside 1 to 2^31 - 1, rather than handed on.) The closing
read, and the duration taken from it, run while the flag is still held (a clock that calls
the renewer back there is skipped too) and under a catch of their own, and only a reading
that is a number is used (a subtraction would coerce null or a Date into a finite duration):
a pass whose clock gave no usable duration (any of the five reasons above) never has its
outcome replaced: it is counted, adds nothing, and the closing-clock line says so. It stays
OFF the background gate by decision (the autosave wave holds that gate exactly when the
renewer runs, so a `tryAcquire` would let claims lapse): single-flight makes its peak one
pool client per realm, pinned by a fake-pool test. A wanted predicate that throws keeps the
claim (counted), and a pending write token on a plot with no claim whose owner nothing wants
is retired (counted). Measured on a 201,000-row claims table across 61 holders: 138 ms per
pass at 5,000 wanted claims, 1.4 ms of it synchronous, and 165 to 203 ms beside a full
autosave burst of 5,000 saves and 5,000 fenced writes, with SKIP LOCKED passing over no row
(workload evidence). WANTED means any
of: the store holds the owner's entry with a session reference or owed work, the Sim holds
its live record, a mutation or recovery pass is in flight for it, or the claim was acquired
less than `FREEHOLD_PERSIST_LOGIN_BUDGET_MS` ago (a handshake between its first ask and its
join bind). That grace counts from the ACQUIRE, not the join: a handshake slower than the
budget can see its claim released before it joins, and the joined session is then the R-3
class (its first write answers `fenced` and quiesces; the next login re-reads). Nothing else renews; 18's visitor reference joins this predicate later and must
never outrank the owner's own authenticated entry on another realm. A completed renew that
did not return a wanted plot means a takeover: the claim leaves the registry and the store's
next write answers `fenced` and quiesces. A THROWN or timed-out renew is a missed heartbeat
(counted, retried next pass, TTL 90 s leaves two), never a loss and never a takeover.

**P6. Release** (the renewer's unwanted ids, and every live claim at shutdown): `UPDATE
freehold_plot_claims SET expires_at = clock_timestamp(), holder = holder || '#released'
WHERE plot_id IN (SELECT plot_id FROM freehold_plot_claims WHERE holder = $1 AND
expires_at > clock_timestamp() ORDER BY plot_id FOR NO KEY UPDATE SKIP LOCKED)`. RENAMED,
not only expired, so a release is FINAL: the renewer and the write fence both match the
live holder exactly, so a renewal already in flight when the release commits cannot revive
the claim and a late write of the releasing process is fenced; the next acquire (another
holder, or this one again) is a takeover and advances the generation. SKIP LOCKED: a row a
write abandoned at the drain deadline still holds is left to expire on its own instead of
failing the whole release. The shutdown form (`FREEHOLD_CLAIM_RELEASE_ALL_SQL`) also
qualifies the OUTER update on `holder = $1` (revision 5): without it the planner
sequential-scanned the whole claims table on a grown book (264 ms at 201,000 rows; 118 ms
on the holder index with it, plan-pinned). The shutdown release runs in `server/main.ts` AFTER
`freeholdPersistIdle` and BEFORE `releaseAllCharacterLeases` (the contract section 8 drain
slot), bounded by `FREEHOLD_CLAIM_RELEASE_ALL_DEADLINE_MS` (2,000 ms) INCLUDING its pool
checkout, never rejects and warns once on failure; it is handed the live registry
(`heldClaims()`), so its releases book `claim_released`. A crash or an abandoned release leaves
the claims to expire after `LEASE_TTL_SECONDS`.

**P7. Operation prepare** (its own short transaction, committed BEFORE any external spend;
no client spans service IO): B (statement 2 s, lock 2 s, idle 2 s) · G1 `accounts` KEY
SHARE · G2 `characters` KEY SHARE (when the intent names a character) · G5a the account
lock · G5b the operation lock · the receipt read · the open-intent count for the account
(`FREEHOLD_OPERATION_OPEN_PER_ACCOUNT`, 8, which is also the recovery pass's read limit, so
one pass resolves every intent an account can hold; exact under G5a) · G6 `INSERT ... ON
CONFLICT (operation_id) DO NOTHING RETURNING` · C. Answers `prepared`, `duplicate` (same
id and fingerprint, still open), `closed` (a receipt holds the id with the SAME
fingerprint, with its outcome), `conflict` (same id, different fingerprint, open or
closed: a closed id never reports "applied" for a different request; and ANOTHER account's
id, open or closed, whatever its fingerprint) or `capacity`. With no open intent, a close
answers `already_closed` only for the caller's own receipt and `missing` for any other.
These answers still tell an id that exists from one that does not (the prepare's
`conflict` against `prepared`, the close's `account` for another account's open intent),
because `operation_id` is unique across accounts, so they are SERVER-SIDE DIAGNOSTICS: the
id itself must never be a cross-account handle, and they must collapse to one
indistinguishable refusal before any client-visible surface. 08, which registers the first
kind, mints ids server-side and crypto-random, or keys them by account, and never accepts a
client-chosen one (a client could otherwise probe for another account's ids, or take an id
another account will use and leave it `conflict` forever). An id the server minted that a
client later sends BACK (a resume after a reconnect) is client-supplied input all the same:
such an id is crypto-random, never the keyed-by-account form a client could guess, it is
checked against the bearer's account before any answer, and every cross-account answer
collapses as above. 07a mints none: its one caller, the Hearth trip, carries no operation.

**P8. Operation apply** (a hook participant inside P1; the intent's account is a declared
account participant, so it was locked at G1): G5b · G6 `SELECT ... FROM
freehold_operations WHERE operation_id = $1 FOR UPDATE` (absent, another account's, or a
fingerprint, fence generation or expected-revision mismatch, refuses) · `INSERT INTO freehold_operation_receipts
(..., outcome) VALUES (..., 'applied') ON CONFLICT (operation_id) DO NOTHING RETURNING` (zero
rows refuses `already_closed`: THE UNIQUE CONSTRAINT IS THE GUARD, never a
SELECT-then-INSERT) · `DELETE FROM freehold_operations WHERE operation_id = $1`.

**P8c. Operation close without apply** (`cancelFreeholdOperation`, its own transaction:
G1 `accounts` KEY SHARE on the intent's account FIRST, as P7 does (the receipt insert's
foreign-key check would otherwise take G1 after G5 and G6, a cycle against an account
delete if the guard were ever missing), then G5a, G5b, the intent FOR UPDATE with a
fingerprint check, the receipt insert with outcome `cancelled` or `refused`, the intent
delete): the terminal state for an intent that will
never apply, so no intent blocks deletion or holds a cap slot forever. Who drives it: the
kind's reconciler (recovery, P9's unresolved arm, a refused apply), and an operator for a
kind with external spend (15 names its horizon). A closed id can never be re-prepared or
applied, because its receipt answers `closed`.

**P9. The ambiguous-COMMIT verify** for a P1 transaction (the Hearth trip; 08's
mutations) runs as the CONTINUATION of the same Q1 job, INSIDE the background permit the
save already held: the hook's persist wrapper (`wrapPersist`, `housingPersist` in
`server/character_save_housing.ts`) wraps the save function itself, so the verify runs
after the save function released its client and before the permit's `finally`. One fresh
pool client, no second permit, so ambiguity clustering in a brownout cannot take clients
outside the gate (AS BUILT at revision 5: both steps share that one checkout; revision 4's
code checked out twice, which the database review of the built code caught). Two steps:
1. THE WAIT, a short transaction with `CHARACTER_DELETE_VERIFY_SQL`'s bounds (statement
   15 s, lock 10 s, idle 2 s): `SELECT 1 FROM characters WHERE id = $1 FOR SHARE`, then
   COMMIT at once. The hung transaction holds that row FOR NO KEY UPDATE (G2), which FOR
   SHARE conflicts with, so this returns only once the hung transaction committed or rolled
   back (an idle-in-transaction one is ended by its 10 s bound). Committing straight away
   holds the character row for one round trip, not for the reads (a held FOR SHARE would
   block every NO KEY UPDATE of that character, the measured delete-verify hazard).
2. THE READS, each its own statement (in one READ COMMITTED transaction, so each takes a
   fresh snapshot), so a row the hung transaction INSERTED is visible once it committed. The evidence is PER KIND: a Hearth
   trip reads only its `advance_token` (landed iff it is this attempt's; the trip's claim
   fence writes no token); an 08 mutation reads its claim `write_token` (landed iff this
   attempt's) and its intent and receipt (landed iff the intent is gone and a receipt holds
   the id), and the readings must agree (they are one atomic commit; disagreement answers
   unresolved).
Revision 1's per-row FOR SHARE was unsound for rows the hung transaction inserted (an
account's first Hearth row, a first claim): an invisible tuple is never waited for. Nothing
re-applies until the verify answers. A wait that runs out its 10 s lock bound while the
hung statement still runs (its own bound is 15 s) answers `unresolved` (counted `trip_unresolved` for a trip), counted
apart, which the trip refuses and recovery re-verifies. P2 and P3 resolve their own
ambiguity on the retry (above), inside Q3.

**P10. Character delete** (`deleteOwnedCharacterRow`): unchanged order (accounts KEY SHARE,
characters FOR UPDATE) then the pre-reads in the triggers' own firing order (PostgreSQL
fires same-event row triggers in name order, so `freehold_operation_guard_*` before
`storage_purchase_guard_*`): `SELECT operation_id FROM freehold_operations WHERE
character_id = $1 LIMIT 1`, throwing the new `CharacterFreeholdOperationOpen`, then the
existing storage pre-read. A NEW catch arm, ahead of `ambiguousCommitLanded` (a 55006 is a
proved rollback, not an ambiguous commit), maps a 55006 by its CONSTRAINT field, matched
exactly: `freehold_operations_open_delete_guard` to `CharacterFreeholdOperationOpen`,
`storage_purchases_open_delete_guard` to `CharacterStoragePurchaseOpen`, anything else
rethrown raw.

**P11. Account hard delete** (the one production path,
`server/federated_auth_db.ts::deleteUnusedFederatedProvision`, a password-less,
token-less provisioning loser that can own no plot): the cascade order is PostgreSQL's
(accounts FOR UPDATE, then each child in constraint order), which would take G7 before G4
against a concurrent store write of the same account; the DELETE's own predicate makes that
impossible (no token, so never a session, a plot or a store entry). Its 55006 handler
switches on the CONSTRAINT field exactly (the two guard names; anything else rethrown raw)
and throws a typed refusal class per guard (there is no HTTP surface on this path; the
`character.freehold_operation_open` code is the character DELETE route's). Driven in real
PG against an open intent under each guard, account-level and through the characters
cascade, with the closed-intent control (`tests/server/freehold_mutation.pg.test.ts`,
section F). DEVIATION from
the packet text, deliberate: "trigger name in the error detail"; PostgreSQL does not put a
trigger name on the error and the storage raise carries no DETAIL, while CONSTRAINT is a
first-class field both raises set.

**P12. `ensureSchema`**: `FREEHOLD_CLAIM_SCHEMA` then `FREEHOLD_OPERATION_SCHEMA` in the
LATE block, immediately before `STORAGE_PURCHASE_SCHEMA` (still after `FREEHOLD_SCHEMA` and
`FREEHOLD_HEARTH_SCHEMA`, after `accounts` and `characters`, and never between storage and
the material-source guard pinned at storage+1 and +2). Late by the storage precedent, which
reasoned that the new foreign keys and trigger DDL take SHARE ROW EXCLUSIVE (and a repair's
DROP TRIGGER ACCESS EXCLUSIVE) on `accounts` and `characters` to the boot COMMIT. Measured
in the 07a QA, the boot already holds more: the core `SCHEMA` runs `ALTER TABLE characters
ADD COLUMN IF NOT EXISTS` and then `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS`, and a
no-op `ADD COLUMN IF NOT EXISTS` still takes ACCESS EXCLUSIVE, so EVERY boot holds both
parents exclusively from its first statements to its COMMIT, and the housing DDL adds no
parent lock the boot does not already hold
([qa/mutation-2026-09-30/workload-evidence.md](qa/mutation-2026-09-30/workload-evidence.md)).
Trigger creation is the operation fragment's last statement. A steady-state boot is
catalog-only: the triggers through the storage probe, and EVERY housing index (07's plot-id
index included) through a `to_regclass` probe in a DO block, because a no-op `CREATE INDEX
IF NOT EXISTS` still takes the table's SHARE lock and holds it to the boot COMMIT
(measured), which would block every other realm's claim and plot writes through this realm's
whole boot. The plot and Hearth fragments MOVED with them: 07 applied them earlier in
`ensureSchema`, and this work places all four in the late block, in the order plots, Hearth,
claims, operations (`tests/schema_wiring.test.ts` pins them at storage minus four to storage
minus one). "Catalog-only" means no lock on a housing or parent TABLE held to the boot
COMMIT: catalog reads, plus the two `CREATE OR REPLACE FUNCTION` rewrites of the guard and
erase functions, which rewrite their `pg_proc` rows on EVERY boot (keeping their oids): a
catalog row write, no table lock. The housing fragments' one table lock is the Hearth token
probe's: deparsing the CHECK takes ACCESS SHARE on `account_freehold_hearth` and releases it
at once, so the boot waits there only behind an ACCESS EXCLUSIVE holder or a queued ACCESS
EXCLUSIVE request on that table, never behind a writer, and holds nothing to its COMMIT
(`tests/server/freehold_hearth_db.pg.test.ts` proves the wait's mode and place, the holder
and queued-request cases, a writer's case, and the nothing-held case with a positive
control). It waits there while holding both parents, so DDL on that table stalls every
realm's saves and logins too. The storage fragment, which is not housing, holds its own
tables: some of its DDL runs unprobed and holds those tables' locks to every boot's COMMIT,
and its probed repairs make a boot a repair boot like any other. The pg suite proves the
housing claim for all four housing fragments: re-applying them completes inside a 1 s
`lock_timeout` beside a writer holding ROW EXCLUSIVE on every table they name (the plot,
Hearth, claims, intents and receipts tables and both parents) and keeps every index,
trigger, constraint and function oid, while each unprobed statement it replaces times out
there; and the operation fragment hands the caller's own `search_path` back
(`tests/server/freehold_mutation.pg.test.ts`, section K). The index probes check a NAME
only, as `IF NOT EXISTS` does: a same-named index with another definition is never repaired,
unlike the trigger probe, which checks the exact shape. The Hearth column probe checks the
column and then its named CHECK: a column whose CHECK is missing gets it back `NOT VALID`,
so every new token is checked again while no boot scans the table for old ones. The CHECK is
probed by name, so a same-named constraint of any type satisfies the probe (that repair can
never fail a boot with 42710, though the column's repair, which names its CHECK unprobed,
fails on a hand-made constraint of that name, on other columns or none); one that is not that
CHECK (another type, or a CHECK with another body, compared on PostgreSQL's own deparse) is
left in place and the boot logs a WARNING. THE FIRST ROLLOUT WINDOW: because no 07 build
deployed, the first 07a boot on production creates five FK-bearing tables and the triggers in
ONE `ensureSchema` transaction with no `lock_timeout`. It takes no parent lock a steady-state
boot does not (above): every boot queues behind each in-flight `characters` and `accounts`
writer on the running fleet, and every later save and account write on every realm queues
behind the boot until its COMMIT (measured with an old realm serving: 55 to 66 ms for the
first rollout with plain saves in flight when no deadlock formed, three boots of 16 waiting out
`deadlock_timeout` for about 1 s, near a steady-state boot's 56 to 59 ms, one of six waiting
1,056 ms; each boot that waited lived, and an account create beside it was aborted). ANY boot
can DEADLOCK on two paths. The UPGRADE path, one table: the boot's first
`characters` lock is SHARE (the core `characters_account` index create), upgraded to ACCESS
EXCLUSIVE by the next statement, against a transaction that took a lock on `characters` that
SHARE does not wait for (a save's G2 row lock, ROW SHARE, or a plain read's ACCESS SHARE) and
then writes it. The ORDER path, two tables: a transaction that holds any lock on `accounts`
and then asks for one on `characters`, this manifest's own G1-then-G2 order (every
effect-carrying or hooked save, the Hearth trip's included, the operation prepare, the
character delete and an account create), against the boot's `characters`-then-`accounts`
order. With G1-shaped saves in flight every bench boot was eventually aborted and saves were
aborted beside it, and a boot that loses exits and is restarted (R-11). A REPAIR boot is any
boot that rebuilds something a probe guards (for example an index, a guard or trigger, or the
advance token column or its CHECK): it holds that statement's lock on that object's table to
its COMMIT, builds a rebuilt index or a re-added column while it holds both parents, for as
long as the build takes, which grows with the table; a rebuilt unique index that meets
duplicate rows fails the boot, which exits and is restarted into the same stall until the
duplicates are resolved. Stop the other realms before a repair boot, and do the first rollout,
any repair boot, and any boot beside other realms serving such saves, in a quiet window;
`DEPLOY.md` carries the operator note.

## 6. Pairwise deadlock review

- P1 against P2 (a trip and a store write of one plot): both take G4 first on the one claim
  row, and the second waits. P1 waits under its 2 s lock bound (a timeout answers a refused
  trip). The ordinary P2 statement carries NO lock bound: its real bound is the LESSER of
  the pool's 15 s statement default and the trip transaction's remaining wall. At shutdown
  the 10 s drain stops awaiting it first, but the statement keeps its pool client until one
  of those bounds fires (R-12). The ambiguous-retry and first-insert transactions carry a
  2 s lock bound, `FREEHOLD_FENCED_WRITE_BOUNDS`, and a timeout there is a thrown blip the
  store retries. No cycle.
- P1 against P4 (a trip and a takeover): the takeover's upsert waits on the trip's G4 lock;
  when the trip commits, the upsert re-evaluates its WHERE on the latest version and, if
  the old claim is still expired, advances the generation. The trip is ordered BEFORE the
  takeover, and the new holder's plot read (after its acquire, same transaction) sees it.
- P4 refused (a live foreign claim): answered by the lock-free pre-check; in the race where
  the claim turns live between the pre-check and the upsert, the upsert's false WHERE
  still locks the row, and the transaction ends immediately (rolled back), so the hold is
  one round trip.
- P1 against P7: P7 takes G1 and G2 in KEY SHARE (compatible with the save's KEY SHARE and
  NO KEY UPDATE) BEFORE G5; the order is a subsequence.
- P1 against P1 on two realms (two alts racing the Hearth): G8 FOR UPDATE serializes them;
  the second reads the first's `ready_at_ms` and answers `cooldown` with no write.
- P10/P11 against P7: the delete's FOR UPDATE on the parent conflicts with P7's FK KEY
  SHARE, so either the delete waits and then its pre-read (or the trigger's fresh READ
  COMMITTED snapshot) sees the committed intent and refuses, or P7's FK check fails on the
  missing parent.
- Multi-claim statements (P5, P6, 08's multi-plot mutations): every one locks claim rows
  through the `ORDER BY plot_id FOR NO KEY UPDATE` subselect, and no transaction holds the
  rows of two such statements (P5 and P6 commit per statement), so two of them cannot
  cycle.
- P2's single statement against P1: the fence CTE's lock is the InitPlan the CAS waits
  on, so G4 is taken before G7, as in every other writer.
- P11's cascade (G7 then G4): guarded by its precondition, above.
- Guild books (G3) against housing: no housing path takes a guild book; G3 precedes G4.
- G9 (the growth singleton) is taken at COMMIT, last, by every audit-writing transaction;
  a housing hook adds its G4/G8 hold time in front of it, priced into the P4 lock bound.

## 7. Schema (every fragment re-applied at boot, guarded and idempotent)

The two new fragments: `FREEHOLD_CLAIM_SCHEMA` is tables and indexes only, so it follows
the 07 plot and Hearth fragments' no-ceremony rule (no `search_path` change).
`FREEHOLD_OPERATION_SCHEMA` defines functions and triggers, so it follows the storage
precedent: a capture and restore of the caller's in-flight `search_path` under its OWN
setting key (`woc.freehold_operation_prior_search_path`), schema-qualified names in every
function body, and `SET search_path = pg_catalog, <schema>, pg_temp` plus an explicit
`SECURITY INVOKER` on each function. The Hearth column addition is a DO block, which needs
no ceremony either (its names are placeholder-qualified). Every CHECK is SHAPE-only and
named; policy counts (the copy-ref count, the open-intent cap) are enforced in TypeScript,
because the DDL pins forbid relaxing a constraint later.

```sql
-- KEEP FOREVER, bounded: one row per plot id ever claimed, cascading with the account.
-- The generation must never restart, so a release keeps the row. account_id is nullable
-- on purpose (a guild-owned plot arrives in 28 with its own owner column and a
-- num_nonnulls CHECK added NOT VALID); every 07a writer sets it, pinned by a test.
CREATE TABLE IF NOT EXISTS freehold_plot_claims (
  plot_id TEXT PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  realm TEXT NOT NULL,
  holder TEXT NOT NULL,
  generation BIGINT NOT NULL,
  write_token TEXT,
  acquired_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT freehold_plot_claims_plot_id_charset CHECK (plot_id ~ '^[A-Za-z0-9_:-]{1,64}$'),
  CONSTRAINT freehold_plot_claims_generation_positive CHECK (generation >= 1),
  CONSTRAINT freehold_plot_claims_realm_shape CHECK (realm <> '' AND length(realm) <= 64),
  -- holder is `${REALM}#${randomUUID()}`: at most 64 + 1 + 36 = 101 characters.
  CONSTRAINT freehold_plot_claims_holder_shape CHECK (holder <> '' AND length(holder) <= 128),
  CONSTRAINT freehold_plot_claims_token_shape
    CHECK (write_token IS NULL OR write_token ~ '^[0-9a-f]{32}$')
);
-- ) WITH (fillfactor = 80): the renewer and every write rewrite each live row on the
-- autosave cadence on columns no index covers, so page room keeps those versions local
-- (a release and a takeover rewrite the indexed `holder`, so those two are never HOT;
-- they are rare).
-- Indexes, each inside a to_regclass-probed DO block (P12):
CREATE INDEX IF NOT EXISTS freehold_plot_claims_holder ON freehold_plot_claims (holder);
CREATE INDEX IF NOT EXISTS freehold_plot_claims_account ON freehold_plot_claims (account_id);

-- OPEN intents only: a row exists while its operation is open; apply and close delete it.
-- Bounded by FREEHOLD_OPERATION_OPEN_PER_ACCOUNT per account, so it needs no sweep. Its
-- parents are RESTRICT, not CASCADE: every row is open by definition, so there is never a
-- row a cascade should remove, and if the guard trigger is ever missing the foreign key
-- still fails closed (23503).
CREATE TABLE IF NOT EXISTS freehold_operations (
  operation_id TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  character_id INT REFERENCES characters(id) ON DELETE RESTRICT,
  plot_id TEXT,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  copy_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_durable_rev BIGINT,
  fence_generation BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- shape CHECKs: operation id '^[A-Za-z0-9_:.-]{1,96}$', plot id charset when present,
  -- kind '^[a-z][a-z0-9_]{0,47}$', fingerprint '^[0-9a-f]{64}$', copy_refs an array,
  -- expected_durable_rev and fence_generation NULL or >= 1, and
  -- num_nonnulls(plot_id, fence_generation) <> 1: a plot-scoped intent carries its fence,
  -- a plot-less one carries neither (P8 compares the pair NULL-explicitly).
);
CREATE INDEX IF NOT EXISTS freehold_operations_account
  ON freehold_operations (account_id, created_at);
CREATE INDEX IF NOT EXISTS freehold_operations_character
  ON freehold_operations (character_id) WHERE character_id IS NOT NULL;

-- KEEP FOREVER: a closed id is permanent replay authority (no signed replay-horizon
-- evidence exists), observed by the receipts growth gauge.
CREATE TABLE IF NOT EXISTS freehold_operation_receipts (
  operation_id TEXT PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  plot_id TEXT,
  kind TEXT NOT NULL,
  outcome TEXT NOT NULL,
  fingerprint TEXT,
  applied_durable_rev BIGINT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- shape CHECKs as the intent's, plus outcome '^[a-z][a-z_]{0,31}$' and
  -- applied_durable_rev NULL unless outcome = 'applied'
);
-- Leads with account_id, so it serves the SET NULL cascade; its order serves the
-- export's newest-first LIMIT without reading an account's whole history.
CREATE INDEX IF NOT EXISTS freehold_operation_receipts_account
  ON freehold_operation_receipts (account_id, closed_at DESC, operation_id DESC)
  WHERE account_id IS NOT NULL;
-- BEFORE UPDATE row trigger freehold_operation_receipt_erase: when account_id goes from a
-- value to NULL (the SET NULL action, an UPDATE that row triggers see), plot_id and
-- fingerprint go NULL in the same row. The plot id is a public wire identity and the
-- fingerprint a hash of the request, so after erasure the tombstone keeps only what
-- replay authority needs: operation id, kind, outcome, revision, time.

-- The D88 guard, the storage shape in all four parts: one function
-- guard_open_freehold_operation_parent_delete() raising
--   RAISE EXCEPTION USING ERRCODE = '55006', MESSAGE = 'freehold_operation_open',
--     CONSTRAINT = 'freehold_operations_open_delete_guard';
-- and two BEFORE DELETE row triggers, freehold_operation_guard_character_delete on
-- characters and freehold_operation_guard_account_delete on accounts. These AND the erase
-- trigger are each REPAIRED by the storage probe's exact predicate (missing, internal,
-- disabled, wrong function, arguments, type 11 or 19, a column list or a WHEN clause:
-- DROP TRIGGER IF EXISTS then CREATE), the one sanctioned reconcile statement, so a
-- disabled erase trigger cannot silently keep an erased account's plot id.

-- 07's Hearth row gains the per-advance token the verify reads, inside
-- FREEHOLD_HEARTH_SCHEMA: in the CREATE TABLE for a fresh database, and for an existing
-- one a DO block that probes pg_attribute first, so a steady-state boot reads the catalog and
-- never takes ALTER TABLE's ACCESS EXCLUSIVE lock (which would block every other realm's
-- Hearth reads through the boot's backfills):
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS advance_token TEXT
--     CONSTRAINT account_freehold_hearth_advance_token_shape
--     CHECK (advance_token IS NULL OR advance_token ~ '^[0-9a-f]{32}$')
```

Both tokens are `randomBytes(16)` as hex, one per attempt, set in the same statement that
writes the effect (the claim's fenced UPDATE; `FREEHOLD_HEARTH_ADVANCE_SQL`, extended with
`advance_token = $4`).

The fingerprint is SHA-256 over the canonical request (kind, plot id, copy refs, expected
revision, fence generation, the kind's payload digest). It binds no account or character id
(the intent's columns bind those), and a copy ref is an opaque item-copy identity, never an
account or character id. After erasure it is NULL anyway (above).

ROLLBACK (corrected in revision 5, the migration-safety review of the built code): no 07
build ever deployed (`server/db.ts` on `release/v0.45.0` and on `main` applies no housing
schema), so the real rollback target is the PRE-HOUSING release, not a 07 binary. That
binary writes no housing table, but the triggers this work installs (the two open-operation
delete guards on `accounts` and `characters`, and the receipts erase trigger) STAY
INSTALLED, because nothing removes them: every character and account delete on the old
binary pays one indexed probe of `freehold_operations`, and an open intent would surface
there as a raw 55006 (a 500), since the old binary has no arm for it. Rollback is therefore
acceptable ONLY while production is dark AND `freehold_operations` holds zero rows,
verified with the fleet stopped by `SELECT count(*) FROM freehold_operations` (must be 0);
a non-zero count is closed intent by intent through `cancelFreeholdOperation`, NEVER a
DELETE, and claims and receipts are never deleted either. The real mixed fleet of the
rollout is a pre-housing realm beside a 07a realm on one database, harmless on the same
condition (zero intents; nothing in production prepares one in this release). Claim rows
are kept, so generations survive a roll back and forward. The RESTRICT backstop surfaces
raw (a 23503, a 500 on the character DELETE route) only if a guard is ever missing. ONLY
on a dev or PBE database that ran 07: the 07 store writes `account_freeholds` without the
claim fence (the CAS still stops a stale overwrite, contract 8a's recorded harm,
acceptable only while dark), and a 07 realm beside a 07a realm is the same hazard as a
rollback, so every process on the `DATABASE_URL` must be 07a before housing is lit
anywhere.

## 8. Per-row-class deletion (D88)

| Row class | Character delete | Account delete |
|---|---|---|
| open intent (`freehold_operations`) | REFUSED (`CharacterFreeholdOperationOpen`, 409 `character.freehold_operation_open`; the RESTRICT key is the backstop) | REFUSED (55006 from the account guard, or from the character guard through the characters cascade) |
| tombstone (`freehold_operation_receipts`) | kept (no character column) | kept, `account_id`, `plot_id` and `fingerprint` NULL |
| claim (`freehold_plot_claims`) | untouched | cascades (its plot row cascades too, and a plot id is never reused) |
| plot, Hearth (07) | untouched | cascade (07) |

THE REVERSE-FK INVENTORY (G14): `world_quest_scores` and `glider_course_bests` (both NEW
at the `aaff789813` sync) cascade from `characters` AND `accounts`. Neither is a housing
participant and no housing transaction locks them, so they add no edge to section 6; a
character delete refused by the open-operation guard deletes none of their rows (the
guard raises before the cascade), and an account delete that passes the guard cascades
them exactly as before.

Tombstones are otherwise keep-forever: a scheduled cascade needs the unsigned "Counsel,
Terms and storefront model" retention schedule, the named release gate. THE SOFT DELETE:
the player-facing account deletion is a soft delete (`handleAccountDeactivate`), which
fires no cascade, so it ERASES the account's tombstones itself, the
`deleteAccountAttribution` precedent beside it: `UPDATE freehold_operation_receipts SET
account_id = NULL WHERE account_id = $1`, which fires the same erase trigger, so a
deactivated account's tombstones keep only replay authority. Open intents at
deactivation are 15's question (no production kind exists in this release); the plot,
Hearth and claim rows of a soft-deleted account stay under contract 8a's existing
soft-delete gate.

## 9. Growth, bytes, export, metrics and the privacy boundary

- Claims: one row per plot (about 150 bytes). Intents: at most 8 per account, deleted on
  close. Receipts: one per closed operation, forever, about 250 to 300 bytes with indexes;
  every kind-registering item (08, 15) states its expected rate and the gauge alert it
  sets. The growth gauge (`server/freehold_receipt_growth_monitor.ts`, the
  `server/bank_ledger_growth_monitor.ts` shape: 60 s, `tryAcquire` on the background gate,
  started after listen, stopped before `pool.end()`) reads `pg_class.reltuples` (rendered
  unknown while it is -1, before the first vacuum) and `pg_total_relation_size`, O(1),
  never a COUNT, and takes 07b's history table in the same list.
- No boot sweep and no whole-table scan: recovery reads ONE account's open intents through
  the account index, at most the cap, when this realm claims that account's plot.
- Export (`exportAccountData`) through ONE loader, `freeholdAccountExport`, keeping 07's
  `freeholds` and `freeholdHearth` keys and adding `freeholdClaims`, `freeholdOperations`
  and `freeholdOperationReceipts`, each an explicit column ALLOWLIST: claims export
  `plot_id`, `realm`, `acquired_at`, `heartbeat_at`, `expires_at`; intents export
  `operation_id`, `kind`, `character_id`, `plot_id`, `copy_refs`, `expected_durable_rev`,
  `created_at`; receipts export `operation_id`, `kind`, `outcome`, `plot_id`,
  `applied_durable_rev`, `closed_at`, newest first through the receipts account index,
  capped at `FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT` (read as limit plus one, so the 07
  `{ truncated: true, limit }` marker is exact). NEVER exported: the holder, the
  generation, either token, the fingerprint, the fence generation. The owner's OWN data
  export is the one sanctioned REST body that carries operation ids (they are the
  owner's records); every other surface is bound by the rule below.
- Metrics (no player data, no token, no holder in any label or log line): claim acquires,
  takeovers, busy refusals, renewals, missed heartbeats, losses, releases, fenced writes,
  self-adopted ambiguous writes; mutation outcomes (committed, refused by reason, fenced,
  ambiguous landed / not landed / unresolved); Hearth trips (advanced, cooldown, corrupt,
  unsupported, refused after commit, metered).
- THE D9/D81 BOUNDARY, pinned on the SERVER side (the sim-side dev modules cannot import
  `server/` at all, so a scan there would prove nothing): no operation kind is registered
  outside tests; `advanceFreeholdHearthOnClient` has an allowlisted caller set (the housing
  hook and the PG suites); the trip's ticket setter has exactly one call site; no
  server-side `/dev` handler reaches the trip, mutation or operation modules; a
  dev-granted tier change rides the ordinary store write and never mints an intent, a
  receipt or a Hearth advance. The holder, the generation, both tokens, operation ids
  (outside the owner's export), fingerprints and fence generations never reach a snapshot,
  event, REST body, error body or metric label (a wire-shape test), nor a log line (a
  recording-logger assertion over the trip, claim and operation paths, plus a metric label
  allowlist; the R-2 line carries no account id, owner key or plot id, the `load_report.ts`
  convention). 15's operation route must use crypto-random ids behind `require_owned`
  with ownerScope `'account'` and a 404 denial.

## 10. Plan inventory and the evidence the PG suites must produce

| Statement | Index / plan | Rows | Round trips | Frequency |
|---|---|---|---|---|
| P4 plot-id pre-read | `account_freeholds` PK `(account_id, plot_index)` | 0 to 1 | 1 | per lit login |
| P4 busy pre-check | `freehold_plot_claims` PK | 0 to 1 | 1 | per lit login with a plot |
| P4 acquire upsert | `freehold_plot_claims` PK | 1 | 1 | per lit login with a plot |
| P1 hook bound | none | 0 | 1 | per hooked save |
| P1 Hearth G4 read fence | `freehold_plot_claims` PK | 1 | 1 | per trip with a claim |
| P2 fenced CTE | claims PK, then `account_freeholds` PK | 1 + 1 | 1 (+1 diagnosis) | per dirty plot write |
| P5 renew / release | the ordered subselect reaches the claims PK or `freehold_plot_claims_holder` (pinned under `enable_seqscan = off`, `tests/server/freehold_claim.pg.test.ts`; on the grown 201,000-row table the planner chose a BitmapAnd of both, measured) | at most 256 per statement | 3 per chunk (4 when a row was skipped) | per realm per 30 s |
| P6 release all | as P5, with the outer update qualified on the holder (pinned; 118 ms at 5,000 claims on the grown table) | the process's live claims | 3 | per shutdown |
| P7 receipt read, cap count, intent insert | receipts PK; `freehold_operations_account`; operations PK | 0 to 1; at most 8; 1 | 3 | per prepare |
| P8 intent lock, receipt insert, intent delete | operations PK; receipts PK | 1 each | 3 | per apply |
| P9 character lock, participant reads | `characters` PK; each participant's PK | 1 each | 2 to 4 | per ambiguous commit |
| P10 housing pre-read | `freehold_operations_character` (partial) | 0 to 1 | 1 | per character delete |
| guard triggers | the same two indexes | 0 to 1 | 0 | per character / account delete |
| SET NULL cascade + erase trigger | `freehold_operation_receipts_account` (partial) | the account's receipts | 0 | per true account delete |
| export loader | claims account index; operations account index; receipts account index (ordered) | bounded by the limits | 3 (plus 07's 2) | per export |

Required runtime proof, on the disposable PG only: an EXPLAIN pin per new statement (the
woc market recipe: a recording pool plus `enable_seqscan = off`); the verify against a
first-advance Hearth row and a first claim with the client destroyed after COMMIT is sent;
the login transaction with an injected clock-read fault (the claim is held and the clock is
cold); a release committing during an in-flight login, both as a race and with the acquire
blocked on the release's lock; a refused acquire against the holder's store write; the
ordered renewer against a two-claim transaction; racing prepares at the cap; the 5,000-owner
drain on the fenced P2; and lock-wait, 55P03 and 57014 counts per path while two admitted
processes race; the renewer at 5,000 wanted plots beside the dirty-plot autosave; the P9
hold against a concurrent `characters` UPDATE; the receipts export EXPLAIN on one account
holding 10,000 receipts; the first-rollout boot against a populated database with a second
realm serving; and the shutdown drain at 5,000 owners on the P2 statement, PASS when it
drains inside `FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS` (10,000 ms) on this host. The contract's
104,000 ms login floor (now with P4's statements and the fault arm's fresh checkout) and the
store's dirty-owner ceiling are re-derived on the measured counts. Every item above is
proved or measured as of the 07a QA: the plan pins in the two pg suites
(`tests/server/freehold_claim.pg.test.ts`, `tests/server/freehold_mutation.pg.test.ts`
section J), and the drain, renewer, contention, P9 and first-rollout evidence in
[qa/mutation-2026-09-30/workload-evidence.md](qa/mutation-2026-09-30/workload-evidence.md).
The pool arithmetic at the flush (the realm pool's 10 clients, the background gate
admitting all but 3, and the three periodic clients outside it, the renewer, the lease
heartbeat and the bank-ledger FIFO tail, which can take all 3 at that instant: composition
headroom, not a reserve) is stated at `renewGameFreeholdClaims`
(`server/freehold_persist_wiring.ts`) and pinned as literals in
`tests/server/tunables.test.ts`.

## 11. Where each acceptance finding landed

Database performance: B1 (verify on inserted rows) P9; B2 (login COMMIT tag) P4 and the
section 5 tag rule; S1 `clock_timestamp()` P4 to P6; S2 lock-free pre-check P4; S3 login
bounds P4; S4 store-write bounds and drain P2, section 10; S5 renewer P5; S6 live-only
release P5, P6; S7 the growth singleton G9; S8 Q3 before Q2, section 3; S9 trip admission
section 3; S10 cap and lifecycle P7, P8c; S11 verify on Q1 P9; S12 export bound section 9;
S13 receipt rate section 9; S14 plan inventory section 10; N1 folded fence, one-trip B; N2
two-int4 keyspace G5; N3 kept nullable (migration N5 ruled the forward-compatible choice);
N5 the gauge's -1; N6 the DO-probed column; N7 `created_at` kept (recovery orders by it).

Migration safety: B1 P9; B2 receipt `outcome`, P8c; B3 the storage probe and RESTRICT keys,
section 7; S1 the DO-probed, named, in-fragment column; S2 the token writers, section 7; S3
the DDL and order pins plus the `search_path` handling, section 7 and P12; S4 shape-only
CHECKs and nullable columns, section 7; S5 the erase trigger and the soft-delete gate,
sections 7 and 8; S6 Hearth fail-closed rules, section 4; S7 and S11 the re-derivations and
R2, P2 and section 10; S8 the rollback conditions, section 7; S9 the new 55006 arms, P10
and P11; S10 the export keys, section 9; S12 the retention-absence pins, section 9 and the
tests; N1 live-only release; N2 the keyspace; N3 the trigger firing order, P10; N4 the
EXPLAIN pins; N5 every writer sets `account_id`; N6 the holder bound, section 7.

Privacy and security: B1 the ticket and pending contract, section 4; B2 the local clock
first, single flight, the refusal memo and the deadlines, sections 3 and 4; S1 the trip's
authority rule, section 4; S2 the claim before the lease, P4; S3 the per-account lock, P7;
S4 the terminal close, P8c; S5 the tombstone erase, section 7; S6 the export allowlist,
section 9; S7 exact constraint matching, P10 and P11; S8 the D9/D81 boundary, section 9; S9
the function hardening, section 7; S10 the visitor reference, P5; S11 the in-statement
fence, P2; N1 the fingerprint's inputs; N2 the tokens; N3 the R-2 log line; N4 the
federated refusal test, section 10 and the tests; N5 the `RETURNING` re-sync, P4.

Round two (revision 2's fresh reads). Database performance: F1 the split admission and
transaction bounds, section 3; F2 the chunked single-statement renewer, P5 and section 6;
F3 the wait-then-commit verify on Q1, P9; F4 the advisory class census, G5; F5 the ordered
receipts index, section 7; F6 the one-statement P2 and the drain PASS rule, P2 and section
10; F7 the per-kind evidence and the fresh-token rule, P1 and P9; F8 the read fence, P1;
F9 the fault arm's fresh checkout, section 10; F10 the erase trigger probe, section 7, and
the boot locks, P12; F11 the unresolved count, P9. Migration safety: S-A the late boot
slot, P12; S-B G1 first in P8c; S-C the erase trigger probe, section 7; S-D the corrupt
test against `clock_timestamp()` (`advanceFreeholdHearthOnClient`'s new `corrupt` arm);
S-E the rollback verification and the rolling-deploy rule, section 7; S-F the
`num_nonnulls` CHECK, section 7; S-G the contract edit list, section 13; N-1 the
placeholder-qualified probe and one CHECK constant; N-2 a positive pin on the probe text;
N-3 the fragment names and keys, section 7; N-4 the raw 23503 and the storage 55006 arm,
sections 7 and P10; N-5 `conflict` for a closed id with another fingerprint, P7; N-6 the
revision CHECK, section 7. Privacy and security: B1 `cooldown` mints `'deny'`, section 4;
S1 the per-account memo, section 4; S2 the memo's outcome set and the pre-queue check,
section 4; S3 the corrupt test; S4 the soft-delete erase, section 8; S5 the export
exception, section 9; S6 the server-side pins, section 9; S7 the eviction, section 4;
N1 the never-ran hook, section 4; N2 the binding captured at start, section 4; N3 the
merge in a `finally`; N4 the server default pin; N5 the log pin; N6 the 15 route.

## 12. Named residuals

- R-1: the first insert of an absent plot racing on two realms is arbitrated by the primary
  key; the loser quiesces with nothing durable lost (07 behavior, unchanged).
- R-2: a committed Hearth advance whose re-dispatch the Sim then refuses (death or combat
  inside the commit window, one save round trip) spends the cooldown without a trip.
  Counted and logged. A precheck drop in that window (draining, the vault lock,
  spectating, jailed, dark) is the same class, counted `trip_dropped_after_commit`; each
  answers as the frame path's precheck would.
- R-3: a realm that lost its claim keeps showing its live view until relog; every write is
  fenced, so durable truth is never overwritten. A handshake that joins later than the login
  grace after its acquire is one way in (P5).
- R-4: a handshake refused after its first ask holds its own account's claim until the
  renewer's first pass after the login budget (P4).
- R-5 (revision 5, the hot-path review): the sim's last-session clock eviction walks the
  online roster for a leaver whose owner key holds a record or a clock, so a mass
  disconnect of such owners is O(N) per leave. The fix is the per-owner session index the
  07 store already names as unclaimed work; the walk itself is 07's shape, now also taken
  for owners that only used a key.
- R-6 (revision 5, the architecture review): after a last-session eviction a relog
  reinstalls the DATABASE's ready time, which can sit slightly before the realm clock's own
  if the realm runs ahead of the database; for a skew-sized window the player hears `busy`
  from the durable refusal instead of `cooldown` from the local check. No free travel
  results.
- R-7 (revision 5): the verify can hold the background permit and that character's queue
  for its one checkout plus both transaction walls, 5 s + 2 x 30 s = 65 s, beside the save's
  own 65 s wall; it runs only after a lost COMMIT answer, and is counted.
- R-9 (revision 5): a login acquire that the database COMMITS before a release statement
  sent first locks the row (the release passed its in-flight re-check, then lost the race on
  the wire) leaves the re-logged owner's fresh claim released; detection drops the claim from
  the registry at once (`claim_release_raced`, one warn per pass with the count), so no
  write, trip or mutation finds a claim for the plot; the renewer binds no `onLost` in
  production, so the store quiesces that owner at its next write, which answers `fenced`,
  until the next login, the R-3 class. The window is the release statement's transit from
  its in-flight re-check to its row lock against the login's round trips after its in-flight
  mark: the busy check, the acquire, the row read and COMMIT. A login whose acquire still
  holds the row uncommitted when the release reaches it is passed over by SKIP LOCKED, and the
  lock-free read keeps the claim.
- R-8 (revision 5, the security review): the soft-delete receipt erase runs once at
  deactivation and has no automatic retry; receipts have no retention story; open intents
  of a deactivated account have no story. None is reachable here (no production kind), and
  the no-kind tripwire in `tests/server/freehold_mutation.test.ts` names all three as owed
  by the change that registers the first kind. DEPLOY.md carries the operator re-run
  query.

- R-10 (revision 6, the QA): the Hearth advance stamps `ready_at_ms` from the save
  transaction's START (`now()`, observed once with the counters under the row lock), so a
  hooked save that ran long shortens that cooldown by at most its own 65 s wall, against a
  3,600,000 ms cooldown. Deliberate: one epoch per entry keeps the counters and the
  cooldown judgment consistent, and the corrupt test already reads `clock_timestamp()`.

- R-11 (revision 6, the QA): ANY boot can deadlock on the two paths P12 names (the boot's
  SHARE-then-upgrade on `characters`, and its `characters`-then-`accounts` order against a
  transaction that locks `accounts` first). With effect-carrying or hooked saves in flight,
  every bench boot was eventually aborted, so the realm exits and is restarted, and saves on
  the serving realms were aborted beside it. What writes an aborted save again depends on
  the save: the next autosave for an autosave; the leave save's bounded retry
  (`server/leave_character_save.ts`) for a leave save; for a shutdown flush save, one more
  pass only when it carried guild bank books, otherwise nothing, so a realm shutting down
  beside a boot can lose a character's last window. A Hearth trip counts `trip_failed` and
  the player presses again. It predates housing (the core schema's boot against the storage
  and ledger saves' G1 and G2 order); 07a adds the Hearth trip's hooked save to the class.
  Bounded only operationally (boot beside quiet realms, and one realm's shutdown finished
  before another boots). Owed to the maintainer, both halves: remove the boot's lock upgrade
  on `characters` (probe the core `characters_account` index the way the housing indexes are
  probed, or take ACCESS EXCLUSIVE on `characters` first), and change the boot's table order
  (which would expose a character INSERT's `characters`-then-`accounts` foreign-key order
  instead).
- R-12 (revision 6, the QA): at shutdown the drain stops awaiting a P2 write blocked on a
  claim row a trip holds, but that statement keeps its pool client for up to the pool's
  statement default. The drain ADMITS `FREEHOLD_PERSIST_DRAIN_MAX_ACTIVE_WRITES` plus
  `FREEHOLD_PERSIST_LEAVE_WRITE_RESERVE` for a leave write, but every write first takes a
  background gate permit, so drain writes hold at most the gate's capacity of clients (the
  pool maximum less `BACKGROUND_DB_MAJOR_PRODUCER_HEADROOM`, and never below one: seven at
  the default pool of ten; below a pool of four the gate keeps one permit, so the clients
  outside it shrink to the pool maximum less one), and one write runs per entry, so one
  trip's claim row blocks at most one write. The steps after the drain find NO free client
  only when the clients outside the gate are held too: by blocking trips, login reads, or a
  statement an earlier drain abandoned. Each has its own bound and none over-runs it, but
  the claim release and the lease release can then fail their checkout and fall back to
  expiry: another realm's takeover waits up to the lease TTL rather than getting an
  immediate release.
- R-13 (revision 6, the QA): a renew chunk is cut by its OWN wall (its transaction's wall or
  the pass deadline): its socket destroyed, then a best-effort backend cancel through the
  canceller's own small pool (`server/db_backend_cancel.ts`, never the shared pool); the
  stop's timeout only bounds how long the stop waits for it. A backend commits only on a
  COMMIT it received, and a closed socket aborts the transaction at its next read, so only a
  chunk whose COMMIT was already sent when its wall cut it can still commit after the
  shutdown release-all passed its locked rows (SKIP LOCKED). Chunks run one at a time and
  the stop starts no other, which keeps at most one renew chunk of plots
  (`FREEHOLD_CLAIM_RENEW_CHUNK`) claimed for at most one lease TTL: the crash bound. A chunk
  that had not reached its statement is cut at its checkout or sends no renewal. A chunk cut
  mid-statement may also still hold its rows when the release-all passes by (the backend
  aborts at the cancel if it lands, else when its statement ends, its statement timeout at
  the latest, and it next touches the closed socket), so SKIP LOCKED leaves those plots to
  wait out their current lease: within the same bound, at most one chunk for at most one
  TTL.

## 13. The persistence-rollout contract edits this work owes

`docs/freeholds/persistence-rollout-contract.md` carries each of these before 07a is
called built (its own rule: none is reported done until the file carries the line):
1. Section 2: the Hearth advance has a production caller; the capable set adds the claim
   acquire, renew and release, the fenced P2 write, the 55006 arms and the verify; a 07
   binary is incapable for a lit fleet; the new fragments, their order and the
   `advance_token` column; the export keys.
2. Section 3: what a 07 binary does against 07a rows (unfenced writes, a 55006 as a 500 or
   a misreported refusal, claims ignored).
3. Section 6: close the owed D88 item (the class, the 409 code, both guards, the RESTRICT
   backstop) and add lifecycle rows for the three tables; keep-forever for claims and
   receipts with their absence pins in `tests/server/main_retention_wiring.test.ts`, and
   the intents' bound.
4. Section 7: the re-derived 104,000 ms floor and dirty-owner ceiling, and the new
   constants (the open-intent cap, the TTL reuse, the export limit, the renew chunk).
5. Section 8: the enable order (every process 07a before lighting); the P6 drain slot; R2
   closed through the claim and P2's adopt arm; the rolling-back leftovers (three tables,
   the guard and erase functions and triggers, `advance_token`); the data-rollback count
   query and the cancel remedy with the owning fragment names.
6. Section 8a: close the two-realm gate (the claim), the forward-clock gate (`corrupt`),
   the cold-clock and fail-open gates (the in-transaction G8 authority; the login read may
   stay fail-open because it only feeds a forward-only local mirror that can deny, never
   admit), and the granted-but-refused gate (the lit trip); extend the soft-delete gate to
   receipts; carry R-1 to R-4.
7. Section 9: link this manifest, and a DEPLOY.md bullet for the new tables and metrics.

## 14. What the implementation refined (revision 4)

Round three's findings and the code that answers them, beyond the sections above:
- The fenced CAS (P2) is `fence` (a MATERIALIZED `SELECT ... FOR NO KEY UPDATE`, no
  write), then `cas`, then `stamp` (the token, written only when `cas` returned a row), so
  a stale attempt commits no token and a later verify can never read it as proof (database
  round three F1, migration round three's blocker). The rule reads: every writer THAT
  LANDS stamps a fresh token.
- The verify runs inside the save's own background permit (`wrapPersist`), not outside
  the gate (database F4).
- The renewer and the release use SKIP LOCKED (database F5); the release renames the
  holder so it is final, and the shutdown release has its own 2,000 ms bound including the
  checkout (the gauge reviewer's three shutdown findings).
- Housing indexes are probe-guarded and the claims table has fillfactor 80 (database F3,
  F8).
- The soft-delete erase runs in its own transaction with the account row FOR UPDATE first,
  after the deactivation's token revoke and disconnect, never failing the deactivation
  (migration round three, security round three S3); a deactivated account prepares
  nothing, and a receipt written for one is written already erased.
- `cooldown` mints `'deny'` (security round two B1); a refused prepare for an erased
  tombstone answers `conflict` (security round three S4).
- The Hearth re-dispatch replays the frame path's prechecks (three at revision 4, five at
  revision 5: the draining and vault-lock drops joined) through ONE predicate,
  `hearthKeyUseRefusal` (`server/freehold_wire.ts`), pinned against the frame path's
  order (security round three S5); every sim refusal after a committed advance counts
  `trip_refused_after_commit` (S6); the merge after an advance sits in a `finally`.
- The admission seam is wired on every server realm (a REQUIRED `buildRealmSimConfig`
  argument whose closure answers `'deny'` when the trip machinery is absent), never the
  sim's offline default (security round three N1).
- Metrics: `woc_freehold_claims_held`, `woc_freehold_authority_total{measure}` (claim and
  trip counters), `fenced_writes` on `woc_freehold_persist_total`, and
  `woc_freehold_receipt_growth{table, measure}`.
- Operation recovery (`server/freehold_operation_recovery.ts`) is scheduled when a login
  proves a claim; with no registered kind it returns before any statement.

## 15. What the domain review of the built code refined (revision 5)

Seven reviewers read the built diff (`0008427d14..` the feature commit). Their one blocker
on the code (the renewer had no overlap guard) and a stale test assertion are fixed; every
other finding is applied or recorded here.
- Database: the renewer is single-flight with a pass deadline and rotation (P5); the verify
  shares one checkout (P9); the login runs under one budget (P4); an aborted signal never
  queues a pool waiter; the shutdown release qualifies its outer update on the holder and
  reaches the live registry (P6); the fillfactor note names the two non-HOT updates; a
  housing save must hold the background permit (section 4); counters for renew passes,
  their milliseconds, skipped triggers, abandoned chunks, thrown wanted tests, swept pending
  tokens and login reads join `woc_freehold_authority_total`, and the summed milliseconds
  (renew passes, login reads, trips) ride their own family,
  `woc_freehold_authority_ms_total`. The account cascade's plot-before-claim order stays
  unreachable because the federated cleanup deletes only the account its own request just
  provisioned (P11), now pinned by source.
- Migration safety: the rollback text targets the pre-housing release (section 7); the
  first rollout window and the moved plot and Hearth fragments are stated (P12); the erase
  trigger nulls the plot id and fingerprint whenever the account is NULL, not only on the
  transition, so an erased tombstone cannot be re-identified.
- Hot path: the renewer's synchronous cost is stated and measured at its bound (P5); the
  leave path no longer walks the sessions; the refusal memo is pruned by expiry; the grown
  table is measured (the release-all scan was the one defect it found); R-5.
- Architecture: the in-place re-type of the admission member is recorded at the member;
  the clock-map scan refuses aliases, optional chains and bracket calls; a parity scenario
  (`freehold_hearth_key`) minted on the pre-07a commit passes byte-identical on this code,
  so offline Hearth Key use draws nothing and behaves as before; R-6.
- Test coverage: the missing-copy, restart-recovery-under-the-original-id, opposing-order,
  D88 custody, full-pool login, stale-cache, ACK-lost replay and ledger-before-guild-replay
  cases now exist in real PG; the verify wait and the fenced CAS fragments are pinned to
  literals; the retention-wiring absences carry positive controls.
- Cross-platform: a second character's press while a trip is pending hears `busy`; the trip
  host reads the sim through a getter; an admitted entry needs no heavy-self mark (pinned).
- Privacy and security: the refusal memo survives a relog; an abandoned trip merges its
  durable clock only while the owner is online; a session without a lease nonce is refused
  before any queue; the re-dispatch replays the draining and vault-lock drops too; the
  receipt monitor logs a bounded error; refusal messages carry no ids; the storage
  constraint name has one source; R-8.

## 16. What the QA of the built code refined (revision 6)

The 07a QA (2026-10-01) read `0008427d14..11316ac3cd` with fresh domain reviewers and fixed
in the code what they found. Every finding of each round, with what became of it (fixed
with its commit, ruled, residual or flagged for the maintainer), is in
[qa/mutation-2026-09-30/qa-findings.md](qa/mutation-2026-09-30/qa-findings.md), and the
run's record in the 07a QA section of `docs/freeholds/qa/persistence-2026-09-08/findings.md`.
What changed the contract above:
- AS BUILT, two names the packet used were never built as exports, on purpose:
  `releaseFreeholdClaim` (a per-plot release is the renewer's unwanted arm, P6, and the
  shutdown release) and `applyFreeholdOperation` (an apply is the hook's operation
  participant inside `commitFreeholdMutation`, a `FreeholdOperationApply` on the request,
  G5b and G6). A downstream doc that names `applyFreeholdOperation` means that
  participant.
- DEVIATION, recorded: an intent and a receipt carry `account_id` (NOT NULL on intents),
  so no operation can carry guild authority in this release; a guild-owned operation
  arrives with 28's owner column, as the claims table's nullable `account_id` already
  anticipates.
- The prepare answers an existing id only for its OWN account: a foreign account sending
  the identical request under that id is `conflict`, open or closed (P7).
- An apply must write its own plot under the same fence and revision, a request must carry
  a Hearth advance or a plot write, and a claim proof must agree with a write fence on the
  same plot; a plot-writing mutation must run inside the store's FIFO.
- A throw after a PROVED COMMIT reports `committed`, never `failed`; the trip's post-COMMIT
  steps are caught and counted; its ticket is bound to the character and the lease nonce.
- The renewer bills its synchronous launch to the profiler's `saves` bucket (p99 4 ms at
  5,000 claims, measured), stops before the shutdown release (bounded by one renew chunk's
  wall, `FREEHOLD_CLAIM_RENEW_BOUNDS.wallMs`; a chunk still at its checkout is cut there and
  one that got its connection sends no renewal; R-13 is the one case left), and lock
  timeouts in a fenced write, a renew chunk or a release
  chunk are counted; the login's busy arm is 55P03 only, counted with busy in one place
  (P4).
- The fragments' DDL path names no `pg_catalog`, so a same-named decoy in the target schema
  cannot bind into a CHECK (proved in real PG with a control that names it); the Hearth
  token CHECK is repaired by name, `NOT VALID` (P12).
- Metrics: the verify's landed and not-landed counts, recovery's counters, and the claims
  table on `woc_freehold_receipt_growth`; the export reads on one client.
- Evidence: every new statement is plan-pinned; the contention, P9 and first-rollout
  measurements are recorded (section 10); the boot deadlock hazard is the core schema's
  (P12).
- R-6 stands as written: a cooldown answer memo or a `cooldown` admission value was tried
  and taken back, since R-6 is an accepted residual and the memo changed the pre-dispatch
  merge. R-10 is new.
- Takeover counts every generation advance over an existing row, a realm's own re-acquire
  after its release included (P6 says so, and so does the metric's help); a re-claim over a
  released row is the common case (the QA's login bench: 2,500 of 5,000).
- The fix round's own fresh readers (eight) refined it further: the persist store re-reads
  a lost-claim entry only when it owes nothing (a dirty, quiesced or capture-holding entry
  replays, since a re-read would rebase its unwritten work onto another realm's row), and a
  re-read moves the Hearth clock forward only; the trip ticket is the SAME session object;
  the trip's clock reads can no longer escape before its outcome is counted, and a throw
  after it is warned with the error's class only; a throwing live apply is reported through
  `onCommittedThrew`; the renew chunk re-checks the stop inside its transaction; every
  housing export statement is a named constant with its columns pinned; the Hearth token
  CHECK is probed by name alone. The authority snapshot is still read three times per
  scrape, deliberately: each read is O(1) (three small counter copies), so a second memo
  beside `housingStats` would buy nothing. The storage fragment still names `pg_catalog`
  second (its decoy exposure is owed against that fragment, not changed here). R-11 and
  R-12 are new.
- A third round of eight fresh readers refined it again: the lost-claim re-read joins a read
  already in flight instead of replaying the stale entry (its predicate is now a pure
  function, `freeholdRereadsLostClaim`, tested clause by clause); a reload after a retryable
  hold keeps a proved Hearth clock; the trip's identity check compares the session's
  character and lease nonce as they were when the trip started; the live apply and its
  report are one binding (`live: { apply, threw }`); the renewer stop cuts a chunk parked at
  its checkout; the Hearth token probe warns on a same-named constraint that is not a CHECK.
  The boot deadlock was re-measured on true steady-state boots and found to have two paths
  (P12, R-11), and R-13 is new.
- A fourth round of eight fresh readers: a read in flight is joined without asking the claim
  at all (the read records the claim before its row lands); the Hearth token probe warns on
  any same-named constraint that is not that CHECK, a CHECK with another body included; the
  launch observer's warning is said once per registry. P12's upgrade path is any lock on
  `characters` then a write, the G2 bench shape no longer counts as isolating it, R-11 says
  which save each retry reaches, R-12 counts gate permits rather than admission slots, and
  R-13 names the chunk's own wall as its cut. P7 states the id duty for an id a client
  sends back.
- A fifth round of eight fresh readers: the in-flight join reads the preload's own account;
  the Hearth token probe's deparse takes a brief ACCESS SHARE on its table, held to no
  COMMIT (P12 says so, proved on PostgreSQL); R-12 keeps the gate's floor of one and R-13
  names the cancel.
- A sixth round of eight fresh readers: P12 names the probe's wait cases, the storage
  fragment's own locks and every repair boot; R-13 adds a chunk cut mid-statement whose rows
  the release passes by; the operator renames a token impostor instead of dropping it; and
  the shutdown budget is pinned whole against `server/main.ts`.
- A seventh round of eight fresh readers: P12 defines a repair boot instead of listing one,
  says the storage fragment holds its own tables, and R-13 says when the backend aborts; the
  operator's token runbook is SQL the pg suite executes.
- An eighth round of eight fresh readers: P12 says what a repair boot costs and that a
  failed unique rebuild restarts into the same stall until its duplicates are resolved
  (`DEPLOY.md` says how), the storage fragment's probed repairs are repair boots, R-13
  bounds a cut backend's abort by its statement timeout, the runbook's five blocks are SQL
  the suite runs, and every shutdown await carries an explicit classification.
- A ninth round of eight fresh readers: P12 stops the other realms before every repair boot,
  and the runbook routes each error by the block that raised it.
- A tenth round of eight fresh readers: P12 names a re-added column in a repair boot's cost;
  the runbook's drop rule takes only a token-only displacement, a failed unique rebuild
  escalates with no row changed, and both shutdown callees that fix their own bound are pinned
  whole.
- An eleventh round of eight fresh readers: the schema notes say steady-state boot throughout,
  and P12 says the column's repair, unlike the CHECK's, can fail on a hand-made constraint of
  the CHECK's name; the runbook sends each block as one psql session that prints a code, never
  a DETAIL, and its drop rule needs one key.
- A twelfth round of eight fresh readers: P12 says a constraint of the CHECK's name on other
  columns or none fails the column repair, and the runbook names its session through
  PGAPPNAME, which psql's own name cannot override.
- A thirteenth round of eight fresh readers: P12 gives the bench's boot times, and the runbook
  gains a HOLDER read that never shows a query, a client address or its own session.
- A fourteenth round of eight fresh readers: P12's bench figures say which boots waited out
  `deadlock_timeout`, and the runbook's HOLDER read runs at any point, in this database only.
