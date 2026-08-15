---
name: feature-plan
description: Break a big feature into a phased multi-session implementation plan with per-phase starter prompts, progress tracking, and cross-session state. Invoked only as the /feature-plan slash command (disable-model-invocation keeps it out of the model-facing skill list by design); pass the feature description inline or you will be asked for it.
disable-model-invocation: true
user-invocable: true
---

# Feature Plan: multi-phase implementation planning

Break a large feature into a phased implementation plan designed for multiple Claude Code
sessions. Every phase runs as its own fresh session. The whole point is to **save context
per phase**: the orchestrator delegates reading and fan-out to subagents and keeps only
conclusions, so each session stays sharp. Effort levels, fan-out expectations, and
per-model behavior are NOT this skill's business: the root `CLAUDE.md` "Working style and
effort by model" block owns them, and every prompt this skill emits references that block
instead of naming a model.

The user provides a feature description inline (`/feature-plan add a guild bank`) or you
ask for one.

**Before doing anything else: scan memory.** Check the `MEMORY.md` index and project
memory entries for prior decisions or feedback relevant to this feature's domain. Past
incidents encoded there are cheaper than rediscovering them.

## What this repo is (so the plan fits it)

Architecture and invariants live in the root `CLAUDE.md` (one sim three hosts, the
`IWorld` seam, server authority, 20 Hz determinism via `Rng`, the i18n contract, the
same-change content obligations); the plan must respect all of them, so reference that
file rather than restating it. Two planning-specific consequences:

- A feature added to the offline `Sim` is not done until it is mirrored online (via
  `ClientWorld`) and, where relevant, exposed to the RL env. Extend `IWorld` first, then
  implement it in **both** worlds.
- **The contributor i18n policy is stated ONCE, here, and referenced everywhere else in
  the generated packet.** Every new player-visible string is a `t()` key added in ENGLISH
  to the matching `src/ui/i18n.catalog/<domain>.ts` module and rendered via `t()`; never
  edit the `src/ui/i18n.locales/` overlays (release-time maintainer work; the one
  exception, M16: a wordy new English value also needs its non-Latin fills in the same
  change). Sim/server stay language-agnostic but their player text needs a matcher rule
  in `src/ui/sim_i18n.ts` / `src/ui/server_i18n.ts` in the SAME change; the S3 guard
  (`tests/localization_fixes.test.ts`) enforces it. Full model: root `CLAUDE.md` and
  `src/ui/CLAUDE.md`.

## Orchestration toolbox: choose deliberately before running any phase

Pick the lightest tool that fits; escalate only when the work demands it. (How
aggressively to fan out is a working-style question; the root block owns it. The one
rule this skill repeats because every emitted prompt depends on it: **request fan-out
explicitly and name the split**; do not assume the runner infers it.)

| Tool | Use it when | Context effect |
|------|-------------|----------------|
| **Explore subagent** (`subagent_type: "Explore"`) | Mapping the codebase, locating files/patterns, "where is X used" | Raw reads stay in the subagent; only the summary returns. Default for all recon. |
| **Parallel Agent fan-out** (multiple `Agent` calls in one message) | Independent vertical slices (sim + server + ui + tests); parallel reviews | Each agent's work stays in its own context. Cap at ~5 manual agents. |
| **Agent teams** (`name:` + `SendMessage`) | Multi-round collaboration where an agent needs its prior context | Reuses a warm agent. Never `mode: "plan"` on teammates (they stall). |
| **Workflow** (the `Workflow` tool) | Batch-heavy phases needing scale + verification: mass edits, content sweeps, exhaustive audits | Intermediate results live in script variables, not your context. Opt-in: only when the running prompt includes `ultracode` (or the user asked). |
| **ToolSearch / deferred tools** | A phase needs a tool not loaded by default | Keeps unused schemas out of context. |

Hard rules:
- **Subagents inherit the parent model**; set a model only when you deliberately want a
  cheaper tier.
- **Manual parallel fan-out caps at ~5 agents.** Past that, use a Workflow; for
  batch-heavy phases the starter prompt should TELL the runner to add `ultracode`.
- **Shared working tree.** A concurrent session may share the checkout. Commit
  sequentially with EXPLICIT paths, never `git add -A` (memory:
  shared-worktree-commit-care).

## Prompting discipline (apply to EVERY prompt this skill emits)

1. **State scope literally and exhaustively.** Write "all three hosts", "every new player
   string", "each of the nine classes"; never "the sections" or "the files". (Root
   working-style rule: models follow instructions literally; when a rule covers every
   case, say "every" or "all".)
2. **Reserve ALL-CAPS / NON-NEGOTIABLE for genuine determinism, server-authority,
   security, and data-integrity gates.** If everything is emphasized, nothing is.
3. **For review/QA agents, the finding stage is COVERAGE, not filtering.** Always prompt:
   "report every issue including low-severity and uncertain ones; ranking happens in a
   later step."
4. **Budget for truncation.** Resume a review agent that truncates with: *"Stop reading
   more files. Output the full report now based on what you've already seen. No more tool
   calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."*
5. **Demand structured handoffs.** A phase ends by writing its state to `progress.md` /
   `state.md` and (for big packets) a per-phase resume file; that IS the cross-session
   memory. The next session reads the summary, not the transcript.

## Context discipline (how each phase stays cheap)

- The orchestrator does **not** read large docs or sprawl across source files: it spawns
  an Explore agent that returns a focused summary (the coordinator monoliths and the i18n
  catalog + overlays are the big offenders; never read them whole in the main loop).
- Give each implementation agent ONLY the slice it needs (the Explore summary + its own
  files), never the raw planning docs.
- Delegate web/doc lookups to a subagent (classic-era formula references, a third-party
  API); keep raw docs out of the main context.
- For 12+ phase packets, use per-phase resume files so a fresh session resumes from a
  checkpoint, not from scratch.

## Step 1: Understand the feature

If no inline description, ask. Get enough detail to understand scope; do not
over-interrogate.

## Step 2: Explore the codebase + research the external surface (parallel agents)

Spawn in parallel in a single message; do NOT read these files yourself. Adapt the split
to the feature (a content-only feature needs the sim/content explorer, not the net
explorer):

- **`sim-explorer`**: `src/sim/` core (tick loop, combat/abilities/threat, mob AI,
  social/economy systems, RL observation surface, `Rng` usage) and the overlapping
  `src/sim/content/` records; note relevant test patterns in `tests/`.
- **`server-explorer`**: `server/` (GameServer loop and dispatch, wire snapshots,
  Postgres persistence and the inline `SCHEMA`, auth, social/moderation, rate limits).
- **`client-explorer`**: `src/render/`, `src/ui/`, `src/game/`; note which `IWorld`
  members the feature will read or call.
- **`net-explorer`**: `src/net/` and the wire lockstep with `server/game.ts`; use when
  anything crosses the network.
- **`admin-explorer`**: `src/admin/` when there is an operator surface (operators are
  users; admin strings localize too).
- **`headless-explorer`**: `headless/` + `python/` for RL-env work.

**Web-research agent (REQUIRED for any third-party surface or exact classic-era
formula):** pull current, primary-source data, return a tight brief with citations, and
mark anything unverifiable OPEN rather than guessing. Fold OPEN items into the plan as
blockers, never assumptions. Gameplay math follows real classic-era formulas; never
invent balance numbers.

## Step 3: Brainstorm with the user

Present summarized findings and brainstorm: what exists vs what is new, what `IWorld`
surface needs adding, ideas that leverage existing systems (parties, duels, arena, trade,
market, dungeons, talents, pets), what stands out while staying classic-faithful, and any
OPEN items needing a human decision before phasing. Get buy-in on the vision before
planning phases.

## Step 4: Create the planning documents

Create `docs/{feature-name}/`:

- `README.md`: packet entry point and index; links every phase file plus the
  cross-cutting docs. A newcomer orients from here alone.
- `brainstorm.md`: vision, approved ideas, current state, reusable systems/`IWorld`
  members, new work needed, research findings + OPEN items.
- `implementation-plan.md`: TOC + canonical workflow + phase summary table. It carries
  the packet's ONE copy of the review-dispatch rules (below) and the validation matrix
  reference; starter prompts point at it, never inline a copy.
- `progress.md`: status table (implementation AND QA phases as separate rows) +
  per-phase deliverable/acceptance checklists + notes per completed phase.
- `state.md`: cross-phase cheat sheet (below).
- `qa-checklist.md`: whole-feature integration matrix verified once at packet completion
  (three-host parity, determinism, i18n completeness per the policy above, classic
  fidelity, server authority, persistence back-compat, performance budgets, copy scan,
  gate green, deploy verification only if deployed).

**For packets with 12+ phases (or non-trivial phases), prefer per-phase resume files**:
`phase-XX-{slug}.md` (a self-contained implementation prompt a fresh session can execute
without the TOC) and `phase-XX-qa.md` (its QA prompt). `implementation-plan.md` then
becomes TOC + workflow + summary table.

### Phase sizing (critical)

Prefer many small phases over fewer large ones. A phase that tries to do too much burns
context, produces sloppier output, and misses details. Each implementation phase must be
completable in a single focused session without exhausting the context window:

- One phase = one logical slice ("add the ability to the sim + content data + tests", or
  "wire the HUD window to the new `IWorld` members"). If you write "and also..." in a
  phase description, split it.
- 2 to 4 deliverables per phase is ideal; more than 5 means the phase is too big.
- When in doubt, split. Two small phases with QA passes beat one large rushed phase.

### Phase ordering

1. Phase 1 is always architecture/foundation: extend `IWorld` and the sim data model,
   establish the pattern later phases follow.
2. Every implementation phase gets a QA phase immediately after it (Phase 1, Phase 1 QA,
   Phase 2, ...), each a separate session.
3. Sim behavior lands server-side and mirrors into `ClientWorld` as you go, not at the
   end.
4. Then server persistence (additive DDL, save/load round-trip, JSONB back-compat), then
   renderer/HUD/i18n surface, then polish last.
5. The final QA phase closes the packet and offers **packet teardown** (below).

### Review dispatch (the one canonical copy lives in the generated plan)

The reviewer roster and what each agent owns is the table in `docs/qa-gate.md`
("Reviewer coverage"); do not copy it here or into prompts. What that table lacks, and
what `implementation-plan.md` DOES carry as the packet's single copy, is the dispatch
trigger: which diff surfaces spawn which agent. Generate it from these heuristics:

- Spawn an agent ONLY when the phase diff touches its surface: `privacy-security-review`
  for `server/`, `src/admin/`, `src/net/`, deploy/secret files, SQL/auth, or any new
  nondeterminism source in `src/sim/`; `migration-safety` for DDL or persisted-state
  shape changes; `database-performance-reviewer` for anything that can change database
  work or growth; `cross-platform-sync` for `IWorld` facets, sim behavior/events, wire or
  matcher changes, or the RL surface; `architecture-reviewer` for `src/sim/` determinism
  and the `SimContext` seam; `frontend-seam-reviewer` for `src/ui/`, `src/styles/`, and `src/render/`
  presentation code (plus the graphics-tier files under `src/game/` it names); `content-obligations-reviewer` for any `src/sim/content/`
  record change (the same-change obligations); `gate-integrity-reviewer` for gate/CI
  pipeline files; `test-coverage-auditor` when a phase's test additions are the
  deliverable; `qa-checklist` when a phase or deliverable set is COMPLETE.
- Most phases trigger one or two agents. If no surface matches (docs-only, test-only),
  spawn NONE; do not default to running a security review anyway.
- Prompt every spawned reviewer for COVERAGE, not filtering, and do not commit until each
  reports no BLOCKING issues.

### Validation (referenced by every phase; the matrix lives in `state.md`)

Baseline per phase: `npx tsc --noEmit` plus the affected vitest files; add
`tests/architecture.test.ts` for `src/sim/` changes, `tests/localization_fixes.test.ts`
if any player text or emit changed, the wire/snapshot suites (`tests/snapshots.test.ts`,
`tests/env_protocol.test.ts`, `tests/bandwidth.test.ts`) if the protocol changed, and
`npm run ci:changed` for Biome on changed files (fix with a SCOPED
`npx @biomejs/biome check --write <file>`, never whole-tree). Before a merge:
`node scripts/gate_select.mjs` is the pre-merge bar; `npm run gate` the deeper full
check. Step lists and tiers live in `docs/qa-gate.md`; do not restate them in prompts.

### Code hygiene (include once in the plan's workflow section)

Module-first per the root Modularity section and the `extract-and-test` skill (the
monolith ratchet `tests/monolith_budget.test.ts` enforces it); every new behavior gets
tests (sim changes get a determinism assertion); update or remove tests you break;
delete replaced code, unused imports, and dead types; never hand-edit generated files.

### The shared starter-prompt template (one template; QA phases apply the delta below)

````
### Starter Prompt
```
This is Phase N {(QA)} of the {Feature Name} feature: {Phase Title}.

Harness: Claude Code. Follow the root CLAUDE.md "Working style and effort by model"
block for effort and fan-out; this prompt names no model.
ULTRACODE: add the keyword `ultracode` to this prompt if this phase is batch-heavy
(content sweeps, bulk catalog additions, exhaustive audit) so orchestration runs
through a Workflow instead of hand-spawned agents.

Goal: {one sentence}

STEP 0 - PRE-FLIGHT:
- Verify `git status` is clean; if not, ask the user (a concurrent session may share
  this checkout).
- Memory scan: check MEMORY.md and entries relevant to this phase's domain
  (suggested topics: {phase-specific}).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly; save your context):
Spawn an Explore agent to read and summarize:
- docs/{feature-name}/state.md, progress.md, and this phase's file
- {relevant source files, listed individually}
- Root CLAUDE.md + the relevant sub-CLAUDE.md files
The agent returns: {specific info this phase needs}.
{If a third-party API or exact classic-era formula is involved: also spawn a
web-research agent; unverifiable facts are OPEN, never guessed.}

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Pick the lightest tool that fits (Explore for recon, parallel Agent fan-out for
independent slices, Workflow for batch/scale). Request fan-out EXPLICITLY and name
the split. Give each agent ONLY the Explore summary. Never `mode: "plan"` on
teammates. Use `isolation: "worktree"` only if agents edit overlapping files.

{Agent A} deliverables:
- {bullet}

INVARIANTS THIS PHASE MUST KEEP (call out the ones in play):
- Determinism: all randomness via `Rng`; no wall-clock in `src/sim/`.
- Seam: extend `IWorld` first, then implement in BOTH `Sim` and `ClientWorld`.
- Server authority: the client never decides outcomes.
- i18n: the contributor policy in docs/{feature-name}/implementation-plan.md
  (English-only catalog keys; matcher rule in the same change for sim/server text).
- Content: any src/sim/content/ record carries its same-change obligations
  (root CLAUDE.md new-content bullet: deeds, reliquary, wiki regen + guide keys,
  item art, name fills).
- Classic-era formulas only; do not invent balance numbers.

Out of scope (do NOT do in this phase):
- {explicit exclusions}

STEP 3 - VALIDATION + REVIEW DISPATCH:
- Run: {phase-specific commands from the state.md validation matrix}.
- Spawn review agents per the dispatch rules in
  docs/{feature-name}/implementation-plan.md (the one canonical copy): check
  `git diff --name-only` against the phase-start commit, spawn ONLY matching agents
  (often one or two; none if no surface matches), prompt each for COVERAGE not
  filtering, resume any truncation with the standard "Stop reading. Output the full
  report now." message. Do not commit until no BLOCKING issues remain.

STEP 4 - COMMIT CADENCE:
{2-5} commits, Conventional Commits with scope and a body, EXPLICIT paths, never
`git add -A`, no em dashes or emojis:
- {commit headline}

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] {item}

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (phase status; deferrals) and state.md (new IWorld members,
  SimEvents, wire fields, endpoints, tables, i18n keys; locked decisions).
- Record surprising rules learned in memory for the next session.

STEP 7 - FINAL RESPONSE FORMAT:
End with: phase status, files touched, validation results, review verdicts, deferred
items, and a one-line handoff for the next session.

STOPPING RULES:
- {explicit stop conditions, e.g. "stop if determinism cannot be preserved"}
```
````

**QA-phase delta** (apply to the same template):
- Goal becomes: audit the paired implementation phase for correctness, missing tests,
  dead code, determinism, three-host parity, and i18n completeness; the Explore agent
  also loads the implementation phase's prompt (what was promised) and the phase diff.
- STEP 2 spawns audit agents instead of implementers: a correctness agent (every
  deliverable and acceptance criterion actually met; edge cases; offline/online parity),
  a test-coverage agent (untested paths, determinism assertions, orphaned tests,
  assertions that mean something), and a dead-code/cleanup agent (unused
  imports/types, import invariant, leftover TODOs); plus the dispatch-rule reviewers and
  `qa-checklist` (this is the phase-completion gate).
- STEP 4 becomes FIX: apply all BLOCKING and SHOULD-FIX items, re-run the validation
  matrix, commit fixes separately from the verdicts.
- Final response format: QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts found
  and fixed, deferred items, handoff.
- Final QA phase only: run **packet teardown** (below) before the PR.

### Cross-cutting gates (include once in the plan, referenced by phases)

- **Persistence phases:** additive, idempotent inline DDL (`CREATE TABLE IF NOT
  EXISTS` / `ADD COLUMN IF NOT EXISTS`; there is no migrations directory), JSONB
  back-compat for old saves, indexes for new predicates, and a save/load round-trip
  test.
- **Client phases:** touch controls and mobile safe areas work (verify with the mobile
  screenshot scripts, e.g. `node scripts/mobile_visual.mjs`); no hover-only essential
  info.
- **Performance:** sim work stays in the 20 Hz tick budget (no per-tick allocations in
  hot paths); snapshots stay interest-scoped and delta-guarded; renderer reads, never
  mutates; `npm run asset:budget` / `npm run perf:tour` for budget-touching phases; keep
  the dependency set tiny.
- **Deploys are rare, deliberate, separate steps**, never part of a phase: follow
  `DEPLOY.md` end to end (it owns the update path and the `/api/status` health check).
  Never set `ALLOW_DEV_COMMANDS=1` in production.

### state.md contents

ONLY what the next session needs: current phase + status; locked design decisions;
non-negotiable constraints; the validation matrix by change type (sim-only, content-only,
server-only, net/wire, ui/render, headless/RL, pre-merge via
`node scripts/gate_select.mjs`, plus `npm run ci:changed` for any code change); key file
paths; per-phase lists of new files, `IWorld` members, `SimEvent`s / wire fields,
endpoints, tables, i18n keys; OPEN research items and known gotchas.

### Packet teardown (final phase only)

The packet in `docs/{feature-name}/` is scaffolding, not a shipping artifact. Once every
phase is green, the final QA phase MUST offer to remove it before a PR: surface any
deferred follow-ups FIRST, ask the user explicitly, and on confirmation delete ONLY that
directory with an explicit path (`git rm -r docs/{feature-name}/` and a
`docs: remove {feature-name} planning scaffolding` commit if committed; `rm -rf` if never
committed). If the user declines, leave it. Never delete anything else and never
`git add -A`.

## Step 5: Commit and summarize

Commit the planning docs (EXPLICIT paths, Conventional Commit with a body, no em dashes
or emojis): `docs: add {feature-name} phased implementation plan`.

Present to the user: phase count and one line per implement/QA pair; how to start Phase 1
(paste its starter prompt into a fresh session); locked decisions in `state.md`; OPEN
research items; and that the final QA phase offers packet teardown before the PR.
