---
name: woc-extract-and-test
description: "Implement World of ClaudeCraft features, bug fixes, and focused refactors using module-first design and behavior-driven tests. Use when adding behavior, fixing a defect, extracting logic from a large file, or moving code behind an existing architectural seam."
---

# Extract and Test

Implement the requested behavior with the smallest clean module boundary and direct
regression coverage.

## Load context

1. Read the root `CLAUDE.md` in full.
2. Read the relevant local `CLAUDE.md` before opening or editing that area.
3. Run `git status --short` and preserve unrelated work.
4. Inspect the production path, its callers, and nearby tests before choosing a seam.

Apply canonical architecture rules to the concrete change without copying them here.

## Choose the workflow

For a bug fix:

1. Reproduce the defect through the real production path.
2. Add a focused test that fails for the intended reason.
3. Confirm the test is red before changing production code.
4. Make the smallest coherent fix.
5. Add nearby edge cases only when they protect the same contract.

For a feature or refactor:

1. Identify the existing module, coordinator, state owner, or extension seam.
2. Place behavior in a pure sibling module, current state owner, or thin adapter.
3. Separate pure decisions from I/O, rendering, global state, and transport.
4. Give the extracted unit direct tests and keep consumers thin.
5. When relocating behavior, preserve semantics before redesigning anything.

Do not grow a monolith when a tested sibling is appropriate, introduce a framework for
one call site, bypass existing seams to reach private state, or build parallel versions
of the same rule. Preserve determinism, parity, localization, and persistence contracts.
Do not commit unless explicitly asked.

## Validate

Run focused tests while iterating, then:

```sh
npm run ci:changed
npx tsc --noEmit
```

Run domain guards for architecture, localization, persistence, parity, or security when
applicable. Before declaring the implementation ready, run `npm run gate`.

Report the selected seam, behavior covered, commands run, and remaining manual checks.
