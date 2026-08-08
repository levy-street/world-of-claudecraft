# Farming packet

Farming: the fifth gathering profession. OSRS-style shared garden patches in four hub
zones, per-player crops with offline wall-clock growth, front-loaded tending (two
visits per cycle, nothing ever rots), skill-scaled survival and yield, an insurance
economy (compost, farmer's watch, growth tonic, withered husks), cooking and alchemy
integration up to well-fed buff dishes and a placeable shared feast, the Harvest
Journal timer window, and a procedural-first art pass with a swap-ready handoff list.

Orient here, then read in this order:

- `state.md`: THE cheat sheet. Locked decisions D1 to D24, constraints, blast-radius
  and seam references, validation matrix, ledgers, OPEN items. Every session reads
  this first.
- `implementation-plan.md`: phase index with live-surface notes, the canonical
  per-phase workflow, the Review Dispatch Matrix (the one canonical copy), scaling and
  hygiene rules.
- `progress.md`: status table and per-phase checklists.
- `brainstorm.md`: vision, research digest, reuse map, wave-2 parking lot.
- `qa-checklist.md`: the whole-feature integration matrix for the final phase.

Phase files, in order (each implementation phase has a QA twin):

1. `phase-01-foundation.md` / `phase-01-qa.md`
2. `phase-02-patches-and-plots.md` / `phase-02-qa.md`
3. `phase-03-growth-engine.md` / `phase-03-qa.md`
4. `phase-04-knobs.md` / `phase-04-qa.md`
5. `phase-05-crops-and-tools.md` / `phase-05-qa.md`
6. `phase-06-economy-hooks.md` / `phase-06-qa.md`
7. `phase-07-render-and-juice.md` / `phase-07-qa.md`
8. `phase-08-harvest-journal.md` / `phase-08-qa.md`
9. `phase-09-world-presence.md` / `phase-09-qa.md` (go-live)
10. `phase-10-celebrations.md` / `phase-10-qa.md`
11. `phase-11-well-fed-food.md` / `phase-11-qa.md`
12. `phase-12-shared-feast.md` / `phase-12-qa.md`
13. `phase-13-integration-polish.md` / `phase-13-qa.md` (offers packet teardown)

Working agreements: all farming work happens in the persistent worktree
`~/Documents/woc-farming-plan`; every phase re-resolves the newest `release/**`
branch at session start; each phase is its own PR; the packet docs never ship (the
final QA phase offers teardown; the asset handoff manifest lives in
`docs/design/farming-asset-manifest.json` so it survives).
