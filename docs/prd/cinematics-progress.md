# Cinematics quality program: progress

Loop state file for the autonomous build of docs/prd/cinematics-quality-program.md.
Feature branch: feature/last-bell-campaign (worktree /Users/chrisherrmann/Code/woc-last-bell).
Untracked on purpose: this is scheduler state, not project docs.

Updated: 2026-07-30, 23:15. PROGRAM COMPLETE. All 17 board lines merged into
feature/last-bell-campaign (final tip 603dccf1c), all cine worktrees removed, loop
stopped.

## Final verification (the honest differential)

- Gate non-test stages: i18n gen and freshness, malware scan, changed-files biome,
  SFX conformance, tsc, all builds PASSED (twice).
- Full vitest suite: 23032 passed; the remaining 28 failures across 8 files were
  each verified FAILING IDENTICALLY at the program base commit f94071025 in a clean
  worktree (pre-existing branch debt, not the program's): snapshots (2),
  quest_link_wire (1), target_echo_client (12), vale_cup_client (4),
  net_interaction_outcome (6) are all the WebSocket-undefined-in-Node family;
  chat_timestamp (1) and clock_format (1) are the Intl midnight 24:00-vs-00:00
  hour-cycle environment quirk; prod_cpu_monitor (1) is ops-test debt.
- Program-attributable failures found by the gate and FIXED in the wrap:
  parity tidemill golden (doorway scene now 15s, walk extended to 16s and golden
  re-recorded under UPDATE_PARITY=1 with identical rng digests, cb03e7e23) and the
  Eastbrook provenance seals (renderer.ts is a fingerprinted input; seals re-minted
  per the established recipe, no capture retaken, 3316f1f49). Parity 78/78 green,
  eastbrook 26/26 green, tsc clean on the final tip.

## Task board

| Task | Status | Worktree / branch | Notes |
|---|---|---|---|
| P0.1 one clock | merged | (worktree removed) | ecf351394, merge 93fba6ea6; reviewer verdict MERGE with zero blocking findings (parity 277 pinned, 4 wire frames lockstep, monotonic reconnect, headless untouched); merged tree verified (tsc + 361 tests across 6 suites) |
| P0.2 one seed | merged | (worktree removed) | fae8971c1; true seed exposed Q0 toll shot pan 61.44 vs 60 deg/s, retuned 6.2s to 6.45s, exemptions stay empty |
| P0.3 shipped-bug fixes | merged | (worktree removed) | 9a7438684, merge cc1cda664; painter owns subtitle resting state + composite statue/plinth via new decorProps parts field; combined tree verified (tsc + 4 suites) |
| P0.4 liveness cluster | merged | (worktree removed) | 9f34aeee2 + e6aa74782, merge 2db4a5f73; architecture-reviewer verdict MERGE (0 blocking), should-fix closed with outside-at-arm pinning test + authoring constraint; P0 phase COMPLETE; scene suites re-verified in background |
| P1.1 typed references | merged | (worktree removed) | a89cf03c6, merge 565708cde; closed unions at the SceneDef layer, wire stays strings, sfx mapping exhaustive; self-committed, verified post-merge (tsc + 7 tests) |
| P1.2 authoring builder | merged | (worktree removed) | f3e3d2993, merge feca65ca1; pure src/sim/scenes/authoring.ts (beat maps, coveredCut, fadeInTail, buildScene) + 10 tests incl golden plain-object emission; verified post-merge |
| P1.3 voyage re-author | merged | (worktree removed) | 20ba4e99d, merged on tip; three scenes rebuilt on the builder (net -189 lines), zero P1.3 rows remain, 6 P3 rider rows preserved, 3 obsolete firstTransition rows removed with rationale, all pins moved deliberately; Q0 heavy walk green |
| P2.1 collision and support arms | merged | (worktree removed) | 0b9eb32b6, merge f63cf37af; collision.hull, support.entity, containment.rider + 3 synthetic controls; hull-through-pier and floating-crew now detected, exempt rows tagged P1.3 (hull) and P3 (riders) across the 3 voyage scenes |
| P2.2 motion quality arms | merged | (worktree removed) | 3436d8072, merge f0a6d7a45; motion.propWay/propAcceleration/visualFloor + cut.firstTransition, 4 controls; dead-stop defect detected, P1.3/P3-tagged rows; post-merge tsc+suite re-verified in background after a shell timeout interrupted the first attempt |
| P2.3 film grammar arms | merged | (worktree removed) | b95437884, merge 1b452c63c; 4 checks + synthetic controls + 8 exact-pinned P1.3 voyage exemptions; merge conflict vs P1.1 in cinematic_shots.test.ts resolved by hand (options object + SyntheticSceneOpDef), verified tsc + suite green |
| P2.4 reference resolution arms | merged | (worktree removed) | 2824937e1, merge 0cc1547d7; music/orphan/subjectRef/line-key/read-time checks + controls, Q0_STATUE_SHOT bound to statueBlock, 5 P1.3 rows added; ALL FIVE P2 ARMS MERGED |
| P2.5 lifecycle arms (smoke + skip sweep) | merged | (worktree removed) | aca936fd8, merge on feature tip; 5-scene smoke restoration + skip sweep (5-tick stride + all op boundaries, documented; 130s ferry scene made every-tick infeasible); FOUND real P3-owned scn_lb_q0_doorway actorMove skip parity defect, pinned with staleness guard; lifecycle suite re-verified on merged tree in background |
| P2.6 meta-test: controls cover MechanicalCheck | merged | (worktree removed) | c6fb18600, merged on tip; exhaustive union coverage meta-test + occlusion and ship-screen-direction watchmen; occlusion found 3 real sight-through-pier defects, fixed with sub-yard look-at shifts (z +0.30, x -1.00, z -0.50), zero skips; P2 PHASE FULLY CLOSED |
| P3 engine behaviors (deck riding, reduced motion, ease-in, tripwires) | merged | (worktree removed) | 29c75d5d4, merge 494e65bfc; reviewer verdict MERGE (parity 191 green, skip convergence float-exact, rows backed by real passes, 3 benign notes); exemptions table now EMPTY and pinned, linter suite zero skips |
| P4 editor cinematic panel | merged (both rounds) | (worktree removed) | round 1 e548fedd4, round 2 d7a8e3a1e; predicates extracted to src/sim/scenes/lint_core.ts (one source of truth for test + editor), gizmo layer + violation readout, linter zero skips, production build green; program-drift format fix be1c53e7c rode the wrap |
| P5a contact-sheet tooling | merged | (worktree removed) | 1d29967bb, merge ea3eb93da; pure plan/HTML cores + 4 tests, npm run cinematic:contact-sheet, loud HMR guard, tail-cut retry passes, per-still intent checklist |
| P5b workflow doc + PRD hygiene closing | merged | (worktree removed) | 9a90bb4bb, merged on tip; docs/design/cinematics-workflow.md (canonical), placement table exact (root CLAUDE.md +2 lines verified), PRD statuses, qa-gate naming; flagged biome drift in last_bell_campaign.ts + last_bell_scenes.test.ts (OUR program debt, format at final wrap) |

## Scheduling policy

- Up to 3 codex runs in parallel, launched as background shell commands
  (codex exec --sandbox workspace-write -C <worktree> "<spec>").
- Worktrees branch off the CURRENT feature-branch tip at start time; merged
  sequentially back into feature/last-bell-campaign after review; worktree deleted
  after merge.
- Review at merge time: diff review against the PRD task, targeted vitest suites,
  npx tsc --noEmit. Full `npm run gate` reserved for phase boundaries (known caveat:
  gate's changed-files biome step fails on the base branch's own lint debt vs main).
- Codex specs live in the session scratchpad (spec-<task>.md); run logs in
  codex-<task>.log next to them.
- Codex launches need the linked-worktree git metadata writable to commit:
  -c 'sandbox_workspace_write.writable_roots=["/Users/chrisherrmann/Code/world-of-claudecraft/.git"]'
  (P0.2 and P0.3 predate this fix; their commits were made by the reviewer after review).
- P2 arms run ONE at a time: they all extend tests/cinematic_shots.test.ts and the
  MechanicalCheck union, so parallel arms would conflict in the same file.
- P1.2 (builder) serializes after P1.1 (the builder consumes the typed references).

## Merge log

- (none yet)

## Base

- Program base commit: f94071025 (docs(prd): add the cinematics quality program PRD)
  on feature/last-bell-campaign.
