# Guild Bank: progress

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: foundation | Done | 2026-08-02 | 2026-08-02 |
| Phase 1 QA | Done (PASS-WITH-FOLLOWUPS) | 2026-08-02 | 2026-08-02 |
| Phase 2: ops and wire | Not started | | |
| Phase 2 QA | Not started | | |
| Phase 3: persistence | Not started | | |
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
- [ ] Op bodies in `src/sim/guild_bank.ts` (deposit/withdraw gold, deposit/withdraw item,
      buy slots) with the full validation order and rank/proximity gates.
- [ ] `guildBankInfoFor` (proximity + rank gated, boundary-cloned).
- [ ] Wire end to end: five `guild_bank_*` tokens in `COMMAND_NAMES`/`COMMAND_FACETS`,
      `online.ts` stubs, `game.ts` allowlist + shape-check dispatch, `maybe('guildBank')`
      snapshot + delta-key registry.
- [ ] Server stamping hooks: join path + every membership/rank change in `SocialService`.
- [ ] `sim_i18n.ts` matcher rows for every new sim emit (same change).
- [ ] Tests: op suite (permissions, clamps, capacity, quest-bind, indivisible instanced
      stacks), command schema/facets, snapshot gating (away/dead/demoted/left), determinism.

## Phase 3 deliverables
- [ ] `guild_banks` DDL (additive, idempotent) + boot load per realm + book injection into
      the sim.
- [ ] Escrow save: acting character + touched book in one transaction with the lease
      fence; rollback on fence miss; round-trip + crash-shape tests.
- [ ] Ledger observer for guild ops (`container='guild'`), `create_fee` row, audit script
      compatibility; keep-forever comment at the retention registration site.
- [ ] Creation fee at `guild_create` dispatch (create-then-charge ordering) + refusal when
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
- Test coverage closed (tests/guild_bank.test.ts, 26 to 33 tests): the
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
