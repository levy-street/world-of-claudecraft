# Ferry fidelity program: progress board

Tracks docs/prd/ferry-fidelity-program.md. States: not started / running / in
review / fix round / merged / blocked. Updated by the orchestrating loop each
iteration; committed at program milestones.

| Task | Status | Worktree / branch | Notes |
|---|---|---|---|
| F1.1 Factory, exporter, contract | merged | | both reviews PASS 0 blocking; combined verify green (54 tests) |
| F1.2 The generated plan | merged | | same merge; hand-measured entries gone, blockers live |
| F1.3 The boarding walk | merged | | audit PASS under four mutation probes; hull arms read the generated plan; verify-staged re-derivation live |
| F2.1 Perpendicular berths, continuous glides | merged | | merge 6c13709af; review PASS; berth continuity pinned in prop_path_core |
| F2.2 Clear the berth footprints | merged | | fence runs end at split-deck corner posts; clearance pinned by tests/ferry_berth_clearance.test.ts |
| F2.3 Linter arm: berth pose continuity | merged | | continuity.berthPose universal check; parked pose shared via harborShipParkedPose (renderer consumes it); F1.3 polish items landed |
| F3.1 Perceptual fade floor | merged | | audit PASS; merged (0.4s MIN_PERCEPTUAL_FADE_SECONDS, per-arm controls); linter-file mutex now free |
| F3.2 Voyage dissolve pacing | merged | | side cut removed, landing dolly added, fade-ins reveal live glides; contact sheet still owed post-program |
| F4.1 Keeper facing | merged | | merge 78a8ca983; yaw derived from gangplank geometry, fixture-pinned |
| F4.2 One ferryman | ready | | owner chose the same Ewald identity at both posts; implementation and targeted verification complete |

## Final verification (2026-07-31)
- Full npm run gate on the merged branch, single-process machine: 23,062 tests
  passed, 31 failed across 11 files. Eight files are the documented
  pre-existing set (the WebSocket-in-Node client family, the Intl midnight
  hour-cycle pair, prod_cpu_monitor). The three ferry-caused deltas were
  closed in commit 94f6112d0: the shot linter seed reference count (9), the
  gap-chunk terrain digest re-mint for the deliberate harbor regrades, and
  the natural-coast seabed scan's authored-basin exclusion. The in-rect
  Eastbrook vertex pin and the Eastbrook provenance seals never moved, so no
  seal or parity re-mint was needed.
- Cinematic linter green with LEGACY_EXEMPTIONS pinned empty; every new check
  (fade floor, berth pose continuity, generated-plan hull arms) carries its
  synthetic control under the MechanicalCheck meta-test.
- Fresh contact sheets committed (82ebea98b): both departures, the Q0
  voyage, and the doorway at seed 20061 (voyage 23 sampled frames down to 7).
  The ashore sheet is unchanged (scene untouched; its standalone capture
  quirk is documented in the cinematics program notes).
- All ferry worktrees and branches removed.

## Run log
- 2026-07-31: board opened. Wave 1 launched: F1 (F1.1+F1.2), F2.1, F4.1 as three
  parallel codex runs in scratch worktrees off feature/last-bell-campaign.
- 2026-07-31: F4.1 reviewed (yaw convention verified against renderer forward
  axis) and merged as 78a8ca983; worktree and branch removed. F3.1 launched in
  the freed slot (it takes the cinematic_shots.test.ts mutex; F2.3 waits).
- 2026-07-31: F3.1 audited (test-coverage: PASS, two inert nits) and merged;
  worktree removed. F1 architecture review: 0 blocking, 3 notes (wire the
  exporter --verify-staged derivation check into a gate step: fold into F1.3;
  transform logic in harbor_layout is a watch item; linter bounds routing is
  interim until F1.3). F1 QA review still finishing; F1 merge held for it.
- 2026-07-31 (close): F1 merged (QA PASS), F2.1 integrated and merged after
  its synthetic-control round, F2.2/F3.2/F1.3 built in parallel and merged
  (F1.3 audited under mutation probes), F2.3 merged last with the F1.3
  polish items. Program-end gate deltas closed (94f6112d0), contact sheets
  refreshed (82ebea98b), worktrees removed. Nine tasks are merged; F4.2 is
  implemented in its task worktree and awaits integration.
