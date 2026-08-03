# Platform and machine-tier matrix

Cross-platform status for the local gate performance packet (Phase 11).
Complements [`tier-workers.md`](tier-workers.md) (worker presets) and
[`baselines.md`](baselines.md) (measured walls).

**Locked:** full `pnpm run gate` / `npm run gate` remains the merge bar.
`gate:fast` is day-loop only. turbo-test / Bun / Deno stay **not default**
(Phase 10).

## Which command should I run?

| Who | Machine tier | Day-loop (iterate) | Before merge / "done" |
|---|---|---|---|
| **Human** | low (4-8 CPUs, 8-16 GB) | `GATE_WORKER_TIER=low pnpm run gate:fast` | `GATE_WORKER_TIER=low pnpm run gate` (overnight OK; or push and use CI) |
| **Human** | medium (8-12 CPUs, 16-32 GB) | `pnpm run gate:fast` (optional `GATE_WORKER_TIER=medium`) | `pnpm run gate` |
| **Human** | high (12+ CPUs, 32+ GB) | `pnpm run gate:fast` or full gate if quiet | `pnpm run gate` (minutes on a quiet host) |
| **Agent** | any | `pnpm run gate:fast` while editing; prefer `GATE_WORKER_TIER=low` when freemem is tight or many worktrees share the box | Always `pnpm run gate` once before claiming done / opening a PR |
| **CI** | Linux `ubuntu-latest` (proxy: low/medium) | n/a (sharded jobs) | Workflow already is the merge contract; local full gate mirrors the same step list unsharded |

### Command cheat sheet

```bash
# Install (once per worktree; shared store across worktrees)
npm install -g pnpm@10.34.5   # match package.json packageManager
pnpm install --frozen-lockfile

# Agent / human day-loop (not merge)
pnpm run gate:fast
# Low-tier or multi-worktree freemem pressure:
GATE_WORKER_TIER=low pnpm run gate:fast

# Thinner Vitest only (no malware/biome/types)
pnpm run test:related -- path/to/changed.ts
pnpm run test:changed

# Merge bar (required before PR / "done")
pnpm run gate
# Expert worker override (bypasses heuristic + tier cap):
GATE_MAX_WORKERS=4 pnpm run gate
```

Windows PowerShell:

```powershell
$env:GATE_WORKER_TIER = "low"
pnpm run gate:fast
pnpm run gate
```

`npm run …` still works after a pnpm install; **install and lockfile updates
must go through pnpm**.

### Decision rules (short)

1. **Iterating on code?** `gate:fast`. Green fast path alone never means "done".
2. **About to merge or claim done?** `gate` (full).
3. **Machine feels thrashy / many agent worktrees?** set `GATE_WORKER_TIER=low`
   (cap 2) or `GATE_MAX_WORKERS=n`. Never remove the available-memory clamp.
4. **Only want tests for one source file?** `test:related -- <file>`.
5. **Experimental turbo-test / Bun?** not default; see Phase 10; do not use for
   merge signal.

---

## Platform validation matrix

Status key:

| Status | Meaning |
|---|---|
| **verified** | Run on a real host of that OS during this packet (or continuous CI for Linux install/gate steps) with a green outcome recorded |
| **smoke** | Script/path reviewed, spawn/shell policy pinned, and/or CI proxies part of the path; no full local wall on that OS in this packet |
| **untested** | No host run this packet; follow-up if a bug appears |

### Scripts

| Script / path | macOS | Linux | Windows | Notes |
|---|---|---|---|---|
| `pnpm run gate` (`scripts/gate.mjs`) | **verified** | **smoke** (CI step list + GHA `ubuntu-latest`) | **smoke** (win32 `shell: true` for npm/npx; no local Win host this packet) | Merge bar. Generate-once i18n/wiki, turbo pure steps, full unsharded vitest, browser, types, builds. |
| `pnpm run gate:fast` (`scripts/gate_fast.mjs`) | **verified** | **smoke** (same Node scripts; no dedicated Linux wall) | **smoke** (same win32 shell pattern as gate) | Day-loop only. Phase 11 M1: ~28.6s default workers; see baselines. |
| `pnpm install --frozen-lockfile` | **verified** | **verified** (CI every PR) | **smoke** (hoisted layout + CONTRIBUTING notes; no Win wall this packet) | Shared store: macOS `~/Library/pnpm/store`, Linux `~/.local/share/pnpm/store`, Windows `%LOCALAPPDATA%\pnpm\store`. |
| `pnpm run test:related` | **verified** | **smoke** | **smoke** | Vitest CLI; path args use repo-relative POSIX after normalize. |
| `pnpm run test:changed` | **verified** | **smoke** | **smoke** | Expands almost full suite if package.json/vite dirty; prefer related or gate:fast. |
| `node scripts/gate_profile.mjs` | **verified** | **smoke** | **smoke** | Measurement harness; win32 shell on spawns. |
| Worker policy `scripts/lib/gate_workers.mjs` | **verified** | **smoke** (unit pins OS-agnostic) | **smoke** (unit pins OS-agnostic) | Free-mem clamp always; `GATE_WORKER_TIER` caps after clamp. |
| Experimental `test:turbo` / `test:bun` | **verified** (not default) | **untested** | **untested** | Phase 10 locked not default. |

### OS summary

| OS | Overall | Evidence | Known issues / gaps |
|---|---|---|---|
| **macOS** (darwin arm64) | **verified** | All packet phases on M1 (Fernando high-tier); gate:fast + gate_profile + pnpm + turbo | Availability now comes from `vm_stat` (`scripts/lib/gate_memory.mjs`); before that, `os.freemem()` read near zero on a healthy host and made the clamp, not CPU, the limiter |
| **Linux** (x64) | **smoke** via CI | `.github/workflows/ci.yml` `runs-on: ubuntu-latest`; pnpm frozen install, 8-way vitest shards, builds, types | No dedicated local Linux wall in this packet; CI is sharded (local full gate is unsharded by design) |
| **Windows** (win32) | **smoke** (code review + prior shell policy) | `shell: process.platform === 'win32'` in gate, gate_fast, gate_profile, pretest; path normalize `\` -> `/` in `gate_fast_plan`; hoisted pnpm for fewer symlink needs | **No Windows host run this packet.** Defender can slow installs. Prefer PowerShell/cmd env syntax. Optional: Defender exclusion on pnpm store. Git Bash generally works. |

---

## Machine inventory (aliases)

| Alias | OS | Arch | CPUs | RAM | Tier | How measured | Notes |
|---|---|---|---|---|---|---|---|
| **M1** | darwin | arm64 | 16 | 128 GiB | high | local `gate_profile --facts` | Primary packet host (Fernando) |
| **CI-L1** | linux (ubuntu-latest GHA) | x64 | 4 | 16 GB | low | GitHub-hosted runner docs (public repos) | Proxy only; jobs use half-core maxWorkers per shard, not full unsharded gate |
| **W1** | win32 | | | | | | **Empty:** no Windows baseline host this packet |

Tier classifier (`classifyMachineTier`): high needs **both** 12+ CPUs and 32+ GB;
low when **both** CPUs <= 8 and RAM <= 16 GB; else medium. CI-L1 is low.

### Expected workers (examples)

| Host sketch | Free RAM sketch | Unset workers | `GATE_WORKER_TIER=low` |
|---|---|---:|---:|
| M1 quiet (16c, lots free) | ~16+ GiB free | 8 (CPU/2) | 2 |
| M1 multi-session | ~4 GiB free | 5 (mem clamp 0.75 GiB/worker) | 2 |
| CI-L1 (4c) | ~8-12 GiB free | 2 (CPU/2) | 2 |
| Low laptop (8c) | ~4 GiB free | 5 -> mem may clamp lower | 2 |

---

## Cross-platform implementation notes

| Concern | Policy |
|---|---|
| Spawning npm/npx/pnpm | `spawnSync(..., { shell: process.platform === 'win32' })` so `.cmd` shims resolve |
| Git path lists on Windows | `normalizeRepoPath` forces POSIX slashes before classification |
| Package manager | pnpm 10.34.x only (`pnpm-lock.yaml`); no `package-lock.json` |
| node_modules layout | `node-linker=hoisted` (Windows-friendly; fewer symlink requirements) |
| FFmpeg | Bundled `ffmpeg-static` / `ffprobe-static`; PATH fallback |
| Turbo cache | Local `.turbo/` per worktree; not a cross-OS remote cache in this packet |
| Browser tests | Full gate only; needs Playwright Chromium (`pnpm exec playwright install chromium` when missing) |

## Windows still unverified (follow-ups)

Recorded so Phase 12 / maintainers do not assume green:

1. Full `pnpm run gate` wall on a real Windows laptop (including Playwright browser step).
2. `gate:fast` with PowerShell vs cmd vs Git Bash (expect OK; not timed).
3. Windows Defender impact on cold `pnpm install` and vitest fork spawn rate.
4. Long path / antivirus interaction with `node_modules/.experimental-vitest-cache`.
5. Optional: fill **W1** row in `baselines.md` when a Windows contributor volunteers.

None of these block documenting smoke status or shipping the day-loop scripts;
gate scripts already carry the win32 shell pattern used elsewhere in the repo
(Electron packaging paths).

## Linux proxy limits

CI proves install, typecheck, sharded tests, and builds on Linux. It does **not**
prove the local unsharded `scripts/gate.mjs` wall time on a 4-core box. Treat
CI-L1 as:

- install: **verified**
- full local gate wall: **untested** (use low-tier guidance + CI as merge signal)

---

## Related docs

| Doc | Role |
|---|---|
| [`tier-workers.md`](tier-workers.md) | `GATE_WORKER_TIER` / `GATE_MAX_WORKERS` detail |
| [`baselines.md`](baselines.md) | Timed walls and phase keep/drop |
| [`task-cache.md`](task-cache.md) | Turborepo pure-step cache |
| [`docs/qa-gate.md`](../qa-gate.md) | Layered QA contract |
| [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | pnpm install + PR gate pointers |
| [`state.md`](state.md) | Locked decisions ledger |
