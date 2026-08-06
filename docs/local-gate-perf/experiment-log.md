# Experiment log

Append-only. Every try gets a row even when dropped.

Columns: date, phase, experiment, before, after, platform, keep/drop, notes.

| Date | Phase | Experiment | Before | After | Platform | Keep/Drop | Notes |
|---|---|---|---|---|---|---|---|
| 2026-08-02 | 1 | baseline capture + gate_profile harness | n/a | full gate 336.3s, vitest 277.5s, workers 8 | M1 darwin/arm64 16c/128GiB Node 26.5 npm 11.17 SHA 2a79ba8a0d | keep | Required foundation; see baselines.md and detail below |
| 2026-08-02 | 2 | gate i18n/wiki generate-once + pretest skip + build:bundle | triple i18n / double wiki; full gate 336.3s | single gen path; ~5s artifact save; composite gate 291.5s | M1 darwin/arm64 16c/128GiB | keep | Option C+B; see detail below |
| 2026-08-02 | 3 | gate:fast + GATE_WORKER_TIER presets | day-loop ~= full gate 291.5s or ad-hoc | gate:fast 25.4s; full gate still merge bar | M1 darwin/arm64 16c/128GiB | keep | related not --changed default; see detail |
| 2026-08-02 | 4 | experimental.fsModuleCache in vite.config test | full cold ~245-277s (prior); multi-file no-cache transform ~3-5s | full cold 252.8s green / warm 241.3s; multi-file transform 1.4s cold / 0.45s warm | M1 darwin/arm64 16c/128GiB vitest 4.1.10 | keep | Default path under node_modules; see detail |
| 2026-08-02 | 4 | npm scripts test:related + test:changed | ad-hoc npx vitest related/changed only | package scripts + docs; gate:fast still owns day-loop orchestration | M1 | keep | Align with Phase 3; do not duplicate gate:fast |
| 2026-08-02 | 4 | optional @vitest/ui dependency | n/a | not added | M1 | drop | Opt-in DX only; would bloat default install; re-open later if needed |
| 2026-08-02 | 5 | add happy-dom@20.11.1 devDependency | jsdom only | happy-dom + jsdom both present | M1 vitest 4.1.10 | keep | Vitest first-class env; needed before pragma migration |
| 2026-08-02 | 5 | pilot 10 UI/admin files to happy-dom | n/a | 9/10 green; form_draft CSS selector gap | M1 | partial | Keep pilot path; form_draft stays jsdom |
| 2026-08-02 | 5 | migrate remaining jsdom pragmas to happy-dom | 112 jsdom files | 103 happy-dom + 9 jsdom exceptions | M1 | partial keep | Per-file pragmas (repo pattern); see exceptions in baselines |
| 2026-08-02 | 5 | localStorage setup under happy-dom | Node 22+ broken global | setup still green | M1 | keep | No setup change required beyond comment |
| 2026-08-02 | 5 | package-lock asset source-fingerprint remint | seal suites red after lock add | fingerprint-only GLB stamp + pin sweep green | M1 | keep (required side effect) | Sizes unchanged; not a geometry rebuild |
| 2026-08-02 | 6 | pool threads vs forks (full suite, maxWorkers=4) | forks 443.2s green | threads 434.1s, 2 fails (process.chdir) | M1 vitest 4.1.10 | drop | ~2% wall, correctness break; keep default forks |
| 2026-08-02 | 6 | vitest projects unit vs integration | n/a | not justified | M1 | drop | No measured full-suite win after threads/isolate drops |
| 2026-08-02 | 6 | isolate:false pure-approx (904 no-sim-import files) | isolate true 115.4s green | isolate false 70.0s, 71 files fail + worker crash | M1 | drop | Faster but unsafe; not a proven pure project |
| 2026-08-02 | 6 | isolate:false 20 pure helper files | isolate true 1.69s | isolate false 1.17s green | M1 | drop (too small) | ~0.5s absolute; not worth projects scaffold |
| 2026-08-02 | 6 | fileParallelism / maxWorkers note | defaults true; gate passes --maxWorkers | no config change | M1 | drop (no change) | gate_workers remains sole worker policy |
| 2026-08-02 | 7 | pnpm full migration + shared store | secondary npm ci ~59s | 2nd worktree pnpm hoisted ~14s (~4x); CI on pnpm frozen-lockfile | M1 darwin/arm64 Node 26.5 pnpm 10.34.5 | keep | Option A single lockfile; Corepack not required; see detail |
| 2026-08-02 | 8 | turbo task cache for pure gate artifacts | no task cache; pure steps always re-run (~24s multi-task cold) | warm pure multi-task 87ms FULL TURBO; catalog touch misses i18n | M1 darwin/arm64 Node 26.5 pnpm 10.34.5 turbo 2.10.8 | keep | wireit dropped; tests never cached; see detail |
| 2026-08-02 | 9 | EMPTY_TEST_WORLD for professions Guild-letter suites | guild_letter 54.0s; delivery_kind 26.3s | 1.1s; 0.7s | M1 vitest 4.1.10 | keep | reuse sim_shared EMPTY; same assertions |
| 2026-08-02 | 9 | EMPTY_TEST_WORLD for tank crit-immunity fights | warrior pair 31.4s | 0.8s (all three pairs ~0.7-0.8s) | M1 vitest 4.1.10 | keep | 240s tick window, hand-spawned wolf only |
| 2026-08-02 | 9 | EMPTY_TEST_WORLD for mail expiry + instance | mail_expiry 40.6s; instance ~18s (P1) | 1.4s; 2.8s | M1 vitest 4.1.10 | keep | mailboxes via BUILTIN services |
| 2026-08-02 | 9 | stable_horse-only world for stable_yard | 12.7s | 0.7s | M1 vitest 4.1.10 | keep | 200s wander without continent AI |
| 2026-08-02 | 9 | EMPTY_TEST_WORLD for corpse_harvest_sim | 14.2s | n/a (reverted) | M1 | drop | breaks hunted seed pins / concentration literals |
| 2026-08-02 | 9 | architecture/malware scan double-walk pass | architecture 0.5s | no change | M1 | drop (not a top offender) | separate roots once each; no double walk |
| 2026-08-02 | 10 | turbo-test 0.3.14 full suite --jobs 8 | vitest ~241-401s green (hist/contended) | turbo wall 126s, 14954 pass / 1775 fail / 511 load-err | M1 darwin/arm64 16c Node 26.5 | drop (not default) | ~2x wall but ~41% files red; bare V8 Node gaps |
| 2026-08-02 | 10 | turbo-test pure gate helpers (5 files) | vitest 72/72 in 0.91s | 46 pass, 3 load-err, wall 20ms | M1 | drop as default | fast but incomplete Node ESM/mjs |
| 2026-08-02 | 10 | pin turbo-test in pnpm-lock | green fingerprints | Eastbrook/tank fingerprint fails | M1 | drop (no permanent dep) | lockfile is asset fingerprint leaf; use npx --yes only |
| 2026-08-02 | 10 | Bun 1.3.14 native `bun test` pure helpers | vitest 0.91s | 72/72 in 65ms | M1 | drop as default | works on pure unit; not full suite |
| 2026-08-02 | 10 | bunx vitest pure set (12 files) | node vitest 2.20s | bunx 2.50s both 128/128 | M1 | drop | no wall win as vitest host |
| 2026-08-02 | 10 | Deno as runner | n/a | not installed on host | M1 | drop | expected skip |
| 2026-08-02 | 11 | platform + tier matrix docs | gaps undocumented | platform-matrix.md; macOS verified; Linux/Windows smoke | M1 + CI-L1 proxy | keep | no large script rewrite; biome format fix only |
| 2026-08-02 | 11 | gate:fast revalidation | Phase 3 ~25s | default 28.6s (8w); low tier 22.7s (2w) | M1 darwin/arm64 | keep | day-loop still well under agent band |
| 2026-08-03 | 12 | final QA full gate + gate:fast | packet complete | gate PASS 505.3s (8w load); gate:fast ~8s clean; pins green | M1 darwin/arm64 Node 26.5 pnpm 10.34.5 | keep | Option A keep packet dir; Dockerfile pnpm fix |
| 2026-08-03 | 12 | Dockerfile npm ci -> pnpm frozen | package-lock COPY (broken post-P7) | pnpm@10.34.5 + pnpm-lock + .npmrc | Dockerfile / deploy pin | keep | QA blocker; pin in deploy_node_version |

## Detail template (copy below for long notes)

### YYYY-MM-DD - Phase N - short title

- Hypothesis:
- Change:
- Commands:
- Before metrics:
- After metrics:
- Pass/fail:
- Decision: keep | drop | defer
- Follow-ups:

---

### 2026-08-02 - Phase 1 - baseline harness and M1 capture

- Hypothesis: A small, Windows-safe measurement tool plus filled baselines will
  make later phase keep/drop decisions evidence-based.
- Change: Added `scripts/gate_profile.mjs` and pure helpers in
  `scripts/lib/gate_profile.mjs` (+ `.d.mts`), tests in `tests/gate_profile.test.ts`.
  No change to worker defaults, vitest pool, or package manager.
- Commands:
  - `npx vitest run tests/gate_profile.test.ts`
  - `node scripts/gate_profile.mjs --help`
  - `node scripts/gate_profile.mjs --facts`
  - `node scripts/gate_profile.mjs --vitest-slow --top 20 --json-out tmp/gate-profile-phase1.json --continue-on-error`
  - `npm ci` (warm cache install timing)
- Before metrics: n/a (no prior measured baseline on this machine)
- After metrics (M1):
  - Full profile total: 336.3 s (all steps ok)
  - Vitest: 277.5 s (1951 files, 24739 tests, success)
  - Browser: 4.9 s; types: 4.5 s; client build: 10.3 s; sfx check: 24.5 s
  - Top slow file: `tests/professions_trend_guild_letter.test.ts` ~57 s
  - Warm `npm ci`: 8.7 s
- Pass/fail: harness unit tests pass; full profile exit 0
- Decision: keep
- Follow-ups:
  - Phase 2: dedupe i18n/wiki regeneration across gate/pretest/build
  - Phase 9: investigate top slow files (professions trend, sfx export, mail expiry)
  - Measure cold empty-store install and second-worktree install in Phase 7
  - Capture a mid/low tier machine when available

---

### 2026-08-02 - Phase 2 - gate orchestration dedupe

- Hypothesis: One `npm run gate` regenerates i18n (and wiki) three times; generate
  once, enforce freshness, and skip redundant pretest/build gens without hurting
  standalone `npm test` / `npm run build`.
- Change:
  - `scripts/pretest.mjs` + pure `shouldSkipPretest` (`scripts/lib/gate_artifact_skip.mjs`)
  - gate runs `i18n:gen` -> freshness -> `wiki:content`, then vitest with
    `WOC_SKIP_PRETEST=1`, then `build:bundle`
  - package.json: `build:bundle` split; `build` = gen + bundle; `pretest` -> node script
  - gate_profile step list mirrors gate; pins in `tests/gate_artifact_skip.test.ts`
  - Fix Phase 1 type pin: `collectMachineFacts` osApi platform/arch accept functions
- Commands:
  - `npx vitest run tests/gate_artifact_skip.test.ts tests/gate_profile.test.ts tests/ci_workflow.test.ts`
  - `npm run check:types`
  - microbench: i18n:gen, wiki:content, pretest skip/full, build:bundle vs build
  - `node scripts/gate_profile.mjs --vitest-slow` (vitest green, pretest skip logged)
  - `node scripts/gate_profile.mjs --skip-vitest` (types + builds green after type fix)
- Before metrics: i18n 3x, wiki 2x; Phase 1 full gate 336.3s / client build 10.3s
- After metrics:
  - pretest skip 0.02s vs full pretest 2.72s
  - build:bundle 7.2s vs full build 10.0s
  - client build in gate profile 7.5s
  - vitest 245.4s with `[pretest] skip` line present
  - composite full gate 291.5s (rest 46.1 + vitest 245.4); ~5s attributed to dedupe
- Pass/fail: unit tests + typecheck + env/server/client builds green; full vitest
  suite green under gate skip; freshness still enforced
- Decision: keep
- Follow-ups:
  - Phase 3: tiered gate:fast
  - Optional: CI shard pretest still multiplies i18n gens (out of Phase 2 local scope)

---

### 2026-08-02 - Phase 3 - tiered local gate + worker presets

- Hypothesis: Agents need a high-signal day-loop path under a few minutes, while
  full gate stays the obvious merge bar; low/medium machines need documented worker
  caps that never remove the free-mem clamp.
- Change:
  - `npm run gate:fast` -> `scripts/gate_fast.mjs` (malware, biome changed, architecture
    + localization guards, incremental `check:ts`, vitest related to dirty sources/tests)
  - Pure plan in `scripts/lib/gate_fast_plan.mjs` (classify paths; skip package.json
    expansion; opt-in `GATE_FAST_BASE` for branch-wide `--changed`)
  - `GATE_WORKER_TIER=low|medium|high` caps in `computeGateWorkers` after free-mem clamp
  - Docs: `docs/qa-gate.md`, `docs/local-gate-perf/tier-workers.md`, CONTRIBUTING pointer
  - Pins: `tests/gate_workers.test.ts`, `tests/gate_fast_plan.test.ts`
- Commands:
  - `npx vitest run tests/gate_workers.test.ts tests/gate_fast_plan.test.ts`
  - `npm run gate:fast` (timed)
  - Rejected probe: default `--changed` vs release / bare `--changed` with dirty package.json
- Before metrics: day-loop effectively full gate ~291.5s (Phase 2) or ad-hoc pre-push
- After metrics (M1):
  - gate:fast **25.4s** PASS (workers 8; related mode; package.json not expanded)
  - Rejected default using vitest `--changed` ~241s (~full suite) when package.json dirty
- Pass/fail: unit tests green; gate:fast green; full gate not re-run this phase
  (Phase 2 composite still the full-gate reference; labeled partial)
- Decision: keep
- Follow-ups:
  - Phase 4: vitest warm path / fsModuleCache / related helper polish
  - Owner OPEN: gate:fast never replaces pre-push or merge bar without state.md sign-off
  - Optional: time full `npm run gate` once after Phase 3 lands on a quiet machine

---

### 2026-08-02 - Phase 4 - Vitest warm path (fsModuleCache + related scripts)

- Hypothesis: Vitest 4.1 `experimental.fsModuleCache` speeds warm re-runs and
  related loops without flaking the full suite; thin `test:related` /
  `test:changed` scripts make the CLI convenient without replacing `gate:fast`.
- Change:
  - `vite.config.ts` `test.experimental.fsModuleCache: true` (default store
    `node_modules/.experimental-vitest-cache`)
  - package.json: `test:related`, `test:changed`
  - `.gitignore` explicit cache path entries (also covered by `node_modules/`)
  - Docs: `docs/qa-gate.md`, CONTRIBUTING, `tier-workers.md`, packet baselines
  - Did **not** add `@vitest/ui` (drop)
- Commands:
  - Multi-file rep set (5 files, 100 tests) with and without cache
  - `WOC_SKIP_PRETEST=1 npx vitest run --maxWorkers=8` cold after `--clearCache`, then warm
  - `npm run test:related -- --maxWorkers=8 scripts/lib/gate_fast_plan.mjs` cold/warm
  - `npm run gate:fast` smoke after config change
  - Rejected concurrent `--clearCache` mid-suite (ENOENT storm; operator error, not a product flake)
- Before metrics (M1, multi-file no-cache CLI false):
  - cold Duration 1.56s (transform 3.14s); warm Duration 1.99s (transform 4.83s, no help)
- After metrics (M1, cache on):
  - multi-file cold Duration 1.02s (transform 1.39s); warm ~0.74s (transform ~0.45s)
  - full suite cold after clear: **252.8s** Duration, 1945 files / 24693 tests PASS
  - full suite warm: **241.3s** Duration (~11s / ~4% wall; transform 62s -> 46s)
  - related `gate_fast_plan.mjs`: Duration cold 362ms -> warm 177ms; wall real ~14s both
    (import-graph discovery dominates small related walls)
  - related `src/sim/rng.ts`: expands to ~899 files (~236-258s); not a day-loop default
  - `gate:fast` after change: **8.5s** PASS (workers 8; docs-only dirty set skipped vitest related)
  - cache dir size ~3.8 MiB
- Pass/fail: full suite green with cache; no wrong pass/fail attributed to cache when
  used alone. Concurrent clearCache during a suite is unsafe (document only).
- Decision:
  - **keep** `experimental.fsModuleCache`
  - **keep** `test:related` / `test:changed` scripts + docs
  - **drop** `@vitest/ui` for this phase
- Follow-ups:
  - Phase 5 happy-dom
  - Do not treat warm/related/`gate:fast` as merge bar
  - Optional: document "never clearCache while another vitest is running"

---

### 2026-08-02 - Phase 5 - happy-dom for DOM tests (partial keep)

- Hypothesis: Vitest-first-class happy-dom is faster than jsdom for the ~112
  `// @vitest-environment jsdom` files without rewriting UI tests.
- Change:
  - devDependency `happy-dom@^20.11.1` (jsdom kept)
  - 103 test files: pragma `jsdom` -> `happy-dom`
  - 9 explicit jsdom exceptions (API gaps: `window.confirm`/`alert`, selectors,
    `DOMTokenList` prototype spies, click/draggable/datetime)
  - Comments on `tests/jsdom_local_storage_setup.ts`, `tests/admin/_setup.ts`,
    `vite.config.ts` setupFiles note both DOM envs
  - Lockfile-driven fingerprint-only remint of 13 shipping GLBs (Eastbrook + tank),
    media manifest regen, polish provenance remint, pin updates
- Commands:
  - Baseline: `WOC_SKIP_PRETEST=1 npx vitest run --maxWorkers=8` on the 112 DOM files
  - Pilot batches; bulk pragma migration; exception reverts
  - `node tmp/remint_source_fingerprints.mjs` (not committed); polish remint script;
    `node scripts/build_media_manifest.mjs generate`
  - Asset seal suite + DOM suite + full suite recheck
- Before metrics (DOM subset, all jsdom): Duration **16.68s**, environment **31.09s**
- After metrics (103 happy-dom + 9 jsdom):
  - cold Duration **14.69s**, environment **14.48s** (~2s / ~12% wall; ~2.1x env)
  - warm Duration **10.53s**, environment **14.22s**
  - DOM 112 files / 1110 tests PASS
- Pass/fail: DOM green; asset seals green after remint; admin/svelte mostly happy-dom
- Decision: **partial keep** (not full drop, not 100% migration)
- Follow-ups:
  - Phase 6 pool/projects/isolation
  - Optional later: polyfill `window.confirm`/`alert` or selector gaps to shrink exceptions
  - Full gate remains merge bar; happy-dom is not a merge-bar change by itself

---

### 2026-08-02 - Phase 6 - pool / projects / isolation

- Hypothesis: Vitest 4.1 `pool: 'threads'`, optional projects split, and carefully
  scoped `isolate: false` can cut full-suite or pure-unit wall without flakes.
- Change attempted: **none kept.** Default remains `pool: 'forks'` (Vitest 4.1
  default), `isolate: true`, no `projects` array, `fileParallelism` default true.
  Free-mem clamp in `computeGateWorkers` unchanged. No dead experimental config left
  in `vite.config.ts`.
- Vitest 4.1 APIs used (current docs): `--pool=threads|forks` (default forks);
  `--isolate` / `--no-isolate`; `--fileParallelism` / `--no-file-parallelism`;
  multi-pool routing is via **projects** (not legacy `poolMatchGlobs`). Threads
  cannot use `process.chdir()`; native modules (e.g. sharp in some tests) prefer forks.
- Commands (all under `WOC_SKIP_PRETEST=1`, pinned `maxWorkers=4` for A/B fairness
  while free RAM was low at start):
  - Full suite forks: `npx vitest run --pool=forks --maxWorkers=4`
  - Full suite threads: `npx vitest run --pool=threads --maxWorkers=4`
  - Pure-approx 904 files (no `src/sim/` import, no DOM pragma): isolate true/false
  - 20 pure helpers: isolate true/false on forks and threads
  - Phase 1 top-10 heavies x2 under default forks
- Before metrics (forks full suite, maxWorkers=4):
  - Duration **443.15s**, real **443.91s**, PASS 1945 files / 24693 tests
  - transform 10.84s, setup 171.92s, import 448.67s, tests 1006.18s, env 12.47s
- After metrics (threads full suite, maxWorkers=4):
  - Duration **434.11s**, real **434.98s**, **FAIL** 1 file / 2 tests
  - Failure: `tests/server/env_bootstrap.test.ts` (`process.chdir` not supported in workers)
  - setup 138.67s, import 424.03s slightly better; ~**9 s / ~2%** wall
- Pure-approx isolate:
  - true: **115.39s** PASS (896+8 skip)
  - false: **69.95s** wall but **71 failed files / 602 failed tests** + worker crash
  - 20-file pure helpers: 1.69s -> 1.17s green (too small for projects)
- Heavy top-10 (default forks):
  - Run 1: **154.5s** PASS 10/10
  - Run 2 under loadavg ~47-60: timeouts on mail_expiry / eastbrook / sfx_export;
    solo retries still timed out. Treated as **machine contention**, not pool
    regression (full suite forks earlier was green; no config kept that could flake).
- fileParallelism: gate and gate:fast already pass `--maxWorkers=${workers}` from
  `computeGateWorkers` (CPU/2, free-mem clamp, optional `GATE_WORKER_TIER` cap,
  `GATE_MAX_WORKERS` override). With default `fileParallelism: true`, maxWorkers is
  the concurrent file-worker count. No measured reason to force serial files.
- Pass/fail: kept config (status quo) full suite green under forks; experimental
  arms dropped on correctness or insufficient win.
- Decision: **drop all Phase 6 config changes**; ledger = keep Vitest defaults +
  existing gate worker policy.
- Follow-ups:
  - Phase 7 pnpm / shared store
  - Phase 9 suite cost (top heavies) still the real wall lever
  - Optional later: rewrite `env_bootstrap` tests off `process.chdir` if threads is
    re-opened; dual projects only if a **proven** pure set survives isolate:false audit

### 2026-08-02 - Phase 7 - pnpm + shared store for worktrees

- Hypothesis: pnpm content-addressable store makes multi-worktree installs much
  cheaper than per-worktree `npm ci`, and a deliberate full migration keeps CI
  and lockfile policy single-source.
- Change (keep):
  - `packageManager: pnpm@10.34.5` (latest 10.x; deliberately not pnpm 11);
    `pnpm-lock.yaml` only (removed `package-lock.json`)
  - Install path: `npm install -g pnpm@10.34.5` (Corepack not required; same on
    macOS/Linux/Windows). CI: `pnpm/action-setup@v4` with the same pin.
  - `.npmrc`: `node-linker=hoisted`, `auto-install-peers=true`,
    `strict-peer-dependencies=false`
  - `package.json` `pnpm.onlyBuiltDependencies` for native/binary install scripts
  - CI: `cache: pnpm` + `pnpm install --frozen-lockfile`
  - Gate dep-sync / SFX messages point at `pnpm install --frozen-lockfile`
  - `release_version` no longer rewrites a lockfile version field (pnpm has none)
  - malware scan accepts `pnpm-lock.yaml` (YAML line scan for non-registry sources)
  - CONTRIBUTING multi-worktree + cross-platform notes; DEPLOY docker type-check
    uses `npm install -g pnpm@10.34.5` then frozen install
  - Fingerprint leaf `package-lock.json` -> `pnpm-lock.yaml`; size-preserving GLB
    remint + polish seal re-pins
- Dropped mid-experiment: default isolated linker (broke `@gltf-transform/core` /
  `meshoptimizer` transitive imports used by asset scripts). Hoisted linker keeps
  the shared store win.
- Commands:
  - secondary `npm ci` timing; `pnpm import`; multi-worktree `pnpm install --frozen-lockfile`
  - targeted vitest for CI/release/assets/dep-sync; full gate under pnpm
- Before metrics: secondary npm ci ~59s (warm cache)
- After metrics: second worktree pnpm (hoisted, warm store) ~14s
- Pass/fail: phase test set green; full `pnpm run gate` green with GATE_MAX_WORKERS=4 (~682s, multi-session machine; 8-worker runs hit timeout flakes under concurrent load, same free-mem clamp story)
- Decision: keep
- Follow-ups: Phase 8 task cache; bump `packageManager` + CI pin together when
  moving pnpm versions

### 2026-08-02 - Phase 8 - task cache (turbo)

- Hypothesis: pure artifact gate steps (i18n, wiki, sfx check, types, builds)
  can skip when inputs are unchanged via a task graph cache, while vitest and
  security/biome always re-run so failures are never hidden.
- Change (keep):
  - **Tool: turbo 2.10.8** (not wireit). Rationale: multi-task parallel CLI,
    precise inputs/outputs, local disk cache, no rewrite of every package.json
    script to `"wireit"`. Wireit remains a valid lighter alternative if turbo
    becomes a maintenance burden.
  - Root `turbo.json` with cacheable tasks + `cache: false` on test/malware/biome
  - `scripts/lib/gate_task_cache.mjs` inventory + `turboRunArgs`
  - `scripts/lib/gate_steps.mjs` shared merge-bar step list (gate + profile)
  - `scripts/gate.mjs` uses turbo for pure steps; parallel
    `check:types` // `build:env` // `build:server`; vitest/malware/biome via npm
  - Phase 2 generate-once preserved (WOC_SKIP_PRETEST, build:bundle, freshness)
  - Docs: `docs/local-gate-perf/task-cache.md`, qa-gate + CONTRIBUTING pointers
  - Tests: `tests/gate_task_cache.test.ts` + updated profile/artifact pins
- Dropped: wireit (not installed).
- Commands:
  - `npx turbo run i18n:gen wiki:content sfx:check check:types build:env build:server build:bundle`
  - catalog touch under `src/ui/i18n.catalog/**` then re-run `i18n:gen`
  - unit: `npx vitest run tests/gate_task_cache.test.ts tests/gate_artifact_skip.test.ts tests/gate_profile.test.ts`
  - full: `pnpm run gate`
- Before metrics: pure multi-task always-execute ~24s cold wall (post-install machine)
- After metrics:
  - Warm pure multi-task: **87ms**, `Cached: 7/7`, `FULL TURBO`
  - Cold pure multi-task (empty `.turbo` after prior partial populate): ~24s
  - Catalog blank-line touch: `i18n:gen` **cache miss** (~2.6s) after prior hit (22ms)
  - Parallel force `check:types build:env build:server` ~5.3s vs sequential sum
    ~6.3s (~1s overlap; types dominate)
- Pass/fail: unit pins green; typecheck green; cache bust correctness green;
  asset fingerprint remint after `turbo`/`pnpm-lock` leaf change (same recipe as
  Phase 7); full gate green under `GATE_MAX_WORKERS=4`
- Decision: **keep**
- Follow-ups: Phase 9 suite cost; optional remote turbo cache is out of scope

---

### 2026-08-02 - Phase 9 - suite cost reduction (subsystem worlds)

- Hypothesis: Phase 1 top slow files spend most wall time on full-world Sim
  construction and continent-wide AI during long tick windows (90s mail, 240s
  tank fights, 200s horse wander). The established subsystem-world pattern
  (`EMPTY_TEST_WORLD` in `tests/sim_shared.ts`, social/dot/combo suites) can
  cut that without weakening assertions when tests only need PostOffice,
  hand-spawned mobs, or ambient horses.
- Change (kept):
  - `tests/professions_trend_util.ts` `makeWorld()` -> `EMPTY_TEST_WORLD`
  - `tests/tank_crit_immunity_util.ts` `critsTaken()` -> `EMPTY_TEST_WORLD`
  - `tests/mail_expiry.test.ts` + `tests/mail_instance.test.ts` -> `EMPTY_TEST_WORLD`
  - `tests/stable_yard.test.ts` -> `STABLE_TEST_WORLD` (stable_horse camps only)
- Dropped:
  - `corpse_harvest_sim.test.ts` empty world: 36 pin failures (hunted seeds and
    #2514 concentration literals depend on full-world construction rng draws)
  - architecture scan rewrite: file ~0.5s, not a top-20 offender; walks are
    per-root once, not double walks of the same tree
- Commands:
  - Before: `WOC_SKIP_PRETEST=1 npx vitest run` on guild_letter, delivery_kind,
    mail_expiry, tank_crit warrior (JSON `tmp/phase9-before.json`)
  - After + flake: same files twice, plus all professions_trend_* + all three
    tank pairs + stable_yard + mail_instance (`tmp/phase9-final.json`)
- Before/after file wall (M1, unloaded-ish single-file/group runs):

  | File | Before ms | After ms | Ratio |
  |---|---:|---:|---:|
  | professions_trend_guild_letter | 54029 | ~1080 | ~50x |
  | professions_trend_delivery_kind | 26306 | ~675 | ~39x |
  | mail_expiry | 40557 | ~1437 | ~28x |
  | mail_instance | ~18194 (P1) | ~2765 | ~7x |
  | tank_crit_immunity_warrior_pair | 31430 | ~773 | ~41x |
  | tank_crit paladin/druid pairs | ~23s (P1) | ~740-790 | ~30x |
  | stable_yard | 12713 | ~700-830 | ~16x |

- Pass/fail: 68 tests across touched suites green twice; corpse suite green after
  revert (100 tests); architecture 488ms (no code change)
- Decision: **keep** subsystem-world fixtures above; **drop** corpse empty world
  and architecture rework
- Follow-ups: Phase 10 experimental runners; optional later re-hunt corpse pins
  on empty world if someone wants that mega-file win; full-suite wall sample
  deferred (file-level wins already decisive)

---

### 2026-08-02 - Phase 10 - experimental runners (turbo-test / Bun)

- Hypothesis: A Vitest-shaped native runner (turbo-test) or Bun might cut full-suite
  wall enough to justify dual-run or adopt, given author claims of 5-12x on React+jsdom
  suites. This suite is Node + Sim heavy; expected fit is weak.
- Change:
  - Spiked `@miaskiewicz/turbo-test@0.3.14` as a temporary devDependency, then
    **removed it** so `pnpm-lock.yaml` stays out of shipping asset fingerprints
  - Optional experimental scripts only (default `test` / gate unchanged):
    - `npm run test:turbo` -> `scripts/test_turbo_experimental.mjs` (`npx --yes` pin)
    - `npm run test:bun` -> `scripts/test_bun_experimental.mjs` (local `bun` binary)
  - Deno not available on the measurement host; dropped without install
- Commands:
  - `pnpm add -D @miaskiewicz/turbo-test@0.3.14` then later `pnpm remove ...`
  - `npx turbo-test --jobs 8 --reporter json` (full suite)
  - `WOC_SKIP_PRETEST=1 npx vitest run --maxWorkers=8` (same machine comparison)
  - Pure pilots: 5 gate helper files under vitest, turbo-test, `bun test`, `bunx vitest`
  - Failure sample: 20 known-red files under default turbo-test reporter
- Before metrics (Vitest, same host, maxWorkers=8, WOC_SKIP_PRETEST=1):
  - Contended full suite during spike: **401.1s real**, Duration 400.4s,
    1939 pass / 7 fail files (failures were lockfile fingerprint pins while
    turbo-test was temporarily in the lockfile; after remove, those pins green)
  - Historical quiet walls on this packet: Phase 4 cold 252.8s / warm 241.3s;
    Phase 1 277.5s
- After metrics (turbo-test 0.3.14, --jobs 8):
  - Full suite wall **125.95s real** (summary wall 125725 ms)
  - **1960 files** | **14954 passed** | **1775 failed** | **511 load-errors**
  - File statuses: **1149 passed** / **300 failed** / **511 error** (811 red files,
    ~41% of files not clean green)
  - Test-level pass rate among executed cases ~89% (14954/16729), but discovery
    and load differ from vitest (~24.7k tests on vitest), so not a 1:1 case map
  - Pure pilot (5 gate helpers): vitest 72/72 in 0.91s real; turbo 46 pass +
    3 entry load-errors in 0.20s real
- First 20 failure signatures (sample re-run + stderr buckets):

  1. `cjs compile failed: *.svelte :: SyntaxError: Unexpected token '<'` (admin Svelte;
     also `@testing-library/svelte-core` wrapper)
  2. `cjs compile failed: *.mjs :: SyntaxError: Cannot use 'import.meta' outside a module`
  3. `cjs compile failed: scripts/asset_pipeline/lib/env.mjs :: Identifier '__dirname' has already been declared`
  4. `ERROR ... (entry load failed)` with empty JSON message (511 files)
  5. `Cannot read properties of undefined (reading 'PROD')` (import.meta.env / Vite define)
  6. `Buffer.byteLength is not a function` (bare V8 Buffer surface; admin/server suites)
  7. `import_node_fs.default.mkdtempSync is not a function` (Node fs shim gaps)
  8. action_bar / admin / ai_review assertion chains fail after the above runtime gaps
  9. same PROD undefined across moderation_actions, daily_reward_event_log, navigation
  10. admin.test.ts mass fail (81 failures) dominated by Buffer.byteLength
  11. Svelte component graph never loads under CJS transform
  12. ESM scripts under `scripts/` fail CJS rewrite (`import.meta`)
  13. load-error cluster on client/HUD painters and account client modules
  14. JSON reporter omits assertion messages for error-status files
  15. Work-stealing finishes wall early relative to vitest but correctness is not close
  16. Temporary lockfile pin of turbo-test broke Eastbrook/tank sourceFingerprint tests
  17. No dual-run value: red rate too high for CI signal
  18. Author benches (React+jsdom 5-12x) do not transfer to Node+Sim+Svelte suite
  19. Isolate reuse not measured; base isolation already far from green
  20. Deno: not on PATH; skipped (expected drop)

- Bun metrics:
  - `bun test` pure 5 gate helpers: **72/72 in 65ms** real 0.07s
  - `bun test` ability_damage + utils: green (small pure units)
  - `bunx vitest run` 12 pure files: 128/128 in 2.50s vs node vitest 2.20s (no win)
  - Full-suite `bun test` not adopted; native runner is not a vitest config drop-in
    for the whole tree (and no wall win when hosting vitest)
- Pass/fail: default vitest path restored green for asset fingerprint suite after
  removing the temporary turbo-test dep; experimental scripts only
- Decision: **not default** (drop as gate/CI runner; trying and measuring is success)
  - Do **not** dual-run in CI
  - Do **not** switch `package.json` `test` or `gate.mjs`
  - Keep optional experimental scripts for future re-spikes without lockfile noise
- Follow-ups:
  - Phase 11 tier matrix
  - Owner would need a near-100% green turbo-test or Bun story before reopening adopt

---

### 2026-08-02 - Phase 11 - cross-platform and machine-tier matrix

- Hypothesis: Contributors and agents need a single place that says which command
  to run by tier and role, and an honest Windows/macOS/Linux status (verified vs
  smoke vs untested) without reopening Phase 10 runners.
- Change:
  - New `docs/local-gate-perf/platform-matrix.md` (OS matrix, machine inventory
    aliases, "Which command should I run?" for human/agent/low/high)
  - `baselines.md` inventory: M1 + CI-L1 (GHA ubuntu-latest 4 vCPU / 16 GB, low
    tier proxy) + empty W1 Windows slot
  - Short pointers in `docs/qa-gate.md`, `CONTRIBUTING.md`, `tier-workers.md`
  - Small in-scope fix: Biome format on `scripts/test_turbo_experimental.mjs`
    (Phase 10 leftover blocking `gate:fast` biome step)
  - No large cross-platform script rewrite; win32 `shell: true` already present
    on gate / gate_fast / gate_profile / pretest
- Commands:
  - `git fetch origin release/v0.34.0 && git merge` (already up to date)
  - `node scripts/gate_profile.mjs --facts`
  - `node scripts/gate_profile.mjs --dry-run --skip-browser`
  - `pnpm run gate:fast` (default workers)
  - `GATE_WORKER_TIER=low pnpm run gate:fast`
  - `npx @biomejs/biome check --write scripts/test_turbo_experimental.mjs`
- Before metrics: OS gaps only partially noted in tier-workers; no single matrix
- After metrics (M1, freemem ~18-20 GiB, Node 26.5, pnpm 10.34.5):
  - gate:fast default **28.55s real**, workers=8, PASS
  - gate:fast `GATE_WORKER_TIER=low` **22.66s real**, workers=2, PASS
  - (Low tier not slower here because related vitest was empty/near-empty and
    fixed steps dominate; tier caps still matter for full gate under load)
  - gate_profile dry-run step list OK
- Pass/fail: macOS day-loop green; Linux install/tests proven via CI only;
  Windows untested on a real host (documented as smoke + follow-ups)
- Decision: **keep** docs matrix; do not expand into multi-OS wall campaigns
- Follow-ups:
  - Phase 12 final QA and packet close
  - Volunteer Windows host for W1 full gate / gate:fast walls
  - Optional local Linux unsharded full-gate wall (distinct from CI shards)



### 2026-08-03 - Phase 12 - final QA and packet close

- Hypothesis: The evolved local gate path is green end-to-end, docs match
  reality, and the packet can close with an explicit teardown choice.
- Change:
  - Full QA: merge origin/release/v0.34.0 (already current), pin suite, gate:fast,
    full `pnpm run gate`
  - Blocker fix from qa-checklist: Dockerfile npm ci / package-lock -> pnpm
    frozen install + packageManager pin; release_checklist wording; scripts/CLAUDE.md
    gate:fast related (not --changed default)
  - Pin: `tests/deploy_node_version.test.ts` Dockerfile pnpm contract
  - Packet close: progress/state/baselines/experiment-log; HANDOFF.md; teardown
    Option A keep docs/local-gate-perf living guidance
- Commands:
  - `pnpm exec vitest run tests/ci_workflow.test.ts tests/gate_workers.test.ts
    tests/gate_profile.test.ts tests/gate_artifact_skip.test.ts
    tests/gate_fast_plan.test.ts tests/gate_task_cache.test.ts`
  - `pnpm exec vitest run tests/deploy_node_version.test.ts`
  - `pnpm run gate:fast`
  - `pnpm run gate`
- Before metrics: Phase 11 complete; Dockerfile still broken for lockfile
- After metrics (M1, freemem ~10.5 GiB under multi-session load):
  - Full gate PASS **505.3s** real, workers 8; vitest 418.7s (1946 files /
    24702 tests pass); browser 4.2s
  - gate:fast PASS **~8s** on clean tree
  - Pin suites PASS including Dockerfile
- Pass/fail: all green; no em/en dash or emoji in packet close
- Decision: **keep** Option A; ready for PR
- Follow-ups: OPEN items in state.md / HANDOFF (Windows walls, low/medium
  baselines, optional starter trim, i18n locale CONTRIBUTING wording)

| 2026-08-03 | 12 | trim planning scaffolding | phase starters + plan/brief/progress | living docs only (8 files) | docs | keep | Option A follow-up; no code change |
| 2026-08-06 | 13 | fill medium-tier Linux baseline (L1) | only M1 high-tier + CI-L1 proxy filled | first real local Linux unsharded full-gate wall: 1210.0s total (1180.9s vitest, under heavy contention from a second concurrent vitest process, 1 timeout flake) | L1 linux/x64 16c/30.5GiB Node 26.4.0 medium tier | keep (data) | see baselines.md 2026-08-06 entry; quiet re-run still open |
| 2026-08-06 | 13 | combine i18n:gen+wiki:content+sfx:check into one turbo multi-task call | 3 separate npx turbo invocations, sequential sum 17.5s (L1) | 1 combined call, measured 10.129s wall (`--force`, 0 cached/3 total, so real overlapped work not a cache hit): 7.4s / 42% faster, matching the max(6.2,0.6,10.7)=10.7 prediction; same pattern already used for check:types/build:env/build:server/build:bot | L1 | keep | scripts/lib/gate_steps.mjs; PRE_VITEST_STEP_NAME now 'biome (changed files)'; tests/gate_task_cache.test.ts + tests/gate_profile.test.ts updated |
| 2026-08-06 | 13 | verify Turborepo >=2.8 auto-shares local cache across git worktrees | assumed each fresh worktree (this repo's own mandated per-task workflow) pays turbo's full cold-cache cost | confirmed empirically: turbo run from a linked worktree wrote new cache entries into the MAIN checkout's .turbo/cache, not the worktree's own; already active (turbo 2.10.8, no cacheDir override) | L1 | keep (verify + guard, no behavior change) | added tests/gate_task_cache.test.ts "git worktree cache sharing" (turbo version floor + no cacheDir pin); https://turborepo.dev/blog/2-8 |
| 2026-08-06 | 13 | NODE_COMPILE_CACHE for gate.mjs's spawned node subprocesses | no compile cache; each spawned node process (i18n gen, wiki, malware scan, vitest CLI) recompiles from scratch | measured MISS: 14-file/592-test vitest subset, user CPU time flat across no-cache (17.78/17.10/18.52s) vs warm compile-cache (17.93/17.63/18.34s) over 6 runs | L1 | drop (measured, no win) | Vitest's own TS transform runs through Vite's module-runner (already cached via experimental.fsModuleCache), not Node's native loader, so V8 bytecode caching barely touches the hot path; not implemented |

