# WOC Marketplace Hardening: implementation plan

Multi-session packet that closes every finding in `review.md` (the 2026-08-11 three-repo
review: 7 ship-blockers, 15 high, the medium list, and the PRD gap backlog) and takes the
P2P $WOC marketplace to the review's "safe to enable" acceptance bar, with a polished UI.
`review.md` is the findings source of truth; this file is the workflow source of truth;
`state.md` is the live cross-session state. Do NOT set `WOC_MARKET_ENABLED=1` on a
production realm until the acceptance bar in `review.md` is fully checked.

## The three repos

| Surface | Working tree | Branch | Validation |
|---|---|---|---|
| Game (this repo) | `/Users/fernando/Documents/wocc-marketplace` | `feature/woc-marketplace` (tracks origin, current with release/v0.39.0, tip d2d1a8ad5c merged at f5df042a86) | `npx tsc --noEmit`, targeted `npx vitest run`, `npm run ci:changed`, pre-merge `node scripts/gate_select.mjs` |
| Economy service (PR #31) | `/Users/fernando/Documents/woc-rewards-service-pr31` | `integration/woc-market-settlement` (PR tip 70d4207; pushes go to `origin/feature/woc-market-settlement`) | in `service/`: `npm run build`, `npm test` |
| Ops dashboard (PR #13) | `/Users/fernando/Documents/woc-rewards-dashboard-pr13` | `integration/woc-market-trading` (PR tip c001d4a; pushes go to `origin/feature/woc-market-trading-controls`) | `npm test`, `npm run check`, `npm run build` |

Packet docs live in the game repo only. Each phase file names the repo it runs in.
Game-repo work happens ONLY in the `wocc-marketplace` worktree (other sessions share the
main checkout and the other worktrees). Do not touch `/Users/fernando/Documents/wocc-market-review`
(the review-session worktree, left in place as a reference).

## Cadence (non-negotiable)

Strict order: implement phase, then its dedicated QA phase, then the next phase. Every
phase and every QA runs as its own fresh Claude Code session. Never start phase NN+1
before `phase-NN-qa.md` has run. Every session ends by naming the NEXT file to run (full
path). The in-phase `qa-checklist` self-review a phase runs before commit is NOT a
substitute for the dedicated QA session; both happen.

## Shared workflow (every session)

### Pre-flight
1. Enter the worktree FIRST. Every phase and QA file opens with a SESSION START block
   naming its worktree and branch: cd there and verify `pwd` plus
   `git branch --show-current` before ANY other command. A restarted or freshly pasted
   session always re-enters; wrong-directory reads mimic data loss (standing memory
   rule).
2. `git status` in that worktree must be clean; if not, stop and ask Fernando
   (concurrent sessions exist).
3. Sync EVERY session at start (implement AND QA): game sessions `git fetch origin` and
   merge the newest `origin/release/**` branch (currently `release/v0.39.0`; v0.38.0 is
   merged to main via PR #3416 and its tip is frozen) into
   `feature/woc-marketplace`; service and dashboard sessions merge `origin/master` into
   their integration branch. If a game merge is non-trivial, run the
   `release-merge-audit` skill on it before starting the phase.
4. Memory scan: check MEMORY.md for the domains the phase touches. Always read the
   `reusable-gotchas-index` cluster and, for any test-pin work, the `test-pin-traps-index`
   catalog, before touching that domain.
5. Load context via an Explore subagent (state.md, progress.md, the phase file, the
   review.md sections it cites, the target source files). Do not read the coordinator
   monoliths whole in the main loop.

### Orchestration
Pick the lightest tool that fits: Explore for recon, parallel Agent fan-out (cap ~5) for
independent slices, a Workflow only when the running prompt includes `ultracode`. Request
fan-out explicitly and name the split. Give each agent only the slice it needs, never the
raw planning docs. Follow the root CLAUDE.md "Working style by model capability" block
for effort; no prompt in this packet names a model.

### Implementation rules
- Module-first per the root CLAUDE.md Modularity section and the `extract-and-test`
  skill. Never grow a monolith-ratchet file; `server/game.ts`, `src/sim/sim.ts`,
  `src/ui/hud.ts`, and `src/net/online.ts` are all in play in this packet.
- Fix bugs test-first: reproduce with a failing test on the real code path, then the
  smallest change that turns it green. Every blocker fix ships a test that fails on the
  old behavior (the acceptance bar demands exactly this).
- Money and security predicates get REAL-SQL tests (a Postgres-backed test, not only
  `FakeWocMarketDb`); the review's "fake-only" finding is a standing trap here.
- Server authority, determinism (`Rng` only in sim), the sim token firewall (no
  wallet/token/settlement code in `src/sim/`), and additive idempotent inline DDL hold in
  every phase.
- i18n (the packet's one copy): every new player-visible string is a `t()` key added in
  ENGLISH to the matching `src/ui/i18n.catalog/<domain>.ts` module; never edit
  `src/ui/i18n.locales/` overlays; sim/server player text gets its matcher rule in the
  SAME change (S3 guard `tests/localization_fixes.test.ts`); M16 wordy-English values need
  their non-Latin fills in the same change. Locale release fills are maintainer release
  work, NOT this packet. The dashboard repo has no i18n framework; keep its operator
  strings consistent English.
- The dashboard and service repos have no reviewer roster or gate; their phases hold the
  same bar by hand (tests for every fix, constant-time secret compares, parameterized SQL).
- Keep the CLAUDE.md files current, never bloated: when a phase adds or moves a seam,
  module, endpoint, env var, monitor, or workflow, update the NEAREST local CLAUDE.md in
  the SAME change (game: the owning directory's file; service and dashboard: the repo's
  top-level CLAUDE.md, creating a concise one if the repo lacks it). A line or two per
  fact, anchor rule (stable paths and symbols, no counts or line numbers), and never
  restate what the code or an existing doc already says. Every QA session verifies the
  phase left no CLAUDE.md stale.

### Commit rules
- Conventional Commits with scope and a body (2 to 5 commits per phase), EXPLICIT paths
  only, never `git add -A` (shared-tree rule).
- Never write the word "phase" (or "phases") in code, comments, commit messages, or PR
  text; it lives only inside these packet files.
- No em dashes, en dashes, or emojis anywhere.
- Push cadence (ruling R4, resolved 2026-08-11): implement sessions do NOT push. A QA
  session whose verdict is PASS (or PASS-WITH-FOLLOWUPS with every fix applied) ends by
  pushing the repos its pair touched, packet-doc commits included:
  game `git push origin feature/woc-marketplace` (only after this session's release
  sync); service
  `git push origin integration/woc-market-settlement:feature/woc-market-settlement`
  (updates PR #31); dashboard
  `git push origin integration/woc-market-trading:feature/woc-market-trading-controls`
  (updates PR #13). A FAIL verdict pushes nothing. Never push any other branch; never
  force-push; after pushing, glance at the PR checks and note the CI state in
  progress.md.
- Biome on changed files only: `npm run ci:changed`, fix with a scoped
  `npx @biomejs/biome check --write <file>`. Gate runs need a COMMITTED tree.

### Review dispatch (game-repo phases; the one canonical copy)
Spawn a reviewer only when the phase diff touches its surface; most phases trigger one or
two, docs-only phases none. Prompt every reviewer for COVERAGE, not filtering (report
every issue including low-severity and uncertain ones; ranking happens later). Resume a
truncated reviewer with: "Stop reading more files. Output the full report now based on
what you have already seen. No more tool calls." Do not commit while a BLOCKING finding
stands.

| Diff surface | Reviewer |
|---|---|
| `server/` money, auth, SQL, secrets, custody | `privacy-security-review` |
| DDL or persisted-state shape | `migration-safety` |
| Query cost, indexes, pool, locks, retention | `database-performance-reviewer` |
| Per-tick / per-request / broadcast server work, caches | `server-hot-path-reviewer` |
| `src/sim/` behavior or the SimContext seam | `architecture-reviewer` |
| IWorld facets, wire fields, sim/server i18n matchers | `cross-platform-sync` |
| `src/ui/`, `src/styles/`, `src/render/` presentation | `frontend-seam-reviewer` |
| Test additions as the deliverable | `test-coverage-auditor` |
| Phase complete, before commit | `qa-checklist` |

Service and dashboard phases dispatch two generic read-only subagents instead: a
security lens (auth tiers, secret handling, fail-closed config, SQL) and a correctness
lens (every deliverable met, edge cases, tests decisive), both prompted for coverage.

### QA phase workflow (canonical; each phase-NN-qa.md adds only specifics)
1. Pre-flight and sync as above. Explore agent loads the paired phase file (what was
   promised), the phase diff (`git log`/`git diff` since the phase-start commit recorded
   in progress.md), and state.md.
2. Fan out audit agents: correctness (every deliverable and acceptance criterion actually
   met, edge cases, regression risk), test-coverage (`test-coverage-auditor` in the game
   repo; every claimed behavior has a decisive assertion that fails on regression; no
   vacuous pins), and dead-code/cleanup (unused imports, leftover scaffolding, TODOs).
   Add the dispatch-table reviewers for the surfaces the diff touches.
3. FIX: apply ALL findings (blocking, should-fix, AND nits; standing rule). The fix round
   is unreviewed code: re-review it (fresh reviewer or careful self-review with files
   open). When a verifier refutes a finding, judge the refutation yourself with the file
   open; verifiers over-refute.
4. Re-run the phase's validation matrix. Commit fixes separately from the audit verdict.
5. Verify the phase left no CLAUDE.md stale (the upkeep rule above); fix any gap as part
   of the fix round.
6. Update progress.md (status, deferrals) and state.md; record surprising rules in
   memory. On PASS (or PASS-WITH-FOLLOWUPS with fixes applied), push per the commit-rules
   cadence. End with: verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts found and
   fixed, what was pushed, deferred items, and the next file's full path.

### Screenshots
Any visual change captures before/after desktop AND mobile screenshots at the LOWEST
graphics preset (memory rule), committed under `docs/screenshots/`, referenced from the
eventual PR body (`pr-screenshots` skill owns the recipe).

## Phase summary

| NN | File | Repo | Closes |
|---|---|---|---|
| 01 | `phase-01-branch-baseline.md` | game | H7, merge re-review, green gate baseline |
| 02 | `phase-02-settlement-state-guards.md` | game | B1, H9, B2a groundwork, sale-row invariant |
| 03 | `phase-03-delivery-exactly-once.md` | game | B2a, B2b, B2c, custody monitor |
| 04 | `phase-04-bond-payment-lifecycle.md` | game | H4, H15 |
| 05 | `phase-05-custody-entry-hardening.md` | game | H5, H6, sim extraction, firewall scan |
| 06 | `phase-06-directed-rail-integrity.md` | game | H10, H12, H14, guardBalance, auto-close |
| 07 | `phase-07-policy-terms-drafts.md` | game (docs) | B7 drafts, doc staleness cluster |
| 08 | `phase-08-service-auth-hardening.md` | service | B5, fail-open configs, compose default |
| 09 | `phase-09-bond-releaser.md` | service | B3, bond double-pay, bond-cents ownership |
| 10 | `phase-10-chain-verifier.md` | service | B4, commitment/timeout decisions |
| 11 | `phase-11-oracle-health.md` | service | H3, venue posture, quote timestamps |
| 12 | `phase-12-wire-completeness.md` | game | H8, env docs, health rail |
| 13 | `phase-13-listing-step-up.md` | game | B6 |
| 14 | `phase-14-ux-honesty.md` | game | H13, error i18n, currency formatting |
| 15 | `phase-15-ui-polish.md` | game | the beautify pass: DESIGN.md conformance, formatting, screenshots |
| 16 | `phase-16-hot-path-scale.md` | game | H11 |
| 17 | `phase-17-db-retention-indexes.md` | game | DB scale mediums |
| 18 | `phase-18-dashboard-guardrails.md` | dashboard | H1, H2, release-ref regex, confirm/audit fixes |
| 19 | `phase-19-dashboard-tooling.md` | dashboard | CI, tests, audit vulns, investigation UX |
| 20 | `phase-20-real-sql-coverage.md` | game | fake-only SQL test gap |
| 21 | `phase-21-devnet-dry-run.md` | service + game | devnet bond cycle + settlement e2e |
| 22 | `phase-22-close-out.md` | all three | runbook, acceptance-bar audit, gates, teardown |

Each phase has a paired `phase-NN-qa.md`. The final QA (`phase-22-qa.md`) offers packet
teardown (delete `docs/woc-marketplace-hardening/` with explicit paths) before any PR.
