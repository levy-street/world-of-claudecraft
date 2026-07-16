# Toolchain Modernization: implementation plan

Five implementation phases, each followed by its own QA phase, each pair delivered as one
PR off the latest release/** branch. Full research record: brainstorm.md. Cross-phase
cheat sheet: state.md. Per-phase starter prompts are self-contained in the phase files.

## Table of contents

| Phase | File | One-line scope | PR | Depends on |
|---|---|---|---|---|
| 1 | phase-01-degit-i18n-aggregates.md | Stop committing the two always-conflicting i18n metadata files; add the out-of-band audit trail; carries the packet docs into the repo | PR 1 | (first) |
| 1 QA | phase-01-qa.md | Verify Phase 1 | (same PR) | |
| 2 | phase-02-flat-translationkey-baseurl.md | Generated flat TranslationKey union + delete baseUrl (the TS7 prerequisite; halves tsc today) | PR 2 | |
| 2 QA | phase-02-qa.md | Verify Phase 2 | (same PR) | |
| 3 | phase-03-ci-parallel-checks-ffmpeg.md | Parallel CI checks job + FFmpeg from npm static binaries | PR 3 | Phase 1 merged |
| 3 QA | phase-03-qa.md | Verify Phase 3 | (same PR) | |
| 4 | phase-04-test-sharding.md | 4-shard vitest matrix + heavy-file split; PR gate at or under 4 minutes | PR 4 | Phase 3 merged |
| 4 QA | phase-04-qa.md | Verify Phase 4 | (same PR) | |
| 5 | phase-05-typescript-7-flip.md | TypeScript 7 via the dual-alias install; pre-push hardening; docs | PR 5 | Phase 2 merged (CI-shape checks assume 3 and 4 too, per D5 order) |
| 5 QA | phase-05-qa.md | Verify Phase 5; closes the packet (teardown offer) | (same PR) | |

Ordering rationale: Phase 1 first because it removes the conflict tax every later PR
would otherwise pay, and its merge must be timed to a release cut. Phase 2 is the TS7
foundation and an immediate standalone win. Phases 3 and 4 are independent of TS7 and
land the CI win early. Phase 5 is smallest last, on a soaked GA.

## Team Workflow (every phase)

Every phase runs as its own fresh Claude Code session on Opus 4.8 at xhigh effort
(1m context variant where the file load demands it; add `ultracode` for batch-heavy
phases so the session orchestrates via a Workflow).

1. Step 0, Pre-flight: verify git status is clean in YOUR worktree (create the phase
   worktree off the latest release/** branch if it does not exist). Packet bootstrap:
   fresh worktrees lack docs/toolchain-modernization/ until Phase 1's PR merges; copy
   the directory from the main checkout when absent (every phase prompt repeats this).
   Scan Claude Code memory (MEMORY.md index) for entries matching the phase domain.
2. Step 1, Load Context: spawn an Explore agent to read state.md, progress.md, the phase
   file, and the phase's source files; the main agent does not read large docs directly.
3. Step 2, Choose Orchestration + Execute: pick the lightest tool that fits (Explore for
   recon, parallel Agent fan-out for independent slices, an ultracode Workflow for
   batch/scale). Request fan-out explicitly; give each agent only the Explore summary.
   Use isolation: "worktree" only when agents mutate overlapping files in parallel.
4. Step 3, Validation + Review Dispatch: run the state.md validation matrix rows for the
   phase's change types; spawn review agents per the Review Dispatch Matrix below (only
   the rows the diff actually matches). Prompt review agents for COVERAGE, not
   filtering; do not commit until no BLOCKING issues remain. Every implementation phase
   pushes its branch and opens a DRAFT PR following .github/PULL_REQUEST_TEMPLATE.md;
   the phase's QA session marks the PR ready for review after its PASS verdict (Phase
   1's merge additionally waits for the owner's release-cut timing).
5. Step 4, Update Docs + Memory: update progress.md and state.md; commit docs in the
   same logical commit as the implementation, with EXPLICIT paths. Packet-doc conflict
   rule: progress.md and state.md are append-per-phase; on a merge conflict take both
   sides (each phase touches only its own checklist rows and the status line).

### Review Dispatch Matrix (the one canonical copy; starter prompts reference it)

Match the change surface to the agent. Spawn an agent ONLY when its row matches the diff:

| Agent | Spawn ONLY when the diff touches | Skip it for |
|-------|----------------------------------|-------------|
| privacy-security-review | server/, src/admin/, src/net/, a deploy/secret file (Docker/compose/env/CI yml/DEPLOY.md), OR introduces SQL / auth / a secret / ALLOW_DEV_COMMANDS / a new Math.random, Date.now, or performance.now in src/sim/ | a pure src/ui / src/render / src/game / src/sim/content / docs / test change |
| migration-safety | server/db.ts, server/social_db.ts, a server/*_db.ts, or a characters.state JSONB serialize/deserialize path | any diff with no DDL and no persisted-state shape change |
| cross-platform-sync | src/world_api.ts or src/world_api/** (the IWorld facets), src/sim/ behavior/obs/SimEvent, src/net/online.ts, server/game.ts wire/dispatch, the matchers src/ui/sim_i18n.ts or src/ui/server_i18n.ts, or the RL surface (headless/, python/) | a pure i18n catalog refactor (only src/ui/i18n.ts + locale data, t() keys unchanged): tsc plus the resolved-equivalence test already cover it |
| architecture-reviewer | a src/sim/ change: determinism, rng draw-order, tick-phase order, the SimContext seam, or a move-not-rewrite relocation | a non-sim change, or a pure data/content/test change |
| frontend-seam-reviewer | src/ui/, src/render/, src/game/, or src/styles/ (the view-core + PainterHost painter seams, graphics-settings fairness, mobile/touch surfaces) | a diff with no frontend surface |
| qa-checklist | a phase / deliverable set is COMPLETE (it self-scales via its per-category Skip rules) | per-commit / mid-phase work, or a docs/test-only change |

If NO row matches (e.g. a docs-only, test-only, or comment change), spawn NO review
agent. Do not default to running privacy-security-review anyway. Note for this packet:
CI yml changes (Phases 1, 3, 4) match the privacy-security-review row; the Phase 2
catalog type swap is exactly the "pure i18n catalog refactor" skip case for
cross-platform-sync but touches src/ui/, so frontend-seam-reviewer decides for itself;
Phase 5 (package.json, .githooks, docs) typically matches no row except qa-checklist.

### Agent Scaling Guidelines

- Split work across parallel agents when a phase has 4+ independent concerns; merge
  small work into a single agent (do not spawn a dedicated agent for a five-minute
  task). Manual fan-out caps at ~5 agents; past that, use an ultracode Workflow.
- Each agent owns a complete vertical slice (the change plus its tests), never a file
  type. Dedicated test agents only when test work spans multiple suites independently.
- The docs/skills text sweep in Phase 1 is batch-shaped: a small Workflow (one agent
  per doc file, one verifier) is appropriate under ultracode. Phase 5's sweep is only a
  few files; a Workflow there is optional.

### Code Hygiene (every phase)

- Module-first: new logic lands as its own module behind an existing seam; never grow a
  coordinator. Data-as-code is exempt.
- Every behavior change gets a test in the same change; fix bugs test-first.
- Delete dead code, unused imports, and orphaned tests (Phase 2 explicitly retires
  tests/i18n_overlay_key_membership.test.ts; Phase 1 retires the sha256 test block).
- Never hand-edit generated output; regenerate via the owning build step.
- No em dashes, en dashes, or emojis anywhere: code, comments, docs, commits, PR text.
- Conventional Commits with a scope; EXPLICIT paths, never git add -A.

## Phase summaries

- Phase 1 (PR 1): remove src/ui/i18n.resolved.sha256 (delete) and
  src/ui/i18n.status.summary.json (gitignore) from version control; rewire every
  consumer (CI freshness diffs, gate.mjs, two test files, biome.json, docs/skills); add
  the out-of-band audit trail (CI job summary + optional sticky PR comment). Kills the
  guaranteed pairwise PR conflict and the regenerate-repush-reapprove loop. Merge timing:
  a release cut (owner announces the take-the-deletion rule).
- Phase 2 (PR 2): emit src/ui/i18n.catalog/translation_keys.generated.ts from
  scripts/i18n_build.mjs (line-item format per decision D6); swap the TranslationKey
  definition; delete baseUrl from tsconfig.json; wire freshness + linguist-generated +
  biome exclusion; retire the overlay membership test. Halves tsc today (26 to 35s down
  to ~12s), strengthens overlay key checking, and clears both TS7 blockers (forward
  probe: typescript@7.0.2 must check the repo clean).
- Phase 3 (PR 3): repoint the sfx_studio FFmpeg spawns at ffmpeg-static (go/no-go on the
  loudness suites first; fallback: CI symlink); drop the apt install from both CI jobs;
  add the parallel pr-checks job (i18n:gen + freshness + malware gate + check:types +
  the three builds) preserving merge-ref checkout; update tests/ci_workflow.test.ts and
  tests/sfx_gate_preflight.test.ts pins coordinately.
- Phase 4 (PR 4): explain the vitest "setup" timing bucket, then convert the pr-gate
  test step to a 4-shard matrix (npm test -- --shard=i/4), split tests/vale_cup.test.ts
  along describe boundaries to flatten the worst shard, mirror the matrix on
  release-gate (keeping I18N_RELEASE_TIER), and update the ci_workflow pins. Acceptance:
  PR gate wall at or under 4 minutes over 3 consecutive runs.
- Phase 5 (PR 5): the TypeScript 7 flip via the dual-alias install (decision D1); verify
  node_modules/.bin/tsc is the Go binary and svelte-check stays green; harden the
  pre-push probe to execute tsc --version instead of stat; docs sweep (CONTRIBUTING.md,
  root CLAUDE.md, contributor editor note); record re-evaluation triggers for dropping
  the alias at TS 7.1.

Every phase's QA session applies the QA starter prompt in its phase-XX-qa.md, and the
final QA phase (Phase 5 QA) offers packet teardown (deleting docs/toolchain-modernization/)
on explicit user confirmation before the last PR is marked ready for review (the draft
PR opens earlier, during Phase 5 validation).
