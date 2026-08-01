# Insane-to-Low Graphics Performance Parity Loop

## Mission
World of ClaudeCraft's `insane` graphics preset must perform as well as the `low` preset does today, with zero change to how the game looks or plays. You are the engineering manager on branch `feature/graphics-performance`. You do not write optimization code yourself: you plan, delegate to Codex subagents, verify, commit, and loop until the stop condition is met.

## Hard constraints (restate these in every task you delegate)
- Performance work only. No visible change on ANY preset (geometry, textures, lighting, VFX, draw distance, UI) and no gameplay, balance, or sim behavior change. Every repo invariant in CLAUDE.md holds: determinism, sim purity, gameplay-neutral graphics settings, i18n, module-first.
- The benchmark is the referee and is frozen: never edit the scenarios, tolerances, or measurement logic in scripts/perf_baseline.mjs, scripts/profiler/, scripts/lib/perf_baseline_store.mjs, or the frozen docs/perf/baseline/baseline-low.json.
- Anything else is allowed: rewrite whole systems, restructure rendering, invent new techniques. Research current best practice before large work.

## Benchmark contract (needs `npm run dev` on :5173)
- Once, at loop start: `node scripts/perf_baseline.mjs baseline --preset low` freezes the target.
- Each cycle: `node scripts/perf_baseline.mjs run --preset insane --gate` measures avg FPS (primary), 1% lows, CPU and GPU across fixed scenarios (town idle, camera sweep, two traversal runs, combat VFX), appends docs/perf/baseline/history.jsonl, and prints PASS or FAIL against the baseline.
- `report` prints the history over time. Visual parity: `shots --preset insane --out <dir>` before and after a change, then `diff-shots --a <before> --b <after>`; calibrate the same-build noise floor first by diffing two shot runs of one build.

## How to work
- Delegate implementation to Codex: `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s workspace-write --output-last-message tmp/codex/<task>.md "<task>"`, run in the background. Run several at once only on non-overlapping subsystems; use git worktrees when they might collide.
- One codex session = one scoped task with an explicit acceptance check and the constraint block above. Start a FRESH `codex exec` for each new task so context never rots; `codex exec resume <session>` only to continue that same task. Kill and respawn any session that drifts off task.
- Stay on top of them: read their output files, watch git diff and bench results, and re-plan continuously. Subagents never commit; you commit.
- Verify EVERY candidate change yourself: `run --preset insane --gate`, a spot-check run on low (no regression), parity shots diff against pre-change, then code health: `npx tsc --noEmit`, the full test suite, and `npm run build`. On your FIRST cycle record the pre-existing test failures on this branch; afterward only NEW failures block. All green: commit it (conventional commit with body) so each win is durable. Anything red: revert and re-scope.
- Keep a loop cadence: dispatch work, schedule a wakeup, review, decide next tasks. Keep working notes in tmp/notes so any cycle can resume cold.

## Stop condition
Stop ONLY when, on two consecutive full cycles: `run --preset insane --gate` PASSES (every scenario's avg FPS at or above the frozen low baseline within its tolerance, GPU within ceiling), parity shots match the pre-loop insane look within the calibrated noise floor, and code health is green with zero regressions beyond the recorded pre-existing set. Until then: measure, research, delegate, verify, commit, repeat. If an avenue is truly blocked after research and repeated attempts, write a blocker note and pursue the next best avenue; never declare done early and never weaken the referee.
