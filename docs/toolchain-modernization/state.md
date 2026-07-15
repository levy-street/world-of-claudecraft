# Toolchain Modernization: cross-phase state

## Current phase

Phase 3 (CI parallel checks job + FFmpeg from npm static binaries): IMPLEMENTED
2026-07-14 on feature/ci-parallel-checks off release/v0.26.0 (tip 812e4b223),
draft PR #1945. Go/no-go verdict GO (four sfx suites, 117 tests at go/no-go
time, loudness assertions included, green against the static binaries alone).
All deliverables landed: the scripts/sfx/ffmpeg_paths.mjs resolver (static
packages, PATH fallback, WOC_FFMPEG_PATH/WOC_FFPROBE_PATH overrides), both
sfx_studio spawn sites repointed, the gate preflight probes the resolved
binaries by execution, apt FFmpeg removed from both CI jobs, and the pr-checks
job runs the serialized checks in parallel with pr-gate (measured live, run
29388205976: pr-gate 527s, pr-checks 92s, wall 531s vs the 658s serial
baseline; probe PR #1946 turned the relocated freshness step red exactly and
was closed unmerged). Reviews: 0 BLOCKING across privacy-security-review,
test-coverage-auditor, qa-checklist.
(CORRECTED 2026-07-15 by Phase 3 QA: after the release/v0.26.0 merge
e0f442637, only the audio_io.mjs playback/encode spawns remain on the
resolver; the export_bundle.mjs conformance call site is bound DIRECTLY to
ffmpeg-static/ffprobe-static per release PR #1930, whose side won the merge
conflict and is pinned by tests/sfx_export_bundle.test.ts. The WOC_* overrides
and the PATH fallback do not reach the conformance-measuring call sites.)
The Phase 2 QA freshness-comment rider is closed (both comments reworded).
Phase 3 QA ran 2026-07-15: verdict PASS (0 BLOCKING; 8 SHOULD-FIX found, 8
resolved; PR #1945 marked ready for review, merge timing owner-scheduled; full
record in the Phase 3 QA notes below). Next: Phase 4.
Phase 3 execution notes for later phases are below.

Phase 1 (Degit the i18n aggregate artifacts): MERGED into release/v0.26.0 on
2026-07-14 (PR #1931, merge 0313a58f6). QA verdict PASS-WITH-FOLLOWUPS (initial FAIL
on criterion 2 was resolved the same day by the owner's OPEN item 8 decision:
criterion re-scoped to the phase's artifacts, durable same-as-English-inversion fix
specced as a follow-up). The release-gate arm of the three i18n steps ran live and
green on the merge push (run 29379864925), closing that deferral; the run's overall
red is the pre-existing mid-cycle release-tier state (empty-pending plus release
version surfaces), identical pre-merge. The packet directory is now ON the release
base: fresh worktrees no longer need the bootstrap copy.

Phase 2 (Generated flat TranslationKey union + baseUrl removal): MERGED into
release/v0.26.0 on 2026-07-14 (PR #1940, merge 66b5eb6c5). IMPLEMENTED
2026-07-14 on feature/flat-translationkey-union off release/v0.26.0 (tip
0313a58f6). All deliverables landed: the generator emits
src/ui/i18n.catalog/translation_keys.generated.ts (committed, line-item, D6
clean), TranslationKey re-exports it, baseUrl deleted, the membership test
retired, freshness wiring complete. PR #1940 against release/v0.26.0.
Phase 2 QA ran 2026-07-14: verdict PASS (0 BLOCKING; 2 SHOULD-FIX found and
resolved, one by the committed teeth successor tests/i18n_union_teeth.test.ts
and one by the accepted cadence deviation recorded in the Phase 2 QA notes
below; doc-record corrections applied; PR #1940 marked ready for review, merge
timing owner-scheduled). Measured: tsc 5.9.3 27.4s -> 12.9s local (QA re-measured
12.4 to 12.5s same machine); the typescript@7.0.2 forward probe exits 0 in 2.4s
(QA re-run 2.31s; 7.0.2 still the newest stable 7.x); both negative probes fail
tsc; resolved output byte-identical (QA re-proved: regen clean at HEAD and at
the base tip, zero resolved-slice diffs in the phase range).
The OPEN item 8 rider spike RAN and recorded its measured result in item 8
below: mechanism validates, bundle premise fails, implementation deferred to
its own PR (a recorded, measured deviation from the checklist's written
fallback to (a); see item 8). Next: Phase 2 QA (phase-02-qa.md), then
Phase 3 (phase-03-ci-parallel-checks-ffmpeg.md).

## Phase 1 execution notes (2026-07-14, for later phases)

- Commit cadence deviation: no separate test(i18n) commit exists. The pinned-test edits
  rode chore(i18n) and ci(i18n) per the non-negotiable pinned-tests-same-commit
  constraint, and every commit in the stack is individually green.
- tests/ci_workflow.test.ts DID gain Phase 1 pins (review finding): the coverage step in
  both jobs, the slimmed freshness diff line, and gate.mjs staying free of the summary
  path. Phases 3 and 4 must update these pins when they restructure ci.yml.
- Both de-committed files gained stays-untracked pins (i18n_resolved_equivalence,
  i18n_status_registry) so a re-commit regression is caught.
- scripts/gate.mjs deliberately did NOT gain the coverage-summary step: it is a CI-only
  audit step (job summary sink, never gates). Revisit if step-list parity is tightened.
- Two unmapped comment-only consumers were found and fixed beyond the mapped set:
  src/ui/i18n.ts (SHA harness wording) and scripts/i18n_build.mjs (SHA-invariance note).
- The sticky PR comment substitute was deferred; the job summary is the audit trail.
- Merge experiment result: two branches each adding a key in a different catalog domain
  merged with zero conflicts, AND the auto-merged slices were byte-identical to a fresh
  regeneration of the merged union (textual merge = semantic merge for line-item slices).
  (CORRECTED 2026-07-14 by Phase 1 QA: this result does not generalize. Probe keys
  sorting past the pending.ts tail conflict in every locale array; the byte-identical
  claim held for the 24 locale slices and en.ts but not pending.ts. See the Phase 1
  QA notes and OPEN item 8.)
- Local environment gotchas (this dev machine, relevant to every later phase):
  Node 25.2.1 (shell default) ships a built-in localStorage that breaks jsdom suites
  (deeds_window_focus reds); run gates under nvm Node 24 (CI pins Node 22). ffmpeg and
  ffprobe are NOT on PATH; the node_modules ffmpeg-static/ffprobe-static binaries work
  when shimmed onto PATH (direct Phase 3 / D8 evidence). npm run test:browser needed a
  one-time npx playwright install chromium-headless-shell, and then has ONE pre-existing
  environmental failure (armory_mobile_layout pixel-height assertion) that reproduces
  identically on the untouched release/v0.26.0 tip; CI is the arbiter for that suite.

## Phase 1 QA notes (2026-07-14)

- Verdict: FAIL on acceptance criterion 2 only; the phase's own deliverables are sound.
  (Updated later on 2026-07-14: the owner decided OPEN item 8, re-scoping criterion 2
  to the phase's artifacts and speccing the durable fix as a follow-up; final verdict
  PASS-WITH-FOLLOWUPS, PR #1931 marked ready for review.)
  Counts: 1 BLOCKING found (surfaced as OPEN item 8, not fixable in phase scope),
  2 SHOULD-FIX found and fixed, 2 NICE-TO-HAVE confirmed and deferred, 11 candidate
  findings rejected by a 3-lens adversarial verification panel (one rejected item,
  the unexercised release-gate arm, is still recorded below as a deferral).
- The BLOCKING finding: src/ui/i18n.resolved.generated/pending.ts (pre-existing, NOT a
  Phase 1 artifact) is a small sorted per-locale array file, so any two concurrent
  new-key PRs whose keys both sort past its current tail (hudChrome.plurals.*, which
  most catalog domains do) conflict in every non-empty locale array. The two aggregates
  Phase 1 removed ARE gone, and the 24 locale slices plus en.ts auto-merge
  byte-identically to a fresh regeneration; pending.ts is the sole remaining
  pairwise-conflict artifact. Reproduced independently three times (QA finder plus
  three verification lenses, all BLOCKING).
- SHOULD-FIX fixes applied: scripts/i18n_coverage_summary.mjs header no longer calls
  the summary committed; acceptance criterion 6 amended to record the owner-approved
  historical-annotation treatment of
  docs/i18n-scaling/lazy-locales-and-contributor-workflow.md, whose three unannotated
  pre-D4 mentions (goal 6, the artifact-decision table, the cross-proposal paragraph)
  now carry dated D4 notes.
- Deferred NICE-TO-HAVE (recorded, not fixed): criterion 5 is proven by evidence chain
  rather than an observed rendered summary (GitHub exposes no API for step summaries
  and hides them from signed-out viewers; the owner can eyeball run 29367611824); the
  defensive fallback branches in i18n_coverage_summary.mjs are untested; the
  release-gate arm of the two i18n steps has no live run yet (the first release-branch
  push exercises it).
- Live-CI evidence for criteria 4 and 5 (previously unrecorded): green run 29367611824
  on PR #1931 head 1f32e20c0 (freshness step green; coverage step logged 'appended the
  rollup to $GITHUB_STEP_SUMMARY'). Probe PR #1932 test/i18n-freshness-redpath, run
  29367801113, failed at the freshness step with legible per-file hunks and was closed
  unmerged.
- Gate re-run with the QA fixes (2026-07-14, Node 24 + ffmpeg shim per the execution
  notes): steps 1 to 6 green including the full vitest suite (13819 passed); browser
  regressions red ONLY at the known environmental armory_mobile_layout pixel assertion
  (PR CI green on the same HEAD is the arbiter); typecheck and the env, server, and
  client builds green.

## Phase 2 QA notes (2026-07-14)

- Verdict: PASS. 0 BLOCKING; 2 SHOULD-FIX found, both resolved; 7 doc-record
  corrections applied; the adversarial panel vindicated every disputed factual
  claim (details below). PR #1940 marked ready for review after PR CI green on
  the QA head; merge timing stays owner-scheduled.
- SHOULD-FIX 1 (fixed, the QA's most substantive finding): retiring
  tests/i18n_overlay_key_membership.test.ts kept the membership guarantee
  (strictly stronger under tsc, and broader: the old test imported only 14
  overlays, tsc checks all 21) but lost its three anti-vacuity "teeth"
  self-checks, leaving two silent-failure channels no gate covered: an overlay
  losing its Partial<Record<TranslationKey, string>> annotation in a merge
  (tsc goes silent for that overlay), and the generator ever gaining a widening
  member such as `| (string & {})` (tsc vacuous repo-wide with regen, freshness,
  and determinism all still green). Fix: tests/i18n_union_teeth.test.ts, the
  committed successor. Type-level half: @ts-expect-error probes (the retired
  test's same three synthetic keys plus a value-type tooth) and a
  string-extends-TranslationKey anti-vacuity pin, compiled by every tsc run
  (gate, pre-push floor, CI check:types, editors); the directives themselves
  fail the build as unused the moment the union stops rejecting bad keys.
  Runtime half: every overlay file carries the annotation, and the union file
  keeps the D6 line-item shape (sorted, unique, one quoted literal per line, no
  widening member, no count/hash/timestamp), which also closes the reviewer
  NICE-TO-HAVE that nothing pinned the artifact's internal shape. Both red
  paths were simulated before commit: a widening member fails tsc (TS2322 on
  the pin plus three TS2578) AND the shape test; a dropped annotation fails the
  annotation test naming the file.
- SHOULD-FIX 2 (resolved as an accepted, recorded deviation): the union's
  reproducibility pins (the i18n_resolved_equivalence blocks) and the
  membership-test retirement ride the test(i18n) commit 386cfe3f4, two commits
  after the artifact and type swap they pin (0dc33257d), which violates the
  literal pin-rides-with-surface constraint. Root cause is a genuine conflict
  between that constraint and the phase doc's own STEP 4 four-commit cadence
  (which prescribes a separate test(i18n) commit); the rebuilt stack honored
  the constraint for the EDITED pins (tests/ci_workflow.test.ts and
  tests/i18n_emit_shape.test.ts ride 0dc33257d with their surfaces) and the
  cadence for the NEW pins. Accepted because QA verified the intermediates:
  at 0dc33257d, tsc exits 0 and the emit-shape, ci_workflow, equivalence, and
  the not-yet-retired membership suites all pass, and the artifact was already
  CI-freshness-guarded by that same commit; Phase 1 set the recorded-deviation
  precedent. The PR #1940 body's overbroad "every pinned test rides the commit
  of the surface it pins" sentence was amended to match. Rule for later phases:
  the pin-rides-with-surface constraint outranks a phase doc's commit cadence;
  put NEW pins in the surface's commit too.
- Known red intermediate (recorded): the mid-phase merge commit e07b4aaeb
  carries a stale committed union (PR #1861's two keys landed in the catalog;
  the regen rides the next commit 926081074), so the freshness gates fail AT
  the merge commit itself: bisect-hostile but head-green. Future base merges:
  git merge --no-commit, npm run i18n:gen, then conclude the merge as one
  commit.
- Adversarial panel results (all other attacked claims held): the "85
  template-literal pattern members" figure was VINDICATED by measuring the real
  old type with the TypeScript 5.9.3 compiler API at the release base
  (Leaves<typeof en, 6> normalizes to 5,761 constituents: 5,676 string literals
  plus exactly 85 templates; a static reconstruction's 86 over-counted
  q_mogger, whose objectives Record is replaced by a literal-keyed object via
  the mergeEntities spread in src/ui/i18n.catalog/index.ts). The
  nothing-got-weaker claim survived a dedicated refutation hunt (57
  as-TranslationKey cast sites enumerated, all in files unchanged across the
  range; the runtime lookup path is byte-identical; the strongest candidate,
  the hud.ts companion-bark template key, is bounded by the runtime
  KNOWN_BARKS allowlist with every key present in the union). The baseUrl
  removal survived exhaustively (exactly two tsconfigs repo-wide;
  tsconfig.admin.json extends the root from the same directory so the paths
  anchor is unchanged; svelte-check clean; zero bare baseUrl-rooted imports;
  the #bot-detector fallback arm exercised with private/ empty).
- QA validation evidence beyond the recorded timings: canonical probe pair red
  (bogus overlay key TS2353, bogus t() literal TS2345); a corrupted real call
  site and a corrupted existing overlay row both red (tsc reports only the
  FIRST excess property per object literal, so per-literal probes must stay
  separate); deleting one union member breaks its real call sites AND every
  overlay row carrying the key; a staled union (catalog key added, no regen)
  turns the CI freshness diff red naming the file, and the bare-tsc contributor
  error names TranslationKeyFlat, whose generated header already carries the
  npm run i18n:gen hint (no hint fix needed); literal as-TranslationKey casts
  compile identically on base and branch (TypeScript same-primitive
  comparability), so cast sites are an unchanged escape hatch, not a
  regression. The typeSafety auditor's 20-site t() sample covered all seven
  TS2590-flagged files plus overlay rows and casts, every sampled key present
  in the union; whole-repo tsc green subsumes the per-site checks. Reviewer
  dispatch per the matrix: privacy-security-review PASS, frontend-seam-reviewer
  PASS (the union proven ERASED from the runtime bundle by esbuild-transforming
  the catalog index: no reference to the generated module survives),
  qa-checklist PASS; cross-platform-sync correctly skipped (the pure
  catalog-refactor case), architecture-reviewer and migration-safety not
  applicable.
- Deferrals (recorded, not blocking): the release-gate arm of the union
  freshness diff has not run live (the pr-gate arm ran green on PR #1940; the
  red path is proven by local simulation only); closes on the first
  release/v0.26.0 push after merge, same class as Phase 1's closed deferral.
  (CLOSED 2026-07-14 on the PR #1940 merge push, run 29386506292: the
  release-gate job ran the i18n generate, the union-inclusive freshness diff,
  and the coverage summary all green inside the expected overall-red mid-cycle
  run.)
  The ci.yml freshness-step comment still says "committed line-item slices"
  and should mention the union; deferred to Phase 3, which restructures those
  steps. (CLOSED by Phase 3: both comments reworded to name the union.) The regen-freshness tests inherit an ambient I18N_OUT_DIR if a
  launcher ever sets one (none does; consistent with the pre-existing
  pattern). emitTranslationKeysModule emits syntactically invalid TS for an
  empty key set (unreachable: the composed en catalog cannot be empty).
- Environment note: QA ran under nvm Node 24 with the ffmpeg-static/ffprobe
  shim per the Phase 1 execution notes; the armory_mobile_layout browser pixel
  failure remains environmental (PR CI green is the arbiter).

## Phase 3 execution notes (2026-07-14, for later phases)

- The release tip ITSELF (812e4b223, the PR #1937 merge) carried a one-key-stale
  committed union: #1937's branch predated the Phase 2 union artifact and added
  hudChrome.gathering.notReady, and the plain GitHub-UI merge left the union
  unregenerated (the e07b4aaeb failure mode, live on the release branch; every
  freshness gate on that tip is red). Phase 3 healed it with the documented
  mechanical regen as its own chore(i18n) commit. Rule extension for the owner:
  the merge --no-commit + npm run i18n:gen + one-commit recipe applies to
  MERGES OF PRE-UNION BRANCHES VIA THE GITHUB UI too; until every open branch
  postdates the union, expect this once per stale-branch merge (take either
  side, regen, commit).
- Post-split CI shape (Phase 4 inherits this): pr-gate = checkout, setup-node,
  npm ci, npm test ONLY (npm test self-provisions i18n via pretest). pr-checks =
  npm ci, i18n:gen, coverage summary, freshness diff, security:gate,
  check:types, three builds; same if-conditions as pr-gate, no needs edge,
  merge-ref checkout load-bearing for the freshness diff. release-gate keeps its
  serial single-job shape and I18N_RELEASE_TIER. Measured (run 29388205976):
  pr-gate 527s (the vitest step is essentially the whole job), pr-checks 92s
  (npm ci 14s, i18n:gen 5s, summary and freshness 0s, malware 5s, typecheck 38s,
  builds about 10s), overall wall 531s. Phase 4's shard matrix attacks the 527s.
- FFmpeg resolution is centralized in scripts/sfx/ffmpeg_paths.mjs (+ .d.mts):
  override env vars win outright (no existence check; callers probe by
  execution), then the static package binary if present, then the bare PATH
  name. gate.mjs preflight executes the resolved binaries; both red paths are
  pinned (nonexistent override + empty PATH, and present-but-broken binary).
  scripts/sfx_conform.mjs still imports ffmpeg-static directly (pre-existing
  pattern, no fallback); gen_ui_sfx.mjs and footstep_toggle_spectrogram.mjs
  still default to PATH ffmpeg (manual dev tools, not on any CI/gate path,
  fail loudly if missing; recorded in README and scripts/CLAUDE.md).
  (UPDATED 2026-07-15, post release-merge: the resolver serves the gate
  preflight and the audio_io.mjs playback/encode spawns. The Studio export
  conformance validation (export_bundle.mjs) binds directly to
  ffmpeg-static/ffprobe-static with an import-time throw on null, per release
  PR #1930; audio_io.mjs therefore loads export_bundle.mjs lazily at the
  export call site, pinned in tests/sfx_studio.test.ts.)
- The pre-push floor CORRECTLY blocks pushing a staled slice (tsc types the
  resolved locale slices against the catalog shape), so a deliberate freshness
  red-path probe needs git push --no-verify; the Phase 3 probe (PR #1946)
  recorded that in its body. Future red-path probes: same.
- Local environment update: npm run gate no longer needs any ffmpeg PATH shim
  on this machine (the gate resolves the static binaries itself); the nvm
  Node 24 requirement is unchanged. The Phase 3 gate ran on a bare ffmpeg-less
  PATH end to end (D8 evidence).
- Test-coverage NITs recorded for future ci.yml editors (low severity, none
  fixed in-phase): the ci_workflow jobSource slice absorbs the NEXT job's
  leading comment block, so prose there can collide with not.toContain pins
  (avoid writing literal step strings or "needs:" in job-leading comments); the
  parallel-split test is a whitelist of the 8 current steps, not a partition
  (a brand-new step added to the wrong job is not auto-caught: extend the list
  when adding steps); the apt-absence pin matches only the literal "apt-get"
  (the resolver-import pin on gate.mjs is the load-bearing half); the
  ci.yml/gate.mjs step-list sync is enforced by spot literals, not as a set
  (pre-existing).

## Phase 3 QA notes (2026-07-15)

- Verdict: PASS. 0 BLOCKING; 8 SHOULD-FIX found, 8 resolved (5 as doc
  corrections, 2 as code+test fixes, 1 verified as correctly recorded external
  operator action); PR #1945 marked ready for review after PR CI green on the
  QA head; merge timing stays owner-scheduled.
- The release base moved before QA started (812e4b223 to 61fd49975, 11 commits
  including the Windows publish job, the full 2,095-row locale fill, and the
  v0.26.0 version-surface sync). Merged as the single commit e0f442637 per the
  packet rule; npm run i18n:gen after the merge left a clean tree (the
  auto-merged union and slices were byte-identical to a fresh regen; the
  branch's pending.ts side was correctly superseded by the release fill). The
  ONE conflict, scripts/sfx_studio/export_bundle.mjs, was resolved to the
  RELEASE side: PR #1930 binds the export conformance validation directly to
  ffmpeg-static/ffprobe-static (CONFORMANCE_* constants, import-time throw on
  null) and pins that by value and call-site wiring in
  tests/sfx_export_bundle.test.ts, so keeping the branch's resolver call site
  would have failed the release's own pin; the release binding is also the
  stricter, gate-toolchain-matched design. The release-merge-audit skill ran
  over the merge (4 lenses, 0 BLOCKING).
- Code SHOULD-FIX fixed (commit 04fde718a): the merged export_bundle.mjs
  throws at import time on ffmpeg-static-null platforms, and audio_io.mjs's
  top-level import would have taken down the whole Studio, including the
  playback/encode paths that deliberately keep working via the resolver's PATH
  fallback; audio_io.mjs now loads export_bundle.mjs lazily at the export call
  site, with a source-level pin in tests/sfx_studio.test.ts. Also fixed there:
  the preflight suite gained the single-tool red path (only ffmpeg broken,
  ffprobe resolving), exercising the message's per-tool selection that both
  existing red paths skipped (test-coverage-auditor finding); and the stale
  resolver-scope comments in scripts/sfx/ffmpeg_paths.mjs and
  tests/ci_workflow.test.ts. Contributor-doc overclaims of a universal PATH
  fallback fixed in commit 7ae2969d7 (README.md, scripts/CLAUDE.md,
  docs/sfx-studio-tutorial.md whose remedy suggested a PATH install that does
  not fix export validation, .claude/agents/qa-checklist.md).
- Check-coverage audit: the merged ci.yml step set is a proven superset
  reordering of the 812e4b223 set across all 6 jobs; the only dropped run
  lines are the two intended apt FFmpeg installs (test-pinned); pr-checks
  carries the 7 relocated steps with verbatim run lines, a byte-identical copy
  of pr-gate's if-expression, no needs edge, plain merge-ref checkout, and the
  Phase 1 audit-summary step directly after i18n:gen. Pin audit: every
  tests/ci_workflow.test.ts assertion re-derived by hand from the merged
  workflow (check:types exactly 2; job-slicing regex terminates for all six
  jobs; the comment-absorption NIT corrupts no pin today; release-gate pins
  untouched, I18N_RELEASE_TIER only there; the test reads only ci.yml, so the
  release's desktop-publish.yml Windows job cannot trip any pin).
- FFmpeg audit re-run on the merged tree with NO system ffmpeg anywhere: the
  four sfx suites green (118 tests now, the release's CONFORMANCE_* pin added
  one to the go/no-go-time 117), resolver emits node_modules paths for both
  tools and both execute (ffmpeg 7.0.2-static, ffprobe 4.0.2-static), and the
  gate preflight text matches every string the test pins.
- Probe evidence (both pushed with --no-verify per the probe protocol, both
  removed after observation): staled-slice probe PR #1962 (run 29413049770)
  turned the relocated pr-checks freshness step red with legible hunks naming
  the staled union line and every locale slice, i18n:gen and the summary
  green, typecheck/builds never ran; closed unmerged, branch deleted.
  Failure-UX probe (run 29413485950): a one-commit type error pushed to the
  draft PR reds pr-checks at Typecheck 77s into the job (about 2 minutes after
  push) with the legible error naming src/main.ts, versus the pre-split serial
  position after the roughly 9-minute test step; the branch was force-pushed
  back to e0f442637 and the run cancelled, so no probe commit remains in
  history.
- Live CI on the merged head (run 29412863470, all green): wall 564s = pr-gate
  559s (tests only; up from 527s pre-merge, consistent with the release's
  about 8.8k added test lines) parallel with pr-checks 94s (npm ci 14s,
  i18n:gen 4s, summary and freshness about 1s, malware 5s, typecheck 37s,
  builds about 10s). The critical path remains the vitest step, Phase 4's
  target.
- Pre-push resync: the release tip moved again during QA (61fd49975 to
  b3d789e83, one commit, the PR #1935 Drowned Litany delve fix; zero overlap
  with the branch surfaces, no conflicts, clean regen; merged as f80f8e522
  with the merge-audit trap checks re-run, all empty). That release commit
  landed via the GitHub UI without the local floor and carried biome ERRORS
  in tests/delves.test.ts (unsorted imports, format) and
  tests/litany_spawn_collision.test.ts (format) that blocked descendant
  pushes at the pre-push floor; healed by a scoped biome --write as its own
  chore(tests) commit 0b6ff86a5 (both suites green before and after), the
  GitHub-UI-merge failure-mode precedent now covering biome as well as the
  union regen. Final QA-head run 29415139204 (head 0b6ff86a5, the full
  post-fix stack): all green, wall 547s = pr-gate 544s parallel with
  pr-checks 95s; the trailing docs stamp of this very record rides after the
  observed green run per the packet convention.
- Gate record (Node 24, bare ffmpeg-less PATH, no shim, the D8 condition
  re-verified by command -v on both tools): steps 1 to 6 green including the
  full vitest suite (14,235 passed; up from 13,957 with the release's new
  tests); browser regressions red ONLY at the known environmental
  armory_mobile_layout pixel assertion (browser-gate green in CI on the same
  content); typecheck, svelte-check, and the env, server, and client builds
  green via the manual tail after the known abort.
- Reviewer dispatch (all COVERAGE-prompted, 0 BLOCKING): privacy-security-
  review PASS (verified the OPEN item 4 branch-protection record and added the
  nuance now recorded there; least-privilege workflow permissions, no
  pull_request_target, no script injection, spawn arg arrays confirmed);
  test-coverage-auditor PASS (all 12 phase behaviors decisively pinned; no
  constant-self-comparison; its single-tool-message SHOULD-FIX fixed as
  above); qa-checklist READY on the final tree (its first workflow run
  returned an empty result and was re-run).
- Deferrals (recorded, not fixed): the gate preflight probes the RESOLVER's
  binaries, but sfx:check, the sfx suites, and export_bundle bind directly to
  the static packages, so a scripts-skipped install with PATH FFmpeg passes
  preflight and fails mid-gate at sfx:check with a raw ENOENT (pre-existing
  gap, widened by the merge; a follow-up could preflight the static paths
  too); scripts/sfx_conform.mjs lacks the null-platform guard its siblings
  have (opaque spawn error on unsupported platforms); the allowScripts keys
  pin exact versions (ffmpeg-static@5.3.0, ffprobe-static@3.1.0) against caret
  ranges, so a lockfile bump inside the caret would silently skip the binary
  download (the resolver fallback plus the preflight are the mitigation; pin
  or sync on the next dep bump); the 8-step parallel-split whitelist pins
  containment, not a partition (extend it when adding steps, recorded at
  implementation); two ci_workflow pins sit one comment-edit from a false
  failure (the absorbed 'needs' phrasing and the summary-json path, recorded
  as NITs); pr-checks posts the coverage summary BEFORE the freshness diff
  while release-gate posts it after (cosmetic asymmetry; pr-checks order keeps
  the audit trail on stale-artifact failures); the release-authored comments
  in export_bundle.mjs and tests/sfx_export_bundle.test.ts still say the
  Studio spawns 'the PATH ffmpeg' (true only under WOC_* overrides or
  scripts-skipped fallback now; release-owned wording, left as-is);
  footstep_toggle_spectrogram.mjs remains the one script hardcoding PATH
  ffmpeg (diagnostic tool, off the gate path, recorded at implementation);
  ffmpeg-static ships ffmpeg 7.0.2 while ffprobe-static ships ffprobe 4.0.2
  (2018), an eight-major-version skew worth knowing if the duration-sensitive
  one-second peak/LUFS branch boundary is ever debugged (both validation arms
  use the same ffprobe, so the gate is internally consistent).
- Environment note: QA ran under nvm Node 24 on a machine with no system
  FFmpeg (the D8 no-shim condition); the armory_mobile_layout browser failure
  remains environmental (PR CI green is the arbiter).

## Locked design decisions (record once, reference forever)

- D1: TypeScript 7 adoption is GO, via the official dual-alias install:
  "typescript": "npm:@typescript/typescript6@^6.0.2" plus
  "@typescript/native": "npm:typescript@^7.0.2". svelte-check stays on the TS6 wrapper
  until the TS 7.1 API ships AND sveltejs/language-tools adopts it.
- D2: TranslationKey becomes a build-generated flat literal union
  (src/ui/i18n.catalog/translation_keys.generated.ts, emitted by scripts/i18n_build.mjs),
  replacing the Leaves-based computation in src/ui/i18n.catalog/index.ts. The Leaves type
  stays exported (it has zero other instantiations). tests/i18n_overlay_key_membership.test.ts
  retires in the same change (tsc now enforces strictly more than it did).
- D3: baseUrl is deleted from tsconfig.json; the #bot-detector paths entries stay as-is
  (already ./-relative; verified to resolve without baseUrl on TS 5.9.3, 6.0.3, 7.0.2).
- D4: src/ui/i18n.resolved.sha256 is deleted outright (redundant with the committed
  slices + CI freshness diff + determinism tests). src/ui/i18n.status.summary.json is
  gitignored but still generated. The audit trail moves out-of-band: scan counts posted
  to the CI job summary (and optionally a sticky PR comment via the existing
  scripts/gh_sticky_comment.mjs pattern). Owner approved reopening the two closed
  decisions in docs/i18n-scaling/lazy-locales-and-contributor-workflow.md on 2026-07-14.
- D5: Five separate PRs, one per implementation phase, each branched off the LATEST
  release/** branch in its own git worktree, landed in phase order. Never fold phases
  into one long-lived branch.
- D6: Generated-artifact policy (the rule Workstream B proved): committed generated
  artifacts must be LINE-ITEM (sorted, one item per line, no counts, no hashes, no
  timestamps anywhere in the file). Global aggregates are never committed; they are
  generated on demand and checked by regeneration in CI. Apply this to every future
  generated artifact.
- D7: CI target: PR gate wall time at or under 4 minutes on free standard runners, via a
  4-shard test matrix (npm test -- --shard=i/4, NEVER bare npx vitest in CI: pretest must
  run per shard) plus a parallel checks job (typecheck, builds, freshness, malware gate).
  The job id pr-gate is load-bearing (pinned by tests/ci_workflow.test.ts). Phase 4 may
  amend the shard count with a recorded measurement rationale.
- D8: FFmpeg in CI comes from the ffmpeg-static/ffprobe-static npm packages (already
  devDependencies with allowlisted install scripts; verify their binaries by execution,
  a scripts-skipped install leaves them missing), preferably by repointing the two
  hardcoded PATH spawns in
  scripts/sfx_studio/audio_io.mjs and scripts/sfx_studio/export_bundle.mjs (pattern:
  scripts/sfx_conform.mjs). Contingent on the Phase 3 loudness go/no-go; fallback is a
  CI-only symlink step.

## Non-negotiable constraints for every phase

- This packet is toolchain work: NO runtime behavior change. The resolved i18n output
  must stay byte-identical except where a phase explicitly changes artifact policy.
- No em dashes, en dashes, or emojis in any file (the repo Stop hook scans for them).
- Never hand-edit generated files; regenerate via the owning build step.
- Never run a whole-repo biome --write; format only changed files.
- Shared working tree: commit with EXPLICIT paths, never git add -A. A concurrent
  session may share the checkout; there are unrelated untracked coop files present.
- Branch off the LATEST release/** branch (release/v0.26.0 as of 2026-07-14; check for
  newer at phase start) in a separate worktree, per the root CLAUDE.md workflow.
- Packet bootstrap: fresh worktrees lack this directory until Phase 1's PR (which
  commits the packet) merges; copy docs/toolchain-modernization/ from the main checkout
  when absent.
- Packet-doc conflict rule: progress.md and state.md are append-per-phase; on a merge
  conflict take both sides (each phase touches only its own checklist rows and the
  status line).
- Pinned tests must be updated in the SAME commit as the surface they pin (list below).

## Validation matrix by change type (this packet's variants)

- i18n artifact/policy change (Phases 1, 2): npm run i18n:gen twice (second run leaves a
  clean tree, the determinism proof) + npx vitest run tests/i18n_resolved_equivalence.test.ts
  tests/i18n_status_registry.test.ts tests/localization_fixes.test.ts + npx tsc --noEmit.
- Type-system change (Phase 2): npx tsc --noEmit (record wall time against baselines
  below) + npx -y -p typescript@7.0.2 tsc --noEmit -p tsconfig.json (the forward probe)
  + npx vitest run tests/server/new_endpoint.test.ts.
- CI workflow change (Phases 1, 3, 4): npx vitest run tests/ci_workflow.test.ts + a real
  test PR observing the run (step list, timings, freshness failure still legible).
- SFX tooling change (Phase 3): npx vitest run tests/sfx_conform.test.ts
  tests/sfx_studio.test.ts tests/sfx_studio_server_security.test.ts
  tests/sfx_export_bundle.test.ts tests/sfx_gate_preflight.test.ts.
- Toolchain flip (Phase 5): npm run check:types + npx vitest run
  tests/server/new_endpoint.test.ts + the pre-push hook dry run
  (bash .githooks/pre-push under a no-op push) + full npm run gate.
- Any code change: npm run ci:changed; fix formatting with a SCOPED
  npx @biomejs/biome check --write <file>.
- Pre-merge, every phase: npm run gate (release-tier automatically on release/**).

## Measured baselines (2026-07-14; re-measure, do not assume)

(2026-07-15 note: every figure below predates the v0.26.0 release merge
e0f442637, which added about 8.8k test lines across 84 test files plus 7
parity golden scenarios. First post-merge PR-tier sample, run 29412863470:
wall 564s = pr-gate 559s parallel with pr-checks 94s. Phase 4 must re-measure
its own baselines on the post-merge tree.)

- tsc --noEmit (TS 5.9.3): 26 to 35s local, ~71s CI. Target after Phase 2: ~12s local.
- Target after Phase 5: <= 5s local (measured ~1.8 to 4s in probes).
- PR gate job median: 658s total; vitest step 502s; Typecheck 66.5s; apt FFmpeg 22s.
- After Phase 3 (single run 29388205976, 2026-07-14): PR tier wall 531s = pr-gate 527s
  (tests only) parallel with pr-checks 92s (typecheck 38s inside it). Phase 4 re-measures
  over 3 consecutive runs per its acceptance criterion.
- Target after Phases 3+4: <= 4 minutes wall over 3 consecutive runs.
- Slowest test files: vale_cup.test.ts 58.5s, sfx_studio_server_security.test.ts 42.2s,
  sfx_export_bundle.test.ts 30.8s, parity/parity.test.ts 21.9s.

## Key file paths

Workstream B (Phase 1 touch set):
- src/ui/i18n.resolved.sha256 (delete), src/ui/i18n.status.summary.json (gitignore)
- scripts/i18n_resolved_hash.mjs (reduce to print-only diagnostics), scripts/i18n_scan.mjs
  (header comment only), package.json (i18n:hash script)
- .github/workflows/ci.yml (freshness diff lines in BOTH pr-gate and release-gate + new
  audit-summary step), scripts/gate.mjs (I18N_ARTIFACTS + hint string)
- tests/i18n_resolved_equivalence.test.ts (drop the sha256 baseline block; KEEP the
  slices-tracked, regen-byte-identical, and perturbed-determinism blocks)
- tests/i18n_status_registry.test.ts (drop tracked/git-diff assertions; keep all four
  remaining blocks, the counts cross-check, the perLocale tally, the universeHash
  re-derivation, and determinism, which read the pretest-generated file)
- .gitignore, biome.json
- Docs/skills text sweep: src/ui/CLAUDE.md, scripts/CLAUDE.md, tests/CLAUDE.md,
  .claude/skills/review-pr/SKILL.md, .claude/skills/release-merge-audit/SKILL.md,
  .claude/skills/i18n-locale-fill/SKILL.md, docs/i18n-scaling/translation-workflow.md,
  docs/prd/FRONTIER_PHASE1_HANDOFF.md,
  docs/i18n-scaling/lazy-locales-and-contributor-workflow.md. Historical program
  records (ip-refactor/, docs/api-pipeline/) are exempt: leave unedited.

Workstream A (Phases 2, 5 touch set):
- scripts/i18n_build.mjs (+ scripts/i18n_flatten.mjs, read-only reuse)
- src/ui/i18n.catalog/index.ts (the TranslationKey definition), NEW
  src/ui/i18n.catalog/translation_keys.generated.ts
- tsconfig.json (baseUrl line), .gitattributes, biome.json
- tests/i18n_overlay_key_membership.test.ts (retire in Phase 2)
- package.json + package-lock.json (Phase 5 dual alias), .githooks/pre-push (Phase 5
  probe-by-execution), CONTRIBUTING.md, root CLAUDE.md (Phase 5 docs)

Workstream C (Phases 3, 4 touch set):
- .github/workflows/ci.yml (pr-checks job, shard matrix, FFmpeg step removal)
- scripts/sfx_studio/audio_io.mjs, scripts/sfx_studio/export_bundle.mjs (ffmpeg-static
  repoint), scripts/gate.mjs (preflight)
- tests/vale_cup.test.ts (split into 2 to 3 files along describe boundaries)
- Pinned: tests/ci_workflow.test.ts, tests/sfx_gate_preflight.test.ts

## Pinned tests (update in the SAME commit as the pinned surface)

- tests/ci_workflow.test.ts: pr-gate AND pr-checks job ids + the three shared if
  fragments + no I18N_RELEASE_TIER string in either PR job; no needs edge in either PR
  job; npm test only in pr-gate; the 8 serialized steps present in pr-checks and absent
  from pr-gate; exactly 2 occurrences of "run: npm run check:types"; no inline
  "npx tsc --noEmit" and no "apt-get" anywhere in ci.yml; gate.mjs imports
  ./sfx/ffmpeg_paths.mjs; coverage-summary + union-inclusive freshness pins in
  pr-checks and release-gate; browser-gate install/test lines; gate.mjs step tuples;
  release-gate tier pins.
- tests/sfx_gate_preflight.test.ts: gate.mjs resolved-ffmpeg preflight error text, both
  red paths (nonexistent override + empty PATH; present-but-broken binary proving
  probe-by-execution).
- tests/sfx_ffmpeg_paths.test.ts: the resolver's three arms (override wins, static
  when present, PATH-name fallback) + an execution probe of the resolved constants.
- tests/i18n_resolved_equivalence.test.ts and tests/i18n_status_registry.test.ts:
  committed-artifact assertions (Phase 1 rewrites specific blocks).
- tests/server/new_endpoint.test.ts: spawns node_modules/.bin/tsc against a config that
  extends the root tsconfig (exercises baseUrl removal and the TS7 binary end to end).

## New files created per phase

(Planned entries below; confirm or amend as phases complete.)
- Phase 2: src/ui/i18n.catalog/translation_keys.generated.ts (committed, line-item).
  CONFIRMED 2026-07-14: emitted exactly there by scripts/i18n_build.mjs (in
  override mode it lands inside I18N_OUT_DIR instead, so the determinism harness
  exercises it hermetically); no other new files.
- Phase 3: scripts/sfx/ffmpeg_paths.mjs + ffmpeg_paths.d.mts (the resolver) and
  tests/sfx_ffmpeg_paths.test.ts. CONFIRMED 2026-07-14; no other new files.
- Phase 4: the tests/vale_cup.test.ts split files (2 to 3, names chosen at split time)
  plus a possible shared local test util.

## OPEN research items and gotchas

1. Vitest "setup" aggregate bucket (~351s across workers) unexplained given zero
   setupFiles; Phase 4 measures before finalizing shard count.
2. FFmpeg-static loudness go/no-go is Phase 3 step 1; fallback: CI symlink only.
   RESOLVED 2026-07-14: GO. The four sfx suites (117 tests, loudness assertions
   included) green against the static binaries alone; the CI-symlink fallback was
   never needed.
3. Phase 1 merge timing: at a release-branch cut, announced in advance; resolution rule
   for open PRs is take-the-deletion then npm run i18n:gen. Owner action.
4. No branch protection / rulesets currently enforced on GitHub (probed 2026-07-14);
   re-approval is process-level. Nothing here depends on it; owner may want to confirm.
   Phase 3 addendum (from its security review): if/when required status checks are
   configured, they must require BOTH pr-gate AND pr-checks; requiring only pr-gate
   would leave the split-out malware gate and freshness diff non-blocking on merges.
   (Phase 3 QA nuance, 2026-07-15: the malware signatures and the i18n freshness
   invariant are redundantly enforced inside pr-gate's npm test
   (tests/malware_scan.test.ts and the i18n equivalence suites, neither
   release-tier-gated), so a pr-gate-only config would uniquely lose check:types
   and the three builds; the require-both recommendation stands.)
5. At Phase 5 execution: if typescript 7.0.3+ exists, re-run the Phase 2 forward probe
   against it before flipping (the plan assumes 7.0.2 semantics).
6. jgyy's issue #1868 comment reproduces at --checkers 8; the discrepancies are explained
   and recorded in brainstorm.md (7 vs 8 files, timing, leaf counts).
7. The i18n:gen output is deterministic; running it twice must leave a clean tree. Any
   phase that sees a dirty tree after a second regen has found a real bug: stop and report.
8. pending.ts conflict class (Phase 1 QA BLOCKING, 2026-07-14): DECIDED 2026-07-14 by
   the owner (in-session direction). Original candidates for the record: (a)
   full-universe anchoring: emit a per-key table over ALL catalog keys so inserts are
   always interior; guaranteed fix but adds an estimated 25 to 35 KB gzip to the
   eagerly-imported client bundle; (b) degit pending.ts and re-derive via i18n:gen;
   REJECTED (breaks fresh-clone tsc and editors, the exact breakage committed slices
   exist to prevent); (c) accept the residual conflict and re-scope criterion 2 to the
   aggregates the phase removed, with the one-command recipe documented.
   THE DECISION, two parts:
   - Immediately (done in Phase 1): (c). Criterion 2 re-scoped (dated note in
     phase-01-degit-i18n-aggregates.md), the residual conflict and its recipe (take
     either side, npm run i18n:gen, git add) documented in src/ui/CLAUDE.md; the
     review-pr skill already treats pending.ts conflicts as mechanical regen churn.
   - Durable fix, a follow-up PR (may ride Phase 2's generator work, both touch
     scripts/i18n_build.mjs, but must not block it): option (d), the SAME-AS-ENGLISH
     INVERSION. Invert what is committed: drop the per-locale pending arrays (which
     every new key appends to) and instead commit the inverse per-locale
     sameAsEnglish lists: keys a translator DELIBERATELY provided with a value
     byte-identical to English ('OK', 'Boss'). That list is tiny, changes only during
     maintainer locale fills (single actor, release time), and new English-only keys
     never touch it, so concurrent new-key PRs cannot conflict on it. The runtime
     derives pending instead of importing it: key k is pending for locale L iff
     resolved[L][k] === resolved.en[k] AND k is not in sameAsEnglish[L]; derive
     lazily for the active locale or once at init, preserve the PENDING_TOTAL===0
     fast path and the t() release hard-fail semantics unchanged.
   - Spike checklist before implementing (d), fall back to (a) with a MEASURED
     bundle cost if any item snags: dialect-aware provided semantics must mirror
     scripts/i18n_scan.mjs providedByLang so build/runtime pending stays in lockstep
     with the registry (pinned by tests/i18n_status_registry.test.ts); en_CA
     near-English overlay and en_XA pseudo-locale handling; the exported pending
     surface for src/ui/i18n.ts and src/admin/i18n.ts (shape change vs accessor);
     determinism under the perturbed-env tests; measured bundle delta (expected near
     zero); and re-run the two-branch merge experiment as the acceptance proof.
   - SPIKE RESULT (2026-07-14, run as the Phase 2 rider on
     feature/flat-translationkey-union): the MECHANISM VALIDATES but the
     near-zero-bundle premise FAILS MEASURABLY, so the implementation is
     DEFERRED to its own PR instead of riding Phase 2. (Phase 2 QA wording
     note: this is a recorded, measured deviation from the checklist's written
     fallback above, which prescribed (a) on a snag; the measurement shows (d)
     dominates (a) on every axis, so falling back would ship the worse option.
     See the RECOMMENDATION at the end of this record.)
     (2026-07-15 note: the mid-cycle figures below are pre-fill numbers; the
     v0.26.0 release fill (1c5739dab) emptied pending, so pending.ts now
     measures 974 bytes with all 21 locale arrays empty, confirming the
     at-release prediction live. The sameAsEnglish counts likely grew with the
     2,095-row fill; re-measure before implementing (d).)
     Measured probes (live data, release tip 0313a58f6 plus the Phase 2 diff):
     (1) Lockstep soundness: derived pending (resolved[L][k] === resolved.en[k]
     AND k not in sameAsEnglish[L]; en-dialects always empty) equals the
     committed pending.ts EXACTLY for all 21 non-en locales (0 mismatches,
     including es_ES/fr_CA dialect chains and en_CA). (2) Whitespace edge:
     0 overlay rows carry a non-isPresent value today, so byte-derivation and
     providedByLang agree; an implementation must add a build-time guard
     rejecting whitespace-only overlay values to keep that equivalence forced.
     (3) Tiny-list premise: FALSE. sameAsEnglish measures 3,753 keys total
     (per locale 78 to 297: de_DE 297, id_ID 273, fr_FR 269, ..., zh_CN 78);
     translators legitimately keep many values byte-identical (proper nouns,
     cognate UI terms). (Phase 2 QA note: the 78-to-297 range describes the
     non-English-dialect locales; en_CA is a divergence-only dialect overlay
     whose sameAsEnglish is structurally ~0, so it sits below the range while
     still counting toward the 21-locale total. Gzip figures in this record
     are node zlib gzipSync at level 9; CLI gzip differs by a few percent.) (4) Measured bundle cost, the snag: a one-file
     same_as_english.ts emit is 123,465 bytes raw / 8,168 bytes gzip and must be
     EAGER (the runtime imports it to derive). Today's pending.ts is 70,259 raw
     / 1,982 gzip mid-cycle (near-identical per-locale lists cross-compress) and
     ~700 raw / ~150 gzip at release. So one-file (d) is a permanent ~+8 KB gzip
     eager add at release vs today's ~0: not near zero, though 3 to 4x below
     option (a)'s 25 to 35 KB estimate. (5) A near-zero variant exists but grows
     the change: ship each locale's sameAsEnglish inside its lazy locale chunk
     (the game client is already lazy-flipped) and derive that locale's pending
     set when ensureLocaleLoaded resolves. Eager delta ~0, but it reshapes the
     loaders.ts emit, the residency lifecycle, and the release hard-fail timing
     (derive-on-load instead of static import), and the non-lazy admin runtime
     still eats its (unmeasured, admin-scoped) list eagerly. That is standalone
     PR scope. Also validated for whichever shape ships: the
     i18n_t_behavior pending-injection mock re-points cleanly (inject the
     synthetic key into the mocked en and es slices with byte-equal values;
     no pending module left to mock); the release-tier empty-pending assertion
     and the runtime surface should move behind a derivePendingKeys(lang)
     accessor; runtime derivation cost is one ~6.2k-leaf walk per loaded locale,
     negligible. RECOMMENDATION: implement (d) as its own follow-up PR in the
     per-locale lazy shape (near-zero eager delta) with the whitespace guard and
     the two-branch merge experiment as acceptance; if the owner prefers the
     simple one-file shape, accept the measured ~8 KB gzip eager cost
     explicitly. Do not fall back to (a): measured (d) dominates (a) on every
     axis (cost, and it also shrinks what concurrent PRs can touch).
