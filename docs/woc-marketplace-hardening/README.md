# WOC Marketplace Hardening packet

Internal planning scaffolding (deleted before the PR) for taking the P2P $WOC
marketplace from "well architected, not safe to enable" to the review's full acceptance
bar, across three repos: the game (`feature/woc-marketplace`), the economy service
(PR #31), and the ops dashboard (PR #13).

Start here:

- `review.md`: the 2026-08-11 three-repo readiness and security review. Findings source
  of truth (B1 to B7 ship-blockers, H1 to H15, mediums, PRD gaps, acceptance bar).
- `implementation-plan.md`: the shared workflow every session follows (cadence,
  pre-flight, commit rules, review dispatch, QA workflow) plus the 22-phase summary table.
- `state.md`: live cross-session state: next file to run, open rulings for Fernando,
  validation matrix, findings-to-phase map, gotchas.
- `progress.md`: per-phase status ledger.
- `qa-checklist.md`: the whole-feature matrix phase 22 verifies with evidence.
- `phase-NN-*.md` / `phase-NN-qa.md`: one implement + QA pair per phase; every file is a
  self-contained spec a fresh session executes.

Cadence: phase NN session, then phase NN QA session, then phase NN+1. Never skip a QA.
Every session ends by naming the next file to run.
