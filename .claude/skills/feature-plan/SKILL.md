---
name: feature-plan
description: Break a big feature into a phased implementation plan with starter prompts, progress tracking, and cross-session state. Opus 4.8 native - each phase runs as its own session with context-saving subagents, agent teams, and (for batch-heavy work) deterministic Workflows, plus a web-research pass for any third-party surface. Use when a feature is too large for one session.
disable-model-invocation: true
user-invocable: true
---

# Feature Plan: Multi-Phase Implementation Planning (Opus 4.8)

Break a large feature into a phased implementation plan designed for multiple Claude Code sessions. Every phase runs as its own fresh session and uses **Opus 4.8 at xhigh effort** (`ultracode` where the phase warrants deterministic multi-agent orchestration). The whole point is to **save context per phase**: the orchestrator delegates reading and fan-out to subagents and keeps only conclusions, so each session stays sharp.

The user will provide a feature description either inline (e.g., `/feature-plan add a guild bank`) or you will ask them to describe it.

**Before doing anything else: scan memory.** If you use Claude Code's memory feature, check your `MEMORY.md` index and project memory entries for prior decisions or feedback relevant to this feature's domain. Past incidents encoded there are cheaper than rediscovering them.

---

## What this repo is (so the plan fits it)

World of ClaudeCraft is a classic-style micro-MMO **and** a headless RL environment, both driven by one deterministic TypeScript simulation core. The load-bearing ideas the plan must respect:

- **One sim, three hosts.** The exact same `src/sim/` code runs the offline browser world, the online authoritative server (`server/`), and the RL env (`headless/`). Behavior must be identical everywhere. A feature added to the offline `Sim` is not done until it is mirrored online (via `ClientWorld`) and, where relevant, exposed to the env.
- **`IWorld` is the only seam** (`src/world_api.ts`). `render/` and `ui/` talk only to `IWorld`; the offline `Sim` satisfies it structurally and the online `ClientWorld` implements it by mirroring server snapshots. New feature: extend `IWorld` first, then implement it in **both** worlds.
- **The server is authoritative.** Clients stream intent + commands at 20 Hz; the server runs the one shared `Sim` and returns interest-scoped snapshots (radius defined in `server/game.ts`) + per-player events. All combat, loot, quest credit, and economy resolve server-side. The client never decides outcomes.
- **Determinism is non-negotiable.** Fixed 20 Hz tick (`DT = 1/20`, `src/sim/types.ts`); all randomness goes through `Rng` (`src/sim/rng.ts`). Never `Math.random`, `Date.now`, or `performance.now` in sim logic. Same seed gives the same world.
- **i18n is a release gate.** Every player-visible string is a `t()` key present in **every** locale. Sim/server stay language-agnostic (no `t()`, no DOM) but emit player text that is re-localized at the client boundary via the matchers in `src/ui/sim_i18n.ts` / `src/ui/server_i18n.ts`. The S3 guard (`tests/localization_fixes.test.ts`) enforces it.

---

## Orchestration Toolbox (Opus 4.8) - choose deliberately before running any phase

Opus 4.8 self-initiates **fewer** subagents than prior models, so you MUST request fan-out explicitly. Pick the lightest tool that fits; escalate only when the work demands it.

| Tool | What it is | Use it when | Context effect |
|------|-----------|-------------|----------------|
| **Explore subagent** (`subagent_type: "Explore"`) | Read-only search agent; reads excerpts, returns conclusions | Mapping the codebase, locating files/patterns, "where is X used" | Raw file reads stay in the subagent; only the summary returns. Default for all recon. |
| **Parallel Agent fan-out** (multiple `Agent` calls in one message) | Several independent agents in one turn | Independent vertical slices in a phase (sim + server + ui + tests); parallel reviews | Each agent's work stays in its own context; you keep the results. Cap at ~5 manual agents. |
| **Agent teams** (`name:` + `SendMessage`) | Addressable, longer-lived agents you can hand more work to with context intact | Multi-round collaboration where an agent needs its prior context (iterative implement, fix, re-review) | Reuses a warm agent instead of re-priming a fresh one. Never `mode: "plan"` on teammates (they stall). |
| **Workflow** (the `Workflow` tool) | A JS script orchestrating dozens to hundreds of subagents deterministically (pipeline / parallel / loop-until-dry / adversarial-verify), with structured-output schemas | A phase is batch-heavy or needs scale + verification: mass edits, content sweeps across many tables, exhaustive audits, adversarially-verified review. Requires explicit `ultracode` opt-in in the running prompt. | Intermediate results live in script variables, not your context. Scales far past manual fan-out (16 concurrent / 1000 total). |
| **ToolSearch / deferred tools** | On-demand tool-schema loading | A phase needs an MCP/integration tool not loaded by default | Keeps unused tool schemas out of context until needed. |

Hard rules (Opus 4.8 + this repo):
- **Subagents inherit the parent model.** No need to set model unless you deliberately want a cheaper tier; when unsure, omit.
- **Request fan-out explicitly** - say "spawn N agents in parallel", name the split. 4.8 will not infer it.
- **Manual parallel fan-out caps at ~5 agents.** Beyond that, coordination overhead wins - use a Workflow instead.
- **Workflow is opt-in.** Only reach for it when the running phase prompt includes `ultracode` (or the user asked for a workflow). For batch-heavy phases, the starter prompt should TELL the runner to add `ultracode` and orchestrate via a Workflow.
- **Shared working tree.** A concurrent session may share this exact checkout. Commit sequentially with EXPLICIT paths, never `git add -A`; often the right move is to commit nothing that is not yours. (See memory: shared-worktree-commit-care.)

---

## Opus 4.8 Prompting Discipline (apply to EVERY prompt this skill emits)

1. **State scope literally and exhaustively.** 4.8 follows instructions literally and will NOT generalize from one example. Write "all three hosts", "every locale in `translations`", "each of the nine classes" - never "the sections" or "the files".
2. **Reserve ALL-CAPS / NON-NEGOTIABLE for genuine determinism, server-authority, security, and data-integrity gates.** If everything is emphasized, nothing is. Routine conventions read fine in plain voice.
3. **For review/QA agents, the finding stage is COVERAGE, not filtering.** 4.8 honors "be conservative / don't nitpick" literally and reports fewer real issues. Always prompt: "report every issue including low-severity and uncertain ones; ranking happens in a later step."
4. **Review agents truncate mid-analysis.** Budget 2-3 SendMessage rounds; resume with: *"Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."*
5. **Demand structured handoffs.** A phase ends by writing its state to `progress.md` / `state.md` and (for big packets) a per-phase resume file - that IS the cross-session memory. The next session reads the summary, not the transcript.

---

## Context Discipline (how each phase stays cheap)

- The orchestrator (main loop) does **not** read large docs or sprawl across source files. It spawns an Explore agent that returns a focused summary. (`src/sim/sim.ts` and `src/ui/hud.ts` are each ~5k+ lines and `src/ui/i18n.ts` is ~13k lines; never read them whole in the main loop.)
- Give each implementation agent ONLY the slice of context it needs (the Explore summary + its own files), never the raw planning docs.
- Delegate web/doc lookups to a subagent (classic-era MMO formula references, a Three.js or GLB asset technique, the `pg` Postgres driver, Cloudflare Turnstile, any third-party surface); keep raw docs out of the main context.
- For 12+ phase packets, use per-phase resume files so a fresh session resumes from a checkpoint, not from scratch.
- Use ToolSearch to pull in deferred tool schemas only when a phase actually needs them.

---

## Step 1: Understand the Feature

If the user did not provide a feature description inline, ask them to describe what they want to build. Get enough detail to understand scope, but do not over-interrogate.

## Step 2: Explore the Codebase + Research the External Surface (parallel agents)

Spawn these in parallel in a single message. Do NOT read these files yourself - save your context window. Each returns a summary, not raw dumps.

### Codebase Explore agents (`subagent_type: "Explore"`)
Adapt the split to the feature (a content-only feature needs the sim/content explorer, not the net explorer; add a `headless-explorer` for RL-env work):

**`sim-explorer`** - `src/sim/` core: tick loop, combat/abilities/threat, mob AI, parties/duels/arena/trade/market/dungeons, the RL observation surface, `Rng` usage, and overlapping content in `src/sim/content/` (classes, abilities, zones, dungeons, items, talents). Note relevant test patterns in `tests/`.

**`server-explorer`** - `server/`: `GameServer` loop and command dispatch (`server/game.ts`), interest-scoped snapshots (`wireEntity`/`selfWireJson`), Postgres persistence and the inline `SCHEMA` (`server/db.ts`) + `SOCIAL_SCHEMA` (`server/social_db.ts`), auth (`server/auth.ts`), social/moderation, rate limiting.

**`client-explorer`** - `src/render/` (Three.js renderer; reads world, never mutates), `src/ui/` (HUD, windows, tooltips, map, FCT, i18n), and `src/game/` (input, camera, keybinds, mobile/touch controls). Note which `IWorld` members the feature will read or call.

**`net-explorer`** - `src/net/` (`ClientWorld implements IWorld`, REST auth, WS mirror) and the wire-protocol lockstep with `server/game.ts` (`applySnapshot`/`applyWire`, `SimEvent` handling). Use when the feature changes anything that crosses the network.

**`admin-explorer`** - `src/admin/` (the separate admin dashboard SPA, its own `admin.html` entry and `admin/api`) and its dedicated i18n catalog `src/admin/i18n.ts`. Use when the feature has an admin, moderation, or operator surface. Operators are users, so admin strings localize too.

(Add **`headless-explorer`** for `headless/` + `python/` RL-env work. One focused agent per surface, up to the ~5-agent cap.)

### Web-research agent (REQUIRED when the feature touches any third-party surface)
If the feature involves a third-party API, SDK, library, framework, cloud service, or a real classic-era MMO formula you need to get exactly right, spawn a web-research agent (`general-purpose`, or `claude-code-guide` for Claude tooling; both have WebSearch/WebFetch). Instruct it to pull **current, primary-source** data (prefer official docs over blogs), since APIs and references drift. Ask for: exact endpoints/auth/schemas (for an API), the canonical formula/constants (for balance math), version/migration notes, and licensing for any asset. It must return a tight brief with citations and **mark anything unverifiable as OPEN** rather than guessing. Fold OPEN items into the plan as blockers, never as assumptions. (Gameplay math must follow real classic-era formulas; do not invent balance numbers.)

For sweeping research (many sources cross-checked), the running session can use an `ultracode` Workflow (multi-modal sweep + adversarial-verify) instead of a single agent.

## Step 3: Brainstorm with the User

Present findings from the Explore + research agents (summarized, not raw) and brainstorm:
- What systems/content already exist vs what is new
- What `IWorld` surface exists vs what needs adding
- Creative ideas that leverage existing infrastructure (the sim already has parties, duels, arena, trade, market, dungeons, talents, pets)
- What would make this feature stand out while staying classic-faithful
- Any OPEN items from research that need a human/credential/design decision before phasing

Get user buy-in on the overall vision before planning phases.

## Step 4: Create Planning Documents

Create `docs/{feature-name}/` with these files:

- `README.md` - packet entry point and index, links to every phase file plus the cross-cutting docs.
- `brainstorm.md` - feature vision, approved ideas, current state summary, reusable systems/`IWorld` members, new work needed, research findings + OPEN items.
- `implementation-plan.md` - TOC + canonical workflow + phase summary table.
- `progress.md` - status table + per-phase deliverables/acceptance checklists.
- `state.md` - cross-phase cheat sheet (locked decisions, validation matrix, file paths, new `IWorld` methods / `SimEvent`s / wire fields / endpoints / tables / i18n keys).
- `qa-checklist.md` - whole-feature integration QA matrix (three-host parity, determinism, i18n completeness, classic fidelity, persistence, performance, deploy verification).

**For packets with 12+ phases (or when each phase is non-trivial), prefer per-phase resume files** instead of inlining everything into `implementation-plan.md`:
- `phase-XX-{slug}.md` - implementation prompt for phase XX (self-contained; a fresh-context Claude can paste it into a new session and execute without referring back to the TOC).
- `phase-XX-qa.md` - QA prompt for phase XX.
- `implementation-plan.md` then becomes a TOC + canonical workflow + summary table that references the per-phase files.

### README.md
The packet entry point: a one-paragraph feature summary, an index linking every phase and QA file in order, and links to the cross-cutting docs (`brainstorm.md`, `implementation-plan.md`, `progress.md`, `state.md`, `qa-checklist.md`). A newcomer should be able to orient from here alone.

### brainstorm.md
- Feature vision and approved ideas
- Current state summary
- Existing systems / `IWorld` members / content tables that can be reused
- New work needed (sim / server / net / render / ui / headless)
- Web-research findings (with citations) and OPEN items
- Open questions for design decisions

### implementation-plan.md
Split the feature into phases. Each implementation phase is followed by a dedicated QA phase. Both are separate Claude Code sessions. The numbering is: Phase 1 (implement), Phase 1 QA (verify), Phase 2 (implement), Phase 2 QA (verify), etc.

**Phase sizing (critical):**
Prefer many small phases over fewer large ones. A phase that tries to do too much burns context, produces sloppier output, and misses details. Each implementation phase should be completable in a single focused session without exhausting the context window. Rules of thumb:
- One phase = one logical slice (e.g., "add the ability to the sim + content data + tests" or "wire the HUD window to the new `IWorld` members"). If you find yourself writing "and also..." in the phase description, split it.
- 2-4 deliverables per phase is ideal. More than 5 is a sign the phase is too big.
- When in doubt, split. Two small phases with QA passes will always produce better work than one large phase that rushes through.

**Phase ordering principles:**
1. Phase 1 is always architecture/foundation: extend `IWorld` and the sim data model, establish the pattern all later phases follow.
2. Phase 1 QA verifies Phase 1.
3. Next phases implement sim behavior server-side and mirror it in `ClientWorld` (keep the offline and online worlds in lockstep as you go, not at the end).
4. Then phases that add server persistence (extend the `SCHEMA` DDL, save/load round-trip, back-compat for existing JSONB saves).
5. Then renderer/HUD/i18n surface, then polish/optimization last.
6. Every implementation phase gets a QA phase immediately after it.
7. The final QA phase closes the packet: once it passes, it offers **Packet teardown** (below), deleting `docs/{feature-name}/` only on explicit user confirmation so the PR does not ship the planning scaffolding.

**Team Workflow section (include at top of plan):**
Every phase runs on **Opus 4.8 at xhigh effort** (1m context variant where the file load demands it; `ultracode` for batch-heavy phases). Include this standard workflow:
1. **Step 0 - Pre-flight**: Verify `git status` is clean (and that no concurrent session is mid-change in your files). Scan your Claude Code memory (the `MEMORY.md` index and any entries matching the phase domain), if you use it.
2. **Step 1 - Load Context**: Spawn an Explore agent to read planning docs and relevant source files. The main agent does NOT read large docs directly. The Explore agent returns a focused summary.
3. **Step 2 - Choose Orchestration + Execute**: Pick the lightest tool from the Orchestration Toolbox. Default: parallel Agent fan-out, one agent per vertical slice (give each ONLY the Explore summary, not raw planning docs). For batch-heavy/audit/content-sweep phases, run an `ultracode` Workflow (pipeline + adversarial-verify) instead. Use `isolation: "worktree"` only when agents mutate overlapping files in parallel.
4. **Step 3 - Validation + Multi-Agent Review Dispatch**:
   - Run validation (see the matrix in `state.md`): `npx tsc --noEmit`; `npx vitest run tests/<affected>.ts` (or `npm test` for broad changes). If `src/sim/` changed, run `npx vitest run tests/architecture.test.ts` (the sim-purity guard: no render/ui/game/net/three imports, no DOM globals, no nondeterminism). If any player-visible text was added or an emit changed, run `npx vitest run tests/localization_fixes.test.ts` (the S3 i18n drift guard). If the wire protocol / snapshots changed, run `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts`. If assets changed, `npm run asset:budget`. Before a big merge, mirror CI: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
   - Spawn review agents using the **Review Dispatch Matrix** below. Spawn ONLY the agents
     whose surface this change actually touches. Most phases trigger one or two, not all
     four; a docs/test-only change triggers none. (Each agent also self-gates and exits
     cheaply if mis-dispatched, but spawning an out-of-scope agent still costs tokens, so
     gate at dispatch too.)
   - Prompt every review agent you DO spawn for COVERAGE not filtering ("report every issue including low-severity and uncertain ones"). Do not commit until each reports no BLOCKING issues. Resume any agent that truncates with: *"Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."*

#### Review Dispatch Matrix (single source of truth - keep the starter-prompt copies below in sync)

Match the change surface to the agent. Spawn an agent ONLY when its row matches the diff:

| Agent | Spawn ONLY when the diff touches | Skip it for |
|-------|----------------------------------|-------------|
| `privacy-security-review` | `server/`, `src/admin/`, `src/net/`, a deploy/secret file (Docker/compose/env/CI yml/`DEPLOY.md`), OR introduces SQL / auth / a secret / `ALLOW_DEV_COMMANDS` / a new `Math.random`\|`Date.now`\|`performance.now` in `src/sim/` | a pure `src/ui` / `src/render` / `src/game` / `src/sim/content` / docs / test change |
| `migration-safety` | `server/db.ts`, `server/social_db.ts`, a `server/*_db.ts`, or a `characters.state` JSONB serialize/deserialize path | any diff with no DDL and no persisted-state shape change |
| `cross-platform-sync` | `src/world_api.ts` (IWorld), `src/sim/` behavior/obs/`SimEvent`, `src/net/online.ts`, `server/game.ts` wire/dispatch, the matchers `src/ui/sim_i18n.ts`\|`src/ui/server_i18n.ts`, or the RL surface (`headless/`, `python/`) | a pure i18n *catalog* refactor (only `src/ui/i18n.ts` + locale data, `t()` keys unchanged) - `tsc` (`: typeof en`) + the resolved-equivalence test already cover it |
| `qa-checklist` | a phase / deliverable set is COMPLETE (it self-scales via its per-category Skip rules) | per-commit / mid-phase work, or a docs/test-only change |

If NO row matches (e.g. a docs-only, test-only, or comment change), spawn NO review agent.
Do not default to "run `privacy-security-review` anyway."
5. **Step 4 - Update Docs + Memory**: Update `progress.md` (mark phase complete; note deferrals) and `state.md` (new `IWorld` members, `SimEvent`s, wire fields, endpoints, tables, i18n keys, locked decisions). If you use Claude Code memory, record any surprising rules learned or current-state notes there for the next session. Commit doc updates in the same logical commit as the implementation (EXPLICIT paths).

**Agent Scaling Guidelines (include in Team Workflow):**
The starter prompts suggest a default split (sim + server + client + tests), but the orchestrator MUST assess the actual workload and scale accordingly:
- **Split large sim work across multiple agents** when a single agent would handle 4+ independent concerns (e.g., a new ability system + threat changes + content tables + RL obs surface). Signs a split is needed: the deliverable list has 10+ items, the work spans 4+ modules, or the concerns are independent.
- **Merge small work into a single agent** when one side has only 1-2 trivial changes (e.g., adding one `IWorld` getter, adding one i18n key). Do not spawn a dedicated agent for work that takes five minutes.
- **Split large client work** when a phase adds 3+ HUD windows plus renderer changes plus input wiring. One agent for HUD/i18n, one for renderer, one for input/camera/mobile.
- **Use dedicated test agents** when a phase has complex test requirements across multiple suites. A test agent can run in parallel after implementation agents commit their code.
- **Escalate to a Workflow past the manual cap.** Hand-orchestrated parallel fan-out tops out at ~5 agents. When a phase has 10+ independent, uniform tasks (e.g., add a new field to every zone's mob table, register 30 new i18n keys across 14 locales, transform many content entries), do not hand-spawn - write an `ultracode` Workflow that pipelines them with structured outputs and verifies each.
- **Each agent should own complete vertical slices** - do not split by file type (one for types, another for tests). Split by domain (one for the sim behavior + its tests, another for the HUD surface + its tests). Each agent writes its own tests for the code it creates.

**Code Hygiene section (include in Team Workflow):**
Every phase must enforce:
- **Module-first**: new self-contained behavior goes in its own focused module behind an existing seam (`IWorld`, a `src/sim/content/` record, a `src/render/<thing>.ts`), not appended to a monolith (`sim.ts`, `hud.ts`, `renderer.ts`). Do not split a monolith for line count. Fix bugs test-first. See the `extract-and-test` skill and the root Modularity section.
- **New code gets tests**: Every new ability, system, command, `IWorld` member, server endpoint, query, and behavior gets unit tests. Sim: combat math, abilities, AI, economy. Server: command dispatch, persistence, snapshots. Net: wire round-trip. UI: data transforms, frame logic. E2E (`scripts/*.mjs`): user flows where applicable. If you wrote it, test it.
- **Determinism tests**: For sim changes, assert same-seed-same-result; never introduce `Math.random` / `Date.now` / `performance.now` into `src/sim/`.
- **Test maintenance**: Update/remove tests when modifying existing code. When placeholder content is replaced with real content, update the tests. Never leave orphaned or broken tests.
- **Dead code removal**: Delete fully replaced abilities, systems, components, helpers, and types. No commented-out code, unused imports, or deprecated functions.
- **Import cleanup**: Zero unused imports. And uphold the import invariant: `src/sim/` imports nothing from `render/`, `ui/`, `game/`, `net/`, and has no DOM/Three.js imports.
- **Type cleanup**: Remove unreferenced interfaces/types. Consolidate evolved types, do not accumulate.
- **No generated-file hand-edits**: Never hand-edit generated output (e.g. `src/render/assets/manifest.generated.ts` or the media manifest emitted by `npm run build`); regenerate via the build instead.

**Every phase starter prompt must follow this structure:**
````
### Starter Prompt
```
This is Phase N of the {Feature Name} feature: {Phase Title}.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: add the keyword `ultracode` to this prompt if this phase is batch-heavy
(content sweeps across many tables, many-locale i18n additions, exhaustive audit) so you
orchestrate via a Workflow (pipeline + adversarial-verify) instead of hand-spawning agents.

Goal: {one sentence}

STEP 0 - PRE-FLIGHT:
- Verify `git status` is clean before starting. If not, ask the user (a concurrent
  session may share this checkout).
- Memory scan (if you use Claude Code memory): check your `MEMORY.md` index and any
  entries relevant to this phase's domain (suggested topics: {phase-specific patterns}).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/{feature-name}/state.md (locked decisions, validation matrix, file paths)
- docs/{feature-name}/progress.md (Phase N status + deliverable checklist)
- docs/{feature-name}/phase-N-{slug}.md (this prompt) - verify the agent has the same understanding
- {relevant source files for this phase, listed individually}
- CLAUDE.md (root) + the relevant sub-CLAUDE.md files
  ({e.g. src/sim/CLAUDE.md, server/CLAUDE.md, src/ui/CLAUDE.md, src/net/CLAUDE.md})
The agent should return: {specific info this phase needs}.
{If this phase integrates a third-party API/SDK or needs an exact classic-era formula:
also spawn a web-research agent for current primary-source docs/constants; mark
unverifiable facts OPEN rather than guessing.}

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Pick the lightest tool that fits (Explore for recon, then parallel Agent fan-out for
independent slices, then Workflow for batch/scale). Request fan-out EXPLICITLY (Opus 4.8
will not self-initiate it). Give each agent ONLY the Explore summary, not raw planning
docs. Never `mode: "plan"` on teammates. Use `isolation: "worktree"` only if agents edit
overlapping files in parallel.

{Agent A} deliverables:
- {bullet}
- {bullet}

{Agent B} deliverables:
- {bullet}
- {bullet}

INVARIANTS THIS PHASE MUST KEEP (call out the ones in play):
- Determinism: all randomness via `Rng`; no `Math.random` / `Date.now` / `performance.now` in `src/sim/`.
- Seam: extend `IWorld` first, then implement in BOTH `Sim` and `ClientWorld`.
- Server authority: the client never decides combat/loot/quest/economy outcomes.
- i18n: every new player string is a `t()` key in every locale; sim/server emit English
  re-localized via the matchers (`src/ui/sim_i18n.ts` / `src/ui/server_i18n.ts`).
- Classic-era formulas only; do not invent balance numbers.

Out of scope (do NOT do in this phase):
- {explicit exclusions to prevent scope creep}

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run: {phase-specific validation commands referencing the state.md matrix}
  (baseline: `npx tsc --noEmit` + `npx vitest run tests/<affected>.ts`; add
  `npx vitest run tests/localization_fixes.test.ts` if any player text changed; add the
  wire/snapshot suites if the protocol changed).
- Spawn review agents in parallel, but ONLY the ones whose surface this diff touches
  (check `git diff --name-only` against the phase-start commit). Spawning an out-of-scope
  agent wastes tokens; most phases trigger one or two, not all four.
  - `privacy-security-review` - ONLY if the diff touches `server/`, `src/admin/`, `src/net/`,
    a deploy/secret file (Docker/compose/env/CI), or introduces SQL / auth / a secret /
    `ALLOW_DEV_COMMANDS` / a new `Math.random`|`Date.now`|`performance.now` in `src/sim/`.
    NOT for a pure `src/ui` / `src/render` / `src/game` / content / docs / test change.
  - `migration-safety` - ONLY if `server/db.ts`, `server/social_db.ts`, a `server/*_db.ts`,
    or a `characters.state` JSONB serialize/deserialize path changed.
  - `cross-platform-sync` - ONLY if `src/world_api.ts`, `src/sim/` behavior/obs/`SimEvent`,
    `src/net/online.ts`, `server/game.ts` wire/dispatch, the matchers `src/ui/sim_i18n.ts`
    |`src/ui/server_i18n.ts`, or the RL surface (`headless/`, `python/`) changed. A pure
    i18n catalog refactor (only `src/ui/i18n.ts` + locale data, keys unchanged) is NOT in
    scope - `tsc` + the resolved-equivalence test cover it.
  - `qa-checklist` - when this phase completes a deliverable set.
  - If none of the above match, spawn no review agent.
- Prompt each agent you spawn for COVERAGE not filtering. Resume any that truncates with the
  "Stop reading. Output verdict now." message.
- Do not commit until each reports no BLOCKING issues.

STEP 4 - COMMIT CADENCE:
Aim for {2-5} commits with these headlines (Conventional Commits with a scope, e.g.
`feat(sim): ...`, `fix(net): ...`; EXPLICIT paths, never `git add -A`; no em dashes/emojis):
- {commit 1 headline}
- {commit 2 headline}
- ...

STEP 5 - ACCEPTANCE CRITERIA (verifiable checklist; do not mark complete until all check):
- [ ] {acceptance item}
- [ ] {acceptance item}
- ...

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/{feature-name}/progress.md (mark Phase N status; note deferrals).
- Update docs/{feature-name}/state.md (new IWorld members, SimEvents, wire fields,
  endpoints, tables, i18n keys; locked decisions).
- If you use Claude Code memory, record any surprising rules or current-state notes for
  the next session.

STEP 7 - FINAL RESPONSE FORMAT:
End your turn with: phase status, files touched, validation results, review-agent verdicts,
any deferred items, and a one-line handoff for the QA session.

STOPPING RULES:
- {explicit stop conditions: "stop if determinism cannot be preserved", "stop and ask if
  Y changes the wire protocol in a backwards-incompatible way", etc.}
```
````

**Every QA phase starter prompt must follow this structure:**
````
### QA Starter Prompt
```
This is Phase N QA of the {Feature Name} feature: Verify {Phase Title}.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: for a large or high-risk phase, add `ultracode` so you can run an
adversarial-verify Workflow (each finding independently confirmed by a skeptic agent
before it counts).

Goal: Audit Phase N implementation for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness.

STEP 0 - PRE-FLIGHT:
- Verify `git status` is clean (Phase N implementation should already be committed). If dirty, ask the user.
- Memory scan (if you use Claude Code memory): check entries from the Phase N domain.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/{feature-name}/state.md (new IWorld members, SimEvents, wire fields, endpoints, tables from Phase N)
- docs/{feature-name}/progress.md (Phase N deliverables checklist + acceptance criteria)
- docs/{feature-name}/phase-N-{slug}.md (the implementation prompt - what was promised)
- All files created or modified in Phase N (use `git diff` against the phase start commit)
- CLAUDE.md (root) and relevant sub-CLAUDE.md files
The agent should return: full list of Phase N deliverables, all new/modified files, and any known issues.

STEP 2 - QA AUDIT (spawn parallel review agents using the Explore summary; prompt each for COVERAGE not filtering):

Correctness agent:
- Verify every deliverable from Phase N was actually implemented
- Verify every acceptance criterion in the phase prompt is met
- Check for logic bugs, off-by-one errors, missing error handling
- Verify classic-era formulas match the cited references; no invented constants
- Verify the offline `Sim` path and the online `ClientWorld` path behave identically
- Test edge cases: empty states, error states, boundary values, concurrent access
- Run the affected tests and (where useful) an E2E script (`scripts/*.mjs`) and verify behavior matches intent

Test coverage agent:
- Identify new code paths without tests
- Add missing unit tests for new sim behavior, commands, IWorld members, endpoints, queries
- Add a determinism test (same seed, same result) for new sim logic
- Update existing tests broken by Phase N changes
- Remove orphaned tests for deleted/replaced code
- Verify test assertions are meaningful (not just "it runs")

Dead code & cleanup agent:
- Find unused imports, functions, types, components left behind
- Verify the import invariant holds (`src/sim/` imports nothing from render/ui/game/net; no DOM/Three)
- Remove commented-out code
- Consolidate duplicate or near-duplicate logic
- Verify no TODO/FIXME items were left unresolved
- Check for inconsistent naming or patterns vs the rest of the codebase

Multi-agent review dispatch (spawn ONLY the agents whose surface the Phase N diff touches;
check `git diff --name-only` against the phase-start commit - do not run all four by default):
- `privacy-security-review` - ONLY if the diff touches `server/`, `src/admin/`, `src/net/`,
  a deploy/secret file, or introduces SQL / auth / a secret / `ALLOW_DEV_COMMANDS` / a new
  `Math.random`|`Date.now`|`performance.now` in `src/sim/`. NOT for a pure UI/render/game/
  content/docs/test change.
- `migration-safety` - ONLY if server schema/DDL or a `characters.state` persisted-state
  shape changed.
- `cross-platform-sync` - ONLY if IWorld / `src/sim` behavior/obs/`SimEvent` / `ClientWorld`
  / `wireEntity` dispatch / the `sim_i18n`|`server_i18n` matchers / the RL surface changed.
  A pure i18n catalog refactor (keys unchanged) is NOT in scope.
- `qa-checklist` - yes (this is the phase-completion QA gate).
Resume any review agent that truncates mid-analysis with: *"Stop reading more files. Output the full report now. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."*

STEP 3 - FIX: Apply all BLOCKING and SHOULD-FIX items. Run the full validation matrix from state.md
(at minimum `npx tsc --noEmit` and the relevant vitest files; the S3 i18n guard if player text changed).
Commit fixes (separate commits from the QA verdicts themselves so the history is reviewable; EXPLICIT paths).

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/{feature-name}/progress.md (mark Phase N QA complete; note any items deferred to follow-up).
- Update docs/{feature-name}/state.md (any drift discovered during QA).
- If you use Claude Code memory, record any surprising rules learned during QA.

STEP 5 - PACKET TEARDOWN (final phase only; skip entirely otherwise):
If this is the LAST phase in the packet and everything is complete and green, ask the user
for explicit confirmation to delete the planning scaffolding before the PR, e.g.:
"All phases are complete and green. OK to delete docs/{feature-name}/ before the PR?"
- Surface any deferred follow-ups first so nothing tracked only in the packet is lost.
- On confirmation, delete ONLY that directory with an explicit path: `git rm -r
  docs/{feature-name}/` (if it was committed) then commit
  `docs: remove {feature-name} planning scaffolding`, or `rm -rf docs/{feature-name}/`
  (if it was never committed).
- If the user declines, leave it in place. Never delete anything outside that directory and
  never `git add -A`.

STEP 6 - FINAL RESPONSE FORMAT:
End your turn with: QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts of
BLOCKING/SHOULD-FIX/NICE-TO-HAVE found and fixed, deferred items, whether the planning
packet was removed, and a one-line handoff for the next implementation phase (or
"packet complete" if this was the final phase).

STOPPING RULES:
- Stop and surface to the user if any BLOCKING item cannot be fixed without changing the phase scope.
```
````

**Every phase that changes server persistence MUST also:**
- Extend the DDL additively: edit `server/db.ts` `SCHEMA` (or `server/social_db.ts` `SOCIAL_SCHEMA`) using `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so existing realms upgrade in place under the boot advisory lock. There is no migrations directory; the inline DDL is the schema.
- Guarantee back-compat for existing JSONB character state: loading a character saved before this change must not throw or lose data (default any missing fields).
- Add appropriate indexes for any new query predicate.
- Add a persistence round-trip test under `tests/` (save then load, assert equality).

**Mobile in every client phase (the game ships touch controls):**
- Any HUD/input change must work with the touch controls in `src/game/` and respect mobile safe areas.
- Verify with the mobile screenshot scripts (e.g. `node scripts/mobile_visual.mjs`, the `mobile_*_shot.mjs` family) against a phone viewport with `npm run dev` running.
- Keep tap targets comfortable; do not rely on hover for essential info.

**Performance in every phase (the sim is a fixed 20 Hz budget):**
- Sim work per tick must stay within the 20 Hz frame budget; avoid per-tick allocations in hot paths.
- Keep snapshots interest-scoped and delta-guarded; do not send unchanged heavy fields (see the interest radius and `wireEntity` / `selfWireJson` in `server/game.ts`).
- The renderer reads the world and never mutates it; keep draw-call and texture budgets in check (`npm run asset:budget`, `npm run perf:tour`).
- Keep the dependency set tiny; do not add packages without a clear need.

**Deploy gates (any phase that ships server or client changes to production):**
- Production runs in Docker (see `DEPLOY.md`). Standalone update path: ssh to the host, `cd /opt/eastbrook`, `sudo git pull`, `sudo docker compose up -d --build`. Players are saved on shutdown and briefly disconnect.
- Health check after deploy: `curl -s localhost:8787/api/status` returns `{"ok":true,"players_online":N,...}`.
- Before any deploy, the CI-equivalent gate must be green locally: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build` (this mirrors `.github/workflows/ci.yml`).
- Never set `ALLOW_DEV_COMMANDS=1` in production (it enables level/teleport/item cheats).
- Most phases do not deploy; deploys are manual and infrequent. Treat deploy as a deliberate, separate step, not part of every phase.

**Packet teardown (final phase only):**
The planning packet in `docs/{feature-name}/` is cross-session scaffolding, not a shipping artifact. The final QA phase, once every phase is complete and the build / CI-equivalent gate is green, MUST offer to remove it before a PR is opened:
- Ask the user explicitly, in plain language, for example: "All phases are complete and green. OK to delete `docs/{feature-name}/` (the planning scaffolding) before the PR?" Do not delete on assumption.
- Surface any deferred follow-up items FIRST, so nothing tracked only inside the packet is lost when it goes.
- Delete ONLY on explicit confirmation, and ONLY that one directory, with an explicit path:
  - If the docs were committed during the packet: `git rm -r docs/{feature-name}/`, then commit `docs: remove {feature-name} planning scaffolding`.
  - If they were never committed: `rm -rf docs/{feature-name}/`.
- If the user declines or wants to keep them, leave the directory in place and say so; delete nothing.
- Never delete anything outside `docs/{feature-name}/`, never fold the deletion into an unrelated commit, and never `git add -A` (a concurrent session may share this checkout).

### progress.md
- Overall status table (phase | status | date started | date completed) - includes both implementation and QA phases (e.g., "Phase 1", "Phase 1 QA", "Phase 2", "Phase 2 QA")
- Per-phase checklist matching deliverables from implementation-plan.md
- Per-QA-phase checklist (fixes applied, tests added, dead code removed)
- Notes section per phase (filled in after completion)

### state.md
Cross-phase cheat sheet. Contains ONLY what the next session needs:
- Current phase number + status
- Locked design decisions (record once, reference forever)
- Non-negotiable constraints (determinism, server authority, `IWorld`-first, i18n in all locales, no generated-file edits, shared-worktree commit care)
- Validation matrix by change type:
  - **sim-only**: `npx tsc --noEmit` + `npx vitest run tests/sim.test.ts` (and the relevant command suites); determinism check.
  - **content-only**: `npx tsc --noEmit` + `npx vitest run tests/progression.test.ts tests/talents.test.ts` (referential integrity); i18n if new names.
  - **server-only**: relevant server suites + `npx tsc --noEmit` + `npm run build:server`.
  - **net/wire**: `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts` + parity check.
  - **ui/render**: `npx tsc --noEmit` + `npx vitest run tests/localization_fixes.test.ts` (if text) + a mobile screenshot script.
  - **headless/RL**: `npm run build:env` + `npx vitest run tests/env_protocol.test.ts` + a short `npm run bench`.
  - **full-stack / pre-merge**: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
- Key file paths (existing + created by this feature)
- New files created per phase
- New `IWorld` members added per phase
- New `SimEvent`s and wire/snapshot fields added per phase
- API endpoints created per phase
- Database tables/columns added per phase (in the inline `SCHEMA`)
- New i18n keys + matcher rules added per phase
- Architecture decisions (locked once made)
- OPEN research items + known issues / gotchas

### qa-checklist.md
Whole-feature integration matrix verified once at packet completion:
- **Three-host parity**: the offline browser `Sim`, the online `ClientWorld`, and the headless env behave consistently for this feature.
- **Determinism**: same seed gives the same world; no `Math.random` / `Date.now` / `performance.now` in `src/sim/`; determinism tests pass.
- **i18n completeness**: every new player-visible string is a `t()` key present in all locales in `translations`; sim/server emits have matcher rules in `sim_i18n.ts` / `server_i18n.ts`; `npx tsc --noEmit` and `npx vitest run tests/localization_fixes.test.ts` (S3 guard) are green; numbers/money/dates go through `formatNumber` / `formatMoney` / `formatDateTime`.
- **Classic-era fidelity**: formulas match the cited references; no invented balance numbers.
- **Server authority**: no client-trusted outcomes; WS commands validated server-side.
- **Persistence**: characters saved before this feature still load; save/load round-trip verified; DDL changes are additive and idempotent.
- **Performance / budgets**: snapshot bandwidth sane; `npm run asset:budget` and `npm run perf:tour` within budget.
- **Copy review**: no em dashes or emojis in player-facing text (raw emojis as in-game icons are also disallowed by the aesthetic rule).
- **Build gate**: the CI-equivalent gate is green (`npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`).
- **Deploy verification** (only if deployed): `curl -s localhost:8787/api/status` returns ok with the expected build.

## Step 5: Commit

Stage and commit all planning docs (EXPLICIT paths, Conventional Commit, short message, no em dashes/emojis):
```
docs: add {feature-name} phased implementation plan
```

Present a summary to the user:
- Number of phases (implementation + QA)
- What each phase covers (one line each, showing the implement/QA pairs)
- How to start Phase 1 (copy the starter prompt from `phase-01-{slug}.md` or the implementation-plan.md Phase 1 section)
- Locked design decisions captured in state.md
- OPEN research items still needing a human/credential/design answer
- Cross-cutting workflow blocks the user can edit centrally (memory scan, orchestration choice, multi-agent dispatch, validation matrix, deploy gate)
- That the final QA phase will offer **packet teardown** (delete `docs/{feature-name}/`) before the PR, on your explicit confirmation, so the planning scaffolding does not ship
