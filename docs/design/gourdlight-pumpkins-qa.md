# Haunted Pumpkins QA

Scope: `feature/haunted-pumpkins`, isolated worktree based on
`feature/halloween-event` at `c0b9a2805d`. Submitted as a draft PR against that
Halloween branch, dependent on upstream PR #4532.

## Passed

- `npm run i18n:gen` and `npm run wiki:content`: generated the new English keys
  and content successfully. Locale completion remains the release maintainer's
  existing workflow.
- `npm run ci:changed`: passed, with existing warnings (3645 files against the
  release base). A direct Biome check also covered the task's untracked modules.
- `npm run check:types`: game, Svelte admin and bot checks passed. A final
  `npx tsc --noEmit` after the calendar-save extraction also passed.
- `npm run build`: client production build passed.
- `pnpm exec turbo run build:env build:server build:bot --ui=stream`: passed.
- `npm run security:gate`: passed, 14133 files and zero high findings after priors.
- `npx vitest run tests/haunted_pumpkins.test.ts tests/haunted_pumpkin_render.test.ts
  tests/haunted_pumpkin_view.test.ts tests/haunted_pumpkin_tracker.test.ts
  tests/seasonal_pumpkin_wire.test.ts --maxWorkers=1 --reporter=verbose
  --testTimeout=120000`: 25 passed.
- `npx vitest run tests/architecture.test.ts tests/monolith_budget.test.ts
  tests/world_api_parity.test.ts tests/command_facets.test.ts
  tests/deeds_content.test.ts tests/reliquary_content.test.ts
  tests/localization_fixes.test.ts --maxWorkers=1 --testTimeout=120000`:
  875 passed, three skipped. The longer command-line deadline accommodates this
  Windows worktree's source-scan I/O; repository test configuration is unchanged.
- Existing Halloween suites `tests/gourdlight_eve.test.ts` and
  `tests/gourdlight_scarecrow.test.ts`: 35 passed during implementation.
- `git diff --check`: passed.
- `node scripts/haunted_pumpkin_shot.mjs`: real screen picking, discovery,
  currency and progress verified in desktop and touch captures, no page errors.
  See [visual evidence](../screenshots/haunted-pumpkins/README.md).

Read-only reviews covered database performance (before and after implementation),
cross-platform parity, security and frontend/render. No confirmed feature blocker
was reported. The calendar-save extraction preserves prior field order and sparse
defaults. The discovery ledger is bounded and adds no database query per click.

## Global checks not green

- `npm run gate` was rerun after staging the regenerated artifacts for the
  authorized PR. The i18n freshness check now passes. The full gate is not
  claimed green; the outstanding full-suite failures below still block merge.
- The broad `npx vitest run --maxWorkers=2` attempt was stopped after failures
  across existing content pins, harness checks and timing-sensitive suites. It
  is not a successful full-suite run. Examples include the inherited corpse
  harvest template count and self-wire profiler bucket count.
- The maximal character-blob fixture needs further historical-ledger maintenance
  inherited from the Halloween/release integration. Pumpkin Hunter's contribution
  is explicitly isolated as 35 bytes; the scarecrow phase contributes 102 bytes.
  Receipt-envelope exact anchors include both, without changing any size ceiling.
  A final two-case run passed the receipt envelope (266934 total bytes, 258650
  baseline, unchanged 8284-byte receipt contribution), but the historical
  counterfactual still measures 250082 against its old 246084 pin after removing
  both seasonal contributions. This remaining 3998-byte drift has not been
  hidden by widening limits. Exact diagnostic command:
  `npx vitest run tests/professions_blob_growth.test.ts -t
  "conservative.full.gear|fixed.point.with.every.container" --maxWorkers=1
  --reporter=verbose --testTimeout=120000` (one passed, one failed, ten skipped).
- `npm run test:browser` was stopped after Vite dependency optimization reloaded
  its runner. The general browser regression suite is not verified. The feature's
  separate real-browser desktop/touch pickup captures did complete.
- A separate preset-4 night capture passed real picking and discovery with no
  page errors. Full live-server reconnect testing remains a release check.
  Unit tests cover both material tiers, saved state,
  owner-only snapshots, reconnect reset, explicit clears and no replayed ignition.

Verdict: implementation and focused checks complete; NOT READY for merge until
the global gate and remaining release checks are green.
