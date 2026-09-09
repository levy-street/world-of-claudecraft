# Mount skins contribution evidence

Local implementation reviewed on 2026-09-08 by Astra, without implementation or review subagents as requested. This receipt is feature evidence, not release sign-off.

Game base: release/v0.42.0 at `723752ea5c26ad23558f6807ce014fb2999b8bc6`.
Branch: `feature/mount-skins-v042-complete`.
Companion economy base: master at `11c0341be9b3926e3765809b70a15c2ed55ca470`.
Branch: `feature/mount-skins-v042`.
Both contributions were prepared in isolated task worktrees; publication was authorized on 2026-09-08. PR3859 supplied the earlier Cosmetics window and first three skins; this integrates that work with the release and converts the rocket sled and race car too.

## Screenshots and browser smoke

| Evidence | Capture |
|---|---|
| Release character UI before this change | [Desktop](before-character-desktop.png), [landscape](before-character-landscape.png) |
| Cosmetics with all five skins | [Desktop](desktop.png), [mobile landscape](landscape.png) |
| Existing portrait rotation requirement | [Portrait](portrait.png) |
| Five shop products after purchasing | [Store](shop.png) |
| Mounted mechanical chicken | [Cluckwork Mech Bird](ride-mech_bird.png) |
| Mounted turtle | [Tolliver the Chimeglass](ride-chimeglass_tortoise.png) |
| Mounted bone cart, with puller loaded | [Bonebound Rickshaw](ride-rickshaw_mount.png) |
| Mounted goblin spaceship | [Goblin Rocket Sled](ride-goblin_rocket_sled.png) |
| Mounted race car | [Rallycart RXT](ride-rallycart_rxt.png) |

Captures use the actual offline game in desktop Chromium with software rendering. The GPU notice visible in the shop capture describes that test environment. Mobile landscape uses an 844x390 viewport and the existing mobile-touch CSS. Portrait remains unsupported by the game and displays the existing rotation overlay. Physical phones and controllers were not tested.

The browser smoke wore all five skins, summoned an earned Valorsteed, and checked that each actual renderer mount rig became ready; Rickshaw also required its puller rig. It then bought all five products through the store confirmation dialog using a mock economy adapter and verified the Owned state. This capture preceded the uniform 2000-Claudium pricing decision; all cards show Owned, with no price displayed. No page errors occurred. No real currency was spent and no production service was called.

## Validation

| Command | Result |
|---|---|
| `xargs npx vitest run --maxWorkers=2 < docs/screenshots/cosmetics-window/regression-tests.txt` | 78 files passed, 1 skipped; 2566 tests passed, 5 skipped. Covers changed unit/server surfaces, mount presentation/audio, ownership, save/reconnect, remote snapshots, legacy items and store behavior. |
| `npx vitest run tests/account_mount_cosmetics_pg_integration.test.ts --maxWorkers=2` with `TEST_DATABASE_URL` set to disposable local Postgres | Passed real schema setup, concurrent additive grants, older account JSON replacement, weapon-state preservation and account deletion cascade. The test creates and drops its own database. |
| `npm run test:browser -- tests/browser/a11y.browser.test.ts tests/browser/storage_purchase_surfaces.browser.test.ts` | 49 passed. |
| `npm run test:browser -- tests/browser/cosmetics.browser.test.ts` | 4 passed: all three tabs have named dialogs and no serious axe violations; all five skins support Wear/Take off in short landscape. |
| `npx vitest run tests/monolith_budget.test.ts tests/architecture.test.ts tests/i18n_completeness.test.ts --maxWorkers=2` | Passed as part of the final 11-file, 217-test focused run. |
| `npx tsc --noEmit` | Passed. |
| `node_modules/.bin/turbo run check:types build:env build:server build:bot build:bundle --ui=stream` | Passed; includes admin/bot checks and client/server builds. |
| `npm run security:gate` | Passed: no high-severity findings after configured priors. |
| Explicit Biome check/write over changed source files; `git diff --check`; `bash .claude/hooks/qa-stop.sh < /dev/null` | Passed. Biome retains inherited warnings; `npm run ci:changed` checked zero files because the branch has no committed diff, so it is not counted as formatter evidence. |
| `npm run i18n:gen` and `npm run wiki:content` | Regenerated through canonical scripts. A second generation left the generated i18n/wiki hashes unchanged. |
| Economy price follow-up: `npm --prefix service run build`, then `node --test service/dist/service/test/claudium_catalog_season1.test.js` (economy root) | Passed build and all 4 catalogue tests after changing all five prices to 2000 Claudium. |
| Economy service: `npm test` | Builds first; 669 tests passed, 13 database-dependent tests skipped, zero failures. Includes exact five-SKU and unchanged existing-product price pins. |

## Remaining merge and rollout checks

`GATE_SELECT_BASE=origin/release/v0.42.0 GATE_WORKER_TIER=low node scripts/gate_select.mjs` initially stopped at unstaged i18n freshness. After publication authorization and staging, the retry passed generated i18n/wiki/media/SFX freshness, malware scanning, formatting and SFX conformance, and reached the broad related-test leg. That broad run was stopped for draft publication under the requested feature-delivery workflow; the focused evidence above remains the completed test result. Full selective/release, physical-device, live multi-client and production purchase checks remain outstanding. Current verdict: **NOT READY for merge/deployment**; published for feature review.

Dependency audit before publication: `npm audit` cannot consume the game pnpm lockfile; `pnpm audit --json` passed with zero unignored advisories and the existing three configured exceptions (two moderate, one high). Economy `npm audit --json` reports the inherited 11 advisories listed below. No dependency or exception configuration changed.

Pricing decision, 2026-09-08: Reuben selected a USD 20 target for every mount skin. All five now cost 2000 Claudium at the service peg of 100 Claudium per USD. The standard USD 19.99 pack grants 2200 Claudium; existing pack bonuses and rail discounts affect effective cash cost. Companion `service/docs/MOUNT_SKINS.md` records catalogue activation and rollback. Deploy compatible game server/client before enabling the five economy rows. No deployment or production ledger inspection was performed. Economy dependencies were unchanged; its install reported 11 inherited audit advisories (3 moderate, 8 high), outside this feature cleanup.

## Release synchronization for PR3941 (2026-09-08)

Merged release `553a5672ed1d914cbb67d2b450a1777a835447eb` into the feature
parent `77954b803b079c03fd7a443fb60a7cf3bd1ccf58`. The two conflicted files
were generated localization pending rows and monolith budgets. Localization was
regenerated with `npm run i18n:gen`; budgets now reflect the measured combined
HUD and entry-point extractions, below both parent ceilings.

Audited the automatic merges in the keyboard/controller collection routing,
mobile Meters entry, HUD practice coach dependencies, simulation spawn setup,
and architecture/localization registries. Both features remain wired. The core
Cosmetics painters/window and optimistic weapon-skin module are byte-identical
to PR3859; the extracted side-button table additionally preserves newer release
entries. All production modules introduced by PR3859 are present. The three
original skins remain in the five-skin catalogue, with paid ownership and the
per-character wear path covered by the existing feature tests.

Validation on the combined tree: 22 files passed, 1071 tests passed and 7 skipped.
Command: `npx vitest run tests/monolith_budget.test.ts tests/architecture.test.ts tests/language_fanout_registry.test.ts tests/localization_fixes.test.ts tests/collection_actions_core.test.ts tests/cosmetics_view.test.ts tests/cosmetics_window.test.ts tests/mount_skins.test.ts tests/game_sessions.test.ts tests/snapshots.test.ts tests/hud_perf_budget.test.ts tests/hub_dummy_drill.test.ts tests/hub_healing_drill.test.ts tests/hub_healing_lesson.test.ts tests/hub_lesson_controller.test.ts tests/hub_lesson_view.test.ts tests/practice_dps_controller.test.ts tests/practice_dps_view.test.ts tests/hub_training_dummy.test.ts tests/hub_healing_dummy.test.ts tests/client_shell.test.ts tests/mobile_controls.test.ts --maxWorkers=2`.

`node_modules/.bin/turbo run check:types build:server build:bundle --ui=stream`
passed all five tasks, including client/server builds and admin/bot typechecks.
`pnpm audit --json` again reported zero unignored advisories, retaining the same
three existing exceptions. Full release/CI and live-device acceptance remain
outstanding; this synchronization is not merge or deployment approval.


## PR3941 review fixes (2026-09-08)

Both P2 findings in review 5140870713 are addressed. Cosmetics now captures and
restores stable card-action focus through the shared helpers when its HTML is
rebuilt. Wear/Take off and live ownership refresh keep the same card focused;
a removed or disabled control falls back to the selected tab. Close/tab focus,
external focus and parked dialog focus are also covered. Mobile tabs now measure
at least 40px high; their strip can grow around that minimum.

[Keyboard focus after Wear](review-keyboard-focus.png) and
[844x390 mobile tabs](review-mobile-tabs.png) were captured from the real painter
and shipped styles in Chromium. These supersede the earlier captures for those
two details; they do not claim physical-device acceptance. The earlier statement
that the core painters match PR3859 describes the pre-review checkpoint.

Focused validation:

- `npx vitest run tests/cosmetics_window.test.ts tests/cosmetics_view.test.ts tests/focus_restore.test.ts tests/professions_rail_tiles.test.ts tests/collection_actions_core.test.ts tests/architecture.test.ts tests/focus_visible_guard.test.ts tests/mobile_window_layout.test.ts --maxWorkers=2`: 216 passed across eight files.
- `npm run test:browser -- tests/browser/cosmetics.browser.test.ts`: five passed, including real Enter/Space activation, refresh focus, axe and measured mobile tab/action targets. New focus and tab-height regressions failed before their fixes.
- `npx vitest run tests/bag_filter.test.ts tests/material_taxonomy.test.ts tests/item_copy_refusal.test.ts tests/release_v039_icon_art.test.ts tests/pad_reel.test.ts tests/guide.test.ts tests/ci_shard_partition.test.ts tests/item_art_audit_builder.test.ts tests/eastbrook_polish_capture_contract.test.ts tests/eastbrook_polish_artifact_integrity.test.ts --maxWorkers=2`: eight files passed initially; the two remaining metadata/provenance suites passed after corrections using individual reruns. Final union: 299 tests across ten files, all passed.
- `node_modules/.bin/turbo run check:types build:bundle --ui=stream`: all four tasks passed, including admin/bot typechecks and client bundle. Turbo reported a disk-space warning after task completion; no task failed.
- `npm run ci:changed`: passed with existing warnings; explicit Biome checks over every additionally edited source/test file and `git diff --check` also passed.
- `pnpm audit --json`: zero unignored advisories, retaining the existing two moderate and one high exceptions. Dependencies and audit exceptions are unchanged.

CI34217836954 on the prior head found feature-related stale references. This
follow-up updates the rail/controller assertions for the shared dispatcher,
documents Shift+Y in the controls guide, pins the five retired reins as inert
non-material items, and uses a vendor-eligible item in the copy-refusal fixture.
The live hotbar art count is 97 after retiring five reins; historical art totals
remain unchanged. The removed mount-grant test leaves the measured shard table;
its replacement uses the existing duration heuristic until measured.

`node scripts/item_art_audit.mjs --verify-only` supplied the new catalogue hash
and byte count. `node scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs`
updated runtime-input provenance for the renderer prewarm change and supplied the
composite, metadata and performance digest pins. All fingerprinted inputs matched
HEAD at mint time. This is a source-only reseal: historical capture pixels, scores,
GLBs and the frozen capture identity did not change.

Full CI must rerun on the pushed fixes. This receipt does not claim a green full
Gate or release/deployment approval.
