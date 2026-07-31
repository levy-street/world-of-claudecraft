# Ferry fidelity program: progress board

Tracks docs/prd/ferry-fidelity-program.md. States: not started / running / in
review / fix round / merged / blocked. Updated by the orchestrating loop each
iteration; committed at program milestones.

| Task | Status | Worktree / branch | Notes |
|---|---|---|---|
| F1.1 Factory, exporter, contract | running | woc-ferry-f1 (feature/ferry-f1) | codex run 1 (with F1.2, one worktree per PRD) |
| F1.2 The generated plan | running | woc-ferry-f1 (feature/ferry-f1) | same run as F1.1 |
| F1.3 The boarding walk | not started | | after F1.1+F1.2 merge; serialize with F2.3/F3.1 on linter file |
| F2.1 Perpendicular berths, continuous glides | running | woc-ferry-f21 (feature/ferry-f21) | codex run 2 |
| F2.2 Clear the berth footprints | not started | | after F2.1 (needs the new island parked footprint) |
| F2.3 Linter arm: berth pose continuity | not started | | after F2.1; mutex on tests/cinematic_shots.test.ts with F3.1 |
| F3.1 Perceptual fade floor | not started | | mutex on tests/cinematic_shots.test.ts with F2.3 |
| F3.2 Voyage dissolve pacing | not started | | after F3.1 and F2.1 |
| F4.1 Keeper facing | running | woc-ferry-f41 (feature/ferry-f41) | codex run 3 |
| F4.2 One ferryman | blocked | | owner decision pending (PRD open decision) |

## Program-end checklist (after all merges)
- Re-run the cinematic linter after F1 and F2.2 are both merged (hull clearance).
- Full npm run gate measured against the documented pre-existing failure set
  (docs/prd/cinematics-progress.md, Final verification).
- Parity golden / Eastbrook seal re-mints if renderer or world content shifted.
- Remove the ferry worktrees and branches.

## Run log
- 2026-07-31: board opened. Wave 1 launched: F1 (F1.1+F1.2), F2.1, F4.1 as three
  parallel codex runs in scratch worktrees off feature/last-bell-campaign.
