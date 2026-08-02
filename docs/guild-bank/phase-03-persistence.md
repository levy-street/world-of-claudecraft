# Phase 3: persistence (DDL, escrow transaction, ledger, creation fee, disband guard)

### Starter prompt
```
This is Phase 3 of the Guild Bank feature: persistence. This is the dupe-safety phase;
read the stopping rules first.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-bank.

Goal: persist the guild bank books durably and atomically, record every op in
bank_ledger, charge the guild creation fee, and refuse disband while the bank is
non-empty.

STEP 0 - PRE-FLIGHT: git status clean; memory scan; confirm Phase 2 QA passed.

STEP 1 - LOAD CONTEXT (via one Explore agent):
- docs/guild-bank/state.md (DDL shape, fee ordering, ledger ops) + progress.md Phase 3
- server/db.ts: the bank_ledger DDL and its reserved-container comment,
  saveCharacterAndMarketState (the escrow transaction + lease fence, read the whole
  function and its header comment), insertBankLedgerRow, loadMarketState/saveMarketState
- server/bank_ledger.ts (diffBankOp, recordBankOp FIFO) + scripts/bank_audit.mjs
- server/social_db.ts (SOCIAL_SCHEMA, createGuildWithLeader transaction idiom) and
  server/social.ts guildDisband + guildCreate
- server/game.ts: guild_create dispatch, the character save call sites, boot/world-state
  load path for market and mail
- server/main.ts: the retention sweep tables array; server/CLAUDE.md Hot paths section
- tests/bank_ledger_db.test.ts, tests/bank_audit.test.ts, the market/mail round-trip tests
Return: the exact transaction + fence idiom, where books should load at boot, the ledger
row shape, and how guildDisband reports refusals today.

STEP 2 - EXECUTE: fan out two agents, each writing its own tests:
Persistence agent deliverables:
- guild_banks DDL per state.md, additive and idempotent, applied with the schema family
  that owns guilds; boot load per realm injecting books into the sim via the Phase 1
  helpers; a guild with no row gets an empty bank.
- The escrow save: extend the saveCharacterAndMarketState family (or a sibling built on
  the same connection/transaction) so a guild bank op persists the acting character's
  state AND the touched guild's book in ONE transaction carrying the character-lease
  fence; fence miss rolls back everything and returns false. Wire the game-loop save path
  so guild-bank-dirty books ride the acting player's save.
- Tests: round-trip (save, reload, deep-equal), back-compat (no row = empty bank; pre-
  feature guild loads), fence-miss rollback, and a crash-shape test asserting the two
  halves can never persist independently (single-statement/transaction assertion).
Economy-integration agent deliverables:
- Ledger observer: diff guildBankInfoFor before/after each dispatched op (the
  bank_ledger.ts personal-bank idiom), writing container='guild', container_id=guild id,
  the op names from state.md, purchased_slots_after from the book; fire-and-forget FIFO,
  never awaited by the loop. Verify scripts/bank_audit.mjs tolerates or is extended for
  guild rows (keep its personal-bank report intact).
- Keep-forever comment for bank_ledger at the retention registration site in
  server/main.ts, stating the guild-bank growth decision explicitly.
- Creation fee: at guild_create dispatch, refuse before any DB work when sim copper is
  under GUILD_CREATION_FEE_COPPER (localized error via the established server-text
  path); on successful creation, deduct in the sim, save the character, and write a
  create_fee ledger row. Ordering is create-then-charge per state.md; put the ordering
  rationale in a comment at the site.
- Disband guard: SocialService.guildDisband refuses while the bank holds any copper or
  item (the server consults the sim book via the transport/context seam); localized
  refusal; tests for guarded and empty-bank disband, fee charged and fee-refused paths.

INVARIANTS IN PLAY: additive idempotent DDL only (no migrations directory), parameterized
SQL, back-compat loads never destroy items, server-text localization in the same change,
no em dashes/emojis.

Out of scope: UI, member visibility, retention sweeps for other tables, remote realms.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit; npx vitest run tests/guild_bank.test.ts (extended)
  tests/bank_ledger.test.ts tests/bank_ledger_db.test.ts tests/bank_audit.test.ts
  tests/social_system.test.ts tests/localization_fixes.test.ts; npm run build:server;
  npm run ci:changed. Postgres-backed suites: npm run db:up first.
- Dispatch: migration-safety, database-performance-reviewer, privacy-security-review,
  architecture-reviewer (sim load-helper usage).

STEP 4 - COMMIT CADENCE (explicit paths):
- feat(server): persist guild bank books atomically with character state
- feat(server): record guild bank operations in the bank ledger
- feat(server): charge the guild creation fee and guard disband on a non-empty bank

STEP 5 - ACCEPTANCE:
- [ ] A deposit or withdrawal can never persist half; fence-miss rolls back both halves.
- [ ] Restart round-trips every book; pre-feature guilds and characters load unchanged.
- [ ] Every successful op has exactly one ledger row; refusals have none; audit script
      runs clean on a scripted session.
- [ ] Creation refused when poor (nothing created, nothing charged); fee charged exactly
      once on success; disband refused until the bank is empty.
- [ ] guild_create seeds an empty book into the LIVE sim in the same success arm that
      stamps the founder (ops never lazily create a book, the load-once shadow hazard:
      without the seed the founder's bank is silent-inert until a realm restart); the
      boot load verifies sim.guildBanks.has(guildId) for every loaded guild.
- [ ] Disband (after the empty-bank guard passes) EVICTS the guild's book from
      Sim.guildBanks and deletes/ignores its row, so the map stays bounded on a
      long-lived realm and a re-created guild id can never inherit a stale book.
- [ ] A null serializeGuildBank return SKIPS the DB write, pinned by test (never
      persist an empty book over a real row); the DB read hands loadGuildBank a PARSED
      object, pinned by test (a raw JSON string yields an empty book by design); the
      raw row size is bounded server-side before load.
- [ ] The Phase 2 silent-inert live wire is released ONLY by this phase: books
      boot-load before players join, and the ledger observer is live BEFORE any
      Phase 4 UI ships (economy mutations must never run unaudited).

STEP 6 - DOCS: update progress.md + state.md ledger (DDL, db functions, ledger ops).

STEP 7 - FINAL RESPONSE: status, files, validation, review verdicts, handoff to Phase 3 QA.

STOPPING RULES: stop and surface immediately if the acting character's save path cannot
carry the book in the same transaction without restructuring saveCharacterAndMarketState
beyond an additive extension, or if any path requires writing the book outside the fence.
Do not improvise a second persistence mechanism.
```
