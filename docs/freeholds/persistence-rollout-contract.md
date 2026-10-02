# Freehold persistence: capable-release rollout and rollback contract

What this file is: the engineering capability statement for durable player housing.
It sits behind the storage seam the persistence contribution builds
([../../server/freehold_db.ts](../../server/freehold_db.ts),
[../../server/freehold_hearth_db.ts](../../server/freehold_hearth_db.ts) and
[../../server/freehold_persist.ts](../../server/freehold_persist.ts)), and it is the
named producing artifact for the
"Source calendar, lifecycle and rollout capability" row in
[state.md](state.md) "Tracked release and handoff gates". Two things a later reader
must not break. First, this is a contract, never an approval: it states what a capable
release is and what an incapable one does, and it grants nothing. Second, every claim
below is anchored to a real path or an exported symbol, so a rename moves the anchor
and a reader can always check the claim against the tree.

Scope, and what this contract does NOT cover. It covers the two normalized housing
tables, the store that reads and writes them, their export, their lifecycle behavior
and the order in which the feature is turned on and off. Cross-record commits now
exist (the 07a work of the [transactional mutation boundary
file](phase-07a-transactional-mutation-boundary.md)), so this contract now ALSO covers
the three tables that work adds, the global plot claims (`freehold_plot_claims`), the
open operation intents (`freehold_operations`) and their terminal receipts
(`freehold_operation_receipts`), at the level of rollout and rollback: what a capable
release carries, what an incapable one does against them, their lifecycle and bounds,
and how they quiesce. The commit protocol itself (the global lock order, every path's
statements, the ambiguous-COMMIT verify and the deadlock review) is the [touch-set
manifest](mutation-touch-set-manifest.md)'s, and this file cites it rather than
restating it. It does not cover account presence, absence or protection history, which
belong to the [account lifecycle file](phase-07b-account-lifecycle.md); it does not
cover [arrival-tier marks](phase-07c-arrival-eligibility.md); and it does not cover
[upkeep calendar facts](phase-13a-authoritative-upkeep-calendar.md). Turning the
housing flag off does not revert those, because none of them exists yet.

## 1. Status

STATUS: `FREEHOLDS_ENABLED` is OFF everywhere and production remains disabled.
Nothing in this file may be read as permission to enable it.

This artifact is UNSIGNED. The named service, operations and database owners must
accept it before upkeep activation, alongside the other artifacts its gate row lists.
An unsigned contract is an engineering description of behavior, not an operator
authorization, and it must never be presented as service, database or operations
acceptance.

The flag itself is `freeholdsEnabled` in
[../../server/freehold_config.ts](../../server/freehold_config.ts): exactly the strict
string `1`, defaulting off, with every other value keeping the realm dark. The REST
status route and the housing wire predicate read it live; `buildRealmSimConfig`
snapshots it once at boot, so a running realm needs a restart to change what its Sim
believes. Flipping the env on a live realm opens the route and the wire while the Sim
stays dark, which is a half-enabled realm and is not a supported state.

## 2. The minimum capable release

The minimum capable release is the first release whose server satisfies every line
below. The release tag is filled in by the wave close that publishes these modules;
until that close lands, this section is a capability test and not a version number.
Do not substitute a guessed tag.

A server is CAPABLE when all of the following hold.

1. It carries [../../server/freehold_db.ts](../../server/freehold_db.ts),
   [../../server/freehold_hearth_db.ts](../../server/freehold_hearth_db.ts) and
   [../../server/freehold_persist.ts](../../server/freehold_persist.ts), AND the 07a
   modules that make the pair safe to light: the global plot claim
   ([../../server/freehold_claim_db.ts](../../server/freehold_claim_db.ts)), its
   registry, renewer and shutdown release
   ([../../server/freehold_claim_registry.ts](../../server/freehold_claim_registry.ts))
   and the claimed login read
   ([../../server/freehold_claim_login.ts](../../server/freehold_claim_login.ts)); the
   fenced plot writer
   ([../../server/freehold_fenced_write.ts](../../server/freehold_fenced_write.ts)); the
   operation intents and receipts
   ([../../server/freehold_operation_db.ts](../../server/freehold_operation_db.ts)) and
   their recovery pass
   ([../../server/freehold_operation_recovery.ts](../../server/freehold_operation_recovery.ts));
   the mutation boundary
   ([../../server/freehold_mutation.ts](../../server/freehold_mutation.ts)) riding the
   character save through its housing hook
   ([../../server/character_save_housing.ts](../../server/character_save_housing.ts));
   the remote Hearth trip
   ([../../server/freehold_hearth_trip.ts](../../server/freehold_hearth_trip.ts)) and
   its realm host
   ([../../server/freehold_hearth_trip_host.ts](../../server/freehold_hearth_trip_host.ts));
   and the bounded transaction runner they share
   ([../../server/freehold_tx.ts](../../server/freehold_tx.ts)). A 07 binary, one that
   carries the first three modules without the 07a set, is INCAPABLE for a lit fleet;
   section 3 says what it does.
2. `ensureSchema` in [../../server/db.ts](../../server/db.ts) applies ALL FOUR housing
   fragments, `FREEHOLD_SCHEMA`, `FREEHOLD_HEARTH_SCHEMA`, `FREEHOLD_CLAIM_SCHEMA` then
   `FREEHOLD_OPERATION_SCHEMA`, back to back inside the boot advisory-locked
   transaction, in the LATE block IMMEDIATELY before `STORAGE_PURCHASE_SCHEMA`: after the
   fragments that create the `accounts` and `characters` parents they reference (the
   plot, Hearth and claim rows through `ON DELETE CASCADE`, the receipts through
   `ON DELETE SET NULL`, the intents through `ON DELETE RESTRICT`), after the chat-filter
   seed and the market and mail backfills, and before the growth-budget fragment that
   closes the boot transaction. LATE ON PURPOSE, the storage precedent (the touch-set
   manifest's P12): on a first rollout or a repair boot the new foreign keys and the
   operation fragment's trigger DDL take SHARE ROW EXCLUSIVE on `accounts` and
   `characters` (and a trigger repair's DROP TRIGGER takes ACCESS EXCLUSIVE), held until
   the boot COMMIT, so they must not sit in front of the seed and the backfills; and
   nothing separates storage from the material-source writer guard that follows it.
   (Measured in the 07a QA: every boot already holds both parents under ACCESS EXCLUSIVE
   from the core schema's `ADD COLUMN IF NOT EXISTS` statements, `characters` first, so
   the housing DDL adds no parent lock; the slot is kept for the precedent.) A
   steady-state boot's housing schema is catalog-only: every housing index behind a
   `to_regclass` probe, the triggers behind the storage probe's exact predicate, and the
   Hearth row's `advance_token` column behind a `pg_attribute` probe (in the CREATE TABLE
   for a fresh database, otherwise one ADD COLUMN, shape-checked by the named
   `account_freehold_hearth_advance_token_shape` constraint, which a later boot puts back
   `NOT VALID` if the column exists without it), so an ordinary boot's housing fragments
   take none of the index, trigger or ALTER TABLE locks that would hold another realm's
   housing statements until its COMMIT (their one table lock, the token probe's ACCESS
   SHARE on the Hearth table for the CHECK's deparse, is taken and released at once; the
   storage fragment, which is not housing, holds its own tables: some of its DDL runs
   unprobed and holds those tables' locks to every boot's COMMIT, and its probed repairs
   make a boot a repair boot like any other). No fragment references another's table, so
   their relative order is a convention rather than a dependency, and it is fixed as
   plot, Hearth, claim, operation so the boot-call ordering pin in
   [../../tests/schema_wiring.test.ts](../../tests/schema_wiring.test.ts) (by index,
   never containment) has one stable answer. All four are applied
   UNCONDITIONALLY, never behind `freeholdsEnabled`: the tables exist before the feature
   does, so enabling is a flag change and never a migration. `freeholdSchema(schemaName)`,
   `freeholdClaimSchema(schemaName)` and `freeholdOperationSchema(schemaName)` exist only
   for the private-schema real-PG test recipe; the unparameterized arms are the ones a
   boot applies.
3. `exportAccountData` in [../../server/db.ts](../../server/db.ts) exports EVERY housing
   table through ONE loader, `freeholdAccountExport`
   ([../../server/freehold_account_export.ts](../../server/freehold_account_export.ts)).
   It keeps 07's two bundle keys, `freeholds` (an array through `freeholdsForExport`,
   empty when the account owns no plot) and `freeholdHearth` (one record through
   `freeholdHearthForExport`, or null), and adds three, each an explicit column
   ALLOWLIST and each bounded: `freeholdClaims` (through `freeholdClaimsForExport`:
   `plot_id`, `realm`, `acquired_at`, `heartbeat_at`, `expires_at`; bounded by the
   account's plots), `freeholdOperations` (through `freeholdOperationsForExport`:
   `operation_id`, `kind`, `character_id`, `plot_id`, `copy_refs`,
   `expected_durable_rev`, `created_at`; bounded by
   `FREEHOLD_OPERATION_OPEN_PER_ACCOUNT`) and `freeholdOperationReceipts` (the same
   loader: `operation_id`, `kind`, `outcome`, `plot_id`, `applied_durable_rev`,
   `closed_at`, newest first through the receipts account index, capped at
   `FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT` and read as the limit plus one, so 07's
   `{ truncated: true, limit }` marker is exact). NEVER exported: the claim holder, the
   fencing generation, the write and advance tokens, the operation fingerprint and the
   fence generation. The owner's own export is the one body that carries operation ids,
   because they are the owner's records. The existing character-state projector reads
   only `characters.state` and cannot reach a normalized table; it must not be asked to.
4. It honors the account Hearth authority through `loadFreeholdHearth` and
   `advanceFreeholdHearthOnClient`. The PLANNED private `fhold/myFreehold.hearthKeyReadyAtMs`
   and `hearthKeyRevision` values are committed UI mirrors. A mirror never authorizes.
   The 07 MARKER that stood here ("written, tested against real PostgreSQL and
   reachable by nothing") is RETIRED: on a lit realm the advance now has a production
   caller, the remote Hearth trip. A key use asks the realm's three-valued admission
   (`admission` on the trips `createGameFreeholdHearthTrips` builds, wired through the
   REQUIRED third argument of `buildRealmSimConfig`); the trip commits ONE character
   save carrying the housing hook (`commitWithHousing`), and the hook's Hearth
   participant in `createFreeholdSaveHook` calls `advanceFreeholdHearthOnClient` with
   that attempt's advance token, inside the save's own transaction. Only a proved
   advance mints the one-shot ticket that admits the server's re-dispatch of the use.
   [../../server/freehold_mutation.ts](../../server/freehold_mutation.ts) is the ONE
   caller outside the Hearth module, pinned by a source scan in
   [../../tests/server/freehold_mutation.test.ts](../../tests/server/freehold_mutation.test.ts).
   Production stays dark behind `FREEHOLDS_ENABLED`, and on a dark realm the frame path
   refuses the key's use at dispatch (`refusedFreeholdCommand`, the verdict
   `hearthKeyUseRefusal` replays as `dark`) before any admission, so in production
   nothing reaches the advance yet. The capability the contract names is still the
   whole pair: a release that reads the clock but cannot advance it is not capable, and
   enabling housing on one would hand out a free travel on every relogin.
5. It registers the store with `registerFreeholdPersistStore` and drains it with
   `freeholdPersistIdle` in the shutdown closure, in the slot section 8 fixes, and in the
   same closure it RELEASES this process's plot claims with `releaseAllFreeholdClaims`:
   after `freeholdPersistIdle`, before `releaseAllCharacterLeases`, under its own
   `FREEHOLD_CLAIM_RELEASE_ALL_DEADLINE_MS` bound, never rejecting. Both slots are pinned
   in
   [../../tests/server/main_retention_wiring.test.ts](../../tests/server/main_retention_wiring.test.ts).
6. It treats both 07 tables as keep-forever, and the 07a claim and receipt tables the
   same way. None appears in
   [../../server/retention_sweep.ts](../../server/retention_sweep.ts), whose swept-table
   list is declared in [../../server/main.ts](../../server/main.ts). The plot table is
   bounded plots per account and the reverse foreign-key account cascade is its only
   removal path. A claim row is bounded one per plot id ever claimed, removed only by
   its account's cascade, and never deleted on release, because its fencing generation
   must never restart. A receipt is permanent replay authority, observed instead of
   swept by
   [../../server/freehold_receipt_growth_monitor.ts](../../server/freehold_receipt_growth_monitor.ts)
   (`woc_freehold_receipt_growth`). The open intents in `freehold_operations` are NOT
   keep-forever: they are bounded per account by `FREEHOLD_OPERATION_OPEN_PER_ACCOUNT`
   and deleted by their own apply or close, so that table needs no sweep either. The
   obligation is a keep-forever comment at each keep-forever DDL (and the bounded
   comment at the intents' DDL) plus an absence assertion in
   [../../tests/server/main_retention_wiring.test.ts](../../tests/server/main_retention_wiring.test.ts),
   the shape that file already uses for `bank_ledger` and the storage receipts; it pins
   all three 07a tables off the sweep and reads each comment from the fragment
   `ensureSchema` applies.

Every process sharing one `DATABASE_URL` must be capable, which now means carrying the
07a set, before housing is enabled on any of them. Capability is a property of the
fleet, not of the process an operator happens to be looking at. On a production
database the real mixed fleet during a rollout is a PRE-HOUSING realm (the latest
release) beside a 07a realm, with housing dark: that is harmless only while
`freehold_operations` holds zero rows, which is the state today, because nothing in
production creates an intent (`FREEHOLD_OPERATION_RECONCILERS` is empty and no
production caller prepares one); section 3 says what the old realm does if one exists.
A ROLLING DEPLOY that leaves a 07 process beside a 07a process applies ONLY to a dev or
PBE database that ran a 07 build (no 07 build ever deployed to production): there it
is the same hazard as a rollback (an unfenced plot write while another realm holds the
plot's claim), so every process is 07a BEFORE housing is lit anywhere.

## 3. What an INCAPABLE release does against a populated database

An incapable release is any build without the whole section 2 set. It comes in two
shapes, and they are not equally real.

THE PRE-HOUSING BINARY is the real rollback target: any build from before these modules
existed. The housing modules have never shipped (at this revision
`git log origin/main -- server/freehold_db.ts`, and the same against the latest
`release/**` branch, return nothing), so every binary a realm could roll back to today
has this shape. Run one against a database that already holds housing rows and this is
exactly what happens.

- It applies NONE of the four schema fragments. It has no import for any housing
  module, so its `ensureSchema` never mentions the tables. Existing tables, functions
  and triggers are left as they are.
- It NEVER reads and never writes any housing table. It has no loader, no writer and no
  query naming `account_freeholds`, `account_freehold_hearth`, `freehold_plot_claims`,
  `freehold_operations` or `freehold_operation_receipts`. It takes no claim, renews none
  and releases none, so the claims a capable process held simply expire after
  `LEASE_TTL_SECONDS`.
- BUT THE DATABASE STILL ENFORCES WHAT 07a INSTALLED, on the statements the old binary
  does issue. The foreign keys and their cascades, the two D88 guard triggers
  (`freehold_operation_guard_character_delete` on `characters` and
  `freehold_operation_guard_account_delete` on `accounts`, both running
  `guard_open_freehold_operation_parent_delete()`) and the receipt erase trigger
  (`freehold_operation_receipt_erase`, running `erase_freehold_operation_receipt()`)
  live in the database and PERSIST after a rollback, because nothing removes them, so
  they fire for an old character delete and for an old federated provision cleanup
  exactly as for a new one. Every character and account delete on the old binary
  therefore pays the guard's one SELECT on `freehold_operations` per deleted parent row
  (through `freehold_operations_character` or `freehold_operations_account`), and an
  open intent would still refuse the delete, which the old binary cannot read: its
  character delete has no 55006 arm, so the guard's refusal is rethrown raw and the
  character DELETE route answers a 500, and its federated cleanup
  (`deleteUnusedFederatedProvision`) reports EVERY 55006 as an open storage purchase.
  Zero open intents, section 8's rollback condition, make both unreachable.
- It REPLACES `characters.state` wholesale on every character save. Every fence shape
  in [../../server/character_save_statement.ts](../../server/character_save_statement.ts)
  writes `state = $3` with the entire re-serialized blob, and both statement forms
  (`characterUpdateStatement` and `characterPreimageUpdateStatement`) do the same. A key
  the old binary does not know is not merged and not preserved: it is gone on that
  character's next autosave.

The consequence, stated plainly because it is the whole point of this section.

Normalized tables OUTSIDE `characters` SURVIVE an old writer. That survival is a
property of the old binary having no statement that addresses them, and it is the only
thing survival proves. The same old writer:

- does NOT maintain them. Condition, layout, trophies, visit policy and the durable
  revision stop advancing while players keep playing, so the rows silently go stale and
  a later capable binary resumes from a durable revision older than what actually
  happened at the table.
- does NOT export them. Its `exportAccountData` bundle carries none of the five housing
  keys (`freeholds`, `freeholdHearth`, `freeholdClaims`, `freeholdOperations`,
  `freeholdOperationReceipts`), so any subject-access export served during that window
  is incomplete for that account.
- does NOT honor the account Hearth authority. `advanceFreeholdHearthOnClient` never
  runs, so the shared account cooldown is neither observed nor advanced, and the one
  account-keyed row that C01 makes authoritative is bypassed rather than respected.
- DOES delete any housing value that lives inside the character blob, on the first save
  of that character, by the whole-blob replacement above. This is the hazard DEPLOY.md
  already writes down once under "Bank Storage rollback caveats". Keeping housing in
  the normalized tables rather than the blob is what confines this exposure to the
  committed UI mirrors, and it is a reason those mirrors must stay excluded from
  anything durable.

Therefore: NORMALIZED-TABLE PRESERVATION ALONE DOES NOT ESTABLISH MIXED-RELEASE
CORRECTNESS. "The rows are still there" answers a question nobody needed answered. A
mixed fleet, capable and incapable processes against the same database, must NOT have
housing enabled. Deploy the capable build everywhere first, stop the old process before
starting the new one per realm, and do not overlap them during a rolling restart.

A 07 BINARY WITHOUT 07a is the second, hypothetical shape: a build carrying the 07
modules (the plot and Hearth tables and the store) without the claim and operation
work. It never deployed to production (no release's `ensureSchema` applies
`FREEHOLD_SCHEMA`), so everything below applies ONLY to a dev or PBE database that ran a
07 build, an older build of this branch or a partial pick of it. Against 07a rows it:

- applies `FREEHOLD_SCHEMA` and `FREEHOLD_HEARTH_SCHEMA` and neither 07a fragment, so
  the claim and operation tables and their functions and triggers are left as they are,
  and the Hearth row's `advance_token` column survives untouched (that build's advance
  never writes it, and has no production caller anyway);
- IGNORES the claims: its login reads the plot row without taking one, so it serves a
  plot another realm holds;
- writes UNFENCED: its store writes `account_freeholds` through 07's autocommit
  `upsertFreehold` UPDATE arm, which neither takes the claim fence nor stamps a token,
  while a 07a realm may hold that plot's claim. The compare-and-swap still stops a stale
  overwrite, which leaves exactly the two-realm harm section 8a recorded before the
  claim closed it: the 07a realm that holds the claim meets that write as `stale` at its
  next compare-and-swap, never as `fenced`;
- keeps the key's hard-false admission, so the granted-but-refused gate of section 8a
  returns on that realm;
- exports none of the three 07a keys, erases no receipt at deactivation, and reads a
  guard refusal exactly as the pre-housing binary does (no 55006 arm on the character
  delete, every 55006 reported as storage by the federated cleanup), against the same
  database-side triggers and cascades.

So a 07 process counts as INCAPABLE for a lit fleet, and section 2's fleet rule applies
to it in full.

## 4. The four fixture classes

The contract is written against four durable-state classes, and the persistence tests
carry a fixture for each. Each row states what the current release does and what it
must never do.

| Class | Fixture | What the current release does | What it must NEVER do |
|---|---|---|---|
| pre-07 | An account with no row in either table, the shape an old release leaves behind | `freeholdForAccount` answers `{ kind: 'absent' }` and `loadFreeholdHearth` answers `{ kind: 'absent' }`, which reads as `ABSENT_FREEHOLD_HEARTH` (ready, revision `0`). The account keeps its in-memory tier-0 Inn Room record, and the first durable write is insert-only (`FreeholdUpsert.expectedDurableRev` null) | Create a second default record, mint a `plot_id` for an account that has never written, report absence as a repair, or write anything at all on a read |
| future | A row whose `schema_version` exceeds `FREEHOLD_PERSIST_VERSION`, or one whose `tier` or `visit_policy` is outside the accepted vocabulary, or one carrying a `plot_index` above `FREEHOLD_PRIMARY_PLOT_INDEX` while only the primary index is admitted | The two causes answer DIFFERENTLY, and the difference is which layer saw the row. A forward version, tier or visit policy reaches `normalizeFreehold`, which answers `{ kind: 'unsupported' }` with the reason `version`, `tier` or `visit_policy`; the SQL reader never inspects those columns. Only the stranded `plot_index` is `{ kind: 'unadmitted' }`, because the slot is the one thing the reader itself admits. The store turns either into a `FreeholdRecoveryHold`, and `installLoadedFreehold` installs the hold in place of a state, so the record is read-only | Rewrite, downgrade, drop, normalize or re-encode the row; let an autosave overwrite it; reinterpret an unsupported shape as absence; or treat an unknown stored identifier as invalid input to be filtered away |
| populated | A legal current row at the measured maximum: `FREEHOLD_MAX_LAYOUT_ROWS` layout rows and `FREEHOLD_MAX_TROPHY_ROWS` trophies, with identifiers at `FREEHOLD_MAX_ID_LENGTH` and a `plot_id` at `FREEHOLD_PLOT_ID_MAX_LEN` matching `FREEHOLD_PLOT_ID_RE` | Loads unchanged and round-trips through `persistedFreeholdFromState` and `freeholdStateFromPersisted` without loss. Repairs are confined to the scalar set `FreeholdRepairedField` (`condition`, `rev`, `version`) and are reported in `FreeholdLoadResult.repaired` | Truncate, reorder or de-duplicate rows to make the maximum fit; repair a field it did not actually change; or let one scalar repair disturb any unrelated field |
| oversized | A row past `FREEHOLD_STORED_DETOAST_GATE_BYTES` on disk, or whose measured bytes exceed `FREEHOLD_MAX_STORED_BYTES` in the reader, or `FREEHOLD_MAX_OWNED_BYTES` in the sim | `freeholdForAccount` answers `{ kind: 'oversize', bytes, limit }` and `normalizeFreehold` refuses the same way. The two refuse at DIFFERENT depths, stated plainly rather than claimed alike: the reader refuses before the content columns cross the wire, so nothing is parsed at all, while the sim's ceiling is measured on the canonical JSON of an already-built candidate, which means the row counts are checked before any allocation but the byte check itself follows the build. The row counts are what bound that build, and they are checked first. The store installs a hold and the operator sees only a bounded, redacted diagnostic | Parse or allocate the oversized content in order to decide; write a truncated replacement; clear the row; or require the bounded diagnostic to carry the oversized original |

Two rules cut across all four. Every diagnostic derived from ROW CONTENT goes
through `freeholdLoadDiagnostic`, which carries a kind and a bounded detail and no
player data. The save path's own refusals and the store's operational lines are
built where they are raised, from this codebase's own literals rather than from a
row, and a database error reaches a log through a wrapper that keeps only its
code, its constraint and its message. And a hold is a REFUSAL TO WRITE,
never a refusal to serve: the account keeps playing, and only its housing writes
quiesce.

A hold has NO PLAYER-FACING SURFACE in this release, and that is a deliberate gap
rather than an oversight. An owner whose row is held sees the free tier-0 Inn Room
with none of their furnishings and no explanation, and nothing they do will save.
The alternative, a message about a durable read, is not something this release has
the vocabulary for: the housing UI is dark, so there is nowhere to put it. The
surface is owed by the release that lights housing up, and it is named here so that
release inherits the obligation rather than discovering it. Until then, the only
observer is an operator watching `woc_freehold_persist{measure="held"}`.

### The development tier grant is now DURABLE

Stated plainly because it changes what a dev command costs. `devGrantFreeholdTier`
reaches the live record through `setFreeholdTier`, which bumps the record revision,
and the periodic sweep writes any record whose revision has moved. So on a realm with
housing enabled, a `/dev` tier grant is no longer a session-local convenience: it is
written to `account_freeholds` and survives every later login, on whatever account the
grant was aimed at.

That is the correct behavior for a grant that reaches the one sanctioned tier writer,
and it is exactly why `ALLOW_DEV_COMMANDS=1` must never be set in production: before
this release the blast radius of a stray grant was one session, and now it is an
account's durable record. Nothing here relaxes that rule, and nothing about housing
adds a new way to reach the grant; the dev command gate is unchanged.

07a NARROWS WHERE THE GRANT LANDS, and changes nothing about who can reach it. The
sweep's write now rides the fenced writer (section 5), so the grant is durable only on
the realm that holds the plot's claim. On a realm that does not, it is FENCED: a realm
that answered `claim_busy` at login holds the entry and writes nothing, and a realm
whose claim another realm took over answers `fenced` at the write, writes nothing and
quiesces that owner (`fenced_writes` on `woc_freehold_persist_total`). An account with
no row yet takes the first-insert arm, which claims the new plot at generation 1 in the
same transaction as its row. The grant still rides only the ordinary store write: it
never mints an operation intent, a receipt or a Hearth advance, and no server dev
module imports the trip, mutation, operation or claim modules (a source scan in
[../../tests/server/freehold_mutation.test.ts](../../tests/server/freehold_mutation.test.ts)).

## 5. Source binding

Initial rows are explicitly UNBOUND. `upkeep_binding` carries
`FREEHOLD_UPKEEP_BINDING_UNBOUND`, the literal `unbound_no_history`. Such a row carries
no upkeep-derived day stamp, no week stamp and no credit. There is nothing to
reinterpret, which is the point: a serving realm cannot infer a calendar from a row
that never claimed one. The rule is enforced in the DDL rather than left to a writer:
the `account_freeholds_unbound_carries_no_upkeep` CHECK refuses any row that claims
the unbound binding while also carrying an upkeep checkpoint or a credit, so the
combination that would assert a billing history that never ran cannot be stored.

`updated_at` on the plot row and `ready_at_ms` on the Hearth row are ORDERING AND
AUTHORITY timestamps. They are not calendar facts and no consumer may read them as one.

When day-keyed facts arrive, they arrive with the [condition and ledger core
file](phase-13-condition-and-ledger-core.md) and the [upkeep calendar
file](phase-13a-authoritative-upkeep-calendar.md), and they use the realm-day
`resetDay` vocabulary: the string `resetDayKey`
([../../server/raid_reset.ts](../../server/raid_reset.ts)) produces over the zone the
ACCEPTED BINDING'S reset policy resolves to, with the week anchor from
`emberWeekAnchorOf`
([../../src/sim/professions/masterwrought_materials.ts](../../src/sim/professions/masterwrought_materials.ts)).
Never the serving process's own `REALM_RESET_TIME_ZONE`
([../../server/realm.ts](../../server/realm.ts)): the serving process is one of several
and its bare zone is a local accident, not an account's calendar. Any epoch-millisecond
companion beside such a fact is DISPLAY ONLY.

Recorded honestly, because it changes what this release can promise: no reset-policy
identity, resolver or table exists in code today. A reset policy identifier, a policy
resolver and a housing week helper return no hits anywhere under `src/`, `server/`,
`tests/`, `headless/` or `scripts/`. This release therefore BINDS NOTHING and has no
resolver to call, which is exactly why its rows are unbound with no history. The
migration from unbound to bound is owned by the two files named above, against the
accepted binding artifact the gate row names, and it is not attempted here.

One related trap. The live record's `conditionStampDay` and `ledgerPaidThroughDay` are
numbers documented as a UTC day, seeded zero by the default record. They are the WRONG
TYPE for the realm-day vocabulary and are not persisted as calendar facts. The durable
row carries the explicit unbound binding instead.

### The store's port binding (07a)

The realm store's ports are bound once, in `createGameFreeholdPersistStore`
([../../server/freehold_persist_wiring.ts](../../server/freehold_persist_wiring.ts)),
and 07a rebinds two of them. Neither touches the source binding above.

- THE WRITE PORT, `writeRow`, binds the fenced writer, `createFreeholdFencedWriter`
  ([../../server/freehold_fenced_write.ts](../../server/freehold_fenced_write.ts)). For
  an existing row it sends ONE autocommit statement, `FREEHOLD_FENCED_CAS_SQL` through
  `upsertFencedFreehold` ([../../server/freehold_db.ts](../../server/freehold_db.ts)),
  which REPLACES 07's autocommit `upsertFreehold` UPDATE arm on the store's path (the
  touch-set manifest's P2): the claim fence, 07's compare-and-swap and the token stamp
  as three CTEs of one statement, the claim row locked before the plot row. A plot this
  process holds no claim for answers `fenced` with no statement at all. The first row
  of a new plot is a short transaction that inserts the claim at generation 1 beside
  07's insert, so a lost race rolls both back (P3). The compare-and-swap's SET list is
  07's, so the fenced write, like 07's, never touches `upkeep_binding`,
  `upkeep_checkpoint`, `upkeep_credit`, `plot_id` or `created_at`, and the insert still
  leaves the binding at its unbound default: every 07a write keeps a row UNBOUND. 07's
  `upsertFreehold` UPDATE arm now runs only inside a housing hook's transaction, behind
  that transaction's own claim write fence, and nothing in production sends a plot
  write through the hook in this release (the Hearth trip writes no plot row).
- THE LOGIN PORT, `readDurables`, binds `readClaimedLoginDurables`
  ([../../server/freehold_claim_login.ts](../../server/freehold_claim_login.ts)): one
  bounded transaction that reads the Hearth clock, then claims the plot, then reads the
  row (P4; section 7 prices it). The two-port fallback (`readRow`, `readHearth`) stays
  bounded and unused on this host.

## 6. Account lifecycle

Housing is ACCOUNT state. Every row below follows from that one sentence.

| Path | Behavior | Anchor |
|---|---|---|
| Account export | Every housing table rides the bundle through ONE loader, under 07's keys `freeholds` and `freeholdHearth` plus `freeholdClaims`, `freeholdOperations` and `freeholdOperationReceipts`, each an explicit column allowlist (section 2, item 3) | `exportAccountData` in [../../server/db.ts](../../server/db.ts); `freeholdAccountExport` in [../../server/freehold_account_export.ts](../../server/freehold_account_export.ts) |
| Soft deactivation | Plot, Hearth and claim rows are PRESERVED. The access restriction applies; no cascade fires, and no absence or grace is manufactured. Receipts are ERASED instead, below | `setAccountDeactivated` and `handleAccountDeactivate` in [../../server/account.ts](../../server/account.ts) |
| Authorized restoration | Plot, Hearth and claim rows are PRESERVED and the retained state is reloaded. No fresh Charter, no first-arrival mark and no fresh grace is granted merely because an account came back. The receipt erase is ONE-WAY: a restored account's erased receipts stay erased and no longer appear in its export | the same `setAccountDeactivated`, cleared |
| Character deletion | Plot, Hearth, claim and receipt rows are PRESERVED: none of them is keyed on a character. An OPEN intent that names the character REFUSES the delete (D88, below) | `deleteOwnedCharacterRow` in [../../server/character_delete_db.ts](../../server/character_delete_db.ts); `CharacterFreeholdOperationOpen` |
| True account deletion | Plot, Hearth and claim rows cascade, through the `accounts` foreign key each table declares; receipts are KEPT with their account, plot id and fingerprint erased; an OPEN intent REFUSES the delete | `FREEHOLD_SCHEMA`, `FREEHOLD_HEARTH_SCHEMA`, `FREEHOLD_CLAIM_SCHEMA` and `FREEHOLD_OPERATION_SCHEMA` |
| Retention | Keep-forever for plots, Hearth rows, claims and receipts: none is swept. The account cascade is the only removal path for plots, Hearth rows and claims; a receipt is never removed, and an account delete or deactivation erases its identifying columns instead. Open intents are bounded per account and deleted by their own apply or close | [../../server/retention_sweep.ts](../../server/retention_sweep.ts), with the absence pinned in [../../tests/server/main_retention_wiring.test.ts](../../tests/server/main_retention_wiring.test.ts) |

THE D88 ITEM THIS SECTION CARRIED AS OWED IS CLOSED by 07a, in code with tests. An open
housing operation now REFUSES a character or account deletion, with a mapped refusal
class and a stable error code:

- the character delete pre-reads open intents in the guard triggers' own firing order
  (`CHARACTER_DELETE_FREEHOLD_OPERATION_SQL` before the storage pre-read) and throws
  `CharacterFreeholdOperationOpen`
  ([../../server/character_delete_db.ts](../../server/character_delete_db.ts)), which
  the character DELETE route answers as a 409 with the body code
  `character.freehold_operation_open` (`CHARACTER_FREEHOLD_OPERATION_OPEN_BODY` in
  [../../server/character_delete_http.ts](../../server/character_delete_http.ts),
  registered in [../../server/http/error_codes.ts](../../server/http/error_codes.ts));
- BOTH parents carry a BEFORE DELETE guard trigger,
  `freehold_operation_guard_character_delete` on `characters` and
  `freehold_operation_guard_account_delete` on `accounts`, raising SQLSTATE 55006 with
  the CONSTRAINT field `freehold_operations_open_delete_guard`
  (`FREEHOLD_OPERATION_OPEN_CONSTRAINT`); the character delete maps that 55006 back to
  the same class through `parentDeleteGuardOf`, matched EXACTLY on the CONSTRAINT field
  and AHEAD of the ambiguous-commit verify, because a guard refusal is a proved
  rollback;
- the intent's parent keys are RESTRICT, never CASCADE, so if a guard is ever missing
  the foreign key still fails closed (a raw 23503, a 500 on the route, never a silent
  delete);
- the one production hard account delete, `deleteUnusedFederatedProvision`
  ([../../server/federated_auth_db.ts](../../server/federated_auth_db.ts)), switches on
  the same CONSTRAINT field and throws the typed `FederatedProvisionFreeholdOperationOpen`
  (there is no HTTP surface on that path; the 409 code is the character route's), and
  any 55006 naming neither guard surfaces raw.

The shape is the `CharacterStoragePurchaseOpen` precedent beside it. Proved in
[../../tests/server/freehold_mutation.pg.test.ts](../../tests/server/freehold_mutation.pg.test.ts)
(both deletes refused while an intent is open, then each row class landing as the table
below declares), [../../tests/character_db.test.ts](../../tests/character_db.test.ts)
and
[../../tests/server/character_delete_http.test.ts](../../tests/server/character_delete_http.test.ts)
(the mapping and the 409), and
[../../tests/federated_auth_db.test.ts](../../tests/federated_auth_db.test.ts) (the
typed federated refusal). No production operation kind is registered in this release
(`FREEHOLD_OPERATION_RECONCILERS` is empty and nothing outside the tests prepares an
intent), so the refusal is in place before anything can be open against it, which is
the order the activation gate asked for.

The per-row-class deletion policy (the touch-set manifest's section 8):

| Row class | Character delete | Account delete |
|---|---|---|
| open intent (`freehold_operations`) | REFUSED (`CharacterFreeholdOperationOpen`, 409 `character.freehold_operation_open`; the RESTRICT key is the backstop) | REFUSED (55006 from the account guard, or from the character guard through the characters cascade) |
| tombstone (`freehold_operation_receipts`) | kept (no character column) | kept, with `account_id`, `plot_id` and `fingerprint` NULL (the SET NULL action plus the erase trigger) |
| claim (`freehold_plot_claims`) | untouched | cascades (its plot row cascades too, and a plot id is never reused) |
| plot, Hearth (07) | untouched | cascade (07) |

THE SOFT-DELETE ERASE. The player-facing account deletion is the soft delete
`handleAccountDeactivate`, which fires no cascade, so it ERASES the account's
tombstones itself, the `deleteAccountAttribution` precedent beside it:
`eraseFreeholdOperationReceiptsForAccount`
([../../server/freehold_operation_db.ts](../../server/freehold_operation_db.ts)) nulls
the receipts' `account_id` in its own transaction, the account row FOR UPDATE first,
and that UPDATE fires the same erase trigger, so each tombstone keeps only replay
authority (operation id, kind, outcome, revision, time). It runs AFTER the token revoke
and the disconnect and NEVER fails the deactivation: a failure warns once with a
bounded line and no account id, and the erase is idempotent, so an operator re-runs it.
A deactivated account prepares nothing (`prepareFreeholdOperation` answers
`parent_missing`), and a receipt written for one is written already erased. The
soft-delete question section 8a carries is carried to the 07a rows with it: receipts
are answered for identity by this erase while the anonymized tombstone itself stays
keep-forever until the accepted retention schedule (the "Counsel, Terms and storefront
model" gate) allows a scheduled cascade, and claims of a soft-deleted account stay,
with its plot and Hearth rows, under the existing soft-delete gate. Open intents at
deactivation belong to the work that registers the first kind with external spend
([the Charter and Call file](phase-15-claudium-charter-and-call.md)); no production kind
exists in this release.

## 7. Bounds

Every persisted collection carries a row ceiling, a byte ceiling and a query ceiling, and
each one is derived from an approved number rather than chosen. The derivation rule is the
one [content-numbers-workbook.md](content-numbers-workbook.md) section H states: build the
maximal legal fixture against approved costs and capacities, encode canonical JSON as
UTF-8 and measure it, then publish a limit that ADMITS that maximum and REJECTS one over,
before mutation or large allocation.

The settled symbols, their values, and where each value comes from.

| Ceiling | Symbol | Value | Derivation |
|---|---|---|---|
| Layout rows per plot | `FREEHOLD_MAX_LAYOUT_ROWS` | 420 | The largest approved `decorBudget` on the tier ladder, Citadel at 420, divided by the smallest approved positive `decorCost`, 1 |
| Trophy rows per plot | `FREEHOLD_MAX_TROPHY_ROWS` | 32 | The largest approved plinth count, Citadel |
| Identifier length | `FREEHOLD_MAX_ID_LENGTH` | 64 | The longest approved content identifier a layout or trophy row may carry, checked before decode |
| Public plot id length | `FREEHOLD_PLOT_ID_MAX_LEN` | 64 | The shared opaque public identity limit already pinned in [../../server/freehold_wire.ts](../../server/freehold_wire.ts), matched by `FREEHOLD_PLOT_ID_RE` |
| Account read rows | `FREEHOLD_ACCOUNT_PLOT_READ_LIMIT` | 2 | The approved two-plot account cap, read WIDER than the writer admits so a forward row is preserved rather than filtered away |
| Owned bytes per plot, canonical JSON | `FREEHOLD_MAX_OWNED_BYTES` | 101376 | Measured, see below |
| Owned bytes per plot, as stored | `FREEHOLD_MAX_STORED_BYTES` | 106496 | Measured against PostgreSQL 16, see below |

Both byte ceilings are MEASURED values, and they are TWO DIFFERENT MEASUREMENTS of one
record rather than one number used twice. The maximal legal fixture, and the two-over
refusal fixture beside it, are published in
[../../tests/helpers/maximal_freehold.ts](../../tests/helpers/maximal_freehold.ts) and
driven from [../../tests/freehold_state.test.ts](../../tests/freehold_state.test.ts).

`FREEHOLD_MAX_OWNED_BYTES` bounds the CANONICAL JSON the sim serializes: the maximal
legal record measures 101139 UTF-8 bytes through the exact serializer the save path uses,
rounded up to 101376.

`FREEHOLD_MAX_STORED_BYTES` bounds what PostgreSQL renders back out of jsonb, which is
what the SQL `octet_length` measure actually sees. jsonb is not a byte copy of the text
that went in: it re-renders every object with a space after each colon and each comma,
and it stores every JSON number as `numeric`, which always prints positionally. The same
record's two content columns measure 100866 bytes as canonical JSON and 106032 bytes as
stored text, so the stored ceiling is 106496. The gap is fixed rather than unbounded only
because the codec refuses a number whose JSON text carries an exponent; without that rule
an all-exponential record would pass the canonical ceiling and store at nearly six times
its size.

Enforcement is THREE-STAGE, and each stage bounds what it can actually see. SQL applies a
cheap ON-DISK pre-gate first (`FREEHOLD_STORED_DETOAST_GATE_BYTES`, read from the TOAST
pointer header without detoasting), then `FREEHOLD_MAX_STORED_BYTES` through an
`octet_length` bound that nulls the content columns before any deep parse can reach them. The sim applies `FREEHOLD_MAX_OWNED_BYTES` through
`persistedFreeholdBytes`, on load and, through `freeholdWriteRefusal`, before every save:
a document past any load ceiling is never written, so a row this realm produces is always
a row this realm can read back. The executed proof of the pair is the maximal-record round
trip in
[../../tests/server/freehold_db.pg.test.ts](../../tests/server/freehold_db.pg.test.ts),
which writes the maximal record, reads it back as a row at the stored bound, and asserts
that the canonical bound refuses the very same row.

Query and plan evidence: produced by two real-Postgres suites, both executed armed
against PostgreSQL 16 on 2026-09-08.
[../../tests/server/freehold_db.pg.test.ts](../../tests/server/freehold_db.pg.test.ts)
supplies the account read plan, the compare-and-swap race and the cascade behavior, and
[../../tests/server/freehold_hearth_db.pg.test.ts](../../tests/server/freehold_hearth_db.pg.test.ts)
supplies the account participant lock wait and the same-account race. Both suites skip
clean without `TEST_DATABASE_URL`, so an unarmed run must never be read as evidence: the
armed run is the one that counts, and it is the one recorded here.

The workbook row for these bounds is in
[content-numbers-workbook.md](content-numbers-workbook.md) section H, landed in the same
change that measured them. The ceiling is therefore PUBLISHED. Publication is not
permission: every gate in section 1 still stands, and housing remains disabled.

### The 07a bounds, and the two figures re-derived on them

The 07a work adds OPERATIONAL bounds, not content ceilings. None is derived from the
workbook; each is stated with its reason, and a value that reuses an existing policy
says so.

| Bound | Symbol | Value | Reason |
|---|---|---|---|
| Open intents per account | `FREEHOLD_OPERATION_OPEN_PER_ACCOUNT` | 8 | Exact under the per-account advisory lock the prepare takes; also the recovery pass's read limit (`openFreeholdOperationsForAccount`), so one pass sees every intent an account can hold, and the intents export's bound |
| Ids per renew or release statement | `FREEHOLD_CLAIM_RENEW_CHUNK` | 256 | A bound on one statement's lock set and on what one blocked row can delay, never a capacity: every wanted claim is renewed every pass, in as many chunks as it takes |
| Shutdown claim release | `FREEHOLD_CLAIM_RELEASE_ALL_DEADLINE_MS` | 2,000 ms | Its own bound INCLUDING the pool checkout, so the release can never hold the lease release behind it; an abandoned release leaves its claims to expire |
| Exported receipts per account | `FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT` | 200 | The 07 export bound's shape: newest first, read as the limit plus one so the truncation marker is exact |
| Copy references per intent | `FREEHOLD_OPERATION_MAX_COPY_REFS` | 64 | Enforced in TypeScript, never in DDL, so a later kind can raise it without relaxing a pinned constraint |
| Claim lease TTL | `LEASE_TTL_SECONDS` (reused) | 90 s | The character lease policy, reused rather than guessed; every claim `ttlSeconds` site in the wiring binds it (a source pin in [../../tests/server/freehold_claim.pg.test.ts](../../tests/server/freehold_claim.pg.test.ts)), so a renewer on the 30 s autosave cadence survives two missed heartbeats |
| Trip waits and refusal memo | `FREEHOLD_HEARTH_TRIP_MEMO_MS` | 5,000 ms | The `FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS` player-waiting value, reused: it bounds the trip's queue and permit WAITS (never its transaction) and the per-account refusal memo |

The transaction bounds, each statement, lock, idle and wall in milliseconds through
`runFreeholdTransaction` ([../../server/freehold_tx.ts](../../server/freehold_tx.ts)),
which sends BEGIN and every SET LOCAL as ONE round trip, arms a `DbTransactionDeadline`
wall that destroys the socket when it fires, and checks COMMIT's command tag:

- the login read, `FREEHOLD_CLAIM_LOGIN_BOUNDS`: 2,000, 1,000, 2,000, 10,000 (the wall
  equals `FREEHOLD_PERSIST_LOGIN_BUDGET_MS`);
- the first insert and the ambiguous-retry adopt transaction,
  `FREEHOLD_FENCED_WRITE_BOUNDS`: 15,000, 2,000, 2,000, 30,000. The ORDINARY fenced
  write is no transaction at all: ONE autocommit statement on 07's bounds (the pool's
  `DB_STATEMENT_TIMEOUT_MS` default and the driver's `DB_QUERY_TIMEOUT_MS`);
- the renewer and the per-pass release, `FREEHOLD_CLAIM_RENEW_BOUNDS`: 2,000, 1,000,
  2,000, 5,000; the shutdown release takes the same with its wall at
  `FREEHOLD_CLAIM_RELEASE_ALL_DEADLINE_MS`;
- the operation prepare and close, `FREEHOLD_OPERATION_PREPARE_BOUNDS`: 2,000, 2,000,
  2,000, 5,000; the soft-delete erase, `FREEHOLD_OPERATION_ERASE_BOUNDS`: 15,000,
  5,000, 2,000, 30,000;
- inside a hooked character save, the hook's own statements under
  `FREEHOLD_HOOK_STATEMENT_TIMEOUT_MS` (15,000, the
  `CHARACTER_SAVE_SIGNAL_STATEMENT_TIMEOUT_MS` value), and the ambiguous-COMMIT verify
  under `FREEHOLD_VERIFY_BOUNDS` (15,000, 10,000, 2,000, 30,000: the character delete
  verify's bounds under one wall), both in
  [../../server/freehold_mutation.ts](../../server/freehold_mutation.ts).

THE LOGIN FLOOR, RE-DERIVED. Section 8a's 104,000 ms prices 07's login shape, the five
statements of `runWithStatementTimeout` on one client. 07a REPLACED that shape: the
login port binds `readClaimedLoginDurables`, ONE `runFreeholdTransaction` under
`FREEHOLD_CLAIM_LOGIN_BOUNDS` that reads the Hearth clock, then the primary plot id
(`FREEHOLD_PRIMARY_PLOT_ID_SQL`, no lock), then the lock-free busy pre-check
(`FREEHOLD_CLAIM_BUSY_SQL`), then the acquire upsert (`FREEHOLD_CLAIM_ACQUIRE_SQL`),
then 07's row read, then a tag-checked COMMIT. Priced the way 07 was, statement by
statement, on the bound each one actually answers to:

5,000 (`DB_POOL_CONNECT_TIMEOUT_MS`, the checkout) + 15,000 (`DB_STATEMENT_TIMEOUT_MS`,
for BEGIN and the three SET LOCAL lines, ONE round trip now, still answering to the
session default because the lowered bound is not in force for the message that sets
it) + 5 x 2,000 (the Hearth read, the plot-id pre-read, the busy pre-check, the acquire
and the row read) + 65,000 (`DB_QUERY_TIMEOUT_MS`, for COMMIT) = 95,000 ms.

That is 07's 104,000, less one 15,000 ms round trip (BEGIN and SET LOCAL merged), plus
three 2,000 ms statements (the pre-read, the pre-check and the acquire). THE SUM IS NO
LONGER THE FLOOR, because 07a added a bound the 07 shape did not have: the WALL.
`runFreeholdTransaction` arms the wall at `FREEHOLD_CLAIM_LOGIN_BOUNDS`' 10,000 ms as
soon as the client is checked out, and when it fires it destroys the socket, so
whatever statement is in flight, COMMIT included, rejects at the client. One login
transaction therefore answers inside 5,000 (checkout) + 10,000 (wall) = 15,000 ms, and
the clock-fault arm (a Hearth read that throws with nothing acquired rolls back and the
plot half runs again in a SECOND transaction on a fresh checkout) at most doubles it:
2 x (5,000 + 10,000) = 30,000 ms. THE RE-DERIVED FLOOR OF THE LOGIN PORT IS 30,000 ms,
and it is a DERIVATION from the bounds in code, not a measurement: the real-PG suite
proves the fault arm's behavior (the claim held and the clock answered as thrown, in
[../../tests/server/freehold_claim.pg.test.ts](../../tests/server/freehold_claim.pg.test.ts))
but times nothing. What a player waits is unchanged: `FREEHOLD_PERSIST_LOGIN_BUDGET_MS`
(10,000 ms) still caps the whole preload and answers `no_budget` past it, and 30,000 ms
is now how long an abandoned read can stay in flight behind that refusal. A COMMIT the
wall cut is answered as THROWN, so the plot is held rather than served, and the claim it
may have taken stays unrecorded and expires after `LEASE_TTL_SECONDS`.

THE DIRTY-OWNER CEILING, RE-DERIVED. Section 8a's figure, about 10,300 concurrently
dirty owners per sweep, is the write cap divided by the per-write statement latency,
times the autosave period: at the measured 345 writes per second at the steady cap of
four, 345 x 30 = 10,350. 07a keeps the form, because the store's ordinary write is still
ONE autocommit statement per dirty plot: `upsertFencedFreehold` sends
`FREEHOLD_FENCED_CAS_SQL` (the fence, the compare-and-swap and the token stamp as three
CTEs) where 07 sent its UPDATE arm, so the round trips per write, the cap and the period
are all unchanged, and so is the figure: 345 x 30 = 10,350, about 10,300. What 07a did
NOT carry over is the 345: that throughput was measured on 07's statement, and the
fenced one also locks the claim row and, when the compare-and-swap lands, rewrites it
with the token (a second row write per statement, on a fillfactor-80 table). So THE
CEILING STANDS
AS A DERIVATION awaiting the real-PG re-measure the touch-set manifest's section 10
names: the shutdown drain at 5,000 owners on the fenced statement, PASS when it drains
inside `FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS` (10,000 ms) on this host. The rarer write
shapes sit off the steady path and do not move it: the FIRST insert of an absent plot is
a transaction of four round trips (BEGIN with its bounds, the claim insert at
generation 1, 07's insert, COMMIT), three more than 07's single autocommit insert, once
per account; and the retry after an AMBIGUOUS write is a transaction of four to five
(BEGIN, the locked token read, the revision read when it adopts, the fenced statement,
COMMIT), once per lost answer. A diagnosis read adds one to either, as it does in 07.

THE RENEWER AND THE TRIP, derived, not measured. Each renewer pass renews every wanted
claim in chunks of `FREEHOLD_CLAIM_RENEW_CHUNK`, each its own short transaction of three
round trips (BEGIN with its bounds, the renew, COMMIT), four when SKIP LOCKED passed a
row over and the lock-free still-held read runs: at 5,000 wanted plots, 5,000 / 256
rounds up to 20 chunks, so 60 to 80 round trips per 30 s pass, awaiting the manifest's
"renewer at 5,000 wanted plots beside the dirty-plot autosave" measurement. A Hearth
trip adds to its one character save the hook's statement-bound line, the claim read
fence when this realm holds the plot's claim, and the Hearth participant (the KEY SHARE
re-lock, the lazy insert, the locked read, and on an advance the UPDATE): 5 to 6 round
trips on an advance, 4 to 5 when the Hearth participant answers cooldown or corrupt,
and fewer when the claim read fence refuses first.

## 8. Rollout and rollback quiescence

### Enable order

Every step assumes the release gates in [state.md](state.md) "Tracked release and
handoff gates" are signed, this contract included.

1. Deploy the capable build, which now means the 07a set (section 2), to EVERY process
   sharing the database, with `FREEHOLDS_ENABLED` unset. Boot applies all four
   fragments unconditionally, so the tables exist before the feature does and enabling
   never needs a migration window.
2. Confirm the whole fleet is capable against section 2, 07a included. One incapable
   process is enough to make the fleet incapable, and a pre-housing or 07 process
   counts as one; section 3 says what each would do.
3. Set `FREEHOLDS_ENABLED=1` and RESTART each realm process. The route and the wire
   read the flag live, but the realm Sim snapshots it at boot, so a restart is what
   actually enables housing. Stop the old process before starting the new one per
   realm; do not overlap them.
4. Verify on a dark-realm control that a process without the flag still answers the
   disabled refusal, refuses every housing frame at dispatch and boots a dark Sim.

THE FIRST ROLLOUT NEEDS A QUIET WINDOW, even though step 1 is flag-off. On a production
database, which has never held a housing table, the first capable boot creates FIVE
foreign-key-bearing tables (`account_freeholds`, `account_freehold_hearth`,
`freehold_plot_claims`, `freehold_operations`, `freehold_operation_receipts`) plus THREE
triggers (the two parent-delete guards and the receipt erase) inside the ONE
`ensureSchema` transaction, which runs on its dedicated boot client with no
`lock_timeout`. That DDL needs SHARE ROW EXCLUSIVE on `accounts` and `characters` (a
later boot that has to repair a trigger takes ACCESS EXCLUSIVE for its DROP TRIGGER),
but EVERY boot already holds both under ACCESS EXCLUSIVE from the core schema's first
`ADD COLUMN IF NOT EXISTS` statements to its COMMIT, so the housing DDL adds no wait:
every boot queues behind every in-flight character save and account write, and every one
that arrives after it queues behind the boot until that COMMIT. Measured with an old
realm serving plain saves, the first rollout took about 65 ms, the same as a
steady-state boot. ANY boot can DEADLOCK on two paths (the touch-set manifest's P12 and
R-11): the boot's SHARE lock on `characters` upgraded to ACCESS EXCLUSIVE, against a
transaction that took a lock on `characters` that SHARE does not wait for (a save's row
lock's ROW SHARE, or a plain read's ACCESS SHARE) and then writes it; and the boot's
`characters`-then-`accounts` order, against a transaction that locks `accounts` first.
Every effect-carrying or hooked character save (the manifest's G1 then G2, the Hearth
trip's save included) takes both shapes, and the operation prepare and the character
delete take the second. With such saves in flight every bench boot was eventually
aborted, saves were aborted beside it, and a boot that loses exits and is restarted: a
hazard of the core schema's boot that predates housing
(`docs/freeholds/qa/mutation-2026-09-30/workload-evidence.md`), to which 07a adds
members. The first rollout is the one boot that also builds the tables: do it, and any
boot beside other realms serving those saves, in a quiet window, and never beside a
realm that is still shutting down (a shutdown flush save that fails gets one more pass
only when it carried guild bank books, and otherwise is not written again).

### The shutdown drain, and why it sits where it sits

`freeholdPersistIdle(FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS)` belongs in the
[../../server/main.ts](../../server/main.ts) shutdown closure AFTER the character saves
and BEFORE `releaseAllCharacterLeases`, the slot the bank ledger and market
sold-volume drains already occupy, and for the same reason.

Once the leases drop, a replacement process may immediately load the same account. A
plot write still queued here would then flush after that process has already read the
durable row. Either it loses the compare-and-set and the owner's last edits are gone
without a trace, or, if it did not have to compete, it lands over state a live process
is already serving. Draining first closes that window on a clean restart.

The drain is BOUNDED, deliberately. A database that accepts the connection and never
answers must not hold the process past the supervisor's kill grace, because that would
lose the character saves already flushed above to SIGKILL and skip the lease sweep
entirely. A generation the deadline abandons leaves the same hole a crash leaves, and
the durable compare-and-set refuses a stale write rather than corrupting a good one.
The drain never throws; a missed deadline logs one line and the shutdown continues.

THE RENEWER STOP comes first in that slot: `stopFreeholdClaimRenewer` starts no pass
again, stops the running one before its next chunk, cuts a chunk still parked at its pool
checkout, makes one that got its connection send no renewal (only its BEGIN, rolled back),
and resolves once that pass settles or one chunk's wall
(`FREEHOLD_CLAIM_RENEW_BOUNDS.wallMs`, 5,000 ms) passes; that timeout bounds only the
stop's wait, while a chunk is cut by its own wall (its socket destroyed, then a best-effort
backend cancel through the canceller's own pool). So no renewal whose COMMIT was not yet
sent outlives the release; one whose COMMIT was already sent when its wall cut it client
side can still land after the release-all passed its rows, and one cut mid-statement may
still hold its rows as the release passes them by (SKIP LOCKED), which keeps at most one
renew chunk of plots claimed for at most one lease TTL (the manifest's R-13, the crash
bound).

THE SHUTDOWN BUDGET is the whole serial chain in `server/main.ts`, not the housing tail
alone, and `tests/server/freehold_mutation.test.ts` pins every await in it against this
paragraph, so a step added, removed or newly bounded at its call site fails there until
the pin lists it and, when it is bounded, this paragraph names it.
The budget counts these deadlines. At the call site: the bank ledger's drain
(`BANK_LEDGER_SHUTDOWN_DRAIN_MS`, 10,000 ms), the market sold volume's
(`MARKET_SOLD_VOLUME_SHUTDOWN_DRAIN_MS`, 10,000 ms), the housing drain
(`FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS`, 10,000 ms), the unstuck records'
(`UNSTUCK_RECORD_SHUTDOWN_DRAIN_MS`, 5,000 ms) and the Steam and Epic mirror stops (run
concurrently, 5,000 ms). Inside the callee: the renewer stop
(`FREEHOLD_CLAIM_RENEW_BOUNDS.wallMs`, 5,000 ms) and the claim release
(`FREEHOLD_CLAIM_RELEASE_ALL_DEADLINE_MS`, 2,000 ms). That is 47 s of bounded waits, inside
the game container's 75 s kill grace (`stop_grace_period` in `docker-compose.yml`). EVERY
other await in that closure, from the collector and sweep stops before the save flush to
`pool.end()` at its end, passes no deadline and is not counted here, whatever its callee
does inside, and spends from the same grace; `pool.end()` also waits for every client
still checked out, whatever holds it (a timed-out drain's mid-query client, an un-awaited
account-wealth sweep pass, a request still in flight). A new shutdown step spends from
what is left after all of them.

THE CLAIM RELEASE (07a) sits in the same closure, AFTER `freeholdPersistIdle` and BEFORE
`releaseAllCharacterLeases`: `releaseAllFreeholdClaims({ pool, holder:
PROCESS_LEASE_HOLDER })` releases every LIVE claim this process holds in one statement,
so a replacement process can take the plots at once instead of waiting out
`LEASE_TTL_SECONDS`. After the drain, because a release under a write still in flight
would fence that write and lose its edits; before the leases, so the plots are free by
the time a replacement can load a character. It has its OWN bound,
`FREEHOLD_CLAIM_RELEASE_ALL_DEADLINE_MS` (2,000 ms), INCLUDING its pool checkout, and it
NEVER rejects: a release that cannot run inside the bound warns once and leaves its
claims to expire, the same as a crash. A release is FINAL: it renames the holder
(`FREEHOLD_CLAIM_RELEASED_SUFFIX`) as well as expiring the row, so a renewal already in
flight cannot revive it and a late write of this process is fenced rather than landing
over the replacement's state, and SKIP LOCKED leaves a row that a write abandoned at
the drain deadline still holds to expire on its own instead of failing the whole
release. The slot is pinned in
[../../tests/server/main_retention_wiring.test.ts](../../tests/server/main_retention_wiring.test.ts).

### The thrown-run retry clock, and what a restart during a database fault costs

A database FAULT (a dropped connection, a statement or driver timeout, exhausted
resources, an operator restart, a permission or schema fault) is not an answer, so a run
of them never quiesces an owner (R1, 2026-09-26; `server/freehold_write_retry.ts`). Three
thrown writes for one owner inside `FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS` (five minutes)
put the owner on a RETRY CLOCK: its entry, its unwritten edits and any leave capture stay,
no write is armed for it until the clock is due, and the periodic sweep then issues ONE
statement, AT MOST one per owner per window. Retries hold at most
`FREEHOLD_PERSIST_RETRY_WRITE_CAP` (two) of the store's write slots and are pumped after
ordinary writes (their backlog is its own `deferred_retries` measure), so a slow fault
stretches their cadence rather than starving healthy owners; the shutdown drain lifts that
sub-cap to its own whole cap, since nothing else then competes. A commit clears the clock; an answer no repeat can change (the fence's stale, a
missing or conflicting row, the seal, a ceiling, or a thrown refusal of the document
itself: a data or constraint SQLSTATE, or the writer's own branded structural refusal,
`FreeholdUpsertRefused`) quiesces as before. A player who returns meanwhile gets the kept
house installed and plays on, and their edits ride the next retry.

THE COST, stated as a bound: an owner on the clock with no session left holds up to TWO
full records that a quiesce used to free (its committed state and its leave capture),
measured at 180 MiB per thousand such owners at the approved 420-row ceiling (a session
probe of the real store, 2026-09-27), for as long as the fault lasts. Nothing caps the
count, because a cap would choose whose edits to drop, and the set is NOT bounded by the
realm's online count: a WRITE-ONLY fault (a revoked permission, a column missing because
code deployed ahead of its migration, lock or statement timeouts on the housing table, a
failing trigger) lets logins carry on, so it grows with every owner who edits a house until
an operator acts. `retrying` names the set and `retrying_offline` its memory share. A
RESTART DURING THE FAULT gives every such owner one last attempt inside the drain above, at
the drain's full cap and never after it, and the edits that still throw end with the process: that is the drain's
accepted bound (R3), logged as the drain's one line. So a housing operator alerts on a
sustained `retrying` and treats it as an outage to end before any planned restart, never
as a data incident.

THE SELF-FENCE (R2) IS CLOSED by 07a, and this is the case of it that belonged here: a
thrown write can have COMMITTED, and before 07a the next write then met its own revision
as stale, released every later edit with the fence's warn line, and looked exactly like
a second writer. On this host the likeliest cause is the driver's 65 s query timeout
firing while a COMMIT waits on a slow flush (`statement_timeout` does not bound COMMIT);
a dropped connection is the other. THE MECHANISM is the fenced writer's ambiguous-retry
adopt arm (`createFreeholdFencedWriter`,
[../../server/freehold_fenced_write.ts](../../server/freehold_fenced_write.ts)). Every
write that LANDS stamps a fresh per-attempt token on the plot's claim row in the same
statement, and only then (the `stamp` CTE of `FREEHOLD_FENCED_CAS_SQL` writes only when
the compare-and-swap wrote, so a stale attempt commits no token). A write whose answer
was lost without proof of rollback (`freeholdCommitMayHaveLanded`) leaves its token
PENDING in the claim registry, and the next write for that plot runs as a short
transaction that first reads the claim's token under FOR NO KEY UPDATE
(`FREEHOLD_CLAIM_TOKEN_LOCK_SQL`), which waits out any transaction still holding the
row. A token equal to the pending one PROVES the earlier write landed, so the expected
revision adopts the row's current `durable_rev` (counted as `claim_self_adopted` on
`woc_freehold_authority_total`) and the new document goes out on top of it; any other
token means it did not land, and the expected revision stands. So on a capable fleet a
`stale_writes` right after `write_failures` on a SINGLE realm is no longer the expected
signature of the realm fencing itself, and another realm cannot produce one either,
because the claim fences its write before its compare-and-swap runs (`fenced_writes`).
Proved by
[../../tests/server/freehold_mutation.test.ts](../../tests/server/freehold_mutation.test.ts)
(the adopt arm, and the pending token noted on an unproved throw) and
[../../tests/server/freehold_claim.pg.test.ts](../../tests/server/freehold_claim.pg.test.ts)
(one write through a matching fence, no token stamped on a stale write, nothing written
through a wrong one).

### Rolling back

TURN THE FEATURE FLAG OFF BEFORE ROLLING BACK. Unset `FREEHOLDS_ENABLED` and restart
on the CAPABLE build first, so the realm stops accepting housing mutations while it can
still persist the ones already in flight and can still drain its queue. A rollback that
reverts the binary first strands in-flight housing edits on a process that is about to
lose its only writer.

THE ROLLBACK TARGET IS THE PRE-HOUSING RELEASE (section 3): no 07 build ever deployed,
so on a production database a rollback of 07a reverts to a binary that has no housing
code at all, never to a 07 one. It is acceptable ONLY while production is dark AND
`freehold_operations` holds ZERO rows, verified with the fleet stopped by
`SELECT count(*) FROM freehold_operations` = 0 (query 3 under Data rollback below).
With no production operation kind registered, nothing in a shipped realm prepares an
intent, so a NON-ZERO count is a D9/D81 boundary incident to investigate (something
outside the tests reached the operation module), NEVER a `DELETE`: each intent is
closed through `cancelFreeholdOperation` on the capable build, which writes its
terminal receipt, and claims and receipts are never deleted at all. Zero intents is
what makes the old binary's two blind spots unreachable: its character delete answers a
guard refusal as a raw 55006, a 500, and its federated cleanup reports every 55006 as a
storage purchase.

What a rollback to an incapable release leaves behind:

- All five housing tables INTACT. No old code path addresses them, so nothing is
  dropped or rewritten. Section 3 is the full account of why that is not reassurance.
- The 07a DATABASE OBJECTS IN PLACE, because nothing removes them: the D88 guard
  function `guard_open_freehold_operation_parent_delete()` and its two triggers
  (`freehold_operation_guard_character_delete`,
  `freehold_operation_guard_account_delete`), the erase function
  `erase_freehold_operation_receipt()` and its trigger
  (`freehold_operation_receipt_erase`), and the Hearth row's `advance_token` column. The
  old binary has no statement that names any of them, but the triggers and the foreign
  keys keep firing on the statements it does issue, so every character and account
  delete it runs pays the guard's one SELECT on `freehold_operations` (section 3).
  NEVER DROP `freehold_operations` while those guard triggers exist: the guard function
  reads it, so every character and account DELETE would fail with 42P01 on every
  binary. Removing the objects by hand goes triggers first (the two guards, then the
  erase trigger), then the two functions, then the tables (DEPLOY.md carries the
  statements' order for the operator).
- The claims UNRENEWED. They expire after `LEASE_TTL_SECONDS` and the rows are kept, so
  the fencing generations survive the round trip: a roll forward takes each plot as a
  takeover and advances its generation.
- UNMAINTAINED. Condition, layout, trophies, visit policy and the durable revision stop
  advancing while players keep playing. Rows read plausible and are simply old.
- UNEXPORTED. A subject-access export served during that window omits every housing
  bundle key and is incomplete for every account that owns a plot.
- The account Hearth authority UNOBSERVED and unadvanced, so nothing enforces the
  shared account cooldown the row exists to hold.
- Any housing value inside `characters.state` DELETED on that character's next save, by
  the whole-blob replacement in
  [../../server/character_save_statement.ts](../../server/character_save_statement.ts).
  The normalized tables are the durable home precisely so this exposure stays confined
  to the committed UI mirrors.

The window is ONE-WAY. An incapable binary records no housing progress anywhere, so
rolling forward resumes from the durable revision the capable build last committed and
recovers nothing a player did in between. That is the whole reason the flag comes off
first: a flag-off window is quiet, and a binary-first window is lossy.

A rollback manifest naming every surviving writer and reader and the owner of each
pending recovery is required by
[../prd/woc/freehold-service-contract.md](../prd/woc/freehold-service-contract.md)
"Account lifecycle, export and capable rollout". It is produced at activation, by the
named operations owner, and it is not a step in this file.

### Data rollback

There is no housing backfill and no migration marker, so there is nothing to undo.
Rollback is a binary and flag operation, and the only data step is a verification.

Precondition: EVERY realm process on this database is STOPPED. These are reads; run
them while the fleet is down so the answers cannot move underneath the operator.

```sql
-- 1. Housing rows present, and the newest durable plot write on this database.
--    Compare newest_plot_write to the moment the incapable binary took over: every
--    housing action after that moment is unrecorded and is NOT recovered by rolling
--    forward.
SELECT count(*) AS plots, max(updated_at) AS newest_plot_write
  FROM account_freeholds;

-- 2. The account Hearth authority rows, which an incapable binary neither reads nor
--    advances. A nonzero count on a fleet about to run an incapable build is the
--    signal to keep the feature flag off rather than to proceed.
SELECT count(*) AS hearth_rows, max(updated_at) AS newest_hearth_write
  FROM account_freehold_hearth;

-- 3. Open housing operation intents. MUST be 0 before rolling back to the
--    pre-housing release. A nonzero count while no production kind is registered
--    is a D9/D81 boundary incident: investigate it, close each intent through
--    cancelFreeholdOperation on the capable build, and never DELETE one.
SELECT count(*) AS open_intents FROM freehold_operations;

-- 4. Terminal receipts. Expected 0 while no production kind is registered: only a
--    closed operation writes one, so a nonzero count means an operation was
--    prepared outside the tests, the same boundary question as query 3. Receipts
--    are keep-forever replay authority and are never deleted.
SELECT count(*) AS receipts FROM freehold_operation_receipts;

-- 5. Plot claims, and the ones still LIVE. With the fleet stopped after its
--    shutdown release (or LEASE_TTL_SECONDS after a crash), live_claims must be 0:
--    only a running process renews a claim, so a live one means a process on this
--    database is still up. The rows themselves stay (keep-forever).
SELECT count(*) AS claims,
       count(*) FILTER (WHERE expires_at > clock_timestamp()) AS live_claims
  FROM freehold_plot_claims;
```

There is deliberately NO `DELETE` step here, and none may be added. Removing these rows
is not a rollback, it is destruction of player property and of replay authority: the
plot, Hearth, claim and receipt tables are keep-forever, the account cascade is the
only sanctioned removal path for the first three, a receipt is never removed, and an
open intent leaves only through its own apply or `cancelFreeholdOperation`. If an
operator concludes rows must go, that is a restore-from-backup decision with a named
owner, not a runbook step. The table and column names above are owned by
`FREEHOLD_SCHEMA` (the plots), `FREEHOLD_HEARTH_SCHEMA` (the Hearth rows and their
`advance_token`), `FREEHOLD_CLAIM_SCHEMA` (the claims) and `FREEHOLD_OPERATION_SCHEMA`
(the intents, the receipts, and the guard and erase functions and triggers); a rename
there updates this block in the same change.

## 8a. Named gates this contract carries, CLOSED and UNCLOSED

Every item here is a MEASURED finding from the review rounds this artifact went
through. Each names what was measured and who measured it, and the full detail is
in [the findings ledger](qa/persistence-2026-09-08/findings.md). An item marked
CLOSED is closed in code with a test; the rest are gates on housing activation
rather than notes. Nothing here is a signature and nothing here grants activation.

CAPACITY REFUSALS WERE TERMINAL. CLOSED at the rulings round, and the fresh read
of that round found the close had opened something else, which is closed with it
and recorded below under the identity gate. A load refused
because the local admission cap was full, because no background permit arrived
inside the login bound, or because the read threw, no longer sets `entry.loaded`,
so `preload`'s replay arms and `retain`'s lost-entry repair both re-read it
instead of replaying the refusal. Measured before the fix, with the shared gate
saturated: 8 of 8 logins at 1 join/s refused, and a lone re-join for a refused
account still replayed the hold. The four DATA kinds (`unadmitted`,
`unsupported`, `malformed`, `oversize`) stay TERMINAL, because the same row
answers the same way every time and a repeat read spends a permit and a statement
on a login path for nothing. The entry stays WRITE-BLOCKED while it is
unrepaired: `blocked()` is `!loaded || isHeld`, so both halves refuse until a
later read actually succeeds. One consequence for an operator, recorded in
DEPLOY.md as well: `loaded` and `held` no longer sum to `entries` for a capacity
hold.

A NEW LOGIN READ AHEAD OF THE PRELOAD, from the release/v0.44.0 sync. The
release's account ledger adds two direct pool queries per fresh login
(`loadAccountLedger` in `server/account_ledger_db.ts`, called from
`server/ws_auth.ts` before the housing preload). They bypass the background gate,
carry no row limit and run on the pool's default statement timeout. They do not
spend the housing budget and nothing new sits between the preload and
`bindFreeholdOnJoin`, so the window the identity gate rests on is unchanged. What
does change: under the saturated pool this section measured, those two reads queue
for the same clients, so a `no_budget` hold at login is more likely than the figures
below were measured with. Not re-measured at the sync; no code change follows.

THE TWO ADMISSION CAPS SUM PAST THE SHARED GATE. ACCEPTED, with the arithmetic,
rather than shared. The load cap of four and the write cap of four are
independent counters against a gate whose capacity is seven on the shipped pool
(`backgroundDbCapacity(DB_POOL_MAX_CLIENTS_DEFAULT)`), so housing's own demand is
8 in steady state and 12 during a drain (the drain raises the write cap to
eight), against 7. The store was measured holding all seven while other named
producers queued.

The alternative was one shared budget, and it was REJECTED: it couples a player's
login read to a sweep's writes, which is the coupling the two constants were
split to avoid, and it would make a saturated write cap refuse logins. So this
contract states the overcommit instead: HOUSING MAY HOLD UP TO SEVEN OF SEVEN
PERMITS IN STEADY STATE AND ALL OF THEM DURING A DRAIN, and the other named
producers wait behind it. What actually bounds concurrency is the GATE, not the
caps: the caps decide how much work housing offers, the gate decides how much
runs, and the surplus waits in a bounded set the store owns rather than on an
uncapped queue. ALERT ON `permit_wait_ms` for the producers behind it; that is
the leading indicator, and DEPLOY.md names it. The peak-concurrency pin the
database reviewer asked for is written against THIS answer, driven through the
real `createBackgroundDbGate`: housing never holds more permits than the gate
grants, and its own two caps do sum past that capacity.

RETENTION: THE `entries` MAP HAS NO SIZE BOUND, and its DERIVED CEILING is
recorded here rather than closed with a cache. There is no eviction policy,
because an eviction policy here is a decision about whose unwritten edits may be
dropped, and nothing has asked for one.

The stated limit is a TIME bound, join rate times grace period, and that
describes the healthy path only: `owesWork` is what suspends collection, so a
dirty entry whose write never gets a permit is kept by both removal paths.
Measured at 96 MiB per five thousand owners at the shipped tier ceiling and
660 MiB at the approved one, with the leave capture on top. The same shape
produces an entry that re-arms every sweep with nothing to write (twelve sweeps,
twelve permits, `writes_without_record` climbing); no production sequence
reaching that state has been named.

No refusal is needed to suspend it, either. One ordinary `saveAllDirty` pass at
five thousand loaded, unblocked owners leaves `dirty=5000 deferred=4996
active=4`, and every deferred entry satisfies `owesWork` through its deferred
clause. At the measured throughput, about 345 writes per second at the steady
cap, that backlog clears in roughly 14.5 seconds, inside the thirty-second
interval, so health recovers on its own.

THE CEILING, which is the number to derive again before a realm is sized past it:
about TEN THOUSAND THREE HUNDRED concurrently dirty owners per sweep. It is the
write cap divided by the statement latency, times the autosave period. Re-derived at
07a in section 7: unchanged in form and in value, because the fenced write is still
ONE statement per dirty plot, and standing as a derivation until the fenced
statement's own latency is measured at 5,000 owners. Below it
the map is self-limiting; above it the deferred set never empties, `entries`
stops being collectable at all, and `oldest_dirty_age_ms` grows without bound. If
a hard cap is wanted anyway, the seam the file already names is the keyed bounded
cache with LRU eviction in `server/discord_status_cache.ts`, and the decision it
forces is which owner's unwritten edits an eviction is allowed to drop.

THE LEAVE RESERVE WAS TWO SLOTS IN TOTAL. CLOSED at the persistence QA. The
reserve is still two, but the mechanism that made it worthless is fixed:
`pumpLoop` admitted a deferred entry at the NON-leaving cap in insertion order,
so a leaver that missed the arm-time window queued behind every background write
already deferred, which is what produced the measured 98 of 100 flushes hitting
the full deadline. The pump now prefers a deferred entry holding a leave capture
and admits it at the leaving cap. A SECOND way to defeat it was found at the
rulings round and closed with it: `retain` cleared a returning owner's capture
inline instead of through `releaseCapture`, leaving the entry in the leaver
subset with no capture, at the head of the set the pump reads, priced at the
non-leaving cap. Every leave still adds its bound to `GameServer.leave`, and that
bound is now inherited by the character takeover path and every moderation kick
as well, because both await it.

THE LOGIN READ HAD NO BOUND ON THE WHOLE OF IT. CLOSED at the rulings round, and
BOTH of the numbers this paragraph used to carry were wrong.

The premise first. An earlier version said the handshake has a deadline of its
own and that the preload spends from it. It does not: `AUTH_TIMEOUT_MS`
(`server/ws_auth.ts`, 10,000 ms) is cleared SYNCHRONOUSLY by the first-frame
handler before `authenticateWebSocket` runs, and that file's own docblock says so
in as many words: it bounds upgrade-to-first-frame only, never the handshake's
database work. The database reviewer's original finding said the same and this
document overwrote it.

Then the arithmetic, of 07's login shape. `runWithStatementTimeout` issues five
statements on one checked-out client: BEGIN, SET LOCAL, the two reads, COMMIT. `SET LOCAL
statement_timeout` bounds each statement separately at READ COMMITTED (measured:
two 300 ms sleeps under a 400 ms bound both completed, 612 ms elapsed), and BEGIN
and SET LOCAL both run BEFORE the lowered bound is in force, so both answer to
the pool session default. AND COMMIT ANSWERS TO NEITHER SERVER-SIDE BOUND, which
every published figure got wrong in the same direction. Measured on PostgreSQL 16
with a DEFERRABLE INITIALLY DEFERRED constraint trigger putting two seconds of
work inside the commit itself: under `SET LOCAL statement_timeout = 300` the
COMMIT ran 2,008 ms and COMMITTED, against a control at the session default that
took the same 2,008 ms. MEASURED BOTH WAYS, because a reviewer pointed out that
the claim was otherwise wider than its evidence: both probes had LOWERED the
bound, so neither tested a session-level `statement_timeout` binding the commit
work. A third probe set the SESSION value to 300 ms with no SET LOCAL at all, and
that COMMIT ran 2,007 ms and committed too. In that shape its only ceiling is the
driver's own `query_timeout` (`DB_QUERY_TIMEOUT_MS`), measured to reject a COMMIT at its
deadline with a client-side read timeout carrying no SQLSTATE. So the floor of 07's
shape was 5,000 (`DB_POOL_CONNECT_TIMEOUT_MS`) + 2 x 15,000 (`DB_STATEMENT_TIMEOUT_MS`,
for BEGIN and SET LOCAL) + 2 x 2,000 (the two reads) + 65,000 (`DB_QUERY_TIMEOUT_MS`,
for COMMIT) = 104,000 ms. The 41,000 this section published priced COMMIT at the
lowered bound; the prose beside it argued 54,000; the 19,000 and the 9,000 before
those omitted five statements between them. 07a REPLACED that shape with
`readClaimedLoginDurables`, one bounded transaction under a WALL that also cuts COMMIT
at the client, and section 7 re-derives the floor on it: 95,000 ms by the same
statement sum, 30,000 ms once the wall binds (a derivation from the bounds in code, not
a measurement). The COMMIT measurements above still stand, and they are why the wall,
never `statement_timeout`, is the bound that reaches the new COMMIT first.

THE FIX IS A CAP ON THE WHOLE PRELOAD, `FREEHOLD_PERSIST_LOGIN_BUDGET_MS`, and
not a lower statement bound, which was considered and rejected because it does
not bound BEGIN, SET LOCAL or COMMIT and so narrows the number without closing
the gate. It is a STATED CEILING rather than a derived share of a deadline that
does not exist: 10,000 ms is the wait the product already treats as the most a
connecting player should spend, and a housing read has no claim on more. What it
prevents is the chain outliving the socket: past the cap the load is refused, so
the handshake stops waiting rather than running on to take a character lease and
join behind a socket that has died, which leaves a linkdead ghost holding a realm
slot and that lease for the whole grace window while the player's every re-login
is refused as already in world.

ONE BUDGET PER HANDSHAKE, NOT PER ASK (2026-09-26). Ruling (b) for the twelfth
path asks twice, once before the character lease and again after the character
read, and as first built each ask armed this whole budget and its own permit
wait: up to 20,000 ms of housing per login, the second half inside the
lease-held window with the admission slot still counted, past the client's
10,000 ms entry watchdog. The hot-path and database reviews of that ruling found
it, and the handshake now hands the re-ask only what the first ask left
(`freeholdReaskBudgetMs`, server/freehold_login_bounds.ts), so a login's housing
wait is back under the one 10,000 ms ceiling, timed on the monotonic clock
(`performance.now`), so a wall-clock step cannot refund it; the one exception is
a deadline the host cannot schedule, where that ask runs uncapped and says so,
as a single ask always has. The second ask can still wait INSIDE the lease-held
window (when the entry was collected between the asks, or the first ask was held
on capacity), bounded by that remainder; a re-ask that runs out answers
`no_budget`, and the join installs what the store's entry decides at install
time (the entry when one is loaded, else nothing: a write-blocked session, never
a loss). `reask_reads` and `reask_ms` on `woc_freehold_persist_total` are what
an operator reads that cost by; a re-ask read is booked when it settles, so one
refused on its budget books its read when the abandoned read lands, which the
permit wait, the statement bound and the driver's query timeout guarantee.

THE LOGIN ITSELF IS NOT REFUSED, and that is deliberate: refusing a login over a
durable housing read reverses a decision this packet has already taken and
pinned. The player joins on the sim's default record and no write goes out for
that account, which is the same failure mode a thrown read already had. The
refusal books its own metric kind, `no_budget`, and deliberately does NOT touch
the store entry: the read it gave up waiting for is still in flight behind a
single-flight slot, and letting it finish and fill the entry is strictly better
than marking the entry held over a read that then succeeds.

A CLOCK FAULT MUST NOT BECOME A PLOT HOLD, and it took three attempts. A thrown
hearth read is carried across the port as a VALUE rather than a rejection. The
guard is around the WHOLE transaction, because an inner catch on the hearth
promise cannot see the COMMIT the timeout helper issues afterwards, and a clock
fault that KILLS the connection (backend crash, restart, dropped socket) makes
that COMMIT reject. AND BOTH HALVES ARE CAPTURED AS THEY ARE READ, which the
second attempt got wrong: capturing only the row threw away a clock both
statements had already answered whenever the COMMIT rejected, and substituted the
cold clock, which reads as READY. The store then remembers that zero on the entry
and replays it to every later character of the account for the whole session
without reading again. An UNREADABLE clock starts cold; a clock that was READ does
not. That 07 policy lived in `server/freehold_hearth_load.ts` as `readLoginDurables`,
out of the composition root, because the root binds the real pool at module scope:
nothing imported it, nothing executed its closures, and the one surviving mutant of
that round lived there. 07a RETIRED `readLoginDurables` for `readClaimedLoginDurables`
([../../server/freehold_claim_login.ts](../../server/freehold_claim_login.ts)), still
out of the composition root for the same reason, and it keeps the asymmetry with the
order REVERSED: the clock is read FIRST, so a clock fault aborts the transaction before
the claim can be taken and silently rolled back, and the plot half then runs in a
second transaction on a fresh checkout with the clock answered as thrown, which reads
cold. One property of the 07 policy does not survive the reversal, stated rather than
hidden: a clock that WAS read is discarded with the row when a later statement or the
COMMIT fails, because the row is then held as thrown and the hold carries
`COLD_HEARTH`. That is harmless now for the reason the cold-clock gate below records as
closed: a cold mirror can deny, never admit. Its behaviour cases live in
[../../tests/server/freehold_mutation.test.ts](../../tests/server/freehold_mutation.test.ts),
and the fault arm is proved against real PostgreSQL in
[../../tests/server/freehold_claim.pg.test.ts](../../tests/server/freehold_claim.pg.test.ts).

THE EXPORT READ WAS UNBOUNDED. CLOSED at the persistence QA: `freeholdsForExport`
carries `FREEHOLD_EXPORT_ROW_LIMIT` (20, WIDENED rather than copied from the
account read's 2, so a slot this build does not admit is still exported) and the
same on-disk pre-gate the account read uses, with an authoritative rendered
measure behind it. A row past the gate keeps its identity, both revisions and
every scalar column and reports its measured on-disk size in place of content.
Proved against real PostgreSQL on an account holding one ordinary row and one row
past the gate, and at the truncation boundary in both directions.

TWO RESIDUALS ON THAT READ, named at the rulings round rather than left implied.
FIRST, the rendered ceiling is only reachable for content that COMPRESSES: for
incompressible content the on-disk pre-gate binds first at 131,072 bytes and the
wider bound is never reached, so an incompressible row above the pre-gate comes
back with its size instead of its content on the owner's ONLY readback of it.
That is the trade the pre-gate exists to make, because measuring an incompressible
row means detoasting it, which is the cost being avoided. SECOND, the two upkeep
JSONB columns are selected RAW, past both bounds. That is safe only because of
the DDL: this build writes NULL and the unbound-carries-no-upkeep CHECK holds them
NULL for every row it can produce. The release that starts writing them owes them
the same pre-gate and measure the two content columns carry.

THE FOUR LOAD-FAILURE CAUSES WERE ONE LABEL. CLOSED at the persistence QA, and
there are TEN kinds now, not seven: the rulings round added `no_budget` for the
whole-preload cap and `unnamed_record` for the ordering refusal below, and 07a added
`claim_busy` for a plot another realm holds the live claim on. Read them as three
groups. FOUR are DATA incidents and their hold is terminal (`unadmitted` for the
row-level stranded slot, `unsupported`, `malformed`, `oversize`); FIVE are CAPACITY
causes and their hold is repairable (`cap_full`, `no_permit`, `read_threw`,
`no_budget`, `claim_busy`); ONE is neither (`unnamed_record`), terminal for a reason
of its own. `FREEHOLD_LOAD_FAILURE_KINDS` in
[../../server/freehold_load_outcome.ts](../../server/freehold_load_outcome.ts) is the
list. The repairable set is DERIVED by subtraction from the kind
list, so a kind added later lands in exactly one group by construction (07a's
`claim_busy` did); an earlier
version claimed that derivation while spelling three literals, and the very commit
that wrote it added a kind the set did not know about. A host with no store answers
the same hold SHAPE through `freeholdPreloadUnavailable` but books no counter at
all, so it never reaches the series. DEPLOY.md carries the corrected reading.

THE WRITE PATH'S CODEC COST IS PAID TWICE, and is now MEASURED. A `codec_ms`
counter sits beside `write_ms` and brackets everything between the permit and the
statement. Re-measured per save at the 420-row ceiling: the clone 0.0084 ms, the
projection 0.0049 ms, the refusal walk plus canonical JSON plus the encode
0.1464 ms, the two column serializations plus the byte length 0.0382 ms, 0.1979 ms
for the block. The earlier 0.225 ms figure stands on magnitude. WHAT REMAINS is
the double serialization itself, and the shape the counter now exposes: this is
UNYIELDING synchronous time between the permit and the statement, about 0.99 s at
five thousand drained owners, which escapes the tick profiler's save lap as well.

THE STORE HOLDS A SECOND COPY OF EVERY ONLINE OWNER'S HOUSE. `entry.state` is a
full record distinct from the sim's live one, and a dirty leaver briefly holds a
third. Measured at 10,051 bytes per copy at the shipped ceiling and 69,452 at the
approved one. Only the leave capture is documented in the source today, and the
second copy is the larger standing cost.

THE MISSING IDENTITY STAMP. CLOSED at the rulings round, in the SAFE form, as one
change, and it closes both halves of it.

It was a WRITE-THROUGH first, and the eighth distinct path to an empty tier-0 Inn
Room landing on a real row. For an account whose entry MINTED its own row,
`applyWriteResult` cached the identity the LIVE RECORD carried, which was the
stand-in, and a freshly seeded default carried the same literal, so the seal's
name comparison was inert BY VALUE EQUALITY for that entry class. The two
continuity arms then had to carry it alone and both are revision-shaped, so a
reseeded default whose revision had caught up satisfied neither. Reproduced three
times against the real store: a row holding tier cottage, one furnishing, one
trophy, condition 91 and policy friends at wire revision 7 was
compare-and-swapped to an empty Inn Room at wire revision 8 and again at 9, with
`quiesced` 0, `write_failures` 0, no error line and `plot_id` untouched.

It was a REFUSAL second, and the mirror of the same gap: a fresh account whose
store entry was dropped and re-read from the row it had just inserted held the
row's name against a live record still holding the stand-in, so the seal saw two
names and write-blocked the account for the rest of its session with a misleading
line.

THE FIX, in the form that was taken: `installLoadedFreehold` installs a default
record carrying the load's own minted `plotId` on the ABSENT arm only, through the
existing `loadFreehold`, which is load-once and already honors the dark-realm
flag, so `addPlayer`'s `ensureFreeholdRecord` then returns it untouched. The
UNSAFE form stamps the minted identity onto whatever record is already live,
bypassing load-once; that rewrites a freshly seeded default's identity to the
minted name, kills the name comparison and, through `standInSeed`, both
continuity arms with it, and is a new path to the same loss. It was refuted with
evidence rather than argued away.

A THIRD REFUSAL LANDED WITH IT, and it exists because the two changes above
RE-OPENED this gate from the other side. `installLoadedFreehold` is the only thing
that teaches a live record its minted name, and it returns early on ANY hold.
Ruling 2 made an admission hold re-readable and the budget cap left its entry
untouched for its in-flight read to fill, so for the first time an entry could be
held at login and WRITABLE afterwards with no install ever having run: the record
kept the stand-in, the store minted a name for the row, the entry cached the
record's stand-in at the first commit, and the seal's name comparison was inert by
value equality for the life of that entry, which is the eighth path arrived at
from the other side. Found by the fresh read of the fix round, not by its own
green tests. So `classify`'s absent arm now REFUSES to name a row for a record it
did not install: a live record carrying the stand-in gets an `unnamed_record`
hold, terminal for that entry, and no row is created at all. Nothing is lost by
it, because there was no row, and the next login builds a fresh entry whose
install runs before the seed.

TWO OTHER THINGS LANDED WITH IT. `revisionRegressed` is un-gated from `standInSeed`,
because after the fix no ONLINE record carries the stand-in and the discriminator
would otherwise be dead for the same-account character swap; it has its own
executed proof, including the arm that matters most, that a rejoin replay AT the
committed revision is not refused. And the MINT was found to be per ENTRY rather
than per owner: an entry the orphan sweep collects between a preload and its
retain is recreated empty, and minting again there gave the ROW a second identity
while the record kept the first. The absent arm now adopts the live record's
identity when there is one.

FOUR EXISTING PINS FLIPPED, not the two that were anticipated. Two of them
encoded a rule that a record carrying a REAL plot name goes backwards onto the
row deliberately. That rule is RETIRED rather than dropped: a live revision
below the entry's last committed one means the live record is not the record
that commit came from, since every install a rejoin is offered carries at least
the committed revision (the twelfth path, an answer read before another session
of the account edited and was evicted, was the one known hole in that premise,
and ruling (b) closed it on 2026-09-26: the join installs the store's answer at
install time, the loaded entry's with any capture, or a durable re-read when the
entry was collected, and installs no record at all when nothing can vouch for
the answer, so the stand-in meets the name comparison; see the findings ledger,
RULING (B) FOR THE TWELFTH PATH) and every sanctioned mutator only increments,
and writing it would walk the client-facing wire counter backwards permanently,
which is the exact harm the loader's own `wire_rev_shape` hold refuses on the
read side. What it newly refuses is a superseded leave capture offered to a
rejoin as the install source: refusing loses nothing, the row survives, and it
books a write failure and quiesces an entry that is about to be collected
anyway. What ruling (b) leaves write-blocked, never lost (an entry is collected only
when it owes no work, so no capture outlives it): a durable re-ask refused on
capacity after the entry was collected, refused at the seal, loudly, over a row,
or held as `unnamed_record` for an account with no row yet (the repair re-read
meets the stand-in on the absent arm), except a `cap_full` refusal, which stays
held with no seal line and shows only as its kind; and the WITHHELD race, an
entry collected between the re-ask and the install with no live record
standing, which warns `join answer withheld` and is then refused the same loud
way (beside a live record the join shares it and warns nothing).

OFFLINE AND HEADLESS PLOT IDENTITY: THE DIVERGENCE IS ACCEPTED AND DOCUMENTED.
Online records now answer to a unique minted identity from their first session.
Offline and headless hosts have no store and no minter, so every record on them
carries the one literal stand-in, `plot:unassigned`, forever. The fix therefore
WIDENS an existing divergence from session two onward to session one onward. It
is harmless while `plotId` is presentation-only, which is what
`src/sim/freehold/types.ts` says it is, and it is not harmless to a consumer that
KEYS on it: correct online, colliding offline. THE PHASE THAT MAKES `plotId`
LOAD-BEARING AS A KEY MUST SUPPLY A MINTER FOR THOSE HOSTS FIRST, and anything
minting ids inside `src/sim/` must draw from `Rng`, never a clock and never
`Math.random`. Recorded in `src/sim/freehold/CLAUDE.md` beside the record
lifecycle so the next author of that directory reads it there.

ONE ACCOUNT ONLINE ON TWO REALMS HAD ONE OF THEM WRITE-BLOCKED, SILENTLY. CLOSED at
07a, by the global plot claim. What was measured before it:
`account_freeholds` is keyed `(account_id, plot_index)` with no realm column, and
the store is per realm PROCESS, while characters are realm-scoped and the session
cap is counted in one process's own client map. Both handshakes read `durable_rev`
7 and install the same house; the realm the player furnishes on wins the
compare-and-swap; the other realm's next write fences on 7, is diagnosed stale and
quiesces for the life of the entry, with only a warn line and the `quiesced`
gauge. The ROW survives in either ordering, which is the fence doing its job, but
one session's edits are discarded with no player-facing surface. Housing rows are
account-scoped and shared by every realm on one database, so the cross-realm claim
this paragraph asked for landed in 07a's mutation boundary. THE CLOSURE: a login now
CLAIMS the plot before it reads the row (`readClaimedLoginDurables`; one
`freehold_plot_claims` row per plot id, its `(holder, generation)` fence compared in
the very statement that locks the row). A second realm meets the first realm's live
claim at its lock-free pre-check and answers the repairable `claim_busy` hold BEFORE it
reads or installs the row, so it never serves the first realm's house as its own: the
login proceeds on the default record under that named hold (section 4's hold
behavior: nothing it does saves, nothing durable is overwritten), the house stays on
the first realm, and the refusal is COUNTED, as `claim_busy` on
`woc_freehold_load_failures_total` and on `woc_freehold_authority_total`, never a
silent write block discovered after the edits. A realm whose claim is taken over after
it expired is fenced at its next write (`fenced_writes`) and quiesces that plot.
Proved in
[../../tests/server/freehold_claim.pg.test.ts](../../tests/server/freehold_claim.pg.test.ts)
(a live claim refused and an expired one taken over with its generation advanced,
`claim_busy` with no row read, exactly one winner of a racing first acquire, and a
write parked behind a takeover fenced) and
[../../tests/server/freehold_mutation.test.ts](../../tests/server/freehold_mutation.test.ts)
(the login reader's arms). Two parts stay NAMED rather than closed: the busy realm's
player still sees no surface for the hold (the held-plot gap at the end of this
section), and the manifest's residual R-3 below.

THE ACCOUNT CASCADE HAS NO PRODUCTION CALLER. Both DDL fragments state that the
accounts `ON DELETE CASCADE` is the only removal path there is, and that is true
of the SCHEMA. It is not true of the product: the player-facing account removal is
a SOFT delete that sets `deactivated_at` and leaves the row in place, so it fires
no cascade, and the only hard `DELETE FROM accounts` in the tree removes a
password-less, token-less provisioning loser that can never own a plot. Housing
rows therefore persist for accounts a player believes are deleted. That is a
retention and disclosure decision, not a data-loss one, and it is owed an explicit
answer: follow `account_attribution`'s erase-on-soft-delete precedent, or state
that housing is keep-forever through a soft delete. 07a CARRIES THE QUESTION TO ITS
OWN ROWS and answers it for one of them. RECEIPTS follow the attribution precedent:
`handleAccountDeactivate` erases them with `eraseFreeholdOperationReceiptsForAccount`,
so a soft-deleted account's tombstones keep only replay authority (section 6); what is
still open for receipts is whether the anonymized tombstone may outlive the accepted
retention schedule, which is that schedule's question, not this gate's. CLAIMS stay,
with the plot and Hearth rows, under this gate unanswered: a soft-deleted account's
claim row survives with its account id, realm and timestamps, and simply expires,
because nothing renews it. The only hard account delete is now also guarded: an open
intent refuses it with `FederatedProvisionFreeholdOperationOpen`.

A FORWARD STEP OF THE DATABASE CLOCK PERMANENTLY BRICKS AN ACCOUNT'S HEARTH KEY.
The stated monotonicity invariant covers a REGRESSED clock only. In the normal
flow `GREATEST` is never the binding term, so an accepted advance under an NTP
step or a container clock jump writes a far-future `ready_at_ms`, and monotonicity
then makes it permanent: no statement can lower it, absence is the only ready
state, the table is exempt from the retention sweep, and the account cascade above
has no production caller. It was owed at 07a, where the caller lands: treat a reading
past `now_ms` plus the cooldown as corrupt rather than authoritative, which fails
closed for the trip and gives an operator a signal instead of a silent lifetime
lockout. CLOSED at 07a in exactly that form, with one refinement. The locked read
(`FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL`) returns `clock_timestamp()` beside `now()`, and
`advanceFreeholdHearthOnClient` answers `corrupt`, writing nothing, when the stored
`ready_at_ms` is more than one cooldown past THAT clock; the trip refuses it, warns once
and counts `trip_corrupt`. THE REFINEMENT: it is judged against `clock_timestamp()` at
the read, never `now()`, because `now()` is this transaction's START, and an ordinary
advance that began later and committed while this one waited for the row lock
legitimately wrote up to its own later start plus the cooldown, which `now()` would
misread as corrupt. Proved in
[../../tests/server/freehold_hearth_db.pg.test.ts](../../tests/server/freehold_hearth_db.pg.test.ts)
(a stored time past the clock plus a cooldown refused as corrupt with nothing written,
one exactly AT the clock plus the cooldown answered as a cooldown, and the judgment made
on the clock after the lock wait) and
[../../tests/server/freehold_mutation.pg.test.ts](../../tests/server/freehold_mutation.pg.test.ts)
(the hook refusing it and writing nothing). What it closes is the SILENCE, not the
lockout: no statement can lower a corrupt row, so the key stays refused until the real
clock catches up with it or an operator repairs the row, and the operator now has a
named refusal for it. Related, and unchanged: `now()` is the TRANSACTION timestamp,
so a long entry transaction records a cooldown that starts at BEGIN and is short by
the transaction's duration.

A REFUSED LOGIN HANDS BACK A COLD HEARTH CLOCK, which is READY, and the merge is
forward-only so nothing later lowers it. `freeholdBudgetRefusal` answers
`hearthReadyAtMs` 0 and every other refusal passes `COLD_HEARTH`, whose ready
time is also 0, so on a database slow enough to overrun the login budget the same
account is handed a ready Hearth on EVERY login. `server/freehold_install.ts`
argues the opposite in its own comment, that merging the clock unconditionally is
what stops a held account getting a free travel per login, and that protection is
defeated by the value every hold path actually supplies. The in-flight read does
learn the real clock, but only onto the store entry, after the session has been
answered. Harmless in the 07 build because nothing wrote the row and the key was
refused anyway; it would have become one free travel per slow login the moment 07a
started writing. This is a sharper statement of the gate below rather than a second
one. CLOSED at 07a by moving the AUTHORITY, not by warming the clock. The login's clock
now feeds only the sim's LOCAL mirror (`mergeFreeholdKeyReadyAt`, forward-only), and
`useHearthKey` checks that mirror BEFORE it asks admission, so a mirror can DENY (a
known later ready time refuses locally, with no host call) and can never ADMIT: a cold
mirror only lets the use reach the trip, and the trip's own transaction reads the
durable row FOR UPDATE (the hook's Hearth participant, `advanceFreeholdHearthOnClient`)
and answers `cooldown` without writing, after which the durable ready time is merged
forward and a `deny` ticket answers the use. Only a proved advance mints an `admit`
ticket. So a cold mirror costs at most one trip transaction and never a free travel.
Proved in
[../../tests/server/freehold_mutation.test.ts](../../tests/server/freehold_mutation.test.ts)
(a cooldown merges first and the ticket denies) and
[../../tests/server/freehold_mutation.pg.test.ts](../../tests/server/freehold_mutation.pg.test.ts)
(two racing saves: exactly one advances, the other answers cooldown and writes
nothing).

THE HEARTH READ FAILS OPEN WHILE THE PLOT READ OF THE SAME LOAD FAILS CLOSED.
`readHearth` catches every error and answers a cold clock, and the merge is
forward-only, so an owner key the sim does not yet hold starts READY. The trigger
is concrete: the load's pool checkout times out, or a statement hits its bound,
under the same saturation the permit bound exists for. Harmless in the 07 build
because nothing wrote the row; it would have become one free travel per pool blip the
moment 07a started writing rows. AN `unsupported` CLOCK IS PART OF THIS GATE, corrected
at the rulings round: the reader's docblock claimed that kind is what stops a damaged
row granting a trip, and it is not. It is normalized to the cold clock with a WARN,
which is ready. The kind buys the operator a named warning; refusing the trip
belongs to the 07a participant, which is the caller that has a trip to refuse.
CLOSED at 07a, with the asymmetry KEPT on purpose. The login read may stay fail-open
because it only feeds the forward-only local mirror, which can deny, never admit; the
in-transaction Hearth read of the trip decides every trip (the cold-clock gate above).
The `unsupported` half closes where this paragraph said it belonged: the trip's
participant answers `unsupported` for an absent account, a vanished row or unreadable
counters, and the trip refuses, writes nothing, warns once and counts
`trip_unsupported` (`createFreeholdHearthTrips`; the advance's `unsupported` arms are
pinned in
[../../tests/server/freehold_hearth_db.test.ts](../../tests/server/freehold_hearth_db.test.ts)).
The fault arm that keeps the claim while the clock fails open is proved in
[../../tests/server/freehold_claim.pg.test.ts](../../tests/server/freehold_claim.pg.test.ts).

THE HEARTH KEY WAS GRANTED ONLINE AND PERMANENTLY REFUSED. On a lit 07 realm the
Freehold Gate granted the key and every use was refused by the realm's hard-false
key admission, emitting the `busy` denial: "This home is active elsewhere or still
opening. Try again shortly.", indefinitely. Offline and headless the same item
works. Intentional per the 07a plan and named in the source, so it was
rollout-gating: either do not grant the key while admission is hard-false, or give
the refusal its own reason token and catalog line. CLOSED at 07a by the lit trip, the
first of those being moot now that admission is no longer hard-false. The realm's key
admission is the trip's (`admission` on `createGameFreeholdHearthTrips`, the REQUIRED
third argument of `buildRealmSimConfig`, whose closure answers `deny`, never the sim's
offline `admit`, when the trip machinery is absent): a use answers `pending` silently,
the trip commits the durable advance on the character FIFO, and the server
re-dispatches the use with a one-shot `admit` ticket. The `busy` denial now means what
its line says, a transient refusal (a metered or pre-queue refusal, a held or
unclaimed plot, a cooldown race, a refused, failed or unresolved commit). The cost that
remains is the manifest's residual R-2 below. Proved in
[../../tests/server/freehold_mutation.test.ts](../../tests/server/freehold_mutation.test.ts)
(the admission contract, the one ticket setter, and the realm wired to the trip,
never the offline default) and
[../../tests/server/freehold_mutation.pg.test.ts](../../tests/server/freehold_mutation.pg.test.ts)
(the character blob and the Hearth advance committing together).

THE TOUCH-SET MANIFEST'S NAMED RESIDUALS, carried here by name
([mutation-touch-set-manifest.md](mutation-touch-set-manifest.md) section 12). None is
closed; each is accepted with its bound, and none is a signature.
- R-1: the first insert of an absent plot racing on two realms is arbitrated by the
  primary key; the loser quiesces with nothing durable lost (07 behavior, unchanged).
- R-2: a committed Hearth advance whose re-dispatch the sim then refuses (death or
  combat inside the commit window, one save round trip) spends the cooldown without a
  trip. Counted as `trip_refused_after_commit` and logged with no account id, owner key,
  plot id, token or holder. A precheck drop in that window (draining, the vault lock,
  spectating, jailed, dark) is the same class, counted `trip_dropped_after_commit`; each
  answers as the frame path's precheck would.
- R-3: a realm that lost its claim keeps showing its live view until relog; every write
  is fenced, so durable truth is never overwritten.
- R-4: a handshake refused after its first ask (the claim is taken BEFORE the character
  lease) holds its own account's claim until the renewer's first pass after
  `FREEHOLD_PERSIST_LOGIN_BUDGET_MS`, so it can block only that account's own plot on
  another realm, for at most that budget plus one autosave interval.

`server/freehold_persist.ts` IS ON THE MONOLITH RATCHET at its exact measured
count, which forbids the next line without granting any slack. Cite the ratchet
row in `tests/monolith_budget.test.ts`, not a number here, which is the anchor
rule this document is otherwise written to; the row's own comment carries the
whole walk, including every lowering and the one raise this packet recorded
against itself. WHETHER THE FILE SHOULD BE SPLIT, and along which seam, is a
maintainer decision this contract does not take, though four modules have now
come off it (`server/freehold_persist_wiring.ts`,
`server/freehold_write_seal.ts`, `server/freehold_install.ts` and
`server/freehold_persist_registry.ts`) and each was a seam the file already had.
The ratchet also has no admission rule of its own: nothing adds a file to it, so
the next monolith to form is untracked until someone notices.

A HELD ROW STILL HAS NO PLAYER-FACING SURFACE, which section 4 also records. Every
capacity item above makes a hold more reachable, so that gap and they are one
obligation. It is SCOPED at the rulings round and built separately, because the
identity fix touches the sim's load path and the surface touches the HUD, and
merging them makes one reviewable change into two unreviewable halves. THE DESIGN
IS RECORDED IN `docs/freeholds/held-plot-surface-scope.md`: the exact `t()` keys,
the render sink each one goes to, and which load-failure kinds the
player is told apart. It is a scope document, not an implementation: no key in it
exists in the catalog yet.

## 9. Cross-links

Outbound, the documents this contract depends on:

- [../../DEPLOY.md](../../DEPLOY.md), whose "Bank Storage rollback caveats" bullet
  already writes down the whole-blob replacement hazard section 3 reasons about, and
  whose operational notes own the environment reference.
- [state.md](state.md), for "Worktree, base, and merge-forward", the C01 account Hearth
  authority, the lifecycle extension boundary and the gate row this artifact answers.
- [progress.md](progress.md), for the implementation ledger this contract's producing
  work reports into.
- [../prd/woc/freehold-service-contract.md](../prd/woc/freehold-service-contract.md),
  whose "Account lifecycle, export and capable rollout" section states the requirement
  this file is the answer to, and whose "Identity and durable protocol" owns the
  hard-deletion rule section 6 defers to.
- [content-numbers-workbook.md](content-numbers-workbook.md) section H, which owns the
  bounds derivation section 7 cites and must receive the measured byte row.
- [mutation-touch-set-manifest.md](mutation-touch-set-manifest.md), the 07a design of
  record: the global lock order, every path's statements, the schema and its
  per-row-class deletion policy, the plan inventory and its owed runtime proofs, and the
  named residuals R-1 to R-4 that sections 2, 6, 7, 8 and 8a cite. Its own section 13
  is the list of edits this contract owed.
- The [producing work's own specification](phase-07-persistence.md), and for the 07a
  additions the [transactional mutation boundary
  file](phase-07a-transactional-mutation-boundary.md).

Inbound. Each is the responsibility of the producing work's documentation step, and
none may be reported as done until the file actually carries the line:

- DEPLOY.md carries the housing operational bullet, landing in this same contribution,
  that names the two tables, their keep-forever status and the flag-off-before-rollback
  rule of section 8, and points here for the capability and quiescence detail.
- DEPLOY.md carries a second bullet for the 07a work, landing in that contribution: the three new tables
  (`freehold_plot_claims`, `freehold_operations`, `freehold_operation_receipts`) with
  their keep-forever or bounded status, the metrics an operator reads them by
  (`woc_freehold_claims_held`, `woc_freehold_authority_total`,
  `woc_freehold_receipt_growth`, and `fenced_writes` on `woc_freehold_persist_total`),
  the every-process-07a rule of section 2, the first-rollout quiet window and the
  rollback conditions of section 8, pointing here for the detail.
- state.md owes the gate-row citation of this file by name plus the implementation
  ledger entry for the modules section 2 lists.
- progress.md owes the persistence row citation of this file as delivered evidence.
- The service contract owes the reciprocal pointer from "Account lifecycle, export and
  capable rollout" to this file as its activation artifact.

Nothing in this file is a signature, and no cross-link creates one.
