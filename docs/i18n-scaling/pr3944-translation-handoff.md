# PR3944 translation handoff

9 September 2026. Validation record for the v0.42.0 release translation fill.

Branch: `fix/pr3944-translations-current`, based on release commit
`57a2ced3bded6d01e33cf6f53fe354d1ae7e4d22` (PR3945, including PR3946).
Canonical worktree: `/Users/reubenhorne/Documents/code/world-of-claudecraft/wt-pr3944-translations-current`.
PR3944 was still OPEN/MERGEABLE at this head at the final remote check.
The results below were captured before publication; publication was authorized
on 9 September 2026.

All 20,305 original pending registry rows are resolved: 12,721 automatic rows and
7,584 names, lore, and narrative rows. Reuben explicitly approved completing the
previously held content. Deed and Reliquary names, titles, and descriptions outside
the registry were completed too. Parallel mini-equivalent Luna workers handled
initial locale batches; Terra/Sol workers and parent review corrected terminology
and rewrote incomplete or semantically incorrect prose.

The generated registry contains 328,501 translated cells, 464 intentionally blocked
cells, and zero pending across 21 locale entries. Blocked-source count: 114.
Admin pending is zero. Regenerated worklists have zero automatic rows, zero
human-required rows, and no batches. Source exclusions remain distinct from
missing translations.

Source review checked placeholders, shared display names, numeric mechanics,
complete guide paragraphs, and locale terminology. Masterwrought equipment,
ordinary masterwork quality, Perfecting, and profession stations remain distinct.
Swedish prose was rewritten where the first pass mixed English and Swedish.
These are model translations with source-based review, not native-speaker certification.

Coverage guards accept a legitimately empty backlog while exercising the actual
pending builder and simulation source provider with sparse fixtures. Removing
retirement filtering, claiming dense English fallback as translated, or emptying
all pending results still fails those fixtures. Reliquary release checks reject
copied English for every manifest field in every base locale. Native cognates are
narrowly pinned, including Compost and six admin cells.

The wider regression run also caught and resolved item-name collisions in four
locales, German/Turkish accessible-label mismatches, a retired Swedish town name,
and two tests that assumed English text after switching locale. Exact focus and
repaint assertions remain intact.

Validation:

- `npm run i18n:gen`: passed; repeat generation rewrote 0/26 main and 0/26
  admin bundles, with zero pending.
- `npm run i18n:worklist`: passed, zero pending and no batches.
- All ten release-tier i18n suites passed: 210 tests.
- Additional focused regression runs passed: 192 tests across six suites
  (enchant item names, quest-dialog labels, retired-name scrubbing, harvest focus,
  admin catalog, and practice display). Combined focused evidence: 402 tests
  across 16 suites. Admin freshness initially used the candidate snapshot described
  below. After staging, the plain admin command passed all 23 tests again.
- Selective gate: 1,619 suites passed, 28 skipped, one failed; 29,378 tests passed,
  485 skipped, one failed. The sole failure was the old German `12,3k` assertion.
  It now pins `12,3Tsd. in 10 Sek.`, the German run label, and removal of English.
  Rerunning its complete suite passed 8/8. The entire broad run was not repeated
  after that test-only correction; no single all-green gate invocation is claimed.
- `npm run test:browser`: 48 suites / 396 tests passed.
- `node_modules/.bin/turbo run check:types build:env build:server build:bot --ui=stream`:
  all five tasks passed; admin svelte-check reported zero errors and warnings.
- Client build passed with the temporary output-storage adapter described below:
  bundle, locale preloads, backdrop checks, and all 1,737 hashed media assets.
- Malware gate: passed, 8,830 files, zero high findings after existing priors.
- The earlier dependency audit passed, but the publication-time
  `pnpm audit --json` exited 1. It reports three unignored advisories:
  [Vitest/@vitest/mocker 4.1.10, moderate](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9),
  [sharp 0.35.3, high](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c),
  and [js-yaml 4.3.1 via electron-builder, high](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh).
  These versions already exist in the release base. No dependency or audit-ignore
  files changed. Publish as a draft with these unresolved release blockers;
  the earlier audit result is not the current security status. Read-only security
  triage found these in development/build tools, no affected application/server
  imports, and no public mocker/interceptor plugin configuration. No production
  server exposure was identified from source reachability; runtime exposure was
  not tested. Required upgrades remain unresolved.
- Publication checks with the real staged index passed: `npm run i18n:gen`,
  plain generated-i18n `git diff --exit-code`, `git diff --cached --check`,
  and `pnpm exec vitest run tests/i18n_admin_catalog.test.ts --maxWorkers=1`.
- Direct Biome checks covered all 77 changed handwritten source/test files,
  including Russian with `--files-max-size=4194304`; no errors.
- `git diff --check` and generated build-manifest freshness: passed.
- Source audits found no missing entries, placeholder/unknown-key problems,
  numeric omissions, or short-prose flags.

Release test command:

```sh
I18N_RELEASE_TIER=1 pnpm exec vitest run tests/deed_i18n.test.ts tests/i18n_status_registry.test.ts tests/i18n_t_behavior.test.ts tests/localization_coverage.test.ts tests/localization_fixes.test.ts tests/reliquary_i18n.test.ts tests/sim_i18n_base_new_passthrough.test.ts tests/sim_i18n_rift_mechanics.test.ts tests/i18n_completeness.test.ts tests/corpse_harvest_localization.test.ts --maxWorkers=2
```

Selective gate command:

```sh
NODE_OPTIONS='--require /tmp/woc3944-qa-freshness.cjs' GATE_SELECT_BASE=origin/release/v0.42.0 GATE_MAX_WORKERS=4 node scripts/gate_select.mjs
```

During the broad run, the temporary QA index contained HEAD plus the generated i18n candidates. The local
preload scopes it only to artifact-freshness Git diffs at this exact worktree,
including the admin reproducibility test. Other Git operations use their ordinary
index. An earlier inherited-index attempt was stopped because temporary Git
fixtures could overwrite that snapshot. Repository gate code and assertions were
not changed. The gate's ci:changed step checks zero files on this uncommitted
branch; the explicit Biome sweep supplies formatting evidence.

Client build command:

```sh
NODE_OPTIONS='--require /tmp/woc3944-build-output-links.cjs' pnpm run build:bundle
```

Ordinary client-build attempts compiled successfully but ran out of disk space
while copying media. The temporary adapter byte-compares each existing raw asset
inside dist with its source, then links the identical generated raw asset into
dist/media. It never links source files to output. This avoids storing the same
asset twice in the disposable build tree; repository build code is unchanged.
The original dirty checkout and both translation source checkpoints are preserved.
Disposable Vitest caches and the inactive older checkpoint's node_modules were
removed to recover space; reinstall dependencies before using that old checkpoint.

Logs are local under /tmp: woc3944-final-15-suites.log,
woc3944-admin-snapshot-recheck.log, woc3944-practice-final.log,
woc3944-final-selective-gate-isolated.log, woc3944-remaining-gate-steps.log,
and woc3944-client-build-output-links.log.

Handwritten sources, generated bundles, the narrow seed changes, and regression
tests ship together in a draft PR into release/v0.42.0. Run normal CI against
the published candidate and resolve dependency advisories before release
promotion. Deployment remains separate. Keep one coordinator responsible for generation.
