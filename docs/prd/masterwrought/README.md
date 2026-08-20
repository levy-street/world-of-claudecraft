# Masterwrought (endgame professions expansion) planning packet

Two halves, one system. The CRAFTING half: epic (apex) craftable gear near raid power for
all ten crafting professions, capped at two equipped ("Unique-Equipped: Masterwrought
(2)"), fed by tradable pattern drops and a raid-priced material economy, with the bound
fail-forward Perfecting stage pushing at most two slots slightly over raid, and an orange
promotion that is process and prestige. The GATHERING half: the completion of the
gathering tier, which starts with FARMING, the fifth gathering profession, absorbed whole
from `feature/farming-plan` with its 14 completed phases and its planning docs, and then
goes past it, so every gathering skill feeds the craft economy and every gathering skill
has real content at every rung. Seven rulings govern that half and the player-pain block: R17 the
provisioner rule (farm produce feeds cooking and alchemy at every rung, never the gear
chain), R18 the anti-compulsion guardrail (produce is buyable, and its rows are always
added to a bill, never substituted into one), R19 farming is a long-haul skill (a slower
curve tuned against a measured calendar model, never a punishment), R20 every gathering
profession reaches the endgame (enforced by a test), R21 demand-side design (output is
consumed at a rate that sustains a market), R22 no material is geographically trapped
(measured in reachability, never membership), and R23 a vendor is a floor, never a
competitor (the margin widens by rung, created by lowering the vendor line). The packet ships fifteen professions of content
as one system, five gathering and ten crafting, in ONE branch and ONE PR from
`feature/masterwrought`.

Read in this order:
- `state.md`: locked rulings, numbers, naming registry, validation matrix. The one file
  every phase session must load.
- `implementation-plan.md`: canonical Team Workflow, Review Dispatch Matrix, the seven
  rulings that govern the gathering half and the player-pain block (R17 to R23), the
  farming absorb and its ordering rule, and all phase definitions (01 to 17 plus the
  fourteen inserted phases 11b to 11o).
- `decisions-index.md`: the one-page key to the five namespaces (`R<n>` masterwrought
  ruling, the COLLIDING `R<n>` Professions 2.0 series that shipped source cites, `D<n>`
  farming decision, `(x)` farming deviation, `F<nn>` farming phase), where each lives, and
  the never-renumber rule.
- `brainstorm.md`: vision, the research record, and the design rationale.
- `progress.md`: live status per phase, including the absorbed `F01` to `F14` rows.
- `qa-checklist.md`: the whole-feature closing matrix (phase 17), executed as the UNION
  with `farming/qa-checklist.md`.
- `phase-01-masterwrought-cap.md` ... `phase-17-final-qa.md` (+ `phase-NN-qa.md`): the
  per-phase starter prompts. Each is self-contained for a fresh session.
- The fourteen inserted phases, sitting between the completed Phase 11 and Phase 12, each
  with its QA twin (`phase-11b-qa.md` through `phase-11o-qa.md`). Ten come from the absorb.
  Three do the absorb itself:
  `phase-11b-farming-absorb.md`, `phase-11c-food-and-feast.md`,
  `phase-11d-derived-artifacts.md`. Seven build the gathering half:
  `phase-11e-mastery-curve.md`, `phase-11f-drop-economy.md`,
  `phase-11g-supply-line-leveling.md`, `phase-11h-supply-line-apex.md`,
  `phase-11i-anglers-endgame.md`, `phase-11j-gathering-completion.md`,
  `phase-11k-provisioning-capstone.md`.
- Three more answer reported player pain rather than the absorb, ADMITTED 2026-08-20
  (ip-GATE-PAIN) and running after 11k, carrying R21, R22 and R23:
  `phase-11l-trophy-economy.md` (21 junk mob drops gain profession
  consumers, zero new item ids), `phase-11m-harvest-geography.md` (no material forces a
  leveled player back into a starter zone, no component tag yields nothing) and
  `phase-11n-vendor-floor.md` (a vendor is a floor, never a competitor). Their shared
  method: re-measure every reported item before it becomes a deliverable, because
  perception is reliable about THAT something is wrong and unreliable about WHY.
- One more comes from the packet's own standing quality review, whose first run
  (2026-08-20, against the plan) the maintainer adopted in full (state.md rows 117 to
  133): `phase-11o-leveling-crafter.md` + `phase-11o-qa.md`, running after 11n. It owns
  the required-level cliff on the crafted rung-50/75 rares, the engineering on-ramp, and
  the retirement of the three skill-150 tool rungs; the same adoption pass amended 11i,
  11l, 11m, 11n, 12, 15 and 16 (plus smaller corrections across 11d, 11e, 11f, 11g-qa,
  11h and 11j) in their own files; the full list is in professions-quality-review.md's
  first-run record.
- `farming/state.md`: the farming design authority (`D1` to `D24`, the deviation letters)
  and the packet's ONE open-item collection point, GATE 1 included.
- `farming/README.md`, `farming/implementation-plan.md`, `farming/progress.md`,
  `farming/qa-checklist.md`, `farming/brainstorm.md`, and
  `farming/phase-01-foundation.md` ... `farming/phase-14-final-polish.md`: farming's own
  packet, absorbed whole and cited as `F01` to `F14`. Past-tense execution records that
  stay verbatim; only their forward-looking delivery assertions were rewritten.

House cadence: phase, then that phase's QA, then the next phase. Every phase session
starts by merging the latest `origin/release/**` and running `release-merge-audit`.

Sessions self-relocate: every phase prompt opens with a worktree guard that switches the
session into `~/Documents/wocc-masterwrought` via EnterWorktree when launched anywhere
else (the maintainer runs multiple concurrent sessions from the main checkout), so a
phase prompt can be pasted into any new session regardless of its launch directory.
