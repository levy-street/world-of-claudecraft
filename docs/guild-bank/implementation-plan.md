# Guild Bank: implementation plan

Four implementation phases, each followed by a QA phase, each its own Claude Code session.
Model: the newest Claude coding model available (Fable 5 at plan time), xhigh effort.
Phase starter prompts live in the per-phase files; this file carries the canonical
workflow and review dispatch matrix they reference.

| Phase | File | Slice | Surfaces |
|---|---|---|---|
| 1 | phase-01-foundation.md | Sim state module, membership stamp, facet | `src/sim/`, `src/world_api/` |
| 1 QA | phase-01-qa.md | Verify Phase 1 | |
| 2 | phase-02-ops-and-wire.md | Op bodies, gating, `guild_bank_*` wire end to end | `src/sim/`, `src/world_api.ts`, `server/game.ts`, `src/net/`, `src/ui/sim_i18n.ts` |
| 2 QA | phase-02-qa.md | Verify Phase 2 | |
| 3 | phase-03-persistence.md | DDL, escrow transaction, ledger, creation fee, disband guard | `server/` |
| 3 QA | phase-03-qa.md | Verify Phase 3 | |
| 4 | phase-04-ui.md | Guild tab in the bank window, i18n, mobile | `src/ui/` |
| 4 QA | phase-04-qa.md | Verify Phase 4, close packet | |

## Team workflow (every phase)
1. **Pre-flight**: `git status` clean in THIS worktree
   (`world-of-claudecraft-guild-bank`); memory scan (`MEMORY.md` index, guild + bank
   entries).
2. **Load context**: one Explore agent reads `state.md`, `progress.md`, the phase file,
   and the phase's listed sources; returns a focused summary. Never read `src/sim/sim.ts`,
   `src/ui/hud.ts`, or `server/game.ts` whole in the main loop.
3. **Execute**: default fan-out is listed per phase (vertical slices, each agent writes its
   own tests). Cap manual fan-out at 5; no phase here is batch-heavy enough for an
   ultracode Workflow unless QA chooses adversarial-verify.
4. **Validate + review**: run the `state.md` validation-matrix rows matching the diff;
   dispatch review agents per the matrix below, prompting each for COVERAGE not filtering
   ("report every issue including low-severity and uncertain ones"); resume truncated
   agents with the standard "Stop reading. Output the full report now. Format: BLOCKING /
   SHOULD-FIX / NICE-TO-HAVE / VERDICT." Do not commit with BLOCKING findings open.
5. **Docs + memory**: update `progress.md` + the `state.md` ledger; record surprises to
   memory; commit with explicit paths, Conventional Commits with scope + body.

Code hygiene in every phase: module-first (`sim.ts` gains only thin delegates; the ops
live in `src/sim/guild_bank.ts`), tests for every new behavior including a same-seed
determinism assertion for sim logic, no dead code, no unused imports, no generated-file
hand-edits, dependency set unchanged.

## Review dispatch matrix (canonical copy for this packet)
Spawn ONLY agents whose row matches the phase diff:

| Agent | Spawn when the diff touches | Expected phases |
|---|---|---|
| `architecture-reviewer` | any `src/sim/` change (determinism, `SimContext` seam, draw order) | 1, 2, 3 (load hooks) |
| `cross-platform-sync` | `src/world_api/**`, `COMMAND_NAMES`, `server/game.ts` wire, `src/net/online.ts`, `sim_i18n.ts` | 1, 2, 4 (matcher rows) |
| `privacy-security-review` | `server/`, SQL, auth-adjacent validation | 2, 3 |
| `migration-safety` | DDL, JSONB save/load shapes | 3 |
| `database-performance-reviewer` | query cost/cadence, table growth, transaction scope | 3 |
| `frontend-seam-reviewer` | `src/ui/`, `src/styles/` | 4 |
| `qa-checklist` | a phase is COMPLETE | every QA phase |

## Cross-phase rules
- Names and constants come from `state.md`; a phase that wants to change one updates
  `state.md` in the same commit and says so in its final response.
- Every phase that touches persistence follows the additive-DDL + back-compat +
  round-trip-test rules (skill standard; Phase 3 carries them explicitly).
- Phase 4 QA runs the whole-feature `qa-checklist.md`, captures PR screenshots, runs
  `npm run gate`, and offers packet teardown before the PR.
