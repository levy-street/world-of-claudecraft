# Loot quality validation, 14 September 2026

Local implementation on `feature/exceptional-loot`, based on
`origin/release/v0.43.0` at `bdc447891de9dae38d17385aed45143d779ed1ba`.
Worktree: `wt-exceptional-loot`. This records the initial local validation before
PR publication. The mechanic contract is in [loot-quality.md](loot-quality.md).

## Automated evidence

| Check | Outcome |
| --- | --- |
| `npx vitest run tests/loot_quality*.test.ts tests/inventory_receipt.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts tests/localization_fixes.test.ts tests/css_corpus.test.ts --maxWorkers=3` | 15 files, 650 passed, 3 skipped |
| Initial broader run including `tests/parity` | 898 passed, 4 skipped; 11 expected trace changes plus a subsequently fixed Exchange monolith ceiling failure |
| `UPDATE_PARITY=1 npx vitest run tests/parity/parity_e.test.ts tests/parity/parity_g.test.ts --maxWorkers=2` | 126 passed; only the 11 reviewed loot-related goldens changed |
| Normal replay of the 11 changed scenarios, without `UPDATE_PARITY` | 22 passed; remaining 104 cases excluded by the scenario-name filter |
| `npm run test:browser` | 411 passed; one existing mail-focus case timed out under concurrent validation |
| `npx vitest run --config vitest.browser.config.ts tests/browser/stale_focus_space.browser.test.ts` | Isolated rerun: all 11 passed |
| `npx turbo run check:types build:env build:server build:bot build:bundle --ui=stream` | All 7 tasks passed, including client/server/headless/bot builds and typechecks |
| `npx turbo run check:types build:bundle --ui=stream` after the receipt fix | All 4 tasks passed |
| `npm run check:ts` | Passed |
| `npm run security:gate` | Passed, zero high-severity findings after repository priors |
| Biome over all actual changed TypeScript/CSS source and test files | 73 files checked, zero errors; existing-style warnings remain |
| `git diff --check` | Passed |

Additional worker-run regressions covered existing loot/master/held-award paths,
FFA/autoloot/reconciliation, Rift Forge and Exchange windows, and prior tooltip
behavior. Their focused tests passed. The final coordinator pass includes all
new feature suites, rather than relying solely on worker reports.

`npm run ci:changed` exited successfully but checked zero files because this is an
uncommitted branch. The explicit changed-file Biome invocation above closes that
local coverage gap.

`node scripts/gate_select.mjs` generated i18n/wiki/SFX successfully, then stopped
at `i18n freshness`: its `git diff --exit-code` requires the regenerated artifacts
to be staged or committed. They were unstaged during that run. The
canonical gate did not pass; the separately executed checks above do
not imply full CI or merge readiness. The full repository test suite was not run.

Publication follow-up, 15 September 2026: the fetched `release/v0.43.0` base was
unchanged. After committing, `npm run ci:changed` checked 73 files with zero errors
and 106 warnings. `npm run i18n:gen` followed by `git diff --exit-code` over its
generated catalog and resolved bundles passed, resolving the earlier freshness
blocker. `pnpm audit --json` exited zero under the repository's advisory policy
(metadata includes two moderate and one high muted vulnerabilities). The user
requested PR publication; broader gate completion remains deferred under the
feature-delivery workflow.

## Reviewed behavior

Independent reviews checked scaling/combat, deterministic simulation, storage
bounds, custody/security, host parity, UI and test coverage. Confirmed findings
were fixed and re-reviewed: physical stamina rounding, actual Spell Power test
coverage, malformed descriptors, real Rift reward producers, enhanced auto-equip,
Forge item levels, equipment badge layout, marketplace decision labels and
receipt links.

The descriptor's compact JSON is at most 59 bytes. It adds 74 bytes to an existing
nonempty instance payload or 87 bytes when a plain inventory slot gains its first
instance. A synthetic 1,100-slot inventory/bank test confirms linear growth. No
SQL, pool, transaction or autosave cadence changes were introduced.

Golden changes were reviewed individually. Party/master messages change only
event identity digests. Rift quality rolls and eligible boss drops add shared-RNG
draws after ordinary item selection; later material counts and combat outcomes
can therefore differ for the same seed. No scenario or trace harness was changed.

## Visual verification

Captured the running offline game in Chromium at 1440×900 desktop and 844×390
mobile landscape. Reviewed Ordinary, Magnificent and Transcendent tooltips,
equipment badges and Rift Forge rows. Portrait play already requires rotating
the device; this verifies the supported landscape layout, not native Safari.
The Forge list scrolls at the smaller viewport.

- [Desktop Magnificent tooltip and exact receipt links](../screenshots/exceptional-loot/desktop-magnificent.png)
- [Desktop equipped quality badge](../screenshots/exceptional-loot/desktop-equipment.png)
- [Desktop Rift Forge](../screenshots/exceptional-loot/desktop-forge.png)
- [Mobile Magnificent tooltip](../screenshots/exceptional-loot/mobile-magnificent.png)
- [Mobile equipped quality badge](../screenshots/exceptional-loot/mobile-equipment.png)
- [Mobile Rift Forge](../screenshots/exceptional-loot/mobile-forge.png)
- [Mobile Transcendent upgrade, scrolled into view](../screenshots/exceptional-loot/mobile-forge-transcendent.png)

## Release considerations

- Older Rift sanitizers discard the new descriptor. Use forward-only rollout
  after minting begins, or backport preservation before permitting old writers.
- Direct trade keeps its existing item-id/count staging policy. Players inspect
  the authoritative selected copies, and confirmation pins them; this feature
  does not introduce a new exact-copy selection command for direct trade.
- Fixed class wand bolts keep their existing class profile. Quality scales the
  equipped mainhand item and its affixes, rather than changing that separate
  innate attack.
- Maximum quality raises a fully upgraded S band to item level 42. Catalogue
  budgets and upgrade monotonicity are tested; broad raid/PvP balance tuning is
  separate from those arithmetic guarantees.
