# Masterwrought: decisions index

The farming absorb (Phase 11b) put two complete planning packets under one root, each with
its own numbering, and neither is renumbered. This file says which symbol belongs to which
packet, where its authority text lives, and which file a session loads first. It is an
index: nothing is settled here and nothing here supersedes `state.md`.

## Namespaces

| Symbol | What it is | Authority file | Cited from |
|---|---|---|---|
| `R<n>`, R1 to R23 | A masterwrought locked ruling, settled with the maintainer, not re-litigated. R1 to R16 govern the crafting half; R17 to R20 were added 2026-08-20 with the gathering half (R17 the provisioner rule, R18 need the output never the slot, R19 farming is a long-haul skill, R20 every gathering profession reaches the endgame); R21 to R23 were added the same day with the player-pain block (R21 demand-side design, R22 no material is geographically trapped, R23 a vendor is a floor never a competitor). All carry the same standing | `docs/prd/masterwrought/state.md`, "Locked design rulings" | shipped source: `src/sim/content/apex_patterns.ts` (the R8 channel doctrine), `src/sim/types.ts` (the R14 corollary), `src/sim/professions/masterwrought_materials.ts` (R4 and R9); R17 to R23 are cited by number from `implementation-plan.md` and from every `phase-11b` to `phase-11n` file |
| `R<n>` IN SHIPPED SOURCE | A **different** series: the Professions 2.0 / professions-tuning rulings, cited from `src/sim/` at R1, R4, R8, R9, R14, R19, R22, R30, R35, R37, R39, R40, R42, R45 to R50. IT COLLIDES WITH THE PACKET SERIES ABOVE. Shipped R19 is the fishing teaching ceiling; shipped R22 is the wield gate ("R22/R50"). Packet numbers never renumber, but any R-number written into `src/`, `server/`, `tests/`, a `CLAUDE.md`, or `docs/design/` by phases 11b to 11o reads "masterwrought R<n>" IN FULL. A bare R-number in those files means the Professions 2.0 series, permanently. REVIEWER INSTRUCTION (11e-D-F, verified at Phase 11d unit 7): a bare packet R-number in source is a FINDING, not a nit; every reviewer treats it as such. `docs/design/professions.md` is the sharpest case, because it is this series' own authority file AND the file 11j writes masterwrought R17 to R20 into | `docs/design/professions.md`, "Locked rulings"; `docs/design/professions-tuning-packet-review.md` | `src/sim/professions/fishing.ts`, `src/sim/content/professions.ts`, `src/sim/professions/CLAUDE.md` |
| `D<n>`, D1 to D24 | A farming locked design decision | `docs/prd/masterwrought/farming/state.md`, "Locked design decisions" | `docs/design/deeds.md` (the D11 tier 3 and 4 seed bootstrap ruling) |
| `(x)`, currently `(a)` to `(ca)` | A farming deviation letter: ONE global append-only sequence distributed through farming's per-phase ledgers | `docs/prd/masterwrought/farming/state.md`, inside the per-phase ledgers | four test comments: `tests/monolith_budget.test.ts` for (an); `tests/item_art_consistency.test.ts` twice and `tests/mob_portrait_source_manifest.test.ts` for (al) |
| `F<nn>`, F01 to F14 plus F06b and F09b | An absorbed farming phase | `docs/prd/masterwrought/farming/` phase files; status row in `progress.md`, record in `farming/progress.md` | the `docs/screenshots/farming-phase-NN` cone rows |
| bare `NN`, 01 to 17 | A masterwrought phase | `docs/prd/masterwrought/phase-NN-*.md` | the `docs/screenshots/masterwrought-phaseNN*` cone rows |
| `NNb`, `NNc`, and so on | A phase inserted after `NN` already completed: 11b through 11o today, the FOURTEEN inserted phases, all ADMITTED. Ten come from the absorb; `phase-11l-*`, `phase-11m-*` and `phase-11n-*` are the player-pain block, admitted 2026-08-20 (the gate in `implementation-plan.md` is CLOSED, and the ruling is ip-GATE-PAIN with the drift fix at 11m-ADMIT); `phase-11o-*` is the quality-review phase, admitted the same day at state.md row 117 (qr-11o-ADMIT) | same as bare `NN` | same as bare `NN` |

All five out-of-packet citations name the farming file by its old path, so Phase 11b's move
commit re-points them in the same change that moves the tree.

## The rule

**Never renumber. Never resequence. Amend in place.** A superseded item keeps its number and
gains a dated SUPERSEDED or AMENDED line where it stands: D22 and its addendum (B) are
exactly that shape, superseded by the absorb, marked in place, never deleted, because they
remain the correct record of how F01 to F14 were executed.

- New farming-derived deviations continue the one sequence at `(cb)`. It is append-mostly,
  so re-derive a row's position from its TEXT, never from a remembered index.
- Farming phase-file bodies keep saying "Phase 11" as written and are never rewritten to
  "F11". The `F` prefix is for cross-packet reference only; the bodies are history.
- New masterwrought work appends on the bare axis with the b-suffix idiom, so every existing
  ledger reference and forward carry stays literally correct.

## What a session loads, and in what order

1. `docs/prd/masterwrought/state.md` is THE file every phase session loads: current phase,
   the delivery contract, R1 to R23, power placement, the naming registry, the validation
   matrix, the key seams, then the append-only per-phase ledgers.
2. `docs/prd/masterwrought/farming/state.md` is the farming design authority (D1 to D24, the
   constraints, tick and hook points, blast-radius and seam references, its own validation
   matrix, the deviation ledgers, the OPEN items). Load it for any diff touching farming.
3. That same file is the merged packet's ONE open-item collection point: the MAINTAINER
   GATES block plus the handoff table (117 rows at the Phase 13 QA round-open, append-mostly
   since). UNTIL 11b's doc move creates it, the delegated answers live in `state.md`'s dated
   append-only block "Decisions closed 2026-08-20 (the full delegation)" at the END of that
   file, which 11b STEP 6 migrates into the handoff table in the SAME commit as the move
   (state-COLLECT). Masterwrought's own Phase 10 ledger decisions (its section "Maintainer
   decisions (the standing three, one WIDENED); ALL CLOSED 2026-08-20") are settled at
   state-OPEN-FLASK, state-OPEN-MASTERWORK and the Phase 10 QA rulings; anything NEW appends
   at the END, never interleaved. Exactly ONE item in the whole packet stays open on purpose,
   ip-17-PUSH, and it is recorded as such. (ip-NAME-BORDERLINE was the second and was CLOSED
   2026-08-20, narrowly, at state.md row 114: Phase 16 renames the 'Enchant <Slot> - <Stat>'
   scheme and nothing else; this row's earlier two-open-items claim was stale against row 114
   and was corrected by the quality-review adoption pass, state.md row 132.)
4. `docs/prd/masterwrought/progress.md` carries both status tables, the bare-`NN` axis and
   the absorbed `F` axis. Per-phase history stays split across two intact append-only files.
5. `docs/prd/masterwrought/implementation-plan.md` carries the canonical workflow and the
   Review Dispatch Matrix. Farming's copy at `farming/implementation-plan.md` is historical
   and does not govern this packet.

## Promoted out of the packet before Phase 17

Farming parked `docs/design/farming-asset-manifest.json` outside its packet deliberately so
the asset handoff would outlive teardown. Two masterwrought files are in that same class and
move to `docs/design/` on that precedent, before Phase 17 offers teardown. Each move
discharges its citations in the same change, never after.

- `naming-audit.md`, the web-verified IP verdicts behind the shipped display-name renames,
  cited from `tests/originality_renames.test.ts` and `tests/ip_scrub.test.ts`. A teardown
  that left it inside the packet would leave two live tests citing evidence that no longer
  exists.
- `power-verification.md`, Phase 15's deliverable and the R5 measurement the closing
  checklist names as the packet's defining gate.
