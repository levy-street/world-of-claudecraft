# Toolchain Modernization: cross-phase state

## Current phase

Phase 1 (Degit the i18n aggregate artifacts): IMPLEMENTED 2026-07-14, PR #1931 against
release/v0.26.0 marked READY FOR REVIEW 2026-07-14. Phase 1 QA ran 2026-07-14: initial
verdict FAIL on acceptance criterion 2 only (the two-branch merge experiment conflicts
in the pre-existing src/ui/i18n.resolved.generated/pending.ts); the owner decided OPEN
item 8 the same day (criterion 2 re-scoped to the phase's artifacts, durable
same-as-English-inversion fix specced as a follow-up), updating the verdict to
PASS-WITH-FOLLOWUPS. Every other criterion verified, all SHOULD-FIX findings fixed.
The merge stays owner-scheduled at a release cut (OPEN item 3).

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
