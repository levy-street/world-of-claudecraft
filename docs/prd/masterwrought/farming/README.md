# Farming packet

> RENAMED, NOT REVISED (2026-08-20, Masterwrought Phase 11b): this packet moved
> whole from `docs/farming/` to `docs/prd/masterwrought/farming/` when the
> maintainer pulled the completed farming packet into the Masterwrought packet
> (the absorb, masterwrought state.md ruling 11b-D-3), so both ship as one
> branch and one PR. Every file, ledger, and decision survives verbatim apart
> from path strings and the superseded delivery agreements (see the banner in
> `state.md` at D22 and the Working agreements paragraph below); old
> transcripts and hashes citing `docs/farming/` resolve to the same content
> here. This banner is the one place the old path may still appear.

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
   9b. `phase-09b-bed-verbs.md` (the client plant and harvest verbs; ADOPTED 2026-08-18)
10. `phase-10-celebrations.md` / `phase-10-qa.md`
11. `phase-11-well-fed-food.md` / `phase-11-qa.md`
12. `phase-12-shared-feast.md` / `phase-12-qa.md`
13. `phase-13-integration-polish.md` / `phase-13-qa.md` (teardown deferred per the
    D22 addendum: Phase 13 QA verified the preconditions and left the packet in place)
14. `phase-14-final-polish.md` (PROPOSED 2026-08-19 by the Phase 13 QA perfection
    sweep: the ACTIONABLE-IN-REPO bucket, thirteen polish items, no mechanics)

Working agreements (REWRITTEN at the 2026-08-20 absorb; the pre-absorb text
lives in this file's git history and its D22 basis is superseded in place in
`state.md`): farming work now happens in the Masterwrought packet's worktree
`~/Documents/wocc-masterwrought` on `feature/masterwrought`, which absorbed
`feature/farming-plan` whole at the 11b merge; every phase re-resolves the
newest `release/**` branch at session start (the discipline D22 pioneered,
adopted upstream by the absorb amendment); phases land as local commits under
the Masterwrought packet's delivery contract, and the packet ships as ONE
branch and ONE PR with Masterwrought when the maintainer says go. The packet
docs live under `docs/prd/masterwrought/farming/`; the asset handoff manifest
stays at `docs/design/farming-asset-manifest.json` so it survives any
teardown, and one teardown decision covers both packets' docs.
