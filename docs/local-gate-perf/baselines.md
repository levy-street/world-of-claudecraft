# Baselines: local gate performance

Fill during Phase 1 and update after each phase that claims a wall win.
Use wall-clock seconds unless noted. Mark unavailable cells `n/a`.

## How to measure

Prefer the Phase 1 harness:

```bash
cd /Users/fernando/Documents/wocc-gate-perf-research

# Machine facts only
node scripts/gate_profile.mjs --facts

# Full timed gate (same steps as scripts/gate.mjs) + top-20 slow vitest files
node scripts/gate_profile.mjs --vitest-slow --top 20 --json-out tmp/gate-profile.json

# Partials (label clearly in baselines notes)
node scripts/gate_profile.mjs --skip-browser --skip-builds --vitest-slow
node scripts/gate_profile.mjs --from-json tmp/gate-profile-vitest.json --top 20

# Dry-run (no spawns)
node scripts/gate_profile.mjs --dry-run --skip-browser
```

Pure helpers: `scripts/lib/gate_profile.mjs` (pinned by `tests/gate_profile.test.ts`).
CLI entry: `scripts/gate_profile.mjs`. Vitest JSON lands at `tmp/gate-profile-vitest.json`
when `--vitest-slow` is used with timed steps.

Fallback without the harness:

```bash
/usr/bin/time -p npm run gate
npx vitest run --reporter=json --outputFile=tmp/vitest-results.json
```

Record:

- date (UTC)
- OS + arch
- CPU logical count, total RAM, free RAM at start
- Node version, package manager version
- git SHA
- GATE_MAX_WORKERS if set
- workers printed by gate / gate_profile

## Machine inventory

| Alias | OS | Arch | CPUs | RAM GB | Tier | Owner/host notes |
|---|---|---|---|---|---|---|
| M1 | darwin | arm64 | 16 | 128 GiB (137 GB decimal) | high | Fernando local; free RAM at Phase 1 start ~8.8 GiB under multi-session load; Phase 11 recheck freemem ~18-20 GiB |
| CI-L1 | linux (GHA ubuntu-latest) | x64 | 4 | 16 GB | low | Proxy only: public GitHub-hosted runner specs; CI uses 8 vitest shards + half-core maxWorkers per job, not unsharded local gate |
| W1 | win32 | n/a | n/a | n/a | n/a | No Windows baseline host this packet (smoke only; see platform-matrix.md) |
| M2 | | | | | | reserved for a future medium-tier local host |
| M3 | | | | | | reserved for a future low-tier local host |

Tier guide: low (4-8 CPUs, 8-16 GB), medium (8-12 CPUs, 16-32 GB), high (12+ CPUs, 32+ GB).
Classification is implemented in `classifyMachineTier` (both dimensions must clear the high bar;
low needs both CPUs <= 8 and RAM <= 16 GB). Full platform matrix:
`docs/local-gate-perf/platform-matrix.md`.

## Phase 0 / Phase 1 cold full gate (before packet code changes)

Measured with `node scripts/gate_profile.mjs --vitest-slow --top 20` on M1 after a
warm `npm ci` (harness itself is measurement-only; worker defaults unchanged).

| Machine | SHA | Workers | Full gate s | Vitest s | Browser s | Types s | Builds s | Notes |
|---|---|---|---|---|---|---|---|---|
| M1 | 2a79ba8a0d | 8 | 336.3 | 277.5 | 4.9 | 4.5 | 10.6 | 2026-08-02T14:57Z UTC; GATE_MAX_WORKERS unset; free RAM 8.8 GiB; builds = env 0.1 + server 0.2 + client 10.3; also dep-sync 0.3, ffmpeg probe 4.6, i18n 2.6, freshness 0.1, malware 4.2, biome 2.5, sfx 24.5; full suite PASS (1951 files, 24739 tests) |

### Phase 1 step breakdown (M1)

| Step | Seconds | Status |
|---|---:|---|
| dependency sync | 0.3 | ok |
| ffmpeg/ffprobe probe | 4.6 | ok |
| i18n artifacts | 2.6 | ok |
| i18n freshness | 0.1 | ok |
| malware scan | 4.2 | ok |
| biome (changed files) | 2.5 | ok |
| sfx check | 24.5 | ok |
| vitest (full suite) | 277.5 | ok |
| browser regressions | 4.9 | ok |
| typecheck | 4.5 | ok |
| env build | 0.1 | ok |
| server build | 0.2 | ok |
| client build | 10.3 | ok |
| **TOTAL** | **336.3** | |

Raw JSON: `tmp/gate-profile-phase1.json` (gitignored under `tmp/`).

## Vitest top slow files (Phase 1)

Source: vitest JSON reporter durations (`endTime - startTime` per file) on M1,
SHA 2a79ba8a0d, maxWorkers=8. Durations are per-file wall on a worker (parallel
suites can overlap; sum of file times exceeds suite wall).

| Rank | File | Duration ms | Machine | SHA |
|---|---|---:|---|---|
| 1 | tests/professions_trend_guild_letter.test.ts | 57070 | M1 | 2a79ba8a0d |
| 2 | tests/sfx_export_core.test.ts | 40206 | M1 | 2a79ba8a0d |
| 3 | tests/mail_expiry.test.ts | 35984 | M1 | 2a79ba8a0d |
| 4 | tests/sfx_studio_server_security.test.ts | 33755 | M1 | 2a79ba8a0d |
| 5 | tests/eastbrook_gameplay_integration.test.ts | 31873 | M1 | 2a79ba8a0d |
| 6 | tests/professions_trend_delivery_kind.test.ts | 24269 | M1 | 2a79ba8a0d |
| 7 | tests/tank_crit_immunity_druid_pair.test.ts | 23583 | M1 | 2a79ba8a0d |
| 8 | tests/tank_crit_immunity_warrior_pair.test.ts | 23257 | M1 | 2a79ba8a0d |
| 9 | tests/tank_crit_immunity_paladin_pair.test.ts | 23168 | M1 | 2a79ba8a0d |
| 10 | tests/stable_yard.test.ts | 18470 | M1 | 2a79ba8a0d |
| 11 | tests/mail_instance.test.ts | 18194 | M1 | 2a79ba8a0d |
| 12 | tests/corpse_harvest_sim.test.ts | 17041 | M1 | 2a79ba8a0d |
| 13 | tests/escort_quest.test.ts | 16958 | M1 | 2a79ba8a0d |
| 14 | tests/escort_ambush_convoy.test.ts | 15033 | M1 | 2a79ba8a0d |
| 15 | tests/terrain_streaming.test.ts | 14963 | M1 | 2a79ba8a0d |
| 16 | tests/parity/parity_g.test.ts | 14741 | M1 | 2a79ba8a0d |
| 17 | tests/professions_deeds_playthrough.test.ts | 14574 | M1 | 2a79ba8a0d |
| 18 | tests/frost_mage_procs.test.ts | 13798 | M1 | 2a79ba8a0d |
| 19 | tests/frostveil_pit_escape.test.ts | 12384 | M1 | 2a79ba8a0d |
| 20 | tests/grave_inferno.test.ts | 12104 | M1 | 2a79ba8a0d |

## Install / worktree cost (Phase 1 and Phase 7)

| Scenario | Manager | Time s | Machine | Notes |
|---|---|---:|---|---|
| Fresh install empty store | npm | n/a | M1 | Not measured (would require `npm cache clean --force`; deferred) |
| Fresh install warm cache | npm | 8.7 | M1 | `npm ci` on empty node_modules with warm global cache; 1037 packages |
| Second worktree install | npm | n/a | M1 | Deferred to Phase 7 comparison |
| Fresh install empty store | pnpm | n/a | | after P7 |
| Second worktree install | pnpm | n/a | | after P7 |

## After each phase (copy rows forward)

| Phase | Machine | Full gate s | Vitest s | Delta vs Phase 1 | Keep? |
|---|---|---:|---:|---|---|
| 1 (baseline) | M1 | 336.3 | 277.5 | 0 | keep (foundation) |
| 2 | M1 | 291.5 (composite) | 245.4 | -44.8 (see notes) | keep |
| 3 | M1 | n/a (day-loop focus) | n/a | gate:fast 25.4s vs full ~291s | keep |
| 4 warm path | M1 | n/a (vitest focus) | cold 252.8 / warm 241.3 | ~11s warm full-suite; multi-file transform 3.1s -> 0.45s | keep |
| 5 happy-dom | M1 | n/a (DOM focus) | DOM cold 14.7 / warm 10.5; full suite recheck separate | DOM subset env 31s -> 14.5s; partial keep | partial keep |
| 6 pool/projects | M1 | n/a (no keep) | forks 443s green / threads 434s red (chdir); isolate:false pure red | drop all; status quo forks+isolate | drop |
| 7 | M1 | n/a (install focus) | n/a | 2nd worktree ~4x faster (59s npm -> 14s pnpm) | keep |
| 8 cold/warm | M1 | 411.8 (load) | n/a (vitest always) | pure multi-task 24s -> 87ms warm | keep |
| 9 suite cost | M1 | n/a (file-level) | see Phase 9 table | top heavies 7-50x faster per file | keep |
| 10 runners | M1 | n/a (no default swap) | turbo 126s red; vitest ~241-401s | not default; 811/1960 files red under turbo-test | drop |
| 11 platform matrix | M1 + CI-L1 proxy | n/a (docs + gate:fast) | n/a | macOS verified; Linux smoke via CI; Windows smoke (scripts only) | keep |
| 12 final QA | M1 | **505.3** (load) | 418.7 | correctness green under multi-session load; not quiet best-case; Dockerfile pnpm keep | keep |

## Phase 12 - final QA close (after)

**Decision:** Packet complete. Teardown **Option A**: keep `docs/local-gate-perf/`
as living guidance; phase starters may trim later. Full merge bar remains
`pnpm run gate`. Experimental runners stay not default (Phase 10 lock).

### Verification walls (M1, 2026-08-03, SHA 12a1dd7c68 + Phase 12 WIP)

| Path | Wall s | Workers | Result | Notes |
|---|---:|---:|---|---|
| `pnpm run gate` | 505.3 | 8 | PASS all 10 steps | freemem ~10.5 GiB; other worktrees running vitest; vitest 418.7s (1946 pass / 8 skip files, 24702 tests); browser 4.2s; turbo pure steps mixed cache |
| `pnpm run gate:fast` | 7.98 | 8 | PASS 4 steps | clean tree (related selection thin) |
| Pin suite (gate helpers + ci + deploy_node_version) | 0.4 | default | PASS | includes Dockerfile pnpm pin |

Quiet-host reference still Phase 1/2 (~336s / ~291s composite). Phase 12 proves
green under realistic multi-session freemem pressure, not a wall win claim.

### Dockerfile install (blocker fix)

| Before | After |
|---|---|
| `COPY package.json package-lock.json` + `npm ci` | `pnpm@10.34.5` + `pnpm-lock.yaml` + `.npmrc` + `pnpm install --frozen-lockfile` |

Pin: `tests/deploy_node_version.test.ts` "installs build deps with pnpm frozen-lockfile".

See `HANDOFF.md` for PR summary and remaining OPEN.

## Target bands (aspirational, not hard CI fail)

Adjusted after Phase 1 M1 numbers (high-tier full gate already ~5.6 min when quiet).

| Path | Low tier | Medium | High |
|---|---|---|---|
| Agent day-loop (`gate:fast` / related) | under 5 min typical edit | under 3 min | under 2 min |
| Full local gate | usable overnight / CI proxy OK | under 45 min stretch goal | under 10 min stretch (M1 baseline 5.6 min; protect under load) |

Phase 1 takeaway: on a high-tier quiet-ish M1, full gate wall is already under the
old 25 min stretch. The agent pain is more likely multi-worktree free-RAM clamp,
duplicated i18n/wiki work, and day-loop needing full suite. Later phases should
still chase mid/low tiers and loaded free-mem cases, not only best-case wall.

## Phase 2 - gate orchestration dedupe (after)

**Decision:** Option C generate-once sequencing + Option B pretest env skip.

| Path | Before (one full gate) | After |
|---|---|---|
| i18n gen | 3x (gate + pretest + build) | 1x (`i18n:gen` step) |
| wiki content | 2x (pretest + build) | 1x (explicit gate step) |
| pretest under gate | always runs gens | `WOC_SKIP_PRETEST=1` no-op |
| client build | `npm run build` (gens + bundle) | `npm run build:bundle` |

Standalone `npm test` still runs full pretest. Standalone `npm run build` still runs
`i18n:gen` + `wiki:content` + `build:bundle`.

### Artifact-path microbench (M1, 2026-08-02)

| Step | Seconds |
|---|---:|
| i18n:gen | 2.45 |
| wiki:content | 0.18 |
| pretest with WOC_SKIP_PRETEST=1 | 0.02 |
| pretest full (no skip) | 2.72 |
| build:bundle | 7.20 |
| full `npm run build` (gens + bundle) | 10.02 |

Attributed gen savings per full gate: about **5 s** (skip second i18n in pretest
~2.5 s + skip third i18n/wiki in client build ~2.8 s; wiki runs once early at ~0.2 s).

### Composite full gate (M1)

Vitest suite green at 245.4 s with pretest skip logged. Non-vitest steps re-profiled
after a Phase 1 type pin fix (`collectMachineFacts` platform/arch accept functions):
all ok; client build 7.5 s via `build:bundle`. Composite total **291.5 s**
(= 245.4 vitest + 46.1 other). Vitest wall also moved ~32 s vs Phase 1 (machine
load / free-RAM variance; freemem ~6.8 GiB at end), so **do not treat the full
-44.8 s as pure Phase 2 credit**. Keep the orchestration change for correctness
and the solid ~5 s artifact win.

Raw JSON: `tmp/gate-profile-phase2.json` (vitest path; typecheck failed pre-fix),
`tmp/gate-profile-phase2-rest.json` (skip-vitest full green tail).

## Phase 3 - tiered local gate + worker presets (after)

**Decision:** Keep additive `npm run gate:fast` + `GATE_WORKER_TIER` caps. Full
`npm run gate` remains the merge bar (generate-once from Phase 2 unchanged).

### Day-loop wall (M1, 2026-08-02T17:07Z UTC, SHA 612cccc9cf + Phase 3 WIP)

| Path | Seconds | Notes |
|---|---:|---|
| Naive day-loop = full gate (Phase 2 composite) | 291.5 | Before tiered path existed |
| `gate:fast` with vitest `--changed` vs release (rejected default) | ~241 | package.json dirtiness expanded to ~1945 files; dropped as default |
| **`npm run gate:fast` (kept)** | **25.4** | malware + biome + guards + check:ts + `vitest related` on dirty sources (5 scripts + 2 tests); package.json skipped for related expansion |
| Full `npm run gate` | not re-timed | Still merge bar; Phase 2 composite 291.5s stands |

### Worker presets

| `GATE_WORKER_TIER` | Cap after free-mem clamp |
|---|---:|
| low | 2 |
| medium | 4 |
| high | 8 |
| unset | CPU/2 + free-mem only |

`GATE_MAX_WORKERS` remains expert absolute override. Free-mem clamp never removed.
Cross-OS notes: `docs/local-gate-perf/tier-workers.md`.

## Phase 4 - Vitest warm path (after)

**Decision:** Keep `experimental.fsModuleCache` in `vite.config.ts` test config and
thin npm scripts `test:related` / `test:changed`. Drop optional `@vitest/ui` for now.
Full `npm run gate` remains merge bar; `gate:fast` remains day-loop only.

### Full suite cold vs warm (M1, 2026-08-02, maxWorkers=8, WOC_SKIP_PRETEST=1)

| Run | Duration s | Transform s | Result |
|---|---:|---:|---|
| Cold after `vitest --clearCache` | 252.8 | 62.3 | 1945 files / 24693 tests PASS |
| Warm second run | 241.3 | 46.2 | same PASS (~11s / ~4% wall) |

Prior Phase 2 vitest composite was 245.4s; cold-with-cache here is within machine-load
noise of that band. Warm win is real but modest for the full parallel suite (matches
Vitest guidance: fs cache helps most on small re-runs with large module graphs).

### Multi-file representative set (5 files, 100 tests)

| Mode | Duration s | Transform s |
|---|---:|---:|
| No cache cold | 1.56 | 3.14 |
| No cache warm | 1.99 | 4.83 |
| Cache cold (after clear) | 1.02 | 1.39 |
| Cache warm | 0.74 | 0.45 |

### Related loop

| Command | Duration (vitest) | Wall real s | Notes |
|---|---:|---:|---|
| `test:related -- scripts/lib/gate_fast_plan.mjs` cold | 0.36 | ~14 | graph discovery dominates wall |
| same warm | 0.18 | ~14 | transform/setup halved |
| `test:related -- src/sim/rng.ts` | ~223-244 | ~236-259 | expands to ~899 files; not day-loop default |

### Scripts / cache path

| Item | Value |
|---|---|
| Config | `test.experimental.fsModuleCache: true` |
| Cache dir | `node_modules/.experimental-vitest-cache` (~3.8 MiB after full suite) |
| Clear | `npx vitest --clearCache` |
| `test:related` | `vitest related --run --passWithNoTests` |
| `test:changed` | `vitest run --passWithNoTests --changed` |
| `gate:fast` after change | 8.5s PASS (no code dirtiness; related step skipped) |

**Caveat:** do not run `--clearCache` while another vitest process is using the same
cache (observed ENOENT storm under concurrent clear). Not a suite correctness flake
when used single-flight.

## Phase 5 - happy-dom for DOM tests (after)

**Decision:** Partial keep. Default DOM pragma is `// @vitest-environment happy-dom`
(103 of 112 previously-jsdom files). Keep `jsdom` as a devDependency for an explicit
exception list of 9 files. Adding `happy-dom` touched `package-lock.json`, which is a
fingerprinted asset-pipeline input; fingerprint-only re-stamped Eastbrook-era shipping
GLBs (sizes unchanged) and re-pinned seals in the same change.

### DOM subset (112 files, 1110 tests, M1, maxWorkers=8, WOC_SKIP_PRETEST=1)

| Mode | Duration s | Environment s (sum) | Transform s | Result |
|---|---:|---:|---:|---|
| Baseline all jsdom (pre change) | 16.68 | 31.09 | 28.33 | PASS |
| Mixed happy-dom+jsdom cold (after clearCache) | 14.69 | 14.48 | 30.65 | PASS |
| Mixed warm | 10.53 | 14.22 | 3.02 | PASS |

Cold wall win about **2 s** (~12%) on the DOM subset; environment setup about **2.1x**
faster. Full-suite wall is dominated by sim/server files, so happy-dom is not treated
as a merge-bar change.

### Exception list (remain `// @vitest-environment jsdom`)

| File | Gap under happy-dom 20.11.1 |
|---|---|
| `tests/form_draft.test.ts` | attribute selectors with quote/bracket values fail restore |
| `tests/vendor_window_painter.test.ts` | bubbled `MouseEvent('click')` does not fire handlers |
| `tests/bags_window_instance_marker.test.ts` | `HTMLImageElement.draggable` not reflected |
| `tests/deeds_window_focus.test.ts` | escaped quote selectors rejected by querySelector |
| `tests/spellbook_tick_repaint.test.ts` | `DOMTokenList` global prototype undefined for spies |
| `tests/admin/staff_page.test.ts` | `window.confirm` missing (`vi.spyOn` fails) |
| `tests/admin/blocked_ips.test.ts` | `window.confirm` missing |
| `tests/admin/account_flair_controls.test.ts` | `window.alert` missing |
| `tests/admin/ip_associations.test.ts` | datetime-local `expiresAt` not read from input |

Admin Svelte testing-library suite: green under happy-dom except the four admin
exceptions above. `tests/jsdom_local_storage_setup.ts` still covers both environments
on Node 22+.

### Full suite recheck (M1, maxWorkers=8, WOC_SKIP_PRETEST=1, after clearCache)

| Result | Duration s | Notes |
|---|---:|---|
| PASS 1945 files / 24693 tests (8 skipped files, 74 skipped tests) | 347.0 | Machine load high (user ~2533s); not comparable to Phase 4 241-253s quiet wall. Correctness green only. |

## Phase 6 - pool / projects / isolation (after)

**Decision:** Drop all experimental config. Keep Vitest 4.1 defaults:
`pool: 'forks'`, `isolate: true`, no projects split, `fileParallelism: true`.
Worker count remains solely from `scripts/lib/gate_workers.mjs` (free-mem clamp kept).

### Full suite A/B (M1, maxWorkers=4 pinned, WOC_SKIP_PRETEST=1, vitest 4.1.10)

| Pool | Duration s | Real s | Result | Notes |
|---|---:|---:|---|---|
| forks (default) | 443.15 | 443.91 | PASS 1945 files / 24693 tests | setup 172s, import 449s, tests 1006s |
| threads | 434.11 | 434.98 | FAIL 1 file / 2 tests | `process.chdir` in `tests/server/env_bootstrap.test.ts`; ~2% faster only |

### isolate:false probes (forks, maxWorkers=4)

| Scope | isolate true | isolate false | Decision |
|---|---:|---:|---|
| 20 pure helpers | 1.69s green | 1.17s green | drop (absolute win too small for projects) |
| 904 no-sim-import files | 115.4s green | 70.0s, 71 files fail + worker crash | drop (not pure enough) |

### Projects

Not implemented. Dual unit/integration projects would only pay for themselves with a
threads or isolate:false win on a proven set; both failed the keep rules.

### Heavy top-10 flake watch (default forks)

| Pass | Result | Notes |
|---|---|---|
| 1 | PASS 10/10 in 154.5s | maxWorkers=4 |
| 2 | timeouts under loadavg ~47-60 | mail_expiry, eastbrook, sfx_export; environment contention, not a kept config change |

### fileParallelism / gate_workers

`scripts/gate.mjs` and `scripts/gate_fast.mjs` pass `--maxWorkers=${workers}` from
`computeGateWorkers`. No interaction required a config change; serial
`fileParallelism: false` would only hurt wall on multi-file runs.

## Phase 7 - package install / multi-worktree (M1)

Measured 2026-08-02 on M1 (darwin/arm64, Node 26.5, warm npm cache / warm pnpm
store as noted). Secondary worktrees under `/tmp/wocc-pnpm-*`.

| Scenario | Manager | Wall s | Notes |
|---|---|---:|---|
| Secondary worktree, empty node_modules, warm npm cache | `npm ci` | 58.95 | Baseline; 1042 packages; node_modules ~1.2G |
| First pnpm install (populate store + link), isolated linker | `pnpm install --frozen-lockfile` | 29.55 | Build scripts later allowlisted |
| Second worktree, shared store warm, isolated linker | `pnpm install --frozen-lockfile` | 38.82 | Still faster than npm; layout broke transitive imports |
| Research worktree install, `node-linker=hoisted`, warm store | `pnpm install --frozen-lockfile` | 23.17 | Chosen layout: flat node_modules + shared store |
| Second worktree, hoisted, warm store | `pnpm install --frozen-lockfile` | 14.10 | **~4.2x vs npm ci secondary** (59s -> 14s) |

Decision: keep full pnpm migration. Store path default
`~/Library/pnpm/store/v10` on this host (`pnpm store path`).

## Phase 8 - task cache turbo (M1)

Measured 2026-08-02 on M1 (darwin/arm64, Node 26.5, pnpm 10.34.5, turbo 2.10.8).

| Scenario | Command | Wall s | Notes |
|---|---|---:|---|
| Pure artifacts cold (first full success after empty/partial `.turbo`) | `npx turbo run i18n:gen wiki:content sfx:check check:types build:env build:server build:bundle` | 24.37 | All miss or partial; real work |
| Pure artifacts warm (unchanged tree) | same | **0.27** (turbo Time 87ms) | `Cached: 7/7` `FULL TURBO` |
| i18n warm | `npx turbo run i18n:gen` | 0.02 | cache hit |
| i18n after catalog touch | same after edit under `src/ui/i18n.catalog/**` | 2.57 | cache miss (invalidation OK) |
| Types+env+server sequential force | three separate `--force` runs | ~6.3 sum | types 5.32 + env 0.41 + server 0.55 |
| Types+env+server parallel force | one multi-task `--force` | 5.30 | ~1s wall win; types dominate |

Full gate still dominated by vitest (always runs). Warm gate saves the pure-step
slice (i18n/wiki/sfx/types/builds), not the suite. See `task-cache.md`.

### Full gate with turbo warm pure steps (Phase 8)

| Machine | Workers | Full gate s | Notes |
|---|---:|---:|---|
| M1 | 4 | 411.8 | 2026-08-02; pure steps cache hit (i18n/wiki/sfx/types/builds FULL TURBO); vitest always ran; multi-session machine |

Warm pure multi-task alone: 87ms FULL TURBO (7/7). Catalog touch forces i18n miss.

## Phase 9 - suite cost reduction (subsystem worlds)

Measured 2026-08-02 on M1 (darwin/arm64, Node 26.5, vitest 4.1.10, `WOC_SKIP_PRETEST=1`).
Durations are per-file wall from vitest JSON (`endTime - startTime`). Assertions
unchanged; only `Sim` construction `world:` fixtures.

**Decision:** Keep EMPTY/STABLE subsystem worlds on the listed suites. Drop
corpse_harvest empty world (seed pin breakage). Drop architecture scan rewrite
(not a top offender).

### File-level before/after

| File | Before ms | After ms | Notes |
|---|---:|---:|---|
| tests/professions_trend_guild_letter.test.ts | 54029 | ~1080 | EMPTY via `professions_trend_util` |
| tests/professions_trend_delivery_kind.test.ts | 26306 | ~675 | same util |
| tests/mail_expiry.test.ts | 40557 | ~1437 | EMPTY; mailboxes from services |
| tests/mail_instance.test.ts | ~18194 (Phase 1) | ~2765 | EMPTY |
| tests/tank_crit_immunity_warrior_pair.test.ts | 31430 | ~773 | EMPTY via util; 240s sim window |
| tests/tank_crit_immunity_paladin_pair.test.ts | ~23257 (P1) | ~740 | same util |
| tests/tank_crit_immunity_druid_pair.test.ts | ~23583 (P1) | ~790 | same util |
| tests/stable_yard.test.ts | 12713 | ~700-830 | stable_horse camps only |

Sum of the Phase 1 top heavies touched here drops from roughly **230+ s of
per-file worker time** to under **10 s** on the same machine (parallel suite
wall is lower than the sum). Full-suite re-profile deferred; day-loop and
shard balance both benefit immediately.

### Dropped experiments

| Experiment | Why |
|---|---|
| `corpse_harvest_sim` + EMPTY_TEST_WORLD | 36 failures: hunted seeds and #2514 yield pins depend on full-world construction rng |
| architecture/malware double-walk rewrite | architecture file ~0.5s; walks are one per root already |

Raw JSON (gitignored): `tmp/phase9-before.json`, `tmp/phase9-after.json`,
`tmp/phase9-final.json`, `tmp/phase9-stable-before.json`,
`tmp/phase9-stable-after.json`.

## Phase 10 - experimental runners (not default)

Measured 2026-08-02 on M1 (darwin/arm64, 16 logical CPUs, 128 GiB, Node 26.5.0,
pnpm 10.34.5, vitest 4.1.10, Bun 1.3.14). SHA during spike: `eed68b938e`.

**Decision: not default.** Keep Vitest as `npm test` / full gate. Optional
scripts `test:turbo` and `test:bun` are experimental only. No CI dual-run. No
permanent `@miaskiewicz/turbo-test` dependency (lockfile is an asset fingerprint
leaf).

### Full suite A/B (maxWorkers / jobs = 8)

| Runner | Real wall s | Files | Tests pass/fail (reported) | Result |
|---|---:|---|---|---|
| Vitest 4.1.10 (historical quiet, Phase 4 warm) | ~241 | ~1945 | ~24693 pass | green |
| Vitest 4.1.10 (contended, with temporary turbo-test in lockfile) | 401.1 | 1939 pass / 7 fail | 24693 pass / 9 fail | fingerprint red only |
| turbo-test 0.3.14 `--jobs 8` | **126.0** | 1149 pass / 300 fail / 511 error | 14954 pass / 1775 fail + 511 load-err | **not adopt** |

turbo-test is roughly **2x faster wall** than a quiet vitest full suite on this
machine, but **~41% of files** are not clean green. That is not dual-run quality.

### Pure helper pilot (5 gate_* files, 72 tests)

| Runner | Real s | Pass/fail |
|---|---:|---|
| vitest --maxWorkers=8 | 0.91 | 72/72 |
| turbo-test --jobs 8 | 0.20 | 46 pass + 3 load-errors |
| bun test | 0.07 | 72/72 |

### Bun as vitest host (12 pure-ish files, 128 tests, maxWorkers=4)

| Host | Real s | Result |
|---|---:|---|
| node + npx vitest | 2.20 | 128/128 |
| bunx vitest | 2.50 | 128/128 |

No wall win hosting Vitest under Bun on this set.

### Deno

Not installed on measurement host. Dropped without install (expected).

### Artifact paths (gitignored)

`tmp/phase10/turbo-full.json`, `tmp/phase10/turbo-full.stderr`,
`tmp/phase10/vitest-full.log`, pure pilot logs under `tmp/phase10/`.

## Phase 11 - cross-platform and tier matrix (after)

**Decision:** Keep documentation matrix + contributor "which command" guidance.
No large platform script rewrite. Small biome format fix on
`scripts/test_turbo_experimental.mjs` (Phase 10 leftover) so `gate:fast` stays green.

### Validation (M1, 2026-08-02, SHA ~eee2655082 + Phase 11 WIP)

| Path | Seconds | Workers | Result |
|---|---:|---:|---|
| `pnpm run gate:fast` (default) | 28.55 | 8 | PASS 5 steps; related on experimental script only |
| `GATE_WORKER_TIER=low pnpm run gate:fast` | 22.66 | 2 | PASS 5 steps (day-loop wall dominated by malware/guards/types, not workers) |
| `node scripts/gate_profile.mjs --facts` | n/a | 8 planned | darwin arm64 high tier |
| `node scripts/gate_profile.mjs --dry-run --skip-browser` | 0 | 8 | planned step list OK |

### Platform fill

| OS | Status | Evidence |
|---|---|---|
| macOS | verified | M1 full packet + Phase 11 gate:fast |
| Linux | smoke | CI-L1 ubuntu-latest (install + sharded tests); no local unsharded wall |
| Windows | smoke | win32 shell spawn policy in gate scripts; no local host |

Contributor matrix: `docs/local-gate-perf/platform-matrix.md`.

