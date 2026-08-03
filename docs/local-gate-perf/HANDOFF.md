# Handoff: local gate performance

**Branch:** `feature/local-gate-perf`  
**Base:** `origin/release/v0.34.0`  
**Status:** complete / ready for PR.

## What shipped (keep list)

| Area | Change | Default? |
|---|---|---|
| Gate orchestration | Generate i18n/wiki once per full gate; pretest skip under gate; client `build:bundle` | yes |
| Day-loop | `pnpm run gate:fast` (malware, biome changed, architecture + localization guards, `check:ts`, vitest related) | day-loop only |
| Workers | `GATE_WORKER_TIER=low\|medium\|high` caps after free-mem clamp; clamp kept | yes |
| Vitest | `experimental.fsModuleCache`; `test:related` / `test:changed` | yes |
| DOM env | happy-dom for most DOM tests; 9 jsdom exceptions | partial keep |
| Package manager | **pnpm 10.34.5** + `pnpm-lock.yaml` only; CI + Dockerfile frozen install; shared store | yes |
| Task cache | turbo 2.10.8 pure steps only (i18n/wiki/sfx/types/builds); tests never cached | yes |
| Suite cost | EMPTY/STABLE subsystem worlds on Guild-letter, tank crit, mail, stable_yard | yes |
| Experimental runners | `test:turbo` / `test:bun` hooks only | **not default** |

Dropped (measured MISSes): vitest threads pool, isolate:false, projects split, @vitest/ui, turbo-test/Bun/Deno as default, corpse_harvest empty world.

## How to measure

```bash
node scripts/gate_profile.mjs --facts
node scripts/gate_profile.mjs --vitest-slow --top 20 --json-out tmp/gate-profile.json

pnpm run gate:fast
pnpm run gate
```

Numbers: `baselines.md`, `experiment-log.md`.  
Which command: `platform-matrix.md`. Workers: `tier-workers.md`. Turbo: `task-cache.md`.

## Permanent surfaces (outside this folder)

- `docs/qa-gate.md`, `CONTRIBUTING.md`, root `README.md`
- `scripts/gate.mjs`, `scripts/gate_fast.mjs`, `turbo.json`, `package.json`
- CI: `.github/workflows/ci.yml` (pnpm frozen-lockfile, 8-way shards)
- Game image: root `Dockerfile` (pnpm; pinned in `tests/deploy_node_version.test.ts`)

## Docs kept here

Living guidance only: README, HANDOFF, platform-matrix, tier-workers, task-cache,
baselines, experiment-log, state. Planning packet scaffolding (phase starters,
implementation-plan, research-brief, progress) was removed after Phase 12.

## Phase 12 verification (M1, 2026-08-03)

| Check | Result |
|---|---|
| `pnpm run gate` | PASS, wall **505.3 s**, workers **8** (multi-session load; vitest 418.7 s) |
| `pnpm run gate:fast` | PASS, wall **~8 s** on clean tree |
| Pin suite | PASS (gate helpers, ci_workflow, deploy_node_version) |

Quiet-host full gate historically ~5-6 min on M1 (Phase 1 336 s / Phase 2 composite 291 s).

## Remaining OPEN

1. Low/medium-tier **local** machine baselines still empty (only M1 + CI-L1 proxy).
2. Windows host (W1) full gate / gate:fast wall untested (smoke only).
3. Whether local multi-shard full gate is worth supporting on high-tier only.
4. Owner sign-off if `gate:fast` is ever allowed as pre-push (default: no).
5. ~~Optional: refresh non-English `docs/i18n/CONTRIBUTING.*` install wording.~~ **Closed:** all 20 locales updated to pnpm.
