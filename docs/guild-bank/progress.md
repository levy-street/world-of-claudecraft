# Guild Bank: progress

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: foundation | Done | 2026-08-02 | 2026-08-02 |
| Phase 1 QA | Done (PASS-WITH-FOLLOWUPS) | 2026-08-02 | 2026-08-02 |
| Phase 2: ops and wire | Done | 2026-08-02 | 2026-08-02 |
| Phase 2 QA | Done (PASS-WITH-FOLLOWUPS) | 2026-08-02 | 2026-08-02 |
| Phase 3: persistence | Done | 2026-08-02 | 2026-08-02 |
| Phase 3 QA | Done (PASS-WITH-FOLLOWUPS) | 2026-08-02 | 2026-08-02 |
| Phase 4: UI | Done | 2026-08-02 | 2026-08-02 |
| Phase 4 QA (final, offers teardown) | Done (PASS-WITH-FOLLOWUPS) | 2026-08-02 | 2026-08-03 |
| Pricing redesign (user-directed) | Done | 2026-08-03 | 2026-08-03 |
| Follow-ups (stacked branch, 3 slices) | Done | 2026-08-03 | 2026-08-03 |
| Audit-trail hardening (payer-side ledger column + 3 loose ends) | Done | 2026-08-03 | 2026-08-03 |
| In-game bank log (final feature slice) | Done | 2026-08-03 | 2026-08-03 |
| Real-Postgres verification + index runtime proof | Done | 2026-08-03 | 2026-08-03 |

## Real-Postgres verification (2026-08-03, on `feature/guild-bank`)
The duplication audit closed seven defects and stated one limitation: every escrow
harness mocks `server/db`, so the protocol above the SQL was proven and the SQL was
not. This pass closes it and supplies the runtime evidence the database review
demanded for the log-read index. Full detail, including the numbers, lives beside
the decisions in state.md ("Real-Postgres verification", plus the INDEX and
CONCURRENT BUILDS blocks).

- [x] **`tests/guild_bank_pg_integration.test.ts`**, opt-in on `TEST_DATABASE_URL`
      like every other `*_integration.test.ts`. Drops and creates its own
      disposable database, boots the REAL `ensureSchema()` and
      `runConcurrentIndexMigrations()` into it, and drives the real exported
      functions. 18 cases, about 6 s. Escrow commit and both rollback arms (fence
      miss AND book-half refusal, the latter undoing a character UPDATE that had
      already succeeded inside the transaction); the real `deleteGuild` cascade,
      with `bank_ledger` proven to SURVIVE it; the two disband guards through the
      real `SocialService` over a real `PgSocialDb`; row-lock ordering; the
      `FOR UPDATE` merge and its no-row seed-then-relock; and `ensureSchema`
      idempotency re-confirmed against a POPULATED database by a full
      column/index/constraint fingerprint.
- [x] **Every load-bearing case mutation-checked**, because a concurrency test
      that never interleaves passes vacuously. Removing `FOR UPDATE`: 2,000 copper
      instead of 6,000. Removing the seed-then-relock: 100 instead of 300. Removing
      the ascending sort in `collectGuildBankDeltas`: real `40P01 deadlock
      detected`. A deliberate `40P01` negative control and a lost-update positive
      control are checked in beside the real cases.
- [x] **One harness defect found and fixed IN THIS PASS.** The first draft of the
      concurrent-escrow case handed every session the SAME hostile guild order, so
      all six transactions still agreed on a lock order and the case SURVIVED the
      sort-removal mutation. Fixed by giving each session a distinct rotated and
      reversed order; the mutation is now caught. No product defect: the mutation
      check found a hole in the test, not in the code.
- [x] **Index runtime proof at 5.2M rows** (5,000,000 personal + 200,000 guild
      across 500 guilds, skewed). `EXPLAIN (ANALYZE, BUFFERS)` of the exact
      statement, index sizes for the partial form versus both non-partial
      equivalents, a directly measured insert-cost delta, and `CREATE INDEX
      CONCURRENTLY` wall clock with and without a concurrently open long
      transaction. One wording correction recorded: the plan node is `Index Scan`,
      not `Index Scan Backward`, because the `id DESC` is baked into the index; no
      Sort node appears either way.

## In-game bank log (2026-08-03, on `feature/guild-bank`)
Three commits (server read path, facet + wire, UI). The final feature slice: the
guild bank is officer-only, so any officer can quietly drain shared property.
Every op already wrote its `bank_ledger` row; the knowledge existed and only an
operator could see it. This is the read that makes officer actions visible to
the guild, which is the social check the permission model rests on.

- [x] **Server read path.** `server/guild_bank_log.ts` (projection + per-guild
      cached read), `server/db.ts loadGuildBankLogRows` (the one statement),
      `server/game.ts` dispatch case + `sendGuildBankLog` +
      `guildBankLogGuildFor`. The gate is the BANK's own gate reused verbatim,
      so a member is refused by the same predicate that denies them the bank,
      and it is RE-CHECKED after the awaited read (a demotion can land inside
      that window). The guild id comes from the membership stamp; there is no
      guild field on the wire.
- [x] **Index.** `bank_ledger_container_recent ON bank_ledger(container_id, id
      DESC) WHERE container = 'guild'` via the post-boot CONCURRENTLY seam
      (`server/bank_ledger_indexes.ts` + `server/concurrent_indexes.ts`), never
      boot DDL. This resolves the Phase 3 QA deferral whose trigger was "a
      per-guild reader exists". Measured on 400k rows: no index 252 shared
      buffers / 1.35ms (backward primary-key scan); the equality ALONE still
      loses to that same PK scan (252 buffers / 1.38ms), which is why the
      ordered column is not decoration; the ordered form 56 buffers / 0.20ms.
      PARTIAL after the database review: `container` is a two-value column this
      reader only ever passes 'guild' for, so a full index was permanent write
      amplification on every personal-bank insert for a query that can never ask
      for one.
- [x] **Cache.** Per guild through `server/cached_read.ts` (TTL 30s,
      single-flight, stale-on-error, LRU cap 256). `KeyedCachedRead` MOVED from
      `server/discord_status_cache.ts` to `cached_read.ts` (re-exported there,
      so every existing caller and test keeps its import path): it is a generic,
      and a guild bank module importing the Discord module for it would have
      been the wrong seam. The bust lives in `recordGuildBankDeltas`, the ONE
      guild row writer, fires only for VISIBLE ops, and fires TWICE: at the op,
      and again once THAT CALL's own inserts settle (chained on those promises,
      never the process-global FIFO tail, which on a slow database is minutes
      long). It MARKS dirty rather than dropping: see the coalescing floor.
- [x] **Withheld.** `escrow_deficit` / `counterparty_orphan` never leave the
      server (filtered in SQL, allowlist re-stated client-side). No account id,
      realm, or instance payload is selected; character ids resolve to display
      names in the statement. `admin_purge` IS shown and names NOBODY: its
      ledger character is the escrow carrier, a bystander, so "An administrator
      removed X" is the honest sentence and an unexplained gap is avoided.
- [x] **Facet + wire.** ONE new member, `guildBankLog(): GuildBankLogView`, a
      METHOD because reading it is what REQUESTS the cold payload; token
      `guild_bank_log` answered on its own `gbanklog` frame, never a snapshot
      key. Send-time TTL gate makes a per-frame read idempotent AND ages a lost
      response into exactly one retry. Pins: parity 288/74/214,
      send 182 / dispatch 194, `GUILD_BANK_TAGS` + facet exhaustiveness,
      concurrent-index order.
- [x] **UI.** `src/ui/guild_bank_log_view.ts` (UI_PURE_CORES) +
      `src/ui/guild_bank_log_window.ts` (UI_DOM_MODULES) behind a Contents/Log
      sub-strip in the Guild pane. Loading / refused / empty are three distinct
      renderings on purpose. Character names are spliced into a textContent
      sink (the rows are built node by node, never as HTML). 17 new
      `hudChrome.bank.*` keys with their five non-Latin M16 fills; 40px mobile
      floors for the sub-tabs. `guildTabActive` now requires the CONTENTS view,
      so a bag click on the reading surface cannot silently deposit.
- [x] **Database review pass** (database-performance-reviewer, verdict BLOCK:
      0 blocking-labelled but 5 actionable SHOULD-FIX; all five fixed here).
      - F5 the index is now PARTIAL (above).
      - F8 `runConcurrentIndexMigrations` split out of `ensureSchema` and called
        AFTER `server.listen`: the builds serialize every realm on the advisory
        lock, so before listen a rolling restart stalled every realm at once and
        none of them served players. Loud, non-fatal, idempotent, self-healing.
      - F1/F2/F12/F13 the COALESCING FLOOR (`GUILD_BANK_LOG_MIN_REFRESH_MS` 2s):
        a bust marks dirty instead of dropping, so a busy guild's log stays
        cached (it was uncached in exactly the state the cache exists for), an
        in-flight query is never orphaned into a second identical one, hidden
        ops no longer force a provably no-op refresh, and the settle-bust waits
        on this call's own inserts.
      - F3 the statement is pinned by shape (`tests/bank_ledger_db.test.ts`):
        predicate clauses, `ORDER BY bl.id DESC`, parameterized LIMIT, the
        lowered timeout, and the absence of account_id/realm/instance from the
        select list. Every other test in the slice mocks at or above that
        function, so nothing else would have noticed an edit that silently
        turned this into a sequential scan.
      - F11 `woc_guild_bank_log_cache{kind}` through the GameStateSource gauge
        seam plus the tenth incident kind `log_read_failed`.
      - Also: the read now carries its OWN 2s statement deadline (the pool
        default is 15s, and ~10 degraded reads at that bound would exhaust the
        pool), the stale retention-sweep "no hot reads" justification in
        `server/main.ts` is corrected, and the two comments the KeyedCachedRead
        move left dangling are fixed.
- [x] **Screenshots** (`scripts/guild_bank_log_shot.mjs`, the
      guild_bank_tab_shot sibling; captured against a real server with
      ALLOW_DEV_COMMANDS=1 after everything else was committed):
      `docs/screenshots/guild-bank-tab/after-desktop-guild-log.png` (+ the
      full-frame variant), `after-desktop-guild-log-empty.png`,
      `after-mobile-guild-log.png`, `after-mobile-guild-log-empty.png`. The
      populated shots are end to end: the guild is founded, opened, expanded,
      banked and un-banked through the real facet commands, so the pane shows
      one line of every sentence it can draw. The EMPTY shot is driven, not
      faked: founding a guild always writes a create_fee row, so an empty log is
      unreachable through play, and the script swaps the WORLD's guildBankLog()
      read for an empty ready view and lets the real core and painter draw it.
      The same session also proved the relocated index build end to end: the
      index was dropped, the server restarted, and it was rebuilt AFTER listen.
- [x] **Tests.** `tests/guild_bank_log_view.test.ts` (20),
      `tests/guild_bank_log_wire.test.ts` (18),
      `tests/guild_bank_log_server.test.ts` (12, real GameServer),
      `tests/server/guild_bank_log.test.ts` (20), plus 16 new cases in
      `tests/guild_bank_window.test.ts`. Mutation-checked: removing the rank
      gate reddens 3 server tests, disabling the bust reddens the freshness
      test.

## Audit-trail hardening (2026-08-03, on `feature/guild-bank`)
Four commits. The first is the substantive one; the rest close what the
consolidation and the two reviewers flagged.

- [x] **Payer-side ledger column.** `bank_ledger` recorded `copper_delta` for the
      RECEIVING side only, so a guild-side replay was self-consistent BY CONSTRUCTION:
      it reconciled the book against rows derived from the book, and could never see
      value that crossed the purse/book boundary in one direction. Every dupe this
      cycle fixed moved value between a purse and a book, and NOT ONE was visible to
      `scripts/bank_audit.mjs`, so the audit could not detect the failure mode it
      exists to detect. Guild rows now carry `counterparty_copper_delta BIGINT` and
      `counterparty_count INT` (additive, nullable, no default), stamped by
      `runGuildBankOp` from the same server-derived before/after snapshot pair the
      book side comes from. See state.md for the full model.
- [x] **Loose end (a): the delete-window refusal reason.** An admin purge refused
      inside the guild-delete window answered `save_failed` (503), whose operator line
      says the change "was rolled back". Nothing was rolled back, because nothing was
      attempted. New reason `delete_in_flight` -> 409 with `error.guildBankDeleting`
      and its `ADMIN_ERROR_KEYS` matcher row.
- [x] **Loose end (b): the escrow counter vocabulary.** `escrow_save_failed` fired on
      RETRIED refusals, which are ordinary two-officer concurrency, so `> 0` alerting
      was noise. Split: `escrow_refused_retry` (per guild, watch the rate) for a
      refusal that will retry; `escrow_save_failed` only for a db throw or a TERMINAL
      refusal. `GUILD_BANK_INCIDENTS` is now nine kinds (also `counterparty_orphan`,
      `counterparty_unstamped`), pins updated.
- [x] **Loose end (c): admin_purge rides the conservation harness.** The server-level
      property harness generated player ops only. The book now seeds three
      transfer-locked copies with their birth-complete deposit rows, and a purge event
      runs the real admin entry point inside the P2, P3 and P4 sweeps, with a
      state-derived destruction term in the oracle. Measured over 3062 runs and 102123
      steps: 0 failures before, 0 after, 2616 purges actually removing a copy.
- [x] **PR review fix wave (FernandoX7 + Rubsey, five passes).** 0 blocking, one real bug
      class each in persistence, sanitization, accounting, operator safety, and two client
      arms. Each fix is test-first and the reasoning lives in state.md:
      - The merged-book write gate counted UTF-16 units against SQL gates that count UTF-8
        bytes, so a multi-byte book could land durable and then be skipped by the boot read
        forever (the quarantine that bound exists to prevent).
      - `sanitizeGuildBankState` took `instance` verbatim and an uncapped
        `craftedRecipeId`, breaking the one-sanitizer doctrine for the newest persisted
        container; both now take the shared load bounds.
      - The creation fee reached the database only through a fire-and-forget character
        save, so a fenced-out or lost save left a created guild with an untouched durable
        purse AND a create_fee row: a free guild booked as sold. The row is now written
        only after the save commits, with a `create_fee_unpaid` incident for the arm that
        cannot self-heal.
      - The purge carrier came off the session stamp; a refused escrow quarantines and
        DISCONNECTS the carrier, so a stale stamp could kick an ex-member for an
        operator's act. It is a fresh durable read now, failing closed, and the dashboard
        warns about the disconnect before the operator confirms.
      - The purge's durability witness compared item TOTALS, so a concurrent unrelated
        withdraw could make a reverted purge report success; it compares the specific copy.
      - The replay's canonical form distinguished an undefined-valued key from an absent
        one, which would have made a live payload compare unequal to its own durable clone
        and refused that session's escrow save forever.
      - The activity-log mirror re-armed only on the gate's null edge, so a refusal taken
        away from the banker survived the walk-up; and the guild log view disarmed only the
        guild deposit, leaving the personal one armed behind an off-screen grid.
      - Nits taken: dirty-mark bound, realm predicates on two statements, a self-tested and
        tightened `server/` import ban, a whole-gold assertion behind the createFee
        matcher, and the runbook/alerting lines in state.md.
      - NOT done (recorded in state.md with its trigger): the `guild_bank_replay.ts`
        extraction. It is a clean pure-leaf move but a whole-file churn that wants its own
        diff.
- [x] **Loose end (d): the admin dashboard control.** CLOSES deferral (b) recorded under
      Slice 3 (a PR-review should-fix: the branch shipped a superadmin purge, its audit
      row, and a full set of t()-keyed operator strings with no component rendering any of
      it, so the strings alone read as if it were done).
      - READ: `GET /admin/api/guilds/:id/bank`, both dispatch arms over one shared
        `guildBankStateOutcome`, permission `moderation.read` (deliberately wider than the
        superadmin-only purge it serves; the reasoning and the payload boundary are in
        state.md). It reuses the ungated `guildBankInfoForGuild` snapshot the purge already
        mutates through rather than inventing a second read, and
        `server/admin_guild_bank_view.ts` projects it: treasury, capacity, purchasedSlots,
        usedSlots, dormantSlots, and per slot `index` / `itemId` / `count` / `dormant`.
        The per-copy instance payload (another character's bind identity) is DROPPED at
        that boundary; nothing account-scoped rides the response.
      - UI: `GuildBankPanel` on the guild detail page beside the rename audit, plus
        `GuildBankPurgeDialog` and the pure `src/admin/guild_bank_purge.ts`. Stuck slots
        render visibly distinct and are never hidden; the removal is offered on a stuck
        slot alone and only to `guildbank.purge`; the confirm step shows slot / item /
        count, takes a reason at the server's 500-char bar, and needs an explicit tick.
        The `itemId` comes from the listing, never the keyboard, so the server's
        index-shift guard still means something. Each refusal renders as itself (not
        stuck or stale, no carrier, guild deleting, save rolled back, bank not loaded)
        through the ADMIN_ERROR_KEYS rows that already existed: no new operator prose, and
        no new matcher row, was needed.
      - Pins: route permission + payload shape + both arms
        (`tests/server/admin.test.ts`, `tests/admin.test.ts`, `tests/admin_routes.test.ts`),
        the surface-inventory row and the `adminIdParamDecode` ledger entry, the
        view/hatch agreement sweep (`tests/server/admin_guild_bank_view.test.ts`), and the
        component + pure-helper suites (`tests/admin/guild_bank_panel.test.ts`,
        `tests/admin/guild_bank_purge.test.ts`).
      - STILL DEFERRED from Slice 3: (a) mail delivery of the purged copy back to its
        depositor (the book keeps no depositor identity and the mail pipe refuses the same
        copy).

## Follow-ups (2026-08-03, branch `feature/guild-bank-followups` off `feature/guild-bank`)
Three independent slices, one commit each.

- [x] **Slice 1: guild-worded, direction-aware pipe refusals.** The quest refusal reused
      the PERSONAL bank's line (`error.bankQuestItem`, "in the bank"), which names the
      wrong bank in the guild pane, and every dimension was deposit-voiced even on the
      withdraw arm. `guildBankPipeRefusal(slot, dir)` now takes a direction defaulting
      to `'deposit'`: the refusal SET stays direction-independent (the `!== null` dormant
      predicate every reader shares is unchanged, pinned by a new test), only the wording
      moves. New sim_i18n rows `error.guildBankQuestItem` (deposit) and
      `error.guildBankWithdrawRefused` (all four dimensions on withdraw), each with its
      five non-Latin M16 fills. The `bags_window.ts` pre-empt moved to the new quest key
      in the SAME change, and the cross-pin in `tests/bags_guild_deposit_routing.test.ts`
      now also asserts the personal line is NOT the guild one. Closes the Phase 4 NOTE
      "withdraw-direction refusal copy is deposit-voiced".
- [x] **Slice 2: guild bank incident counters** (server-only, no schema change, no player
      text). Every failure mode on the dupe-sensitive paths reported only through
      `console.error` / `console.warn`, so it was invisible to production alerting. One
      closed-vocabulary counter through the existing `gameMetricsCounters` seam:
      `woc_guild_bank_incidents_total{kind}` over the then-fixed six
      `GUILD_BANK_INCIDENTS` (`escrow_save_failed`, `save_fenced_out`,
      `escrow_quarantined`, `reconcile`, `book_unloaded`, `ledger_write_failed`),
      pre-registered at zero like the ws drop causes. SUPERSEDED by the audit-trail
      hardening above, which split the retry arm out and added the two counterparty
      kinds: the set is now nine. Guild id stays in the log line and is NEVER a label (the
      bounded-cardinality contract).
      Each increment sits beside its existing loud log, and the escrow-save arm rethrows
      unchanged. Rebased onto the escrow root fix when the two lines merged:
      `escrow_save_failed` now also covers a REFUSED book half (`GuildBankEscrowRefused`,
      not only a thrown write), `escrow_quarantined` was ADDED for the terminal arm the
      refusal design introduced (a refusal that can never resolve abandons the session),
      and the reconcile counter moved to `revertOwnGuildBookOps`, the one reconcile site
      left after the evict-and-reload arm and the cross-session scan were deleted, where
      it counts only a guild whose unflushed log actually had work to undo.
      Emission sites: `server/game.ts` (the escrow save `catch`, the
      `saved === false` fence-out when books were carried, the quarantine in
      `handleGuildBankEscrowRefusal`, per-guild in `revertOwnGuildBookOps`, and every
      "left unloaded" arm of the boot load) plus `server/bank_ledger.ts`
      (`recordGuildBankDeltas`). Tests drive the real paths in
      `tests/guild_bank_persistence.test.ts` with a recording sink, with decisive
      negatives (a failed/fenced save carrying NO book books nothing) and a vacuity
      guard; the exposition shape is pinned in `tests/server/http/game_metrics.test.ts`.
- [x] **Slice 3: the admin escape hatch for a dormant slot.** REMEDIES the v1 limitation
      below: an item a later content change flags soulbound / noMarketList /
      transfer-locked was refused in both directions, so `guildBankHoldings` stayed
      non-zero forever and the guild could never disband, with no player action able to
      clear it.
      - Sim: `purgeDormantGuildBankSlot(ctx, guildId, slotIndex)` removes exactly one
        slot `guildBankPipeRefusal` refuses and returns the removed clone as evidence;
        an ordinary withdrawable copy, a bad index, and a missing book all refuse
        without mutating. Plus `guildBankInfoForGuild`, the ungated guild-id read,
        deliberately NOT downgraded to `publicInstanceView` (the projection would erase
        the very bind identity the evidence row needs); server-only, never IWorld.
      - Server: `GameServer.adminPurgeGuildBankSlot` runs the removal through
        `runGuildBankOp`, which was EXTENDED (not duplicated) to take
        `{ pid } | { guildId }` so the operator path shares the one observed mutation
        path: same `bank_ledger` row, same per-session unflushed delta the fence-out
        revert depends on, same fenced escrow save. A fence-out reverts a purge exactly
        like a withdraw (pinned end to end).
      - Ledger: new op `admin_purge` (declared in `GuildBankOpDelta`, `GuildBankLedgerOp`,
        and `BankLedgerRow['op']`, with the sim/server lockstep type pin already in
        place). It carries item id, count, and the REAL instance payload.
        `scripts/bank_audit.mjs` gained its four registrations (shape chain, guild-only
        predicate, item replay as a REMOVAL, excluded from the treasury replay) with a
        load-bearing control test proving the book stops reconciling without the arm.
      - Route: `POST /admin/api/guilds/:id/bank/purge-slot`, both dispatch arms (RouteDef
        + the legacy ladder, the dual-edit rule) over one shared outcome helper, behind
        the NEW permission `guildbank.purge` (its own permission, not `moderation.act`:
        it destroys player property, and it is kept out of the moderator and viewer
        bundles). Surface-inventory row added.
      - THE CARRIER CONSTRAINT (accepted, documented): books persist only inside a
        character's fenced escrow transaction (there is no standalone book write by
        design), so the purge rides a live session of the TARGET GUILD (officer-plus
        first, any member otherwise). With nobody from the guild online it refuses with
        `no_carrier` (409) rather than mutating a book it could not persist.
      - Deferred, recorded here: (a) MAIL DELIVERY of the purged copy back to its
        depositor: the book keeps no depositor identity and the mail pipe refuses the
        same copy, so v1 purges; (b) the ADMIN DASHBOARD control: a usable UI needs a
        guild-bank READ surface the admin API does not have (slot list with indices +
        dormant flags) plus a confirm flow, which is a second endpoint and a new panel,
        so the API + tests shipped and the UI is a follow-up. Until it lands an operator
        discovers slot indices out of band (SQL on `guild_banks`). The six operator error
        strings already carry their `ADMIN_ERROR_KEYS` matcher rows and English catalog
        entries so the UI follow-up is drop-in.
        DEFERRAL (b) IS NOW CLOSED: see "Loose end (d): the admin dashboard control"
        above. (a) still stands.

- [x] **Slice 3 review pass** (privacy-security-review CHANGES REQUESTED 0 BLOCKING /
      3 SHOULD-FIX / 8 NIT; architecture-reviewer 0 BLOCKING / 5 SHOULD-FIX / 6 NOTE).
      Everything BLOCKING/SHOULD-FIX was fixed in the same commit; the theme was that a
      property-destroying endpoint had WEAKER accountability than the cosmetic rename
      beside it.
      - ATTRIBUTION: the `admin_purge` ledger row now books the ACTING OPERATOR's
        account (`runGuildBankOp`'s operator arm takes `actorAccountId`), not the
        carrier's owner. Its character column stays the carrier, because the column is
        NOT NULL and an operator may hold no character; that mixed row is the signal.
      - AUDIT: a moderation REASON is now required and validated at the same
        `ADMIN_GUILD_REASON_MAX` bar as the rename, and `recordAdminGuildBankPurge`
        writes a `guild_moderation_actions` row (`action = 'guild_bank_purge'`, the
        operator, the reason, and what was removed) so a purge appears in the realm
        moderation history. That table gained an ADDITIVE `action TEXT NOT NULL DEFAULT
        'guild_rename'` column (the literal the history union used to hardcode), so
        every pre-existing row backfills correctly. A failed audit insert cannot
        un-remove the item, so it is reported as `audited: false`, never thrown.
      - DURABILITY: the endpoint no longer answers 200 optimistically. It AWAITS the
        fenced escrow save and confirms the removal survived (a fence-out reverts it),
        answering 503 `save_failed` otherwise; both the throw arm and the fence-out
        revert arm are pinned by test.
      - PERMISSION (the maintainer's design call): `guildbank.purge` moved into
        `SUPERADMIN_ONLY_PERMISSIONS`, so no dashboard-grantable role reaches it,
        `admin` included. Easy to relax; an item removed under a too-broad grant cannot
        be un-destroyed.
      - INDEX-SHIFT SAFETY (architecture SHOULD-FIX): the request must also name the
        `itemId` it expects at that index, and the sim refuses on a mismatch. A purge
        splices the slot out, so every higher index shifts down by one and an operator
        working from a stale listing could otherwise destroy the wrong dormant copy.
      - Fail-closed default on the refusal switch (a future reason 500s rather than
        falling through to the success return); the ladder arm's position AFTER the
        central permission gate is now source-pinned, as is the fact that both dispatch
        arms run the ONE shared helper; the whole-item-table dormant parity sweep now
        exercises BOTH direction arms; the evidence-clone test was made decisive
        (identity assertions, not just absence); the stale-membership-stamp carrier case
        is documented and pinned (the carrier is never charged, credited, or named).

## Pricing redesign (2026-08-03, user-directed)
- [x] `GUILD_CREATION_FEE_COPPER` 100_000 -> 10_000 (1 gold); pure constant change,
      reserve-at-gate machinery / refund arms / create_fee row untouched; every fee pin
      and the server_i18n sample updated.
- [x] The slot ladder is now 7 rungs (`GUILD_BANK_RUNG_SLOTS` / `GUILD_BANK_RUNG_PRICES`
      / `GUILD_BANK_LADDER_POSITIONS`): a new guild's bank is UNOPENED (0 item slots,
      treasury gold ops ungated); rung 0 (9g, PURSE-paid by the clicking officer) opens
      it for 24 slots; rungs 1..6 are the unchanged treasury expansions (192g50s to 60
      slots). `GUILD_BANK_BASE_SLOTS` and `GUILD_BANK_EXPANSION_PRICES` removed.
      Sanitize floors purchasedSlots to a valid ladder position.
- [x] Rung 0 gets its own `open_bank` ledger op (dispatch observer renames off the
      BEFORE snapshot; sim delta union + revert arm + `bank_audit.mjs` shape checks and
      treasury-replay exclusion). No new wire tokens and no GuildBankInfo field: the
      client derives the unopened pane from `purchasedSlots === 0`.
- [x] UI: `GuildBankViewModel` gained the 'unopened' kind (treasury as normal + the
      "Open the guild bank" row with purse-shortfall marker + payer note; confirm
      prompt); 5 new `hudChrome.bank.guildOpen*`/`guildPurseShort` keys with the five
      non-Latin M16 fills; the bank window refresh signature reads the purse only while
      unopened.
- [x] Tests: ladder/fee/capacity pins rewalked; new rung-0 purse charge/refusal,
      0-capacity deposit refusal, unopened holdings/disband, open_bank ledger + audit
      rows, sanitize-floor sweep, and the UI unopened state (view + window + enablement
      + purse-repaint).
- [x] Redesign QA fix pass (fresh reviewer, NOT READY -> fixed): the observer derives
      the rung via guildBankRungsBought (never a literal-zero compare, so a tampered
      below-base count still records open_bank); the open_bank revert undoes the grant
      ONLY at exactly the opened base (a cross-session expansion can no longer be
      stranded on a non-ladder position); three new decisive arms (cross-session
      open_bank revert, tampered-count observer naming, opened-pane purse-free
      negative with positive control); bank_audit gains bad_buy_position +
      multiple_open_bank checks and a lockstep pin tying its ladder literals to the
      sim tables; the two guild confirm prompts fold into one builder; state.md
      qualifies the old-row floor (pre-merge-only acceptability). Screenshots:
      docs/screenshots/guild-bank-tab gains the unopened pane (desktop + mobile),
      refreshed opened captures, and before-*-guild-open-default.png preserved from
      the pre-redesign captures.

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
- [x] Creation fee at `guild_create` dispatch (create-then-charge ordering, REVISED to
      reserve-at-gate by Phase 3 QA, see state.md) + refusal when poor; disband guard
      while bank non-empty; tests for both.

## Phase 4 deliverables
- [x] Guild tab in the bank window (renders only when `guildBankInfo` is present), view
      core registered in `UI_PURE_CORES`, painter/window per the hud contracts
      (`guild_bank_view.ts` + `guild_bank_window.ts` composed by `BankWindow`; cold
      bucket, no new registrations needed beyond `UI_DOM_MODULES`).
- [x] English i18n keys (treasury shown via the i18n `formatMoney` at the painter
      boundary); the one sanctioned overlay edit class applied: the five M16 non-Latin
      fills for the new wordy values (zh_CN/zh_TW/ja_JP/ko_KR/ru_RU).
- [x] Mobile pass + PR screenshots (desktop and mobile) under
      `docs/screenshots/guild-bank-tab/` (scripts/guild_bank_tab_shot.mjs).
- [x] View-core tests + window tests; no hud budget bucket changes (bank_window's
      scrollTop allowance unchanged at 4; the pane is a default cold window).

## Per-QA-phase checklist (each QA phase)
- [ ] Every deliverable and acceptance item verified; BLOCKING and SHOULD-FIX fixed.
- [ ] Tests decisive; no orphaned tests; no dead code; matrix suites green.

Phase 1 QA: both lines verified and closed on 2026-08-02 (see Notes).
Phase 4 QA: both lines verified and closed on 2026-08-03 (see Notes); this was the
packet-closing QA, so the whole-feature matrix below the Phase 4 QA note is the
final verification record.

## Notes
Phase 4 QA (2026-08-03), fresh auditor, verdict PASS-WITH-FOLLOWUPS (after fixes):
- Reviews dispatched fresh (COVERAGE not filtering): qa-checklist READY (0 BLOCKING,
  1 SHOULD-FIX, 6 NIT) and test-coverage-auditor (1 BLOCKING, 8 SHOULD-FIX, 5 NIT).
  The two frontend reviewers were not re-dispatched (they ran during implementation);
  instead their six applied fixes were spot-verified in the committed code: the
  refuse-and-keep gold prompt with inline live-region refusals, the plain-click
  identity guard, the shared bank_quantity_prompt builder, the whole-table
  dormant-predicate parity sweep, the mobile coin floor, and the no-magic guard
  describe. All present and correct.
- qa-checklist SHOULD-FIX fixed: render()'s blanket close-button refocus yanked a
  keyboard user off their guild control whenever ANOTHER officer's op repainted the
  signature. Focus now re-lands via the shared focus_restore key ladder
  (data-focus-key on tabs, grid cells, gold buttons, buy button; close fallback),
  driven by a jsdom test simulating an external signature change over a focused
  cell and tab. The first full-gate run caught the release-merged
  tests/focus_restore.test.ts single-reader guard (any src/ui module touching
  data-focus-key must import the helper): fixed architecturally by moving ALL key
  annotation into BankWindow.annotateGuildFocusKeys, keeping the pane
  focus-agnostic.
- test-coverage BLOCKING fixed: guildTabActive's live-info conjunct (the one-frame
  stale-mode fix from the Phase 4 reviews) had NO decisive assertion (the only test
  repainted first, so the tab reset masked a deleted conjunct). Pinned without the
  repaint; mutation-checked (conjunct removed, test fails, restored).
- test-coverage SHOULD-FIX fixed (all eight): deposit-disabled-at-cap arm; the
  affordable-arm buy-marker negative; the zero-submit silent-dismiss assertion; the
  live-region role/aria-live pins; the zero-headroom withdraw refusal arm
  (guildGoldCannotMove, purse at MAX_SAFE_INTEGER); the pre-empt deny lines
  cross-pinned to guildBankPipeRefusal's literal returns (key identity alone would
  pass a reworded row); a hostile unknown item id proving esc() guards the tooltip
  path; presence pins for the hud.mobile.css guild touch-floor rules (the generic
  bank scan matches .bank-*, never .gbank-). Plus two cheap NITs: the parity
  sweep's vacuity guard and the unknown-cell withdraw click.
- Cheap qa-checklist NITs taken: gold-prompt refusals land as a fresh child node so
  a repeated identical refusal re-announces to AT; renderInto receives the model
  BankWindow already built (one core call per paint); dead api() helper deleted
  from scripts/guild_bank_tab_shot.mjs; the two dash literals in the guard test
  switched to unicode escapes; the stale 'locale overlays untouched' matrix line
  corrected to name the sanctioned M16 fills.
- NITs recorded, not fixed (with reasons): the quest-deny wording deferral (a sim
  emit change, out of scope, follow-up), the withdraw-clamps/deposit-refuses
  asymmetry (documented BY DESIGN in the painter), the projected-lock dormant gap
  (documented, pinned), and no automated mobile-viewport regression gate (the
  committed mobile PNGs cover this release; follow-up).
- Carried-forward Phase 3 QA lines verified: NO guild book mutation outside
  src/sim/guild_bank.ts (grep over src/ server/ headless/: every server reference
  is read-only boot verification or fenced save serialization; Phase 4 touched no
  server path); the two-session fence-out dupe regression, the fail-closed disband
  guard, and the reserve-at-gate fee tests all pass UNMODIFIED (untouched by the
  Phase 4 diff; 252 tests green); the dormant-slot v1 limitation is called out for
  the PR body (below).
- Release merge: origin/release/v0.34.0 (17e5ba027) merged as fbf4d35a1. The
  release brought the pnpm migration (pnpm-lock.yaml, package-lock.json gone,
  pnpm install --frozen-lockfile), gate-perf phases, the dev_profiler_invulnerable
  dispatch token, the riftCollisionToken re-add, and the mount_select wire
  removal. Conflicts: COMMAND_NAMES (both appended; release token first, the five
  guild_bank_* tokens last), command-schema pins (now 179 send / 191 dispatch / 12
  dispatch-only), IWorld parity pins (283 members, 73 data, 210 methods), and the
  generated pending.ts (regenerated via npm run i18n:gen, never hand-merged). The
  release-merge-audit skill ran clean: no branch-owned surface was release-touched
  (social/db/bank/tab-strip/painter files untouched on the release side), no
  legacy-arm divergence, no stale injected bindings, and the release-authored
  partial db mocks (the trap class) all pass on the merged tree. Premise note:
  PR A (feature/guild-social-v1) had NOT landed on the release branch at merge
  time; the state.md 'rebase after PR A merges' line is superseded by this merge
  (re-merge the release branch if PR A lands before this PR does).
- Whole-feature matrix (qa-checklist.md), all PASS: see the matrix results block
  below.
- Validation: npx tsc --noEmit clean on the merged tree; the touched-suite matrix
  green (881 passed across the 13 core suites, 341 across the 9 UI suites);
  scripts/bank_audit.mjs exit 0 against the dev DB (48 guild ledger rows, 0
  findings); npm run gate green (the full pre-merge gate, post-merge tree).
- Teardown NOT performed: docs/guild-bank/ is retained until the user explicitly
  confirms deletion (the packet teardown question is the orchestrator's to ask).

Whole-feature matrix results (2026-08-03, post-merge tree):
- Three-host parity: PASS. tests/world_api_parity.test.ts + the full tests/parity
  trace green (185 passed); the offline Sim facet arm pinned inert and the
  ClientWorld payloads pinned in tests/guild_bank.test.ts.
- Determinism: PASS. tests/architecture.test.ts green; the zero-rng sweep over the
  whole op surface pinned in tests/guild_bank.test.ts.
- Server authority: PASS. Per-op negative tests for member rank, out of range, and
  dead in tests/guild_bank.test.ts; prices pinned to the sim table; dispatch pinned
  shape-only in tests/guild_stamp_fence.test.ts.
- Dupe safety: PASS. tests/guild_bank_persistence.test.ts + tests/guild_bank_db
  .test.ts green unmodified (escrow transaction, fence-miss rollback, crash
  shapes); scripts/bank_audit.mjs reconciled the dev DB ledger clean (exit 0).
- Economy: PASS. tests/bank_ledger*.test.ts + tests/bank_audit.test.ts green;
  treasury-cap refuse-never-truncate and copper conservation pinned.
- Persistence: PASS. Pre-feature saves load unchanged (no-row guilds get an empty
  book, pinned); unknown item ids survive load dormant (pinned in the view suite
  and the sanitizer suite).
- i18n: PASS. S3 guard (tests/localization_fixes.test.ts) green; every UI string an
  English catalog key with the five M16 non-Latin fills; formatMoney at the painter
  boundary; post-merge artifacts regenerated via npm run i18n:gen.
- UI/mobile: PASS. Tab matrix, dormant rendering, and every action round-trip
  pinned in tests/guild_bank_window.test.ts; 40px touch floors + 16px anti-zoom
  coin fields now presence-pinned; desktop + mobile screenshots committed under
  docs/screenshots/guild-bank-tab/.
- Performance: PASS. tests/bandwidth.test.ts green (proximity + rank gated,
  delta-guarded snapshot); the guild pane is a cold window (no per-frame work, no
  new budget registrations).
- Copy: PASS. Whole-feature diff scan found no em/en dashes or emojis (the two
  guard-test literals now unicode escapes).
- Gate: PASS. npm run gate green on the merged tree; screenshots exist and are
  referenced; the branch carries the release merge (see the merge note above).

Phase 4 (2026-08-02):
- The bank window family stayed COLD (event-driven rebuild + the slow-band
  refreshIfChanged signature), so the phase's stopping rule (painter-driven per-frame
  writes) never triggered: the Guild tab is a sibling pane inside the same cold window,
  behind the same ONE signature (guild arm appended, deliberately purse-free).
- The three carried-forward Phase 3 QA lines:
  - No new book mutation path: the UI calls ONLY the five guild_bank_* facet commands
    (pinned by the round-trip suite); no client code touches a book.
  - Dormant slots render visibly distinct and are never hidden (dimmed + dashed + lock
    mark + own aria + an always-visible legend line; the guild pane has NO filter layer
    so nothing can drop a slot). The projected-lock residue (a slot whose only refusal
    dimension was a per-copy transfer lock, stripped by publicInstanceView) is
    client-undetectable BY DESIGN and round-trips to the sim's localized refusal; pinned
    in tests/guild_bank_view.test.ts and recorded in the state.md ledger.
  - The transient disband/last-member-leave refusal (guild.bankNotEmpty while an
    emptying op is unflushed) needed NO client work: it rides the ordinary server error
    pipeline (server_i18n) and surfaces as-is; no special client error state was added.
- Screenshot capture is a bespoke online scene (scripts/guild_bank_tab_shot.mjs):
  the Guild tab exists only online, so the change-aware offline tooling cannot shoot it;
  the offline stage doubles as the offline/member-sees-only-Personal proof and the
  BEFORE side (captured at the Phase 3 base via the stash protocol).
- Phase 4 reviews (both dispatched fresh, COVERAGE not filtering):
  frontend-seam-reviewer 0 BLOCKING / 8 SHOULD-FIX / 9 NIT; cross-platform-sync
  APPROVE, 0 BLOCKING / 3 SHOULD-FIX. Every SHOULD-FIX was fixed in this pass:
  - Mobile: the gold prompt's coin fields gained the 40px/16px touch rule (the
    market coininput twin) and the Guild pane's fixed chrome gained max-height:480px
    margin carve-outs beside the existing grid-floor yield.
  - Distinct guild bags hints (guildDepositHint / guildCannotDeposit + M16 fills):
    the consequences differ from the personal pane (shared pool, dormant stranding).
  - Gold prompt semantics rebuilt to the sim's refuse-and-keep: an over-purse
    deposit refuses with the 'Not enough money.' line, an over-headroom deposit
    with error.guildBankTreasuryCap, both in an inline polite live-region line
    (never a silent clamp-down or dismiss); an all-zero submit cancels silently;
    the WITHDRAW side clamps to the on-screen treasury BY DESIGN (documented).
  - The stale-index identity guard now covers the PLAIN click too (another
    officer's op shifting the grid a tick before the click sends), not just the
    prompt submit; pinned in tests/guild_bank_window.test.ts.
  - Rule-of-three extraction: src/ui/bank_quantity_prompt.ts (UI_DOM_MODULES) is
    the ONE quantity-prompt builder behind the bank withdraw, guild withdraw, and
    bags deposit prompts (stale-resolve closures stay per caller).
  - The sim's guildBankPipeRefusal is now exported for the parity pin only:
    tests/guild_bank_view.test.ts sweeps the WHOLE merged item table asserting
    the client dormant predicate agrees with the sim gate, plus the lock arms.
  - tests/bags_guild_deposit_routing.test.ts (real BagsWindow, jsdom) pins WHICH
    facet command each guild-tab bag click dispatches and the exact tSim line
    each pipe deny voices; tests/guild_bank_window.test.ts gained the
    no-magic-values twin describe (hex/dash scans, token + focus-ring pins).
  - guildTabActive now also requires guildBankInfo non-null, closing the
    one-frame stale-mode window between the mirror nulling and the slow-band
    repaint; every guild prompt opener tears siblings down (dismissPrompts).
- Phase 4 NITs accepted with reasons (recorded, not fixed):
  - The bank tab strip omits panelId/aria-controls (the daily_rewards precedent):
    the panes mount directly on the window root because wrapping them would
    disturb the flex column the bank CSS sizes; tabs are still real WAI-ARIA.
  - The bags deny wording for a guild-tab quest item reuses the sim's personal
    line ('You cannot store quest items in the bank.'): a guild-worded variant
    is a sim_i18n change (new emit + row), out of Phase 4 scope; follow-up.
  - The capacity readout keeps the personal pane's idiom (a text div with a
    supplementary aria-label, no role), precedent-consistent.
  - The gbank-quantity-prompt / gbank-gold-prompt / gbank-buy-prompt marker
    classes carry no CSS on purpose: they are test/QA selectors distinguishing
    guild prompts from their personal twins inside the shared teardown classes.
  - Dormant and unknown cells share the dashed border deliberately (both are
    "needs attention" states); they differ by icon treatment, mark, label, and aria.
  - The projected-lock dormant gap is the documented state.md item, pinned by test.

Phase 3 QA (2026-08-02), fresh auditor, verdict PASS-WITH-FOLLOWUPS (after fixes):
- The three reviewer lenses the implementer had only self-reviewed (progress note
  below) were RE-DISPATCHED fresh, serially: privacy-security-review CHANGES
  REQUESTED (1 BLOCKING, 3 SHOULD-FIX, 8 NOTE), database-performance-reviewer
  CHANGES REQUESTED (1 BLOCKING, 6 SHOULD-FIX, 6 NOTE), architecture-reviewer
  CHANGES REQUESTED (0 BLOCKING, 5 SHOULD-FIX, 8 NOTE). Every BLOCKING and every
  cheap SHOULD-FIX was fixed in this pass (four fix commits); the scale-dependent
  SHOULD-FIX remainders are recorded as deferrals with escalation triggers in
  state.md. All five 328d31ffa migration-safety fixes were confirmed in the
  committed code; the one missing decisive test (onGuildDisbanded clearing every
  session's dirty mark) was added.
- Security BLOCKING fixed: the fence-out reconcile's skip arm (another session
  dirty) left a deterministic two-account dupe (alt parks a dirty mark, main
  deposits, main self-takeover fences out, alt's save persists the orphaned book
  half). Sessions now log their unflushed deltas and the reconcile surgically
  REVERTS the dead session's ops (Sim.revertGuildBankDeltas); two-session
  regression pinned. The accepted-risk record in state.md was narrowed to the
  genuinely crash-windowed arm.
- Security SHOULD-FIX fixed: the fee moved to RESERVE-AT-GATE (charged
  synchronously at dispatch, refunded on every refusal arm, guildCreate returns
  the committed-success boolean), closing the pipelined-spend and logout fee
  dodges; the locked state.md decision was revised with the new rationale. A
  short gate charge refuses and refunds (no free guild for a meta-only pid).
- Database BLOCKING fixed: saveCharacter serialized the character BEFORE the
  serial-writer wait and the book INSIDE it, so an op dispatched during the wait
  committed two instants (deposit in both halves, withdraw in neither); both
  halves now snapshot in one synchronous step inside the queued thunk, pinned by
  a writer-held-busy regression.
- Database SHOULD-FIX fixed: per-session guild-bank op token bucket
  (server/guild_bank_op_guard.ts; every allowed op is a keep-forever ledger row),
  the unflushed-op log cap with evict-and-reload fallback, reconcile read retries,
  keyset-batched boot read with single octet_length evaluation on the heavy
  allowance, ascending-guild-id upsert order, writer queue-depth warn, soft
  row-size watch, audit-script statement timeout + bank-slice-only character read.
- Architecture SHOULD-FIX fixed: the guild ledger differ and the revert path are
  provenance-exact (craftedRecipeId as a third key dimension; deposit-undo
  matches it; withdraw-undo grants through addStacked so stack caps hold) and
  instance equality is canonical sorted-key JSON (JSONB round trips reorder
  keys). Sim/server op vocabularies pinned in lockstep; stale create-then-charge
  narration corrected everywhere; src/sim/CLAUDE.md module row updated.
- My own atomicity lens (beyond the reviewers): exactly ONE guild_banks write
  statement exists, fenced at both call sites; the empty-bank disband guard
  proved LIVE state while the cascade destroys DURABLE state, so the transport
  holdings read now fails closed while ANY session (including mid-leave, via
  sessionsByCharacterId) holds an unflushed mark; an exhausted leave flush
  reconciles its unflushable books; both fixes pinned.
- Deferred (state.md records each with its trigger): per-guild autosave
  serializer, audit pagination, ledger index calculus, metrics counters, the
  holdings scan refcount, the dormant-slot admin escape hatch (v1 limitation:
  a pipe-refused slot blocks disband forever), the reconcile-window silence.
- Validation: tsc clean; the 15-suite matrix 471 passed / 3 skipped; npm run
  build:server green; npm run ci:changed exit 0; scripts/bank_audit.mjs exit 0
  against the dev DB.

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
