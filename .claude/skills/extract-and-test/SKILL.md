---
name: extract-and-test
description: Build features and fix bugs the clean, scalable way for World of ClaudeCraft. Use when adding a feature, refactoring logic out of a large file (sim.ts, hud.ts, renderer.ts, main.ts), or fixing a bug, especially when the change would otherwise append a block of new logic to an existing big file. Extracts self-contained behavior into a small, well-named, unit-tested module behind one of this repo's existing seams instead of growing a monolith, and fixes bugs test-first (reproduce with a failing test, then make the smallest change that turns it green). Keeps merge conflicts small and the codebase scalable for many contributors.
user-invocable: true
---

# Extract and test: module-first features, test-first fixes

This repo is built and maintained almost entirely by AI agents and grows by many
small contributions. The thing that keeps it scalable, and keeps open-source merge
conflicts small, is that new behavior lands as a focused module behind a known seam,
not as another block appended to an already huge coordinator. This skill is the detailed how-to
behind the root CLAUDE.md "Modularity" section. Apply it whenever you implement a
feature or fix a bug.

## The one decision: sibling module or monolith edit

The four logic monoliths (`src/ui/hud.ts`, `src/sim/sim.ts`, `src/main.ts`,
`src/render/renderer.ts`) are coordinators, not a license to grow them: do
not split them to hit a line count, and do not rewrite them as a side effect of your task,
but never GROW one either. `src/main.ts` especially is a firewall, not a home (its
client-bootstrap helpers belong in `src/game/` or `src/ui/` siblings). Before you add a
block of new logic to one, ask:

> Does this behavior need the monolith's private mutable state (the live `Sim`
> entity loop, the `Hud` DOM and per-frame state, the renderer's scene graph)?

- **No:** it is a sibling module. Write it as its own file with a named export and a
  Vitest, then wire it in with a few lines (a call, a registration, a consume).
- **Yes, partly:** extract the pure part (the math, the formatting, the id/state
  resolution) into a host-agnostic module a test imports directly, and leave the
  stateful side a thin consumer that calls it. This is the pure-core + thin-consumer
  split (reference: `src/ui/unit_portrait.ts` core + `src/ui/unit_portrait_painter.ts`,
  shared by the player and target frames; `src/ui/xp_bar.ts` is a pure `xpBarView()`
  that a snapshot test drives with no DOM).

If your edit to a monolith is more than a thin wiring of something defined elsewhere,
you are probably appending behavior that wants its own module.

## Use the seams this repo already has

Do not invent a new architecture. Pick the seam that matches the work:

- **render or ui needs new data or an action:** extend `IWorld` first. `IWorld` is
  split into domain facets under `src/world_api/`, re-aggregated by `src/world_api.ts`:
  add the member to the matching facet file, implement it in BOTH the offline `Sim`
  (`src/sim/sim.ts`) and the online `ClientWorld` (`src/net/online.ts`), and update the
  member pins in `tests/world_api_parity.test.ts` in the same change. render and ui
  never import a concrete world. This is the load-bearing parity rule; the
  `cross-platform-sync` agent audits it.
- **New sim SYSTEM behavior (a combat, mob, social, or economy mechanic, not just a
  data record):** its own module behind the `SimContext` seam
  (`src/sim/sim_context.ts`), with backing state kept on `Sim` as a live `ctx` view,
  never a new method cluster on the `sim.ts` coordinator. See `src/sim/CLAUDE.md`.
- **New game content (mob, quest, item, ability, zone, talent):** a declarative
  record in `src/sim/content/`, merged into the flat tables by `src/sim/data.ts`.
  Never inline a content table in `sim.ts`.
- **New visual system:** a new `src/render/<thing>.ts` exporting a `build*()` that
  returns a `*View` the renderer owns and calls. Not a new method bank on
  `renderer.ts` (templates: `terrain.ts`, `props.ts`, `foliage.ts`).
- **New HUD component (a self-contained window OR a per-frame frame/bar):** a
  DOM-free pure view core (`src/ui/<name>_view.ts` or `_core.ts`, registered in the
  `UI_PURE_CORES` allowlist that `tests/architecture.test.ts` sweeps) plus a thin
  write-elided painter on the `PainterHost` seam (`src/ui/painter_host.ts`),
  instance-parameterized (take a descriptor or id, no hardcoded element id). Reuse a
  painter FAMILY before writing a bespoke one (a unit-style frame is a
  `UnitFramePainter`; an extra action bar is a new `ActionBarPainter(descriptor)`).
  Full recipe: `src/ui/CLAUDE.md`.
- **New server REST endpoint:** a `RouteDef` module (`server/<domain>.ts` exporting
  `routes`) registered in `server/http/registry.ts`, never an inline route in
  `main.ts`. Scaffold with `npm run new:endpoint`; see `server/http/CLAUDE.md`.
- **New server WS command:** validate every field in `dispatchMessage`
  (`server/game.ts`), then call the `sim.*` method that owns the rule. The outcome
  resolves in the `Sim`, never on the server outside it.
- **A multi-file subsystem:** a directory with an `index.ts` barrel that exports only
  its public surface, plus its own short `CLAUDE.md` (templates:
  `src/render/characters/`, `src/ui/i18n.catalog/`).

## When to extract, and when not to

- **Extract on the rule of three.** Two similar blocks: leave them. A third copy, or
  a single block whose responsibility you can name in one sentence with no "and",
  earns its own module.
- **Do not abstract ahead of need.** No helper, base class, options bag, or
  indirection for a single caller or a hypothetical future requirement. The right
  amount of structure is the minimum the current task needs. A wrong abstraction is
  more expensive than a little duplication.
- **Name for the behavior, not the layer.** `threat_table.ts`, `loot_roll.ts`,
  `coords.ts`, not `helpers.ts` or `utils.ts`. The file name should tell a reader
  what one thing it owns.
- **Keep new modules host-aware.** Anything reused by `src/sim/` must stay
  DOM-free and Three-free (the `tests/architecture.test.ts` guard enforces this for
  `src/sim/`). Pure logic that both the sim and the UI need lives sim-side or in a
  neutral module both can import without breaking the import direction in
  `src/CLAUDE.md`.

## Build a new module

1. Create `src/<area>/<behavior>.ts` with a small, explicit public surface (one or a
   few named exports). Keep internals private.
2. Add a Vitest at `tests/<behavior>.test.ts` that imports the module directly and
   asserts real behavior (not "it runs"). Tests live in `tests/`, not beside the
   source (see `tests/CLAUDE.md` for the idioms). For sim logic, add a determinism
   assertion: same seed gives the same result (`expect(run()).toEqual(run())`).
3. Wire it into its consumer with the smallest possible edit (a call, a registration,
   a barrel re-export). The consumer stays thin.
4. If the module is the public face of a new directory, add an `index.ts` barrel and a
   local `CLAUDE.md` describing only that directory's conventions.

## Fix bugs test-first

1. **Reproduce in a failing test before touching the fix.** Write a Vitest that
   exercises the real code path and fails, and confirm it fails for the reason the
   bug describes, not an unrelated setup error. If the buggy logic is buried in a
   monolith and hard to test in place, that is the signal to extract the unit under
   test into its own module first, then test it.
2. **Make the smallest change that turns the test green.** Fix the root cause, not the
   symptom. Never special-case the test inputs or hard-code the expected value into
   the implementation.
3. **Generalize the assertion, not the fix.** Add a couple of nearby cases (boundary,
   empty, the mirror host) so the test pins the behavior, not one example.
4. For a high-risk or subtle fix, isolate the grader from the implementer: have one
   subagent write the reproducing test, a second implement the fix, and a fresh
   subagent review the diff for coverage (every correctness and requirement gap),
   so the fix is not validated by the same reasoning that produced it.

## Verify, and keep the diff honest

After an extraction or fix, these stay green (run the subset your change touches):

- `npx tsc --noEmit`
- `npx vitest run tests/<affected>.test.ts` (or `npm test` for broad changes)
- `npx vitest run tests/architecture.test.ts` if you touched `src/sim/`, or added / renamed a
  `src/ui` or `src/render` `*_view` / `*_core` pure core (the completeness sweep also checks
  `UI_PURE_CORES` / `RENDER_PURE_CORES` registration)
- `npx vitest run tests/localization_fixes.test.ts` if any player-visible text or a
  `src/sim`/`server` emit changed (the S3 i18n guard)
- `npm run ci:changed` (Biome on the files you changed; this is what the `.githooks/pre-push`
  floor runs, so clear it here, not at push time). If it flags formatting on your own files,
  fix with a SCOPED `npx @biomejs/biome check --write <file>` per touched file, never a
  whole-tree `--write` (the repo defers global Biome debt, so a whole-tree write buries your
  change in thousands of unrelated reformats).
- `npm run build` before a merge

When the change is database-backed (SQL or a query call site, schema/indexes, query cadence
or cardinality, pool/lock/timeout behavior, scheduled database work, or stored-data growth),
get a read-only `database-performance-reviewer` checkpoint BEFORE implementing and carry its
concrete bounds and evidence requirements into the test-first contract; re-run it on the
finished diff.

When you extract, the diff should read as move plus import, not rewrite. If you
"improved" the moved code in the same change, that is scope creep: split it into a
follow-up so the extraction stays reviewable. Delete the code you replaced; leave no
dead duplicate, commented-out block, or unused import behind.

Effort by model (the doctrine here is identical, only the effort scales): on Opus 4.8,
after the extraction fan out a fresh subagent (or the `architecture-reviewer` for a
`src/sim/` move) to review your move-diff for COVERAGE, every parity and correctness gap,
before calling it done. On the Sonnet baseline, take small verifiable steps and lean on
one investigator.

## Repo anti-patterns to avoid

- Appending a new system as another `// ----` banner section in `sim.ts` or `hud.ts`
  when it does not need that file's private state.
- Reaching past `IWorld` into `Sim`/`ClientWorld` from `render/` or `ui/`.
- Adding a content table or balance number inline in `sim.ts` instead of
  `src/sim/content/` and the tuning const blocks.
- A `helpers.ts`/`utils.ts` grab-bag, or an abstraction with exactly one caller.
- Splitting a monolith purely to reduce its line count, with no seam and no test.
