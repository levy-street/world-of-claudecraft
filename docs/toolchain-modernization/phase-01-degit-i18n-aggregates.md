# Phase 1: Degit the i18n aggregate artifacts

One PR off the latest release/** branch. Kills the guaranteed pairwise PR conflict on
src/ui/i18n.resolved.sha256 and src/ui/i18n.status.summary.json (see brainstorm.md,
Workstream B: the two files are global aggregates whose correct merged value no textual
merge can produce; the line-item locale slices auto-merge byte-perfectly and stay
committed).

### Starter Prompt

```
This is Phase 1 of the Toolchain Modernization packet: Degit the i18n aggregate
artifacts.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: the docs/skills text sweep (deliverable 5) is batch-shaped; if running with
ultracode, fan it out as a small Workflow (one agent per doc file plus one verifier).

Goal: remove src/ui/i18n.resolved.sha256 (delete outright) and
src/ui/i18n.status.summary.json (gitignore, still generated) from version control,
rewire every consumer, and add the out-of-band audit trail, so concurrent key-adding
PRs merge with zero conflicts.

STEP 0 - PRE-FLIGHT:
- Create a worktree off the LATEST release/** branch (release/v0.26.0 as of planning;
  check for newer) named fix/degit-i18n-aggregates. Verify git status is clean there.
- Packet bootstrap: docs/toolchain-modernization/ will be ABSENT in the fresh worktree
  (it is committed on the planning branch, not the release base). Copy the directory
  from the main checkout at /home/fernandoramirez/Documents/world-of-claudecraft into
  the worktree first. This phase COMMITS the packet directory into its PR (see the
  commit cadence) so every later phase inherits it once PR 1 merges.
- Memory scan (if you use Claude Code memory): check MEMORY.md for i18n-artifact or
  CI-gate entries.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/toolchain-modernization/state.md (decisions D4, D6; the Phase 1 touch set; the
  pinned-tests list; OPEN items 3 and 7)
- docs/toolchain-modernization/progress.md (Phase 1 deliverables checklist)
- docs/toolchain-modernization/phase-01-degit-i18n-aggregates.md (this prompt)
- scripts/i18n_resolved_hash.mjs, scripts/i18n_scan.mjs (writer + header comments),
  scripts/gate.mjs (the I18N_ARTIFACTS list and the freshness step), package.json (the
  i18n:hash script), .github/workflows/ci.yml (the freshness steps in BOTH the pr-gate
  and release-gate jobs), tests/i18n_resolved_equivalence.test.ts,
  tests/i18n_status_registry.test.ts, .gitignore, biome.json,
  scripts/gh_sticky_comment.mjs (the existing sticky-comment pattern)
- CLAUDE.md (root) + src/ui/CLAUDE.md (the generated-artifact merge rule it documents)
The agent should return: the exact current consumer lines for both files, the freshness
step commands verbatim, and which test blocks assert committed-ness versus determinism.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Two parallel implementation agents plus an optional Workflow for the docs sweep:

Agent A (artifact removal + consumer rewiring) deliverables:
- Delete src/ui/i18n.resolved.sha256 (git rm); reduce scripts/i18n_resolved_hash.mjs to
  a print-only diagnostic (remove BASELINE_PATH, --write, --check); update or remove the
  package.json i18n:hash script accordingly.
- git rm --cached src/ui/i18n.status.summary.json and add it to .gitignore (update the
  .gitignore comment block that calls it the tracked audit trail); keep
  scripts/i18n_scan.mjs emitting it, updating its header comment.
- Rewire consumers: drop summary.json from the freshness git diff in ci.yml (BOTH jobs)
  and from scripts/gate.mjs I18N_ARTIFACTS (update the stage-and-rerun hint text);
  remove the biome.json exclusion line.
- Update tests: in tests/i18n_resolved_equivalence.test.ts delete ONLY the sha256
  baseline block (keep the slices-tracked, regen-byte-identical, and perturbed
  determinism blocks); in tests/i18n_status_registry.test.ts remove the tracked and
  git-diff-freshness assertions (keep the counts cross-check, perLocale tally,
  universeHash re-derivation, and determinism blocks, which read the pretest-generated
  file).

Agent B (audit-trail substitute) deliverables:
- Add a CI step to BOTH jobs that reads the generated summary and appends the coverage
  counts (keys, translated, pending, blocked, per-locale rollup) to GITHUB_STEP_SUMMARY.
- Optionally (if cheap) a sticky PR comment with the same counts via the existing
  scripts/gh_sticky_comment.mjs pattern used by the screenshot/AI-review bots.

Docs sweep (Workflow under ultracode, or a third agent) deliverables:
- Update every doc/skill that references either artifact or the i18n:hash re-baseline
  step: src/ui/CLAUDE.md (the merge-conflict rule + contributor step 3), scripts/CLAUDE.md,
  tests/CLAUDE.md if it mentions them, .claude/skills/review-pr/SKILL.md,
  .claude/skills/release-merge-audit/SKILL.md (its sha256 trap paragraph becomes
  obsolete), .claude/skills/i18n-locale-fill/SKILL.md (its release-time step instructs
  the removed i18n:hash -- --write), docs/i18n-scaling/translation-workflow.md (the
  canonical contributor doc; two i18n:hash -- --write instructions),
  docs/prd/FRONTIER_PHASE1_HANDOFF.md if it references the baseline, and
  docs/i18n-scaling/lazy-locales-and-contributor-workflow.md (record the two reopened
  decisions with the 2026-07-14 owner approval and the substitute). Historical program
  records (ip-refactor/, docs/api-pipeline/) are exempt: leave them unedited.

INVARIANTS THIS PHASE MUST KEEP:
- NO runtime behavior change; the resolved i18n output stays byte-identical.
- The committed locale slices (src/ui/i18n.resolved.generated/ and the admin dir) STAY
  committed; only the two aggregate files leave version control.
- The CI freshness step must still fail legibly when a contributor forgets to run
  npm run i18n:gen (the slices still carry that signal).
- Pinned tests updated in the SAME commit as the surface they pin.
- No em dashes, en dashes, or emojis anywhere.

Out of scope (do NOT do in this phase):
- The TranslationKey union, baseUrl, any tsconfig change (Phase 2).
- Any CI job restructuring beyond the freshness-diff lines and the audit step (Phases 3
  and 4).
- Do NOT merge the PR: merge timing is a release cut the owner announces (state.md OPEN
  item 3).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run: npm run i18n:gen twice (second run must leave a clean tree); npx vitest run
  tests/i18n_resolved_equivalence.test.ts tests/i18n_status_registry.test.ts
  tests/localization_fixes.test.ts tests/ci_workflow.test.ts; npx tsc --noEmit;
  npm run ci:changed; then the full npm run gate.
- Conflict-elimination proof: in a scratch worktree, create two branches off this
  branch, each adding one key in a DIFFERENT catalog domain, regenerate on each, merge
  one into the other: assert ZERO conflicts.
- Push the branch and open a DRAFT PR following .github/PULL_REQUEST_TEMPLATE.md (the
  acceptance criteria below need a live CI run; the QA session marks the PR ready after
  PASS; the MERGE stays owner-scheduled at a release cut).
- Spawn review agents per the Review Dispatch Matrix in
  docs/toolchain-modernization/implementation-plan.md (the ci.yml diff matches the
  privacy-security-review row; the rest is test/docs/tooling). Prompt for COVERAGE not
  filtering; do not commit until no BLOCKING issues remain.

STEP 4 - COMMIT CADENCE (Conventional Commits with scope; EXPLICIT paths; no em dashes/emojis):
- docs: add toolchain-modernization planning packet (the docs/toolchain-modernization/
  directory copied in during pre-flight; first commit, so later phases inherit it)
- chore(i18n): stop committing the resolved-hash baseline and status summary
- ci(i18n): post i18n coverage counts to the job summary
- docs(i18n): update contributor workflow and skills for the untracked aggregates
- test(i18n): retire committed-artifact assertions for the removed aggregates

STEP 5 - ACCEPTANCE CRITERIA:
- [x] git ls-files shows neither src/ui/i18n.resolved.sha256 nor
      src/ui/i18n.status.summary.json; npm run i18n:gen still emits the summary locally
      (verified 2026-07-14, Phase 1 QA)
- [x] The two-branch merge experiment produces zero conflicts
      (FALSIFIED as originally written, 2026-07-14 Phase 1 QA: an independent re-run
      off 1f32e20c0 with questUi.tracker.* and hudChrome.spectate.* probe keys
      conflicts in src/ui/i18n.resolved.generated/pending.ts, 20 hunks, one per
      locale array. Structural, not key luck: pending.ts is a small sorted per-locale
      array file whose tail is hudChrome.plurals.*, so any two concurrent new keys
      sorting past that tail rewrite the same tail lines. The two removed aggregates
      ARE gone and all 24 other slices auto-merge byte-identically to a fresh regen;
      pending.ts is the sole remaining pairwise-conflict artifact.)
      (RE-SCOPED 2026-07-14 by owner decision, recorded in state.md OPEN item 8: the
      criterion now covers the artifacts this phase touched, and in that scope it
      HOLDS and is checked off: both removed aggregates produce zero conflicts by
      absence, and the 24 locale slices plus en.ts auto-merge byte-identically to a
      fresh regeneration, verified by the QA re-run. The pre-existing pending.ts
      conflict class is handled separately: the one-command resolution recipe is
      documented in src/ui/CLAUDE.md, and the durable fix, the same-as-English
      inversion, is specced with a fallback in OPEN item 8.)
- [x] npm run gate fully green on the branch (verified 2026-07-14, Phase 1 QA, with
      one documented environmental exception: on the dev laptop the gate reds only at
      the known pre-existing armory_mobile_layout browser pixel assertion, which
      reproduces on the untouched release/v0.26.0 tip; every other step is green
      locally, including the full vitest suite, typecheck, and all three builds, and
      PR CI on the same HEAD, the recorded arbiter for that suite, is fully green.)
- [x] A deliberately staled slice (edit a catalog key without regenerating) still turns
      the CI freshness step red on a test PR (verified 2026-07-14, Phase 1 QA: probe
      PR #1932 test/i18n-freshness-redpath, run 29367801113, pr-gate failed at the
      freshness step with legible per-file hunks; PR closed unmerged. Local
      simulation of the same command also exits non-zero.)
- [x] The audit counts render in the GitHub job summary on a test PR (verified
      2026-07-14, Phase 1 QA, by evidence chain on green run 29367611824: the summary
      was generated before the step, the step succeeded logging 'appended the rollup
      to $GITHUB_STEP_SUMMARY', and the script appends non-empty markdown before
      printing that line. GitHub exposes no API for rendered step summaries and hides
      them from signed-out viewers; an owner eyeball of the run page is the only
      stronger proof.)
- [x] git grep finds no remaining reference to i18n.resolved.sha256 or the i18n:hash
      --write re-baseline flow in any LIVING surface (src/, scripts/, tests/, server/,
      .github/, .githooks/, .claude/, docs/i18n-scaling/, CONTRIBUTING.md, the
      CLAUDE.md files); the historical program records (ip-refactor/,
      docs/api-pipeline/) and this packet are the only permitted remaining hits.
      (Amended and verified 2026-07-14, Phase 1 QA: per the docs-sweep deliverable
      above, docs/i18n-scaling/lazy-locales-and-contributor-workflow.md is also
      permitted to retain its pre-D4 text as a historical design record, provided
      every retained old-flow mention carries a dated D4 note; the addendum plus
      in-body annotations satisfy that, and stays-untracked pins and
      removal-explaining prose are permitted references everywhere.)

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/toolchain-modernization/progress.md (Phase 1 checklist + status) and
  state.md (record the PR number; note any drift discovered).
- If you use Claude Code memory, record surprising rules learned.

STEP 7 - FINAL RESPONSE FORMAT:
End your turn with: phase status, files touched, validation results, review-agent
verdicts, deferred items, and a one-line handoff for the Phase 1 QA session.

STOPPING RULES:
- Stop and report if you discover a consumer of either file beyond the mapped list in
  state.md (do not improvise a fix).
- Stop if the second i18n:gen run leaves a dirty tree (a real determinism bug; report).
- Never merge the PR yourself; the merge is owner-scheduled at a release cut.
```
