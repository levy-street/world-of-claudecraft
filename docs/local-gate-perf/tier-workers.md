# Machine-tier worker presets (Windows, macOS, Linux)

Cross-platform guidance for Vitest workers under `npm run gate` and
`npm run gate:fast`. Implementation: `scripts/lib/gate_workers.mjs`
(`computeGateWorkers`, `GATE_WORKER_TIER_CAPS`).

## Policy (locked)

1. **Available-memory clamp stays.** Default workers are
   `min(floor(cpu/2), floor(availableMem / 0.75 GiB))`, never fewer than 1. The sensor is
   `scripts/lib/gate_memory.mjs`: `vm_stat` on darwin, `os.freemem()` everywhere else.
2. **Tier presets are caps**, not a way around memory pressure.
3. **Full gate remains the merge bar** (`npm run gate`). `gate:fast` is day-loop only.
4. Scripts use `spawnSync(..., { shell: process.platform === 'win32' })` so `npm` /
   `npx` resolve on Windows the same way as on macOS/Linux.

## Hardware tiers (planning)

| Tier | Rough hardware | Day-loop | Full gate |
|---|---|---|---|
| low | 4-8 logical CPUs, 8-16 GB RAM, often shared with browser/IDE | Prefer `npm run gate:fast` | Overnight or CI proxy; keep freemem free |
| medium | 8-12 CPUs, 16-32 GB | `gate:fast` while editing; full gate before merge | Default half-core + mem clamp is usually fine |
| high | 12+ CPUs, 32+ GB total RAM | Either path; full gate is already minutes on a quiet host | Optional higher workers only when freemem allows |

Classification for baselines also lives in `classifyMachineTier`
(`scripts/lib/gate_profile.mjs`): high needs **both** 12+ CPUs and 32+ GB.

## Environment knobs

| Variable | Effect |
|---|---|
| (unset) | CPU/2 and available-memory clamp only |
| `GATE_WORKER_TIER=low` | Cap workers at **2** after the available-memory clamp |
| `GATE_WORKER_TIER=medium` | Cap at **4** after the clamp |
| `GATE_WORKER_TIER=high` | Cap at **8** after the clamp |
| `GATE_MAX_WORKERS=<n>` | **Expert absolute override** (bypasses heuristic and tier cap). Use when you deliberately share a machine (lower n) or you know freemem is solid (raise n). Invalid values fall back to the heuristic. |
| `GATE_FAST_BASE=<ref>` | Only for `gate:fast`: force branch-wide `vitest --changed <ref>` (slow if package.json differs). Default day-loop uses `vitest related` on changed sources instead. |

## Related / changed helpers (Phase 4)

| Script | What it runs | Notes |
|---|---|---|
| `npm run test:related -- <file.ts>` | `vitest related --run --passWithNoTests` | Pass source paths after `--`. Aligns with `gate:fast` related selection. |
| `npm run test:changed` | `vitest run --passWithNoTests --changed` | Uncommitted changes. Optional base: `npm run test:changed -- origin/release/v0.34.0`. Dirtiness of `package.json` / vite config expands almost to the full suite; prefer `test:related` or `gate:fast` then. |
| `npx vitest --clearCache` | Clears results + `experimental.fsModuleCache` | Use if a warm run misbehaves. Default cache dir: `node_modules/.experimental-vitest-cache`. |

None of these replace `npm run gate`.

### Examples (all OS shells)

```bash
# Low-tier day loop: few workers, fast path
export GATE_WORKER_TIER=low
npm run gate:fast

# Medium-tier full gate with a soft cap
export GATE_WORKER_TIER=medium
npm run gate

# Quiet high-tier: force 12 workers (you own freemem; clamp is skipped by design)
export GATE_MAX_WORKERS=12
npm run gate

# Windows PowerShell
$env:GATE_WORKER_TIER = "low"
npm run gate:fast

# Windows cmd
set GATE_WORKER_TIER=low
npm run gate:fast
```

## Cross-platform notes

Full OS status matrix (verified / smoke / untested) and the contributor
"which command should I run?" table live in
[`platform-matrix.md`](platform-matrix.md).

| OS | Notes |
|---|---|
| macOS | Primary agent host; availability comes from `vm_stat`, so CPU/2 is normally the limiter. Before that sensor landed, `os.freemem()` read near zero on a healthy host and pinned the suite to 1 worker |
| Linux | Matches CI hosts; same Node scripts, no bash-only gate core |
| Windows | `gate.mjs` / `gate_fast.mjs` set `shell: true` for npm/npx `.cmd` resolution; use PowerShell or cmd env syntax above; prefer `npm run` over bare `node` when PATH differs |

## What not to do

- Do not remove or bypass the available-memory clamp in `computeGateWorkers` to chase wall
  time. Widening the SENSOR (`scripts/lib/gate_memory.mjs`) is the supported way to fix a
  platform where the reading is wrong; the clamp itself stays.
- Do not document `gate:fast` as the only or default pre-merge check.
- Do not raise CI shard count or weaken `.githooks/pre-push` from this packet without owner sign-off (see `state.md` OPEN items).
