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
One golden delta reads like a behavior change and is not: `heroic_five_man_clear`'s
`wyrmfall_core` count moving from 1 to 2 is stream re-seating (that count is itself
an rng draw, and the scenario went from 62 to 63 draws), not the personal-loot
`count` change in `interaction.ts` landing (every `personalFor` producer is still
`count: 1`, so that change is a no-op today).

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

## Base merge and gate, 21 September 2026

`release/v0.43.0` shipped on 17 September, so the branch was merged onto
`origin/release/v0.44.0` (`chore(merge): sync release/v0.44.0 into
feature/exceptional-loot`) and the PR retargeted there. Ten conflicts, all
known classes: the loot drop site composes the release's kill-time
bind-on-pickup trade-eligibility snapshot with the quality roll; the Rift band
rebuild composes the release's ring-enchant marker with the quality descriptor
(`sanitizeRiftGearInstance` carries both); the `sim.ts` and `server/game.ts`
monolith ceilings re-pin to the exact merged counts; `pending.ts` regenerated
rather than hand-merged; five parity goldens re-minted, the four this branch
already owned plus the release's new `bop_party_trade_eligibility` scenario,
whose diff is one extra draw per eligible kill and its digests.

The first CI run (14 September, against `release/v0.43.0`) failed nine tests in
eight files, every one a source pin the extractions had moved out from under,
plus the M16 English-leak guard. The fix round follows the code rather than
loosening pins: the hud loot arm is exactly `if (!ev.callerLogs) this.log(`
again with the string-or-nodes receipt decision in
`src/ui/loot_quality_receipt.ts` (`lootQualityReceiptBody`) and `log()`
accepting a node body; the tooltip column-order pin reads
`item_combat_tooltip_view.ts`; the equipped-instance wire pin reads
`server/equipped_instance_wire.ts` (seven fields); the market and paperdoll
aria pins read the resolved parts name; the masterwrought cap test drives
`maybeAutoEquip` through `src/sim/auto_equip.ts`; the duplicate-block resolver
allowlists the loot-roll controller's `itemTooltip` rig chain. `hud.ts` re-pins
at 18279, ten lines under the release ceiling. The six wordy
`hudChrome.lootQuality.*` values gained ja_JP, ko_KR, ru_RU, zh_CN and zh_TW
fills. `lootQualityWeapon` now consults the tier before the item level so an
ordinary weapon costs nothing extra on `recalcPlayerStats`.

Read-only review fan-out on the merged tree (the qa-checklist gate plus the
sim architecture, cross-platform parity, persisted-state, server-authority,
test-coverage and frontend-seam reviewers): no blocking findings. Confirmed by
direct reading: every draw is `ctx.rng` after ordinary selection and nothing
re-rolls on pickup, award, transfer or load; the descriptor rides every wire
channel generically (self snapshot, equipment mirror, bank, guild bank and
mail through `publicInstanceView`, inspect through `equippedInstanceWire`,
SimEvents fanned out whole), so no `IWorld` facet changed; one validator on
the single shared load sanitizer covers every persisted container; no client
command supplies a descriptor. Rollback consequence, confirmed against the
release binary: an older Rift sanitizer strips a band's quality on its first
load or save, while ordinary items keep the descriptor unvalidated.

Selective gate on `c596051403` (`node scripts/gate_select.mjs`, base
`origin/release/v0.44.0`, 136 changed paths): artifact regen and freshness,
malware scan and changed-files Biome passed; the related test step ran 3296
files and 53127 tests green, with one whole-tree importer scan
(`tests/professions_admin_restore.test.ts`) timing out at the 20 s budget under
a load average of 30 and passing standalone, alongside
`tests/ci_workflow.test.ts`, with `--testTimeout=240000`. The remaining gate
steps ran individually on the same tree: `npm run test:browser` 49 files and
416 tests passed; `turbo run check:types build:env build:server build:bot
build:bundle` 7 of 7 tasks passed.
