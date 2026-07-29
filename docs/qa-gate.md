# The QA gate

World of ClaudeCraft uses multiple coding-agent runtimes, but one repository QA
contract. Every layer does one job at the cheapest useful boundary. Claude Code and
Codex have different entry points and share the same deterministic scripts and commands.

## Layers

| Layer | What runs | When | Blocks? |
|---|---|---|---|
| Instant copy gate | `.claude/hooks/qa-stop.sh` through each runtime's Stop hook | End of an agent turn | Yes, on a hard-invariant hit |
| Deterministic floor | `.githooks/pre-push` | Before a push | Yes |
| Day-loop fast path | `npm run gate:fast` through `scripts/gate_fast.mjs` | While iterating (agents and mid/low-tier machines) | No (local only; not merge) |
| **Selective gate** | `node scripts/gate_select.mjs` | **Before implementation is called ready / pre-merge** | **Yes (the merge bar)** |
| Full local gate | `npm run gate` through `scripts/gate.mjs` | When you want the whole suite locally, or the planner falls back | Yes (deeper check) |
| Selective PR-tier CI | ci.yml `pr-gate` shards through `scripts/ci_shard_test.mjs` (same selection semantics, sharded; full suite on any unprovable diff) | Every pull request | Yes (PR checks) |
| Merge queue | ci.yml on the `merge_group` event: the full PR tier over the exact merge result about to become the branch tip (see `docs/merge-queue.md`, including rollout status: `release/**` first, `main` at the next release-to-main merge) | Every queued merge into a queue-protected branch | Yes (required checks on the merge group) |
| Nightly full gate | `.github/workflows/nightly.yml`: full suite + checks + browser over the tips of main and the active `release/**` branch | Scheduled nightly (04:47 UTC) | No (alerting: files and closes one tracking issue) |
| Judgment review | Claude `/qa` or Codex `$woc-qa`, plus scoped reviewers | End of a contribution | Advisory locally |

### Instant copy gate

The Stop gate scans the uncommitted added lines (the unstaged tracked diff plus
untracked text files) for an em dash, en dash, emoji, focused `.only(` test, or leftover
`debugger`. It takes milliseconds and never runs TypeScript, Vitest, Biome, browser
work, or an agent. `.claude/settings.json` and `.codex/hooks.json` share the Claude
implementation; the Codex adapter (`.codex/hooks/qa-stop.sh`) delegates to it, then
additionally scans TOML and `.mts`/`.cts` TypeScript module files that the shared
extension filter omits.

### Deterministic floor

`.githooks/pre-push` runs the heavier fast checks at the push boundary: TypeScript,
determinism and purity guards, i18n matcher guards, Biome on changed files, and copy
checks over the push diff. The shared `.claude/hooks/ensure-hooks.sh` idempotently points
`core.hooksPath` at `.githooks`; both agent runtimes call it at session start.

`git push --no-verify` remains an emergency bypass, not a substitute for reporting and
fixing a red gate.

### Day-loop fast path (`gate:fast`)

`npm run gate:fast` is a **high-signal subset** for agent and day-to-day loops. It is
**not** the merge contract and does **not** replace `npm run gate`.

It runs, in order:

1. Malware gate (`security:gate`, typically a few seconds)
2. Biome on changed files (`ci:changed`)
3. Determinism / purity and i18n-matcher guards (`tests/architecture.test.ts`,
   `tests/localization_fixes.test.ts`)
4. Incremental TypeScript check (`check:ts` only; not admin `svelte-check`)
5. Vitest for changed code: `vitest related` on working-tree source files plus any
   changed test files (`--passWithNoTests`). `package.json` / vite config dirtiness is
   **not** expanded through `vitest --changed` (that would re-run nearly the full suite).

It deliberately skips full unsharded vitest, browser regressions, SFX conformance,
i18n generate/freshness, wiki content, and env/server/client builds. Those stay on the
full gate. Vitest workers still use `computeGateWorkers` (CPU/2 and available-memory clamp;
the sensor is `scripts/lib/gate_memory.mjs`, which reads `vm_stat` on macOS because
`os.freemem()` under-reports availability there).
Optional `GATE_WORKER_TIER=low|medium|high` caps workers after that clamp; see
[`docs/local-gate-perf/tier-workers.md`](local-gate-perf/tier-workers.md). Opt in to
branch-wide `vitest --changed <ref>` with `GATE_FAST_BASE=<ref>` when you deliberately
want that broader (and slower) selection. **Which command for your tier / agent vs
human:** [`docs/local-gate-perf/platform-matrix.md`](local-gate-perf/platform-matrix.md)
(macOS verified; Linux smoke via CI; Windows smoke until a host fills the matrix).

For a narrower loop without malware/biome/types, use the thin wrappers (same Vitest CLI;
not a merge bar):

```bash
npm run test:related -- path/to/changed.ts   # vitest related --run --passWithNoTests
npm run test:changed                         # vitest run --changed (uncommitted)
npm run test:changed -- origin/release/v0.34.0
```

`test:changed` expands almost to the full suite when `package.json` or `vite.config.ts`
is dirty (same reason `gate:fast` skips those paths for related expansion). Prefer
`test:related` with explicit sources, or `gate:fast`, for day-to-day work. Vitest
`experimental.fsModuleCache` is on in `vite.config.ts` so warm re-runs reuse module
transforms under `node_modules/.experimental-vitest-cache` (clear with
`npx vitest --clearCache` if a warm run looks wrong). The same store is persisted
across CI runs since Phase 4 of the CI/CD performance packet: the pr-gate and
release-gate shard jobs carry an `actions/cache` step for it, keyed per shard, and the
long-sims lane job carries the same step keyed per lane (Phase 6, the recorded Phase 4
rider), all over the node_modules-layout inputs (lockfile, vite config, `.npmrc`,
`package.json`), with the design constraints written on the pr-gate copy of the step in
`.github/workflows/ci.yml` and pinned by `tests/ci_workflow.test.ts`. The nightly gate deliberately stays cold: it is the
uncached full replay. Most DOM-environment unit
tests use `// @vitest-environment happy-dom`; a short exception list still pins
`jsdom` where happy-dom API gaps bite (see `docs/local-gate-perf/baselines.md`
Phase 5). Default environment remains `node`.

### Full local gate

`npm run gate` (or `pnpm run gate`) is the **merge and "done" contract**. It mirrors CI:
generated i18n freshness, malware scanning, changed-file formatting, the SFX conformance
check, the full test suite, the browser regression suite (`npm run test:browser`, which
drives Chromium through Playwright), the typecheck, and env, server, bot, and client
builds. Release branches use the release i18n tier. It stops at the first failure and
bounds Vitest workers to avoid load flakes on shared machines. It resolves FFmpeg
(`ffmpeg` and `ffprobe`) from the bundled `ffmpeg-static`/`ffprobe-static` npm packages,
falling back to PATH, and refuses to run when neither source yields a working binary.

**Task cache (Turborepo):** pure artifact steps (`i18n:gen`, `wiki:content`, `sfx:check`,
`check:types`, `build:env`, `build:server`, `build:bot`, `build:bundle`) run through `npx turbo run`
with inputs/outputs in root `turbo.json`. A warm second gate on an unchanged tree
replays those steps from `.turbo/` (often under a second). Full vitest, browser tests,
malware, changed-file Biome, and the i18n freshness `git diff` always run (they are not
cached as "passed"). Catalog edits under `src/ui/i18n.catalog/**` invalidate `i18n:gen`.
Contributor detail: [`docs/local-gate-perf/task-cache.md`](local-gate-perf/task-cache.md).

Use this command instead of an ad hoc shell pipeline, and always before calling a change
ready or opening a mergeable PR. Piping a test run can hide its exit status, and
unconstrained full-suite parallelism can make healthy heavy sim tests flake. Day-loop
iteration may use `npm run gate:fast`; a green fast path alone is never enough to claim
done.

### Selective gate (`gate:select`)

`node scripts/gate_select.mjs` is **the merge bar** (owner decision, 2026-08-05; recorded in
`docs/local-gate-perf/state.md`). `npm run gate` remains the deeper check. The one-line
difference from the other paths:

| | Non-test steps | Tests | Merge bar? |
|---|---|---|---|
| `gate:fast` | **A subset.** No builds, no admin/bot typecheck, no i18n or wiki freshness, no sfx, no browser. | `related` plus two guard files | **No** |
| `gate` | **All**, plus the dep-sync and ffmpeg preflights | **Every** test file | Yes (provably complete) |
| `gate:select` | **All, and the same preflights** | always-run set + `related` | Yes (empirically complete) |

The distinction that matters: **`gate:fast` is weaker because it drops whole checks;
`gate:select` drops none of them.** A change that breaks the client bundle, the admin
Svelte types, the bot build, i18n freshness, or SFX conformance fails `gate:select`
exactly as it fails `gate`, and on a `release/**` branch it runs the release-tier i18n
step too. Only the test step is narrowed, so the question "is this enough to ship a PR"
reduces to one question: does the narrowed test step still catch what the full one would?

**Why the narrowed test step is sufficient.** `vitest related` selects on the static
import graph, which models most of this suite correctly and misses the rest *silently*
(a skipped test does not error, so the gate still prints PASS). So selection is never
trusted alone. `scripts/lib/test_visibility.mjs` classifies every test file first:

- **blind**: reaches outside the graph (disk scan, subprocess, dynamic import, or an
  fs-touching shared helper one hop away) and imports no source. `related` can never
  select it. `tests/architecture.test.ts`, the determinism and sim-purity guard, is one
  of these.
- **partial**: reaches outside the graph *and* imports source, so `related` selects it
  only sometimes, which hides better than never.
- **graph**: pure imports, modelled correctly.

Discovery matches vitest's own collection rule rather than approximating it, because a
walker that misses a file the suite runs removes it from the always-run set silently.

Every blind and partial file runs on **every** selective gate regardless of the diff.
Only the graph-visible remainder is left to `related`. The set is recomputed from source
on each run rather than read from a committed list, so it cannot go stale: a new test that
scans from disk joins it the moment it lands.

**Safety fallback.** Any change the planner cannot reason about (a lockfile, `package.json`,
a vite/vitest/tsconfig edit, the shared test helpers or global setup) drops the whole run
to the full suite. One deliberate carve-out: the regenerated i18n artifacts never widen;
they classify into their own bucket and are fed to `related` as graph nodes (see
"Generated i18n artifacts" under the CI section below; the same shared classifier serves
both arms, and the local gate's own i18n freshness step is the local half of the safety
argument). Selection is an optimization for changes we understand; everything else gets
the old bar. Failing toward *more* tests is the only safe direction, which is also why
an unresolvable diff base or a failing `git diff` is a hard stop rather than an empty
changed set. The diff is taken against the BRANCH base, not just the dirty working tree:
`GATE_SELECT_BASE` overrides it, otherwise the tracking branch is used.

**Reading a shadow run.** It reports two numbers. *Escapes* (a file the full suite
failed that selection skipped) is the strict signal, but it is empty on any green
branch regardless of how sound selection is, so a green run is explicitly labelled
INCONCLUSIVE on escapes rather than PASS. The *coverage delta* (files the full suite
ran that selection skipped) exists on every run: it is not a defect list, it is the
surface where an escape could hide, and it is what to actually study.

**What it still cannot prove, and why that is acceptable.** The out-of-graph pattern list is
a floor, not a proof, so this path is empirically complete rather than provably complete.
The backstops are the runs that stay unconditionally full: `.github/workflows/ci.yml` runs
the FULL suite on every push to `main` / `release/**` (release pushes as the plain 8-shard
matrix; main/dev pushes through the PR tier's shards-plus-long-sims-lane layout, full
mode, since selection applies to pull requests only, next section), and the scheduled
nightly full gate re-proves the tips daily with same-day alerting. A selection miss
therefore surfaces at merge-to-release time or the same night, never later, and the
release branch is the safety net the packet designed it to be.

### Selective PR-tier CI (`ci_shard_test.mjs`)

Since Phase 2 of the CI/CD performance packet, the
`pull_request` tier of `.github/workflows/ci.yml` runs the SAME selection semantics as
`gate:select`, sharded 8 ways. The `changes` job derives a `test_mode` from the same
API-fetched file listing that decides `code` (`scripts/lib/ci_test_select.mjs`), and each
`pr-gate` shard builds its legs through `scripts/lib/ci_shard_plan.mjs` via
`scripts/ci_shard_test.mjs`: in full mode, the old `npm test -- --shard=i/8` step minus
the long-sims lane files (below); in selective mode, the always-run floor plus
`vitest related` over the changed sources, both sharded.

**The long-sims lane** (Phase 4). The `CI_LONG_SUITES` files
(`scripts/lib/ci_shard_plan.mjs`: the suites measured over 90 seconds inside a full-mode
shard, the chronomancy balance sweep among them) run in the dedicated
`PR gate (long sims)` job (`node scripts/ci_shard_test.mjs --lane=long-sims`), and every
shard leg excludes them, so a single multi-minute file no longer sets the slowest shard's
wall clock. Completeness is a pinned invariant, not an intention: the lane fails closed to
its whole file list on exactly the inputs that make a shard fail closed to full, the
shard legs exclude exactly the files the lane owns, and in selective mode the lane runs
just the lane files the floor or the PR's diff would have carried (the related legs stay
unfiltered, so a reached lane file re-runs there: duplicate work, never a gap). Mode for
mode, the nine PR-tier test jobs together therefore run exactly what the pre-lane
8-shard layout would have run (`tests/ci_shard_plan.test.ts` pins the partition;
selective mode still skips the outside-floor remainder by design, exactly as before the
lane). The latency win is concentrated in FULL mode: three of the four lane files are
graph-visible, so on a sim-heavy selective PR the `related` legs pull them back into a
shard exactly as they did before the lane, and only the blind member (plus any lane
test the PR itself changed) rides the lane.
The lane reproduces locally with
`node scripts/ci_shard_test.mjs --lane=long-sims --plan-only`, printing the same
`[ci-shard]` audit lines as the shards. `release-gate` is deliberately not lane-split:
`release/**` pushes keep the full suite in their 8 shards; a push to `main` or `dev-*`
runs the PR tier, so it gets the shards-plus-lane layout.

The CI floor is a superset of the local one: every blind/partial test (recomputed in the
PR's own tree via the shared `collectSuiteVisibility`), PLUS the invariant guard suites by
name (`tests/architecture.test.ts`, the localization guards, `tests/world_api_parity.test.ts`,
and everything under `tests/parity/`), PLUS every test file the PR changed. CI also widens
on triggers the local gate does not need: any `.github/` path, the selection pipeline's own
scripts (a PR runs its own copy of them), any removed or renamed source/test path (a
deleted module's importers are invisible to `related`), and any listing it cannot relay or
read safely. Selection never applies off `pull_request` events: a merge-queue run
(`merge_group`) always takes `test_mode=full` (the queue is the last pre-merge bar),
`release-gate` keeps the unconditional full 8-shard run line, and the nightly gate
re-proves the tips daily.

**Generated i18n artifacts.** The regenerated i18n artifacts (the per-locale resolved
slices directly under `src/ui/i18n.resolved.generated/` and
`src/admin/i18n.resolved.generated/`, and
`src/ui/i18n.catalog/translation_keys.generated.ts`) classify into their own bucket
(`isGeneratedI18nArtifactPath` in `scripts/lib/gate_select_plan.mjs`) instead of the
unrecognized-widen-to-full catch-all, so a PR that carries a routine regeneration no
longer forces the full suite: before this rule they were the single dominant full
trigger (8 of the 25 PRs replayed in Phase 2 went full SOLELY on them). The standing
rests on three structural facts, each pinned:

1. **Integrity is owned by the freshness step, which selection never touches.** The
   `pr-checks` job (and `release-checks`, and the full local gate's i18n step) reruns
   `npm run i18n:gen` and fails on `git diff --exit-code` over EXACTLY the artifact
   paths, gated only on `code` (any `src/` change), never on `test_mode`. A hand-edited
   or stale artifact is therefore a red check in every mode. `tests/ci_workflow.test.ts`
   pins the classifier's path list to the workflow's freshness-diff list AND to the
   local gate's `I18N_ARTIFACTS` list, so the copies cannot drift apart silently.
2. **Coverage is owned by the import graph, with the artifacts as entry nodes.** The
   artifacts are INSIDE the module graph, and are its most-connected i18n node
   (`src/ui/i18n.ts` statically imports and re-exports the resolved barrel); their
   DRIVING sources (catalog modules, locale overlays) are build inputs the runtime
   reaches only through type-erased edges, so `related` over a driving source selects
   almost nothing. Both arms therefore feed the changed artifact paths THEMSELVES to
   `vitest related`, which walks the real graph to every consumer, including suites
   that pin resolved-table content through the `src/ui/i18n.ts` re-export seam without
   ever naming an artifact (measured: a single resolved slice reaches about 240 of the
   2296 suites; a locale-fill PR runs the floor plus that set instead of everything).
   The `generated-i18n` entry in `OUT_OF_GRAPH_PATTERNS` is a belt over this, not the
   mechanism: it floors the direct artifact-naming importers on every selective run,
   with witnesses floored SOLELY by it (`tests/i18n_lazy_loader.test.ts`,
   `tests/i18n_dialect_resolution.test.ts`) pinned in `tests/gate_select_plan.test.ts`.
   Each `npm test` leg's pretest also regenerates the artifacts, so selected suites
   always assert over fresh content.
3. **Deletions and unprovable shapes widen.** The freshness diff cannot flag a
   deleted-then-regenerated file (regeneration recreates it UNTRACKED, and `git diff`
   never shows untracked files), so a removed or renamed-away artifact forces full in
   the mode decision (statuses), the shard plan re-proves presence with the checkout the
   changes job lacks, and the local planner takes an existence probe and widens without
   one. Membership is top-level only: the generator's orphan sweep does not recurse, so
   a SUBDIRECTORY path under an artifact dir is not freshness-provable and keeps the
   unrecognized widen. Every OTHER `.generated` tree keeps the old behavior:
   unrecognized, widen. Do not extend the artifact list without a freshness-equivalent
   proof AND the `tests/ci_workflow.test.ts` coupling.

Every decision prints in the job log (`[detect_code_changes]` in the changes job,
`[ci-shard]` in each shard: mode, reason, floor size, related sources, and the
outside-floor count), so a suspicious green is auditable at a glance. To reproduce a CI
decision locally: `TEST_MODE=... CHANGED_FILES='[...]' node scripts/ci_shard_test.mjs
--shard=1/8 --plan-only` (`--plan-only` spawns nothing, so it works on any platform;
the real run path is POSIX-only by design). Pins: `tests/ci_test_select.test.ts`,
`tests/ci_shard_plan.test.ts`, `tests/ci_selection_pipeline.test.ts` (the trigger list
matches the pipeline's real import closure), and the workflow shape in
`tests/ci_workflow.test.ts`.

What the selective PR tier still cannot prove: the merge-result INTERACTION between
the PR's diff and base commits that landed after the PR's merge base. The shards check
out the merge ref (the PR merged onto the current base tip), but selection derives
from the PR's own changed files, so a test that only fails in the combination of a PR
change and a newer base change is outside both the floor and the related set. On the
queue-protected branches (`main` and `release/**`, see `docs/merge-queue.md`) the merge
queue closes this pre-merge: every queued PR is retested with the FULL suite on the
exact merge result against the current tip before it may land. The full-suite run on
every `release/**` push still re-proves the landed tip, and the nightly re-proves it
daily.

**Known-flake handling** (Phase 6). The shard and lane legs run through
`scripts/lib/ci_leg_runner.mjs`, which streams each leg's output through with
backpressure while keeping a bounded tail, and applies the ONE sanctioned automatic
retry: a leg that exits 1 while its vitest summary shows every test passed, carries the
exact unhandled `EnvironmentTeardownError: [vitest-worker]: Closing rpc while
"onUserConsoleLog" was pending` message (the worker-teardown console-log race, first
recorded 2026-08-05), and whose summary `Errors` count is fully explained by teardown-rpc
occurrences (so a run also carrying any OTHER unhandled error never retries) is rerun
once, with a loud `[ci-shard] known-flake retry` banner in the job log, a GitHub warning
annotation on the run, and a `(known-flake retry used on: ...)` suffix on the PASS line,
so a green that used the retry is auditable at a glance. At most ONE retry per job,
shared across all its legs. Any failed test, any other exit code, a signal kill, a spawn
error, or any unexplained unhandled error fails the job exactly as before: the packet's
non-goals forbid a blanket retry because retries hide real regressions. Be precise about
what the guarantee is: test output is not a trust boundary (a test already executes
arbitrary code in the job), so the summary parse is a narrowing filter, not integrity;
the property that holds is the policy itself, at most one rerun of the same leg per job,
always visible in the log. Classifier and policy live in
`scripts/lib/teardown_rpc_flake.mjs` and `scripts/lib/ci_leg_runner.mjs`, pinned by
`tests/teardown_rpc_flake.test.ts` and `tests/ci_leg_runner.test.ts`. `release-gate`,
the nightly, and the local gate carry NO auto-retry: there a teardown-rpc red stays red
and the remedy remains a manual rerun of the red shard
(`gh run rerun <run-id> --failed`).

**Evidence it works.** Fault injection, 5/5 caught: a `Math.random()` in `src/sim`, a combat
constant, a content record, a sim-emitted player string, and a deleted weapon `.glb`. In two
of those (`Math.random` and the asset deletion) `vitest related` selected **nothing** and
exited green; the always-run set caught both. That is the mechanism doing precisely the job
it exists for.

**No `npm run` alias yet, deliberately.** `tests/fenbridge_town_assets.test.ts`
fingerprints the whole of `package.json` as an input to a shipping GLB, so adding a
script entry invalidates the asset and demands a full re-export (63 files: preview
PNGs, raw and optimized GLBs). Rather than put that churn in a tooling change, this
ships as a direct `node` invocation. Adding the alias is a follow-up that either
re-exports the asset or narrows the fingerprint to the dependency fields, which is
the toolchain-relevant part its own comment cites as the reason for the pin.

Pure planning logic: `scripts/lib/gate_discovery.mjs`, `scripts/lib/gate_select_plan.mjs`
and `scripts/lib/test_visibility.mjs`, all pinned by `tests/gate_select_plan.test.ts`.

### Nightly full gate (scheduled backstop)

`.github/workflows/nightly.yml` re-proves the tips of `main` and the highest
`release/vX.Y.Z` branch (the `v` is optional) every night: the full unsharded test suite, the serialized
checks lane (mirroring ci.yml's release-checks run steps), and the Chromium browser
lane, per ref. It exists because a red release tip once sat unwatched for days while
every open PR inherited its failures; push runs show rot, but only to someone looking.

The verdict lands in exactly one tracking issue (label `nightly-gate`, title "Nightly
full gate is red"): created on the first red run, updated with the failed-job list on
repeat failures, closed with a recovery comment on the first green run. A run that
reports no failures but did not actually complete its lanes counts as red ("unproven"),
never as recovery. A `workflow_dispatch` with the `ref` input gates exactly that ref and
reports under the separate `nightly-gate-drill` identity, so acceptance drills never
touch the production issue; nothing scheduled drains a red drill's issue, so close it
by hand or finish the drill with a green dispatch at the same ref.

Deliberate exclusions: the release-i18n 21-locale lane (expected red mid-cycle, issue
#2820) and the release version gate (cannot rot without a push, which ci.yml covers).
GitHub registers a workflow's cron AND its `workflow_dispatch` surface from the default
branch, so neither can fire until the file reaches `main` with a release merge; the
first drill and the first manual pass both come after that.
Planning logic: `scripts/lib/nightly_plan.mjs`, pinned by `tests/nightly_plan.test.ts`;
the workflow shape is pinned by `tests/nightly_workflow.test.ts`.

### Judgment review

Reasoning is required for determinism, host parity, server authority, persistence,
localization, rendering and UI seams, mobile behavior, graphics fairness, content
fidelity, security, performance, and decisive coverage.

- Claude Code uses `/qa` (`.claude/skills/qa/`), `qa-checklist`, and `.claude/agents/`.
- Codex uses `$woc-qa` (`.agents/skills/woc-qa/`) and `.codex/agents/`.

The coordinator establishes one diff and runs commands once. It dispatches only relevant
read-only reviewers, gives them the shared evidence, and verifies consequential findings
before reporting readiness.

## Reviewer coverage

| Concern | Claude role | Codex role |
|---|---|---|
| Simulation architecture | `architecture-reviewer` | `woc_sim_architecture` |
| Cross-host parity | `cross-platform-sync` | `woc_cross_platform` |
| Persistence and migrations | `migration-safety` | `woc_persistence` |
| Database performance | `database-performance-reviewer` | `woc_database_performance` |
| Privacy and security | `privacy-security-review` | `woc_security` |
| Decisive tests | `test-coverage-auditor` | `woc_test_coverage` |
| Frontend and graphics | `frontend-seam-reviewer` | `woc_frontend` |
| Release malware | `release-malware-audit` | `woc_release_malware` |

These roles encode non-obvious review heuristics. Canonical architecture stays in root
and local `CLAUDE.md` files. Persistence review owns compatibility, save/load shape, and
rollback safety. Database-performance review owns query cadence, cardinality, plans,
indexes, pool pressure, locks, timeout scope, write amplification, driver/dependency upgrades,
PostgreSQL engine/resource/configuration/topology changes, and production-scale observability.
Dispatch both when both sets of risk apply.

## Keep the gate current

When architecture changes, update the applicable reviewer and tests in the same change.
Anchor guidance on stable paths, symbols, seams, and gate names, not line counts. Add a
new specialist only when a concern is large enough to need focused judgment and is not
already protected by a deterministic test.

## Trust

Project hooks execute local shell with the user's permissions. Review changes before
trusting them. Each runtime snapshots only the hook registration at startup; the scripts
themselves are read when a hook fires, so review script edits like any other executable
change. The scripts are small, local, and non-networked; CI and the release malware
audit remain the enforcement layer.

To disable the clone's pre-push floor, use `git config --unset core.hooksPath`. Claude
Code can additionally use its local hook setting. Codex hook trust is managed with
`/hooks`.
