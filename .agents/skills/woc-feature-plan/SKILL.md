---
name: woc-feature-plan
description: "Plan a large or multi-session World of ClaudeCraft feature as architecture-aligned vertical slices with explicit decisions, verification, and handoff state. Use when the user requests a phased implementation plan, planning packet, session breakdown, or scalable approach before implementation."
---

# Feature Plan

Create the smallest planning artifact that makes a large feature safe to execute across
sessions.

## Research before planning

1. Read the root and relevant local `CLAUDE.md` files.
2. Run `git status --short` and preserve unrelated work.
3. Inspect production paths, tests, module seams, and relevant project documentation.
4. Use bounded parallel exploration for independent subsystems.
5. Fetch current official documentation for version-sensitive external interfaces.
6. When work adds or changes SQL, a database call site, stored-data growth, scheduled database
   work, pool sizing or admission, transaction or lock scope, or timeout policy; a database
   driver/dependency version, or PostgreSQL engine/resource/configuration/topology, use
   `woc_database_performance` for a read-only scaling pass.

Do not create planning files until the goal, scope, and important constraints are
understood. Ask the user when a choice would materially change architecture or product
behavior.

## Define the change

Record current behavior and ownership, desired behavior and acceptance criteria,
affected systems and platforms, constraining invariants, decisions already made, truly
blocking open decisions, and compatibility, migration, localization, privacy, security,
database performance, and testing implications. For database-backed work, record expected
query frequency and cardinality, the index/cache/pagination strategy, pool and lock impact,
version-sensitive timeout/planner assumptions, and the measured evidence the implementation must
produce. Reference canonical instructions instead of copying them.

## Build vertical phases

Prefer phases that deliver a testable behavior slice. Each phase states:

1. Outcome and explicit scope.
2. Expected modules or seams.
3. Tests to add or update.
4. Validation commands and manual verification.
5. Exit criteria.
6. State needed by the next phase.

Keep a phase small enough for one focused session when practical. Do not isolate
documentation that belongs beside its implementation.

## Persist only useful state

If the user requests planning files, use a minimal packet:

- `implementation-plan.md` for architecture, decisions, phases, and completion criteria.
- `progress.md` for verified phase status.
- `state.md` for the exact resume point, blocker, and next action.

Add per-phase files only when a phase needs substantial independent detail. Starter
prompts must be model-neutral and include the goal, relevant files, canonical
constraints, authorized actions, checks, and handoff. Do not pin a model or effort.

Planning does not authorize implementation, commits, pushes, issues, or pull requests.
Do not modify `CLAUDE.md` or `.claude/**` as Codex support work.

Return the phases, unresolved decisions, risk areas, and recommended first executable
step.
