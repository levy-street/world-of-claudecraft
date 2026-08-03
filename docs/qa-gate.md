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
| Full local gate | `npm run gate` through `scripts/gate.mjs` | Before implementation is called ready / pre-merge | Yes |
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
full gate. Vitest workers still use `computeGateWorkers` (CPU/2 and free-mem clamp).
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
`npx vitest --clearCache` if a warm run looks wrong). Most DOM-environment unit
tests use `// @vitest-environment happy-dom`; a short exception list still pins
`jsdom` where happy-dom API gaps bite (see `docs/local-gate-perf/baselines.md`
Phase 5). Default environment remains `node`.

### Full local gate

`npm run gate` (or `pnpm run gate`) is the **merge and "done" contract**. It mirrors CI:
generated i18n freshness, malware scanning, changed-file formatting, the SFX conformance
check, the full test suite, the browser regression suite (`npm run test:browser`, which
drives Chromium through Playwright), the typecheck, and env, server, and client builds.
Release branches use the release i18n tier. It stops at the first failure and bounds
Vitest workers to avoid load flakes on shared machines. It resolves FFmpeg (`ffmpeg`
and `ffprobe`) from the bundled `ffmpeg-static`/`ffprobe-static` npm packages, falling
back to PATH, and refuses to run when neither source yields a working binary.

**Task cache (Turborepo):** pure artifact steps (`i18n:gen`, `wiki:content`, `sfx:check`,
`check:types`, `build:env`, `build:server`, `build:bundle`) run through `npx turbo run`
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
