<!-- World of ClaudeCraft, project-root CLAUDE.md. Keep this lean (about 170 lines)
     and strictly repo-wide. Area-specific guidance lives in each subdirectory's own
     CLAUDE.md (src/sim/, src/render/, server/, ...), which load on demand when you
     open files there, so do NOT duplicate them here. HTML comments like this are
     stripped before load (zero tokens). No em dashes, en dashes, or emojis. -->

# World of ClaudeCraft

A classic-style micro-MMO **and** a headless reinforcement-learning
environment, both driven by one deterministic TypeScript simulation core.
Stack: TypeScript (ESM, `strict`) · Three.js renderer · `ws` WebSockets ·
Postgres (`pg`) · Vite + esbuild · Vitest. No UI framework; tiny dependency set.

## Repo map
| Path | What it is |
|---|---|
| `src/sim/` | **Deterministic game core, the source of truth.** No DOM/Three deps; runs in browser, server, and headless. |
| `src/sim/content/` | Data-as-code: the 9 classes, abilities, zones, dungeons, items, talents. |
| `src/render/` | Three.js renderer (procedural geometry/textures/VFX). Reads the world; never mutates it. |
| `src/game/` | Local input, camera, keybinds, mobile controls, procedural WebAudio. |
| `src/ui/` | Classic HUD (frames, windows, tooltips, map, FCT), procedural icons, i18n. |
| `src/net/` | Online client: REST auth + WebSocket world mirror (`ClientWorld`). |
| `src/admin/` | Admin dashboard SPA (separate `admin.html` entry). |
| `src/world_api.ts` | `IWorld`, the seam render/ui depend on (see Architecture). |
| `src/main.ts` | Client entry; fixes the world seed. |
| `server/` | Authoritative game server: HTTP+WS, world loop, Postgres, auth, social, moderation. |
| `headless/` + `python/` | RL env server (`env_server.ts`) + Python Gym bindings. |
| `tests/` | Vitest suite. |
| `scripts/` | Asset build + browser E2E / screenshot / integration scripts (`.mjs`). |
| `public/` · `docs/` | Static assets (GLB models / textures / HDRIs) · design + PRD docs. |

Most directories above have their own `CLAUDE.md` with local conventions; read it when you work there.

## Commands
- `npm run dev`: Vite client on :5173 (proxies `/api`, `/admin/api`, `/ws` to :8787).
- `npm run server`: esbuild-bundle + run the authoritative server on :8787.
- `npm test`: Vitest. **Prefer a single file while iterating:** `npx vitest run tests/sim.test.ts`.
- `npm run build`: generate media manifest, then `vite build`, then emit manifest. Two entries (game + admin).
- `npm run env` / `npm run bench`: build + run the headless RL env server.
- `npm run db:up` / `npm run db:down`: Postgres 16 in Docker (dev DB on :5433).
- `npm run realms`: run multiple realm processes locally.

See `README.md` for the full host/develop/play guide and the classic-fidelity checklist; `DEPLOY.md` for production.

## Architecture (the load-bearing ideas)
- **One sim, three hosts.** The exact same `src/sim/` code runs the offline
  browser world, the online server, and the RL env. Behavior must be identical
  everywhere; that is the whole point.
- **`IWorld` is the only seam.** `src/world_api.ts` defines `IWorld`; the offline
  `Sim` satisfies it structurally and the online `ClientWorld` implements it by
  mirroring server snapshots. **`src/render/` and `src/ui/` talk only to `IWorld`**,
  never to `Sim`/`ClientWorld` concretely. New feature: extend `IWorld` first,
  then implement it in both worlds.
- **The server is authoritative.** Clients stream movement intent + commands at
  20 Hz; the server runs the one shared `Sim` and returns interest-scoped
  (~120 yd) snapshots + per-player events. All combat, loot, quest credit, and
  economy resolve server-side. The client is a renderer; it never decides outcomes.

## Invariants, YOU MUST keep these
- **`src/sim/` has zero DOM/browser/Three.js imports** and never imports from
  `render/`, `ui/`, `game/`, or `net/`. It must run unchanged in Node and the
  browser. (Guarded by `tests/architecture.test.ts`, which scans every sim file.)
- **Determinism.** The sim is a fixed **20 Hz** tick (`DT = 1/20`). All randomness
  goes through `Rng` (`src/sim/rng.ts`): **never `Math.random`**, `Date.now`, or
  `performance.now` in sim logic. Same seed gives the same world. (Also guarded by
  `tests/architecture.test.ts`.)
- **Gameplay math follows real classic-era MMO formulas** (rage, hit tables, armor DR,
  XP curves; see `README.md` and `docs/design/`). Don't invent balance numbers.
- **Don't hand-edit generated files**, e.g. `src/render/assets/manifest.generated.ts`
  (regenerate via the build).
- **i18n: every player-visible string is a `t()` key**, classified by render sink,
  not statement type. In scope: labels, tooltips, placeholders, aria/alt, toasts,
  dialogs, validation and "connection lost" errors, static HTML, `document.title`,
  server-sent player text, and the whole admin dashboard (operators are users). The
  final rendered text always comes from `t()`, never concat, `?? 'English'`
  fallbacks, default params, or `setAttribute('aria-label'|'title'|...)`. Out of
  scope (English only): dev-channel text (`console.*`, assertions, a `throw` no catch
  surfaces); if one string feeds both a log and the UI, split it. Numbers, money,
  dates, and percents go through `formatNumber`/`formatDateTime`/`formatMoney`/`Intl`.
  - **Contributors add ENGLISH only; the maintainer fills every locale at release.**
    Add the key to `en` (the matching `src/ui/i18n.catalog/<domain>.ts` module) and
    render it via `t()`. Never edit the `src/ui/i18n.locales/<lang>.ts` overlays, and
    never put English, a placeholder, or a `// TODO` into one. The build English-fills
    omissions (registry marks them `pending`): the PR-tier gate permits English-only,
    the release-tier gate (`I18N_RELEASE_TIER=1`) hard-fails on any `pending` row.
  - **`src/sim/` and `server/` stay language-agnostic** (no `t()`, no DOM) but their
    player text is in scope: emit a stable key plus values, or English re-localized
    via the client matcher (`src/ui/sim_i18n.ts` + `server_i18n.ts`) in the SAME
    change. The S3 guard (`tests/localization_fixes.test.ts`) enforces it.
  - Full model (catalog layout, the `hud_chrome` English-only exception, formatters,
    matcher rules): `src/ui/CLAUDE.md` and `docs/i18n-scaling/translation-workflow.md`.
- **Never set `ALLOW_DEV_COMMANDS=1` in production** (it enables level/teleport/item cheats).
- **Never commit `.env` or secrets.**

## Conventions
- **ESM + TypeScript `strict`** everywhere. 2-space indent; match the surrounding file.
- **Keep the dependency set tiny.** Don't add packages without a clear need.
- **No em dashes, en dashes, or emojis** anywhere: code, comments, docs, commits, PR
  text, or player-facing copy. Use commas, colons, parentheses, or "to" for ranges.
  (An emoji that stands in for a real label still needs its real `t()` text.)
- **Commits:** Conventional Commits with a scope (`feat(talents): ...`, `fix(net): ...`,
  `test(sim): ...`). Branches: `feature/<slug>`, `fix/<slug>`.

## Modularity, module-first for new code
The large existing files are normal: `sim.ts` and `hud.ts` are the two largest, then
`main.ts` and `renderer.ts`. Do NOT split one just to hit a line count; the
deterministic sim core and the single scene coordinator are correct as monoliths. But
NEW self-contained behavior belongs in its own small module behind an existing seam,
not bolted onto a monolith as another method cluster or banner section. If the work
does not need a monolith's private mutable state, it is a sibling module. Use the seams
this repo already has, do not invent new ones:
- New render/ui feature: extend `IWorld` (`src/world_api.ts`) first, implement in BOTH
  `Sim` and `ClientWorld`, then consume via `IWorld`. render/ui never import a concrete world.
- New self-contained HUD window or panel: its own module the HUD composes, not a new
  banner section in `hud.ts` (the direction the HUD modularization is heading).
- New visual system: a new `src/render/<thing>.ts` the renderer calls, not a method bank on `renderer.ts`.
- New game content (mob/quest/item/ability/zone): a declarative record in
  `src/sim/content/`, merged by `data.ts`, never a content table inline in `sim.ts`.
- New multi-file subsystem: a directory with an `index.ts` barrel exposing only its
  public surface (templates: `src/render/characters/`, `src/ui/i18n.catalog/`), plus a local `CLAUDE.md`.

Extract on the rule of three, not before: leave two similar blocks alone; a third copy,
or one block with a single nameable responsibility, earns its own module. Never add an
abstraction for one use or a hypothetical future need. Lift pure presentation/domain
logic (geometry, formatting, id/state resolution) out of DOM/render/sim modules into a
small host-agnostic module a Vitest imports directly, leaving the render side a thin
consumer (reference: `src/ui/unit_portrait.ts` core plus `unit_portrait_painter.ts`).
Fix bugs test-first: a failing test that reproduces the bug, then the smallest change
that turns it green. Detailed heuristics and the bug-fix workflow live in the
`extract-and-test` skill (`.claude/skills/extract-and-test/`).

## Testing & verification
- Logic/unit: Vitest (`tests/`). Add or update tests when you change sim or server behavior.
- E2E/visual: `scripts/*.mjs` drive real browsers via `puppeteer-core` and need
  `npm run dev` (often `npm run server` too) running. Bot raids / E2E that teleport
  or level need `ALLOW_DEV_COMMANDS=1` (dev only).

## Working style and effort by model
This whole file is the baseline for **any** model: obey all of it. Your active model is
named in your system prompt ("You are powered by the model named ... model ID ..."). The
block below changes only how much you take on at once and at what effort, never what is
correct.
- **Baseline (Sonnet 4.6, any model, and the default whenever you are unsure):** take
  small, verifiable steps; checkpoint with the user before large multi-file changes; use
  one investigation subagent for a broad search rather than fanning out widely. Effort:
  medium by default, low for latency-sensitive trivia, high for hard reasoning.
- **Opus 4.8 only (model ID `claude-opus-4-8`):** work autonomously. Plan multi-step work
  end to end and carry long-horizon tasks (migrations, multi-file refactors) to completion
  without pausing after each step, as long as the build and tests stay green. Front-load
  the spec: state the task, intent, constraints, and the acceptance check in one turn
  rather than revealing them piecemeal. Effort: `xhigh` for coding and agentic work,
  `high` minimum for intelligence-sensitive work; reserve `max` for genuinely frontier
  problems and measure, since it overthinks and oscillates on structured tasks. The
  operator can push further with ultracode (`xhigh` plus deterministic Workflow fan-out).
- **Fan out, and review for coverage (Opus 4.8):** 4.8 under-spawns by default, so
  explicitly fan out parallel subagents across independent files, subsystems, or batch
  items; do not spawn for work doable in one response. Before declaring done, have a fresh
  subagent review your own diff: its job is COVERAGE (report every correctness or
  requirement gap with confidence and severity), not filtering, which happens in a later
  pass. The repo ships purpose-built reviewers in `.claude/agents/` (`cross-platform-sync`,
  `migration-safety`, `privacy-security-review`, `qa-checklist`), a `feature-plan` skill,
  and an `extract-and-test` skill; prefer those over ad-hoc subagents.
- **State rule scope literally.** 4.8 follows instructions literally and will not
  generalize a rule across cases unless told. When an invariant covers every case (every
  player string is a `t()` key; all sim randomness goes through `Rng`), say "every" or
  "all"; do not rely on generalization by analogy.
- **Never gate the Invariants, safety (`ALLOW_DEV_COMMANDS`, secrets), or correctness on
  which model you are:** the identity line can be stale, so when in doubt use the
  baseline. Anchor every autonomous step on a check you can actually run (`npx vitest run
  <file>`, `npm test`, `npm run build`, `tests/architecture.test.ts`, the S3 i18n guard
  `tests/localization_fixes.test.ts`), never on "looks done."

## Pointers
`README.md` (host/develop/play + fidelity checklist) · `DEPLOY.md` (production) ·
`CREDITS.md` (asset licenses) · `docs/design/` (design docs) · `docs/prd/` (feature specs).
