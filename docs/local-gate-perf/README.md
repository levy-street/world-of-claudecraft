# Local gate and developer machine performance

Living contributor guidance for **on-machine** gate speed: agents, multi-worktree
workflows, and low/medium/high tier hosts, without weakening the merge contract.

The merge and "done" contract is still documented in [`docs/qa-gate.md`](../qa-gate.md)
and [`CONTRIBUTING.md`](../../CONTRIBUTING.md). This folder holds measured baselines,
keep/drop history, and how-to tables that those surfaces point at.

## Index

| File | Role |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | Short summary of what shipped, how to measure, remaining OPEN |
| [`platform-matrix.md`](platform-matrix.md) | Which command by role/tier; OS validation matrix |
| [`tier-workers.md`](tier-workers.md) | `GATE_WORKER_TIER` / `GATE_MAX_WORKERS` and free-mem clamp |
| [`task-cache.md`](task-cache.md) | Turborepo pure-step cache for full gate |
| [`baselines.md`](baselines.md) | Machine inventory and wall numbers |
| [`experiment-log.md`](experiment-log.md) | Append-only try / measure / keep or drop log |
| [`state.md`](state.md) | Locked decisions, invariants, ledger, OPEN items |

## Day-loop vs merge bar

```bash
pnpm run gate:fast   # iterate only; not merge
pnpm run gate        # full merge / "done" contract
```

Details and OS notes: [`platform-matrix.md`](platform-matrix.md).

## Measure a change

```bash
node scripts/gate_profile.mjs --facts
node scripts/gate_profile.mjs --vitest-slow --top 20 --json-out tmp/gate-profile.json
```

Record walls in `baselines.md` and keep/drop rows in `experiment-log.md`.

## Locked product outcomes (do not re-litigate casually)

1. `node scripts/gate_select.mjs` is the merge bar (owner decision, 2026-08-05; see
   `state.md`); full `pnpm run gate` remains the deeper local check. `gate:fast` stays
   day-loop only, never a merge bar.
2. pnpm is the package manager (`pnpm-lock.yaml` only; CI and Dockerfile frozen install).
3. Free-mem worker clamp stays; tier presets cap after the clamp.
4. turbo-test / Bun / Deno stay **not default** (optional `test:turbo` / `test:bun` only).
5. Full detail: [`state.md`](state.md) and [`HANDOFF.md`](HANDOFF.md).
