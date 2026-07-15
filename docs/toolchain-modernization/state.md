# Toolchain Modernization: cross-phase state

## Current phase

Phase 1 (Degit the i18n aggregate artifacts): MERGED into release/v0.26.0 on
2026-07-14 (PR #1931, merge 0313a58f6). QA verdict PASS-WITH-FOLLOWUPS (initial FAIL
on criterion 2 was resolved the same day by the owner's OPEN item 8 decision:
criterion re-scoped to the phase's artifacts, durable same-as-English-inversion fix
specced as a follow-up). The release-gate arm of the three i18n steps ran live and
green on the merge push (run 29379864925), closing that deferral; the run's overall
red is the pre-existing mid-cycle release-tier state (empty-pending plus release
version surfaces), identical pre-merge. The packet directory is now ON the release
base: fresh worktrees no longer need the bootstrap copy.

Phase 2 (Generated flat TranslationKey union + baseUrl removal): IMPLEMENTED
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
  The ci.yml freshness-step comment still says "committed line-item slices"
  and should mention the union; deferred to Phase 3, which restructures those
  steps. The regen-freshness tests inherit an ambient I18N_OUT_DIR if a
  launcher ever sets one (none does; consistent with the pre-existing
  pattern). emitTranslationKeysModule emits syntactically invalid TS for an
  empty key set (unreachable: the composed en catalog cannot be empty).
- Environment note: QA ran under nvm Node 24 with the ffmpeg-static/ffprobe
  shim per the Phase 1 execution notes; the armory_mobile_layout browser pixel
  failure remains environmental (PR CI green is the arbiter).

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

- tsc --noEmit (TS 5.9.3): 26 to 35s local, ~71s CI. Target after Phase 2: ~12s local.
- Target after Phase 5: <= 5s local (measured ~1.8 to 4s in probes).
- PR gate job median: 658s total; vitest step 502s; Typecheck 66.5s; apt FFmpeg 22s.
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

- tests/ci_workflow.test.ts: pr-gate job id + three if fragments + no I18N_RELEASE_TIER
  string in the job; exactly 2 occurrences of "run: npm run check:types"; no inline
  "npx tsc --noEmit" in ci.yml; browser-gate install/test lines; gate.mjs step tuples;
  release-gate tier pins.
- tests/sfx_gate_preflight.test.ts: gate.mjs PATH-ffmpeg preflight error text.
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
- Phase 4: the tests/vale_cup.test.ts split files (2 to 3, names chosen at split time)
  plus a possible shared local test util.

## OPEN research items and gotchas

1. Vitest "setup" aggregate bucket (~351s across workers) unexplained given zero
   setupFiles; Phase 4 measures before finalizing shard count.
2. FFmpeg-static loudness go/no-go is Phase 3 step 1; fallback: CI symlink only.
3. Phase 1 merge timing: at a release-branch cut, announced in advance; resolution rule
   for open PRs is take-the-deletion then npm run i18n:gen. Owner action.
4. No branch protection / rulesets currently enforced on GitHub (probed 2026-07-14);
   re-approval is process-level. Nothing here depends on it; owner may want to confirm.
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
