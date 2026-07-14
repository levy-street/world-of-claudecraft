# Character Equipment Screen Redesign

Rebuild the character window (`#char-window`, key C) into the new two-tab design: an EQUIPMENT tab with a paperdoll arranged around the 3D character preview, an embedded bags grid, and a right-hand column of stat panels (Attributes, Combat, Defense, Progression, Specialization, Gathering); and an OVERVIEW tab carrying the identity, archetype, talent summary, prestige, and share-card content of the old sheet. Pure client work: no sim, server, wire, or DB changes.

Reference mockup: the approved design shows an ornate gold-on-dark window, title = character name with a level/class subtitle, currency chips top right, tab rail (EQUIPMENT active, OVERVIEW), paperdoll slots flanking the model on a pedestal, a BAGS section with container selector and used/total counter, and six stat panels with icon section headers.

## Index

Read `state.md` first in every session, then your phase file.

| File | What it is |
|---|---|
| [brainstorm.md](brainstorm.md) | Vision, locked design decisions, current-state findings, reuse map |
| [implementation-plan.md](implementation-plan.md) | Canonical team workflow + phase summary table |
| [state.md](state.md) | Cross-phase cheat sheet: locked decisions, validation matrix, key paths |
| [progress.md](progress.md) | Status table + per-phase deliverable checklists |
| [qa-checklist.md](qa-checklist.md) | Whole-feature integration QA matrix (run at packet completion) |
| [phase-01-pure-cores.md](phase-01-pure-cores.md) | Paperdoll model rework + stat-panels pure core |
| [phase-02-window-shell.md](phase-02-window-shell.md) | Tabs, titlebar accessory (money + subtitle), Equipment tab paperdoll layout |
| [phase-02b-preview-pedestal.md](phase-02b-preview-pedestal.md) | 3D pedestal in the preview + equipment-visual base seam (armor visuals deferred) |
| [phase-03-stat-panels.md](phase-03-stat-panels.md) | The six right-hand stat panels + section icons |
| [phase-04-embedded-bags.md](phase-04-embedded-bags.md) | Embedded bags grid with container selector |
| [phase-05-overview-tab.md](phase-05-overview-tab.md) | Overview tab content migration |
| [phase-06-mobile-polish.md](phase-06-mobile-polish.md) | Mobile adaptation, a11y regression, screenshots, full gate |

Each phase file contains its own implementation starter prompt AND its QA starter prompt (run QA as a separate session after the implementation session). Work the phases strictly in order: 1, 1 QA, 2, 2 QA, 2b, 2b QA, 3, 3 QA, ... 6, 6 QA.

The final QA session offers packet teardown (deleting `docs/char-equipment/`) before the PR, on explicit user confirmation only.

## Branch and delivery

- Branch: `feat/char-equipment` (created off `origin/main` at `fa435903a`).
- Deliverable: a PR against the repo default base per CLAUDE.md (check for the latest `release/**` branch before opening the PR; `release/v0.24.0` was the active integration base when this packet was written, so expect to retarget or rebase onto it).
- Visual change: before/after screenshots (desktop and mobile) committed under `docs/screenshots/` and referenced from the PR body. Before shots are captured in Phase 2 pre-flight, before any layout change lands.
