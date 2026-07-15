<!-- World of ClaudeCraft, project-root CLAUDE.md. Keep this lean (about 200 lines)
     and strictly repo-wide. Area-specific guidance lives in each subdirectory's own
     CLAUDE.md (src/sim/, src/render/, server/, ...), which load on demand when you
     open files there, so do NOT duplicate them here. Anchor guidance on stable paths,
     symbols, and pinned tests, never on counts that rot. HTML comments like this are
     stripped before load (zero tokens). No em dashes, en dashes, or emojis. -->

# World of ClaudeCraft

A classic-style micro-MMO **and** a headless reinforcement-learning
environment, both driven by one deterministic TypeScript simulation core.
Stack: TypeScript (ESM, `strict`) · Three.js renderer · `ws` WebSockets ·
Postgres (`pg`) · Vite + esbuild · Vitest. No UI framework in the game client; tiny
dependency set. The one sanctioned exception is the standalone admin dashboard
(`src/admin/`), which is built with Svelte 5 (it never touches the game client bundle).

## Repo map
| Path | What it is |
|---|---|
| `src/sim/` | **Deterministic game core, the source of truth.** No DOM/Three deps; runs in browser, server, and headless. |
| `src/sim/content/` | Data-as-code: the 9 classes, abilities, zones, dungeons, items, talents, professions content, deeds. |
| `src/render/` | Three.js renderer (procedural geometry/textures/VFX + curated GLBs). Reads the world; never mutates it. |
| `src/game/` | Local input, camera, keybinds, gamepad, mobile controls, sampled WebAudio SFX, and procedural music. |
| `src/ui/` | Classic HUD (frames, windows, tooltips, map, FCT), procedural icons, i18n. |
| `src/styles/` | Extracted HUD CSS under one `@layer` order, imported once via `src/main.ts`. See `src/styles/CLAUDE.md`. |
| `src/net/` | Online client: REST auth + WebSocket world mirror (`ClientWorld`), reconnect, native-app glue. |
| `src/admin/` | Admin dashboard SPA (separate `admin.html` entry). |
| `src/guide/` | Public guide/wiki SPA (separate `guide.html` entry, served at `/wiki`); spoiler-safe content generated from `src/sim/`. |
| `src/editor/` | World editor SPA (separate root-level `editor.html` entry); its 3D viewport composes the real `Sim` + `Renderer`. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, the seam render/ui depend on: one facet interface per domain file under `src/world_api/`, re-aggregated by the barrel (see Architecture). |
| `src/main.ts` | Client entry; fixes the world seed. |
| `server/` | Authoritative game server: HTTP+WS, world loop, Postgres, auth, social, moderation. |
| `server/http/` | The REST request pipeline spine: table router, middleware onion, per-domain `RouteDef` tables, typed schemas, stable error codes. |
| `headless/` + `python/` | RL env server (`env_server.ts`) + Python Gym bindings. |
| `bot/` | Discord bot (role sync, relay, activity feed; own `CLAUDE.md`). |
| `electron/` (+ `build/`) | Desktop (Steam) shell + packaging assets; see `docs/desktop-release.md`. |
| `android/` + `ios/` | Capacitor native shells (`npm run native:*`). |
| `tests/` | Vitest suite (subdirectory map in `tests/CLAUDE.md`). |
| `scripts/` | Asset/build/i18n/SFX tooling + browser E2E / screenshot scripts. |
| `public/` · `docs/` | Static assets, **deployed verbatim to the live site** · design + PRD + ops docs. |
| `mediawiki/` + `deploy/` | Player-wiki container + production first-boot assets (see `DEPLOY.md`). |

Most directories above have their own `CLAUDE.md` with local conventions; read it when you work there.

## Commands
- `npm run dev`: Vite client on :5173 (proxies `/api`, `/admin/api`, `/ws` to :8787).
- `npm run server`: esbuild-bundle + run the authoritative server on :8787.
- `npm test`: Vitest. **Prefer a single file while iterating:** `npx vitest run tests/sim.test.ts`.
- `npm run gate`: the full CI-equivalent pre-merge gate (i18n gen + freshness, malware scan,
  changed-files biome, SFX conformance, full tests with bounded workers, `tsc`, all builds;
  release-tier automatically on a `release/**` branch; FFmpeg/ffprobe come from the bundled
  ffmpeg-static/ffprobe-static packages, PATH is the fallback). Exit-code-safe;
  use it instead of an ad-hoc `&&` chain before calling a change done (piping `npm test` through
  `tail` masks its exit code, and an unbounded run flakes heavy suites under core contention).
- `npm run build`: regen all generated artifacts (i18n, wiki content, sitemap, SFX + media
  manifests), then `vite build`. Five entries: game, admin, play, guide, editor.
- `npm run env` / `npm run bench`: build + run the headless RL env server.
- `npm run db:up` / `npm run db:down`: Postgres 16 in Docker (dev DB on :5433).
- `npm run realms`: run multiple realm processes locally.

See `README.md` for the full host/develop/play guide and the classic-fidelity checklist; `DEPLOY.md` for production.

## Default task workflow
Unless the request says otherwise, the default for any task is to accomplish the stated
objective, and to deliver it this way. This is the baseline for every contribution.

Before making changes:
- **Base your work off the latest release branch** (and its tracking issue), not `main`. The
  release branch is the active integration base; `main` trails it.
- **Create and use a separate git worktree for the task**, so unrelated working-tree WIP never
  contaminates the branch and parallel tasks stay isolated.
- **Review the existing implementation before modifying anything.** Read the code paths, tests,
  and the local `CLAUDE.md` for the area you are touching first.
- **Preserve existing behavior unless the goal explicitly requires changing it.**

Implementation requirements:
- Make **all** the changes the objective needs: code, data, validation, UI, and tests.
- **Avoid unrelated refactors.** Keep the diff scoped to the task.
- **Add or update automated tests** covering the new behavior (`sim/` and `server/` changes
  always get a test).
- Keep the solution maintainable and extensible: follow the module-first seams below, do not grow
  a monolith.
- **If the change is visual, add before/after screenshots to the PR** (desktop and mobile where
  relevant), committed under `docs/screenshots` and referenced from the PR body (the
  `pr-screenshots` skill has the capture recipe).

Deliverable: a PR based off the latest release branch, following
`.github/PULL_REQUEST_TEMPLATE.md`, that is **fully mergeable and passes CI**. Gate it locally
with `npm run gate` (above) before calling it done.

## Architecture (the load-bearing ideas)
- **One sim, three hosts.** The exact same `src/sim/` code runs the offline
  browser world, the online server, and the RL env. Behavior must be identical
  everywhere; that is the whole point.
- **`IWorld` is the only seam.** `IWorld` is split into per-domain facet interfaces
  (`src/world_api/<domain>.ts`); the barrel `src/world_api.ts` re-aggregates them and
  stays count-free. The offline `Sim` satisfies it structurally and the online
  `ClientWorld` implements it by mirroring server snapshots. **`src/render/` and
  `src/ui/` talk only to `IWorld`**, never to `Sim`/`ClientWorld` concretely.
  New feature: add the member to the matching facet file (never the barrel), implement
  it in BOTH worlds, and update the pinned member list in `tests/world_api_parity.test.ts`
  in the same change (see `src/world_api/CLAUDE.md`).
- **The server is authoritative.** Clients stream movement intent + commands at
  20 Hz; the server runs the one shared `Sim` and returns interest-scoped
  (~120 yd) snapshots + per-player events. All combat, loot, quest credit, and
  economy resolve server-side. The client is a renderer; it never decides outcomes.
  REST requests run through the in-house pipeline seam (`server/http/`): a new endpoint is a
  `RouteDef` module behind the registry, never an inline route in `main.ts` (see `server/http/CLAUDE.md`).

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
- **Graphics and performance settings are gameplay-neutral.** A preset or tier knob may shed
  cosmetic richness but NEVER actionable information a player reacts to (own debuffs, party/raid
  HP, cast bars, target HP granularity, enemy positions). Tier knobs read the STATIC preset via
  `src/game/ui_effects_profile.ts`, never the FPS governor. Rule of thumb: if it hides or delays
  something a player acts on, it is not allowed. Exemplars + fairness tests: `src/ui/CLAUDE.md`
  and `docs/design/graphics-settings-fairness.md`.
- **Don't hand-edit generated files** (`*.generated.ts`, the `i18n.resolved.generated`
  bundles, the SFX manifest + runtime pack): regenerate via the owning build step
  (`npm run build` chains them all; SFX tuning edits `scripts/sfx/sfx_gain_map.json` /
  `sfx_speed_map.json`, then `npm run sfx:manifest`).
- **i18n: every player-visible string is a `t()` key**, classified by render sink, not
  statement type: labels, tooltips, placeholders, aria/alt, toasts, dialogs, validation and
  connection errors, static HTML, `document.title`, server-sent player text, and the whole
  admin dashboard (operators are users). Rendered text always comes from `t()`: never concat,
  `?? 'English'` fallbacks, default params, or `setAttribute('aria-label'|'title'|...)`.
  Dev-channel text (`console.*`, assertions, a `throw` no catch surfaces) stays English; if one
  string feeds both a log and the UI, split it. Numbers, money, dates, percents go through
  `formatNumber`/`formatMoney`/`formatDateTime`/`Intl`.
  - **Contributors add ENGLISH only** to the matching `src/ui/i18n.catalog/<domain>.ts` module;
    the maintainer fills every locale at release. Never edit the `src/ui/i18n.locales/` overlays.
    The PR-tier gate permits English-only (one exception, M16: a new wordy English value also
    needs its non-Latin fills in the same change); the release-tier gate (`I18N_RELEASE_TIER=1`)
    hard-fails on any `pending` row.
  - **`src/sim/` and `server/` stay language-agnostic** (no `t()`, no DOM) but their player text
    is in scope: emit a stable key plus values, or English re-localized via the client matcher,
    in the SAME change. The S3 guard (`tests/localization_fixes.test.ts`) enforces it.
  - Full model (catalog layout, matcher rules, formatters, exceptions): `src/ui/CLAUDE.md` and
    `docs/i18n-scaling/translation-workflow.md`.
- **Never set `ALLOW_DEV_COMMANDS=1` in production** (it enables level/teleport/item cheats).
- **Never commit `.env` or secrets.**

## Conventions
- **ESM + TypeScript `strict`** everywhere. 2-space indent; match the surrounding file.
- **Keep the dependency set tiny.** Don't add packages without a clear need. (Svelte
  and `@sveltejs/vite-plugin-svelte` are the one sanctioned exception, scoped to the
  `src/admin/` dashboard bundle; the game/guide/play entries stay framework-free.)
- **No em dashes, en dashes, or emojis** anywhere: code, comments, docs, commits, PR
  text, or player-facing copy. Use commas, colons, parentheses, or "to" for ranges.
  (An emoji that stands in for a real label still needs its real `t()` text.)
- **Commits:** Conventional Commits with a scope (`feat(talents): ...`, `fix(net): ...`,
  `test(sim): ...`), and every commit carries a BODY, never a title alone: after a
  blank line, 1 to 4 plain sentences or short bullet lines saying what changed and
  why (the intent or finding behind it, not a file list), wrapped near 72 columns.
  Branches: `feature/<slug>`, `fix/<slug>`.
- **Docs follow the anchor rule:** cite stable paths, exported symbols, and pinned tests;
  never literal counts or line numbers that rot (see `docs/qa-gate.md`).

## Modularity: module-first is the default for ALL new code
The default, stated explicitly: **every piece of new logic lands as its own small, reusable,
tested module behind an existing seam, imported where needed. Never append it to an existing
big file.** The four logic coordinators (`src/ui/hud.ts`, `src/sim/sim.ts`, `src/main.ts`,
`src/render/renderer.ts`) are ACTIVE extraction targets: never GROW one, and do not split one
just to hit a line count. The deciding question is one: **does this code need the coordinator's
private mutable state** (the live `Sim` loop, the `Hud` DOM and per-frame buffers, the
renderer's scene graph)? If no, it is a sibling module, every time. If only partly, extract the
pure part (math, formatting, id/state resolution) into a host-agnostic module a Vitest imports
directly and leave the coordinator a thin consumer.
- **`src/main.ts` is a firewall, not a home.** Client-bootstrap helpers (mobile, fullscreen,
  shell, loading, analytics, graphics detection) belong in `src/game/` or `src/ui/` sibling
  modules. It is the one coordinator with no seam and still accreting; never add a top-level
  function here when a sibling module will do.
- **Data-as-code is exempt.** Large declarative tables (`src/sim/content/*`,
  `src/ui/i18n.catalog/*`, `talent_i18n.ts`, `sim_i18n.ts`) are correctly big; module-first is
  about LOGIC, never data. Do not "modularize" a data table.

Use the seams this repo already has, do not invent new ones:
- New render/ui data or action: add it to the matching `IWorld` facet
  (`src/world_api/<domain>.ts`), implement in BOTH `Sim` and `ClientWorld`, update the
  parity pin (`tests/world_api_parity.test.ts`), then consume via `IWorld` only.
- New HUD component (a window OR a per-frame frame/bar): its own module the HUD composes,
  never a new banner section in `hud.ts`: a pure view-core (`src/ui/<name>_view.ts`,
  DOM-free, Node-tested, in the `UI_PURE_CORES` allowlist) plus a thin write-elided,
  instance-parameterized painter on the `PainterHost` seam. Reuse a FAMILY before bespoke.
  Full recipe + contracts: `src/ui/CLAUDE.md` and `src/styles/CLAUDE.md`.
- New visual system: a new `src/render/<thing>.ts` the renderer calls, not a method bank on
  `renderer.ts` (pure logic goes in a `RENDER_PURE_CORES` core; see `src/render/CLAUDE.md`).
- New sim SYSTEM behavior (a combat/mob/social/economy mechanic, not just a data record):
  its own module behind the `SimContext` seam (`src/sim/sim_context.ts`), with backing
  state kept on `Sim` as a live `ctx` view, never a new method cluster on the `sim.ts`
  coordinator. See `src/sim/CLAUDE.md`.
- New game content (mob/quest/item/ability/zone/deed): a declarative record in
  `src/sim/content/`, merged by `data.ts`, never a content table inline in `sim.ts`.
  Player-facing content also feeds the `/wiki` guide: run `npm run wiki:content` (auto in
  `pretest`/`build`, freshness-gated by `tests/guide.test.ts`) and add any new `guide.*`
  prose keys (see `src/guide/CLAUDE.md`). Every new piece of conquerable content (a
  dungeon, delve, raid, world boss, zone, or rare) also authors its Book of Deeds
  records in `src/sim/content/deeds.ts` in the SAME change, following the authoring
  rules in `docs/design/deeds.md`; deeds are cosmetic-only (titles, Renown), never
  power, and `tests/deeds_content.test.ts` pins the catalog.
- New server REST endpoint: a `RouteDef` module (`server/<domain>.ts` `export const routes`)
  registered in `server/http/registry.ts`, never an inline handler in `main.ts`. Scaffold with
  `npm run new:endpoint` (see `server/http/CLAUDE.md`).
- New multi-file subsystem: a directory with an `index.ts` barrel exposing only its
  public surface (templates: `src/render/characters/`, `src/ui/i18n.catalog/`), plus a local `CLAUDE.md`.

Extract on the rule of three, not before: leave two similar blocks alone; a third copy,
or one block with a single nameable responsibility, earns its own module. Never abstract
for one use or a hypothetical future need (the pure-core + thin-consumer reference is
`src/ui/unit_portrait.ts` + `unit_portrait_painter.ts`). **Fix bugs test-first, in
isolation:** reproduce the bug with a failing test that exercises the real code path
(if the buggy logic is buried in a coordinator, that is the signal to extract the unit
under test into its own module first), then make the smallest change that turns it green.
Detailed heuristics and the bug-fix workflow live in the `extract-and-test` skill
(`.claude/skills/extract-and-test/`).

## Testing & verification
- Logic/unit: Vitest (`tests/`). Add or update tests when you change sim or server behavior.
  Opt-in real-browser suite: `npm run test:browser` (`tests/browser/`).
- E2E/visual: `scripts/*.mjs` drive real browsers via `puppeteer-core` and need
  `npm run dev` (often `npm run server` too) running. Bot raids / E2E that teleport
  or level need `ALLOW_DEV_COMMANDS=1` (dev only).
- **QA gate before a change is done.** Run `/qa` (or invoke the `qa-checklist` agent) over your
  diff: it checks every invariant in play, names the domain reviewers to dispatch, and ends with
  an adversarial "what is missing" pass. Two checked-in hooks enforce the cheap floor so it is
  never skipped: a `Stop` hook (`.claude/hooks/qa-stop.sh`) blocks instantly on an em/en dash,
  emoji, stray `.only(`, or `debugger`; the `.githooks/pre-push` floor runs `tsc`, the guard
  tests, biome, and the copy scan at push time. See `docs/qa-gate.md` and `.claude/hooks/README.md`.
- **Biome / formatting / CI.** Biome 2.5.0 (`biome.json`: 2-space, lineWidth 100, single quotes,
  trailing commas). CI and the pre-push floor gate CHANGED FILES ONLY (`npm run ci:changed`)
  and fail on errors and format diffs, NOT on lint warnings. Whole-repo `biome check .` is
  intentionally RED (pre-existing debt): a DEFERRED chore, not your regression, do not fix it.
  NEVER run a whole-repo `--write`; format only the files you changed:
  `npx @biomejs/biome check --write <changed-file.ts>`.

## Working style and effort by model
This whole file is the baseline for **any** model: obey all of it. Your active model is
named in your system prompt ("You are powered by the model named ... model ID ..."). The
block below changes only how much you take on at once and at what effort, never what is
correct.
- **Baseline (Sonnet 4.6, any model, and the default whenever you are unsure):** take
  small, verifiable steps; checkpoint with the user before large multi-file changes; use
  one investigation subagent for a broad search rather than fanning out widely. Effort:
  medium by default, low for latency-sensitive trivia, high for hard reasoning.
- **Opus 4.8 (`claude-opus-4-8`) and the Claude 5 family (Fable 5, `claude-fable-5`):**
  work autonomously. Plan multi-step work end to end and carry long-horizon tasks
  (migrations, multi-file refactors) to completion without pausing after each step, as
  long as the build and tests stay green. Front-load the spec: state the task, intent,
  constraints, and the acceptance check in one turn rather than revealing them piecemeal.
  Effort: `xhigh` is the recommended start for coding and agentic work, `high` the minimum
  for intelligence-sensitive work; reserve `max` for genuinely frontier problems and
  measure, since it overthinks and oscillates on structured tasks. The operator can push
  further with ultracode (`xhigh` plus deterministic Workflow fan-out).
- **Fan out, and review for coverage (Opus 4.8 and newer):** these models under-spawn by
  default, so explicitly fan out parallel subagents across independent files, subsystems,
  or batch items; do not spawn for work doable in one response. Before declaring done, have
  a fresh subagent review your own diff: its job is COVERAGE (report every correctness or
  requirement gap with confidence and severity), not filtering, which happens in a later
  pass. The repo ships purpose-built reviewers in `.claude/agents/` (dispatch via `/qa`):
  `qa-checklist` (the end-of-contribution gate), `architecture-reviewer` (determinism + the
  `SimContext` seam for `src/sim/`), `frontend-seam-reviewer` (ui/styles/render seams),
  `cross-platform-sync`, `migration-safety`, `database-performance-reviewer` (query
  cost/cadence, indexes, pool/lock/deadline scaling), `privacy-security-review`,
  `test-coverage-auditor` (assertion decisiveness + pin quality), and the
  `release-malware-audit` release gate; plus the `feature-plan`, `extract-and-test`,
  `release-merge-audit` (after any release merge into a feature branch), `i18n-locale-fill`
  (release-time locale fill), and `pr-screenshots` skills. Prefer those over ad-hoc subagents.
- **State rule scope literally.** These models follow instructions literally and will not
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
`CREDITS.md` (asset licenses) · `docs/design/` (design docs) · `docs/prd/` (feature specs) ·
`docs/qa-gate.md` (the layered QA gate).
