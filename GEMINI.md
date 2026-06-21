# Gemini Developer Guide - World of Claudecraft

This guide provides project-specific context and instructions optimized for **Gemini 3.5 Flash (High)**. Use this file as a persistent reference to align development style, workflows, and commands.

---

## 🤖 Model Capabilities & Optimization

### Gemini 3.5 Flash (High) Performance
- **Model ID**: `gemini-3.5-flash`
- **Config Setting**: `thinking_level: HIGH`
  - *Instruction*: Leverage the high reasoning capabilities. Think through multi-step algorithms, edge cases, and simulation consistency before writing code.
- **Tokens**: Up to 65,536 output tokens and a 1M input context window.
- **Adjustable Thinking Levels**: Set `thinking_level` to `HIGH` for complex logic (physics, pathfinding, WS synchronization, db schemas). If performing lightweight tasks (simple documentation, simple UI alignments), use lower thinking budgets to optimize execution speed.

### Context Caching Optimization (10x discount on input)
- **Granular structure**: Keep codebase imports stable and group them at the top of files.
- **Cache Invalidation Mitigation**: Avoid making unnecessary changes to large files (such as `src/sim/sim.ts` or `GEMINI.md`) unless implementing features. Any change in a file's imports or prefix invalidates the cache, increasing latency and API cost.
- **Large Document Reference**: Keep static/constant reference materials (like this guide and the project API spec) at the beginning of prompt queries.

### Agentic Loop Coordination
- **Subagent Spawning**: For long-horizon research or E2E test runs, spawn the specialized `research` subagent to keep the main context window free of verbose logs.
- **Timer / Cron Scheduler**: Use the native `schedule` tool for delayed checks or recurring tasks (polling servers or waiting for long builds) instead of running terminal `sleep` commands.
- **Direct Output Style**: Gemini 3.5 Flash (High) can generate overly flowery explanations or AI-like narratives when reasoning is set to High. Write concise, direct, and functional comments. Do **not** use em dashes, en dashes, or emojis anywhere (code, comments, docs, commits, PR text, or player copy); prefer commas, colons, parentheses, or "to" for ranges.

### Claude Interoperability
- **`CLAUDE.md` is canonical.** This project is driven primarily through Claude Code (Claude Opus 4.8); the root and per-directory `CLAUDE.md` files are the source of truth for architecture, invariants, commands, and conventions. Read and ingest them during your initialization/planning phase, and when this guide and `CLAUDE.md` disagree, **`CLAUDE.md` wins** — treat this file as the Gemini-session companion, not a competing spec.
- **Git Notice**: `GEMINI.md` is tracked in the repository (it is committed). Keep it consistent with `CLAUDE.md` when conventions change; do not add it to `.gitignore`.

---

## 🗺️ Project Map & Architecture

- **`src/sim/` (Deterministic Simulation Core)**:
  - *Must know*: Purely deterministic game simulation. Zero DOM/WebGL/rendering dependencies.
  - Contains entity state definitions, stats formulas (e.g. classic-era MMO formulas), collision geometry (`colliders.ts`), pathfinding (`pathfind.ts`), and quests.
  - Shared directly by the client (offline mode) and the server (authoritative online mode).
- **`server/` (Authoritative Game Server)**:
  - Node `http` + `ws` WebSocket + REST server (`main.ts`, `game.ts`).
  - Manages player accounts, JWT tokens, PostgreSQL persistence (`db.ts`), rate limits, and live game states.
- **`src/render/` (Three.js Graphics)**:
  - 3D rendering layer built using Three.js (`renderer.ts`, assets preloader, postprocessing).
- **`src/ui/` (Vanilla DOM HUD)**:
  - User interface components (minimap, chat, action bar, quest log, player frames) wired via vanilla TypeScript and direct DOM queries.
- **`python/` (Reinforcement Learning)**:
  - Gymnasium environment wrapper (`wow_env.py`) wrapping the headless Node simulation.
- **`tests/` & `scripts/` (Test Suites)**:
  - Vitest unit tests under `tests/`.
  - Node integration, E2E browser tests, and bot raid simulations under `scripts/`.

---

## 🎮 Deterministic Simulation Core (`src/sim`)

When working inside the simulation package:
1. **Deterministic Mutation**: Never directly modify the `Sim` state or entity properties from rendering or client code. All state mutations must go through `Sim`'s own command methods (e.g. `castAbility`, `targetEntity`, `addItem`) and resolve inside the `tick()` loop (`src/sim/sim.ts`). The numeric RL action surface `applyAction` lives in `src/sim/obs.ts`, not `sim.ts`.
2. **Deterministic RNG**: Always use the seed-based pseudo-random number generator (`src/sim/rng.ts`). Never call `Math.random()`, `Date.now()`, or `performance.now()` in `src/sim/`. `tests/architecture.test.ts` enforces sim purity (no DOM or render/ui/game/net/three imports, no nondeterminism).
3. **Stat Formulas**: Maintain fidelity to classic-era-MMO-style formulas (e.g., Attack Power, Armor Damage Mitigation, Critical Strike rating, and Spell Resistances) defined in `src/sim/content/classes.ts`.
4. **Collision & Spatial Queries**: Use the axis-aligned bounding box (AABB) system in `src/sim/colliders.ts` and spatial indexing in `src/sim/spatial.ts` for physics checks and spell ranges.

---

## 🛠️ Development & Command Reference

### Environment & Database
```bash
npm install                     # Install dependencies
cp .env.example .env            # Copy env template (set POSTGRES_PASSWORD)
npm run db:up                   # Spin up Postgres 16 in Docker (port 5433)
npm run db:down                 # Stop the database container
```

### Running the Game
```bash
npm run server                  # Build & start authoritative game server (:8787)
npm run dev                     # Start client dev server (:5173, proxies api/ws)
npm run env                     # Build & run headless Gymnasium RL server
```

### User Management & Cheats
```bash
npm run admin:grant <username>  # Grant GM/admin status to an account
```

### Testing & Verification
```bash
npm run test                    # Run Vitest unit & integration tests
```

**Playwright Verification:**
Verify game clients and frontend interface behavior using the Playwright MCP server:
1. **Initialize Tab**: Call `browser_tabs` with argument `action: "new"` to prepare a browser page context.
2. **Navigate**: Call `browser_navigate` with argument `url: "http://localhost:5173"` to load the local game client.
3. **Interact & Inspect**: Use MCP tools like `browser_click`, `browser_press_key`, and `browser_evaluate` to verify state transitions and accessibility attributes.
4. **Visual Check**: Run `browser_take_screenshot` (without `filename` to allow temp dir save) to capture the visual interface state.

**Automated Bot / Integration Scripts:**
```bash
node scripts/mp_integration.mjs    # API/WS/Persistence integration suite
node scripts/crypt_raid.mjs        # 5-bot party dungeon raid test (requires ALLOW_DEV_COMMANDS=1)
node scripts/smoke_mage.mjs        # Headless Mage combat/spell-casting smoke test
node scripts/smoke_rogue.mjs       # Headless Rogue combat/energy smoke test
```

### 🔌 Model Context Protocol (MCP) Setup & Usage

The workspace uses MCP servers to enhance the agent's capabilities. Configurations are located in [mcp_config.json](file:///Users/fernando/.gemini/config/mcp_config.json) and global [settings.json](file:///Users/fernando/.gemini/settings.json).

#### ⚙️ Configuration Rules
* **SSE (HTTP) transport (e.g., Context7)**: You must use the `"url"` key to specify the endpoint (do NOT use `"httpUrl"` as it is not recognized by the connector parser and results in a `no connector can handle spec` error).
* **Stdio transport (e.g., Playwright, Postgres)**: Use `"command"` and `"args"` keys to specify the process execution.

#### 🛠️ Available Servers & Tools
1. **Playwright**: Interact with the frontend and automate browser testing.
2. **Postgres**: Read/write queries directly to the local database. Ensure the container is started first (`npm run db:up`).
3. **Context7**: Resolve library IDs and pull up-to-date documentation.

#### 📖 Documentation Retrieval Best Practices
* **Use Context7**: When using libraries and external packages (such as Three.js, pg, etc.), always query Context7 first to obtain version-specific documentation and avoid writing hallucinated or deprecated APIs.
* **Perform Web Search**: Balance Context7 with standard web searches (`search_web`) to retrieve general troubleshooting, ecosystem info, or the latest online data when appropriate.

---

## 🛠️ Git Conventions

Format: `<type>: <short description>` followed by a detailed description body.
Types: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`.

- Keep commits focused on a single change.
- Always include a detailed commit description body explaining the background, context, and exact changes implemented.

---

## 🎨 Coding Standards & Conventions

1. **Imports & Modules**:
   - Use standard ES Modules (`import`/`export`).
   - Prefer relative imports. Maintain absolute path clean-ups if present.
2. **TypeScript Strictness**:
   - Maintain strict type safety. Avoid using `any` type casting.
   - Use defined type interfaces from `src/sim/types.ts`.
3. **UI & Styling**:
   - Use Vanilla CSS for all custom layouts and components.
   - Do **not** import TailwindCSS unless explicitly instructed by the user.
   - Use native DOM APIs and selectors (`document.querySelector`) rather than external frameworks (React/Vue).
4. **No Placeholders**:
   - Never implement placeholder code. Ensure every feature is complete, type-safe, and ready for production before checking in.
5. **Design Tokens & Componentization**:
   - Utilize a unified design token system (CSS custom properties) for styling (e.g., colors, typography, spacers, radius, transitions) to avoid hardcoding values or strings.
   - Design modular, reusable, and cleanly encapsulated UI components. Avoid ad-hoc inline styles.
6. **Accessibility & WCAG Compliance**:
   - All user interface elements must target full accessibility, incorporating keyboard navigation, appropriate focus states, correct semantic tags (like `<form>`), and robust ARIA roles/attributes (`aria-invalid`, `aria-describedby`, `aria-pressed`, `aria-label`).
   - Visual designs must comply with WCAG 2.1 color contrast ratios (at least 4.5:1 for standard text, 3:1 for large text).
7. **Senior Engineering Standards**:
   - Deliver clean, scalable, and well-architected code.
   - **Always read before editing**: Read and fully understand existing patterns, dependencies, and imports in a file before modifying it.
   - **Module-first for new behavior**: prefer a new, focused, testable module behind an existing seam (`IWorld`, a `src/sim/content/` record, a `src/render/<thing>.ts`) over appending a block of logic to a large file. Do not split a monolith just to hit a line count. See the Modularity section in `CLAUDE.md`.
   - **Reason through blast radius**: For simulation changes, DB persistence alterations, API routes, or WebSocket handler updates, reason through failure modes (concurrency, partial success, side-effects) before writing code.
   - **Red team your own diffs**: Critically review your changes before declaring completion. Ask: "What breaks under edge cases? What's the worst input?"
   - **Verification goes beyond compile checks**: Ensure unit/integration tests pass (`npm run test`), and visually verify/interact with UI changes in the browser using the Playwright MCP server (testing both success and error paths).
   - **Zero Warnings & Errors**: Keep code free of TypeScript compiler warnings/errors and ensure 100% test coverage for newly introduced utilities.
8. **UI Text & Copy Standards**:
   - UI-facing text must NEVER use em dashes. Use alternative punctuation (like hyphens, colons, or parentheses) to prevent text from appearing AI-generated.
9. **Input & Key Bindings**:
   - Never hardcode KeyboardEvent codes (e.g. `'KeyW'`, `'Digit1'`). Map them to actions using `keybinds.ts` and dispatch/poll through `Input or InputCallbacks`.
10. **Animation & Locomotion Hysteresis**:
    - Use the locomotion tracker (`src/render/locomotion.ts`) rather than direct input readings for player visual states to prevent walk-animation jitter and handle locomotion-state latency properly.
11. **Localization & Internationalization**:
    - **Route every player-facing string through `t()`**: add the English key to the matching per-domain module under `src/ui/i18n.catalog/<domain>.ts` (new HUD chrome goes in `hud_chrome.ts`), then render via `t('dotted.key', values)`. `src/ui/i18n.ts` is the thin runtime (`t`, formatters, locale resolution) and imports the generated `en`; do not author strings there.
    - **Locale coverage is release-gated, not per-PR**: English-only is correct per PR (the PR-tier gate permits it). Contributors add ENGLISH only; the maintainer batch-fills the 13 non-English locales before release via the `src/ui/i18n.locales/<lang>.ts` overlays (do not hand-edit them). The authoritative locale set is `supportedLanguages` (derived from the generated `SUPPORTED_LANGUAGES`); author against the code, not a printed list. See `docs/i18n-scaling/translation-workflow.md`.
    - **No fake translations**: never put copied English, a placeholder, an empty string, or `// TODO` into a non-English overlay as a stand-in translation. (English-only per PR is fine; the maintainer fills real translations at release.)
    - **No laundering**: the final rendered text, however assembled, must come from `t()`. Defects (when the result is user-facing): string concatenation, template-literal English parts, English default parameters (`title = 'Notice'`), `value ?? 'English'` fallbacks, English-valued lookup or enum maps, non-`t()` wrappers, and English literals passed to `setAttribute('aria-label'|'title'|'placeholder'|'alt', ...)`, `document.title`, or native `confirm` / `prompt` / `alert`.
    - **Locale-aware formatting**: all user-facing numbers, money, percentages, units, dates, and times go through `formatNumber` / `formatDateTime` / `formatMoney` / `languageTag` / `Intl` with the player SupportedLanguage. Never raw `String(n)`, default-locale `toLocaleString()`, hard-coded separators, or `n + 'g'` concatenation.
    - **Classify by render sink, not statement type**: if any code path can render a string to a person it is player-facing, even when it sits in a `throw`, `catch`, or `console.*`. In scope: visible labels, tooltips, titles, placeholders, ARIA and accessible names, `alt` text, toasts, banners, dialogs, user-shown error and validation text (validation, "connection lost"), static HTML, SEO/meta and `document.title`, server-sent player text, and the entire admin dashboard (operators are users). If one string feeds both a log and the UI, split it: a `t()` key for the user, a separate English literal for the log.
    - **Dev-channel exemption only**: text whose sole sink is `console.*`, an assertion, an internal id, a code comment, or a `throw new Error(...)` that no catch path surfaces to a user stays English and must not be keyed. A thrown error that is caught and displayed is player-facing and must be translated.
    - **Sim and server stay language-agnostic but their player text is in scope**: `src/sim` and `server` run headless (no DOM, no `t()`), yet any player-shown text they emit (combat, loot, system, chat, guild/party, ban/suspension notices in `server/social.ts`, `server/admin.ts`, and similar) must be a stable key plus values, or English re-localized at the client boundary by adding a matching entry to `src/ui/sim_i18n.ts` and its `src/ui/server_i18n.ts` mirror (via `localizeSimText` / `localizeServerText`) in the same change. Emitting new English player text without a matcher entry is a defect; the S3 drift test (`tests/localization_fixes.test.ts`) guards sim emits.
    - **Emojis and symbols**: need no translation entry and may appear inline or stand alone, but must never replace a required translation (the accessible name behind an emoji control is still a `t()` key). This is about translation coverage only and does not override the separate no-raw-emoji-as-in-game-icon aesthetic rule in this guide.
    - **The enforcement gap you own**: `tsc` (via `: typeof en`) catches a missing or renamed key but cannot see a hard-coded literal that never became a key, nor a new sim/server English emit missing its matcher entry. Both compile clean and ship English to a translated player, and no human reviewer reliably catches it: this discipline is on you.

---

## 🎨 UI/UX & Frontend Architecture Guidelines

When developing user interfaces, menus, or launchers for the game client:

### 1. Aesthetic Style & MMO Theme
- **Classic-MMO-Inspired Themes**: Target a premium, dark fantasy theme with deep dark tracks, gold-brown accents, and rich borders. Avoid default browser elements.
- **No Emojis**: Do not use raw emojis for icons. Generate procedural in-game ability/class icons dynamically, or use high-quality assets/SVGs.
- **Rich Transitions**: Implement smooth, interruption-safe transition classes (e.g., cross-fades) to navigate between views without layout shifts.

### 2. Layout & Component Architecture
- **Componentization**: Design modular, cleanly encapsulated, and reusable UI components. Avoid ad-hoc styling and inline styles.
- **Layout Stability**: Ensure layout grids and panels are structurally stable. Content updates must not cause parent resizing, layout jumps, or clipping.
- **Responsive Design**: Support fluid, responsive dimensions using flexible grids, flexbox, container queries, and fluid typography.
  - *Fluid Widths over Viewport Widths*: Avoid using absolute viewport width percentages (e.g., `92vw`) on panel structures, which can cause page overflow when combined with margins or parent padding. Use `width: 100%` alongside constraints like `max-width`.
  - *Prevent Mobile Input Auto-Zoom*: Apply a `font-size` of at least `16px` on form controls (e.g., `select`, `input`) for mobile screens to stop iOS Safari from auto-zooming.
  - *Touch Target Sizing*: Interactive elements (e.g., dropdowns, navigation button links) must maintain vertical tap dimensions of at least `40px` (via touch padding like `10px 16px` or explicit heights).
  - *Mobile menu drawer*: Implement vertical drawer menus (overlay dropdowns) toggled by a hamburger button rather than allowing headers to wrap or overflow on narrow viewports.

### 2.1 Mobile Touch And Zoom Baseline
- Use at least `16px` font size for every visible mobile `input`, `select`, and `textarea`. This prevents iOS Safari from zooming into fields and keeps forms stable.
- Give every mobile touch target at least a `40px` by `40px` tappable area. This includes native buttons and links, selects, icon-only controls, tabs, and custom interactive elements with roles such as `button`, `tab`, or `option`.
- Apply these rules through touch-device or mobile runtime selectors where possible, not only `max-width` breakpoints. Landscape phones can be wide enough to skip narrow viewport CSS while still needing mobile touch sizing.
- Verify both mobile portrait and mobile landscape for input zoom, missed touch targets, clipping, overlap, and horizontal overflow before declaring UI work complete.

### 3. Accessibility & Usability (WCAG 2.1 AA)
- **Keyboard Navigation**: Ensure all menus, buttons, and custom cards are fully navigable and activatable using only `Tab`, `Shift+Tab`, `Space`, and `Enter`.
- **Keyboard Focus States**: Custom interactive elements must use high-contrast focus indicators (`:focus-visible`).
- **No Scale Effects on Focus/Hover**: Avoid using scale transforms (`transform: scale(...)`) on focus/hover for list, rail, or chip items to prevent motion sickness.
- **Reduced Motion Support**: Always respect the `prefers-reduced-motion` media query by disabling panel cross-fades, content translations, and automated 3D camera auto-rotations.
- **Semantic Markup & ARIA**: Ensure correct HTML semantic tags or appropriate ARIA roles (`role="button"`, `role="option"`, `aria-selected`, `tabindex="0"`) are used.
