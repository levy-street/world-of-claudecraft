---
name: feature-plan
description: Break a large World of ClaudeCraft feature into a phased Codex implementation plan with starter prompts, progress tracking, cross-session state, explicit subagent dispatch, validation gates, and Codex-native review agents. Use when a feature is too large for one focused Codex session.
---

# Feature Plan: Multi-Phase Codex Planning

Create a phased implementation packet for a large feature. Each implementation phase and QA phase should be executable in a fresh Codex session without needing the original conversation.

## Codex Surfaces

- Use `AGENTS.md` plus relevant nested `CLAUDE.md` files as project guidance. In this repo, `CLAUDE.md` is canonical and `AGENTS.md` mirrors it for Codex.
- Use Codex subagents only when the user asks for parallel agents or when a generated phase prompt explicitly requests them. Codex does not spawn subagents automatically.
- Use project custom agents from `.codex/agents/*.toml` when the review surface matches:
  - `cross-platform-sync`
  - `migration-safety`
  - `privacy-security-review`
  - `qa-checklist`
- Use worktrees when concurrent implementation would otherwise collide. Codex-managed app worktrees live under `$CODEX_HOME/worktrees`; this project also keeps local Codex worktrees under ignored `.codex/worktrees/`.
- Use current official docs for third-party APIs, libraries, model behavior, and Codex behavior. Prefer Context7 or official primary docs for libraries, and OpenAI docs/manual for Codex/OpenAI surfaces.

## Project Invariants

World of ClaudeCraft is a classic-style micro-MMO and headless RL environment driven by one deterministic TypeScript simulation core.

- One sim, three hosts: offline browser `Sim`, authoritative server, and headless RL env.
- `IWorld` is the seam. Extend `src/world_api.ts` first, then implement both `Sim` and `ClientWorld`.
- The server is authoritative. Clients stream intent; server/sim decide outcomes.
- Determinism is mandatory. Use `Rng`; never use `Math.random`, `Date.now`, or `performance.now` in `src/sim/`.
- i18n must route player-visible text through `t()` or sim/server matcher localization at the client boundary.
- Do not hand-edit generated files.

## Workflow

### Step 1: Understand The Feature

If the user did not provide enough detail, ask only for the missing feature scope. Identify:

- Desired player/operator behavior.
- Systems touched: sim, server, net, render, UI, admin, headless, persistence, tests.
- Third-party docs or exact game formulas that need source verification.
- Explicit out-of-scope items.

### Step 2: Explore With Focused Subagents

For broad features, ask Codex to spawn read-only subagents in parallel. Use the built-in `explorer` agent with role-specific prompts. Each subagent should return a summary, file references, risks, and relevant tests rather than raw dumps.

Use only the relevant explorer roles:

- Sim explorer: `src/sim/`, `src/sim/content/`, and sim tests.
- Server explorer: `server/`, persistence, command dispatch, snapshots, auth/rate limiting.
- Client explorer: `src/render/`, `src/ui/`, `src/game/`, accessibility, i18n, input.
- Net explorer: `src/net/`, `ClientWorld`, wire protocol, event handling.
- Admin explorer: `src/admin/`, admin API/UI/i18n.
- Headless explorer: `headless/`, `python/`, env protocol.
- Docs researcher: primary-source docs for third-party APIs/libraries or exact classic-era formulas.

Keep the main thread focused on decisions and the final plan.

### Step 3: Align With The User

Summarize current state, reusable systems, new work, risks, and open questions. Get user agreement before writing the phase packet when the feature direction is ambiguous.

### Step 4: Create The Planning Packet

Create `docs/{feature-name}/` with:

- `README.md`: one-paragraph summary and ordered index.
- `brainstorm.md`: approved feature vision, current state, reusable systems, new work, research notes, open questions.
- `implementation-plan.md`: workflow, phase table, validation matrix, and review dispatch matrix.
- `progress.md`: status table and acceptance checklist per phase.
- `state.md`: locked decisions, touched surfaces, new `IWorld` members, `SimEvent`s, wire fields, endpoints, tables, i18n keys, and test commands.
- `qa-checklist.md`: whole-feature QA matrix.

For 12+ phases or complex work, add:

- `phase-XX-{slug}.md`: implementation prompt.
- `phase-XX-qa.md`: QA prompt.

The final QA phase should offer packet teardown, deleting `docs/{feature-name}/` only after explicit user approval.

## Phase Design

- Prefer small phases. One phase should have 2-4 deliverables and be finishable in a focused Codex session.
- Start with architecture/foundation: data model and `IWorld`.
- Keep offline and online worlds in lockstep as each feature slice lands.
- Add persistence only after the model/server behavior is clear.
- Add renderer/HUD/i18n surfaces after behavior and network surfaces exist.
- Follow each implementation phase with a dedicated QA phase.

## Starter Prompt Template

Each phase file should include a prompt like:

```text
This is Phase N of the {Feature Name} feature: {Phase Title}.

Harness: Codex.
Model guidance: use gpt-5.5 for demanding implementation/review; use gpt-5.4-mini only for lightweight read-only scans when speed matters.

Goal: {one sentence}

STEP 0 - PRE-FLIGHT:
- Run git status --short.
- Read AGENTS.md and relevant nested CLAUDE.md files.
- Preserve unrelated user changes.

STEP 1 - LOAD CONTEXT:
Ask Codex to spawn focused read-only subagents if the phase spans multiple surfaces.
Each subagent should return findings with file references and test suggestions.

STEP 2 - EXECUTE:
Implement only the listed deliverables.
Keep these invariants: {phase-specific invariants}.
Out of scope: {explicit exclusions}.

STEP 3 - VALIDATE:
Run the smallest useful validation set.
Required commands: {commands}.

STEP 4 - REVIEW DISPATCH:
Spawn only the matching `.codex/agents` reviewers:
{review dispatch list}

STEP 5 - UPDATE PACKET:
Update progress.md and state.md with completed work, validation evidence, and deferred items.
```

## Review Dispatch Matrix

Spawn a custom Codex review agent only when the diff touches its surface:

| Agent | Spawn when the diff touches | Skip for |
|---|---|---|
| `privacy-security-review` | `server/`, `src/admin/`, `src/net/`, deploy/secret/config files, SQL/auth/secrets/rate limits, or forbidden sim wall-clock/randomness | pure docs/tests/content/UI/render work |
| `migration-safety` | `server/db.ts`, `server/social_db.ts`, `server/*_db.ts`, or `characters.state` save/load shape | no DDL or persisted JSONB shape change |
| `cross-platform-sync` | `src/world_api.ts`, `src/sim/`, `src/net/online.ts`, `server/game.ts`, sim/server i18n matchers, `headless/`, `python/` | docs-only, tests-only, or pure i18n catalog refactors with unchanged keys |
| `qa-checklist` | a phase or feature deliverable set is complete | mid-phase or tiny single-surface edits |

Ask review agents to report every issue, including low-severity and uncertain ones. Ranking happens after coverage.

## Validation Matrix

Choose the smallest set that covers the changed surface:

- TypeScript/source: `npx tsc --noEmit`
- Unit/integration: `npx vitest run tests/<affected>.ts`
- Broad confidence: `npm test`
- Build: `npm run build`
- Server bundle: `npm run build:server`
- Headless env: `npm run build:env`
- i18n emit/matcher changes: `npx vitest run tests/localization_fixes.test.ts`
- Snapshot/wire/RL changes: `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts`
- Asset changes: `npm run asset:budget`

## Code Hygiene

- Add or update tests for new behavior.
- Delete replaced dead code and unused types/imports.
- Keep `src/sim/` free of DOM, browser, Three.js, render, UI, game, and net imports.
- Do not add placeholders or TODO-driven implementations.
- Do not commit or stage unrelated files.
