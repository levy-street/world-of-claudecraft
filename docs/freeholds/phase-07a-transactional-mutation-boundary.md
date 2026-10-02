# Phase 07a: transactional mutations and global claim fencing

Wave A. The settled decisions in state.md, content-manifest.md,
content-numbers-workbook.md, art-brief.md and ux-spec.md govern this work. The artifacts
and tests named below are NEW unless the context inventory labels them EXISTING.
No housing implementation is claimed complete by this planning file.

### Starter Prompt
```
This is Phase 07a of the Freeholds and Guildhalls feature: transactional mutations and global claim fencing.
Harness: Claude Code. Follow the root CLAUDE.md "Working style by model capability"
block for effort and fan-out.
This prompt names no model. Keep independent implementation owners disjoint; the parent
integrates shared callers and pins after their reports return.

Goal: make durable plot ownership, exact-copy custody and repeatable operation recovery safe across process crashes and competing realms.

STEP 0 - PRE-FLIGHT:
- Work in /Users/fernando/orca/workspaces/world-of-claudecraft/wocc-freeholds on
  feature/freeholds. Verify git status is clean; otherwise ask the user.
- Sync per state.md "Worktree, base, and merge-forward": git fetch origin --prune; use the
  newest origin/release/**. Run release-merge-audit after any non-empty merge and pnpm
  install --frozen-lockfile when patches/ moved.
- Memory scan: MEMORY.md, freeholds entry, test-pin traps, apply ALL findings, and
  review the review-fix round. Record changed seam/ceiling/base facts in state.md before
  editing dependent code. Read each changed directory's CLAUDE.md.

STEP 1 - LOAD CONTEXT (through agents, never planning docs or coordinators directly):
- One Explore agent reads this file, its paired QA, state.md, the matching progress row,
  implementation-plan.md review table, ux-spec.md and the three content/art artifacts.
- It reads the following existing seams and prior outputs, returning exact exports,
  readers/writers, pin sites, known failure behavior and a promised-versus-tree table:
  - PRIOR 07 server/freehold_db.ts and freehold_persist.ts, src/sim/freehold/state.ts.
  - EXISTING server/character_save_transaction.ts::beginCharacterSaveTx (deadline owner),
    server/character_save_statement.ts::runFencedCharacterSave and
    server/db.ts save composition (read through the Explore agent),
    server/bank_ledger_batch_db.ts, server/guild_bank_receipt_db.ts,
    server/storage_purchase_db.ts, server/serial_writer.ts, server/background_db_gate.ts,
    server/db_connection_budget.ts and the character lease/fence caller census returned
    by the database reviewer. Read actual exported paths before citing any moved helper.
  - EXISTING ordinary save ordering: sorted account parent KEY SHARE; character
    FOR NO KEY UPDATE pre-lock and nonce-fenced update; bank-ledger receipt classifier
    and ledger writes; sorted guild-bank replay; sorted storage purchase-key advisory
    locks and pending/applied receipt/audit close. Market/mail compounds additionally
    order their market/mail writes and custody tail. Never reorder legacy participants.
  - EXISTING server/guild_bank_lazy_loader.ts and keyed cached-read/admission lifecycle.
    EXISTING tests/server/storage_purchase_db.pg.test.ts for disposable schema setup;
    existing character/guild-bank/market save suites found by the exact caller census.
- Reports go to the session scratchpad; replies carry a path and short summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Deliverables (at most five):
1. NEW server/freehold_claim_db.ts::acquireFreeholdClaim/releaseFreeholdClaim owns a
   DB-enforced lease plus monotonically increasing fencing generation per opaque plot ID
   in the NEW freehold_plot_claims table under FREEHOLD_CLAIM_SCHEMA (one active claim
   per plot_id; ensureSchema position after FREEHOLD_SCHEMA and before
   STORAGE_PURCHASE_SCHEMA). All realm processes must prove the current fence before
   admission and mutation; one plot has one active authoritative claim. The reused lease
   policy is expiry PLUS heartbeat (server/db.ts LEASE_TTL_SECONDS, PROCESS_LEASE_HOLDER,
   the acquireCharacterLease ON CONFLICT arms and nonce rotation), so this phase names
   the renewer: NEW renewFreeholdClaims, a PeriodicSaveWrites member registered in
   PERIODIC_SAVE_WRITE_NAMES beside heartbeatLeases on the same 30 s cadence, renews
   every claim that has a live session, an in-flight operation or a loaded plot with
   visitors. The offline-owner visit case (07 keeps the plot loaded for visitors) is
   the reason: no character autosave of the owner holds that claim, so the renewer,
   not a visitor's character heartbeat, keeps it alive. A crashed holder stops
   renewing and expires under that policy, then a new claimant gets a newer generation;
   late old saves cannot commit. Use bounded lazy load/single-flight and honest
   busy/retry on foreign claim/pool pressure. Lease policy/timing reuses that verified
   authority infrastructure, never a sim clock or a guessed housing timeout. No live
   client/transaction spans a player visit.
   AS BUILT (the 07a QA, recorded in the manifest's section 16): no
   `releaseFreeholdClaim` export exists. A per-plot release is the renewer's unwanted arm
   (`FREEHOLD_CLAIM_RELEASE_SQL`, chunked) and the shutdown release
   (`releaseAllFreeholdClaims`); the renewer is `renewFreeholdClaims` in
   `server/freehold_claim_registry.ts`.
2. NEW server/freehold_mutation.ts::commitFreeholdMutation composes exact item/gold
   transfers with housing effects in ONE bounded character-save transaction. Acquire
   character FIFO before plot/shared-resource serialization and admission; no queue wait
   holds a DB client. Pre-lock and nonce-fence character rows using the actual
   runFencedCharacterSave path, not the InitPlan-prone unchecked save helper. Preserve
   all legacy save participants' relative lock order. Append a named housing composition hook after the legacy effects and before COMMIT.
   Its exact new-participant lock order is a producing implementation artifact: author
   the touch-set manifest before coding, obtain database/persistence/security acceptance,
   then prove the manifest with real PG interleaves. Never acquire a legacy participant
   after this hook. Hall Fund and wards extend this same reviewed manifest with every
   lifecycle/FK/trigger/custody ordering constraint. Material/gold, plot/fund,
   receipt/replay and character lease refusal abort all halves.
3. NEW server/freehold_operation_db.ts::prepareFreeholdOperation/applyFreeholdOperation
   owns durable discoverable operation intent and compact applied identities in the NEW
   freehold_operations (intent) and freehold_operation_receipts (applied tombstone)
   tables under FREEHOLD_OPERATION_SCHEMA, placed in ensureSchema beside
   FREEHOLD_CLAIM_SCHEMA; a growth gauge modelled on server/bank_ledger_growth_monitor.ts
   and pinned in tests/server/main_retention_wiring.test.ts observes the receipts table
   (and 07b's history table) with a keep-forever comment at the DDL. Bind opaque
   plot ID, internal account/character or guild authority, operation kind, immutable
   fingerprint, exact-copy references, expected durable revision and fence generation.
   AS BUILT (the 07a QA, recorded in the manifest's section 16): no
   `applyFreeholdOperation` export exists; an apply is the housing hook's operation
   participant inside `commitFreeholdMutation` (a `FreeholdOperationApply` on the
   request), and later packets that name `applyFreeholdOperation` mean that participant.
   An intent binds an ACCOUNT only (`account_id` NOT NULL): guild authority arrives with
   28's owner column, a recorded deviation.
   Intent is committed before external spend; apply identity and housing/inventory effect
   commit together; the applied-identity guard is a unique constraint, never a
   SELECT-then-INSERT. Applied receipt identity is permanent replay authority unless
   signed service replay-horizon evidence proves safe tombstone compaction. Live key
   arrays are only acceleration. ON DELETE policy per row class (D88): intent rows
   cascade with their account only when no open operation exists; applied tombstones
   retain a nonidentifying operation identity with the account reference nulled or
   scalar and cascade only under the accepted retention schedule (the data
   inventory/retention schedule artifact of the "Counsel, Terms and storefront model"
   gate row); an open housing operation blocks character or account deletion through a
   NEW CharacterFreeholdOperationOpen refusal class in server/character_delete_db.ts,
   the storage_purchase_db.ts guard_pending_storage_purchase_parent_delete shape in all
   four parts: a NEW guard_open_freehold_operation_parent_delete trigger on characters
   and accounts raising SQLSTATE 55006, that class, the stable HTTP body code
   character.freehold_operation_open (NEW CHARACTER_FREEHOLD_OPERATION_OPEN_BODY in
   server/character_delete_http.ts beside CHARACTER_STORAGE_PURCHASE_OPEN_BODY, its
   server/http/error_codes.ts row and its English catalog row
   apiError.character.freehold_operation_open in src/ui/i18n.catalog/api_error.ts,
   mapped in src/ui/api_error_i18n.ts, the S3 guard), and the account-side SQLSTATE
   55006 consumers (server/federated_auth_db.ts and the accepted hard-deletion path),
   which tell the housing trigger from the storage trigger by trigger name in the
   error detail and map it to the same code (AS BUILT: by the error's CONSTRAINT field,
   since PostgreSQL puts no trigger name on the error; the manifest's P11 records the
   deviation). 15
   extends this row for service quote/receipt data, never a parallel receipt subsystem.
   No database lock/client spans service IO.
4. Recovery is a bounded admitted producer using the same mutation writer: on restart,
   disconnect, timeout, stale response or failed apply, discover intent and reconcile the
   original operation ID. A lost COMMIT answer is a distinct ambiguous outcome: verify
   by original operation identity with a locked read (the server/character_delete_db.ts
   ambiguousCommitLanded FOR KEY SHARE verify, CHARACTER_DELETE_VERIFY_SQL, and the
   server/guild_create_db.ts commit_ambiguous durability precedents), never a plain
   SELECT that races the hung COMMIT, and never re-apply before that verify resolves.
   AS BUILT (the manifest's P9, a ruling, not drift): the housing verify WAITS with
   `FOR SHARE`, not `FOR KEY SHARE`, because the hung save holds the character row FOR
   NO KEY UPDATE, which does not conflict with FOR KEY SHARE, so a KEY SHARE wait would
   return at once and read before the COMMIT resolved; tests/server/freehold_mutation.pg
   .test.ts proves the KEY SHARE form does not wait. Do not "fix" it back.
   Pending is not success; never silently retry with a new ID.
   ACK and publish public/wire state only after commit; offline Sim executes the same
   pure mutation plan synchronously with deterministic exact-copy behavior. Failed fences
   quiesce the claim and require authoritative reload, without discarding acknowledged
   transfers or private recoverable inventory. Export/delete and retention cover every
   operation/claim row, with query/index/bytes/growth metrics and no unbounded boot sweep.
5. NEW tests/server/freehold_mutation.test.ts, freehold_mutation.pg.test.ts and
   freehold_claim.pg.test.ts exercise crash/interleave and two-process races. Produce the
   exact touch-set lock graph, query/index plan inventory and bounded workload evidence
   under docs/freeholds implementation ledger references. Include old-character nonce,
   stale plot fence, stale durable revision, duplicate operation, missing copy, dirty
   autosave race, transaction failure after each half, no-client-across-service-IO, and
   the service contract's required PG-proof rows mirrored here: ambiguous COMMIT (destroy
   the client after COMMIT is sent; landed proves no second apply, not-landed exactly one
   later apply), the claim renewer keeping a live idle claim past LEASE_TTL_SECONDS and
   reclaim advancing the generation once renewal stops, character/account deletion while
   an intent is open (the D88 refusal, then exactly one custody location) and the
   per-row-class deletion outcomes, lease takeover, storage start/apply and guild replay
   interleaves, including pending legacy side effects.
   Parent integrates every legacy-save call-site hook and reviews relative ordering.

ACCOUNT HEARTH TRANSACTION PARTICIPANT:
Consume 07's account_freehold_hearth through
server/freehold_hearth_db.ts::advanceFreeholdHearthOnClient. Add its account PK/FK,
row lock and authoritative epoch read to the exact new-participant touch-set map;
preserve every existing legacy lock/effect order. Accepted remote-key entry and the
account ready_at_ms/revision update commit together or neither. Two alts/processes
racing different destinations share one account participant, so only one eligible
entry advances the cooldown. Refused, already-home and physical-gate attempts leave
it untouched. No cached plot/UI stamp authorizes, and transfer never rewrites it.
Publish its private mirror only after commit and reject older mirror revisions.
Real-PG cross-process races, injected failure between effects, stale cache, backward
clock and commit-before-ACK replay prove no bypass or double advancement. Character
save snapshots and lifecycle rollback cannot reintroduce a transferable cooldown.

<!-- core-d9-authority:start -->
D9 AND DEVELOPER AUTHORITY BOUNDARY:
- Preserve literal game-server ignorance of distribution as well as Sim neutrality.
  The future economy service owns eligibility verification and opaque authorization
  bound to account, purpose/SKU, policy, quote and operation. Its signed issuer/verifier
  conformance artifact gates new spend; no complete trusted issuer is shipped today.
  A first-party web checkout session alone does not prove the physical distribution.
- The game consumes a verified ordinary effect through the narrow host boundary and
  correlates it to the durable operation. Client channel labels, Origin, UA, arbitrary
  JSON, linked Steam/Epic accounts or the game-service secret do not prove eligibility.
  Do not add a trusted distribution field to the game server to rescue an unverified
  purchase. Unknown eligibility refuses NEW spend; already accepted payments retain
  recovery under their original operation identity, with no DB client across service IO.
- The 05 local developer permission and fixture (D81) cannot satisfy service
  authorization, mint a paid receipt, cross into online authority or replace a durable
  transfer proof.
  Phase 15 extends these operation rows and consumes the signed service authorization
  contract; it does not fork receipt/recovery machinery or weaken D9.
<!-- core-d9-authority:end -->

INVARIANTS AND CLOSED HANDOFFS:
- A once-per-account entitlement grant and a repeatable operation are distinct.
  Economy prices and settlement remain service-owned; this foundation computes neither.
  15 must consume these exact durability/fence primitives before enabling paid effects.
- The existing character save seam includes bank-ledger receipts BEFORE guild-bank
  replay. Do not replace it with a universal all-receipts-last hierarchy. The actual
  touch-set map includes lifecycle parents, FKs, deferred triggers and compound saves.
- Render revisions may advance for presentation; only durable committed revisions
  authorize CAS. No positive player acknowledgment precedes atomic persistence online.
- Capacity, bytes, background admission and cancellation are finite, derived and tested;
  repeatable receipts require explicit permanent-growth observation or proven safe
  compaction, never deletion that re-enables an old operation.
- Pure sim behavior uses SimContext, no wall clock or host imports, no new Rng draw.
  IWorld is the renderer/UI seam; BOTH worlds and all facet/command/event pins change
  together. No internal account or guild ownership key crosses a public descriptor.
- Module-first siblings own logic. A coordinator edit is paid by a behavior-preserving
  extraction and a remeasured/lowered ceiling; never raise a ceiling without permission.
- Every player string resolves through an English hudChrome.housing.* key; use the
  tooltip-writing skill for every tooltip. Shared API/kind keys retain their own catalog.
  Regenerate artifacts; never hand-edit generated files or locale overlays.
- The state token firewall applies to on-chain vocabulary, with the Book of Deeds
  gameplay exception. Housing never sells power or destroys a home for condition.
- Never add a balance literal absent from state or a source/approved calibration row.
  A pending external acceptance has a concrete artifact, owner and closed release gate;
  it is not an unresolved implementation choice. Feature flags default off.


ACCOUNT AUTHORITY COMPOSITION EXTENSIONS:
- 07b adds the account lifecycle head/history participant and captured observation CAS;
  07c adds normalized account+tier insert at accepted owner entry. Hydrate before queues,
  capture before queueing and preserve actual account/character/legacy/FK/unique/deferred
  ordering. Never fit these into a guessed universal suffix order. Their full manifests
  must include ordinary load/entry, periodic/leave/shutdown, export/delete/maintenance.
- 13/13a later add compatible calendar-head FOR SHARE revision+irrevocable-facts guard;
  its calendar-only writer takes FOR UPDATE and never account/plot/receipt locks. Known
  coverage with mutable historical dependencies cannot commit durable condition/credit
  effects. Missing history/finality holds the affected effect pending without losing state.
- Lifecycle/account and plot CAS are independent revision checks; lower revisions cannot
  overwrite newer accepted state. Concurrent readers, waiting writer, legacy saves,
  cross-realm alts, FK/unique waits, cancellation and late acquisition require real PG.
- Sale/transfer materializes condition under original protection/calendar at its boundary,
  retains immutable credits/source identity and applies buyer lifecycle prospectively.
  It neither copies seller grace/arrival marks nor clears either account history.

STEP 3 - VALIDATION + REVIEW DISPATCH:
- npx tsc --noEmit; npx vitest run tests/server/freehold_mutation.test.ts
  tests/server/freehold_persist.test.ts tests/server/freehold_db.test.ts
  tests/freehold_state.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts
  tests/api_error_code_parity.test.ts tests/localization_fixes.test.ts (the D88 guard's
  code and English row).
- npm run db:up; with TEST_DATABASE_URL set for the disposable development DB,
  npx vitest run tests/server/freehold_mutation.pg.test.ts
  tests/server/freehold_claim.pg.test.ts. The PG summary must show executed passing tests.
  Run every actual legacy character/bank/guild-bank/market/mail save suite named by the
  reviewer-owned touch-set census. Record transaction/query/lock wait counts and plans;
  race two admitted processes and prove both invariant and bounded cancellation behavior.
- Invoke database-performance-reviewer before database/workload decisions and on the
  finished diff whenever this file touches SQL, storage shapes, queues, locks or growth.
- Required COVERAGE reviewers: database-performance-reviewer, migration-safety, privacy-security-review, server-hot-path-reviewer, architecture-reviewer, cross-platform-sync, test-coverage-auditor, qa-checklist.
  Each reports all findings to a file. The parent applies ALL findings including nits,
  then a FRESH reviewer reads the fixes. No unreviewed fix is accepted.
- Run node scripts/gate_select.mjs before completion; npm run gate is the deeper option.
  Record exact commands, exit codes, exercised/omitted suites and material risks.

STEP 4 - COMMIT CADENCE:
- Commit coherent dependency-first chunks with Conventional Commits scope and a body,
  explicit paths, never git add -A, no coauthor trailer and no word "phase" in a message.
  Separate extraction/parity provenance if applicable. Run npm run ci:changed after
  the last commit and read its exit code. Do not push or open/merge a PR.

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] Only one global claim is authoritative per plot; the renewer keeps a live claim
  past LEASE_TTL_SECONDS, lease expiration/reclaim advances the fence, late old writes
  refuse and full pool/foreign realm emits busy without loss.
- [ ] Each cross-record mutation commits every half or none in real PG; nonce/lease,
  plot/fund revision and receipt refusal cannot persist item loss or duplicate ownership.
- [ ] Lock graph preserves legacy relative order including bank receipts before guild
  replay, the InitPlan race is closed by pre-lock+nonce fence, and no queue or service IO
  holds a client/transaction. Deadline/admission/cancellation evidence is recorded.
- [ ] Restart recovers discoverable intents with the original identity; a lost COMMIT
  answer is resolved by the locked verify before any re-apply; replay after live-cache
  compaction never repeats an effect. ACK follows commit, and stale reload cannot erase
  acknowledged custody. Export, the D88 per-row-class deletion policy, the open-operation
  deletion guard, retention and byte bounds cover all rows in real PG.
- [ ] 08/13/15 and later consumers name this composition boundary; no independent
  character/housing autosave is described as an atomic item or money transfer.
- [ ] All scoped checks and the shared contribution gate passed, every required review
  returned, and the independent fix review found no remaining finding.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md row 07a and state.md's implementation ledger with exact files,
  exported symbols, schema/wire/command keys, measured bounds, artifacts and evidence.
  Keep planning "settled" distinct from implementation "built". Record no anonymous
  deferral; carry every named unsigned release gate when applicable.
- Record useful traps in the freeholds memory entry within the authorized scope.

STEP 7 - FINAL RESPONSE FORMAT:
End with status, files, commands/outcomes, review verdicts, release evidence still required,
and the FULL PATH of the next file:
/Users/fernando/orca/workspaces/world-of-claudecraft/wocc-freeholds/docs/freeholds/phase-07a-qa.md

STOPPING RULES:
- Preserve unrelated user work. Stop for an unapproved destructive schema change or a
  required raised monolith ceiling; explain the exact constraint and concrete evidence.
- If a required artifact or runtime proof fails, record FAIL and repair it; do not claim
  approval, invent numbers or silently waive checks. Never push or open/merge a PR.
```
