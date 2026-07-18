# Professions 2.0 planning packet

The phased implementation plan for completing the professions system as
approved in the 2026-07-16 maintainer brainstorm: six deep crafts with
pair-named archetypes, station masters in the open world, deterministic
crafting with celebrated masterworks, gathering with rare events, an economy
that pays skillers without touching raid loot, and a wheel window at Book of
Deeds quality. Built on epic #1866 and PR 2039.

Each phase runs as its own fresh Claude Code session (Opus 4.8, xhigh effort;
`ultracode` where a phase says so). Start a phase by pasting its starter prompt
from the phase file. Every implementation phase is followed by its QA phase.

## Reading order for a new session

1. `state.md`: locked decisions, validation matrix, current phase pointer.
2. `progress.md`: status table and deliverable checklists.
3. Your phase file below.

Do not read the whole packet into a session; spawn an Explore agent per the
starter prompt.

## Cross-cutting docs

- [brainstorm.md](brainstorm.md): vision, pillars, locked rulings, current
  state, out-of-scope list.
- [implementation-plan.md](implementation-plan.md): canonical team workflow,
  review dispatch matrix, phase summary table.
- [progress.md](progress.md): status and per-phase checklists.
- [state.md](state.md): the cross-phase cheat sheet (decisions, validation
  matrix, new surfaces per phase).
- [qa-checklist.md](qa-checklist.md): the whole-feature integration matrix for
  the final QA phase.
- [asset-manifest.json](asset-manifest.json): every designer-replaceable image
  slot this feature ships procedurally, with purpose, size, and format.

## Phases

| # | Phase | QA |
|---|---|---|
| 1 | [Ring and identity foundations](phase-01-ring-and-identity.md) | [QA](phase-01-qa.md) |
| 2 | [Masterwork model](phase-02-masterwork-model.md) | [QA](phase-02-qa.md) |
| 3 | [Host-parity bug fixes](phase-03-parity-bug-fixes.md) | [QA](phase-03-qa.md) |
| 4 | [Node materials and pristine veins](phase-04-node-materials.md) | [QA](phase-04-qa.md) |
| 5 | [The professions wheel window](phase-05-wheel-window.md) | [QA](phase-05-qa.md) |
| 6 | [Crafting window upgrades and celebrations](phase-06-crafting-window.md) | [QA](phase-06-qa.md) |
| 7 | [The Guild letter and quest objectives](phase-07-guild-letter.md) | [QA](phase-07-qa.md) |
| 8 | [Stations and masters (sim and server)](phase-08-stations-masters.md) | [QA](phase-08-qa.md) |
| 9 | [Station presence and recipe training](phase-09-station-training.md) | [QA](phase-09-qa.md) |
| 10 | [Recipe ladders and materials content](phase-10-recipe-ladders.md) | [QA](phase-10-qa.md) |
| 11 | [Fishing joins the framework](phase-11-fishing.md) | [QA](phase-11-qa.md) |
| 12 | [Base tool tier gating](phase-12-tool-gating.md) | [QA](phase-12-qa.md) |
| 13 | [Enchanting reachable](phase-13-enchanting.md) | [QA](phase-13-qa.md) |
| 14 | [Attunement quests and nudges](phase-14-attunement-quests.md) | [QA](phase-14-qa.md) |
| 15 | [Deeds, tuning, and polish](phase-15-deeds-polish.md) | [Final QA + teardown](phase-15-qa.md) |

Waves for orientation: phases 1 to 7 are the fun kernel (visibility, truth,
and the first taste of identity); phases 8 to 15 are wave one (stations,
content, quests, polish). End of Phase 7 is the vertical-slice checkpoint:
the Phase 7 QA session plays the eight-step journey end to end (gather a
rare event, craft, watch skill move, receive the Guild letter, visit the
letter's named quest giver and attune via the quest flow (smith_haldren
stands in until the Phase 8 masters land), celebrate a masterwork, trade
it) before wave one begins. Ordering relief: Phase 6 depends on Phases 2
and 4, NOT on Phase 5, so it may run ahead of the wheel window if the
design-language rollout stalls Phase 5 (the state.md OPEN item).
Wave 2+ work (market instance carriage, commissions, Jack of All Trades,
monster proficiency, battlefield experience) is tracked on epic #1866, not
in this packet; salvage wiring moved INTO Phase 13 by the 2026-07-17
design-review amendments recorded in state.md.
