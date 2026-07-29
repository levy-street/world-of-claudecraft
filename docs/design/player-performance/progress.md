# Player Performance Overhaul: Program Progress

Program source of truth: brainstorm.md (revision 2, decisions resolved 2026-07-23).
Cadence per packet: phased-packet (each phase lands with its phase-NN-qa.md before the
next begins; full gate + /qa before a packet is called done; PR off the latest release
branch).

| Packet | Scope | Plan doc | Status |
|---|---|---|---|
| 0 | Instruments (draw stats, report dimensions, net traces, honest gates, doctor nudge, baselines) | packet-0-instruments.md | PHASES COMPLETE (01-07, 2026-07-23 to 07-24; per-phase QA consolidated into the plan doc's Close-out record at the combined-branch close, full text in git history; baselines.md + jitter-soak-baseline.json committed). Ships with packet 3 in the combined PR; the two sweep amendments were ratified in the PR #2372 review (2026-07-24). PENDING: maintainer captures (live-site trace, production peak + 48 h summary; commands in baselines.md section 4) |
| 3 | Input cadence contract (limiter redesign; ships with or before 1-2) | packet-3-input-cadence.md | PHASES COMPLETE (01-06, 2026-07-24; per-phase QA consolidated into the plan doc's Close-out record at packet close, full text in git history; soak artifacts soak-packet-3.md + jitter-soak-packet3.json committed; the list-read guard landed per the maintainer's same-day ruling). Ships with packet 0 in the combined PR off release/v0.30.0 (the maintainer's go, 2026-07-24; the release refresh and the packet 0 merge were resolved per ruling R1). PENDING: the maintainer's post-deploy scrape of the drop and seq-gap counters (commands in soak-packet-3.md, runbook item 6) |
| 1 | Crowd character cost (articulated ceiling, far-swap exemptions, governor rung, nameplate cap) | not authored | PENDING |
| 2 | Hitch elimination (player rig pooling, create deadline, compile batching, light budget, HUD thrash) | not authored | PENDING |
| 4 | Fleet pixel-fill defaults (ultra DPR/AO, governor on auto-ultra, M-series to HIGH) | not authored | PENDING |
| 5 | Graphics settings rationalization (knob coherence, governor retune, orbit bench) | not authored | PENDING |
| 6 | Server broadcast residuals (dirty epochs, invalidation matrix, catch-up policy, load soak) | not authored | PENDING |

Branch state: packets 0 and 3 are COMBINED on feature/input-cadence (worktree
worktree wocc-input-cadence) for one PR off release/v0.30.0, at the
maintainer's request; feature/perf-instruments (worktree
worktree wocc-player-perf) retains packet 0's standalone history and
is superseded by the combined branch. The R1 add/add union for these docs was applied
at the combine merge.

Execution order ruling (brainstorm section 7): 0 first; 3 with or before 1-2; then 4-5;
6 alongside as capacity work.
