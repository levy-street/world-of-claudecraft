# Guild Bank: progress

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: foundation | Done | 2026-08-02 | 2026-08-02 |
| Phase 1 QA | Done (PASS-WITH-FOLLOWUPS) | 2026-08-02 | 2026-08-02 |
| Phase 2: ops and wire | Done | 2026-08-02 | 2026-08-02 |
| Phase 2 QA | Done (PASS-WITH-FOLLOWUPS) | 2026-08-02 | 2026-08-02 |
| Phase 3: persistence | Done | 2026-08-02 | 2026-08-02 |
| Phase 3 QA | Not started | | |
| Phase 4: UI | Not started | | |
| Phase 4 QA (final, offers teardown) | Not started | | |

## Phase 1 deliverables
- [x] `src/sim/guild_bank.ts`: state type, constants (from state.md), capacity, sanitize,
      empty-state factory; unit tests including clamp and never-destroy-items cases.
- [x] Session-only guild membership stamp on `PlayerMeta` + server-callable stamp entry
      point; parity-trace exclusion; tests.
- [x] `SimContext` view exposing the books (append-only extension); sim holds the
      per-guild map.
- [x] `src/world_api/guild_bank.ts` facet + barrel aggregation + `Sim` offline no-ops +
      `ClientWorld` stubs + parity pin update.

## Phase 2 deliverables
- [x] Op bodies in `src/sim/guild_bank.ts` (deposit/withdraw gold, deposit/withdraw item,
      buy slots) with the full validation order and rank/proximity gates.
- [x] `guildBankInfoFor` (proximity + rank gated, boundary-cloned).
- [x] Wire end to end: five `guild_bank_*` tokens in `COMMAND_NAMES`/`COMMAND_FACETS`,
      `online.ts` stubs, `game.ts` allowlist + shape-check dispatch, `maybe('guildBank')`
      snapshot + delta-key registry.
- [x] Server stamping hooks: join path + every membership/rank change in `SocialService`.
- [x] `sim_i18n.ts` matcher rows for every new sim emit (same change).
- [x] Tests: op suite (permissions, clamps, capacity, quest-bind, indivisible instanced
      stacks), command schema/facets, snapshot gating (away/dead/demoted/left), determinism.

## Phase 3 deliverables
- [x] `guild_banks` DDL (additive, idempotent) + boot load per realm + book injection into
      the sim. MUST also seed an empty book at `guild_create` (a freshly founded guild
      has no row to boot-load, and ops never lazily create one), add the disband evict,
      and land BEFORE any Phase 4 UI ships: until books load, every op is deliberately
      silent-inert (Phase 2 review finding, tracked).
- [x] Escrow save: acting character + touched book in one transaction with the lease
      fence; rollback on fence miss; round-trip + crash-shape tests.
- [x] Ledger observer for guild ops (`container='guild'`), `create_fee` row, audit script
      compatibility; keep-forever comment at the retention registration site.
- [x] Creation fee at `guild_create` dispatch (create-then-charge ordering) + refusal when
      poor; disband guard while bank non-empty; tests for both.

## Phase 4 deliverables
- [ ] Guild tab in the bank window (renders only when `guildBankInfo` is present), view
      core registered in `UI_PURE_CORES`, painter/window per the hud contracts.
- [ ] English i18n keys (treasury shown via the i18n `formatMoney`); no locale overlay
      edits.
- [ ] Mobile pass + PR screenshots (desktop and mobile) under `docs/screenshots`.
- [ ] View-core tests + any hud budget bucket updates.

## Per-QA-phase checklist (each QA phase)
- [ ] Every deliverable and acceptance item verified; BLOCKING and SHOULD-FIX fixed.
- [ ] Tests decisive; no orphaned tests; no dead code; matrix suites green.

Phase 1 QA: both lines verified and closed on 2026-08-02 (see Notes).

## Notes
Phase 3 review (2026-08-02): migration-safety ran as a dispatched agent and reported
2 BLOCKING + 1 BLOCKING-class escrow finding + 5 SHOULD-FIX + 3 NOTE; the other three
reviewer agents (database-performance, privacy-security, architecture) were lost to
infrastructure drops mid-run, so those three lenses were performed by the implementer
directly against the committed diff (recorded here explicitly; Phase 3 QA should
re-dispatch them fresh). Resolution:
- BLOCKING fixed: the last-member arm of guildLeave deleted the guild with no bank
  guard and no evict (a solo GM /gquit with a stocked bank destroyed the book via the
  cascade); it now runs the same fail-closed holdings guard as guildDisband BEFORE
  any row moves and fires onGuildDisbanded after the committed DELETE, pinned in
  tests/social_system.test.ts (refused stocked/null; allowed empty deletes + evicts;
  a non-last member is never trapped by the guard).
- BLOCKING fixed: a fenced-out session left its book mutations live while the
  character half rolled back (sim ahead of durable truth, a reproducible dupe).
  reconcileFencedOutGuildBooks evicts and reloads the touched books from the DB
  (loadGuildBankRow) unless another live session holds a dirty mark; the residual
  cross-officer skew is ACCEPTED market-precedent risk, documented in state.md, and
  the escrow comment in saveCharacter now states the guarantee's scope honestly.
- SHOULD-FIX fixed: octet_length (uncompressed) replaces pg_column_size for the row
  bound; a structurally-not-a-book row under the bound is skip-and-preserve
  (isMalformedGuildBankRow) instead of salvage-to-empty; the boot load retries
  transient failures then goes loudly inert; onGuildDisbanded clears every session's
  dirty mark; a rollback-safety note at the DDL pins the both-paths-guarded contract.
- NOTEs recorded in state.md: no optimistic concurrency on guild_banks (valid only
  under one-process-per-realm), guild_banks.realm write-only, audit unpaginated.
- Self-review lenses (implementer, in lieu of the lost agents): privacy-security:
  every new statement parameterized (the one SET LOCAL interpolation is the
  pre-existing server-constant idiom); the book write exists at exactly two fenced
  call sites; the fee path is fully server-authoritative (constant-derived amount,
  purse read from the sim, ledger rows from the info diff, never from msg fields);
  refusals mutate nothing (pinned per path); no secrets or player data in new logs.
  VERDICT: no findings. database-performance: boot read is one realm-scoped LEFT
  JOIN (guilds_realm_name prefix + guild_banks PK), octet_length detoast cost is
  boot-only; write amplification is one small PK upsert per DIRTY save; books share
  the market serial writer by design (documented); transactions stay bounded by the
  heavy statement timeout; bank_ledger growth is the documented keep-forever
  decision; guild_banks is bounded by guild count and cascades. VERDICT: no
  findings, notes recorded. architecture: sim additions are pure free functions over
  SimContext with thin facade delegates (no new imports, no rng, guards green);
  sim_context.ts untouched; the four client coordinators untouched; game.ts growth
  is dispatch/transport/save-path glue that needs GameServer private state, with the
  pure parts extracted (guild_bank_state.ts, bank_ledger.ts). VERDICT: no findings.

Phase 3 (2026-08-02):
- DDL landed in `SOCIAL_SCHEMA` (the family that owns guilds): `guild_banks` per the
  state.md shape, `ON DELETE CASCADE` off `guilds`, realm with NO interpolated default
  (every insert passes realm explicitly). Applied against the real dev Postgres by a
  server boot and re-applied twice by hand: valid and idempotent.
- Persistence is ONE mechanism: the fenced escrow family in `server/db.ts`. The fenced
  character UPDATE was extracted into `characterUpdateStatement` (rule of three: the
  third copy appeared) so the lease fence is byte-identical across `saveCharacterState`,
  `saveCharacterAndMarketState`, and the new `saveCharacterAndGuildBankState`. The
  market sibling gained an additive optional `guildBanks` trailing param (the leave
  flush carries books); the new sibling is the autosave-path escrow (no market gate:
  it writes no world_state row, and books only exist post-boot-load/seed). Fence miss
  rolls back everything and returns false; there is NO standalone book write anywhere.
- Boot: `server/guild_bank_state.ts` (`loadGuildBanksIntoSim` + `collectGuildBankSaves`)
  is the host-side glue module, unit-tested against a real Sim. `loadGuildBankRows`
  LEFT JOINs every realm guild; no-row = empty book; an OVERSIZED row (bound applied
  in SQL via `pg_column_size`, `GUILD_BANK_ROW_MAX_BYTES` = 256 KiB) is SKIPPED
  entirely, never loaded as empty (that guild stays inert and its row survives; the
  disband guard fails closed on it). `sim.guildBanks.has()` verified per loaded guild.
  `main.ts` awaits `loadGuildBanks()` before listen: books are live before any join,
  releasing the Phase 2 silent-inert wire.
- Dirty tracking: `session.dirtyGuildBanks` (guildId -> seq). The dispatch observer
  (`runGuildBankOp`) diffs `guildBankInfoFor` before/after each op: a non-empty diff
  writes the container='guild' ledger rows (shared FIFO tail, never awaited) AND marks
  the book dirty. Saves carrying books ride the ONE market serial writer with book
  serialization at write time (the market clobber rationale); the seq-guarded release
  keeps a mid-save op scheduled; a fence-out (false) releases nothing.
- Fee: dispatch refuses a poor founder BEFORE any DB work with the localized
  `guild.createFee` line; the commit arm (`SocialTransport.onGuildCreated`, fired in
  guildCreate's success arm right after the founder stamp) seeds the empty book into
  the LIVE sim, charges via `Sim.chargeGuildCreationFeeFor` (clamped to the purse,
  silent by design), writes the `create_fee` row, and schedules the escrow save.
- Disband: `guildDisband` consults `tx.guildBankHoldings` (the live book) after the
  leader check; refuses while copper/items remain AND fails CLOSED on null (unloaded
  book = the oversized-skip state; the cascade must not destroy the row). On the
  committed DELETE, `onGuildDisbanded` evicts the book (`Sim.evictGuildBank`).
- Ledger + audit: `diffGuildBankOp` (pure) + `recordGuildBankDeltas` in
  `server/bank_ledger.ts`; gold ops record the TREASURY delta, buy_slots the negated
  BEFORE table price, create_fee the founder's purse (excluded from treasury replay).
  `scripts/bank_audit.mjs` groups guild rows per GUILD (anonymous pipe), replays the
  treasury to non-negative, shape-checks the new ops, reconciles against `guild_banks`
  books (disbanded guilds reconcile items+treasury against empty, purchased skipped),
  and its `main()` reads `guild_banks`; ran clean against the dev DB (exit 0).
- i18n: two new server literals (`guild.createFee` parameterized + RULES entry,
  `guild.bankNotEmpty` exact) with DICT rows in ALL 22 locales and byte-bound pins in
  `tests/server_i18n.test.ts` (game.ts/social.ts are S3 blind spots; the samples list
  is the backstop). The fee literal uses a `goldAmount` local so the S3 scanner's
  probe substitution stays digit-shaped and the RULE recognizes it.
- New suites: `tests/guild_bank_db.test.ts` (DDL pin, transaction/crash shape,
  fence-miss rollback, bounded read), `tests/guild_bank_persistence.test.ts` (real
  GameServer + Sim: boot load, parsed-object pin, round trip, observer, escrow arm,
  null-serialize skip, fence-out keeps the mark, mid-save seq guard, fee gate, create
  and disband hooks); guild arms appended to `tests/bank_ledger.test.ts`,
  `tests/bank_ledger_db.test.ts`, `tests/bank_audit.test.ts`,
  `tests/social_system.test.ts` (guard refus/allow/evict/fail-closed),
  `tests/guild_bank.test.ts` (evict/holdings/charge).

Phase 2 (2026-08-02):
- Sim ops landed as free functions over SimContext in `src/sim/guild_bank.ts` with a
  shared `requireOfficerBook` gate helper. Validation order exactly per state.md.
  Reused emit strings (too-far, quest-item, "Not enough money.", "You are not in a
  guild.") resolve via existing sim/server matchers; the 12 NEW strings are English-only
  `error.guildBank*` / `log.guildBank*` rows in sim_i18n plus 4 RULES entries (money
  fragments splice verbatim, item names via locItem). Gold-op sentences end "guild
  treasury", item-op sentences end "guild bank", so the money and item rules can never
  shadow each other. `guild_bank.ts` joined the S3 scan list in the same commit.
- The SERVER entry points are pid-first `guildBank*For` methods on the Sim facade
  (the bankInfoFor pattern), because the IWorld facet arm is inert-forever offline
  (locked Phase 1 decision); dispatch calls those, never the facet members.
- A stamped guild whose book is NOT loaded refuses SILENTLY (host wiring state, not a
  player error): ops must never lazily create a book, because loadGuildBank is
  load-once and a lazy empty book would shadow the Phase 3 DB row (dupe-shaped).
  `guildBankInfoFor` likewise returns null with no book, so the Phase 4 tab never
  renders before persistence wires up.
- Withdraw-gold refuses past `Number.MAX_SAFE_INTEGER` on the purse (no game copper
  cap exists; the bound is exact because both operands are safe integers).
- `guildBankInfoFor` gates on DEAD as well (stricter than personal bankInfoFor):
  acceptance requires the stream to null on death.
- Wire: 5 tokens appended (append-only) + IWorldGuildBank facet tags; pins bumped:
  send 174->179, dispatch 185->190, delta keys 62->63 (`guildBank` ->
  `guildBankInfo`), dirty fixture + round-trip assertion added. The four
  self-touching commands joined HEAVY_SELF_CMDS; guild_bank_buy_slots deliberately
  did not (treasury-only, rides the ungated guildBank stream).
- Stamps: `SocialTransport.onGuildMembershipChanged` is called synchronously at every
  committed mutation site (create, accept, leave both arms, kick, setRank, transfer
  BOTH rows: target leader + former leader officer, disband every member online or
  not). The game.ts arm is the ONE combined entry point (pairs setPlayerGuild +
  setPlayerGuildMembership; Phase 1 QA carried-forward line closed). A per-session
  `guildStampSeq` fence makes sendSocialSnapshot (which now stamps the PAIR at
  join/push) skip its stamp when a synchronous one landed mid-flight, closing the
  in-flight-snapshot stale-rank window. Refused mutations stamp nothing (pinned per
  site in tests/social_system.test.ts).
- Parity-trace exclusion re-audited (carried-forward line): `guildMembership` stays
  excluded; rationale recorded in tests/parity/trace.ts (host-injected authorization
  input, always null offline where ops refuse; the gated state itself IS sampled).
- tests/guild_bank.test.ts grew substantially (shared refusal dimensions run against
  ALL five ops via an OPS table; treasury-cap edge at exactly the cap; purse bound at
  exactly MAX_SAFE_INTEGER; indivisible instanced stacks; craftedRecipeId round trip;
  copper conservation; info null transitions; stale-rank scenario; zero-rng over the
  whole op surface; the ClientWorld pin FLIPPED from send-nothing to the five exact
  payloads, closing the "no empty online.ts body" carried-forward line).

Phase 2 QA (2026-08-02), fresh auditor, verdict PASS-WITH-FOLLOWUPS:
- Reviews dispatched fresh (COVERAGE not filtering): architecture-reviewer (0 blocking,
  3 should-fix, 9 note), privacy-security-review (1 CRITICAL, 2 warning, 5 info),
  cross-platform-sync (0 critical, 3 warning), test-coverage-auditor (7 should-fix,
  8 nit), qa-checklist. Every BLOCKING and SHOULD-FIX was fixed here or pinned into
  Phase 3's acceptance lines.
- CRITICAL fixed (the one real exploit, constructed and reproduced): `setGuildRank`
  had NO `guild_id` predicate and discarded its rowcount, and `guildSetRank` stamped
  the live sim unconditionally after it. A promote racing a leave, kick, disband, or
  guild switch made the UPDATE match zero rows while the sim was stamped
  `{guildId: A, rank: 'officer'}`. Because the stamp IS the guild bank's authorization
  input and `pushGuild` never reaches a character no longer in the roster, the bogus
  officer rank persisted until relog (and the `guildStampSeq` fence actively protected
  it). Fix: the write predicates on character AND guild and returns whether a row
  moved; `guildSetRank` refuses without stamping when it did not. Two regression tests
  drive the real race (mid-flight leave, mid-flight guild switch), both mutation-checked.
- SHOULD-FIX fixed in this pass: the officer gate was a DENYLIST (`rank === 'member'`),
  which fails OPEN for any rank added later, and it was duplicated between the op gate
  and the info read: both now share one positive `GUILD_BANK_RANKS` allowlist, swept
  over every rank plus a future-rank arm that a denylist fails. `guildBankInfoFor`
  shipped whole instance payloads justified by "locked copies can never enter the
  book", which covers deposits but NOT the sanitize load path a tampered/legacy row
  arrives through: a refused (unwithdrawable) slot now degrades to `publicInstanceView`,
  so no `boundTo`/armed `bindOnTrade` bind identity is broadcast to every officer.
  Runtime pid guard added (the required-pid claim was type-only; `Sim.resolve`
  falls back to the local player on undefined). Dispatch routing was pinned by COUNT
  only: a spy test now names each entry point and its argument order plus the shape
  rejects. The fence suite only proved the SKIP arm (a check against 0 instead of the
  captured seq passed everything): the apply arm and the offline-id no-op are pinned.
  `error.guildBankNoGuild` duplicated `server_i18n`'s `guild.notInOne` verbatim, which
  the hud matcher resolves FIRST, leaving the sim row dead while shipping a second
  divergable per-locale copy: the guild bank refusal now names its own feature.
  Cross-guild isolation, the full withdraw-side pipe sweep (all four dimensions, not
  two), and malformed-count negatives added.
- Exploit catalog run against the code as written, all NEGATIVE: double-dispatch in one
  tick (ops are synchronous and all-or-nothing, no await inside any body);
  deposit+withdraw interleavings (conservation pinned); capacity scratch-vs-real
  divergence (`countFit` gates before `addStacked` mutates, one primitive, no scratch
  copy exists to diverge); treasury cap at exactly the cap (accepted) and one past
  (refused whole, never truncated); purse bound at exactly MAX_SAFE_INTEGER (accepted)
  and one past (refused); instanced-stack splitting (moves whole or not at all);
  `craftedRecipeId` laundering (threaded through both the fit check and the grant).
  The stale-rank window was the ONE live hole and it is closed above.
- Silent-inertness verified safe: no `server/` caller of `loadGuildBank` exists, so
  every op dead-ends at `requireOfficerBook`'s `?? null` with no player line and,
  critically, no lazy book creation (`get`, never `set`), so nothing can shadow the
  Phase 3 DB row. Confirmed the four Phase 3 prerequisites are pinned as acceptance
  lines in phase-03-persistence.md (boot-load, guild_create empty-book seed, disband
  evict, ledger rows before any Phase 4 UI).
- Carried-forward lines all verified explicitly: the five `online.ts` bodies are
  non-empty and payload-pinned to literal wire tokens; `onGuildMembershipChanged` is
  the ONE combined entry point at every one of the 8 mutation sites (each pinned, with
  refused mutations pinning zero stamps); the `guildMembership` parity exclusion
  re-audited and correct (host-injected authorization input, null offline, and the
  state it gates is fully sampled).
- Validation: `npx tsc --noEmit` clean; the 10-suite run 784 passed / 3 skipped (was
  773, +11); `tests/parity` + `social_db_guild_names` + `i18n_completeness` 197 passed;
  `npm run ci:changed` exit 0. Every new guard mutation-checked (guard neutered ->
  the new test fails -> restored).
- Deferred with rationale (NOTEs, none blocking): withdraw-direction refusal copy is
  deposit-voiced ("cannot store") and would need its own i18n rows; item notices omit
  counts; a dormant unknown-item-id row emits its raw id in the withdraw notice; the
  spectator arm mirrors the anchor's guild bank exactly as `maybe('bank')` already
  does; admin guild RENAME does not re-stamp the nameplate name (membership id + rank,
  the gate input, are unaffected); the first-join retro-deeds fence edge (cosmetic).

Phase 2 review (2026-08-02): architecture-reviewer (1 BLOCKING, 5 SHOULD-FIX, 6 NOTE),
privacy-security-review (CHANGES REQUESTED: 1 BLOCKING, 2 SHOULD-FIX, 2 NIT),
cross-platform-sync (APPROVE: 0 BLOCKING, 2 SHOULD-FIX, 3 NIT). All dispatched fresh,
COVERAGE not filtering. Resolution:
- BLOCKING (both): the deposit gate only refused quest items while the guild bank is an
  anonymous exchange pipe. FIXED: `guildBankPipeRefusal` (quest / soulbound /
  noMarketList / `isTransferLockedInstance`) on deposit AND withdraw, one negative test
  per dimension plus the tampered-book withdraw arm; state.md decision line revised.
- SHOULD-FIX fixed: guildStampSeq fence test (`tests/guild_stamp_fence.test.ts`, real
  GameServer + deferred snapshot, mutation-checked); collect-quest un-credit/re-credit
  test; `src/sim/CLAUDE.md` module row updated; required pid on all five ops (NOTE
  upgraded, fails-open hazard); gold commands dropped from HEAVY_SELF_CMDS with a
  truthful comment (copper is always-sent); stale describe title renamed.
- SHOULD-FIX tracked to Phase 3 (not Phase 2 scope by the locked plan: no DDL, no
  ledger): books are never boot-loaded so the live wire is deliberately silent-inert
  until Phase 3 (guarded: ops never lazily create a book, load-once shadow hazard);
  bank_ledger observer rows; guild_create empty-book seed; disband evict. Pinned in the
  Phase 3 deliverables above. Guild bank ops are NOT deeds banker business by design
  (module header comment); revisit in Phase 4 if wanted.
- NITs deferred with rationale: firstJoin retro-deed fence race (cosmetic, needs a
  same-millisecond join+mutation; both reviewers call the raced outcome acceptable);
  item notices omit counts (cosmetic; no personal-bank precedent to match);
  guildBankInfoFor full-payload ruling recorded in-code (locked copies can never enter
  the book, so publicInstanceView's hidden fields are unreachable); spectate parity
  with the personal bank (moderator-only, read-only, precedent-consistent);
  resolveOfficerBook extraction is a rule-of-three watch item.

Phase 1 (2026-08-02):
- The stamp landed as ONE field, `PlayerMeta.guildMembership: GuildMembership | null`
  (`{ guildId, rank }`), not two: one `META_EXCLUDE` entry, atomic clear on leave.
  `GuildRank` is redeclared in `src/sim/guild_bank.ts` (sim never imports `server/`);
  the string values mirror `server/social.ts`.
- `guildBankNextExpansionPrice` landed with the capacity math (it is a pure table
  lookup `guildBankInfoFor` needs in Phase 2, not an op body).
- Sim facade delegates: `setPlayerGuildMembership` (beside `setPlayerGuild`),
  `loadGuildBank`/`serializeGuildBank` (the Phase 3 persistence seam, pure shape
  in/out). The offline facet arm is inert forever (the `socialInfo` idiom).
- The two SimContextHost test fixtures (`tests/sim_context.test.ts`,
  `tests/entity_roster.test.ts`) gained the `guildBanks` view; parity goldens
  did not churn (full `tests/parity/` green).
- Review outcomes (architecture-reviewer + cross-platform-sync, both approve, 0
  blocking): the two SHOULD-FIX items landed in Phase 1 (`GUILD_RANKS` tuple +
  type/value lockstep pin against `server/social.ts` `GuildRank` in
  `tests/guild_bank.test.ts`, and a zero-rng-draw observer test over the whole
  Phase 1 surface). Deferred follow-ups carried forward:
  - Phase 2: `setPlayerGuild` and `setPlayerGuildMembership` are independent
    stamps; the leave/kick/disband call sites MUST pair them (or use one
    combined entry point), and Phase 2 QA adds the acceptance line "no
    `guildBank*` method body in `src/net/online.ts` is empty".
  - Phase 2: re-audit the `guildMembership` parity-trace exclusion when the
    officer gate starts reading the field.
  - Phase 3: add an unload/evict path for `Sim.guildBanks` (disband hook) so
    the map is not unbounded on a long-lived realm; the server load path should
    verify `sim.guildBanks.has(guildId)` after boot-loading.
  - The sanitize inventory loop is a deliberate second copy of `bank.ts` (rule
    of three); extract a shared leaf if a third copy appears.

Phase 1 QA (2026-08-02), fresh auditor, verdict PASS-WITH-FOLLOWUPS:
- Reviews dispatched (all four, COVERAGE not filtering): architecture-reviewer
  PASS (0 blocking, 3 should-fix), cross-platform-sync APPROVE (0/0),
  test-coverage-auditor CHANGES REQUESTED (1 blocking, 6 should-fix),
  qa-checklist READY (0 blocking, 3 should-fix). Every BLOCKING and SHOULD-FIX
  was fixed in this QA pass or pinned into a later phase's acceptance lines.
- Code fixes landed: `loadGuildBank` is now LOAD-ONCE (a second load skips
  rather than clobbering a live book with unflushed deposits; evict-then-load
  is the sanctioned reload path, pinned by test); `serializeGuildBank` now
  documents that null means SKIP the write, never persist an empty book (the
  Phase 3 acceptance test must pin it); the sim architecture guard
  (`tests/architecture.test.ts` forbiddenImport) now bans `server/` imports
  from `src/sim/` (even type-only; verified to fail on an injected probe), so
  the GuildRank-redeclaration contract is enforced, not just documented.
- Test coverage closed (tests/guild_bank.test.ts): the
  craftedRecipeId sanitize dimension (both arms, key-absence pinned, and in
  the round-trip); truthy-non-object `instance` degrades to a plain slot;
  truthy-non-object membership stamps normalize to null; `sanitize({})` whole
  object default; overstacked PLAIN slot counts pinned uncapped (the bank.ts
  pre-bag idiom, deliberate); a sanitizer LOCKSTEP pin feeds one hostile
  fixture through both `sanitizeGuildBankState` and `sanitizeBankState` and
  requires identical inventory arms (guards the deliberate second copy until
  the rule-of-three extraction); the zero-rng test now covers the whole Phase 1
  surface (capacity/price/empty-state/facet arm) with a positive observer
  control; the offline Sim facet arm is behaviorally pinned inert (null read,
  five commands mutate nothing); the five ClientWorld stubs are pinned to send
  NOTHING on the wire (bare-prototype cmd spy).
- Tracked forward, not fixable in Phase 1 (acceptance lines added to
  phase-02-qa.md): the independent `setPlayerGuild` / `setPlayerGuildMembership`
  stamps (prefer ONE combined entry point when the server call sites land; a
  stale rank stamp is privilege-escalation-shaped once the officer gate reads
  it); no empty `guildBank*` body in online.ts after Phase 2; re-audit the
  parity exclusion. New Phase 2 notes: pin offline-empty `Sim.guildBanks` and
  op purity (ops as pure functions of book + actor) once op bodies read the
  map; decide `nextExpansionPrice` vs the personal bank's `nextExpansionCost`
  naming before Phase 4 renders both. New Phase 3 notes: a null
  `serializeGuildBank` must SKIP the DB write (never write an empty book over
  a real row); the server hands `loadGuildBank` a PARSED object (a JSON string
  raw yields an empty book by design, pin the parse at the DB read); bound the
  raw row size server-side before load (the sim tolerates unbounded inventory
  length by contract).
