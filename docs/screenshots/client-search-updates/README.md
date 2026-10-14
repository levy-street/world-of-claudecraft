# Client update recovery

The incompatible client/server screen now offers Search for updates alongside
Return to Login. Browser clients fetch a fresh entry document while preserving
URL parameters. Website desktop clients check their own update track, download,
then offer an explicit Restart now. Native clients retry the installed OTA
pipeline, with store fallback when needed. Other terminal errors retain their
single login action.

The terminal screen names its dialog, focuses recovery, traps Tab, shields button
keys from game input, and keeps focus inside while a search is pending. Failed,
unavailable, and empty searches report distinct localized results and allow retry.
Native requests that time out cannot start a late staged-bundle switch.

## Screenshots

These controlled Chrome fixtures import the production controller and stylesheet.
The before fixtures reproduce the previous screen markup. The update result is
stubbed to exercise the recovery controls without downloading a real update.

| Viewport | Before | After |
|---|---|---|
| Desktop, 1440 x 900 | [Before](desktop-before.png) | [After](desktop-after.png) |
| Phone portrait, 390 x 844 | [Before](portrait-before.png) | [After](portrait-after.png) |
| Phone landscape, 844 x 390 | [Before](landscape-before.png) | [After](landscape-after.png) |

All three viewports passed button bounds and the 40px touch-height floor, initial
recovery focus, Tab cycling/wrapping, and native Space activation.

## Verification

Base: `origin/release/v0.45.0`. Work is on
`codex/client-search-updates` in a separate managed worktree.

- `npm run i18n:gen`: passed; the five required non-Latin translations are filled.
- `npx vitest run tests/client_update_search.test.ts tests/fatal_overlay_controller.test.ts tests/electron_updater_track.test.ts tests/ota_update_gate.test.ts --maxWorkers=2`: 59 passed.
- `npx vitest run tests/native_update_search.test.ts tests/native_ota.test.ts`: 46 passed, including late staged-apply cancellation.
- `npx vitest run tests/client_update_search.test.ts tests/fatal_overlay_controller.test.ts tests/native_update_search.test.ts tests/electron_updater_track.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts tests/resume_play.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/i18n_completeness.test.ts tests/localization_fixes.test.ts --maxWorkers=2 --testTimeout=120000`: 308 passed, 3 skipped, one existing trade localization test timed out under concurrent host load.
- `npx vitest run tests/localization_fixes.test.ts -t 'the real trade-accept-race deny text' --maxWorkers=1 --testTimeout=300000`: the timed-out test passed alone.
- `npm run build:bundle`: passed on the final source.
- `npx tsc --noEmit`: passed on the final source with `GOMAXPROCS=2` to limit compiler concurrency on the shared host.
- `npm run security:gate`: passed, zero high findings after prior classifications.
- `npm run ci:changed`: passed but inspected zero files because this branch is uncommitted. An explicit Biome check of all 22 changed, non-generated source files passed with zero errors and eight warnings.
- `git diff --check`: passed.

Frontend and security review found no remaining blocking code findings. Coverage
review findings were addressed with host-routing and both mismatch wiring pins,
distinct result-copy assertions, and staged-apply cancellation coverage.

## Remaining gates

`npm run gate` stopped at i18n freshness: the regenerated localization files are
unstaged, and staging was not authorized. The remaining locale fills follow the
maintainer release workflow; new keys have 60 pending translation rows.

`npm run test:browser` could not connect to its Chromium session and ran no tests.
The targeted Chrome fixture checks above passed. Packaged desktop installation
and actual Android/iOS OTA/store behavior still need device verification.

The merge verdict remains NOT READY until the complete canonical gate passes.
