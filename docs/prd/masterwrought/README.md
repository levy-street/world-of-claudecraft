# Masterwrought (endgame professions expansion) planning packet

Epic (apex) craftable gear near raid power for all ten crafting professions, capped at two
equipped ("Unique-Equipped: Masterwrought (2)"), fed by tradable pattern drops and a
raid-priced material economy, with the bound fail-forward Perfecting stage pushing at most
two slots slightly over raid, and an orange promotion that is process and prestige. The
entire system ships in ONE branch and ONE PR from `feature/masterwrought`.

Read in this order:
- `state.md`: locked rulings, numbers, naming registry, validation matrix. The one file
  every phase session must load.
- `implementation-plan.md`: canonical Team Workflow, Review Dispatch Matrix, and all
  17 phase definitions.
- `brainstorm.md`: vision, the research record, and the design rationale.
- `progress.md`: live status per phase.
- `qa-checklist.md`: the whole-feature closing matrix (phase 17).
- `phase-01-masterwrought-cap.md` ... `phase-17-final-qa.md` (+ `phase-NN-qa.md`): the
  per-phase starter prompts. Each is self-contained for a fresh session.

House cadence: phase, then that phase's QA, then the next phase. Every phase session
starts by merging the latest `origin/release/**` and running `release-merge-audit`.
