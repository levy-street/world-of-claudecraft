# Guild Bank: progress

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: foundation | Not started | | |
| Phase 1 QA | Not started | | |
| Phase 2: ops and wire | Not started | | |
| Phase 2 QA | Not started | | |
| Phase 3: persistence | Not started | | |
| Phase 3 QA | Not started | | |
| Phase 4: UI | Not started | | |
| Phase 4 QA (final, offers teardown) | Not started | | |

## Phase 1 deliverables
- [ ] `src/sim/guild_bank.ts`: state type, constants (from state.md), capacity, sanitize,
      empty-state factory; unit tests including clamp and never-destroy-items cases.
- [ ] Session-only guild membership stamp on `PlayerMeta` + server-callable stamp entry
      point; parity-trace exclusion; tests.
- [ ] `SimContext` view exposing the books (append-only extension); sim holds the
      per-guild map.
- [ ] `src/world_api/guild_bank.ts` facet + barrel aggregation + `Sim` offline no-ops +
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

## Notes
(fill in per phase)
